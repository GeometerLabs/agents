// Voice notes in the deploy bundle (plan B29): the speech and media Guards as defined, the key intake that gates the setting, and the refusal of a shop's `speech` block
// until the key is handed in AND the Guards are placed (they are defined but not placed in compose yet, so today it is always refused). Stand-ins only; no account.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEDIA_TOOL, SPEECH_GUARDS_PLACED, SPEECH_TOOL, mediaGuardDef, mediaSpec, speechGuardDef, speechProblem, speechSpec } from "../generate/speech.ts";
import { GUARD_KINDS } from "../generate/guards.ts";
import { noSecretsIn } from "../generate/rules.ts";
import { planShop } from "../generate/shop.ts";
import { SPEECH_GUARD, SPEECH_SECRET, secretFile, speechKeyHandedIn, writeSpeechKey } from "../lib/secrets.ts";
import { spokenCostOf, summarizeUsage } from "../lib/usage.ts";
import { serverConfig, panelRuntime, tempServer, PHONE_NUMBER_ID } from "./helpers.ts";
import { SARVAM_ROUTES } from "../../modules/voice/sarvam.ts";
import { GEOMETER_SPEECH_ROUTES } from "../../modules/voice/geometer.ts";

const ID = { tenant: "acme-vps-1", name: "acme-vps-1-speech", version: 1, reviewedBy: "builder-arjun" };

test("the speech Guard (Sarvam, the optional paid adapter) fronts Sarvam, adds its header from a file only it reads, lists the two routes the adapter calls, pins the speaking model and caps both a day", () => {
  const def = speechGuardDef("sarvam");
  assert.deepEqual(def, { kind: "speech", tool: SPEECH_TOOL, upstream: "api.sarvam.ai:443", secretFile: SPEECH_SECRET, headers: { "api-subscription-key": "${file:/run/secrets/speech_subscription_key}" } });
  const spec = speechSpec(ID, { provider: "sarvam", ttsModel: "bulbul:v3", listensPerDay: 300, speaksPerDay: 300 });
  assert.deepEqual(spec.routes.map((r) => [r.method, r.path, r.operation]), [["POST", SARVAM_ROUTES.listen, "transcribe"], ["POST", SARVAM_ROUTES.speak, "synthesize"]]);
  assert.deepEqual(spec.rules, [{ id: "speak-model-pin", kind: "argument_allowlist", operation: "synthesize", field: "model", match: "exact", allowed_values: ["bulbul:v3"] }]);
  assert.deepEqual(spec.limits.map((l) => [l.id, l.operation, l.cap, l.window_seconds]), [["listens-per-day", "transcribe", "300", 86400], ["speaks-per-day", "synthesize", "300", 86400]]);
  assert.ok(!spec.rules.some((r) => r.operation === "transcribe"), "the listening model sits in a multipart body, which a JSON-field rule cannot bind: stated, not faked");
  assert.deepEqual(noSecretsIn({ "spec.json": JSON.stringify(spec), "def.json": JSON.stringify(def) }, []), []);
});

test("the default speech Guard fronts Geometer's own service on the private network: no key, plain HTTP, its two routes, a daily count each, nothing pinned that the contract does not have", () => {
  const def = speechGuardDef();
  assert.deepEqual(def, { kind: "speech", tool: SPEECH_TOOL, upstream: "geometer-speech:8080", plain: true, headers: {} });
  assert.equal(def.secretFile, undefined, "no key file");
  const spec = speechSpec(ID, { listensPerDay: 400, speaksPerDay: 400 });
  assert.deepEqual(spec.routes.map((r) => [r.method, r.path, r.operation]), [["POST", GEOMETER_SPEECH_ROUTES.listen, "transcribe"], ["POST", GEOMETER_SPEECH_ROUTES.speak, "synthesize"]]);
  assert.deepEqual(spec.rules, []);
  assert.deepEqual(spec.limits.map((l) => [l.id, l.cap]), [["listens-per-day", "400"], ["speaks-per-day", "400"]]);
  // elsewhere than the private network: a shared token, sent by Guard from a file
  const remote = speechGuardDef("geometer", { upstream: "speech.example.com:443", withToken: true });
  assert.deepEqual(remote.headers, { Authorization: "${file:/run/secrets/speech_token}" });
  assert.equal(remote.secretFile, "speech_token");
});

test("the media Guard lists one GET route with the shop's own WhatsApp token and cannot send or upload; it cannot tell a media id from another id there (stated, not hidden)", () => {
  const def = mediaGuardDef();
  assert.equal(def.tool, MEDIA_TOOL);
  assert.equal(def.headers.Authorization, "${file:/run/secrets/whatsapp_authorization}");
  const spec = mediaSpec({ ...ID, tenant: "glow-salon", name: "glow-salon-media" }, { readsPerDay: 500 });
  assert.deepEqual(spec.routes, [{ method: "GET", path: "/{version}/{media_id}", operation: "read_media" }]);
  assert.ok(!spec.routes.some((r) => r.method !== "GET"));
});

