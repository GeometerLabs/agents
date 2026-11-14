// The open check of a signed monthly report's books summary: it re-adds the journal from the evidence pack alone and compares the result with the summary the report carries,
// field by field, to the paisa.
//
//   node modules/accounting/check.ts <pack.json> <report.json>      exit 0: everything matches; 1: something differs; 2: a file could not be read or is not what it says
//
// What it reads: the evidence pack (record/ledger.ts: each entry's body is the record entry's own fields without its conversation, notes and refs.page, which the journal never
// reads, so the entries can be rebuilt from the bodies), and from the report its period, its `anchor` (the record's last entry number and hash when the report was made) and its
// `accounting` field (the summary and the template's frozen legacy map, so no template is imported here). It reads no settings and no names.
//
// What it does NOT do, and says so: it does not check the hash chain or the signatures. That is geometer-verify's to do (`geo-verify pack.json --anchor anchor.json`). This
// script checks the arithmetic, and that the pack runs up to the report's anchor with the same head hash there, so the report was made from this record.
//
// Layout: the first part is pure (no `node:` import, so a browser can run it on a pack and a report the person chose); only `main` at the bottom reads files.
import { journal } from "./journal.ts";
import type { LegacyMap } from "./journal.ts";
import { accountingSummary } from "./summary.ts";
import type { AccountingSummary } from "./summary.ts";
import type { RecordEntry } from "../record/record.ts";

/** A file that is not what it says it is (not an evidence pack, not a report, no summary where one is needed). The CLI exits 2 on it. */
export class BadInput extends Error {}

export interface CheckLine { ok: boolean; text: string }
export interface CheckResult { ok: boolean; lines: CheckLine[] }

const BODY_TYPE = "geometer.agent-record-entry/1"; // modules/record/ledger.ts BODY_TYPE, repeated so this file imports nothing that needs node:crypto
const PACK_FORMAT = "geometer.evidence-pack";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const need = (cond: unknown, why: string): void => { if (!cond) throw new BadInput(why); };

/** The record's entries rebuilt from a pack's bodies, oldest first. The three fields a body leaves out are empty: the journal never reads them. */
export function entriesOfPack(pack: unknown): { entries: RecordEntry[]; hashes: Map<number, string>; tenant: string } {
  need(isObj(pack) && pack.format === PACK_FORMAT && Array.isArray(pack.entries), `This is not an evidence pack (its format is not "${PACK_FORMAT}" with a list of entries).`);
  const p = pack as { entries: unknown[]; tenant?: unknown };
  const entries: RecordEntry[] = [];
  const hashes = new Map<number, string>();
  for (const raw of p.entries) {
    need(isObj(raw) && typeof raw.body === "string" && typeof raw.seq === "string" && typeof raw.hash === "string", "An entry of the pack has no seq, hash or body.");
    const e = raw as { body: string; seq: string; hash: string; body_type?: unknown };
    need(e.body_type === BODY_TYPE, `Entry ${e.seq} is a "${String(e.body_type)}", not an agent record entry ("${BODY_TYPE}"), so this check cannot read it.`);
    let b: unknown;
    try { b = JSON.parse(e.body); } catch { throw new BadInput(`The body of entry ${e.seq} is not readable JSON.`); }
    need(isObj(b) && Number.isInteger(b.seq) && typeof b.time === "string" && typeof b.action === "string" && typeof b.outcome === "string", `The body of entry ${e.seq} is not a record entry.`);
    const r = b as Record<string, unknown>;
    need(Number(e.seq) === r.seq, `Entry ${e.seq}'s body says it is entry ${String(r.seq)}.`);
    entries.push({
      seq: r.seq as number, time: r.time as string, conversation: "", booking: typeof r.booking === "string" ? r.booking : null, action: r.action as string,
      inputsDigest: typeof r.inputsDigest === "string" ? r.inputsDigest : "", outcome: r.outcome as RecordEntry["outcome"], decisions: Array.isArray(r.decisions) ? r.decisions as RecordEntry["decisions"] : [],
      language: (r.language as RecordEntry["language"]) ?? "en", notes: "", refs: isObj(r.refs) ? r.refs as Record<string, string> : {},
    });
    hashes.set(r.seq as number, e.hash);
  }
  entries.sort((a, b) => a.seq - b.seq);
  return { entries, hashes, tenant: typeof p.tenant === "string" ? p.tenant : "" };
}

const rupees = (paise: number): string => `${paise < 0 ? "-" : ""}₹${Math.trunc(Math.abs(paise) / 100)}.${String(Math.abs(paise) % 100).padStart(2, "0")}`;

/** Both sides of one figure, said in plain words. */
function figure(out: CheckLine[], what: string, report: number, pack: number): void {
  out.push(report === pack ? { ok: true, text: `${what}: ${rupees(report)}, the same in the report and in the pack.` } : { ok: false, text: `${what}: the report says ${rupees(report)} but the pack adds up to ${rupees(pack)}.` });
}

