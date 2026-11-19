// The CONTRACT of the owner's morning line in a listings-only shop (modules/assistant/morning.ts, run on the beat as modules/runtime/core.ts `daily`) and the licence's final stop that
// gates it (modules/licence/rules.ts, client/licence.json): with push on, a phone with alerts on and something waiting for the owner, one line a day goes to the phone in the
// owner's language, claimed in the record before it goes and ended after; never twice; never in the final stop; silent with nothing to say. Run on a TypeScript shop and a Go shop
// at the same time and compared, over HTTP, the push Guard's calls (opened with the phone's own key) and the shops' files.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { REPO, draftAnswer, makeShop, startFakeModel } from "./harness.ts";
import type { FakeModel, Shop } from "./harness.ts";
import { enablePush, softBrowser, startFakeGuard } from "./push-harness.ts";
import type { FakeGuard } from "./push-harness.ts";

const shops: Shop[] = [];
const others: { close(): Promise<void> }[] = [];
after(async () => { for (const s of shops) { await s.stop(); s.cleanup(); } for (const o of others) await o.close(); });

const GO_BIN = process.env.LISTINGS_GO_BIN ?? join(REPO, "go", "bin", "listings");
// the morning hour is set a minute before now, in India: a run in the first minutes after midnight there would put it on yesterday
const india = new Date(Date.now() + 330 * 60_000);
const nearMidnight = india.getUTCHours() === 0 && india.getUTCMinutes() < 3;
const BOTH = { skip: (!existsSync(GO_BIN) && "there is no Go binary (LISTINGS_GO_BIN or go/bin/listings), so the two runtimes cannot be compared") || (nearMidnight && "the morning hour would fall on yesterday in the first minutes after midnight in India") };
const at = (): string => { const t = new Date(Date.now() + 330 * 60_000 - 60_000); return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`; };

function record(s: Shop): any[] {
  const db = new DatabaseSync(join(s.dataDir, "agent.db"), { readOnly: true });
  try { return db.prepare("select entry from record order by seq").all().map((r: any) => JSON.parse(r.entry)); } finally { db.close(); }
}

/** A shop with push on, a phone subscribed with the owner's link, and (unless `quiet`) a drafted listing's card waiting for the owner; the beat every second. */
async function morningShop(impl: "ts" | "go", o: { language?: "en" | "hi" | "ml" | "kn"; quiet?: boolean; licence?: unknown; personality?: string }): Promise<{ s: Shop; guard: FakeGuard; open: (c: any) => any }> {
  const fake: FakeModel = await startFakeModel(() => draftAnswer()); others.push(fake);
  const guard = await startFakeGuard(); others.push(guard);
  const s = await makeShop({ modelPort: fake.port, budget: { monthlyMicroInr: 50_000_000, daily: { listing_draft: 20 } }, ownerLanguage: o.language ?? "en", assistant: { morning: { at: at() }, ...(o.personality ? { character: { personality: o.personality } } : {}) } });
  shops.push(s);
  enablePush(s, guard);
  if (o.licence) writeFileSync(join(s.client, "licence.json"), JSON.stringify(o.licence));
  await s.start(impl);
  const b = softBrowser();
  const sub = await s.call("/internal/channel/push", { owner: s.owner, body: { op: "owner_subscribe", subscription: b.subscription } });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  if (!o.quiet) {
    const r = await s.call("/internal/channel/events", { owner: s.owner, body: { events: [{ kind: "owner_message", id: "m-1", text: "I have two Persian kittens for sale on my page, 8000 rupees" }] } });
    assert.equal(r.status, 200); await s.settle();
  }
  return { s, guard, open: (c) => b.open(c) };
}

/** Run the beat for a few seconds (a tick a second) and see what the morning line did. */
async function morningOf(impl: "ts" | "go", s: Shop, guard: FakeGuard, open: (c: any) => any): Promise<any> {
  s.setTickSeconds(1); enablePush(s, guard); await s.stop(); await s.start(impl); // setTickSeconds writes runtime.json from the harness's copy, which has no push Guard
  for (let i = 0; i < 40 && !record(s).some((e) => e.action === "send_message" && e.refs.morning && e.outcome !== "attempted"); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 1500)); // more beats: nothing is sent twice
  const lines = record(s).filter((e) => e.action === "send_message" && e.refs.morning).map((e) => [e.outcome, { ...e.refs, ...(e.refs.messageId ? { messageId: "m-" } : {}) }, e.notes ?? "", e.language]);
  const pushes = guard.calls.map((c) => open(c.call)).filter((p) => p.tag === "owner");
  return { lines, pushes };
}

describe("the owner's morning line", () => {
  for (const [language, personality] of [["en", "warm"], ["hi", "cheerful"], ["ml", "brief"], ["kn", "warm"]] as const) {
    test(`one line a day to the owner's phone, in ${language}, claimed before it goes; the same on both runtimes`, BOTH, async () => {
      const seen: Record<string, any> = {};
      await Promise.all((["ts", "go"] as const).map(async (impl) => {
        const { s, guard, open } = await morningShop(impl, { language, personality });
        seen[impl] = await morningOf(impl, s, guard, open);
      }));
      assert.deepEqual(seen.go, seen.ts);
      assert.deepEqual(seen.ts.lines.map((l: any) => l[0]), ["attempted", "confirmed"]);
      assert.equal(seen.ts.pushes.length, 1);
      assert.ok(seen.ts.pushes[0].body.includes("Glow Pets"), seen.ts.pushes[0].body);
    });
  }

  test("silent with nothing to say, and never in the licence's final stop", BOTH, async () => {
    const stopped = { schema: 1, shop: { id: "glow-pets", plan: "basic", state: "stopped", paid_through: 1_700_000_000, grace_days: 30, expires: 1_700_000_000, stop_at: 1_700_000_000, export_until: 1_800_000_000, notice: "stop" }, newest_issued_at: 1_700_000_000, extension_until: 0, partner: "Divya" };
    const seen: Record<string, any> = {};
    await Promise.all((["ts", "go"] as const).map(async (impl) => {
      const quiet = await morningShop(impl, { quiet: true });
      const stop = await morningShop(impl, { licence: stopped });
      seen[impl] = { quiet: await morningOf(impl, quiet.s, quiet.guard, quiet.open), stopped: await morningOf(impl, stop.s, stop.guard, stop.open) };
    }));
    assert.deepEqual(seen.go, seen.ts);
    assert.deepEqual(seen.ts.quiet, { lines: [], pushes: [] });
    assert.deepEqual(seen.ts.stopped, { lines: [], pushes: [] });
  });
});

