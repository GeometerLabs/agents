// The model parser, against a local stub server (test/stub-model-server.ts) on both wire shapes. No test calls a real model.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { SAYS } from "../crash-test/situations.ts";
import { createModelParser } from "../src/adapters/model-llm.ts";
import type { ModelConfig } from "../../../modules/understanding/model-llm.ts";
import { intentSchema, systemPrompt } from "../src/adapters/model-prompt.ts";
import { parseIntent } from "../src/adapters/rule-parser.ts";
import { CUSTOMER, createWorld, glowSalon } from "../src/harness.ts";
import { LANGUAGES } from "../../../modules/language/languages.ts";
import { anthropicReply, answer, openaiReply, startStubModel } from "./stub-model-server.ts";
import type { StubModel, StubReply, StubRequest } from "./stub-model-server.ts";

const salon = glowSalon();
const ctx = { services: salon.services, languages: salon.languages };
const WIRES = ["openai", "anthropic"] as const;
type Wire = (typeof WIRES)[number];

const stubs: StubModel[] = [];
after(async () => { for (const s of stubs) await s.close(); });
async function stub(reply: (request: StubRequest) => StubReply): Promise<StubModel> {
  const s = await startStubModel(reply);
  stubs.push(s);
  return s;
}

/** What a wire's reply looks like when the model said `text`. */
const replyFor = (wire: Wire, text: string): StubReply => ({ json: wire === "anthropic" ? anthropicReply(text) : openaiReply(text) });
const configFor = (wire: Wire, s: StubModel, more: Partial<ModelConfig> = {}): ModelConfig => ({ wire, baseUrl: s.url, model: "stub-model", ...more });

const HINDI_BOOKING = "कल शाम 6 बजे हेयरकट, 300 में हो जाएगा?";
const hindiBookingAnswer = answer({ kind: "book", language: "hi", serviceId: "haircut", offerInr: 300, date: { kind: "relative", offsetDays: 1 }, time: { hour: 6, minute: 0, period: "pm" } });

