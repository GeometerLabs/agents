// The heartbeat: one body every 60 seconds, built from what each shop's runtime says at /status and what each of its Guards says at /admin/status,
// in exactly the shape of Geometer's fleet contract (monorepo apps/fleet/README.md). COUNTS, VERSIONS AND HEALTH ONLY: nothing here reads a message, a name
// or a number, and the body is made field by field from numbers, booleans and a few fixed words, never copied from a reply.
//
// A Guard whose tripwires failed, or that is not ready, is sent as ready=false. A failed backup drill is NOT sent as a runtime problem: calling it "not ready"
// would raise the wrong alert and stop the shop counting as live for billing. It has its own optional fields, which fleet judges separately:
//   backup_age_s     seconds since the shop's last successful nightly snapshot
//   drill            { age_s, ok }: how long ago the last weekly restore drill ran, and whether it passed
// Both are AGES, worked out here from the host's own clock, because the contract's counts stop at 999,999 on purpose (a phone number cannot pass as one) and a
// time as text looks like a phone number to fleet's check. A field is left out when there is nothing to say (no snapshot or drill yet): fleet reads
// "absent" as "nothing to report", never as a problem. The drill's free-text reason is never sent; it stays in status/<shop>.json for `geometer status`.

// The cost meter's counts (B45) travel as `usage`, per shop, since the last accepted heartbeat. They come from the shop's status file (the 15-minute export counts
// them from the record, lib/usage.ts) as CUMULATIVE totals, and this file sends the difference against a baseline that ops keeps on disk (lib/fleet.ts):
//   - a shop with no baseline starts AT its current totals and sends nothing: history from before the meter was never counted by fleet, and replaying it would
//     put months of messages into one day;
//   - a total that went DOWN (the record was restored from a copy) restarts the baseline at the new total, and sends nothing;
//   - each count is capped at 999,999 in one heartbeat (the contract's cap), and the baseline moves only by what was SENT, so the rest goes in the next heartbeat
//     and nothing is lost to the cap or to an outage;
//   - the baseline moves on disk only when fleet answered 200 (ops.ts), the same rule as steps and errors.
// A shop with nothing new gets no `usage` field at all.
//
// Three counts fleet's badges and its unfinished-work views read (fleet ADR-0059; optional fields, so fleet must be deployed with them first):
//   since_last.reports_sent       monthly reports the owner received, the same way as the cost meter's counts (a baseline that does not have it yet starts at the
//                                 current total: a report sent before this bundle is not replayed, so a shop's First report sent badge comes with its next report)
//   usage.replies_by_language     messages to customers by language, the same way, inside `usage` (never a `usage` with only this in it: fleet needs the nine counts)
//   open_obligations              the unfinished-work list's counts by kind NOW (a gauge, sent every heartbeat; `{}` is none open), from the 15-minute export
//                                 (modules/unfinished `countsByKind`). Kind ids only, filtered to fleet's rule, so a kind fleet would refuse never costs the heartbeat.
import { COUNTER_FIELDS, EXTRA_FIELDS, looksLikeLease, parseFleetAnswer } from "../lib/fleet.ts";
import type { ShopAnswer, UsageBaseline, UsageCounters } from "../lib/fleet.ts";
import type { UsageTotals } from "../lib/usage.ts";

export interface GuardObservation {
  id: string;
  /** GET /readyz on the Guard's health port answered 200. */
  healthReady: boolean;
  /** GET /admin/status, or null when the Guard's admin port could not be reached. */
  admin: AdminStatus | null;
  /** How many approvals are waiting (GET /admin/approvals?state=pending), or null when unknown. */
  held: number | null;
}

export interface AdminStatus {
  runtime?: { mode?: string };
  kill_switch?: { on?: boolean };
  tripwires?: { ran?: boolean; ok?: boolean; passed?: number; of?: number };
}

export interface RuntimeStatus {
  pathway?: string; version?: string;
  bookings?: Record<string, number>;
  /** What a Fees runtime calls its cases (its fees, by state). The fleet contract has one map for them, `runtime.bookings`: it carries whichever the runtime has. */
  fees?: Record<string, number>;
  /** An Orders runtime's cases (its orders, by state). */
  orders?: Record<string, number>;
  tasks?: { pending?: number; failed?: number };
  lastStepAt?: string | null;
  steps?: number; errors?: number; startedAt?: string;
}

