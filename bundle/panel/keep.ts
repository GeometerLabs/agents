// The phone form never drops what it does not show (owner, 17 Nov 2026, item 7). Each form builds a shop's settings from its own boxes, so before this file an edit
// silently lost every field the form has no box for: a Fees student's `backDues`, `joined` and `adult`, a Classes block, an Orders shop's `plans`, a slot's own cut-off,
// a Stock supplier's `approved`. An Operator who corrected one fee then deleted the old dues and their reminders stopped.
//
// The rule, in one function: start from the settings the shop has saved (the raw settings.json), and replace only what the form owns. A top-level key the form owns and no
// longer writes (an address that was cleared, a delivery area that was removed) is deleted, not brought back. A list the form owns (batches, menu, slots, suppliers) is
// matched to the saved entries by id (students by their name and parent's number, the key the settings' own duplicate check uses); a matched entry keeps every key the form
// does not write, and an entry the Operator removed goes with all its fields, because it is simply not in the built list. The caller then runs the template's
// `validateSettings` on the result, so a kept value that no longer fits (a back due above a fee that was lowered) is refused in the validator's plain words, never saved.
//
// No list of hidden keys is kept here, only the keys each form OWNS: a field another stream adds to the settings tomorrow is kept without a change in this file.
// Nothing here reads disk or imports a template, so the same function is used by the four forms and by the tests.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** How the entries of one list the form owns are matched and merged. */
export interface ListRule {
  /** The keys the form writes for each entry. Every other key of the matching saved entry is kept. */
  owned: string[];
  /** Keys where the saved value wins even though the form writes one too (a supplier's approval, a student's own language). */
  prefer?: string[];
  /** The entry's `names`: when the name the form shows is the saved one, every saved name (the other languages, the other ways customers say it) is kept. */
  names?: boolean;
  /**
   * How many saved entries the form has room to show (its MAX_*). A saved entry after that is not on the form at all, so it is kept as it was and added after the form's own
   * (a centre with more batches than the form takes is set up by a builder: the form must not delete the rest).
   */
  shown?: number;
  /** Which saved entry each built entry is. Default: the one with the same `id`. */
  pair?: (built: Obj[], saved: Obj[]) => (Obj | undefined)[];
}

export interface KeepSpec {
  /** The top-level keys the form writes (or deliberately leaves out when empty). A saved key not named here is kept as it was. */
  owned: string[];
  /** A top-level object the form writes only some keys of: the named keys are the form's, the rest of the saved object is kept ("limits" keeps `maxQuantity`). */
  objects?: Record<string, string[]>;
  /** Lists the form owns, by path ("batches", "pickup.slots"). */
  lists?: Record<string, ListRule>;
}

const clone = <T>(v: T): T => structuredClone(v);
const without = (o: Obj, keys: readonly string[]): Obj => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

const getPath = (o: Obj, path: string): unknown => path.split(".").reduce<unknown>((at, k) => (isObj(at) ? at[k] : undefined), o);
/** A copy of `o` with the value at `path` replaced (only the objects on the way are copied). A path that is not there is left alone. */
function setPath(o: Obj, path: string, value: unknown): Obj {
  const [head, ...rest] = path.split(".");
  if (rest.length === 0) return { ...o, [head]: value };
  const inner = o[head];
  return isObj(inner) ? { ...o, [head]: setPath(inner, rest.join("."), value) } : o;
}

/** The name an entry shows in a language: its first name there, or its first name in any language (the same fallback the forms use to show it). */
const nameIn = (names: unknown, language: string | undefined): string | undefined => {
  if (!isObj(names)) return undefined;
  const list = (language ? names[language] : undefined) ?? Object.values(names).find((l) => Array.isArray(l) && l.length > 0);
  return Array.isArray(list) && typeof list[0] === "string" ? list[0] : undefined;
};

const firstLanguage = (root: Obj): string | undefined => (Array.isArray(root.languages) && typeof root.languages[0] === "string" ? root.languages[0] : undefined);

/** Match each built entry to a saved entry with the same id; an id is used once. */
const byId = (built: Obj[], saved: Obj[]): (Obj | undefined)[] => {
  const used = new Set<Obj>();
  return built.map((b) => { const s = saved.find((x) => !used.has(x) && typeof x.id === "string" && x.id === b.id); if (s) used.add(s); return s; });
};

/**
 * Fees students have no id. They are matched by the settings' own key (the parent's number and the lowercased name), then, so that a corrected spelling does not cost a student
 * their back dues, by the same parent's number and the same batch, only when exactly one saved and one typed student fit. A match ALWAYS keeps the parent's number: a student
 * is never matched by name alone, because a removed "Rahul" of one family and a new "Rahul" of another would otherwise hand the first family's old dues to the second.
 */
