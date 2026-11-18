// What the runtime does with the owner's listing steps, for every template at once (block S, phase A): the events the runtime's own HTTP layer makes when the owner uses the listings page
// of their app (a photo taken in, the plain form, Confirm / Sold / Take off / Change, the switch, the place), their one rule-checked effect on the shop's listings, and the reads the
// owner's page and the public page need. Like the limits kit (modules/limits/runtime-limits.ts) it is run by the runtime CORE inside a step, so the change is saved in the same
// transaction as the rest and no template's agent has to know about it. PURE: no disk, no node:sqlite, no network (the photo's bytes live in the runtime's store; only their ids and
// sizes are here).
//
// Who writes: the owner. The runtime's HTTP layer has checked the owner's link or session before it made the event, and the effect is done with an owner Authority made here
// (modules/memory ownerAuthority("app")). A customer has no route to any of this: the routes are the owner's, and no event of this kind is accepted from the inbox or the public
// channel (`checkChannelEvent` does not know them).
import { createHash } from "node:crypto";
import { DAY, localParts } from "../core/time.ts";
import type { Language } from "../language/languages.ts";
import { ownerAuthority } from "../memory/memory.ts";
import type { Authority } from "../memory/memory.ts";
import type { ActionRecord } from "../record/record.ts";
import { CATEGORIES, LISTING_ACTION, MAX_LIVE, MAX_PHOTOS, UPLOADS_PER_DAY, allPhotoIds, confirm, draft, edit, freshnessOf, isCategory, listingById, listingRefs, listingsOf, markSold, noteUpload, ownersListings, pendingPhotos, publicListings, publish, remove, setShop, takePhotos } from "./listings.ts";
import type { Category, Failure, Lang, Listing, ListingChange, ListingsShop, ListingsState, Photo } from "./listings.ts";
import { PHOTO_ID } from "./photo.ts";
import { STOCK_ACTION, listingStockId, quantityOfListing, restoreAfterYes, soldOutListings, stockRefs } from "../stock/stock.ts";

export type ListingOp =
  | { op: "publish_form"; category: string; title: string; priceInr?: number; priceNote?: string; qty?: number; photos: string[] }
  | { op: "edit"; id: string; title?: string; category?: string; priceInr?: number | null; priceNote?: string | null; qty?: number | null }
  | { op: "confirm"; id: string; confirmedMs: number }
  | { op: "sold"; id: string }
  | { op: "remove"; id: string }
  | { op: "shop"; visible?: boolean; town?: string | null; pincode?: string | null; point?: { lat: number; lon: number } | null; registration?: string | null };

/** The owner used their listings page (made only by the runtime's HTTP layer after it checked the owner). */
export interface OwnerListingEvent { kind: "owner_listing"; id: string; op: ListingOp }
/** A photo the owner took in, already checked and cleaned and stored by the runtime's HTTP layer (the bytes are in the store; this carries only what the state keeps). */
export interface OwnerPhotoEvent { kind: "owner_photo"; id: string; photo: Photo }
export type ListingsEvent = OwnerListingEvent | OwnerPhotoEvent;
export const listingsEventKey = (e: ListingsEvent): string => `${e.kind}:${e.id}`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/u;
const LISTING_ID = /^l-\d{1,9}$/u;
const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v : undefined);

