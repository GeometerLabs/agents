// Part cash marks (17 Nov 2026): the owner marks only part of a fee received by hand, from their page's "paid another way?" list. Each mark is a payment of its own and a
// record line of its own; the fee stays open for the rest, and its payment link is made again for exactly the rest; a press with an old digest, or an amount that is not
// whole rupees or is more than is owed, does nothing. Undoing a mark is NOT built (Deferred.md): this file keeps only what is. Dev harness with the in-memory fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROHAN_PARENT, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { cashList } from "../src/channel.ts";
import { balancePaise } from "../src/due.ts";
import { checkChannelEvent } from "../../../../modules/channels/events.ts";

const digestOf = (w: World, id: string): string => cashList(w.settings, w.store).find((x) => x.case === id)!.digest;
const mark = (w: World, id: string, digest: string, amountPaise?: number, n = 1) => w.agent.handle({ kind: "owner_action", id: `o-${n}`, action: "cash", case: id, digest, ...(amountPaise !== undefined ? { amountPaise } : {}) });
const marks = (w: World) => w.record.entries().filter((e) => e.action === "owner_marked_paid" && e.outcome === "confirmed");

test("a part marked in cash: the fee stays open for the rest, the parent is told, and a new link is for exactly what is left", async () => {
  const w = createWorld();
  await w.advance(61);
  const due = w.dueOf("Rohan Mehta")!;
  const oldLink = due.currentLinkId;
  await mark(w, due.id, digestOf(w, due.id), 60_000);
  assert.equal(due.state, "open");
  assert.equal(balancePaise(due), 120_000);
  assert.deepEqual(due.payments.map((p) => [p.linkId, p.amountPaise]), [["cash", 60_000]]);
  assert.equal(marks(w).length, 1);
  assert.equal(marks(w)[0].refs.amountPaise, "60000");
  assert.equal(marks(w)[0].refs.via, "cash");
  assert.match(w.lastTextTo(ROHAN_PARENT), /₹600/u, "the parent is told what was received");
  assert.notEqual(due.currentLinkId, oldLink, "the link is made again for the rest");
  assert.equal(w.linkFor("Rohan Mehta")!.amount, 120_000);
});

test("the rest marked later settles the fee, once; a press with the digest from before the first part does nothing", async () => {
  const w = createWorld();
  await w.advance(61);
  const due = w.dueOf("Rohan Mehta")!;
  const first = digestOf(w, due.id);
  await mark(w, due.id, first, 60_000, 1);
  await mark(w, due.id, first, 60_000, 2); // the same page again: the fee is no longer as it was shown
  assert.equal(due.payments.length, 1, "nothing was marked a second time");
  await mark(w, due.id, digestOf(w, due.id), undefined, 3);
  assert.equal(due.state, "paid");
  assert.equal(due.payments.length, 2);
  assert.equal(marks(w).length, 2, "two marks, two record lines");
  assert.equal(due.payments.reduce((n, p) => n + p.amountPaise, 0), 180_000);
  assert.equal(w.payments.refunds().length, 0);
});

test("an amount that is not whole rupees, is nothing, or is more than is owed marks nothing", async () => {
  const w = createWorld();
  await w.advance(61);
  const due = w.dueOf("Rohan Mehta")!;
  const digest = digestOf(w, due.id);
  for (const [i, amount] of [0, 50, 12_345, 180_100].entries()) await mark(w, due.id, digest, amount, i + 1);
  assert.equal(due.payments.length, 0);
  assert.equal(due.state, "open");
  assert.equal(marks(w).length, 0);
  assert.ok(w.record.entries().some((e) => e.action === "owner_page_action" && e.outcome === "blocked"));
});

test("the page's event carries a part only for cash and bank, in whole rupees", () => {
  const base = { kind: "owner_action", id: "o-1", case: "f-3", digest: "a".repeat(32) };
  const ok = checkChannelEvent({ ...base, action: "cash", amountPaise: 60_000 });
  assert.ok(ok.ok && (ok.event as { amountPaise?: number }).amountPaise === 60_000);
  assert.equal(checkChannelEvent({ ...base, action: "cash", amountPaise: 50 }).ok, false);
  assert.equal(checkChannelEvent({ ...base, action: "bank", amountPaise: 60_050 }).ok, false);
  const other = checkChannelEvent({ ...base, action: "approve", amountPaise: 60_000 });
  assert.ok(other.ok && !("amountPaise" in other.event), "any other action ignores it");
  const whole = checkChannelEvent({ ...base, action: "cash" });
  assert.ok(whole.ok && !("amountPaise" in whole.event), "no amount: the whole balance, as before");
});
