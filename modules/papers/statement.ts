// A signed statement for one person (B28): a Bookings customer's deposits and refunds, a Fees parent's payments and refunds, and their own totals, in their
// own language. NOTHING about anyone else: it is made only from the entries of this person's own cases, and no total of the shop is in it.
//
// Where the numbers come from: the record entries a payment service's own record confirmed (`confirmed` on the template's paid and refund actions), counted
// once per payment id and refund id, with the amount the record kept; and for a UPI shop the owner's marks, labelled "marked paid by owner" on every line.
// The statement is anchored to the head of the shop's ledger when one is named, so a quiet change to the record later would not match the copy this
// person holds. It is sealed with the same envelope as every report (geometer-document/1), so the site's checker reads it.
import type { KeyObject } from "node:crypto";
import type { Language } from "../language/languages.ts";
import type { LocalDate } from "../core/time.ts";
import type { RecordEntry } from "../record/record.ts";
import { headOf } from "../record/ledger.ts";
import type { LedgerHead } from "../record/ledger.ts";
import { esc, table } from "../report/page.ts";
import { seal } from "../report/sign.ts";
import type { Envelope } from "../report/sign.ts";
import { rupees } from "../report/text.ts";
import { verifyCodePath } from "../report/verify-link.ts";
import { UPI_PAID, UPI_REFUNDED, dayText, entriesOf, head, isPerson, lastDigits, localDay, notCheckedSection, paperPage, sealSection, when } from "./common.ts";
import type { PaperCase, TemplatePapers } from "./common.ts";
import { WORDS } from "./words.ts";

export const STATEMENT_FORMAT = "geometer-statement/1";

export interface StatementItem {
  seq: number;
  time: string;
  case: string;
  /** What the case was, in the person's language, as the template words it. */
  for: string;
  kind: "paid" | "refunded";
  /** "provider": the payment service's own record confirmed it. "owner-marked": the owner marked it (UPI); no payment service has a record. */
  by: "provider" | "owner-marked";
  amountPaise: number;
  ref: string;
}

export interface Statement {
  format: typeof STATEMENT_FORMAT;
  pathway: { name: string; version: string };
  shop: { name: string; timeZone: string };
  language: Language;
  issuedAt: string;
  issuedOn: LocalDate;
  /** The person, as little as lets them see it is theirs: the last digits of the number and the ids of their own cases. */
  person: { number: string; cases: string[] };
  items: StatementItem[];
  totals: { paidPaise: number; refundedPaise: number; netPaise: number; owedPaise?: number };
  /** What this statement does not check, in plain words in the person's language (the site's checker lists these). */
  notTested: string[];
  anchor: LedgerHead | null;
}

export interface StatementInput {
  template: TemplatePapers;
  shop: { name: string; timeZone: string };
  /** The person's WhatsApp number, as they or the shop gave it. Matched against the record as the shop holds it, and against the export's fingerprints when `personKey` is given. */
  number: string;
  /** The shop's fingerprint key (B69): what lets a number be matched against the export's fingerprints. Left out, only a number kept as itself (the shop's own store) matches. */
  personKey?: Buffer;
  /** The whole record, oldest first. */
  entries: readonly RecordEntry[];
  /** Every case of the shop; only this person's are used. */
  cases: readonly PaperCase[];
  /** Left out: the language of the person's latest case. */
  language?: Language;
  now: number;
  /** The ledger tenant to anchor to (the shop's id). Left out, the anchor is null. */
  tenant?: string;
}

