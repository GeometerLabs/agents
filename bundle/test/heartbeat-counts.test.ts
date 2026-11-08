// The three counts fleet now takes (fleet ADR-0059): reports the owner received (`since_last.reports_sent`), replies to customers by language
// (`usage.replies_by_language`) and the unfinished-work list's counts by kind (`open_obligations`), and the lease token ops keeps from fleet's answer. Counts only:
// no case id, no name, no amount. Fleet's own validator reads every body here when the monorepo is at hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAnswerFile, readUsageBaseline, writeUsageBaseline } from "../lib/fleet.ts";
import { summarizeUsage } from "../lib/usage.ts";
import type { UsageTotals } from "../lib/usage.ts";
import { buildHeartbeat, obligationCounts, usageDelta } from "../services/heartbeat.ts";
import type { ShopObservation } from "../services/heartbeat.ts";
import { heartbeatTick, readObligations, readUsage } from "../services/ops.ts";
import type { HeartbeatState, OpsConfig } from "../services/ops.ts";
import { fleetChecker } from "./monorepo.ts";
import { lease } from "./licence-helpers.ts";

const NOW = new Date("2026-11-05T10:00:00.000Z");
const fleet = await fleetChecker();
const fleetKnows = fleet ? fleet.checkHeartbeat({ deployment_id: "acme-vps-1", bundle_version: "0.1.0", sent_at: "2026-11-05T10:00:00Z", agents: [{ id: "a", pathway: "bookings", pathway_version: "0.1.0", runtime: { up: true, ready: true, tasks: { pending: 0, failed: 0 }, last_step_age_s: null, bookings: {} }, guards: [], since_last: { steps: 0, errors: 0, reports_sent: 0 }, open_obligations: {} }] }).ok : false;
const skipFleet = fleet ? (fleetKnows ? false : "the monorepo's fleet does not know reports_sent and open_obligations yet") : "the monorepo's fleet is not at hand (set GEOMETER_MONOREPO)";

const entry = (action: string, outcome: string, refs: Record<string, string> = {}, language = "en") => ({ seq: 1, time: NOW.toISOString(), conversation: "c", booking: null, action, inputsDigest: "d", outcome, decisions: [], language, notes: "", refs });

test("a report the owner received is counted once: the ending read back, never the claim before it, a failed try or the certificate document after it", () => {
  const t = summarizeUsage([
    entry("send_message", "attempted", { to: "owner", report: "2026-10" }),
    entry("send_message", "confirmed", { to: "owner", report: "2026-10", messageId: "m1" }),
    entry("send_message", "confirmed", { to: "owner", reportFile: "2026-10", kind: "document" }),
    entry("send_message", "failed", { to: "owner", report: "2026-11" }),
    entry("send_message", "unconfirmed", { to: "owner", report: "2026-12" }),
  ], {});
  assert.equal(t.reportsSent, 1);
});

test("replies are counted by the language they went out in: customers only, read back only, and a UPI picture beside the words is not a second reply", () => {
  const t = summarizeUsage([
    entry("send_message", "confirmed", { to: "customer", templates: "booked" }, "ml"),
    entry("send_message", "confirmed", { to: "customer", templates: "upi_qr_caption", image: "qr" }, "ml"),
    entry("voice_note_reply", "confirmed", { to: "customer" }, "hi"),
    entry("send_message", "confirmed", { to: "owner", templates: "owner_notice" }, "kn"),
    entry("send_message", "blocked", { to: "customer" }, "kn"),
    entry("send_message", "unconfirmed", { to: "customer" }, "en"),
  ], {});
  assert.deepEqual(t.repliesByLanguage, { hi: 1, en: 0, ml: 1, kn: 0 });
});

const totals = (more: Partial<UsageTotals> = {}): UsageTotals => ({ messages: 100, byStep: { rules: 30, decision: 60, model: 10 }, modelMicroInr: 140_000, whatsapp: { service: 250, utility: 40, marketing: 0, estMicroInr: 39_000, estimated: true }, reportsSent: 1, repliesByLanguage: { hi: 4, en: 10, ml: 0, kn: 0 }, ...more });
const NINE = { messages: 100, rules: 30, decision: 60, model: 10, modelMicroInr: 140_000, service: 250, utility: 40, marketing: 0, estMicroInr: 39_000, estimated: true };

