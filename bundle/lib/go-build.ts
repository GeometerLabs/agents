// How the Go shop programs get onto a server (decision 61, wave 1b). The server builds them itself, from ITS OWN agents checkout, so the program always matches the code beside it,
// also for a commit that is not a release (the Operator server's `agents_ref`, `--use-this-checkout`). Two steps, both through the Runner so a test never touches Docker:
//
//   1. compile: the official Go image, pinned BY DIGEST in bundle/release.json (`go_image_digest`), runs `go build` on the checkout's go/ folder, mounted READ-ONLY. CGO off, the
//      toolchain the image has (GOTOOLCHAIN=local: never a download of another one), -trimpath, -mod=readonly, -buildvcs=false (the mount has no .git), -ldflags "-s -w". Modules come
//      from the Go proxy and Go checks each against go.sum; a named volume (geo-go-cache) keeps the module and build cache so an update does not download them again.
//   2. image: a tiny image of our own, FROM scratch, holding only the programs, tagged by the checkout's commit (geo-go:<commit>). A generated Dockerfile; scratch needs no download.
//      It has no shell and no tools, so a program's health check is the program itself (`/listings health <url>`), and the image carries the empty /home/node folder, owned by the
//      user the shop containers run as (1000:1000), so a NEW data volume mounted there is that user's, as it is with the node image.
//
// Idempotent: an image for this checkout already there means nothing to do. A failure changes nothing (no image is tagged) and says why in plain words: `update` holds the shop back on
// the version it runs, `install.sh` stops. Adding a program (cmd/directory, cmd/bookings...) is ONE line in GO_PROGRAMS.
//
// The same file is the one place that knows which template folders run on Go: template.json says `"runtime": "go"` and names the program (`goRuntimeOf`). A folder without the field
// (every version before the Go one, kept beside the server) runs on Node exactly as it always did.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { Runner } from "./runner.ts";

/** The programs in the image: cmd/<name> of the agents repository's go/ folder. One line per program; each is built and copied to /<name>. */
export const GO_PROGRAMS = ["listings", "listings-shared"] as const;
/** The image's name; the tag is the checkout's commit (`goSourceTag`). */
export const GO_IMAGE_REPO = "geo-go";
/** The named volume that keeps Go's module and build cache between builds. Mounted at /go in the builder: the image's own /go is open to every user, so the empty volume starts open too. */
export const GO_CACHE_VOLUME = "geo-go-cache";
/** The user the shop containers run as (the node image's `node` user, bundle/generate/compose.ts nodeUser), so a data volume made by the node image keeps its owner. */
export const GO_RUN_USER = "1000:1000";

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
  "# Generated by bundle/lib/go-build.ts: the Go shop programs and nothing else (no shell, no tools, no certificates).",
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
    // one loop, so a program added to GO_PROGRAMS is built by the same command; `set -e` stops at the first failure
    const script = 'set -e; for p in "$@"; do go build -trimpath -mod=readonly -buildvcs=false -ldflags "-s -w" -o "/out/$p" "./cmd/$p"; done';
    const compiled = await ctx.runner.run(ctx.docker, [
      "run", "--rm", "--user", user,
      "-e", "CGO_ENABLED=0", "-e", "GOTOOLCHAIN=local", "-e", "GOPATH=/go", "-e", "GOCACHE=/go/build-cache", "-e", "HOME=/tmp",
      "-v", `${join(ctx.appDir, "go")}:/src:ro`, "-v", `${root}:/out`, "-v", `${GO_CACHE_VOLUME}:/go`, "-w", "/src",
      builder.ref, "sh", "-c", script, "sh", ...GO_PROGRAMS,
    ], { timeoutMs: 20 * 60_000 });
    if (compiled.code !== 0) return { ok: false, reason: `The Go shop programs could not be built (${lastLines(compiled)}). Nothing was changed.` };
    const missing = GO_PROGRAMS.filter((p) => !existsSync(join(root, p)));
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
