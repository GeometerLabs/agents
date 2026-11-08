// The record of one case (B35): for one booking or one fee, a signed one-page paper in the shop's language that puts side by side what the customer asked,
// what the agent did, what the limits and Guard allowed or held and why, who approved, and what the payment service's and the calendar's own records showed
// when the agent read them back (or "marked paid by owner" for UPI), and what was not checked. It never says who is right: it has no field and no word for it.
//
// Everything comes from the record's entries for this case, as the record keeps them: the customer's number as the record has it (the number in the shop's
// own store, a short hash in the bundle's export), each message only as its fingerprint, and each service's ids. Nothing is looked up again, and the paper
// says so. Each row names its entry number and, when the ledger is given, the entry's hash in the ledger, so the paper can be held against the evidence pack.
import type { KeyObject } from "node:crypto";
import type { Language } from "../language/languages.ts";
import type { LocalDate } from "../core/time.ts";
import type { RecordEntry } from "../record/record.ts";
import { hashAt, headOf, ledgerEntries } from "../record/ledger.ts";
import type { LedgerHead } from "../record/ledger.ts";
import { esc, table } from "../report/page.ts";
import { seal } from "../report/sign.ts";
import type { Envelope } from "../report/sign.ts";
import { rupees } from "../report/text.ts";
import { UPI_PAID, UPI_REFUNDED, dayText, entriesOf, head, localDay, notCheckedSection, paperPage, sealSection, when } from "./common.ts";
import type { PaperCase, TemplatePapers } from "./common.ts";
import { WORDS, actionWord } from "./words.ts";
import type { PaperWords } from "./words.ts";

export const DISPUTE_FORMAT = "geometer-dispute-record/1";

/** The five columns, each a list of short facts. An entry can fill more than one (a refund the agent asked for, that a limit held, that the owner then approved). */
export interface DisputeRow {
  seq: number;
  time: string;
  /** The entry's hash in the shop's ledger, when the ledger was given: the same hash geo-verify checks in the evidence pack. */
  ledgerHash: string | null;
  customer: string[];
  agent: string[];
  limits: string[];
  owner: string[];
  services: string[];
}

export interface DisputeRecord {
  format: typeof DISPUTE_FORMAT;
  pathway: { name: string; version: string };
  shop: { name: string; timeZone: string };
  language: Language;
  issuedAt: string;
  issuedOn: LocalDate;
  case: { id: string; customer: string; label: string; state: string };
  rows: DisputeRow[];
  /** What was not checked, in plain words in the paper's language. */
  notTested: string[];
  anchor: LedgerHead | null;
}

export interface DisputeInput {
  template: TemplatePapers;
  shop: { name: string; timeZone: string };
  /** The case, as the template gives it. */
  case: PaperCase;
  /** The whole record, oldest first (only this case's entries are used; the whole of it is needed for the ledger's hashes). */
  entries: readonly RecordEntry[];
  /** The shop's language (the owner's). */
  language: Language;
  now: number;
  /** The ledger tenant (the shop's id): each row then names its ledger hash, and the paper is anchored to the head. Left out, neither. */
  tenant?: string;
}

const SERVICE_OF: Record<string, keyof PaperWords["dispute"]["service"]> = { paymentId: "payments", refundId: "payments", linkId: "payments", eventId: "calendar", messageId: "whatsapp" };
const CUSTOMER_ACTIONS = new Set(["receive_message", "opt_out", "upi_paid_claim"]);
/** What came in (a message, a payment service's notice): it was taken, not read back from a service's own record, so it has no outcome to state and no service column. */
const RECEIVED = new Set(["receive_message", "receive_payment_event"]);
const OWNER_ACTIONS = new Set(["owner_decision", UPI_PAID, UPI_REFUNDED, "upi_refund_kept"]);

