// The shop's listings (block S, phase A, owner 18 Nov 2026): the things a shop shows on its own page and offers to the open feed, such as "two Persian kittens, ₹8,000 each",
// made by the owner's assistant from the owner's own words and published by the owner's one tap. This file is PURE: no disk, no node:sqlite, no network, no model, so the agents
// (and the browser demo built from them) can import it. The state it works on is plain JSON; the assistant keeps it under `assistant.listings` (modules/assistant/state.ts), so it
// is saved in the same step and transaction as everything else, and is in the backup and the export with nothing new, like the shop's memory (modules/memory).
//
// What it promises, and how:
//  - A listing becomes PUBLIC only by a person with authority. `publish`, `confirm`, `markSold`, `remove` and `setShop` take an `Authority` (modules/memory: ownerAuthority,
//    panelAuthority), checked at run time. A customer's words have no path to a write: the only thing code with no authority may do is `draft`, and a draft is never public.
//  - The owner's price and quantity are the owner's own: `draft` takes them from the caller, which reads them from the owner's words by rule, never from a model. The words in
//    the other languages are machine-written and marked so (`Listing.machine`).
//  - Freshness is the shop's own word and only the owner renews it: "fresh" for 3 days after the owner last confirmed, "check" ("Call to check") after that, hidden from the
//    public after 30 days without a confirm (still in the owner's list, "confirm to show again"). A sold listing hides itself. Nothing is ever confirmed by a customer.
//  - Ids ("l-3") are never reused, and a shop shows at most 50 live listings; text lengths are bounded.
//  - Protected native animals may not be listed (a short list, to be checked against the Wildlife (Protection) Act from a primary source before a real pet shop uses it:
//    modules/Deferred.md), and nothing here ever says an animal is healthy, vaccinated or pure-bred: only the owner's own words can, shown as "the owner says".
import { DAY } from "../core/time.ts";
import { isAuthority } from "../memory/memory.ts";
import type { Authority, NoteBy, NoteFrom } from "../memory/memory.ts";

export type Lang = "en" | "hi" | "ml" | "kn";
export const LANGS: readonly Lang[] = ["en", "hi", "ml", "kn"];