export function pairStudents(built: Obj[], saved: Obj[]): (Obj | undefined)[] {
  const name = (x: Obj) => String(x.name ?? "").trim().toLowerCase();
  const out: (Obj | undefined)[] = built.map(() => undefined);
  const used = new Set<number>();
  built.forEach((b, i) => {
    const j = saved.findIndex((s, k) => !used.has(k) && s.parent === b.parent && name(s) === name(b));
    if (j >= 0) { used.add(j); out[i] = saved[j]; }
  });
  built.forEach((b, i) => {
    if (out[i]) return;
    const same = (a: Obj, c: Obj) => a.parent === c.parent && a.batch === c.batch;
    const others = built.filter((o, k) => k !== i && !out[k] && same(b, o));
    const fits = saved.map((s, k) => [s, k] as const).filter(([s, k]) => !used.has(k) && same(b, s));
    if (others.length === 0 && fits.length === 1) { used.add(fits[0][1]); out[i] = fits[0][0]; }
  });
  return out;
}

const hasDetails = (s: Obj): boolean => (Array.isArray(s.backDues) && s.backDues.length > 0) || typeof s.joined === "string" || s.adult === true;

/**
 * The saved students whose hidden details (back dues, joining day, adult) could not be carried over although a typed student has the same name: the parent's number changed, and a
 * number is the only safe proof it is the same family. The save says so, by name, so the Operator can ask for the details to be added again. A student simply removed is not listed.
 */
export function studentsWithoutSafeMatch(built: Obj[], saved: Obj[]): string[] {
  const pairs = pairStudents(built, saved);
  const matched = new Set(pairs.filter(Boolean));
  const name = (x: Obj) => String(x.name ?? "").trim().toLowerCase();
  return saved.filter((s) => !matched.has(s) && hasDetails(s) && built.some((b, i) => !pairs[i] && name(b) === name(s))).map((s) => String(s.name));
}

/** One entry: the saved keys the form does not write, then what the form wrote, then the keys where the saved value wins. */
function mergeEntry(built: Obj, saved: Obj | undefined, rule: ListRule, languages: string[], builtFirst: string | undefined, savedFirst: string | undefined): Obj {
  if (!saved) return built;
  const entry: Obj = { ...clone(without(saved, rule.owned)), ...built };
  for (const key of rule.prefer ?? []) if (key in saved) entry[key] = clone(saved[key]);
  // a saved language the shop no longer offers cannot stay (the settings refuse it): the form's own value, or none, stands
  if (typeof entry.language === "string" && !languages.includes(entry.language)) { if (typeof built.language === "string") entry.language = built.language; else delete entry.language; }
  if (rule.names && isObj(built.names) && isObj(saved.names)) {
    const shown = nameIn(saved.names, savedFirst);
    if (shown !== undefined && shown === nameIn(built.names, builtFirst)) {
      // every saved name stays (even a language the shop does not offer yet); a shop language the saved entry has no name in gets the form's (the form's names for languages the shop does not offer are left out)
      entry.names = { ...clone(Object.fromEntries(Object.entries(built.names as Obj).filter(([l]) => languages.includes(l)))), ...clone(saved.names as Obj) };
    }
  }
  // the keys stay in the order the saved entry had (new ones after), so an entry that changed nothing is the same bytes
  return Object.fromEntries([...Object.keys(saved).filter((k) => k in entry), ...Object.keys(entry).filter((k) => !(k in saved))].map((k) => [k, entry[k]]));
}

/** The same value with every object's keys in one fixed order, so two values that say the same thing compare equal whatever order their keys came in. */
const canonical = (v: unknown): unknown => (Array.isArray(v) ? v.map(canonical) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);

/** What the form built for a part, laid out like the saved part: equal in content: the saved one itself; otherwise the saved key order for the keys that remain, new keys after. */
function sameOrder(built: unknown, saved: unknown): unknown {
  if (saved === undefined) return built;
  if (JSON.stringify(canonical(built)) === JSON.stringify(canonical(saved))) return clone(saved);
  if (!isObj(built) || !isObj(saved)) return built;
  return Object.fromEntries([...Object.keys(saved).filter((k) => k in built), ...Object.keys(built).filter((k) => !(k in saved))].map((k) => [k, built[k]]));
}

