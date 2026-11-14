// The customer's documents: a receipt, a fee bill, a refund note that cites its receipt, and a composition shop's bill of supply, each drawn in all four languages.
// What is pinned, and why: the claims check passes on every page; an unregistered shop's document never says "tax" (English or any language's own word) and has no
// GSTIN; a composition shop's documents carry the rule 5(1)(f) legend; the customer's name shows only when handed in; amounts come from integer paise; the page has
// no script. The records are real ones, written through post.ts, so the DocRefs are what the journal gives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../core/clock.ts";
import { zonedToMs } from "../../core/time.ts";
import { createRecord } from "../../record/record.ts";
import type { Outcome } from "../../record/record.ts";
import { LANGUAGES } from "../../language/languages.ts";
import type { Language } from "../../language/languages.ts";
import { bannedIn } from "../../report/claims.ts";
import { createAccounting } from "../post.ts";
import type { MoneyEvent, TaxStatus } from "../post.ts";
import type { LegacyMap } from "../journal.ts";
import { formatPaise, makeDocument } from "../documents.ts";
import type { Document } from "../documents.ts";
import { documentPage } from "../document-page.ts";

const TZ = "Asia/Kolkata";
const NOV_15 = zonedToMs({ year: 2026, month: 11, day: 15 }, { hour: 10, minute: 30 }, TZ);
const LEGACY: LegacyMap = { received: [], feeCharged: "open_fee" };
const SHOP = { name: "Meena Salon", address: "12 Temple Road, Kochi", phone: "+91 98111 11111", timezone: TZ };

function world(status: TaxStatus) {
  const clock = fakeClock(NOV_15);
  const record = createRecord(clock);
  const acc = createAccounting({ record, shop: { timezone: TZ, status }, legacy: LEGACY, clock });
  const post = (event: MoneyEvent, action: string, outcome: Outcome = "confirmed") =>
    acc.post(event, (refs) => record.append({ conversation: "+919800000001", booking: "case" in event ? event.case : null, action, inputs: {}, outcome, language: "en", refs }));
  return { post, docs: () => acc.journal().documents };
}

const whatFor = (c: string, l: Language) => (c.startsWith("fee") ? { en: "Fee for November 2026", hi: "नवंबर 2026 की फ़ीस", ml: "2026 നവംബറിലെ ഫീസ്", kn: "ನವೆಂಬರ್ 2026 ರ ಶುಲ್ಕ" }[l] : { en: "Haircut, Sun 15 Nov, 10:30 am", hi: "बाल कटवाना, रवि 15 नवंबर", ml: "ഹെയർകട്ട്, ഞായർ 15 നവംബർ", kn: "ಹೇರ್‌ಕಟ್, ಭಾನು 15 ನವೆಂಬರ್" }[l]);

