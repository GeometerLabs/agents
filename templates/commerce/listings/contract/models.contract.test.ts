// The CONTRACT of the owner's words that no rule reads (modules/assistant/reading.ts, understanding/router.ts, conversation.ts talkToOwner): the router's decision model and language
// model choose only the KIND of what the owner wants, and words still unknown are answered by the talk model from the shop's notes and listings, through the talk's checks. Every
// model answer is untrusted: good answers, malformed JSON, wrong types, extra members, an HTTP error, a model that does not answer in time, and the day's and month's caps are run
// here with fake models (harness.ts startFakeModel, startFakeDecision), and what the owner reads, what the record says and which calls reached a model are compared line for line
// with the GOLDEN answers (golden.ts, golden/models.contract.json). Until 19 Nov 2026 a TypeScript shop and a Go shop ran each script at once and were compared; the TypeScript
// shop's answers were recorded before its runtime was deleted (decision 61, wave 1b), so the Go shop is now held to them. Like the other suites it talks to the shops ONLY over
// HTTP and their files.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { callName, makeShop, rawReply, slowReply, startFakeDecision, startFakeModel, statusReply } from "./harness.ts";
import type { FakeModel, Shop } from "./harness.ts";
import { goldenFor } from "./golden.ts";

const shops: Shop[] = [];
const fakes: FakeModel[] = [];
after(async () => { for (const s of shops) { await s.stop(); s.cleanup(); } for (const f of fakes) await f.close(); });

const golden = goldenFor(import.meta.url);

type Answer = (owner: string, body: any) => unknown;
const BUDGET = { monthlyMicroInr: 50_000_000, daily: { listing_draft: 20, owner_talk: 20, router: 50 } };

