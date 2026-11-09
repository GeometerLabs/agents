// `geometer update` and `geometer rollback`: three clients where one fails a situation at the new version (two move, one is held back and says why), a rollback of
// what the update moved, a run that was stopped in the middle and carries on without doing anything twice, a refused deploy that puts the pin back and stops the rollout,
// a dry run that changes nothing, and the agents someone else wrote being skipped. The hand check is answered by a stand-in, in the very lines the real one prints, except in
// the two tests that run the real one (one, and a whole update with it) so the reading of its lines is held to what it really prints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { addAgent } from "../agent/deploy.ts";
import { deploy } from "../deploy.ts";
import { main } from "../geometer.ts";
import { compare, readHandCheck, runHandCheck, savedDataLayout } from "../handcheck.ts";
import { realRunner } from "../lib/runner.ts";
import { loadState } from "../lib/state.ts";
import { readStatus } from "../lib/status.ts";
import { EXAMPLE_CLIENT, PHONE_NUMBER_ID, CALENDAR_ID, panelRuntime } from "./helpers.ts";
import { composeCalls, world } from "./world.ts";
import type { World } from "./world.ts";

async function quiet<T>(work: () => Promise<T>): Promise<{ result: T; out: string; err: string }> {
  const out: string[] = []; const err: string[] = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a: unknown[]) => out.push(a.join(" ")); console.error = (...a: unknown[]) => err.push(a.join(" "));
  try { return { result: await work(), out: out.join("\n"), err: err.join("\n") }; } finally { console.log = log; console.error = error; }
}

// ---- a stand-in for the template's hand check, printing the lines the real one prints ---------------------------------------------------------

interface Row { title: string; held: boolean; why?: string; number?: number }