export function buildStatement(input: StatementInput): Statement {
  const mine = input.cases.filter((c) => isPerson(c.customer, input.number, input.personKey));
  const language = input.language ?? mine.at(-1)?.language ?? "en";
  const w = WORDS[language];
  const ids = new Set(mine.map((c) => c.id));
  const byId = new Map(mine.map((c) => [c.id, c]));
  const paid = new Set([...input.template.paidActions, UPI_PAID]);
  const refunded = new Set([...input.template.refundActions, UPI_REFUNDED]);
  const seen = new Set<string>();
  const items: StatementItem[] = [];
  let upi = false;
  for (const e of entriesOf(input.entries, ids)) {
    if (e.outcome !== "confirmed") continue;
    const kind = paid.has(e.action) ? "paid" : refunded.has(e.action) ? "refunded" : null;
    if (!kind) continue;
    const ref = kind === "paid" ? e.refs.paymentId ?? e.refs.requestId ?? `entry-${e.seq}` : e.refs.refundId ?? `entry-${e.seq}`;
    const amount = Number(e.refs.amountPaise);
    if (seen.has(`${kind}|${ref}`) || !Number.isInteger(amount) || amount < 0) continue; // once per payment and per refund; an entry with no amount is not a payment line
    seen.add(`${kind}|${ref}`);
    const by = e.action === UPI_PAID || e.action === UPI_REFUNDED || e.refs.markedBy === "owner" ? "owner-marked" : "provider";
    if (by === "owner-marked") upi = true;
    items.push({ seq: e.seq, time: e.time, case: e.booking as string, for: byId.get(e.booking as string)?.label(language) ?? (e.booking as string), kind, by, amountPaise: amount, ref });
  }
  const paidPaise = items.filter((i) => i.kind === "paid").reduce((n, i) => n + i.amountPaise, 0);
  const refundedPaise = items.filter((i) => i.kind === "refunded").reduce((n, i) => n + i.amountPaise, 0);
  const owed = mine.filter((c) => c.owedPaise !== undefined);
  const notTested = [w.not.others, w.not.cash, w.not.providers, ...(upi ? [w.not.upi] : []), w.not.truth, input.tenant ? w.not.anchorNotCompared : w.not.noLedger];
  return {
    format: STATEMENT_FORMAT,
    pathway: input.template.pathway,
    shop: { ...input.shop },
    language,
    issuedAt: new Date(input.now).toISOString(),
    issuedOn: localDay(input.now, input.shop.timeZone),
    person: { number: lastDigits(input.number), cases: [...ids].sort() },
    items,
    totals: { paidPaise, refundedPaise, netPaise: paidPaise - refundedPaise, ...(owed.length > 0 ? { owedPaise: owed.reduce((n, c) => n + (c.owedPaise as number), 0) } : {}) },
    notTested,
    anchor: input.tenant ? headOf(input.entries, input.tenant) : null,
  };
}

export const sealStatement = (input: StatementInput, key?: KeyObject): Envelope<Statement> => seal(buildStatement(input), key);

const label = (i: StatementItem, language: Language): string => {
  const s = WORDS[language].statement;
  return i.kind === "paid" ? (i.by === "owner-marked" ? s.markedPaid : s.paid) : (i.by === "owner-marked" ? s.markedRefund : s.refunded);
};

/** The short text for WhatsApp: who it is for, the totals, the code and where to check it. */
export function statementText(envelope: Envelope<Statement>): string {
  const d = envelope.document;
  const w = WORDS[d.language];
  const s = w.statement;
  const lines = [`${s.title} · ${d.shop.name}`, s.forNumber(d.person.number.replace("…", ""))];
  if (d.items.length === 0) lines.push(s.none);
  else lines.push(`${s.totalPaid}: ${rupees(d.totals.paidPaise)} · ${s.totalRefunded}: ${rupees(d.totals.refundedPaise)}`);
  if (d.totals.owedPaise !== undefined) lines.push(`${s.owed}: ${rupees(d.totals.owedPaise)}`);
  lines.push(`${w.common.code}: ${envelope.code} · ${w.common.checkAt(verifyCodePath(envelope))}`);
  return lines.join("\n");
}

export function statementPage(envelope: Envelope<Statement>): string {
  const d = envelope.document;
  const w = WORDS[d.language];
  const s = w.statement;
  const rows = d.items.map((i) => [esc(when(i.time, d.shop.timeZone, d.language)), esc(label(i, d.language)), esc(i.for), esc(rupees(i.amountPaise))]);
  const totals: [string, number][] = [[s.totalPaid, d.totals.paidPaise], [s.totalRefunded, d.totals.refundedPaise], [s.net, d.totals.netPaise], ...(d.totals.owedPaise !== undefined ? [[s.owed, d.totals.owedPaise] as [string, number]] : [])];
  const body = `${head(d.shop.name, s.title, `${s.forNumber(d.person.number.replace("…", ""))} · ${w.common.issued} ${dayText(d.issuedOn, d.language)}`, d.language)}
<p class="note">${esc(s.intro)}</p>
<div class="cards">${totals.map(([k, v]) => `<div class="card"><b>${esc(rupees(v))}</b><span>${esc(k)}</span></div>`).join("")}</div>
<h2>${esc(s.heading)}</h2>
${d.items.length === 0 ? `<p>${esc(s.none)}</p>` : table([{ text: s.when }, { text: s.what }, { text: s.case }, { text: s.amount, n: true }], rows)}
${notCheckedSection(d.notTested, d.language)}
${sealSection(envelope, d.language)}`;
  return paperPage(`${s.title} · ${d.shop.name}`, d.language, body);
}
