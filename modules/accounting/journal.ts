// The journal: the shop's record read as double-entry lines in paise. The one reader of the accounts.
//
// Why a fold over the record and not a store of its own (docs/plans/accounting-module.md, section 1): every money fact a shop agent may count is already a record
// entry that the payments service's own list or the owner's mark confirmed, and the record is append-only, hash-chained and exported. Reading the accounts out of it
// means they can never disagree with it, a record written before this module has its accounts at once (no migration), and the same accounts come out of the shop's
// database, the export and the evidence pack (this file reads only chained fields: action, outcome, the case id, the time and `refs`; never `conversation`, `notes`
// or `refs.page`). It is pure: no `node:` import, no settings, no clock, so the browser demo, the report, the owner's page and the open check (check.ts) all run it.
//
// Two kinds of entry are read:
//  - a money line written through post.ts carries `refs.money` (the kind) and the rest of its facts in `refs` (MONEY_REFS). This is every line written since this
//    module came in;
//  - an older line has no `refs.money`. It is read through a LegacyMap the template hands in (which of its actions were money, and what kind), plus the lines every
//    template writes the same way (refunds, and the owner's marks of refunds owed). The map is frozen: new code always writes `refs.money`. What an older line
//    cannot say (a refund owed before it was made, the service of a booking done) is left out or put in a general account, never guessed.
//
// Every entry gives lines that sum to zero. Anything that cannot be read as written is a Problem, listed and never silently fixed.
import { ACCOUNTS, METHOD_ACCOUNT, isAccount, serviceAccount } from "./accounts.ts";
import type { Method } from "./accounts.ts";
import { parseNumber } from "./numbers.ts";
import type { Series } from "./numbers.ts";
import type { Outcome, RecordEntry } from "../record/record.ts";

/** The kinds of money fact. A payment request is not one: no money moved and nothing was supplied (plan, section 2). */
export type MoneyKind =
  | "received" | "fee_charged" | "late_fee" | "discount" | "applied" | "kept"
  | "refund_owed" | "refund_made" | "refund_cancelled" | "write_off" | "correction";
export const MONEY_KINDS: readonly MoneyKind[] = ["received", "fee_charged", "late_fee", "discount", "applied", "kept", "refund_owed", "refund_made", "refund_cancelled", "write_off", "correction"];

/** How the money is known: the payments service's own list, the owner's mark, or a person's word (Guard's `already_done`). Printed on documents and the owner's page. */
export type Evidence = "provider" | "owner_mark" | "person_word";

/** What a payment received was for: a booking's deposit or an order's advance, a fee, or money beyond it that is given back (a second payment on the same link). */
export type ReceivedFor = "advance" | "fee" | "extra";

/** The `refs` keys a money line carries. Strings, as every ref is. Chained (record/ledger.ts), so never renamed. */
export const MONEY_REFS = {
  kind: "money", amount: "amountPaise", paymentId: "paymentId", refundId: "refundId", owed: "owed", method: "method", evidence: "evidence",
  for: "for", service: "service", doc: "doc", reverses: "reverses", why: "why",
} as const;

/** Which of a template's older actions were money, and what kind. Handed in by the template (it knows its own action names; this module imports no template). */
export interface LegacyMap {
  /** Payments that arrived: `record_deposit` confirmed (advance) and blocked (a second payment: extra), `record_payment`, `owner_marked_paid`. */
  received: readonly { action: string; outcome: Outcome; for: ReceivedFor }[];
  /** The line that says the booking or order was done, and the account its deposit or advance goes to. The amount is the case's deposit then held. */
  applied?: readonly { action: string; account: string }[];
  /** Fees: the month's fee opened, a late fee added, a waiver. */
  feeCharged?: string;
  lateFee?: string;
  discount?: string;
}

/** The lines every template writes the same way (modules/payments/refunds.ts and owner-marked/obligations.ts MARK_ACTIONS). Their values are persisted names. */
const SHARED = { refund: "refund", owedByOwner: "upi_refund_owed", doneByOwner: "upi_refund_marked_done", keptByOwner: "upi_refund_kept", markedPaid: "owner_marked_paid" } as const;