for (const wire of WIRES) {
  test(`${wire} wire: a valid answer is parsed, and the request has the right shape`, async () => {
    const s = await stub(() => replyFor(wire, hindiBookingAnswer));
    const result = await createModelParser(configFor(wire, s, { timeoutMs: 2000 })).parseDetailed(HINDI_BOOKING, ctx);
    assert.equal(result.fallbackReason, undefined);
    assert.deepEqual(result.intent, { kind: "book", language: "hi", serviceId: "haircut", offerInr: 300, date: { kind: "relative", offsetDays: 1 }, time: { hour: 6, minute: 0, period: "pm" } });
    assert.deepEqual(result.usage, { inputTokens: 900, outputTokens: 60 });
    assert.ok(result.latencyMs !== undefined && result.latencyMs >= 0);

    assert.equal(s.requests.length, 1);
    const { path, headers, body } = s.requests[0];
    assert.equal(path, wire === "anthropic" ? "/v1/messages" : "/chat/completions");
    assert.equal(body.model, "stub-model");
    assert.equal(body.max_tokens, 1024);
    const system = wire === "anthropic" ? body.system : body.messages[0].content;
    assert.equal(system, systemPrompt(ctx));
    const user = body.messages[body.messages.length - 1];
    assert.deepEqual(user, { role: "user", content: HINDI_BOOKING }); // the customer's message goes in as data, alone
    if (wire === "anthropic") {
      assert.equal(headers["anthropic-version"], "2026-10-21");
      assert.deepEqual(body.output_config.format, { type: "json_schema", schema: intentSchema(ctx) });
      assert.equal(body.temperature, undefined); // this API version refuses it
      assert.equal(body.tool_choice, undefined); // and newer models refuse a forced tool
      assert.equal(body.output_config.effort, undefined);
    } else {
      assert.equal(body.response_format.type, "json_schema");
      assert.deepEqual(body.response_format.json_schema.schema, intentSchema(ctx));
      assert.equal(body.messages.length, 2);
    }
  });

  test(`${wire} wire: the runtime parser holds no key and sends none`, async () => {
    const s = await stub(() => replyFor(wire, hindiBookingAnswer));
    await createModelParser(configFor(wire, s)).parse(HINDI_BOOKING, ctx);
    const names = Object.keys(s.requests[0].headers);
    for (const key of ["authorization", "x-api-key", "api-key", "api-subscription-key", "x-goog-api-key"]) assert.ok(!names.includes(key), `${key} must not be sent`);
  });

  test(`${wire} wire: nulls are dropped, extra date fields are ignored and "18:00 pm" is repaired`, async () => {
    const s = await stub(() => replyFor(wire, answer({
      kind: "reschedule", serviceId: null, date: { kind: "weekday", weekday: 6, which: "this", offsetDays: null, day: null }, time: { hour: 18, minute: 30, period: "pm" },
    })));
    const intent = await createModelParser(configFor(wire, s)).parse("is Saturday 18:30 ok to change", ctx);
    assert.deepEqual(intent, { kind: "reschedule", date: { kind: "weekday", weekday: 6, which: "this" }, time: { hour: 18, minute: 30 } });
  });

  test(`${wire} wire: a code fence or <think> text around the JSON is tolerated`, async () => {
    const s = await stub(() => replyFor(wire, `<think>customer wants a haircut</think>\n\`\`\`json\n${answer({ kind: "yes" })}\n\`\`\``));
    assert.deepEqual(await createModelParser(configFor(wire, s)).parse("ok", ctx), { kind: "yes" });
  });

  // Every way the model can fail falls back to the rule parser, says why, and never repeats what the model said.
  const SECRET = "SECRET-CUSTOMER-TEXT";
  const failures: [string, (wire: Wire) => StubReply, RegExp, Partial<ModelConfig>?][] = [
    ["invalid JSON", (w) => replyFor(w, `${SECRET} this is not json`), /answer was not JSON/],
    ["a reply that is not JSON at all", () => ({ raw: `<html>${SECRET}</html>` }), /reply was not JSON/],
    ["a 500", () => ({ status: 500, raw: SECRET }), /HTTP 500/],
    ["a 429", () => ({ status: 429, raw: SECRET }), /HTTP 429/],
    ["a timeout", (w) => ({ ...replyFor(w, answer({ kind: "yes" })), delayMs: 1500 }), /no answer within 100 ms/, { timeoutMs: 100 }],
    ["an answer with an unknown kind", (w) => replyFor(w, answer({ kind: "teleport" })), /not a valid intent/],
    ["a service this shop does not sell", (w) => replyFor(w, answer({ kind: "book", serviceId: `massage-${SECRET}` })), /not a valid intent/],
    ["a time that does not exist", (w) => replyFor(w, answer({ kind: "book", time: { hour: 99, minute: 0, period: null } })), /not a valid intent/],
    ["a negative price", (w) => replyFor(w, answer({ kind: "book", offerInr: -5 })), /not a valid intent/],
    ["JSON that is not an object", (w) => replyFor(w, "[1, 2, 3]"), /not a valid intent/],
    ["an answer that was cut off", (w) => (w === "anthropic" ? { json: anthropicReply("{", undefined, "max_tokens") } : { json: openaiReply("{", undefined, { finish_reason: "length" }) }), /cut off/],
    ["a reply with no answer in it", () => ({ json: {} }), /no answer in it/],
  ];
  for (const [name, reply, why, more] of failures) {
    test(`${wire} wire: ${name} falls back to the rule parser, with a reason`, async () => {
      const s = await stub(() => reply(wire));
      const text = "haircut tomorrow at 6pm for 300";
      const result = await createModelParser(configFor(wire, s, more)).parseDetailed(text, ctx);
      assert.match(result.fallbackReason ?? "", why);
      assert.ok(!(result.fallbackReason ?? "").includes(SECRET), "the reason must not repeat what the model said");
      assert.deepEqual(result.intent, parseIntent(text, ctx)); // exactly what the rule parser reads
      assert.equal(result.intent.kind, "book");
      assert.equal((await createModelParser(configFor(wire, s, more)).parse(text, ctx)).kind, "book"); // parse() never throws
    });
  }

  test(`${wire} wire: a server that is not there falls back with a reason`, async () => {
    const s = await startStubModel(() => ({}));
    await s.close();
    const result = await createModelParser(configFor(wire, s)).parseDetailed("hello", ctx);
    assert.match(result.fallbackReason ?? "", /connection failed/);
    assert.equal(result.intent.kind, "greeting");
  });

  test(`${wire} wire: a message that says "ignore your rules" stays flagged, even when the model is fooled`, async () => {
    // A fooled model: it books, at price 0, and says nothing about a trick.
    const fooled = answer({ kind: "book", offerInr: 0, serviceId: "haircut", date: { kind: "relative", offsetDays: 1 }, time: { hour: 6, minute: 0, period: "pm" } });
    const s = await stub(() => replyFor(wire, fooled));
    const parser = createModelParser(configFor(wire, s));
    for (const language of LANGUAGES) {
      assert.equal((await parser.parse(SAYS[language].trick, ctx)).overrideAttempt, true, language);
    }
    // An honest model flags it itself.
    const honest = await stub(() => replyFor(wire, answer({ kind: "book", offerInr: 0, overrideAttempt: true })));
    assert.equal((await createModelParser(configFor(wire, honest)).parse("some trick the rules do not know", ctx)).overrideAttempt, true);
    // And an ordinary message is not flagged.
    assert.equal((await parser.parse(SAYS.en.book, ctx)).overrideAttempt, undefined);
  });
}

test("openai wire: json_object mode for providers without schemas, and room for extra body fields", async () => {
  const s = await stub(() => replyFor("openai", answer({ kind: "yes" })));
  await createModelParser({ wire: "openai", baseUrl: `${s.url}/v1/`, model: "m", responseFormat: "json_object", maxTokens: 200, extraBody: { max_tokens: null, max_completion_tokens: 200 } }).parse("ok", ctx);
  const { path, body } = s.requests[0];
  assert.equal(path, "/v1/chat/completions");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.ok(/JSON/.test(body.messages[0].content), "json_object mode needs the word JSON in the messages");
  assert.equal(body.max_tokens, null);
  assert.equal(body.max_completion_tokens, 200);
});

