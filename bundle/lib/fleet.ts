// What fleet says back (B48), and the two small files ops keeps for it in the fleet folder (<server>/fleet, the one folder ops can write):
//
//   <fleet>/<shop>.json        schema 1: the last answer fleet gave about this shop. The deployer reads `ai` from it (button mode, generate/shop.ts), the panel reads
//                              the rest (plan, allowance, innovator badge, warnings). Written by ops only, on a 200, and only for a shop that is in the answer.
//   <fleet>/usage-baseline.json  schema 1: the cumulative counts fleet has accepted for each shop, so an ops restart sends the difference and never replays history.
//
// A missing, older or unreadable answer means "keep the last mode": nothing here ever turns a shop to normal because fleet was quiet. The reading is tolerant,
// field by field: a field of the wrong type is dropped, never guessed, and an `ai` that is neither "normal" nor "buttons" makes no entry at all.
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
  /** Codes the panel says in the shop's language: allowance_80, balance_80, whatsapp_unsettled. Unknown codes are kept and ignored by the panel. */
  warn: string[];
}

export interface AnswerFile extends ShopAnswer { schema: 1; at: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const CODE = /^[a-z0-9_]{1,40}$/u;
/** Fleet's agent ids: the heartbeat's id rule. The first character is never `_`, so no `__proto__`. */
const SHOP = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

/** One entry, or undefined when it cannot be trusted (no usable `ai`). */
export function parseShopAnswer(raw: unknown): ShopAnswer | undefined {
  if (!isObj(raw) || (raw.ai !== "normal" && raw.ai !== "buttons")) return undefined;
  const plan = (PLANS as readonly unknown[]).includes(raw.plan) ? (raw.plan as Plan) : null;
  const allowance = typeof raw.allowance === "number" && Number.isSafeInteger(raw.allowance) && raw.allowance >= 0 ? raw.allowance : null;
  const warn = Array.isArray(raw.warn) ? raw.warn.filter((c): c is string => typeof c === "string" && CODE.test(c)).slice(0, 8) : [];
  return {
    plan, allowance, innovator: raw.innovator === true, ai: raw.ai,
    ...(raw.ai === "buttons" && typeof raw.reason === "string" && CODE.test(raw.reason) ? { reason: raw.reason } : {}),
    warn,
  };
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

export function readAnswerFile(path: string): AnswerFile | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    const a = isObj(raw) && raw.schema === 1 ? parseShopAnswer(raw) : undefined;
    return a && isObj(raw) && typeof raw.at === "string" && Number.isFinite(Date.parse(raw.at)) ? { schema: 1, at: raw.at, ...a } : undefined;
  } catch { return undefined; }
}

/** Write the answer for each shop that is on this server and in the answer. Others are not touched: no entry means "keep the last mode". */
export function writeAnswerFiles(dir: string, shops: readonly string[], answer: Record<string, ShopAnswer>, at: Date): string[] {
  const written: string[] = [];
  for (const shop of shops) {
    const a = answer[shop];
    if (!a) continue;
    const file: AnswerFile = { schema: 1, at: at.toISOString(), ...a };
    writeAtomic(join(dir, `${shop}.json`), `${JSON.stringify(file, null, 2)}\n`);
    written.push(shop);
  }
  return written;
}

// ---- the usage baseline -------------------------------------------------------------------------------------------------------------------------------------------

/** The cumulative counts fleet has accepted for one shop: the totals of lib/usage.ts, flattened. */
export interface UsageCounters {
  messages: number; rules: number; decision: number; model: number; modelMicroInr: number;
  service: number; utility: number; marketing: number; estMicroInr: number; estimated: boolean;
}
export type UsageBaseline = Record<string, UsageCounters>;
export const COUNTER_FIELDS = ["messages", "rules", "decision", "model", "modelMicroInr", "service", "utility", "marketing", "estMicroInr"] as const;

export const baselineFile = (dir: string): string => join(dir, "usage-baseline.json");

export function readUsageBaseline(dir: string): UsageBaseline {
  try {
    const raw: unknown = JSON.parse(readFileSync(baselineFile(dir), "utf8"));
    if (!isObj(raw) || raw.schema !== 1 || !isObj(raw.shops)) return {};
    const out: UsageBaseline = {};
    for (const [shop, c] of Object.entries(raw.shops)) {
      if (!SHOP.test(shop) || !isObj(c)) continue;
      const n = COUNTER_FIELDS.map((f) => c[f]);
      if (n.every((v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0)) out[shop] = { ...(Object.fromEntries(COUNTER_FIELDS.map((f, i) => [f, n[i]])) as Omit<UsageCounters, "estimated">), estimated: c.estimated === true };
    }
    return out;
  } catch { return {}; }
}

/** Only the shops given are kept: a shop removed from the server does not leave a baseline behind. */
export function writeUsageBaseline(dir: string, baseline: UsageBaseline, shops: readonly string[]): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeAtomic(baselineFile(dir), `${JSON.stringify({ schema: 1, shops: Object.fromEntries(shops.filter((s) => baseline[s]).map((s) => [s, baseline[s]])) }, null, 2)}\n`);
}
