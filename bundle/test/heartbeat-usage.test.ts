// The cost meter's counts in the heartbeat, and fleet's answer coming back (B45, B48). Counts only; a difference against a baseline that survives a restart;
// lossless under the 999,999 cap; and an answer that changes nothing unless fleet said something.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fleetChecker } from "./monorepo.ts";
import { parseFleetAnswer, readAnswerFile, readUsageBaseline } from "../lib/fleet.ts";
import type { UsageBaseline } from "../lib/fleet.ts";
import type { UsageTotals } from "../lib/usage.ts";
import { buildHeartbeat, sendHeartbeat, usageDelta } from "../services/heartbeat.ts";
import type { ShopObservation } from "../services/heartbeat.ts";
import { heartbeatTick, readUsage } from "../services/ops.ts";
import type { HeartbeatState, OpsConfig } from "../services/ops.ts";

const totals = (more: Partial<{ messages: number; rules: number; decision: number; model: number; modelMicroInr: number; service: number; utility: number; marketing: number; estMicroInr: number; estimated: boolean }> = {}): UsageTotals => {
  const o = { messages: 100, rules: 30, decision: 60, model: 10, modelMicroInr: 140_000, service: 250, utility: 40, marketing: 0, estMicroInr: 39_000, estimated: true, ...more };
  return { messages: o.messages, byStep: { rules: o.rules, decision: o.decision, model: o.model }, modelMicroInr: o.modelMicroInr, whatsapp: { service: o.service, utility: o.utility, marketing: o.marketing, estMicroInr: o.estMicroInr, estimated: o.estimated } };
};
const flatOf = (t: UsageTotals) => usageDelta(t, undefined).next;
const NOW = new Date("2026-11-05T10:00:00.000Z");
const shop = (usage?: UsageTotals): ShopObservation => ({ id: "glow-salon", pathway: "bookings", pathwayVersion: "0.1.0", up: true, ready: true, status: null, guards: [], ...(usage ? { usage } : {}) });
const beat = (shops: ShopObservation[], usageBaseline: UsageBaseline = {}) => buildHeartbeat({ deploymentId: "acme-vps-1", bundleVersion: "0.1.0", now: NOW, shops, baseline: {}, usageBaseline });
const usageOf = (r: ReturnType<typeof beat>) => (r.body.agents as Record<string, unknown>[])[0].usage;

test("a shop with no baseline starts at its current totals and sends nothing: history from before the meter is never replayed", () => {
  const r = beat([shop(totals())]);
  assert.equal(usageOf(r), undefined);
  assert.equal("usage" in (r.body.agents as object[])[0], false, "no field at all, not zeros");
  assert.deepEqual(r.nextUsage["glow-salon"], flatOf(totals()));
});

test("the heartbeat sends the difference against the baseline, in the contract's shape, and the baseline moves by what was sent", () => {
  const base = { "glow-salon": flatOf(totals()) };
  const r = beat([shop(totals({ messages: 109, rules: 32, decision: 66, model: 11, modelMicroInr: 154_000, service: 254, utility: 42, estMicroInr: 39_000 + 7_000 }))], base);
  assert.deepEqual(usageOf(r), {
    messages: 9, by_step: { rules: 2, decision: 6, model: 1 }, model_micro_inr: 14_000,
    whatsapp: { service: 4, utility: 2, marketing: 0, est_micro_inr: 7_000 },
  });
  assert.equal(r.nextUsage["glow-salon"].messages, 109);
  assert.deepEqual(Object.keys((r.body.agents as Record<string, unknown>[])[0]).slice(-1), ["usage"], "after the contract's required fields and the optional backups");
});

test("the count of calls with no price stays out of the heartbeat: fleet refuses a field it does not know, so the body and the baseline are exactly what they are without it", () => {
  const base = { "glow-salon": flatOf(totals()) };
  const plain = beat([shop(totals({ messages: 109, model: 11 }))], base);
  const withCount = beat([shop({ ...totals({ messages: 109, model: 11 }), unpriced: 7 })], base);
  assert.deepEqual(withCount.body, plain.body);
  assert.deepEqual(withCount.nextUsage, plain.nextUsage);
  assert.doesNotMatch(JSON.stringify(withCount.body), /unpriced/);
  // and a shop whose only news is more unpriced calls has nothing to send: no usage field, never a body fleet would refuse
  const onlyUnpriced = beat([shop({ ...totals(), unpriced: 9 })], base);
  assert.equal(usageOf(onlyUnpriced), undefined);
});

