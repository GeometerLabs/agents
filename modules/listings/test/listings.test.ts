// The shop's listings (modules/listings/listings.ts): who may write, a customer cannot, the limits, freshness and hiding, a sold listing hides itself, ids are never reused, the pets
// rules, and the words in four languages. Written, not run, in the 18 Nov build stream: the lead's test pass runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DAY } from "../../core/time.ts";
import { ownerAuthority, panelAuthority } from "../../memory/memory.ts";
import type { Authority } from "../../memory/memory.ts";
import {
  FRESH_MS, HIDE_AFTER_MS, MAX_LIVE, confirm, draft, dueAsks, emptyListings, freshnessOf, hiddenListings, isPublic, markSold, noteUpload, protectedAnimalIn, publicListings, publish, remove,
  setShop, textIn, tidyListings, edit, takePhotos, pendingPhotos, UPLOADS_PER_DAY,
} from "../listings.ts";
import type { DraftInput, ListingsState } from "../listings.ts";
import { LISTING_WORDS, freshnessLine, listingReviewLines, priceLine } from "../words.ts";

const NOW = 1_800_000_000_000;
const c = (nowMs = NOW) => ({ nowMs });
const owner = ownerAuthority("app");
const kitten = (extra: Partial<DraftInput> = {}): DraftInput => ({ category: "pets", ownerLang: "en", words: { en: { title: "Persian kitten", text: "Two kittens, playful." } }, pricePaise: 800000, priceNote: "each", qty: 2, ...extra });
const live = (s: ListingsState, input: DraftInput = kitten()) => {
  const d = draft(s, input, c());
  assert.ok(d.ok);
  const p = publish(s, owner, d.value.id, c());
  assert.ok(p.ok);
  return p.value;
};

test("a draft is not public, and only an authority this repo made can publish it", () => {
  const s = emptyListings();
  const d = draft(s, kitten(), c());
  assert.ok(d.ok);
  assert.equal(d.value.state, "draft");
  assert.equal(publicListings(s, NOW).length, 0);
  const forged = { by: "owner", from: "app" } as Authority;
  assert.throws(() => publish(s, forged, d.value.id, c()), /Only the owner/u);
  assert.throws(() => publish(s, undefined as never, d.value.id, c()));
  assert.equal(s.items[0].state, "draft");
  const p = publish(s, panelAuthority("operator"), d.value.id, c());
  assert.ok(p.ok);
  assert.deepEqual([p.value.by, p.value.from, p.value.state], ["operator", "panel", "live"]);
});

test("every write but a draft throws without an authority", () => {
  const s = emptyListings();
  const l = live(s);
  const forged = { by: "owner", from: "app" } as Authority;
  assert.throws(() => confirm(s, forged, l.id, c()));
  assert.throws(() => markSold(s, forged, l.id, c()));
  assert.throws(() => remove(s, forged, l.id, c()));
  assert.throws(() => edit(s, forged, l.id, { qty: 3 }));
  assert.throws(() => setShop(s, forged, { visible: true }));
  assert.equal(s.shop.visible, false);
  assert.equal(l.state, "live");
});

