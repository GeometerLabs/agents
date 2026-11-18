// The runtime's listings kit (modules/listings/kit.ts): the owner's page ops are checked for shape, pre-checked with the same rules the step applies, done with the owner's authority in a
// step, recorded without the words, and read back as the owner's view and as the PUBLIC read, which never carries a draft, a sold or hidden listing, who wrote it or the morning's asks.
// Written, not run, in the 18 Nov build stream: the lead's test pass runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY } from "../../core/time.ts";
import { fakeClock } from "../../core/clock.ts";
import { createRecord } from "../../record/record.ts";
import { checkOwnerListing, createListingsKit } from "../kit.ts";
import type { ListingOp } from "../kit.ts";
import { HIDE_AFTER_MS, listingsOf } from "../listings.ts";
import type { AssistantState } from "../../assistant/state.ts";

const NOW = 1_800_000_000_000;
const PH = { id: "ph-0123456789ab", type: "image/jpeg" as const, width: 800, height: 600, bytes: 1000 };
const kit = createListingsKit<{ assistant?: AssistantState }>({ owner: { whatsapp: "+919000000000", language: "en" }, timezone: "Asia/Kolkata" });
const world = () => { const clock = fakeClock(NOW); return { store: {} as { assistant?: AssistantState }, record: createRecord(clock), clock }; };
const op = (o: ListingOp, id = "r-1") => ({ kind: "owner_listing" as const, id, op: o });
const form: ListingOp = { op: "publish_form", category: "pets", title: "Persian kitten", priceInr: 8000, priceNote: "each", qty: 2, photos: [PH.id] };

test("the body of an op is checked for shape; anything else is refused with a sentence", () => {
  assert.ok(checkOwnerListing({ id: "r-1", op: form }).ok);
  assert.ok(!checkOwnerListing({ id: "r-1", op: { op: "publish_form", category: "pets", title: "", photos: [] } }).ok);
  assert.ok(!checkOwnerListing({ id: "r-1", op: { op: "publish_form", category: "pets", title: "x", photos: ["../../etc/passwd"] } }).ok);
  assert.ok(!checkOwnerListing({ id: "r-1", op: { op: "sold", id: "../l-1" } }).ok);
  assert.ok(!checkOwnerListing({ id: "r-1", op: { op: "launch" } }).ok);
  assert.ok(!checkOwnerListing({ id: "bad id", op: form }).ok);
  assert.ok(!checkOwnerListing({ id: "r-1", op: { op: "shop", visible: "yes" } }).ok);
  const shop = checkOwnerListing({ id: "r-1", op: { op: "shop", visible: true, town: "Thrissur", point: { lat: 10.5, lon: 76.2 } } });
  assert.ok(shop.ok);
});

test("a photo event then the form: the form publishes at once with the owner's authority, the photo is taken, and the record keeps no words", () => {
  const w = world();
  kit.run({ kind: "owner_photo", id: PH.id, photo: PH }, { store: w.store, record: w.record, nowMs: NOW });
  assert.equal(listingsOf(w.store.assistant!).pending.length, 1);
  assert.equal(kit.check(w.store, form, NOW), undefined);
  kit.run(op(form), { store: w.store, record: w.record, nowMs: NOW });
  const s = listingsOf(w.store.assistant!);
  assert.equal(s.items[0].state, "live");
  assert.deepEqual([s.items[0].pricePaise, s.items[0].priceNote, s.items[0].qty, s.items[0].photos.length, s.items[0].by, s.items[0].from], [800000, "each", 2, 1, "owner", "app"]);
  assert.deepEqual(Object.keys(s.items[0].words), ["en"], "the form saves the owner's language only");
  assert.equal(s.pending.length, 0);
  const lines = w.record.entries().filter((e) => e.action === "listing");
  assert.ok(lines.some((e) => e.refs.change === "published"));
  assert.ok(!JSON.stringify(lines).includes("Persian"), "the record keeps the id, category and who, never the title");
});

test("the pre-check says what the step would refuse: a protected animal, an unknown category, a full shop", () => {
  const w = world();
  assert.equal(kit.check(w.store, { ...form, title: "Indian star tortoise" } as ListingOp, NOW), "protected_animal");
  assert.equal(kit.check(w.store, { ...form, category: "guns" } as ListingOp, NOW), "bad_category");
  assert.equal(kit.check(w.store, { op: "confirm", id: "l-9", confirmedMs: 1 }, NOW), "no_such_listing");
  assert.equal(kit.check(w.store, { op: "shop", pincode: "12" }, NOW), "bad_place");
  // the check does not change anything
  assert.equal(w.store.assistant?.listings?.items?.length ?? 0, 0);
  // and the step refuses the same, with a blocked line and no change
  kit.run(op({ ...form, title: "Indian star tortoise" } as ListingOp), { store: w.store, record: w.record, nowMs: NOW });
  assert.equal(listingsOf(w.store.assistant!).items.length, 0);
  assert.ok(w.record.entries().some((e) => e.action === "listing" && e.outcome === "blocked"));
});