function compare(report: AccountingSummary, pack: AccountingSummary): CheckLine[] {
  const out: CheckLine[] = [];
  const codes = [...new Set([...report.accounts.map((a) => a.account), ...pack.accounts.map((a) => a.account)])].sort();
  for (const code of codes) {
    const r = report.accounts.find((a) => a.account === code) ?? { debitPaise: 0, creditPaise: 0 };
    const k = pack.accounts.find((a) => a.account === code) ?? { debitPaise: 0, creditPaise: 0 };
    figure(out, `Account "${code}", debits`, r.debitPaise, k.debitPaise);
    figure(out, `Account "${code}", credits`, r.creditPaise, k.creditPaise);
  }
  const kinds = [...new Set([...report.byKind.map((a) => a.kind), ...pack.byKind.map((a) => a.kind)])].sort();
  for (const kind of kinds) {
    const r = report.byKind.find((a) => a.kind === kind) ?? { entries: 0, paise: 0 };
    const k = pack.byKind.find((a) => a.kind === kind) ?? { entries: 0, paise: 0 };
    figure(out, `Money of kind "${kind}"`, r.paise, k.paise);
    out.push(r.entries === k.entries ? { ok: true, text: `Entries of kind "${kind}": ${r.entries}, the same.` } : { ok: false, text: `Entries of kind "${kind}": the report says ${r.entries} but the pack has ${k.entries}.` });
  }
  figure(out, "Advances held at the month's end", report.closing.advancesPaise, pack.closing.advancesPaise);
  figure(out, "Refunds still owed back at the month's end", report.closing.refundsOwedPaise, pack.closing.refundsOwedPaise);
  figure(out, "Still to come in at the month's end", report.closing.receivablePaise, pack.closing.receivablePaise);
  const docKey = (d: { series: string; fy: string }) => `${d.series} ${d.fy}`;
  const keys = [...new Set([...report.documents.map(docKey), ...pack.documents.map(docKey)])].sort();
  for (const key of keys) {
    const r = report.documents.find((d) => docKey(d) === key);
    const k = pack.documents.find((d) => docKey(d) === key);
    const same = r !== undefined && k !== undefined && JSON.stringify(r) === JSON.stringify(k);
    const say = (d: typeof r) => (d ? `${d.count} from ${d.first} to ${d.last}${d.skipped.length ? `, skipping ${d.skipped.map((s) => `${s.from} to ${s.to}`).join(", ")}` : ""}` : "none");
    out.push(same ? { ok: true, text: `Documents ${key}: ${say(r)}, the same.` } : { ok: false, text: `Documents ${key}: the report says ${say(r)} but the pack gives ${say(k)}.` });
  }
  out.push(report.problems === pack.problems ? { ok: true, text: `Entries that could not be read as money: ${report.problems}, the same.` } : { ok: false, text: `Entries that could not be read as money: the report says ${report.problems} but the pack gives ${pack.problems}.` });
  return out;
}

function summaryOf(v: unknown): AccountingSummary {
  const s = v as AccountingSummary | undefined;
  const ints = (xs: unknown[]) => xs.every((n) => Number.isSafeInteger(n));
  need(isObj(s) && Array.isArray(s.accounts) && Array.isArray(s.byKind) && Array.isArray(s.documents) && isObj(s.closing) && Number.isSafeInteger(s.problems), "The report's books summary is not in the shape this check reads.");
  need(s!.accounts.every((a) => isObj(a) && typeof a.account === "string" && ints([a.debitPaise, a.creditPaise])) && s!.byKind.every((k) => isObj(k) && typeof k.kind === "string" && ints([k.entries, k.paise])), "The report's books summary has a figure that is not a whole number of paise.");
  need(ints([s!.closing.advancesPaise, s!.closing.refundsOwedPaise, s!.closing.receivablePaise]), "The report's closing balances are not whole numbers of paise.");
  need(s!.documents.every((d) => isObj(d) && typeof d.series === "string" && typeof d.fy === "string" && typeof d.first === "string" && typeof d.last === "string" && Number.isSafeInteger(d.count) && Array.isArray(d.skipped)), "The report's document list is not in the shape this check reads.");
  return s!;
}

/** The report's signed data: a signed file is `{ document, signature ... }`, a bare document is accepted too. */
function documentOf(report: unknown): Record<string, unknown> {
  need(isObj(report), "The report is not a JSON object.");
  const r = report as Record<string, unknown>;
  const doc = isObj(r.document) ? r.document : r;
  need(isObj(doc.period) && typeof doc.period.from === "string" && typeof doc.period.to === "string" && Number.isFinite(Date.parse(doc.period.from)) && Number.isFinite(Date.parse(doc.period.to)), "The report has no period (from and to).");
  return doc;
}