/** The body of POST /internal/channel/owner-listing, checked for shape. The rules themselves (limits, the pets rules) are applied again in the step. */
export function checkOwnerListing(body: unknown): { ok: true; event: OwnerListingEvent } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (!isObj(body) || typeof body.id !== "string" || !REQUEST_ID.test(body.id) || !isObj(body.op)) return bad('Send {"id": a request id, "op": {...}}.');
  const o = body.op;
  const id = typeof o.id === "string" && LISTING_ID.test(o.id) ? o.id : undefined;
  const num = (v: unknown): number | null | undefined => (v === null ? null : typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const mk = (op: ListingOp) => ({ ok: true as const, event: { kind: "owner_listing" as const, id: body.id as string, op } });
  switch (o.op) {
    case "publish_form": {
      const title = text(o.title, 200);
      if (!title || typeof o.category !== "string" || !Array.isArray(o.photos) || o.photos.length > MAX_PHOTOS || !o.photos.every((p) => typeof p === "string" && PHOTO_ID.test(p))) return bad("A listing needs a title, a category and up to 3 photo ids.");
      const price = num(o.priceInr);
      const qty = num(o.qty);
      if (price === null || qty === null) return bad("price and quantity are numbers, or left out.");
      return mk({ op: "publish_form", category: o.category, title, ...(price !== undefined ? { priceInr: price } : {}), ...(typeof o.priceNote === "string" && o.priceNote.trim() ? { priceNote: o.priceNote.slice(0, 60) } : {}), ...(qty !== undefined ? { qty } : {}), photos: o.photos as string[] });
    }
    case "edit": {
      if (!id) return bad("edit needs a listing id (l-3).");
      const title = o.title === undefined ? undefined : text(o.title, 200);
      if (o.title !== undefined && !title) return bad("title is words.");
      return mk({ op: "edit", id, ...(title ? { title } : {}), ...(typeof o.category === "string" ? { category: o.category } : {}), ...(o.priceInr !== undefined ? { priceInr: num(o.priceInr) ?? null } : {}), ...(o.priceNote !== undefined ? { priceNote: typeof o.priceNote === "string" && o.priceNote.trim() ? o.priceNote.slice(0, 60) : null } : {}), ...(o.qty !== undefined ? { qty: num(o.qty) ?? null } : {}) });
    }
    case "confirm": return id && typeof o.confirmedMs === "number" && Number.isSafeInteger(o.confirmedMs) ? mk({ op: "confirm", id, confirmedMs: o.confirmedMs }) : bad("confirm needs a listing id and the confirmedMs the owner was shown.");
    case "sold": case "remove": return id ? mk({ op: o.op, id }) : bad(`${String(o.op)} needs a listing id (l-3).`);
    case "shop": {
      const out: Extract<ListingOp, { op: "shop" }> = { op: "shop" };
      if (o.visible !== undefined) { if (typeof o.visible !== "boolean") return bad("visible is true or false."); out.visible = o.visible; }
      for (const k of ["town", "pincode", "registration"] as const) {
        if (o[k] === undefined) continue;
        if (o[k] !== null && typeof o[k] !== "string") return bad(`${k} is words, or null to clear it.`);
        out[k] = o[k] === null ? null : (o[k] as string).slice(0, 200);
      }
      if (o.point !== undefined) {
        if (o.point === null) out.point = null;
        else if (isObj(o.point) && typeof o.point.lat === "number" && typeof o.point.lon === "number") out.point = { lat: o.point.lat, lon: o.point.lon };
        else return bad("point is {lat, lon}, or null to clear it.");
      }
      return mk(out);
    }
    default: return bad("op is one of publish_form, edit, confirm, sold, remove, shop.");
  }
}

