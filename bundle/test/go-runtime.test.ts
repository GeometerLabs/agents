// How a server gets the Go shop programs and runs listings shops on them (wave 1b, decision 61): the compose entries of a Go shop and of the shared process on Go, a Node shop of an older
// version left exactly as it was, the build (the pinned Go image, read-only source, the scratch image, idempotent, a failure that changes nothing), and `geometer update` holding a shop
// back on the version it runs when the build fails. Docker is a stand-in: nothing here touches a machine (the one real build is run by hand, see bundle/Explanation.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeServer } from "../generate/compose.ts";
import type { ShopDeploy } from "../generate/compose.ts";
import { names } from "../generate/shop.ts";
import { deploy } from "../deploy.ts";
import { main } from "../geometer.ts";
import { GO_CACHE_VOLUME, GO_PROGRAMS, ensureGoRuntimes, goBuilderOf, goImageFor, goRuntimeOf } from "../lib/go-build.ts";
import { fakeRunner, failed, ok } from "../lib/runner.ts";
import type { RunOptions } from "../lib/runner.ts";
import { loadState } from "../lib/state.ts";
import { panelRuntime, serverConfig } from "./helpers.ts";
import { world } from "./world.ts";

const REPO = new URL("../../", import.meta.url).pathname.replace(/\/$/u, "");
const D = { app: "/repo", generated: "/srv/generated", secrets: "/srv/secrets", status: "/srv/status", fleet: "/srv/fleet", shops: "/srv/shops", secretsInbox: "/srv/secrets-inbox", requests: "/srv/requests", exports: "/srv/exports", panelData: "/srv/panel", config: "/srv/geometer.json", licence: "/srv/state/licence" };
const IMAGE = "geo-go:abc123def456";
const guards = (name: string) => (["razorpay", "whatsapp", "calendar"] as const).map((kind) => ({ kind, service: names.guard(name, kind), tenant: name }));
const node = (name: string, index: number): ShopDeploy => ({ name, index, pathwayDir: "/repo/templates/commerce/bookings", guards: guards(name) });
const goShop = (name: string, index: number): ShopDeploy => ({ ...node(name, index), runtime: { program: "listings" } });
const shared = (name: string, go = false): ShopDeploy => ({ name, index: 0, shared: true, pathwayDir: "/repo/templates/commerce/listings", guards: [], ...(go ? { runtime: { program: "listings", sharedProgram: "listings-shared" } } : {}) });
const build = (shops: ShopDeploy[], goImage?: string) => composeServer(serverConfig({ panel: { enabled: true } }), D, shops, { panel: { user: "501:20", shareAddress: "calendar@x.iam.gserviceaccount.com" }, ...(goImage ? { goImage } : {}) });
const block = (c: ReturnType<typeof build>, svc: string) => c.services[svc].block as Record<string, any>;

// ---- compose ------------------------------------------------------------------------------------------------------------------------------------

test("a shop on a Go version runs the programs' image as the same user, with the same environment, secrets, data, network and Guards; /pathway and /modules are not mounted; its health check is the program", () => {
  const c = build([goShop("glow-salon", 1)], IMAGE);
  const was = build([node("glow-salon", 1)]); // the same shop, before it moved to Go
  const [go, old] = [block(c, "rt-glow-salon"), block(was, "rt-glow-salon")];
  assert.equal(go.image, IMAGE);
  assert.deepEqual(go.command, ["/listings", "--client", "/client"]);
  assert.equal(go.user, "1000:1000");
  for (const key of ["init", "read_only", "cap_drop", "security_opt", "tmpfs", "restart"]) assert.deepEqual(go[key], old[key], `${key} is the hardening every runtime has`);
  assert.deepEqual(go.environment, old.environment);
  assert.deepEqual(go.networks, old.networks);
  assert.deepEqual(go.depends_on, old.depends_on);
  assert.deepEqual(go.volumes, (old.volumes as string[]).filter((v) => !v.endsWith(":/pathway:ro") && !v.endsWith(":/modules:ro")), "everything else is mounted as before");
  assert.ok(!JSON.stringify(go.volumes).includes("/pathway") && !JSON.stringify(go.volumes).includes("/modules"));
  assert.deepEqual(go.healthcheck.test, ["CMD", "/listings", "health", "http://127.0.0.1:8780/readyz"], "no wget in the image: the program asks its own /readyz");
  assert.deepEqual(c.services["rt-glow-salon"].files, was.services["rt-glow-salon"].files, "the files whose change restarts it are the same");
  // the shop's door, report folder job and Guards do not change: only the one container does
  assert.equal(block(c, "rd-glow-salon").image, "node:26-alpine", "the one-shot that makes the reports folder stays on the node image");
});

