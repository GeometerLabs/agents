// How the Go shop programs get onto a server (decision 61, wave 1b). The server builds them itself, from ITS OWN agents checkout, so the program always matches the code beside it,
// also for a commit that is not a release (the Operator server's `agents_ref`, `--use-this-checkout`). Two steps, both through the Runner so a test never touches Docker:
//
//   1. compile: the official Go image, pinned BY DIGEST in bundle/release.json (`go_image_digest`), runs `go build` on the checkout's go/ folder, mounted READ-ONLY. CGO off, the
//      toolchain the image has (GOTOOLCHAIN=local: never a download of another one), -trimpath, -mod=readonly, -buildvcs=false (the mount has no .git), -ldflags "-s -w". Modules come
//      from the Go proxy and Go checks each against go.sum; a named volume (geo-go-cache) keeps the module and build cache so an update does not download them again.
//   2. image: a tiny image of our own, FROM scratch, holding only the programs, tagged by the checkout's commit (geo-go:<commit>). A generated Dockerfile; scratch needs no download.
//      It has no shell and no tools, so a program's health check is the program itself (`/listings health <url>`), and the image carries the empty /home/node folder, owned by the
//      user the shop containers run as (1000:1000), so a NEW data volume mounted there is that user's, as it is with the node image. It also carries the certificate authorities of
//      the pinned builder image (/etc/ssl/certs/ca-certificates.crt, where Go looks first on Linux): the directory (wave 1c) reads the feeds of builders' servers over https, and a
//      scratch image has none (Node carries its own list; Go reads the system's). Copied from the image pinned by digest, so it changes only when the pin does.
//
// Idempotent: an image for this checkout already there means nothing to do. A failure changes nothing (no image is tagged) and says why in plain words: `update` holds the shop back on
// the version it runs, `install.sh` stops. Adding a program (cmd/bookings...) is ONE line in GO_PROGRAMS (cmd/directory was added so, wave 1c).
//
// The same file is the one place that knows which template folders run on Go: template.json says `"runtime": "go"` and names the program (`goRuntimeOf`). A folder without the field
// (every version before the Go one, kept beside the server) runs on Node exactly as it always did.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { Runner } from "./runner.ts";

/** The programs in the image: cmd/<name> of the agents repository's go/ folder. One line per program; each is built and copied to /<name>. */
export const GO_PROGRAMS = ["listings", "listings-shared", "directory", "bookings", "orders", "fees", "stock-orders", "parts"] as const; // parts: decision 65, a shop of several template parts
/** The image's name; the tag is the checkout's commit (`goSourceTag`). */
export const GO_IMAGE_REPO = "geo-go";
/** The named volume that keeps Go's module and build cache between builds. Mounted at /go in the builder: the image's own /go is open to every user, so the empty volume starts open too. */
export const GO_CACHE_VOLUME = "geo-go-cache";
/**
 * The compile's memory wall, in MB, and its settings to stay under it. A full server (25 shops on a 4 GB e2-medium) cannot give the compiler the whole machine: `-p 1` builds one package at a
 * time, GOMAXPROCS=1 runs one thread, GOGC=50 collects sooner. The wall is a Docker memory limit (swap off), so an overrun stops the BUILD (exit 137), never the shops; the message says so.
 */
export const GO_BUILD_MEMORY_MB = 1536;
/** The user the shop containers run as (the node image's `node` user, bundle/generate/compose.ts nodeUser), so a data volume made by the node image keeps its owner. */
export const GO_RUN_USER = "1000:1000";
/** Where the certificate authorities are in the builder image (Alpine's and Debian's place) and in ours: the first file Go's crypto/x509 reads on Linux. */
export const GO_CA_FILE = "etc/ssl/certs/ca-certificates.crt";

/** What a Go template folder runs: its program for one shop, and its program for the shared process of many shops (listings-only shops only). */
export interface GoRuntime { program: string; sharedProgram?: string }

