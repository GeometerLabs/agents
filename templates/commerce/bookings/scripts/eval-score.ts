// Scoring for scripts/model-eval.ts: is a parser's answer the labelled one, and the numbers and the plain table built from
// many answers. Pure functions with no network and no files, so a test can feed them made-up answers.
import type { Intent } from "../src/adapters/model.ts";
import type { TokenUsage } from "../../../../modules/understanding/model.ts";
import type { TimePhrase } from "../../../../modules/language/dates.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";

export interface EvalMessage { id: string; language: Language; text: string; expected: Intent }

/** The six fields an answer is judged on. `language` is reported too, but is not part of "right": a bare "ok" says nothing about it. */
export const FIELDS = ["kind", "serviceId", "date", "time", "offerInr", "overrideAttempt"] as const;
export type Field = (typeof FIELDS)[number];

/** A time for comparing: 6 pm and 18:00 are the same time, but "6" with no am/pm is not (it is still to be confirmed). */
function timeKey(t: TimePhrase | undefined): string {
  if (!t) return "none";
  if (t.period === "pm") return `${t.hour === 12 ? 12 : t.hour + 12}:${t.minute}:sure`;
  if (t.period === "am") return `${t.hour === 12 ? 0 : t.hour}:${t.minute}:sure`;
  return `${t.hour}:${t.minute}:${t.hour === 0 || t.hour >= 12 ? "sure" : "unsure"}`;
}

const dateKey = (d: Intent["date"]): string => (d ? JSON.stringify(Object.keys(d).sort().map((k) => [k, (d as unknown as Record<string, unknown>)[k]])) : "none");

/** Which of the six fields the answer got right. Absent and absent agree; overrideAttempt absent means false. */
export function compareIntent(expected: Intent, got: Intent): Record<Field, boolean> {
  return {
    kind: expected.kind === got.kind,
    serviceId: expected.serviceId === got.serviceId,
    date: dateKey(expected.date) === dateKey(got.date),
    time: timeKey(expected.time) === timeKey(got.time),
    offerInr: expected.offerInr === got.offerInr,
    overrideAttempt: (expected.overrideAttempt === true) === (got.overrideAttempt === true),
  };
}

/** One message's result for one parser. */
export interface Row {
  id: string;
  language: Language;
  fields: Record<Field, boolean>;
  allRight: boolean;
  /** Only when the label names a language. */
  languageRight?: boolean;
  fellBack: boolean;
  reason?: string;
  latencyMs: number;
  usage?: TokenUsage;
}

export function scoreRow(message: EvalMessage, got: Intent, extra: { fellBack: boolean; reason?: string; latencyMs: number; usage?: TokenUsage }): Row {
  const fields = compareIntent(message.expected, got);
  return {
    id: message.id, language: message.language, fields, allRight: FIELDS.every((f) => fields[f]),
    ...(message.expected.language ? { languageRight: message.expected.language === got.language } : {}),
    ...extra,
  };
}

/** The p-th percentile (nearest rank) of some numbers; 0 for none. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export interface Summary {
  name: string;
  messages: number;
  right: number;
  /** Messages the model itself answered (not read by the rule parser after a failure), and how many of those were right. */
  answered: number;
  answeredRight: number;
  byLanguage: Record<Language, { right: number; messages: number }>;
  byField: Record<Field, number>;
  language: { right: number; messages: number };
  fallbacks: number;
  reasons: Record<string, number>;
  p50Ms: number;
  p95Ms: number;
  tokensIn: number;
  tokensOut: number;
  missed: string[];
}

export function summarise(name: string, rows: Row[]): Summary {
  const byLanguage = Object.fromEntries(LANGUAGES.map((l) => [l, { right: 0, messages: 0 }])) as Summary["byLanguage"];
  const byField = Object.fromEntries(FIELDS.map((f) => [f, 0])) as Summary["byField"];
  const summary: Summary = {
    name, messages: rows.length, right: 0, answered: 0, answeredRight: 0, byLanguage, byField, language: { right: 0, messages: 0 },
    fallbacks: 0, reasons: {}, p50Ms: percentile(rows.map((r) => r.latencyMs), 50), p95Ms: percentile(rows.map((r) => r.latencyMs), 95),
    tokensIn: 0, tokensOut: 0, missed: [],
  };
  for (const r of rows) {
    byLanguage[r.language].messages += 1;
    if (r.allRight) { summary.right += 1; byLanguage[r.language].right += 1; } else summary.missed.push(r.id);
    for (const f of FIELDS) if (r.fields[f]) byField[f] += 1;
    if (r.languageRight !== undefined) { summary.language.messages += 1; if (r.languageRight) summary.language.right += 1; }
    if (r.fellBack) { summary.fallbacks += 1; summary.reasons[r.reason ?? "unknown"] = (summary.reasons[r.reason ?? "unknown"] ?? 0) + 1; }
    else { summary.answered += 1; if (r.allRight) summary.answeredRight += 1; }
    summary.tokensIn += r.usage?.inputTokens ?? 0;
    summary.tokensOut += r.usage?.outputTokens ?? 0;
  }
  return summary;
}

/** Dollars (or whatever currency the prices are in) per 1,000 messages, from the tokens the API reported; null when a price is not filled in. */
export function costPer1000(s: Summary, priceIn: number | null, priceOut: number | null): number | null {
  if (priceIn === null || priceOut === null || s.messages === 0) return null;
  return ((s.tokensIn * priceIn + s.tokensOut * priceOut) / 1_000_000 / s.messages) * 1000;
}

const pct = (n: number, of: number) => (of === 0 ? "-" : `${((100 * n) / of).toFixed(1)}%`);
const ms = (n: number) => `${Math.round(n)} ms`;

/** One plain table: a row per measure, a column per parser. `costs` is the cost per 1,000 messages for each column, or null. */
export function formatTable(summaries: Summary[], costs: (number | null)[]): string {
  const rows: [string, (s: Summary, i: number) => string][] = [
    ["all six fields right (all messages)", (s) => pct(s.right, s.messages)],
    ["  only where the model answered", (s) => (s.answered === s.messages ? "same" : pct(s.answeredRight, s.answered))],
    ...LANGUAGES.map((l): [string, (s: Summary) => string] => [`  ${l} messages`, (s) => pct(s.byLanguage[l].right, s.byLanguage[l].messages)]),
    ...FIELDS.map((f): [string, (s: Summary) => string] => [`  field ${f}`, (s) => pct(s.byField[f], s.messages)]),
    ["  language field (not in the total)", (s) => pct(s.language.right, s.language.messages)],
    ["fell back to the rule parser", (s) => (s.name === "rule parser" ? "-" : pct(s.fallbacks, s.messages))],
    ["latency p50", (s) => ms(s.p50Ms)],
    ["latency p95", (s) => ms(s.p95Ms)],
    ["tokens in / out (all calls)", (s) => (s.tokensIn + s.tokensOut === 0 ? "-" : `${s.tokensIn} / ${s.tokensOut}`)],
    ["cost per 1,000 messages", (s, i) => (s.name === "rule parser" ? "0" : costs[i] === null ? "no price set" : costs[i]!.toFixed(4))],
  ];
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  const columns = summaries.map((s, i) => Math.max(14, s.name.length + 2, ...rows.map(([, value]) => value(s, i).length + 2)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(width) : c.padStart(columns[i - 1]))).join("");
  return [line(["", ...summaries.map((s) => s.name)]), ...rows.map(([label, value]) => line([label, ...summaries.map((s, i) => value(s, i))]))].join("\n");
}
