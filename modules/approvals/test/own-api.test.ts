// B71 part 2: the approvals relay asks the owner about a call held on an agent's OWN API (an API with no payment module, behind the spec its builder reviewed with the
// companies kit). These tests read the kit's own example spec, Guard's review items in the form Guard writes them, and the relay with a stub Guard: what the owner is
// shown is the held call (B74), an amount sent as text or a request for several approvers is never shown, the words are checked in four languages, and a yes goes
// to Guard for that approval only (the agent sends the identical call again; nothing is sent by the relay).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NOT_A_REFUND } from "../clients.ts";
import type { GuardClient, RuntimeClient } from "../clients.ts";
import { heldRulesOf, readHeldCall } from "../held-call.ts";
import { checkOwnApi, formatCallAmount, OWN_API_META_TEMPLATES, ownApiVoice, renderOwnApi } from "../own-api-voice.ts";
import type { OwnApiFacts } from "../own-api-voice.ts";
import { createRelay } from "../relay.ts";
import { openRelayStore } from "../store.ts";
import { fakeClock } from "../../core/clock.ts";
import { LANGUAGES } from "../../language/languages.ts";
import { fillBody, metaBody } from "../../language/meta-templates.ts";
import type { Messaging, OutboundMessage, TemplateMessage } from "../../messaging/messaging.ts";

const OWNER = "+919800000001";
const START = Date.UTC(2026, 10, 11, 6, 0);
/** The kit's example, as the builder would deploy it (the bundle builds it the same way): create_refund over 10000 cents waits for a person. */
const SPEC = JSON.parse(readFileSync(new URL("../../../companies/examples/refunds-api/spec.json", import.meta.url), "utf8")) as { tool: string; rules: unknown[] };
const HELD = heldRulesOf(SPEC);

const item = (over: Record<string, unknown> = {}, args: Record<string, unknown> = { amount: ["int", "15000"], charge_id: ["str", "ch_1"] }) => ({
  id: "appr_9", agent: "agent-brightside", tool: SPEC.tool, operation: "create_refund", you_may_decide: true, arguments: ["map", args],
  requested_at_ms: String(START), expires_at_ms: String(START + 3_600_000), ...over,
});

test("the kit's spec says which calls wait for the owner, which field is the amount and its unit", () => {
  assert.deepEqual(HELD, { tool: "refunds", rules: [{ operation: "create_refund", amountField: "amount", unit: "cents" }] });
});

test("a held own-API call is read from Guard's typed arguments; anything else is not shown to the owner", () => {
  const read = readHeldCall(item(), HELD);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.deepEqual({ ...read.held }, { id: "appr_9", agent: "agent-brightside", amountPaise: 15000, paymentId: "", receipt: "appr_9", requestedAtMs: START, expiresAtMs: START + 3_600_000, youMayDecide: true });
  assert.deepEqual(read.call, { operation: "create_refund", unit: "cents", details: ["charge_id ch_1"] });
  // an amount sent as text is a different call to Guard, and is never shown as an amount
  assert.match((readHeldCall(item({}, { amount: ["str", "15000"], charge_id: ["str", "ch_1"] }), HELD) as { reason: string }).reason, /not a whole number written as a number/u);
  // another tool, or an operation the spec does not hold, is not the owner's to answer: the relay leaves it alone
  assert.ok((readHeldCall(item({ tool: "razorpay" }), HELD) as { reason: string }).reason.endsWith(NOT_A_REFUND));
  assert.ok((readHeldCall(item({ operation: "cancel_refund" }), HELD) as { reason: string }).reason.endsWith(NOT_A_REFUND));
  // a request for several approvers is the builder's: an own API's Guard has the owner alone
  assert.match((readHeldCall(item({ approvals_needed: 2, approvals_given: 0, votes: [], requested_by: [], may_still_decide: [] }), HELD) as { reason: string }).reason, /several approvers/u);
  // the fields shown are id-like, short and few: a link, a bare domain, an address, prose, a reply-looking value or a map is left out, never cleaned
  const noisy = readHeldCall(item({}, { amount: ["int", "15000"], a_link: ["str", "https://pay.example/x"], a_domain: ["str", "pay.example"], a_mail: ["str", "x@y"], b_reply: ["str", "approve K7M2QX"], c_map: ["map", {}], d_note: ["str", "refund for order 7"], e: ["str", "ord_7"], f: ["int", "12"], g: ["str", "z"], h: ["str", "w"] }), HELD);
  assert.ok(noisy.ok);
  if (noisy.ok) assert.deepEqual(noisy.call!.details, ["e ord_7", "f 12", "g z"]);
});

test("the owner reads the held amount in the API's own unit, rupees only when the unit is paise", () => {
  assert.equal(formatCallAmount(15000, "cents"), "15000 cents");
  assert.equal(formatCallAmount(123400, "paise"), "₹1,234");
  assert.equal(formatCallAmount(7, undefined), "7");
});

