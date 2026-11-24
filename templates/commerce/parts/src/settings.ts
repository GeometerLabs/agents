// A shop of several template parts (decision 65): its settings.json read and checked the way the shop's Go program reads it (go/internal/parts parts.go ReadSettings), for the
// deployer and the panel, which are TypeScript. The keys every template reads sit at the top (SHARED_KEYS: name, address, timezone, languages, owner, assistant); each part's
// own keys sit in `parts.<template>`, in the shop's order; each part is checked by ITS OWN template's check on the top keys plus its block, so its settings mean what they mean
// in a single-part shop. A key the block shares with the top is refused, except an object at both (the owner), whose members join (a member in both is refused).
//
// Also here, so a shop is made into a parts shop in ONE place: `asParts` (a single template's settings split into the top and that part's block) and `partSettings` (a part's
// settings as its template reads them). The panel's "add a part" and the contract harnesses' switch to the parts program both use them.
//
// Decided conservatively, and the owner's to confirm (go/TRIAL.md § decision 65): no payment gateway in a parts shop yet (UPI only: one Guard holds one shop's refund limits,
// and two parts' limits in one gateway spec are not designed), and Bookings is not a part yet (its calendar Guard and booking page).
import { validateSettings as feesSettings } from "../../../education/fees/src/settings.ts";
import { validateSettings as ordersSettings } from "../../orders/src/settings.ts";
import { validateSettings as stockSettings } from "../../stock-orders/src/settings.ts";

/** The keys every part's template accepts: the shop's, set once at the top. */
export const SHARED_KEYS = ["name", "address", "timezone", "languages", "owner", "assistant"] as const;

/** The templates a shop may run as parts, by the name a part goes by. */
export const PART_TEMPLATES = { fees: feesSettings, orders: ordersSettings, "stock-orders": stockSettings } as const;
export type PartName = keyof typeof PART_TEMPLATES;
export const isPartName = (x: unknown): x is PartName => typeof x === "string" && Object.prototype.hasOwnProperty.call(PART_TEMPLATES, x);

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

/** One part, checked: its name, its settings in its template's own shape, and the merged file its template read. */
export interface CheckedPart { name: PartName; settings: any; file: Obj }

/** A parts shop's settings, checked: the shop's name, time zone and owner (what the bundle reads of every shop), its languages, its parts in order, and the carried part. */
export interface Settings { name: string; timezone: string; owner: { whatsapp: string; language: string }; languages: string[]; assistant?: unknown; parts: CheckedPart[]; carried?: PartName }

export type SettingsResult = { ok: true; settings: Settings } | { ok: false; errors: string[] };

/** The part's settings file as its template reads it: the top keys, then the block's; a clash is said as `parts.<name>: "<key>" ...`. */
export function partSettings(input: Obj, name: string, block: Obj): { ok: true; file: Obj } | { ok: false; error: string } {
  const file: Obj = {};
  for (const [k, v] of Object.entries(input)) if (k !== "parts" && k !== "carried") file[k] = v;
  for (const [k, v] of Object.entries(block)) {
    if (!(k in file)) { file[k] = v; continue; }
    const top = file[k];
    if (!isObj(top) || !isObj(v)) return { ok: false, error: `parts.${name}: "${k}" is the shop's, set once at the top of the settings.` };
    for (const m of Object.keys(v)) if (m in top) return { ok: false, error: `parts.${name}: "${k}.${m}" is the shop's, set once at the top of the settings.` };
    file[k] = { ...top, ...v };
  }
  return { ok: true, file };
}

/** Check a parts shop's settings.json: every problem, each with the part it is in. */
export function validateSettings(input: unknown): SettingsResult {
  if (!isObj(input) || !isObj(input.parts) || Object.keys(input.parts).length === 0) return { ok: false, errors: [`"parts" names the shop's parts, each with its own settings: {"fees": {...}, "stock-orders": {...}, "orders": {...}}.`] };
  const errors: string[] = [];
  const carried = input.carried;
  if (carried !== undefined && typeof carried !== "string") errors.push(`"carried" is the name of the part the shop was before it had parts (a string), or left out.`);
  const parts: CheckedPart[] = [];
  for (const [name, block] of Object.entries(input.parts)) {
    if (!isPartName(name)) { errors.push(`parts: "${name}" is not a template a shop can run as a part (${Object.keys(PART_TEMPLATES).sort().join(", ")}).`); continue; }
    if (!isObj(block)) { errors.push(`parts.${name} is the part's own settings, an object.`); continue; }
    const merged = partSettings(input, name, block);
    if (!merged.ok) { errors.push(merged.error); continue; }
    if ((merged.file.payment as { module?: unknown } | undefined)?.module === "razorpay") { errors.push(`parts.${name}: a shop of several parts takes UPI payments (no payment gateway yet: one Guard holds one shop's refund limits).`); continue; }
    const r = PART_TEMPLATES[name](merged.file);
    if (!r.ok) { for (const e of r.errors) errors.push(`parts.${name}: ${e}`); continue; }
    parts.push({ name, settings: r.settings, file: merged.file });
  }
  if (typeof carried === "string" && !parts.some((p) => p.name === carried) && !errors.some((e) => e.startsWith(`parts.${carried}`))) errors.push(`"carried" names "${carried}", which is not one of the shop's parts.`);
  if (errors.length > 0) return { ok: false, errors };
  const first = parts[0].settings as { name: string; timezone: string; owner: { whatsapp: string; language: string }; languages: string[]; assistant?: unknown };
  return { ok: true, settings: { name: first.name, timezone: first.timezone, owner: first.owner, languages: first.languages, ...(first.assistant !== undefined ? { assistant: first.assistant } : {}), parts, ...(typeof carried === "string" ? { carried: carried as PartName } : {}) } };
}

/** As validateSettings, throwing every problem at once. */
export function parseSettings(input: unknown): Settings {
  const r = validateSettings(input);
  if (!r.ok) throw new Error(`These settings need fixing:\n- ${r.errors.join("\n- ")}`);
  return r.settings;
}

/**
 * A single template's settings.json made into ONE part of a parts shop's settings: the shared keys to the top (the owner's number and language only: the template's other owner
 * members, Orders' approveOverInr, stay in the block), every other key to `parts.<name>`. `others` are more parts' blocks, after it (the shop's order: this one first unless
 * `first` is false). `carried` names this part when the shop was this template before.
 */
export function asParts(name: PartName, single: Obj, o: { others?: Record<string, Obj>; first?: boolean; carried?: boolean; top?: Obj } = {}): Obj {
  const top: Obj = {};
  const block: Obj = {};
  for (const [k, v] of Object.entries(single)) {
    if (k === "owner" && isObj(v)) {
      const { whatsapp, language, ...rest } = v;
      top.owner = { ...(whatsapp !== undefined ? { whatsapp } : {}), ...(language !== undefined ? { language } : {}) };
      if (Object.keys(rest).length > 0) block.owner = rest;
    } else if ((SHARED_KEYS as readonly string[]).includes(k)) top[k] = v;
    else block[k] = v;
  }
  const others = o.others ?? {};
  const parts: Obj = o.first === false ? { ...others, [name]: block } : { [name]: block, ...others };
  return { ...top, ...(o.top ?? {}), ...(o.carried ? { carried: name } : {}), parts };
}
