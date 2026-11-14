// Item 11h, the shared parts: the events an Orders page and a parent's fees page may hand a runtime (checked for shape, never carrying a price or a number that finds
// fees), the Orders API and MCP lists kept equal to the one operations list, and the parent link's hash kept apart from every handle's. The end-to-end tests are the
// templates' own (templates/commerce/orders/test/channels.test.ts, templates/education/fees/test/channels.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { channelEventKey, checkChannelEvent } from "../events.ts";
import { handleHash, newHandle, parentLinkHash } from "../handle.ts";
import { ORDER_OPERATIONS, linesOf } from "../order-ops.ts";
import { API_ROUTES, ORDER_API_ROUTES, orderApiOperation } from "../api.ts";
import { ORDER_TOOLS, TOOLS } from "../mcp.ts";
import { OPERATIONS } from "../ops.ts";

const hash = "a".repeat(64);
const order = { kind: "channel_request", id: "r-1", channel: "web", op: "order", handle: hash, lines: [{ itemId: "veg-thali", qty: 2 }], date: "2026-11-17", mode: "pickup", slotId: "lunch", name: "Asha", phone: "+919811111111", language: "en" };

test("an order event is read for its shape only, and a price sent with it is never kept", () => {
  const checked = checkChannelEvent({ ...order, priceInr: 1, totalInr: 1, lines: [{ itemId: "veg-thali", qty: 2, priceInr: 1 }] });
  assert.ok(checked.ok);
  assert.equal(JSON.stringify(checked.event).includes("priceInr"), false, "no price reaches the runtime: the agent reads every price from the settings");
  assert.equal(JSON.stringify(checked.event).includes("totalInr"), false);
  for (const [bad, why] of [
    [{ lines: [] }, "no lines"], [{ lines: [{ itemId: "veg-thali", qty: 0 }] }, "a zero"], [{ lines: [{ itemId: "veg-thali", qty: 100 }] }, "too many of one"],
    [{ lines: [{ itemId: "a", qty: 1 }, { itemId: "a", qty: 1 }] }, "an item twice"], [{ date: "17 Nov" }, "a day not YYYY-MM-DD"], [{ mode: "drone" }, "no such way"],
    [{ mode: "delivery" }, "a delivery with no address"], [{ phone: "98111 11111" }, "a number not in full"], [{ name: "4sha" }, "a name with digits"],
  ] as const) assert.equal(checkChannelEvent({ ...order, ...bad }).ok, false, why);
  assert.equal(channelEventKey(checked.event), `channel_book:${hash}`, "one task per handle, the key the runtime reads for \"pending\"");
});

test("a parent's press comes from their page only, carries their link's hash and a fee's id, and nothing else", () => {
  const press = { kind: "channel_request", id: "r-2", channel: "web", op: "fee_paid", parent: hash, dueId: "f-3", handle: "b".repeat(64) };
  const checked = checkChannelEvent({ ...press, phone: "+919811111111" });
  assert.ok(checked.ok);
  assert.equal(JSON.stringify(checked.event).includes("9811111111"), false, "a number sent with it is dropped: it never finds fees");
  assert.equal(checkChannelEvent({ ...press, channel: "mcp" }).ok, false, "no AI assistant reaches fees");
  assert.equal(checkChannelEvent({ ...press, parent: "+919811111111" }).ok, false, "the parent is a link's hash, never a number");
  assert.equal(checkChannelEvent({ ...press, dueId: "b-3" }).ok, false, "a fee's id");
  assert.equal(channelEventKey(checked.event), `channel_book:${"b".repeat(64)}`, "one confirmation page per press");
});

test("the owner's page may switch a parent's link off or send a new one, by the parent's reference and the digest shown", () => {
  for (const action of ["send_link", "revoke_link"]) assert.ok(checkChannelEvent({ kind: "owner_action", id: "a-1", action, case: "p-0123456789ab", digest: "c".repeat(32) }).ok, action);
});

