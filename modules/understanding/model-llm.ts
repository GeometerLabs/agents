// An IntentParser that asks a model over HTTP, for any template. The model only READS: it turns one message into an intent, and everything it says is
// checked by the template's own `coerce` (modules/understanding/model.ts, Reading) before the agent sees it. Two wire shapes:
//   "openai"    OpenAI-compatible chat completions with JSON output. One shape for OpenAI, Gemini's OpenAI-compatible endpoint,
//               Sarvam, Groq and Geometer's own model gateway.
//   "anthropic" the Anthropic Messages API, with structured output (output_config.format).
//
// NO KEY LIVES HERE. This parser sends no Authorization header and no API key. In production `baseUrl` is a Guard instance
// in front of the model provider, and Guard adds the key. Only the founder's own eval script (scripts/model-eval.ts) gives
// it a fetch that adds a key, from a local .env.
//
// When the model cannot be used (no answer in time, an HTTP error, a reply that is not JSON, or JSON that is not a valid
// intent) the message is read by the rule parser instead, and the reason is passed on so the record can note it. The reason
// is a few plain words and never contains what the model said, because that can echo the customer's message.
import type { IntentBase, IntentParser, ParseOptionsBase, ParseResult, Reading, TokenUsage } from "./model.ts";
import { isObj } from "./model.ts";

export interface ModelConfig {
  wire: "openai" | "anthropic";
  /** The provider's, or Guard's, address. openai: ".../v1" (the call goes to <baseUrl>/chat/completions). anthropic: "https://host" (the call goes to <baseUrl>/v1/messages). */
  baseUrl: string;
  model: string;
  /** How long to wait for the whole answer before reading the message with the rule parser. Default 8000. */
  timeoutMs?: number;
  /** The most the model may write. The answer is a few dozen tokens; room is left for models that think first. Default 1024. */
  maxTokens?: number;
  /** openai wire: "json_schema" (default) where the provider supports it, "json_object" where it does not. */
  responseFormat?: "json_schema" | "json_object";
  /** anthropic wire: how hard the model thinks ("low" suits reading a short message). Left out unless set, because older models refuse it. */
  effort?: "low" | "medium" | "high";
  /** Anything else a provider needs in the request body, merged over ours (for example { max_completion_tokens: 1024, max_tokens: null }). */
  extraBody?: Record<string, unknown>;
}

export const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_TOKENS = 1024;
export const ANTHROPIC_VERSION = "2026-10-21"; // not a secret: the API version the request shape is written for (the bundle writes the same value into the model Guard)

type Obj = Record<string, unknown>;

/** What one wire gives back, once its reply is taken apart. */
type Reply = { text?: string; usage?: TokenUsage; problem?: string };

const asNumber = (v: unknown): number => (typeof v === "number" ? v : 0);

function readOpenAI(body: unknown): Reply {
  if (!isObj(body)) return { problem: "its reply was not what was expected" };
  const cached = isObj(body.usage) && isObj(body.usage.prompt_tokens_details) ? asNumber(body.usage.prompt_tokens_details.cached_tokens) : 0;
  const usage = isObj(body.usage) ? { inputTokens: asNumber(body.usage.prompt_tokens), outputTokens: asNumber(body.usage.completion_tokens), ...(cached > 0 ? { cachedInputTokens: cached } : {}) } : undefined;
  const choice = Array.isArray(body.choices) && isObj(body.choices[0]) ? body.choices[0] : undefined;
  const message = isObj(choice?.message) ? choice.message : undefined;
  if (typeof message?.refusal === "string" && message.refusal) return { usage, problem: "the model refused" };
  if (choice?.finish_reason === "length") return { usage, problem: "its answer was cut off" };
  return typeof message?.content === "string" ? { usage, text: message.content } : { usage, problem: "its reply had no answer in it" };
}

function readAnthropic(body: unknown): Reply {
  if (!isObj(body)) return { problem: "its reply was not what was expected" };
  const usage = isObj(body.usage) ? { inputTokens: asNumber(body.usage.input_tokens), outputTokens: asNumber(body.usage.output_tokens) } : undefined;
  if (body.stop_reason === "refusal") return { usage, problem: "the model refused" };
  if (body.stop_reason === "max_tokens") return { usage, problem: "its answer was cut off" };
  // The first text block: a model that thinks first puts a thinking block before it.
  const block = Array.isArray(body.content) ? body.content.find((b) => isObj(b) && b.type === "text") : undefined;
  return isObj(block) && typeof block.text === "string" ? { usage, text: block.text } : { usage, problem: "its reply had no answer in it" };
}

/** What one call asks: the system text, the one user message, and the JSON schema of the answer. */
export interface JsonCall { system: string; user: string; schema: Record<string, unknown>; /** The schema's name on the openai wire. */ name?: string }

