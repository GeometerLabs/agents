// Picks the one model Geometer bundles (decision 6 of the implementation plan): runs the rule parser (the baseline) and every
// candidate in eval/models.json over the labelled customer messages in eval/messages.jsonl, and prints one plain table.
//   node pathways/bookings/scripts/model-eval.ts                       the baseline, plus every candidate whose key is in .env
//   node pathways/bookings/scripts/model-eval.ts --max-messages 40    send only 40 messages (spread over the four languages) to each model
//   node pathways/bookings/scripts/model-eval.ts --only claude-haiku-5-5 --only gemini-flash-lite
// This is the founder's own tooling, run on a laptop. Keys come from a local .env at the repo root and are sent from here
// only (scripts/eval-keys.ts); the runtime parser sends none. A candidate whose key is not in .env is skipped with a line
// saying so, and with no keys at all only the baseline runs. Nothing is written outside this pathway except eval/results.json,
// which git ignores. Each model call costs a little: --max-messages caps it, and the token totals are printed.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { coerceIntent } from "../src/adapters/model.ts";
import { createModelParser } from "../src/adapters/model-llm.ts";
import type { ModelConfig } from "../src/adapters/model-llm.ts";
import { createRuleParser } from "../src/adapters/rule-parser.ts";
import { glowSalon } from "../src/harness.ts";
import { LANGUAGES } from "../src/settings.ts";
import { keyedFetch, readEnvFile } from "./eval-keys.ts";
import type { AuthHeader } from "./eval-keys.ts";
import { costPer1000, formatTable, scoreRow, summarise } from "./eval-score.ts";
import type { EvalMessage, Row, Summary } from "./eval-score.ts";

/** One model to try. Prices are per million tokens, in US dollars, filled in from the provider's current price page. */
export interface Candidate extends Omit<ModelConfig, "wire"> {
  name: string;
  wire: ModelConfig["wire"];
  /** The name of the variable in .env that holds this provider's key. */
  keyEnv: string;
  /** How the key is sent. Default: x-api-key for the anthropic wire, authorization (Bearer) for the openai wire. */
  authHeader?: AuthHeader;
  /** Wait this long between calls, for providers with a low rate limit. */
  pauseMs?: number;
  priceInputPerMillion: number | null;
  priceOutputPerMillion: number | null;
  note?: string;
}

export interface EvalOptions {
  messagesPath?: URL | string;
  modelsPath?: URL | string;
  /** The .env to read keys from. Default: the repo root's. */
  envPath?: URL | string;
  /** Use these keys instead of reading a .env (tests). */
  env?: Record<string, string>;
  /** Use these candidates instead of reading models.json (tests). */
  models?: Candidate[];
  maxMessages?: number;
  only?: string[];
  baselineOnly?: boolean;
  /** Where to write the full results; null for nowhere. Default: eval/results.json. */
  resultsPath?: URL | string | null;
  fetchFn?: typeof fetch;
  log?: (line: string) => void;
}

const EVAL_DIR = new URL("../eval/", import.meta.url);
const salon = glowSalon();
const context = { services: salon.services, languages: salon.languages };

/** The labelled messages. A label that is not a valid Intent for this shop is a mistake in the file, and stops the run. */
export function loadMessages(path: URL | string = new URL("messages.jsonl", EVAL_DIR)): EvalMessage[] {
  const messages = readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#")).map((l, i) => {
    const m = JSON.parse(l) as EvalMessage;
    if (typeof m.id !== "string" || typeof m.text !== "string" || !LANGUAGES.includes(m.language) || coerceIntent(m.expected, context) === null) throw new Error(`Eval message ${i + 1} (${m.id ?? "no id"}) is not a valid labelled message.`);
    return m;
  });
  if (new Set(messages.map((m) => m.id)).size !== messages.length) throw new Error("Two eval messages share an id.");
  return messages;
}

