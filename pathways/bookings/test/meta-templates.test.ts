// The WhatsApp templates: each carries exactly one message's wording, so what the customer reads is what the outgoing check read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorld, glowSalon, CUSTOMER } from "../src/harness.ts";
import { checkMessage } from "../src/language/check.ts";
import { META_TEMPLATES, exampleFacts, fillBody, metaBody, metaSubmissions, parametersFor, slotsOf, templateMessage } from "../src/language/meta-templates.ts";
import { render } from "../src/language/templates.ts";
import { REPORT_TEMPLATES, reportSubmissions } from "../report/whatsapp.ts";
import { LANGUAGES } from "../src/settings.ts";
import type { TemplateMessage } from "../src/adapters/messaging.ts";

const settings = glowSalon();

test("every template, in every language, fills to exactly the rendered message, and the outgoing check passes it", () => {
  for (const t of META_TEMPLATES) {
    for (const language of LANGUAGES) {
      const facts = exampleFacts(settings, language);
      const filled = fillBody(metaBody(t.bodies[language]), parametersFor(t, language, facts));
      assert.equal(filled, render(t.usedFor, facts), `${t.name} (${language})`);
      assert.deepEqual(checkMessage(filled, facts), { ok: true, problems: [] }, `${t.name} (${language})`);
    }
  }
});

test("each template follows Meta's rules: a lowercase name, numbered parameters used once, fixed words at both ends, values with no line breaks", () => {
  assert.equal(new Set(META_TEMPLATES.map((t) => t.name)).size, META_TEMPLATES.length);
  for (const t of META_TEMPLATES) {
    assert.match(t.name, /^[a-z0-9_]+$/);
    for (const language of LANGUAGES) {
      const body = metaBody(t.bodies[language]);
      const numbers = [...body.matchAll(/\{\{(\d+)\}\}/gu)].map((m) => Number(m[1]));
      assert.deepEqual(numbers, numbers.map((_n, i) => i + 1), `${t.name} (${language}) numbers`);
      assert.ok(!body.startsWith("{{") && !body.endsWith("}}"), `${t.name} (${language}) starts or ends with a parameter`);
      assert.ok(body.length <= 1024);
      assert.equal(numbers.length, slotsOf(t.bodies[language]).length);
      for (const p of parametersFor(t, language, exampleFacts(settings, language))) assert.ok(!/[\n\t\r]| {4}/u.test(p) && p.trim() === p && p.length > 0, `${t.name} (${language}) parameter "${p}"`);
    }
  }
});

test("the list to submit to Meta is checked in, and is the one the code produces", () => {
  const checkedIn = JSON.parse(readFileSync(new URL("../whatsapp-templates.json", import.meta.url), "utf8"));
  assert.deepEqual(checkedIn, [...metaSubmissions(settings), ...reportSubmissions()], "run: node pathways/bookings/scripts/whatsapp-templates.ts --write");
  assert.equal(checkedIn.length, (META_TEMPLATES.length + REPORT_TEMPLATES.length) * LANGUAGES.length);
  for (const entry of checkedIn) {
    const text: string = entry.components[0].text;
    assert.equal(entry.components[0].example.body_text[0].length, (text.match(/\{\{\d+\}\}/gu) ?? []).length);
  }
});

test("templateMessage: one matching message goes as its template with parameters; several together, or a message with no template, go as the generic name", () => {
  const facts = exampleFacts(settings, "en");
  const text = render("reminder", facts);
  const real = templateMessage({ ids: ["reminder"], language: "en", facts, text, generic: "booking_reminder" });
  assert.deepEqual(real, { name: "booking_reminder", language: "en", text, parameters: ["haircut", "Glow Salon", "Tue 10 Nov, 6:00 pm"] });
  const several = templateMessage({ ids: ["price_floor", "slot_and_link"], language: "en", facts, text: "x", generic: "booking_update" });
  assert.deepEqual(several, { name: "booking_update", language: "en", text: "x" });
  const none = templateMessage({ ids: ["hold_expired"], language: "en", facts, text: render("hold_expired", facts), generic: "booking_update" });
  assert.equal(none.parameters, undefined);
  // the text the check read must be what the template would say; if it is not, the generic name is used
  const different = templateMessage({ ids: ["reminder"], language: "en", facts, text: text + " Extra.", generic: "booking_update" });
  assert.deepEqual(different, { name: "booking_update", language: "en", text: text + " Extra." });
});

test("the agent sends a reminder outside the window as the real template with its values; the fake's outbox still shows the whole text", async () => {
  const w = createWorld();
  const seen: TemplateMessage[] = [];
  const send = w.messaging.sendTemplate;
  w.messaging.sendTemplate = (to, t) => { seen.push(t); return send(to, t); };
  await w.say("haircut tomorrow at 6pm");
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  await w.advance(24 * 60 + 5); // a day later: the customer's 24-hour window has closed, and the 24-hour reminder is due
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, "booking_reminder");
  assert.deepEqual(seen[0].parameters, ["haircut", "Glow Salon", "Wed 4 Nov, 6:00 pm"]);
  const outbox = w.messaging.sentTo(CUSTOMER).at(-1)!;
  assert.equal(outbox.kind, "template");
  assert.equal(outbox.text, fillBody(metaBody(META_TEMPLATES[0].bodies.en), seen[0].parameters!));
});