function record(s: Shop): any[] {
  const db = new DatabaseSync(join(s.dataDir, "agent.db"), { readOnly: true });
  try { return db.prepare("select entry from record order by seq").all().map((r: any) => JSON.parse(r.entry)); } finally { db.close(); }
}
const say = async (s: Shop, id: string, text: string): Promise<void> => {
  const r = await s.call("/internal/channel/events", { owner: s.owner, body: { events: [{ kind: "owner_message", id, text }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await s.settle();
};
/** A live listing to talk about, made through the owner's form (no model). */
async function kittens(s: Shop): Promise<void> {
  const r = await s.call("/internal/channel/owner-listing", { owner: s.owner, body: { id: "f-1", op: { op: "publish_form", category: "pets", title: "Persian kittens", priceInr: 8000, qty: 2, photos: [] } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await s.settle();
}

/** What a runtime must agree on after a script: the talk, the record's model lines, the month's counts and the calls the fakes saw. */
async function observe(s: Shop, model: FakeModel, decision?: FakeModel): Promise<any> {
  const page = (await s.call("/internal/channel/owner", { owner: s.owner })).body;
  const keep = ["owner_assistant", "talk", "send_message", "ai_mode", "memory"];
  return {
    talk: page.app.talk.map((l: any) => [l.from, l.text]),
    record: record(s).filter((e) => keep.includes(e.action)).map((e) => [e.action, e.outcome, e.refs, e.notes ?? "", e.language]),
    // the decision model's pause is a moment: the two shops run a few milliseconds apart, so only whether it is paused is compared
    ai: ((a) => ({ ...a, paused: { decision: a.paused?.decision ? "paused" : null } }))((await s.call("/status")).body.ai),
    calls: model.requests.map((r) => [callName(r.body), r.body.messages?.find((m: any) => m.role === "user")?.content]),
    decisions: decision?.requests.map((r) => [r.body.state, Object.keys(r.body.questions ?? {})]) ?? [],
  };
}

/** Run one script on a shop with its own fakes, and compare what it saw with the golden answer named `name` (golden.ts: the shop runs at the recorded instant). */
async function scripted(name: string, o: { answer: Answer; decide?: (state: string, q: any) => unknown; budget?: typeof BUDGET; parser?: Record<string, unknown>; decision?: Record<string, unknown>; listing?: boolean }, script: (s: Shop) => Promise<void>): Promise<any> {
  return golden(name, async () => {
    const model = await startFakeModel(o.answer); fakes.push(model);
    const decision = o.decide ? await startFakeDecision(o.decide) : undefined; if (decision) fakes.push(decision);
    const s = await makeShop({ modelPort: model.port, budget: o.budget ?? BUDGET, ...(o.parser ? { parser: o.parser } : {}), ...(decision ? { decision: { port: decision.port, ...(o.decision ?? {}) } } : {}) }); shops.push(s);
    await s.start();
    if (o.listing !== false) await kittens(s);
    await script(s);
    return observe(s, model, decision);
  });
}

const unknownKind = (_owner: string, body: any): unknown => (callName(body) === "intent" ? { kind: "unknown" } : undefined);
const talkSays = (sentences: { text: string; sources: string[] }[], extra: Record<string, unknown> = {}) => (owner: string, body: any): unknown =>
  callName(body) === "intent" ? { kind: "unknown" } : { sentences, ask_owner: null, note: null, limit: null, ...extra };

describe("the router's language model chooses only the kind; the rules give every value", () => {
  test("a kind the model chose is answered with the rules' date; a kind this shop does not take is unknown", async () => {
    const seen = await scripted("router: the kinds", { answer: (owner, body) => (callName(body) === "intent" ? { kind: /tuesday/u.test(owner) ? "money" : /holiday/u.test(owner) ? "close_day" : /pending/u.test(owner) ? "waiting" : "unknown" } : { sentences: [{ text: "Hello!", sources: [] }], ask_owner: null, note: null, limit: null }) }, async (s) => {
      for (const [i, t] of ["what did the shop bring in on the coming tuesday please", "take a holiday", "anything pending for me today", "ok then"].entries()) await say(s, `r-${i}`, t);
    });
    assert.ok(seen.record.some((r: any) => r[0] === "owner_assistant" && r[2].step === "model" && r[2].intent === "money"), "the model's kind is the intent");
    assert.ok(seen.talk.some(([from, t]: [string, string]) => from === "assistant" && /^Nothing recorded on Tue \d+ \w+ yet\.$/u.test(t)), "the rules' date with the model's kind");
  });

  test("untrusted answers: malformed JSON, wrong types, extra members, an HTTP error and a model that does not answer in time are read by the rules, and the record says why", async () => {
    // each in a shop of its own: a model step that fails puts the shop in the fault pause, and the next words would be read by the rules alone
    const replies: [string, unknown][] = [
      ["not json", rawReply("not json {")], ["kind is a number", { kind: 7 }], ["extra members", { kind: "waiting", extra: { deep: [1, 2] }, words: 12 }], ["http 500", statusReply(500)],
      ["too slow", slowReply(1500, { kind: "waiting" })], ["no such kind", { kind: "fly_to_moon" }], ["an array", [{ kind: "waiting" }]], ["fenced", rawReply("```json\n{\"kind\": \"help\"}\n```")],
      ["thinks first", rawReply("<think>hmm</think>{\"kind\":\"undo\"}")], ["rules only kind", { kind: "remember" }],
    ];
    const notes: string[] = [];
    for (const [name, reply] of replies) {
      // only the slow one has a short timeout: the others keep the harness's, so a busy machine cannot time them out
      const seen = await scripted(`untrusted: ${name}`, { listing: false, ...(name === "too slow" ? { parser: { timeoutMs: 600 } } : {}), answer: (_owner, body) => (callName(body) === "intent" ? reply : rawReply("{")) }, async (s) => { await say(s, "u-1", `the words are ${name}`); });
      notes.push(...seen.record.filter((r: any) => r[0] === "owner_assistant").map((r: any) => r[3]));
    }
    assert.ok(notes.some((n) => n.includes("its answer was not JSON")) && notes.some((n) => n.includes("no answer within 600 ms")) && notes.some((n) => n.includes("HTTP 500")) && notes.some((n) => n.includes("not a valid intent")), notes.join(" | "));
  });
});

describe("the decision model: a sure answer is the kind, an unsure one goes on to the language model, a failing one is paused", () => {
  test("sure, unsure, a wrong reply and an error", async () => {
    const probs = (choice: string, p: number) => ({ model: "laya", answers: { want: { type: "choice", choice, confidence: p, probabilities: Object.fromEntries(["waiting", "money", "cancel", "refund", "message", "undo", "limit", "help"].map((k) => [k, k === choice ? p : (1 - p) / 7])) } }, usage: { input_tokens: 40, output_tokens: 2 } });
    const seen = await scripted("decision model", {
      answer: (owner, body) => (callName(body) === "intent" ? { kind: "help" } : rawReply("{")),
      decide: (state) => (state.includes("one") ? probs("money", 0.9) : state.includes("two") ? probs("waiting", 0.5) : state.includes("three") ? { model: "laya", answers: { other: {} } } : state.includes("four") ? statusReply(503) : probs("undo", 0.95)),
    }, async (s) => {
      for (const [i, t] of ["words one", "my number is 9811111111 one", "words two", "words three", "words four", "words five four four", "words four again", "words one again"].entries()) await say(s, `d-${i}`, t);
    });
    assert.ok(seen.decisions.some((d: any) => d[0].includes("[number]")), "the number is taken out before the decision model sees the words");
  });
});

describe("the owner's talk: words still unknown are answered from the shop's notes and listings, through the talk's checks", () => {
  test("a reply that passes is shown and kept for the next prompt; the notes and the listing are its sources", async () => {
    const seen = await scripted("talk: a reply that passes", { answer: talkSays([{ text: "Your Persian kittens are on your page at ₹8,000.", sources: ["s:l-1"] }, { text: "You asked me to close at 6 on Saturdays.", sources: ["n-1"] }]) }, async (s) => {
      await say(s, "t-1", "remember we close at 6 on Saturdays");
      await say(s, "t-2", "how is the shop doing?");
      await say(s, "t-3", "and the kittens?");
    });
    assert.ok(seen.talk.some(([from, t]: [string, string]) => from === "assistant" && t.startsWith("Your Persian kittens are on your page")), JSON.stringify(seen.talk));
    assert.ok(seen.calls.some(([name, user]: [string, string]) => name === "talk" && user.includes("Earlier in this talk:")), "the second turn carries the first");
  });

  for (const [name, sentences, extra] of [
    ["a number no source states (check 2)", [{ text: "You sold 12 kittens.", sources: ["s:l-1"] }], {}],
    ["a word that says something was done (check 4)", [{ text: "Your kittens are booked.", sources: [] }], {}],
    ["a source the speaker may not see (check 1)", [{ text: "Hello.", sources: ["n-99"] }], {}],
    ["a link (check 5)", [{ text: "See shop.example.com for more.", sources: [] }], {}],
    ["a number word no source uses (check 2)", [{ text: "Half of them are gone.", sources: ["s:l-1"] }], {}],
    ["the wrong shape: no sentences", [], {}],
    ["the wrong types: a sentence's text is a number", [{ text: 5, sources: [] }], {}],
    ["extra members are dropped", [{ text: "Hello there.", sources: null, colour: "red" }], { mood: "happy", note: { kind: "fact", text: "x", audience: "owner" } }],
    ["a limit is named: which limit?", [{ text: "Sure.", sources: [] }], { limit: "refund_limit" }],
  ] as const) {
    test(`the talk's checks: ${name}`, async () => {
      const seen = await scripted(`talk check: ${name}`, { answer: talkSays(sentences as never, extra) }, async (s) => { await say(s, "c-1", "tell me about my shop please"); });
      assert.equal(seen.record.filter((r: any) => r[0] === "talk").length, 1);
    });
  }

  test("the talk model fails: malformed JSON, an HTTP error, no answer in time; the fixed line, and the fault pause", async () => {
    const replies: Record<string, unknown> = { "one?": rawReply("{oops"), "two?": statusReply(502), "three?": slowReply(1500, { sentences: [{ text: "late", sources: [] }] }) };
    await scripted("talk model fails", { parser: { timeoutMs: 600 }, answer: (owner, body) => (callName(body) === "intent" ? { kind: "unknown" } : replies[owner.split("\n").at(-1) ?? ""] ?? rawReply("{")) }, async (s) => {
      for (const [i, t] of Object.keys(replies).entries()) await say(s, `f-${i}`, t);
    });
  });

  test("the day's cap: the owner_talk feature stops for the day and the owner is told once; the month's budget stops the model too", async () => {
    const seen = await scripted("talk: the day's cap", { budget: { monthlyMicroInr: 50_000_000, daily: { owner_talk: 1, router: 50 } }, answer: talkSays([{ text: "Hello there.", sources: [] }]) }, async (s) => {
      for (const t of ["first words", "second words", "third words"]) await say(s, t.replace(" ", "-"), t);
    });
    assert.equal(seen.calls.filter((c: any) => c[0] === "talk").length, 1);
    await scripted("talk: the month's budget", { budget: { monthlyMicroInr: 150_000, daily: { owner_talk: 50, router: 50 } }, answer: talkSays([{ text: "Hello there.", sources: [] }]) }, async (s) => {
      for (const t of ["first words", "second words", "third words"]) await say(s, t.replace(" ", "-"), t);
    });
  });

  test("with no model at all the talk is off and the fixed line is said; nothing is asked", async () => {
    await golden("no model", async () => {
      const s = await makeShop({}); shops.push(s); await s.start();
      await say(s, "n-1", "tell me about my shop please");
      return (await s.call("/internal/channel/owner", { owner: s.owner })).body.app.talk.map((l: any) => l.text);
    });
  });
});
