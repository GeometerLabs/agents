// The Streetlist home on the partner server (plan item 6 of before-launch.md, decision 49): streetlist.in's static pages (/, /shops, /partners, /privacy,
// /examples/..., /assets/...) are served by the partner server's own Caddy, and everything else on that domain goes to the front door (services/door.ts).
// This file is the one place that knows what the home is and how a build of it reaches the server:
//
//   - WHAT IT SERVES: the names the home owns (HOME_TOP). Each must be reserved in fleet's slug list (apps/fleet/src/page-slugs.ts RESERVED_SLUGS), so a shop can never
//     take a name a static file answers for. Two tests keep that true (bundle/test/home.test.ts and fleet's test/page-slugs.test.ts), and `install` refuses a build that
//     holds any other top-level name.
//   - HOW A BUILD ARRIVES: one "pack" file, made on the owner's machine from the streetlist repository's built `dist/` (`geometer home pack <streetlist folder>`), then
//     put on the server by file or https address and installed with `geometer home install`. Its sha256 is the pin (bundle/home.json, reviewed with the commit that
//     the server runs), so what is served is exactly what was reviewed. No build tool, no npm and no git ever run on the server.
//   - HOW IT IS SWITCHED: home/releases/<id>/ holds each installed build; home/current is a RELATIVE symlink to one of them and is replaced by renaming a new symlink over
//     it (atomic: a request sees the old build or the new one, never half of either); home/previous keeps the one before for `geometer home rollback`.
//     Caddy mounts the home/ folder (not the symlink: Docker resolves a bind-mounted symlink once, at start) read-only and reads home/current/site.
//   - THE HEADERS AND CACHE RULES are the streetlist repository's firebase.json, ported by hand into generate/compose.ts (homeHandlers). To make that one source of truth,
//     the pack records a hash of firebase.json's rules (rulesSha) and `install` refuses a build whose rules differ from HOME_RULES_SHA below, so a changed header
//     cannot go live without the Caddy side being reviewed. A test compares the hash with the repository's own firebase.json when it is beside this one.
//
// Nothing here touches the network except `readSource` (https only, size-capped, checksum verified before anything is parsed or written).
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync, chmodSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { Refused, stableJson } from "./util.ts";

/** The top-level names the home owns, as a visitor types them (`/shops`, `/assets/...`). Every one is in fleet's RESERVED_SLUGS. */
export const HOME_TOP: readonly string[] = ["shops", "partners", "privacy", "examples", "assets"];
/** Single files at the top that are not slugs (a dot is never in a slug). robots.txt is not here: Caddy answers it, merged with the door's. */
export const HOME_FILES: readonly string[] = ["favicon.svg"];
/** Pages inside /examples/, as the home builds them (a name here is a file examples/<name>.html). Any lowercase name is accepted, the shape is checked on install. */
export const HOME_EXAMPLE_NAME = /^[a-z0-9][a-z0-9-]{0,60}$/u;
/** Firebase's `redirects` for the one redirect the home has: /examples is the first example. Kept with the rules hash below. */
export const HOME_EXAMPLES_REDIRECT = "/examples/glow-salon";

/** Inside Caddy's container: the home/ folder is mounted here, and the served build is the one `current` points to. */
export const HOME_MOUNT = "/srv/home";
export const HOME_SITE_ROOT = `${HOME_MOUNT}/current/site`;

/** The sha256 of the streetlist repository's firebase.json rules (cleanUrls, trailingSlash, redirects, headers) that generate/compose.ts's homeHandlers ports. */
export const HOME_RULES_SHA = "0b520e80971c20999d0fb25ad981f7f06e6152dcb04fb88250ab01cb2d437d14";
/** What the home's robots.txt disallows (its public/robots.txt). The door's own list is in services/door.ts; Caddy answers /robots.txt with both. */
export const HOME_ROBOTS_DISALLOW: readonly string[] = ["/examples/"];

const MAX_PACK_BYTES = 12 * 1024 * 1024;
const MAX_FILES = 2000;
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/u;