function handCheckText(shopName: string, rows: Row[]): string {
  const failed = rows.filter((r) => !r.held);
  const lines = ["Stand-ins, not the Geometer engine. Hand-run check for the Phase 0 prototype.", "", `CRASH TEST   ${shopName} · Bookings · English   (stand-in services, hand-run)`, "",
    `  Held ${rows.length - failed.length} of ${rows.length}.  ${failed.length} failed.  14 not tested.`, "", "  Work done for you: ...", ""];
  for (const r of rows) {
    lines.push(`  ${r.held ? "✓" : "✗"} ${r.number ? `#${String(r.number).padStart(2, " ")}` : "   "}  ${r.title}`);
    if (!r.held) { lines.push(`        ✗ ${r.why ?? "A check failed"}`, "            what the stand-in's own records hold"); }
  }
  lines.push("", failed.length === 0 ? `  Held ${rows.length} of ${rows.length} within what was tried.` : `  ${failed.length} failed: ${failed.map((r) => r.title).join("; ")}.`);
  return lines.join("\n");
}

const SITUATIONS = ["A normal booking", "Razorpay created the link but the reply was lost", "Deposit link paid twice", "Customer asks for more back than they paid"];
const holdsAll = (): Row[] => SITUATIONS.map((title, i) => ({ title, held: true, number: i === 0 ? undefined : i }));

/** Answer every hand check and every saved-data-layout question the update asks, and write down who was asked about what. */
function standIn(w: World, answer: (version: string, settings: Record<string, any>) => Row[], layout: (version: string) => number = () => 1) {
  const asked: { version: string; shop: string }[] = [];
  const next = w.ctx.runner.run.bind(w.ctx.runner);
  const versionIn = (pathwayDir: string) => (JSON.parse(readFileSync(join(pathwayDir, "package.json"), "utf8")) as { version: string }).version;
  w.ctx.runner.run = async (command, args, options) => {
    if (command === process.execPath && args[0]?.endsWith("hand-check.ts")) {
      const version = versionIn(dirname(dirname(args[0])));
      const settings = JSON.parse(readFileSync(args[2], "utf8")) as Record<string, any>;
      asked.push({ version, shop: basename(dirname(args[2])) });
      const rows = answer(version, settings);
      return { code: rows.every((r) => r.held) ? 0 : 1, stdout: handCheckText(settings.name, rows), stderr: "" };
    }
    if (command === process.execPath && args.includes("-e")) return { code: 0, stdout: `${layout(versionIn(dirname(dirname(new URL(args.at(-1)!).pathname))))}\n`, stderr: "" };
    return next(command, args, options);
  };
  return asked;
}

/** At 0.2.0 a client whose deposit is ₹240 pays twice. Nothing else changes. */
const paysTwiceAtNew = (version: string, settings: Record<string, any>): Row[] =>
  holdsAll().map((r) => (version === "0.2.0" && settings.deposit.amountInr === 240 && r.title === "Deposit link paid twice" ? { ...r, held: false, why: "The customer was charged twice: the payments service shows 2 captured payments for one booking" } : r));

const SHOPS = ["glow-salon", "bright-tuition", "pet-spa"];

/** Three clients, deployed at 0.1.0; bright-tuition's deposit is ₹240. Version 0.2.0 is on the server (a copy of the pathway, as `git worktree` of a tag would give). */
async function threeClients(): Promise<World> {
  const w = world(Object.fromEntries(SHOPS.map((s) => [s, panelRuntime()])));
  for (const s of SHOPS) w.handIn(s);
  setSettings(w, "bright-tuition", (x) => { x.name = "Bright Tuition"; x.deposit.amountInr = 240; });
  setSettings(w, "pet-spa", (x) => { x.name = "Pet Spa"; });
  await deploy(w.ctx);
  addVersion(w, "0.2.0");
  w.calls.length = 0;
  return w;
}

function setSettings(w: World, shop: string, edit: (x: any) => void): void {
  const path = join(w.paths.shop(shop), "settings.json");
  const x = JSON.parse(readFileSync(path, "utf8")); edit(x); writeFileSync(path, JSON.stringify(x));
}

function addVersion(w: World, version: string): void {
  const dir = join(w.root, "templates", "commerce", `bookings@${version}`);
  cpSync(join(w.ctx.appDir, "templates", "commerce", "bookings"), dir, { recursive: true });
  // a kept checkout imports the shared modules three folders up from itself (../../../../modules), so the server holds them beside its kept templates
  if (!existsSync(join(w.root, "modules"))) cpSync(join(w.ctx.appDir, "modules"), join(w.root, "modules"), { recursive: true });
  const pkg = join(dir, "package.json");
  writeFileSync(pkg, readFileSync(pkg, "utf8").replaceAll('"version": "0.1.0"', `"version": "${version}"`));
}

const pin = (w: World, shop: string): string => readFileSync(join(w.paths.shop(shop), "pathway.lock"), "utf8").trim();
const update = (w: World, ...args: string[]) => quiet(() => main(["update", ...args, "--server", w.root], w.ctx));
const rollback = (w: World, ...args: string[]) => quiet(() => main(["rollback", ...args, "--server", w.root], w.ctx));

/** Every file under a folder with its content, so a test can say that nothing was written. */
function tree(root: string, base = root, into: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) tree(path, base, into); else into[path.slice(base.length)] = readFileSync(path, "utf8");
  }
  return into;
}

// ---- reading the hand check ---------------------------------------------------------------------------------------------------------------

test("the real hand check's answer is read as it is printed: the count agrees with its lines, and a version compared with itself differs in nothing", async () => {
  const ctx = { runner: realRunner } as Parameters<typeof runHandCheck>[0];
  const pathway = new URL("../../templates/commerce/bookings", import.meta.url).pathname;
  const r = await runHandCheck(ctx, pathway, join(EXAMPLE_CLIENT, "settings.json"));
  assert.ok(r.ok, r.ok ? "" : r.reason);
  assert.ok(r.read.total > 20 && r.read.held === r.read.total && r.read.situations.length === r.read.total, `${r.read.held} of ${r.read.total}`);
  assert.ok(r.read.situations.every((s) => s.title.length > 3 && s.why === ""));
  assert.deepEqual(compare(r.read, r.read), { failing: [], notChecked: [] });
  // the stand-in prints what the reader reads back, so the tests below are about the same lines
  assert.deepEqual(readHandCheck(handCheckText("X", r.read.situations.map((s) => ({ title: s.title, held: s.held })))), { ...r.read, situations: r.read.situations.map((s) => ({ ...s, why: "" })) });
  const layout = await savedDataLayout(ctx, pathway);
  assert.ok(Number.isInteger(layout) && layout! > 0, "and the runtime's saved-data layout can be asked of a version's folder");
  assert.equal(await savedDataLayout(ctx, join(pathway, "nowhere")), undefined, "or not, when it cannot be asked");
  const nothing = await runHandCheck(ctx, join(pathway, "nowhere"), join(EXAMPLE_CLIENT, "settings.json"));
  assert.ok(!nothing.ok && nothing.reason.length > 0, "a version with no hand check is an answer the update can say in words, not a crash");
});