test("neither Guard is a kind a server places today: an unchanged server is byte-identical", () => {
  assert.ok(!GUARD_KINDS.includes("speech") && !GUARD_KINDS.includes("media"));
  assert.equal(SPEECH_GUARDS_PLACED, false);
});

test("Sarvam is refused without its key; the default (Geometer's own service) asks for no key; both are refused until the Guards are placed", () => {
  assert.match(speechProblem({ provider: "sarvam", keyHandedIn: false, placed: true })!, /hand it in with `geometer speech-key/);
  assert.match(speechProblem({ provider: "sarvam", keyHandedIn: true, placed: false })!, /cannot run on this server yet/);
  assert.equal(speechProblem({ provider: "sarvam", keyHandedIn: true, placed: true }), null);
  assert.equal(speechProblem({ keyHandedIn: false, placed: true }), null, "no key needed for the default");
  assert.match(speechProblem({ keyHandedIn: false, placed: false })!, /cannot run on this server yet/);
});

test("the key goes in through the write-only intake: a file for the speech Guard only, found by existence and size, never read back", () => {
  const dir = mkdtempSync(join(tmpdir(), "voice-key-"));
  try {
    assert.equal(speechKeyHandedIn(dir), false);
    assert.throws(() => writeSpeechKey(dir, "short"), /one line/);
    assert.throws(() => writeSpeechKey(dir, "has a space inside it"), /one line/);
    writeSpeechKey(dir, "  sk_test_0123456789  ");
    assert.equal(speechKeyHandedIn(dir), true);
    assert.ok(secretFile(dir, SPEECH_GUARD, SPEECH_SECRET).endsWith(`g-speech/${SPEECH_SECRET}`));
    assert.ok(statSync(secretFile(dir, SPEECH_GUARD, SPEECH_SECRET)).size > 0); // the file's mode and its folder are writeSecretFile's, the same as every other Guard key
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a shop's runtime.json with a speech block is refused by the planner, with the reason in words; without the block the plan has no voice problem", () => {
  const speech = { provider: "sarvam", rate: { sttInrPerMinute: 1, ttsInrPer1000Characters: 1 } };
  const base = { services: { payments: {}, calendar: { calendarId: "glow@example.com" }, messaging: { phoneNumberId: PHONE_NUMBER_ID }, timeoutMs: 20_000 } };
  const plan = (runtime: Record<string, unknown>, keyHandedIn?: boolean) => {
    const t = tempServer({ "glow-salon": panelRuntime({ ...base, ...runtime }) });
    try { return planShop(serverConfig(), t.shop("glow-salon"), {}, undefined, keyHandedIn ? { speechKeyHandedIn: true } : {}); } finally { t.done(); }
  };
  assert.deepEqual(plan({}).problems.filter((p) => p.rule === "voice-notes"), []);
  const noKey = plan({ speech }).problems.find((p) => p.rule === "voice-notes")!;
  assert.match(noKey.message, /speech-key/);
  const noGuards = plan({ speech }, true).problems.find((p) => p.rule === "voice-notes")!;
  assert.match(noGuards.message, /cannot run on this server yet/);
  const geometer = plan({ speech: { provider: "geometer" } }).problems.find((p) => p.rule === "voice-notes")!;
  assert.doesNotMatch(geometer.message, /speech-key/, "the default needs no key, only the Guards");
  assert.match(geometer.message, /cannot run on this server yet/);
});

test("a spoken copy's cost is read from the record as model spend; other entries and a missing cost are not", () => {
  const audio = { action: "send_message", outcome: "confirmed", refs: { audio: "voice", costMicroInr: "4500", to: "customer", templates: "menu" }, language: "hi" };
  assert.equal(spokenCostOf(audio), 4500);
  assert.equal(spokenCostOf({ ...audio, refs: { ...audio.refs, costMicroInr: "x" } }), null);
  assert.equal(spokenCostOf({ ...audio, refs: { to: "customer", templates: "menu" } }), null);
  assert.equal(spokenCostOf({ ...audio, action: "receive_message" }), null);
  const t = summarizeUsage([audio, { action: "receive_message", outcome: "confirmed", refs: { step: "rules", provider: "rules", model: "rule-parser", costMicroInr: "0" } }], {});
  assert.equal(t.modelMicroInr, 4500);
  assert.equal(t.messages, 1);
  assert.equal(Object.values(t.repliesByLanguage!).reduce((a, b) => a + b, 0), 0, "a spoken copy is not counted as a reply by language");
});
