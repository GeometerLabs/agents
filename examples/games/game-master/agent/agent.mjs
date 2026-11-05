// Game master: an AI game master that rewards players when they finish quests in a small economy
// (gold and a few items).
//
// The game server sends quest-completion events (and sometimes sends the same event twice). A workflow
// hands the model one event at a time; the model issues the tool call; THIS CODE decides what reaches
// the economy service:
//   - the reward comes from the quest's own table, never from the event or the player's chat;
//   - one reward per completion: the economy has no idempotency keys, so the rewards it lists are looked at
//     first and again after a lost reply;
//   - a reward worth more than GM_LIMIT gold waits for a human game master's approval id;
//   - rewards go only to player accounts.
// A daily cap on rewards is NOT checked (the engine has no time-window rule yet); see LIMITS.md.
import { appendFileSync, mkdirSync } from "node:fs";

const env = process.env;
const task = JSON.parse(process.argv[2] ?? "{}");
const retries = Number(env.AGENT_RETRIES ?? "1");
const gmLimit = Number(env.GM_LIMIT ?? "100.00");
const timeout = Number(env.TOOL_TIMEOUT_MS ?? "30000");

const tools = [{ type: "function", function: { name: "grant_reward", description: "Reward a player for a completed quest",
  parameters: { type: "object", required: ["quest_id", "completion_id", "player"],
    properties: { quest_id: { type: "string" }, completion_id: { type: "string" }, player: { type: "string" },
      approval: { type: "string" } } } } }];

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
  const r = await fetch(`${env.ECONOMY_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rewardOf = async (completion) => ((await api("GET", `/v1/completions/${completion}/rewards`)).body ?? [])[0];

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

async function grantReward(a) {
  const quest = (await api("GET", `/v1/quests/${a.quest_id}`)).body; // the quest's own reward table
  const path = `/v1/completions/${a.completion_id}/rewards`;
  const gold = quest.gold;
  if (Number(gold) > gmLimit && !a.approval) return { held: "needs a game master's approval", gold };
  const body = { player: a.player, quest_id: a.quest_id, gold, item: quest.item, approval: a.approval };
  return once(path, body, undefined, () => rewardOf(a.completion_id));
}

const results = [];
for (const event of task.events ?? []) {
  const messages = [
    { role: "system", content: "You are the game master. Reward quest completions with the grant_reward tool." },
    { role: "user", content: `Quest completed. Call grant_reward once with exactly this immutable command JSON: ${JSON.stringify(event)}` },
  ];
  for (let turn = 0; turn < 3; turn++) {
    const msg = await model(messages);
    messages.push(msg);
    if (!msg.tool_calls) break;
    for (const c of msg.tool_calls) {
      const out = await grantReward(JSON.parse(c.function.arguments));
      results.push({ tool: c.function.name, out });
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out) });
    }
  }
}
mkdirSync("/data", { recursive: true });
appendFileSync("/data/memory.jsonl", JSON.stringify({ task, results }) + "\n");
console.log(JSON.stringify({ results }));
