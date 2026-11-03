// The generator: what each Guard is given from a shop's own files, and every rule that refuses a deploy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { guardDef, guardToml, GUARD_KINDS, GUARD_UPSTREAM_TIMEOUT_MS, calendarSpec, whatsappSpec } from "../generate/guards.ts";
import { noSecretsIn, provenLine, toolNamesMatch, tripwiresHold } from "../generate/rules.ts";
import { DEFAULT_RUNTIME_TIMEOUT_MS, planModelGuard, planShop } from "../generate/shop.ts";
import { parseVerify, refusalProblems } from "../generate/verify.ts";
import { shopNameProblem } from "../lib/util.ts";
import { CALENDAR_ID, PHONE_NUMBER_ID, panelRuntime, serverConfig, tempServer } from "./helpers.ts";

const plan = (runtime = panelRuntime(), serverChange: Record<string, unknown> = {}) => {
  const t = tempServer({ "glow-salon": runtime });
  try { return planShop(serverConfig(serverChange), t.shop("glow-salon")); } finally { t.done(); }
};
const rules = (p: ReturnType<typeof plan>) => p.problems.map((x) => x.rule);

test("a good shop gives three Guards: Razorpay from the settings, WhatsApp and Calendar pinned exactly to the shop's own ids", () => {
  const p = plan();
  assert.deepEqual(p.problems, []);
  assert.deepEqual(p.guards.map((g) => g.kind), ["razorpay", "whatsapp", "calendar"]);
  const [razorpay, whatsapp, calendar] = p.guards;
  const deposit = razorpay.spec.rules.find((r: any) => r.id === "deposit-amount");
  assert.equal(deposit.min, deposit.max, "the only amount a link may be made for is the shop's deposit");
  assert.equal(razorpay.spec.rules.find((r: any) => r.id === "refund-needs-owner").kind, "call_bound_approval");
  assert.deepEqual(whatsapp.spec.rules, [{ id: "own-number-only", kind: "argument_allowlist", operation: "send", field: "phone_number_id", match: "exact", allowed_values: [PHONE_NUMBER_ID] }]);
  assert.equal(calendar.spec.rules.length, 5);
  for (const r of calendar.spec.rules) assert.deepEqual([r.field, r.match, r.allowed_values], ["calendarId", "exact", [CALENDAR_ID]]);
  assert.ok(!calendar.spec.routes.some((r: any) => r.operation === "clear"), "clearing a calendar is not even listed");
  for (const g of p.guards) assert.equal(g.tenant, "glow-salon");
});

test("the approval window is one setting: 24 hours by default, and the same number in Guard's bundle", () => {
  assert.equal(plan().guards[0].spec.approval_ttl_seconds, 86_400);
  assert.equal(plan(panelRuntime(), { approvalHours: 6 }).guards[0].spec.approval_ttl_seconds, 21_600);
  assert.throws(() => serverConfig({ approvalHours: 0 }), /approvalHours/);
  assert.throws(() => serverConfig({ approvalHours: 200 }), /approvalHours/);
});

test("the tool name is written once and read by both files: spec, guard.toml and the definition agree, for every kind", () => {
  const model = serverConfig().model;
  for (const kind of GUARD_KINDS) {
    const def = guardDef(kind, model);
    const p = kind === "model" ? planModelGuard(serverConfig()) : plan().guards.find((g) => g.kind === kind)!;
    const toml = guardToml({ def, tenant: p.tenant, deployment: p.deployment, bundleDigest: "sha256:" + "a".repeat(64), upstream: p.upstream, adminSha: "b".repeat(64), agents: [{ id: "runtime-x", sha: "c".repeat(64) }] });
    assert.equal(p.spec.tool, def.tool);
    assert.match(toml, new RegExp(`^tool = "${def.tool}"$`, "m"));
    assert.deepEqual(toolNamesMatch(p, toml), []);
  }
  const p = plan().guards[0];
  const wrong = guardToml({ def: guardDef("whatsapp"), tenant: p.tenant, deployment: p.deployment, bundleDigest: "sha256:" + "a".repeat(64), upstream: p.upstream, adminSha: "b".repeat(64), agents: [] });
  assert.match(toolNamesMatch(p, wrong)[0].message, /guard\.toml says tool "whatsapp" but the Guard is for "razorpay"/);
  assert.equal(toolNamesMatch(p, wrong)[0].rule, "tool-names-match");
});

