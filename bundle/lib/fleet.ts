// What fleet says back (B48), and the two small files ops keeps for it in the fleet folder (<server>/fleet, the one folder ops can write):
//
//   <fleet>/<shop>.json        schema 1: the last answer fleet gave about this shop. The deployer reads `ai` (button mode) and `model` (the AI cap) from it
//                              (generate/shop.ts), the panel reads the rest (plan, allowance, innovator badge, warnings). Written by ops only, on a 200, and only for a
//                              shop that is in the answer.
//   <fleet>/usage-baseline.json  schema 1: the cumulative counts fleet has accepted for each shop, so an ops restart sends the difference and never replays history.
//   <fleet>/lease              the licence lease token of the last 200 answer, as it came (B13). Ops trusts nothing in it: the deployer checks it with the key pinned in
//                              geometer.json and keeps it only if it is good and newer (lib/licence.ts).
//
// A missing, older or unreadable answer means "keep the last mode": nothing here ever turns a shop to normal because fleet was quiet. The reading is tolerant,
// field by field: a field of the wrong type is dropped, never guessed, and an `ai` that is neither "normal" nor "buttons" makes no entry at all. A `model` that is
// neither "normal" nor "off", or none, keeps the model mode the shop's file last had (the rest of the entry is still written).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./util.ts";

export const PLANS = ["basic", "business", "operations"] as const;
export type Plan = (typeof PLANS)[number];

/** One shop's entry of fleet's answer (apps/fleet/README.md, "What fleet tells each shop"). */
export interface ShopAnswer {
  plan: Plan | null;
  allowance: number | null;
  innovator: boolean;
  ai: "normal" | "buttons";
  /** Only with "buttons": why. Today only "overage_unfunded". */
  reason?: string;
  /**
   * The AI cap (price list `ai.cap`): "off" once the month's model spend reaches the cap for the shop's allowance and the extra messages bought, until the month turns and
   * fleet says "normal" again. Only for a shop on Geometer's server with a plan; left out for builders' shops, which bring their own AI key. `ai: "buttons"` outranks it.
   */
  model?: "normal" | "off";
  /** Codes the panel says in the shop's language: allowance_80, balance_80, whatsapp_unsettled, ai_cap, licence_due, licence_warning, licence_wind_down, licence_stopped. */
  warn: string[];
  /**
   * Where the shop stands in the licence's wind-down, as fleet worked it out (B13), for the panel only: its days (fleet's local days) and the renew link. Not signed: what
   * restricts a shop is the signed lease alone, worked out on this server (lib/licence.ts). Only for a shop with a plan, while fleet's licence is on.
   */
  licence?: ShopLicence;
}

export const LICENCE_STATES = ["active", "reminder", "warning", "wind_down", "stopped"] as const;
export interface ShopLicence {
  state: (typeof LICENCE_STATES)[number];
  paid_through: string | null;
  wind_down_on: string | null;
  stop_on: string | null;
  export_until: string | null;
  notice: "wind_down" | "stop" | null;
  /** The partner's payment link for the invoice holding the shop back: https only, or null. */
  renew_url: string | null;
  /**
   * Only for a shop the builder's trial covers (no plan; decision 39, monorepo ADR-0070): the trial's LAST DAY, which the panel shows as "the last day of the trial
   * is <day>" and the account page shows as `trialUntil` (one meaning since 12 Nov 2026; fleet's trial.ts `trialLastDay`). Taken as fleet sends it: no date
   * arithmetic here, so an answer and the page can never be a day apart.
   */
  trial_ends?: string;
}

export interface AnswerFile extends ShopAnswer { schema: 1; at: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const CODE = /^[a-z0-9_]{1,40}$/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const RENEW_URL = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*)?$/u;