// Voice (modules/voice, modules/runtime/http.ts): a listings-only shop has no voice service for its assistant and no chat, so the owner's page shows no record button (`listen`
// false) and both voice routes say voice is off, after the method and, for the owner's, the owner's credential. Nothing is held or saved.
describe("voice, as a listings-only shop has it: off", () => {
  test("the voice routes answer as TypeScript's do, the same on both runtimes; nothing is saved", BOTH, async () => {
    const seen: Record<string, any> = {};
    for (const impl of ["ts", "go"] as const) {
      const s = await makeShop({}); shops.push(s); await s.start(impl);
      const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3]);
      const calls = [
        await s.call("/internal/channel/owner-voice", { raw: ogg, type: "audio/ogg" }),
        await s.call("/internal/channel/owner-voice", { owner: "not-the-link", raw: ogg, type: "audio/ogg" }),
        await s.call("/internal/channel/owner-voice", { owner: s.owner, raw: ogg, type: "audio/ogg" }),
        await s.call("/internal/channel/owner-voice", { owner: s.owner, method: "GET" }),
        await s.call("/internal/channel/owner-voice", { token: null, owner: s.owner, raw: ogg, type: "audio/ogg" }),
        await s.call("/internal/channel/chat-voice?handle=" + "a".repeat(64) + "&lang=en&id=x", { raw: ogg, type: "audio/ogg" }),
        await s.call("/internal/channel/chat-voice", { method: "GET" }),
      ];
      seen[impl] = { calls: calls.map((c) => [c.status, c.body]), listen: (await s.call("/internal/channel/owner", { owner: s.owner })).body.app.listen, status: (await s.settle()).tasks };
    }
    assert.deepEqual(seen.go, seen.ts);
    assert.equal(seen.ts.listen, false);
    assert.deepEqual(seen.ts.calls[2], [404, { error: "Voice is not on for this shop's assistant." }]);
  });
});
