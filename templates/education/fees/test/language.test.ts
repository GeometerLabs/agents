// The words: every message the Fees agent can send exists in all four languages, passes the outgoing check against a full set of facts, and says only what the facts
// hold; the buttons fit Meta's limits; the sentences the scripted parents write are read as what they mean; and the WhatsApp templates are the messages themselves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatInr } from "../../../../modules/language/format.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { LIMITS, interactiveProblem } from "../../../../modules/language/interactive.ts";
import { createWorld } from "../src/harness.ts";
import { parseIntent } from "../src/adapters/rule-parser.ts";
import { checkMessage } from "../src/language/check.ts";
import { LABELS, buttonsFor, intentFromReply } from "../src/language/interactive.ts";
import { reportSubmissions } from "../report/whatsapp.ts";
import { META_TEMPLATES, exampleFacts, fillBody, metaBody, metaSubmissions, parametersFor, slotsOf, templateMessage } from "../src/language/meta-templates.ts";
import { TEMPLATES, render } from "../src/language/templates.ts";
import type { TemplateId } from "../src/language/templates.ts";
import { brightTuition } from "../src/harness.ts";
import { SAYS } from "../crash-test/says.ts";

const settings = brightTuition();
const IDS = Object.keys(TEMPLATES.en) as TemplateId[];

test("every message exists in all four languages, and a language cannot have fewer", () => {
  assert.ok(IDS.length >= 50, `${IDS.length} messages`);
  for (const language of LANGUAGES) assert.deepEqual(Object.keys(TEMPLATES[language]).sort(), [...IDS].sort(), language);
});

