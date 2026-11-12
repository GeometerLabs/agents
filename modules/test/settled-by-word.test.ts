// A refund a person settled by their word is told apart from one the payments service confirmed (follow-up 5, 12 Nov 2026; modules/report/settled-by-word.ts).
// The three templates' monthly reports read lines through these two functions. Written 12 Nov 2026, not run yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RecordEntry } from "../record/record.ts";
import { isSettledByWord, settledByWordOf } from "../report/settled-by-word.ts";
import { SETTLED_BY_SOMEONE, SETTLED_BY_WORD, settledByWordWords, settledWho } from "../report/text.ts";
import { LANGUAGES } from "../language/languages.ts";

let seq = 0;
const line = (outcome: RecordEntry["outcome"], refs: Record<string, string>, action: RecordEntry["action"] = "refund"): RecordEntry => {
  seq++;
  return { seq, time: new Date(Date.UTC(2026, 10, 12) + seq * 1000).toISOString(), conversation: "+919811111111", booking: "b-1", action, inputsDigest: "0123456789abcdef", outcome, decisions: [], language: "en", notes: "", refs } as RecordEntry;
};

test("a person's word is a confirmed refund line with confirmedBy and no provider refund id; anything else is not", () => {
  assert.equal(isSettledByWord(line("confirmed", { paymentId: "p1", amountPaise: "20000", confirmedBy: "operator:ravi" })), true);
  assert.equal(isSettledByWord(line("confirmed", { paymentId: "p1", amountPaise: "20000", refundId: "rfd_1" })), false, "the provider's list");
  assert.equal(isSettledByWord(line("confirmed", { paymentId: "p1", amountPaise: "20000", refundId: "rfd_1", eventId: "evt_1" })), false, "the provider's refund.done");
  assert.equal(isSettledByWord(line("unconfirmed", { paymentId: "p1", confirmedBy: "operator:ravi" })), false, "only a confirmed line");
  assert.equal(isSettledByWord(line("confirmed", { confirmedBy: "operator:ravi" }, "record_deposit")), false, "only a refund");
});

test("settlements by word are grouped by who said so, each payment once, sorted by who, and a line with no amount is noted", () => {
  seq = 0;
  const { rows, missingAmounts } = settledByWordOf([
    line("confirmed", { paymentId: "p1", amountPaise: "20000", confirmedBy: "operator:zara" }),
    line("confirmed", { paymentId: "p1", amountPaise: "20000", confirmedBy: "operator:zara" }), // the same payment again
    line("confirmed", { paymentId: "p2", amountPaise: "5000", confirmedBy: "operator:ravi" }),
    line("confirmed", { paymentId: "p3", confirmedBy: "operator:ravi" }),
    line("confirmed", { paymentId: "p4", amountPaise: "9900", refundId: "rfd_4" }), // the provider's: not here
  ]);
  assert.deepEqual(rows, [{ by: "operator:ravi", count: 2, paise: 5000 }, { by: "operator:zara", count: 1, paise: 20000 }]);
  assert.equal(missingAmounts, 1);
  assert.deepEqual(settledByWordOf([]), { rows: [], missingAmounts: 0 });
});

// ---- how the documents say it (12 Nov 2026): "Settled by <who>, by their word", and the WhatsApp words that give way to keep the message within the limit ----

test("who settled it reads as the person: Guard's operator: prefix goes, one line, at most 40 characters", () => {
  assert.equal(settledWho("operator:ravi"), "ravi");
  assert.equal(settledWho("ravi"), "ravi");
  assert.equal(settledWho("operator:asha\n  k"), "asha k");
  assert.equal(settledWho(`operator:${"x".repeat(60)}`), `${"x".repeat(39)}…`);
  assert.equal(SETTLED_BY_WORD.en("ravi"), "Settled by ravi, by their word");
  for (const language of LANGUAGES) assert.ok(SETTLED_BY_WORD[language]("ravi").includes("ravi") && SETTLED_BY_SOMEONE[language].length > 0, language);
});

test("the WhatsApp words: each person named (two, then 'and N more'); without names, with the totals; the count alone; or nothing, whichever is the longest that fits", () => {
  const more = (n: number) => `and ${n} more (see the full report)`;
  const rows = [{ by: "operator:ravi", count: 1, paise: 20_000 }, { by: "operator:asha", count: 2, paise: 40_000 }, { by: "operator:meena", count: 1, paise: 100 }];
  assert.equal(settledByWordWords(undefined, "en", more, () => true), undefined, "nobody settled anything: nothing is said");
  assert.equal(settledByWordWords([], "en", more, () => true), undefined);
  assert.equal(settledByWordWords(rows, "en", more, () => true), "Settled by ravi, by their word: 1 (₹200) · Settled by asha, by their word: 2 (₹400) · and 1 more (see the full report)");
  const named = settledByWordWords(rows, "en", more, () => true)!;
  assert.equal(settledByWordWords(rows, "en", more, (w) => w.length < named.length), "Settled by a person, by their word: 4 (₹601)", "the totals, nobody left out of the count");
  assert.equal(settledByWordWords(rows, "en", more, (w) => !w.includes("(")), "Settled by a person, by their word: 4");
  assert.equal(settledByWordWords(rows, "en", more, () => false), undefined, "a message that fitted without these words still fits: the full report names them");
});