test("a baseline from before these counts keeps the cost meter's nine and starts the new ones at the current totals: no report or reply is replayed", () => {
  const first = usageDelta(totals({ messages: 110 }), { ...NINE });
  assert.equal((first.send as { messages: number }).messages, 10, "the cost meter's baseline was not dropped");
  assert.equal("replies_by_language" in (first.send as object), false);
  assert.equal(first.reportsSent, 0, "a report sent before this bundle is not replayed");
  assert.deepEqual([first.next.reportsSent, first.next.hi, first.next.en], [1, 4, 10]);
  const second = usageDelta(totals({ messages: 112, reportsSent: 2, repliesByLanguage: { hi: 4, en: 12, ml: 3, kn: 0 } }), first.next);
  assert.equal(second.reportsSent, 1);
  assert.deepEqual((second.send as { replies_by_language: unknown }).replies_by_language, { en: 2, ml: 3 }, "a language with none is left out");
  const quiet = usageDelta(totals({ messages: 112, reportsSent: 2, repliesByLanguage: { hi: 4, en: 12, ml: 3, kn: 0 } }), second.next);
  assert.equal(quiet.send, undefined, "nothing new, no usage");
  assert.equal(quiet.reportsSent, 0);
  const restored = usageDelta(totals({ messages: 112, reportsSent: 0, repliesByLanguage: { hi: 0, en: 0, ml: 0, kn: 0 } }), second.next);
  assert.deepEqual([restored.reportsSent, restored.next.reportsSent, restored.next.en], [0, 0, 0], "a count that went down (a record restored) starts again, and sends nothing");
});