/** Re-add the journal from the pack and compare it with the report's books summary. Throws BadInput for a file that is not what it says it is. */
export function checkAccounting(pack: unknown, report: unknown): CheckResult {
  const doc = documentOf(report);
  const period = doc.period as { from: string; to: string };
  const { entries, hashes, tenant } = entriesOfPack(pack);
  const lines: CheckLine[] = [];
  const add = (ok: boolean, text: string) => lines.push({ ok, text });

  // 1. Was the report made from this record: the pack runs up to the report's anchor and has the same head hash there.
  const anchor = doc.anchor;
  let upTo = Infinity;
  if (!isObj(anchor) || !Number.isSafeInteger(anchor.seq) || typeof anchor.head !== "string") {
    add(false, "The report names no record head (it was made without a ledger), so this check cannot tell that it was made from this record. It adds up the whole pack instead.");
  } else {
    const seq = anchor.seq as number;
    upTo = seq;
    const last = entries.at(-1)?.seq ?? 0;
    const gap = entries.findIndex((e, i) => e.seq !== i + 1);
    if (gap >= 0) add(false, `The pack's entries do not run 1, 2, 3 ...: entry ${gap + 1} is missing or repeated.`);
    else if (last < seq) add(false, `The pack stops at entry ${last}, before the report's record head at entry ${seq}. It was cut short, so it cannot show what the report was made from.`);
    else if (hashes.get(seq) !== anchor.head) add(false, `At entry ${seq} the pack's head hash is not the one the report names. The pack and the report are not of the same record.`);
    else add(true, `The pack runs to entry ${last}, and at entry ${seq} its head hash is the report's: the report was made from this record.`);
    if (typeof anchor.tenant === "string" && tenant !== "" && anchor.tenant !== tenant) add(false, `The report is for "${anchor.tenant}" but the pack is for "${tenant}".`);
  }

  // 2. The same input the report was made from: the entries up to the anchor, and before the period's end.
  const toMs = Date.parse(period.to);
  const used = entries.filter((e) => e.seq <= upTo && Date.parse(e.time) < toMs);
  const acc = doc.accounting as { summary?: unknown; legacy?: unknown } | undefined;
  if (acc === undefined) {
    // a report with no summary is right only for a record with no money at all (the field is left out then)
    const j = journal(used, { received: [] });
    add(j.lines.length === 0, j.lines.length === 0 ? "The report has no books summary and the pack has no money lines: nothing to compare." : "The report has no books summary, but the pack has money lines. Either the report was made before the books summary existed, or it left the money out; this check cannot tell which. (Money lines made before the books summary are read with the template's list of its own older action names, which only a report with a summary carries.)");
  } else {
    need(isObj(acc) && isObj(acc.legacy) && Array.isArray(acc.legacy.received), "The report's books summary carries no readable legacy map, so older lines cannot be read.");
    const reported = summaryOf(acc.summary);
    const j = journal(used, acc.legacy as unknown as LegacyMap);
    if (j.lines.length === 0) add(false, "The pack has no money lines, but the report carries a books summary.");
    const mine = accountingSummary(j, period.from, period.to, used);
    lines.push(...compare(reported, mine));
  }

  add(true, "Not checked here: the hash chain and the signatures. That is geometer-verify's: geo-verify pack.json --anchor anchor.json. This script checks the arithmetic.");
  // the last line is a note, not a result: it never makes the check fail
  return { ok: lines.slice(0, -1).every((l) => l.ok), lines };
}

/** The result as plain lines: what matches, what does not, and the verdict. */
export function renderCheck(result: CheckResult): string {
  const body = result.lines.map((l, i) => (i === result.lines.length - 1 ? `Note: ${l.text}` : `${l.ok ? "matches" : "DIFFERENT"}: ${l.text}`));
  return `${body.join("\n")}\n\n${result.ok ? "Everything matches: the report's money figures are what the pack adds up to." : "Something does not match. Do not rely on the report's money figures until it is explained."}\n`;
}

// ---- the command line (the only part that needs node) ----------------------------------------------------------------------------------------------------------
async function main(argv: string[]): Promise<number> {
  const [packPath, reportPath] = argv;
  if (!packPath || !reportPath) { process.stderr.write("Usage: node modules/accounting/check.ts <pack.json> <report.json>\n"); return 2; }
  const { readFileSync } = await import("node:fs");
  const read = (path: string): unknown => {
    let text: string;
    try { text = readFileSync(path, "utf8"); } catch { throw new BadInput(`${path} could not be read.`); }
    try { return JSON.parse(text); } catch { throw new BadInput(`${path} is not JSON.`); }
  };
  try {
    const result = checkAccounting(read(packPath), read(reportPath));
    process.stdout.write(renderCheck(result));
    return result.ok ? 0 : 1;
  } catch (err) {
    if (!(err instanceof BadInput)) throw err;
    process.stderr.write(`${err.message}\n`);
    return 2;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