/** What the deployer's backup jobs recorded for one shop (status/<shop>.json, `backups`): times as ISO text, the drill's verdict as a flag. Nothing else of that file is read. */
export interface BackupFacts { lastCopyAt?: string | null; lastDrillAt?: string | null; drillOk?: boolean | null }

export interface ShopObservation {
  id: string;
  /** Item 11c: this shop's own Gupshup wallet pays Meta and Gupshup for WhatsApp. Its WhatsApp counts are kept in the baseline but sent as zero, so fleet's WhatsApp pass-through (billed from the partner's balance) leaves it out. */
  whatsappPaidBy?: "shop";
  pathway: string;
  pathwayVersion: string;
  up: boolean;
  ready: boolean;
  /** GET /status, or null when the runtime could not be asked. */
  status: RuntimeStatus | null;
  guards: GuardObservation[];
  /** From the deployer's status file; left out when the file is missing or unreadable (then no backup field is sent, never a wrong one). */
  backups?: BackupFacts;
  /** The record's cumulative counts, from the same file (`usage`); left out when there are none yet. Then no usage is sent and the baseline stays as it was. */
  usage?: UsageTotals;
  /** The unfinished-work list's counts by kind, as of the last export (status/<shop>.json `obligations`). Left out when unknown: then `open_obligations` is left out too. */
  obligations?: Record<string, number>;
}

/** Running totals as last ACCEPTED by fleet, per shop. The difference is what a heartbeat sends. */
export type Baseline = Record<string, { startedAt: string; steps: number; errors: number }>;

const MAX_COUNT = 999_999;
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(MAX_COUNT, Math.floor(v)) : 0);
const STATE_NAME = /^[a-z_]{1,64}$/u;

/** Whole seconds from an ISO time to `now`, as a count. A time in the future (a clock set back) is 0; text that is not a time is nothing to report. */
function ageSeconds(now: Date, at: string | null | undefined): number | undefined {
  const t = typeof at === "string" ? Date.parse(at) : Number.NaN;
  return Number.isFinite(t) ? count(Math.floor((now.getTime() - t) / 1000)) : undefined;
}

/** Steps and errors since the last accepted heartbeat. A new start time means the runtime restarted and its totals began again from zero. */
export function since(status: RuntimeStatus | null, base: Baseline[string] | undefined): { steps: number; errors: number } {
  if (!status || typeof status.steps !== "number" || typeof status.errors !== "number") return { steps: 0, errors: 0 };
  const same = base !== undefined && base.startedAt === status.startedAt && status.steps >= base.steps && status.errors >= base.errors;
  return { steps: count(status.steps - (same ? base.steps : 0)), errors: count(status.errors - (same ? base.errors : 0)) };
}

const flat = (t: UsageTotals): UsageCounters => ({
  messages: t.messages, rules: t.byStep.rules, decision: t.byStep.decision, model: t.byStep.model, modelMicroInr: t.modelMicroInr,
  service: t.whatsapp.service, utility: t.whatsapp.utility, marketing: t.whatsapp.marketing, estMicroInr: t.whatsapp.estMicroInr, estimated: t.whatsapp.estimated,
  ...(t.reportsSent !== undefined ? { reportsSent: t.reportsSent } : {}), ...(t.repliesByLanguage ? t.repliesByLanguage : {}),
});

/** Fleet's rule for a kind id (apps/fleet/src/schema.ts): lowercase words joined by single `_`, no digits, at most 40 characters; at most 20 kinds. */
const FLEET_KIND = /^(?=.{1,40}$)[a-z]+(?:_[a-z]+)*$/u;
export const MAX_OBLIGATION_KINDS = 20;
/** The counts by kind as the heartbeat may carry them: only kind ids fleet takes, each a count, at most 20. A kind it would refuse is left out, never the heartbeat. */
export function obligationCounts(raw: Record<string, unknown> | undefined): Record<string, number> | undefined {
  if (!raw) return undefined;
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => FLEET_KIND.test(k) && typeof v === "number" && Number.isFinite(v) && v >= 0).slice(0, MAX_OBLIGATION_KINDS).map(([k, v]) => [k, count(v)]));
}