test("the baseline file keeps the new counts beside the nine, and an older file without them still reads whole", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-counts-"));
  try {
    writeFileSync(join(dir, "usage-baseline.json"), JSON.stringify({ schema: 1, shops: { "glow-salon": NINE } }));
    assert.deepEqual(readUsageBaseline(dir), { "glow-salon": NINE });
    writeUsageBaseline(dir, { "glow-salon": { ...NINE, reportsSent: 2, hi: 1, en: 0, ml: 0, kn: 3 } }, ["glow-salon"]);
    assert.deepEqual(readUsageBaseline(dir)["glow-salon"], { ...NINE, reportsSent: 2, hi: 1, en: 0, ml: 0, kn: 3 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("open_obligations is the counts now, on every heartbeat, {} when none is open; a kind fleet would refuse is left out, never the heartbeat", () => {
  assert.deepEqual(obligationCounts({ deposit_no_booking: 2, refund_failed: 0, kind2: 1, "bad-kind": 1, _x: 1 }), { deposit_no_booking: 2, refund_failed: 0 });
  assert.deepEqual(obligationCounts({}), {});
  assert.equal(Object.keys(obligationCounts(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`kind_${"abcdefghijklmnopqrstuvwxyzabcd"[i]}${"x".repeat(i % 3)}`, 1])))!).length, 20);
  const shop = (o?: Record<string, number>): ShopObservation => ({ id: "glow-salon", pathway: "bookings", pathwayVersion: "0.1.0", up: true, ready: true, status: null, guards: [], ...(o ? { obligations: o } : {}) });
  const body = (o?: Record<string, number>) => (buildHeartbeat({ deploymentId: "acme-vps-1", bundleVersion: "0.1.0", now: NOW, shops: [shop(o)], baseline: {} }).body.agents as Record<string, unknown>[])[0];
  assert.deepEqual(body({}).open_obligations, {});
  assert.deepEqual(body({ refund_waiting: 1 }).open_obligations, { refund_waiting: 1 });
  assert.equal("open_obligations" in body(), false, "unknown is left out, which changes nothing fleet holds");
});

test("fleet's own validator takes a heartbeat with all three counts", { skip: skipFleet }, () => {
  const shop: ShopObservation = { id: "glow-salon", pathway: "bookings", pathwayVersion: "0.1.0", up: true, ready: true, status: null, guards: [], usage: totals({ messages: 112, reportsSent: 2, repliesByLanguage: { hi: 5, en: 12, ml: 3, kn: 0 } }), obligations: { deposit_no_booking: 1, upi_refund_owed: 0 } };
  const r = buildHeartbeat({ deploymentId: "acme-vps-1", bundleVersion: "0.1.0", now: NOW, shops: [shop], baseline: {}, usageBaseline: { "glow-salon": { ...NINE, reportsSent: 1, hi: 4, en: 10, ml: 0, kn: 0 } } });
  const agent = (r.body.agents as Record<string, any>[])[0];
  assert.equal(agent.since_last.reports_sent, 1);
  assert.deepEqual(agent.usage.replies_by_language, { hi: 1, en: 2, ml: 3 });
  const checked = fleet!.checkHeartbeat(r.body);
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
});

// ---- ops: the status file's counts, the lease token, fleet's unsigned licence entry ------------------------------------------------------------------------------

function opsWorld() {
  const dir = mkdtempSync(join(tmpdir(), "geo-ops-licence-"));
  const status = join(dir, "glow-salon.json");
  const fleetDir = join(dir, "fleet");
  const config: OpsConfig = {
    deploymentId: "acme-vps-1", bundleVersion: "0.1.0", fleet: { url: "https://fleet.example", keyFile: join(dir, "key") }, fleetDir,
    shops: { "glow-salon": { pathway: "bookings", pathwayVersion: "0.1.0", runtimeUrl: "http://rt", internalTokenFile: join(dir, "t"), statusFile: status, guards: [] } },
    model: { id: "guard-model", service: "g-model", adminUrl: "http://m", healthUrl: "http://m", adminTokenFile: join(dir, "a") },
  };
  const sent: Record<string, any>[] = [];
  let body: unknown = { ok: true };
  const fetchFn = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/v1/heartbeat")) { sent.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify(body), { status: 200 }); }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const state = (): HeartbeatState => ({ baseline: {}, usageBaseline: readUsageBaseline(fleetDir), lastKnown: {}, lastProblem: "" });
  return { dir, status, fleetDir, config, sent, fetchFn, state, answer: (b: unknown) => { body = b; }, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("ops reads the counts from the status file whole or not at all, and sends the obligations it finds there", async () => {
  const w = opsWorld();
  try {
    writeFileSync(w.status, JSON.stringify({ usage: { ...totals(), at: NOW.toISOString() }, obligations: { counts: { refund_waiting: 2 }, at: NOW.toISOString() } }));
    assert.deepEqual(readUsage(w.status), totals());
    assert.deepEqual(readObligations(w.status), { refund_waiting: 2 });
    writeFileSync(w.status, JSON.stringify({ usage: { ...totals(), repliesByLanguage: { hi: 1, en: 2 }, reportsSent: -1 }, obligations: { counts: { refund_waiting: "2" } } }));
    const half = readUsage(w.status)!;
    assert.equal("repliesByLanguage" in half || "reportsSent" in half, false, "half a language list, or a count that is not one, is not read");
    assert.equal(readObligations(w.status), undefined);
    writeFileSync(w.status, JSON.stringify({ obligations: { counts: {} } }));
    await heartbeatTick(w.config, "k", w.state(), w.fetchFn, NOW);
    assert.deepEqual(w.sent[0].agents[0].open_obligations, {});
  } finally { w.done(); }
});

test("ops keeps fleet's lease token as it came, for the deployer to judge, and fleet's unsigned licence entry for the panel", async () => {
  const w = opsWorld();
  try {
    const token = lease(5, 1_796_700_000);
    const licence = { state: "warning", paid_through: "2026-12-08", wind_down_on: "2027-01-07", stop_on: null, export_until: null, notice: null, renew_url: "https://rzp.io/i/abc123" };
    w.answer({ ok: true, lease: token, shops: { "glow-salon": { plan: "business", allowance: 3000, innovator: false, ai: "normal", warn: ["licence_warning"], licence } } });
    await heartbeatTick(w.config, "k", w.state(), w.fetchFn, NOW);
    assert.equal(readFileSync(join(w.fleetDir, "lease"), "utf8"), `${token}\n`);
    assert.deepEqual(readAnswerFile(join(w.fleetDir, "glow-salon.json"))?.licence, licence);
    w.answer({ ok: true, lease: "not a lease", shops: { "glow-salon": { plan: "business", allowance: 3000, innovator: false, ai: "normal", warn: [], licence: { ...licence, renew_url: "http://rzp.io/i/abc", paid_through: "8 Dec" } } } });
    await heartbeatTick(w.config, "k", w.state(), w.fetchFn, NOW);
    assert.equal(readFileSync(join(w.fleetDir, "lease"), "utf8"), `${token}\n`, "something that is not shaped like a lease never replaces the token");
    assert.deepEqual([readAnswerFile(join(w.fleetDir, "glow-salon.json"))?.licence?.renew_url, readAnswerFile(join(w.fleetDir, "glow-salon.json"))?.licence?.paid_through], [null, null], "a renew link that is not https, and a day that is not a day, are dropped");
  } finally { w.done(); }
});
