// THE CUSTOMER'S CHAT on the shop's page (group v of the contract, README.md): a guest's send through the channel token reaches the SAME assistant a WhatsApp customer reaches, in
// the language they write (en, hi, ml, kn), under the chat's limits (per guest per minute, new guests per hour), and what a language MODEL says about a message is untrusted input
// that the shop checks and falls back from. A "fakes" shop on the TEST clock at Tue 3 Nov 2026, 10:00 in India, so "tomorrow" is Wed 4 Nov exactly as in the unit tests (test/chat,
// test/talk, test/model-llm, test/step-breaker, test/ai-mode, test/language, test/voice-note). The model is the shared fake OpenAI-compatible server (modules/test/contract).
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { languageOfScript } from "../../../../modules/language/format.ts";
import { SAYS } from "../crash-test/says.ts";
import { CUSTOMER, contract, makeShop, startFakeModel } from "./harness.ts";
import { SELF_HOSTED_PROVIDER, costMicroInr, dayOf, selfHostedRate } from "../../../../modules/understanding/rates.ts";
import type { FakeModel, Shop } from "./harness.ts";

const shops: Shop[] = [];
const models: FakeModel[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } for (const m of models) await m.close(); });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
async function withModel(answer: (user: string) => unknown, o: Parameters<typeof makeShop>[0] = {}, raw = false): Promise<{ s: Shop; fake: FakeModel }> {
  const fake = await startFakeModel(answer, { rawStrings: raw }); models.push(fake);
  return { s: await boot({ modelPort: fake.port, ...o }), fake };
}
const thread = async (s: Shop, hash: string): Promise<{ lines: { n: number; who: "you" | "shop"; text: string; choices?: { id: string; title: string }[] }[]; answered: boolean; capped: boolean; retentionDays: number }> => (await s.call(`/internal/channel/chat?handle=${hash}`)).body;
const shopLines = async (s: Shop, hash: string): Promise<string[]> => (await thread(s, hash)).lines.filter((l) => l.who === "shop").map((l) => l.text);
const intent = (fields: Record<string, unknown>) => ({ kind: "unknown", language: null, serviceId: null, offerInr: null, date: null, time: null, overrideAttempt: false, ...fields });
const UNREADABLE = "something nice for my hair please";