test("nothing new, nothing sent: no usage field, and the baseline stays", () => {
  const base = { "glow-salon": flatOf(totals()) };
  const r = beat([shop(totals())], base);
  assert.equal(usageOf(r), undefined);
  assert.deepEqual(r.nextUsage, base);
});

test("a shop whose status file has no counts yet sends nothing and keeps its baseline", () => {
  const base = { "glow-salon": flatOf(totals()) };
  const r = beat([shop()], base);
  assert.equal(usageOf(r), undefined);
  assert.deepEqual(r.nextUsage, base);
});

test("a total that went down (the record was restored from a copy) restarts the baseline at the new total and sends nothing", () => {
  const base = { "glow-salon": flatOf(totals({ messages: 500 })) };
  const r = beat([shop(totals({ messages: 120 }))], base);
  assert.equal(usageOf(r), undefined);
  assert.equal(r.nextUsage["glow-salon"].messages, 120);
});

test("each count is capped at 999,999 in one heartbeat and the rest is carried: nothing is lost to the cap", () => {
  const big = totals({ messages: 2_500_000, rules: 2_500_000, decision: 0, model: 0, modelMicroInr: 2_100_000, service: 0, utility: 0, estMicroInr: 0 });
  let base: UsageBaseline = { "glow-salon": flatOf(totals({ messages: 0, rules: 0, decision: 0, model: 0, modelMicroInr: 0, service: 0, utility: 0, estMicroInr: 0 })) };
  let sentMessages = 0, sentSpend = 0, beats = 0;
  for (; beats < 6; beats++) {
    const r = beat([shop(big)], base);
    const u = usageOf(r) as { messages: number; model_micro_inr: number } | undefined;
    if (!u) break;
    assert.ok(u.messages <= 999_999 && u.model_micro_inr <= 999_999);
    sentMessages += u.messages; sentSpend += u.model_micro_inr;
    base = r.nextUsage;
  }
  assert.deepEqual([sentMessages, sentSpend, beats], [2_500_000, 2_100_000, 3]);
});

test("an estimate that had no rates and now has them (or the reverse) starts again from the current one, and the rest of the counts still go", () => {
  const base = { "glow-salon": flatOf(totals({ estMicroInr: 0, estimated: false })) };
  const r = beat([shop(totals({ messages: 110, estMicroInr: 39_000, estimated: true }))], base);
  assert.equal((usageOf(r) as { messages: number }).messages, 10);
  assert.equal((usageOf(r) as { whatsapp: { est_micro_inr: number } }).whatsapp.est_micro_inr, 0, "no replay of the whole history's estimate");
  assert.deepEqual([r.nextUsage["glow-salon"].estMicroInr, r.nextUsage["glow-salon"].estimated], [39_000, true]);
  const lost = beat([shop(totals({ messages: 110, estMicroInr: 0, estimated: false }))], { "glow-salon": flatOf(totals({ estimated: true })) });
  assert.equal((usageOf(lost) as { messages: number }).messages, 10, "a rate that went missing does not throw the counts away");
});

test("the usage block is numbers only: nothing a customer wrote, nothing but counts, and every one is a whole number from 0 to 999,999", () => {
  const base = { "glow-salon": flatOf(totals()) };
  const u = usageOf(beat([shop(totals({ messages: 140, rules: 50 }))], base)) as Record<string, unknown>;
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "object" && v !== null) return Object.entries(v).forEach(([k, x]) => walk(x, `${path}.${k}`));
    assert.ok(typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 999_999, `${path} is a count`);
  };
  walk(u, "usage");
  assert.deepEqual(Object.keys(u), ["messages", "by_step", "model_micro_inr", "whatsapp"]);
});

