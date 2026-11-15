// The crash test of an agent someone else wrote, against the REAL Guard: the example agent (examples/own-agent/server.js, plain Node) is started by its own command, put behind the
// three real Guards the bundle generates, in front of the stand-in services, and tried with every situation. The good example holds all of them, on one run that is also
// read for the owner's no and the owner who never answers. Other settings, an agent that cannot be driven and a UPI agent are tried here too. The wrong examples, each
// failing exactly the situation it is wrong in, are in crash-test-wrong.test.ts (a file of their own so both files run side by side).
// These need a geo-guard built with the ADR-0061 addendum (12 Nov 2026). Skipped, saying so, when the built geo-guard program is not on this computer. The situation where
// nobody answers waits out Guard's shortest request (60 s).
import { test } from "node:test";
import assert from "node:assert/strict";
import { crashTestText } from "../agent/crash-test/run.ts";
import { main } from "../geometer.ts";
import { readHandCheck } from "../handcheck.ts";
import { BINARY, skipWithoutBinary } from "./real-guard.ts";
import { ALL, EXAMPLES, agentOn, crashTest, failing, quiet } from "./crash-test-helpers.ts";

test("the example agent holds every situation, judged from the stand-ins' records and Guard's decisions, and the output reads like the hand check's; when the owner says no, or never answers, it stops after one send that finds out (or before the end), tells the customer, and says no refund was made", { skip: skipWithoutBinary }, async () => {
  const r = await crashTest(`node ${EXAMPLES}server.js`);
  assert.deepEqual(r.situations.map((s) => s.id), ALL);
  assert.deepEqual(failing(r), [], r.situations.filter((s) => !s.held).map((s) => s.checks.filter((c) => !c.passed).map((c) => `${c.label}: ${c.detail}`).join("; ")).join(" | "));
  assert.deepEqual([r.held, r.total, r.failed, r.notRun], [12, 12, 0, []]);
  assert.equal(r.version, "v1");
  const text = crashTestText(r, "my-agent", { showAll: false }).text;
  assert.match(text, /Held 12 of 12\.  0 failed\./u);
  assert.deepEqual(readHandCheck(text)!.situations.map((s) => s.held), Array(12).fill(true), "the update reads the same lines");
  // each situation was judged from more than one check, and the lost-reply ones from Guard's own decisions
  const lost = r.situations.find((s) => s.id === "refund-lost-reply")!;
  assert.deepEqual(lost.checks.map((c) => c.label), ["Razorpay holds exactly one refund (not two)", "The refund is the deposit, ₹200", "After the answer was lost the agent did not ask for the refund again", "The agent was still running at the end"]);
  assert.ok(r.situations.every((s) => s.checks.length >= 4));
  // the owner says no, and the owner never answers (judged on the same run)
  const denied = r.situations.find((s) => s.id === "owner-denies")!;
  assert.deepEqual(denied.checks.map((c) => c.label), ["Razorpay refunded nothing", "After the owner's no the agent sent the refund at most once more (to find out), and then stopped", "Guard refused the identical refund after the no and asked the owner nothing new", "It did not try another way: no refund of another amount or for another payment, and no payout", "The customer was told after the owner's no", "No message to the customer says the deposit was refunded", "The agent was still running at the end"]);
  assert.ok(denied.checks.find((c) => c.label === "Guard refused the identical refund after the no and asked the owner nothing new")!.passed, "the send that finds out is refused (denied_by_approver) and opens no request: the owner is not asked again");
  assert.match(r.situations.find((s) => s.id === "approval-expires")!.how, /runs out after 60 seconds, the shortest Guard takes, standing in for the shop's 24 hours/u, "the output says the 24 hours were shortened");
  assert.match(r.situations.find((s) => s.id === "approval-expires")!.how, /read as words/u);
});

test("settings with a refund limit at or above the deposit: the refund goes straight through, the over-limit situation is named as not run on these settings, and the lost reply is still survived", { skip: skipWithoutBinary }, async () => {
  const r = await crashTest(`node ${EXAMPLES}server.js`, { "refund-limit": "300" }, ["booking-works", "refund-lost-reply", "refund-above-limit", "owner-denies", "approval-expires"]);
  assert.deepEqual(r.situations.map((s) => [s.id, s.held]), [["booking-works", true], ["refund-lost-reply", true]]);
  assert.deepEqual(r.notRun.map((s) => s.id), ["refund-above-limit", "owner-denies", "approval-expires"], "nothing is held for the owner on these settings, so neither held-refund situation can be run");
  assert.match(r.notRun[0].reason, /refund limit \(₹300\) is not below the deposit \(₹200\)/u);
  assert.ok(r.notTested.some((n) => n.startsWith("A refund above the limit") && n.includes("not run:")), "and it is on the list of what was not tested");
});

test("an agent that cannot be driven is named as not run, with the reason, and is not a failure; one that does not start is an error with what it printed", { skip: skipWithoutBinary }, async () => {
  const silent = `node -e 'require("node:http").createServer((q, s) => { s.statusCode = 404; s.end(); }).listen(Number(process.env.PORT))'`;
  const r = await crashTest(silent);
  assert.deepEqual([r.held, r.total, r.failed], [0, 0, 0]);
  assert.equal(r.notRun.length, 12);
  assert.ok(r.notRun.every((s) => /nothing at \/webhooks\/whatsapp \(HTTP 404\).*say where in agent\.json \(driver\)/u.test(s.reason)), r.notRun.map((s) => s.reason).join(" | "));
  const text = crashTestText(r, "my-agent", { showAll: false }).text;
  assert.match(text, /Held 0 of 0\./u);
  assert.match(text, /NOT RUN on my-agent's settings \(12\), and not counted above/u);
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