/** The fixed categories, shown in four languages (words.ts). A builder can add more through `extraCategories` of the shop's state. */
export const CATEGORIES = ["pets", "food", "clothes", "home", "electronics", "vehicles", "services", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const LISTING_STATES = ["draft", "live", "sold", "removed"] as const;
export type ListingState = (typeof LISTING_STATES)[number];

/** The most live listings a shop shows, and the room a title and a text have, per language. */
export const MAX_LIVE = 50;
export const MAX_TITLE = 80;
export const MAX_TEXT = 400;
export const MAX_NOTE = 30;
export const MAX_QTY = 9999;
export const MAX_PHOTOS = 3;
/** The most drafts waiting for a tap at once, and how long one waits. */
export const MAX_DRAFTS = 5;
export const DRAFT_MS = DAY;
/** "Fresh" for this long after the owner confirmed; after it "Call to check"; hidden from the public after HIDE_AFTER_MS. */
export const FRESH_MS = 3 * DAY;
export const HIDE_AFTER_MS = 30 * DAY;
/** The owner is asked "still have it?" at most this many times a day, and about one listing at most once in FRESH_MS. */
export const ASKS_PER_DAY = 3;
/** The most photos the owner may upload in a day, and how long an upload that no listing took waits. */
export const UPLOADS_PER_DAY = 30;
export const PENDING_PHOTO_MS = 6 * 3_600_000;
/** A sold or removed listing keeps its words this long (the owner's list, an undo), then only its id and dates stay. */
export const GONE_KEPT_MS = 30 * DAY;

export interface Photo {
  /** "ph-<12 hex>": the photo's name everywhere, never the uploaded name. */
  id: string;
  type: "image/jpeg" | "image/webp";
  width: number;
  height: number;
  bytes: number;
}

export interface LangText { title: string; text: string }

export interface Listing {
  /** "l-3": never given twice. */
  id: string;
  state: ListingState;
  category: Category;
  /** The language the owner spoke or typed in; the other three are machine-written and marked so. */
  ownerLang: Lang;
  /** Title and short text per language. A language with nothing yet is absent (a form with no model writes the owner's language only). */
  words: Partial<Record<Lang, LangText>>;
  /** The owner's price in paise; absent means "ask the shop". */
  pricePaise?: number;
  /** "each", "per kg": the owner's own note on the price. */
  priceNote?: string;
  qty?: number;
  photos: Photo[];
  createdMs: number;
  publishedMs?: number;
  /** When the owner last said the shop still has it. */
  confirmedMs?: number;
  soldMs?: number;
  removedMs?: number;
  /** When the owner was last asked "still have it?" (so one listing is not asked about every morning). */
  askedMs?: number;
  by: NoteBy;
  from: NoteFrom;
  /** The registration number or word of a pet shop is the shop's (ListingsShop.registration), not a listing's. A pets listing's own claims ("vaccinated") are the owner's words here. */
  claims?: string[];
}

/** What the owner sets for the whole shop's showing: the switch, the place, the pet-shop registration. All the owner's own words. */
export interface ListingsShop {
  /** "Show my shop on Streetlist and in search": off until the owner turns it on. Only then do the pages carry the feed and drop `noindex`. */
  visible: boolean;
  town?: string;
  pincode?: string;
  /** A map point the owner sets in their app. */
  lat?: number;
  lon?: number;
  /** The registration under the Prevention of Cruelty to Animals (Pet Shop) Rules, 2018, as the owner wrote it. Shown as "the owner says", never as checked. */
  registration?: string;
  /** A builder's extra categories (id: lower-case letters, name in the shop's languages). */
  extraCategories?: { id: string; names: Partial<Record<Lang, string>> }[];
}

/** An uploaded photo the owner has not put in a listing yet (its bytes are in the runtime's store, by id). */
export interface PendingPhoto extends Photo { atMs: number }

export interface ListingsState {
  /** The last number given to a listing: never given twice. */
  seq: number;
  items: Listing[];
  shop: ListingsShop;
  pending: PendingPhoto[];
  /** Photos accepted today, for the day's bound. */
  uploads: { day: string; n: number };
}

export const emptyListings = (): ListingsState => ({ seq: 0, items: [], shop: { visible: false }, pending: [], uploads: { day: "", n: 0 } });

/** The listings in an assistant state, made on first use. A store from before listings has none and loads as it was. */
export function listingsOf(holder: { listings?: ListingsState }): ListingsState {
  if (!holder.listings) holder.listings = emptyListings();
  return holder.listings;
}

// ---- refusals and checks ------------------------------------------------------------------------------------------------------------------------

export type Failure =
  | "bad_category" | "empty" | "too_long" | "bad_price" | "bad_qty" | "too_many_photos" | "no_such_listing" | "not_a_draft" | "not_live" | "full" | "too_many_drafts"
  | "protected_animal" | "health_claim" | "bad_place" | "bad_text";
export type Result<T> = { ok: true; value: T } | { ok: false; why: Failure };

const clean = (text: string): string => text.replace(/\s+/gu, " ").trim();
const fail = (why: Failure): { ok: false; why: Failure } => ({ ok: false, why });

/** Only an authority this repo's memory module made may write: a forged `{ by: "owner" }`, a customer's event, or nothing throws. */
function requireAuthority(a: unknown): asserts a is Authority {
  if (!isAuthority(a)) throw new Error("Only the owner, the Operator or the builder can change what the shop shows.");
}

export const isCategory = (c: unknown, s?: ListingsShop): c is Category => (CATEGORIES as readonly string[]).includes(c as string) || (s?.extraCategories ?? []).some((x) => x.id === c);

// The animals a pet shop may NOT sell (Wildlife (Protection) Act, 1972): a starting list of native species, with the words the owner may use in the four languages. It is to be
// checked against the Act's schedules from a primary source before a real pet shop relies on it (modules/Deferred.md); it only ever REFUSES, so a gap lets a listing through
// and does not turn a lawful one away. Matched on whole words, case-folded.
const NL = "(?![\\p{L}\\p{M}])";
const NB = "(?<![\\p{L}\\p{M}])";
export const PROTECTED_ANIMALS: { name: string; words: RegExp }[] = [
  { name: "native parrots and parakeets", words: new RegExp(`${NB}(?:parrots?|parakeets?|parakeet|popat|tota|tote|तोता|तोते|तोती|തത്ത|ಗಿಳಿ)${NL}`, "iu") },
  { name: "munias", words: new RegExp(`${NB}(?:munias?|muniya|मुनिया|മുനിയ|ಮುನಿಯಾ)${NL}`, "iu") },
  { name: "mynas", words: new RegExp(`${NB}(?:mynas?|mynahs?|maina|मैना|മൈന|ಮೈನಾ)${NL}`, "iu") },
  { name: "native owls", words: new RegExp(`${NB}(?:owls?|ullu|उल्लू|മൂങ്ങ|ಗೂಬೆ)${NL}`, "iu") },
  { name: "Indian star tortoise and native turtles", words: new RegExp(`${NB}(?:tortoises?|turtles?|kachua|कछुआ|कछुए|ആമ|ಆಮೆ)${NL}`, "iu") },
  { name: "monkeys", words: new RegExp(`${NB}(?:monkeys?|bandar|बंदर|കുരങ്ങ്|കുരങ്ങൻ|ಕೋತಿ)${NL}`, "iu") },
];

/** The protected animal a pets listing's words name, or undefined. Looked for in every language's title and text. */
export function protectedAnimalIn(words: Partial<Record<Lang, LangText>>): string | undefined {
  const all = Object.values(words).map((w) => `${w?.title ?? ""} ${w?.text ?? ""}`).join(" \n ");
  return PROTECTED_ANIMALS.find((a) => a.words.test(all))?.name;
}

/** Words that say an animal is healthy, vaccinated, certified or of a pure breed. Only the owner's own words may carry them, and then they are shown as "the owner says". */
export const HEALTH_CLAIM = new RegExp([
  `${NB}(?:healthy|health|vaccinat\\w*|dewormed|pure-?bred|pure breed|pedigree\\w*|kc registered|certified|disease[- ]free|vet[- ]checked|checked by (?:a )?vet)${NL}`,
  "स्वस्थ|तंदुरुस्त|टीका|टीके|वैक्सीन|टीकाकरण|शुद्ध नस्ल|नस्ल|പ്രതിരോധ കുത്തിവയ്പ്|വാക്സിൻ|ആരോഗ്യ|ശുദ്ധ ജാതി|ശുദ്ധമായ ജാതി|ಆರೋಗ್ಯ|ಲಸಿಕೆ|ಶುದ್ಧ ತಳಿ|ತಳಿ",
].join("|"), "iu");

/** Does this text carry a health claim? */
export const hasHealthClaim = (text: string): boolean => HEALTH_CLAIM.test(text);

function checkWords(category: Category, words: Partial<Record<Lang, LangText>>, ownerWords: string | undefined): { ok: true; words: Partial<Record<Lang, LangText>> } | { ok: false; why: Failure } {
  const out: Partial<Record<Lang, LangText>> = {};
  for (const l of LANGS) {
    const w = words[l];
    if (!w) continue;
    const title = clean(w.title);
    const text = clean(w.text);
    if (title === "") return fail("empty");
    if (title.length > MAX_TITLE || text.length > MAX_TEXT) return fail("too_long");
    out[l] = { title, text };
  }
  if (Object.keys(out).length === 0) return fail("empty");
  if (category === "pets") {
    if (protectedAnimalIn(out)) return fail("protected_animal");
    // a health claim in a pets listing must be in the owner's own words (the words they said), or the listing is not made
    for (const l of LANGS) {
      const w = out[l];
      if (w && hasHealthClaim(`${w.title} ${w.text}`) && !(ownerWords !== undefined && hasHealthClaim(ownerWords))) return fail("health_claim");
    }
  }
  return { ok: true, words: out };
}

// ---- writing ------------------------------------------------------------------------------------------------------------------------------------

export interface WriteContext { nowMs: number }

export interface DraftInput {
  category: Category;
  ownerLang: Lang;
  words: Partial<Record<Lang, LangText>>;
  /** Read from the owner's own words by rule (never a model's). */
  pricePaise?: number;
  priceNote?: string;
  qty?: number;
  photos?: Photo[];
  /** The owner's own words, kept only to check that a health claim in a pets listing is theirs. */
  ownerWords?: string;
  /** What the owner said about the animal's health or breed, word for word, when they did (shown as "the owner says"). */
  claims?: string[];
}

/** Where the listing came from, so `by` and `from` are the person's, never the model's. A draft has no authority yet: its `by` is set when it is published. */
const DRAFT_BY: { by: NoteBy; from: NoteFrom } = { by: "owner", from: "app" };

function checkFields(s: ListingsState, i: { category: Category; pricePaise?: number; priceNote?: string; qty?: number; photos?: Photo[] }): Failure | undefined {
  if (!isCategory(i.category, s.shop)) return "bad_category";
  if (i.pricePaise !== undefined && (!Number.isSafeInteger(i.pricePaise) || i.pricePaise <= 0 || i.pricePaise > 100_000_000_00)) return "bad_price";
  if (i.priceNote !== undefined && clean(i.priceNote).length > MAX_NOTE) return "too_long";
  if (i.qty !== undefined && (!Number.isSafeInteger(i.qty) || i.qty < 1 || i.qty > MAX_QTY)) return "bad_qty";
  if ((i.photos?.length ?? 0) > MAX_PHOTOS) return "too_many_photos";
  return undefined;
}

export const liveCount = (s: ListingsState): number => s.items.filter((l) => l.state === "live").length;
const find = (s: ListingsState, id: string): Listing | undefined => s.items.find((l) => l.id === id);
export const listingById = find;

/**
 * The assistant's draft: a listing that is NOT public (state "draft"), waiting for the owner's tap. No authority is needed to make one because a draft shows nobody anything; the
 * only way it becomes public is `publish`, which needs the owner's. Its id is taken now and never given again.
 */
export function draft(s: ListingsState, input: DraftInput, c: WriteContext): Result<Listing> {
  const bad = checkFields(s, input);
  if (bad) return fail(bad);
  const checked = checkWords(input.category, input.words, input.ownerWords);
  if (!checked.ok) return checked;
  s.items = s.items.filter((l) => !(l.state === "draft" && l.createdMs + DRAFT_MS <= c.nowMs));
  if (s.items.filter((l) => l.state === "draft").length >= MAX_DRAFTS) return fail("too_many_drafts");
  s.seq += 1;
  const l: Listing = {
    id: `l-${s.seq}`, state: "draft", category: input.category, ownerLang: input.ownerLang, words: checked.words,
    ...(input.pricePaise !== undefined ? { pricePaise: input.pricePaise } : {}), ...(input.priceNote ? { priceNote: clean(input.priceNote) } : {}), ...(input.qty !== undefined ? { qty: input.qty } : {}),
    photos: (input.photos ?? []).map((p) => ({ ...p })), createdMs: c.nowMs, ...DRAFT_BY, ...(input.claims && input.claims.length > 0 ? { claims: input.claims.map(clean).filter(Boolean).slice(0, 3) } : {}),
  };
  s.items.push(l);
  return { ok: true, value: l };
}

/** The owner's tap on "Show it": the draft goes live now, confirmed today. Only with an authority; at most 50 live. */
export function publish(s: ListingsState, a: Authority, id: string, c: WriteContext): Result<Listing> {
  requireAuthority(a);
  const l = find(s, id);
  if (!l) return fail("no_such_listing");
  if (l.state !== "draft") return fail("not_a_draft");
  if (liveCount(s) >= MAX_LIVE) return fail("full");
  // checked again at the tap: the protected-animal rule holds whatever was drafted
  if (l.category === "pets" && protectedAnimalIn(l.words)) return fail("protected_animal");
  l.state = "live";
  l.publishedMs = c.nowMs;
  l.confirmedMs = c.nowMs;
  l.by = a.by;
  l.from = a.from;
  s.pending = s.pending.filter((p) => !l.photos.some((x) => x.id === p.id));
  return { ok: true, value: l };
}

/** What the owner may change on a draft or a live listing before or after showing it ("Change"): only the fields the owner gave, each checked as at the draft. */
export interface Edit {
  category?: Category;
  words?: Partial<Record<Lang, LangText>>;
  /** The words given replace all the listing's words (the owner changed the title: the machine-written ones no longer say it, so they go) instead of being merged. */
  replaceWords?: boolean;
  pricePaise?: number | null; priceNote?: string | null; qty?: number | null;
}

export function edit(s: ListingsState, a: Authority, id: string, e: Edit): Result<Listing> {
  requireAuthority(a);
  const l = find(s, id);
  if (!l) return fail("no_such_listing");
  if (l.state !== "draft" && l.state !== "live") return fail("not_live");
  const next = {
    category: e.category ?? l.category,
    pricePaise: e.pricePaise === null ? undefined : (e.pricePaise ?? l.pricePaise),
    priceNote: e.priceNote === null ? undefined : (e.priceNote ?? l.priceNote),
    qty: e.qty === null ? undefined : (e.qty ?? l.qty),
    photos: l.photos,
  };
  const bad = checkFields(s, next);
  if (bad) return fail(bad);
  const merged = e.replaceWords ? { ...(e.words ?? {}) } : { ...l.words, ...(e.words ?? {}) };
  // the owner is the one editing: their own words are what a health claim may come from
  const checked = checkWords(next.category, merged, Object.values(e.words ?? {}).map((w) => `${w?.title ?? ""} ${w?.text ?? ""}`).join(" ") + " " + (l.claims ?? []).join(" "));
  if (!checked.ok) return checked;
  l.category = next.category;
  l.words = checked.words;
  if (next.pricePaise === undefined) delete l.pricePaise; else l.pricePaise = next.pricePaise;
  if (next.priceNote === undefined || next.priceNote === "") delete l.priceNote; else l.priceNote = clean(next.priceNote);
  if (next.qty === undefined) delete l.qty; else l.qty = next.qty;
  l.by = a.by;
  l.from = a.from;
  return { ok: true, value: l };
}

/** "Yes, still have it": confirmed now. If it had been hidden for 30 days it shows again. The tap names the listing and the `confirmedMs` the owner was shown, so an old tap does nothing. */
export function confirm(s: ListingsState, a: Authority, id: string, c: WriteContext, shown?: { confirmedMs: number }): Result<Listing> {
  requireAuthority(a);
  const l = find(s, id);
  if (!l) return fail("no_such_listing");
  if (l.state !== "live") return fail("not_live");
  if (shown && l.confirmedMs !== shown.confirmedMs) return fail("not_live");
  l.confirmedMs = c.nowMs;
  return { ok: true, value: l };
}

/** "Sold": the listing hides itself at once. */
export function markSold(s: ListingsState, a: Authority, id: string, c: WriteContext): Result<Listing> {
  requireAuthority(a);
  const l = find(s, id);
  if (!l) return fail("no_such_listing");
  if (l.state !== "live") return fail("not_live");
  l.state = "sold";
  l.soldMs = c.nowMs;
  return { ok: true, value: l };
}

/** The owner takes a listing (or a draft) off. */
export function remove(s: ListingsState, a: Authority, id: string, c: WriteContext): Result<Listing> {
  requireAuthority(a);
  const l = find(s, id);
  if (!l) return fail("no_such_listing");
  if (l.state === "removed") return fail("not_live");
  l.state = "removed";
  l.removedMs = c.nowMs;
  return { ok: true, value: l };
}

/** The shop-wide settings the owner sets in their app: the switch, the place, the registration. Each field is validated; a `null` clears it. */
export interface ShopPatch { visible?: boolean; town?: string | null; pincode?: string | null; point?: { lat: number; lon: number } | null; registration?: string | null }

export function setShop(s: ListingsState, a: Authority, p: ShopPatch): Result<ListingsShop> {
  requireAuthority(a);
  const shop = { ...s.shop };
  if (p.town !== undefined) { const t = p.town === null ? "" : clean(p.town); if (t.length > 60) return fail("bad_place"); if (t === "") delete shop.town; else shop.town = t; }
  if (p.pincode !== undefined) { const t = p.pincode === null ? "" : p.pincode.trim(); if (t !== "" && !/^[1-9]\d{5}$/u.test(t)) return fail("bad_place"); if (t === "") delete shop.pincode; else shop.pincode = t; }
  if (p.point !== undefined) {
    if (p.point === null) { delete shop.lat; delete shop.lon; }
    else {
      // India's own box, so a typo in a map point is refused rather than shown
      const { lat, lon } = p.point;
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 6 || lat > 37.5 || lon < 68 || lon > 98) return fail("bad_place");
      shop.lat = Math.round(lat * 1e5) / 1e5;
      shop.lon = Math.round(lon * 1e5) / 1e5;
    }
  }
  if (p.registration !== undefined) { const t = p.registration === null ? "" : clean(p.registration); if (t.length > 120) return fail("bad_text"); if (t === "") delete shop.registration; else shop.registration = t; }
  if (p.visible !== undefined) shop.visible = p.visible;
  s.shop = shop;
  return { ok: true, value: shop };
}

