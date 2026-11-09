// WhatsApp reply buttons and list messages for Orders: the words, the ids, the list of the menu and of the day's slots, and how a tap becomes an Intent with no model.
// Meta's limits, the message type and the checks are shared (modules/language/interactive.ts). The ids are the ones this file makes:
//   yes, no            Yes / No buttons on a read-back
//   cancel             "Cancel order": asks "are you sure" first (cancel_yes cancels, keep leaves it)
//   owner              "Talk to the owner": tells the owner, once an hour for the same customer
//   menu               back to the menu
//   pickup, delivery   how the order is collected
//   paid               "I have paid" (a UPI shop, B33): the owner is asked to look; nothing is marked paid
//   upi-received:<code>, upi-refunded:<code>, upi-kept:<code>   the owner's buttons for a UPI payment or refund (modules/payments/owner-marked/owner.ts)
//   item:<item id>     a row of the menu list: one of that item
//   slot:<slot id>     a row of the list of the day's slots
// A forged or old id changes nothing the typed word would not: a slot is checked against the cut-off, the stock and the day's limit like any typed one, and an id that
// names no item or slot of the shop is read as ordinary text.
import type { Language } from "../../../../../modules/language/languages.ts";
import { COMMON_ID, COMMON_LABELS, LIMITS, clip } from "../../../../../modules/language/interactive.ts";
import type { Choice, CommonLabels, InteractiveMessage } from "../../../../../modules/language/interactive.ts";
import { formatInr, formatTime } from "../../../../../modules/language/format.ts";
import { localParts } from "../../../../../modules/core/time.ts";
import { itemName, slotOf } from "../settings.ts";
import type { Settings } from "../settings.ts";
import type { Intent } from "../adapters/model.ts";
import { ownerMarkChoices } from "../../../../../modules/payments/owner-marked/buttons.ts";

export interface Labels extends CommonLabels {
  cancel: string; cancelYes: string; keep: string; pickItem: string; pickTime: string; pickup: string; delivery: string;
  /** UPI shops (B33): the customer's "I have paid", and the owner's "Received", "Refund sent" and "Kept for order". */
  paid: string; received: string; refundSent: string; keptForBooking: string;
}

/** Machine-written; the Hindi, Malayalam and Kannada must be read by a native speaker before a real shop sees them (REVIEW-hi.md, REVIEW-ml.md, REVIEW-kn.md). No number appears in any label. Yes, no and "talk to the owner" are the shared ones. */
export const LABELS: Record<Language, Labels> = {
  en: { ...COMMON_LABELS.en, cancel: "Cancel order", cancelYes: "Yes, cancel", keep: "No, keep it", pickItem: "Pick an item", pickTime: "Pick a time", pickup: "Pickup", delivery: "Delivery", paid: "I have paid", received: "Received", refundSent: "Refund sent", keptForBooking: "Kept for order" },
  hi: { ...COMMON_LABELS.hi, cancel: "ऑर्डर रद्द करें", cancelYes: "हाँ, रद्द करें", keep: "नहीं, रहने दें", pickItem: "चीज़ चुनें", pickTime: "समय चुनें", pickup: "पिकअप", delivery: "डिलीवरी", paid: "मैंने पैसे भेजे", received: "मिल गया", refundSent: "रिफंड भेज दिया", keptForBooking: "ऑर्डर के लिए रखा" },
  ml: { ...COMMON_LABELS.ml, cancel: "ഓർഡർ റദ്ദാക്കൂ", cancelYes: "അതെ, റദ്ദാക്കൂ", keep: "നിലനിർത്തൂ", pickItem: "സാധനം തിരഞ്ഞെടുക്കൂ", pickTime: "സമയം തിരഞ്ഞെടുക്കൂ", pickup: "പിക്കപ്പ്", delivery: "ഡെലിവറി", paid: "ഞാൻ പണമടച്ചു", received: "കിട്ടി", refundSent: "റീഫണ്ട് അയച്ചു", keptForBooking: "ഓർഡറിനായി വെച്ചു" },
  kn: { ...COMMON_LABELS.kn, cancel: "ಆರ್ಡರ್ ರದ್ದು", cancelYes: "ಹೌದು, ರದ್ದು", keep: "ಹಾಗೇ ಇರಲಿ", pickItem: "ವಸ್ತು ಆಯ್ಕೆಮಾಡಿ", pickTime: "ಸಮಯ ಆಯ್ಕೆಮಾಡಿ", pickup: "ಪಿಕಪ್", delivery: "ಡೆಲಿವರಿ", paid: "ನಾನು ಪಾವತಿಸಿದ್ದೇನೆ", received: "ಬಂದಿದೆ", refundSent: "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ", keptForBooking: "ಆರ್ಡರ್‌ಗೆ ಇಟ್ಟಿದೆ" },
};

