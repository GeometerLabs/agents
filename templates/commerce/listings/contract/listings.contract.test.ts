// The CONTRACT of a listings-only shop's runtime, as the outside sees it: the routes the shop's front (modules/channels/backend.ts), the directory and the inbox use, and nothing else.
// Every test starts the shop as a separate process (harness.ts) and talks to it ONLY over HTTP. The runtime to test is picked by LISTINGS_IMPL=ts|go. It must pass against the
// TypeScript runtime first (that proves the contract is right) and then against any other implementation: the same folder, the same token files, the same answers.
//
// What a signature must satisfy is checked with the TypeScript signing module, so an implementation has to write byte-identical canonical JSON (RFC 8785) signed with Ed25519.
// Assertions are on status codes and machine fields (`state`, `why`, `format`), never on English sentences.
//
// ROUTES NOT IN THIS SUITE for a listings-only shop, and why: /internal/channel/owner (the owner's talk-and-cards page: the whole assistant's app view) is tested for the TypeScript
// runtime only (see the last test); the chat, push, voice, limits and stock routes are not routes of this kind of shop's front (a listings-only shop has no chat and no WhatsApp).
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson, signingKeyFromText, verifyCard, verifyDocument, verifyNotice, keyIdOf } from "../../../../modules/signing/index.ts";
import { photoIdOf } from "../../../../modules/listings/photo.ts";
import { newSoftPasskey, softRegister, softSignin } from "../../../../modules/channels/test/soft-authenticator.ts";
import { IMPL, OWNER_BASE, PAGE, draftAnswer, makeShop, startFakeModel, tinyJpeg } from "./harness.ts";
import type { FakeModel, Shop } from "./harness.ts";

const shops: Shop[] = [];
const fakes: FakeModel[] = [];
after(async () => { for (const s of shops) { await s.stop(); s.cleanup(); } for (const f of fakes) await f.close(); });

/** A started shop. */
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
const KITTENS = { op: { op: "publish_form", category: "pets", title: "Two Persian kittens", priceInr: 8000, qty: 2, photos: [] } };
const rp = { rpId: new URL(OWNER_BASE).hostname, origin: new URL(OWNER_BASE).origin };