// ---- photos the owner uploaded but has not put in a listing ------------------------------------------------------------------------------------------

/** The day for the upload bound, "2026-11-18" in the shop's zone (the caller says which: this file has no clock or zone of its own). */
export function noteUpload(s: ListingsState, a: Authority, photo: Photo, day: string, c: WriteContext): Result<PendingPhoto> {
  requireAuthority(a);
  if (s.uploads.day !== day) s.uploads = { day, n: 0 };
  if (s.uploads.n >= UPLOADS_PER_DAY) return fail("too_many_photos");
  s.uploads.n += 1;
  const p: PendingPhoto = { ...photo, atMs: c.nowMs };
  s.pending.push(p);
  return { ok: true, value: p };
}

/** The photos the owner uploaded lately and has not used: what the next listing takes (at most 3, oldest first). */
export const pendingPhotos = (s: ListingsState, nowMs: number): PendingPhoto[] => s.pending.filter((p) => nowMs - p.atMs < PENDING_PHOTO_MS).slice(0, MAX_PHOTOS);

/** A draft takes these pending photos (by id), and they are no longer pending. */
export function takePhotos(s: ListingsState, ids: readonly string[], nowMs: number): Photo[] {
  const got = pendingPhotos(s, nowMs).filter((p) => ids.includes(p.id));
  return got.map(({ atMs: _atMs, ...p }) => p);
}

