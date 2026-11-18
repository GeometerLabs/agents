// One shop's own model budget (owner, 19 Nov 2026, "a busy Basic shop"): a small file in the shop's own folder on the server, shops/<shop>/budget-override.json, that replaces
// the numbers it names in the shop's model budget and leaves the rest as the plan's (bundle/lib/budget.ts reads it when it works the shop's budget out, so an agent shop and a
// listings-only shop honour it the same way). It is the SERVER ADMIN's: only `geometer shop budget` (bundle/geometer.ts) writes or removes it, on the command line, and no panel
// route reads it for anything but showing it. On Geometer's own Operator server Geometer pays for the model, so an Operator must never be able to raise it; keeping the writer
// out of the panel is how that is true. The numbers are never in code: this file holds the format and the checks only.
//
//   { "monthlyInr": 40, "daily": { "owner_talk": 50 }, "reason": "busy shop, owner asked", "setBy": "Naval", "date": "2026-11-19" }
//
// `daily` is optional. Whole rupees and whole counts only, known feature names only, a reason and who set it always: a number nobody can explain is how a budget gets forgotten.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FEATURES } from "../../modules/budget/budget.ts";
import type { BudgetConfig, Feature } from "../../modules/budget/budget.ts";
import { writeAtomic } from "./util.ts";

/** The file's name in the shop's folder. */
export const OVERRIDE_FILE = "budget-override.json";

/** The features a SHOP spends on. `buyer` is the directory's assistant, which is not a shop's and has its own budget, so a shop's override may not name it. */
export const SHOP_FEATURES = FEATURES.filter((f) => f !== "buyer") as readonly Feature[];

/** The largest number the file accepts, for rupees and for counts: far above any real shop, so a slipped zero is refused rather than becoming a month of spend. */
export const OVERRIDE_MAX = 100_000;

export interface BudgetOverride {
  /** The month's most model spend for this shop, in whole rupees (the budget itself is in micro-rupees; see `applyOverride`). */
  monthlyInr: number;
  /** Daily caps (calls a day) for the features named; any feature left out keeps the plan's. */
  daily?: Partial<Record<Feature, number>>;
  /** Why, in one line. Shown to the shop's Operator in the panel. */
  reason: string;
  /** Who set it (the admin's name), one line. */
  setBy: string;
  /** The day it was set, YYYY-MM-DD. */
  date: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, max = OVERRIDE_MAX): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= max;
const oneLine = (v: unknown, max: number): v is string => typeof v === "string" && v.trim() === v && v.length >= 1 && v.length <= max && !/[\r\n\u0000-\u001f]/u.test(v);
const realDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** The file's text (or an object) judged: the override, or every problem in plain words. */
export function parseOverride(input: unknown): { ok: true; override: BudgetOverride } | { ok: false; errors: string[] } {
  let raw: unknown = input;
  if (typeof input === "string") {
    try { raw = JSON.parse(input); } catch (e) { return { ok: false, errors: [`it is not valid JSON (${(e as Error).message})`] }; }
  }
  if (!isObj(raw)) return { ok: false, errors: ["it must be a JSON object like {\"monthlyInr\": 40, \"reason\": \"...\", \"setBy\": \"...\", \"date\": \"2026-11-19\"}"] };
  const errors: string[] = [];
  for (const k of Object.keys(raw)) if (!["monthlyInr", "daily", "reason", "setBy", "date"].includes(k)) errors.push(`"${k}" is not something this file says (it has monthlyInr, daily, reason, setBy and date)`);
  if (!whole(raw.monthlyInr)) errors.push(`"monthlyInr" must be a whole number of rupees from 1 to ${OVERRIDE_MAX}`);
  let daily: Partial<Record<Feature, number>> | undefined;
  if (raw.daily !== undefined) {
    if (!isObj(raw.daily)) errors.push('"daily" must list features and a whole number of calls a day, like {"owner_talk": 50}');
    else {
      daily = {};
      for (const [k, n] of Object.entries(raw.daily)) {
        if (!(SHOP_FEATURES as readonly string[]).includes(k)) errors.push(`"${k}" is not a feature a shop has a daily cap on (it has ${SHOP_FEATURES.join(", ")})`);
        else if (!whole(n)) errors.push(`the daily cap for ${k} must be a whole number of calls from 1 to ${OVERRIDE_MAX}`);
        else daily[k as Feature] = n;
      }
    }
  }
  if (!oneLine(raw.reason, 120)) errors.push('"reason" must say why, in one line of up to 120 characters');
  if (!oneLine(raw.setBy, 60)) errors.push('"setBy" must be the name of who set it, in one line of up to 60 characters');
  if (!realDay(raw.date)) errors.push('"date" must be a real day written like 2026-11-19');
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, override: { monthlyInr: raw.monthlyInr as number, ...(daily && Object.keys(daily).length > 0 ? { daily } : {}), reason: raw.reason as string, setBy: raw.setBy as string, date: raw.date as string } };
}

/** Read a shop's override from its folder. No file is no override; a file that cannot be used is reported, never half-applied. */
export function readOverride(shopFolder: string): { override?: BudgetOverride; problem?: string } {
  const path = join(shopFolder, OVERRIDE_FILE);
  if (!existsSync(path)) return {};
  const r = parseOverride(readFileSync(path, "utf8"));
  return r.ok ? { override: r.override } : { problem: `${OVERRIDE_FILE} is not usable: ${r.errors.join("; ")}. Fix it, or remove it with: geometer shop budget <shop> --clear.` };
}

/** Write (replace) the override, after it has been judged. Atomic, so a reader never sees half a file. */
export function writeOverride(shopFolder: string, override: BudgetOverride): void {
  const checked = parseOverride(override);
  if (!checked.ok) throw new Error(`The budget override is not usable: ${checked.errors.join("; ")}.`);
  writeAtomic(join(shopFolder, OVERRIDE_FILE), `${JSON.stringify(checked.override, null, 2)}\n`);
}

/** Take the override away, so the plan's numbers hold again. False when there was none. */
export function clearOverride(shopFolder: string): boolean {
  const path = join(shopFolder, OVERRIDE_FILE);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

/**
 * The shop's budget with its override on top: the month's rupees become the override's, and each daily cap it names becomes the override's, while every other number (the
 * features it does not name, the warning share) stays the plan's. With no plan budget (a list without one, or a shop with no plan) the override still makes a budget out of what it
 * names alone: the admin's word is explicit, and a budget with only the numbers it names is a valid one (a feature with no daily cap has none).
 */
export function applyOverride(base: BudgetConfig | undefined, o: BudgetOverride | undefined): BudgetConfig | undefined {
  if (!o) return base;
  return { ...(base ?? { daily: {} }), monthlyMicroInr: o.monthlyInr * 1_000_000, daily: { ...(base?.daily ?? {}), ...(o.daily ?? {}) } };
}