test("the ordering API and MCP offer exactly the Orders operations, and none marks a payment or approves a refund", () => {
  assert.deepEqual(Object.keys(ORDER_API_ROUTES), [...ORDER_OPERATIONS]);
  assert.deepEqual(ORDER_TOOLS.map((t) => t.name), [...ORDER_OPERATIONS]);
  for (const t of ORDER_TOOLS) assert.doesNotMatch(t.name, /mark|approve|refund|confirm/u);
  assert.ok(!ORDER_TOOLS.some((t) => JSON.stringify(t.inputSchema).includes("price")), "no tool takes a price");
  assert.equal(orderApiOperation("POST", "/api/v1/orders"), "start_order");
  assert.equal(orderApiOperation("GET", "/api/v1/orders/x/payment"), "payment_instructions");
  assert.equal(orderApiOperation("POST", "/api/v1/bookings"), undefined, "an Orders shop has no booking route");
  // Bookings' lists are untouched
  assert.deepEqual(Object.keys(API_ROUTES), [...OPERATIONS]);
  assert.deepEqual(TOOLS.map((t) => t.name), [...OPERATIONS]);
  assert.deepEqual(linesOf([{ item_id: "veg-thali", qty: 2 }]), [{ itemId: "veg-thali", qty: 2 }]);
  assert.deepEqual(linesOf([{ item_id: "veg-thali", qty: 2, price_inr: 1 }]), [{ itemId: "veg-thali", qty: 2 }], "a price sent with a line is not read");
});

test("a parent's link hashes apart from every handle: one can never open the other", () => {
  const s = newHandle();
  assert.notEqual(parentLinkHash(s), handleHash(s));
  assert.match(parentLinkHash(s), /^[0-9a-f]{64}$/u);
});

test("\"I have paid\" may carry the UPI reference the customer typed: digits only, kept for a paid press and dropped from anything else (it counts as nothing)", () => {
  const paid = { kind: "channel_request", id: "r-5", channel: "web", op: "paid", handle: hash };
  const keep = checkChannelEvent({ ...paid, upiRef: " 412345678901 " });
  assert.ok(keep.ok && keep.event.kind === "channel_request" && "upiRef" in keep.event && keep.event.upiRef === "412345678901", "trimmed digits are kept");
  for (const bad of ["see my screenshot", "<script>1</script>", "12345", "1".repeat(23), "4123 4567 8901", "https://x.example/1234567890", 412345678901]) {
    const dropped = checkChannelEvent({ ...paid, upiRef: bad });
    assert.ok(dropped.ok, "the claim itself is still taken");
    assert.equal(JSON.stringify(dropped.event).includes("upiRef"), false, `${String(bad)} is dropped`);
  }
  assert.equal(JSON.stringify((checkChannelEvent({ ...paid, op: "cancel", upiRef: "412345678901" }) as { event: unknown }).event).includes("upiRef"), false, "a cancel carries none");
  const fee = { kind: "channel_request", id: "r-6", channel: "web", op: "fee_paid", parent: hash, dueId: "f-3", handle: "b".repeat(64), upiRef: "412345678901" };
  const kept = checkChannelEvent(fee);
  assert.ok(kept.ok && "upiRef" in kept.event && kept.event.upiRef === "412345678901");
  assert.equal(JSON.stringify((checkChannelEvent({ ...fee, op: "fee_pay" }) as { event: unknown }).event).includes("upiRef"), false, "asking how to pay carries none");
});

test("the owner page's answers include the cash mark (money clarity), and only by the digest shown", () => {
  const ok = checkChannelEvent({ kind: "owner_action", id: "o-1", action: "cash", case: "f-3", digest: "a".repeat(32) });
  assert.ok(ok.ok);
  assert.equal(checkChannelEvent({ kind: "owner_action", id: "o-2", action: "cash", case: "f-3", digest: "x" }).ok, false, "no digest, no mark");
});
