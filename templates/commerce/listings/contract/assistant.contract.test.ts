// The CONTRACT of the owner's talk-and-cards page of a listings-only shop (modules/assistant, templates/commerce/listings): `GET /internal/channel/owner`, the owner's `owner_action` taps on a
// card, the cards a drafted listing makes, the words the assistant says back, and the clock's beat. Like listings.contract.test.ts it talks to the shop ONLY over HTTP (the process of
// harness.ts), and must pass on the TypeScript runtime first (LISTINGS_IMPL=ts) and then on the Go one (LISTINGS_IMPL=go).
//
// Two kinds of assertion. The first suites check machine fields (a card's id, kind and digest, the record's refs, the state of a listing); where a sentence is checked it is only that it
// names the owner's own title or price. The last suites run the SAME script on a TypeScript shop and on a Go shop and compare what the owner would read, line for line, in each of
// the four owner languages: that is what proves the Go words (packed from the TypeScript ones by go/scripts/gen_words.ts) are the TypeScript words. Those need both runtimes, so they
// start both whatever LISTINGS_IMPL says, and are skipped (with the reason) when there is no Go binary.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { IMPL, REPO, draftAnswer, makeShop, startFakeModel } from "./harness.ts";
import type { FakeModel, Shop } from "./harness.ts";

const shops: Shop[] = [];
const fakes: FakeModel[] = [];
after(async () => { for (const s of shops) { await s.stop(); s.cleanup(); } for (const f of fakes) await f.close(); });

const GO_BIN = process.env.LISTINGS_GO_BIN ?? join(REPO, "go", "bin", "listings");
const BOTH = { skip: !existsSync(GO_BIN) && "there is no Go binary (LISTINGS_GO_BIN or go/bin/listings), so the two runtimes cannot be compared" };

async function boot(o: Parameters<typeof makeShop>[0] = {}, impl?: "ts" | "go"): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(impl); return s; }

const BUDGET = { monthlyMicroInr: 50_000_000, daily: { listing_draft: 20 } };
const KITTENS = "I have two Persian kittens for sale on my page, 8000 rupees";
/** A shop with a fake model that writes the one draft. */
async function withModel(o: Parameters<typeof makeShop>[0] = {}, answer?: (owner: string) => unknown, impl?: "ts" | "go"): Promise<{ s: Shop; fake: FakeModel }> {
  const fake = await startFakeModel(answer); fakes.push(fake);
  return { s: await boot({ modelPort: fake.port, budget: BUDGET, ...o }, impl), fake };
}