test("a failed situation is read with the first check that failed; a count that disagrees with the lines, or an output that is not an answer, is not read", () => {
  const read = readHandCheck(handCheckText("X", [{ title: "A normal booking", held: true }, { title: "Deposit link paid twice", held: false, number: 7, why: "Charged twice" }]))!;
  assert.deepEqual([read.held, read.total, read.situations[1]], [1, 2, { title: "Deposit link paid twice", held: false, why: "Charged twice: what the stand-in's own records hold" }]);
  assert.equal(readHandCheck("nothing useful"), undefined);
  assert.equal(readHandCheck(handCheckText("X", holdsAll()).replace("Held 4 of 4", "Held 3 of 4")), undefined);
  const before = readHandCheck(handCheckText("X", holdsAll()))!;
  const after = readHandCheck(handCheckText("X", [...holdsAll().slice(1).map((r, i) => (i === 0 ? { ...r, held: false } : r)), { title: "A new situation", held: false }]))!;
  assert.deepEqual(compare(before, after), { failing: [{ title: "Razorpay created the link but the reply was lost", why: "A check failed: what the stand-in's own records hold" }, { title: "A new situation", why: "A check failed: what the stand-in's own records hold" }], notChecked: ["A normal booking"] });
  assert.deepEqual(compare(after, after), { failing: [], notChecked: [] }, "a situation that failed in both is not a reason to hold a client back");
});

// ---- update ---------------------------------------------------------------------------------------------------------------------------------

test("three clients: one fails a situation at the new version, so two move and one is held back with the situation and the reason; each was checked on its own settings first", async () => {
  const w = await threeClients(); try {
    const asked = standIn(w, paysTwiceAtNew);
    const r = await update(w, "--to", "0.2.0");
    assert.equal(r.result, 1, "one client was held back");
    assert.deepEqual([pin(w, "glow-salon"), pin(w, "pet-spa"), pin(w, "bright-tuition")], ["bookings@0.2.0", "bookings@0.2.0", "bookings@0.1.0"]);
    const state = loadState(w.root);
    assert.deepEqual(["glow-salon", "pet-spa", "bright-tuition"].map((s) => state.shops[s].applied!.pathway), ["bookings@0.2.0", "bookings@0.2.0", "bookings@0.1.0"], "what runs is what the pins say");
    assert.deepEqual(state.shops["glow-salon"].lockHistory, ["bookings@0.1.0\n"], "the pin before is kept for the rollback");
    // each client was asked at the version it runs and at the new one, in order, on its own settings
    assert.deepEqual(asked.map((a) => `${a.shop}@${a.version}`), ["bright-tuition@0.1.0", "bright-tuition@0.2.0", "glow-salon@0.1.0", "glow-salon@0.2.0", "pet-spa@0.1.0", "pet-spa@0.2.0"]);
    // the record of the run, step by step
    const run = state.update!;
    assert.ok(run.finishedAt && run.kind === "update");
    assert.deepEqual(run.shops.map((s) => run.steps[s].status), ["held-back", "moved", "moved"]);
    const held = run.steps["bright-tuition"];
    assert.deepEqual([held.from, held.to, held.before, held.after], ["bookings@0.1.0", "bookings@0.2.0", { held: 4, of: 4 }, { held: 3, of: 4 }]);
    assert.deepEqual(held.failing, [{ title: "Deposit link paid twice", why: "The customer was charged twice: the payments service shows 2 captured payments for one booking: what the stand-in's own records hold" }]);
    assert.match(held.reason!, /Held 3 of 4 at bookings@0\.2\.0; 4 of 4 held at bookings@0\.1\.0\. Now failing: Deposit link paid twice\. It stays on bookings@0\.1\.0\./);
    assert.match(run.steps["glow-salon"].proven!, /12 of 12 limits proven to bite/);
    // what a person reads
    assert.match(r.out, /✗ bright-tuition  HELD BACK\. Held 3 of 4 at bookings@0\.2\.0/);
    assert.match(r.out, /- Deposit link paid twice: The customer was charged twice/);
    assert.match(r.out, /✓ glow-salon +moved from bookings@0\.1\.0 to bookings@0\.2\.0\. Held 4 of 4 on its own settings \(4 of 4 before\)\. 12 of 12 limits proven to bite/);
    assert.match(r.out, /Moved 2, held back 1, unchanged 0, skipped 0\./);
    assert.match(r.out, /A held-back client keeps running the version it runs now\./);
    // the held-back client was not touched: its status still says the old version, and no compose command was about it alone
    assert.equal(readStatus(w.root, "bright-tuition")!.versions?.pathway, "bookings@0.1.0");
    assert.equal(readStatus(w.root, "glow-salon")!.versions?.pathway, "bookings@0.2.0");
    assert.equal(composeCalls(w).filter((c) => c[0] === "up").length, 2, "one checked deploy per client that moved");
    // asking again: the held-back client is checked again (the run was finished), and the others are already there
    const again = await update(w, "--to", "0.2.0");
    assert.equal(again.result, 1);
    assert.match(again.out, /= glow-salon +unchanged\. Already on bookings@0\.2\.0\./);
    assert.deepEqual(asked.slice(6).map((a) => `${a.shop}@${a.version}`), ["bright-tuition@0.1.0", "bright-tuition@0.2.0"]);
    // and when the client's settings no longer trip the new version, it moves
    setSettings(w, "bright-tuition", (x) => { x.deposit.amountInr = 250; });
    const fixed = await update(w, "--to", "0.2.0");
    assert.equal(fixed.result, 0, fixed.out);
    assert.equal(pin(w, "bright-tuition"), "bookings@0.2.0");
  } finally { w.done(); }
});

