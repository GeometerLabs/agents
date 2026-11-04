// The heartbeat: exactly the fleet contract, counts only, tripwire failure as not ready, totals moved forward only when fleet said 200.
// The body is also run through fleet's OWN validator when the monorepo is at a sibling path (and skipped, saying why, when it is not).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildHeartbeat, sendHeartbeat, since } from "../services/heartbeat.ts";
import type { GuardObservation, ShopObservation } from "../services/heartbeat.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const FLEET = [process.env.GEOMETER_MONOREPO, join(ROOT, "..", "monorepo"), join(ROOT, "..", "..", "monorepo"), join(ROOT, "..", "..", "geometer", "monorepo"), join(ROOT, "..", "geometer", "monorepo")].filter((x): x is string => !!x).map((c) => join(c, "apps", "fleet", "src", "schema.ts")).find((f) => existsSync(f));
const fleet = FLEET ? await import(FLEET) as { checkHeartbeat(input: unknown): { ok: boolean; problems?: unknown[] } } : undefined;

const guard = (id: string, change: Partial<GuardObservation> = {}): GuardObservation => ({ id, healthReady: true, admin: { runtime: { mode: "enforce" }, kill_switch: { on: false }, tripwires: { ran: true, ok: true, passed: 4, of: 4 } }, held: 0, ...change });
const shop = (change: Partial<ShopObservation> = {}): ShopObservation => ({
  id: "glow-salon", pathway: "bookings", pathwayVersion: "0.1.0", up: true, ready: true,
  status: { pathway: "bookings", version: "0.1.0", bookings: { awaiting_deposit: 2, confirmed: 14 }, tasks: { pending: 0, failed: 0 }, lastStepAt: "2026-11-04T09:59:48.000Z", steps: 31, errors: 0, startedAt: "2026-11-04T08:00:00.000Z" },
  guards: [guard("guard-whatsapp"), guard("guard-razorpay", { held: 1 })], ...change,
});
const NOW = new Date("2026-11-04T10:00:00.000Z");
const build = (shops: ShopObservation[], baseline = {}) => buildHeartbeat({ deploymentId: "acme-vps-1", bundleVersion: "0.1.0", now: NOW, shops, baseline });

test("the body is the fleet contract's example, field for field", () => {
  const { body } = build([shop()]);
  assert.deepEqual(body, {
    deployment_id: "acme-vps-1", bundle_version: "0.1.0", sent_at: "2026-11-04T10:00:00Z",
    agents: [{ id: "glow-salon", pathway: "bookings", pathway_version: "0.1.0",
      runtime: { up: true, ready: true, tasks: { pending: 0, failed: 0 }, last_step_age_s: 12, bookings: { awaiting_deposit: 2, confirmed: 14 } },
      guards: [{ id: "guard-whatsapp", ready: true, mode: "enforce", killed: false, held_calls: 0 }, { id: "guard-razorpay", ready: true, mode: "enforce", killed: false, held_calls: 1 }],
      since_last: { steps: 31, errors: 0 } }],
  });
});

test("fleet's own validator accepts it, including a shop whose runtime is down", { skip: fleet ? false : "the monorepo's apps/fleet is not at a sibling path (set GEOMETER_MONOREPO)" }, () => {
  for (const shops of [[shop()], [shop({ up: false, ready: false, status: null })], [shop({ guards: [guard("guard-razorpay", { admin: null, healthReady: false })] })], []]) {
    const r = fleet!.checkHeartbeat(build(shops).body);
    assert.equal(r.ok, true, JSON.stringify(r));
  }
});

// ---- backups: the age of the last good snapshot and the last restore drill (two optional fields of the contract) ----------------------------------------------
const BACKUPS = { lastCopyAt: "2026-11-04T09:00:00.000Z", lastDrillAt: "2026-11-02T03:00:00.000Z", drillOk: true };
const agentOf = (shops: ShopObservation[]) => (build(shops).body.agents as Record<string, unknown>[])[0];
// Fleet's validator may be an older one (the monorepo's main before apps/fleet knew these fields): then the contract tests below are skipped, and say why.
const fleetKnowsBackups = fleet ? fleet.checkHeartbeat(build([shop({ backups: BACKUPS })]).body).ok : false;
const skipUnlessFleetKnows = fleet ? (fleetKnowsBackups ? false : "the fleet validator found does not know backup_age_s and drill yet (merge apps/fleet's backup fields first, or set GEOMETER_MONOREPO)") : "the monorepo's apps/fleet is not at a sibling path (set GEOMETER_MONOREPO)";