/** The effect of one op on a state, with this authority. Shared by the step (real state) and the page's pre-check (a copy), so what the page says is what the step does. */
function applyOp(s: ListingsState, op: ListingOp, a: Authority, c: { nowMs: number; ownerLang: Lang }): { ok: true; change: ListingChange; listing?: Listing } | { ok: false; why: Failure } {
  const w = { nowMs: c.nowMs };
  const done = (r: { ok: true; value: Listing } | { ok: false; why: Failure }, change: ListingChange) => (r.ok ? { ok: true as const, change, listing: r.value } : r);
  switch (op.op) {
    case "publish_form": {
      if (!isCategory(op.category, s.shop)) return { ok: false, why: "bad_category" };
      const price = op.priceInr === undefined ? undefined : Math.round(op.priceInr * 100);
      // the owner typed these words themselves, so a health word in them is theirs
      const made = draft(s, {
        category: op.category as Category, ownerLang: c.ownerLang, words: { [c.ownerLang]: { title: op.title, text: "" } }, ownerWords: op.title,
        ...(price !== undefined ? { pricePaise: price } : {}), ...(op.priceNote ? { priceNote: op.priceNote } : {}), ...(op.qty !== undefined ? { qty: op.qty } : {}), photos: takePhotos(s, op.photos, c.nowMs),
      }, w);
      if (!made.ok) return made;
      const pub = publish(s, a, made.value.id, w);
      // a refused publish (50 already live) leaves no draft behind: the form is all-or-nothing
      if (!pub.ok) { remove(s, a, made.value.id, w); return pub; }
      return done(pub, "published");
    }
    case "edit": {
      const l = listingById(s, op.id);
      if (!l) return { ok: false, why: "no_such_listing" };
      const price = op.priceInr === undefined ? undefined : op.priceInr === null ? null : Math.round(op.priceInr * 100);
      return done(edit(s, a, op.id, {
        ...(op.category !== undefined ? { category: op.category as Category } : {}),
        ...(op.title !== undefined ? { words: { [l.ownerLang]: { title: op.title, text: l.words[l.ownerLang]?.text ?? "" } }, replaceWords: true } : {}),
        ...(price !== undefined ? { pricePaise: price } : {}), ...(op.priceNote !== undefined ? { priceNote: op.priceNote } : {}), ...(op.qty !== undefined ? { qty: op.qty } : {}),
      }), "edited");
    }
    case "confirm": return done(confirm(s, a, op.id, w, { confirmedMs: op.confirmedMs }), "confirmed");
    case "sold": return done(markSold(s, a, op.id, w), "sold");
    case "remove": return done(remove(s, a, op.id, w), "removed");
    case "shop": {
      const r = setShop(s, a, { ...(op.visible !== undefined ? { visible: op.visible } : {}), ...(op.town !== undefined ? { town: op.town } : {}), ...(op.pincode !== undefined ? { pincode: op.pincode } : {}), ...(op.point !== undefined ? { point: op.point } : {}), ...(op.registration !== undefined ? { registration: op.registration } : {}) });
      return r.ok ? { ok: true, change: op.visible !== undefined ? "switch" : "place" } : r;
    }
  }
}

// ---- the reads -----------------------------------------------------------------------------------------------------------------------------------------

/** The marks a counted listing carries on the owner's page (none for an uncounted one, so its row is as it was). */
const stockMarks = (stock: Parameters<typeof quantityOfListing>[0], l: Pick<Listing, "id">): { counted?: true; soldOut?: true } => {
  const q = quantityOfListing(stock, l.id);
  return q === undefined ? {} : { counted: true, ...(q <= 0 ? { soldOut: true as const } : {}) };
};

/** One listing as the owner's page shows it: what to draw and which buttons make sense. Never the bytes of a photo. */
export interface OwnerListingRow {
  id: string; state: "draft" | "live"; category: string; ownerLang: Lang; words: Listing["words"]; pricePaise?: number; priceNote?: string; qty?: number;
  photos: { id: string; type: Photo["type"]; width: number; height: number }[]; freshness: "fresh" | "check" | "hidden"; confirmedMs?: number; claims?: string[];
  /** The owner counts this listing (modules/stock): `qty` is then the count now, and `soldOut` says the count is 0 so the listing has sold itself. */
  counted?: true; soldOut?: true;
}
export interface OwnerListingsView {
  shop: ListingsShop; listings: OwnerListingRow[]; pending: Photo[]; uploadsLeft: number; maxLive: number; liveCount: number;
  categories: { id: string; names: Partial<Record<Lang, string>> }[];
}

/** What the public page, the feed and the open data read: only what a visitor may see. No `by`, no `from`, no asks, no drafts, no sold or hidden listing. */
export interface PublicListingsRead { shop: ListingsShop; listings: Listing[] }

/** The shape the pure feed builders take, made from a public read (the builders ignore what is not public anyway). */
export const stateOfPublic = (r: PublicListingsRead): ListingsState => ({ seq: 0, items: r.listings, shop: r.shop, pending: [], uploads: { day: "", n: 0 } });

export interface ListingsKitOptions { owner: { whatsapp: string; language: Language } }

