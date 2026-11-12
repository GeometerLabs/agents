// The shop's assistant's words (item 11e, modules/assistant/words.ts and templates.ts): every message in every language passes the outgoing check over the values it
// states, the card buttons fit WhatsApp's limits, and the three templates' text is exactly the approved body filled in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkText } from "../../language/check.ts";
import { LANGUAGES } from "../../language/languages.ts";
import { LIMITS } from "../../language/interactive.ts";
import { fillBody, metaBody } from "../../language/meta-templates.ts";
import { APPROVAL_LABELS } from "../../approvals/buttons.ts";
import { CARD_LABELS, write } from "../words.ts";
import type { MessageData, MessageId } from "../words.ts";
import { assistantCatalogue, assistantSubmissions, dayFacts, morningFacts, render, templateMessageFor } from "../templates.ts";
import type { PrepareRefusal } from "../skill.ts";

const TZ = "Asia/Kolkata";
const SUN = { year: 2026, month: 11, day: 15 };
const AT_4PM = Date.UTC(2026, 10, 15, 10, 30); // 4:00 pm in India
const rows = [{ case: "b-14", startMs: AT_4PM, what: "Haircut", who: "Priya", state: "confirmed" }];
const SAMPLES: { [K in MessageId]: MessageData[K][] } = {
  day_list: [{ date: SUN, rows, closed: false }, { date: SUN, rows: [], closed: true }],
  owes_list: [{ rows: [{ case: "f-3", who: "Arjun", what: "November", amountPaise: 150_000 }] }, { rows: [] }],
  open_list: [{ rows: [{ case: "o-5", who: "Ravi", what: "2 boxes", amountPaise: 480_000, state: "confirmed" }] }, { rows: [] }],
  waiting_head: [{ count: 2 }, { count: 0 }],
  money_in: [{ date: SUN, paise: 140_000, payments: 3 }, { date: SUN, paise: 0, payments: 0 }],
  closed: [{ date: SUN, asked: 2 }, { date: SUN, asked: 0 }],
  already_closed: [{ date: SUN }], weekday_closed: [{ date: SUN }], not_closed: [{ date: SUN }], reopened: [{ date: SUN, told: 2 }, { date: SUN, told: 0 }], past_day: [{ date: SUN }],
  undo_none: [{}],
  need_ref: [{ kind: "cancel", rows }, { kind: "message", rows: [] }, { kind: "refund", rows }],
  need_date: [{ kind: "close_day" }, { kind: "reopen_day" }],
  need_words: [{ ref: "b-14" }],
  refusal: (["no_case", "not_yours", "not_live", "not_booked", "already_back", "cancel_first", "nothing_paid", "too_much", "nothing_waiting", "no_window", "opted_out", "amount_not_on_record", "busy", "not_here"] as PrepareRefusal[])
    .map((why) => ({ why, ref: "b-14", who: "Priya", paidPaise: 20_000 })),
  card: [
    { kind: "cancel", who: "Priya", ref: "b-14", what: "Haircut, Sun 15 Nov, 4:00 pm", amountPaise: 20_000, code: "K7M2QX", hasNo: true },
    { kind: "cancel", who: "Priya", ref: "b-14", what: "Haircut", amountPaise: 0, code: "K7M2QX", hasNo: true },
    { kind: "refund", who: "Priya", ref: "b-14", what: "Haircut", amountPaise: 120_000, aboveLimit: true, code: "K7M2QX", hasNo: true },
    { kind: "message", who: "Priya", ref: "b-14", what: "Haircut", amountPaise: 0, words: "Running 15 minutes late", code: "K7M2QX", hasNo: true },
    ...["late_refund", "calendar", "deposit", "refund_owed", "waiver", "refund_request", "big_order"].map((itemKind) => ({ kind: "answer", itemKind, who: "Priya", ref: "b-14", what: "Haircut", amountPaise: 20_000, code: "K7M2QX", hasNo: itemKind !== "deposit" })),
  ],
  done: (["cancelled", "refund_sent", "held_by_guard", "owed_by_owner", "sent", "answered", "failed", "not_sent"] as const).map((note) => ({ note, who: "Priya", ref: "b-14", amountPaise: 20_000 })),
  refused: [{}], refused_before: [{ atMs: AT_4PM }], card_changed: [{}], card_closed: [{}], card_expired: [{}], card_unknown: [{}], limit_no: [{}],
  help: [{ name: "Mithra", shop: "Glow Salon", kinds: ["day", "waiting", "money", "close_day", "cancel", "message", "undo", "owes", "open_orders"] }],
  not_understood: [{ kinds: ["day", "waiting", "close_day"] }], not_offered: [{}], voice_unheard: [{}],
  owner_words: [{ shop: "Glow Salon", words: "Running 15 minutes late, sorry!" }],
};