// ---- reading: freshness, what the public sees ----------------------------------------------------------------------------------------------------------

export type Freshness = "fresh" | "check" | "hidden";

/** How fresh a live listing is, by the owner's last confirm. */
export function freshnessOf(l: Pick<Listing, "state" | "confirmedMs" | "publishedMs">, nowMs: number): Freshness {
  const at = l.confirmedMs ?? l.publishedMs ?? 0;
  const age = nowMs - at;
  return age <= FRESH_MS ? "fresh" : age <= HIDE_AFTER_MS ? "check" : "hidden";
}

/** Is it shown to the public: live, and not hidden for want of a confirm. A sold, removed or draft listing is never public. */
export const isPublic = (l: Listing, nowMs: number): boolean => l.state === "live" && freshnessOf(l, nowMs) !== "hidden";

/**
 * The listings the public sees, newest confirmed first. `soldOut` is the ids of counted listings whose stock is at 0 (modules/stock `soldOutListings`): they sell themselves, so they are
 * left out here WITHOUT writing anything to the listing (its words, price and card digest stay as the owner made them). Left out: no counting, exactly as before.
 */
export const publicListings = (s: ListingsState, nowMs: number, soldOut?: ReadonlySet<string>): Listing[] =>
  s.items.filter((l) => isPublic(l, nowMs) && !soldOut?.has(l.id)).sort((a, b) => (b.confirmedMs ?? 0) - (a.confirmedMs ?? 0) || b.createdMs - a.createdMs);

