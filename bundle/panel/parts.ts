// A shop's template parts in the panel (decision 65): add a part to a live shop, take one out, and the rules both follow. Pure over the shop's files (the panel writes them;
// the deployer then runs the shop on go/cmd/parts). The rules, each conservative and each the owner's to confirm (go/TRIAL.md § decision 65):
//   * ADD. A single-template shop that takes a second part becomes a parts shop: its settings are split into the shop's keys and the old template's block (templates/commerce/
//     parts/src/settings.ts asParts), that template stays FIRST and is the `carried` part (its saved state and its record lines from before are read as its own), and its pin
//     becomes parts@<version>. A parts shop takes a template it does not have. The new settings must pass every part's own check, and the number of parts the plan allows
//     (lib/parts-limit.ts, one setting in the price list in force; none there is no limit).
//   * REMOVE. Only from a parts shop, never its last part, never the carried part (the shop's history from before it had parts is read as that part's), and never a part that
//     still has cases open (the runtime's own count of them, by state; a state this does not know as finished counts as open). The removed part's saved state stays in the
//     shop's store and its lines in the record: nothing of its history is thrown away. A shop left with one part stays a parts shop.
import { PART_TEMPLATES, asParts, isPartName, validateSettings } from "../../templates/commerce/parts/src/settings.ts";
import type { PartName } from "../../templates/commerce/parts/src/settings.ts";
import { pathwayVersion as partsVersion } from "../../templates/commerce/parts/server/config.ts";
import { partsProblem } from "../lib/parts-limit.ts";

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);


export type PartsChange = { ok: true; settings: Obj; lock: string } | { ok: false; errors: string[] };

/** The shop's parts, in order, from its pin and settings (a single-template shop: its one template). */
export function partsOf(settings: Obj, lock: string): string[] {
  const pathway = lock.split("@")[0];
  if (pathway === "parts") return isObj(settings.parts) ? Object.keys(settings.parts) : [];
  return [pathway];
}

/** The templates that could be added to this shop. */
export function addable(settings: Obj, lock: string): PartName[] {
  const have = partsOf(settings, lock);
  if (lock.split("@")[0] !== "parts" && !isPartName(lock.split("@")[0])) return [];
  return (Object.keys(PART_TEMPLATES) as PartName[]).filter((p) => !have.includes(p));
}

/** Add `part` with its own settings `block`. */
export function addPart(o: { settings: Obj; lock: string; part: string; block: unknown; plan?: string | null; limit?: number }): PartsChange {
  const pathway = o.lock.split("@")[0];
  if (!isPartName(o.part)) return { ok: false, errors: [`"${o.part}" is not a template a shop can run as a part.`] };
  if (!isObj(o.block)) return { ok: false, errors: ["The part's settings are an object (its own keys, without the shop's name, time zone, languages, owner and assistant)."] };
  let next: Obj;
  if (pathway === "parts") {
    if (!isObj(o.settings.parts)) return { ok: false, errors: ["The shop's settings have no parts."] };
    if (o.part in o.settings.parts) return { ok: false, errors: [`The shop already runs ${o.part}.`] };
    next = { ...o.settings, parts: { ...o.settings.parts, [o.part]: o.block } };
  } else if (isPartName(pathway)) {
    if (pathway === o.part) return { ok: false, errors: [`The shop already runs ${o.part}.`] };
    next = asParts(pathway, o.settings, { others: { [o.part]: o.block }, carried: true });
  } else return { ok: false, errors: [`A ${pathway} shop cannot take parts (a shop of several parts runs ${Object.keys(PART_TEMPLATES).join(", ")}).`] };
  const checked = validateSettings(next);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const tooMany = partsProblem(checked.settings.parts.length, o.plan, o.limit);
  if (tooMany) return { ok: false, errors: [tooMany] };
  return { ok: true, settings: next, lock: `parts@${partsVersion()}` };
}

/** The states a part's cases end in, by template: any other state is a case still open (the runtime's /status counts them as "<part>:<state>"). */
const FINISHED: Record<PartName, readonly string[]> = {
  orders: ["completed", "cancelled", "expired"],
  fees: ["paid", "waived", "closed", "cancelled"],
  "stock-orders": ["received", "cancelled", "declined", "closed", "done"],
};

/** How many of this part's cases are still open, from the runtime's case counts ("orders:confirmed": 2). */
export function openCasesOf(counts: Record<string, unknown> | undefined, part: string): number {
  if (!counts || !isPartName(part)) return 0;
  let open = 0;
  for (const [key, n] of Object.entries(counts)) {
    const [p, state] = key.split(":");
    if (p === part && typeof n === "number" && !FINISHED[part].includes(state ?? "")) open += n;
  }
  return open;
}

/** Take `part` out. `openCases`: the runtime's count of its cases still open (undefined: the runtime could not be asked, so nothing is taken out). */
export function removePart(o: { settings: Obj; lock: string; part: string; openCases: number | undefined }): PartsChange {
  if (o.lock.split("@")[0] !== "parts" || !isObj(o.settings.parts)) return { ok: false, errors: ["Only a shop of several parts has parts to take out."] };
  if (!(o.part in o.settings.parts)) return { ok: false, errors: [`The shop does not run ${o.part}.`] };
  if (Object.keys(o.settings.parts).length <= 1) return { ok: false, errors: ["A shop keeps at least one part."] };
  if (o.settings.carried === o.part) return { ok: false, errors: [`${o.part} is the part the shop was before it had parts: its history from then is read as its own, so it stays.`] };
  if (o.openCases === undefined) return { ok: false, errors: ["The shop's runtime could not be asked how many of the part's cases are still open, so nothing was taken out. Try again when the shop is running."] };
  if (o.openCases > 0) return { ok: false, errors: [`${o.part} still has ${o.openCases} open case${o.openCases === 1 ? "" : "s"}. Finish or cancel ${o.openCases === 1 ? "it" : "them"} first.`] };
  const { [o.part]: _gone, ...rest } = o.settings.parts;
  const next = { ...o.settings, parts: rest };
  const checked = validateSettings(next);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  return { ok: true, settings: next, lock: o.lock };
}

/** A template's example settings as a part's block: what the "add a part" form starts from (its own keys only). */
export function exampleBlock(part: PartName, example: Obj): Obj {
  const made = asParts(part, example);
  return ((made.parts as Obj)[part] ?? {}) as Obj;
}