export interface Line {
  seq: number;
  /** The record entry's time (ISO, UTC). A line is always dated by its entry: nothing is back-dated. */
  at: string;
  case: string | null;
  account: string;
  debitPaise: number;
  creditPaise: number;
  kind: MoneyKind;
  evidence?: Evidence;
  method?: Method;
  doc?: string;
}

export interface DocRef { number: string; series: Series; fy: string; n: number; seq: number; at: string; case: string | null; kind: MoneyKind; amountPaise: number; evidence?: Evidence;
  /** The payment this document is about (a receipt's, or the payment a refund note gives back), and how it was paid: a refund note finds its receipt by `paymentId` (documents.ts). */
  paymentId?: string; method?: Method }

export interface Problem { seq: number; why: string }

/** One refund owed, open until it is made, cancelled or kept. `from` is where its money was taken from, so a cancellation puts it back exactly there. */
interface Owed { case: string | null; open: number; from: { account: string; paise: number }[] }

/**
 * The journal, built one entry at a time. The record is append-only, so a caller that keeps one (post.ts) only reads the entries after the last it saw.
 * `journal(entries, legacy)` below is the one-shot form.
 */
export class Journal {
  readonly lines: Line[] = [];
  readonly documents: DocRef[] = [];
  readonly problems: Problem[] = [];
  /** How many record entries have been read. */
  seen = 0;
  /** What each money identity was posted by (dedupe across new and older lines): "received:<payment>", "made:<refund>", "fee:<case>", ... */
  readonly identities = new Map<string, number>();
  private readonly balance = new Map<string, number>(); // `${case}|${account}`: debits less credits
  private readonly owed = new Map<string, Owed>();
  private readonly bySeq = new Map<number, Line[]>();

  constructor(private readonly legacy: LegacyMap) {}

  addAll(entries: readonly RecordEntry[]): this {
    for (let i = this.seen; i < entries.length; i++) this.add(entries[i]);
    return this;
  }

  /** What the case holds in an account: debits less credits (an asset's balance; a liability's is the negative). */
  caseBalance(caseId: string | null, account: string): number { return this.balance.get(`${caseId}|${account}`) ?? 0; }
  /** The deposit or advance a case holds now, in paise. */
  advancesOf(caseId: string): number { return -this.caseBalance(caseId, ACCOUNTS.advances.code); }
  /** What a fee case is still owed (negative: paid beyond it). */
  receivableOf(caseId: string): number { return this.caseBalance(caseId, ACCOUNTS.receivable.code); }
  /** The lines one record entry gave (none: it was not money, or it could not be read). */
  linesOf(seq: number): readonly Line[] { return this.bySeq.get(seq) ?? []; }
  /** The refund owed under this key that is still open, in paise (0: none). */
  openOwed(key: string): number { return this.owed.get(key)?.open ?? 0; }
  /** Every refund still owed: key, case and amount. */
  owedList(): { key: string; case: string | null; paise: number }[] { return [...this.owed].filter(([, o]) => o.open > 0).map(([key, o]) => ({ key, case: o.case, paise: o.open })); }

  add(e: RecordEntry): void {
    this.seen++;
    try {
      const kind = e.refs[MONEY_REFS.kind];
      if (kind !== undefined) this.readNew(e, kind);
      else this.readLegacy(e);
    } catch (err) {
      this.problems.push({ seq: e.seq, why: (err as Error).message });
    }
  }

  // ---- the lines ------------------------------------------------------------------------------------------------------

