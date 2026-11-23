// What must hold of a shop's books after anything at all has happened: the checks the templates' crash tests run on every world they make (a lost reply, a double tap,
// a refund held by Guard, a restart, a restore, a refund the books did not expect ...), so a fault in how a template posts money shows up as a named fault and not as a
// wrong figure on an owner's page months later.
//
// Why a list of faults and not asserts: the crash tests run dozens of worlds, and a plain sentence per fault ("entry 12: debits 20000, credits 10000") says which world
// and which line at once. An empty list is the books holding. This file reads the record and the journal only (no clock, no settings), like the rest of the module.
//
// What it checks:
//  - the journal reads every money line (a problem other than a repeat is a fault: a line said it was money and could not be read);
//  - each record entry's lines balance (debits equal credits), so the whole journal does too;
//  - money moves at most once: one `received` per payment, one `refund_made` per refund id;
//  - `refunds_owed` holds exactly the refunds still open (Journal.owedList), never less than nothing;
//  - document numbers, per series and financial year, are unique and have no gap, except a jump that a `restored` entry explains (numbers.ts RESTORE_DOC_GAP);
//  - privacy: no record entry's refs carry a customer's phone number, nor any of the `privateText` given (a Fees student's name), since refs go into the evidence pack
//    and the accountant's files. A customer's number lives only in the entry's own `conversation`, which the evidence pack fingerprints (modules/record/fingerprint.ts).
//    The numbers looked for are the record's own conversations (with and without the country code), not "any long run of digits": refs rightly carry times in
//    seconds or milliseconds and a bank's 12-digit UTR, which a digit count would call phone numbers.
// `figuresFaults` checks one more thing, for the monthly report: its rows (figures.ts) and its "Money this month" block (the books summary) differ only by the
// money `booksOnly` names (a payment made twice, the owner's own marks), counted each way a report counts the owner's marks. So the line under the block that
// explains the difference is always the whole difference.
import { ACCOUNTS } from "./accounts.ts";
import { journal, MONEY_REFS } from "./journal.ts";
import type { Journal, LegacyMap } from "./journal.ts";
import { RESTORED_ACTION } from "./numbers.ts";
import { figuresOf } from "./figures.ts";
import { accountingSummary } from "./summary.ts";
import type { RecordEntry } from "../record/record.ts";

/** The phone numbers of the record's conversations, each with and without its country code (an Indian number's last 10 digits). */
function phonesOf(entries: readonly RecordEntry[]): string[] {
  const out = new Set<string>();
  for (const e of entries) {
    const digits = (e.conversation ?? "").replace(/\D/gu, "");
    if (digits.length < 10) continue;
    out.add(digits);
    out.add(digits.slice(-10));
  }
  return [...out];
}

