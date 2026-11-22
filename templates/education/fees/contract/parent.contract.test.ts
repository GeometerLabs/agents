// A parent's private page (item 11h), on the wire (guards mode). A typed phone number never opens a student's fees: the page is found ONLY by the hash of the parent's own
// private link, which the centre sends them (in a reminder, or by the owner's "send a new link" from their page) and keeps as a hash. It shows that parent's students and fees
// and nothing of anyone else's. "Show how to pay" makes the request for what is owed; "I have paid" asks the owner to look (nothing is marked paid) and makes a confirmation
// page that says "confirmed" only when the record does. A press on another parent's fee, or through a link replaced or switched off since, does nothing. The page's documents
// (receipts) are the parent's own fees'. Expected values from test/channels, page-link and chat-parent.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { BACK_MONTH, MEERA, ROHAN, contract, lines, makeCentre, parentLinkHash } from "./harness.ts";
import type { Centre, CentreOptions } from "./harness.ts";

const centres: Centre[] = [];
after(async () => { for (const c of centres) await c.cleanup(); });

async function centre(o: CentreOptions = {}): Promise<Centre> {
  const c = await makeCentre({ mode: "guards", ...o }); centres.push(c);
  await c.start();
  await c.waitFor(() => lines(c, "open_fee", "confirmed").length === 2, "the two earlier months opened");
  return c;
}

/** The owner sends a parent a new private link from their page; the parent (who wrote first, so the window is open) gets it as text. Returns the link's hash. */
async function sendLink(c: Centre, phone: string): Promise<string> {
  await c.inbound(phone, "hello");
  const before = c.linkOf(phone)?.hash;
  const parents = (await c.ownerView()).body.parents as { ref: string; phone: string; digest: string; link: string }[];
  const p = parents.find((x) => x.phone === phone)!;
  await c.ownerAction("send_link", p.ref, p.digest);
  const got = c.linkOf(phone);
  assert.ok(got && got.hash !== before, "the parent was sent a new private link");
  assert.match(c.sent(phone).at(-1)!.text, /\/f\/[A-Za-z0-9_-]{32}/u);
  return got!.hash;
}

