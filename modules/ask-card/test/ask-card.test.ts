// The "What to ask the shop for" card (B72): one list, every template and language complete, none of the banned words, no promise of "no documents" or "one visit", the
// WhatsApp login line in every card, Google Calendar marked optional, the machine-written marker on Hindi, Malayalam and Kannada, and the card files equal to what the
// renderer makes (so the card on paper cannot drift from the list the panel reads).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../../language/languages.ts";
import { bannedIn } from "../../report/claims.ts";
import { CARD_TEMPLATES, HEADS, INTRO, LIST, NOTE, OPTIONAL_LABEL, TEMPLATE_NAMES, TITLE } from "../list.ts";
import { REPO, askCardFor, askCardRows, cardFiles, cardPath, renderMarkdown, staleCards } from "../render.ts";

const TRANSLATED = LANGUAGES.filter((l) => l !== "en");
/** Words no site-like copy may use (the owner's list), as whole words in the English text. */
const SITE_BANNED = [/\bearn/i, /\bincome\b/i, /side hustle/i, /\bpassive\b/i, /\bbot\b/i, /leaderboard/i, /\bstreak/i, /\bfounder/i];
/** A promise the facts file says we must not make (docs/research/2026-11-11-whatsapp-onboarding-facts.md). */
const PROMISE = /\bno documents\b|\bone visit\b|\bno paperwork\b|\bwithout (any )?documents\b/i;

test("the list has a card for each of its templates (that these are the bundle's templates is checked in bundle/test/ask-card.test.ts)", () => {
  assert.deepEqual(Object.keys(LIST).sort(), [...CARD_TEMPLATES].sort());
});

test("every template has every language, and every item has all four languages with non-empty text", () => {
  for (const t of CARD_TEMPLATES) {
    assert.ok(LIST[t].length >= 6, `${t}: the card is not empty`);
    assert.equal(new Set(LIST[t].map((i) => i.id)).size, LIST[t].length, `${t}: item ids are unique`);
    for (const item of LIST[t]) {
      for (const l of LANGUAGES) {
        assert.ok(item.what[l].trim().length > 5, `${t}.${item.id}.what.${l} is empty`);
        assert.ok(item.why[l].trim().length > 5, `${t}.${item.id}.why.${l} is empty`);
      }
    }
    for (const l of LANGUAGES) {
      const card = askCardFor(t, l);
      assert.equal(card.language, l);
      assert.ok(card.title.includes(TEMPLATE_NAMES[t][l]) && card.title.includes(TITLE[l]));
      assert.equal(card.items.length, LIST[t].length);
      for (const part of [card.intro, card.note, card.heads.always, card.heads.template, card.optionalLabel]) assert.ok(part.trim().length > 0, `${t}.${l}: a part of the card is empty`);
    }
  }
  for (const words of [TITLE, INTRO, NOTE, OPTIONAL_LABEL, HEADS.always, HEADS.template, ...Object.values(TEMPLATE_NAMES)]) for (const l of LANGUAGES) assert.ok(words[l].trim().length > 0);
});

test("a translated item is really translated, not the English copied", () => {
  for (const t of CARD_TEMPLATES) for (const item of LIST[t]) for (const l of TRANSLATED) assert.notEqual(item.what[l], item.what.en, `${t}.${item.id}.what.${l} is the English`);
});

test("every card has the always-asked items: UPI ID, shop number, owner's phone, the WhatsApp (Facebook) login, the public name and the verification line", () => {
  for (const t of CARD_TEMPLATES) {
    const ids = askCardFor(t, "en").items.map((i) => i.id);
    for (const id of ["upi", "shop-whatsapp", "owner-phone", "meta-login", "public-name", "verification"]) assert.ok(ids.includes(id), `${t}: ${id} is on the card`);
    for (const l of LANGUAGES) {
      const login = askCardFor(t, l).items.find((i) => i.id === "meta-login")!;
      assert.ok(login.what.includes("Facebook") && login.what.includes("Meta"), `${t}.${l}: the login line names Facebook and Meta`);
      assert.equal(login.group, "always");
      assert.equal(login.optional, false, "the WhatsApp login is not optional");
    }
  }
});

test("the card never promises 'no documents' or 'one visit', and says the verification question is open", () => {
  for (const t of CARD_TEMPLATES) {
    for (const l of LANGUAGES) {
      const card = askCardFor(t, l);
      const all = [card.title, card.intro, card.note, ...card.items.flatMap((i) => [i.what, i.why])].join("\n");
      assert.ok(!PROMISE.test(all), `${t}.${l}: a promise the facts file forbids`);
    }
    const v = askCardFor(t, "en").items.find((i) => i.id === "verification")!;
    assert.ok(/not confirmed/.test(v.why) && /verify/.test(v.what), "the verification line says Meta may ask and that the documents are not confirmed");
  }
});

test("no banned word in any card, in any language (the report's own list), and none of the site-copy words in English", () => {
  for (const t of CARD_TEMPLATES) {
    for (const l of LANGUAGES) {
      const text = renderMarkdown(askCardFor(t, l));
      assert.deepEqual(bannedIn(text, l), [], `${t}.${l}`);
      for (const re of SITE_BANNED) assert.ok(!re.test(text), `${t}.${l}: ${re}`);
    }
    const english = renderMarkdown(askCardFor(t, "en"));
    assert.ok(!/communal/i.test(english));
    assert.ok(!/@/.test(english.replace(/<!--[\s\S]*?-->/g, "")), "no contact address on the card: the public one is hello@geometer.dev and it is not needed here");
  }
});