  private post(e: RecordEntry, kind: MoneyKind, pairs: { account: string; debit?: number; credit?: number }[], extra: { evidence?: Evidence; method?: Method; doc?: string; paymentId?: string; identity?: string; amount: number }): void {
    if (extra.identity !== undefined) {
      const was = this.identities.get(extra.identity);
      if (was !== undefined) throw new Error(`${extra.identity} was already counted at entry ${was}; this one is not counted again`);
    }
    let sum = 0;
    for (const p of pairs) {
      if (!isAccount(p.account)) throw new Error(`"${p.account}" is not an account`);
      sum += (p.debit ?? 0) - (p.credit ?? 0);
    }
    if (sum !== 0) throw new Error(`the lines of a ${kind} do not balance (${sum} paise)`);
    const made: Line[] = [];
    for (const p of pairs) {
      const debit = p.debit ?? 0;
      const credit = p.credit ?? 0;
      if (debit === 0 && credit === 0) continue;
      const line: Line = { seq: e.seq, at: e.time, case: e.booking, account: p.account, debitPaise: debit, creditPaise: credit, kind, ...(extra.evidence ? { evidence: extra.evidence } : {}), ...(extra.method ? { method: extra.method } : {}), ...(extra.doc ? { doc: extra.doc } : {}) };
      made.push(line);
      const key = `${e.booking}|${p.account}`;
      this.balance.set(key, (this.balance.get(key) ?? 0) + debit - credit);
    }
    this.lines.push(...made);
    this.bySeq.set(e.seq, made);
    if (extra.identity !== undefined) this.identities.set(extra.identity, e.seq);
    if (extra.doc) {
      const d = parseNumber(extra.doc);
      if (!d) this.problems.push({ seq: e.seq, why: `"${extra.doc}" is not a document number this module writes` });
      else this.documents.push({ number: extra.doc, series: d.series, fy: d.fy, n: d.n, seq: e.seq, at: e.time, case: e.booking, kind, amountPaise: extra.amount, ...(extra.evidence ? { evidence: extra.evidence } : {}), ...(extra.paymentId ? { paymentId: extra.paymentId } : {}), ...(extra.method ? { method: extra.method } : {}) });
    }
  }

  /** Where money given back comes from, in this order: the deposit or advance the case holds, then what it paid beyond a fee, then the sale itself (a return). */
  private take(caseId: string | null, amount: number): { account: string; paise: number }[] {
    const out: { account: string; paise: number }[] = [];
    let left = amount;
    const held = caseId === null ? 0 : Math.max(0, this.advancesOf(caseId));
    if (held > 0 && left > 0) { const p = Math.min(held, left); out.push({ account: ACCOUNTS.advances.code, paise: p }); left -= p; }
    const over = caseId === null ? 0 : Math.max(0, -this.receivableOf(caseId));
    if (over > 0 && left > 0) { const p = Math.min(over, left); out.push({ account: ACCOUNTS.receivable.code, paise: p }); left -= p; }
    if (left > 0) out.push({ account: ACCOUNTS.returns.code, paise: left });
    return out;
  }

  private received(e: RecordEntry, a: { amount: number; paymentId: string; method: Method; evidence: Evidence; for: ReceivedFor; doc?: string }): void {
    const into = a.for === "fee" ? ACCOUNTS.receivable.code : ACCOUNTS.advances.code;
    this.post(e, "received", [{ account: METHOD_ACCOUNT[a.method], debit: a.amount }, { account: into, credit: a.amount }], { evidence: a.evidence, method: a.method, doc: a.doc, paymentId: a.paymentId, identity: `received:${a.paymentId}`, amount: a.amount });
  }

  private refundOwed(e: RecordEntry, key: string, amount: number, doc?: string): void {
    if (this.openOwed(key) > 0) throw new Error(`a refund is already owed under ${key}; it is not owed twice`);
    const from = this.take(e.booking, amount);
    this.post(e, "refund_owed", [...from.map((f) => ({ account: f.account, debit: f.paise })), { account: ACCOUNTS.refundsOwed.code, credit: amount }], { doc, amount });
    this.owed.set(key, { case: e.booking, open: amount, from });
  }

