// The books summary of one period: the small, plain-data figure set that the signed monthly report carries and the open check (check.ts) re-adds.
//
// Why this file and not the report's own sums: the report must show money that matches the journal to the paisa, and anyone holding the evidence pack must be able to
// work out the same figures from the pack alone. So this is a pure function of the journal (journal.ts) and nothing else: no clock, no settings, no `node:` import, so
// a browser can run it too. Every figure is an integer number of paise (or a count), and every list is sorted in a fixed order, so the signed bytes are the same
// each time the same record is read.
//
// What it holds, for [fromIso, toIso):
//  - accounts: per account, the debits and credits of the period's lines (the same lines `balances()` adds up, which a test holds equal);
//  - byKind: per kind of money fact (received, refund_made, kept ...) how many record entries and how many paise moved. The page's "Money this month" block is
//    written from this and from `closing`, so it never needs an account name;
//  - closing: what is held at the period's END, over every line before `toIso` (not only the period's): the advances held for customers, the refunds still owed
//    back and what is still to come in (a fee's receivable), each as the amount the shop is holding or owed (never negative for the first two unless the books are
//    wrong, which then shows);
//  - documents: per series and financial year, the documents issued in the period: first number, last number, how many, and any numbers skipped (a restore moves a
//    series on; the skipped range is said, never hidden);
//  - byWord: the period's refunds made on a person's word only (evidence person_word: no provider's or owner's record shows the money moved). They are in byKind's
//    refund_made, as the journal holds them, and the page takes them OUT of "given back" and lists them on their own, the same rule as the owner's Money section
//    (owner-money.ts byWord), so the report and the owner's page never say two different "given back" figures;
//  - problems: how many of the period's record entries the journal could not read as money. It needs the record's entries only for their times (a problem names its
//    entry by number), so they are handed in.
import { journal as foldJournal } from "./journal.ts";
import type { Journal, LegacyMap } from "./journal.ts";
import { ACCOUNTS } from "./accounts.ts";
import { formatNumber } from "./numbers.ts";
import type { Series } from "./numbers.ts";
import type { RecordEntry } from "../record/record.ts";

export interface SummaryAccount { account: string; debitPaise: number; creditPaise: number }
export interface SummaryKind { kind: string; entries: number; paise: number }
export interface SummaryDocuments { series: Series; fy: string; first: string; last: string; count: number; skipped: { from: string; to: string }[] }
export interface AccountingSummary {
  accounts: SummaryAccount[];
  byKind: SummaryKind[];
  /** At the period's end: what the shop holds for customers, what it still owes back, and what is still to come in (a fee's receivable; negative when paid beyond it). */
  closing: { advancesPaise: number; refundsOwedPaise: number; receivablePaise: number };
  documents: SummaryDocuments[];
  /** Refunds made in the period on a person's word only: how many entries and how many paise (inside byKind's refund_made). */
  byWord: { entries: number; paise: number };
  problems: number;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0); // code-unit order, never a locale's

export function accountingSummary(journal: Journal, fromIso: string, toIso: string, entries: readonly RecordEntry[]): AccountingSummary {
  const inPeriod = (at: string): boolean => at >= fromIso && at < toIso;

  const accounts = new Map<string, SummaryAccount>();
  const kinds = new Map<string, { seqs: Set<number>; paise: number }>();
  const byWord = { seqs: new Set<number>(), paise: 0 };
  const closing = new Map<string, number>(); // debits less credits up to the period's end
  for (const l of journal.lines) {
    if (l.at >= toIso) continue;
    closing.set(l.account, (closing.get(l.account) ?? 0) + l.debitPaise - l.creditPaise);
    if (!inPeriod(l.at)) continue;
    const a = accounts.get(l.account) ?? { account: l.account, debitPaise: 0, creditPaise: 0 };
    a.debitPaise += l.debitPaise;
    a.creditPaise += l.creditPaise;
    accounts.set(l.account, a);
    const k = kinds.get(l.kind) ?? { seqs: new Set<number>(), paise: 0 };
    k.seqs.add(l.seq);
    k.paise += l.debitPaise; // every entry balances, so what it moved is the sum of its debits
    kinds.set(l.kind, k);
    if (l.kind === "refund_made" && l.evidence === "person_word") { byWord.seqs.add(l.seq); byWord.paise += l.debitPaise; }
  }
  const held = (account: string): number => closing.get(account) ?? 0;

  // documents: by series and year, the numbers issued in the period, and the gaps in the run that this period's documents sit at the end of
  const groups = new Map<string, { series: Series; fy: string; mine: number[]; all: number[] }>();
  for (const d of journal.documents) {
    if (d.at >= toIso) continue;
    const key = `${d.series}|${d.fy}`;
    const g = groups.get(key) ?? { series: d.series, fy: d.fy, mine: [], all: [] };
    g.all.push(d.n);
    if (inPeriod(d.at)) g.mine.push(d.n);
    groups.set(key, g);
  }
  const documents: SummaryDocuments[] = [];
  for (const key of [...groups.keys()].sort(byText)) {
    const g = groups.get(key)!;
    if (g.mine.length === 0) continue;
    const all = [...new Set(g.all)].sort((x, y) => x - y);
    const mine = new Set(g.mine);
    const skipped: { from: string; to: string }[] = [];
    for (let i = 1; i < all.length; i++) {
      if (all[i] - all[i - 1] > 1 && mine.has(all[i])) skipped.push({ from: formatNumber({ series: g.series, fy: g.fy, n: all[i - 1] + 1 }), to: formatNumber({ series: g.series, fy: g.fy, n: all[i] - 1 }) });
    }
    const sorted = [...mine].sort((x, y) => x - y);
    documents.push({ series: g.series, fy: g.fy, first: formatNumber({ series: g.series, fy: g.fy, n: sorted[0] }), last: formatNumber({ series: g.series, fy: g.fy, n: sorted[sorted.length - 1] }), count: g.mine.length, skipped });
  }

  const timeOf = new Map(entries.map((e) => [e.seq, e.time]));
  const problems = journal.problems.filter((p) => { const t = timeOf.get(p.seq); return t !== undefined && inPeriod(t); }).length;

  return {
    accounts: [...accounts.values()].sort((x, y) => byText(x.account, y.account)),
    byKind: [...kinds].map(([kind, k]) => ({ kind, entries: k.seqs.size, paise: k.paise })).sort((x, y) => byText(x.kind, y.kind)),
    closing: {
      advancesPaise: 0 - held(ACCOUNTS.advances.code), // 0 - x, not -x: no -0 in the signed bytes
      refundsOwedPaise: 0 - held(ACCOUNTS.refundsOwed.code),
      receivablePaise: held(ACCOUNTS.receivable.code) + 0,
    },
    documents,
    byWord: { entries: byWord.seqs.size, paise: byWord.paise },
    problems,
  };
}

/**
 * What a template's report data carries as `accounting`: the summary and the template's frozen legacy map (so the open check can read an older line without importing a
 * template). `undefined` when the whole record has no money lines at all, so the report then leaves the field out and every report made before keeps its bytes.
 * `entries` is the record up to the period's end; the check folds the pack's entries the same way and must get the same figures.
 */
export function reportAccounting(entries: readonly RecordEntry[], legacy: LegacyMap, fromIso: string, toIso: string): { summary: AccountingSummary; legacy: LegacyMap } | undefined {
  const j = foldJournal(entries, legacy);
  if (j.lines.length === 0) return undefined;
  return { summary: accountingSummary(j, fromIso, toIso, entries), legacy };
}