/** The Go runtime a template folder declares in template.json, or undefined: it runs on Node (every version made before Go, and every template with no Go program yet). */
export function goRuntimeOf(templateFolder: string): GoRuntime | undefined {
  try {
    const m = JSON.parse(readFileSync(join(templateFolder, "template.json"), "utf8")) as { runtime?: unknown; program?: unknown; sharedProgram?: unknown };
    if (m.runtime !== "go" || typeof m.program !== "string") return undefined;
    const known = (name: string): boolean => (GO_PROGRAMS as readonly string[]).includes(name);
    if (!known(m.program) || (typeof m.sharedProgram === "string" && !known(m.sharedProgram))) return undefined;
    return { program: m.program, ...(typeof m.sharedProgram === "string" ? { sharedProgram: m.sharedProgram } : {}) };
  } catch { return undefined; }
}

const git = (appDir: string, ...args: string[]): string | undefined => {
  try { return execFileSync("git", ["-C", appDir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return undefined; }
};

/** A hash of every file under go/ (names and bytes), for a checkout whose go/ differs from its commit or that has no git: the commit alone would then name two different programs. */
function treeHash(folder: string): string {
  const h = createHash("sha256");
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === "bin" || e.name === ".git" || e.name === "node_modules") continue;
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path); else if (e.isFile()) h.update(relative(folder, path)).update("\0").update(readFileSync(path)).update("\0");
    }
  };
  if (existsSync(folder)) walk(folder);
  return h.digest("hex");
}

/**
 * What names the programs of this checkout: its commit (12 characters) when go/ is exactly what the commit holds; `<commit>-<8 of a hash of go/>` when go/ was changed by hand
 * (a trial with `--use-this-checkout`); `nogit-<hash>` with no git. Synchronous, because the compose file is written synchronously and needs the image's name.
 */
export function goSourceTag(appDir: string): string {
  const commit = git(appDir, "rev-parse", "HEAD")?.slice(0, 12);
  if (commit && git(appDir, "status", "--porcelain", "--", "go") === "") return commit;
  return `${commit ?? "nogit"}-${treeHash(join(appDir, "go")).slice(0, 8)}`;
}

/** The image this checkout's programs are in. */
export const goImageFor = (appDir: string): string => `${GO_IMAGE_REPO}:${goSourceTag(appDir)}`;

/** The pinned builder: `golang@sha256:...` (the multi-arch index digest, so each CPU gets its own), with the readable tag kept beside it for messages. */
export function goBuilderOf(appDir: string): { ref: string; name: string } | { problem: string } {
  try {
    const r = JSON.parse(readFileSync(join(appDir, "bundle", "release.json"), "utf8")) as Record<string, unknown>;
    const name = typeof r.go_image === "string" ? r.go_image : "";
    const digest = typeof r.go_image_digest === "string" ? r.go_image_digest : "";
    if (name === "" || !/^sha256:[0-9a-f]{64}$/u.test(digest)) return { problem: "This copy's bundle/release.json does not pin the Go builder image (go_image and go_image_digest), so the shop programs cannot be built here." };
    return { ref: `${name.split(":")[0]}@${digest}`, name };
  } catch (e) { return { problem: `bundle/release.json could not be read (${(e as Error).message}), so the shop programs cannot be built here.` }; }
}

/** What building needs from the deployer's context (a narrower type, so `geometer go-build` and the tests need no server folder). */
export interface GoBuildContext { appDir: string; runner: Runner; docker: string; log: (line: string) => void }
export type GoBuild = { ok: true; image: string; built: boolean } | { ok: false; reason: string };

const lastLines = (r: { stdout: string; stderr: string }, n = 8): string => `${r.stderr}\n${r.stdout}`.trim().split("\n").filter(Boolean).slice(-n).join(" | ");

/** The Dockerfile of the programs' image: nothing but the programs, and the empty home folder of the user the shops run as. */
export const dockerfileOf = (tag: string, builder: string): string => [
  "# Generated by bundle/lib/go-build.ts: the Go programs, an empty home folder and the builder image's certificate authorities; nothing else (no shell, no tools).",
  "FROM scratch",
  `LABEL org.opencontainers.image.title="geometer shop programs" org.opencontainers.image.revision="${tag}" dev.geometer.builder="${builder}"`,
  `COPY --chown=${GO_RUN_USER} root/ /`,
  "",
].join("\n");

/**
 * Make sure the image for this checkout exists: build it if it does not. Never throws: a failure is `{ ok: false, reason }` in plain words and leaves no image behind.
 * (An existing image is trusted by its tag; the tag is the commit, so it is the program of this checkout.)
 */
