// Item 11h, in the Fees agent itself (the in-memory harness): the parent's private link in the reminder. One link per parent, made in the step and saved as a hash;
// the same link while it is the saved one; a centre without a page sends the reminder it always sent; the wording fits WhatsApp's 1,024 characters in every language
// with long names; and the outgoing check lets this parent's page link through and nothing else. The end-to-end test (channels.test.ts) opens the pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { parentLinkHash } from "../../../../modules/channels/handle.ts";
import { ROHAN_PARENT, SHARMA_PARENT, brightTuition, createWorld } from "../src/harness.ts";
import { render } from "../src/language/templates.ts";
import type { MessageFacts } from "../src/language/templates.ts";
import { checkMessage } from "../src/language/check.ts";
import { META_TEMPLATES } from "../src/language/meta-templates.ts";

const BASE = "https://pages.example/bright-tuition";
const LINK = /https:\/\/pages\.example\/bright-tuition\/f\/([A-Za-z0-9_-]{32})/u;

test("with a page, each parent's reminder carries their own private link, the same for both of a parent's children, and only its hash is kept", async () => {
  const w = createWorld({ pageBase: () => BASE });
  await w.goto({ year: 2026, month: 11, day: 2 }, { hour: 10, minute: 0 });
  const sharma = w.textsTo(SHARMA_PARENT).map((t) => LINK.exec(t)?.[1]);
  assert.equal(sharma.length, 2);
  assert.ok(sharma[0] && sharma[0] === sharma[1], "one link for the parent, in both children's reminders");
  const rohan = LINK.exec(w.lastTextTo(ROHAN_PARENT))?.[1];
  assert.ok(rohan && rohan !== sharma[0], "another parent's link is another link");
  assert.match(w.lastTextTo(ROHAN_PARENT), /See your children's fees on your private page: .* Please do not share it\./u);
  assert.equal(w.store.parentLinks![SHARMA_PARENT].hash, parentLinkHash(sharma[0]!), "the saved state has the hash");
  assert.ok(!JSON.stringify(w.store).includes(sharma[0]!), "and never the link");
  assert.ok(!JSON.stringify(w.record.entries()).includes(sharma[0]!), "nor does the record");
  assert.equal(w.record.entries().filter((e) => e.action === "parent_link").length, 4, "one line per parent whose link went out (four parents)");

  // the due day's reminder: the same link (it is still the saved one), and no new record line
  await w.goto({ year: 2026, month: 11, day: 5 }, { hour: 10, minute: 0 });
  assert.equal(LINK.exec(w.lastTextTo(ROHAN_PARENT))?.[1], rohan, "the link does not change with every reminder");
  assert.equal(w.record.entries().filter((e) => e.action === "parent_link").length, 4);
});

test("without a page, the reminder is the one it always was: no link, no new template, nothing kept", async () => {
  const w = createWorld();
  await w.goto({ year: 2026, month: 11, day: 2 }, { hour: 10, minute: 0 });
  const text = w.lastTextTo(ROHAN_PARENT);
  assert.doesNotMatch(text, /\/f\/|private page/u);
  assert.match(text, /^Fee reminder from /u);
  assert.equal(w.store.parentLinks, undefined);
  const sent = w.record.entries().filter((e) => e.action === "send_message" && e.conversation === ROHAN_PARENT);
  assert.ok(sent.every((e) => !String(e.refs.templates).includes("_page")), "the reminder's own template, as before");
});

test("the reminders with the link fit WhatsApp's 1,024 characters in every language with long names and a UPI link, and the outgoing check allows this link only", () => {
  const long = "Sree Saraswathi Vidya Niketan Tuition and Coaching Centre"; // 57 characters
  const page = `${BASE}/f/${"A".repeat(32)}`;
  for (const language of LANGUAGES) {
    const facts: MessageFacts = {
      language, timeZone: "Asia/Kolkata", businessName: long, studentName: "Anantha Padmanabhan Venkataraman Iyer", batchName: "Class 10 State Board Mathematics", monthLabel: "November 2026",
      feeInr: 12_500, lateFeeInr: 500, balanceInr: 13_000, dueMs: Date.UTC(2026, 10, 4, 18, 30),
      link: "upi://pay?pa=sreesaraswathividyaniketan@okhdfcbank&pn=Sree%20Saraswathi%20Vidya%20Niketan&am=13000.00&tn=f-123.4&cu=INR", upiId: "sreesaraswathividyaniketan@okhdfcbank", payee: "Sree Saraswathi Vidya Niketan",
      pageLink: page,
    };
    for (const id of ["fee_reminder_page", "fee_overdue_page", "fee_overdue_late_page", "fee_page_link"] as const) {
      const text = render(id, facts);
      assert.ok(text.length <= 1_024, `${id} in ${language} is ${text.length} characters`);
      assert.ok(checkMessage(text, facts).ok, `${id} in ${language} passes the outgoing check: ${checkMessage(text, facts).problems.join(" ")}`);
      assert.equal(checkMessage(text.replace(page, `${BASE}/f/${"B".repeat(32)}`), facts).ok, false, `${id} in ${language}: another parent's link is refused`);
    }
  }
  const settings = brightTuition();
  assert.ok(settings.languages.length > 0);
  for (const t of META_TEMPLATES.filter((x) => x.usedFor.endsWith("_page") || x.usedFor === "fee_page_link")) {
    for (const language of LANGUAGES) {
      const body = t.bodies[language];
      assert.ok(!/^\{/u.test(body) && !/\}$/u.test(body.trim()), `${t.name} (${language}) starts and ends with fixed words, as Meta asks`);
      assert.match(body, /\{page\}/u, `${t.name} (${language}) carries the page as a parameter`);
    }
  }
});