test("customer code never imports the authority makers (the source says so)", () => {
  for (const f of ["../../assistant/talk-customer.ts", "../../channels/chat.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(!/ownerAuthority|panelAuthority/u.test(src), f);
  }
});

test("ids are never reused, even after a listing is removed", () => {
  const s = emptyListings();
  const a = live(s);
  assert.equal(a.id, "l-1");
  remove(s, owner, a.id, c());
  const b = live(s);
  assert.equal(b.id, "l-2");
  s.items = [];
  assert.equal(draft(s, kitten(), c()).ok && s.seq, 3);
});

test("limits: 50 live listings, bounded text, a valid price and quantity, a known category", () => {
  const s = emptyListings();
  for (let i = 0; i < MAX_LIVE; i++) live(s, kitten({ category: "other", words: { en: { title: `Thing ${i}`, text: "" } } }));
  const d = draft(s, kitten({ category: "other" }), c());
  assert.ok(d.ok);
  const full = publish(s, owner, d.value.id, c());
  assert.deepEqual(full, { ok: false, why: "full" });
  const t = emptyListings();
  assert.deepEqual(draft(t, kitten({ words: { en: { title: "x".repeat(81), text: "" } } }), c()), { ok: false, why: "too_long" });
  assert.deepEqual(draft(t, kitten({ words: { en: { title: "ok", text: "y".repeat(401) } } }), c()), { ok: false, why: "too_long" });
  assert.deepEqual(draft(t, kitten({ pricePaise: -5 }), c()), { ok: false, why: "bad_price" });
  assert.deepEqual(draft(t, kitten({ pricePaise: 12.5 }), c()), { ok: false, why: "bad_price" });
  assert.deepEqual(draft(t, kitten({ qty: 0 }), c()), { ok: false, why: "bad_qty" });
  assert.deepEqual(draft(t, kitten({ category: "guns" as never }), c()), { ok: false, why: "bad_category" });
  assert.deepEqual(draft(t, kitten({ words: {} }), c()), { ok: false, why: "empty" });
  assert.deepEqual(draft(t, kitten({ photos: [1, 2, 3, 4].map((n) => ({ id: `ph-00000000000${n}`, type: "image/jpeg" as const, width: 10, height: 10, bytes: 10 })) }), c()), { ok: false, why: "too_many_photos" });
});

test("a draft past its day goes, and only 5 wait at once", () => {
  const s = emptyListings();
  for (let i = 0; i < 5; i++) assert.ok(draft(s, kitten({ category: "other" }), c()).ok);
  assert.deepEqual(draft(s, kitten({ category: "other" }), c()), { ok: false, why: "too_many_drafts" });
  assert.ok(draft(s, kitten({ category: "other" }), c(NOW + DAY + 1)).ok);
  tidyListings(s, NOW + 3 * DAY);
  assert.equal(s.items.filter((l) => l.state === "draft").length, 0);
});

test("freshness: fresh for 3 days after the owner's confirm, then 'check', then hidden after 30 days; a confirm shows it again", () => {
  const s = emptyListings();
  const l = live(s);
  assert.equal(freshnessOf(l, NOW + FRESH_MS), "fresh");
  assert.equal(freshnessOf(l, NOW + FRESH_MS + 1), "check");
  assert.equal(isPublic(l, NOW + 10 * DAY), true);
  assert.equal(freshnessOf(l, NOW + HIDE_AFTER_MS + 1), "hidden");
  assert.equal(publicListings(s, NOW + HIDE_AFTER_MS + 1).length, 0);
  assert.equal(hiddenListings(s, NOW + HIDE_AFTER_MS + 1).length, 1); // still in the owner's list
  const later = NOW + HIDE_AFTER_MS + 1;
  assert.ok(confirm(s, owner, l.id, c(later)).ok);
  assert.equal(publicListings(s, later).length, 1);
  assert.equal(freshnessOf(l, later), "fresh");
});

test("a confirm that names an old confirmedMs does nothing; sold hides itself and cannot be confirmed", () => {
  const s = emptyListings();
  const l = live(s);
  assert.ok(confirm(s, owner, l.id, c(NOW + DAY), { confirmedMs: NOW }).ok);
  assert.deepEqual(confirm(s, owner, l.id, c(NOW + 2 * DAY), { confirmedMs: NOW }), { ok: false, why: "not_live" });
  assert.ok(markSold(s, owner, l.id, c(NOW + 3 * DAY)).ok);
  assert.equal(publicListings(s, NOW + 3 * DAY).length, 0);
  assert.deepEqual(confirm(s, owner, l.id, c(NOW + 4 * DAY)), { ok: false, why: "not_live" });
});

test("the morning asks at most 3 a day and not about a listing asked lately", () => {
  const s = emptyListings();
  for (let i = 0; i < 5; i++) live(s, kitten({ category: "other", words: { en: { title: `Thing ${i}`, text: "" } } }));
  const due = dueAsks(s, NOW + 3 * DAY, 0);
  assert.equal(due.length, 3);
  assert.equal(dueAsks(s, NOW + 3 * DAY, 2).length, 1);
  assert.equal(dueAsks(s, NOW + 3 * DAY, 3).length, 0);
  assert.equal(dueAsks(s, NOW + 1 * DAY, 0).length, 0, "nothing is asked while it is fresh");
  for (const l of due) l.askedMs = NOW + 3 * DAY;
  assert.equal(dueAsks(s, NOW + 3 * DAY + DAY, 0).length, 2, "the three asked are not asked again the next day");
});

test("pets: protected native animals are refused in four languages; a health claim needs the owner's own words", () => {
  const s = emptyListings();
  for (const title of ["Indian parakeet pair", "star tortoise", "baby monkey", "पालतू तोता", "മൈന", "ಗೂಬೆ"]) {
    const r = draft(s, kitten({ words: { en: { title, text: "" } } }), c());
    assert.deepEqual(r, { ok: false, why: "protected_animal" }, title);
  }
  assert.equal(protectedAnimalIn({ en: { title: "Persian kitten", text: "" } }), undefined);
  assert.deepEqual(draft(s, kitten({ words: { en: { title: "Persian kitten", text: "Healthy and vaccinated" } } }), c()), { ok: false, why: "health_claim" });
  const ok = draft(s, kitten({ words: { en: { title: "Persian kitten", text: "Vaccinated" } }, ownerWords: "two kittens, vaccinated, 8000 each", claims: ["vaccinated"] }), c());
  assert.ok(ok.ok);
  // in another category the words are the owner's business
  assert.ok(draft(s, kitten({ category: "food", words: { en: { title: "Healthy millet laddoo", text: "" } } }), c()).ok);
});

test("photos: a draft takes the pending ones, an upload day is bounded, and the shop's settings are validated", () => {
  const s = emptyListings();
  const photo = { id: "ph-0123456789ab", type: "image/jpeg" as const, width: 800, height: 600, bytes: 1000 };
  assert.ok(noteUpload(s, owner, photo, "2026-11-18", c()).ok);
  assert.equal(pendingPhotos(s, NOW).length, 1);
  assert.equal(takePhotos(s, [photo.id], NOW).length, 1);
  for (let i = 0; i < UPLOADS_PER_DAY; i++) noteUpload(s, owner, { ...photo, id: `ph-${String(i).padStart(12, "0")}` }, "2026-11-18", c());
  assert.deepEqual(noteUpload(s, owner, photo, "2026-11-18", c()), { ok: false, why: "too_many_photos" });
  assert.ok(noteUpload(s, owner, photo, "2026-11-19", c()).ok);
  assert.ok(setShop(s, owner, { visible: true, town: "Thrissur", pincode: "680001", point: { lat: 10.52, lon: 76.21 }, registration: "PS/KL/2026/123" }).ok);
  assert.deepEqual(setShop(s, owner, { pincode: "12" }), { ok: false, why: "bad_place" });
  assert.deepEqual(setShop(s, owner, { point: { lat: 0, lon: 0 } }), { ok: false, why: "bad_place" });
  assert.equal(s.shop.visible, true);
  assert.equal(s.shop.town, "Thrissur");
});

test("the words: four languages carry every line, and none uses a word the shop's papers never use", () => {
  const banned = /\b(?:safe|guaranteed?|verified|certified|100%|earn|income|bot)\b/iu;
  const en = listingReviewLines("en");
  for (const l of ["hi", "ml", "kn"] as const) {
    const lines = listingReviewLines(l);
    assert.deepEqual(Object.keys(lines).sort(), Object.keys(en).sort(), l);
    for (const v of Object.values(lines)) assert.ok(v.trim().length > 0);
  }
  for (const v of Object.values(en)) assert.ok(!banned.test(v), v);
  assert.equal(priceLine(undefined, undefined, "en"), "Ask the shop");
  assert.equal(priceLine(800000, "each", "en"), "₹8,000 each");
  assert.equal(freshnessLine("fresh", NOW, NOW, "en"), "Confirmed today");
  assert.equal(freshnessLine("check", NOW, NOW + 5 * DAY, "en"), "Call to check");
  assert.equal(textIn({ ...live(emptyListings()), ownerLang: "hi", words: { en: { title: "A", text: "" } } }, "ml").machine, true);
  assert.ok(LISTING_WORDS.hi.refusal.protected("x").length > 0);
});
