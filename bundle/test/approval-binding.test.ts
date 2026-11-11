// B74 (11 Nov): what the owner is asked to approve on WhatsApp is the call Guard holds, in every template's words and in all four languages. The relay
// writes the ask from Guard's held call (the amount and the payment, typed) and the runtime's context, and only after checking that the runtime's case is
// for the same payment, the same amount and the same approval. This test pins that, for the three templates' voices: the amount in the text and in the
// out-of-window template's parameters is Guard's amount, formatted once; the template's parameters fill back to exactly the text the outgoing check read;
// and a runtime whose case shows another amount or another payment gets no ask at all. The real Guard's side (a changed call is a new approval) is in
// templates/commerce/bookings/test/approvals-guard-binary.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRelay } from "../../modules/approvals/relay.ts";
import type { RelayVoice } from "../../modules/approvals/relay.ts";
import type { GuardClient, RefundContext, RuntimeClient } from "../../modules/approvals/clients.ts";
import { openRelayStore } from "../../modules/approvals/store.ts";
import { fakeClock } from "../../modules/core/clock.ts";
import { formatInr } from "../../modules/language/format.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";
import { fillBody, metaBody } from "../../modules/language/meta-templates.ts";
import type { MetaTemplate } from "../../modules/language/meta-templates.ts";
import type { Messaging, OutboundMessage, TemplateMessage } from "../../modules/messaging/messaging.ts";
import { bookingsVoice } from "../../templates/commerce/bookings/approvals/relay.ts";
import { ordersVoice } from "../../templates/commerce/orders/approvals/relay.ts";
import { feesVoice } from "../../templates/education/fees/approvals/relay.ts";
import { META_TEMPLATES as BOOKINGS_TEMPLATES } from "../../templates/commerce/bookings/src/language/meta-templates.ts";
import { META_TEMPLATES as ORDERS_TEMPLATES } from "../../templates/commerce/orders/src/language/meta-templates.ts";
import { META_TEMPLATES as FEES_TEMPLATES } from "../../templates/education/fees/src/language/meta-templates.ts";

const OWNER = "+919800000001";
const START = Date.UTC(2026, 10, 3, 6, 0);
const AMOUNT_PAISE = 123_400; // ₹1,234: a figure with a thousands separator, so a formatting slip would show

/** One review item as Guard writes it: the amount and the payment typed, as the relay reads them. */
const heldItem = (amountPaise: number, paymentId: string) => ({
  id: "appr_1", agent: "runtime-shop", tool: "razorpay", operation: "refund", you_may_decide: true,
  arguments: ["map", { amount: ["int", String(amountPaise)], payment_id: ["str", paymentId], receipt: ["str", "c-1"] }],
  requested_at_ms: String(START), expires_at_ms: String(START + 24 * 3_600_000),
});

/** What a template's runtime shows for the case: everything any of the three voices needs. */
const contextOf = (language: Language, over: Partial<RefundContext> = {}): RefundContext => ({
  booking: "c-1", customerPhone: "+919811111111", businessName: "Test Shop", timeZone: "Asia/Kolkata", ownerLanguage: language as RefundContext["ownerLanguage"],
  paymentId: "pay_1", amountPaise: AMOUNT_PAISE, approval: "appr_1", expiresAtMs: START + 24 * 3_600_000,
  serviceName: "haircut", slotMs: START + 2 * 86_400_000, studentName: "Aarav", batchName: "Class 8", monthLabel: "Nov 2026", ...over,
});

/** A WhatsApp that keeps the template messages it was handed, parameters and all (the shared fake does not keep them). The owner has not written: the window is closed. */
function recordingMessaging() {
  const templates: TemplateMessage[] = []; const texts: string[] = [];
  const out = (to: string, text: string, kind: OutboundMessage["kind"]): OutboundMessage => ({ id: `m${templates.length + texts.length}`, to, kind, text, sentAt: START, afterOptOut: false });
  const messaging: Messaging = {
    async sendText(to, text) { texts.push(text); return out(to, text, "text"); },
    async sendTemplate(to, t) { templates.push(t); return out(to, t.text, "template"); },
    async isWindowOpen() { return false; },
    async getMessage() { return null; },
  };
  return { messaging, templates, texts };
}

async function askOnce(voice: RelayVoice, language: Language, held: ReturnType<typeof heldItem>, context: RefundContext) {
  const dir = mkdtempSync(join(tmpdir(), "geo-b74-"));
  const store = openRelayStore(dir);
  const wa = recordingMessaging();
  const guard: GuardClient = { async reviews() { return { ok: true, items: [held] }; }, async notify() { return { kind: "recorded" }; } };
  const runtime: RuntimeClient = { async context() { return { kind: "found", context }; }, async decided() { return true; } };
  try {
    const relay = createRelay({ voice, clock: fakeClock(START), guard, runtime, messaging: wa.messaging, store, ownerWhatsapp: OWNER, expectedAgent: "runtime-shop" });
    await relay.poll();
    return { ...wa, status: relay.status() };
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
}

const VOICES: [string, RelayVoice, readonly MetaTemplate<string>[]][] = [["bookings", bookingsVoice, BOOKINGS_TEMPLATES], ["fees", feesVoice, FEES_TEMPLATES], ["orders", ordersVoice, ORDERS_TEMPLATES]];

for (const [name, voice, templates] of VOICES) {
  test(`B74 (${name}): in every language the owner is asked about Guard's own amount, and the template's parameters are the text the check read`, async () => {
    for (const language of LANGUAGES) {
      const asked = await askOnce(voice, language, heldItem(AMOUNT_PAISE, "pay_1"), contextOf(language));
      assert.equal(asked.templates.length, 1, `${language}: asked once, as a template (the owner's window is closed)`);
      const t = asked.templates[0];
      assert.notEqual(t.name, voice.ownerTemplate, `${language}: the ask has its own approved template, not the generic one`);
      assert.equal(t.language, language);
      assert.ok(t.parameters && t.parameters.length > 0);
      // the formatted total the owner reads is Guard's amount, in the text and in the parameter that carries it
      const shown = formatInr(AMOUNT_PAISE / 100);
      assert.ok(t.text.includes(shown), `${language}: the text states ${shown}: ${t.text}`);
      assert.ok(t.parameters!.includes(shown), `${language}: a parameter carries ${shown}`);
      // no other amount is in what the owner reads
      const amounts = [...t.text.matchAll(/₹[\d,]+(?:\.\d+)?/gu)].map((m) => m[0]);
      assert.deepEqual([...new Set(amounts)], [shown], `${language}: the only amount shown is the held one`);
      // the template, filled with its parameters, is word for word the text the outgoing check passed
      const approved = templates.find((m) => m.name === t.name);
      assert.ok(approved, `${language}: ${t.name} is one of the template's own`);
      assert.equal(fillBody(metaBody(approved.bodies[language]), t.parameters!), t.text, `${language}: the filled template is the checked text`);
    }
  });

  test(`B74 (${name}): a runtime whose case shows another amount or another payment than Guard holds gets no ask: the builder is told`, async () => {
    for (const over of [{ amountPaise: AMOUNT_PAISE + 100 }, { paymentId: "pay_2" }]) {
      const asked = await askOnce(voice, "en", heldItem(AMOUNT_PAISE, "pay_1"), contextOf("en", over));
      assert.equal(asked.templates.length + asked.texts.length, 0, `nothing sent for ${JSON.stringify(over)}`);
      assert.equal(asked.status.alerts.byKind.disagree, 1, `the builder is told for ${JSON.stringify(over)}`);
    }
  });
}