test("a situation that held before and is not run at the new version holds the client back too, and says so apart from a failure", async () => {
  const w = await threeClients(); try {
    standIn(w, (version) => (version === "0.2.0" ? holdsAll().filter((r) => r.title !== "Deposit link paid twice") : holdsAll()));
    const r = await update(w, "--to", "0.2.0", "--shops", "glow-salon");
    assert.equal(r.result, 1);
    assert.match(r.out, /HELD BACK\. Held 3 of 3 at bookings@0\.2\.0; 4 of 4 held at bookings@0\.1\.0\. No longer checked at bookings@0\.2\.0: Deposit link paid twice\./);
    assert.doesNotMatch(r.out, /Now failing/);
    assert.equal(pin(w, "glow-salon"), "bookings@0.1.0");
    assert.equal(pin(w, "pet-spa"), "bookings@0.1.0", "--shops left the others alone");
  } finally { w.done(); }
});

test("a version this server does not have, a hand check that cannot run, and a pin that does not match what runs hold a client back in words", async () => {
  const w = await threeClients(); try {
    const missing = await update(w, "--to", "0.9.0", "--shops", "glow-salon");
    assert.equal(missing.result, 1);
    assert.match(missing.out, /This server does not have bookings@0\.9\.0\. Put a checkout of it in .*templates\/commerce\/bookings@0\.9\.0, then run this again\. It stays on bookings@0\.1\.0\./);
    const next = w.ctx.runner.run.bind(w.ctx.runner);
    w.ctx.runner.run = async (command, args, options) => (command === process.execPath && args[0]?.endsWith("hand-check.ts") ? { code: 1, stdout: "", stderr: "SyntaxError: the new hand check does not start\n   at file" } : next(command, args, options));
    const broken = await update(w, "--to", "0.2.0", "--shops", "pet-spa");
    assert.match(broken.out, /The hand check could not be run on its settings at bookings@0\.1\.0, the version it runs now, so there is nothing to compare bookings@0\.2\.0 with \(SyntaxError: the new hand check does not start\)\./);
    writeFileSync(join(w.paths.shop("pet-spa"), "pathway.lock"), "bookings@0.2.0\n");
    const differs = await update(w, "--to", "0.2.0", "--shops", "pet-spa");
    assert.match(differs.out, /Its pin says bookings@0\.2\.0 but bookings@0\.1\.0 is what runs, so an earlier change did not finish\. Run `geometer deploy pet-spa` first/);
    assert.match((await update(w, "--shops", "nobody")).err, /There is no shop called nobody/);
    assert.match((await update(w, "--to", "latest")).err, /is not a version/);
  } finally { w.done(); }
});