/** The unsigned licence entry, field by field: a day that is not a day is null, a renew link that is not https is null, and an unknown state makes no entry. */
export function parseShopLicence(raw: unknown): ShopLicence | undefined {
  if (!isObj(raw) || !(LICENCE_STATES as readonly unknown[]).includes(raw.state)) return undefined;
  const day = (v: unknown): string | null => (typeof v === "string" && DAY.test(v) ? v : null);
  return {
    state: raw.state as ShopLicence["state"], paid_through: day(raw.paid_through), wind_down_on: day(raw.wind_down_on), stop_on: day(raw.stop_on), export_until: day(raw.export_until),
    notice: raw.notice === "wind_down" || raw.notice === "stop" ? raw.notice : null,
    renew_url: typeof raw.renew_url === "string" && raw.renew_url.length <= 300 && RENEW_URL.test(raw.renew_url) ? raw.renew_url : null,
    ...(day(raw.trial_ends) ? { trial_ends: day(raw.trial_ends)! } : {}),
  };
}
/** Fleet's agent ids: the heartbeat's id rule. The first character is never `_`, so no `__proto__`. */
const SHOP = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

/** One entry, or undefined when it cannot be trusted (no usable `ai`). */
export function parseShopAnswer(raw: unknown): ShopAnswer | undefined {
  if (!isObj(raw) || (raw.ai !== "normal" && raw.ai !== "buttons")) return undefined;
  const plan = (PLANS as readonly unknown[]).includes(raw.plan) ? (raw.plan as Plan) : null;
  const allowance = typeof raw.allowance === "number" && Number.isSafeInteger(raw.allowance) && raw.allowance >= 0 ? raw.allowance : null;
  const warn = Array.isArray(raw.warn) ? raw.warn.filter((c): c is string => typeof c === "string" && CODE.test(c)).slice(0, 8) : [];
  const licence = parseShopLicence(raw.licence);
  return {
    plan, allowance, innovator: raw.innovator === true, ai: raw.ai,
    ...(raw.ai === "buttons" && typeof raw.reason === "string" && CODE.test(raw.reason) ? { reason: raw.reason } : {}),
    ...(raw.model === "normal" || raw.model === "off" ? { model: raw.model } : {}),
    warn,
    ...(licence ? { licence } : {}),
  };
}

/** A lease token, as far as ops may judge it: the lease's prefix and its characters, at most 64 KB. Whether it is GOOD is the deployer's question (lib/licence.ts). */
export const looksLikeLease = (v: unknown): v is string => typeof v === "string" && v.length <= 64 * 1024 && /^gl1\.[A-Za-z0-9_.-]+$/u.test(v);

/** Keep the lease fleet sent, as it came, for the deployer to check. The same token again is not written again (fleet hands it back until something changes). */
export function writeLeaseInbox(dir: string, token: string): boolean {
  if (!looksLikeLease(token)) return false;
  const path = join(dir, "lease");
  try { if (readFileSync(path, "utf8").trim() === token) return false; } catch { /* none yet */ }
  writeAtomic(path, `${token}\n`);
  return true;
}

/** The `shops` of a 200 answer, by shop id. Undefined when the answer has none (an older fleet): the caller then keeps whatever it last knew. */
export function parseFleetAnswer(json: unknown): Record<string, ShopAnswer> | undefined {
  if (!isObj(json) || !isObj(json.shops)) return undefined;
  const out: Record<string, ShopAnswer> = {};
  for (const [id, entry] of Object.entries(json.shops)) {
    const parsed = SHOP.test(id) ? parseShopAnswer(entry) : undefined;
    if (parsed) out[id] = parsed;
  }
  return out;
}

// Reads the answer file ops keeps; any damage gives undefined (treated as "fleet said nothing"), never a guessed plan.
export function readAnswerFile(path: string): AnswerFile | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    const a = isObj(raw) && raw.schema === 1 ? parseShopAnswer(raw) : undefined;
    return a && isObj(raw) && typeof raw.at === "string" && Number.isFinite(Date.parse(raw.at)) ? { schema: 1, at: raw.at, ...a } : undefined;
  } catch { return undefined; }
}