test("every message, in every language, passes the outgoing check against the record's facts and carries no value the record does not hold", () => {
  for (const language of LANGUAGES) {
    const facts = exampleFacts(settings, language);
    for (const id of IDS) {
      const text = render(id, facts);
      const result = checkMessage(text, facts);
      assert.ok(result.ok, `${language} ${id}: ${result.problems.join(" ")}\n${text}`);
      assert.ok(!/undefined|NaN|\[object/u.test(text), `${language} ${id} has a hole in it: ${text}`);
    }
  }
});

test("a message that states an amount, a date, a link or a reference the record does not hold is stopped by the check", () => {
  const facts = exampleFacts(settings, "en");
  const text = render("fee_reminder", facts);
  assert.equal(checkMessage(text, facts).ok, true);
  assert.equal(checkMessage(text.replace(formatInr(facts.balanceInr!), formatInr(facts.balanceInr! - 300)), facts).ok, false, "another amount");
  assert.equal(checkMessage(text.replace("5 Nov", "6 Nov"), facts).ok, false, "another date");
  assert.equal(checkMessage(text.replace(facts.link!, "https://evil.example/pay"), facts).ok, false, "another link");
  assert.equal(checkMessage(`${text} Pay 12 more.`, facts).ok, false, "a number the record does not hold");
});

test("a template that needs a value the record lacks is not written at all", () => {
  const facts = { ...exampleFacts(settings, "en"), link: undefined };
  assert.throws(() => render("fee_reminder", facts), /needs "link"/);
});

test("the buttons fit WhatsApp's limits in every language, and a tap is read by its id: no words, no model", () => {
  for (const language of LANGUAGES) {
    const buttons = buttonsFor(language, ["pay", "paid", "owner"], "f-12");
    assert.equal(interactiveProblem({ body: "x", buttons }), null, language);
    for (const b of buttons) assert.ok([...b.title].length <= LIMITS.buttonTitle, `${language} ${b.title}`);
    assert.deepEqual(buttons.map((b) => b.id), ["pay:f-12", "paid:f-12", "owner"]);
    const labels = Object.values(LABELS[language]);
    assert.ok(labels.every((l) => !/\d/u.test(l)), "no number in a label");
  }
  assert.deepEqual(intentFromReply("pay:f-12"), { kind: "pay", dueId: "f-12" });
  assert.deepEqual(intentFromReply("paid:f-3"), { kind: "paid", dueId: "f-3" });
  assert.deepEqual(intentFromReply("owner"), { kind: "owner" });
  assert.equal(intentFromReply("pay:f-12; drop"), null, "an id that is not ours is read as words");
  assert.equal(intentFromReply("svc:haircut"), null);
});

test("the sentences the scripted parents write are read as what they mean, in every language", () => {
  for (const language of LANGUAGES) {
    const says = SAYS[language];
    const ctx = { languages: [...LANGUAGES] };
    const kind = (text: string) => parseIntent(text, ctx);
    assert.equal(kind(says.paid).kind, "paid", `${language} paid`);
    assert.equal(kind(says.discount).kind, "discount", `${language} discount`);
    assert.equal(kind(says.discount).amountInr, undefined);
    assert.deepEqual([kind(says.discountOff(300)).kind, kind(says.discountOff(300)).amountInr], ["discount", 300], `${language} discountOff`);
    assert.equal(kind(says.push).kind, "discount", `${language} push`);
    assert.deepEqual([kind(says.refund(4500)).kind, kind(says.refund(4500)).amountInr], ["refund", 4500], `${language} refund`);
    assert.equal(kind(says.pay).kind, "pay", `${language} pay`);
    assert.equal(kind(says.trick).overrideAttempt, true, `${language} trick`);
    assert.equal(kind(says.owner).kind, "owner", `${language} owner`);
    assert.equal(kind(says.hello).kind, "greeting", `${language} hello`);
    assert.equal(kind("STOP").kind, "stop");
    assert.equal(kind(says.paid).language, language, `${language} is detected`);
  }
  assert.equal(parseIntent("I have not paid yet", { languages: ["en"] }).kind, "pay", "\"not paid yet\" is not a claim of payment");
  assert.equal(parseIntent("I already paid, not yet received", { languages: ["en"] }).kind, "paid");
  assert.equal(parseIntent("asdf qwer zxcv", { languages: ["en"] }).kind, "unknown");
});

test("the WhatsApp templates are the messages themselves: each starts and ends with fixed words, and filled in gives back the very text the check read", () => {
  assert.ok(META_TEMPLATES.length >= 12);
  for (const t of META_TEMPLATES) {
    for (const language of LANGUAGES) {
      const body = t.bodies[language];
      assert.ok(!/^\s*\{/u.test(body) && !/\}\s*$/u.test(body), `${t.name} ${language} starts or ends with a value: ${body}`);
      const facts = exampleFacts(settings, language);
      const filled = fillBody(metaBody(body), parametersFor(t, language, facts));
      assert.equal(filled, render(t.usedFor, facts), `${t.name} ${language}`);
      assert.deepEqual(slotsOf(body).length, (metaBody(body).match(/\{\{\d+\}\}/g) ?? []).length);
      assert.ok([...body].length <= 1024, `${t.name} ${language} is too long`);
    }
  }
  const facts = exampleFacts(settings, "hi");
  const message = templateMessage({ ids: ["fee_reminder"], language: "hi", facts, text: render("fee_reminder", facts), generic: "fee_reminder_notice" });
  assert.equal(message.name, "fee_reminder");
  assert.ok(message.parameters && message.parameters.length === 7);
  assert.equal(templateMessage({ ids: ["fee_menu"], language: "hi", facts, text: render("fee_menu", facts), generic: "fee_update" }).name, "fee_update", "a message with no template of its own goes as the generic one");
  assert.equal(metaSubmissions(settings).length, META_TEMPLATES.length * LANGUAGES.length);
});

test("the list to submit to Meta (whatsapp-templates.json) is the one the code makes", () => {
  const committed = JSON.parse(readFileSync(new URL("../whatsapp-templates.json", import.meta.url), "utf8")) as unknown;
  assert.deepEqual(committed, [...metaSubmissions(settings), ...reportSubmissions()], "run: node templates/education/fees/scripts/whatsapp-templates.ts");
});

test("each reminder reaches the parent in their own language, and the check read it", async () => {
  const w = createWorld();
  await w.tick();
  await w.advance(61);
  for (const [student, phone, marker] of [["Aarav Sharma", "+919811111111", "फीस की याद"], ["Meera Nair", "+919822222222", "ഫീസ് ഓർമ്മപ്പെടുത്തൽ"], ["Kiran Gowda", "+919833333333", "ಶುಲ್ಕದ ನೆನಪು"], ["Rohan Mehta", "+919844444444", "Fee reminder from"]] as const) {
    assert.ok(w.textsTo(phone).some((t) => t.includes(marker) && t.includes(student.split(" ")[0])), `${student}: ${w.textsTo(phone)[0]}`);
  }
  assert.equal(w.textsTo("+919811111111").length, 2, "the Sharma family has two children, and two reminders (one for each)");
  assert.ok(w.record.entries().every((e) => e.action !== "send_message" || e.outcome === "confirmed"), "none was held back by the check");
});