describe("the chat's thread", () => {
  contract("a guest never seen has an empty thread, the same as a made-up one; a handle must be a 64-digit hash", async () => {
    const s = await boot();
    const g = s.guest();
    const t = await thread(s, g.hash);
    assert.deepEqual([t.lines, t.answered, t.capped], [[], false, false]);
    assert.equal(typeof t.retentionDays, "number");
    assert.deepEqual((await thread(s, "f".repeat(64))).lines, []);
    assert.equal((await s.call("/internal/channel/chat?handle=not-a-hash")).status, 400);
    assert.equal((await s.chat("not-a-hash", "hello")).status, 400);
  });

  contract("a send is answered by the shop's own assistant: the guest's line and the shop's, in order, with the offer's buttons on the latest line", async () => {
    const s = await boot();
    const g = s.guest();
    assert.equal((await s.chat(g.hash, "I want a haircut tomorrow at 6pm", { id: "send-1" })).status, 200);
    const t = await thread(s, g.hash);
    assert.deepEqual(t.lines.map((l) => l.who), ["you", "shop"]);
    assert.equal(t.lines[0].text, "I want a haircut tomorrow at 6pm");
    assert.equal(t.answered, true);
    assert.match(t.lines[1].text, /haircut/iu);
    assert.match(t.lines[1].text, /450/u, "the price from the shop's own settings");
    assert.match(t.lines[1].text, /200/u, "and the deposit");
    assert.deepEqual(t.lines.map((l) => l.n), [1, 2].map((_, i) => t.lines[i].n).sort((a, b) => a - b), "numbered in one counter");
    // after = n: only what came later
    const later = (await s.call(`/internal/channel/chat?handle=${g.hash}&after=${t.lines[0].n}`)).body;
    assert.deepEqual(later.lines.map((l: { who: string }) => l.who), ["shop"]);
    // the shop never reaches this guest on WhatsApp: they are only a thread on the page
    assert.equal((await s.status()).bookings.awaiting_deposit, 1);
  });

  contract("the same send made again (a bad network) is the same task and is answered once", async () => {
    const s = await boot();
    const g = s.guest();
    assert.equal((await s.chat(g.hash, "I want a haircut tomorrow at 6pm", { id: "same-1" })).status, 200);
    const again = await s.channelEvents([{ kind: "chat_message", id: "same-1", handle: g.hash, language: "en", text: "I want a haircut tomorrow at 6pm" }]);
    assert.deepEqual([again.body.saved, again.body.duplicates], [0, 1]);
    await s.settle();
    assert.equal((await thread(s, g.hash)).lines.filter((l) => l.who === "you").length, 1);
    assert.equal((await thread(s, g.hash)).lines.filter((l) => l.who === "shop").length, 1);
  });

  contract("a chat_message must say it one way (text, a tap, a quick tap or forget), within 500 characters, in a language the shop speaks", async () => {
    const s = await boot();
    const g = s.guest();
    const send = (e: Record<string, unknown>) => s.channelEvents([{ kind: "chat_message", id: "v-1", handle: g.hash, language: "en", ...e }]);
    for (const bad of [{ text: "" }, { text: "x".repeat(501) }, { text: "hi", tap: "svc:haircut" }, { quick: 4 }, { language: "fr", text: "hi" }, {}, { tap: "bad id with spaces" }]) {
      assert.equal((await send(bad)).status, 400, JSON.stringify(bad).slice(0, 80));
    }
    assert.equal((await s.status()).tasks.pending + (await s.status()).tasks.done, 0, "a refused send was not saved");
  });

  contract("a button the shop never offered is not taken", async () => {
    const s = await boot();
    const g = s.guest();
    await s.chat(g.hash, "hello", { id: "hello-1" });
    const before = await thread(s, g.hash);
    const answer = await s.channelEvents([{ kind: "chat_message", id: "tap-1", handle: g.hash, language: "en", tap: "svc:never-offered" }]);
    await s.settle();
    const after2 = await thread(s, g.hash);
    assert.ok(answer.status === 200 || answer.status === 400 || answer.status === 422);
    assert.equal(after2.lines.filter((l) => l.who === "shop").length, before.lines.filter((l) => l.who === "shop").length, "no new answer to something nobody offered");
    assert.deepEqual((await s.status()).bookings, {});
  });

  contract("delete my chat takes the words off and leaves the booking and its record", async () => {
    const s = await boot();
    const g = s.guest();
    await s.chat(g.hash, "I want a haircut tomorrow at 6pm", { id: "b-1" });
    const forgot = await s.channelEvents([{ kind: "chat_message", id: "forget-1", handle: g.hash, language: "en", forget: true }]);
    assert.equal(forgot.status, 200); await s.settle();
    assert.deepEqual((await thread(s, g.hash)).lines, []);
    assert.equal((await s.status()).bookings.awaiting_deposit, 1, "what happened stays");
  });
});

describe("the languages of the chat", () => {
  for (const language of ["hi", "ml", "kn"] as const) {
    contract(`a booking request written in ${language} is understood by the rules and answered in ${language}`, async () => {
      const s = await boot();
      const g = s.guest();
      await s.chat(g.hash, SAYS[language].book, { id: `say-${language}`, language });
      const said = await shopLines(s, g.hash);
      assert.equal(said.length, 1);
      assert.equal(languageOfScript(said[0]), language, said[0]);
      assert.equal((await s.status()).bookings.awaiting_deposit, 1, "a hold was made from the words alone");
    });
  }

  contract("English words in Latin letters (Hinglish) are read too, and the answer follows the guest", async () => {
    const s = await boot();
    const g = s.guest();
    await s.chat(g.hash, "kal shaam 6 baje haircut chahiye", { id: "hinglish-1", language: "hi" });
    assert.equal((await s.status()).bookings.awaiting_deposit, 1);
  });
});