// The words for "tax" this module might use, by language (the English word is checked everywhere): an unregistered shop's page holds none of them.
const TAX_WORDS = [/\btax/i, /GSTIN/i, /\bGST\b/, /टैक्स/u, /(^|[\s,.;(])कर($|[\s,.;)])/u, /करदाता/u, /നികുതി/u, /ತೆರಿಗೆ/u];
const body = (page: string) => page.replace(/<style>[\s\S]*?<\/style>/u, "");
const visible = (page: string) => body(page).replace(/<[^>]+>/gu, " ").replace(/&#39;/gu, "'").replace(/&amp;/gu, "&");

function receipt(status: TaxStatus = "unregistered") {
  const w = world(status);
  w.post({ kind: "received", case: "b-1", paymentId: "pay_1", amountPaise: 45_050, method: "gateway", evidence: "provider", for: "advance" }, "record_deposit");
  return { w, doc: w.docs()[0] };
}

test("a receipt in every language: title, number, date, amount, how it is known, the footer; English beside it for hi, ml, kn", () => {
  const { w, doc } = receipt();
  for (const language of LANGUAGES) {
    const d = makeDocument({ doc, documents: w.docs(), shop: SHOP, language, whatFor });
    const page = documentPage(d);
    const text = visible(page);
    assert.match(text, /RCT\/26-27\/0001/u);
    assert.ok(text.includes("₹450.50"), `${language}: amount`);
    assert.ok(text.includes(SHOP.name) && text.includes(SHOP.address) && text.includes(SHOP.phone));
    assert.ok(text.includes(whatFor("b-1", language)), `${language}: what it is for`);
    assert.match(text, /15 Nov 2026/u); // the English date is on every page (the local one for en reads "Sun 15 Nov, 10:30 am, 2026")
    if (language !== "en") { assert.ok(text.includes("Receipt") && text.includes("Amount received") && text.includes("Number")); assert.match(page, /class="machine"/u); }
    else assert.ok(text.includes("Confirmed by the payment service") && text.includes("Made by computer for Meena Salon."));
    assert.ok(page.includes(`<html lang="${language}">`));
  }
  const en = visible(documentPage(makeDocument({ doc, documents: w.docs(), shop: SHOP, language: "en", whatFor })));
  assert.ok(en.includes("Receipt") && en.includes("Online"));
});

test("how it is known: provider, owner mark (received and sent) and a person's word, each in its own words", () => {
  const w = world("unregistered");
  w.post({ kind: "received", case: "b-1", paymentId: "p1", amountPaise: 10_000, method: "upi", evidence: "owner_mark", for: "advance" }, "owner_marked_paid");
  w.post({ kind: "refund_owed", case: "b-1", owed: "b-1:p1", paymentId: "p1", amountPaise: 10_000 }, "refund", "attempted");
  w.post({ kind: "refund_made", case: "b-1", owed: "b-1:p1", paymentId: "p1", amountPaise: 10_000, method: "upi", evidence: "owner_mark", refundId: "upr-1" }, "refund");
  w.post({ kind: "received", case: "b-2", paymentId: "p2", amountPaise: 5_000, method: "cash", evidence: "person_word", for: "advance" }, "record_deposit");
  const [r1, cn, r2] = w.docs();
  const t = (doc: typeof r1) => visible(documentPage(makeDocument({ doc, documents: w.docs(), shop: SHOP, language: "en", whatFor })));
  assert.ok(t(r1).includes("Marked received by the shop owner") && !t(r1).includes("Marked sent"));
  assert.ok(t(cn).includes("Marked sent by the shop owner"));
  assert.ok(t(r2).includes("Settled by a person's word"));
});

test("a fee bill: an unregistered shop's is a Bill, with no payment line (nothing is paid yet)", () => {
  const w = world("unregistered");
  w.post({ kind: "fee_charged", case: "fee-7", amountPaise: 150_000 }, "open_fee");
  const doc = w.docs()[0];
  assert.equal(doc.number, "BILL/26-27/0001");
  for (const language of LANGUAGES) {
    const d = makeDocument({ doc, documents: w.docs(), shop: SHOP, language, whatFor });
    assert.equal(d.kind, "bill");
    assert.equal(d.legend, false);
    const text = visible(documentPage(d));
    assert.ok(text.includes("₹1,500") && text.includes(whatFor("fee-7", language)));
    assert.equal(d.evidence, undefined);
  }
});

test("a refund note cites the receipt of the same payment by its number", () => {
  const w = world("unregistered");
  w.post({ kind: "received", case: "b-9", paymentId: "pay_9", amountPaise: 20_000, method: "gateway", evidence: "provider", for: "advance" }, "record_deposit");
  w.post({ kind: "received", case: "b-8", paymentId: "pay_8", amountPaise: 7_000, method: "gateway", evidence: "provider", for: "advance" }, "record_deposit"); // another payment: RCT 0002
  w.post({ kind: "refund_owed", case: "b-9", owed: "b-9:pay_9", paymentId: "pay_9", amountPaise: 20_000 }, "refund", "attempted");
  w.post({ kind: "refund_made", case: "b-9", owed: "b-9:pay_9", paymentId: "pay_9", refundId: "rfd_9", amountPaise: 20_000, method: "gateway", evidence: "provider" }, "refund");
  const cn = w.docs().find((x) => x.series === "CN")!;
  assert.equal(cn.paymentId, "pay_9");
  for (const language of LANGUAGES) {
    const d = makeDocument({ doc: cn, documents: w.docs(), shop: SHOP, language, whatFor });
    assert.equal(d.kind, "refund_note");
    assert.equal(d.cites?.number, "RCT/26-27/0001");
    const text = visible(documentPage(d));
    assert.ok(text.includes("CN/26-27/0001") && text.includes("RCT/26-27/0001") && !text.includes("RCT/26-27/0002"));
    assert.ok(text.includes("₹200"));
  }
  assert.ok(visible(documentPage(makeDocument({ doc: cn, documents: w.docs(), shop: SHOP, language: "en", whatFor }))).includes("Refund note"));
});

test("a composition shop: its bill is a Bill of supply and every document begins with the rule 5(1)(f) legend (in English too)", () => {
  const w = world("composition");
  w.post({ kind: "fee_charged", case: "fee-7", amountPaise: 150_000 }, "open_fee");
  w.post({ kind: "received", case: "b-1", paymentId: "pay_1", amountPaise: 20_000, method: "upi", evidence: "owner_mark", for: "advance" }, "owner_marked_paid");
  for (const doc of w.docs()) for (const language of LANGUAGES) {
    const d = makeDocument({ doc, documents: w.docs(), shop: { ...SHOP, status: "composition" }, language, whatFor });
    const page = documentPage(d);
    assert.equal(d.legend, true);
    assert.ok(visible(page).includes("composition taxable person, not eligible to collect tax on supplies"));
    assert.ok(page.indexOf('class="legend"') < page.indexOf("<h1>", page.indexOf('class="card')), "the legend is above the title");
    if (doc.series === "BILL") { assert.equal(d.kind, "bill_of_supply"); assert.ok(visible(page).includes("Bill of supply")); }
    else assert.equal(d.kind, "receipt");
  }
});

test("an unregistered shop's documents never say tax, GSTIN or GST, in any language (every kind)", () => {
  const w = world("unregistered");
  w.post({ kind: "fee_charged", case: "fee-7", amountPaise: 150_000 }, "open_fee");
  w.post({ kind: "received", case: "b-1", paymentId: "pay_1", amountPaise: 20_000, method: "gateway", evidence: "provider", for: "advance" }, "record_deposit");
  w.post({ kind: "refund_owed", case: "b-1", owed: "b-1:pay_1", paymentId: "pay_1", amountPaise: 20_000 }, "refund", "attempted");
  w.post({ kind: "refund_made", case: "b-1", owed: "b-1:pay_1", paymentId: "pay_1", refundId: "r1", amountPaise: 20_000, method: "gateway", evidence: "provider" }, "refund");
  assert.equal(w.docs().length, 3);
  for (const doc of w.docs()) for (const language of LANGUAGES) {
    const text = visible(documentPage(makeDocument({ doc, documents: w.docs(), shop: SHOP, language, whatFor })));
    for (const re of TAX_WORDS) assert.ok(!re.test(text), `${doc.series} ${language}: ${re}`);
  }
});

test("the claims check passes on every page, in every language and for both statuses", () => {
  for (const status of ["unregistered", "composition"] as const) {
    const w = world(status);
    w.post({ kind: "fee_charged", case: "fee-7", amountPaise: 150_000 }, "open_fee");
    w.post({ kind: "received", case: "b-1", paymentId: "pay_1", amountPaise: 20_000, method: "bank", evidence: "provider", for: "advance" }, "record_deposit");
    w.post({ kind: "refund_owed", case: "b-1", owed: "b-1:pay_1", paymentId: "pay_1", amountPaise: 20_000 }, "refund", "attempted");
    w.post({ kind: "refund_made", case: "b-1", owed: "b-1:pay_1", paymentId: "pay_1", refundId: "r1", amountPaise: 20_000, method: "gateway", evidence: "provider" }, "refund");
    for (const doc of w.docs()) for (const language of LANGUAGES) {
      const d = makeDocument({ doc, documents: w.docs(), shop: { ...SHOP, status }, language, whatFor, person: () => "Asha" });
      assert.deepEqual(bannedIn(visible(documentPage(d)), language), [], `${status} ${doc.series} ${language}`);
    }
  }
});

test("the customer's name appears only when handed in; a hostile shop name stays text; the page has no script", () => {
  const { w, doc } = receipt();
  const without = documentPage(makeDocument({ doc, documents: w.docs(), shop: SHOP, language: "en", whatFor }));
  const withName = documentPage(makeDocument({ doc, documents: w.docs(), shop: SHOP, language: "en", whatFor, person: (c) => (c === "b-1" ? "Asha Nair" : undefined) }));
  assert.ok(!without.includes("Asha") && withName.includes("Asha Nair"));
  const evil = documentPage(makeDocument({ doc, documents: w.docs(), shop: { ...SHOP, name: "<script>alert(1)</script>" }, language: "en", whatFor }));
  assert.ok(!/<script/iu.test(evil) && evil.includes("&lt;script&gt;"));
  for (const language of LANGUAGES) {
    const page = documentPage(makeDocument({ doc, documents: w.docs(), shop: SHOP, language, whatFor, person: () => "Asha" }));
    assert.ok(!/<script/iu.test(page) && !/\son[a-z]+=/iu.test(page) && !/<(link|img|iframe|form)\b/iu.test(page));
    assert.ok(page.includes("@media print") && page.includes("@page"));
  }
});

test("amounts are written from integer paise, and a float or a negative is refused", () => {
  assert.equal(formatPaise(0), "₹0");
  assert.equal(formatPaise(45_000), "₹450");
  assert.equal(formatPaise(45_005), "₹450.05");
  assert.equal(formatPaise(12_500_000), "₹1,25,000");
  assert.equal(formatPaise(10 + 20), "₹0.30");
  assert.throws(() => formatPaise(10.5), /whole number of paise/);
  assert.throws(() => formatPaise(-1), /whole number of paise/);
  const d: Document | undefined = undefined;
  assert.equal(d, undefined);
});