test("every message, in every language, states only the values it was written from", () => {
  for (const language of LANGUAGES) {
    for (const [id, list] of Object.entries(SAMPLES) as [MessageId, MessageData[MessageId][]][]) {
      for (const data of list) {
        const { text, facts } = write(id, data as never, language, TZ);
        assert.ok(text.trim().length > 0, `${id} ${language}`);
        const check = checkText(text, facts);
        assert.ok(check.ok, `${id} (${language}): ${check.problems.join(" ")}\n${text}`);
      }
    }
  }
});

test("a stray number in the words fails the check, so it would not be sent", () => {
  const { text, facts } = write("closed", { date: SUN, asked: 2 }, "en", TZ);
  assert.equal(checkText(`${text} Call 98765.`, facts).ok, false);
  assert.equal(checkText(text.replace("Sun 15 Nov", "Mon 16 Nov"), facts).ok, false);
});

test("a card shows the amount it carries, and the code to type", () => {
  const { text } = write("card", { kind: "refund", who: "Priya", ref: "b-14", what: "Haircut", amountPaise: 120_000, code: "K7M2QX", hasNo: true }, "en", TZ);
  assert.match(text, /^Refund ₹1,200 to Priya for b-14\?/u);
  assert.match(text, /yes K7M2QX or no K7M2QX/u);
});

test("the buttons fit WhatsApp's limits in every language", () => {
  for (const language of LANGUAGES) {
    for (const label of [...Object.values(CARD_LABELS[language]), ...Object.values(APPROVAL_LABELS[language])]) assert.ok([...label].length <= LIMITS.buttonTitle, `${language}: ${label}`);
  }
});

test("the three templates: the text is the approved body filled in, it passes its check, and outside the window it goes under its own name", () => {
  for (const language of LANGUAGES) {
    const morning = morningFacts({ language, timeZone: TZ, shop: "Glow Salon", name: "Mithra", today: SUN, parts: [{ bookings: 6, firstMs: AT_4PM }, { owes: 3, owedPaise: 450_000 }, { open: 2 }], moneyPaise: 140_000, waiting: 2 });
    const quiet = morningFacts({ language, timeZone: TZ, shop: "Glow Salon", name: "Mithra", today: SUN, parts: [{ bookings: 0 }], moneyPaise: 0, waiting: 0 });
    const day = dayFacts({ language, timeZone: TZ, shop: "Glow Salon", date: SUN, startMs: AT_4PM });
    for (const [id, facts] of [["morning", morning], ["morning", quiet], ["day_closed", day], ["day_open", day]] as const) {
      const text = render(id, facts);
      assert.ok(checkText(text, facts.check).ok, `${id} ${language}: ${checkText(text, facts.check).problems.join(" ")}`);
      const message = templateMessageFor(id, facts, text);
      const template = assistantCatalogue.templates.find((t) => t.usedFor === id)!;
      assert.equal(message.name, template.name);
      assert.equal(fillBody(metaBody(template.bodies[language]), message.parameters ?? []), text);
      assert.ok(!(message.parameters ?? []).some((p) => p.includes("\n")), "a template value has no line break");
    }
  }
  const submissions = assistantSubmissions();
  assert.equal(submissions.length, 3 * LANGUAGES.length);
  assert.deepEqual([...new Set(submissions.map((s) => s.name))].sort(), ["booking_day_closed", "booking_day_open", "owner_morning"]);
  for (const s of submissions) assert.match(s.components[0].text, /^[^{].*[^}]$/su, "a body neither starts nor ends with a value");
});
