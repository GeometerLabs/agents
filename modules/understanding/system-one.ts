// A client for the System One decisions API, over plain fetch and nothing else. A decision model does not write text: it is given a state
// (here, one customer message) and some questions, and answers each with a choice or a probability. That is exactly the question "what does
// this customer want, which of the shop's services, which of these times", so most messages need no language model at all.
//
// The wire (from pydantic-ai's models/system_one.py, read 5 Nov 2026):
//   POST {base}/v1/systemone   (or {base}/systemone when the base already ends in /v1)
//   body     { state, model, questions: { name: { type: "choice", criteria: { label: description }, instructions }
//                                       | { type: "noul", instructions } }, temperature? }
//   answer   { model, answers: { name: { type: "choice", choice, confidence, probabilities: { label: p } } | { type: "noul", noul: p } },
//              usage: { input_tokens, output_tokens } }
// `instructions` is required on every question. An answer is refused unless its names are the questions' names, its choice is one of the
// question's own labels, its probabilities are for exactly those labels, each is between 0 and 1, and they add up to 1 (a server may round to
// two decimals or send raw floats, so the sum may be off by 1e-6 plus half a hundredth for each option).
//
// Two ways to reach it, both this same client:
//   Laya (Apache-2.0 open weights), run on the shop's own server with `laya-serve`: a local URL, no key, nothing leaves the machine.
//   Jev (hosted): a URL and a key. The key is read from an environment variable by the caller and goes only into the Authorization header
//   here; it is never logged, never put in an error, and never stored.
// Creating a client makes no call.
import type { TokenUsage } from "./model.ts";

export interface ChoiceQuestion { type: "choice"; instructions: string; criteria: Record<string, string> }
/** A yes/no question; the answer is the probability of yes. */
export interface NoulQuestion { type: "noul"; instructions: string }
export type Question = ChoiceQuestion | NoulQuestion;

export interface ChoiceAnswer { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
export interface NoulAnswer { type: "noul"; noul: number }
export type Answer = ChoiceAnswer | NoulAnswer;

export interface Decision { model: string; answers: Record<string, Answer>; usage: TokenUsage }

export type SystemOneKind = "laya" | "jev" | "system-one";

export interface SystemOneConfig {
  /** The API's address, with or without a trailing /v1. */
  baseUrl: string;
  /** The name the API serves the model under ("laya", "clm-latest"). */
  model: string;
  /** Which service this is, for the record and the rate table. Default "system-one". */
  kind?: SystemOneKind;
  /** Sent as a bearer token when given. Laya on the shop's own server needs none. */
  apiKey?: string;
  /** How long to wait for the whole answer. Default 3000: a decision is a short call, and a slow one is better asked of the next step. */
  timeoutMs?: number;
}

export interface SystemOne {
  readonly kind: SystemOneKind;
  readonly model: string;
  decide(state: string, questions: Record<string, Question>): Promise<Decision>;
}

/** Why a call could not be used, in a few plain words. It never holds what the model said, a key, or the customer's message. */
export class SystemOneError extends Error {
  readonly timedOut: boolean;
  constructor(message: string, timedOut = false) { super(message); this.timedOut = timedOut; }
}

export const DEFAULT_DECISION_TIMEOUT_MS = 3000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isProbability = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Where the call goes. */
export function systemOneUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/u, "");
  return base.endsWith("/v1") ? `${base}/systemone` : `${base}/v1/systemone`;
}

/** The request body. Exported so the stand-in and the tests read the same shape. */
export function requestBody(state: string, model: string, questions: Record<string, Question>): Obj {
  return { state, model, questions };
}

const sameKeys = (a: string[], b: string[]) => a.length === b.length && a.every((k) => b.includes(k));