test("the runtime must wait longer than Guard: 15 s or less is refused by name, nothing set becomes 20 s", () => {
  for (const timeoutMs of [15_000, 10_000, 1]) {
    const p = plan(panelRuntime({ services: { calendar: { calendarId: CALENDAR_ID }, messaging: { phoneNumberId: PHONE_NUMBER_ID }, timeoutMs } }));
    assert.deepEqual(rules(p), ["runtime-timeout-exceeds-guard"]);
    assert.match(p.problems[0].message, new RegExp(`${timeoutMs} ms, but Guard waits ${GUARD_UPSTREAM_TIMEOUT_MS} ms`));
  }
  const unset = plan(panelRuntime({ services: { calendar: { calendarId: CALENDAR_ID }, messaging: { phoneNumberId: PHONE_NUMBER_ID } } }));
  assert.deepEqual(unset.problems, []);
  assert.equal((unset.runtime.services as any).timeoutMs, DEFAULT_RUNTIME_TIMEOUT_MS);
  assert.ok(DEFAULT_RUNTIME_TIMEOUT_MS > GUARD_UPSTREAM_TIMEOUT_MS);
  const justOver = plan(panelRuntime({ services: { calendar: { calendarId: CALENDAR_ID }, messaging: { phoneNumberId: PHONE_NUMBER_ID }, timeoutMs: 15_001 } }));
  assert.deepEqual(justOver.problems, []);
  assert.equal((justOver.runtime.services as any).timeoutMs, 15_001);
});

test("everything runtime.json must say is said all at once, in plain words, naming the rule", () => {
  const p = plan({ mode: "fakes", services: { timeoutMs: 5000 } });
  assert.deepEqual(rules(p).sort(), ["calendar-id", "runtime-mode-live", "runtime-timeout-exceeds-guard", "whatsapp-number-id"]);
  assert.match(p.problems.find((x) => x.rule === "runtime-mode-live")!.message, /fakes/);
  assert.deepEqual(p.guards, [], "nothing is generated for a shop that cannot be deployed");
});

test("the runtime config points only at the shop's own Guards, with credential files, and sets what the panel has no say in", () => {
  const p = plan(panelRuntime({ services: { payments: { baseUrl: "https://api.razorpay.com" }, calendar: { calendarId: CALENDAR_ID }, messaging: { phoneNumberId: PHONE_NUMBER_ID } } }));
  const r = p.runtime as any;
  assert.equal(r.mode, "live");
  assert.equal(r.host, "0.0.0.0");
  assert.equal(r.services.payments.baseUrl, "http://g-glow-salon-razorpay:8080", "a base URL the panel wrote is not used: Guard is the only way out");
  assert.equal(r.services.messaging.baseUrl, "http://g-glow-salon-whatsapp:8080");
  assert.equal(r.services.calendar.baseUrl, "http://g-glow-salon-calendar:8080");
  assert.equal(r.services.payments.agentTokenFile, "/run/secrets/agent_razorpay");
  assert.ok(p.notes.some((n) => /services\.payments/.test(n)));
  assert.equal(r.parser, undefined, "no parser asked for: the built-in rules read the messages");
  assert.ok(!JSON.stringify(r).match(/rzp_|Bearer|Basic /));
});

test("a model parser must be the server's one model on the server's wire, and is pointed at the shared model Guard", () => {
  const good = plan(panelRuntime({ parser: { wire: "openai", model: "gpt-4o-mini" } }));
  assert.deepEqual(good.problems, []);
  assert.deepEqual(good.runtime.parser, { wire: "openai", baseUrl: "http://g-model:8080/v1", model: "gpt-4o-mini", agentTokenFile: "/run/secrets/agent_model" });
  assert.deepEqual(rules(plan(panelRuntime({ parser: { wire: "openai", model: "gpt-5" } }))), ["model-matches-guard"]);
  assert.deepEqual(rules(plan(panelRuntime({ parser: { wire: "anthropic", model: "gpt-4o-mini" } }))), ["model-matches-guard"]);
  const anthropic = plan(panelRuntime({ parser: { wire: "anthropic", model: "claude-haiku-4-5" } }), { model: { wire: "anthropic", model: "claude-haiku-4-5" } });
  assert.equal((anthropic.runtime.parser as any).baseUrl, "http://g-model:8080", "the Messages call goes to <base>/v1/messages");
});

test("shop names the heartbeat would refuse are refused when the shop is added", () => {
  assert.equal(shopNameProblem("glow-salon"), undefined);
  assert.match(shopNameProblem("Glow Salon")!, /usable shop name/);
  assert.match(shopNameProblem("shop-98765-43210")!, /phone number/);
  assert.match(shopNameProblem("a@b")!, /usable shop name/);
  assert.match(shopNameProblem("x".repeat(41))!, /usable shop name/);
});

test("no secret appears in any generated file: the literal values are searched for, and so are the shapes of keys", () => {
  const p = plan();
  const files: Record<string, string> = { "runtime.json": JSON.stringify(p.runtime) };
  for (const g of p.guards) {
    files[`${g.service}/spec.json`] = g.specText;
    files[`${g.service}/guard.toml`] = guardToml({ def: g.def, tenant: g.tenant, deployment: g.deployment, bundleDigest: "sha256:" + "a".repeat(64), upstream: g.upstream, adminSha: "b".repeat(64), agents: [{ id: "runtime-glow-salon", sha: "c".repeat(64) }], ...(g.kind === "razorpay" ? { approver: { id: "owner-glow-salon", secretFile: "/run/secrets/owner_notify_secret" } } : {}) });
  }
  assert.deepEqual(noSecretsIn(files, ["rzp_live_abcdef123456", "supersecret-value-123"]), []);
  const leaked = noSecretsIn({ ...files, "guard.toml": `${files["g-glow-salon-razorpay/guard.toml"]}\nAuthorization = "Basic cnpwX2xpdmVfMTIzNDU2Nzg6c2VjcmV0c2VjcmV0"` }, ["supersecret-value-123"]);
  assert.equal(leaked[0].rule, "no-secret-in-files");
  assert.match(leaked[0].message, /Basic credential/);
  assert.equal(noSecretsIn({ "x.toml": "token = supersecret-value-123" }, ["supersecret-value-123"])[0].rule, "no-secret-in-files");
  assert.equal(noSecretsIn({ "x": "gg_0123456789abcdef0123456789abcdef" }, [])[0].rule, "no-secret-in-files");
  assert.equal(noSecretsIn({ "x": '{"private_key": "-----BEGIN PRIVATE KEY-----"}' }, []).length, 2);
});