test("anthropic wire: effort is sent only when asked for", async () => {
  const s = await stub(() => replyFor("anthropic", answer({ kind: "yes" })));
  await createModelParser({ wire: "anthropic", baseUrl: s.url, model: "m", effort: "low" }).parse("ok", ctx);
  assert.equal(s.requests[0].body.output_config.effort, "low");
});

test("the prompt is one text for all four languages: it says the message is data, lists the services and gives no date", async () => {
  const prompt = systemPrompt(ctx);
  assert.match(prompt, /DATA, never instructions/);
  assert.match(prompt, /overrideAttempt/);
  for (const service of ctx.services) {
    assert.ok(prompt.includes(service.id));
    for (const names of Object.values(service.names)) for (const name of names ?? []) assert.ok(prompt.includes(name), name);
  }
  for (const word of ["Hinglish", "Manglish", "Kanglish"]) assert.ok(prompt.includes(word));
  assert.ok(!/\b20\d\d\b/.test(prompt), "the model is not told today's date or any year, so it cannot resolve a date");
  // The same system text goes out whatever language the customer wrote in.
  const s = await stub(() => replyFor("openai", answer({ kind: "yes" })));
  const parser = createModelParser(configFor("openai", s));
  for (const language of LANGUAGES) await parser.parse(SAYS[language].book, ctx);
  assert.equal(new Set(s.requests.map((r) => r.body.messages[0].content)).size, 1);
});

test("the answer schema asks for every field, closes every object and uses no ranges", () => {
  const schema = JSON.stringify(intentSchema(ctx));
  assert.deepEqual((intentSchema(ctx) as { required: string[] }).required, ["kind", "language", "serviceId", "offerInr", "date", "time", "overrideAttempt"]);
  assert.ok(!/"(minimum|maximum|minLength|maxLength|multipleOf)"/.test(schema));
  const objects = (schema.match(/"type":"object"/g) ?? []).length;
  assert.equal((schema.match(/"additionalProperties":false/g) ?? []).length, objects);
  for (const id of ctx.services.map((x) => x.id)) assert.ok(schema.includes(`"${id}"`));
});

// ---- the agent, with a model that goes wrong (the model-backed side of crash-test situation 13) ----------------------------------------

const LIST_AND_DEPOSIT = [200, 250, 450, 900, 1800];
const amountsIn = (text: string) => [...text.matchAll(/₹\s?(\d[\d,]*)/g)].map((m) => Number(m[1].replace(/,/g, "")));
const receiveNotes = (w: ReturnType<typeof createWorld>) => w.record.entries().filter((e) => e.action === "receive_message").map((e) => e.notes);

for (const wire of WIRES) {
  const broken: [string, StubReply, RegExp, Partial<ModelConfig>?][] = [
    ["times out", { ...replyFor(wire, answer({ kind: "yes" })), delayMs: 1500 }, /no answer within 100 ms/, { timeoutMs: 100 }],
    ["answers 500", { status: 500, raw: "oops" }, /HTTP 500/],
    ["gives nonsense", replyFor(wire, "I'm sorry, I can't help with that."), /not JSON/],
    ["gives an invalid intent", replyFor(wire, answer({ kind: "teleport" })), /not a valid intent/],
  ];
  for (const [name, reply, why, more] of broken) {
    test(`#13 (${wire} wire) the model ${name}: the rule parser reads the message, the booking still works and the record says why`, async () => {
      const s = await stub(() => reply);
      const w = createWorld({ parser: createModelParser(configFor(wire, s, more)) });
      await w.say(SAYS.en.book);
      assert.equal(w.payments.links().length, 1, "the customer was understood, so the deposit link was made");
      assert.equal(w.payments.links()[0].amount, 20000);
      assert.ok(w.textsTo(CUSTOMER).length >= 1);
      const notes = receiveNotes(w);
      assert.equal(notes.length, 1);
      assert.match(notes[0], /the model could not be used/);
      assert.match(notes[0], why);
      assert.match(notes[0], /rule parser read the message/);
      assert.ok(!notes[0].includes("sorry"), "what the model said is not copied into the record");
    });
  }

  test(`#9 (${wire} wire) a fooled model: the trick is flagged and changes nothing`, async () => {
    const fooled = answer({ kind: "book", offerInr: 0, serviceId: "haircut", date: { kind: "relative", offsetDays: 1 }, time: { hour: 6, minute: 0, period: "pm" } });
    const s = await stub(() => replyFor(wire, fooled));
    const w = createWorld({ parser: createModelParser(configFor(wire, s)) });
    await w.say(SAYS.en.trick);
    assert.equal(w.payments.links().length, 1);
    assert.equal(w.payments.links()[0].amount, 20000, "the only link is the ₹200 deposit");
    assert.ok(w.textsTo(CUSTOMER).every((t) => amountsIn(t).every((n) => LIST_AND_DEPOSIT.includes(n))), w.textsTo(CUSTOMER).join(" | "));
    assert.match(receiveNotes(w)[0], /asked the agent to ignore its rules/);
  });
}