/** Live listings the owner still sees but the public does not (hidden for want of a confirm): "confirm to show again". */
export const hiddenListings = (s: ListingsState, nowMs: number): Listing[] => s.items.filter((l) => l.state === "live" && freshnessOf(l, nowMs) === "hidden");

/** The live listings' titles in a language, for the owner's Stock page (which listings may be counted). */
export const liveListingTitles = (s: ListingsState, lang: Lang): { id: string; title: string }[] => s.items.filter((l) => l.state === "live").map((l) => ({ id: l.id, title: textIn(l, lang).title }));

/** The owner's own list: drafts, live (hidden ones too), newest first. */
export const ownersListings = (s: ListingsState): Listing[] => s.items.filter((l) => l.state === "draft" || l.state === "live").sort((a, b) => b.createdMs - a.createdMs);

/** The text of a listing in a language: that language's, else the owner's own, else English, else whatever there is. `machine` is true when it is not the owner's language. */
export function textIn(l: Listing, lang: Lang): { title: string; text: string; lang: Lang; machine: boolean } {
  const order: Lang[] = [lang, l.ownerLang, "en", ...LANGS];
  for (const k of order) {
    const w = l.words[k];
    if (w) return { ...w, lang: k, machine: k !== l.ownerLang };
  }
  return { title: l.id, text: "", lang: l.ownerLang, machine: false };
}

