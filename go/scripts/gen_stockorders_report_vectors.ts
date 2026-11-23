// Writes the TEST VECTORS of the Go Stock orders monthly report (go/internal/stockordersreport/testdata/vectors.json.gz), made by RUNNING the TypeScript on Node:
// templates/commerce/stock-orders/report/* on several shop records, the way a month's report is made and sent. For each case: the report as the sealed envelope file (so the tree, its
// digest, code and signature are compared byte for byte), the report page and the owner's text in every language asked for, the signed summary link and the TypeScript verifier's
// reading of it (`checkSummaryLink`), and the WhatsApp message (text and template) in all four languages. Besides the cases: the policy digest of several settings, the settings as
// validateSettings returns them (so the Go settings reader's tree is proved to be the tree the digest is of), the go-live certificates the report reads (every status and every way to be
// untrusted, made by the TypeScript's own `buildGoLiveCertificate`), `writeStockReport`'s files, and `createMonthlyReport` (the job's wiring over a scripted messaging: the folder, the
// files, the claim and ending entries).
//
// Stock orders has no monthly record certificate (report/certificate.ts is the go-live certificate, the CLI's and the deployer's), so no vector holds one.
//
// The TypeScript is given the REAL purchase orders (the agent's own, made by running a busy month on the harness); Go is given only a small projection of them (`orders` in each case:
// state, supplier, total, the times asked, approved and sent, the answer and the receipt), made here by `project`, so the test shows the projection is all the report reads.
//
// The shop records are made by RUNNING the TypeScript: a busy month on the example salon (the harness with stand-in services and a real agent, as test/report.test.ts builds it), and
// records built here with the real record (`createRecord`) that exercise every rule of the counting. The signing key is a TEST VALUE made from a fixed 32-byte seed (so Ed25519's
// deterministic signatures can be compared); it signs nothing real. The vectors name the Node that made them.
// Run from the repository root:  node go/scripts/gen_stockorders_report_vectors.ts   (--check only compares; the test words-fresh fails when it was not run after a change to the report)
import { createPrivateKey, createHash } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";
import { createRecord } from "../../modules/record/record.ts";
import type { Outcome, RecordEntry } from "../../modules/record/record.ts";
import { fakeClock } from "../../modules/core/clock.ts";
import { zonedToMs } from "../../modules/core/time.ts";
import { envelopeFile, keyIdOf, publicKeyHex, seal } from "../../modules/report/sign.ts";
import { checkSummaryLink, summaryLinkFor } from "../../modules/report/summary-sign.ts";
import type { ListedSigner } from "../../modules/report/summary-sign.ts";
import { monthRange } from "../../modules/report/months.ts";
import { ApiError } from "../../modules/core/faults.ts";
import { MEENA, RAVI, createWorld, glowSalon } from "../../templates/commerce/stock-orders/src/harness.ts";
import { parseSettings } from "../../templates/commerce/stock-orders/src/settings.ts";
import type { Settings } from "../../templates/commerce/stock-orders/src/settings.ts";
import type { PurchaseOrder } from "../../templates/commerce/stock-orders/src/order.ts";
import { buildStockReport, checkedPolicyDigest, policyDigest } from "../../templates/commerce/stock-orders/report/data.ts";
import type { GoLiveFinding } from "../../templates/commerce/stock-orders/report/data.ts";
import { buildGoLiveCertificate } from "../../templates/commerce/stock-orders/report/certificate.ts";
import { reportPage } from "../../templates/commerce/stock-orders/report/html.ts";
import { ownerText } from "../../templates/commerce/stock-orders/report/text.ts";
import { monthlyReportMessage } from "../../templates/commerce/stock-orders/report/whatsapp.ts";
import { reportSummaryFields } from "../../templates/commerce/stock-orders/report/summary.ts";
import { writeStockReport } from "../../templates/commerce/stock-orders/report/run.ts";
import { createMonthlyReport } from "../../templates/commerce/stock-orders/report/monthly-job.ts";
import { readGoLive } from "../../templates/commerce/stock-orders/report/cli.ts";
import { readGoLiveCertificate } from "../../templates/commerce/stock-orders/report/go-live.ts";
import { newRecord } from "./lib_books_worlds.ts";

const here = dirname(fileURLToPath(import.meta.url));
const INTERNAL = join(here, "..", "internal");
export const OUT = INTERNAL;

// ---- the test keys: fixed seeds, never real keys ----
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const keyFromSeed = (seed: Buffer): KeyObject => createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
const KEY = keyFromSeed(Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 255)));
const KEY2 = keyFromSeed(Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 13 + 9) & 255)));
const PUB = publicKeyHex(KEY);
const SIGNER: ListedSigner = { key_id: keyIdOf(PUB), public_key: PUB, kind: "builder", name: "Test builder", since: "2026-01-01" };