test("a Node shop of an older version is composed exactly as before, and a server with no Go shop never needs the image", () => {
  const c = build([node("glow-salon", 1)]);
  const b = block(c, "rt-glow-salon");
  assert.equal(b.image, "node:26-alpine");
  assert.deepEqual(b.command, ["node", "/pathway/server/main.ts", "--client", "/client"]);
  assert.ok((b.volumes as string[]).includes("/repo/templates/commerce/bookings:/pathway:ro"));
  assert.deepEqual(b.healthcheck.test, ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8780/readyz"]);
  assert.ok(!c.compose.includes("geo-go"));
  const s = build([shared("sree-pets")]);
  assert.equal(block(s, "rt-listings").command[0], "node", "listings shops pinned to a version with no runtime field run on the Node shared process");
  assert.equal(block(s, "rt-listings").mem_limit, "1536m");
  assert.throws(() => build([goShop("glow-salon", 1)]), /no image of the Go programs/u, "a Go shop with no image to run is a mistake, not a compose file");
});

test("the shared process on Go: its program, the same mounts without /app, no Node pool settings, a memory wall of its own, the program's health check; a new shop changes nothing", () => {
  const two = build([node("glow-salon", 1), shared("sree-pets", true), shared("glow-pets", true)], IMAGE);
  const three = build([node("glow-salon", 1), shared("sree-pets", true), shared("glow-pets", true), shared("new-shop", true)], IMAGE);
  const b = block(two, "rt-listings");
  assert.equal(b.image, IMAGE);
  assert.deepEqual(b.command, ["/listings-shared"]);
  assert.equal(b.user, "1000:1000");
  assert.deepEqual(b.environment, { SHOPS_DIR: "/shops", SECRETS_DIR: "/run/secrets", HOST: "0.0.0.0", PORT: "8780", SCAN_SECONDS: "5" }, "no SHARED_WORKERS or SHARED_WORKER_MB: there is no worker pool");
  assert.deepEqual(b.volumes, ["/srv/generated/listings:/shops:ro", "/srv/secrets/rt-listings:/run/secrets:ro", "rt-data-listings:/home/node"], "the Node process's mounts, without /app");
  assert.equal(b.mem_limit, "1024m");
  assert.deepEqual(b.healthcheck.test, ["CMD", "/listings-shared", "health", "http://127.0.0.1:8780/readyz"]);
  assert.equal(JSON.stringify(three.services["rt-listings"]), JSON.stringify(two.services["rt-listings"]), "adding a shop leaves the shared container's entry byte for byte as it was");
  assert.deepEqual(two.services["rt-listings"].files, []);
});

// ---- the template folder says which runtime it has ----------------------------------------------------------------------------------------------

test("the current listings template is on Go (version 0.2.0, matching the program's own constant); a folder with no runtime field, or an unknown program, runs on Node", () => {
  const folder = join(REPO, "templates", "commerce", "listings");
  assert.deepEqual(goRuntimeOf(folder), { program: "listings", sharedProgram: "listings-shared" });
  assert.equal((JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as { version: string }).version, "0.2.0");
  assert.match(readFileSync(join(REPO, "go", "internal", "runtime", "config.go"), "utf8"), /Version = "0\.2\.0"/u);
  assert.equal(goRuntimeOf(join(REPO, "templates", "commerce", "bookings")), undefined, "a template with no runtime field");
  assert.equal(goRuntimeOf(join(REPO, "templates", "commerce", "nowhere")), undefined);
  const dir = mkdtempSync(join(tmpdir(), "geo-gort-"));
  try {
    writeFileSync(join(dir, "template.json"), JSON.stringify({ schema: 1, runtime: "go", program: "not-built-here" }));
    assert.equal(goRuntimeOf(dir), undefined, "a program the image does not hold is not a Go runtime");
    writeFileSync(join(dir, "template.json"), JSON.stringify({ schema: 1, runtime: "node", program: "listings" }));
    assert.equal(goRuntimeOf(dir), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.ok(GO_PROGRAMS.includes("listings") && GO_PROGRAMS.includes("listings-shared"));
});

// ---- the build ----------------------------------------------------------------------------------------------------------------------------------

/** A stand-in Docker: `image inspect` says whether the image is there; `run` writes the programs into the folder mounted at /out (or fails); `build` records the Dockerfile and context. */
function stand(opts: { have?: boolean; compileFails?: boolean; buildFails?: boolean } = {}) {
  const seen: { dockerfile?: string; context?: string[]; mounts?: string[] } = {};
  let have = opts.have === true;
  const runner = fakeRunner((_command, args, _o: RunOptions) => {
    if (args[0] === "image") return have ? ok("sha256:x") : failed("No such image", 1);
    if (args[0] === "run") {
      if (opts.compileFails) return failed("go: downloading modernc.org/sqlite\nsqlite.go:1: syntax error", 1);
      const out = args[args.indexOf("-v", args.indexOf("-v") + 2) + 1].replace(/:\/out$/u, "");
      seen.mounts = args.filter((_a, i) => args[i - 1] === "-v");
      for (const p of GO_PROGRAMS) writeFileSync(join(out, p), `binary ${p}`, { mode: 0o755 });
      return ok();
    }
    if (args[0] === "build") {
      const context = args.at(-1)!;
      seen.dockerfile = readFileSync(join(context, "Dockerfile"), "utf8");
      seen.context = (function walk(dir: string, base = dir): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [`${join(dir, e.name).slice(base.length + 1)}/`, ...walk(join(dir, e.name), base)] : [join(dir, e.name).slice(base.length + 1)])); })(context);
      if (opts.buildFails) return failed("failed to solve", 1);
      have = true;
      return ok();
    }
    return ok();
  });
  return { runner, seen, ctx: { appDir: REPO, runner, docker: "docker", log: () => undefined } };
}