  private refundMade(e: RecordEntry, key: string, a: { amount: number; method: Method; evidence: Evidence; identity: string; doc?: string; paymentId?: string }): void {
    const o = this.owed.get(key);
    const use = Math.min(o?.open ?? 0, a.amount);
    const rest = a.amount - use; // made with nothing (or less) owed first: an older line, or a refund the list showed after it was given up
    const from = rest > 0 ? this.take(e.booking, rest) : [];
    this.post(e, "refund_made", [{ account: ACCOUNTS.refundsOwed.code, debit: use }, ...from.map((f) => ({ account: f.account, debit: f.paise })), { account: METHOD_ACCOUNT[a.method], credit: a.amount }], { evidence: a.evidence, method: a.method, doc: a.doc, paymentId: a.paymentId, identity: a.identity, amount: a.amount });
    if (o && use > 0) { o.open -= use; spend(o.from, use); } // only once the lines are in: a refused line changes nothing
  }

  /** A refund owed that will not be made (the owner's no, an approval that ran out, a refusal): its money goes back where it was taken from. */
  private refundCancelled(e: RecordEntry, key: string): void {
    const o = this.owed.get(key);
    if (!o || o.open === 0) throw new Error(`no refund is owed under ${key}, so there is nothing to cancel`);
    const amount = o.open;
    this.post(e, "refund_cancelled", [{ account: ACCOUNTS.refundsOwed.code, debit: amount }, ...o.from.map((f) => ({ account: f.account, credit: f.paise }))], { amount });
    o.open = 0;
    o.from = [];
  }

  /** Money the owner keeps: a deposit after a late cancellation the owner said no to (from the advances), or a refund owed the owner keeps for work done by hand. */
  private kept(e: RecordEntry, a: { amount: number; key?: string }): void {
    if (a.key !== undefined) {
      const o = this.owed.get(a.key);
      if (!o || o.open === 0) throw new Error(`no refund is owed under ${a.key}, so nothing can be kept from it`);
      const amount = o.open;
      this.post(e, "kept", [{ account: ACCOUNTS.refundsOwed.code, debit: amount }, { account: ACCOUNTS.kept.code, credit: amount }], { amount, identity: `kept:${a.key}` });
      o.open = 0;
      o.from = [];
      return;
    }
    this.post(e, "kept", [{ account: ACCOUNTS.advances.code, debit: a.amount }, { account: ACCOUNTS.kept.code, credit: a.amount }], { amount: a.amount, identity: `kept:${e.booking}` });
  }

  // ---- a line written through post.ts ---------------------------------------------------------------------------------