const trial = <T>(fn: () => T): { ok: T } | { error: string } => { try { return { ok: fn() }; } catch (e) { return { error: (e as Error).message }; } };
const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const TZ = "Asia/Kolkata";
const at = (month: number, day: number, hour: number, minute = 0, year = 2026): number => zonedToMs({ year, month, day }, { hour, minute }, TZ);
const asJson = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// ---- the shops' settings: the example salon, other names, other time zones, with and without the assistant ----
const glow: Settings = glowSalon();
const rawGlow = JSON.parse(readFileSync(new URL("../../templates/commerce/stock-orders/settings/glow-salon.example.json", import.meta.url), "utf8"));
const nyc: Settings = parseSettings({ ...rawGlow, name: "  Brooklyn Salon  ", timezone: "America/New_York" });
const auckland: Settings = parseSettings({ ...rawGlow, name: "ग्लो सैलून", timezone: "Pacific/Auckland", owner: { ...rawGlow.owner, language: "hi" } });
const withAssistant: Settings = parseSettings({ ...rawGlow, assistant: { morning: { at: "07:30" }, character: { name: "  Maya ", style: "critters", seed: "maya-1", personality: "brief" }, talk: { customers: false } } });
const longName = (n: number) => ({ ...glow, name: "Glow Unisex Salon " + "ग्लो सैलून नगर ".repeat(Math.ceil(n / 12)).slice(0, n) }) as Settings;

// ---- the busy month of the example (test/report.test.ts busyMonth): a real agent on the harness with stand-in services ----
async function busyMonth(markPaid: boolean): Promise<{ entries: RecordEntry[]; orders: PurchaseOrder[] }> {
  const w = createWorld();
  const orderAndApprove = async (text: string) => { await w.ownerSays(text); await w.ownerSays(w.approveText()); return [...w.store.orders.keys()].at(-1)!; };
  const po1 = await orderAndApprove("order 10 boxes of hair colour from Ravi Traders");
  await w.supplierSays(RAVI, "ok");
  await w.ownerSays(`received ${po1} 4`);
  const po2 = await orderAndApprove("order 6 bottles of hair oil from Meena Beauty Supplies");
  await w.supplierSays(MEENA, "ok");
  await w.ownerSays(`received ${po2}`);
  if (markPaid) await w.ownerSays(`paid ${po2}`);
  await orderAndApprove("order 12 bottles of shampoo from Ravi Traders");
  await w.supplierSays(RAVI, "no");
  const po4 = await orderAndApprove("order 10 pieces of towel from Meena Beauty Supplies");
  await w.supplierSays(MEENA, "ok");
  await w.ownerSays(`wrong ${po4}`);
  await orderAndApprove("order 3 bottles of shampoo from Meena Beauty Supplies");
  await w.ownerSays("order 500 bottles of hair oil from Meena Beauty Supplies");
  // The agent's approval cards carry a random code, which goes into each entry's `inputsDigest`, so two runs would make two records. The digest is made fixed here (the report digests the
  // whole entry but its conversation, so it takes the fixed value, in the TypeScript and in Go alike): everything else in the record is the real agent's.
  const entries = [...w.record.entries()].map((e) => ({ ...e, inputsDigest: sha(`${e.seq}|${e.action}|${e.outcome}`).slice(0, 16) }));
  return { entries, orders: w.orders() };
}
const busy = await busyMonth(true);
const busyQuiet = await busyMonth(false);