test("a dry run runs the hand checks and says what would happen, and changes nothing: no file, no state, no pin, no docker command", async () => {
  const w = await threeClients(); try {
    const asked = standIn(w, paysTwiceAtNew);
    const before = tree(w.root);
    const r = await update(w, "--to", "0.2.0", "--dry-run");
    assert.equal(r.result, 1, "it would hold one client back");
    assert.match(r.out, /^Dry run: nothing was changed\./);
    assert.match(r.out, /✓ glow-salon +would move from bookings@0\.1\.0 to bookings@0\.2\.0\./);
    assert.match(r.out, /✗ bright-tuition +HELD BACK\. Held 3 of 4/);
    assert.match(r.out, /Would move 2, held back 1/);
    assert.equal(asked.length, 6, "the hand checks did run");
    assert.deepEqual(tree(w.root), before, "every file under the server folder is byte for byte as it was");
    assert.deepEqual(w.calls, [], "and docker was not asked anything");
    const back = await rollback(w, "--dry-run");
    assert.match(back.err, /nothing to roll back/);
  } finally { w.done(); }
});

test("an update stopped in the middle carries on from where it stopped when the same command is run again, and checks and deploys nothing twice", async () => {
  const w = await threeClients(); try {
    const asked = standIn(w, paysTwiceAtNew);
    let lostPower = true;
    const next = w.ctx.runner.run.bind(w.ctx.runner);
    w.ctx.runner.run = async (command, args, options) => {
      // the machine stops while pet-spa's checked deploy brings its services up (its pin has just been written)
      if (lostPower && args[0] === "compose" && args.includes("up") && pin(w, "pet-spa") === "bookings@0.2.0") throw new Error("the machine lost power");
      return next(command, args, options);
    };
    const first = await update(w, "--to", "0.2.0");
    assert.equal(first.result, 1); assert.match(first.err, /the machine lost power/);
    const half = loadState(w.root).update!;
    assert.deepEqual(half.shops.map((s) => half.steps[s]?.status), ["held-back", "moved", "moving"]);
    assert.equal(half.finishedAt, undefined);
    assert.equal(asked.length, 6);
    lostPower = false; w.calls.length = 0;
    const second = await update(w, "--to", "0.2.0");
    assert.equal(second.result, 1, "bright-tuition is still held back");
    assert.equal(asked.length, 6, "nobody was checked a second time, the client that was half-way included");
    assert.equal(composeCalls(w).filter((c) => c[0] === "up").length, 1, "and only the client that was half-way was deployed");
    const done = loadState(w.root);
    assert.deepEqual(done.update!.shops.map((s) => done.update!.steps[s].status), ["held-back", "moved", "moved"]);
    assert.ok(done.update!.finishedAt);
    assert.deepEqual([done.update!.steps["bright-tuition"], done.update!.steps["glow-salon"]], [half.steps["bright-tuition"], half.steps["glow-salon"]], "the steps already done are as they were: it was the same run");
    assert.equal(done.shops["pet-spa"].applied!.pathway, "bookings@0.2.0");
    assert.deepEqual(done.shops["pet-spa"].lockHistory, ["bookings@0.1.0\n"], "and its history has the old pin once");
    assert.match(second.out, /✓ pet-spa +moved from bookings@0\.1\.0 to bookings@0\.2\.0/);
    // a different request is a new run, even if the old one had not finished
    const other = await update(w, "--shops", "glow-salon", "--to", "0.2.0");
    assert.equal(other.result, 0, other.out);
    assert.deepEqual(loadState(w.root).update!.shops, ["glow-salon"], "the run is the new one: it has only the client it was asked for");
  } finally { w.done(); }
});

