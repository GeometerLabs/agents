// A fake OpenAI-compatible model server for the runtime contracts (listings and Bookings): it counts and records every call and answers with whatever JSON the test's
// `answer` function returns for the last user message. Moved here from the listings harness so the Bookings suite uses the same one.
import { createServer } from "node:http";
import type { Server } from "node:http";

export interface FakeModel { port: number; calls: number; requests: any[]; answer: (owner: string) => unknown; close(): Promise<void> }

/**
 * Start the fake. `answer` gets the last user message and returns the JSON the model would write; it is sent as JSON text. With `rawStrings`, a string answer is sent as it is
 * instead (a model that answers in prose, or in broken JSON). Every call is counted.
 */
export async function startFakeModel(answer: (owner: string) => unknown, o: { rawStrings?: boolean } = {}): Promise<FakeModel> {
  const fake: FakeModel = { port: 0, calls: 0, requests: [], answer, close: async () => undefined };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      fake.calls += 1;
      let body: any = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* leave empty */ }
      fake.requests.push({ url: req.url, authorization: req.headers.authorization, body });
      const user = (body.messages ?? []).filter((m: { role: string }) => m.role === "user").at(-1)?.content ?? "";
      const out = fake.answer(user);
      const reply = JSON.stringify({ id: "fake", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: o.rawStrings && typeof out === "string" ? out : JSON.stringify(out) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(reply);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  fake.port = (server.address() as { port: number }).port;
  fake.close = () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); });
  return fake;
}
