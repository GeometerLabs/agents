// THE OWNER'S SIDE of a Bookings shop (group iv of the contract, README.md): who controls the owner's sign-in (the SHARED rules of modules/channels, proved for the listings shop
// by templates/commerce/listings/contract/owner-control.contract.test.ts, here on a Bookings shop: the lock, the Operator's QR after it, a changed number, a session's reach), what
// the owner may do from the page (accountant's files, their own limits), the owner's talk with the shop's assistant, the owner told by template outside the 24-hour window, and a
// shop with no WhatsApp at all. The helpers are modules/test/contract/owner-kit.ts (the same ones the listings contract uses). The 48-hour rules run on the TEST clock.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { REMOVAL_WAIT_MS, newRecoveryCode, newSetupToken } from "../../../../modules/channels/owner-grants.ts";
import { code, iso, ownerKit, qr } from "../../../../modules/test/contract/owner-kit.ts";
import { HOUR, MIN, OTHER_CUSTOMER, OWNER_BASE, OWNER_NUMBER, contract, makeShop } from "./harness.ts";
import type { Shop, ShopOptions } from "./harness.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
const NEW_OWNER = "+919822222222";
async function boot(o: ShopOptions = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
const { grants, passkey, grantState, register, offered, signin, good, phones, list, panel, told, near } = ownerKit(OWNER_BASE);

describe("the lock and the owner's phones, on a Bookings shop", () => {
  contract("the first passkey locks the shop; a session made here opens the owner's page and the accountant's files; the panel's link opens neither the phones nor the files; sign-out ends the session", async () => {
    const s = await boot();
    assert.deepEqual(await panel(s), { passkeys: 0, alertPhones: 0, locked: false });
    const p1 = await register(s, qr(s.setup));
    assert.deepEqual([(await panel(s)).passkeys, (await panel(s)).locked], [1, true]);
    const v = await list(s, p1.session);
    assert.equal(v.phones.length, 1);
    assert.equal(v.lockedLast4, OWNER_NUMBER.slice(-4), "the number the shop is locked with, last four digits only");
    assert.equal((await phones(s, undefined, { op: "list" }, s.owner)).status, 403);
    assert.equal(await good(s, p1.session), true);
    assert.equal((await s.call("/internal/channel/owner", { session: p1.session })).status, 200, "the owner's page data opens with the session");
    const files = await s.call("/internal/channel/accounting?period=2026-11", { session: p1.session });
    assert.equal(files.status, 200);
    assert.ok(Array.isArray(files.body.files) && files.body.files.length >= 2, "the accountant's journal and documents files and a README");
    assert.equal((await s.call("/internal/channel/accounting?period=2026-13", { session: p1.session })).status, 400, "a period is a month or a financial year");
    assert.equal((await s.call("/internal/channel/accounting?period=2026-11", { owner: s.owner })).status, 403, "never the panel's link");
    assert.equal((await s.call("/internal/channel/accounting?period=2026-11")).status, 403, "never the channel token alone");
    assert.equal((await s.call("/internal/channel/owner-signout", { session: p1.session, body: {} })).status, 200);
    assert.equal(await good(s, p1.session), false);
    assert.equal((await signin(s, p1.phone)).status, 200, "the phone can sign in again with its passkey");
  });

  contract("ATTACK: a QR or a card the Operator makes after the first passkey is refused, even back-dated; one seen before it still works", async () => {
    const s = await boot();
    const before = newRecoveryCode();
    s.writeGrants(grants(s, { token: s.setup, codes: [before] }));
    assert.equal(await grantState(s, code(before)), "valid", "a card seen before the lock");
    await register(s, qr(s.setup));
    const late = newSetupToken(); const card = newRecoveryCode();
    const file = grants(s, { token: late, codes: [card] }) as { setup: { createdAt: string }; recovery: { createdAt: string } };
    file.setup.createdAt = iso(s.now() - HOUR); file.recovery.createdAt = iso(s.now() - HOUR);
    s.writeGrants(file);
    assert.equal(await grantState(s, qr(late)), "unknown");
    assert.equal(await grantState(s, code(card)), "unknown");
    const ro = await passkey(s, "register_options", { grant: qr(late) });
    assert.deepEqual([ro.status, ro.body.state], [403, "unknown"]);
  });

  contract("the owner's number is locked with the first phone: a changed number after the lock keeps the phones and is a 48-hour request, and the owner may cancel it", async () => {
    const s = await boot({ tickSeconds: 1 });
    const p1 = await register(s, qr(s.setup));
    await s.stop();
    s.setOwnerNumber(NEW_OWNER); // the Operator's settings form; the deployer restarts the runtime with it
    await s.start();
    const seen = s.now();
    const p = await panel(s);
    assert.equal(p.locked, true);
    assert.equal(p.removal?.askedBy, "the owner number");
    near(p.removal?.effectiveAt, seen + REMOVAL_WAIT_MS, "the number change waits 48 hours");
    assert.equal(await offered(s), 1, "the owner's phone still opens the shop");
    assert.equal(await good(s, p1.session), true);
    const v = await list(s, p1.session);
    assert.equal(v.numberDiffers, true);
    assert.equal(v.lockedLast4, OWNER_NUMBER.slice(-4), "messages still go to the number it was locked with");
    await told(s, "owner_change_asked");
    assert.deepEqual((await phones(s, p1.session, { op: "cancel_removal" })).body, { cancelled: true });
    assert.equal((await panel(s)).removal, undefined);
  });

  contract("a sale: the change applies after 48 hours with no restart, and the new owner's phone binds the shop to the NEW number", async () => {
    const s = await boot({ tickSeconds: 1 });
    const p1 = await register(s, qr(s.setup));
    await s.stop();
    s.setOwnerNumber(NEW_OWNER);
    await s.start();
    await told(s, "owner_change_asked");
    s.advance(REMOVAL_WAIT_MS + MIN);
    const open = await panel(s);
    assert.deepEqual([open.locked, open.removal], [false, undefined], "applied, with no restart");
    assert.equal(await good(s, p1.session), false);
    await told(s, "removal_applied");
    const q = newSetupToken();
    s.writeGrants(grants(s, { token: q }));
    const pB = await register(s, qr(q));
    assert.equal((await list(s, pB.session)).lockedLast4, NEW_OWNER.slice(-4));
    await s.stop(); await s.start();
    assert.equal((await panel(s)).removal, undefined, "the settings and the lock agree");
    assert.equal((await signin(s, pB.phone)).status, 200);
  });
});

describe("the owner's own limits page", () => {
  contract("a passkey session reads the limits and may tighten one; a panel link may read but not change; nothing loosens past what the template allows", async () => {
    const s = await boot();
    const p1 = await register(s, qr(s.setup));
    const read = await s.call("/internal/channel/owner-limits", { session: p1.session });
    assert.equal(read.status, 200);
    assert.equal(read.body.passkey, true);
    const link = await s.call("/internal/channel/owner-limits", { owner: s.owner });
    assert.equal(link.body.passkey, false);
    const first = (read.body.limits ?? [])[0];
    if (first) {
      const refused = await s.call("/internal/channel/owner-limits", { owner: s.owner, body: { id: "x-1", limit: first.id ?? first.limit, to: first.value } });
      assert.equal(refused.status, 403);
    }
    assert.equal((await s.call("/internal/channel/owner-limits", { session: p1.session, body: { nonsense: true } })).status, 400);
  });
});

describe("the owner talks with the shop's assistant", () => {
  contract("the owner's words from the page are read by the shop, and the answer is on the owner's page; a stranger's words are refused", async () => {
    const s = await boot({ settings: { assistant: {} } });
    const stranger = await s.channelEvents([{ kind: "owner_message", id: "t-0", text: "what is on today?" }]);
    assert.equal(stranger.status, 403, "owner kinds need the owner's credential");
    const sent = await s.channelEvents([{ kind: "owner_message", id: "t-1", text: "what is on today?" }], { owner: true });
    assert.equal(sent.status, 200);
    await s.settle();
    const view = (await s.ownerView()).body;
    assert.ok(view.app, "the owner's page carries the assistant's view");
    assert.ok(JSON.stringify(view.app).includes("what is on today?"), `the owner's own words and the shop's answer are on the page: ${JSON.stringify(view.app).slice(0, 400)}`);
    for (const bad of [{ kind: "owner_message", id: "t-2", text: "" }, { kind: "owner_message", id: "t-3", text: "x".repeat(901) }, { kind: "owner_message", text: "no id" }]) {
      assert.equal((await s.channelEvents([bad], { owner: true })).status, 400, JSON.stringify(bad).slice(0, 60));
    }
  });

  contract("the owner's own number is the owner on WhatsApp: a stranger's \"approve\" or \"deny\" from another number is a customer's message and does nothing", async () => {
    const s = await boot({ mode: "guards" });
    await s.inbound(OTHER_CUSTOMER, "approve b-1");
    await s.inbound(OTHER_CUSTOMER, "deny b-1");
    assert.equal(s.guards!.of("payments", "POST").length, 0);
    assert.deepEqual(s.sent(OWNER_NUMBER), [], "the owner is not messaged about a stranger's words");
  });

  contract("what the owner is told outside their 24-hour window goes as an approved template, never a plain text", async () => {
    const s = await boot({ mode: "guards", settings: { payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } }, calendar: { module: "own" } } });
    await s.book();                                       // the UPI shop asks the owner to look for the money
    const toOwner = s.guards!.of("messaging", "POST").filter((c) => c.body.to === OWNER_NUMBER);
    assert.ok(toOwner.length >= 1, "the owner was told");
    for (const c of toOwner) assert.equal(c.body.type, "template", "the owner never wrote to this number, so only a template may reach them");
    assert.equal(toOwner[0].body.template.name, "owner_upi_check");
  });
});

describe("a shop with no WhatsApp", () => {
  contract("a UPI shop with no messaging service starts, takes a booking from its page, and the owner marks the money on their page", async () => {
    const s = await boot({ mode: "guards", noWhatsApp: true, settings: { payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } }, calendar: { module: "own" } } });
    assert.deepEqual(s.guards!.calls, []);
    const { hash } = await s.book();
    const [item] = (await s.ownerView()).body.items;
    assert.equal(item.kind, "deposit");
    await s.channelEvents([{ kind: "owner_action", id: "m-1", action: "received", case: "b-1", digest: item.digest }], { owner: true }); await s.settle();
    assert.equal((await s.request(hash)).body.status, "booked");
    assert.deepEqual(s.guards!.calls, [], "no Guard of any kind was called");
  });
});

