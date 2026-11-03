// A local stand-in for a model provider, for tests. It listens on 127.0.0.1, answers whatever a test tells it to (a good
// answer, junk, an error, a very slow reply) and keeps every request it received so a test can read the headers and the body.
// No test calls a real model.
import { createServer } from "node:http";
import type { IncomingHttpHeaders } from "node:http";

export interface StubRequest { path: string; headers: IncomingHttpHeaders; body: any }
export interface StubReply { status?: number; json?: unknown; raw?: string; delayMs?: number }
export interface StubModel { url: string; requests: StubRequest[]; close(): Promise<void> }

export async function startStubModel(reply: (request: StubRequest) => StubReply): Promise<StubModel> {
  const requests: StubRequest[] = [];
  const timers = new Set<NodeJS.Timeout>();
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const request: StubRequest = { path: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
      requests.push(request);
      const answer = reply(request);
      const send = () => {
        res.writeHead(answer.status ?? 200, { "content-type": "application/json" });
        res.end(answer.raw ?? JSON.stringify(answer.json ?? {}));
      };
      if (answer.delayMs) { const t = setTimeout(send, answer.delayMs); timers.add(t); } else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => {
      for (const t of timers) clearTimeout(t);
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

/** What an OpenAI-compatible endpoint sends back for a model that said `content`. */
export const openaiReply = (content: string, usage = { prompt_tokens: 900, completion_tokens: 60 }, extra: Record<string, unknown> = {}) => ({
  id: "chatcmpl-stub", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop", ...extra }], usage,
});

/** What the Anthropic Messages API sends back for a model that said `text` (after a thinking block, as a thinking model does). */
export const anthropicReply = (text: string, usage = { input_tokens: 900, output_tokens: 60 }, stopReason = "end_turn") => ({
  id: "msg_stub", type: "message", role: "assistant", model: "stub",
  content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text }], stop_reason: stopReason, usage,
});

/** The answer a good model gives: every field present, null for what the customer did not say. */
export const answer = (fields: Record<string, unknown>) => JSON.stringify({
  kind: "unknown", language: null, serviceId: null, offerInr: null, date: null, time: null, overrideAttempt: false, ...fields,
});