export async function ensureGoRuntimes(ctx: GoBuildContext): Promise<GoBuild> {
  const image = goImageFor(ctx.appDir);
  const there = await ctx.runner.run(ctx.docker, ["image", "inspect", image]);
  if (there.code === 0) return { ok: true, image, built: false };
  const builder = goBuilderOf(ctx.appDir);
  if ("problem" in builder) return { ok: false, reason: `${builder.problem} Nothing was changed.` };
  if (!existsSync(join(ctx.appDir, "go", "go.mod"))) return { ok: false, reason: `There is no go/ folder in ${ctx.appDir}, so the shop programs cannot be built. Nothing was changed.` };

  ctx.log(`Building the shop programs (${GO_PROGRAMS.join(", ")}) with ${builder.name} (pinned by its digest). The first time this downloads Go's modules; later builds reuse them.`);
  const work = mkdtempSync(join(tmpdir(), "geometer-go-"));
  try {
    const root = join(work, "context", "root");
    mkdirSync(join(root, "home", "node"), { recursive: true });
    const user = typeof process.getuid === "function" ? `${process.getuid()}:${process.getgid?.() ?? 0}` : GO_RUN_USER;
    // one loop, so a program added to GO_PROGRAMS is built by the same command; `set -e` stops at the first failure; then the builder image's certificate authorities, for https calls
    const script = `set -e; for p in "$@"; do go build -p 1 -trimpath -mod=readonly -buildvcs=false -ldflags "-s -w" -o "/out/$p" "./cmd/$p"; done; mkdir -p /out/${GO_CA_FILE.split("/").slice(0, -1).join("/")}; cp /${GO_CA_FILE} /out/${GO_CA_FILE}`;
    const compiled = await ctx.runner.run(ctx.docker, [
      "run", "--rm", "--user", user,
      "--memory", `${GO_BUILD_MEMORY_MB}m`, "--memory-swap", `${GO_BUILD_MEMORY_MB}m`,
      "-e", "CGO_ENABLED=0", "-e", "GOTOOLCHAIN=local", "-e", "GOMAXPROCS=1", "-e", "GOGC=50", "-e", "GOPATH=/go", "-e", "GOCACHE=/go/build-cache", "-e", "HOME=/tmp",
      "-v", `${join(ctx.appDir, "go")}:/src:ro`, "-v", `${root}:/out`, "-v", `${GO_CACHE_VOLUME}:/go`, "-w", "/src",
      builder.ref, "sh", "-c", script, "sh", ...GO_PROGRAMS,
    ], { timeoutMs: 20 * 60_000 });
    // 137 is a process killed by the memory wall (the kernel's out-of-memory kill, or Docker's)
    if (compiled.code === 137) return { ok: false, reason: `The Go shop programs could not be built: the build was stopped at its memory limit of ${GO_BUILD_MEMORY_MB} MB so the shops keep running. Free some memory (stop what is not needed, or use a larger server) and run it again. Nothing was changed.` };
    if (compiled.code !== 0) return { ok: false, reason: `The Go shop programs could not be built (${lastLines(compiled)}). Nothing was changed.` };
    const missing = [...GO_PROGRAMS, GO_CA_FILE].filter((p) => !existsSync(join(root, p)));
    if (missing.length > 0) return { ok: false, reason: `The build finished but did not make ${missing.join(", ")}. Nothing was changed.` };

    const tag = image.slice(GO_IMAGE_REPO.length + 1);
    writeFileSync(join(work, "context", "Dockerfile"), dockerfileOf(tag, builder.ref));
    const made = await ctx.runner.run(ctx.docker, ["build", "-t", image, join(work, "context")], { timeoutMs: 10 * 60_000 });
    if (made.code !== 0) return { ok: false, reason: `The shop programs were built but their image could not be made (${lastLines(made)}). Nothing was changed.` };
    ctx.log(`The shop programs are ready: ${image}.`);
    return { ok: true, image, built: true };
  } catch (e) {
    return { ok: false, reason: `The Go shop programs could not be built (${(e as Error).message}). Nothing was changed.` };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---- the programs for the panel's hand check -----------------------------------------------------------------------------------------------------------------

/** The programs the panel's go-live hand check runs (each template's own, and a parts shop's: bundle/lib/hand-check-go.ts). The directory and the listings programs have no hand check. */
export const HAND_CHECK_PROGRAMS = ["bookings", "orders", "fees", "stock-orders", "parts"] as const satisfies readonly (typeof GO_PROGRAMS)[number][];
/** The file in the programs' folder that names the image they were copied from. */
const PROGRAMS_FROM = "image.txt";

/**
 * Copy the hand check's programs out of the image the shops run into `dir` (serverPaths().programs), so the panel, which has no Docker, runs the go-live hand check on the very
 * programs the shops run. A folder that already holds this image's programs is left as it is. Each program is copied beside its old file and renamed over it, INSIDE the folder:
 * the panel has the folder bind-mounted, and a folder replaced from outside would leave a running panel on the old, deleted one. The file naming the image is written last.
 * Never throws: a failure says why, and the panel's hand check then says the programs are not there or not the ones the shops run (it never runs anything else).
 */
export async function copyGoPrograms(ctx: GoBuildContext, image: string, dir: string): Promise<{ ok: true; copied: boolean } | { ok: false; reason: string }> {
  try {
    if (readFileSync(join(dir, PROGRAMS_FROM), "utf8").trim() === image && HAND_CHECK_PROGRAMS.every((p) => existsSync(join(dir, p)))) return { ok: true, copied: false };
  } catch { /* no copy yet */ }
  const name = `geo-go-copy-${createHash("sha256").update(`${image}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 12)}`;
  const made = await ctx.runner.run(ctx.docker, ["create", "--name", name, image, `/${HAND_CHECK_PROGRAMS[0]}`]);
  if (made.code !== 0) return { ok: false, reason: `The shop programs could not be copied for the panel's hand check (${lastLines(made)}).` };
  try {
    mkdirSync(dir, { recursive: true });
    rmSync(join(dir, PROGRAMS_FROM), { force: true }); // until every program is in, the folder names no image
    for (const p of HAND_CHECK_PROGRAMS) {
      const next = join(dir, `.${p}.next`);
      rmSync(next, { force: true });
      const r = await ctx.runner.run(ctx.docker, ["cp", `${name}:/${p}`, next]);
      if (r.code !== 0) return { ok: false, reason: `The shop program ${p} could not be copied for the panel's hand check (${lastLines(r)}).` };
      renameSync(next, join(dir, p));
    }
    writeFileSync(join(dir, PROGRAMS_FROM), `${image}\n`);
    ctx.log(`The panel's hand check runs on the shop programs of ${image}.`);
    return { ok: true, copied: true };
  } catch (e) {
    return { ok: false, reason: `The shop programs could not be copied for the panel's hand check (${(e as Error).message}).` };
  } finally {
    await ctx.runner.run(ctx.docker, ["rm", "-f", name]);
  }
}