test("a refused deploy puts that client's earlier pin back and stops the rollout there; the same command again carries on with the clients not started", async () => {
  const w = await threeClients(); try {
    standIn(w, paysTwiceAtNew);
    w.failVerify("g-glow-salon-razorpay", ["deposit-amount"]);
    const r = await update(w, "--to", "0.2.0");
    assert.equal(r.result, 1);
    assert.deepEqual([pin(w, "glow-salon"), pin(w, "pet-spa")], ["bookings@0.1.0", "bookings@0.1.0"], "glow-salon's pin is back, and pet-spa was never started");
    const state = loadState(w.root);
    const run = state.update!;
    assert.equal(run.finishedAt, undefined);
    assert.equal(run.steps["glow-salon"].status, "held-back");
    assert.match(run.steps["glow-salon"].reason!, /The deploy was refused: \[tripwire:deposit-amount\].* It stays on bookings@0\.1\.0\./);
    assert.equal(run.steps["pet-spa"], undefined);
    assert.match(run.stoppedBecause!, /glow-salon: the deploy was refused/);
    assert.deepEqual(state.shops["glow-salon"].lockHistory, [], "nothing was left in the history by the move that did not happen");
    assert.equal(state.shops["glow-salon"].applied!.pathway, "bookings@0.1.0");
    assert.match(r.out, /Stopped after glow-salon: the deploy was refused\. The clients not started yet are taken when you run the same command again\./);
    assert.match(r.out, /\. pet-spa +not started yet\./);
    const next = await update(w, "--to", "0.2.0");
    assert.equal(pin(w, "pet-spa"), "bookings@0.2.0");
    assert.equal(pin(w, "glow-salon"), "bookings@0.1.0", "glow-salon was finished in the first run, as held back, and is not tried again until a new run");
    assert.ok(loadState(w.root).update!.finishedAt);
    assert.equal(next.result, 1);
  } finally { w.done(); }
});

test("an agent you wrote that Geometer has no command to start is skipped with a plain note, and the clients beside it are updated (the agents that can be crash-tested: update-agent.test.ts)", async () => {
  const w = await threeClients(); try {
    standIn(w, () => holdsAll());
    addAgent(w.root, "my-agent", { upstreams: "razorpay,whatsapp,calendar", "owner-whatsapp": "+919800000001", deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "calendar-id": CALENDAR_ID }, () => { throw new Error("no file"); }, new Date("2026-11-05T09:00:00Z"));
    const r = await update(w, "--to", "0.2.0");
    assert.equal(r.result, 0, r.out);
    assert.match(r.out, /- my-agent +skipped\. It has no command to start it with, so it cannot be crash-tested\. Give one: geometer agent set my-agent --run "<command>" --version <version>\. Until then you update it yourself\./);
    assert.match(r.out, /Moved 3, held back 0, unchanged 0, skipped 1\./);
    assert.equal(loadState(w.root).update!.steps["my-agent"].status, "skipped");
    const only = await update(w, "--shops", "my-agent", "--to", "0.2.0");
    assert.equal(only.result, 0); assert.match(only.out, /skipped\. It has no command to start it with/);
  } finally { w.done(); }
});

// ---- rollback -------------------------------------------------------------------------------------------------------------------------------

