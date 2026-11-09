// The crash test of an agent someone else wrote, against the REAL Guard: the example agent (examples/own-agent/server.js, plain Node) is started by its own command, put behind the
// three real Guards the bundle generates, in front of the stand-in services, and tried with every situation. The good example holds all of them. The broken example is the same agent
// with one thing done wrong (when the answer to a refund is lost it asks again, with a new idempotency key): it fails exactly one situation, and the stand-in still holds one refund
// because Guard's at-most-once rule held every repeat. Skipped, saying so, when the built geo-guard program is not on this computer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addAgent } from "../agent/deploy.ts";
import { crashTestText, planCrashTest, runCrashTest } from "../agent/crash-test/run.ts";
import type { CrashResult } from "../agent/crash-test/run.ts";
import { makeContext, main } from "../geometer.ts";
import { readHandCheck } from "../handcheck.ts";
import { CALENDAR_ID, PHONE_NUMBER_ID, tempServer } from "./helpers.ts";
import { BINARY, skipWithoutBinary } from "./real-guard.ts";

const EXAMPLES = new URL("../examples/own-agent/", import.meta.url).pathname;
const NOW = new Date("2026-11-05T09:00:00Z");
const flags = { upstreams: "razorpay,whatsapp,calendar", "owner-whatsapp": "+919800000001", deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "calendar-id": CALENDAR_ID };
const ALL = ["booking-works", "payment-link-lost-reply", "refund-lost-reply", "duplicate-payment-event", "calendar-silent-failure", "razorpay-key-expired", "refund-above-limit", "refund-more-than-paid", "duplicate-inbound", "price-below-floor"];

function agentOn(run: string, extra: Record<string, string> = {}) {
  const t = tempServer({});
  addAgent(t.root, "my-agent", { ...flags, run, version: "v1", ...extra }, () => "", NOW);
  return { ...t, ctx: makeContext(t.root, { now: () => NOW }) };
}

async function crashTest(run: string, extra: Record<string, string> = {}, situations?: string[]): Promise<CrashResult> {
  const a = agentOn(run, extra);
  try {
    const { plan } = await planCrashTest(a.ctx, "my-agent", { guardBin: BINARY });
    return await runCrashTest(plan, situations ? { situations } : {});
  } finally { a.done(); }
}

async function quiet<T>(work: () => Promise<T>): Promise<{ result: T; out: string; err: string }> {
  const out: string[] = []; const err: string[] = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a: unknown[]) => out.push(a.join(" ")); console.error = (...a: unknown[]) => err.push(a.join(" "));
  try { return { result: await work(), out: out.join("\n"), err: err.join("\n") }; } finally { console.log = log; console.error = error; }
}

const failing = (r: CrashResult) => r.situations.filter((s) => !s.held).map((s) => s.id);

test("the example agent holds every situation, judged from the stand-ins' records and Guard's decisions, and the output reads like the hand check's", { skip: skipWithoutBinary }, async () => {
  const r = await crashTest(`node ${EXAMPLES}server.js`);
  assert.deepEqual(r.situations.map((s) => s.id), ALL);
  assert.deepEqual(failing(r), [], r.situations.filter((s) => !s.held).map((s) => s.checks.filter((c) => !c.passed).map((c) => `${c.label}: ${c.detail}`).join("; ")).join(" | "));
  assert.deepEqual([r.held, r.total, r.failed, r.notRun], [10, 10, 0, []]);
  assert.equal(r.version, "v1");
  const text = crashTestText(r, "my-agent", { showAll: false }).text;
  assert.match(text, /Held 10 of 10\.  0 failed\./u);
  assert.deepEqual(readHandCheck(text)!.situations.map((s) => s.held), Array(10).fill(true), "the update reads the same lines");
  // each situation was judged from more than one check, and the lost-reply ones from Guard's own decisions
  const lost = r.situations.find((s) => s.id === "refund-lost-reply")!;
  assert.deepEqual(lost.checks.map((c) => c.label), ["Razorpay holds exactly one refund (not two)", "The refund is the deposit, ₹200", "After the answer was lost the agent did not ask for the refund again", "The agent was still running at the end"]);
  assert.ok(r.situations.every((s) => s.checks.length >= 4));
});

test("the broken example fails exactly the situation it is broken in, and Guard's at-most-once holds every repeat so the stand-in still has one refund", { skip: skipWithoutBinary }, async () => {
  const r = await crashTest(`node ${EXAMPLES}server-broken.js`);
  assert.deepEqual(failing(r), ["refund-lost-reply"]);
  assert.deepEqual([r.held, r.total], [9, 10]);
  const lost = r.situations.find((s) => s.id === "refund-lost-reply")!;
  const byLabel = Object.fromEntries(lost.checks.map((c) => [c.label, c]));
  // the money: one refund at Razorpay, because Guard did not let the repeat through
  assert.equal(byLabel["Razorpay holds exactly one refund (not two)"].passed, true);
  assert.equal(byLabel["The refund is the deposit, ₹200"].passed, true);
  // the agent: it asked again, three times, with a new key each time, and Guard's decisions say it held every one
  const asked = byLabel["After the answer was lost the agent did not ask for the refund again"];
  assert.equal(asked.passed, false);
  assert.match(asked.detail, /Guard saw 3 more refund requests after the one whose answer was lost, and stopped all of them \(hold\)/u);
  assert.match(asked.detail, /not by the agent/u);
  // every other situation held, including the ones that use the same resend-until-approved path
  assert.ok(r.situations.filter((s) => s.id !== "refund-lost-reply").every((s) => s.held));
});

