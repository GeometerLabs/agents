// Update every client at once, and put them back.
//
//   geometer update [--to <version>] [--shops a,b] [--dry-run]
//   geometer rollback [--shops a,b]            (or: rollback <shop>)
//
// A client's version is its pin: shops/<shop>/pathway.lock, a line like `bookings@0.1.0`. The pins before it are the shop's `lockHistory` in state/state.json, and
// this file reuses both. An update takes the clients one at a time, in order:
//
//   1. run the template's hand check on THIS client's own settings at the version it runs now, and again at the new version
//   2. a client that holds everything it held before moves: write the new pin, then the same checked deploy as `geometer deploy` (only what changed is restarted)
//   3. a client with any situation that held before and fails now (or is not run now) is held back, on the version it runs, with the situation names and the first failed check
//
// Every step is written to state/state.json (`update`, `rollback`). "moving" is written before a pin is touched, so a run that was stopped in the middle carries on from
// where it stopped when the same command is run again: clients that are done are not checked or deployed a second time, and the one that was half-way is finished.
// A deploy that is refused puts that client's earlier pin back and stops the rollout there (one client at most is affected); the rest wait for the next run.
// Agents someone else wrote have no template and no hand check yet: they are skipped, with a plain note.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listAgents } from "./agent/folder.ts";
import { updateAgent } from "./agent/update.ts";
import { Refused, deploy } from "./deploy.ts";
import type { Context } from "./deploy.ts";
import { compare, runHandCheck, savedDataLayout } from "./handcheck.ts";
import { pathwayDirFor } from "./lib/pathways.ts";
import { listShops, readShop, serverPaths } from "./lib/server.ts";
import { loadState, saveState } from "./lib/state.ts";
import type { Run, State, Step } from "./lib/state.ts";
import { writeAtomic } from "./lib/util.ts";

export interface UpdateOptions { to?: string; shops?: string[]; dryRun?: boolean }
export interface RollbackOptions { shops?: string[]; dryRun?: boolean }

type Save = (step: Step) => void;
type Outcome = { step: Step; halt?: string };

const VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.]+)?$/u;
const pinLine = (lockText: string): string => lockText.split("\n").map((l) => l.trim()).find((l) => l !== "" && !l.startsWith("#")) ?? "";
const versionOfPin = (pin: string): string => pin.split("@")[1] ?? "";
const lockFile = (ctx: Context, shop: string): string => join(serverPaths(ctx.dir).shop(shop), "pathway.lock");
const currentPin = (ctx: Context, shop: string): string => { try { return pinLine(readFileSync(lockFile(ctx, shop), "utf8")); } catch { return ""; } };
const counts = (r: { held: number; total: number }) => ({ held: r.held, of: r.total });