// ---- records built here: the real record, every rule of the counting ----
type Ex = { refs?: Record<string, string>; decisions?: { ruleId: string; verdict: string; reason: string }[]; language?: Language; notes?: string; conversation?: string };
function world(startIso = "2026-10-01T00:00:00Z") {
  const r = newRecord(Date.parse(startIso));
  const add = (when: string, action: string, outcome: Outcome, booking: string | null, ex: Ex = {}): RecordEntry => r.append(Date.parse(when), { action, outcome, booking, ...ex } as never);
  return { add, entries: (): RecordEntry[] => [...r.entries()] };
}
const block = (ruleId: string) => ({ ruleId, verdict: "block", reason: `${ruleId} said no` });
const allow = (ruleId: string) => ({ ruleId, verdict: "allow", reason: "fine" });
const D = (d: number, h = 10, m = 0, mo = 11) => `2026-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
const OWNER_NO = "919876500099", RAVI_NO = "919876500001";

/** A purchase order as the store keeps it, with the members the report does not read filled in. */
function order(o: Partial<PurchaseOrder> & { id: string }): PurchaseOrder {
  return { requestId: `r-${o.id}`, lowStock: false, supplier: "ravi-traders", line: "hair-colour~ravi-traders~box", item: "hair-colour", unit: "box", qty: 1, unitPaise: 10000, totalPaise: 10000, state: "sent", createdMs: at(11, 2, 10), ack: "none", receipt: "none", receivedQty: 0, asks: [], ...o } as PurchaseOrder;
}
/** What the Go report is given of an order: the members the report reads, as plain JSON. */
const project = (o: PurchaseOrder) => ({ state: o.state, supplier: o.supplier, totalPaise: o.totalPaise, createdMs: o.createdMs ?? null, approvedMs: o.approvedMs ?? null, sentMs: o.sentMs ?? null, ack: o.ack, receipt: o.receipt });

/** A November that exercises every rule of the counting. */
function rulesWorld(): { entries: RecordEntry[]; orders: PurchaseOrder[] } {
  const w = world();
  const conv = (n: number) => ({ conversation: n === 0 ? OWNER_NO : RAVI_NO });
  // October: an order sent, a paid note
  w.add(D(30, 5, 0, 10), "send_order", "confirmed", "po-0", conv(1));
  w.add(D(30, 6, 0, 10), "mark_paid_outside", "confirmed", "po-0", conv(0));
  w.add(D(30, 7, 0, 10), "send_order", "failed", "po-0", conv(1)); // not this month
  // what the limits stopped: one rule, two rules on one entry, an unknown rule, the same rule twice, an allow, no decisions, a block on an entry that was not blocked
  w.add(D(2, 5), "check_order", "blocked", "po-1", { decisions: [block("monthly-budget")], ...conv(0) });
  w.add(D(2, 6), "send_order", "blocked", "po-1", { decisions: [block("per-order-cap"), block("order-quantity")], ...conv(0) });
  w.add(D(2, 7), "check_order", "blocked", "po-2", { decisions: [block("somewhere-else")], ...conv(0) });
  w.add(D(2, 8), "check_order", "blocked", "po-2", { decisions: [block("opt-out"), block("opt-out"), allow("monthly-budget")], ...conv(0) });
  w.add(D(2, 9), "check_order", "blocked", "po-2", { decisions: [allow("monthly-budget")], ...conv(0) }); // an allow is not a stop
  w.add(D(2, 10), "check_order", "blocked", "po-2", { ...conv(0) }); // no decisions
  w.add(D(2, 11), "check_order", "confirmed", "po-2", { decisions: [block("monthly-budget")], ...conv(0) }); // not blocked: not a stop
  w.add(D(2, 12), "check_order", "blocked", "po-3", { decisions: [block("constructor"), block("approved-supplier-only"), block("approval-matches-order"), block("one-order-per-request"), block("reply-from-supplier")], ...conv(0) });
  w.add(D(2, 13), "send_order", "blocked", "po-3", { decisions: [block("send-only-when-approved"), block("message-matches-record")], ...conv(0) });
  w.add(D(2, 14), "send_order", "blocked", "po-3", { decisions: [block("monthly-budget")], ...conv(0) });
  w.add(D(2, 15), "send_order", "blocked", "po-3", { decisions: [block("monthly-budget")], ...conv(0) });
  // the owner's own "paid" note: each order once, one that did not confirm, no order id, an empty one
  w.add(D(3, 5), "mark_paid_outside", "confirmed", "po-4", conv(0));
  w.add(D(3, 6), "mark_paid_outside", "confirmed", "po-4", conv(0));
  w.add(D(3, 7), "mark_paid_outside", "confirmed", "po-5", conv(0));
  w.add(D(3, 8), "mark_paid_outside", "unconfirmed", "po-6", conv(0));
  w.add(D(3, 9), "mark_paid_outside", "confirmed", null, conv(0));
  w.add(D(3, 10), "mark_paid_outside", "confirmed", "", conv(0));
  // sends left unconfirmed or failed, and one that went through
  w.add(D(4, 5), "send_order", "unconfirmed", "po-7", conv(1));
  w.add(D(4, 6), "send_order", "failed", "po-8", conv(1));
  w.add(D(4, 7), "send_order", "confirmed", "po-9", conv(1));
  w.add(D(4, 8), "send_message", "failed", "po-9", conv(1)); // not a send_order
  w.add(D(5, 5), "restored", "confirmed", null, conv(0));
  w.add(D(5, 6), "licence", "confirmed", null, { refs: { state: "grace" }, ...conv(0) });
  // after the month: December
  w.add(D(1, 5, 0, 12), "send_order", "unconfirmed", "po-90", conv(1));
  const orders = [
    order({ id: "po-1", supplier: "ravi-traders", state: "sent", approvedMs: at(11, 3, 10), sentMs: at(11, 3, 10, 1), ack: "accepted", receipt: "full", receivedQty: 1, totalPaise: 450000 }),
    order({ id: "po-2", supplier: "ravi-traders", state: "sent", approvedMs: at(11, 3, 11), sentMs: at(11, 3, 11, 1), ack: "declined", totalPaise: 216000 }),
    order({ id: "po-3", supplier: "meena-beauty", state: "sent", approvedMs: at(11, 4, 10), sentMs: at(11, 4, 10, 1), ack: "none", totalPaise: 72000 }), // out, no answer
    order({ id: "po-4", supplier: "meena-beauty", state: "approved", approvedMs: at(11, 4, 11), totalPaise: 90000 }), // approved, not out yet: holds budget
    order({ id: "po-5", supplier: "meena-beauty", state: "cancelled", approvedMs: at(11, 5, 10), totalPaise: 52650 }), // never sent, cancelled: gives its budget back
    order({ id: "po-6", supplier: "ravi-traders", state: "send_failed", approvedMs: at(11, 5, 11), totalPaise: 1000 }),
    order({ id: "po-7", supplier: "ravi-traders", state: "send_blocked", approvedMs: at(11, 5, 12), totalPaise: 2000 }),
    order({ id: "po-8", supplier: "kumar-wholesale", state: "send_unknown", approvedMs: at(11, 5, 13), totalPaise: 3000 }), // a paused supplier still has its row
    order({ id: "po-9", supplier: "gone-supplier", state: "sent", approvedMs: at(11, 6, 10), sentMs: at(11, 6, 10, 1), ack: "accepted", receipt: "wrong_item", totalPaise: 4000 }), // not on the list: counted, no row
    order({ id: "po-10", supplier: "ravi-traders", state: "sent", approvedMs: at(11, 6, 11), sentMs: at(11, 6, 11, 1), ack: "accepted", receipt: "part", receivedQty: 1, totalPaise: 5000 }),
    order({ id: "po-11", state: "declined", createdMs: at(11, 7, 10) }), // the owner said no
    order({ id: "po-12", state: "void", createdMs: at(11, 7, 11) }), // never went out
    order({ id: "po-13", state: "void", createdMs: at(11, 7, 12) }),
    order({ id: "po-14", state: "sent", createdMs: at(10, 30, 10), approvedMs: at(11, 1, 0), sentMs: at(11, 1, 0, 1), ack: "accepted", totalPaise: 6000 }), // approved at the first moment of the month
    order({ id: "po-15", state: "sent", createdMs: at(11, 30, 10), approvedMs: at(12, 1, 0), sentMs: at(12, 1, 0, 1), ack: "accepted", totalPaise: 7000 }), // the first moment of the next month: not this month's
    order({ id: "po-16", state: "sent", createdMs: at(10, 20, 10), approvedMs: at(10, 20, 11), sentMs: at(10, 20, 12), ack: "accepted", totalPaise: 8000 }), // October's
  ];
  return { entries: w.entries(), orders };
}

/** Lines the job itself wrote, and nothing else: a quiet month. */
function quietWorld(): RecordEntry[] {
  const w = world();
  w.add("2026-10-30T05:00:00Z", "send_order", "confirmed", "po-1");
  w.add("2026-11-01T05:00:00Z", "send_message", "confirmed", null, { refs: { to: "owner", report: "2026-10", code: "7K2M-9QXD" } });
  return w.entries();
}

const rules = rulesWorld();
const quietEntries = quietWorld();
const fyendEntries = ((): RecordEntry[] => {
  const w = world("2027-03-01T00:00:00Z");
  w.add("2027-03-30T05:00:00Z", "send_order", "confirmed", "po-1");
  w.add("2027-03-31T18:29:59.999Z", "mark_paid_outside", "confirmed", "po-1");
  w.add("2027-03-31T18:30:00.000Z", "mark_paid_outside", "confirmed", "po-2");
  w.add("2027-04-01T05:00:00Z", "restored", "confirmed", null);
  return w.entries();
})();
/** The shop records the vectors share, written once (a case or a job names one). */
const RECORDS: Record<string, readonly RecordEntry[]> = { busy: busy.entries, busyquiet: busyQuiet.entries, rules: rules.entries, quiet: quietEntries, fyend: fyendEntries, empty: [] };
const recordRef = (entries: readonly RecordEntry[]): string | RecordEntry[] => Object.entries(RECORDS).find(([, v]) => v === entries)?.[0] ?? asJson(entries);

// ---- the cases ----
interface Case {
  name: string; settings: Settings; entries: readonly RecordEntry[]; orders: PurchaseOrder[];
  month?: string; range?: [number, number]; source: "stand-in" | "test-mode" | "live"; madeAt: number;
  preparedBy: string | null; innovator?: boolean; goLive?: GoLiveFinding; tenant?: string;
  signed: boolean; pages: ("en" | "hi" | "ml" | "kn" | "both")[];
}
const FINDING_OWN: GoLiveFinding = { status: "own", code: "AB12-CD34", signedBy: "key:" + "ab".repeat(32), issuedOn: { year: 2026, month: 10, day: 20 }, held: 8, total: 8, failed: 0, notRun: 0, notTested: 8 };
const FINDING_SKIPS: GoLiveFinding = { ...FINDING_OWN, held: 7, total: 8, failed: 1, notRun: 2 } as GoLiveFinding;
const FINDING_EXAMPLE: GoLiveFinding = { status: "example", code: "EF56-GH78", signedBy: "key:" + "cd".repeat(32), issuedOn: { year: 2026, month: 9, day: 3 } };
const FINDING_DIFFERENT: GoLiveFinding = { status: "different", code: "JK90-LM12", signedBy: "key:" + "ef".repeat(32), issuedOn: { year: 2026, month: 11, day: 30 } };
const NOW = at(12, 1, 9, 30);
const base = { source: "stand-in" as const, madeAt: NOW, signed: true, pages: ["en"] as Case["pages"], orders: [] as PurchaseOrder[] };

const CASES: Case[] = [
  { ...base, name: "busy-both-signed", settings: glow, entries: busy.entries, orders: busy.orders, month: "2026-11", preparedBy: "Divya, Sri Sai Digital", innovator: true, goLive: FINDING_OWN, tenant: "glow", pages: ["both", "ml"], source: "live" },
  { ...base, name: "busy-unsigned-hi", settings: glow, entries: busy.entries, orders: busy.orders, month: "2026-11", preparedBy: "Divya", goLive: FINDING_EXAMPLE, signed: false, pages: ["hi", "kn"] },
  { ...base, name: "busy-october-untrusted", settings: glow, entries: busy.entries, orders: [], month: "2026-10", preparedBy: "Ravi & Sons <Digital>", goLive: { status: "untrusted" }, pages: ["ml"], source: "test-mode" },
  { ...base, name: "busy-december-different", settings: glow, entries: busy.entries, orders: busy.orders, month: "2026-12", preparedBy: "Divya", goLive: FINDING_DIFFERENT, tenant: "glow", pages: ["kn", "en"] },
  { ...base, name: "busy-custom-range", settings: glow, entries: busy.entries, orders: busy.orders, range: [at(11, 3, 0), at(11, 10, 0)], preparedBy: "Divya", goLive: FINDING_SKIPS, pages: ["en", "hi"] },
  { ...base, name: "busy-no-golive", settings: glow, entries: busy.entries, orders: busy.orders, month: "2026-11", preparedBy: "Divya", pages: ["en"] },
  { ...base, name: "busy-no-paid-note", settings: glow, entries: busyQuiet.entries, orders: busyQuiet.orders, month: "2026-11", preparedBy: "Divya", innovator: true, pages: ["both", "kn"] },
  { ...base, name: "rules-signed", settings: glow, entries: rules.entries, orders: rules.orders, month: "2026-11", preparedBy: "Meena", innovator: true, tenant: "Glow Unisex Salon", pages: ["en", "ml", "both"] },
  { ...base, name: "rules-skips", settings: glow, entries: rules.entries, orders: rules.orders, month: "2026-11", preparedBy: "Meena", goLive: FINDING_SKIPS, pages: ["hi", "kn"] },
  { ...base, name: "rules-october", settings: glow, entries: rules.entries, orders: rules.orders, month: "2026-10", preparedBy: "Meena", pages: ["hi"] },
  { ...base, name: "rules-december", settings: glow, entries: rules.entries, orders: rules.orders, month: "2026-12", preparedBy: "Meena", pages: ["en"] },
  { ...base, name: "rules-with-assistant", settings: withAssistant, entries: rules.entries, orders: rules.orders, month: "2026-11", preparedBy: "Meena", goLive: FINDING_OWN, pages: ["en"] },
  { ...base, name: "fyend-march", settings: glow, entries: fyendEntries, month: "2027-03", preparedBy: "Meena", tenant: "fy-end", pages: ["en", "hi"], madeAt: at(4, 1, 9, 30, 2027) },
  { ...base, name: "fyend-april", settings: glow, entries: fyendEntries, month: "2027-04", preparedBy: "Meena", tenant: "fy-end", pages: ["en"], madeAt: at(5, 1, 9, 30, 2027) },
  { ...base, name: "quiet", settings: glow, entries: quietEntries, month: "2026-11", preparedBy: "Divya", tenant: "quiet", pages: ["en"] },
  { ...base, name: "empty-record", settings: glow, entries: RECORDS.empty, month: "2026-11", preparedBy: "Divya", tenant: "empty", pages: ["en", "hi"], innovator: true },
  { ...base, name: "no-prepared-by", settings: glow, entries: quietEntries, month: "2026-11", preparedBy: null, pages: ["en"] },
  { ...base, name: "blank-prepared-by", settings: glow, entries: quietEntries, month: "2026-11", preparedBy: "  \n ", pages: ["en"] },
  { ...base, name: "other-zone-newyork", settings: nyc, entries: rules.entries, orders: rules.orders, month: "2026-11", preparedBy: "Sam", pages: ["en"], madeAt: zonedToMs({ year: 2026, month: 12, day: 1 }, { hour: 9, minute: 30 }, "America/New_York") },
  { ...base, name: "other-zone-auckland", settings: auckland, entries: rules.entries, orders: rules.orders, month: "2026-11", preparedBy: "तारा", pages: ["hi", "ml"], madeAt: zonedToMs({ year: 2026, month: 12, day: 1 }, { hour: 9, minute: 30 }, "Pacific/Auckland") },
  // the message must fit WhatsApp's 1024 characters: a long shop name pushes the signed summary link out, then the #digest link, then the #code link is used
  { ...base, name: "long-name-180", settings: longName(180), entries: rules.entries, month: "2026-11", preparedBy: "Meena", pages: ["en"] },
  { ...base, name: "long-name-300", settings: longName(300), entries: rules.entries, month: "2026-11", preparedBy: "Meena", pages: ["hi"] },
  { ...base, name: "long-name-420", settings: longName(420), entries: rules.entries, month: "2026-11", preparedBy: "Meena", pages: ["ml"] },
  { ...base, name: "long-name-600", settings: longName(600), entries: rules.entries, month: "2026-11", preparedBy: "Meena", pages: ["kn"] },
  { ...base, name: "long-name-unsigned", settings: longName(500), entries: rules.entries, month: "2026-11", preparedBy: "Meena", signed: false, pages: [] },
  // text that reaches the page and the message is escaped or put on one line
  { ...base, name: "escapes", settings: { ...glow, name: "Glow & <b>Salon</b> \"A's\"\n  line two" } as Settings, entries: rules.entries, orders: rules.orders, month: "2026-11", preparedBy: "Meena\n  S\t<x>&", innovator: true, pages: ["en", "kn"] },
  // a record that is not a chain: the report cannot be anchored, and says why
  { ...base, name: "ledger-gap", settings: glow, entries: rules.entries.filter((e) => e.seq !== 5), month: "2026-11", preparedBy: "Divya", tenant: "gap", pages: [] },
  { ...base, name: "ledger-bad-time", settings: glow, entries: rules.entries.map((e) => (e.seq === 3 ? { ...e, time: "not a time" } : e)), month: "2026-11", preparedBy: "Divya", tenant: "bad-time", pages: [] },
  { ...base, name: "ledger-bad-tenant", settings: glow, entries: quietEntries, month: "2026-11", preparedBy: "Divya", tenant: "!!!", pages: [] },
  { ...base, name: "period-backwards", settings: glow, entries: quietEntries, range: [at(11, 10, 0), at(11, 3, 0)], preparedBy: "Divya", pages: [] },
];
const BAD_SOURCE: Case = { ...base, name: "unknown-source", settings: glow, entries: [], source: "paper" as never, month: "2026-11", preparedBy: "Divya", pages: [] };

const LINK = (c: Case, l: string) => `https://reports.example.com/r/3f9a1c7d2b8e4f60/report-${c.month ?? "range"}-${l}.html`;
const checkOf = (link: string | undefined) => {
  if (!link) return null;
  const r = checkSummaryLink(link, [SIGNER]);
  if (r.status !== "genuine") return { status: r.status };
  const s = r.summary;
  return { status: r.status, layout: s.layout, source: s.source, ownerMarked: s.ownerMarked, period: s.period, pathway: s.pathway, shop: s.shop, by: s.by, figures: s.figures, digest: s.digest, signer: r.signer.key_id };
};

