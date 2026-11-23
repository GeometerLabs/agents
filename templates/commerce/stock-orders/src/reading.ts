// Reading the owner's words, by rules only. The reader only READS: it names an item, a supplier, a unit and a number from the text, or a command about an order ("received
// po-3"). It decides nothing. What may be ordered, from whom, and at what price is decided by the limits and the catalogue (limits.ts, settings.ts), so a cleverer or a fooled
// reader changes nothing about what is allowed; and anything it cannot tell is asked, never guessed (agent.ts).
//
// The words are English, Hindi, Malayalam and Kannada (the latter three also typed in Latin letters) for the commands, and the shop's OWN names for items, units and
// suppliers, taken from its settings. Reading with a language model (the shared router in modules/understanding) is not wired here: Deferred.md.
import { canon } from "../../../../modules/language/format.ts";
import { wordRe } from "../../../../modules/language/dates.ts";
import type { Names, Settings } from "./settings.ts";

export type Command = "receive" | "wrong" | "paid" | "cancel" | "send" | "change";

export type Reading =
  | { kind: "order"; lowStock: boolean; qty?: number; item?: string; /** items tied on the longest name */ tied?: string[]; supplier?: string; unit?: string; /** "from X" where X is no supplier the shop lists */ unknownSupplier?: string; mentionsOrder: boolean }
  | { kind: "command"; command: Command; ref?: string; /** the item the text names, to find the order when no number is given */ item?: string; qty?: number }
  | { kind: "status" }
  | { kind: "other" };

export const WORDS = {
  cancel: ["cancel", "रद्द", "cancel karo", "റദ്ദ്", "റദ്ദാക്കൂ", "ರದ್ದು", "ರದ್ದುಮಾಡಿ"],
  paid: ["paid", "payment done", "i paid", "paid outside", "bhugtan", "भुगतान", "पैसे दे दिए", "paise de diye", "അടച്ചു", "പണം കൊടുത്തു", "ಪಾವತಿಸಿದೆ", "ಹಣ ಕೊಟ್ಟೆ"],
  wrong: ["wrong", "wrong item", "galat", "ghalat", "ग़लत", "गलत", "തെറ്റായ", "തെറ്റ്", "ತಪ್ಪು"],
  receive: ["received", "receive", "arrived", "delivered", "mila", "mil gaya", "aa gaya", "aaya", "मिल गया", "आ गया", "पहुँच गया", "kitti", "kitti", "കിട്ടി", "വന്നു", "ಬಂತು", "ಬಂದಿದೆ", "ಸಿಕ್ಕಿತು"],
  send: ["send", "resend", "send again", "try again", "फिर भेजो", "bhejo", "അയയ്ക്കൂ", "ಕಳುಹಿಸಿ"],
  change: ["change", "make it", "update", "बदलो", "badlo", "മാറ്റൂ", "ಬದಲಿಸಿ"],
  status: ["status", "open orders", "orders", "budget", "what is open", "what's open", "pending", "स्थिति", "बजट", "സ്ഥിതി", "ബജറ്റ്", "ಸ್ಥಿತಿ", "ಬಜೆಟ್"],
  low: ["low", "finished", "ending", "out of", "ran out", "running out", "running low", "short", "khatam", "khatm", "खत्म", "ख़त्म", "कम है", "തീർന്നു", "തീരാറായി", "ಮುಗಿದಿದೆ", "ಮುಗಿಯುತ್ತಿದೆ"],
  order: ["order", "reorder", "buy", "need", "want", "get", "send me", "mangao", "mangwao", "मंगाओ", "मंगवाओ", "ऑर्डर", "चाहिए", "ഓർഡർ", "വേണം", "ആവശ്യം", "ಆರ್ಡರ್", "ಬೇಕು"],
};
const RE = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, wordRe(v, "u", false)])) as Record<keyof typeof WORDS, RegExp>;

export const ENGLISH_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
const REF_RE = /\bpo-?\s*(\d{1,6})\b/iu;

/** The text as words: lower case, digits in any script as Western digits, every run of other characters a single space, a space at each end. */
const padded = (text: string): string => ` ${canon(text).replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim()} `;

/** Does the text contain this name? A Latin name matches as a whole word, with a plural (s, es); a name in another script matches at the start of a word (a suffix may follow). */
function mentions(words: string, name: string): boolean {
  const n = canon(name).replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
  if (n === "") return false;
  if (/^[a-z0-9 ]+$/u.test(n)) return new RegExp(` ${n.replace(/ /gu, " ")}(?:s|es)? `, "u").test(words);
  return words.includes(` ${n}`);
}