test("the last good snapshot and the last restore drill are sent as ages in whole seconds, from the host's clock", () => {
  const a = agentOf([shop({ backups: BACKUPS })]);
  assert.equal(a.backup_age_s, 3600); // 09:00 to 10:00
  assert.deepEqual(a.drill, { age_s: 2 * 86_400 + 7 * 3600, ok: true }); // 2 Nov 03:00 to 4 Nov 10:00
  assert.deepEqual(Object.keys(a), ["id", "pathway", "pathway_version", "runtime", "guards", "since_last", "backup_age_s", "drill"], "after the contract's required fields");
  assert.deepEqual((agentOf([shop({ backups: { ...BACKUPS, drillOk: false } })]).drill as { ok: boolean }).ok, false);
});

test("a field with nothing to say is left out, never sent as 0 or null: no file, no snapshot yet, no drill yet, a drill with no verdict, text that is not a time", () => {
  const keys = (backups: ShopObservation["backups"]) => Object.keys(agentOf([shop(backups === undefined ? {} : { backups })])).filter((k) => k === "backup_age_s" || k === "drill");
  assert.deepEqual(keys(undefined), [], "no status file");
  assert.deepEqual(keys({ lastCopyAt: null, lastDrillAt: null, drillOk: null }), [], "the status file before the first job");
  assert.deepEqual(keys({ lastCopyAt: BACKUPS.lastCopyAt, lastDrillAt: null, drillOk: null }), ["backup_age_s"]);
  assert.deepEqual(keys({ lastCopyAt: null, lastDrillAt: BACKUPS.lastDrillAt, drillOk: true }), ["drill"]);
  assert.deepEqual(keys({ lastCopyAt: BACKUPS.lastCopyAt, lastDrillAt: BACKUPS.lastDrillAt, drillOk: null }), ["backup_age_s"], "a drill with no verdict is not guessed");
  assert.deepEqual(keys({ lastCopyAt: "last night", lastDrillAt: "Sunday", drillOk: true }), [], "text that is not a time");
});

test("an age is a count: a time set in the future is 0, an old one stops at 999,999 (about 11.5 days)", () => {
  const a = agentOf([shop({ backups: { lastCopyAt: "2026-11-04T12:00:00.000Z", lastDrillAt: "2026-01-01T00:00:00.000Z", drillOk: true } })]);
  assert.equal(a.backup_age_s, 0);
  assert.deepEqual(a.drill, { age_s: 999_999, ok: true });
});

test("a failed drill is its own fact: the shop is still ready, no Guard changes, and the drill's reason never travels", () => {
  const a = agentOf([shop({ backups: { ...BACKUPS, drillOk: false, drillDetail: "the continuous copy could not be restored: litestream: no snapshots found for 9876543210" } as never })]);
  assert.deepEqual([(a.runtime as { up: boolean }).up, (a.runtime as { ready: boolean }).ready], [true, true]);
  assert.deepEqual((a.guards as { ready: boolean }[]).map((g) => g.ready), [true, true]);
  assert.deepEqual(a.drill, { age_s: 198_000, ok: false });
  assert.doesNotMatch(JSON.stringify(build([shop({ backups: { ...BACKUPS, drillOk: false, drillDetail: "litestream: no snapshots found" } as never })]).body), /litestream|snapshots found|detail/u);
});

test("fleet's own validator accepts the backup fields, a failed drill, and a shop with only one of them", { skip: skipUnlessFleetKnows }, () => {
  for (const backups of [BACKUPS, { ...BACKUPS, drillOk: false }, { lastCopyAt: BACKUPS.lastCopyAt }, { lastDrillAt: BACKUPS.lastDrillAt, drillOk: true }, { lastCopyAt: "2026-01-01T00:00:00.000Z", lastDrillAt: "2026-01-01T00:00:00.000Z", drillOk: true }]) {
    const r = fleet!.checkHeartbeat(build([shop({ backups }), shop({ id: "bright-tuition" })]).body);
    assert.equal(r.ok, true, JSON.stringify(r));
  }
});

test("fleet's validator would refuse a time in place of an age: the fields stay counts (this guards the choice, not the sender)", { skip: skipUnlessFleetKnows }, () => {
  for (const [field, value] of [["backup_age_s", Date.parse(BACKUPS.lastCopyAt)], ["backup_age_s", BACKUPS.lastCopyAt], ["drill", { age_s: Date.parse(BACKUPS.lastDrillAt), ok: true }], ["drill", { age_s: 5, ok: "yes" }], ["drill", { age_s: 5, ok: true, detail: "x" }]] as const) {
    const body = build([shop()]).body as { agents: Record<string, unknown>[] };
    body.agents[0][field] = value;
    assert.equal(fleet!.checkHeartbeat(body).ok, false, `${field}: ${JSON.stringify(value)}`);
  }
});

