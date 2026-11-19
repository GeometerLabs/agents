// The CONTRACT of the owner's morning line in a listings-only shop (modules/assistant/morning.ts, run on the beat as modules/runtime/core.ts `daily`) and the licence's final stop that
// gates it (modules/licence/rules.ts, client/licence.json): with push on, a phone with alerts on and something waiting for the owner, one line a day goes to the phone in the
// owner's language, claimed in the record before it goes and ended after; never twice; never in the final stop; silent with nothing to say. What a shop did (its record's morning
// lines, the push Guard's calls opened with the phone's own key) is compared with the GOLDEN answers (golden.ts, golden/morning.contract.json): until 19 Nov 2026 a TypeScript shop
// and a Go shop ran at once and were compared; the TypeScript answers were recorded before its runtime was deleted (decision 61, wave 1b). Each golden test's shops run on the test
// clock at the recorded instant, so the morning hour, the day and the date in the line are the recorded ones.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { draftAnswer, makeShop, now, SKIP, startFakeModel } from "./harness.ts";
import type { FakeModel, Shop } from "./harness.ts";
import { enablePush, softBrowser, startFakeGuard } from "../../../../modules/test/contract/push-harness.ts";
import type { FakeGuard } from "../../../../modules/test/contract/push-harness.ts";
import { goldenFor } from "./golden.ts";

const shops: Shop[] = [];
const others: { close(): Promise<void> }[] = [];
after(async () => { for (const s of shops) { await s.stop(); s.cleanup(); } for (const o of others) await o.close(); });

