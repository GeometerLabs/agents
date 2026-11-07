// The parts of the agent crash test that need no Guard program: what agent.json may say, that a new version of the agent is not a change to its Guards, where the geo-guard program is
// found, which situations the settings allow, the words the customer writes, the go-live certificate (and that the monthly report reads it as it reads a template's), and the readers the
// update uses. The run against a real Guard is in crash-test.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentDesiredHash, addAgent } from "../agent/deploy.ts";
import { buildAgentCertificate, agentCertificatePage, agentCertificateText } from "../agent/crash-test/certificate.ts";
import { DEFAULT_SAYS, commandFor, contractEnv, resolveDriver } from "../agent/crash-test/driver.ts";
import { issueGoLive, recordService } from "../agent/crash-test/golive.ts";
import { chooseSituations, crashTestText, notTestedFor, parseCrashResult, planCrashTest, readOfCrash } from "../agent/crash-test/run.ts";
import type { CrashResult } from "../agent/crash-test/run.ts";
import { buildSituations } from "../agent/crash-test/situations.ts";
import { agentGuardPart, parseAgentFile, readAgent, setAgent } from "../agent/folder.ts";
import { findGuardBinary } from "../agent/guard-process.ts";
import { writeAgentReport } from "../agent/report.ts";
import { makeContext } from "../geometer.ts";
import { readHandCheck } from "../handcheck.ts";
import { fakeRunner, ok, failed } from "../lib/runner.ts";
import { secretFile } from "../lib/secrets.ts";
import { loadState } from "../lib/state.ts";
import { sha256Hex, stableJson } from "../lib/util.ts";
import { readGoLiveCertificate } from "../../templates/commerce/bookings/report/go-live.ts";
import { CALENDAR_ID, PHONE_NUMBER_ID, tempServer } from "./helpers.ts";

const NOW = new Date("2026-11-05T09:00:00Z");
const flags = { "owner-whatsapp": "+919800000001", deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "calendar-id": CALENDAR_ID };
const BANNED = /\b(safe|safely|guaranteed?|proves?|proven|certified)\b/iu;

function server(extra: Record<string, string> = {}, name = "my-agent") {
  const t = tempServer({});
  addAgent(t.root, name, { ...flags, ...extra }, () => "", NOW);
  return { ...t, ctx: makeContext(t.root, { now: () => NOW }), name };
}

/** A crash test result like the real one's, with the checks a certificate counts. */
function result(change: Partial<CrashResult> = {}): CrashResult {
  const check = (label: string, passed = true, detail = "") => ({ label, passed, detail });
  return {
    format: "geometer-agent-crash-test/1", agent: "my-agent", version: "abc1234", held: 2, total: 3, failed: 1,
    situations: [
      { id: "booking-works", title: "A normal booking", held: true, how: "No faults", checks: [check("One payment link"), check("Nothing was refunded")] },
      { id: "razorpay-key-expired", title: "Razorpay key expired", held: true, how: "401", checks: [check("No payment link exists")] },
      { id: "refund-lost-reply", title: "Razorpay made the refund but the reply was lost", held: false, how: "lost", checks: [check("Razorpay holds exactly one refund (not two)"), check("After the answer was lost the agent did not ask for the refund again", false, "Guard saw 3 more refund requests")] },
    ],
    notRun: [{ id: "refund-above-limit", title: "A refund above the limit is held by Guard, and nothing is refunded", reason: "the refund limit is not below the deposit" }],
    notTested: notTestedFor([{ id: "refund-above-limit", title: "A refund above the limit is held by Guard, and nothing is refunded", reason: "the refund limit is not below the deposit" }]),
    tookMs: 12_000, ...change,
  };
}

// ---- agent.json -------------------------------------------------------------------------------------------------------------------------------

