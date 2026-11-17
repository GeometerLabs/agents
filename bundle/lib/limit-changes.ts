// The deployer's part of "limits, tightened by a tap" (17 Nov 2026; bundle/Explanation.md). On every pass of its loop the deployer asks each shop's runtime (through ops)
// for the limit changes the owner made that are still Pending, and carries ONE at a time per shop to the end:
//   1. check it again against the settings FILE (not against the words, and not against the runtime's own view): a tightening must be strictly tighter than the file,
//      a loosening strictly looser and inside the template's hard bounds, and the whole file must still be valid settings;
//   2. write that one number into shops/<shop>/settings.json (the file Guard's spec and the runtime's config are made from; the old text is kept beside the journal);
//   3. deploy the shop: the checked deploy makes Guard's spec again from the file, restarts that shop's Guard, and reads each running Guard's policy digest back;
//   4. read the limit back: the running Guards' digests are the ones that were compiled, and the restarted runtime reports the new value from the file;
//   5. tell the runtime "active", or, on any failure, put the file back and tell it "failed" with the reason in plain words. The runtime then drops its tighter value and
//      tells the owner the previous limit is still in force.
// Nothing here waits for the Operator, and nothing here decides a limit: it only carries out what the runtime recorded and the owner tapped or signed in with a passkey.
//
// It survives a restart of the deployer anywhere in the middle: a small journal per change (state/limit-changes/<shop>/<id>.json) says how far it got, every step is safe
// to do again (a number already in the file is not written twice; the runtime ignores a second "active"), and the runtime's own Pending state is the queue.
//
// What Guard cannot report: Guard's /admin/status carries its policy DIGEST, not the numbers inside it. So "read back" here is the digest of the running spec (made from
// the new file) plus the runtime's own report of the file's value. Guard reporting the limit values themselves is listed in bundle/Deferred.md.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { applyChanges, getPath } from "./limits-draft.ts";
import { isStrictlyTighter, limitNamed, withinBounds } from "../../modules/limits/chat-limits.ts";
import type { ChatLimit, LimitChange } from "../../modules/limits/chat-limits.ts";
import type { LimitsView } from "../../modules/limits/runtime-limits.ts";
import { kindFor } from "./kinds.ts";
import type { Kind } from "./kinds.ts";
import { serverPaths } from "./server.ts";
import { loadState } from "./state.ts";
import { updateStatus } from "./status.ts";
import { writeAtomic } from "./util.ts";

/** How many 10-second passes a restarted runtime is waited for before the change is given up as failed (five minutes). */
export const MOST_WAITS = 30;

/** Everything the deployer does to the outside, so the tests run all of this on fakes. */
export interface LimitIO {
  /** The runtime's limits and changes (ops "limits"), or undefined when it does not answer. */
  read(shop: string): Promise<LimitsView | undefined>;
  /** The deployer's word to the runtime; true when the runtime took it (HTTP 200). `requestId` is the same for the same word, so a repeat is one. */
  settle(shop: string, requestId: string, change: string, result: "active" | "failed", why?: string): Promise<boolean>;
  /** The checked deploy of this shop (throws when it is refused or fails). */
  deploy(shop: string): Promise<void>;
  /** Do the shop's running Guards report the policy digests that were compiled? */
  guardsMatch(shop: string): Promise<{ ok: true } | { ok: false; why: string }>;
}

export interface LimitContext { dir: string; now: () => Date; log: (line: string) => void }

interface Journal {
  change: string; limit: string; from: number; to: number; direction: "tighten" | "loosen"; startedAt: string; waits: number;
  phase: "writing" | "written" | "deployed";
  /** Set when the change was given up but the runtime could not be told yet: the next pass only tells it. */
  failed?: string;
}

const journalDir = (dir: string, shop: string): string => join(serverPaths(dir).state, "limit-changes", shop);
const journalFile = (dir: string, shop: string, id: string): string => join(journalDir(dir, shop), `${id}.json`);
const readJournal = (dir: string, shop: string, id: string): Journal | undefined => { try { return JSON.parse(readFileSync(journalFile(dir, shop, id), "utf8")) as Journal; } catch { return undefined; } };
const writeJournal = (dir: string, shop: string, j: Journal): void => { mkdirSync(journalDir(dir, shop), { recursive: true }); writeAtomic(journalFile(dir, shop, j.change), `${JSON.stringify(j, null, 2)}\n`, 0o600); };
const settingsPath = (dir: string, shop: string): string => join(serverPaths(dir).shop(shop), "settings.json");
const readText = (path: string): string | undefined => { try { return readFileSync(path, "utf8"); } catch { return undefined; } };

