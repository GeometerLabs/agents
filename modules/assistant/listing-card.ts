// The listing card (block S, phase A): "Show this on your page? [Show it] [Change] [No]" and "Still have the Persian kitten? [Yes] [Sold]". Like the limits card (limits-card.ts) it is
// one more SKILL of the assistant, so a listing's card takes exactly the path of every other card: bound to the exact fields (cards.ts), one use, a no is final, a tap after the
// fields changed does nothing and a new card is made. Nothing becomes public before the owner's tap, and only the owner's tap (an Authority, modules/memory) publishes.
//
//  - `listing`: the card for a drafted listing. Every field the card shows is in its action (category, title and text per language, the owner's own price, note and quantity, the
//    photos' ids), so the digest covers what the owner read. A tap publishes THAT listing, only while the draft still has exactly those fields (an edit made since voids the card).
//  - `listing_ask`: the owner's morning question about a live listing. Bound to the listing and the `confirmedMs` the owner was shown, so an old question does nothing. Yes renews
//    the listing; No on this card is "Sold" (the listing hides at once). Nothing is ever confirmed by a customer.
//
// "Change" is not a third answer of a card: it is the owner editing the draft on the listings page of their app, which voids the old card and makes a new one (conversation.ts).
import { ownerAuthority } from "../memory/memory.ts";
import type { NoteFrom } from "../memory/memory.ts";
import { LANGS, LISTING_ACTION, confirm, listingById, listingRefs, listingsOf, markSold, publish, textIn } from "../listings/listings.ts";
import type { Listing } from "../listings/listings.ts";
import { LISTING_WORDS } from "../listings/words.ts";
import type { Language } from "../language/languages.ts";
import type { Outcome } from "../record/record.ts";
import type { Executed, OwnerSkill, Prepared, Proposal } from "./skill.ts";
import { assistantOf } from "./state.ts";
import type { AssistantState, CardAction } from "./state.ts";

/** The case a listing card carries: "listing:l-3". routing.refs matches it, so the one card path finds this skill. */
export const listingCase = (id: string): string => `listing:${id}`;
const ID = /^listing:(l-\d{1,9})$/u;

export interface ListingsDeps {
  store: { assistant?: AssistantState };
  nowMs(): number;
  ownerLanguage: Language;
  /** The record's line (the template's writer; the case is none). */
  log(action: string, outcome: Outcome, inputs: unknown, refs: Record<string, string>, notes?: string): void;
}

/** The fields a listing card's action carries, flat (a card's fields are scalars): everything the owner is shown and everything a tap publishes. */
export function listingFields(l: Listing): Record<string, string | number | boolean> {
  const f: Record<string, string | number | boolean> = { category: l.category, ownerLang: l.ownerLang, from: l.from, photos: l.photos.map((p) => p.id).join(",") };
  for (const k of LANGS) {
    const w = l.words[k];
    if (w) { f[`title_${k}`] = w.title; f[`text_${k}`] = w.text; }
  }
  if (l.pricePaise !== undefined) f.pricePaise = l.pricePaise;
  if (l.priceNote) f.priceNote = l.priceNote;
  if (l.qty !== undefined) f.qty = l.qty;
  if (l.claims && l.claims.length > 0) f.claims = l.claims.join(" | ");
  return f;
}

export function createListings(d: ListingsDeps) {
  const state = () => listingsOf(assistantOf(d.store));
  const categoryName = (l: Listing, language: Language): string => LISTING_WORDS[language].categories[l.category as keyof typeof LISTING_WORDS.en.categories] ?? l.category;
  const log = (l: Listing, change: Parameters<typeof listingRefs>[1], inputs: unknown, notes: string) => d.log(LISTING_ACTION, "confirmed", inputs, listingRefs(l, change), notes);

  const skill: OwnerSkill = {
    name: "listings",
    routing: { refs: /^listing:l-\d+$/u, buttonPrefixes: [], words: {}, liveCaseOf: () => undefined },
    waiting: () => [],
    problems: () => 0,
    prepare(p: Proposal): Prepared {
      if (p.kind !== "listing" && p.kind !== "listing_ask") return { ok: false, why: "not_here" };
      const id = ID.exec(p.case)?.[1];
      const l = id ? listingById(state(), id) : undefined;
      if (!l) return { ok: false, why: "no_case" };
      const language = d.ownerLanguage;
      if (p.kind === "listing") {
        if (l.state !== "draft") return { ok: false, why: "not_live" };
        const action: CardAction = { kind: "listing", skill: "listings", case: p.case, fields: listingFields(l) };
        return { ok: true, action, shown: { who: categoryName(l, language), what: textIn(l, language).title, amountPaise: l.pricePaise ?? 0, ...(l.priceNote ? { words: l.priceNote } : {}) } };
      }
      if (l.state !== "live" || l.confirmedMs !== p.confirmedMs) return { ok: false, why: "not_live" };
      const action: CardAction = { kind: "listing_ask", skill: "listings", case: p.case, fields: { title: textIn(l, language).title, confirmedMs: p.confirmedMs } };
      return { ok: true, action, shown: { who: "", what: textIn(l, language).title, amountPaise: 0 } };
    },
    async execute(action: CardAction): Promise<Executed> {
      const id = ID.exec(action.case)?.[1];
      const s = state();
      const l = id ? listingById(s, id) : undefined;
      if (!l) return { ok: false, note: "failed" };
      const now = d.nowMs();
      if (action.kind === "listing") {
        // the tap is the owner's: the authority is made here, from the door the draft came through, only after the card's digest matched the draft as it is now
        const via: Exclude<NoteFrom, "panel"> = action.fields.from === "whatsapp" ? "whatsapp" : "app";
        const r = publish(s, ownerAuthority(via), l.id, { nowMs: now });
        if (!r.ok) return { ok: false, note: "failed" };
        log(r.value, "published", { listing: r.value.id, category: r.value.category, ...(r.value.pricePaise !== undefined ? { pricePaise: r.value.pricePaise } : {}), words: r.value.words }, "the owner tapped Show it; the listing is on the shop's page now, with the fields the card showed");
        return { ok: true, note: "done" };
      }
      if (action.kind === "listing_ask") {
        const via: "whatsapp" | "app" = "app";
        if (action.fields.answer === "no") {
          const r = markSold(s, ownerAuthority(via), l.id, { nowMs: now });
          if (!r.ok) return { ok: false, note: "failed" };
          log(r.value, "sold", { listing: r.value.id }, "the owner said it is sold; the listing is off the shop's page");
          return { ok: true, note: "done" };
        }
        const r = confirm(s, ownerAuthority(via), l.id, { nowMs: now }, { confirmedMs: Number(action.fields.confirmedMs) });
        if (!r.ok) return { ok: false, note: "failed" };
        log(r.value, "confirmed", { listing: r.value.id }, "the owner said the shop still has it; the listing was confirmed today");
        return { ok: true, note: "done" };
      }
      return { ok: false, note: "failed" };
    },
  };

  return { skill, categoryName };
}
export type Listings = ReturnType<typeof createListings>;
