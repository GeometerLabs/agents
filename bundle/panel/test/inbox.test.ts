// The unfinished-work inbox (B31): one list across the shops a person may see, in plain sentences, built from the exported record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORDS } from "../languages.ts";
import { sentenceOf } from "../views.ts";
import type { Ctx } from "../views.ts";
import { NOW, accountIdOf, boot } from "./helpers.ts";
import type { Boot } from "./helpers.ts";

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const entry = (seq: number, booking: string, action: string, outcome: string, at: number) =>
  ({ seq, time: iso(at), conversation: "c-aaaaaaaaaaaa", booking, action, inputsDigest: "0", outcome, decisions: [], language: "en", notes: "", refs: {} });

/** Write what the deployer would export for a Bookings shop: a record and its bookings (the customer is a hash). */
function exportBookings(b: Boot, shop: string, bookings: unknown[], entries: unknown[]): void {
  const dir = join(b.dir, "exports", shop);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "record.json"), JSON.stringify(entries));
  writeFileSync(join(dir, "bookings.json"), JSON.stringify(bookings));
}
const stuckBooking = (id: string) => ({ id, customer: "p-aaaaaaaaaaaa", language: "en", state: "needs_owner", depositPaymentId: "pay_1", depositInr: 200, handledPayments: ["pay_1"], reminders: [], pending: [{ kind: "calendar" }], dateNeedsConfirmation: false, timeInferred: false });

test("the list holds the shops a person can see: a partner sees only their own, a builder sees every shop", async () => {
  const b = await boot();
  try {
    const arjun = await b.account("arjun", "builder");
    const divya = await b.account("divya", "partner");
    const meera = await b.account("meera", "partner");
    b.addShop("glow-salon", { name: "Glow Salon", ownerId: accountIdOf(b, "divya"), ownerName: "Divya" });
    b.addShop("hosahalli-cuts", { name: "Hosahalli Cuts", ownerId: accountIdOf(b, "meera"), ownerName: "Meera" });
    for (const shop of ["glow-salon", "hosahalli-cuts"]) exportBookings(b, shop, [stuckBooking("b-1")], [entry(1, "b-1", "record_deposit", "confirmed", NOW - 2 * HOUR)]);
    const sentence = WORDS.en.inbox.kinds.deposit_no_booking("b-1", "₹200", 0, "");
    const mine = (await divya.get("/inbox")).plain;
    assert.ok(mine.includes("Glow Salon") && mine.includes(sentence), mine.slice(0, 1500));
    assert.ok(!mine.includes("Hosahalli Cuts"), "a partner never sees another partner's shop");
    assert.ok(!(await meera.get("/inbox")).plain.includes("Glow Salon"));
    const all = (await arjun.get("/inbox")).plain;
    assert.ok(all.includes("Glow Salon") && all.includes("Hosahalli Cuts") && all.includes(WORDS.en.inbox.count(2)));
  } finally { await b.close(); }
});

test("the list says what it is built from, and a shop with no export yet says so instead of 'nothing to do'", async () => {
  const b = await boot();
  try {
    const arjun = await b.account("arjun", "builder");
    b.addShop("glow-salon", { name: "Glow Salon" });
    const none = (await arjun.get("/inbox")).plain;
    assert.ok(none.includes(WORDS.en.inbox.notShared));
    exportBookings(b, "glow-salon", [], []);
    const empty = (await arjun.get("/inbox")).plain;
    assert.ok(empty.includes(WORDS.en.inbox.empty) && empty.includes(WORDS.en.inbox.asOf("").slice(0, 14)));
    assert.ok(empty.includes(WORDS.en.inbox.help), "the help line is on the page");
  } finally { await b.close(); }
});

test("the shop's own page has its list, and the page reads in all four languages", async () => {
  const b = await boot();
  try {
    const arjun = await b.account("arjun", "builder");
    b.addShop("glow-salon", { name: "Glow Salon" });
    exportBookings(b, "glow-salon", [stuckBooking("b-1")], [entry(1, "b-1", "record_deposit", "confirmed", NOW - 2 * HOUR)]);
    assert.ok((await arjun.get("/shops/glow-salon")).plain.includes(WORDS.en.inbox.kinds.deposit_no_booking("b-1", "₹200", 0, "")));
    for (const l of ["hi", "ml", "kn"] as const) {
      await arjun.get(`/lang/${l}?next=/inbox`);
      const page = (await arjun.get("/inbox")).plain;
      assert.ok(page.includes(WORDS[l].inbox.kinds.deposit_no_booking("b-1", "₹200", 0, "")), l);
      assert.ok(page.includes(WORDS[l].inbox.help), l);
    }
  } finally { await b.close(); }
});

