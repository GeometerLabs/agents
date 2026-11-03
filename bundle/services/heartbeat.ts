// The heartbeat: one body every 60 seconds, built from what each shop's runtime says at /status and what each of its Guards says at /admin/status,
// in exactly the shape of Geometer's fleet contract (monorepo apps/fleet/README.md). COUNTS, VERSIONS AND HEALTH ONLY: nothing here reads a message, a name
// or a number, and the body is made field by field from numbers, booleans and a few fixed words, never copied from a reply.
//
// A Guard whose tripwires failed, or that is not ready, is sent as ready=false. A failed backup drill is NOT sent as a runtime problem: the contract has
// no field for it (Deferred.md), and calling it "not ready" would raise the wrong alert and stop the shop counting as live for billing.

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
  tasks?: { pending?: number; failed?: number };
  lastStepAt?: string | null;
  steps?: number; errors?: number; startedAt?: string;
}

export interface ShopObservation {
  id: string;
  pathway: string;
  pathwayVersion: string;
  up: boolean;
  ready: boolean;
  /** GET /status, or null when the runtime could not be asked. */
  status: RuntimeStatus | null;
  guards: GuardObservation[];
}

/** Running totals as last ACCEPTED by fleet, per shop. The difference is what a heartbeat sends. */
export type Baseline = Record<string, { startedAt: string; steps: number; errors: number }>;

const MAX_COUNT = 999_999;
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(MAX_COUNT, Math.floor(v)) : 0);
const STATE_NAME = /^[a-z_]{1,64}$/u;

/** Steps and errors since the last accepted heartbeat. A new start time means the runtime restarted and its totals began again from zero. */
export function since(status: RuntimeStatus | null, base: Baseline[string] | undefined): { steps: number; errors: number } {
  if (!status || typeof status.steps !== "number" || typeof status.errors !== "number") return { steps: 0, errors: 0 };
  const same = base !== undefined && base.startedAt === status.startedAt && status.steps >= base.steps && status.errors >= base.errors;
  return { steps: count(status.steps - (same ? base.steps : 0)), errors: count(status.errors - (same ? base.errors : 0)) };
}

export function buildHeartbeat(input: { deploymentId: string; bundleVersion: string; now: Date; shops: ShopObservation[]; baseline: Baseline; lastKnown?: Record<string, RuntimeStatus> }): { body: Record<string, unknown>; next: Baseline } {
  const next: Baseline = { ...input.baseline };
  const agents = input.shops.map((shop) => {
    const known = shop.status ?? input.lastKnown?.[shop.id] ?? null;
    const s = shop.status;
    const delta = since(s, input.baseline[shop.id]);
    if (s && typeof s.startedAt === "string") next[shop.id] = { startedAt: s.startedAt, steps: count(s.steps), errors: count(s.errors) };
    const lastStep = s?.lastStepAt ? Math.max(0, Math.floor((input.now.getTime() - Date.parse(s.lastStepAt)) / 1000)) : null;
    const bookings = Object.fromEntries(Object.entries(known?.bookings ?? {}).filter(([k]) => STATE_NAME.test(k)).slice(0, 16).map(([k, v]) => [k, count(v)]));
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
      since_last: delta,
    };
  });
  return {
    body: { deployment_id: input.deploymentId, bundle_version: input.bundleVersion, sent_at: input.now.toISOString().replace(/\.\d{3}Z$/u, "Z"), agents },
    next,
  };
}

export interface SendResult { accepted: boolean; status: number | null; problem?: string }

/** One try, ten seconds. The next heartbeat replaces this one, so a failure is never retried inside the minute. The key is a header and never logged. */
export async function sendHeartbeat(url: string, key: string, body: unknown, fetchFn: typeof fetch = fetch): Promise<SendResult> {
  try {
    const r = await fetchFn(`${url.replace(/\/+$/u, "")}/v1/heartbeat`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    const text = await r.text().catch(() => "");
    return r.status === 200 ? { accepted: true, status: 200 } : { accepted: false, status: r.status, problem: r.status === 400 ? `fleet refused the heartbeat as malformed: ${text.slice(0, 300)}` : `fleet answered ${r.status}` };
  } catch (e) { return { accepted: false, status: null, problem: `fleet could not be reached (${(e as { cause?: { code?: string } }).cause?.code ?? (e as Error).name})` }; }
}