test("in every language the ask states the held call, passes its check, and its template fills back to exactly that text; a number not in the call fails the check", () => {
  for (const language of LANGUAGES) {
    const f: OwnApiFacts = { language, operation: "create_refund", amount: "15000 cents", details: "charge_id ch_1", approvalCode: "K7M2QX", approvalHours: 1 };
    const text = renderOwnApi("owner_call_needs_approval", f);
    for (const piece of ["create_refund", "15000 cents", "charge_id ch_1", '"approve K7M2QX"', '"deny K7M2QX"']) assert.ok(text.includes(piece), `${language}: ${piece} in ${text}`);
    assert.deepEqual(checkOwnApi(text, f), { ok: true, problems: [] }, language);
    const message = ownApiVoice.templateMessage({ ids: ["owner_call_needs_approval"], language, facts: f, text, generic: ownApiVoice.ownerTemplate });
    assert.equal(message.name, "owner_agent_call_approval_request", language);
    assert.equal(fillBody(metaBody(OWN_API_META_TEMPLATES[0].bodies[language]), message.parameters!), text, `${language}: the template is the checked text`);
    for (const id of ["owner_call_approval_done", "owner_call_approval_denied", "owner_call_approval_expired", "owner_call_approval_failed"] as const) {
      assert.deepEqual(checkOwnApi(renderOwnApi(id, f), f), { ok: true, problems: [] }, `${language} ${id}`);
    }
    assert.equal(checkOwnApi(text.replace("15000 cents", "16000 cents"), f).ok, false, `${language}: another amount is caught`);
  }
});

/** A WhatsApp that keeps what it was handed; the owner's window is open once they have written. */
function recording() {
  const sent: { text: string; template?: TemplateMessage }[] = [];
  let open = false;
  const out = (to: string, text: string, kind: OutboundMessage["kind"]): OutboundMessage => ({ id: `m${sent.length}`, to, kind, text, sentAt: START, afterOptOut: false });
  const messaging: Messaging = {
    async sendText(to, text) { sent.push({ text }); return out(to, text, "text"); },
    async sendTemplate(to, t) { sent.push({ text: t.text, template: t }); return out(to, t.text, "template"); },
    async isWindowOpen() { return open; },
    async getMessage() { return null; },
  };
  return { messaging, sent, open: () => { open = true; } };
}

test("the relay asks the owner about the held call, once, and a yes goes to Guard for that approval only: the agent is not told and nothing is sent by the relay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-own-api-"));
  const store = openRelayStore(dir);
  const wa = recording();
  const notified: unknown[] = [];
  const held = item();
  const guard: GuardClient = { async reviews() { return { ok: true, items: [held] }; }, async notify(approval, decision, approver) { notified.push({ approval, decision, approver }); return { kind: "recorded", state: "approved" }; } };
  // the context is Guard's held call itself, as the bundle's own-API context reads it (bundle/agent/relay-context.ts ownApiRuntime, tested there with the real Guard)
  const runtime: RuntimeClient = {
    async context(receipt) {
      const r = readHeldCall(held, HELD);
      if (!r.ok || r.held.id !== receipt) return { kind: "missing" };
      return { kind: "found", context: { booking: r.held.id, customerPhone: "", businessName: "Brightside", timeZone: "Asia/Kolkata", ownerLanguage: "en", paymentId: "", amountPaise: r.held.amountPaise, approval: r.held.id, expiresAtMs: r.held.expiresAtMs, call: r.call } };
    },
    async decided() { return true; },
  };
  try {
    const relay = createRelay({ voice: ownApiVoice, readHeld: (i) => readHeldCall(i, HELD), clock: fakeClock(START), guard, runtime, messaging: wa.messaging, store, ownerWhatsapp: OWNER, expectedAgent: "agent-brightside" });
    await relay.poll(); await relay.poll();
    assert.equal(wa.sent.length, 1, "asked once");
    assert.equal(wa.sent[0].template?.name, "owner_agent_call_approval_request", "outside the window, as its template");
    const code = /"approve ([A-Z0-9]{6})"/u.exec(wa.sent[0].text)![1];
    assert.equal(wa.sent[0].text, `Approval needed: your agent wants to make a create_refund call for 15000 cents (charge_id ch_1). Reply "approve ${code}" or "deny ${code}" within 1 hours.`);
    wa.open();
    relay.receive([{ id: "wamid.1", from: OWNER, text: `approve ${code}`, timestamp: START }]);
    await relay.idle();
    assert.deepEqual(notified, [{ approval: "appr_9", decision: "approve", approver: undefined }], "Guard gets the owner's answer for that approval, and nothing else");
    assert.equal(wa.sent.at(-1)!.text, "Thank you. The create_refund call for 15000 cents is approved. It goes through when your agent sends it again, exactly as it was.");
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