const golden = goldenFor(import.meta.url);
// the morning hour is set a minute before the shop's now, in India (harness `now`: inside a golden test, the recorded instant; golden.ts never records near midnight, when it would
// fall on yesterday)
const at = (): string => { const t = new Date(now() + 330 * 60_000 - 60_000); return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`; };

function record(s: Shop): any[] {
  const db = new DatabaseSync(join(s.dataDir, "agent.db"), { readOnly: true });
  try { return db.prepare("select entry from record order by seq").all().map((r: any) => JSON.parse(r.entry)); } finally { db.close(); }
}

/** A shop with push on, a phone subscribed with the owner's link, and (unless `quiet`) a drafted listing's card waiting for the owner; the beat every second. */
async function morningShop(o: { language?: "en" | "hi" | "ml" | "kn"; quiet?: boolean; licence?: unknown; personality?: string }): Promise<{ s: Shop; guard: FakeGuard; open: (c: any) => any }> {
  const fake: FakeModel = await startFakeModel(() => draftAnswer()); others.push(fake);
  const guard = await startFakeGuard(); others.push(guard);
  const s = await makeShop({ modelPort: fake.port, budget: { monthlyMicroInr: 50_000_000, daily: { listing_draft: 20 } }, ownerLanguage: o.language ?? "en", assistant: { morning: { at: at() }, ...(o.personality ? { character: { personality: o.personality } } : {}) } });
  shops.push(s);
  enablePush(s, guard);
  if (o.licence) writeFileSync(join(s.client, "licence.json"), JSON.stringify(o.licence));
  await s.start();
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
async function morningOf(s: Shop, guard: FakeGuard, open: (c: any) => any): Promise<any> {
  s.setTickSeconds(1); enablePush(s, guard); await s.stop(); await s.start(); // setTickSeconds writes runtime.json from the harness's copy, which has no push Guard
  for (let i = 0; i < 40 && !record(s).some((e) => e.action === "send_message" && e.refs.morning && e.outcome !== "attempted"); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 1500)); // more beats: nothing is sent twice
  const lines = record(s).filter((e) => e.action === "send_message" && e.refs.morning).map((e) => [e.outcome, { ...e.refs, ...(e.refs.messageId ? { messageId: "m-" } : {}) }, e.notes ?? "", e.language]);
  const pushes = guard.calls.map((c) => open(c.call)).filter((p) => p.tag === "owner");
  return { lines, pushes };
}

describe("the owner's morning line", { skip: SKIP }, () => {
  for (const [language, personality] of [["en", "warm"], ["hi", "cheerful"], ["ml", "brief"], ["kn", "warm"]] as const) {
    test(`one line a day to the owner's phone, in ${language}, claimed before it goes; the golden words`, async () => {
      const seen = await golden(`the line in ${language}`, async () => {
        const { s, guard, open } = await morningShop({ language, personality });
        return morningOf(s, guard, open);
      });
      assert.deepEqual(seen.lines.map((l: any) => l[0]), ["attempted", "confirmed"]);
      assert.equal(seen.pushes.length, 1);
      assert.ok(seen.pushes[0].body.includes("Glow Pets"), seen.pushes[0].body);
    });
  }

  test("on the test clock: no phone, so the send fails and is tried again an hour later; the next day's line; nothing after the four hours", async () => {
    const IST = 330 * 60_000;
    /** Move the shop's clock to the next hh:mm in India. */
    const to = (s: Shop, hh: number, mm: number): void => {
      const now = s.now(); const d = new Date(now + IST);
      let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm) - IST;
      if (t <= now) t += 86_400_000;
      s.advance(t - now);
    };
    const draft = async (s: Shop, id: string) => {
      const r = await s.call("/internal/channel/events", { owner: s.owner, body: { events: [{ kind: "owner_message", id, text: `item ${id} for sale on my page, 450 rupees` }] } });
      assert.equal(r.status, 200); await s.settle();
    };
    const beats = () => new Promise((r) => setTimeout(r, 2500));
    const seen = await golden("on the test clock", async () => {
      const fake = await startFakeModel(() => draftAnswer()); others.push(fake);
      const guard = await startFakeGuard(); others.push(guard);
      const s = await makeShop({ clock: true, tickSeconds: 1, modelPort: fake.port, budget: { monthlyMicroInr: 50_000_000, daily: { listing_draft: 20 } }, assistant: { morning: { at: "09:00" } } });
      shops.push(s);
      enablePush(s, guard);
      to(s, 8, 30); // before the hour: nothing is due
      await s.start();
      await draft(s, "d-1");
      to(s, 9, 1); await beats(); // the hour: no phone has alerts on, so nothing goes ("failed")
      const b = softBrowser();
      assert.equal((await s.call("/internal/channel/push", { owner: s.owner, body: { op: "owner_subscribe", subscription: b.subscription } })).status, 200);
      s.advance(30 * 60_000); await beats(); // half an hour on: not tried again yet
      s.advance(31 * 60_000); await beats(); // an hour after the failure: tried again, and it goes
      s.advance(60 * 60_000); await beats(); // once a day: nothing more today
      to(s, 8, 45); await draft(s, "d-2"); // the next day, a new card before the hour
      to(s, 9, 5); await beats();          // the next day's line
      to(s, 13, 10); await draft(s, "d-3"); // the day after, a card, but only after the four hours
      await beats(); await beats();
      const lines = record(s).filter((e) => e.action === "send_message" && e.refs.morning).map((e) => [e.outcome, { ...e.refs, ...(e.refs.messageId ? { messageId: "m-" } : {}), morning: "day" }, e.notes ?? ""]);
      const days = [...new Set(record(s).filter((e) => e.action === "send_message" && e.refs.morning).map((e) => e.refs.morning))];
      return { lines, days: days.length, pushes: guard.calls.map((c) => b.open(c.call)).filter((p) => p.tag === "owner").map((p) => p.body.replace(/\d+ \w+:/u, "D:")) };
    });
    assert.deepEqual(seen.lines.map((l: any) => l[0]), ["attempted", "failed", "attempted", "confirmed", "attempted", "confirmed"]);
    assert.equal(seen.days, 2);
    assert.equal(seen.pushes.length, 2);
  });

  test("silent with nothing to say, and never in the licence's final stop", async () => {
    const stopped = { schema: 1, shop: { id: "glow-pets", plan: "basic", state: "stopped", paid_through: 1_700_000_000, grace_days: 30, expires: 1_700_000_000, stop_at: 1_700_000_000, export_until: 1_800_000_000, notice: "stop" }, newest_issued_at: 1_700_000_000, extension_until: 0, partner: "Divya" };
    const seen = await golden("silent and stopped", async () => {
      const quiet = await morningShop({ quiet: true });
      const stop = await morningShop({ licence: stopped });
      return { quiet: await morningOf(quiet.s, quiet.guard, quiet.open), stopped: await morningOf(stop.s, stop.guard, stop.open) };
    });
    assert.deepEqual(seen.quiet, { lines: [], pushes: [] });
    assert.deepEqual(seen.stopped, { lines: [], pushes: [] });
  });
});

// Voice (modules/voice, modules/runtime/http.ts): a listings-only shop has no voice service for its assistant and no chat, so the owner's page shows no record button (`listen`
// false) and both voice routes say voice is off, after the method and, for the owner's, the owner's credential. Nothing is held or saved.
describe("voice, as a listings-only shop has it: off", { skip: SKIP }, () => {
  test("the voice routes answer as TypeScript's did (the golden answers); nothing is saved", async () => {
    const seen = await golden("voice off", async () => {
      const s = await makeShop({}); shops.push(s); await s.start();
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
      return { calls: calls.map((c) => [c.status, c.body]), listen: (await s.call("/internal/channel/owner", { owner: s.owner })).body.app.listen, status: (await s.settle()).tasks };
    });
    assert.equal(seen.listen, false);
    assert.deepEqual(seen.calls[2], [404, { error: "Voice is not on for this shop's assistant." }]);
  });
});