const say = async (s: Shop, id: string, text: string): Promise<void> => {
  const r = await s.call("/internal/channel/events", { owner: s.owner, body: { events: [{ kind: "owner_message", id, text }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await s.settle();
};
const tap = async (s: Shop, id: string, action: string, card: { id: string; digest: string }): Promise<number> => {
  const r = await s.call("/internal/channel/events", { owner: s.owner, body: { events: [{ kind: "owner_action", id, action, case: card.id, digest: card.digest }] } });
  await s.settle();
  return r.status;
};
const page = async (s: Shop): Promise<any> => { const r = await s.call("/internal/channel/owner", { owner: s.owner }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const cards = async (s: Shop): Promise<any[]> => (await page(s)).app.cards;
const talk = async (s: Shop): Promise<{ from: string; text: string }[]> => (await page(s)).app.talk.map((l: any) => ({ from: l.from, text: l.text }));
const lastSaid = async (s: Shop): Promise<string> => (await talk(s)).filter((l) => l.from === "assistant").at(-1)?.text ?? "";
const publicListings = async (s: Shop): Promise<any[]> => (await s.call("/internal/channel/listings")).body.listings;
const ownerListings = async (s: Shop): Promise<any[]> => (await s.call("/internal/channel/owner-listing", { owner: s.owner })).body.listings;
/** The record as the shop keeps it, read from its own file (the one place the contract looks inside: the record has no route). */
function record(s: Shop): any[] {
  const db = new DatabaseSync(join(s.dataDir, "agent.db"), { readOnly: true });
  try { return db.prepare("select entry from record order by seq").all().map((r: any) => JSON.parse(r.entry)); } finally { db.close(); }
}
const lines = (s: Shop, action: string): any[] => record(s).filter((e) => e.action === action);
/** Change the saved state of a STOPPED shop: each card is given to `edit`. */
function editCards(s: Shop, edit: (card: any) => void): void {
  const db = new DatabaseSync(join(s.dataDir, "agent.db"));
  try {
    const rows = db.prepare("select pos, value from state_rows where list = ?").all(JSON.stringify(["assistant", "cards"])) as { pos: number; value: string }[];
    for (const r of rows) { const c = JSON.parse(r.value); edit(c); db.prepare("update state_rows set value = ? where list = ? and pos = ?").run(JSON.stringify(c), JSON.stringify(["assistant", "cards"]), r.pos); }
  } finally { db.close(); }
}
/** Draft the kittens and return the one card. */
async function draft(s: Shop, id = "m-1", text = KITTENS): Promise<any> { await say(s, id, text); const c = await cards(s); assert.equal(c.length, 1, JSON.stringify(c)); return c[0]; }

describe("the owner's page: who may read it, and what it shows a shop with nothing yet", () => {
  test("it needs the owner's link: no link, a wrong link and the channel token alone are refused", async () => {
    const s = await boot();
    assert.equal((await s.call("/internal/channel/owner")).status, 403);
    assert.equal((await s.call("/internal/channel/owner", { owner: "not-the-link" })).status, 403);
    assert.equal((await s.call("/internal/channel/owner", { token: null, owner: s.owner })).status, 401, "the channel token is needed first");
    assert.equal((await s.call("/internal/channel/owner", { method: "POST", owner: s.owner, body: {} })).status, 405);
  });

  test("a new shop: the view of a listings-only shop, the default character, nothing waiting and a quiet face", async () => {
    const s = await boot();
    const v = await page(s);
    assert.deepEqual(v.shop, { name: "Glow Pets", timezone: "Asia/Kolkata", ownerLanguage: "en" });
    assert.equal(v.kind, "listings");
    assert.deepEqual([v.services, v.items, v.upcoming], [[], [], []]);
    assert.deepEqual(v.app, { character: { style: "clay", personality: "warm" }, mood: "quiet", face: "well", closedToday: false, today: [], waiting: [], cards: [], talk: [], notes: [], listen: false });
  });

  test("the character and its name come from the shop's settings", async () => {
    const s = await boot({ assistant: { character: { name: "Mithra", style: "critters", personality: "cheerful", colour: "7dd3fc" } } });
    assert.deepEqual((await page(s)).app.character, { name: "Mithra", style: "critters", personality: "cheerful", colour: "7dd3fc" });
  });
});

describe("a drafted listing makes ONE card, and the owner's tap on it publishes the listing", () => {
  test("the draft: a card with its id, digest and question, the owner's line in the talk, a waiting face, and the record's lines", async () => {
    const { s } = await withModel();
    const c = await draft(s);
    assert.equal(c.id, "c-1"); assert.match(c.digest, /^[0-9a-f]{32}$/u);
    assert.deepEqual([c.skill, c.kind, c.case, c.amountPaise, c.who, c.hasNo], ["listings", "listing", "listing:l-1", 0, "listing:l-1", true]);
    assert.ok(c.expiresAtMs > Date.now() + 23 * 3600_000 && c.expiresAtMs < Date.now() + 25 * 3600_000, "a card is good for a day");
    assert.ok(c.question.includes("Persian kittens") && c.question.includes("₹8,000"), c.question);
    const v = await page(s);
    assert.deepEqual([v.app.mood, v.app.face], ["waiting_for_owner", "needs"]);
    assert.deepEqual(v.app.talk.map((l: any) => [l.from, l.text]), [["owner", KITTENS]], "the card is in the card list, not a line of talk");
    const l = (await ownerListings(s))[0];
    assert.equal(l.state, "draft");
    assert.deepEqual(await publicListings(s), []);
    const held = lines(s, "owner_card");
    assert.equal(held.length, 1);
    assert.deepEqual([held[0].outcome, held[0].refs], ["held_for_owner", { card: "c-1", skill: "listings", kind: "listing", digest: c.digest, case: "listing:l-1", amountPaise: "800000" }]);
    assert.equal(lines(s, "listing").filter((e) => e.refs.change === "drafted").length, 1);
  });

  test("yes publishes it: public now, the record says who did it, the card is closed and the owner is told in words", async () => {
    const { s } = await withModel();
    const c = await draft(s);
    assert.equal(await tap(s, "a-1", "card_yes", c), 200);
    const pub = await publicListings(s);
    assert.equal(pub.length, 1); assert.equal(pub[0].words?.en?.title ?? pub[0].title, "Persian kittens");
    assert.equal((await ownerListings(s))[0].state, "live");
    assert.deepEqual(await cards(s), []);
    assert.deepEqual([(await page(s)).app.mood, (await page(s)).app.face], ["quiet", "well"]);
    const pubLine = lines(s, "listing").find((e) => e.refs.change === "published");
    assert.deepEqual(pubLine.refs, { listing: "l-1", category: "pets", by: "owner", from: "app", change: "published" });
    const done = lines(s, "owner_card").at(-1);
    assert.deepEqual([done.outcome, done.refs], ["confirmed", { card: "c-1", skill: "listings", kind: "listing", digest: c.digest, decision: "yes", via: "page", result: "done" }]);
    assert.ok((await lastSaid(s)).includes("Persian kittens"), "said in the listing's own words");
    assert.ok(record(s).findIndex((e) => e.refs?.change === "published") < record(s).findLastIndex((e) => e.action === "owner_card"), "the listing's own line comes before the card's");
  });

  test("no drops the draft: nothing was ever public, the card is refused, and the same draft is not shown again for a day", async () => {
    const { s } = await withModel();
    const c = await draft(s);
    await tap(s, "a-1", "card_no", c);
    assert.equal((await ownerListings(s)).find((l) => l.id === "l-1")?.state ?? "removed", "removed");
    assert.deepEqual(await publicListings(s), []);
    assert.deepEqual(await cards(s), []);
    const no = lines(s, "owner_card").at(-1);
    assert.deepEqual([no.outcome, no.refs.decision, no.refs.via], ["confirmed", "no", "page"]);
    assert.equal(lines(s, "listing").filter((e) => e.refs.change === "published").length, 0);
  });

  test("a wrong digest does nothing: the card stays, and the owner is told it is not one the assistant holds", async () => {
    const { s } = await withModel();
    const c = await draft(s);
    const before = (await talk(s)).length;
    await tap(s, "a-1", "card_yes", { id: c.id, digest: "0".repeat(32) });
    assert.equal((await cards(s)).length, 1);
    assert.equal((await publicListings(s)).length, 0);
    assert.equal((await talk(s)).length, before + 1);
    const b = lines(s, "owner_card").at(-1);
    assert.deepEqual([b.outcome, b.refs], ["blocked", { card: "c-1", decision: "yes", via: "page" }]);
    // and a card id nobody holds, even with a well-shaped digest
    await tap(s, "a-2", "card_yes", { id: "c-77", digest: c.digest });
    assert.equal((await publicListings(s)).length, 0);
    assert.equal(lines(s, "owner_card").filter((e) => e.outcome === "blocked").length, 2);
  });

  test("a closed card does nothing again: a second yes, or a no after a yes, is 'already answered'", async () => {
    const { s } = await withModel();
    const c = await draft(s);
    await tap(s, "a-1", "card_yes", c);
    const said = (await talk(s)).length;
    await tap(s, "a-2", "card_yes", c);
    await tap(s, "a-3", "card_no", c);
    assert.equal((await talk(s)).length, said + 2);
    assert.equal((await ownerListings(s)).find((l) => l.id === "l-1")?.state, "live", "a no after the yes does not take it off");
    const replays = lines(s, "owner_card").slice(-2);
    for (const r of replays) assert.deepEqual([r.outcome, r.notes], ["blocked", "the card is already done: nothing was done"]);
    assert.deepEqual(replays.map((r) => r.refs.decision), ["yes", "no"]);
    assert.equal(lines(s, "listing").filter((e) => e.refs.change === "published").length, 1, "published once");
  });

  test("an edited draft voids its card on the tap: nothing is published, and a new card with the new digest is made", async () => {
    const { s } = await withModel();
    const c = await draft(s);
    const r = await s.call("/internal/channel/owner-listing", { owner: s.owner, body: { id: "e-1", op: { op: "edit", id: "l-1", title: "Persian kitten pair" } } });
    assert.equal(r.status, 200); await s.settle();
    assert.equal((await cards(s))[0].id, "c-1", "the old card is still open until it is tapped (nothing re-offers it by itself)");
    await tap(s, "a-1", "card_yes", c);
    assert.equal((await publicListings(s)).length, 0, "nothing was published");
    const now = await cards(s);
    assert.equal(now.length, 1);
    assert.equal(now[0].id, "c-2"); assert.notEqual(now[0].digest, c.digest);
    assert.ok(now[0].question.includes("Persian kitten pair"));
    const [blocked] = lines(s, "owner_card").filter((e) => e.outcome === "blocked");
    assert.deepEqual(blocked.refs, { card: "c-1", skill: "listings", kind: "listing", digest: c.digest, decision: "yes", via: "page" });
    assert.deepEqual(lines(s, "owner_card").filter((e) => e.outcome === "held_for_owner").map((e) => e.refs.card), ["c-1", "c-2"]);
    // the old card is closed: tapping it again is "already answered", and the new one publishes
    await tap(s, "a-2", "card_yes", c);
    assert.equal((await publicListings(s)).length, 0);
    await tap(s, "a-3", "card_yes", now[0]);
    assert.equal((await publicListings(s)).length, 1);
  });

  test("a listing taken off by the owner before the tap: the tap is 'gone', nothing is published, and the card is void", async () => {
    const { s } = await withModel();
    const c = await draft(s);
    await s.call("/internal/channel/owner-listing", { owner: s.owner, body: { id: "r-1", op: { op: "remove", id: "l-1" } } }); await s.settle();
    await tap(s, "a-1", "card_yes", c);
    assert.equal((await publicListings(s)).length, 0);
    assert.deepEqual(await cards(s), []);
    const b = lines(s, "owner_card").at(-1);
    assert.equal(b.outcome, "blocked"); assert.ok(b.notes.startsWith("the action can no longer be done (not_live)"), b.notes);
  });

  test("asking 'what needs me' shows an open card again as a NEW card (the old one is void), at most once per ask", async () => {
    const { s } = await withModel();
    const c = await draft(s);
    await say(s, "q-1", "what needs me");
    const now = await cards(s);
    assert.equal(now.length, 1); assert.equal(now[0].id, "c-2"); assert.equal(now[0].digest, c.digest, "the same action, so the same digest");
    assert.deepEqual(lines(s, "owner_card").map((e) => e.refs.card ?? ""), ["c-1", "c-2"]);
    await tap(s, "a-1", "card_yes", c); // the voided one
    assert.equal((await publicListings(s)).length, 0);
    await tap(s, "a-2", "card_yes", now[0]);
    assert.equal((await publicListings(s)).length, 1);
  });

  test("each draft has its own card; a sixth draft is refused (five waiting at most) and says so", async () => {
    const { s } = await withModel();
    for (let i = 1; i <= 5; i++) await say(s, `m-${i}`, `item number ${i} for sale on my page`);
    const open = await cards(s);
    assert.deepEqual(open.map((c: any) => c.case), ["listing:l-1", "listing:l-2", "listing:l-3", "listing:l-4", "listing:l-5"]);
    assert.equal(new Set(open.map((c: any) => c.id)).size, 5);
    await say(s, "m-6", "item number 6 for sale on my page");
    assert.equal((await cards(s)).length, 5);
    assert.ok((await lastSaid(s)).includes("waiting for your tap"), await lastSaid(s));
  });
});

describe("owner_action: the shape is checked before the owner is, and what a listings-only shop has no use for is ignored", () => {
  const post = (s: Shop, e: Record<string, unknown>, owner = true) => s.call("/internal/channel/events", { ...(owner ? { owner: s.owner } : {}), body: { events: [{ kind: "owner_action", id: "x-1", ...e }] } });
  const ok = { action: "card_yes", case: "c-1", digest: "a".repeat(32) };
  test("400 for a bad shape (even with no owner), 403 for a good shape with no owner, 200 with the owner", async () => {
    const s = await boot();
    for (const bad of [{ ...ok, action: "approve_everything" }, { ...ok, case: "b 1" }, { ...ok, case: "b-3" }, { ...ok, digest: "xyz" }, { ...ok, digest: "A".repeat(32) }, { action: "card_yes" }]) {
      assert.equal((await post(s, bad, false)).status, 400, JSON.stringify(bad));
      assert.equal((await post(s, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await post(s, ok, false)).status, 403);
    assert.equal((await post(s, ok)).status, 200);
    assert.equal((await s.call("/internal/channel/events", { owner: s.owner, body: { events: [{ kind: "owner_action", action: "card_yes", case: "c-1", digest: "a".repeat(32) }] } })).status, 400, "an id is needed");
  });
  test("an action of another template's (a refund sent, a deposit received) is saved and does nothing", async () => {
    const s = await boot();
    assert.equal((await post(s, { action: "received", case: "b-3", digest: "b".repeat(32) })).status, 200);
    await s.settle();
    assert.deepEqual((await page(s)).app.talk, []);
    assert.equal((await s.call("/status")).body.tasks.failed, 0);
  });
});

describe("the clock's beat: a card past its time closes, and a tap on it is answered", () => {
  test("the tap on a card that ran out: nothing is published, the card closes as expired, the owner is told", async () => {
    const { s } = await withModel();
    const c = await draft(s);
    await s.stop(); editCards(s, (k) => { k.expiresAtMs = Date.now() - 1000; }); await s.start();
    assert.deepEqual(await cards(s), [], "an expired card is not shown, even before the tick closes it");
    await tap(s, "a-1", "card_yes", c);
    assert.equal((await publicListings(s)).length, 0);
    const b = lines(s, "owner_card").at(-1);
    assert.deepEqual([b.outcome, b.notes], ["blocked", "the card ran out before the tap: nothing was done"]);
    assert.equal(b.refs.decision, "yes");
  });

  test("the beat closes it: one record line, no decision, and a later tap is 'already expired'", async () => {
    const { s } = await withModel({ tickSeconds: 1 });
    const c = await draft(s);
    await s.stop(); editCards(s, (k) => { k.expiresAtMs = Date.now() - 1000; }); await s.start();
    for (let i = 0; i < 60 && lines(s, "owner_card").filter((e) => e.outcome === "blocked").length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    const [b] = lines(s, "owner_card").filter((e) => e.outcome === "blocked");
    assert.ok(b, "the beat made a line");
    assert.deepEqual([b.refs, b.notes], [{ card: "c-1", skill: "listings", kind: "listing", digest: c.digest, decision: "none" }, "the card ran out without a tap: nothing was done"]);
    await new Promise((r) => setTimeout(r, 1200)); // another beat: nothing is closed twice
    assert.equal(lines(s, "owner_card").filter((e) => e.outcome === "blocked").length, 1);
    await tap(s, "a-1", "card_yes", c);
    assert.equal((await publicListings(s)).length, 0);
    assert.equal(lines(s, "owner_card").at(-1).notes, "the card is already expired: nothing was done");
  });

  test("a closed card is taken off the state after a day (compacted), an open one never", async () => {
    const { s } = await withModel({ tickSeconds: 1 });
    const c = await draft(s);
    await tap(s, "a-1", "card_yes", c);
    await s.stop(); editCards(s, (k) => { k.closedAtMs = Date.now() - 2 * 86400_000; }); await s.start();
    for (let i = 0; i < 60; i++) {
      const db = new DatabaseSync(join(s.dataDir, "agent.db"), { readOnly: true });
      const n = db.prepare("select count(*) as n from state_rows where list = ?").get(JSON.stringify(["assistant", "cards"])) as { n: number };
      db.close();
      if (n.n === 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail("the closed card was not compacted");
  });

  test("the morning question: 'Still have it?' for a listing not confirmed in a while, a card with Yes and Sold", async () => {
    // the owner's morning hour is ten minutes ago, so the question is due now; the listing was confirmed two and a half days ago
    const ist = new Date(Date.now() - 15 * 60_000 + 5.5 * 3600_000);
    const morning = `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`;
    const { s } = await withModel({ tickSeconds: 1, assistant: { morning: { at: morning } } });
    await tap(s, "a-0", "card_yes", await draft(s)); // published now
    await s.stop();
    const db = new DatabaseSync(join(s.dataDir, "agent.db"));
    const shape = JSON.parse((db.prepare("select shape from state_shape").get() as { shape: string }).shape);
    shape.assistant.listings.items[0].confirmedMs = Date.now() - 2.5 * 86400_000;
    db.prepare("update state_shape set shape = ?").run(JSON.stringify(shape)); db.close();
    await s.start();
    for (let i = 0; i < 60 && (await cards(s)).length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    const ask = (await cards(s))[0];
    assert.ok(ask, "a question was asked");
    assert.deepEqual([ask.kind, ask.case, ask.hasNo], ["listing_ask", "listing:l-1", true]);
    assert.ok(ask.question.includes("Persian kittens"));
    const held = lines(s, "owner_card").filter((e) => e.outcome === "held_for_owner").at(-1);
    assert.equal(held.refs.kind, "listing_ask");
    // "Sold" is the card's no: the listing is off the page
    await tap(s, "a-1", "card_no", ask);
    assert.notEqual((await ownerListings(s)).find((l) => l.id === "l-1")?.state, "live");
    assert.deepEqual(await publicListings(s), []);
    assert.equal(lines(s, "listing").at(-1).refs.change, "sold");
    assert.ok((await lastSaid(s)).includes("Persian kittens"));
    // it is asked once: a beat later nothing new is asked about a sold listing
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal((await cards(s)).length, 0);
  });

  test("the morning question's yes: the listing is confirmed today, and the question is not asked again for two days", async () => {
    const ist = new Date(Date.now() - 15 * 60_000 + 5.5 * 3600_000);
    const morning = `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`;
    const { s } = await withModel({ tickSeconds: 1, assistant: { morning: { at: morning } } });
    await tap(s, "a-0", "card_yes", await draft(s));
    await s.stop();
    const db = new DatabaseSync(join(s.dataDir, "agent.db"));
    const shape = JSON.parse((db.prepare("select shape from state_shape").get() as { shape: string }).shape);
    shape.assistant.listings.items[0].confirmedMs = Date.now() - 2.5 * 86400_000;
    db.prepare("update state_shape set shape = ?").run(JSON.stringify(shape)); db.close();
    await s.start();
    for (let i = 0; i < 60 && (await cards(s)).length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    const ask = (await cards(s))[0];
    await tap(s, "a-1", "card_yes", ask);
    const l = (await ownerListings(s))[0];
    assert.equal(l.state, "live");
    assert.equal(lines(s, "listing").at(-1).refs.change, "confirmed");
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal((await cards(s)).length, 0, "not asked again");
  });
});