  private readNew(e: RecordEntry, kindText: string): void {
    if (!MONEY_KINDS.includes(kindText as MoneyKind)) throw new Error(`"${kindText}" is not a kind of money fact`);
    const kind = kindText as MoneyKind;
    const r = e.refs;
    const doc = r[MONEY_REFS.doc];
    const amount = kind === "correction" || kind === "refund_cancelled" ? 0 : paise(r[MONEY_REFS.amount]);
    const need = (k: keyof typeof MONEY_REFS): string => {
      const v = r[MONEY_REFS[k]];
      if (v === undefined || v === "") throw new Error(`a ${kind} line has no ${MONEY_REFS[k]}`);
      return v;
    };
    switch (kind) {
      case "received": return this.received(e, { amount, paymentId: need("paymentId"), method: method(need("method")), evidence: evidence(need("evidence")), for: receivedFor(need("for")), doc });
      case "fee_charged": return this.post(e, kind, [{ account: ACCOUNTS.receivable.code, debit: amount }, { account: ACCOUNTS.fees.code, credit: amount }], { doc, identity: `fee:${e.booking}`, amount });
      case "late_fee": return this.post(e, kind, [{ account: ACCOUNTS.receivable.code, debit: amount }, { account: ACCOUNTS.lateFees.code, credit: amount }], { doc, identity: `late:${e.booking}`, amount });
      case "discount": return this.post(e, kind, [{ account: ACCOUNTS.discounts.code, debit: amount }, { account: ACCOUNTS.receivable.code, credit: amount }], { amount });
      case "write_off": return this.post(e, kind, [{ account: ACCOUNTS.writtenOff.code, debit: amount }, { account: ACCOUNTS.receivable.code, credit: amount }], { amount });
      case "applied": {
        const service = need("service");
        const account = service === "orders" ? ACCOUNTS.orders.code : serviceAccount(service);
        if (e.booking !== null && this.advancesOf(e.booking) < amount) this.problems.push({ seq: e.seq, why: `${e.booking} holds ${this.advancesOf(e.booking)} paise of deposit, less than the ${amount} applied` });
        return this.post(e, kind, [{ account: ACCOUNTS.advances.code, debit: amount }, { account, credit: amount }], { doc, identity: `applied:${e.booking}`, amount });
      }
      case "kept": return this.kept(e, { amount, key: r[MONEY_REFS.owed] });
      case "refund_owed": return this.refundOwed(e, need("owed"), amount, doc);
      case "refund_made": {
        const ev = evidence(need("evidence"));
        const refundId = r[MONEY_REFS.refundId];
        const identity = refundId ? `made:${refundId}` : `made:${need("owed")}:${ev}`;
        return this.refundMade(e, need("owed"), { amount, method: method(need("method")), evidence: ev, identity, doc, paymentId: r[MONEY_REFS.paymentId] });
      }
      case "refund_cancelled": return this.refundCancelled(e, need("owed"));
      case "correction": {
        const seq = Number(need("reverses"));
        const lines = this.bySeq.get(seq);
        if (!lines || lines.length === 0) throw new Error(`entry ${seq} has no lines to reverse`);
        const k = lines[0].kind;
        if (k === "refund_owed" || k === "refund_made" || k === "refund_cancelled" || k === "correction" || k === "received") throw new Error(`a ${k} is corrected by its own flow, never by a correction`);
        const total = lines.reduce((n, l) => n + l.debitPaise, 0);
        return this.post(e, kind, lines.map((l) => ({ account: l.account, debit: l.creditPaise, credit: l.debitPaise })), { identity: `correction:${seq}`, amount: total });
      }
    }
  }

  // ---- a line written before this module (frozen) ---------------------------------------------------------------------