test("rollback puts back the clients the last update moved, with no name; one name or --shops puts back just those; a client that was never moved says it has nothing to go back to", async () => {
  const w = await threeClients(); try {
    standIn(w, paysTwiceAtNew);
    await update(w, "--to", "0.2.0");
    // run it again, as the summary says to, to look at the held-back client again: the two it moved are "unchanged" now, and a rollback still undoes them
    const again = await update(w, "--to", "0.2.0");
    assert.match(again.out, /Moved 0, held back 1, unchanged 2/);
    assert.match(again.out, /run `geometer update --to 0\.2\.0` again/, "and the hint repeats the request as it was given");
    w.calls.length = 0;
    const r = await rollback(w);
    assert.equal(r.result, 0, r.err + r.out);
    assert.deepEqual(SHOPS.map((s) => pin(w, s)), ["bookings@0.1.0", "bookings@0.1.0", "bookings@0.1.0"]);
    assert.match(r.out, /✓ glow-salon +Back to bookings@0\.1\.0 \(was bookings@0\.2\.0\)\./);
    assert.match(r.out, /Moved back 2, held back 0/);
    assert.equal(composeCalls(w).filter((c) => c[0] === "up").length, 2, "through the same checked deploy");
    const state = loadState(w.root);
    assert.equal(state.shops["glow-salon"].applied!.pathway, "bookings@0.1.0");
    assert.deepEqual(state.rollback!.shops.map((s) => state.rollback!.steps[s].status), ["moved", "moved"]);
    assert.ok(state.rollback!.finishedAt && state.update!.finishedAt, "the update's own record is still there");
    assert.match((await rollback(w)).err, /There is nothing to roll back/);
    assert.match((await rollback(w, "bright-tuition")).err, /bright-tuition has no earlier pathway\.lock to go back to/);
    assert.match((await rollback(w, "glow-salon")).err, /glow-salon has no earlier pathway\.lock to go back to/, "a rollback is not a way to go forward, which would skip the check");
    assert.deepEqual(loadState(w.root).shops["glow-salon"].lockHistory, []);
    // moved again, then only one of the two goes back
    await update(w, "--to", "0.2.0", "--shops", "glow-salon,pet-spa");
    const one = await rollback(w, "--shops", "pet-spa");
    assert.equal(one.result, 0, one.err);
    assert.deepEqual([pin(w, "glow-salon"), pin(w, "pet-spa")], ["bookings@0.2.0", "bookings@0.1.0"]);
  } finally { w.done(); }
});

