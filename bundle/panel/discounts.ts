// The discount boxes of the phone setup (E1, decision 64; panel item of 24 Nov 2026), shared by the Bookings deposit step and the Orders rules step: a switch (off by default),
// the cap the agent may take off alone (a percentage and rupees, the lower one wins) once for the shop, and a floor (the lowest price) for each service or menu item.
//
// One check: what the boxes say is handed to modules/limits/discounts.ts `readDiscounts`, the same check the deployer and the templates' validateSettings run, so the
// Operator reads exactly its sentences (no second set of rules lives here). At the step the items are named by what the Operator typed (a new shop has no ids yet), so a
// sentence says "the lowest price for "Haircut""; at the save the floors are moved onto the ids the settings get, and validateSettings checks the block once more.
//
// The draft keeps each floor by the item's name in lower case, not by its row: going back to the first step and moving or adding a line does not hand a floor to another item.
// A renamed item loses its floor (the box shows empty again), which the step then says if no floor is left. A draft saved before these boxes existed has no `discounts` and
// keeps the shop's saved block exactly as it was (the panel owns the key now, so it would otherwise be deleted at the save).
import { readDiscounts } from "../../modules/limits/discounts.ts";
import type { DiscountSettings, Priced } from "../../modules/limits/discounts.ts";
import type { Language } from "../../modules/language/languages.ts";
import { html, raw } from "./html.ts";
import type { Raw } from "./html.ts";
import { wordsLanguage } from "./languages.ts";
import type { Words } from "./words.ts";

/** What the boxes hold, as typed. `floors`: by the item's name in lower case. */
export interface DiscountDraft { on: boolean; capPercent: string; capInr: string; floors: Record<string, string> }

/** An item the step shows a floor box for: its name as typed and its list price (a number, or undefined when the first step's price is not a whole number yet). */
export interface FloorItem { name: string; priceInr: number | undefined }

/** The boxes' starting values for a new shop: off, with a modest cap shown for when the Operator turns it on. */
export const newDiscountDraft = (): DiscountDraft => ({ on: false, capPercent: "10", capInr: "100", floors: {} });

const WHOLE = /^\d{1,9}$/u;
const key = (name: string) => name.trim().toLowerCase();
/** "450" is 450; anything else is passed on as typed, so readDiscounts says what is wrong with it in its own words. */
const asNumber = (v: string): number | string => (WHOLE.test(v) ? Number(v) : v);

/** The draft of a shop that exists: its block, with each floor under the name the form shows for that id. No block: the boxes are off. */
export function discountDraftOf(block: DiscountSettings | undefined, names: { id: string; name: string }[]): DiscountDraft {
  if (!block) return newDiscountDraft();
  const floors: Record<string, string> = {};
  for (const [id, inr] of Object.entries(block.floors)) {
    const n = names.find((x) => x.id === id);
    if (n) floors[key(n.name)] = String(inr);
  }
  return { on: true, capPercent: String(block.capPercent), capInr: String(block.capInr), floors };
}

/**
 * The step: reads the boxes into the draft (kept even when something is wrong, so the form refills) and, with the switch on, checks them with readDiscounts against the
 * items as typed. `what` is "service" or "item" (readDiscounts' word); `least` is the Bookings deposit (a floor is never below it). Returns readDiscounts' sentences.
 */
export function applyDiscountBoxes(body: Record<string, string | undefined>, items: FloorItem[], what: string, least?: { inr: number; name: string }): { draft: DiscountDraft; problems: string[] } {
  const box = (v: string | undefined, max: number) => (v ?? "").trim().slice(0, max);
  const floors: Record<string, string> = {};
  items.forEach((it, i) => { const v = box(body[`floor_${i}`], 9); if (v !== "") floors[key(it.name)] = v; });
  const draft: DiscountDraft = { on: body.discountsOn === "on", capPercent: box(body.capPercent, 3), capInr: box(body.capInr, 9), floors };
  if (!draft.on) return { draft, problems: [] };
  const problems: string[] = [];
  const priced: Priced[] = items.flatMap((it) => (it.priceInr !== undefined ? [{ id: it.name, priceInr: it.priceInr }] : []));
  const typed = Object.fromEntries(items.flatMap((it) => (floors[key(it.name)] !== undefined && it.priceInr !== undefined ? [[it.name, asNumber(floors[key(it.name)])]] : [])));
  readDiscounts({ capPercent: asNumber(draft.capPercent), capInr: asNumber(draft.capInr), floors: typed }, priced, what, problems, least);
  return { draft, problems };
}