test("guard.toml holds hashes and file names, in the production profile, with the admin port on loopback", () => {
  const g = plan().guards[0];
  const toml = guardToml({ def: g.def, tenant: g.tenant, deployment: g.deployment, bundleDigest: "sha256:" + "d".repeat(64), upstream: g.upstream, adminSha: "b".repeat(64), agents: [{ id: "runtime-glow-salon", sha: "c".repeat(64) }, { id: "relay-glow-salon", sha: "e".repeat(64), operations: ["send"] }], approver: { id: "owner-glow-salon", secretFile: "/run/secrets/owner_notify_secret" } });
  assert.match(toml, /^profile = "production"$/m);
  assert.match(toml, /^admin_listen = "127\.0\.0\.1:8082"$/m);
  assert.match(toml, /^mode = "enforce"$/m);
  assert.match(toml, /^upstream_timeout_ms = 15000$/m);
  assert.match(toml, /^unlisted_tools = "deny"$/m);
  assert.match(toml, /^Authorization = "\$\{file:\/run\/secrets\/razorpay_authorization\}"$/m);
  assert.match(toml, /owner-glow-salon = "\$\{file:\/run\/secrets\/owner_notify_secret\}"/);
  assert.match(toml, /operations = \["send"\]/);
  assert.match(toml, /^\[upstream_tls\]$/m, "a real provider is reached over TLS");
  const test = guardToml({ def: g.def, tenant: g.tenant, deployment: g.deployment, bundleDigest: "sha256:" + "d".repeat(64), upstream: { host: "standins:8790", tls: false }, adminSha: "b".repeat(64), agents: [] });
  assert.ok(!/\[upstream_tls\]/.test(test), "a stand-in is plain HTTP");
});

test("verify-bundle's answer is read: 4 of 4 with the untestable ones named, and a failing tripwire names its rule", () => {
  const good = parseVerify(0, "sha256:aa ok (ceiling production)\ntool razorpay tenant glow-salon mode enforce: the bundle matches this configuration\ntripwires: passed 4 of 4, not self-testable 4\n  not self-testable: rule refund-once: whether a repeat is stopped depends on the intent ledger in the store\n  not self-testable: limit links-per-hour: a cap is counted by reserving capacity in the store\n", "");
  assert.deepEqual([good.ok, good.passed, good.of, good.notSelfTestable.length], [true, 4, 4, 2]);
  assert.equal(provenLine(good), "4 of 4 limits proven to bite (2 cannot be tested without writing, and are not counted)");
  const bad = parseVerify(1, "sha256:aa ok\n", "geo-guard: tripwire failed: rule everything-goes (argument_allowlist on send) expected refuse for to = x, got allow\nrefused: 1 of 1 tripwires would have been allowed\n");
  assert.deepEqual([bad.ok, bad.failedRules, bad.passed, bad.of], [false, ["everything-goes"], 0, 1]);
  const p = plan().guards[0];
  assert.deepEqual(tripwiresHold(p, bad).map((x) => x.rule), ["tripwire:everything-goes"]);
  assert.deepEqual(tripwiresHold(p, good), []);
  assert.equal(parseVerify(0, "no tripwires line at all", "").ok, false, "silence is not a pass");
  assert.equal(parseVerify(1, "", "refused: the policy bundle names tool \"a\" but guard.toml says tool = \"b\"").ok, false);
  const refusals = refusalProblems("compile", "refused: rules[2] (refund-once): needs an intents entry\nrefused: limits[0] (x): bad cap\n");
  assert.equal(refusals.length, 2);
  assert.match(refusals[0].message, /refund-once/);
});

test("the specs for WhatsApp and Calendar are the same bytes for the same settings", () => {
  const id = { tenant: "t", name: "t-whatsapp", version: 3, reviewedBy: "b" };
  assert.deepEqual(whatsappSpec(id, { phoneNumberId: PHONE_NUMBER_ID, messagesPerHour: 200 }), whatsappSpec(id, { phoneNumberId: PHONE_NUMBER_ID, messagesPerHour: 200 }));
  assert.equal(calendarSpec(id, { calendarId: CALENDAR_ID, createdPerHour: 30, deletedPerDay: 20 }).version, 3);
  assert.equal(plan().guards[0].specText, plan().guards[0].specText);
});