/**
 * What to send for one shop, and where its baseline goes if fleet accepts it. `send` is undefined when there is nothing to say. `reportsSent` is the count for
 * `since_last.reports_sent`, undefined when the shop's totals do not count reports (an older status file) or there is no baseline yet.
 */
export function usageDelta(current: UsageTotals, base: UsageCounters | undefined): { send?: Record<string, unknown>; next: UsageCounters; reportsSent?: number } {
  const cur = flat(current);
  // The estimate was 0 because a rate was missing, or is no longer: its totals are not comparable, so it starts again from the current one and sends nothing this time.
  const comparable = !!base && cur.estimated === base.estimated;
  const skip = (f: (typeof COUNTER_FIELDS)[number]) => f === "estMicroInr" && !comparable;
  if (!base || COUNTER_FIELDS.some((f) => !skip(f) && cur[f] < base[f])) return { next: cur };
  const sent = {} as UsageCounters;
  const next = { ...cur } as UsageCounters;
  for (const f of COUNTER_FIELDS) {
    const take = skip(f) ? 0 : Math.min(cur[f] - base[f], MAX_COUNT);
    sent[f] = take;
    next[f] = skip(f) ? cur[f] : base[f] + take;
  }
  // The badges' counts: one the baseline does not have yet, or that went down, starts at the current total and sends nothing this time.
  const extra: Partial<Record<(typeof EXTRA_FIELDS)[number], number>> = {};
  for (const f of EXTRA_FIELDS) {
    const c = cur[f];
    if (c === undefined) continue;
    const b = base[f];
    if (b === undefined || c < b) { next[f] = c; extra[f] = 0; continue; }
    extra[f] = Math.min(c - b, MAX_COUNT);
    next[f] = b + extra[f]!;
  }
  const replies = Object.fromEntries((["hi", "en", "ml", "kn"] as const).filter((l) => (extra[l] ?? 0) > 0).map((l) => [l, extra[l]]));
  const reports = extra.reportsSent !== undefined ? { reportsSent: extra.reportsSent } : {};
  if (COUNTER_FIELDS.every((f) => sent[f] === 0) && Object.keys(replies).length === 0) return { next, ...reports };
  return {
    send: {
      messages: sent.messages, by_step: { rules: sent.rules, decision: sent.decision, model: sent.model }, model_micro_inr: sent.modelMicroInr,
      whatsapp: { service: sent.service, utility: sent.utility, marketing: sent.marketing, est_micro_inr: sent.estMicroInr },
      ...(Object.keys(replies).length > 0 ? { replies_by_language: replies } : {}),
    },
    next, ...reports,
  };
}

/**
 * The panel's address as fleet takes it in a heartbeat (`panel_url`, fleet's schema.ts): https and nothing after the host and port, at most 200 characters, and
 * nothing fleet would take for a phone number or an email address (a whole heartbeat with a field fleet refuses is refused). Anything else is not sent: the
 * account page then shows no "Open panel" link for this server, and nothing else changes.
 */
export function panelUrlForFleet(url: string | undefined): string | undefined {
  if (!url || url.length > 200 || url.includes("@") || /\+?\d(?:[\s().-]{0,2}\d){6,}/u.test(url)) return undefined;
  try { const u = new URL(url); return u.protocol === "https:" && u.origin === url ? url : undefined; } catch { return undefined; }
}