export const ID = { ...COMMON_ID, cancel: "cancel", cancelYes: "cancel_yes", keep: "keep", menu: "menu", paid: "paid", pickup: "pickup", delivery: "delivery" } as const;
export type ButtonId = "yes" | "no" | "cancel" | "cancelYes" | "keep" | "owner" | "paid" | "pickup" | "delivery";

export const itemRowId = (itemId: string) => `item:${itemId}`;
export const slotRowId = (slotId: string) => `slot:${slotId}`;

/** The buttons named, in the language, in this order. */
export function buttonsFor(language: Language, ids: ButtonId[]): Choice[] {
  const labels = LABELS[language];
  const title: Record<ButtonId, string> = { yes: labels.yes, no: labels.no, cancel: labels.cancel, cancelYes: labels.cancelYes, keep: labels.keep, owner: labels.owner, paid: labels.paid, pickup: labels.pickup, delivery: labels.delivery };
  return ids.map((id) => ({ id: ID[id], title: clip(title[id], LIMITS.buttonTitle) }));
}

/** The owner's buttons for a UPI payment ("Received ₹200") or a refund ("Refund sent", and "Kept for order" where that is offered). Each carries its one-use code. */
export function ownerMarkButtons(language: Language, a: { kind: "received"; code: string; amountInr: number } | { kind: "refund"; code: string; keepAllowed: boolean }): Choice[] {
  return ownerMarkChoices(LABELS[language], a);
}

/** The list of the shop's menu, with the price on each row and, last, a row to reach the owner. At most 9 items fit beside it; a tenth is reached by typing its name. */
export function itemList(settings: Settings, language: Language): NonNullable<InteractiveMessage["list"]> {
  const rows: Choice[] = settings.menu.slice(0, LIMITS.rows - 1).map((i) => ({ id: itemRowId(i.id), title: clip(itemName(i, language), LIMITS.rowTitle), description: formatInr(i.priceInr) }));
  rows.push({ id: ID.owner, title: clip(LABELS[language].owner, LIMITS.rowTitle) });
  return { button: clip(LABELS[language].pickItem, LIMITS.listButton), rows };
}

/** The list of a day's slots of one mode: the window as the row's title, and a last row to reach the owner. */
export function slotList(windows: readonly { id: string; fromMs: number; toMs: number }[], timeZone: string, language: Language): NonNullable<InteractiveMessage["list"]> {
  const rows: Choice[] = windows.slice(0, LIMITS.rows - 1).map((w) => ({ id: slotRowId(w.id), title: clip(`${formatTime(localParts(w.fromMs, timeZone), language)} – ${formatTime(localParts(w.toMs, timeZone), language)}`, LIMITS.rowTitle) }));
  rows.push({ id: ID.owner, title: clip(LABELS[language].owner, LIMITS.rowTitle) });
  return { button: clip(LABELS[language].pickTime, LIMITS.listButton), rows };
}

// ---- a tap becomes an Intent ------------------------------------------------------------------------------------------------------

/** The Intent a button or list id stands for, or null when the id is none of ours (an old message, or a forged one): the title is then read as ordinary words. */
export function intentFromReply(id: string, settings: Settings): Intent | null {
  if (id === ID.yes) return { kind: "yes" };
  if (id === ID.no) return { kind: "no" };
  if (id === ID.cancel) return { kind: "cancel", ask: true };
  if (id === ID.cancelYes) return { kind: "cancel" };
  if (id === ID.keep) return { kind: "keep" };
  if (id === ID.owner) return { kind: "owner" };
  if (id === ID.menu) return { kind: "greeting" };
  if (id === ID.paid) return { kind: "paid" };
  if (id === ID.pickup) return { kind: "order", mode: "pickup" };
  if (id === ID.delivery) return { kind: "order", mode: "delivery" };
  const item = /^item:([a-z0-9-]{1,60})$/u.exec(id);
  if (item) return settings.menu.some((i) => i.id === item[1]) ? { kind: "order", items: [{ itemId: item[1], qty: 1 }] } : null;
  const slot = /^slot:([a-z0-9-]{1,60})$/u.exec(id);
  if (slot) {
    const found = slotOf(settings, slot[1]);
    return found ? { kind: "order", slotId: slot[1], mode: found.mode } : null;
  }
  return null;
}