export class HomeRefused extends Refused {
  constructor(message: string) { super([{ rule: "home", message }]); }
}

export interface PackFile { path: string; sha256: string; size: number; data: string }
export interface Pack { format: 1; commit: string; rulesSha: string; files: PackFile[] }

const sha256 = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex");

/** The pin: which pack this bundle's commit serves (bundle/home.json). Empty until the owner makes the first pack. */
export interface HomePin { commit: string; sha256: string; url: string }
export function readPin(file = new URL("../home.json", import.meta.url)): HomePin {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const text = (k: string) => (typeof raw[k] === "string" ? raw[k] as string : "");
  return { commit: text("commit"), sha256: text("sha256"), url: text("url") };
}

// ---- making a pack (on the owner's machine) -----------------------------------------------------------------------------------------------------------------

/** The rules hash of a firebase.json's hosting section: the same four fields HOME_RULES_SHA was made from. */
export function rulesShaOf(hosting: { cleanUrls?: unknown; trailingSlash?: unknown; redirects?: unknown; headers?: unknown }): string {
  return sha256(stableJson({ cleanUrls: hosting.cleanUrls, trailingSlash: hosting.trailingSlash, redirects: hosting.redirects, headers: hosting.headers }));
}

function walk(root: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith(".")) continue; // Firebase ignores dot files and folders (firebase.json `ignore`): dist/.vite/manifest.json is a build leftover and is never served
    const p = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new HomeRefused(`${p} is a link. A build holds plain files only.`);
    if (entry.isDirectory()) out.push(...walk(root, p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

/**
 * The pack of a built streetlist repository: every file of dist/ (no dot entries) with its sha256, the commit, and the hash of firebase.json's rules. The same dist and
 * commit always give the same bytes (sorted, no dates), so a second person can make the pack and compare its sha256. A dirty work tree is refused: the commit must be
 * what was built.
 */
export function makePack(streetlistDir: string, opts: { commit?: string } = {}): { bytes: Buffer; pack: Pack; sha256: string } {
  const root = resolve(streetlistDir);
  const dist = join(root, "dist");
  if (!existsSync(join(dist, "index.html"))) throw new HomeRefused(`${dist}/index.html is not there. Build the Streetlist site first (npm run build in that folder).`);
  let commit = opts.commit;
  if (!commit) {
    try {
      commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      if (execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim() !== "") throw new HomeRefused("The Streetlist folder has uncommitted changes, so the build does not match a commit. Commit them (or stash) and build again.");
    } catch (e) { if (e instanceof HomeRefused) throw e; throw new HomeRefused("The Streetlist folder is not a git repository, so the commit cannot be recorded. Pass --commit <id> if you are sure."); }
  }
  const hosting = (JSON.parse(readFileSync(join(root, "firebase.json"), "utf8")) as { hosting: Parameters<typeof rulesShaOf>[0] }).hosting;
  const files = walk(dist).map((path) => ({ path, data: readFileSync(join(dist, path)) }));
  const made = buildPack(files, commit, rulesShaOf(hosting), false);
  verifyPack(made.bytes); // a changed firebase.json is refused HERE, in the words that say what to update, not for the first time on the server
  return made;
}

/** The pack of these files (sorted by path, so the same files always give the same bytes). The one place a pack is written; tests use it for small fixtures. */
export function buildPack(files: readonly { path: string; data: Uint8Array }[], commit: string, rulesSha = HOME_RULES_SHA, check = true): { bytes: Buffer; pack: Pack; sha256: string } {
  const packed: PackFile[] = [...files].sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => ({ path: f.path, sha256: sha256(f.data), size: f.data.length, data: Buffer.from(f.data).toString("base64") }));
  const pack: Pack = { format: 1, commit, rulesSha, files: packed };
  const bytes = Buffer.from(JSON.stringify(pack));
  if (check) verifyPack(bytes); // never hand out a pack the server would refuse for a reason that is knowable here
  return { bytes, pack, sha256: sha256(bytes) };
}

// ---- checking a pack (on the server) ------------------------------------------------------------------------------------------------------------------

/** What a safe path in a build looks like: plain segments, no dot, no `..`, no empty one, never absolute. */
export function pathProblem(path: string): string | undefined {
  if (path.length === 0 || path.length > 200 || path.startsWith("/") || path.includes("\\")) return `"${path.slice(0, 60)}" is not a path inside the site`;
  const parts = path.split("/");
  if (!parts.every((p) => SEGMENT.test(p))) return `"${path.slice(0, 60)}" has a part that is empty, hidden or holds a character a site file does not use`;
  return undefined;
}

/** The top-level name a path answers for as a visitor sees it: shops.html -> shops, examples/x.html -> examples, assets/a.js -> assets. */
export const topNameOf = (path: string): string => path.split("/")[0]!.replace(/\.html$/u, "");

/**
 * Parse and check a pack. Refuses, in plain words, anything that is not exactly a Streetlist build this bundle knows how to serve: a wrong checksum, a changed rules
 * hash, a path outside the site, a top-level name the home does not own (which could shadow a shop's page), a file whose bytes do not match its sha256, or missing index/404.
 * `expectSha`: the pin. `rulesSha`: tests may pass another expectation; the server always uses HOME_RULES_SHA.
 */
export function verifyPack(bytes: Buffer, opts: { expectSha?: string; rulesSha?: string } = {}): Pack {
  if (bytes.length > MAX_PACK_BYTES) throw new HomeRefused(`The build is ${Math.round(bytes.length / 1048576)} MB, more than the ${MAX_PACK_BYTES / 1048576} MB a home may be.`);
  const got = sha256(bytes);
  if (opts.expectSha !== undefined && got !== opts.expectSha.toLowerCase()) throw new HomeRefused(`The build's checksum is ${got}, not the pinned ${opts.expectSha}. It was not installed. Fetch the right file again, or (for a new build) update bundle/home.json in a reviewed commit.`);
  let pack: Pack;
  try { pack = JSON.parse(bytes.toString("utf8")) as Pack; } catch { throw new HomeRefused("The build file is not readable (it is not a pack made by `geometer home pack`)."); }
  if (pack.format !== 1 || typeof pack.commit !== "string" || !/^[0-9a-f]{7,64}$/u.test(pack.commit) || !Array.isArray(pack.files)) throw new HomeRefused("The build file is not a pack this bundle knows (format 1, with a commit and files).");
  const want = opts.rulesSha ?? HOME_RULES_SHA;
  if (pack.rulesSha !== want) throw new HomeRefused(`This build's hosting rules (headers, redirects, cache) are not the ones this bundle's Caddy settings were written for (${String(pack.rulesSha).slice(0, 12)} against ${want.slice(0, 12)}). Update generate/compose.ts's homeHandlers and HOME_RULES_SHA in a reviewed commit first.`);
  if (pack.files.length === 0 || pack.files.length > MAX_FILES) throw new HomeRefused(`The build holds ${pack.files.length} files; a home has between 1 and ${MAX_FILES}.`);
  const seen = new Set<string>();
  const owned = new Set<string>([...HOME_TOP, "index", "404"]);
  for (const f of pack.files) {
    const bad = typeof f.path !== "string" ? "a file has no path" : pathProblem(f.path);
    if (bad) throw new HomeRefused(`${bad}. Nothing was installed.`);
    if (seen.has(f.path)) throw new HomeRefused(`${f.path} is in the build twice.`);
    seen.add(f.path);
    const parts = f.path.split("/");
    const top = topNameOf(f.path);
    const isHomeFile = parts.length === 1 && HOME_FILES.includes(f.path);
    const isRobots = f.path === "robots.txt";
    if (!isHomeFile && !isRobots && !owned.has(top)) throw new HomeRefused(`${f.path} would answer for the name "${top}", which the home does not own (it owns ${HOME_TOP.join(", ")}). A name here must first be reserved in fleet's slug list and added to HOME_TOP, or a shop could be shadowed by a file.`);
    // a folder name must be a real folder of the home: /examples/<page>.html, /assets/<file>, and nothing deeper than that under examples
    if (parts.length > 1 && top === "examples" && (parts.length !== 2 || !f.path.endsWith(".html") || !HOME_EXAMPLE_NAME.test(parts[1]!.slice(0, -5)))) throw new HomeRefused(`${f.path} is not an example page (examples/<name>.html).`);
    if (parts.length > 1 && !["examples", "assets"].includes(top)) throw new HomeRefused(`${f.path} is in a folder the home does not have.`);
    if (parts.length === 1 && HOME_TOP.includes(top) && !f.path.endsWith(".html")) throw new HomeRefused(`${f.path} would shadow the name "${top}".`);
    const data = Buffer.from(typeof f.data === "string" ? f.data : "", "base64");
    if (data.length !== f.size || sha256(data) !== f.sha256) throw new HomeRefused(`${f.path} does not match its checksum: the build file is damaged or was changed. Nothing was installed.`);
  }
  for (const needed of ["index.html", "404.html"]) if (!seen.has(needed)) throw new HomeRefused(`The build has no ${needed}.`);
  {
    const robots = pack.files.find((f) => f.path === "robots.txt");
    if (robots) {
      const lines = Buffer.from(robots.data, "base64").toString("utf8").split("\n").map((l) => l.trim()).filter((l) => /^disallow:/iu.test(l)).map((l) => l.replace(/^disallow:\s*/iu, ""));
      if (stableJson(lines) !== stableJson([...HOME_ROBOTS_DISALLOW])) throw new HomeRefused(`The build's robots.txt disallows ${lines.join(", ") || "nothing"}, but this bundle's merged robots.txt says ${HOME_ROBOTS_DISALLOW.join(", ")}. Update HOME_ROBOTS_DISALLOW in a reviewed commit first.`);
    }
  }
  return pack;
}

// ---- the folder on the server -------------------------------------------------------------------------------------------------------------------------

export const homePaths = (serverDir: string) => {
  const root = join(resolve(serverDir), "home");
  return { root, releases: join(root, "releases"), release: (id: string) => join(root, "releases", id), current: join(root, "current"), previous: join(root, "previous") };
};

/** The release a symlink points at (its folder name), or undefined when there is no link or it points nowhere. */
function targetOf(link: string): string | undefined {
  try { if (!lstatSync(link).isSymbolicLink()) return undefined; } catch { return undefined; }
  const id = readlinkSync(link).replace(/^releases\//u, "");
  return /^[0-9a-f]{16}$/u.test(id) && existsSync(join(dirname(link), "releases", id, "site", "index.html")) ? id : undefined;
}

/** Point `link` at releases/<id> by making a new symlink beside it and renaming that over it: one atomic step, so a reader never sees the link missing. */
function pointAt(link: string, id: string): void {
  const tmp = `${link}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  symlinkSync(`releases/${id}`, tmp); // relative: valid inside Caddy's container, where the folder is mounted somewhere else
  renameSync(tmp, link);
}

export interface HomeInfo { id: string; commit: string; sha256: string; installedAt: string }
const infoOf = (serverDir: string, id: string | undefined): HomeInfo | undefined => {
  if (!id) return undefined;
  try { return JSON.parse(readFileSync(join(homePaths(serverDir).release(id), "release.json"), "utf8")) as HomeInfo; } catch { return undefined; }
};

export function homeStatus(serverDir: string): { current?: HomeInfo; previous?: HomeInfo } {
  const p = homePaths(serverDir);
  const current = infoOf(serverDir, targetOf(p.current)); const previous = infoOf(serverDir, targetOf(p.previous));
  return { ...(current ? { current } : {}), ...(previous ? { previous } : {}) };
}

/**
 * Install a verified pack and make it the one served. Everything is checked BEFORE the first byte is written under the server folder: a refused build changes nothing.
 * The files are written into a hidden temporary folder under releases/, renamed into place as one folder, and only then does `current` move (the old one becomes
 * `previous`). Builds older than previous are removed. Installing the build that is already current changes nothing.
 */
export function installHome(serverDir: string, bytes: Buffer, o: { expectSha?: string; now?: () => Date } = {}): { id: string; commit: string; changed: boolean } {
  const pack = verifyPack(bytes, o.expectSha ? { expectSha: o.expectSha } : {});
  const p = homePaths(serverDir);
  const sha = sha256(bytes);
  const id = sha.slice(0, 16);
  mkdirSync(p.releases, { recursive: true, mode: 0o755 });
  chmodSync(p.root, 0o755); chmodSync(p.releases, 0o755);
  const before = targetOf(p.current);
  if (before === id) return { id, commit: pack.commit, changed: false };
  if (!existsSync(join(p.release(id), "site", "index.html"))) {
    const tmp = join(p.releases, `.${id}.${process.pid}.tmp`);
    rmSync(tmp, { recursive: true, force: true });
    for (const f of pack.files) {
      const dest = join(tmp, "site", f.path);
      mkdirSync(dirname(dest), { recursive: true, mode: 0o755 });
      writeFileSync(dest, Buffer.from(f.data, "base64"), { mode: 0o644 });
    }
    // chmod after the write: the umask must not make a file unreadable for Caddy's user
    for (const d of [join(tmp, "site"), ...new Set(pack.files.map((f) => dirname(join(tmp, "site", f.path))))]) chmodSync(d, 0o755);
    writeFileSync(join(tmp, "release.json"), stableJson({ id, commit: pack.commit, sha256: sha, installedAt: (o.now?.() ?? new Date()).toISOString() } satisfies HomeInfo), { mode: 0o644 });
    chmodSync(tmp, 0o755);
    rmSync(p.release(id), { recursive: true, force: true });
    renameSync(tmp, p.release(id));
  }
  if (before) pointAt(p.previous, before);
  pointAt(p.current, id);
  // keep only the two that can be switched to
  const keep = new Set([id, before].filter((x): x is string => x !== undefined));
  for (const name of readdirSync(p.releases)) if (!name.startsWith(".") && !keep.has(name) && statSync(p.release(name)).isDirectory()) rmSync(p.release(name), { recursive: true, force: true });
  return { id, commit: pack.commit, changed: true };
}

/** Switch back to the build before this one (and a second rollback switches forward again). Refuses when there is none. */
export function rollbackHome(serverDir: string): { id: string; commit: string } {
  const p = homePaths(serverDir);
  const back = targetOf(p.previous);
  const now = targetOf(p.current);
  if (!back) throw new HomeRefused("There is no earlier Streetlist build on this server to go back to.");
  pointAt(p.current, back);
  if (now) pointAt(p.previous, now);
  return { id: back, commit: infoOf(serverDir, back)?.commit ?? "" };
}

/** The pack's bytes from a file or an https address, size-capped. An http address, or any other scheme, is refused. */
export async function readSource(source: string, fetcher: (url: string, init: { redirect: "follow" }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }> = (u, i) => fetch(u, i)): Promise<Buffer> {
  if (/^https:\/\//iu.test(source)) {
    const r = await fetcher(source, { redirect: "follow" });
    if (!r.ok) throw new HomeRefused(`${source} answered ${r.status}.`);
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > MAX_PACK_BYTES) throw new HomeRefused(`${source} is more than ${MAX_PACK_BYTES / 1048576} MB.`);
    return b;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(source)) throw new HomeRefused("Only an https address or a file on this server is accepted for a Streetlist build.");
  const path = resolve(source);
  if (!existsSync(path) || statSync(path).size > MAX_PACK_BYTES) throw new HomeRefused(`${path} is not there, or is bigger than ${MAX_PACK_BYTES / 1048576} MB.`);
  return readFileSync(path);
}