describe("what a parent's private link opens", () => {
  contract("only that parent's students and fees, with the amounts and the due date; the owner's page lists the parent by a ref, never the link", async () => {
    const c = await centre();
    const hash = await sendLink(c, ROHAN);
    const view = await c.parent(hash);
    assert.equal(view.status, 200);
    assert.match(view.body.ref, /^p-[0-9a-f]{12}$/u);
    assert.deepEqual(view.body.students, [{ name: "Rohan Mehta", batch: { en: "class 10", hi: "कक्षा 10", ml: "പത്താം ക്ലാസ്", kn: "10ನೇ ತರಗತಿ" } }]);
    assert.equal(view.body.dues.length, 1);
    const fee = view.body.dues[0];
    assert.deepEqual([fee.id, fee.student, fee.month, fee.feeInr, fee.owedInr, fee.paidInr, fee.balanceInr, fee.state, fee.canSayPaid, fee.claimed], ["f-2", "Rohan Mehta", BACK_MONTH, 1800, 1800, 0, 1800, "open", true, false]);
    const text = JSON.stringify(view.body);
    for (const other of ["Meera", MEERA, "f-1"]) assert.ok(!text.includes(other), `${other} is not on Rohan's page`);
    const owner = (await c.ownerView()).body;
    const row = owner.parents.find((p: { phone: string }) => p.phone === ROHAN);
    assert.equal(row.link, "active");
    assert.equal(row.ref, view.body.ref);
    assert.ok(!JSON.stringify(owner).includes(hash), "the owner's page never carries the link or its hash");
    assert.equal(lines(c, "parent_link", "confirmed").filter((l) => l.conversation === ROHAN).length >= 1, true);
  });

  contract("'show how to pay' makes the UPI request for what is owed (the owner told what to look for); the page then shows how to pay; no WhatsApp message to the parent", async () => {
    const c = await centre();
    const hash = await sendLink(c, ROHAN);
    const before = c.sent(ROHAN).length;
    const upiBefore = lines(c, "upi_request").filter((l) => l.booking === "f-2").length;
    const { answer } = await c.press("fee_pay", hash, "f-2");
    assert.equal(answer.status, 200);
    const fee = (await c.parent(hash)).body.dues[0];
    assert.equal(fee.pay.kind, "upi");
    assert.equal(fee.pay.amountPaise, 180000);
    assert.match(fee.pay.link, /^upi:\/\/pay\?/u);
    assert.deepEqual(fee.pay.payTo, { id: "brighttuition@oksbi", name: "Bright Tuition" });
    assert.ok(lines(c, "upi_request").filter((l) => l.booking === "f-2").length >= Math.max(1, upiBefore), "a request exists for the fee");
    assert.equal(c.sent(ROHAN).length, before, "the page is the answer: nothing on WhatsApp");
    assert.equal(lines(c, "channel_fee", "confirmed").length, 1);
  });

  contract("'I have paid' marks nothing: a confirmation page that says waiting, the owner asked to look; once the owner marks it received the page says confirmed, and the receipt is the parent's", async () => {
    const c = await centre();
    const hash = await sendLink(c, ROHAN);
    const { hash: page } = await c.press("fee_paid", hash, "f-2", { upiRef: "412345678901" });
    const waiting = await c.request(page);
    assert.equal(waiting.status, 200);
    assert.deepEqual([waiting.body.status, waiting.body.ref, waiting.body.op], ["waiting", "f-2", "paid"]);
    assert.deepEqual((await c.status()).fees, { open: 2 });
    assert.equal((await c.parent(hash)).body.dues[0].claimed, true);
    const item = (await c.ownerView()).body.items.find((i: { case: string }) => i.case === "f-2");
    assert.equal(item.kind, "deposit");
    assert.equal(item.upiRef, "412345678901", "the UPI reference the parent typed helps the owner find it; it counts as nothing");
    await c.ownerAction("received", "f-2", item.digest);
    const done = await c.request(page);
    assert.equal(done.body.status, "confirmed");
    assert.equal(done.body.due.state, "paid");
    const docs = await c.call(`/internal/channel/documents?link=${hash}&lang=en`);
    assert.equal(docs.status, 200);
    assert.ok(docs.body.documents.length >= 1, "a receipt");
    assert.ok(!JSON.stringify(docs.body).includes("Meera"), "only the parent's own fees' documents");
    assert.equal((await c.call(`/internal/channel/documents?link=${hash}&lang=xx`)).status, 400);
    assert.equal((await c.call(`/internal/channel/documents?link=${hash}&handle=${page}`)).status, 400);
  });

  contract("a press on another parent's fee does nothing (refused on its page); a link switched off by the owner opens nothing, and a new one replaces the old", async () => {
    const c = await centre();
    const hash = await sendLink(c, ROHAN);
    const { hash: page } = await c.press("fee_paid", hash, "f-1"); // Meera's fee, through Rohan's link
    assert.deepEqual((await c.request(page)).body, { status: "refused", reason: "unknown" });
    assert.equal(lines(c, "channel_fee", "blocked").length, 1);
    assert.deepEqual((await c.ownerView()).body.items, [], "nothing waits for the owner");
    // the owner switches the link off: it opens nothing, at once
    const row = ((await c.ownerView()).body.parents as { phone: string; ref: string; digest: string }[]).find((p) => p.phone === ROHAN)!;
    await c.ownerAction("revoke_link", row.ref, row.digest);
    assert.equal((await c.parent(hash)).status, 404);
    const { hash: gone } = await c.press("fee_paid", hash, "f-2");
    assert.deepEqual((await c.request(gone)).body, { status: "refused", reason: "link_gone" });
    assert.equal(((await c.ownerView()).body.parents as { phone: string; link: string }[]).find((p) => p.phone === ROHAN)!.link, "none");
    // a stale digest does nothing; a new link works and the old still does not
    await c.ownerAction("send_link", row.ref, row.digest);
    assert.equal(c.linkOf(ROHAN)!.hash, hash, "the old digest sends nothing");
    const fresh = await sendLink(c, ROHAN);
    assert.equal((await c.parent(fresh)).status, 200);
    assert.equal((await c.parent(hash)).status, 404);
  });

  contract("a link survives a restart (the hash is in the saved state); a parent's page is never found by a number", async () => {
    const c = await centre();
    const hash = await sendLink(c, ROHAN);
    await c.stop(); await c.start();
    assert.equal((await c.parent(hash)).status, 200);
    assert.equal((await c.parent(parentLinkHash(ROHAN))).status, 404);
    assert.ok(!c.record().some((l) => l.entry.includes(c.linkOf(ROHAN)!.link)), "the link itself is never in the record");
    assert.ok(!c.record().some((l) => l.entry.includes(hash)), "nor its hash");
  });

  contract("a Razorpay centre's page pays by the fee's own link", async () => {
    const c = await centre({ example: "razorpay" });
    const hash = await sendLink(c, ROHAN);
    await c.press("fee_pay", hash, "f-2");
    const fee = (await c.parent(hash)).body.dues[0];
    assert.equal(fee.pay.kind, "link");
    assert.match(fee.pay.url, /^https?:\/\//u);
    assert.equal(c.guards!.of("payments", "POST", /^\/v1\/payment_links$/u).filter((x) => x.body.reference_id === "f-2.1").length, 1);
  });
});