/**
 * The "discounts" block the settings get, after keepHidden has put back what the form does not show: `shown` are the form's items with the ids they got at this save. Floors
 * of the form's items come from the boxes; a saved floor of an item the form does not show (a Bookings shop with more services than the form has rows) is kept while that item
 * is still in the settings. Undefined: the switch is off, and the block is left out (every price below the list is refused, as before).
 */
export function discountBlock(d: DiscountDraft | undefined, shown: { id: string; name: string }[], written: Record<string, unknown>, saved: unknown, list: "services" | "menu"): unknown {
  const savedBlock = (saved as { discounts?: unknown } | undefined)?.discounts;
  if (d === undefined) return savedBlock; // a draft from before the boxes: the saved block as it was
  if (!d.on) return undefined;
  const floors: Record<string, number | string> = {};
  for (const s of shown) { const v = d.floors[key(s.name)]; if (v !== undefined && v !== "") floors[s.id] = asNumber(v); }
  const ids = new Set(shown.map((s) => s.id));
  const now = Array.isArray(written[list]) ? (written[list] as { id?: unknown }[]).map((x) => x.id) : [];
  const before = (savedBlock as { floors?: Record<string, unknown> } | undefined)?.floors;
  if (before && typeof before === "object") for (const [id, v] of Object.entries(before)) if (!ids.has(id) && now.includes(id)) floors[id] = v as number;
  return { capPercent: asNumber(d.capPercent), capInr: asNumber(d.capInr), floors };
}

/** The settings with the block in place of what they had (left out when undefined). */
export function withDiscounts<T extends Record<string, unknown>>(written: T, block: unknown): T {
  const { discounts: _old, ...rest } = written;
  return (block === undefined ? rest : { ...rest, discounts: block }) as T;
}

// ---- the words, four languages -------------------------------------------------------------------------------------------------------

export interface DiscountWords {
  title: string;
  on: string;
  onHelp: string;
  capPercent: string;
  capInr: string;
  capHelp: string;
  floorsHelp: string;
  floor: (name: string) => string;
}