/** The number of a change id ("l-12" is 12), so the oldest is taken first. */
const order = (c: LimitChange): number => Number(c.id.slice(2));

/** The settings file with one limit's number set (a path already there; nothing else changes), as text. */
function withValue(text: string, path: string, value: number): { ok: true; text: string; settings: unknown } | { ok: false; why: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, why: "the settings file could not be read" }; }
  const r = applyChanges(parsed, [{ path, value }]);
  return r.ok ? { ok: true, text: `${JSON.stringify(r.settings, null, 2)}\n`, settings: r.settings } : { ok: false, why: r.problem };
}

/** Keep the panel's list of changes and their states in step with what the runtime holds (status/<shop>.json, `limitChanges`): a change is shown from the moment it is Pending. */
function showChanges(ctx: LimitContext, shop: string, view: LimitsView): void {
  const rows = view.changes.slice(-30).map((c) => ({ id: c.id, limit: c.limit, from: c.from, to: c.to, direction: c.direction, by: c.by, state: c.state, at: new Date(c.atMs).toISOString(), ...(c.why ? { why: c.why } : {}) }));
  updateStatus(ctx.dir, shop, ctx.now(), (s) => { if (JSON.stringify(s.limitChanges ?? []) !== JSON.stringify(rows)) s.limitChanges = rows; }, false);
}

/**
 * One pass for one shop: take the oldest Pending change as far as it will go. Returns the lines for the deployer's log. Safe to call again at any point.
 */
