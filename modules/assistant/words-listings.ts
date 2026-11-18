// What the assistant says to the owner about listings (block S, phase A), in English, Hindi, Malayalam and Kannada: the answer after a tap, the refusals, and the card's own question
// ("Show this on your page?", "Still have it?"). The lines themselves live with the module (modules/listings/words.ts) so the storefront, the owner's app and the review sheets read
// the same words; this file only carries them through the assistant's Writer, so every value is noted for the outgoing check (a title is the owner's own word: a literal). Kept apart
// from words.ts so that file does not grow by a whole feature, like words-memory.ts.
import type { Language } from "../language/languages.ts";
import { LISTING_WORDS, priceLine } from "../listings/words.ts";
import type { Failure } from "../listings/listings.ts";
import type { PhotoRefusal } from "../listings/photo.ts";
import type { Writer } from "./words.ts";

export type ListingLine =
  | { line: "published" | "confirmed" | "sold"; title: string }
  | { line: "dropped" | "need_model" | "need_photo" | "unknown" | "gone" | "model_failed" }
  | { line: "refused"; why: Failure | "no_model" | "model_failed" | "numbers" | "claims" | "health" | "price_not_in_words"; animal?: string; max?: number }
  | { line: "photo"; why: PhotoRefusal | "day" };

export interface ListingMessageData { listing_line: ListingLine }

const refusalOf = (language: Language, d: Extract<ListingLine, { line: "refused" }>, w: Writer): string => {
  const r = LISTING_WORDS[language].refusal;
  switch (d.why) {
    case "protected_animal": return r.protected(w.lit(d.animal ?? ""));
    case "health_claim": case "health": return r.health;
    case "price_not_in_words": case "numbers": return r.priceNotInWords;
    case "claims": return r.claims;
    case "full": return r.full(w.n(d.max ?? 50));
    case "too_many_drafts": return r.tooManyDrafts;
    case "too_long": return r.tooLong;
    case "bad_price": return r.badPrice;
    case "bad_qty": return r.badQty;
    case "bad_category": return r.badCategory;
    case "bad_place": return r.badPlace;
    case "too_many_photos": return r.tooManyPhotos;
    case "no_such_listing": return r.unknown;
    case "not_live": case "not_a_draft": return r.gone;
    case "no_model": return LISTING_WORDS[language].needModel;
    case "model_failed": return r.modelFailed;
    default: return r.empty;
  }
};

const line = (language: Language, d: ListingLine, w: Writer): string => {
  const x = LISTING_WORDS[language];
  switch (d.line) {
    case "published": return x.published(w.lit(d.title));
    case "confirmed": return x.confirmed(w.lit(d.title));
    case "sold": return x.markedSold(w.lit(d.title));
    case "dropped": return x.dropped;
    case "need_model": return x.needModel;
    case "need_photo": return x.needPhoto;
    case "unknown": return x.refusal.unknown;
    case "gone": return x.refusal.gone;
    case "model_failed": return x.refusal.modelFailed;
    case "photo": return x.refusal.photo[d.why];
    default: return refusalOf(language, d, w);
  }
};

export const LISTING_MSG: Record<Language, { listing_line: (d: ListingLine, w: Writer) => string }> = {
  en: { listing_line: (d, w) => line("en", d, w) }, hi: { listing_line: (d, w) => line("hi", d, w) },
  ml: { listing_line: (d, w) => line("ml", d, w) }, kn: { listing_line: (d, w) => line("kn", d, w) },
};

/**
 * The card's question for a listing card (words.ts SKILL_ASK "listings"): `what` is the title in the owner's language, `who` the category's name there, `amountPaise` the owner's
 * price (0: ask the shop), `words` the owner's own note on the price. Written from the same fields the card's digest covers, so what the owner reads is what one tap does.
 */
export function listingCardLine(language: Language, w: Writer, d: { kind: string; who: string; what: string; amountPaise: number; words?: string }): string | undefined {
  const x = LISTING_WORDS[language];
  if (d.kind === "listing_ask") return x.still(w.lit(d.what));
  if (d.kind !== "listing") return undefined;
  const price = d.amountPaise > 0 ? `${w.inr(d.amountPaise)}${d.words ? ` ${w.lit(d.words)}` : ""}` : priceLine(undefined, undefined, language);
  return x.card({ title: w.lit(d.what), price, category: w.lit(d.who) });
}