/** The request for one wire: where it goes and what it carries. */
function request(config: ModelConfig, call: JsonCall): { url: string; headers: Record<string, string>; body: Obj } {
  const base = config.baseUrl.replace(/\/+$/, "");
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  if (config.wire === "anthropic") {
    return {
      url: `${base}/v1/messages`,
      headers: { "content-type": "application/json", "anthropic-version": ANTHROPIC_VERSION },
      // No temperature: this API version refuses it. No forced tool choice either: newer models refuse that too.
      body: {
        model: config.model, max_tokens: maxTokens, system: call.system, messages: [{ role: "user", content: call.user }],
        output_config: { format: { type: "json_schema", schema: call.schema }, ...(config.effort ? { effort: config.effort } : {}) },
        ...config.extraBody,
      },
    };
  }
  const responseFormat = config.responseFormat === "json_object"
    ? { type: "json_object" }
    : { type: "json_schema", json_schema: { name: call.name ?? "intent", strict: true, schema: call.schema } };
  return {
    url: `${base}/chat/completions`,
    headers: { "content-type": "application/json" },
    body: {
      model: config.model, max_tokens: maxTokens, temperature: 0, response_format: responseFormat,
      messages: [{ role: "system", content: call.system }, { role: "user", content: call.user }],
      ...config.extraBody,
    },
  };
}

/** The JSON object in a model's text: some models wrap it in a code fence, or think out loud in <think> tags first. */
function parseAnswer(text: string): unknown {
  const bare = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(bare);
  return JSON.parse(fenced ? fenced[1] : bare);
}

/** A timeout is a timeout; anything else that stops a call from finishing is the connection. */
const isTimeout = (e: unknown) => ["TimeoutError", "AbortError"].includes((e as { name?: string } | null)?.name ?? "");

/** What one JSON call came to: the parsed answer, or why there is none (a few plain words that never contain what the model said), and what it cost in tokens. */
export interface JsonAnswer { answer?: unknown; reason?: string; usage?: TokenUsage; latencyMs: number }

/**
 * One call to a model over either wire, asking for JSON: the transport every model use shares (the intent parser below, and the talk, understanding/talk.ts). It sends no
 * key (a Guard in front adds it, or `fetchFn` does), waits at most `timeoutMs`, and never throws: a timeout, an HTTP error, a refusal, a cut-off answer or a reply that is not
 * JSON comes back as a `reason`.
 */
export async function askJson(config: ModelConfig, call: JsonCall, fetchFn: typeof fetch = globalThis.fetch): Promise<JsonAnswer> {
  const started = performance.now();
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const readReply = config.wire === "anthropic" ? readAnthropic : readOpenAI;
  let usage: TokenUsage | undefined;
  try {
    const { url, headers, body } = request(config, call);
    const response = await fetchFn(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      await response.body?.cancel();
      return { reason: `the model answered HTTP ${response.status}`, latencyMs: performance.now() - started };
    }
    const reply = readReply(await response.json());
    usage = reply.usage;
    if (reply.problem !== undefined) return { reason: reply.problem, usage, latencyMs: performance.now() - started };
    try { return { answer: parseAnswer(reply.text as string), usage, latencyMs: performance.now() - started }; } catch { return { reason: "its answer was not JSON", usage, latencyMs: performance.now() - started }; }
  } catch (e) {
    return { reason: isTimeout(e) ? `no answer within ${timeoutMs} ms` : e instanceof SyntaxError ? "its reply was not JSON" : "the connection failed", usage, latencyMs: performance.now() - started };
  }
}

export interface ModelParser<I extends IntentBase = IntentBase, C = unknown> extends IntentParser<I, C, ParseOptionsBase> { parseDetailed(text: string, context: C): Promise<ParseResult<I>> }

/**
 * Creates the parser for one template's `reading`. Creating it makes no call. `fetchFn` is how the eval script adds a key; the runtime leaves it alone,
 * so the runtime sends none.
 */
export function createModelParser<I extends IntentBase, C>(config: ModelConfig, reading: Reading<I, C>, fetchFn: typeof fetch = globalThis.fetch): ModelParser<I, C> {
  if (config.wire !== "openai" && config.wire !== "anthropic") throw new Error('The model wire must be "openai" or "anthropic".');
  if (!config.baseUrl || !config.model) throw new Error("Give the model parser a baseUrl and a model.");

  async function parseDetailed(text: string, context: C): Promise<ParseResult<I>> {
    const call: JsonCall = { system: reading.prompt(context), user: text, schema: reading.schema(context) };
    const got = await askJson(config, call, fetchFn);
    let reason = got.reason;
    if (reason === undefined) {
      const intent = reading.coerce(reading.shape(got.answer), context);
      if (intent) {
        // The rule parser's check for "ignore your rules" runs too: a fooled model cannot hide a trick from the record.
        if (reading.rules(text, context).overrideAttempt) intent.overrideAttempt = true;
        return { intent, usage: got.usage, latencyMs: got.latencyMs };
      }
      reason = "its answer was not a valid intent";
    }
    return { intent: reading.rules(text, context), fallbackReason: reason, usage: got.usage, latencyMs: got.latencyMs };
  }

  return { parse: async (text, context): Promise<I> => (await parseDetailed(text, context)).intent, parseDetailed };
}