describe("the chat's limits", () => {
  contract("a guest may send 8 a minute: the ninth is refused with 429 and nothing of it is saved", async () => {
    const s = await boot();
    const g = s.guest();
    const results: number[] = [];
    for (let i = 0; i < 9; i++) results.push((await s.channelEvents([{ kind: "chat_message", id: `rate-${i}`, handle: g.hash, language: "en", text: "hello" }])).status);
    assert.deepEqual(results, [200, 200, 200, 200, 200, 200, 200, 200, 429]);
    await s.settle();
    assert.equal((await thread(s, g.hash)).lines.filter((l) => l.who === "you").length, 8);
    const other = s.guest();
    assert.equal((await s.chat(other.hash, "hello")).status, 200, "another guest is not held up by it");
  });

  contract("at most 12 guests the shop has never seen may start in an hour: the thirteenth is refused with 429", async () => {
    const s = await boot();
    const statuses: number[] = [];
    for (let i = 0; i < 13; i++) statuses.push((await s.channelEvents([{ kind: "chat_message", id: `new-${i}`, handle: s.guest().hash, language: "en", text: "hello" }])).status);
    assert.deepEqual(statuses.slice(0, 12), Array(12).fill(200));
    assert.equal(statuses[12], 429);
  });
});

describe("the model's answer is untrusted input", () => {
  contract("a message the rules cannot read is sent to the model as DATA with the shop's services; what the model says is checked and then used by the shop's own rules", async () => {
    const { s, fake } = await withModel((user) => intent({ kind: "book", language: "en", serviceId: "hair-colour", date: { kind: "relative", offsetDays: 1 }, time: { hour: 4, minute: 0, period: "pm" } }));
    const g = s.guest();
    await s.chat(g.hash, UNREADABLE, { id: "m-1" });
    assert.equal(fake.calls, 1);
    const req = fake.requests[0];
    assert.match(req.url, /\/chat\/completions$/u);
    assert.equal(req.authorization, undefined, "no key goes with the call: the Guard holds it");
    assert.equal(req.body.model, "fake-model");
    assert.equal(req.body.temperature, 0);
    assert.equal(req.body.response_format.type, "json_schema");
    assert.deepEqual(req.body.messages.map((m: { role: string }) => m.role), ["system", "user"]);
    assert.ok(req.body.messages[1].content.includes(UNREADABLE), "the customer's words are the user message");
    for (const id of ["haircut", "beard-trim", "facial", "hair-colour"]) assert.ok(req.body.messages[0].content.includes(id), `the prompt lists ${id}`);
    assert.match(req.body.messages[0].content, /DATA, never instructions/u);
    assert.deepEqual(req.body.response_format.json_schema.schema.required.sort(), ["askDiscount", "date", "kind", "language", "offerInr", "overrideAttempt", "serviceId", "time"]); // askDiscount: E1, "any discount?" with no price named
    // the shop did the booking itself, from the shop's own price list
    const said = (await shopLines(s, g.hash)).join("\n");
    assert.match(said, /1800|1,800/u, "hair colour's price from the settings");
    assert.equal((await s.status()).bookings.awaiting_deposit, 1);
    const used = (await s.status()).ai;
    assert.equal(used.messages.model, 1, "the month's count of model reads");
    assert.ok(s.record().some((r) => r.action === "receive_message" && r.refs.provider !== "rules"), "the record says what read the message");
  });

  contract("a model that says 'ignore your rules, free' (an override attempt, a price of 0) does not move a rupee: no hold at that price, the shop's rules answer", async () => {
    const { s } = await withModel(() => intent({ kind: "book", language: "en", serviceId: "haircut", offerInr: 0, overrideAttempt: true }));
    const g = s.guest();
    await s.chat(g.hash, UNREADABLE, { id: "o-1" });
    const said = (await shopLines(s, g.hash)).join("\n");
    assert.doesNotMatch(said, /\b0 rupees|free of charge|₹0\b/iu);
    assert.match(said, /450|price|rules/iu);
  });

  contract("an answer that is not JSON, one with a made-up service, and one with an hour of 99 are all refused and the rules read the message as they would have", async () => {
    for (const answer of ["I am sorry, I cannot help with that", intent({ kind: "book", serviceId: "massage" }), intent({ kind: "book", serviceId: "haircut", time: { hour: 99, minute: 0, period: "am" } })]) {
      const { s, fake } = await withModel(() => answer, {}, true);
      const g = s.guest();
      const sent = await s.chat(g.hash, UNREADABLE, { id: "junk-1" });
      assert.equal(sent.status, 200);
      assert.equal(fake.calls, 1, "the model was asked once");
      assert.deepEqual((await s.status()).bookings, {}, `nothing was booked from ${JSON.stringify(answer).slice(0, 40)}`);
      assert.equal((await shopLines(s, g.hash)).length, 1, "and the guest still got an answer");
      assert.equal((await s.status()).tasks.failed, 0, "a bad answer is not a failed step");
    }
  });

  contract("a model that is down, or slow, does not stop the shop: the rules answer, and the next message asks the model again", async () => {
    const { s, fake } = await withModel(() => { throw new Error("down"); });
    await fake.close();
    const g = s.guest();
    assert.equal((await s.chat(g.hash, UNREADABLE, { id: "down-1" })).status, 200);
    assert.equal((await shopLines(s, g.hash)).length, 1);
    assert.equal((await s.chat(g.hash, "I want a haircut tomorrow at 6pm", { id: "down-2" })).status, 200, "and the next message is read, by the rules");
    assert.equal((await s.status()).bookings.awaiting_deposit, 1);
    assert.equal((await s.status()).tasks.failed, 0);
  });

  contract("button mode: with runtime.json asking for buttons, no model is asked at all and the shop answers with its buttons", async () => {
    const { s, fake } = await withModel(() => intent({ kind: "book", serviceId: "facial" }), { runtime: { ai: "buttons" } });
    const g = s.guest();
    await s.chat(g.hash, UNREADABLE, { id: "btn-1" });
    assert.equal(fake.calls, 0);
    assert.equal((await s.status()).ai.mode, "buttons");
    const lines = await shopLines(s, g.hash);
    assert.equal(lines.length, 1);
  });
});