/** At most `max` messages, taken in turn from each language so every language is still tested. */
export function pickMessages(messages: EvalMessage[], max: number | undefined): EvalMessage[] {
  if (max === undefined || max >= messages.length) return messages;
  const queues = LANGUAGES.map((l) => messages.filter((m) => m.language === l));
  const picked: EvalMessage[] = [];
  for (let i = 0; picked.length < max; i++) for (const q of queues) if (q[i] && picked.length < max) picked.push(q[i]);
  return picked;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const count = (n: number, what: string) => `${n} ${what}`;

export async function runEval(options: EvalOptions = {}): Promise<{ summaries: Summary[]; skipped: string[]; table: string }> {
  const log = options.log ?? console.log;
  const messages = pickMessages(loadMessages(options.messagesPath), options.maxMessages);
  const candidates = options.models ?? (JSON.parse(readFileSync(options.modelsPath ?? new URL("models.json", EVAL_DIR), "utf8")) as { candidates: Candidate[] }).candidates;
  const env = options.env ?? readEnvFile(options.envPath ?? new URL("../../../.env", import.meta.url));
  const perLanguage = LANGUAGES.map((l) => `${l} ${messages.filter((m) => m.language === l).length}`).join(", ");

  log("Bookings model eval. The labels are machine-written and not yet reviewed by native speakers (eval/messages.jsonl).");
  log(`${count(messages.length, "messages")} (${perLanguage}), read against ${salon.name}'s services. The rule parser is the baseline.`);

  const columns: { name: string; rows: Row[]; candidate?: Candidate }[] = [];
  const skipped: string[] = [];

  const rule = createRuleParser();
  const ruleRows: Row[] = [];
  for (const m of messages) {
    const started = performance.now();
    const got = await rule.parse(m.text, context);
    ruleRows.push(scoreRow(m, got, { fellBack: false, latencyMs: performance.now() - started }));
  }
  columns.push({ name: "rule parser", rows: ruleRows });

  for (const candidate of candidates) {
    if (options.baselineOnly || (options.only?.length && !options.only.includes(candidate.name))) continue;
    const key = env[candidate.keyEnv];
    if (!key) { skipped.push(`Skipped ${candidate.name}: no ${candidate.keyEnv} in .env.`); continue; }
    log(`Asking ${candidate.name} (${candidate.model}) about ${count(messages.length, "messages")}, one at a time...`);
    const header: AuthHeader = candidate.authHeader ?? (candidate.wire === "anthropic" ? "x-api-key" : "authorization");
    const { name: _name, keyEnv: _keyEnv, authHeader: _auth, pauseMs: _pause, priceInputPerMillion: _pi, priceOutputPerMillion: _po, note: _note, ...config } = candidate;
    const parser = createModelParser(config, keyedFetch(header, key, options.fetchFn));
    const rows: Row[] = [];
    for (const m of messages) {
      const r = await parser.parseDetailed(m.text, context);
      rows.push(scoreRow(m, r.intent, { fellBack: r.fallbackReason !== undefined, reason: r.fallbackReason, latencyMs: r.latencyMs ?? 0, usage: r.usage }));
      if (candidate.pauseMs) await sleep(candidate.pauseMs);
    }
    columns.push({ name: candidate.name, rows, candidate });
  }

  const summaries = columns.map((c) => summarise(c.name, c.rows));
  const costs = columns.map((c, i) => (c.candidate ? costPer1000(summaries[i], c.candidate.priceInputPerMillion, c.candidate.priceOutputPerMillion) : 0));
  const table = formatTable(summaries, costs);
  log("");
  for (const line of skipped) log(line);
  if (columns.length === 1) log("No model keys found in .env, so only the rule parser baseline ran. To test a model, put its key in .env (README: Choose the model).");
  log("");
  log(table);
  log("");
  for (const s of summaries) {
    log(`Missed by ${s.name}: ${s.missed.length === 0 ? "none" : s.missed.join(" ")}`);
    if (s.fallbacks > 0) log(`  fell back ${s.fallbacks} times: ${Object.entries(s.reasons).map(([why, n]) => `${why} (${n})`).join("; ")}`);
  }
  const used = summaries.slice(1);
  if (used.length > 0) {
    log("");
    log(`Tokens used by this run: ${used.reduce((n, s) => n + s.tokensIn, 0)} in, ${used.reduce((n, s) => n + s.tokensOut, 0)} out, over ${count(messages.length * used.length, "calls")}. Use --max-messages to send fewer.`);
    const unpriced = columns.filter((c) => c.candidate && costs[columns.indexOf(c)] === null).map((c) => c.name);
    if (unpriced.length > 0) log(`No price filled in for ${unpriced.join(", ")}: fill from the provider's current price page in eval/models.json.`);
  }

  const resultsPath = options.resultsPath === undefined ? new URL("results.json", EVAL_DIR) : options.resultsPath;
  if (resultsPath !== null) {
    writeFileSync(resultsPath, `${JSON.stringify({ messages: messages.length, candidates: columns.map((c, i) => ({ name: c.name, summary: summaries[i], rows: c.rows })) }, null, 1)}\n`);
    log(`Full results: eval/results.json (git ignores it).`);
  }
  return { summaries, skipped, table };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { "max-messages": { type: "string" }, only: { type: "string", multiple: true }, "baseline-only": { type: "boolean" }, "no-results": { type: "boolean" }, help: { type: "boolean" } } });
  if (values.help) {
    console.log("node pathways/bookings/scripts/model-eval.ts [--max-messages N] [--only NAME]... [--baseline-only] [--no-results]");
  } else {
    const max = values["max-messages"] === undefined ? undefined : Number(values["max-messages"]);
    if (max !== undefined && (!Number.isInteger(max) || max < 1)) { console.error("--max-messages must be a whole number, 1 or more."); process.exit(1); }
    await runEval({ maxMessages: max, only: values.only, baselineOnly: values["baseline-only"], resultsPath: values["no-results"] ? null : undefined });
  }
}
