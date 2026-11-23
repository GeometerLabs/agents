// Send once for Stock orders (modules/messaging/send-once.ts): the order message to the supplier, and its reminder, go out ONCE even if the process dies mid-send. The step only
// records the intent; after the step's save the claim is saved, the message is sent, and the ending is saved. A claim with no ending is never sent again and the owner is asked
// ("They got it" / "Send it again"); only a refusal that says nothing went out is tried again; "Send it again" is a new claim by the owner's own press.
// Written 17 Nov 2026 (not yet run: the one test pass is at the end).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { TimeoutError } from "../../../../modules/core/faults.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { createFakeMessaging } from "../../../../modules/messaging/messaging.ts";
import type { Messaging } from "../../../../modules/messaging/messaging.ts";
import { RAVI, createWorld, glowSalon } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { createAgent } from "../src/agent.ts";
import { ownerItems, ownerView } from "../src/channel.ts";
import { ownerPage } from "../../../../modules/channels/owner-page.ts";
import { STOCK_WORDS } from "../../../../modules/channels/words-stock.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import { META_TEMPLATE_NAMES } from "../src/language/meta-templates.ts";
import { REPORT_TEMPLATE_NAMES } from "../report/whatsapp.ts";
import { openStore } from "../server/store.ts";
import { parseStore, serializeStore } from "../server/snapshot.ts";
import type { Store } from "../src/order.ts";

const items = (w: World, store: Store = w.store) => ownerItems(w.settings, store, w.clock.now(), store.assistant);
const press = (w: World, action: string, c: string, digest: string, id: string) => w.agent.handle({ kind: "owner_action", id, action: action as never, case: c, digest });
const intentsOf = (w: World, kind: string) => (w.store.sendOnce?.intents ?? []).filter((i) => i.kind === kind);
const entries = (w: World, action: string) => w.record.entries().filter((e) => e.action === action);

/** An agent that, like the runtime's, only records what it wants sent: `sendOnce.run` sends it. It shares the world's clock, fakes and record. */
const runtimeLike = (w: World, store: Store = w.store) => createAgent({ settings: w.settings, clock: w.clock, messaging: w.messaging, record: w.record, store, sendLater: true });

/** A card is open for po-1; the owner approves it through a runtime-like agent, so the step records the order message and sends nothing. */
async function approveWithoutSending(w: World) {
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  const agent = runtimeLike(w);
  await agent.handle({ kind: "message", message: w.messaging.receive(w.owner, w.approveText()) });
  return agent;
}

test("the happy path sends the order once: one intent, claimed and then confirmed, and no tick sends it again", async () => {
  const w = createWorld();
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  assert.equal(w.order("po-1")?.state, "sent");
  assert.equal(w.orderMessagesTo(RAVI).length, 1);
  const [intent] = intentsOf(w, "purchase_order");
  assert.equal(intent.id, "po-1:purchase_order:1");
  assert.equal(intent.status, "confirmed");
  assert.equal(intent.tries, 1);
  assert.deepEqual(entries(w, "send_order").map((e) => e.outcome), ["attempted", "confirmed"], "the claim line, then the ending say() wrote");
  await w.advance(10);
  await w.tick();
  assert.equal(w.orderMessagesTo(RAVI).length, 1);
});

test("the step itself sends nothing: the intent holds the message id, the supplier, the template, the values and the order", async () => {
  const w = createWorld();
  await approveWithoutSending(w);
  assert.equal(w.orderMessagesTo(RAVI).length, 0, "nothing went out inside the step");
  assert.equal(w.order("po-1")?.state, "approved");
  const [intent] = intentsOf(w, "purchase_order");
  assert.equal(intent.status, "queued");
  assert.equal(intent.caseId, "po-1");
  assert.equal(intent.to, RAVI);
  assert.deepEqual(intent.templates, ["supplier_order"]);
  assert.equal(intent.values.orderRef, "po-1");
  assert.equal(intent.values.totalInr, 4500);
});

