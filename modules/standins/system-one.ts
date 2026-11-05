// A stand-in for a System One decision model (Laya, Jev): `POST /v1/systemone` (or `/systemone`), with the same checks on the REQUEST that the real API
// makes, and answers in the real shape. It decides nothing clever: a `Decider` you give it picks the option and how likely it is, and the
// stand-in fills in the rest (the other options share what is left, rounded to two decimals the way Jev shows them, adding up to 1).
//
// Tests give it a decider to make the model sure, unsure, wrong, slow or broken. A template can give one that answers from its own rule parser, so a
// local run of the whole stack has something to talk to (Bookings: pathways/bookings/standins/rule-decider.ts). Left out, it picks the last option of every
// choice at 0.9. Every request is kept (`requests`) so a test can read what was asked, and see that no phone number or name was in it.
import type { Question } from "../understanding/system-one.ts";
import { ok } from "./http.ts";
import type { Handler, StandinReply } from "./http.ts";

export interface DecisionRequestSeen { state: unknown; model: string; questions: Record<string, Question>; authorization: string | undefined }

/** What the decider says about one question: the option it picks and the probability it gives it (choice), or the probability of yes (noul). */
export type Pick = { choice: string; p: number } | { noul: number };
export type Decider = (name: string, question: Question, state: string) => Pick;

export interface SystemOneStandin {
  handler: Handler;
  /** Every request that was well formed, oldest first. */
  requests: DecisionRequestSeen[];
}

export interface SystemOneStandinOptions {
  decider?: Decider;
  /** If set, a request without `Authorization: Bearer <this>` is refused with 401, like a hosted service. */
  requireKey?: string;
  /** Tokens to report: default, one for every four characters of the state, and 40 for the questions. */
  usage?: (state: string) => { input_tokens: number; output_tokens: number };
}

const err = (status: number, message: string): StandinReply => ({ status, body: { error: message } });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The decider used when a template gives none: the last option of every choice (the "anything else" label, by the convention of the questions), at 0.9. */
export const lastOptionDecider: Decider = (_name, question) => {
  if (question.type !== "choice") return { noul: 0.5 };
  const labels = Object.keys(question.criteria);
  return { choice: labels[labels.length - 1], p: 0.9 };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function answerFor(question: Question, pick: Pick): Record<string, unknown> {
  if (question.type === "noul") return { type: "noul", noul: "noul" in pick ? pick.noul : 0.5 };
  const labels = Object.keys(question.criteria);
  const choice = "choice" in pick && labels.includes(pick.choice) ? pick.choice : labels[0];
  const p = round2("p" in pick ? Math.min(1, Math.max(0, pick.p)) : 1 / labels.length);
  const others = labels.length - 1;
  const probabilities: Record<string, number> = {};
  for (const label of labels) probabilities[label] = label === choice ? p : others === 0 ? 0 : round2((1 - p) / others);
  // Two decimals can leave a hundredth over or under; the picked option takes the difference so the sum is 1 to two places.
  const rest = labels.filter((l) => l !== choice).reduce((n, l) => n + probabilities[l], 0);
  probabilities[choice] = round2(1 - rest);
  return { type: "choice", choice, confidence: probabilities[choice], probabilities };
}

export function systemOneStandin(options: SystemOneStandinOptions = {}): SystemOneStandin {
  const decider = options.decider ?? lastOptionDecider;
  const requests: DecisionRequestSeen[] = [];
  const handler: Handler = async ({ method, path, body, headers }) => {
    if (path !== "/v1/systemone" && path !== "/systemone") return undefined;
    if (method !== "POST") return err(405, "Use POST.");
    if (options.requireKey !== undefined && headers.authorization !== `Bearer ${options.requireKey}`) return err(401, "A valid API key is needed.");
    if (!isObj(body) || (typeof body.state !== "string" && !isObj(body.state)) || typeof body.model !== "string" || body.model === "" || !isObj(body.questions) || Object.keys(body.questions).length === 0) {
      return err(422, "The body needs state, model and questions.");
    }
    const questions: Record<string, Question> = {};
    for (const [name, raw] of Object.entries(body.questions)) {
      if (!isObj(raw) || (raw.type !== "choice" && raw.type !== "noul")) return err(422, `Question ${name} needs a type of choice or noul.`);
      if (typeof raw.instructions !== "string" || raw.instructions === "") return err(422, `Question ${name} needs instructions.`);
      if (raw.type === "choice") {
        if (!isObj(raw.criteria) || Object.keys(raw.criteria).length < 2) return err(422, `Question ${name} needs at least two options in criteria.`);
        questions[name] = { type: "choice", instructions: raw.instructions, criteria: raw.criteria as Record<string, string> };
      } else questions[name] = { type: "noul", instructions: raw.instructions };
    }
    const state = typeof body.state === "string" ? body.state : JSON.stringify(body.state);
    requests.push({ state: body.state, model: body.model, questions, authorization: headers.authorization });
    const answers = Object.fromEntries(Object.entries(questions).map(([name, q]) => [name, answerFor(q, decider(name, q, state))]));
    const usage = options.usage ? options.usage(state) : { input_tokens: Math.ceil(state.length / 4) + 40, output_tokens: 0 };
    return ok({ model: body.model, answers, usage });
  };
  return { handler, requests };
}

/**
 * The stand-in as a `fetch`, so the client and the router can be run against it inside one process with no port and no network (the hand check does this).
 * `down`: when it returns true the call fails the way a connection that cannot be made does.
 */
export function systemOneFetch(standin: SystemOneStandin, options: { down?: () => boolean } = {}): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (options.down?.()) throw new TypeError("the connection failed");
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const reply = await standin.handler({
      method: init?.method ?? "GET", path: url.pathname, query: url.searchParams,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    if (!reply) return new Response("{}", { status: 404 });
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
