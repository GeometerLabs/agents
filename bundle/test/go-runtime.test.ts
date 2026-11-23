// How a server gets the Go shop programs and runs listings shops on them (wave 1b, decision 61): the compose entries of a Go shop and of the shared process on Go, a Node shop of an older
// version left exactly as it was, the build (the pinned Go image, read-only source, the scratch image, idempotent, a failure that changes nothing), and `geometer update` holding a shop
// back on the version it runs when the build fails. Docker is a stand-in: nothing here touches a machine (the one real build is run by hand, see bundle/Explanation.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ASSISTANT_NETWORK, DIRECTORY_DATA_DIR, DIRECTORY_VOLUME, addressing, caddyfile, composeServer, hasDirectory } from "../generate/compose.ts";
import type { ShopDeploy } from "../generate/compose.ts";
import { DIRECTORY_SECRET_FILE, directoryConfig } from "../generate/configs.ts";
import { guardUrl, names } from "../generate/shop.ts";
import { deploy } from "../deploy.ts";
import { main } from "../geometer.ts";
import { GO_BUILD_MEMORY_MB, GO_CACHE_VOLUME, GO_CA_FILE, GO_PROGRAMS, dockerfileOf, ensureGoRuntimes, goBuilderOf, goImageFor, goRuntimeOf, pruneGoImages } from "../lib/go-build.ts";
import { DIRECTORY_AGENT_ID, directoryAssistant, discoveryBudgetFor } from "../lib/budget.ts";
import { parseServer } from "../lib/server.ts";
import { PRICES_DIR, latestPriceList, loadPriceList } from "../panel/cost.ts";
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
  assert.throws(() => build([shared("sree-pets")], IMAGE), /names no shared program/u, "listings-only shops run on the Go shared process only: the Node one went with the TypeScript runtime");
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