// ---- old images ------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Remove the `geo-go:<tag>` images nothing needs any more. Kept: this checkout's, the image of every container (running or stopped) and every image the deployed compose file names (a shop
 * on a kept version, a rollback's way back). `dryRun` only lists. Never throws; a removal Docker refuses is said and left.
 */
export async function pruneGoImages(ctx: GoBuildContext, o: { dryRun?: boolean; composeText?: string } = {}): Promise<{ removed: string[]; kept: string[] }> {
  const all = (await ctx.runner.run(ctx.docker, ["image", "ls", GO_IMAGE_REPO, "--format", "{{.Repository}}:{{.Tag}}"])).stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith(`${GO_IMAGE_REPO}:`) && !l.endsWith(":<none>"));
  const used = new Set<string>([goImageFor(ctx.appDir)]);
  for (const l of (await ctx.runner.run(ctx.docker, ["ps", "-a", "--format", "{{.Image}}"])).stdout.split("\n")) if (l.trim().startsWith(`${GO_IMAGE_REPO}:`)) used.add(l.trim());
  for (const m of (o.composeText ?? "").matchAll(/geo-go:[A-Za-z0-9._-]+/gu)) used.add(m[0]);
  const kept = all.filter((i) => used.has(i));
  const removed: string[] = [];
  for (const image of all.filter((i) => !used.has(i))) {
    if (o.dryRun) { removed.push(image); continue; }
    if ((await ctx.runner.run(ctx.docker, ["image", "rm", image])).code === 0) removed.push(image); else kept.push(image);
  }
  if (removed.length > 0) ctx.log(`${o.dryRun ? "Would remove" : "Removed"} old shop-program images: ${removed.join(", ")}.`);
  return { removed, kept };
}
