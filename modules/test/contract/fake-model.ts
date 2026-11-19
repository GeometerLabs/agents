// The fake model servers for the runtime contracts (listings and Bookings), ONE place: a fake OpenAI-compatible model (counts and records every call; `answer` returns the JSON the
// model would write, or a rawReply, statusReply or slowReply for a model that writes prose, fails or is slow; with `rawStrings` a returned string is sent as it is) and a fake
// System One decision server. Moved here from the listings harness (with the AI core's fakes added on main) so the Bookings suite uses the same ones.
import { createServer } from "node:http";
import type { Server } from "node:http";

export interface FakeModel { port: number; calls: number; requests: any[]; answer: (owner: string, body: any) => unknown; close(): Promise<void> }

/** What a fake's `answer` may return instead of JSON: raw text as the model's content (not JSON, say), an HTTP status, or a wait before the answer (to time a model out). */
const FAKE = Symbol("fake reply");
type FakeReply = { [FAKE]: true; content?: string; status?: number; delayMs?: number; then?: unknown };
export const rawReply = (content: string): FakeReply => ({ [FAKE]: true, content });
export const statusReply = (status: number): FakeReply => ({ [FAKE]: true, status });
export const slowReply = (delayMs: number, then: unknown): FakeReply => ({ [FAKE]: true, delayMs, then });
const isFake = (v: unknown): v is FakeReply => typeof v === "object" && v !== null && FAKE in v;

/** Which call a request is: "intent" (the router's language step), "talk" (the owner's talk) or "listing" (a draft), from the schema's name the runtime sends. */
export const callName = (body: any): string => body?.response_format?.json_schema?.name ?? "";

/**
 * Start the fake. `answer` gets the owner's words (the last user message) and the whole request, and returns the JSON the model would write (or a rawReply, statusReply or
 * slowReply). Every call is counted.
 */
export async function startFakeModel(answer: (owner: string, body: any) => unknown = () => draftAnswer()): Promise<FakeModel> {
  const fake: FakeModel = { port: 0, calls: 0, requests: [], answer, close: async () => undefined };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      fake.calls += 1;
      let body: any = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* leave empty */ }
      fake.requests.push({ url: req.url, authorization: req.headers.authorization, body });
      const user = (body.messages ?? []).filter((m: { role: string }) => m.role === "user").at(-1)?.content ?? "";
      let got = fake.answer(user, body);
      if (isFake(got) && got.delayMs !== undefined) { await new Promise((r) => setTimeout(r, got.delayMs)); got = (got as FakeReply).then; }
      if (isFake(got) && got.status !== undefined) { res.writeHead(got.status, { "content-type": "application/json" }); res.end("{}"); return; }
      const content = isFake(got) ? got.content : o.rawStrings && typeof got === "string" ? got : JSON.stringify(got);
      const reply = JSON.stringify({ id: "fake", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
      if (res.destroyed) return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(reply);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  fake.port = (server.address() as { port: number }).port;
  fake.close = () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); });
  return fake;
}

/** A fake System One decision model (POST /v1/systemone). `answer` gets the state (the words, redacted) and the questions, and returns the reply body (or a FakeReply). */
export async function startFakeDecision(answer: (state: string, questions: any) => unknown): Promise<FakeModel> {
  const fake: FakeModel = { port: 0, calls: 0, requests: [], answer: answer as FakeModel["answer"], close: async () => undefined };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      fake.calls += 1;
      let body: any = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* leave empty */ }
      fake.requests.push({ url: req.url, body });
      let got = fake.answer(body.state ?? "", body.questions);
      if (isFake(got) && got.delayMs !== undefined) { await new Promise((r) => setTimeout(r, got.delayMs)); got = (got as FakeReply).then; }
      if (isFake(got) && got.status !== undefined) { res.writeHead(got.status, { "content-type": "application/json" }); res.end("{}"); return; }
      if (res.destroyed) return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(isFake(got) ? got.content : JSON.stringify(got));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  fake.port = (server.address() as { port: number }).port;
  fake.close = () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); });
  return fake;
}