test("agent.json may say how to start the agent, which version it is at and how the crash test drives it; each mistake is said in plain words", () => {
  const base = { schema: 1, name: "my-agent", upstreams: ["razorpay", "whatsapp"], whatsapp: { phoneNumberId: PHONE_NUMBER_ID }, createdAt: NOW.toISOString() };
  const good = parseAgentFile({ ...base, run: "node app.js", version: "abc1234", driver: { cwd: "/srv/app", whatsappPath: "/wa", says: { book: ["hi", "a haircut"], cancel: "cancel it" }, bookedWords: "\\bdone\\b", startSeconds: 30 } }, "my-agent");
  assert.deepEqual(good.errors, []);
  assert.equal(good.agent!.run, "node app.js");
  assert.equal(good.agent!.version, "abc1234");
  assert.deepEqual(good.agent!.driver!.says, { book: ["hi", "a haircut"], cancel: "cancel it" });
  const bad = parseAgentFile({ ...base, run: "node app.js\nrm -rf /", version: "v 2", driver: { whatsappPath: "wa", bookedWords: "(", says: { book: [], dance: "x" }, startSeconds: 0, colour: 1 } }, "my-agent");
  const said = bad.errors.join("\n");
  assert.match(said, /"run" must be the one-line command/u);
  assert.match(said, /"version" must be one word/u);
  assert.match(said, /driver\.whatsappPath" must be a path/u);
  assert.match(said, /driver\.bookedWords" must be a regular expression/u);
  assert.match(said, /driver\.says\.book must be one line/u);
  assert.match(said, /driver\.says\.dance/u);
  assert.match(said, /driver\.startSeconds" must be a whole number of seconds/u);
  assert.match(said, /what driver\.colour means/u);
  // an agent.json without any of this is as valid as it was
  assert.deepEqual(parseAgentFile(base, "my-agent").errors, []);
});

test("agent add --run --version records them, and agent set changes them with the same checks", () => {
  const s = server({ run: "node app.js --version={version}", version: "v1" });
  try {
    const folder = readAgent(s.root, s.name);
    assert.deepEqual([folder.agent!.run, folder.agent!.version], ["node app.js --version={version}", "v1"]);
    const after = setAgent(s.root, s.name, { version: "v2" });
    assert.deepEqual([after.agent!.run, after.agent!.version], ["node app.js --version={version}", "v2"], "the run command is kept when only the version is given");
    assert.throws(() => setAgent(s.root, s.name, { version: "two words" }), /"version" must be one word/u);
    assert.equal(readAgent(s.root, s.name).agent!.version, "v2", "a refused change writes nothing");
    assert.equal(commandFor(after.agent!, undefined), "node app.js --version=v2");
    assert.equal(commandFor(after.agent!, "v1"), "node app.js --version=v1", "a version asked for wins over the one in agent.json");
    assert.equal(commandFor(after.agent!, "v1", "other {version}"), "other v1", "--run wins over agent.json");
  } finally { s.done(); }
});

test("a new version of the agent is not a change to its Guards: the deployer's hash ignores run, version and driver, and an agent.json without them hashes as it always did", () => {
  const s = server();
  try {
    const plain = readAgent(s.root, s.name);
    assert.equal(agentDesiredHash(plain), sha256Hex(stableJson({ agent: plain.agentText, settings: plain.settingsText })), "an agent without the new keys: byte for byte the hash it had");
    const v1 = setAgent(s.root, s.name, { run: "node app.js", version: "v1" });
    const v2 = setAgent(s.root, s.name, { version: "v2" });
    assert.equal(agentDesiredHash(v1), agentDesiredHash(plain), "adding a command and a version changes nothing the Guards are built from");
    assert.equal(agentDesiredHash(v2), agentDesiredHash(v1));
    assert.equal(agentGuardPart(v2.agentText), agentGuardPart(plain.agentText));
    // but a real change still is one
    const moved = JSON.parse(plain.agentText); moved.caps = { linksPerHour: 5 };
    assert.notEqual(agentDesiredHash({ agentText: stableJson(moved), settingsText: plain.settingsText }), agentDesiredHash(plain));
  } finally { s.done(); }
});

// ---- the driver contract -----------------------------------------------------------------------------------------------------------------------

test("the driver contract: defaults for a plain agent, the builder's own lines when given, and the environment the agent is started with", () => {
  const d = resolveDriver(undefined);
  assert.deepEqual([d.whatsappPath, d.razorpayPath, d.says.book, d.says.cancel], ["/webhooks/whatsapp", "/webhooks/razorpay", [...DEFAULT_SAYS.book], DEFAULT_SAYS.cancel]);
  assert.equal(d.startMs, 20_000);
  assert.ok(d.bookedWords.test("Booked!") && d.bookedWords.test("your slot is CONFIRMED") && !d.bookedWords.test("Pay the deposit to book"), "the default words for 'it is booked'");
  const own = resolveDriver({ says: { book: "hello", haggle: "cheaper?" }, bookedWords: "\\bdone\\b", situationSeconds: 90, cwd: "app" });
  assert.deepEqual([own.says.book, own.says.haggle, own.own], [["hello"], "cheaper?", { book: true, cancel: false, haggle: true, refundMore: false }]);
  assert.ok(own.bookedWords.test("all DONE") && !own.bookedWords.test("Booked!"));
  const env = contractEnv({ port: 4100, razorpay: "http://127.0.0.1:1", whatsapp: "http://127.0.0.1:2", credential: "gg_x", phoneNumberId: "123456789012345", whatsappAppSecret: "wa", razorpayWebhookSecret: "rz", depositInr: 200, priceInr: 450, ownerWhatsapp: "+919800000001", retryMs: 300 });
  assert.deepEqual(Object.keys(env).sort(), ["GEOMETER_CRASH_TEST", "GEOMETER_CREDENTIAL", "GEOMETER_DEPOSIT_INR", "GEOMETER_OWNER_WHATSAPP", "GEOMETER_PORT", "GEOMETER_PRICE_INR", "GEOMETER_RAZORPAY_URL", "GEOMETER_RAZORPAY_WEBHOOK_SECRET", "GEOMETER_RETRY_MS", "GEOMETER_WHATSAPP_APP_SECRET", "GEOMETER_WHATSAPP_URL", "PHONE_NUMBER_ID", "PORT"].sort(), "a service the agent does not use has no address, and an unset value is not passed as 'undefined'");
  assert.equal(env.PORT, "4100");
});

// ---- where the geo-guard program comes from -----------------------------------------------------------------------------------------------------

test("the geo-guard program: --guard-bin, GEO_GUARD_BIN, the PATH, and on a Linux server out of the Guard image; anywhere else a plain message says what to do", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-find-"));
  try {
    const runner = fakeRunner(() => failed("no docker here"));
    const common = { runner, image: "geo-guard:0.1.0", cacheDir: join(dir, "work") };
    assert.deepEqual(await findGuardBinary({ ...common, flag: process.execPath, env: {} }), { ok: true, path: process.execPath, how: "--guard-bin" });
    assert.match((await findGuardBinary({ ...common, flag: join(dir, "nope"), env: { GEO_GUARD_BIN: process.execPath } }) as { reason: string }).reason, /--guard-bin .* is not a program/u, "a flag that is wrong is not quietly replaced by the next place");
    assert.deepEqual(await findGuardBinary({ ...common, env: { GEO_GUARD_BIN: process.execPath } }), { ok: true, path: process.execPath, how: "GEO_GUARD_BIN" });
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "geo-guard"), "#!/bin/sh\n", { mode: 0o755 });
    assert.deepEqual(await findGuardBinary({ ...common, env: { PATH: `/nonexistent:${join(dir, "bin")}` } }), { ok: true, path: join(dir, "bin", "geo-guard"), how: "the PATH" });
    const nowhere = await findGuardBinary({ ...common, env: { PATH: "" }, platform: "darwin" });
    assert.equal(nowhere.ok, false);
    assert.match((nowhere as { reason: string }).reason, /--guard-bin <path> \(or set GEO_GUARD_BIN\).*Linux server/u);
    assert.equal(runner.calls.length, 0, "nothing is asked of Docker off a Linux server");

    // on Linux: the image the server already has is asked for its id, a container is made from it, the program is copied out, the container is removed; the second time it is kept
    const docker = fakeRunner((_command, args) => {
      if (args[0] === "image") return ok("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n");
      if (args[0] === "create") return ok("aabbccddeeff00112233445566778899\n");
      if (args[0] === "cp") { writeFileSync(args[2], "#!/bin/sh\n"); return ok(); }
      return ok();
    });
    const fromImage = await findGuardBinary({ runner: docker, image: "geo-guard:0.1.0", cacheDir: join(dir, "work"), env: { PATH: "" }, platform: "linux" });
    assert.equal(fromImage.ok, true);
    assert.equal((fromImage as { how: string }).how, "the image geo-guard:0.1.0");
    assert.deepEqual(docker.calls.map((c) => c.args[0]), ["image", "create", "cp", "rm"]);
    assert.deepEqual(docker.calls[2].args, ["cp", "aabbccddeeff00112233445566778899:/usr/local/bin/geo-guard", (fromImage as { path: string }).path]);
    assert.ok(existsSync((fromImage as { path: string }).path));
    await findGuardBinary({ runner: docker, image: "geo-guard:0.1.0", cacheDir: join(dir, "work"), env: { PATH: "" }, platform: "linux" });
    assert.deepEqual(docker.calls.map((c) => c.args[0]), ["image", "create", "cp", "rm", "image"], "the program taken out once is used again");
    // no image on the server
    const noImage = await findGuardBinary({ runner: fakeRunner(() => failed("No such image")), image: "geo-guard:0.1.0", cacheDir: join(dir, "work2"), env: { PATH: "" }, platform: "linux" });
    assert.match((noImage as { reason: string }).reason, /Guard image geo-guard:0.1.0 is not on this server/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- which situations these settings allow -----------------------------------------------------------------------------------------------------

test("the situations are the same list for every agent, with the ones the settings cannot express named and left out of the counts", async () => {
  const ids = ["booking-works", "payment-link-lost-reply", "refund-lost-reply", "duplicate-payment-event", "calendar-silent-failure", "razorpay-key-expired", "refund-above-limit", "refund-more-than-paid", "duplicate-inbound", "price-below-floor"];
  const a = server({ run: "node app.js" });
  try {
    const built = buildSituations((await planCrashTest(a.ctx, a.name, { guardBin: process.execPath })).plan);
    assert.deepEqual(built.situations.map((s) => s.id), ids);
    assert.deepEqual(built.skipped, []);
    assert.equal(new Set(built.situations.map((s) => s.title)).size, ids.length, "titles are what an update matches on, so they are all different");
    assert.ok(built.situations.every((s) => !/\d|₹/u.test(s.title)), "and carry no version, amount or setting");
  } finally { a.done(); }
  // a refund limit that is not below the deposit: no refund of the deposit can be above it
  const b = server({ run: "node app.js", "refund-limit": "300", upstreams: "razorpay,whatsapp" });
  try {
    const built = buildSituations((await planCrashTest(b.ctx, b.name, { guardBin: process.execPath })).plan);
    assert.deepEqual(built.skipped.map((s) => s.id), ["calendar-silent-failure", "refund-above-limit"]);
    assert.match(built.skipped.find((s) => s.id === "refund-above-limit")!.reason, /refund limit \(₹300\) is not below the deposit \(₹200\)/u);
    assert.match(built.skipped.find((s) => s.id === "calendar-silent-failure")!.reason, /does not use the calendar/u);
    assert.equal(built.situations.length, ids.length - 2);
    assert.deepEqual(chooseSituations(built, ["booking-works", "refund-above-limit"]).skipped.map((s) => s.id), ["refund-above-limit"]);
    assert.throws(() => chooseSituations(built, ["booking-works", "nonsense"]), /I don't know the situation nonsense\. They are: booking-works, .*refund-above-limit/u);
  } finally { b.done(); }
  const c = server();
  try { await assert.rejects(() => planCrashTest(c.ctx, c.name, { guardBin: process.execPath }), /has no command to start it with.*agent set my-agent --run/u); } finally { c.done(); }
});

// ---- reading the result ------------------------------------------------------------------------------------------------------------------------

test("the result prints the way the hand check does, and the update reads it from the printed lines and from --json alike", () => {
  const r = result();
  const printed = crashTestText(r, "Glow Salon", { showAll: false });
  assert.equal(printed.failed, 1);
  assert.match(printed.text, /Held 2 of 3\.  1 failed\.  \d+ not tested\./u);
  assert.match(printed.text, /✗ +Razorpay made the refund but the reply was lost/u);
  assert.match(printed.text, /NOT RUN on Glow Salon's settings \(1\)/u);
  assert.match(printed.text, /never from what the agent said/u);
  assert.doesNotMatch(printed.text, BANNED);
  const lines = readHandCheck(printed.text)!;
  assert.deepEqual([lines.held, lines.total, lines.situations.map((s) => s.title)], [2, 3, r.situations.map((s) => s.title)], "the hand check's reader reads this output too");
  assert.deepEqual(readOfCrash(r), { held: 2, total: 3, situations: r.situations.map((s) => ({ title: s.title, held: s.held, why: s.held ? "" : "After the answer was lost the agent did not ask for the refund again: Guard saw 3 more refund requests" })) });
  assert.deepEqual(parseCrashResult(`progress line\n${JSON.stringify(r)}\n`), r);
  assert.equal(parseCrashResult("nothing useful"), undefined);
  assert.equal(parseCrashResult(JSON.stringify({ format: "other" })), undefined);
  const named = r.notTested.filter((n) => n.includes("not run:"));
  assert.equal(named.length, 1, "what could not be run for this agent is named in the not-tested list, with the reason");
  assert.match(named[0], /A refund above the limit.*the refund limit is not below the deposit/u);
});

// ---- the go-live certificate -----------------------------------------------------------------------------------------------------------------

test("the go-live certificate: the template's document format, signed and sealed by the shared code, says what held and what did not, and the monthly report reads it as it reads a template's", () => {
  const s = server({ run: "node app.js", version: "abc1234" });
  try {
    const settings = readAgent(s.root, s.name).settings!;
    const r = result();
    const cert = buildAgentCertificate({ settings, agent: s.name, result: r, issuedAt: NOW.getTime() });
    assert.equal(cert.format, "geometer-go-live-certificate/1");
    assert.deepEqual(cert.pathway, { name: "own-agent", version: "abc1234" });
    assert.deepEqual([cert.checks.held, cert.checks.total, cert.checks.failed, cert.checks.failedTitles], [2, 3, 1, ["Razorpay made the refund but the reply was lost"]]);
    assert.equal(cert.policyDigest, cert.checkedPolicyDigest, "the crash test always ran on the agent's own settings");
    assert.equal(buildAgentCertificate({ settings, agent: s.name, result: result({ version: null }), issuedAt: NOW.getTime() }).pathway.version, "unversioned");

    // no signing key on the server: made and sealed, but the monthly report cannot trust it
    const unsigned = issueGoLive(s.ctx, s.name, r);
    assert.equal(unsigned.signed, false);
    assert.deepEqual(unsigned.files.map((f) => f.split("/").at(-1)), ["go-live-certificate.json", "go-live-certificate-en.html", "go-live-certificate-en.txt"]);
    const file = join(s.paths.exportsOf(s.name), "go-live-certificate.json");
    assert.equal(readGoLiveCertificate(readFileSync(file, "utf8"), settings).finding.status, "untrusted");

    // with the server's signing key
    const keyFile = secretFile(s.root, "panel", "signing_key");
    mkdirSync(join(s.root, "secrets", "panel"), { recursive: true });
    writeFileSync(keyFile, generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(keyFile, 0o600);
    const extra = join(s.root, "copy-here");
    const signed = issueGoLive(s.ctx, s.name, r, extra);
    assert.equal(signed.signed, true);
    assert.ok(existsSync(join(extra, "go-live-certificate-en.html")), "also written where the builder asked");
    const reading = readGoLiveCertificate(readFileSync(file, "utf8"), settings);
    assert.equal(reading.finding.status, "own", "the checks ran on this agent's own settings");
    assert.deepEqual([(reading.finding as { held: number }).held, (reading.finding as { total: number }).total, (reading.finding as { failed: number }).failed], [2, 3, 1]);
    // other settings: the report says so
    const other = { ...settings, deposit: { ...settings.deposit, amountInr: 300 } };
    assert.equal(readGoLiveCertificate(readFileSync(file, "utf8"), other).finding.status, "different");

    const html = readFileSync(join(extra, "go-live-certificate-en.html"), "utf8");
    for (const text of [html, signed.text, agentCertificateText({ document: cert, format: "geometer-document/1", digest: "", code: "ABC", signature: null }), agentCertificatePage({ document: cert, format: "geometer-document/1", digest: "", code: "ABC", signature: null })]) assert.doesNotMatch(text, BANNED);
    assert.match(signed.text, /Held 2 of 3 situations\. 1 failed\. \d+ not tested\./u);
    assert.match(signed.text, /Did not hold: Razorpay made the refund but the reply was lost/u);
    assert.match(signed.text, /Run by hand against stand-in services .* with your agent's real Guards in front of them/u);
    assert.match(html, /Agent version[\s\S]*own-agent abc1234/u);

    // the agent is recorded as in service at that version, only when someone says so
    assert.equal(loadState(s.root).agents?.[s.name]?.service, undefined);
    recordService(s.ctx, s.name, result({ held: 3, total: 3, failed: 0 }), signed.code);
    assert.deepEqual(loadState(s.root).agents![s.name].service, { version: "abc1234", at: NOW.toISOString(), held: 3, of: 3, code: signed.code });
    assert.ok(loadState(s.root).agents![s.name].index >= 1, "an agent that was not deployed yet gets its network index the way a deploy would give it");

    // the monthly report: it needs a record to read; an empty one is enough to see what it says about the go-live checks
    mkdirSync(s.paths.exportsOf(s.name), { recursive: true });
    writeFileSync(join(s.paths.exportsOf(s.name), "record.json"), "[]");
    writeFileSync(join(s.paths.exportsOf(s.name), "bookings.json"), "[]");
    const out = join(s.root, "report");
    const report = writeAgentReport(s.root, s.name, { month: "2026-11", out, language: "en", source: "stand-in", now: NOW.getTime() });
    assert.match(report.goLiveSaid ?? "", /says its checks ran on this shop's own settings: held 2 of 3, 1 failed/u);
    assert.equal(JSON.parse(readFileSync(join(out, "report-2026-11.json"), "utf8")).document.goLive.status, "own");
    rmSync(join(s.paths.exportsOf(s.name), "go-live-certificate.json"));
    const without = writeAgentReport(s.root, s.name, { month: "2026-11", out: join(s.root, "report2"), language: "en", source: "stand-in", now: NOW.getTime() });
    assert.equal(without.goLiveSaid, undefined);
    assert.equal(JSON.parse(readFileSync(join(s.root, "report2", "report-2026-11.json"), "utf8")).document.goLive.status, "none", "without a certificate the report says none was given, as before");
  } finally { s.done(); }
});