/**
 * Write the answer for each shop that is on this server and in the answer. Others are not touched: no entry means "keep the last mode". An entry with no usable `model`
 * keeps the one the shop's file last had, so the AI cap is never lifted because fleet left the field out; only fleet saying "normal" lifts it.
 */
export function writeAnswerFiles(dir: string, shops: readonly string[], answer: Record<string, ShopAnswer>, at: Date): string[] {
  const written: string[] = [];
  for (const shop of shops) {
    const a = answer[shop];
    if (!a) continue;
    const last = a.model === undefined ? readAnswerFile(join(dir, `${shop}.json`))?.model : undefined;
    const file: AnswerFile = { schema: 1, at: at.toISOString(), ...a, ...(last ? { model: last } : {}) };
    writeAtomic(join(dir, `${shop}.json`), `${JSON.stringify(file, null, 2)}\n`);
    written.push(shop);
  }
  return written;
}

// ---- the usage baseline -------------------------------------------------------------------------------------------------------------------------------------------

/**
 * The cumulative counts fleet has accepted for one shop: the totals of lib/usage.ts, flattened. The nine `COUNTER_FIELDS` are the cost meter's; the `EXTRA_FIELDS` are the
 * counts fleet's badges read (reports sent, and replies by language), optional on both sides: a baseline written before them has none, and then each starts at the
 * shop's current total (it sends nothing that time), so an upgrade never drops the cost meter's baseline and never replays a report or a reply.
 */
export interface UsageCounters {
  messages: number; rules: number; decision: number; model: number; modelMicroInr: number;
  service: number; utility: number; marketing: number; estMicroInr: number; estimated: boolean;
  reportsSent?: number; hi?: number; en?: number; ml?: number; kn?: number;
}
export type UsageBaseline = Record<string, UsageCounters>;
export const COUNTER_FIELDS = ["messages", "rules", "decision", "model", "modelMicroInr", "service", "utility", "marketing", "estMicroInr"] as const;
export const EXTRA_FIELDS = ["reportsSent", "hi", "en", "ml", "kn"] as const;

// Where the usage baseline is kept, so usage counts can be reported as a difference from a known starting point.
export const baselineFile = (dir: string): string => join(dir, "usage-baseline.json");

// Reads the baseline, dropping entries with bad shop ids or shapes; an unreadable file gives {} so counting starts afresh instead of failing.
export function readUsageBaseline(dir: string): UsageBaseline {
  try {
    const raw: unknown = JSON.parse(readFileSync(baselineFile(dir), "utf8"));
    if (!isObj(raw) || raw.schema !== 1 || !isObj(raw.shops)) return {};
    const out: UsageBaseline = {};
    for (const [shop, c] of Object.entries(raw.shops)) {
      if (!SHOP.test(shop) || !isObj(c)) continue;
      const n = COUNTER_FIELDS.map((f) => c[f]);
      const extra = Object.fromEntries(EXTRA_FIELDS.filter((f) => typeof c[f] === "number" && Number.isSafeInteger(c[f]) && (c[f] as number) >= 0).map((f) => [f, c[f]]));
      if (n.every((v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0)) out[shop] = { ...(Object.fromEntries(COUNTER_FIELDS.map((f, i) => [f, n[i]])) as Omit<UsageCounters, "estimated">), estimated: c.estimated === true, ...extra };
    }
    return out;
  } catch { return {}; }
}

/** Only the shops given are kept: a shop removed from the server does not leave a baseline behind. */
export function writeUsageBaseline(dir: string, baseline: UsageBaseline, shops: readonly string[]): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeAtomic(baselineFile(dir), `${JSON.stringify({ schema: 1, shops: Object.fromEntries(shops.filter((s) => baseline[s]).map((s) => [s, baseline[s]])) }, null, 2)}\n`);
}
