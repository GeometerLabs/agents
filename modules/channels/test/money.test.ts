// Money clarity (batch 4, 14 Nov 2026): the new money words exist in four languages (the three machine-written ones are not English), none uses a banned word, and none
// says the shop already has money it cannot see (a UPI payment is seen only by the owner, in their own UPI app); and the UPI box's script is small, fixed, and sends nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES } from "../../language/languages.ts";
import { CHECK_MINUTES, MONEY, OWNER_MONEY } from "../words-money.ts";
import { UPI_SCRIPT } from "../upi-script.ts";

const BANNED = /\b(safe|guaranteed|proves?|certified|100%|bot|earn|earning|income|leaderboard|streak|founder)\b/iu;
const textsOf = (language: (typeof LANGUAGES)[number]): string[] => {
  const m = MONEY[language];
  const o = OWNER_MONEY[language];
  return [
    m.copyId, m.copied, m.openChrome, m.chromeNote, m.refLabel, m.refHint, m.paid, m.claimed, m.checkTime(CHECK_MINUTES), m.failTitle, ...m.failTips, m.retry, m.lateTitle, m.lateNote, m.lateClaimed, m.lateRefund,
    o.saysPaid, o.waitingPay, o.waitingPayNote, o.lateHeading, o.lateNote, o.tagSaysPaid, o.tagLate, o.reference("b-1"), o.claimedAt("Mon 10:30"), o.upiRef("412345678901"), o.lateDeposit("Asha", "₹200", "haircut"), o.lateAfter,
    o.cashTitle, o.cashNote, o.cashRow("Rohan", "class 10"), o.cashButton("₹1,800"), o.bankButton("₹1,800"), o.cashPartLabel, o.cashPartButton,
  ];
};

test("the money words: every language has them all, the machine-written three are not English, and none is a banned word", () => {
  for (const language of LANGUAGES) {
    const texts = textsOf(language);
    assert.equal(texts.length, textsOf("en").length, language);
    for (const t of texts) { assert.ok(t.trim().length > 0, language); assert.doesNotMatch(t, BANNED, `${language}: ${t}`); }
    if (language !== "en") assert.notDeepEqual(texts, textsOf("en"), `${language} is translated`);
  }
  for (const language of ["hi", "ml", "kn"] as const) assert.equal(MONEY[language].failTips.length, 3, language);
});

test("a late payment is never said to be in the shop's hands: it is noted, and the shop will check it, then refund or book again", () => {
  assert.match(MONEY.en.lateClaimed, /noted/u);
  assert.match(MONEY.en.lateClaimed, /refund it or book you again/u);
  assert.doesNotMatch(MONEY.en.lateClaimed, /we have your (payment|money)|received/iu);
  assert.match(MONEY.en.failTips[0], /do not pay again/u, "a retry after the money left would pay twice, so the first tip says to look in the bank app first");
});

test("the UPI box's script reads two attributes, sends nothing, and reloads only when what the page says has changed", () => {
  assert.ok(UPI_SCRIPT.length < 1_400, "small");
  assert.doesNotMatch(UPI_SCRIPT, /XMLHttpRequest|sendBeacon|WebSocket|method:\s*"POST"|document\.cookie|localStorage|eval\(|innerHTML|document\.write/u);
  assert.match(UPI_SCRIPT, /fetch\(url,\{cache:"no-store",credentials:"same-origin"\}\)/u, "only a GET of the page's own address");
  assert.match(UPI_SCRIPT, /location\.reload\(\)/u);
  assert.match(UPI_SCRIPT, /Android/u, "open in Chrome is shown on Android only");
});