test("a failed tripwire, a Guard that is not ready, and one whose admin port cannot be reached are all ready=false", () => {
  const guards = build([shop({ guards: [
    guard("guard-razorpay", { admin: { runtime: { mode: "enforce" }, kill_switch: { on: false }, tripwires: { ran: true, ok: false, passed: 3, of: 4 } } }),
    guard("guard-whatsapp", { healthReady: false }),
    guard("guard-calendar", { admin: null }),
  ] })]).body.agents as { guards: { id: string; ready: boolean }[] }[];
  assert.deepEqual(guards[0].guards.map((g) => [g.id, g.ready]), [["guard-razorpay", false], ["guard-whatsapp", false], ["guard-calendar", false]]);
});

test("a killed Guard says so, and a Guard that watches only says shadow", () => {
  const g = (build([shop({ guards: [guard("guard-razorpay", { admin: { runtime: { mode: "shadow" }, kill_switch: { on: true }, tripwires: { ok: true } } })] })]).body.agents as { guards: { mode: string; killed: boolean }[] }[])[0].guards[0];
  assert.deepEqual([g.mode, g.killed], ["shadow", true]);
});

test("steps and errors are the difference since the last ACCEPTED heartbeat, and a restarted runtime starts again from zero", () => {
  const first = build([shop()]);
  const later = shop({ status: { ...shop().status!, steps: 40, errors: 2 } });
  assert.deepEqual(build([later], first.next).body.agents[0].since_last, { steps: 9, errors: 2 });
  // fleet did not answer 200: the baseline stays where it was, so the next heartbeat carries everything since, once
  assert.deepEqual(build([later], {}).body.agents[0].since_last, { steps: 40, errors: 2 });
  const restarted = shop({ status: { ...shop().status!, steps: 3, errors: 0, startedAt: "2026-11-04T09:30:00.000Z" } });
  assert.deepEqual(build([restarted], first.next).body.agents[0].since_last, { steps: 3, errors: 0 });
  assert.deepEqual(since(null, undefined), { steps: 0, errors: 0 });
});

test("a down runtime is still sent, with the counts last known and no step age", () => {
  const last = shop().status!;
  const r = buildHeartbeat({ deploymentId: "acme-vps-1", bundleVersion: "0.1.0", now: NOW, baseline: {}, shops: [shop({ up: false, ready: false, status: null })], lastKnown: { "glow-salon": last } });
  const a = r.body.agents[0] as { runtime: { up: boolean; ready: boolean; last_step_age_s: number | null; bookings: Record<string, number> } };
  assert.deepEqual([a.runtime.up, a.runtime.ready, a.runtime.last_step_age_s, a.runtime.bookings], [false, false, null, { awaiting_deposit: 2, confirmed: 14 }]);
});

test("nothing but counts goes out: odd state names are dropped, counts are clamped, and no text field of a reply is copied", () => {
  const s = shop({ status: { ...shop().status!, bookings: { "name with spaces": 3, "+919811111111": 1, confirmed: 5_000_000 } as Record<string, number>, pathway: "Call me at +919811111111" } });
  const body = JSON.stringify(build([s]).body);
  assert.ok(!body.includes("919811111111") && !body.includes("spaces") && !body.includes("Call me"), body);
  assert.match(body, /"confirmed":999999/);
});

test("the send is one try with the key in a header; a refusal or an outage means 'not accepted', and the key is in no message", async () => {
  const calls: { url: string; auth: string }[] = [];
  const reply = (status: number) => (async (url: string, init: RequestInit) => { calls.push({ url, auth: String((init.headers as Record<string, string>).authorization) }); return new Response(status === 400 ? '{"error":"x","problems":[{"path":"agents[0].id","problem":"p"}]}' : "{}", { status }); }) as unknown as typeof fetch;
  assert.deepEqual(await sendHeartbeat("https://fleet.example/", "gfk_secretkey0123456789", {}, reply(200)), { accepted: true, status: 200 });
  const bad = await sendHeartbeat("https://fleet.example", "gfk_secretkey0123456789", {}, reply(400));
  assert.equal(bad.accepted, false); assert.match(bad.problem!, /malformed/);
  const down = await sendHeartbeat("https://fleet.example", "gfk_secretkey0123456789", {}, (async () => { throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }); }) as unknown as typeof fetch);
  assert.deepEqual([down.accepted, down.status], [false, null]);
  assert.ok(!JSON.stringify([bad, down]).includes("secretkey"));
  assert.deepEqual(calls.map((c) => c.url), ["https://fleet.example/v1/heartbeat", "https://fleet.example/v1/heartbeat"]);
  assert.equal(calls[0].auth, "Bearer gfk_secretkey0123456789");
});