/** The listings a shop asks the owner about this morning: live, shown, older than 3 days since the last ask (and the last confirm), at most 3 a day counting the asks already made today. */
export function dueAsks(s: ListingsState, nowMs: number, askedToday: number): Listing[] {
  const room = Math.max(0, ASKS_PER_DAY - askedToday);
  return s.items
    .filter((l) => l.state === "live" && nowMs - (l.confirmedMs ?? 0) > FRESH_MS - DAY && nowMs - (l.askedMs ?? 0) > DAY * 2)
    .sort((a, b) => (a.confirmedMs ?? 0) - (b.confirmedMs ?? 0))
    .slice(0, room);
}

/** On the tick: a draft past its day goes (its photos are free to be taken off by the runtime); sold or removed listings lose their words after 30 days; stale pending photos go. Returns the ids of photos no listing holds any more. */
export function tidyListings(s: ListingsState, nowMs: number): { photosToDelete: string[] } {
  const before = new Set(allPhotoIds(s));
  s.items = s.items.filter((l) => !(l.state === "draft" && l.createdMs + DRAFT_MS <= nowMs));
  for (const l of s.items) {
    if ((l.state === "sold" && (l.soldMs ?? 0) + GONE_KEPT_MS <= nowMs) || (l.state === "removed" && (l.removedMs ?? 0) + GONE_KEPT_MS <= nowMs)) {
      l.words = {};
      l.photos = [];
      delete l.claims;
    }
    if (l.state === "removed" && l.photos.length > 0) l.photos = [];
  }
  s.pending = s.pending.filter((p) => nowMs - p.atMs < PENDING_PHOTO_MS);
  const after = new Set(allPhotoIds(s));
  return { photosToDelete: [...before].filter((id) => !after.has(id)) };
}