/** The settings the form built, with everything the form does not own put back from the saved settings. `saved` undefined (a new shop): the built settings as they are. */
export function keepHidden(built: unknown, saved: unknown, spec: KeepSpec): unknown {
  if (!isObj(built) || !isObj(saved)) return built;
  let out: Obj = clone(without(saved, spec.owned));
  for (const [key, value] of Object.entries(built)) {
    const parts = spec.objects?.[key];
    if (parts && isObj(value) && isObj(saved[key])) {
      const before = saved[key] as Obj;
      const merged: Obj = { ...clone(without(before, parts)), ...value };
      // a part the form owns that says the same as before stays as it was, byte for byte; one that changed keeps the saved order of what remains, new keys after
      for (const part of parts) if (part in value) merged[part] = sameOrder(value[part], before[part]);
      out[key] = merged;
    } else out[key] = value;
  }
  const languages = Array.isArray(built.languages) ? built.languages.filter((l): l is string => typeof l === "string") : [];
  for (const [path, rule] of Object.entries(spec.lists ?? {})) {
    const now = getPath(out, path);
    const before = getPath(saved, path);
    if (!Array.isArray(now) || !Array.isArray(before)) continue;
    const entries = now.filter(isObj);
    const pairs = (rule.pair ?? byId)(entries, before.filter(isObj));
    const merged = entries.map((b, i) => mergeEntry(b, pairs[i], rule, languages, firstLanguage(built), firstLanguage(saved)));
    const unseen = rule.shown === undefined ? [] : before.slice(rule.shown).filter(isObj).filter((x) => !merged.some((m) => m.id !== undefined && m.id === x.id));
    out = setPath(out, path, [...merged, ...clone(unseen)]);
  }
  return out;
}

// ---- what each form owns -----------------------------------------------------------------------------------------------------------------------

const NAMED = ["id", "names"];

/** Bookings (setup.ts + demo/personalise.ts). Not owned, so kept: the address, a service's machine or chair (`resource`), the reminders, slot and buffer minutes, the time zone. */
const BOOKINGS: KeepSpec = {
  // "discounts" (E1): the deposit step's boxes write it, or leave it out when switched off (discounts.ts)
  owned: ["name", "languages", "services", "openingHours", "resources", "deposit", "cancellation", "owner", "approvers", "payment", "calendar", "discounts"],
  lists: { services: { owned: [...NAMED, "priceInr", "durationMinutes"], names: true, shown: 4 } }, // shown = demo/personalise.ts MAX_SERVICES (test/keep.test.ts checks it)
};

/** Fees (fees.ts). Not owned, so kept: `joiningMidMonth`, a student's `joined`, `backDues` and `adult`, a student's own language, a batch's other names, the Classes block's lead minutes and file limit. */
const FEES: KeepSpec = {
  owned: ["name", "address", "languages", "batches", "students", "due", "lateFeeInr", "reminders", "partPayments", "waiver", "refund", "payment", "owner", "approvers", "classes"],
  // the Classes block: the form owns the timetable and the old-dues switch; the lead minutes and the file limit stay as saved
  objects: { classes: ["timetable", "oldDuesStopLink"] },
  lists: {
    batches: { owned: [...NAMED, "monthlyFeeInr"], names: true, shown: 6 }, // shown = fees.ts MAX_BATCHES (test/keep.test.ts checks it)
    students: { owned: ["name", "parent", "batch"], prefer: ["language"], pair: pairStudents },
  },
};

/** Orders (orders.ts). Not owned, so kept: `plans`, the reminder, a slot's own cut-off and most orders, an item's other names. */
const ORDERS: KeepSpec = {
  // "discounts" (E1): the rules step's boxes write it, or leave it out when switched off (discounts.ts)
  owned: ["name", "address", "languages", "menu", "orders", "cutoff", "pickup", "delivery", "advance", "cancellation", "refund", "payment", "owner", "approvers", "discounts"],
  lists: {
    menu: { owned: [...NAMED, "priceInr", "dailyStock"], names: true },
    "pickup.slots": { owned: ["id", "from", "to", "names"], names: true },
    "delivery.slots": { owned: ["id", "from", "to", "names"], names: true },
  },
};

/** Stock orders (stock.ts). Not owned, so kept: the follow-up hours, the most units in one order, a supplier's aliases, language and approval. */
const STOCK: KeepSpec = {
  owned: ["name", "address", "languages", "owner", "items", "units", "suppliers", "catalogue", "limits"],
  objects: { limits: ["maxPerOrderInr", "monthlyBudgetInr"] },
  lists: {
    items: { owned: NAMED, names: true },
    units: { owned: NAMED, names: true },
    suppliers: { owned: ["id", "name", "whatsapp"], prefer: ["aliases", "language", "approved"] },
  },
};

/** Listings only (listings.ts). The form owns the name, the place, the trade, the languages and the owner; the time zone and the assistant's block are kept as saved. */
const LISTINGS: KeepSpec = { owned: ["name", "place", "trade", "languages", "owner"] };

export const KEEP: Record<string, KeepSpec> = { bookings: BOOKINGS, fees: FEES, orders: ORDERS, "stock-orders": STOCK, listings: LISTINGS };