test("no price and no percentage on the card (a price is written in prices/ only)", () => {
  for (const t of CARD_TEMPLATES) for (const l of LANGUAGES) assert.ok(!/₹|\d\s?%/.test(renderMarkdown(askCardFor(t, l))), `${t}.${l}`);
});

test("Google Calendar is optional and only on Bookings; Razorpay and the shop's own Gupshup account (11c) are optional everywhere; nothing else is", () => {
  const bookings = askCardFor("bookings", "en").items;
  const calendar = bookings.find((i) => i.id === "calendar")!;
  assert.equal(calendar.optional, true);
  assert.ok(/only if the shop wants it/.test(calendar.what), "the condition is in the text");
  assert.ok(/own booking list/.test(calendar.why) && /"today"/.test(calendar.why) && /"tomorrow"/.test(calendar.why), "it says what runs without a calendar");
  assert.ok(renderMarkdown(askCardFor("bookings", "en")).includes(`(${OPTIONAL_LABEL.en}) Google Calendar`), "the Markdown marks it");
  for (const l of LANGUAGES) assert.ok(askCardFor("bookings", l).items.find((i) => i.id === "calendar")!.optional);
  for (const t of ["orders", "fees"] as const) assert.ok(!askCardFor(t, "en").items.some((i) => i.id === "calendar"), `${t}: no calendar on the card`);
  for (const t of CARD_TEMPLATES) {
    const optional = askCardFor(t, "en").items.filter((i) => i.optional).map((i) => i.id).sort();
    assert.deepEqual(optional, ({ bookings: ["calendar", "gupshup-account", "razorpay"], orders: ["delivery-area", "gupshup-account", "razorpay"], fees: ["gupshup-account", "razorpay"] })[t]);
  }
});

test("each template asks what its own settings ask, and nothing the code no longer needs", () => {
  const ids = (t: (typeof CARD_TEMPLATES)[number]) => askCardFor(t, "en").items.filter((i) => i.group === "template").map((i) => i.id);
  // item 11d: the booking page is on the card too (nothing to ask for, but the partner should know the shop has it from day one)
  assert.deepEqual(ids("bookings"), ["services", "hours", "deposit", "hold-time", "cancellation", "refund-limit", "calendar", "booking-page"]);
  assert.deepEqual(ids("orders"), ["menu", "cutoff", "slots", "delivery-area", "advance", "day-limits", "cancellation", "refund-limit", "approval-line"]);
  assert.deepEqual(ids("fees"), ["students", "class-fee", "due-day", "late-fee", "reminders", "part-payments", "waiver-limit", "refund-limit"]);
  // The card carries no price at all, so Razorpay's fee cannot be on it.
  for (const t of CARD_TEMPLATES) for (const l of LANGUAGES) assert.ok(!/platform fee|GST/i.test(renderMarkdown(askCardFor(t, l))));
});

test("Hindi, Malayalam and Kannada carry the machine-written marker, in the data and in the Markdown; English does not", () => {
  // that CARD_REVIEW_STATE is the panel's REVIEW_STATE is checked in bundle/test/ask-card.test.ts (a shared module's test imports no bundle code)
  for (const t of CARD_TEMPLATES) {
    for (const l of TRANSLATED) {
      const card = askCardFor(t, l);
      assert.equal(card.review, "machine-written");
      assert.ok(card.reviewBanner.length >= 2 && /Machine-written/.test(card.reviewBanner[0]) && /native speaker/.test(card.reviewBanner[0]));
      assert.ok(renderMarkdown(card).split("\n").slice(0, 6).join("\n").includes("Machine-written"), `${t}.${l}: the banner is at the top of the file`);
    }
    const en = askCardFor(t, "en");
    assert.equal(en.review, "source");
    assert.deepEqual(en.reviewBanner, []);
    assert.ok(!/Machine-written/.test(renderMarkdown(en)));
  }
});

test("the review rows cover every line of the card in Malayalam and Kannada, with their English", () => {
  for (const l of ["ml", "kn"] as const) {
    const rows = askCardRows(l);
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, "unique ids");
    for (const r of rows) assert.ok(r.text.trim() && r.english.trim(), r.id);
    for (const t of CARD_TEMPLATES) for (const i of LIST[t]) {
      const what = rows.find((r) => r.id === `askcard.${t}.${i.id}.what`);
      assert.deepEqual([what?.text, what?.english], [i.what[l], i.what.en]);
    }
  }
});

test("the card files are exactly what the renderer makes (run node modules/ask-card/render.ts after a change to the list)", () => {
  assert.deepEqual(staleCards(), []);
  assert.equal(cardFiles().length, CARD_TEMPLATES.length * LANGUAGES.length);
  for (const t of CARD_TEMPLATES) for (const l of LANGUAGES) assert.equal(readFileSync(`${REPO}/${cardPath(t, l)}`, "utf8"), renderMarkdown(askCardFor(t, l)));
});

test("each card sits beside its template's sell guide, and the guide points at it", () => {
  for (const t of CARD_TEMPLATES) for (const l of LANGUAGES) {
    const path = cardPath(t, l);
    assert.ok(path.endsWith(`/sell/ask-card.${l}.md`));
    const guide = readFileSync(`${REPO}/${path.replace(/ask-card\.\w+\.md$/, `guide.${l}.md`)}`, "utf8");
    assert.ok(guide.includes(`ask-card.${l}.md`), `${t}.${l}: the sell guide names the card`);
  }
});