function derive(c: Case): unknown {
  const { from, to } = c.range ? { from: c.range[0], to: c.range[1] } : monthRange(c.month!, c.settings.timezone);
  const input = {
    settings: c.settings, entries: c.entries, orders: c.orders, from, to, source: c.source, madeAt: c.madeAt,
    ...(c.preparedBy !== null ? { preparedBy: c.preparedBy } : {}), ...(c.innovator ? { innovator: true } : {}), ...(c.goLive ? { goLive: c.goLive } : {}),
    ...(c.tenant !== undefined ? { ledger: { tenant: c.tenant } } : {}),
  };
  const head = { name: c.name, settings: asJson(c.settings), entries: recordRef(c.entries), orders: c.orders.map(project), month: c.month ?? null, range: c.range ?? null, from, to, source: c.source, madeAt: c.madeAt,
    preparedBy: c.preparedBy, innovator: c.innovator === true, goLive: c.goLive ?? null, tenant: c.tenant ?? null, signed: c.signed };
  const built = trial(() => buildStockReport(input));
  if ("error" in built) return { ...head, error: built.error };
  const report = built.ok;
  const key = c.signed ? KEY : undefined;
  const sealed = seal(report, key);
  const reportCheck = summaryLinkFor(sealed, reportSummaryFields(report), key);
  const pages = Object.fromEntries(c.pages.map((l) => [l, reportPage(sealed, l, reportCheck)]));
  const owner = Object.fromEntries(LANGUAGES.map((l) => [l, ownerText(report, l)]));
  const messages = Object.fromEntries(LANGUAGES.map((l) => [l, trial(() => monthlyReportMessage(sealed, l, { link: LINK(c, l), ...(reportCheck ? { check: reportCheck } : {}) }))]));
  return { ...head, report: envelopeFile(sealed), check: reportCheck ?? null, checked: checkOf(reportCheck), pages, owner, messages };
}

