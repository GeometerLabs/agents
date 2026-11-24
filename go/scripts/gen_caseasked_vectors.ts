// Writes go/internal/runtime/testdata/caseasked-vectors.json: what modules/record/case-asked.ts reads out of a message (the case it names, and how), the keys it takes from a
// record, and its hourly limit, for go/internal/runtime/caseasked.go to be proved equal (caseasked_test.go). Run with node from the repository root:
//   node go/scripts/gen_caseasked_vectors.ts        (add --check to only compare with the committed file)
// The words below are the forms a customer writes a reference in, in four languages, and the near misses that must name nothing ("booking 3 pm" when the word form is
// not allowed, a reference the shop does not hold, a short id, a receipt of another year).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CASE_ASKED, namedCase, recordKeys, tokensOf, toldLately } from "../../modules/record/case-asked.ts";
import type { CaseForms } from "../../modules/record/case-asked.ts";
import type { RecordEntry } from "../../modules/record/record.ts";

const OUT = new URL("../internal/runtime/testdata/caseasked-vectors.json", import.meta.url);

const entry = (seq: number, time: string, conversation: string, booking: string | null, action: string, outcome: string, refs: Record<string, string>): RecordEntry =>
  ({ seq, time, conversation, booking, action, inputsDigest: "", outcome, decisions: [], language: "en", notes: "", refs }) as unknown as RecordEntry;

// a shop's record: payments, a receipt, link references, and lines of other cases and of no case
const entries: RecordEntry[] = [
  entry(1, "2026-11-03T06:00:00.000Z", "+919811111111", "b-3", "receive_payment_event", "confirmed", { paymentId: "pay_Qz9AbC12345678", eventId: "evt_1" }),
  entry(2, "2026-11-03T06:00:01.000Z", "+919811111111", "b-3", "record_deposit", "confirmed", { doc: "RCT/26-27/0007", amountPaise: "20000" }),
  entry(3, "2026-11-04T06:00:00.000Z", "+919822222222", "f-4", "create_fee_link", "confirmed", { reference: "f-4.2", linkId: "plink_1" }),
  entry(4, "2026-11-04T06:00:00.000Z", "+919833333333", "o-5", "create_balance_link", "confirmed", { reference: "o-5.b", linkId: "plink_2" }),
  entry(5, "2026-11-05T06:00:00.000Z", "+919844444444", null, "receive_message", "confirmed", { messageId: "m-1", paymentId: "pay_NoCase000000" }),
  entry(6, "2026-11-05T06:00:00.000Z", "+919811111111", "b-9", "refund", "confirmed", { paymentId: "upi-pay-2", doc: "CN/26-27/0001" }),
];
const holds = new Set(["b-3", "b-12", "f-4", "o-5", "b-9"]);
const extra: [string, string][] = [["412345678901", "b-12"]]; // a UPI reference a customer typed on b-12's page
const keys = new Map([...recordKeys(entries), ...extra]);

const forms: Record<string, CaseForms> = {
  bookings: { prefix: "b", words: ["booking", "बुकिंग", "ബുക്കിംഗ്", "ಬುಕಿಂಗ್"] },
  orders: { prefix: "o", words: ["order", "ऑर्डर", "ഓർഡർ", "ಆರ್ಡರ್"] },
  fees: { prefix: "f", words: ["fee", "fees", "फीस", "ഫീസ്", "ಶುಲ್ಕ"] },
};

const texts = [
  "what about b-3?", "B3 please", "my booking B-3", "b#3", "b 3", "booking 3", "booking no 3", "Booking number 12 status", "booking 3 pm", "booking at 3",
  "बुकिंग 3 का क्या हुआ", "बुकिंग नंबर १२", "ബുക്കിംഗ് 3 എന്തായി", "ಬುಕಿಂಗ್ ೩", "b-03", "b-4", "b-30", "ab3", "b3x", "b-3.", "(b-3)",
  "RCT/26-27/0007", "rct/26-27/7", "RCT/25-26/0007", "rct 26-27 0007", "CN/26-27/0001", "paid with pay_Qz9AbC12345678", "PAY_QZ9ABC12345678", "pay_NoCase000000",
  "my upi ref 412345678901", "upi ref 412345678902", "upi-pay-2", "f-4.2", "F4.2", "f-4.9", "f-4", "fee 4", "fees 4", "फीस 4", "o-5.b", "O5", "order 5", "order 2 dosa",
  "hello", "", "b-3 and b-12", "b-12 or b-3",
];

function vectors(): unknown {
  const named = [];
  for (const [template, f] of Object.entries(forms)) {
    for (const text of texts) {
      for (const words of [false, true]) named.push({ template, text, words, named: namedCase(text, { forms: f, isCase: (id) => holds.has(id), keys, words }) });
    }
  }
  const now = Date.parse("2026-11-10T10:00:00.000Z");
  const asked = [
    entry(10, "2026-11-10T09:30:00.000Z", "+919855555555", null, CASE_ASKED, "confirmed", { case: "b-3", via: "reference" }),
    entry(11, "2026-11-10T08:30:00.000Z", "+919855555555", null, CASE_ASKED, "confirmed", { case: "b-12", via: "reference" }),
    entry(12, "2026-11-10T09:50:00.000Z", "+919866666666", null, CASE_ASKED, "failed", { case: "b-3", via: "reference" }),
    entry(13, "2026-11-10T09:00:00.001Z", "+919877777777", null, CASE_ASKED, "confirmed", { case: "b-3", via: "payment" }),
  ];
  const told = [];
  for (const conversation of ["+919855555555", "+919866666666", "+919877777777", "+919888888888"]) {
    for (const c of ["b-3", "b-12"]) told.push({ conversation, case: c, nowMs: now, told: toldLately(asked, conversation, c, now) });
  }
  return {
    holds: [...holds], extra, entries, keys: Object.fromEntries([...recordKeys(entries)]), forms,
    tokens: texts.map((text) => ({ text, tokens: tokensOf(text) })), named, asked, told,
  };
}

const text = (): string => JSON.stringify(vectors(), null, 1) + "\n";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    let committed = "";
    try { committed = readFileSync(OUT, "utf8"); } catch { /* missing: stale */ }
    if (committed !== text()) { console.error("out of date: go/internal/runtime/testdata/caseasked-vectors.json  (run node go/scripts/gen_caseasked_vectors.ts)"); process.exit(1); }
  } else {
    writeFileSync(OUT, text());
    console.log(`written with Node ${process.version}`);
  }
}
