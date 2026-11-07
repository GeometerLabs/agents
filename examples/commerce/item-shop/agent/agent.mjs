// Item shop: a live-ops agent for a game. It restores items lost to a crash or a failed purchase, and
// sells items for gems.
//
// A workflow hands the model one stored command at a time; the model issues the tool call; THIS CODE
// decides what actually reaches the inventory service:
//   - the ticket decides who gets the item, never the chat message;
//   - a ticket is restored once, however often the player asks: the inventory is looked at first;
//   - after a lost reply it looks up what landed before it tries again;
//   - a restoration worth more than GM_LIMIT gems (the ticket says how many) waits for a game master's approval id.
import { appendFileSync, mkdirSync } from "node:fs";

const env = process.env;
const task = JSON.parse(process.argv[2] ?? "{}");
const retries = Number(env.AGENT_RETRIES ?? "1");
const gmLimit = Number(env.GM_LIMIT ?? "50.00");
const timeout = Number(env.TOOL_TIMEOUT_MS ?? "30000");

const tools = [
  { type: "function", function: { name: "restore_item", description: "Restore a ticket's lost item or gems",
      parameters: { type: "object", required: ["ticket_id", "restoration_request"],
        properties: { ticket_id: { type: "string" }, restoration_request: { type: "string" },
          approval: { type: "string" }, send_to: { type: "string" } } } } },
  { type: "function", function: { name: "sell_item", description: "Sell an item to a player for gems",
      parameters: { type: "object", required: ["sale_request", "player", "item", "price_gems"],
        properties: { sale_request: { type: "string" }, player: { type: "string" }, item: { type: "string" }, price_gems: { type: "string" } } } } },
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

async function api(method, path, body, key) {
  const r = await fetch(`${env.INVENTORY_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const listed = async (path) => (await api("GET", path)).body ?? [];

// Make a change once: look first, and if the reply is lost look again before trying again.
async function once(path, body, key, landed) {
  const done = await landed().catch(() => null);
  if (done) return { already_done: done };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return (await api("POST", path, body, key)).body; }
    catch { const seen = await landed().catch(() => null); if (seen) return { already_done: seen }; }
  }
  return { error: "no answer from the inventory service; not retried further" };
}

async function restoreItem(a) {
  const ticket = (await api("GET", `/v1/tickets/${a.ticket_id}`)).body;
  const path = `/v1/tickets/${a.ticket_id}/restorations`;
  if (Number(ticket.gems) > gmLimit && !a.approval) return { held: "needs a game master's approval", gems: ticket.gems };
  const body = { player: ticket.player, item: ticket.item, gems: ticket.gems, approval: a.approval, restoration_request: a.restoration_request };
  return once(path, body, a.restoration_request, async () => (await listed(path))[0]);
}

async function sellItem(a) {
  const path = `/v1/sales/${a.sale_request}`;
  return once(path, { player: a.player, item: a.item, price_gems: a.price_gems }, a.sale_request,
    async () => (await listed(`${path}/records`))[0]);
}

const handlers = { restore_item: restoreItem, sell_item: sellItem };
const results = [];
for (const [name, command] of task.commands ?? []) {
  const messages = [
    { role: "system", content: "You carry out one stored live-ops command with the matching tool." },
    { role: "user", content: `Carry out this command. Call ${name} once with exactly this immutable command JSON: ${JSON.stringify(command)}` },
  ];
  for (let turn = 0; turn < 3; turn++) {
    const msg = await model(messages);
    messages.push(msg);
    if (!msg.tool_calls) break;
    for (const c of msg.tool_calls) {
      const out = await handlers[c.function.name](JSON.parse(c.function.arguments));
      results.push({ tool: c.function.name, out });
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out) });
    }
  }
}
mkdirSync("/data", { recursive: true });
appendFileSync("/data/memory.jsonl", JSON.stringify({ task, results }) + "\n");
console.log(JSON.stringify({ results }));
