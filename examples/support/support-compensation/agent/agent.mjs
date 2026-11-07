// Support compensation: a helpdesk agent that makes a customer whole after a bad experience, with
// EITHER a credit on their account OR a refund to their card. Never both for one ticket.
//
// A workflow hands the model one stored request at a time ("credit" or "refund"); the model issues the
// tool call; THIS CODE decides what reaches the helpdesk service:
//   - before it acts it looks at BOTH kinds of compensation already given to the ticket;
//   - after a lost reply it looks up what landed before it tries again;
//   - a refund above REFUND_LIMIT waits for a person's approval id.
import { appendFileSync, mkdirSync } from "node:fs";

const env = process.env;
const task = JSON.parse(process.argv[2] ?? "{}");
const retries = Number(env.AGENT_RETRIES ?? "1");
const refundLimit = Number(env.REFUND_LIMIT ?? "100.00");
const timeout = Number(env.TOOL_TIMEOUT_MS ?? "30000");

const fields = { ticket_id: { type: "string" }, request_id: { type: "string" }, amount: { type: "string" }, approval: { type: "string" } };
const tools = ["credit", "refund"].map((name) => ({ type: "function", function: {
  name, description: `Give the customer a ${name} for a ticket`,
  parameters: { type: "object", required: ["ticket_id", "request_id", "amount"], properties: fields } } }));

async function model(messages) {
  const r = await fetch(`${env.MODEL_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, tools }),
  });
  if (!r.ok) throw new Error(`model: ${r.status} ${await r.text()}`);
  return (await r.json()).choices[0].message;
}

async function api(method, path, body, key) {
  const r = await fetch(`${env.HELPDESK_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const given = async (ticket, kind) => (await api("GET", `/v1/tickets/${ticket}/${kind}s`)).body ?? [];

async function compensate(kind, a) {
  // One kind per ticket: look at credits AND refunds, not only at the kind being asked for.
  for (const k of ["credit", "refund"]) {
    const prior = (await given(a.ticket_id, k))[0];
    if (prior) return { not_given: `ticket already has a ${k}`, existing: prior.id };
  }
  if (kind === "refund" && Number(a.amount) > refundLimit && !a.approval) {
    return { held: "needs a person's approval", amount: a.amount };
  }
  const body = { amount: a.amount, approval: a.approval, request_id: a.request_id };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return (await api("POST", `/v1/tickets/${a.ticket_id}/${kind}s`, body, a.request_id)).body; }
    catch {
      // The reply was lost. Look at what landed before trying again.
      const seen = (await given(a.ticket_id, kind).catch(() => []))[0];
      if (seen) return { already_given: seen.id };
    }
  }
  return { error: "no answer from the helpdesk; not retried further" };
}

const results = [];
for (const [name, command] of task.commands ?? []) {
  const messages = [
    { role: "system", content: "You carry out one stored support request with the matching tool." },
    { role: "user", content: `Carry out this request. Call ${name} once with exactly this immutable command JSON: ${JSON.stringify(command)}` },
  ];
  for (let turn = 0; turn < 3; turn++) {
    const msg = await model(messages);
    messages.push(msg);
    if (!msg.tool_calls) break;
    for (const c of msg.tool_calls) {
      const out = await compensate(c.function.name, JSON.parse(c.function.arguments));
      results.push({ tool: c.function.name, out });
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out) });
    }
  }
}
mkdirSync("/data", { recursive: true });
appendFileSync("/data/memory.jsonl", JSON.stringify({ task, results }) + "\n");
console.log(JSON.stringify({ results }));