export interface ListingsKit<Store extends { assistant?: import("../assistant/state.ts").AssistantState }> {
  takes(event: { kind: string }): boolean;
  run(event: ListingsEvent, ctx: { store: Store; record: ActionRecord; nowMs: number }): void;
  /** What an op would do now, without doing it: undefined when it would work, else why not. For the page's own notice. */
  check(store: Store, op: ListingOp, nowMs: number): Failure | undefined;
  ownerView(store: Store, nowMs: number): OwnerListingsView;
  publicRead(store: Store, nowMs: number): PublicListingsRead;
  /** Photo ids the shop's state holds (the clean-up keeps these). */
  keepIds(store: Store): Set<string>;
  /** A photo the PUBLIC may fetch: it belongs to a public listing now. */
  publicPhoto(store: Store, id: string, nowMs: number): Photo | undefined;
  /** A photo the OWNER may fetch: any the state holds (a draft's, a waiting one, a hidden listing's). */
  ownerPhoto(store: Store, id: string): Photo | undefined;
  /** Is the photo upload still within today's bound? */
  uploadsLeft(store: Store, nowMs: number): number;
}

export function createListingsKit<Store extends { assistant?: import("../assistant/state.ts").AssistantState }>(o: ListingsKitOptions & { timezone: string }): ListingsKit<Store> {
  const ownerLang = o.owner.language as Lang;
  const dayOf = (nowMs: number): string => { const p = localParts(nowMs, o.timezone); return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; };
  const stateOf = (store: Store): ListingsState => listingsOf((store.assistant ??= { seq: 0, cards: [], refused: [], closedDays: [], undo: [], talk: [], limitChanges: [] }));
  const peek = (store: Store): ListingsState | undefined => store.assistant?.listings;
  const digest = (v: unknown): string => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

  return {
    takes: (event) => event.kind === "owner_listing" || event.kind === "owner_photo",
    run(event, ctx) {
      const s = stateOf(ctx.store);
      const a = ownerAuthority("app");
      const line = (change: ListingChange, l: Pick<Listing, "id" | "category" | "by" | "from">, inputs: unknown, outcome: "confirmed" | "blocked", notes: string) =>
        ctx.record.append({ conversation: o.owner.whatsapp, action: LISTING_ACTION, outcome, inputs, language: o.owner.language, refs: listingRefs(l, change), notes });
      if (event.kind === "owner_photo") {
        const r = noteUpload(s, a, event.photo, dayOf(ctx.nowMs), { nowMs: ctx.nowMs });
        // the line names the photo's id and size, never its bytes; a refused upload is a blocked line (its bytes are cleaned up with the others no listing holds)
        line("photo", { id: event.photo.id, category: "other", by: "owner", from: "app" }, { photo: event.photo.id, bytes: event.photo.bytes }, r.ok ? "confirmed" : "blocked", r.ok ? "the owner added a photo through their app; it was checked and cleaned, and no listing holds it yet" : "the day's photo bound was reached; the photo was not kept");
        return;
      }
      const r = applyOp(s, event.op, a, { nowMs: ctx.nowMs, ownerLang });
      if (!r.ok) {
        line("edited", { id: "l-0", category: "other", by: "owner", from: "app" }, { op: event.op.op, why: r.why }, "blocked", `the owner's listings page asked for something the rules refuse (${r.why}); nothing changed`);
        return;
      }
      const l = r.listing;
      // the Confirm button on the page is the same "Yes, I still have it" as the morning card: for a counted listing that sold itself at 0 it sets the count (stock.ts restoreAfterYes)
      if (l && r.change === "confirmed" && restoreAfterYes(ctx.store.assistant?.stock, a, l.id, l.qty, `confirm-${event.id}`, { nowMs: ctx.nowMs })) {
        ctx.record.append({ conversation: o.owner.whatsapp, action: STOCK_ACTION, outcome: "confirmed", inputs: { op: "correct", item: listingStockId(l.id) }, language: o.owner.language, refs: stockRefs(listingStockId(l.id), "corrected", "owner"), notes: "the owner confirmed a listing that had sold itself at 0, so its count was set to the number they first said" });
      }
      if (l) line(r.change, l, { op: event.op.op, listing: l.id, digest: digest(event.op) }, "confirmed", "the owner changed their listings in their app; the record keeps the listing's id, category and who, never its words");
      else line(r.change, { id: "l-0", category: "other", by: "owner", from: "app" }, { op: "shop", digest: digest(event.op) }, "confirmed", "the owner changed how the shop shows itself (the switch, the place or the registration) in their app");
    },
    check(store, op, nowMs) {
      const copy = structuredClone(peek(store) ?? listingsOf({}));
      const r = applyOp(copy, op, ownerAuthority("app"), { nowMs, ownerLang });
      return r.ok ? undefined : r.why;
    },
    ownerView(store, nowMs) {
      const s = peek(store) ?? listingsOf({});
      const stock = store.assistant?.stock;
      const rows: OwnerListingRow[] = ownersListings(s).map((l) => ({
        ...stockMarks(stock, l),
        id: l.id, state: l.state as "draft" | "live", category: l.category, ownerLang: l.ownerLang, words: l.words, ...(l.pricePaise !== undefined ? { pricePaise: l.pricePaise } : {}), ...(l.priceNote ? { priceNote: l.priceNote } : {}), ...(quantityOfListing(stock, l.id) !== undefined ? { qty: quantityOfListing(stock, l.id)! } : l.qty !== undefined ? { qty: l.qty } : {}),
        photos: l.photos.map((p) => ({ id: p.id, type: p.type, width: p.width, height: p.height })), freshness: l.state === "live" ? freshnessOf(l, nowMs) : "fresh", ...(l.confirmedMs !== undefined ? { confirmedMs: l.confirmedMs } : {}), ...(l.claims ? { claims: l.claims } : {}),
      }));
      return {
        shop: s.shop, listings: rows, pending: pendingPhotos(s, nowMs).map(({ atMs: _atMs, ...p }) => p), uploadsLeft: s.uploads.day === dayOf(nowMs) ? Math.max(0, UPLOADS_PER_DAY - s.uploads.n) : UPLOADS_PER_DAY,
        maxLive: MAX_LIVE, liveCount: s.items.filter((l) => l.state === "live").length,
        categories: [...CATEGORIES.map((id) => ({ id, names: {} })), ...(s.shop.extraCategories ?? [])],
      };
    },
    publicRead(store, nowMs) {
      const s = peek(store);
      if (!s) return { shop: { visible: false }, listings: [] };
      // by, from and the morning's asks are the owner's business; a copy without them is all the public side ever gets
      // a counted listing (modules/stock) shows its count as its quantity and leaves the page by itself at 0; nothing is written to the listing, and an uncounted one is as it was
      const stock = store.assistant?.stock;
      const listings = publicListings(s, nowMs, soldOutListings(stock)).map(({ by: _by, from: _from, askedMs: _askedMs, ...rest }) => {
        const q = quantityOfListing(stock, rest.id);
        return { ...rest, ...(q !== undefined ? { qty: q } : {}), by: "owner" as const, from: "app" as const };
      });
      return { shop: s.shop, listings };
    },
    keepIds: (store) => new Set(peek(store) ? allPhotoIds(peek(store)!) : []),
    publicPhoto(store, id, nowMs) { const s = peek(store); return s ? publicListings(s, nowMs, soldOutListings(store.assistant?.stock)).flatMap((l) => l.photos).find((p) => p.id === id) : undefined; },
    ownerPhoto(store, id) { const s = peek(store); return s ? [...s.items.flatMap((l) => l.photos), ...s.pending].find((p) => p.id === id) : undefined; },
    uploadsLeft(store, nowMs) { const s = peek(store); return !s || s.uploads.day !== dayOf(nowMs) ? UPLOADS_PER_DAY : Math.max(0, UPLOADS_PER_DAY - s.uploads.n); },
  };
}

/** How long a draft or an unused upload waits is in listings.ts; the clean-up the runtime runs once a day keeps a photo this long before it may delete one nothing holds. */
export const PHOTO_GRACE_MS = DAY;