test("a crash between the claim and the send: the order is never sent, the owner is asked", async () => {
  const w = createWorld();
  const agent = await approveWithoutSending(w);
  let claimed = "";
  await assert.rejects(agent.sendOnce.run(() => { claimed = serializeStore(w.store); throw new Error("the process died right after the claim was saved"); }), /process died/u);
  assert.equal(w.orderMessagesTo(RAVI).length, 0, "it died before sending");
  // the restart: a fresh store from what was saved, a fresh agent
  const restarted = parseStore(claimed);
  assert.equal(restarted.sendOnce?.intents[0].status, "claimed");
  await runtimeLike(w, restarted).sendOnce.run(() => undefined);
  assert.equal(w.orderMessagesTo(RAVI).length, 0, "a claim with no ending is never sent");
  assert.equal(restarted.orders.get("po-1")?.state, "send_unknown");
  assert.equal(restarted.sendOnce?.intents[0].status, "unconfirmed");
  assert.ok(entries(w, "send_order").some((e) => e.outcome === "unconfirmed"), "the record says it may or may not have gone out");
  const [item] = items(w, restarted).filter((i) => i.kind === "po_unsure");
  assert.ok(item, "the owner is asked");
  assert.deepEqual(item.actions, ["got_it", "send_again"]);
  assert.match(w.lastTextTo(w.owner), /may or may not have reached/u);
});

test("a crash after the send, before the ending is saved: the order is never sent again, the owner is asked", async () => {
  const w = createWorld();
  const agent = await approveWithoutSending(w);
  let claimed = "";
  let saves = 0;
  await assert.rejects(agent.sendOnce.run(() => { saves += 1; if (saves === 1) { claimed = serializeStore(w.store); return; } throw new Error("the process died before the ending was saved"); }), /process died/u);
  assert.equal(w.orderMessagesTo(RAVI).length, 1, "WhatsApp took it");
  const restarted = parseStore(claimed); // only the claim was saved
  await runtimeLike(w, restarted).sendOnce.run(() => undefined);
  await w.advance(120); // and the clock goes on: no later tick sends it again
  await runtimeLike(w, restarted).sendOnce.run(() => undefined);
  assert.equal(w.orderMessagesTo(RAVI).length, 1, "never resent");
  assert.equal(restarted.orders.get("po-1")?.state, "send_unknown");
  assert.equal(items(w, restarted).filter((i) => i.kind === "po_unsure").length, 1);
});

test("a refusal that says nothing went out is tried again once, an hour later, and the order is then sent once", async () => {
  const w = createWorld({ unapproved: ["stock_order_to_supplier"] });
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  assert.equal(w.order("po-1")?.state, "approved", "held while a second try is coming");
  assert.equal(items(w).filter((i) => i.kind === "po_refused").length, 1, "and the owner is told at once on their page");
  assert.equal(w.orderMessagesTo(RAVI).length, 0);
  for (const l of LANGUAGES) w.messaging.approve("stock_order_to_supplier", l); // the provider approves the template meanwhile
  await w.advance(30);
  assert.equal(w.orderMessagesTo(RAVI).length, 0, "not before the hour");
  await w.advance(31);
  assert.equal(w.orderMessagesTo(RAVI).length, 1);
  assert.equal(w.order("po-1")?.state, "sent");
  const [intent] = intentsOf(w, "purchase_order");
  assert.equal(intent.tries, 2);
  assert.equal(intent.status, "confirmed");
  await w.advance(300);
  assert.equal(w.orderMessagesTo(RAVI).length, 1);
});

test("a refusal that goes on ends as send_failed after three tries, and the owner is told then", async () => {
  const w = createWorld({ unapproved: ["stock_order_to_supplier"] });
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  await w.advance(61);
  await w.advance(61);
  assert.equal(w.order("po-1")?.state, "send_failed");
  assert.equal(intentsOf(w, "purchase_order")[0].status, "gave_up");
  assert.equal(intentsOf(w, "purchase_order")[0].tries, 3);
});