/** The best (longest) name of a set that the text mentions, in any language; 0 when none. */
function longest(words: string, names: Names, extra: readonly string[] = []): number {
  let best = 0;
  for (const list of [...Object.values(names), extra]) for (const n of list ?? []) if (mentions(words, n)) best = Math.max(best, canon(n).length);
  return best;
}

/** The first whole number in the text that is not part of an order number or a price. */
export function quantityIn(text: string): number | undefined {
  const t = canon(text).replace(REF_RE, " ").replace(/(?:₹|rs\.?|inr)\s*\d[\d,.]*/giu, " ");
  const digits = /(?<![\w.-])(\d{1,6})(?![\w.]*\d)(?![.,]\d)/u.exec(t);
  if (digits) return Number(digits[1]);
  for (const w of t.split(/[^a-z]+/u)) if (w in ENGLISH_NUMBERS) return ENGLISH_NUMBERS[w];
  return undefined;
}

/** What the owner wrote, as a reading. `ordersOpen` says whether a bare command ("received") could mean an order. */
export function readOwnerText(settings: Settings, text: string): Reading {
  const t = canon(text);
  const words = padded(text);
  const ref = REF_RE.exec(t);
  const refId = ref ? `po-${Number(ref[1])}` : undefined;

  // A command about an order: it names the order, or it is the first thing the owner wrote.
  const first = words.trim().split(" ")[0] ?? "";
  const leading = (re: RegExp) => re.test(` ${first} `) || (re.test(t) && t.trim().split(/\s+/u).length <= 4);
  const commands: [Command, RegExp][] = [["cancel", RE.cancel], ["paid", RE.paid], ["wrong", RE.wrong], ["receive", RE.receive], ["send", RE.send], ["change", RE.change]];
  for (const [command, re] of commands) {
    if (!(refId ? re.test(t) : leading(re))) continue;
    const itemNamed = itemsIn(settings, words);
    if (!refId && (command === "send" || command === "change") && itemNamed.length > 0) break; // "send me 10 boxes of ..." is a request, not a command
    return { kind: "command", command, ...(refId ? { ref: refId } : {}), ...(itemNamed.length === 1 ? { item: itemNamed[0] } : {}), ...(command === "receive" || command === "change" ? { qty: quantityIn(t) } : {}) };
  }

  if (RE.status.test(t) && itemsIn(settings, words).length === 0 && !quantityIn(t)) return { kind: "status" };

  const itemHits = itemsIn(settings, words);
  const supplierId = supplierIn(settings, words);
  const named = /\bfrom\s+(.+?)\s*$/u.exec(t)?.[1]?.trim();
  const unknownSupplier = !supplierId && named && itemHits.length > 0 ? named : undefined;
  const mentionsOrder = RE.order.test(t) || RE.low.test(t);
  if (itemHits.length === 0 && !supplierId && !unknownSupplier && !mentionsOrder) return { kind: "other" };
  const unit = unitIn(settings, words);
  const qty = quantityIn(t);
  return {
    kind: "order", lowStock: RE.low.test(t), mentionsOrder,
    ...(qty !== undefined ? { qty } : {}),
    ...(itemHits.length === 1 ? { item: itemHits[0] } : itemHits.length > 1 ? { tied: itemHits } : {}),
    ...(supplierId ? { supplier: supplierId } : {}), ...(unit ? { unit } : {}), ...(unknownSupplier ? { unknownSupplier } : {}),
  };
}

/** The items the text names: the one with the longest matching name, or all that tie for it. */
function itemsIn(settings: Settings, words: string): string[] {
  const scored = settings.items.map((i) => ({ id: i.id, score: longest(words, i.names) })).filter((x) => x.score > 0);
  const best = Math.max(0, ...scored.map((x) => x.score));
  return scored.filter((x) => x.score === best).map((x) => x.id);
}

/** The supplier the text names: the longest matching name or alias, among every supplier on the list (approved or not: an unapproved one is named so it can be refused). */
export function supplierIn(settings: Settings, words: string): string | undefined {
  const w = words.startsWith(" ") ? words : padded(words);
  let best: { id: string; score: number } | undefined;
  for (const s of settings.suppliers) {
    for (const n of [s.name, ...s.aliases]) if (mentions(w, n) && (!best || canon(n).length > best.score)) best = { id: s.id, score: canon(n).length };
  }
  return best?.id;
}

/** The unit the text names (a box, a piece): the longest matching unit name. */
export function unitIn(settings: Settings, words: string): string | undefined {
  const w = words.startsWith(" ") ? words : padded(words);
  let best: { id: string; score: number } | undefined;
  for (const u of settings.units) {
    const score = longest(w, u.names);
    if (score > 0 && (!best || score > best.score)) best = { id: u.id, score };
  }
  return best?.id;
}
export { padded };