test("the current listings, Bookings, Orders, Fees and Stock orders templates are on Go (version 0.2.0, matching each program's own constant); a folder with no runtime field, or an unknown program, runs on Node", () => {
  const folder = join(REPO, "templates", "commerce", "listings");
  assert.deepEqual(goRuntimeOf(folder), { program: "listings", sharedProgram: "listings-shared" });
  assert.equal((JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as { version: string }).version, "0.2.0");
  assert.match(readFileSync(join(REPO, "go", "internal", "runtime", "config.go"), "utf8"), /Version = "0\.2\.0"/u);
  // the switch of 24 Nov 2026: Bookings, Orders, Fees and Stock orders are on Go from 0.2.0, each version matching its program's own constant (go/internal/<package>/<package>.go)
  for (const [folder, program, pkg] of [["commerce/bookings", "bookings", "bookings"], ["commerce/orders", "orders", "orders"], ["education/fees", "fees", "fees"], ["commerce/stock-orders", "stock-orders", "stockorders"]]) {
    const dir = join(REPO, "templates", ...folder.split("/"));
    assert.deepEqual(goRuntimeOf(dir), { program }, folder);
    assert.equal((JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string }).version, "0.2.0", folder);
    assert.match(readFileSync(join(REPO, "go", "internal", pkg, `${pkg}.go`), "utf8"), /Version = "0\.2\.0"/u, folder);
    assert.ok((GO_PROGRAMS as readonly string[]).includes(program), `${program} is in the programs' image`);
  }
  assert.equal(goRuntimeOf(join(REPO, "templates", "commerce", "nowhere")), undefined);
  const dir = mkdtempSync(join(tmpdir(), "geo-gort-"));
  try {
    writeFileSync(join(dir, "template.json"), JSON.stringify({ schema: 1, runtime: "go", program: "not-built-here" }));
    assert.equal(goRuntimeOf(dir), undefined, "a program the image does not hold is not a Go runtime");
    writeFileSync(join(dir, "template.json"), JSON.stringify({ schema: 1, runtime: "node", program: "listings" }));
    assert.equal(goRuntimeOf(dir), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.ok(GO_PROGRAMS.includes("listings") && GO_PROGRAMS.includes("listings-shared") && GO_PROGRAMS.includes("directory"));
});

// ---- the build ----------------------------------------------------------------------------------------------------------------------------------

/** A stand-in Docker: `image inspect` says whether the image is there; `run` writes the programs into the folder mounted at /out (or fails); `build` records the Dockerfile and context. */
function stand(opts: { have?: boolean; compileFails?: boolean; buildFails?: boolean; noCertificates?: boolean } = {}) {
  const seen: { dockerfile?: string; context?: string[]; mounts?: string[] } = {};
  let have = opts.have === true;
  const runner = fakeRunner((_command, args, _o: RunOptions) => {
    if (args[0] === "image") return have ? ok("sha256:x") : failed("No such image", 1);
    if (args[0] === "run") {
      if (opts.compileFails) return failed("go: downloading modernc.org/sqlite\nsqlite.go:1: syntax error", 1);
      const out = args[args.indexOf("-v", args.indexOf("-v") + 2) + 1].replace(/:\/out$/u, "");
      seen.mounts = args.filter((_a, i) => args[i - 1] === "-v");
      for (const p of GO_PROGRAMS) writeFileSync(join(out, p), `binary ${p}`, { mode: 0o755 });
      if (!opts.noCertificates) { mkdirSync(join(out, dirname(GO_CA_FILE)), { recursive: true }); writeFileSync(join(out, GO_CA_FILE), "-----BEGIN CERTIFICATE-----\n"); }
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
  assert.ok(run.includes(`${GO_BUILD_MEMORY_MB}m`) && run.includes("--memory") && run.includes("--memory-swap"), "the compile runs under a memory wall, swap off");
  for (const e of ["GOMAXPROCS=1", "GOGC=50"]) assert.ok(run.includes(e), e);
  const script = run[run.indexOf("-c") + 1];
  assert.ok(script.includes("go build -p 1 "), "one package at a time");
  for (const flag of ["-trimpath", "-mod=readonly", '-ldflags "-s -w"']) assert.ok(script.includes(flag), flag);
  assert.deepEqual(run.slice(run.indexOf("-c") + 3), [...GO_PROGRAMS], "every program of GO_PROGRAMS is built by the same command");
  // the seven programs, named here and not only through the constant: a program dropped from GO_PROGRAMS would leave its shops with no runtime in the image
  assert.deepEqual([...GO_PROGRAMS].sort(), ["bookings", "directory", "fees", "listings", "listings-shared", "orders", "stock-orders"]);
  for (const p of ["bookings", "orders", "fees", "stock-orders", "listings", "listings-shared", "directory"]) assert.ok(script.includes('-o "/out/$p" "./cmd/$p"') && run.includes(p), `${p} is compiled from go/cmd/${p}`);
  assert.ok(script.endsWith(`cp /${GO_CA_FILE} /out/${GO_CA_FILE}`), "the builder image's certificate authorities are copied, for the directory's https calls");
  assert.deepEqual(s.seen.context!.sort(), ["Dockerfile", "root/", "root/home/", "root/home/node/", "root/etc/", "root/etc/ssl/", "root/etc/ssl/certs/", `root/${GO_CA_FILE}`, ...GO_PROGRAMS.map((p) => `root/${p}`)].sort(), "the programs, the empty home folder and the certificate authorities, nothing else");
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
/**
 * A server with one shop on bookings 0.1.0, a kept checkout that runs on Node (today's folder copied, its template.json without the runtime fields, as every version made before
 * the switch of 24 Nov 2026 has), and today's Bookings, 0.2.0, which runs on the Go program: the move every Node shop makes when it takes the Go version.
 */
async function oneShopWithGoVersion() {
  const w = world({ [SHOP]: panelRuntime() });
  w.handIn(SHOP);
  const dir = join(w.root, "templates", "commerce", "bookings@0.1.0");
  cpSync(join(w.ctx.appDir, "templates", "commerce", "bookings"), dir, { recursive: true });
  cpSync(join(w.ctx.appDir, "modules"), join(w.root, "modules"), { recursive: true });
  writeFileSync(join(dir, "package.json"), readFileSync(join(dir, "package.json"), "utf8").replaceAll('"version": "0.2.0"', '"version": "0.1.0"'));
  const { runtime: _runtime, program: _program, ...nodeTemplate } = JSON.parse(readFileSync(join(dir, "template.json"), "utf8")) as Record<string, unknown>;
  writeFileSync(join(dir, "template.json"), JSON.stringify(nodeTemplate));
  assert.equal(goRuntimeOf(dir), undefined, "the kept version runs on Node");
  writeFileSync(join(w.root, "shops", SHOP, "pathway.lock"), "bookings@0.1.0\n");
  await deploy(w.ctx);
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
    assert.match(rt, /command:\s+- "\/bookings"\s+- "--client"\s+- "\/client"/u);
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

test("a compile stopped by its memory wall says so and changes nothing", async () => {
  const runner = fakeRunner((_c, args) => (args[0] === "image" ? failed("none", 1) : args[0] === "run" ? failed("Killed", 137) : ok()));
  const r = await ensureGoRuntimes({ appDir: REPO, runner, docker: "docker", log: () => undefined });
  assert.ok(!r.ok && new RegExp(`stopped at its memory limit of ${GO_BUILD_MEMORY_MB} MB so the shops keep running`, "u").test(r.reason) && /Nothing was changed/u.test(r.reason), JSON.stringify(r));
  assert.ok(!runner.calls.some((c) => c.args[0] === "build"));
});

test("old geo-go images are removed, except this checkout's, any a container uses and any the deployed compose file names; a dry run only lists them", async () => {
  const mine = goImageFor(REPO);
  const lines: string[] = [];
  const make = () => fakeRunner((_c, args) => {
    if (args[0] === "image" && args[1] === "ls") return ok([mine, "geo-go:old1", "geo-go:running2", "geo-go:kept3", "geo-go:stale4", "geo-go:<none>"].join("\n"));
    if (args[0] === "ps") return ok("geo-go:running2\nnode:26-alpine\n");
    return ok();
  });
  const compose = 'rt-x:\n  image: "geo-go:kept3"\n';
  const dry = make();
  const d = await pruneGoImages({ appDir: REPO, runner: dry, docker: "docker", log: (l) => lines.push(l) }, { dryRun: true, composeText: compose });
  assert.deepEqual(d.removed.sort(), ["geo-go:old1", "geo-go:stale4"]);
  assert.ok(!dry.calls.some((c) => c.args[1] === "rm"), "a dry run removes nothing");
  assert.match(lines[0], /^Would remove old shop-program images: geo-go:old1, geo-go:stale4\.$/u);
  const real = make();
  const r = await pruneGoImages({ appDir: REPO, runner: real, docker: "docker", log: () => undefined }, { composeText: compose });
  assert.deepEqual(r.removed.sort(), ["geo-go:old1", "geo-go:stale4"]);
  assert.deepEqual(real.calls.filter((c) => c.args[1] === "rm").map((c) => c.args[2]).sort(), ["geo-go:old1", "geo-go:stale4"]);
  assert.deepEqual(r.kept.sort(), [mine, "geo-go:kept3", "geo-go:running2"].sort());
});

// ---- the directory of local shops on Go (wave 1c) -------------------------------------------------------------------------------------------------
// The deployer's side of the directory (moved here from directory-service.test.ts and directory-assistant.test.ts when the TypeScript service was deleted: their checks of the service
// itself are the directory contract, modules/discovery/contract/, and the Go tests in go/internal/directory and go/cmd/directory).

const DDIRS = { app: "/repo", generated: "/srv/generated", secrets: "/srv/secrets", status: "/srv/status", fleet: "/srv/fleet", shops: "/srv/shops", secretsInbox: "/srv/secrets-inbox", requests: "/srv/requests", exports: "/srv/exports", panelData: "/srv/panel", config: "/srv/geometer.json", licence: "/srv/state/licence", home: "/srv/home" };
const hosted = (extra: Record<string, unknown> = {}) => serverConfig({ panel: { enabled: true, mode: "hosted" }, fleet: { url: "https://fleet.example", keyFile: "fleet.key" }, pages: { domain: "pages.example", extraDomains: ["old.example"] }, ...extra });
const nets = (c: ReturnType<typeof composeServer>, svc: string): string[] => Object.keys((c.services[svc].block.networks as Record<string, unknown> | undefined) ?? {}).sort();

test("the directory runs the Go program in the programs' image: its own container on the pages and egress networks, its own volume at the folder existing servers have it in, no secret, no app mount, the program's health check, and exactly CONFIG, PORT and HOST", () => {
  const c = composeServer(hosted(), DDIRS, [], { goImage: IMAGE });
  const d = c.services.directory.block as Record<string, any>;
  assert.equal(d.image, IMAGE);
  assert.deepEqual(d.command, ["/directory"]);
  assert.equal(d.user, "1000:1000");
  assert.equal(d.read_only, true);
  for (const key of ["init", "cap_drop", "security_opt", "tmpfs", "restart"]) assert.ok(d[key] !== undefined, `${key}: the hardening every service has`);
  assert.deepEqual(d.environment, { CONFIG: "/etc/geometer/directory.json", PORT: "8799", HOST: "0.0.0.0" }, "nothing else is passed: never the contract's test clock (GEOMETER_TEST, GEOMETER_TEST_CLOCK_FILE)");
  assert.deepEqual(d.volumes, ["/srv/generated/directory:/etc/geometer:ro", `${DIRECTORY_VOLUME}:/home/node`], "the config and its own volume; no /app (the program has its code inside), no secret");
  assert.equal(DIRECTORY_DATA_DIR, "/home/node/directory", "the index and the key stay where the Node service kept them, so an existing server's volume is read as it is");
  assert.deepEqual(d.healthcheck.test, ["CMD", "/directory", "health", "http://127.0.0.1:8799/healthz"], "no wget in the image: the program asks its own /healthz");
  assert.deepEqual(Object.keys(d.networks).sort(), ["egress", "pages"], "no admin, front, panel or shop network: it reaches no runtime, Guard, relay or panel");
  assert.match(c.compose, new RegExp(`\\n  ${DIRECTORY_VOLUME}:`, "u"), "the volume is declared");
  assert.deepEqual(c.services.directory.files, ["/srv/generated/directory/directory.json"], "a changed config restarts it");
  const door = c.services.door.block as { environment: Record<string, string>; networks: Record<string, unknown>; image: string };
  assert.equal(door.environment.INTERNAL_PORT, "8798");
  assert.deepEqual(Object.keys(door.networks).sort(), ["egress", "pages"]);
  assert.equal(door.image, "node:26-alpine", "the door stays on Node");
  assert.ok(!caddyfile(hosted(), [], ["veena"]).includes("directory"), "Caddy does not name the directory: everything under the pages domain goes to the door");
  assert.ok(GO_PROGRAMS.includes("directory"), "the programs' image holds it");
  assert.throws(() => composeServer(hosted(), DDIRS, [], {}), /no image of the Go programs/u, "a server with the directory needs the programs' image");
});

test("the programs' image gives /home/node to 1000:1000, so a NEW directory volume is the directory's user's and an existing one keeps its owner", () => {
  assert.match(dockerfileOf("abc", "golang@sha256:x"), /^COPY --chown=1000:1000 root\/ \/$/mu);
});

test("a server with no pages domain has no directory, no volume, no door and never needs the image", () => {
  const builder = serverConfig({ panel: { enabled: true } });
  const c = composeServer(builder, DDIRS, [], {});
  assert.equal(c.services.directory, undefined);
  assert.equal(c.services.door, undefined);
  assert.ok(!c.compose.includes(DIRECTORY_VOLUME));
  assert.ok(!c.compose.includes("geo-go"));
  assert.equal(directoryConfig(builder), undefined);
  assert.equal(hasDirectory(builder), false);
  assert.equal(hasDirectory(hosted()), true);
});

test("the directory's volume is a cache that no backup copies", () => {
  const jobs = readFileSync(new URL("../backup/jobs.ts", import.meta.url), "utf8");
  assert.ok(!jobs.includes(DIRECTORY_VOLUME) && !/directory-data|DIRECTORY_VOLUME/u.test(jobs), "backup/jobs.ts names the volumes it copies, and this is not one");
  assert.match(readFileSync(new URL("../generate/compose.ts", import.meta.url), "utf8"), /that no backup copies/u);
});

test("the directory's config: the pages domains it serves, the door's own port, its folder, the feeds named in geometer.json, who runs it; no secret", () => {
  const text = directoryConfig(hosted({ directory: { feeds: ["https://shops.example/s/ravi/listings.json"], area: "Kerala" } }))!;
  assert.deepEqual(JSON.parse(text), { origin: "https://pages.example", served: ["pages.example", "old.example"], doorUrl: "http://door:8798", dataDir: DIRECTORY_DATA_DIR, feeds: ["https://shops.example/s/ravi/listings.json"], provider: { organization: "Geometer", url: "https://pages.example" }, area: "Kerala" });
  assert.deepEqual(JSON.parse(directoryConfig(hosted())!).feeds, []);
  assert.ok(!/key|secret|token|password/iu.test(text.replace("dataDir", "")));
});

test("geometer.json `directory`: feeds are https addresses, at most 200, and it needs the pages domain", () => {
  const base = { schema: 1, id: "partner-1", domain: "partners.example", reviewedBy: "t", panel: { enabled: true, mode: "hosted" }, fleet: { url: "https://fleet.example", keyFile: "fleet.key" }, pages: { domain: "pages.example", extraDomains: [] } };
  const errors = (directory: unknown, withPages = true) => parseServer({ ...base, ...(withPages ? {} : { pages: undefined }), directory }).errors.join(" ");
  assert.equal(errors({ feeds: ["https://shops.example/s/ravi/listings.json"], area: "Kerala" }), "");
  assert.equal(errors({}), "", "both parts are optional");
  assert.match(errors({ feeds: ["http://shops.example/x/listings.json"] }), /"directory" must say/u);
  assert.match(errors({ feeds: ["not an address"] }), /"directory" must say/u);
  assert.match(errors({ feeds: Array.from({ length: 201 }, (_, i) => `https://x.example/${i}/listings.json`) }), /"directory" must say/u);
  assert.match(errors({ feeds: [], extra: 1 }), /"directory" must say/u);
  assert.match(errors("yes"), /"directory" must say/u);
  assert.match(errors({ feeds: [] }, false), /needs "pages"/u);
  assert.deepEqual(parseServer({ ...base, directory: { feeds: ["https://a.example/b/listings.json"], area: "Kerala" } }).config.directory, { feeds: ["https://a.example/b/listings.json"], area: "Kerala" });
});

const inForce = latestPriceList();
const before = loadPriceList(new URL("2026-11-14.json", PRICES_DIR).pathname);

test("the directory's assistant is on only where the server has the directory and a model, and the price list in force has its budget", () => {
  const b = directoryAssistant(hosted(), inForce)!;
  assert.deepEqual([b.monthlyMicroInr, b.daily.buyer, b.perBuyerPerDay], [2_500_000_000, 1500, 12]);
  assert.deepEqual(b, discoveryBudgetFor(inForce));
  assert.equal(directoryAssistant(hosted(), before), undefined, "a list with no budget: off");
  assert.equal(directoryAssistant(serverConfig({ panel: { enabled: true } }), inForce), undefined, "no pages domain, no directory");
  assert.equal(directoryAssistant({ ...hosted(), model: { ...hosted().model, model: "" } }, inForce), undefined, "no model chosen");
  assert.deepEqual(directoryAssistant(hosted()), directoryAssistant(hosted(), inForce), "by default it reads the list in force");
});

test("the assistant's config: the budget, the model by the Guard's address, the credential's file name and never the credential; with no budget there is no block", () => {
  const server = hosted();
  const withIt = JSON.parse(directoryConfig(server, directoryAssistant(server, inForce))!);
  assert.deepEqual(withIt.assistant, {
    monthlyMicroInr: 2_500_000_000, dailyCalls: 1500, perBuyerPerDay: 12,
    model: { wire: "openai", baseUrl: `${guardUrl("g-model")}/v1`, model: "gpt-4o-mini" }, agentTokenFile: DIRECTORY_SECRET_FILE,
    ...(withIt.assistant.provider ? { provider: withIt.assistant.provider } : {}),
  });
  assert.equal(DIRECTORY_SECRET_FILE, "/run/secrets/agent_model");
  assert.equal(JSON.parse(directoryConfig(server)!).assistant, undefined, "no budget: the assistant is off and the search page has no box");
  assert.equal(JSON.parse(directoryConfig(server, directoryAssistant(server, before))!).assistant, undefined);
  assert.ok(!/Bearer|"[A-Za-z0-9_-]{40,}"/u.test(JSON.stringify(withIt)), "no credential in the file");
});

test("compose with the assistant: the model Guard and the directory share one internal network of their own; the directory still reaches only the door, the feeds and that Guard; its credential folder only", () => {
  const c = composeServer(hosted(), DDIRS, [node("glow-salon", 1)], { assistant: true, goImage: IMAGE });
  assert.deepEqual(nets(c, "directory"), ["assistant", "egress", "pages"]);
  assert.ok(nets(c, "fwd-model").includes(ASSISTANT_NETWORK), "the Guard is reachable there");
  assert.deepEqual(Object.keys(c.services).filter((s) => nets(c, s).includes(ASSISTANT_NETWORK)).sort(), ["directory", "fwd-model"], "nobody else is on it");
  assert.match(c.compose, /\n  assistant:\n    internal: true/u, "it has no way out");
  const subnets = addressing(hosted()).subnets;
  assert.equal(new Set(Object.values(subnets)).size, Object.keys(subnets).length, "its subnet overlaps none");
  const d = c.services.directory.block as { volumes: string[] };
  assert.ok(d.volumes.includes("/srv/secrets/directory:/run/secrets:ro"), "its own credential folder, read-only");
  assert.ok(!d.volumes.some((v) => v.includes("/secrets/") && !v.includes("/secrets/directory")), "no other secret");
  for (const n of ["admin", "front", "panel", "net-glow-salon"]) assert.ok(!nets(c, "directory").includes(n), `the directory is not on ${n}`);
  assert.ok(nets(c, "fwd-model").includes("net-glow-salon"), "the shops still reach the Guard as before");
  // without the assistant: as it was; and with no shop there is no model Guard to reach
  const plain = composeServer(hosted(), DDIRS, [node("glow-salon", 1)], { goImage: IMAGE });
  assert.deepEqual(nets(plain, "directory"), ["egress", "pages"]);
  assert.doesNotMatch(plain.compose, /\n  assistant:\n    internal/u);
  assert.ok(!(plain.services.directory.block.volumes as string[]).some((v) => v.includes("/secrets")));
  const noShops = composeServer(hosted(), DDIRS, [], { assistant: true, goImage: IMAGE });
  assert.deepEqual(nets(noShops, "directory"), ["egress", "pages"]);
  assert.equal(noShops.services["g-model"], undefined);
  const noPages = composeServer(serverConfig({ panel: { enabled: true } }), DDIRS, [node("glow-salon", 1)], { assistant: true });
  assert.ok(!noPages.compose.includes(`\n  ${ASSISTANT_NETWORK}:`), "no directory, no network");
});

test("the directory is one more agent of the model Guard under its own id, which no shop's id can be", () => {
  assert.equal(DIRECTORY_AGENT_ID, "directory-assistant");
  assert.notEqual(DIRECTORY_AGENT_ID, names.agentId("directory-assistant"), "a shop named so is `runtime-directory-assistant`");
  assert.ok(!names.agentId("x").startsWith(DIRECTORY_AGENT_ID));
});