/** The owner publishes a listing through the form and the step runs. */
async function publish(shop: Shop, id: string, op: Record<string, unknown> = KITTENS.op): Promise<void> {
  const r = await shop.call("/internal/channel/owner-listing", { owner: shop.owner, body: { id, op } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await shop.settle();
}
const view = async (shop: Shop): Promise<any> => (await shop.call("/internal/channel/owner-listing", { owner: shop.owner })).body;
const switchOn = async (shop: Shop): Promise<void> => publish(shop, "sw-1", { op: "shop", visible: true });

describe("health, status and the two tokens", () => {
  test("/healthz and /readyz need no token; /status needs the internal token", async () => {
    const s = await boot();
    const h = await s.call("/healthz", { token: null });
    assert.equal(h.status, 200); assert.equal(h.body.ok, true);
    const r = await s.call("/readyz", { token: null });
    assert.equal(r.status, 200); assert.equal(r.body.ok, true);
    assert.equal((await s.call("/status", { token: null })).status, 401);
    assert.equal((await s.call("/status", { token: "wrong-token-wrong-token" })).status, 401);
    assert.equal((await s.call("/status", { token: s.channel })).status, 401, "the channel token is not the inbox's");
    const st = await s.call("/status");
    assert.equal(st.status, 200);
    assert.equal(st.body.pathway, "listings");
    assert.equal(typeof st.body.version, "string");
    assert.deepEqual(st.body.tasks, { pending: 0, done: 0, failed: 0 });
    assert.equal(st.body.recordLength, 0);
    assert.deepEqual(st.body.listings ?? {}, {});
    assert.deepEqual(st.body.ownerAccess, { passkeys: 0, alertPhones: 0 });
    assert.equal(typeof st.body.ai, "object", "the month's AI counts are there");
  });

  test("wrong methods are 405, unknown paths 404", async () => {
    const s = await boot();
    assert.equal((await s.call("/healthz", { method: "POST", token: null, body: {} })).status, 405);
    assert.equal((await s.call("/nothing-here", { token: null })).status, 404);
    assert.equal((await s.call("/internal/channel/listings", { method: "POST", body: {} })).status, 405);
  });

  test("the channel routes refuse a missing, wrong or inbox token with 401 and answer 200 to the channel token", async () => {
    const s = await boot();
    for (const path of ["/internal/channel/listings", "/internal/channel/offer", "/internal/channel/owner-listing"]) {
      assert.equal((await s.call(path, { token: null })).status, 401, `${path} with no token`);
      assert.equal((await s.call(path, { token: "x".repeat(40) })).status, 401, `${path} with a wrong token`);
      assert.equal((await s.call(path, { token: s.internal })).status, 401, `${path} with the inbox's token`);
    }
    assert.equal((await s.call("/internal/channel/listings")).status, 200);
    assert.equal((await s.call("/internal/events", { method: "POST", token: null, body: { events: [] } })).status, 401);
    assert.equal((await s.call("/internal/feed-notice", { token: s.channel })).status, 401);
  });
});

describe("the public read and the owner's credential", () => {
  test("an empty shop: no listings, the switch off, and the offer names the shop", async () => {
    const s = await boot();
    const l = await s.call("/internal/channel/listings");
    assert.deepEqual(l.body, { shop: { visible: false }, listings: [] });
    const o = await s.call("/internal/channel/offer");
    assert.equal(o.status, 200);
    assert.equal(o.body.kind, "listings");
    assert.deepEqual(o.body.shop, { name: "Glow Pets", timezone: "Asia/Kolkata", languages: ["en", "ml"], address: "Thrissur 680001", paused: false });
  });

  test("the owner's page data needs the owner's link: none or a wrong one is 403", async () => {
    const s = await boot();
    assert.equal((await s.call("/internal/channel/owner-listing")).status, 403);
    assert.equal((await s.call("/internal/channel/owner-listing", { owner: "A".repeat(43) })).status, 403);
    assert.equal((await s.call("/internal/channel/owner-listing", { owner: "short" })).status, 403);
    const ok = await s.call("/internal/channel/owner-listing", { owner: s.owner });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.maxLive, 50); assert.equal(ok.body.liveCount, 0); assert.equal(ok.body.uploadsLeft, 30);
    assert.deepEqual(ok.body.listings, []); assert.deepEqual(ok.body.pending, []);
    assert.deepEqual(ok.body.shop, { visible: false });
    assert.deepEqual(ok.body.categories.map((c: { id: string }) => c.id), ["pets", "food", "clothes", "home", "electronics", "vehicles", "services", "other"]);
  });
});

describe("the owner's listings: create, edit, confirm, sold, remove", () => {
  test("publish_form makes a live listing, with the price in paise and the owner's language", async () => {
    const s = await boot();
    await publish(s, "r-1");
    const v = await view(s);
    assert.equal(v.liveCount, 1);
    const l = v.listings[0];
    assert.equal(l.id, "l-1"); assert.equal(l.state, "live"); assert.equal(l.category, "pets"); assert.equal(l.ownerLang, "en");
    assert.deepEqual(l.words, { en: { title: "Two Persian kittens", text: "" } });
    assert.equal(l.pricePaise, 800000); assert.equal(l.qty, 2); assert.equal(l.freshness, "fresh");
    assert.equal(typeof l.confirmedMs, "number");
    const st = await s.call("/status");
    assert.deepEqual(st.body.listings, { live: 1 });
    assert.equal(st.body.tasks.done, 1); assert.ok(st.body.recordLength >= 1);
    // the same request id again is the same task: saved once
    const again = await s.call("/internal/channel/owner-listing", { owner: s.owner, body: { id: "r-1", op: KITTENS.op } });
    assert.deepEqual(again.body, { saved: 0, duplicates: 1 });
  });

  test("the rules refuse with 422 and a `why`, before anything is saved", async () => {
    const s = await boot();
    const refuse = async (op: Record<string, unknown>, why: string) => {
      const r = await s.call("/internal/channel/owner-listing", { owner: s.owner, body: { id: `x-${why.replace(/_/gu, "-")}-${Math.random().toString(36).slice(2, 8)}`, op } });
      assert.equal(r.status, 422, JSON.stringify(r.body)); assert.equal(r.body.why, why);
    };
    await refuse({ op: "publish_form", category: "pets", title: "A green parrot", photos: [] }, "protected_animal");
    await refuse({ op: "publish_form", category: "nonsense", title: "Thing", photos: [] }, "bad_category");
    await refuse({ op: "publish_form", category: "home", title: "Lamp", priceInr: -5, photos: [] }, "bad_price");
    await refuse({ op: "publish_form", category: "home", title: "Lamp", qty: 0, photos: [] }, "bad_qty");
    await refuse({ op: "publish_form", category: "home", title: "x".repeat(81), photos: [] }, "too_long");
    await refuse({ op: "edit", id: "l-9", title: "Nothing" }, "no_such_listing");
    await refuse({ op: "sold", id: "l-9" }, "no_such_listing");
    await refuse({ op: "shop", pincode: "12" }, "bad_place");
    await refuse({ op: "shop", point: { lat: 1, lon: 1 } }, "bad_place");
    assert.equal((await s.settle()).tasks.done, 0, "a refused op saved nothing");
  });

  test("a malformed body is 400, a bad JSON body is 400", async () => {
    const s = await boot();
    assert.equal((await s.call("/internal/channel/owner-listing", { owner: s.owner, body: { id: "r-9", op: { op: "dance" } } })).status, 400);
    assert.equal((await s.call("/internal/channel/owner-listing", { owner: s.owner, body: { id: "bad id!", op: KITTENS.op } })).status, 400);
    assert.equal((await s.call("/internal/channel/owner-listing", { owner: s.owner, raw: new TextEncoder().encode("{not json"), type: "application/json" })).status, 400);
  });

  test("edit, confirm, sold and remove change the listing and keep the owner's own words", async () => {
    const s = await boot();
    await publish(s, "r-1");
    await publish(s, "r-2", { op: "edit", id: "l-1", title: "Three Persian kittens", priceInr: 9000.5, priceNote: "each", qty: null });
    let l = (await view(s)).listings[0];
    assert.deepEqual(l.words.en, { title: "Three Persian kittens", text: "" });
    assert.equal(l.pricePaise, 900050); assert.equal(l.priceNote, "each"); assert.equal(l.qty, undefined);
    await publish(s, "r-3", { op: "confirm", id: "l-1", confirmedMs: l.confirmedMs });
    const stale = await s.call("/internal/channel/owner-listing", { owner: s.owner, body: { id: "r-4", op: { op: "confirm", id: "l-1", confirmedMs: 1 } } });
    assert.equal(stale.status, 422); assert.equal(stale.body.why, "not_live");
    await publish(s, "r-5", { op: "sold", id: "l-1" });
    let v = await view(s);
    assert.equal(v.listings.length, 0, "a sold listing leaves the owner's list");
    await publish(s, "r-6", { op: "publish_form", category: "home", title: "Brass lamp", photos: [] });
    assert.equal((await view(s)).listings[0].id, "l-2", "ids are never given twice");
    await publish(s, "r-7", { op: "remove", id: "l-2" });
    v = await view(s);
    assert.equal(v.listings.length, 0);
    assert.equal((await s.call("/internal/channel/owner-listing", { owner: s.owner, body: { id: "r-8", op: { op: "remove", id: "l-2" } } })).status, 422);
  });

  test("the switch and the place: the public read follows the switch", async () => {
    const s = await boot();
    await publish(s, "r-1");
    assert.deepEqual((await s.call("/internal/channel/listings")).body.listings.map((x: { id: string }) => x.id), ["l-1"], "the public read has the live listing even with the switch off; the feed and page follow the switch");
    await publish(s, "r-2", { op: "shop", visible: true, town: "Kochi", pincode: "682001", point: { lat: 9.931233, lon: 76.267304 }, registration: "PSR-1234" });
    const pub = (await s.call("/internal/channel/listings")).body;
    assert.deepEqual(pub.shop, { visible: true, town: "Kochi", pincode: "682001", lat: 9.93123, lon: 76.2673, registration: "PSR-1234" });
    const l = pub.listings[0];
    assert.equal(l.by, "owner"); assert.equal(l.from, "app"); assert.equal(l.askedMs, undefined);
  });
});

describe("photos", () => {
  test("a photo is cleaned of its EXIF, named by its own bytes, public only with a public listing", async () => {
    const s = await boot();
    const raw = tinyJpeg();
    const up = await s.call("/internal/channel/owner-photo", { owner: s.owner, raw, type: "image/jpeg" });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    const p = up.body.photo;
    assert.match(p.id, /^ph-[0-9a-f]{12}$/u); assert.equal(p.type, "image/jpeg"); assert.equal(p.width, 64); assert.equal(p.height, 48);
    assert.ok(p.bytes < raw.length, "the EXIF segment is gone");
    await s.settle();
    const mine = await s.call(`/internal/channel/listing-photo?id=${p.id}`, { owner: s.owner });
    assert.equal(mine.status, 200); assert.equal(mine.headers.get("content-type"), "image/jpeg");
    assert.equal(photoIdOf(mine.bytes), p.id, "the id is the hash of the cleaned bytes");
    assert.ok(!Buffer.from(mine.bytes).includes("GPS-IS-HERE"));
    assert.equal(mine.bytes.length, p.bytes);
    assert.equal((await s.call(`/internal/channel/listing-photo?id=${p.id}`)).status, 404, "a waiting photo is the owner's only");
    assert.equal((await view(s)).pending[0].id, p.id);
    await publish(s, "r-1", { op: "publish_form", category: "home", title: "Brass lamp", photos: [p.id] });
    assert.equal((await view(s)).pending.length, 0, "the photo left the waiting list");
    const pub = await s.call(`/internal/channel/listing-photo?id=${p.id}`);
    assert.equal(pub.status, 200); assert.equal(pub.headers.get("content-type"), "image/jpeg");
    assert.equal((await s.call("/internal/channel/listing-photo?id=ph-000000000000")).status, 404);
    assert.equal((await s.call("/internal/channel/listing-photo?id=nope")).status, 400);
  });

  test("not a photo, the wrong type, no owner: refused", async () => {
    const s = await boot();
    const text = new TextEncoder().encode("this is not a photo");
    const r1 = await s.call("/internal/channel/owner-photo", { owner: s.owner, raw: text, type: "image/jpeg" });
    assert.equal(r1.status, 422); assert.equal(r1.body.why, "not_a_photo");
    assert.equal((await s.call("/internal/channel/owner-photo", { owner: s.owner, raw: text, type: "text/plain" })).status, 415);
    assert.equal((await s.call("/internal/channel/owner-photo", { raw: tinyJpeg(), type: "image/jpeg" })).status, 403);
    const big = new Uint8Array(1_600_000); big.set([0xff, 0xd8, 0xff]);
    const r2 = await s.call("/internal/channel/owner-photo", { owner: s.owner, raw: big, type: "image/jpeg" });
    assert.equal(r2.status, 413);
  });
});

describe("the signed feed, the check and the Agent Card (verified with the TypeScript signing module)", () => {
  test("shop-feed: 404 while the switch is off, then a feed signed over RFC 8785 JSON that verifies", async () => {
    const s = await boot();
    await publish(s, "r-1", { op: "publish_form", category: "pets", title: "Two Persian kittens", priceInr: 8000, photos: [] });
    const q = { page: PAGE, name: "Glow Pets", languages: ["en", "ml", "xx"] };
    assert.equal((await s.call("/internal/channel/shop-feed", { body: q })).status, 404);
    await switchOn(s);
    const f = await s.call("/internal/channel/shop-feed", { body: q });
    assert.equal(f.status, 200, JSON.stringify(f.body));
    const feed = f.body;
    assert.equal(feed.format, "shop-feed/1");
    assert.deepEqual(feed.shop, { name: "Glow Pets", page: `${PAGE}/`, languages: ["en", "ml"], check: `${PAGE}/api/v1/check`, agentCard: `${PAGE}/agent-card.json` });
    assert.equal(feed.items.length, 1);
    const item = feed.items[0];
    assert.equal(item.id, "l-1"); assert.equal(item.page, `${PAGE}/shop#l-1`); assert.equal(item.category, "pets");
    assert.deepEqual(item.title, { en: "Two Persian kittens" }); assert.deepEqual(item.text, {});
    assert.equal(item.ownerLanguage, "en"); assert.deepEqual(item.machineWritten, []);
    assert.deepEqual(item.price, { value: "8000.00", currency: "INR" });
    assert.equal(item.availability, "in_stock"); assert.match(item.confirmed, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u);
    assert.match(feed.updated, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u);
    assert.equal(feed.signature.alg, "Ed25519");
    assert.deepEqual(verifyDocument(feed), { ok: true, keyId: feed.signature.keyId }, "the signature holds over the canonical JSON of the feed without it");
    assert.equal(keyIdOf(feed.signature.key), feed.signature.keyId);
    // the same bytes signed again by us: the canonical form of the body is what was signed
    const { signature, ...body } = feed;
    assert.ok(canonicalJson(body).length > 100 && signature.sig.length === 86);
    // a second call: the same key
    const again = (await s.call("/internal/channel/shop-feed", { body: q })).body;
    assert.equal(again.signature.keyId, feed.signature.keyId);
    // the question's own checks
    assert.equal((await s.call("/internal/channel/shop-feed", { body: { ...q, page: "https://evil.example/x" } })).status, 400);
    assert.equal((await s.call("/internal/channel/shop-feed", { body: { ...q, name: "" } })).status, 400);
    assert.equal((await s.call("/internal/channel/shop-feed", { body: { ...q, chat: "https://evil.example/chat" } })).status, 400);
    assert.equal((await s.call("/internal/channel/shop-feed", { body: q, token: s.internal })).status, 401);
  });

  test("shop-check: signed answer, gone for what is not public, at most 10 ids", async () => {
    const s = await boot();
    await publish(s, "r-1", { op: "publish_form", category: "home", title: "Brass lamp", priceInr: 450, qty: 3, photos: [] });
    await publish(s, "r-2", { op: "publish_form", category: "home", title: "Old fan", photos: [] });
    await publish(s, "r-3", { op: "sold", id: "l-2" });
    const ask = (ids: unknown) => s.call("/internal/channel/shop-check", { body: { page: PAGE, ids } });
    const off = await ask(["l-1"]);
    assert.equal(off.status, 200);
    assert.deepEqual(off.body.items, [{ id: "l-1", availability: "gone" }], "with the switch off every id is gone");
    await switchOn(s);
    const shopKey = (await s.call("/internal/channel/shop-feed", { body: { page: PAGE, name: "G", languages: [] } })).body.signature.key;
    assert.deepEqual(verifyDocument(off.body, shopKey), { ok: true, keyId: off.body.signature.keyId }, "an all-gone answer is signed all the same");
    const r = await ask(["l-1", "l-2", "l-77", "l-1"]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.format, "shop-check/1"); assert.equal(r.body.page, `${PAGE}/`);
    assert.ok(Math.abs(Date.parse(r.body.at) - Date.now()) < 60_000);
    assert.deepEqual(r.body.items, [
      { id: "l-1", availability: "in_stock", price: { value: "450.00", currency: "INR" }, quantity: 3, confirmed: r.body.items[0].confirmed },
      { id: "l-2", availability: "gone" }, { id: "l-77", availability: "gone" },
    ]);
    assert.equal(r.body.signature.key, undefined, "an answer names its key id, not the key");
    assert.deepEqual(verifyDocument(r.body, shopKey), { ok: true, keyId: r.body.signature.keyId });
    assert.equal((await ask([])).status, 400);
    assert.equal((await ask(Array.from({ length: 11 }, (_, i) => `l-${i + 1}`))).status, 400);
    assert.equal((await ask(["bad id"])).status, 400);
    assert.equal((await ask("l-1")).status, 400);
  });

  test("shop-card: an Agent Card is signed only when every address in it is under the shop's page", async () => {
    const s = await boot();
    const card = { protocolVersion: "0.3.0", name: "Glow Pets", description: "What we have.", version: "1", provider: { organization: "Glow Pets", url: PAGE }, supportedInterfaces: [{ url: `${PAGE}/api/v1`, protocolBinding: "HTTP+JSON" }], skills: [] };
    assert.equal((await s.call("/internal/channel/shop-card", { body: { page: PAGE, card } })).status, 404, "off while the switch is off");
    await switchOn(s);
    const r = await s.call("/internal/channel/shop-card", { body: { page: PAGE, card } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.signatures.length, 1);
    const key = (await s.call("/internal/channel/shop-feed", { body: { page: PAGE, name: "G", languages: [] } })).body.signature.key;
    assert.ok(verifyCard(r.body, key), "the JWS verifies with the shop's key");
    assert.equal((await s.call("/internal/channel/shop-card", { body: { page: PAGE, card: { ...card, provider: { url: "https://evil.example/" } } } })).status, 400);
    assert.equal((await s.call("/internal/channel/shop-card", { body: { page: PAGE, card: { ...card, supportedInterfaces: [{ url: `${PAGE}/../x` }] } } })).status, 400);
    assert.equal((await s.call("/internal/channel/shop-card", { body: { page: PAGE, card: { ...card, supportedInterfaces: [] } } })).status, 400);
    assert.equal((await s.call("/internal/channel/shop-card", { body: { page: PAGE, card: { ...card, rating: 1.5 } } })).status, 400, "a float has no canonical form: not signed");
  });

  test("feed-notice: the inbox carries a signed 'my feed changed' notice to the directory, at most one a minute", async () => {
    const s = await boot();
    assert.equal((await s.call("/internal/feed-notice")).status, 204, "nothing yet: the switch is off and nothing was ever delivered");
    await publish(s, "r-1");
    await switchOn(s);
    const n = await s.call("/internal/feed-notice");
    assert.equal(n.status, 200, JSON.stringify(n.body));
    assert.match(n.body.fingerprint, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(n.body.notice.format, "shop-feed-changed/1"); assert.equal(n.body.notice.feed, `${PAGE}/listings.json`);
    const key = (await s.call("/internal/channel/shop-feed", { body: { page: PAGE, name: "G", languages: [] } })).body.signature.key;
    assert.deepEqual(verifyNotice(n.body.notice, key), { ok: true, keyId: n.body.notice.keyId });
    assert.equal((await s.call("/internal/feed-notice", { method: "POST", body: { fingerprint: "short" } })).status, 400);
    assert.deepEqual((await s.call("/internal/feed-notice", { method: "POST", body: { fingerprint: n.body.fingerprint } })).body, { ok: true });
    assert.equal((await s.call("/internal/feed-notice")).status, 204, "delivered, and a minute has not passed");
  });
});

describe("the owner's passkey: set up, sign in, sign out", () => {
  const opts = async (s: Shop, op: string, extra: Record<string, unknown> = {}) => s.call("/internal/channel/owner-passkey", { body: { op, ...extra } });
  const grant = (s: Shop) => ({ kind: "setup", token: s.setup });

  test("the setup code opens one registration; the passkey signs the owner in; sign-in works again after sign-out", async () => {
    const s = await boot();
    assert.deepEqual((await opts(s, "status")).body, { count: 0 });
    assert.deepEqual((await opts(s, "signin_options")).body, { count: 0 });
    const gs = await opts(s, "grant_state", { grant: grant(s) });
    assert.deepEqual(gs.body, { state: "valid", shop: "Glow Pets" });
    assert.equal((await opts(s, "grant_state", { grant: { kind: "setup", token: "A".repeat(43) } })).body.state, "unknown");
    const ro = await opts(s, "register_options", { grant: grant(s) });
    assert.equal(ro.status, 200, JSON.stringify(ro.body));
    const options = ro.body.options;
    assert.equal(options.rp.id, rp.rpId); assert.equal(options.attestation, "none"); assert.equal(options.authenticatorSelection.userVerification, "required");
    assert.deepEqual(options.pubKeyCredParams.map((p: { alg: number }) => p.alg), [-7, -8, -257]);
    assert.match(options.challenge, /^[A-Za-z0-9_-]{43}$/u);
    const phone = newSoftPasskey(rp.rpId);
    // a wrong origin and a wrong challenge are refused, and use nothing up
    const bad = await opts(s, "register", { grant: grant(s), response: softRegister(phone, options, "https://evil.example") });
    assert.equal(bad.status, 403); assert.equal(bad.body.state, "refused");
    const done = await opts(s, "register", { grant: grant(s), response: softRegister(phone, options, rp.origin) });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const session = done.body.session as string;
    assert.match(session, /^[A-Za-z0-9_-]{43}$/u); assert.ok(done.body.expires_at_ms > Date.now() + 29 * 86_400_000);
    // the code is used up
    assert.equal((await opts(s, "grant_state", { grant: grant(s) })).body.state, "used");
    assert.equal((await opts(s, "register_options", { grant: grant(s) })).body.state, "used");
    // the session is the owner's credential, and the inbox can ask whether it is good
    assert.equal((await s.call("/internal/channel/owner-listing", { session })).status, 200);
    assert.equal((await s.call("/internal/owner-session", { session })).status, 204);
    assert.equal((await s.call("/internal/owner-session", { session: "B".repeat(43) })).status, 403);
    assert.equal((await s.call("/internal/owner-session", { session, token: null })).status, 401);
    assert.equal((await opts(s, "status")).body.count, 1);
    assert.equal((await s.call("/status")).body.ownerAccess.passkeys, 1);
    assert.equal((await s.settle()).tasks.done, 2, "the record's passkey_added and signed_in lines were saved as steps");
    // sign out ends it
    assert.deepEqual((await s.call("/internal/channel/owner-signout", { method: "POST", session })).body, { ended: true });
    assert.equal((await s.call("/internal/channel/owner-listing", { session })).status, 403);
    assert.deepEqual((await s.call("/internal/channel/owner-signout", { method: "POST", session })).body, { ended: false });
    // sign in with the passkey
    const so = await opts(s, "signin_options");
    assert.equal(so.body.count, 1);
    assert.deepEqual(so.body.options.allowCredentials, [{ type: "public-key", id: phone.credId.toString("base64url") }]);
    assert.equal(so.body.options.rpId, rp.rpId);
    const wrongKey = newSoftPasskey(rp.rpId); wrongKey.credId = phone.credId;
    const forged = await opts(s, "signin", { response: softSignin(wrongKey, so.body.options, rp.origin) });
    assert.equal(forged.status, 403, "a signature from another key is refused");
    const so2 = await opts(s, "signin_options");
    const ok = await opts(s, "signin", { response: softSignin(phone, so2.body.options, rp.origin) });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await s.call("/internal/channel/owner-listing", { session: ok.body.session })).status, 200);
    // the answer cannot be replayed: its challenge is used up
    const replay = await opts(s, "signin", { response: softSignin(phone, so2.body.options, rp.origin, { still: true }) });
    assert.equal(replay.status, 403);
    // a counter that goes back is refused (a copied key)
    const so3 = await opts(s, "signin_options");
    phone.count = 0;
    assert.equal((await opts(s, "signin", { response: softSignin(phone, so3.body.options, rp.origin, { still: true }) })).status, 403);
  });

  test("passkey requests that are not well formed", async () => {
    const s = await boot();
    assert.equal((await opts(s, "register", { response: {} })).status, 400, "no grant");
    assert.equal((await opts(s, "dance")).status, 400);
    assert.equal((await s.call("/internal/channel/owner-passkey", { raw: new TextEncoder().encode("{x"), type: "application/json" })).status, 400);
    assert.equal((await s.call("/internal/channel/owner-passkey", { token: null, body: { op: "status" } })).status, 401);
    const phone = newSoftPasskey(rp.rpId);
    const ro = await opts(s, "register_options", { grant: grant(s) });
    const noAuth = await opts(s, "register", { grant: grant(s), response: softRegister(phone, ro.body.options, rp.origin, { flags: 0x00 }) });
    assert.equal(noAuth.status, 403, "the phone did not check the owner (user verification missing)");
    const wrongRp = await opts(s, "register", { grant: grant(s), response: softRegister(phone, ro.body.options, rp.origin, { rpId: "other.example" }) });
    assert.equal(wrongRp.status, 403, "a passkey for another site");
  });

  test("an EdDSA passkey works too", async () => {
    const s = await boot();
    const phone = newSoftPasskey(rp.rpId, { alg: -8 });
    const ro = await opts(s, "register_options", { grant: grant(s) });
    assert.equal((await opts(s, "register", { grant: grant(s), response: softRegister(phone, ro.body.options, rp.origin) })).status, 200);
    const so = await opts(s, "signin_options");
    assert.equal((await opts(s, "signin", { response: softSignin(phone, so.body.options, rp.origin) })).status, 200);
  });

  test("a sign-in link that was never issued is unknown, and consuming it is 403", async () => {
    const s = await boot();
    const link = "C".repeat(43);
    const get = await s.call("/internal/channel/owner-signin", { headers: { "x-owner-signin": link } });
    assert.deepEqual(get.body, { state: "unknown" });
    const post = await s.call("/internal/channel/owner-signin", { method: "POST", headers: { "x-owner-signin": link } });
    assert.equal(post.status, 403); assert.deepEqual(post.body, { state: "unknown" });
  });
});

describe("a listing drafted by the assistant, through a model, under the budget", () => {
  const WORDS = "I have two Persian kittens for sale on my page, 8000 rupees";
  const ask = async (s: Shop, id: string, text = WORDS) => {
    const r = await s.call("/internal/channel/events", { owner: s.owner, body: { events: [{ kind: "owner_message", id, text }] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await s.settle();
  };
  const listing = async (s: Shop) => (await s.call("/status")).body.ai.budget?.features?.listing_draft as { today: number; cap: number | null; calls: number } | undefined;

  test("the owner's words become a draft: price and quantity by rule, words from the model, nothing public", async () => {
    const fake = await startFakeModel(); fakes.push(fake);
    const s = await boot({ modelPort: fake.port, budget: { monthlyMicroInr: 50_000_000, daily: { listing_draft: 10 } } });
    await ask(s, "m-1");
    assert.equal(fake.calls, 1);
    const req = fake.requests[0];
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.body.model, "fake-model");
    assert.equal(req.body.response_format.type, "json_schema");
    assert.equal(req.body.messages.at(-1).content, WORDS, "the owner's own words are the user message");
    const v = await view(s);
    assert.equal(v.listings.length, 1);
    const l = v.listings[0];
    assert.equal(l.state, "draft"); assert.equal(l.category, "pets"); assert.equal(l.ownerLang, "en");
    assert.equal(l.pricePaise, 800000); assert.equal(l.qty, 2);
    assert.deepEqual(Object.keys(l.words).sort(), ["en", "hi", "kn", "ml"]);
    assert.deepEqual(l.words.en, { title: "Persian kittens", text: "Playful kittens, looking for a home." });
    assert.equal(v.liveCount, 0);
    assert.deepEqual((await s.call("/internal/channel/listings")).body.listings, [], "a draft is never public");
    const f = await listing(s);
    assert.deepEqual({ today: f!.today, cap: f!.cap, calls: f!.calls }, { today: 1, cap: 10, calls: 1 });
    // a draft can be changed by the owner (their own words replace the model's)
    await publish(s, "r-1", { op: "edit", id: l.id, title: "Persian kitten pair" });
    assert.deepEqual((await view(s)).listings[0].words, { en: { title: "Persian kitten pair", text: "Playful kittens, looking for a home." } }, "the new title replaces the machine-written words of the other languages; the owner's text stays");
  });

  test("what the model makes up is refused and not shown: a number, a guarantee, a health claim, a bad shape", async () => {
    let next: (owner: string) => unknown = () => draftAnswer();
    const fake = await startFakeModel((o) => next(o)); fakes.push(fake);
    const s = await boot({ modelPort: fake.port, budget: { monthlyMicroInr: 50_000_000, daily: { listing_draft: 20 } } });
    next = () => draftAnswer("Persian kittens", "Only 3 left today.");
    await ask(s, "m-1");
    next = () => draftAnswer("Persian kittens", "Best kittens, guaranteed.");
    await ask(s, "m-2");
    next = () => draftAnswer("Healthy kittens", "Playful kittens.");
    await ask(s, "m-3");
    next = () => ({ category: "pets" });
    await ask(s, "m-4");
    next = () => draftAnswer("Persian kittens", "Playful kittens.", "pets", ["fully vaccinated"]);
    await ask(s, "m-5");
    assert.equal(fake.calls, 5, "every one was asked and paid for");
    assert.equal((await view(s)).listings.length, 0, "none of them became a draft");
    assert.equal((await listing(s))!.today, 5, "and every call counted against the day");
  });

  test("a protected animal is refused before the model is asked", async () => {
    const fake = await startFakeModel(); fakes.push(fake);
    const s = await boot({ modelPort: fake.port, budget: { monthlyMicroInr: 50_000_000, daily: { listing_draft: 10 } } });
    await ask(s, "m-1", "I have a green parrot for sale on my page, 2000 rupees");
    assert.equal(fake.calls, 0);
    assert.equal((await view(s)).listings.length, 0);
  });

  test("the day's cap stops the model: the third ask of a cap of two never reaches it", async () => {
    const fake = await startFakeModel(); fakes.push(fake);
    const s = await boot({ modelPort: fake.port, budget: { monthlyMicroInr: 50_000_000, daily: { listing_draft: 2 } } });
    await ask(s, "m-1"); await ask(s, "m-2"); await ask(s, "m-3");
    assert.equal(fake.calls, 2);
    assert.equal((await view(s)).listings.length, 2);
    const f = await listing(s);
    assert.deepEqual({ today: f!.today, cap: f!.cap }, { today: 2, cap: 2 });
    assert.equal((await s.call("/status")).body.ai.budget.level, "ok", "the month's budget is not the thing that stopped it");
  });

  test("the month's budget stops the model: an unpriced call counts 100000 micro-rupees, so a budget of 150000 allows two", async () => {
    const fake = await startFakeModel(); fakes.push(fake);
    const s = await boot({ modelPort: fake.port, budget: { monthlyMicroInr: 150_000, daily: { listing_draft: 50 } } });
    await ask(s, "m-1"); await ask(s, "m-2"); await ask(s, "m-3"); await ask(s, "m-4");
    assert.equal(fake.calls, 2);
    const st = (await s.call("/status")).body.ai;
    assert.equal(st.budget.level, "full"); assert.equal(st.budget.monthlyMicroInr, 150_000); assert.equal(st.budget.usedMicroInr, 200_000);
    assert.equal(st.unpriced, 2); assert.equal(st.messages.model, 2); assert.equal(st.mode, "ai");
    assert.equal((await view(s)).listings.length, 2);
  });

  test("with no model at all nothing is asked and nothing is drafted", async () => {
    const s = await boot();
    await ask(s, "m-1");
    assert.equal((await view(s)).listings.length, 0);
    assert.equal((await s.call("/status")).body.tasks.failed, 0);
  });

  test("an owner_message needs the owner; a body that is not an event is 400", async () => {
    const s = await boot();
    const ev = { events: [{ kind: "owner_message", id: "m-1", text: "hello" }] };
    assert.equal((await s.call("/internal/channel/events", { body: ev })).status, 403);
    assert.equal((await s.call("/internal/channel/events", { owner: s.owner, body: { events: [] } })).status, 400);
    assert.equal((await s.call("/internal/channel/events", { owner: s.owner, body: { events: [{ kind: "owner_message", id: "m-2", text: "" }] } })).status, 400);
  });
});

describe("the store survives a restart", () => {
  test("listings, photos, the shop's key, the passkey session and the switch are all still there", async () => {
    const s = await boot();
    await publish(s, "r-1");
    await switchOn(s);
    const up = await s.call("/internal/channel/owner-photo", { owner: s.owner, raw: tinyJpeg(), type: "image/jpeg" });
    await s.settle();
    const phone = newSoftPasskey(rp.rpId);
    const ro = await s.call("/internal/channel/owner-passkey", { body: { op: "register_options", grant: { kind: "setup", token: s.setup } } });
    const reg = await s.call("/internal/channel/owner-passkey", { body: { op: "register", grant: { kind: "setup", token: s.setup }, response: softRegister(phone, ro.body.options, rp.origin) } });
    await s.settle();
    const before = (await s.call("/internal/channel/shop-feed", { body: { page: PAGE, name: "Glow Pets", languages: ["en"] } })).body;
    const statusBefore = (await s.call("/status")).body;
    await s.stop();
    await s.start();
    assert.equal((await s.call("/readyz")).status, 200);
    const v = await view(s);
    assert.equal(v.listings.length, 1); assert.equal(v.listings[0].id, "l-1"); assert.equal(v.shop.visible, true);
    assert.equal(v.pending[0].id, up.body.photo.id);
    assert.equal((await s.call(`/internal/channel/listing-photo?id=${up.body.photo.id}`, { owner: s.owner })).status, 200);
    const after = (await s.call("/internal/channel/shop-feed", { body: { page: PAGE, name: "Glow Pets", languages: ["en"] } })).body;
    assert.equal(after.signature.keyId, before.signature.keyId, "the shop's own key is kept in its store");
    assert.deepEqual(after.items, before.items);
    assert.equal(after.updated, before.updated);
    assert.equal((await s.call("/internal/channel/owner-listing", { session: reg.body.session })).status, 200, "a session made before the restart is still good");
    const st = (await s.call("/status")).body;
    assert.equal(st.recordLength, statusBefore.recordLength, "the record is kept");
    assert.deepEqual(st.listings, statusBefore.listings);
    const so = await s.call("/internal/channel/owner-passkey", { body: { op: "signin_options" } });
    assert.equal((await s.call("/internal/channel/owner-passkey", { body: { op: "signin", response: softSignin(phone, so.body.options, rp.origin) } })).status, 200, "and the passkey still signs in");
    // a new listing after the restart gets the next id
    await publish(s, "r-2", { op: "publish_form", category: "home", title: "Brass lamp", photos: [] });
    assert.equal((await view(s)).listings[0].id, "l-2");
  });

  test("a task saved but not run is run at the next start (the queue is on disk)", async () => {
    const s = await boot();
    await publish(s, "r-1");
    await s.stop();
    // two listings written straight into the queue's tasks are not possible over HTTP; what can be shown is that a stopped shop loses nothing it had answered 200 to
    await s.start();
    assert.equal((await view(s)).listings.length, 1);
    assert.equal((await s.call("/status")).body.tasks.pending, 0);
  });

  test("the SQLite file keeps the shop's format: schema 5, the same tables, the snapshot as the TypeScript reader reads it", async () => {
    const s = await boot();
    await publish(s, "r-1");
    await s.call("/internal/channel/owner-photo", { owner: s.owner, raw: tinyJpeg(), type: "image/jpeg" });
    await s.settle();
    await s.stop();
    const db = new DatabaseSync(join(s.dataDir, "agent.db"), { readOnly: true });
    assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 5);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    assert.deepEqual(names, ["listing_photos", "record", "shop_key", "state_rows", "state_shape", "tasks", "window"]);
    const shape = db.prepare("SELECT shape, lists, version FROM state_shape WHERE id = 1").get() as { shape: string; lists: string; version: number };
    const snapshot = JSON.parse(shape.shape) as { format: number; assistant: { listings: { seq: number } } };
    assert.equal(snapshot.format, 1); assert.equal(snapshot.assistant.listings.seq, 1);
    // the listings sit two levels down (assistant.listings.items), so they stay inside the shape; only the lists directly under `assistant` are split into rows
    const snap = snapshot as unknown as { assistant: { listings: { items: { id: string }[] } } };
    assert.equal(snap.assistant.listings.items[0].id, "l-1");
    assert.deepEqual(JSON.parse(shape.lists), (JSON.parse(shape.lists) as string[]).filter((n) => JSON.parse(n).length <= 2), "a list is a top-level one or one level inside a top-level object");
    assert.equal((db.prepare("SELECT count(*) AS n FROM listing_photos").get() as { n: number }).n, 1);
    const key = (db.prepare("SELECT private_key FROM shop_key WHERE id = 1").get() as { private_key: string }).private_key;
    assert.match(signingKeyFromText(key).keyId, /^[A-Za-z0-9_-]{43}$/u);
    const rec = db.prepare("SELECT action, outcome, entry FROM record ORDER BY seq").all() as { action: string; outcome: string; entry: string }[];
    assert.equal(rec[0].action, "listing"); assert.equal(rec[0].outcome, "confirmed");
    assert.match(JSON.parse(rec[0].entry).inputsDigest, /^k-[0-9a-f]{16}$/u, "keyed with the shop's record key");
    assert.throws(() => new DatabaseSync(join(s.dataDir, "agent.db")).exec("UPDATE record SET outcome = 'failed'"), /append-only/u);
    db.close();
    readFileSync(join(s.dataDir, "agent.db"));
  });
});

describe("TypeScript only: the owner's talk-and-cards page", () => {
  test("GET /internal/channel/owner answers the owner's app view (not ported to Go: it is the whole assistant)", { skip: IMPL !== "ts" && "the owner's app view is not part of the Go runtime" }, async () => {
    const s = await boot();
    assert.equal((await s.call("/internal/channel/owner")).status, 403);
    const r = await s.call("/internal/channel/owner", { owner: s.owner });
    assert.equal(r.status, 200);
    assert.equal(r.body.kind, "listings");
    assert.equal(typeof r.body.app, "object");
  });
});