export async function limitStep(ctx: LimitContext, io: LimitIO, shop: string, kind: Kind): Promise<string[]> {
  const lines: string[] = [];
  const view = await io.read(shop);
  if (!view) return lines; // the runtime is not answering: nothing is changed, and the change stays Pending
  if (view.changes.length > 0) showChanges(ctx, shop, view);
  // a journal whose change the runtime has settled is finished: it is removed
  for (const f of existsSync(journalDir(ctx.dir, shop)) ? readdirSync(journalDir(ctx.dir, shop)) : []) {
    const id = f.replace(/\.json$/u, "");
    if (!view.changes.some((c) => c.id === id && c.state === "pending")) rmSync(join(journalDir(ctx.dir, shop), f), { force: true });
  }
  const c = view.changes.filter((x) => x.state === "pending").sort((a, b) => order(a) - order(b))[0];
  if (!c) return lines;
  const limit: ChatLimit | undefined = limitNamed(kind.chatLimits, c.limit);

  /** End the change as failed: the file goes back to the previous number if it was written, then the runtime is told (and tells the owner the previous limit stands). */
  const fail = async (why: string, restore: boolean): Promise<void> => {
    if (restore && limit) {
      const now = readText(settingsPath(ctx.dir, shop));
      // the number the file held before THIS change wrote it (its own copy), not the change's `from`, which can be a pending tightening that never reached the file
      const beforeText = readText(join(journalDir(ctx.dir, shop), `${c.id}.settings.before.json`));
      let held: unknown;
      try { held = beforeText === undefined ? undefined : getPath(JSON.parse(beforeText), limit.path); } catch { held = undefined; }
      const back = now === undefined ? undefined : withValue(now, limit.path, typeof held === "number" ? held : c.from);
      if (back?.ok && back.text !== now) writeAtomic(settingsPath(ctx.dir, shop), back.text); // the normal pass then deploys the old file again if a deploy had taken the new one
    }
    const told = await io.settle(shop, `${shop}-${c.id}-failed`, c.id, "failed", why);
    lines.push(`${shop}: the limit change ${c.id} (${c.limit} ${c.from} to ${c.to}) failed: ${why}. The previous limit is still in force.${told ? "" : " The runtime could not be told yet; it will be tried again."}`);
    if (told) rmSync(journalFile(ctx.dir, shop, c.id), { force: true });
    else { const j = readJournal(ctx.dir, shop, c.id); if (j) writeJournal(ctx.dir, shop, { ...j, failed: why }); }
  };

  if (!limit || limit.path !== c.path) { await fail("that is not a limit the owner may change", false); return lines; }

  let journal = readJournal(ctx.dir, shop, c.id);
  if (journal?.failed) { await fail(journal.failed, false); return lines; } // given up before; only the runtime was not told
  if (!journal) {
    const text = readText(settingsPath(ctx.dir, shop));
    if (text === undefined) { await fail("the shop's settings file could not be read", false); return lines; }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { await fail("the shop's settings file could not be read", false); return lines; }
    const fileNow = getPath(parsed, limit.path);
    if (typeof fileNow !== "number") { await fail("the settings file has no such limit", false); return lines; }
    // 1. the check again, against the FILE: the words and the runtime's own view are not the authority
    if (fileNow !== c.to) {
      const fine = c.direction === "tighten" ? isStrictlyTighter(limit, fileNow, c.to) : isStrictlyTighter(limit, c.to, fileNow) && withinBounds(limit, parsed, c.to);
      if (!fine) { await fail(c.direction === "tighten" ? `the settings already hold ${fileNow}, which is as tight or tighter` : `${c.to} is not a looser value inside this template's bounds`, false); return lines; }
      const next = withValue(text, limit.path, c.to);
      if (!next.ok) { await fail(next.why, false); return lines; }
      const checked = kind.validateSettings(next.settings);
      if (!checked.ok) { await fail(`the settings would no longer be valid (${checked.errors[0] ?? "see the panel"})`, false); return lines; }
      // 2. the journal first (with the old file kept beside it), then the file: a stop between the two is picked up again by the same steps
      mkdirSync(journalDir(ctx.dir, shop), { recursive: true });
      writeAtomic(join(journalDir(ctx.dir, shop), `${c.id}.settings.before.json`), text, 0o600);
      journal = { change: c.id, limit: c.limit, from: c.from, to: c.to, direction: c.direction, startedAt: ctx.now().toISOString(), waits: 0, phase: "writing" };
      writeJournal(ctx.dir, shop, journal);
      writeAtomic(settingsPath(ctx.dir, shop), next.text);
    } else {
      journal = { change: c.id, limit: c.limit, from: c.from, to: c.to, direction: c.direction, startedAt: ctx.now().toISOString(), waits: 0, phase: "written" };
    }
    journal.phase = "written";
    writeJournal(ctx.dir, shop, journal);
    lines.push(`${shop}: ${c.limit} is ${c.to} in the settings file now (it was ${c.from}); the old file is kept in state/limit-changes/${shop}/.`);
  }

  if (journal.phase === "writing") {
    // the deployer stopped between its journal and its write: write now, if the file does not hold the number yet
    const text = readText(settingsPath(ctx.dir, shop));
    const next = text === undefined ? undefined : withValue(text, limit.path, c.to);
    if (!next?.ok) { await fail("the settings file could not be written", true); return lines; }
    if (next.text !== text) writeAtomic(settingsPath(ctx.dir, shop), next.text);
    journal.phase = "written";
    writeJournal(ctx.dir, shop, journal);
  }

  if (journal.phase === "written") {
    // 3. the checked deploy: Guard's spec again from the file, that shop's Guard restarted, the running digests read back
    try { await io.deploy(shop); } catch (e) {
      const why = (e as { problems?: { message: string }[] }).problems?.[0]?.message ?? (e as Error).message;
      await fail(`the deploy did not go through (${why.slice(0, 120)})`, true);
      return lines;
    }
    journal.phase = "deployed";
    writeJournal(ctx.dir, shop, journal);
    lines.push(`${shop}: deployed with ${c.limit} ${c.to}; waiting for Guard and the runtime to report it.`);
  }

  // 4. the read-back: the running Guards hold the policy that was compiled, and the restarted runtime reads the new number from the file
  const guards = await io.guardsMatch(shop);
  if (!guards.ok) { await fail(guards.why, true); return lines; }
  const after = await io.read(shop); // fresh: the runtime was restarted by the deploy
  if (after?.limits.find((l) => l.id === c.limit)?.file !== c.to) {
    journal.waits += 1;
    if (journal.waits > MOST_WAITS) { await fail("the shop's runtime did not report the new value in time", true); return lines; }
    writeJournal(ctx.dir, shop, journal);
    return lines; // not restarted yet: the next pass looks again
  }
  // 5. Guard and the runtime both have it
  const told = await io.settle(shop, `${shop}-${c.id}-active`, c.id, "active");
  if (told) {
    rmSync(journalFile(ctx.dir, shop, c.id), { force: true });
    lines.push(`${shop}: the limit change ${c.id} is Active (${c.limit} ${c.from} to ${c.to}).`);
  }
  return lines;
}

/** One pass over every deployed shop whose template has limits the owner may change. One change at a time per shop; a shop that fails does not stop the others. */
export async function syncLimitChanges(ctx: LimitContext, io: LimitIO, shops: readonly string[]): Promise<string[]> {
  const lines: string[] = [];
  const state = loadState(ctx.dir);
  for (const shop of shops) {
    const kind = kindFor(state.shops[shop]?.applied?.pathway.split("@")[0]);
    if (!kind || kind.chatLimits.length === 0) continue;
    try { lines.push(...await limitStep(ctx, io, shop, kind)); } catch (e) { lines.push(`${shop}: the limit changes could not be looked at (${(e as Error).message}).`); }
  }
  lines.forEach((l) => ctx.log(l));
  return lines;
}