test("confirm, sold, remove and edit; a confirm with an old confirmedMs does nothing; an edit of the title drops the machine-written languages", () => {
  const w = world();
  kit.run(op(form), { store: w.store, record: w.record, nowMs: NOW });
  const l = listingsOf(w.store.assistant!).items[0];
  l.words.hi = { title: "बिल्ली", text: "" };
  kit.run(op({ op: "edit", id: l.id, title: "Persian cat", priceInr: 7500 }, "r-2"), { store: w.store, record: w.record, nowMs: NOW });
  assert.deepEqual([l.words.en!.title, l.words.hi, l.pricePaise], ["Persian cat", undefined, 750000]);
  kit.run(op({ op: "confirm", id: l.id, confirmedMs: NOW }, "r-3"), { store: w.store, record: w.record, nowMs: NOW + 2 * DAY });
  assert.equal(l.confirmedMs, NOW + 2 * DAY);
  kit.run(op({ op: "confirm", id: l.id, confirmedMs: NOW }, "r-4"), { store: w.store, record: w.record, nowMs: NOW + 3 * DAY });
  assert.equal(l.confirmedMs, NOW + 2 * DAY, "an old tap does nothing");
  kit.run(op({ op: "sold", id: l.id }, "r-5"), { store: w.store, record: w.record, nowMs: NOW + 3 * DAY });
  assert.equal(l.state, "sold");
});

test("the public read has live, not-hidden listings only, without who wrote them or when they were asked about; the owner's view still lists a hidden one", () => {
  const w = world();
  kit.run({ kind: "owner_photo", id: PH.id, photo: PH }, { store: w.store, record: w.record, nowMs: NOW });
  kit.run(op(form), { store: w.store, record: w.record, nowMs: NOW });
  kit.run(op({ ...form, title: "Another" }, "r-2"), { store: w.store, record: w.record, nowMs: NOW });
  const s = listingsOf(w.store.assistant!);
  s.items[1].state = "sold";
  s.items[0].askedMs = NOW;
  const pub = kit.publicRead(w.store, NOW + DAY);
  assert.deepEqual(pub.listings.map((l) => l.id), ["l-1"]);
  assert.ok(!("askedMs" in pub.listings[0]));
  const later = NOW + HIDE_AFTER_MS + DAY;
  assert.equal(kit.publicRead(w.store, later).listings.length, 0);
  assert.equal(kit.ownerView(w.store, later).listings[0].freshness, "hidden");
  assert.ok(kit.publicPhoto(w.store, PH.id, NOW), "listing l-1 is public and holds the photo");
});

test("photos: the public may fetch only a public listing's; the owner any the shop holds; the clean-up keeps what the state holds", () => {
  const w = world();
  kit.run({ kind: "owner_photo", id: PH.id, photo: PH }, { store: w.store, record: w.record, nowMs: NOW });
  assert.equal(kit.publicPhoto(w.store, PH.id, NOW), undefined, "waiting, not in a listing");
  assert.ok(kit.ownerPhoto(w.store, PH.id));
  assert.ok(kit.keepIds(w.store).has(PH.id));
  kit.run(op(form), { store: w.store, record: w.record, nowMs: NOW });
  assert.ok(kit.publicPhoto(w.store, PH.id, NOW));
  assert.equal(kit.publicPhoto(w.store, "ph-ffffffffffff", NOW), undefined);
});

test("the photo day bound is read from the saved state", () => {
  const w = world();
  assert.equal(kit.uploadsLeft(w.store, NOW), 30);
  for (let i = 0; i < 30; i++) kit.run({ kind: "owner_photo", id: `ph-${String(i).padStart(12, "0")}`, photo: { ...PH, id: `ph-${String(i).padStart(12, "0")}` } }, { store: w.store, record: w.record, nowMs: NOW });
  assert.equal(kit.uploadsLeft(w.store, NOW), 0);
  assert.equal(kit.uploadsLeft(w.store, NOW + DAY), 30);
});