/** Hindi, Malayalam and Kannada are machine-written and on the review sheets (ids "discounts.*"). */
export const DISCOUNT_WORDS: Record<Language, DiscountWords> = {
  en: {
    title: "Discounts",
    on: "Let the agent agree to a lower price",
    onHelp: "Off: every price below your list is refused, as now. On: the agent may take off up to the amount below on its own, asks you for more, and never goes below the lowest price you set.",
    capPercent: "Most it may take off alone (%)",
    capInr: "Most it may take off alone (₹)",
    capHelp: "The lower of the two is used. Above it, the agent asks you first.",
    floorsHelp: "The lowest price for each. Leave a box empty for no discount on that one.",
    floor: (name) => `Lowest price for ${name} (₹)`,
  },
  hi: {
    title: "छूट",
    on: "एजेंट को कम दाम पर हाँ कहने दें",
    onHelp: "बंद: आपकी सूची से कम हर दाम मना होगा, जैसे अभी। चालू: एजेंट नीचे लिखी रकम तक खुद कम कर सकता है, इससे ज़्यादा के लिए आपसे पूछता है, और आपके रखे सबसे कम दाम से नीचे कभी नहीं जाता।",
    capPercent: "खुद ज़्यादा से ज़्यादा कितना कम करे (%)",
    capInr: "खुद ज़्यादा से ज़्यादा कितना कम करे (₹)",
    capHelp: "दोनों में से जो कम है, वही माना जाएगा। उससे ज़्यादा पर एजेंट पहले आपसे पूछेगा।",
    floorsHelp: "हर एक का सबसे कम दाम। जिस पर छूट नहीं देनी, उसका खाना खाली छोड़ें।",
    floor: (name) => `${name} का सबसे कम दाम (₹)`,
  },
  ml: {
    title: "ഇളവുകൾ",
    on: "കുറഞ്ഞ വിലയ്ക്ക് സമ്മതിക്കാൻ ഏജന്റിനെ അനുവദിക്കുക",
    onHelp: "ഓഫ്: നിങ്ങളുടെ ലിസ്റ്റിനേക്കാൾ കുറഞ്ഞ എല്ലാ വിലയും നിരസിക്കും, ഇപ്പോഴത്തെ പോലെ. ഓൺ: താഴെയുള്ള തുക വരെ ഏജന്റിന് സ്വയം കുറയ്ക്കാം, അതിൽ കൂടുതലിന് നിങ്ങളോട് ചോദിക്കും, നിങ്ങൾ വെച്ച ഏറ്റവും കുറഞ്ഞ വിലയ്ക്ക് താഴെ ഒരിക്കലും പോകില്ല.",
    capPercent: "സ്വയം പരമാവധി കുറയ്ക്കാവുന്നത് (%)",
    capInr: "സ്വയം പരമാവധി കുറയ്ക്കാവുന്നത് (₹)",
    capHelp: "രണ്ടിൽ കുറഞ്ഞതാണ് കണക്കാക്കുക. അതിനു മുകളിൽ ഏജന്റ് ആദ്യം നിങ്ങളോട് ചോദിക്കും.",
    floorsHelp: "ഓരോന്നിന്റെയും ഏറ്റവും കുറഞ്ഞ വില. ഇളവ് വേണ്ടാത്തതിന്റെ കള്ളി ഒഴിച്ചിടുക.",
    floor: (name) => `${name}-ന്റെ ഏറ്റവും കുറഞ്ഞ വില (₹)`,
  },
  kn: {
    title: "ರಿಯಾಯಿತಿಗಳು",
    on: "ಕಡಿಮೆ ಬೆಲೆಗೆ ಒಪ್ಪಲು ಏಜೆಂಟ್‌ಗೆ ಬಿಡಿ",
    onHelp: "ಆಫ್: ನಿಮ್ಮ ಪಟ್ಟಿಗಿಂತ ಕಡಿಮೆ ಎಲ್ಲಾ ಬೆಲೆಯನ್ನೂ ನಿರಾಕರಿಸಲಾಗುತ್ತದೆ, ಈಗಿನಂತೆ. ಆನ್: ಕೆಳಗಿನ ಮೊತ್ತದವರೆಗೆ ಏಜೆಂಟ್ ತಾನೇ ಕಡಿಮೆ ಮಾಡಬಹುದು, ಅದಕ್ಕಿಂತ ಹೆಚ್ಚಿಗೆ ನಿಮ್ಮನ್ನು ಕೇಳುತ್ತದೆ, ನೀವು ಇಟ್ಟ ಕನಿಷ್ಠ ಬೆಲೆಗಿಂತ ಕೆಳಗೆ ಎಂದಿಗೂ ಹೋಗುವುದಿಲ್ಲ.",
    capPercent: "ತಾನೇ ಗರಿಷ್ಠ ಎಷ್ಟು ಕಡಿಮೆ ಮಾಡಬಹುದು (%)",
    capInr: "ತಾನೇ ಗರಿಷ್ಠ ಎಷ್ಟು ಕಡಿಮೆ ಮಾಡಬಹುದು (₹)",
    capHelp: "ಎರಡರಲ್ಲಿ ಕಡಿಮೆಯದನ್ನು ಬಳಸಲಾಗುತ್ತದೆ. ಅದಕ್ಕಿಂತ ಹೆಚ್ಚಾದರೆ ಏಜೆಂಟ್ ಮೊದಲು ನಿಮ್ಮನ್ನು ಕೇಳುತ್ತದೆ.",
    floorsHelp: "ಪ್ರತಿಯೊಂದರ ಕನಿಷ್ಠ ಬೆಲೆ. ರಿಯಾಯಿತಿ ಬೇಡದಿದ್ದರೆ ಆ ಡಬ್ಬಿ ಖಾಲಿ ಬಿಡಿ.",
    floor: (name) => `${name} ಕನಿಷ್ಠ ಬೆಲೆ (₹)`,
  },
};

export const discountWords = (w: Words): DiscountWords => DISCOUNT_WORDS[wordsLanguage(w)];

/** The boxes, for the step's form: the switch, the two caps side by side, then a floor box for each item. `text` is the step's own box helper (views.ts). */
export function discountBoxes(w: Words, d: DiscountDraft | undefined, items: FloorItem[],
  text: (label: string, name: string, value: string, o?: { mode?: string; max?: number; help?: string }) => Raw): Raw {
  const t = discountWords(w);
  const v = d ?? newDiscountDraft();
  return html`<h2>${t.title}</h2>
  <div class="field"><label><input type="checkbox" name="discountsOn" ${v.on ? raw("checked") : ""}> ${t.on}</label><p class="help">${t.onHelp}</p></div>
  <div class="row">${text(t.capPercent, "capPercent", v.capPercent, { mode: "numeric", max: 3 })}${text(t.capInr, "capInr", v.capInr, { mode: "numeric", max: 9, help: t.capHelp })}</div>
  <p class="help">${t.floorsHelp}</p>
  ${items.map((it, i) => text(t.floor(it.name), `floor_${i}`, v.floors[key(it.name)] ?? "", { mode: "numeric", max: 9 }))}`;
}