/** Every photo id the state holds: the listings' (draft, live, sold) and the pending ones. */
export function allPhotoIds(s: ListingsState): string[] {
  return [...s.items.filter((l) => l.state !== "removed").flatMap((l) => l.photos.map((p) => p.id)), ...s.pending.map((p) => p.id)];
}

/** Is this photo one the public may be shown now: it belongs to a public listing. The runtime asks this before it hands any photo to the front. */
export function photoIsPublic(s: ListingsState, photoId: string, nowMs: number): Photo | undefined {
  for (const l of publicListings(s, nowMs)) { const p = l.photos.find((x) => x.id === photoId); if (p) return p; }
  return undefined;
}

/** Is the shop's showing switched on (and so may its page be indexed and its feed served)? */
export const isVisible = (s: ListingsState | undefined): boolean => s?.shop.visible === true;

// ---- the record ------------------------------------------------------------------------------------------------------------------------------------

export const LISTING_ACTION = "listing";
export type ListingChange = "drafted" | "published" | "edited" | "confirmed" | "sold" | "removed" | "switch" | "place" | "photo";

/** What a `listing` line of the record carries: ids, category, who and what changed, as refs. Never the words or the price: the line's inputs hold them and the record keeps their digest. */
export function listingRefs(l: Pick<Listing, "id" | "category" | "by" | "from">, change: ListingChange): Record<string, string> {
  return { listing: l.id, category: l.category, by: l.by, from: l.from, change };
}
