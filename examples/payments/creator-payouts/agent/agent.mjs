// Creator payouts: pays creators their share of a period's revenue.
//
// A workflow hands the model one stored payout command per creator; the model issues the tool call;
// THIS CODE decides what reaches the payouts service:
//   - the amount is clamped to what the service says the creator is owed, never the amount the command
//     asked for;
//   - the money goes to the creator's registered account from the service, never an account named in a message;
//   - one payout per creator per period: the service has no idempotency keys, so the payouts it lists are
//     looked at first and again after a lost reply;
//   - a payout above APPROVAL_LIMIT waits for a person's approval id.
import { appendFileSync, mkdirSync } from "node:fs";

const env = process.env;
const task = JSON.parse(process.argv[2] ?? "{}");
const retries = Number(env.AGENT_RETRIES ?? "1");
const limit = Number(env.APPROVAL_LIMIT ?? "500.00");
const timeout = Number(env.TOOL_TIMEOUT_MS ?? "30000");

const tools = [{ type: "function", function: { name: "pay_creator", description: "Pay a creator their share for a period",
  parameters: { type: "object", required: ["creator_id", "period", "amount"],
    properties: { creator_id: { type: "string" }, period: { type: "string" }, amount: { type: "string" },
      approval: { type: "string" }, pay_to: { type: "string" } } } } }];

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
  const r = await fetch(`${env.PAYOUTS_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const paid = async (creator, period) =>
  ((await api("GET", `/v1/creators/${creator}/payouts`)).body ?? []).find((p) => p.period === period);

// Make a change once: look first, and if the reply is lost look again before trying again.
async function once(path, body, key, landed) {
  const done = await landed().catch(() => null);
  if (done) return { already_done: done };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return (await api("POST", path, body, key)).body; }
    catch { const seen = await landed().catch(() => null); if (seen) return { already_done: seen }; }
  }
  return { error: "no answer from the service; not retried further" };
}

async function payCreator(a) {
  const creator = (await api("GET", `/v1/creators/${a.creator_id}`)).body;
  const amount = Math.min(Number(a.amount), Number(creator.owed)).toFixed(2); // never more than is owed
  if (Number(amount) <= 0) return { nothing_owed: creator.owed };
  if (Number(amount) > limit && !a.approval) return { held: "needs a person's approval", amount };
  const body = { amount, period: a.period, to: creator.account, approval: a.approval };
  const path = `/v1/creators/${a.creator_id}/payouts`;
  return once(path, body, undefined, () => paid(a.creator_id, a.period));
}

const results = [];
for (const command of task.commands ?? []) {
  const messages = [
    { role: "system", content: "You carry out one stored payout command with the pay_creator tool." },
    { role: "user", content: `Carry out this payout. Call pay_creator once with exactly this immutable command JSON: ${JSON.stringify(command)}` },
  ];
  for (let turn = 0; turn < 3; turn++) {
    const msg = await model(messages);
    messages.push(msg);
    if (!msg.tool_calls) break;
    for (const c of msg.tool_calls) {
      const out = await payCreator(JSON.parse(c.function.arguments));
      results.push({ tool: c.function.name, out });
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out) });
    }
  }
}
mkdirSync("/data", { recursive: true });
appendFileSync("/data/memory.jsonl", JSON.stringify({ task, results }) + "\n");
console.log(JSON.stringify({ results }));