// ---- the files writeStockReport writes ----
function filesOf(c: Case, language: "en" | "hi" | "ml" | "kn" | "both"): unknown {
  const out = mkdtempSync(join(tmpdir(), "stock-report-"));
  try {
    const made = writeStockReport({
      settings: c.settings, entries: c.entries, orders: c.orders, month: c.month!, language, out, source: c.source,
      ...(c.signed ? { key: KEY } : {}), ...(c.preparedBy !== null ? { preparedBy: c.preparedBy } : {}), ...(c.innovator ? { innovator: true } : {}), ...(c.goLive ? { goLive: c.goLive } : {}),
      now: c.madeAt, ...(c.tenant ? { tenant: c.tenant } : {}),
    });
    const names = readdirSync(out).sort();
    return { name: c.name, language, written: made.files.map((f) => f.slice(out.length + 1)), sha: Object.fromEntries(names.map((n) => [n, sha(readFileSync(join(out, n), "utf8"))])), ownerTexts: made.ownerTexts, code: made.code, check: made.check ?? null };
  } finally { rmSync(out, { recursive: true, force: true }); }
}

// ---- the go-live certificates the report reads (made by the TypeScript's own builder) ----
function goLiveReadings(): unknown {
  const handCheck = { held: 8, total: 8, checks: 60, failedTitles: [] as string[] };
  const cert = (settings: Settings, hc: { held: number; total: number; checks: number; failedTitles: string[]; ranOn?: string; notRun?: string[] }, key: KeyObject | undefined = KEY, mutate?: (d: Record<string, unknown>) => void): string => {
    const doc = buildGoLiveCertificate({ settings, handCheck: hc, issuedAt: at(10, 20, 11), preparedBy: "Divya" }) as unknown as Record<string, unknown>;
    mutate?.(doc);
    return envelopeFile(seal(doc, key));
  };
  const other = longName(40);
  const cases: { name: string; settings: Settings; text: string }[] = [
    { name: "own", settings: nyc, text: cert(nyc, { ...handCheck, ranOn: policyDigest(nyc) }) },
    { name: "own-skipped", settings: nyc, text: cert(nyc, { ...handCheck, held: 7, total: 8, failedTitles: ["x"], ranOn: policyDigest(nyc), notRun: ["a", "b"] }) },
    { name: "own-assistant", settings: withAssistant, text: cert(withAssistant, { ...handCheck, ranOn: policyDigest(withAssistant) }) },
    { name: "example", settings: nyc, text: cert(nyc, handCheck) },
    { name: "example-for-the-example", settings: glow, text: cert(glow, handCheck) },
    { name: "different", settings: nyc, text: cert(nyc, { ...handCheck, ranOn: policyDigest(other) }) },
    { name: "other-key", settings: nyc, text: cert(nyc, { ...handCheck, ranOn: policyDigest(nyc) }, KEY2) },
    { name: "unsigned", settings: nyc, text: cert(nyc, { ...handCheck, ranOn: policyDigest(nyc) }, undefined) },
    { name: "changed", settings: nyc, text: cert(nyc, { ...handCheck, ranOn: policyDigest(nyc) }).replace("\"held\":8", "\"held\":9") },
    { name: "not-json", settings: nyc, text: "this is not a certificate" },
    { name: "empty", settings: nyc, text: "" },
    { name: "a monthly report", settings: nyc, text: envelopeFile(seal({ format: "geometer-stock-orders-report/1", anchor: null }, KEY)) },
    { name: "other-template", settings: nyc, text: cert(nyc, { ...handCheck, ranOn: policyDigest(nyc) }, KEY, (d) => { d.pathway = { name: "orders", version: "0.1.0" }; }) },
    { name: "no-pathway", settings: nyc, text: cert(nyc, { ...handCheck, ranOn: policyDigest(nyc) }, KEY, (d) => { delete d.pathway; }) },
    { name: "bad-counts", settings: nyc, text: cert(nyc, { ...handCheck, ranOn: policyDigest(nyc) }, KEY, (d) => { (d.checks as Record<string, unknown>).held = -1; }) },
  ];
  const missing = "/nonexistent/go-live-certificate.json"; // a fixed path that is not there: the vectors must not carry a machine's own paths
  return {
    cases: cases.map((c) => ({ name: c.name, settings: asJson(c.settings), text: c.text, reading: readGoLiveCertificate(c.text, c.settings) })),
    paths: { none: readGoLive(undefined, nyc), empty: readGoLive("", nyc), missing: { path: missing, reading: readGoLive(missing, nyc) } },
  };
}