test("settings with a refund limit at or above the deposit: the refund goes straight through, the over-limit situation is named as not run on these settings, and the lost reply is still survived", { skip: skipWithoutBinary }, async () => {
  const r = await crashTest(`node ${EXAMPLES}server.js`, { "refund-limit": "300" }, ["booking-works", "refund-lost-reply", "refund-above-limit"]);
  assert.deepEqual(r.situations.map((s) => [s.id, s.held]), [["booking-works", true], ["refund-lost-reply", true]]);
  assert.deepEqual(r.notRun.map((s) => s.id), ["refund-above-limit"]);
  assert.match(r.notRun[0].reason, /refund limit \(₹300\) is not below the deposit \(₹200\)/u);
  assert.ok(r.notTested.some((n) => n.startsWith("A refund above the limit") && n.includes("not run:")), "and it is on the list of what was not tested");
});

test("an agent that cannot be driven is named as not run, with the reason, and is not a failure; one that does not start is an error with what it printed", { skip: skipWithoutBinary }, async () => {
  const silent = `node -e 'require("node:http").createServer((q, s) => { s.statusCode = 404; s.end(); }).listen(Number(process.env.PORT))'`;
  const r = await crashTest(silent);
  assert.deepEqual([r.held, r.total, r.failed], [0, 0, 0]);
  assert.equal(r.notRun.length, 10);
  assert.ok(r.notRun.every((s) => /nothing at \/webhooks\/whatsapp \(HTTP 404\).*say where in agent\.json \(driver\)/u.test(s.reason)), r.notRun.map((s) => s.reason).join(" | "));
  const text = crashTestText(r, "my-agent", { showAll: false }).text;
  assert.match(text, /Held 0 of 0\./u);
  assert.match(text, /NOT RUN on my-agent's settings \(10\), and not counted above/u);
  // through the command line: exit 1, and --json is the result alone on the output
  const a = agentOn(silent);
  try {
    const human = await quiet(() => main(["agent", "crash-test", "my-agent", "--server", a.root, "--guard-bin", BINARY], a.ctx));
    assert.equal(human.result, 1);
    assert.match(human.out, /Held 0 of 0\./u);
    const json = await quiet(() => main(["agent", "crash-test", "my-agent", "--server", a.root, "--guard-bin", BINARY, "--json", "--situations", "booking-works"], a.ctx));
    assert.equal(json.result, 1);
    assert.equal(JSON.parse(json.out).notRun.length, 1, "with --json the output is only the result; the progress is on the error stream");
    assert.match(json.err, /1\/1 {2}A normal booking/u);
    const refused = await quiet(() => main(["agent", "go-live", "my-agent", "--server", a.root, "--guard-bin", BINARY, "--situations", "booking-works"], a.ctx));
    assert.equal(refused.result, 1);
    assert.match(refused.err, /A go-live certificate counts all the situations/u);
    const nothing = await quiet(() => main(["agent", "go-live", "my-agent", "--server", a.root, "--guard-bin", BINARY], a.ctx));
    assert.equal(nothing.result, 1);
    assert.match(nothing.err, /No situation could be run, so there is nothing to put in a certificate/u);
  } finally { a.done(); }
  await assert.rejects(() => crashTest("sh -c 'echo cannot find the app >&2; exit 3'"), /The agent did not start: the agent stopped by itself with exit code 3 before it answered\. It printed: cannot find the app\. The command was: /u);
});

test("B71: an agent that takes UPI through the desk is booked only after the owner's own mark, counted once, and owes a refund it never says was sent; the gateway situations are named as not applying", { skip: skipWithoutBinary }, async () => {
  const r = await crashTest(`node ${EXAMPLES}server.js`, { upstreams: "upi,whatsapp,calendar", "upi-id": "glowsalon@okicici", payee: "Glow Salon" });
  assert.deepEqual(r.situations.map((s) => s.id), ["upi-paid-only-after-owner", "upi-marked-twice", "upi-refund-owed"]);
  assert.deepEqual(failing(r), [], r.situations.filter((s) => !s.held).map((s) => s.checks.filter((c) => !c.passed).map((c) => `${c.label}: ${c.detail}`).join("; ")).join(" | "));
  assert.ok(r.notRun.some((s) => s.id === "booking-works" && /takes UPI through the desk/u.test(s.reason)), "the gateway situations say why they did not run");
});