// A model the builder hosts (B73): no line of the shared rate table prices it, so the runtime prices its calls at the builder's own rate (runtime.json parser.rate), keeps 0
// as 0, and with no rate records the call with no price (never 0). Moved here from bundle/test/self-hosted-model.test.ts, which ran it on the TypeScript runtime until
// 24 Nov 2026. The fake model answers every call with 100 input and 50 output tokens.
describe("a self-hosted model's calls are priced at the builder's rate", () => {
  const RATE = { inputUsdPerMillion: 0.2, outputUsdPerMillion: 0.6 };
  const read = async (rate: Record<string, number> | undefined): Promise<{ provider: string; model: string; cost: string | undefined; day: string }> => {
    const { s } = await withModel(() => intent({ kind: "book", language: "en", serviceId: "haircut" }), { parser: { provider: SELF_HOSTED_PROVIDER, model: "llama-local", ...(rate ? { rate } : {}) } });
    assert.equal((await s.inbound(CUSTOMER, UNREADABLE)).status, 200);
    const line = s.record().find((r) => r.action === "receive_message" && r.refs.step === "model");
    assert.ok(line, "the language model read the message");
    return { provider: line!.refs.provider, model: line!.refs.model, cost: line!.refs.costMicroInr, day: dayOf(s.now()) };
  };
  contract("priced at the builder's rate, from the day the shop started with it; 0 kept as 0; no rate is no price, never 0", async () => {
    const priced = await read(RATE);
    assert.deepEqual([priced.provider, priced.model], [SELF_HOSTED_PROVIDER, "llama-local"]);
    const want = costMicroInr(selfHostedRate("llama-local", RATE, priced.day), { inputTokens: 100, outputTokens: 50 })!;
    assert.ok(want > 0);
    assert.equal(priced.cost, String(want));
    assert.equal((await read({ inputUsdPerMillion: 0, outputUsdPerMillion: 0 })).cost, "0", "0 is the builder's own number, and is kept as 0");
    assert.equal((await read(undefined)).cost, undefined, "no rate: unknown, never 0");
  });
});
