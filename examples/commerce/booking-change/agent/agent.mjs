// Booking change: an airline-style agent that moves a traveller to another seat and charges the fee.
//
// Two tools in two services: the bookings service changes the seat, the billing service charges the
// change fee. A workflow hands the model one stored change request; the model issues the tool calls;
// THIS CODE decides what reaches the services:
//   - a change request is applied once: the request id is the Idempotency-Key, and the bookings
//     service is looked at before a retry;
//   - the billing service has NO idempotency keys, so a lost reply to the charge is answered by
//     looking at the booking's charges before charging again. That look-up is the only protection.
import { appendFileSync, mkdirSync } from "node:fs";

const env = process.env;
const task = JSON.parse(process.argv[2] ?? "{}");
const retries = Number(env.AGENT_RETRIES ?? "1");
const timeout = Number(env.TOOL_TIMEOUT_MS ?? "30000");

const tools = [{ type: "function", function: { name: "change_seat", description: "Move a booking to another seat and charge the change fee",
  parameters: { type: "object", required: ["booking_id", "change_request", "seat", "fee"],
    properties: { booking_id: { type: "string" }, change_request: { type: "string" }, seat: { type: "string" }, fee: { type: "string" } } } } }];

async function model(messages) {
  const r = await fetch(`${env.MODEL_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, tools }),
  });
  if (!r.ok) throw new Error(`model: ${r.status} ${await r.text()}`);
  return (await r.json()).choices[0].message;
}

async function api(base, method, path, body, key) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// Make a change once: look first, and if the reply is lost look again before trying again.
async function once(base, path, body, key, landed) {
  const done = await landed().catch(() => null);
  if (done) return { already_done: done };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return (await api(base, "POST", path, body, key)).body; }
    catch { const seen = await landed().catch(() => null); if (seen) return { already_done: seen }; }
  }
  return { error: `no answer from ${base}; not retried further` };
}
const first = async (base, path, request, field) =>
  ((await api(base, "GET", path)).body ?? []).find((x) => x[field] === request);

async function changeSeat(a) {
  const changes = `/v1/bookings/${a.booking_id}/changes`;
  const charges = `/v1/bookings/${a.booking_id}/charges`;
  const change = await once(env.BOOKINGS_URL, changes, { seat: a.seat, change_request: a.change_request }, a.change_request,
    () => first(env.BOOKINGS_URL, changes, a.change_request, "change_request"));
  if (change.error) return { change, charged: false };
  const charge = await once(env.BILLING_URL, charges, { amount: a.fee, change_request: a.change_request }, undefined,
    () => first(env.BILLING_URL, charges, a.change_request, "change_request"));
  return { change, charge };
}

const results = [];
for (const command of task.commands ?? []) {
  const messages = [
    { role: "system", content: "You carry out one stored booking change with the change_seat tool." },
    { role: "user", content: `Carry out this change. Call change_seat once with exactly this immutable command JSON: ${JSON.stringify(command)}` },
  ];
  for (let turn = 0; turn < 3; turn++) {
    const msg = await model(messages);
    messages.push(msg);
    if (!msg.tool_calls) break;
    for (const c of msg.tool_calls) {
      const out = await changeSeat(JSON.parse(c.function.arguments));
      results.push({ tool: c.function.name, out });
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out) });
    }
  }
}
mkdirSync("/data", { recursive: true });
appendFileSync("/data/memory.jsonl", JSON.stringify({ task, results }) + "\n");
console.log(JSON.stringify({ results }));
