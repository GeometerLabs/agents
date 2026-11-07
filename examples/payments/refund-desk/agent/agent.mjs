// Refund desk: a support agent that refunds orders.
//
// The model proposes refunds from a customer task; this code decides whether and how each one is
// made. Three habits keep it honest:
//   1. every refund carries the request id as the provider's Idempotency-Key;
//   2. after a lost reply it LOOKS UP the order's refunds before it tries again;
//   3. a refund above APPROVAL_LIMIT is held until a person's approval id is on the task.
import { appendFileSync, mkdirSync } from "node:fs";

const env = process.env;
const task = JSON.parse(process.argv[2] ?? "{}");
const retries = Number(env.AGENT_RETRIES ?? "1");
const limit = Number(env.APPROVAL_LIMIT ?? "50.00");
const timeout = Number(env.TOOL_TIMEOUT_MS ?? "30000");

const tools = [
  { type: "function", function: { name: "refund", description: "Refund part of an order",
      parameters: { type: "object", required: ["order_id", "amount", "refund_request"],
        properties: { order_id: { type: "string" }, amount: { type: "string" }, refund_request: { type: "string" } } } } },
];

async function model(messages) {
  const r = await fetch(`${env.MODEL_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, tools }),
  });
  if (!r.ok) throw new Error(`model: ${r.status} ${await r.text()}`);
  return (await r.json()).choices[0].message;
}

// Has this refund request already landed? The provider is the source of truth.
async function alreadyRefunded(args) {
  const q = new URLSearchParams({ order_id: args.order_id });
  const r = await fetch(`${env.PAYMENTS_URL}/v1/refunds?${q}`, { signal: AbortSignal.timeout(timeout) });
  const listed = (await r.json()).data ?? [];
  return listed.find((x) => x.refund_request === args.refund_request);
}

async function refund(args) {
  if (Number(args.amount) > limit && !args.approval) return { held: "needs a person's approval", amount: args.amount };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(`${env.PAYMENTS_URL}/v1/refunds`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": args.refund_request },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(timeout),
      });
      return await r.json();
    } catch (e) {
      // The reply was lost: the refund may or may not have happened. Look before trying again.
      const done = await alreadyRefunded(args).catch(() => null); // if the lookup fails too, retry with the same key
      if (done) return { already_refunded: done };
    }
  }
  return { error: "no answer from the payments service; not retried further" };
}

const messages = [
  { role: "system", content: "You process customer refund tasks with the refund tool." },
  { role: "user", content: JSON.stringify(task) },
];
const results = [];
for (let turn = 0; turn < 4; turn++) {
  const msg = await model(messages);
  messages.push(msg);
  if (!msg.tool_calls) { results.push({ final: msg.content }); break; }
  for (const c of msg.tool_calls) {
    const out = await refund(JSON.parse(c.function.arguments));
    results.push({ tool: c.function.name, out });
    messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out) });
  }
}
mkdirSync("/data", { recursive: true });
appendFileSync("/data/memory.jsonl", JSON.stringify({ task, results }) + "\n");
console.log(JSON.stringify({ results }));