test("the build: the pinned Go image by digest, the source read-only, the settings the owner chose, a cache volume, then a scratch image of the programs alone tagged by the commit", async () => {
  const s = stand();
  const r = await ensureGoRuntimes(s.ctx);
  assert.ok(r.ok && r.built, JSON.stringify(r));
  assert.equal(r.image, goImageFor(REPO));
  assert.match(r.image, /^geo-go:[0-9a-f]{12}(-[0-9a-f]{8})?$|^geo-go:nogit-[0-9a-f]{8}$/u);
  const release = JSON.parse(readFileSync(join(REPO, "bundle", "release.json"), "utf8")) as Record<string, string>;
  assert.match(release.go_image_digest, /^sha256:[0-9a-f]{64}$/u);
  const run = s.runner.calls.find((c) => c.args[0] === "run")!.args;
  assert.ok(run.includes(`golang@${release.go_image_digest}`), "the image is run by its digest, never by the tag");
  assert.ok(run.includes(`${join(REPO, "go")}:/src:ro`), "the source is mounted read-only");
  assert.ok(run.includes(`${GO_CACHE_VOLUME}:/go`), "a named volume keeps the modules and the build cache");
  for (const e of ["CGO_ENABLED=0", "GOTOOLCHAIN=local"]) assert.ok(run.includes(e), e);
  const script = run[run.indexOf("-c") + 1];
  for (const flag of ["-trimpath", "-mod=readonly", '-ldflags "-s -w"']) assert.ok(script.includes(flag), flag);
  assert.deepEqual(run.slice(run.indexOf("-c") + 3), [...GO_PROGRAMS], "every program of GO_PROGRAMS is built by the same command");
  assert.deepEqual(s.seen.context!.sort(), ["Dockerfile", "root/", "root/home/", "root/home/node/", ...GO_PROGRAMS.map((p) => `root/${p}`)].sort(), "the programs and the empty home folder, nothing else");
  assert.match(s.seen.dockerfile!, /^FROM scratch$/mu);
  assert.match(s.seen.dockerfile!, /^COPY --chown=1000:1000 root\/ \/$/mu, "the programs and /home/node belong to the user the shops run as, so a new data volume does too");
  assert.deepEqual(s.runner.calls.filter((c) => c.args[0] === "build").map((c) => c.args.slice(0, 3)), [["build", "-t", r.image]]);
});