// ---- the policy digest, and the settings as validateSettings returns them ----
function policies(): unknown {
  const named: [string, Settings][] = [["glow", glow], ["newyork", nyc], ["auckland", auckland], ["assistant", withAssistant], ["long", longName(300)]];
  const rows = named.map(([name, s]) => {
    const validated = asJson(s);
    if (policyDigest(validated as Settings) !== policyDigest(s)) throw new Error(`the policy digest of ${name} changes when the settings go through JSON: the Go report would digest another tree than the TypeScript`);
    return { name, settings: validated, digest: policyDigest(s) };
  });
  // settings files as owners might write them, before validateSettings fills the defaults in: the Go settings reader must make the validated tree from each
  const raws: Record<string, unknown>[] = [
    rawGlow,
    { ...rawGlow, name: "  Padded Salon  ", address: "1 High Street" },
    { ...rawGlow, languages: ["en", "hi", "en"], owner: { whatsapp: "+919812345678" }, followUpHours: undefined, limits: { maxPerOrderInr: 5000, monthlyBudgetInr: 20000 } },
    { ...rawGlow, assistant: {} },
    { ...rawGlow, assistant: { morning: false } },
    { ...rawGlow, assistant: { morning: { at: "09:05" }, talk: { customers: true }, character: { style: "clay", colour: "#C4795C", paint: "pink" } } },
    { ...rawGlow, assistant: { morning: { at: "07:30" }, character: { name: "  Maya ", style: "critters", seed: "maya-1", personality: "cheerful" }, talk: { customers: false } } },
  ];
  const trees = raws.map((raw) => { const text = JSON.stringify(raw); const v = parseSettings(JSON.parse(text)); return { text, tree: asJson(v), digest: policyDigest(v) }; });
  return { rows, checkedPolicyDigest: checkedPolicyDigest(), trees };
}