function rowOf(e: RecordEntry, d: PaperWords, extra: Record<string, string>, ledgerHash: string | null): DisputeRow {
  const row: DisputeRow = { seq: e.seq, time: e.time, ledgerHash, customer: [], agent: [], limits: [], owner: [], services: [] };
  const amount = e.refs.amountPaise !== undefined && Number.isInteger(Number(e.refs.amountPaise)) ? ` (${rupees(Number(e.refs.amountPaise))})` : "";
  if (e.action === "receive_message") row.customer.push(d.dispute.message);
  else if (e.action === "upi_paid_claim") row.customer.push(d.dispute.claim(e.refs.via ?? "words"));
  else if (e.action === "opt_out") row.customer.push(actionWord(d, extra, e.action));
  else if (e.action === "owner_decision") row.owner.push(d.dispute.owner(e.refs.command ?? "?"));
  else if (e.action === UPI_PAID) row.owner.push(`${d.dispute.ownerMarked}${amount}`);
  else if (e.action === UPI_REFUNDED) row.owner.push(`${d.dispute.ownerMarkedRefund}${amount}`);
  else if (OWNER_ACTIONS.has(e.action)) row.owner.push(`${actionWord(d, extra, e.action)}${amount}`);
  if (!CUSTOMER_ACTIONS.has(e.action) && !OWNER_ACTIONS.has(e.action)) row.agent.push(RECEIVED.has(e.action) ? actionWord(d, extra, e.action) : `${actionWord(d, extra, e.action)}${amount}: ${d.outcome[e.outcome]}`);
  if (e.refs.by === "owner") row.owner.push(actionWord(d, extra, e.action));
  for (const x of e.decisions) row.limits.push(d.dispute.rule(x.ruleId, d.dispute.verdict[x.verdict], x.reason));
  if (e.refs.approval) row.limits.push(d.dispute.guardHeld(e.refs.approval));
  if (e.outcome === "confirmed" && !OWNER_ACTIONS.has(e.action) && !CUSTOMER_ACTIONS.has(e.action) && !RECEIVED.has(e.action) && e.refs.markedBy !== "owner") {
    const byService = new Map<string, string[]>();
    for (const [k, v] of Object.entries(e.refs)) if (SERVICE_OF[k] && v) byService.set(SERVICE_OF[k], [...(byService.get(SERVICE_OF[k]) ?? []), v]);
    for (const [s, ids] of byService) row.services.push(d.dispute.showed(d.dispute.service[s as keyof PaperWords["dispute"]["service"]], ids.join(", ") + amount));
  }
  return row;
}

export function buildDisputeRecord(input: DisputeInput): DisputeRecord {
  const d = WORDS[input.language];
  const extra = input.template.actionWords[input.language] ?? {};
  const ledger = input.tenant ? ledgerEntries(input.entries, input.tenant) : null;
  const mine = entriesOf(input.entries, new Set([input.case.id]));
  const rows = mine.map((e) => rowOf(e, d, extra, ledger ? hashAt(ledger, e.seq) : null));
  const upi = mine.some((e) => e.action === UPI_PAID || e.action === UPI_REFUNDED || e.refs.markedBy === "owner");
  const guard = mine.some((e) => e.refs.approval);
  return {
    format: DISPUTE_FORMAT,
    pathway: input.template.pathway,
    shop: { ...input.shop },
    language: input.language,
    issuedAt: new Date(input.now).toISOString(),
    issuedOn: localDay(input.now, input.shop.timeZone),
    case: { id: input.case.id, customer: input.case.customer, label: input.case.label(input.language), state: input.case.state },
    rows,
    notTested: [d.not.whoIsRight, d.not.providers, d.not.words, ...(guard ? [d.not.guardLog] : []), ...(upi ? [d.not.upi] : []), d.not.outside, d.not.truth, ledger ? d.not.anchorNotCompared : d.not.noLedger],
    anchor: ledger && ledger.length > 0 ? headOf(input.entries, input.tenant as string) : null,
  };
}

export const sealDisputeRecord = (input: DisputeInput, key?: KeyObject): Envelope<DisputeRecord> => seal(buildDisputeRecord(input), key);

const cell = (lines: string[]): string => lines.map((l) => esc(l)).join("<br>");

export function disputePage(envelope: Envelope<DisputeRecord>): string {
  const r = envelope.document;
  const w = WORDS[r.language];
  const d = w.dispute;
  const rows = r.rows.map((x) => [`${esc(when(x.time, r.shop.timeZone, r.language))}<div class="small mono">#${x.seq}${x.ledgerHash ? ` ${esc(x.ledgerHash.slice(7, 19))}` : ""}</div>`, cell(x.customer), cell(x.agent), cell(x.limits), cell(x.owner), cell(x.services)]);
  const body = `${head(r.shop.name, d.title, `${d.case} ${r.case.id} · ${w.common.issued} ${dayText(r.issuedOn, r.language)}`, r.language)}
<p class="note">${esc(d.intro)}</p>
<dl><dt>${esc(d.case)}</dt><dd>${esc(r.case.id)}</dd><dt>${esc(d.askedFor)}</dt><dd>${esc(r.case.label)}</dd><dt>${esc(d.customer)}</dt><dd class="mono">${esc(r.case.customer)}</dd><dt>${esc(d.state)}</dt><dd>${esc(r.case.state)}</dd></dl>
${r.rows.length === 0 ? `<p>${esc(d.nothing)}</p>` : table([{ text: d.time }, { text: d.asked }, { text: d.did }, { text: d.limits }, { text: d.approved }, { text: d.services }], rows)}
${notCheckedSection(r.notTested, r.language)}
${sealSection(envelope, r.language)}`;
  return paperPage(`${d.title} · ${r.case.id} · ${r.shop.name}`, r.language, body);
}

/** A few lines for a message: the case, how many entries, the code and where to check it. */
export function disputeText(envelope: Envelope<DisputeRecord>): string {
  const r = envelope.document;
  const w = WORDS[r.language];
  return [`${w.dispute.title} · ${r.shop.name}`, `${w.dispute.case} ${r.case.id}: ${r.case.label}`, w.dispute.intro, `${w.common.code}: ${envelope.code} · ${w.common.checkAt(`/verify/#${envelope.code}`)}`].join("\n");
}