test("an image for this checkout already there means nothing is built, and a second run does nothing", async () => {
  const s = stand({ have: true });
  assert.deepEqual(await ensureGoRuntimes(s.ctx), { ok: true, image: goImageFor(REPO), built: false });
  assert.deepEqual(s.runner.calls.map((c) => c.args[0]), ["image"], "one question to Docker and nothing else");
  const t = stand();
  assert.ok((await ensureGoRuntimes(t.ctx) as { built: boolean }).built);
  const again = await ensureGoRuntimes(t.ctx);
  assert.ok(again.ok && !again.built, "the image the first run made is found by the second");
});

test("a build that fails changes nothing and says why in plain words; a release with no pinned builder is refused before Docker is asked to build", async () => {
  const bad = stand({ compileFails: true });
  const r = await ensureGoRuntimes(bad.ctx);
  assert.ok(!r.ok);
  assert.match(r.reason, /could not be built \(.*syntax error.*\)\. Nothing was changed\./u);
  assert.ok(!bad.runner.calls.some((c) => c.args[0] === "build"), "no image is made from a failed compile");
  const noImage = stand({ buildFails: true });
  const r2 = await ensureGoRuntimes(noImage.ctx);
  assert.ok(!r2.ok && /image could not be made/u.test(r2.reason));
  // a copy of the checkout whose release.json pins no digest
  const dir = mkdtempSync(join(tmpdir(), "geo-gorel-"));
  try {
    mkdirSync(join(dir, "bundle")); mkdirSync(join(dir, "go"));
    writeFileSync(join(dir, "go", "go.mod"), "module x\n");
    writeFileSync(join(dir, "bundle", "release.json"), JSON.stringify({ go_image: "golang:1.27.1-alpine", go_image_digest: "" }));
    assert.ok("problem" in goBuilderOf(dir));
    const s = stand();
    const refused = await ensureGoRuntimes({ ...s.ctx, appDir: dir });
    assert.ok(!refused.ok && /does not pin the Go builder image/u.test(refused.reason));
    assert.ok(!s.runner.calls.some((c) => c.args[0] === "run" || c.args[0] === "build"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- update -------------------------------------------------------------------------------------------------------------------------------------

const SHOP = "glow-salon";
/** A server with one shop at bookings 0.1.0, and a kept checkout of 0.2.0 whose template.json says it runs on a Go program (the stand-in for the day a template has one). */
async function oneShopWithGoVersion() {
  const w = world({ [SHOP]: panelRuntime() });
  w.handIn(SHOP);
  await deploy(w.ctx);
  const dir = join(w.root, "templates", "commerce", "bookings@0.2.0");
  cpSync(join(w.ctx.appDir, "templates", "commerce", "bookings"), dir, { recursive: true });
  cpSync(join(w.ctx.appDir, "modules"), join(w.root, "modules"), { recursive: true });
  writeFileSync(join(dir, "package.json"), readFileSync(join(dir, "package.json"), "utf8").replaceAll('"version": "0.1.0"', '"version": "0.2.0"'));
  writeFileSync(join(dir, "template.json"), JSON.stringify({ ...JSON.parse(readFileSync(join(dir, "template.json"), "utf8")), runtime: "go", program: "listings" }));
  // every question the update asks of the hand check and the saved-data layout is answered "all held, layout 1"
  const next = w.ctx.runner.run.bind(w.ctx.runner);
  const handCheck = "CRASH TEST   Glow · Bookings\n\n  Held 1 of 1.  0 failed.\n\n  ✓      A normal booking\n\n  Held 1 of 1 within what was tried.";
  w.ctx.runner.run = async (command, args, options) => {
    if (command === process.execPath && args[0]?.endsWith("hand-check.ts")) return { code: 0, stdout: handCheck, stderr: "" };
    if (command === process.execPath && args.includes("-e")) return { code: 0, stdout: "1\n", stderr: "" };
    return next(command, args, options);
  };
  return w;
}
const pinOf = (root: string): string => readFileSync(join(root, "shops", SHOP, "pathway.lock"), "utf8").trim();
const quietMain = async (argv: string[], ctx: Parameters<typeof main>[1]) => {
  const [log, error] = [console.log, console.error];
  const out: string[] = [];
  console.log = (...a: unknown[]) => out.push(a.join(" ")); console.error = (...a: unknown[]) => out.push(a.join(" "));
  try { return { code: await main(argv, ctx), out: out.join("\n") }; } finally { console.log = log; console.error = error; }
};

test("update to a Go version builds the programs first; a build that fails holds the shop back on the version it runs, says why, and leaves its pin and its runtime alone", async () => {
  const w = await oneShopWithGoVersion();
  try {
    const before = pinOf(w.root);
    const next = w.ctx.runner.run.bind(w.ctx.runner);
    let compile = 0;
    w.ctx.runner.run = async (command, args, options) => {
      if (args[0] === "image" && args[1] === "inspect" && String(args[2]).startsWith("geo-go:")) return failed("No such image", 1);
      if (args[0] === "run" && args.some((a) => String(a).startsWith("golang@"))) { compile++; return failed("go: modernc.org/sqlite@v1.0.0: Get https://proxy.golang.org/...: dial tcp: no route to host", 1); }
      return next(command, args, options);
    };
    const composeBefore = existsSync(join(w.root, "generated", "compose.yaml")) ? readFileSync(join(w.root, "generated", "compose.yaml"), "utf8") : "";
    w.calls.length = 0;
    const r = await quietMain(["update", "--to", "0.2.0", "--server", w.root], w.ctx);
    assert.equal(r.code, 1, r.out);
    assert.equal(compile, 1);
    assert.match(r.out, /HELD BACK\. bookings@0\.2\.0 runs on a Go program, and it could not be built here: The Go shop programs could not be built \(.*no route to host.*\)\. Nothing was changed\. It stays on bookings@0\.1\.0\./u);
    assert.equal(pinOf(w.root), before, "the pin is where it was");
    assert.equal(loadState(w.root).shops[SHOP].applied?.pathway, "bookings@0.1.0");
    assert.ok(!w.calls.some((c) => c.args[0] === "compose" && c.args.includes("up")), "nothing was started or recreated");
    assert.equal(existsSync(join(w.root, "generated", "compose.yaml")) ? readFileSync(join(w.root, "generated", "compose.yaml"), "utf8") : "", composeBefore, "the compose file is as it was");
  } finally { w.done(); }
});

test("update to a Go version whose programs are already built moves the shop onto them: its runtime is the programs' image, and no build is run", async () => {
  const w = await oneShopWithGoVersion();
  try {
    w.calls.length = 0;
    const r = await quietMain(["update", "--to", "0.2.0", "--server", w.root], w.ctx);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /moved from bookings@0\.1\.0 to bookings@0\.2\.0/u);
    assert.equal(pinOf(w.root), "bookings@0.2.0");
    assert.ok(!w.calls.some((c) => c.args[0] === "run" && c.args.some((a) => String(a).startsWith("golang@"))), "the image of this checkout was already there: nothing is compiled");
    const compose = readFileSync(join(w.root, "generated", "compose.yaml"), "utf8");
    const rt = /\n  rt-glow-salon:\n([\s\S]*?)\n  [a-z]/u.exec(compose)![1];
    assert.match(rt, new RegExp(`image: "${goImageFor(w.ctx.appDir).replace(".", "\\.")}"`, "u"));
    assert.match(rt, /command:\s+- \/listings\s+- --client\s+- \/client/u);
    assert.ok(!rt.includes("/pathway"), "no template code is mounted for a Go program");
  } finally { w.done(); }
});

test("a dry run of an update to a Go version builds nothing", async () => {
  const w = await oneShopWithGoVersion();
  try {
    w.calls.length = 0;
    const r = await quietMain(["update", "--to", "0.2.0", "--dry-run", "--server", w.root], w.ctx);
    assert.equal(r.code, 0, r.out);
    assert.ok(!w.calls.some((c) => c.args[0] === "run" || c.args[0] === "build"));
    assert.equal(pinOf(w.root), "bookings@0.1.0");
  } finally { w.done(); }
});

// ---- the deployer's questions to the shared container ----------------------------------------------------------------------------------------------

test("the deployer asks the Go shared process through its own program (the image has no wget or test), falls back to wget for the Node one, and asks the data volume, not the container, whether a name is taken", async () => {
  const { sharedHeld, sharedHasFolder } = await import("../lib/listings-move.ts");
  const answer = JSON.stringify({ shops: ["sree-pets"] });
  const go = fakeRunner(() => ok(answer));
  const ctxGo = { ...world().ctx, runner: go };
  assert.deepEqual(await sharedHeld(ctxGo), ["sree-pets"]);
  assert.ok(go.calls[0].args.join(" ").endsWith("exec -T rt-listings /listings-shared get http://127.0.0.1:8780/shared/shops"));
  assert.equal(go.calls.length, 1, "no second try when the program answered");
  const nodeOnly = fakeRunner((_c, args) => (args.includes("/listings-shared") ? failed("exec: not found", 126) : ok(answer)));
  assert.deepEqual(await sharedHeld({ ...ctxGo, runner: nodeOnly }), ["sree-pets"]);
  assert.ok(nodeOnly.calls[1].args.join(" ").endsWith("exec -T rt-listings wget -q -O - http://127.0.0.1:8780/shared/shops"));
  const server = serverConfig({});
  const volume = `geometer-${server.id.replace(/_/gu, "-")}_rt-data-listings`;
  const none = fakeRunner(() => failed("no such volume", 1));
  assert.equal(await sharedHasFolder({ ...ctxGo, runner: none }, server, "sree-pets"), false, "no volume yet holds nothing, and nothing is run");
  assert.equal(none.calls.length, 1);
  const there = fakeRunner((_c, args) => (args[0] === "volume" ? ok() : args.at(-1) === "/v/sree-pets" ? ok() : failed("", 1)));
  assert.equal(await sharedHasFolder({ ...ctxGo, runner: there }, server, "sree-pets"), true);
  assert.equal(await sharedHasFolder({ ...ctxGo, runner: there }, server, "new-shop"), false);
  const run = there.calls.find((c) => c.args[0] === "run")!.args;
  assert.ok(run.includes(`${volume}:/v:ro`) && run.includes("--network") && run.includes("none") && run.includes("--read-only"), run.join(" "));
});