// ---- createMonthlyReport: the job's wiring over a scripted messaging ----
const job = await (async () => {
  const runs: unknown[] = [];
  for (const mode of ["template", "text", "document-refused", "no-activity"] as const) {
    const clock = fakeClock(at(12, 1, 10, 30));
    const entries = mode === "no-activity" ? quietEntries : rules.entries;
    const record = createRecord(clock, entries);
    const dir = mkdtempSync(join(tmpdir(), "stock-job-"));
    const sent: unknown[] = [];
    let nextId = 0;
    const messaging = {
      isWindowOpen: async () => mode !== "template",
      sendText: async (to: string, text: string) => { sent.push({ kind: "text", to, text }); return { id: `wamid.${++nextId}`, to, text, status: "sent" } as never; },
      sendTemplate: async (to: string, template: unknown) => { sent.push({ kind: "template", to, template }); return { id: `wamid.${++nextId}`, to } as never; },
      sendDocument: async (to: string, doc: unknown) => { sent.push({ kind: "document", to, doc }); if (mode === "document-refused") { throw new ApiError(400, "document refused"); } return { id: `wamid.${++nextId}`, to } as never; },
      getMessage: async (id: string) => ({ id }) as never,
    };
    const saves: number[] = [];
    const logs: string[] = [];
    const setup = { source: "stand-in" as const, pages: { dir, baseUrl: "https://reports.example.com/r" }, options: () => ({ preparedBy: "Divya, Sri Sai Digital", innovator: mode === "text" }), key: KEY, goLive: () => FINDING_OWN, token: () => "0123456789abcdef0123456789abcdef", tenant: "glow" };
    const jobRun = createMonthlyReport(setup);
    const ctx = { settings: glow, clock, messaging: messaging as never, record, save: () => saves.push(record.entries().length), log: (l: string) => logs.push(l), store: { orders: new Map(rules.orders.map((o) => [o.id, o])) } as never };
    const before = record.entries().length;
    const result = await jobRun.run(ctx);
    const written = record.entries().slice(before).map((e) => ({ seq: e.seq, time: e.time, action: e.action, outcome: e.outcome, booking: e.booking, language: e.language, notes: e.notes, refs: e.refs }));
    const files: Record<string, string> = {};
    for (const d of readdirSync(dir)) for (const f of readdirSync(join(dir, d))) files[`${d}/${f}`] = sha(readFileSync(join(dir, d, f), "utf8"));
    runs.push({ mode, entries: recordRef(entries), orders: rules.orders.map(project), now: at(12, 1, 10, 30), result, sent, written, saves, logs, files });
    rmSync(dir, { recursive: true, force: true });
  }
  return runs;
})();