test("the whole body, with usage in it, holds no text but ids, versions, a time and the Guard's two modes, even when the status file is stuffed with words", () => {
  const stuffed = { ...totals({ messages: 140 }), note: "book Priya at 9", provider: "+919811111111" } as unknown as UsageTotals;
  const body = beat([{ ...shop(stuffed), status: { pathway: "Call me at +919811111111", version: "0.1.0", bookings: { "name with spaces": 3, confirmed: 5 } } as never }], { "glow-salon": flatOf(totals()) }).body;
  const strings: string[] = [];
  const walk = (v: unknown): void => { if (typeof v === "string") strings.push(v); else if (typeof v === "object" && v !== null) Object.values(v).forEach(walk); };
  walk(body);
  const id = /^[a-z0-9][a-z0-9_-]{0,63}$/u, version = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/u, time = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u;
  for (const s of strings) assert.ok(id.test(s) || version.test(s) || time.test(s) || s === "shadow" || s === "enforce", `a text that is no id, version, time or mode: ${s}`);
  assert.doesNotMatch(JSON.stringify(body), /Priya|9811111111|Call me/u);
});

const fleet = await fleetChecker();
const fleetKnowsUsage = fleet ? fleet.checkHeartbeat((() => { const b = beat([shop(totals({ messages: 101 }))], { "glow-salon": flatOf(totals()) }).body; return b; })()).ok : false;
test("fleet's own validator accepts the usage block, the capped one and a heartbeat without one", { skip: fleet ? (fleetKnowsUsage ? false : "the fleet validator found does not know `usage` yet (merge apps/fleet's usage block first, or set GEOMETER_MONOREPO)") : "the monorepo's apps/fleet is not at a sibling path (set GEOMETER_MONOREPO)" }, () => {
  const base = { "glow-salon": flatOf(totals({ messages: 0, rules: 0, decision: 0, model: 0, modelMicroInr: 0 })) };
  for (const shops of [[shop(totals())], [shop({ ...totals(), unpriced: 9 })], [shop(totals({ messages: 5_000_000, modelMicroInr: 9_000_000 }))], [shop()], [shop(totals({ messages: 0, rules: 0, decision: 0, model: 0, modelMicroInr: 0, service: 0, utility: 0, estMicroInr: 0 }))]]) {
    const r = fleet!.checkHeartbeat(beat(shops, base).body);
    assert.equal(r.ok, true, JSON.stringify(r));
  }
});

test("fleet's answer is read field by field: a bad field is dropped, an unknown ai makes no entry, a shop id that is not an id is ignored", () => {
  const got = parseFleetAnswer({ ok: true, shops: {
    "glow-salon": { plan: "business", allowance: 3000, innovator: true, ai: "buttons", reason: "overage_unfunded", warn: ["allowance_80", "balance_80", 7, "has spaces"] },
    "chai-point": { plan: null, allowance: null, innovator: false, ai: "normal", warn: [] },
    "odd-one": { plan: "platinum", allowance: -5, innovator: "yes", ai: "normal", reason: "overage_unfunded" },
    "no-ai": { plan: "basic", allowance: 1000, innovator: false },
    "maybe-ai": { plan: "basic", allowance: 1000, innovator: false, ai: "turbo" },
    "__proto__": { ai: "buttons" }, "Bad Id": { ai: "buttons" },
  } });
  assert.deepEqual(got, {
    "glow-salon": { plan: "business", allowance: 3000, innovator: true, ai: "buttons", reason: "overage_unfunded", warn: ["allowance_80", "balance_80"] },
    "chai-point": { plan: null, allowance: null, innovator: false, ai: "normal", warn: [] },
    "odd-one": { plan: null, allowance: null, innovator: false, ai: "normal", warn: [] },
  });
  for (const none of [{ ok: true }, { ok: true, shops: [] }, { shops: "x" }, null, "x", 3]) assert.equal(parseFleetAnswer(none), undefined);
});

test("sendHeartbeat returns the answer only when there is one, and an answer that is not JSON does not spoil an accepted heartbeat", async () => {
  const reply = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;
  assert.deepEqual(await sendHeartbeat("https://fleet.example", "k", {}, reply(200, "{}")), { accepted: true, status: 200 });
  assert.deepEqual(await sendHeartbeat("https://fleet.example", "k", {}, reply(200, "not json")), { accepted: true, status: 200 });
  const answered = await sendHeartbeat("https://fleet.example", "k", {}, reply(200, JSON.stringify({ ok: true, shops: { "glow-salon": { plan: "basic", allowance: 1000, innovator: false, ai: "normal", warn: [] } } })));
  assert.equal(answered.answer?.["glow-salon"].plan, "basic");
  assert.equal((await sendHeartbeat("https://fleet.example", "k", {}, reply(500, JSON.stringify({ shops: { x: { ai: "buttons" } } })))).answer, undefined, "only a 200 answer counts");
});