/** Check an answer the way the reference client does. Returns the decision, or the reason in plain words. */
export function readDecision(body: unknown, questions: Record<string, Question>): Decision | string {
  if (!isObj(body) || !isObj(body.answers) || typeof body.model !== "string") return "its reply was not what was expected";
  const names = Object.keys(questions);
  if (!sameKeys(Object.keys(body.answers), names)) return "its answers did not match the questions";
  const answers: Record<string, Answer> = {};
  for (const name of names) {
    const question = questions[name];
    const raw = body.answers[name];
    if (!isObj(raw) || raw.type !== question.type) return `its answer to "${name}" was not the kind asked for`;
    if (question.type === "noul") {
      if (!isProbability(raw.noul)) return `its answer to "${name}" was not a probability`;
      answers[name] = { type: "noul", noul: raw.noul };
      continue;
    }
    const labels = Object.keys(question.criteria);
    if (typeof raw.choice !== "string" || !labels.includes(raw.choice)) return `its choice for "${name}" was not one of the options`;
    if (!isObj(raw.probabilities) || !sameKeys(Object.keys(raw.probabilities), labels)) return `its probabilities for "${name}" were not for the options asked`;
    const probabilities: Record<string, number> = {};
    let sum = 0;
    for (const label of labels) {
      const p = raw.probabilities[label];
      if (!isProbability(p)) return `a probability for "${name}" was out of range`;
      probabilities[label] = p;
      sum += p;
    }
    if (Math.abs(sum - 1) > 1e-6 + labels.length * 0.005) return `the probabilities for "${name}" did not add up to 1`;
    if (!isProbability(raw.confidence)) return `its confidence for "${name}" was out of range`;
    answers[name] = { type: "choice", choice: raw.choice, confidence: raw.confidence, probabilities };
  }
  const usage = isObj(body.usage) ? body.usage : {};
  return { model: body.model, answers, usage: { inputTokens: isCount(usage.input_tokens) ? usage.input_tokens : 0, outputTokens: isCount(usage.output_tokens) ? usage.output_tokens : 0 } };
}

/** Creates the client. Nothing is sent until `decide` is called. */
export function createSystemOne(config: SystemOneConfig, fetchFn: typeof fetch = globalThis.fetch): SystemOne {
  if (!config.baseUrl || !config.model) throw new Error("Give the System One client a baseUrl and a model.");
  const url = systemOneUrl(config.baseUrl);
  const timeoutMs = config.timeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS;
  const kind = config.kind ?? "system-one";
  const apiKey = config.apiKey && config.apiKey.trim() !== "" ? config.apiKey.trim() : undefined;
  return {
    kind,
    model: config.model,
    async decide(state, questions) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      let response: Response;
      try {
        response = await fetchFn(url, { method: "POST", headers, body: JSON.stringify(requestBody(state, config.model, questions)), signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        const timedOut = ["TimeoutError", "AbortError"].includes((e as { name?: string } | null)?.name ?? "");
        throw new SystemOneError(timedOut ? `no answer within ${timeoutMs} ms` : "the connection failed", timedOut);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new SystemOneError(`the decision model answered HTTP ${response.status}`);
      }
      let body: unknown;
      try { body = await response.json(); } catch { throw new SystemOneError("its reply was not JSON"); }
      const decision = readDecision(body, questions);
      if (typeof decision === "string") throw new SystemOneError(decision);
      return decision;
    },
  };
}

/**
 * The client for the service a config names, with its key taken from the environment variable the config names (and sent only if it is set).
 * Laya has no key. Jev without a key is `null`, so the step is simply off: nothing is ever sent to a paid service without one.
 */
export function systemOneFromEnv(config: Omit<SystemOneConfig, "apiKey"> & { keyEnv?: string }, env: Record<string, string | undefined>, fetchFn?: typeof fetch): SystemOne | null {
  const key = config.keyEnv ? env[config.keyEnv] : undefined;
  if (config.kind === "jev" && (!key || key.trim() === "")) return null;
  const { keyEnv: _keyEnv, ...rest } = config;
  return createSystemOne({ ...rest, ...(key ? { apiKey: key } : {}) }, fetchFn);
}