const stamp = (v: unknown): string => JSON.stringify({ node: process.version, ...(v as object) }) + "\n";

/** Which check link each message chose: the signed summary, the #digest link or the #code link (so the cases hold all three). */
function checkKinds(derived: unknown[]): string[] {
  const kinds = new Set<string>();
  for (const d of derived as { messages?: Record<string, { ok?: { template: { parameters: string[] } } }> }[]) {
    for (const m of Object.values(d.messages ?? {})) {
      const p = m.ok?.template.parameters.find((x) => x.startsWith("https://geometer.dev/verify/"));
      if (p) kinds.add(p.includes("#s1.") ? "summary" : /#sha256:/.test(p) ? "digest" : "code");
    }
  }
  return [...kinds].sort();
}

function vectors(): unknown {
  const cases = CASES.map(derive);
  const kinds = checkKinds(cases);
  if (kinds.join() !== "code,digest,summary") throw new Error(`the cases must make messages with each kind of check link (summary, digest, code); they make: ${kinds.join(", ")}`);
  const named = (n: string) => CASES.find((c) => c.name === n)!;
  const fileRuns = [filesOf(CASES[0], "both"), filesOf(CASES[1], "hi"), filesOf(named("rules-signed"), "en"), filesOf(named("rules-skips"), "ml"), filesOf(named("busy-no-paid-note"), "kn"), filesOf(named("quiet"), "en")];
  const badSource = trial(() => buildStockReport({ settings: glow, entries: [], orders: [], from: 0, to: 1, source: BAD_SOURCE.source, madeAt: 0 }));
  const text = JSON.stringify(cases);
  if (/\/Users\/|\/private\/|\/var\/folders|\/tmp\//.test(text)) throw new Error("a vector holds a path of this machine");
  return {
    signer: SIGNER, publicKey: PUB, languages: LANGUAGES, records: asJson(RECORDS), cases, files: fileRuns, badSource,
    policies: policies(), goLive: goLiveReadings(), job,
    // what the report must not carry: the numbers that are in the records (the owner's and Ravi's, and the busy month's suppliers' as the harness writes them)
    numbers: [OWNER_NO, RAVI_NO, glow.owner.whatsapp.replace("+", ""), ...glow.suppliers.map((s) => s.whatsapp.replace("+", ""))],
    sizes: { busyEntries: busy.entries.length, rulesEntries: rules.entries.length, busyOrders: busy.orders.length },
  };
}

/** Packed (gzip, level 9): the pages repeat their style sheet and the shop records repeat, so the file is a tenth of its text. */
export function generate(): Map<string, Buffer> { return new Map([["stockordersreport/testdata/vectors.json.gz", gzipSync(Buffer.from(stamp(vectors())), { level: 9 })]]); }

/** The text of a vector file without its `node` member, so a newer Node that writes the same figures is not reported stale. */
const withoutNode = (packed: Buffer): string => { const o = JSON.parse(gunzipSync(packed).toString("utf8")); delete o.node; return JSON.stringify(o); };

export function staleFiles(root = INTERNAL): string[] {
  return [...generate()].filter(([name, data]) => !existsSync(join(root, name)) || withoutNode(readFileSync(join(root, name))) !== withoutNode(data)).map(([name]) => name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles();
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}  (run node go/scripts/gen_stockorders_report_vectors.ts)`); process.exit(1); }
  } else {
    for (const [name, data] of generate()) { mkdirSync(dirname(join(INTERNAL, name)), { recursive: true }); writeFileSync(join(INTERNAL, name), data); }
    console.log(`written with Node ${process.version}`);
  }
}