/** Below zero when version a is older than b, above zero when newer (the numbers first; a pre-release is older than its release). */
function compareVersions(a: string, b: string): number {
  const [coreA, ...preA] = a.split("-"); const [coreB, ...preB] = b.split("-");
  const [x, y] = [coreA.split(".").map(Number), coreB.split(".").map(Number)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  if (preA.length === 0 || preB.length === 0) return preB.length - preA.length;
  return preA.join("-") < preB.join("-") ? -1 : preA.join("-") > preB.join("-") ? 1 : 0;
}

/** The version of a template this server's checkout has: what `update` moves clients to when no version is given. */
function checkoutVersion(ctx: Context, pathway: string): string | undefined {
  try { return (JSON.parse(readFileSync(join(ctx.appDir, "pathways", pathway, "package.json"), "utf8")) as { version?: string }).version; } catch { return undefined; }
}

/** Change the state file: read it fresh, change one thing, write it. Never hold a State across a deploy, which reads and writes the same file. */
function change(ctx: Context, edit: (s: State) => void): void {
  const state = loadState(ctx.dir);
  edit(state);
  saveState(ctx.dir, state);
}

// ---- the walk: one client after another, each step written down -------------------------------------------------------------------------------

function start(ctx: Context, kind: Run["kind"], request: Run["request"], shops: string[], dryRun: boolean): Run {
  const last = loadState(ctx.dir)[kind];
  // the same command again after a stop carries on with the run that was stopped; a finished run, or another request, starts a new one
  // (the state file keeps keys sorted, so the two requests are compared field by field, not as text)
  if (last && !last.finishedAt && !dryRun && last.request.to === request.to && JSON.stringify(last.request.shops) === JSON.stringify(request.shops)) return last;
  return { kind, startedAt: ctx.now().toISOString(), request, shops, steps: {} };
}

async function walk(ctx: Context, run: Run, dryRun: boolean, one: (shop: string, earlier: Step | undefined, save: Save) => Promise<Outcome>): Promise<Run> {
  delete run.stoppedBecause;
  const persist = () => { if (!dryRun) change(ctx, (s) => { s[run.kind] = run; }); };
  for (const shop of run.shops) {
    const earlier = run.steps[shop];
    if (earlier && earlier.status !== "moving") continue; // done in the run that was stopped: not checked or deployed again
    const save: Save = (step) => { run.steps[shop] = step; persist(); };
    const outcome = await one(shop, earlier, save);
    save(outcome.step);
    if (outcome.halt) { run.stoppedBecause = outcome.halt; break; }
  }
  if (run.shops.every((s) => run.steps[s] && run.steps[s].status !== "moving")) run.finishedAt = ctx.now().toISOString();
  persist();
  return run;
}

/** Shop and agent names the command was given, checked against the server, in the order given. */
function named(ctx: Context, asked: string[]): string[] {
  const known = new Set([...listShops(ctx.dir), ...listAgents(ctx.dir)]);
  const unknown = asked.filter((n) => !known.has(n));
  if (unknown.length > 0) throw new Error(`There is no shop called ${unknown.join(", ")} on this server. Shops here: ${[...known].sort().join(", ") || "none yet"}.`);
  return [...new Set(asked)];
}

// ---- update ----------------------------------------------------------------------------------------------------------------------------------------

export async function runUpdate(ctx: Context, opts: UpdateOptions = {}): Promise<Run> {
  if (opts.to !== undefined && !VERSION.test(opts.to)) throw new Error(`"${opts.to}" is not a version. Say it like 0.2.0.`);
  const names = opts.shops ? named(ctx, opts.shops) : [...listShops(ctx.dir), ...listAgents(ctx.dir)];
  if (names.length === 0) throw new Error("There are no shops yet. Add one with `geometer shop add <name> --from <client folder>`.");
  const dryRun = opts.dryRun === true;
  const run = start(ctx, "update", { to: opts.to ?? null, shops: opts.shops ? names : null }, names, dryRun);
  if (dryRun) run.dryRun = true;
  return walk(ctx, run, dryRun, (shop, earlier, save) => updateOne(ctx, shop, opts, earlier, save));
}

async function updateOne(ctx: Context, shop: string, opts: UpdateOptions, earlier: Step | undefined, save: Save): Promise<Outcome> {
  const at = ctx.now().toISOString();
  const heldBack = (reason: string, more: Partial<Step> = {}): Outcome => ({ step: { status: "held-back", at, reason, ...more } });
  // an agent someone else wrote: the crash test at the version it was last checked at and at the one in agent.json (agent/update.ts), not a deploy
  if (listAgents(ctx.dir).includes(shop)) return { step: await updateAgent(ctx, shop, opts.dryRun === true) };
  if (earlier?.status === "moving") return finishMove(ctx, shop, earlier, "update");

  const folder = readShop(ctx.dir, shop);
  if (!folder.settings || !folder.lock) return heldBack(`Its folder cannot be read, so it cannot be checked: ${folder.problems.filter((p) => !/^(runtime|pins)\.json/u.test(p)).join(" ")}`);
  const applied = loadState(ctx.dir).shops[shop]?.applied;
  if (!applied) return { step: { status: "skipped", at, reason: "It has not been deployed yet, so nothing is running to update. Its first deploy uses its pin as it is (pathway.lock); change the pin before then if you want another version." } };

  const pathway = folder.lock.pathway;
  const running = applied.pathway;
  const pin = `${pathway}@${folder.lock.version}`;
  if (pin !== running) return heldBack(`Its pin says ${pin} but ${running} is what runs, so an earlier change did not finish. Run \`geometer deploy ${shop}\` first, then update.`, { from: running });
  const target = opts.to ?? checkoutVersion(ctx, pathway);
  if (!target) return heldBack(`This server's checkout of ${pathway} has no version to move to. Say which: --to <version>.`, { from: running });
  const to = `${pathway}@${target}`;
  if (to === running) return { step: { status: "unchanged", at, from: running, to, reason: `Already on ${to}.` } };
  // with no version named, the checkout's is where clients go; a client that already runs a newer one (put beside the server by hand) is left alone, never taken back
  if (opts.to === undefined && compareVersions(target, versionOfPin(running)) < 0) return { step: { status: "unchanged", at, from: running, reason: `It runs ${running}, which is newer than the ${to} in this checkout, so it is left as it is. Name a version with --to to move it anyway.` } };

  const toDir = pathwayDirFor(ctx.appDir, ctx.dir, { pathway, version: target });
  if (!toDir) return heldBack(`This server does not have ${to}. Put a checkout of it in ${join(serverPaths(ctx.dir).root, "pathways", `${pathway}@${target}`)}, then run this again. It stays on ${running}.`, { from: running, to });
  const fromDir = existsSync(applied.pathwayDir) ? applied.pathwayDir : pathwayDirFor(ctx.appDir, ctx.dir, { pathway, version: versionOfPin(running) });
  if (!fromDir) return heldBack(`This server no longer has ${running}, the version it runs, so there is nothing to compare ${to} with. It stays on ${running}.`, { from: running, to });

  // the hand check on this client's own settings: at the version it runs now, and at the new one
  ctx.log(`${shop}: running the hand check on its own settings at ${running} and at ${to}...`);
  const settingsFile = join(serverPaths(ctx.dir).shop(shop), "settings.json");
  const before = await runHandCheck(ctx, fromDir, settingsFile);
  if (!before.ok) return heldBack(`The hand check could not be run on its settings at ${running}, the version it runs now, so there is nothing to compare ${to} with (${before.reason}). It stays on ${running}.`, { from: running, to });
  const after = await runHandCheck(ctx, toDir, settingsFile);
  if (!after.ok) return heldBack(`The hand check could not be run on its settings at ${to} (${after.reason}). It stays on ${running}.`, { from: running, to, before: counts(before.read) });
  const diff = compare(before.read, after.read);
  const result = { from: running, to, before: counts(before.read), after: counts(after.read) };
  if (diff.failing.length > 0 || diff.notChecked.length > 0) {
    const said = [
      `Held ${after.read.held} of ${after.read.total} at ${to}; ${before.read.held} of ${before.read.total} held at ${running}.`,
      diff.failing.length > 0 ? `Now failing: ${diff.failing.map((f) => f.title).join("; ")}.` : "",
      diff.notChecked.length > 0 ? `No longer checked at ${to}: ${diff.notChecked.join("; ")}.` : "",
      `It stays on ${running}.`,
    ].filter(Boolean).join(" ");
    return heldBack(said, { ...result, failing: diff.failing, notChecked: diff.notChecked });
  }

  const layout = { from: await savedDataLayout(ctx, fromDir), to: await savedDataLayout(ctx, toDir) };
  const known = layout.from !== undefined && layout.to !== undefined ? { layout: { from: layout.from, to: layout.to } } : {};
  // a runtime cannot start on saved data written in a layout newer than it knows, so a move to a version that knows fewer is refused here as a rollback's is
  if (layout.from !== undefined && layout.to !== undefined && layout.from > layout.to) {
    return heldBack(`Moving to ${to} is refused. ${running} changed how this client's saved data is laid out (layout ${layout.to} to ${layout.from}), and ${to} cannot read it, so its runtime would not start. It stays on ${running}.`, { ...result, ...known });
  }
  if (opts.dryRun) return { step: { status: "moved", at, ...result, ...known } };

  // written BEFORE the pin is touched: if this stops now, the next run finishes this client and does not check it again
  const step: Step = { status: "moving", at, ...result, ...known, fromLock: folder.lockText, toLock: `${to}\n`, historyBefore: [...(loadState(ctx.dir).shops[shop]?.lockHistory ?? [])] };
  save(step);
  return finishMove(ctx, shop, step, "update");
}

// ---- rollback --------------------------------------------------------------------------------------------------------------------------------------

/**
 * The clients the last update left on the version it names, that have an earlier pin to go back to: the ones it moved, and the ones a repeat of it found already there (running
 * `update` again, to see a held-back client again, must not empty the list of what a rollback undoes).
 */
function lastMoved(ctx: Context): string[] {
  const state = loadState(ctx.dir);
  const run = state.update;
  const left = (s: string) => run?.steps[s]?.to !== undefined && run.steps[s].to === currentPin(ctx, s);
  return run ? run.shops.filter((s) => left(s) && (run.steps[s].status === "moved" || (run.steps[s].status === "unchanged" && (state.shops[s]?.lockHistory.length ?? 0) > 0))) : [];
}

export async function runRollback(ctx: Context, opts: RollbackOptions = {}): Promise<Run> {
  const state = loadState(ctx.dir);
  // with no names: the clients the last update moved, or (after a stop) the clients of the rollback that was stopped
  const carrying = !opts.shops && state.rollback && !state.rollback.finishedAt && state.rollback.request.shops === null ? state.rollback : undefined;
  const names = opts.shops ? named(ctx, opts.shops) : carrying ? carrying.shops : lastMoved(ctx);
  if (names.length === 0) throw new Error("There is nothing to roll back: the last update moved no client that is still on the version it moved it to. Say which shop: rollback <shop>, or --shops a,b.");
  // one shop asked for by name and nothing to go back to: said as an error, as `rollback <shop>` always has
  const [lone] = names;
  if (names.length === 1 && !listAgents(ctx.dir).includes(lone) && (state.shops[lone]?.lockHistory.length ?? 0) === 0 && state.rollback?.steps[lone]?.status !== "moving") throw new Error(`${lone} has no earlier pathway.lock to go back to.`);
  const dryRun = opts.dryRun === true;
  const run = start(ctx, "rollback", { to: null, shops: opts.shops ? names : null }, names, dryRun);
  if (dryRun) run.dryRun = true;
  return walk(ctx, run, dryRun, (shop, earlier, save) => rollbackOne(ctx, shop, dryRun, earlier, save));
}

async function rollbackOne(ctx: Context, shop: string, dryRun: boolean, earlier: Step | undefined, save: Save): Promise<Outcome> {
  const at = ctx.now().toISOString();
  const heldBack = (reason: string, more: Partial<Step> = {}): Outcome => ({ step: { status: "held-back", at, reason, ...more } });
  if (listAgents(ctx.dir).includes(shop)) return { step: { status: "skipped", at, reason: "Geometer does not run an agent you wrote, so there is nothing for it to roll back. Put the version you want back in service yourself, then `geometer agent set <name> --version <it>` and `geometer update`." } };
  if (earlier?.status === "moving") return finishMove(ctx, shop, earlier, "rollback");

  const folder = readShop(ctx.dir, shop);
  const state = loadState(ctx.dir);
  const history = state.shops[shop]?.lockHistory ?? [];
  const toLock = history.at(-1);
  if (toLock === undefined) return { step: { status: "skipped", at, reason: `${shop} has no earlier pathway.lock to go back to.` } };
  const applied = state.shops[shop]?.applied;
  const from = applied?.pathway ?? pinLine(folder.lockText);
  const to = pinLine(toLock);
  const pathway = to.split("@")[0];
  const toDir = pathwayDirFor(ctx.appDir, ctx.dir, { pathway, version: versionOfPin(to) });
  if (!toDir) return heldBack(`This server no longer has ${to}. Put a checkout of it in ${join(serverPaths(ctx.dir).root, "pathways", to)} to go back to it.`, { from, to });
  // a runtime cannot start on saved data written in a layout newer than it knows: going back across such a change is refused here, before anything is touched
  const layout = { from: applied ? await savedDataLayout(ctx, applied.pathwayDir) : undefined, to: await savedDataLayout(ctx, toDir) };
  const known = layout.from !== undefined && layout.to !== undefined ? { layout: { from: layout.from, to: layout.to } } : {};
  if (layout.from !== undefined && layout.to !== undefined && layout.from > layout.to) {
    return heldBack(`Going back to ${to} is refused. ${from} changed how this client's saved data is laid out (layout ${layout.to} to ${layout.from}), and ${to} cannot read it, so its runtime would not start. Nothing was changed. Either move forward to a version that fixes what went wrong, or put back the record from before the update with \`geometer restore ${shop} --at <time>\` (that loses what came in since).`, { from, to, ...known });
  }
  if (dryRun) return { step: { status: "moved", at, from, to, ...known } };
  const step: Step = { status: "moving", at, from, to, ...known, fromLock: folder.lockText, toLock, historyBefore: [...history] };
  save(step);
  return finishMove(ctx, shop, step, "rollback");
}

// ---- moving one client (shared) --------------------------------------------------------------------------------------------------------------------

/**
 * Put the new pin in place and run the checked deploy. It can be run again on a step that stopped half-way: the pin is written again, and a deploy of what is already applied
 * changes nothing. A rollback takes the pin it goes back to OFF the history (the deploy puts the version it leaves on the end, and that is taken off again once it has gone
 * through), so rolling back twice goes back twice, and a rollback is never a way to go forward without a check. A deploy that is refused puts the earlier pin back and stops
 * the rollout; any other failure leaves the step "moving", for the same command to finish.
 */
async function finishMove(ctx: Context, shop: string, step: Step, kind: Run["kind"]): Promise<Outcome> {
  const without = (): void => change(ctx, (s) => { if (s.shops[shop] && step.historyBefore) s.shops[shop].lockHistory = step.historyBefore.slice(0, -1); });
  if (kind === "rollback") without();
  writeAtomic(lockFile(ctx, shop), step.toLock!);
  try {
    const [result] = await deploy(ctx, shop);
    if (kind === "rollback") without();
    const { historyBefore: _kept, ...rest } = step;
    return { step: { ...rest, status: "moved", at: ctx.now().toISOString(), proven: result.proven.line } };
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    const why = e.problems.map((p) => `[${p.rule}] ${p.message}`).join(" ").slice(0, 700);
    const note = await putBack(ctx, shop, step);
    const { historyBefore: _dropped, ...rest } = step;
    return { step: { ...rest, status: "held-back", at: ctx.now().toISOString(), reason: `The deploy was refused: ${why} ${note}` }, halt: `${shop}: the deploy was refused` };
  }
}

/** After a refused deploy: the earlier pin and lock history back, and the earlier version started again if the refused one had already been brought up. Says what it did. */
async function putBack(ctx: Context, shop: string, step: Step): Promise<string> {
  writeAtomic(lockFile(ctx, shop), step.fromLock!);
  const applied = loadState(ctx.dir).shops[shop]?.applied;
  let said = `It stays on ${step.from}.`;
  if (applied && applied.lockText !== step.fromLock) {
    try { await deploy(ctx, shop); said = `${step.from} was started again.`; } catch (e) {
      said = `${step.from} could not be started again (${e instanceof Refused ? e.problems.map((p) => `[${p.rule}]`).join(" ") : (e as Error).message}): look at ${shop} now. If it was stopped by the check on the running Guards, \`geometer start ${shop}\` releases it once you have looked.`;
    }
  }
  change(ctx, (s) => { if (s.shops[shop] && step.historyBefore) s.shops[shop].lockHistory = step.historyBefore; });
  return said;
}

// ---- saying it -------------------------------------------------------------------------------------------------------------------------------------

/** The plain summary of a run, client by client. */
export function summary(run: Run): string {
  const dry = run.dryRun === true;
  const back = run.kind === "rollback";
  const lines: string[] = [];
  const total = { moved: 0, "held-back": 0, unchanged: 0, skipped: 0, waiting: 0 };
  lines.push(dry ? `Dry run: nothing was changed. This is what ${back ? "a rollback" : "an update"} would do.` : back ? "Rollback:" : "Update, each client checked on its own settings first:");
  const width = Math.max(...run.shops.map((s) => s.length));
  for (const shop of run.shops) {
    const s = run.steps[shop];
    const name = shop.padEnd(width);
    if (!s || s.status === "moving") {
      total.waiting++;
      lines.push(s ? `  … ${name}  stopped part-way from ${s.from} to ${s.to}. The same command again finishes it.` : `  . ${name}  not started yet.`);
      continue;
    }
    total[s.status]++;
    if (s.status === "moved") {
      const held = s.after ? ` Held ${s.after.held} of ${s.after.of} on its own settings${s.before ? ` (${s.before.held} of ${s.before.of} before)` : ""}.` : "";
      const said = back ? (dry ? `would go back to ${s.to} (now ${s.from}).` : `Back to ${s.to} (was ${s.from}).`) : `${dry ? "would move" : "moved"} from ${s.from} to ${s.to}.`;
      lines.push(`  ✓ ${name}  ${said}${held}${s.proven ? ` ${s.proven}.` : ""}`);
      if (s.layout && s.layout.to > s.layout.from) lines.push(`      Note: ${s.to} changes how saved data is laid out (layout ${s.layout.from} to ${s.layout.to}), so \`geometer rollback\` will refuse to go back across it.`);
    } else if (s.status === "held-back") {
      lines.push(`  ✗ ${name}  HELD BACK. ${s.reason ?? ""}`);
      for (const f of s.failing ?? []) lines.push(`      - ${f.title}${f.why ? `: ${f.why}` : ""}`);
    } else if (s.status === "unchanged") {
      lines.push(`  = ${name}  unchanged. ${s.reason ?? ""}`);
    } else {
      lines.push(`  - ${name}  skipped. ${s.reason ?? ""}`);
    }
  }
  lines.push("");
  const word = dry ? "Would move" : back ? "Moved back" : "Moved";
  lines.push(`${word} ${total.moved}, held back ${total["held-back"]}, unchanged ${total.unchanged}, skipped ${total.skipped}${total.waiting > 0 ? `, not finished ${total.waiting}` : ""}.`);
  if (run.stoppedBecause) lines.push(`Stopped after ${run.stoppedBecause}. The clients not started yet are taken when you run the same command again.`);
  else if (total.waiting > 0 && !dry) lines.push("The run did not finish. Run the same command again to carry on: clients that are done are not checked or deployed a second time.");
  const again = `geometer update${run.request.to ? ` --to ${run.request.to}` : ""}${run.request.shops ? ` --shops ${run.request.shops.join(",")}` : ""}`;
  if (total["held-back"] > 0 && !back) lines.push(`A held-back client keeps running the version it runs now. Fix what failed, or its settings, and run \`${again}\` again: it checks those clients again.`);
  if (total.moved > 0 && !back && !dry) lines.push("`geometer rollback` puts the clients this update moved back on their previous version, one command.");
  return lines.join("\n");
}

/** 0 when everything asked for is done (moved, unchanged or skipped); 1 when any client is held back or the run did not finish. */
export const exitCodeOf = (run: Run): number => (run.finishedAt && !Object.values(run.steps).some((s) => s.status === "held-back") ? 0 : 1);