test("an update with no version never takes a client back to an older one than it runs, and a move to a version that knows an older saved-data layout is held back", async () => {
  const w = await threeClients(); try {
    standIn(w, () => holdsAll(), (version) => (version === "0.2.0" ? 2 : 1));
    assert.equal((await update(w, "--to", "0.2.0", "--shops", "glow-salon,pet-spa")).result, 0);
    // this checkout is 0.1.0, which is what a bare `update` aims at: the two that run 0.2.0 are newer than that, and stay
    w.calls.length = 0;
    const bare = await update(w);
    assert.equal(bare.result, 0, bare.out);
    assert.deepEqual(SHOPS.map((s) => pin(w, s)), ["bookings@0.2.0", "bookings@0.1.0", "bookings@0.2.0"]);
    assert.match(bare.out, /= glow-salon +unchanged\. It runs bookings@0\.2\.0, which is newer than the bookings@0\.1\.0 in this checkout, so it is left as it is\. Name a version with --to to move it anyway\./);
    assert.deepEqual(composeCalls(w), []);
    // asked for by name, an older version is a move like any other, and the layout guard holds it back: 0.2.0 changed the layout and 0.1.0 cannot read it
    const down = await update(w, "--to", "0.1.0", "--shops", "glow-salon");
    assert.equal(down.result, 1);
    assert.match(down.out, /HELD BACK\. Moving to bookings@0\.1\.0 is refused\. bookings@0\.2\.0 changed how this client's saved data is laid out \(layout 1 to 2\), and bookings@0\.1\.0 cannot read it, so its runtime would not start\. It stays on bookings@0\.2\.0\./);
    assert.equal(pin(w, "glow-salon"), "bookings@0.2.0");
    assert.deepEqual(composeCalls(w), []);
  } finally { w.done(); }
});

test("rollback across a change in how the runtime lays out its saved data is refused before anything is touched, and the update warned about it", async () => {
  const w = await threeClients(); try {
    standIn(w, () => holdsAll(), (version) => (version === "0.2.0" ? 2 : 1));
    const up = await update(w, "--to", "0.2.0", "--shops", "glow-salon");
    assert.equal(up.result, 0, up.out);
    assert.match(up.out, /Note: bookings@0\.2\.0 changes how saved data is laid out \(layout 1 to 2\), so `geometer rollback` will refuse to go back across it\./);
    w.calls.length = 0;
    const r = await rollback(w);
    assert.equal(r.result, 1);
    assert.match(r.out, /Going back to bookings@0\.1\.0 is refused\. bookings@0\.2\.0 changed how this client's saved data is laid out \(layout 1 to 2\), and bookings@0\.1\.0 cannot read it/);
    assert.match(r.out, /geometer restore glow-salon --at <time>/);
    assert.equal(pin(w, "glow-salon"), "bookings@0.2.0");
    assert.deepEqual(composeCalls(w), []);
    assert.deepEqual(loadState(w.root).shops["glow-salon"].lockHistory, ["bookings@0.1.0\n"], "and the pin before is still there");
  } finally { w.done(); }
});

// ---- the whole thing with the real hand check -----------------------------------------------------------------------------------------------

test("with a real fault in the new version that only a client with a 48-hour cancellation window meets, the real hand check holds that client back and moves the other", async () => {
  const w = world({ "glow-salon": panelRuntime(), "bright-tuition": panelRuntime() }); try {
    for (const s of ["glow-salon", "bright-tuition"]) w.handIn(s);
    setSettings(w, "bright-tuition", (x) => { x.name = "Bright Tuition"; x.cancellation.windowHours = 48; });
    await deploy(w.ctx);
    addVersion(w, "0.2.0");
    // version 0.2.0 is the pathway with one line changed: a window of more than 24 hours is counted a hundred times too long, so nobody is ever "inside" it
    const file = join(w.root, "templates", "commerce", "bookings@0.2.0", "src", "agent.ts");
    const line = "const inWindow = hoursLeft >= settings.cancellation.windowHours;";
    const text = readFileSync(file, "utf8");
    assert.equal(text.split(line).length, 2, "the line this test changes in its copy of the pathway has moved: pick another line that depends on a setting");
    writeFileSync(file, text.replace(line, "const inWindow = hoursLeft >= settings.cancellation.windowHours * (settings.cancellation.windowHours > 24 ? 100 : 1);"));
    const next = w.ctx.runner.run.bind(w.ctx.runner);
    w.ctx.runner.run = (command, args, options) => (command === process.execPath ? realRunner.run(command, args, options) : next(command, args, options));
    const r = await update(w, "--to", "0.2.0");
    assert.equal(r.result, 1, r.out + r.err);
    assert.deepEqual([pin(w, "glow-salon"), pin(w, "bright-tuition")], ["bookings@0.2.0", "bookings@0.1.0"]);
    const held = loadState(w.root).update!.steps["bright-tuition"];
    assert.ok(held.before && held.after && held.after.held < held.before.held && held.before.held === held.before.of, JSON.stringify([held.before, held.after]));
    assert.ok(held.failing!.length > 0 && held.failing!.every((f) => f.title.length > 3 && f.why.length > 3), JSON.stringify(held.failing));
    assert.match(r.out, /HELD BACK\. Held \d+ of \d+ at bookings@0\.2\.0; \d+ of \d+ held at bookings@0\.1\.0\. Now failing: /);
    assert.equal(loadState(w.root).update!.steps["glow-salon"].after!.held, loadState(w.root).update!.steps["glow-salon"].after!.of, "the client with a 24-hour window holds everything at the new version");
  } finally { w.done(); }
});

test("with the real hand check at both versions, on each client's own settings, two clients that hold everything move", async () => {
  const w = world({ "glow-salon": panelRuntime(), "bright-tuition": panelRuntime() }); try {
    for (const s of ["glow-salon", "bright-tuition"]) w.handIn(s);
    setSettings(w, "bright-tuition", (x) => { x.name = "Bright Tuition"; x.languages = ["en", "hi"]; });
    await deploy(w.ctx);
    addVersion(w, "0.2.0");
    const next = w.ctx.runner.run.bind(w.ctx.runner);
    w.ctx.runner.run = (command, args, options) => (command === process.execPath ? realRunner.run(command, args, options) : next(command, args, options));
    const r = await update(w, "--to", "0.2.0");
    assert.equal(r.result, 0, r.out + r.err);
    assert.deepEqual(["glow-salon", "bright-tuition"].map((s) => pin(w, s)), ["bookings@0.2.0", "bookings@0.2.0"]);
    const step = loadState(w.root).update!.steps["bright-tuition"];
    assert.ok(step.after && step.after.held === step.after.of && step.after.of > 20, JSON.stringify(step));
    assert.ok(step.layout && step.layout.from > 0 && step.layout.from === step.layout.to, "the real runtime's saved-data layout was asked of both versions");
    const glow = loadState(w.root).update!.steps["glow-salon"];
    assert.ok(glow.after!.of > step.after!.of, "bright-tuition speaks fewer languages, so it has fewer situations: each client's own count");
  } finally { w.done(); }
});