test("a kind with no words (a module added one) is still listed, under the fallback sentence", () => {
  const c = { w: WORDS.en } as unknown as Ctx;
  assert.equal(sentenceOf(c, { kind: "upi_unconfirmed", caseId: "b-3", sinceMs: null, facts: { case: "b-3" }, actions: [] }), WORDS.en.inbox.fallback("upi_unconfirmed", "b-3"));
  assert.equal(sentenceOf(c, { kind: "__proto__", caseId: "b-3", sinceMs: null, facts: {}, actions: [] }), WORDS.en.inbox.fallback("__proto__", "b-3"));
});

test("the wait before an answer is 'too long' is the panel's setting (PANEL_APPROVAL_WAIT_HOURS), 12 hours by default", async () => {
  const held = { ...stuckBooking("b-2"), state: "cancelled", depositPaymentId: "pay_2", pending: [{ kind: "guard_hold", amountInr: 900, paymentId: "pay_2", receipt: "b-2:pay_2", approval: "ap-1", body: "{}", expiresAtMs: null, heldAtMs: NOW - 5 * HOUR }] };
  for (const [hours, expect] of [[undefined, "refund_waiting"], [4, "approval_waiting_long"]] as const) {
    const b = await boot(hours === undefined ? {} : { approvalWaitHours: hours });
    try {
      const arjun = await b.account("arjun", "builder");
      b.addShop("glow-salon", { name: "Glow Salon" });
      exportBookings(b, "glow-salon", [held], [entry(1, "b-2", "refund", "held_for_owner", NOW - 5 * HOUR)]);
      const page = (await arjun.get("/inbox")).plain;
      const want = expect === "refund_waiting" ? WORDS.en.inbox.kinds.refund_waiting("b-2", "₹900", 0, WORDS.en.inbox.variants.owner) : WORDS.en.inbox.kinds.approval_waiting_long("b-2", "", 5, WORDS.en.inbox.variants.guard_hold);
      assert.ok(page.includes(want), `${expect}: ${page.slice(page.indexOf("<main>"), page.indexOf("<main>") + 1200)}`);
    } finally { await b.close(); }
  }
});

test("an item shows a button for each recovery action it offers; pressing one files a request with a name and an id and nothing else; an action the list does not offer for that case is refused", async () => {
  const b = await boot();
  try {
    const arjun = await b.account("arjun", "builder");
    const divya = await b.account("divya", "partner");
    const meera = await b.account("meera", "partner");
    b.addShop("glow-salon", { name: "Glow Salon", ownerId: accountIdOf(b, "divya"), ownerName: "DIVYA" });
    exportBookings(b, "glow-salon", [stuckBooking("b-1")], [entry(1, "b-1", "record_deposit", "confirmed", NOW - 2 * HOUR)]);
    const page = (await divya.get("/inbox")).plain;
    for (const a of ["retry_booking", "recheck_payment", "ask_owner_again"]) assert.ok(page.includes(`name="action" value="${a}"`) && page.includes(WORDS.en.inbox.actions[a]), a);
    assert.ok(!page.includes('value="recheck_refund"'), "only what fits this item");
    assert.ok(page.includes(WORDS.en.inbox.actionNote), "and it says these go through Guard and the same limits");
    // pressing one
    const sent = await divya.post("/shops/glow-salon/recover", { case: "b-1", action: "retry_booking" }, "/inbox");
    assert.equal(sent.status, 303);
    assert.equal(sent.location, "/inbox?notice=sent");
    assert.ok((await divya.get("/inbox?notice=sent")).plain.includes(WORDS.en.inbox.recover.sent));
    const files = readdirSync(join(b.dir, "requests"));
    assert.equal(files.length, 1);
    assert.match(files[0], /^glow-salon\.recover\.[0-9a-f]{16}\.json$/u);
    const body = JSON.parse(readFileSync(join(b.dir, "requests", files[0]), "utf8"));
    assert.deepEqual(Object.keys(body).sort(), ["action", "case", "requestId", "requestedAt", "requestedBy", "schema", "shop"].sort(), "a name and an id, no message, no number, no amount");
    assert.deepEqual([body.case, body.action, body.shop, body.requestedBy.name], ["b-1", "retry_booking", "glow-salon", "DIVYA"]);
    // not offered for this case: refused, nothing filed
    for (const form of [{ case: "b-1", action: "recheck_refund" }, { case: "b-9", action: "retry_booking" }, { case: "b-1", action: "refund_everything" }, { case: "", action: "" }]) {
      const r = await divya.post("/shops/glow-salon/recover", form, "/inbox");
      assert.equal(r.location, "/inbox?notice=refused", JSON.stringify(form));
    }
    assert.equal(readdirSync(join(b.dir, "requests")).length, 1);
    // another partner sees nothing of it; the builder may ask
    assert.equal((await meera.post("/shops/glow-salon/recover", { case: "b-1", action: "retry_booking" }, "/inbox")).status, 404);
    assert.equal((await arjun.post("/shops/glow-salon/recover", { case: "b-1", action: "ask_owner_again" }, "/inbox")).location, "/inbox?notice=sent");
    assert.equal(readdirSync(join(b.dir, "requests")).length, 2);
  } finally { await b.close(); }
});