// Builds the 60-second body from what was observed. Usage is sent as the change since the last beat (the baseline), so a lost beat does not double count; a shop that did not answer reuses its last known status.
export function buildHeartbeat(input: { deploymentId: string; bundleVersion: string; panelUrl?: string; now: Date; shops: ShopObservation[]; baseline: Baseline; lastKnown?: Record<string, RuntimeStatus>; usageBaseline?: UsageBaseline }): { body: Record<string, unknown>; next: Baseline; nextUsage: UsageBaseline } {
  const next: Baseline = { ...input.baseline };
  const nextUsage: UsageBaseline = { ...input.usageBaseline };
  const agents = input.shops.map((shop) => {
    const used = shop.usage ? usageDelta(shop.usage, input.usageBaseline?.[shop.id]) : undefined;
    if (used) nextUsage[shop.id] = used.next;
    const known = shop.status ?? input.lastKnown?.[shop.id] ?? null;
    const s = shop.status;
    const delta = since(s, input.baseline[shop.id]);
    if (s && typeof s.startedAt === "string") next[shop.id] = { startedAt: s.startedAt, steps: count(s.steps), errors: count(s.errors) };
    const lastStep = s?.lastStepAt ? Math.max(0, Math.floor((input.now.getTime() - Date.parse(s.lastStepAt)) / 1000)) : null;
    const bookings = Object.fromEntries(Object.entries(known?.bookings ?? known?.fees ?? known?.orders ?? {}).filter(([k]) => STATE_NAME.test(k)).slice(0, 16).map(([k, v]) => [k, count(v)]));
    const snapshotAge = ageSeconds(input.now, shop.backups?.lastCopyAt);
    const drillAge = ageSeconds(input.now, shop.backups?.lastDrillAt);
    const drillOk = shop.backups?.drillOk;
    return {
      id: shop.id,
      pathway: shop.pathway,
      pathway_version: shop.pathwayVersion,
      runtime: {
        up: shop.up, ready: shop.up && shop.ready,
        tasks: { pending: count(known?.tasks?.pending), failed: count(known?.tasks?.failed) },
        last_step_age_s: shop.up && Number.isFinite(lastStep) ? lastStep : null,
        bookings,
      },
      guards: shop.guards.map((g) => ({
        id: g.id,
        // not ready if it says so, if its admin port cannot be reached, or if its self-check (the tripwires) failed
        ready: g.healthReady && g.admin !== null && g.admin.tripwires?.ok !== false,
        mode: g.admin?.runtime?.mode === "shadow" ? "shadow" : "enforce",
        killed: g.admin?.kill_switch?.on === true,
        held_calls: count(g.held),
      })),
      since_last: { ...delta, ...(used?.reportsSent !== undefined ? { reports_sent: used.reportsSent } : {}) },
      ...(snapshotAge !== undefined ? { backup_age_s: snapshotAge } : {}),
      ...(drillAge !== undefined && typeof drillOk === "boolean" ? { drill: { age_s: drillAge, ok: drillOk } } : {}),
      ...(used?.send ? { usage: shop.whatsappPaidBy === "shop" ? { ...used.send, whatsapp: { service: 0, utility: 0, marketing: 0, est_micro_inr: 0 } } : used.send } : {}),
      ...(shop.obligations ? { open_obligations: obligationCounts(shop.obligations) } : {}),
    };
  });
  return {
    body: { deployment_id: input.deploymentId, bundle_version: input.bundleVersion, ...(panelUrlForFleet(input.panelUrl) ? { panel_url: panelUrlForFleet(input.panelUrl) } : {}), sent_at: input.now.toISOString().replace(/\.\d{3}Z$/u, "Z"), agents },
    next, nextUsage,
  };
}

/**
 * `answer`: fleet's entry for each shop it said something about (lib/fleet.ts). Absent when the answer had none, or was not JSON: the caller keeps the last mode.
 * `lease`: the licence lease token of the answer, as it came (only something shaped like one); the deployer judges it.
 */
export interface SendResult { accepted: boolean; status: number | null; problem?: string; answer?: Record<string, ShopAnswer>; lease?: string }

/** One try, ten seconds. The next heartbeat replaces this one, so a failure is never retried inside the minute. The key is a header and never logged. */
export async function sendHeartbeat(url: string, key: string, body: unknown, fetchFn: typeof fetch = fetch): Promise<SendResult> {
  try {
    const r = await fetchFn(`${url.replace(/\/+$/u, "")}/v1/heartbeat`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    const text = await r.text().catch(() => "");
    if (r.status === 200) {
      let answer: Record<string, ShopAnswer> | undefined;
      let lease: string | undefined;
      try {
        const json = JSON.parse(text) as { lease?: unknown };
        answer = parseFleetAnswer(json);
        if (looksLikeLease(json?.lease)) lease = json.lease;
      } catch { /* an answer that is not JSON says nothing: the heartbeat was still accepted */ }
      return { accepted: true, status: 200, ...(answer ? { answer } : {}), ...(lease ? { lease } : {}) };
    }
    return { accepted: false, status: r.status, problem: r.status === 400 ? `fleet refused the heartbeat as malformed: ${text.slice(0, 300)}` : `fleet answered ${r.status}` };
  } catch (e) { return { accepted: false, status: null, problem: `fleet could not be reached (${(e as { cause?: { code?: string } }).cause?.code ?? (e as Error).name})` }; }
}