export function booksFaults(entries: readonly RecordEntry[], legacy: LegacyMap, o: { privateText?: readonly string[] } = {}): string[] {
  const j: Journal = journal(entries, legacy);
  const faults: string[] = [];

  for (const p of j.problems) if (!/already counted/u.test(p.why)) faults.push(`entry ${p.seq} could not be read as money: ${p.why}`);

  const sides = new Map<number, { d: number; c: number }>();
  for (const l of j.lines) { const s = sides.get(l.seq) ?? { d: 0, c: 0 }; s.d += l.debitPaise; s.c += l.creditPaise; sides.set(l.seq, s); }
  for (const [seq, s] of sides) if (s.d !== s.c) faults.push(`entry ${seq}: debits ${s.d} paise, credits ${s.c} paise`);

  // once: the money identities of the entries that posted
  const once = new Map<string, number>();
  for (const e of entries) {
    if (j.linesOf(e.seq).length === 0) continue;
    const kind = e.refs[MONEY_REFS.kind];
    const id = kind === "received" ? e.refs[MONEY_REFS.paymentId] : kind === "refund_made" ? e.refs[MONEY_REFS.refundId] : undefined;
    if (id === undefined) continue;
    const key = `${kind}:${id}`;
    if (once.has(key)) faults.push(`${key} is counted twice (entries ${once.get(key)} and ${e.seq})`);
    else once.set(key, e.seq);
  }

  const owedAccount = 0 - j.lines.filter((l) => l.account === ACCOUNTS.refundsOwed.code).reduce((n, l) => n + l.debitPaise - l.creditPaise, 0);
  const owedOpen = j.owedList().reduce((n, x) => n + x.paise, 0);
  if (owedAccount !== owedOpen) faults.push(`refunds owed holds ${owedAccount} paise, but the open refunds add up to ${owedOpen}`);
  if (owedAccount < 0) faults.push(`refunds owed is below nothing (${owedAccount} paise)`);

  // numbers: unique, and no gap a restore does not explain
  const restores = entries.filter((e) => e.action === RESTORED_ACTION).map((e) => e.seq);
  const runs = new Map<string, { n: number; seq: number; number: string }[]>();
  for (const d of j.documents) { const k = `${d.series}/${d.fy}`; runs.set(k, [...(runs.get(k) ?? []), { n: d.n, seq: d.seq, number: d.number }]); }
  for (const [k, docs] of runs) {
    docs.sort((a, b) => a.n - b.n);
    let prev = { n: 0, seq: 0 };
    for (const d of docs) {
      if (d.n === prev.n) faults.push(`${d.number} is used twice`);
      else if (d.n > prev.n + 1 && !restores.some((r) => r > prev.seq && r < d.seq)) faults.push(`${k}: numbers ${prev.n + 1} to ${d.n - 1} are missing and no restore explains it`);
      if (d.seq < prev.seq) faults.push(`${d.number} was issued before a lower number`);
      prev = { n: d.n, seq: d.seq };
    }
  }

  const secrets = (o.privateText ?? []).filter((t) => t.trim().length >= 3);
  const phones = phonesOf(entries);
  for (const e of entries) {
    // in key order, so the faults do not depend on the order the refs were written in (22 Nov; a Go map has no order, and the two runtimes list the same faults)
    for (const [k, v] of Object.entries(e.refs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (phones.some((p) => v.includes(p))) faults.push(`entry ${e.seq}: refs.${k} carries a customer's phone number`);
      for (const t of secrets) if (v.includes(t)) faults.push(`entry ${e.seq}: refs.${k} carries a private name`);
    }
  }
  return faults;
}

/**
 * The report's rows against its "Money this month" block, over the whole record: received in the books = received + paidTwice + markedReceived, and refunds made
 * (less a person's word) = refunds + markedGivenBack, with the owner's marks summed and left out. `refundAmountFromPayment`: as the template's report passes it.
 */
export function figuresFaults(entries: readonly RecordEntry[], legacy: LegacyMap, o: { refundAmountFromPayment?: boolean } = {}): string[] {
  const from = "1970-01-01T00:00:00.000Z", to = "2100-01-01T00:00:00.000Z";
  const j = journal(entries, legacy);
  const s = accountingSummary(j, from, to, entries);
  const books = (kind: string): number => s.byKind.find((k) => k.kind === kind)?.paise ?? 0;
  const out: string[] = [];
  for (const ownerMarks of [true, false]) {
    const f = figuresOf(j, entries, legacy, from, to, { ...o, ownerMarks });
    const b = f.booksOnly;
    const rows = f.received.paise + b.paidTwice.paise + b.markedReceived.paise;
    if (books("received") !== rows) out.push(`owner marks ${ownerMarks ? "counted" : "left out"}: the books received ${books("received")}, the rows and booksOnly ${rows}`);
    const back = f.refunds.paise + b.markedGivenBack.paise;
    if (books("refund_made") - s.byWord.paise !== back) out.push(`owner marks ${ownerMarks ? "counted" : "left out"}: the books gave back ${books("refund_made") - s.byWord.paise}, the rows and booksOnly ${back}`);
  }
  return out;
}