test("a lost reply makes the order unconfirmed, asks the owner, and \"They got it\" settles it without sending", async () => {
  const w = createWorld();
  w.messaging.inject("sendTemplate", "lostReply");
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  assert.equal(w.order("po-1")?.state, "send_unknown");
  assert.equal(w.orderMessagesTo(RAVI).length, 1);
  const [item] = items(w).filter((i) => i.kind === "po_unsure");
  assert.ok(item);
  await press(w, "got_it", item.case, item.digest, "p-got");
  assert.equal(w.order("po-1")?.state, "sent");
  assert.equal(w.orderMessagesTo(RAVI).length, 1, "nothing was sent");
  assert.equal(items(w).filter((i) => i.kind === "po_unsure").length, 0);
  assert.equal(w.store.sendOnce?.intents[0].resolved, "owner_got_it");
  await press(w, "send_again", item.case, item.digest, "p-late");
  assert.equal(w.orderMessagesTo(RAVI).length, 1, "a press for an answered item does nothing");
});

test("\"Send it again\" is a fresh claim made by the owner's press: a new message, once, and the first stays unconfirmed in the record", async () => {
  const w = createWorld();
  w.messaging.inject("sendTemplate", "lostReply");
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  await w.advance(10); // time passing alone never resends it
  assert.equal(w.orderMessagesTo(RAVI).length, 1);
  const [item] = items(w).filter((i) => i.kind === "po_unsure");
  await press(w, "send_again", item.case, item.digest, "p-again");
  assert.equal(w.orderMessagesTo(RAVI).length, 2, "one more, by the owner's own act");
  assert.equal(w.order("po-1")?.state, "sent");
  const intents = intentsOf(w, "purchase_order");
  assert.deepEqual(intents.map((i) => i.id), ["po-1:purchase_order:1", "po-1:purchase_order:2"]);
  assert.deepEqual(intents.map((i) => i.status), ["unconfirmed", "confirmed"]);
  assert.equal(intents[0].resolved, "owner_send_again");
  assert.equal(entries(w, "send_order").filter((e) => e.outcome === "attempted").length, 2, "two claims");
  await press(w, "send_again", item.case, item.digest, "p-again2");
  assert.equal(w.orderMessagesTo(RAVI).length, 2, "pressed twice, sent once more only");
});

test("the supplier's own OK settles an unconfirmed order too: the owner's question leaves the list", async () => {
  const w = createWorld();
  w.messaging.inject("sendTemplate", "lostReply");
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  assert.equal(items(w).filter((i) => i.kind === "po_unsure").length, 1);
  await w.supplierSays(RAVI, "ok");
  assert.equal(w.order("po-1")?.state, "sent");
  assert.equal(items(w).filter((i) => i.kind === "po_unsure").length, 0);
});

test("the reminder to the supplier goes through the same way: once, with a claim, and a reminder left claimed is never sent", async () => {
  const w = createWorld();
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  await w.advance(5 * 60);
  const reminders = () => w.messaging.sentTo(RAVI).filter((m) => m.templateName === "stock_order_reminder");
  const checks = intentsOf(w, "supplier_check");
  assert.ok(checks.length >= 1 && reminders().length === checks.length, `${reminders().length} reminders, ${checks.length} intents`);
  assert.ok(checks.every((i) => i.status === "confirmed" && i.tries === 1));
  const before = reminders().length;
  await w.tick();
  assert.equal(reminders().length, before, "a tick sends no reminder twice");
  // a reminder whose process died after the claim: never sent, and it is not the owner's question (the owner's "Ask again" is the explicit act)
  const last = checks.at(-1)!;
  last.status = "claimed";
  await w.agent.sendOnce.run(() => undefined);
  assert.equal(last.status, "unconfirmed");
  assert.equal(reminders().length, before);
  assert.equal(items(w).filter((i) => i.kind === "po_unsure").length, 0);
});

test("the owner's page for an unconfirmed order names the order and carries only the order's own words", async () => {
  const w = createWorld();
  w.messaging.inject("sendTemplate", "lostReply");
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  const [item] = items(w).filter((i) => i.kind === "po_unsure");
  assert.equal(item.case, "po-1");
  assert.match(item.what ?? "", /^po-1: /u);
  assert.equal(item.customer.name, "Ravi Traders");
  assert.ok(!JSON.stringify(item).match(/yes [A-Z0-9]{4,6}/u));
});