  private readLegacy(e: RecordEntry): void {
    const r = e.refs;
    const L = this.legacy;
    const got = L.received.find((x) => x.action === e.action && x.outcome === e.outcome);
    if (got) {
      if (r.paymentId === undefined) throw new Error(`an older ${e.action} line has no payment id`);
      const byOwner = e.action === SHARED.markedPaid;
      const m: Method = byOwner ? (r.via === "cash" ? "cash" : "upi") : "gateway";
      return this.received(e, { amount: paise(r.amountPaise), paymentId: r.paymentId, method: m, evidence: byOwner ? "owner_mark" : "provider", for: got.for });
    }
    if (e.outcome !== "confirmed" && !(e.action === SHARED.owedByOwner && e.outcome === "held_for_owner")) return;
    const applied = L.applied?.find((x) => x.action === e.action);
    if (applied && e.booking !== null) {
      const held = this.advancesOf(e.booking);
      if (held > 0) this.post(e, "applied", [{ account: ACCOUNTS.advances.code, debit: held }, { account: applied.account, credit: held }], { identity: `applied:${e.booking}`, amount: held });
      return;
    }
    if (L.feeCharged === e.action) return this.post(e, "fee_charged", [{ account: ACCOUNTS.receivable.code, debit: paise(r.amountPaise) }, { account: ACCOUNTS.fees.code, credit: paise(r.amountPaise) }], { identity: `fee:${e.booking}`, amount: paise(r.amountPaise) });
    if (L.lateFee === e.action) return this.post(e, "late_fee", [{ account: ACCOUNTS.receivable.code, debit: paise(r.amountPaise) }, { account: ACCOUNTS.lateFees.code, credit: paise(r.amountPaise) }], { identity: `late:${e.booking}`, amount: paise(r.amountPaise) });
    if (L.discount === e.action) return this.post(e, "discount", [{ account: ACCOUNTS.discounts.code, debit: paise(r.amountPaise) }, { account: ACCOUNTS.receivable.code, credit: paise(r.amountPaise) }], { amount: paise(r.amountPaise) });
    if (e.action === SHARED.refund) {
      // A refund the payments service's list showed, or one a person settled by their word (Guard's already_done: refs.confirmedBy, no refund id).
      const byWord = r.confirmedBy !== undefined && r.refundId === undefined;
      if (r.paymentId === undefined) throw new Error("an older refund line has no payment id");
      const key = `${e.booking}:${r.paymentId}`;
      return this.refundMade(e, key, { amount: paise(r.amountPaise), method: "gateway", evidence: byWord ? "person_word" : "provider", identity: r.refundId ? `made:${r.refundId}` : `made:${key}:person_word`, paymentId: r.paymentId });
    }
    if (e.action === SHARED.owedByOwner) {
      if (r.refundId === undefined) throw new Error("an older refund owed by the owner has no id");
      return this.refundOwed(e, r.refundId, paise(r.amountPaise));
    }
    if (e.action === SHARED.doneByOwner) {
      if (r.refundId === undefined) throw new Error("an older refund marked sent has no id");
      return this.refundMade(e, r.refundId, { amount: paise(r.amountPaise ?? String(this.openOwed(r.refundId))), method: "upi", evidence: "owner_mark", identity: `made:${r.refundId}` });
    }
    if (e.action === SHARED.keptByOwner) {
      if (r.refundId === undefined) throw new Error("an older refund kept by the owner has no id");
      return this.kept(e, { amount: 0, key: r.refundId });
    }
  }
}

/** Use up `paise` of where an owed refund's money came from, first source first. */
function spend(from: { account: string; paise: number }[], paise: number): void {
  let left = paise;
  while (left > 0 && from.length > 0) {
    const p = Math.min(from[0].paise, left);
    from[0].paise -= p;
    left -= p;
    if (from[0].paise === 0) from.shift();
  }
}

/** A ref's amount: a whole number of paise, more than zero. Anything else is a Problem (today's report counts the same thing as "missing"). */
function paise(text: string | undefined): number {
  const n = text === undefined ? NaN : Number(text);
  if (!Number.isSafeInteger(n) || n <= 0 || String(n) !== text) throw new Error(`the amount ${text === undefined ? "is missing" : `"${text}" is not a whole number of paise above 0`}`);
  return n;
}

const METHODS: readonly Method[] = ["gateway", "upi", "cash", "bank"];
const EVIDENCE: readonly Evidence[] = ["provider", "owner_mark", "person_word"];
const FOR: readonly ReceivedFor[] = ["advance", "fee", "extra"];
function method(v: string): Method { if (!METHODS.includes(v as Method)) throw new Error(`"${v}" is not a payment method`); return v as Method; }
function evidence(v: string): Evidence { if (!EVIDENCE.includes(v as Evidence)) throw new Error(`"${v}" is not a kind of evidence`); return v as Evidence; }
function receivedFor(v: string): ReceivedFor { if (!FOR.includes(v as ReceivedFor)) throw new Error(`"${v}" is not what a payment can be for`); return v as ReceivedFor; }

/** The whole record, read once. */
export function journal(entries: readonly RecordEntry[], legacy: LegacyMap): Journal {
  return new Journal(legacy).addAll(entries);
}

/** Debits less credits per account over the lines whose time is in [fromIso, toIso) (both optional, ISO strings compare as times). */
export function balances(lines: readonly Line[], fromIso?: string, toIso?: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) {
    if ((fromIso !== undefined && l.at < fromIso) || (toIso !== undefined && l.at >= toIso)) continue;
    out[l.account] = (out[l.account] ?? 0) + l.debitPaise - l.creditPaise;
  }
  return out;
}