// ---- ops: the tick, the files, the restart ----------------------------------------------------------------------------------------------------------------------

function opsWorld() {
  const dir = mkdtempSync(join(tmpdir(), "geo-ops-"));
  const status = join(dir, "glow-salon.json");
  const fleetDir = join(dir, "fleet");
  const config: OpsConfig = {
    deploymentId: "acme-vps-1", bundleVersion: "0.1.0", fleet: { url: "https://fleet.example", keyFile: join(dir, "key") }, fleetDir,
    shops: { "glow-salon": { pathway: "bookings", pathwayVersion: "0.1.0", runtimeUrl: "http://rt", internalTokenFile: join(dir, "t"), statusFile: status, guards: [] } },
    model: { id: "guard-model", service: "g-model", adminUrl: "http://m", healthUrl: "http://m", adminTokenFile: join(dir, "a") },
  };
  const sent: Record<string, any>[] = [];
  let answer: { status: number; body: unknown } = { status: 200, body: { ok: true } };
  const fetchFn = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/v1/heartbeat")) { sent.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify(answer.body), { status: answer.status }); }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const setUsage = (t: UsageTotals) => writeFileSync(status, JSON.stringify({ shop: "glow-salon", usage: { ...t, at: NOW.toISOString() } }));
  const fresh = (): HeartbeatState => ({ baseline: {}, usageBaseline: readUsageBaseline(fleetDir), lastKnown: {}, lastProblem: "" });
  return { dir, config, sent, fetchFn, setUsage, fresh, answer: (a: typeof answer) => { answer = a; }, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const answerFor = (shopAnswer: Record<string, unknown>) => ({ status: 200, body: { ok: true, shops: { "glow-salon": shopAnswer } } });
const BUTTONS = { plan: "business", allowance: 3000, innovator: true, ai: "buttons", reason: "overage_unfunded", warn: ["balance_80"] };

test("on a 200 the answer is written for each shop in it, atomically, as a file the deployer and the panel read", async () => {
  const w = opsWorld(); try {
    w.setUsage(totals());
    w.answer(answerFor(BUTTONS));
    const state = w.fresh();
    assert.deepEqual(await heartbeatTick(w.config, "k", state, w.fetchFn, NOW), { accepted: true });
    const file = readAnswerFile(join(w.config.fleetDir!, "glow-salon.json"));
    assert.deepEqual(file, { schema: 1, at: NOW.toISOString(), plan: "business", allowance: 3000, innovator: true, ai: "buttons", reason: "overage_unfunded", warn: ["balance_80"] });
    assert.ok(!JSON.stringify(readFileSync(join(w.config.fleetDir!, "glow-salon.json"), "utf8")).includes("tmp"));
  } finally { w.done(); }
});

test("no answer for a shop, or an older fleet with no answer at all, leaves the last mode as it was: never 'normal'", async () => {
  const w = opsWorld(); try {
    w.setUsage(totals());
    const state = w.fresh();
    w.answer(answerFor(BUTTONS));
    await heartbeatTick(w.config, "k", state, w.fetchFn, NOW);
    for (const later of [{ status: 200, body: { ok: true } }, { status: 200, body: { ok: true, shops: {} } }, { status: 200, body: { ok: true, shops: { "someone-else": { ai: "normal" } } } }, { status: 200, body: { ok: true, shops: { "glow-salon": { ai: "turbo" } } } }]) {
      w.answer(later);
      assert.equal((await heartbeatTick(w.config, "k", state, w.fetchFn, new Date(NOW.getTime() + 60_000))).accepted, true);
      assert.equal(readAnswerFile(join(w.config.fleetDir!, "glow-salon.json"))?.ai, "buttons", JSON.stringify(later));
    }
    w.answer(answerFor({ ...BUTTONS, ai: "normal", reason: undefined, warn: [] }));
    await heartbeatTick(w.config, "k", state, w.fetchFn, new Date(NOW.getTime() + 120_000));
    assert.equal(readAnswerFile(join(w.config.fleetDir!, "glow-salon.json"))?.ai, "normal", "only fleet saying normal makes it normal");
  } finally { w.done(); }
});

test("a refused or unreachable heartbeat moves nothing: not the baseline in memory, not the baseline file, not the answer", async () => {
  const w = opsWorld(); try {
    w.setUsage(totals());
    const state = w.fresh();
    await heartbeatTick(w.config, "k", state, w.fetchFn, NOW); // first beat: the baseline starts at the current totals
    w.setUsage(totals({ messages: 130 }));
    w.answer({ status: 400, body: { error: "no" } });
    assert.deepEqual(await heartbeatTick(w.config, "k", state, w.fetchFn, new Date(NOW.getTime() + 60_000)), { accepted: false });
    assert.equal(state.usageBaseline["glow-salon"].messages, 100);
    assert.equal(readUsageBaseline(w.config.fleetDir!)["glow-salon"].messages, 100);
    w.answer({ status: 200, body: { ok: true } });
    await heartbeatTick(w.config, "k", state, w.fetchFn, new Date(NOW.getTime() + 120_000));
    assert.equal(w.sent.at(-1)!.agents[0].usage.messages, 30, "the missed minute is counted in the next one, once");
  } finally { w.done(); }
});

test("a restart of ops sends the difference and never replays the record: the baseline is on disk", async () => {
  const w = opsWorld(); try {
    w.setUsage(totals());
    await heartbeatTick(w.config, "k", w.fresh(), w.fetchFn, NOW);
    assert.equal(w.sent[0].agents[0].usage, undefined, "the first beat only sets the baseline");
    assert.ok(existsSync(join(w.config.fleetDir!, "usage-baseline.json")));
    w.setUsage(totals({ messages: 112, rules: 31, decision: 70 }));
    await heartbeatTick(w.config, "k", w.fresh(), w.fetchFn, new Date(NOW.getTime() + 60_000)); // a new process: its state is read back from the file
    assert.deepEqual(w.sent[1].agents[0].usage.by_step, { rules: 1, decision: 10, model: 0 });
    assert.equal(w.sent[1].agents[0].usage.messages, 12);
    await heartbeatTick(w.config, "k", w.fresh(), w.fetchFn, new Date(NOW.getTime() + 120_000));
    assert.equal(w.sent[2].agents[0].usage, undefined, "and a second restart sends nothing again");
    // with no fleet folder in the config the baseline is in memory only, and a new process starts again at the current totals
    const bare: OpsConfig = { ...w.config }; delete bare.fleetDir;
    await heartbeatTick(bare, "k", { baseline: {}, usageBaseline: {}, lastKnown: {}, lastProblem: "" }, w.fetchFn, new Date(NOW.getTime() + 180_000));
    assert.equal(w.sent[3].agents[0].usage, undefined);
  } finally { w.done(); }
});

test("readUsage takes only numbers from the status file and nothing else", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-ops-")); try {
    const file = join(dir, "s.json");
    const write = (usage: unknown) => writeFileSync(file, JSON.stringify({ shop: "x", usage, backups: { lastDrillAt: "9876543210 secret" } }));
    write({ ...totals(), at: NOW.toISOString(), note: "I want to book for Priya" });
    assert.deepEqual(readUsage(file), totals());
    assert.doesNotMatch(JSON.stringify(readUsage(file)), /Priya|secret/u);
    // the count of calls with no price is optional: kept when it is a whole number, and an older file without it is read as having none counted
    write({ ...totals(), unpriced: 4 });
    assert.deepEqual(readUsage(file), { ...totals(), unpriced: 4 });
    for (const odd of [-1, 1.5, "4", null]) { write({ ...totals(), unpriced: odd }); assert.deepEqual(readUsage(file), totals(), `unpriced ${JSON.stringify(odd)} is dropped, and the rest still reads`); }
    write({ ...totals(), messages: "100" });
    assert.equal(readUsage(file), undefined);
    write({ ...totals(), messages: -1 });
    assert.equal(readUsage(file), undefined);
    write({ messages: 3 });
    assert.equal(readUsage(file), undefined);
    write(null);
    assert.equal(readUsage(file), undefined);
    assert.equal(readUsage(join(dir, "absent.json")), undefined);
    assert.equal(readUsage(undefined), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