test("the owner's page draws the unconfirmed order in all four languages, with the two buttons bound to its digest", async () => {
  const w = createWorld();
  w.messaging.inject("sendTemplate", "lostReply");
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  const [item] = items(w).filter((i) => i.kind === "po_unsure");
  for (const language of LANGUAGES) {
    const html = ownerPage({ base: "/o/x", language, view: ownerView(w.settings, w.store, w.clock.now()), relayAsks: [] });
    assert.ok(html.includes(STOCK_WORDS[language].gotIt) && html.includes(STOCK_WORDS[language].sendAgain), language);
    assert.ok(html.includes('value="got_it"') && html.includes('value="send_again"') && html.includes(item.digest), language);
    assert.ok(html.includes(STOCK_WORDS[language].unsure("Ravi Traders", "po-1")), language);
  }
});

test("a refused order message is shown to the owner at once, with the time of the next try, and the item closes by itself when a later try goes through", async () => {
  const w = createWorld({ unapproved: ["stock_order_to_supplier"] });
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  const [item] = items(w).filter((i) => i.kind === "po_refused");
  assert.ok(item);
  assert.deepEqual(item.actions, ["try_now", "cancel_order"]);
  assert.equal(item.startMs, intentsOf(w, "purchase_order")[0].lastTryMs! + 60 * 60_000, "the time of the next automatic try");
  for (const language of LANGUAGES) {
    const html = ownerPage({ base: "/o/x", language, view: ownerView(w.settings, w.store, w.clock.now()), relayAsks: [] });
    assert.ok(html.includes(STOCK_WORDS[language].tryNow) && html.includes(STOCK_WORDS[language].cancelOrder) && html.includes('value="try_now"') && html.includes('value="cancel_order"'), language);
  }
  for (const l of LANGUAGES) w.messaging.approve("stock_order_to_supplier", l);
  await w.advance(61);
  assert.equal(w.order("po-1")?.state, "sent");
  assert.equal(items(w).filter((i) => i.kind === "po_refused").length, 0, "closed by itself");
  assert.equal(w.messaging.sentTo(w.owner).filter((m) => /went to Ravi Traders/u.test(m.text)).length, 1, "the owner is told once that it went");
});

test("\"Try now\" tries the same intent at once, as one of its three tries; pressed again after it went, it does nothing", async () => {
  const w = createWorld({ unapproved: ["stock_order_to_supplier"] });
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  const [item] = items(w).filter((i) => i.kind === "po_refused");
  for (const l of LANGUAGES) w.messaging.approve("stock_order_to_supplier", l);
  await press(w, "try_now", item.case, item.digest, "p-now");
  assert.equal(w.orderMessagesTo(RAVI).length, 1, "sent without waiting the hour");
  assert.equal(intentsOf(w, "purchase_order").length, 1, "the same intent, not a new one");
  assert.equal(intentsOf(w, "purchase_order")[0].tries, 2);
  await press(w, "try_now", item.case, item.digest, "p-now2");
  assert.equal(w.orderMessagesTo(RAVI).length, 1);
});

test("\"Cancel order\" on a refused message stops the retries and frees the budget", async () => {
  const w = createWorld({ unapproved: ["stock_order_to_supplier"] });
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  const [item] = items(w).filter((i) => i.kind === "po_refused");
  await press(w, "cancel_order", item.case, item.digest, "p-cancel");
  assert.equal(w.order("po-1")?.state, "cancelled");
  assert.equal(items(w).length, 0);
  for (const l of LANGUAGES) w.messaging.approve("stock_order_to_supplier", l);
  await w.advance(120);
  assert.equal(w.orderMessagesTo(RAVI).length, 0, "never sent after it was cancelled");
  assert.equal(w.store.sendOnce?.intents[0].status, "gave_up");
});
