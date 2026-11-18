// The assistant makes the listing (block S, phase A), on fakes: the owner's words become ONE card and nothing is public before the tap; the price, note and quantity come from the
// owner's words by rule; a number or a claim the owner did not say refuses the draft; protected animals are refused before the model is asked; a customer's words never write;
// the card publishes exactly the fields it showed; "Still have it?" renews or sells; the morning asks at most 3 a day. Not tested on a real model: the talk model is a script.
// Written, not run, in the 18 Nov build stream: the lead's test pass runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAssistant, kindsOf } from "../conversation.ts";
import { readOwnerRules } from "../intents.ts";
import { defaultCharacter } from "../character.ts";
import { LISTING_CUE, groundedIn, numbersIn, readListingWords } from "../listing-draft.ts";
import { createListings } from "../listing-card.ts";
import type { OwnerSkill } from "../skill.ts";
import type { AssistantState } from "../state.ts";
import type { AiStore } from "../../understanding/ai-state.ts";
import type { TalkCallResult, TalkModel } from "../../understanding/talk.ts";
import { fakeClock } from "../../core/clock.ts";
import { DAY, HOUR, zonedToMs } from "../../core/time.ts";
import { createFakeMessaging } from "../../messaging/messaging.ts";
import { createRecord } from "../../record/record.ts";
import { listingsOf, publicListings } from "../../listings/listings.ts";
import { LISTING_WORDS } from "../../listings/words.ts";

const TZ = "Asia/Kolkata";
const OWNER = "+919000000000";
const CUSTOMER = "+919111111111";
const NOW = zonedToMs({ year: 2026, month: 11, day: 18 }, { hour: 11, minute: 0 }, TZ);
const skill: OwnerSkill = { name: "bookings", routing: { refs: /^b-\d+$/u, buttonPrefixes: [], words: {}, liveCaseOf: () => undefined }, day: () => [], waiting: () => [], problems: () => 0, prepare: () => ({ ok: false, why: "busy" }), execute: async () => ({ ok: false, note: "failed" }) };

const good = (over: Record<string, unknown> = {}) => ({
  category: "pets", claims: [],
  titles: { en: "Persian kitten", hi: "फ़ारसी बिल्ली का बच्चा", ml: "പേർഷ്യൻ പൂച്ചക്കുട്ടി", kn: "ಪರ್ಷಿಯನ್ ಬೆಕ್ಕಿನ ಮರಿ" },
  texts: { en: "Two kittens for a good home.", hi: "दो बच्चे, अच्छे घर के लिए।", ml: "രണ്ട് കുഞ്ഞുങ്ങൾ.", kn: "ಎರಡು ಮರಿಗಳು." }, ...over,
});

function world(o: { model?: boolean; reply?: () => unknown } = {}) {
  const clock = fakeClock(NOW);
  const messaging = createFakeMessaging(clock);
  const record = createRecord(clock);
  const store: { assistant?: AssistantState } & AiStore = {};
  const calls: { system: string; user: string }[] = [];
  const script: { reply: unknown } = { reply: good() };
  const model: TalkModel = {
    async ask(call): Promise<TalkCallResult> {
      calls.push({ system: call.system, user: call.user });
      return { usage: { inputTokens: 1000, outputTokens: 300 }, costMicroInr: 5000, rateDate: "2026-11-07", provider: "fake", model: "fake", latencyMs: 1, answer: o.reply ? o.reply() : script.reply } as TalkCallResult;
    },
  };
  const log = (caseId: string | null, conversation: string, action: string, outcome: never, inputs: unknown, more: { notes?: string; refs?: Record<string, string>; language?: "en" }) => { record.append({ conversation, booking: caseId, action, inputs, outcome, language: more.language ?? "en", ...(more.notes ? { notes: more.notes } : {}), ...(more.refs ? { refs: more.refs } : {}) }); };
  const listings = createListings({ store, nowMs: () => clock.now(), ownerLanguage: "en", log: (action, outcome, inputs, refs, notes) => log(null, OWNER, action, outcome as never, inputs, { refs, ...(notes ? { notes } : {}) }) });
  const skills = [skill, listings.skill];
  const assistant = createAssistant({
    shop: { name: "Paws & Co", timezone: TZ, owner: { whatsapp: OWNER, language: "en" }, settings: { morningAt: { hour: 8, minute: 0 }, character: defaultCharacter() } },
    store, skills, clock, messaging, listings,
    read: async (text) => ({ intent: readOwnerRules(text, { kinds: kindsOf(skills) }), refs: {} }),
    log: log as never, entries: () => record.entries(), languageOf: () => "en", optedOut: () => false,
    talk: { ...(o.model === false ? {} : { model }), policy: {} },
  });
  const sayOwner = async (text: string, reply?: { id: string; kind: "button" }) => { await assistant.onOwnerMessage(messaging.receive(OWNER, text, reply ? { reply } : {})); return messaging.sentTo(OWNER).at(-1); };
  const codeOf = (m: { text?: string; body?: string } | undefined): string => /yes ([A-Z0-9]+)/u.exec(JSON.stringify(m))![1];
  const pend = (n = 1) => { const s = listingsOf(store.assistant ??= { seq: 0, cards: [], refused: [], closedDays: [], undo: [], talk: [], limitChanges: [] }); for (let i = 0; i < n; i++) s.pending.push({ id: `ph-00000000000${i}`, type: "image/jpeg", width: 800, height: 600, bytes: 1000, atMs: clock.now() }); };
  return { clock, messaging, record, store, assistant, calls, script, sayOwner, codeOf, pend };
}
const state = (w: ReturnType<typeof world>) => listingsOf(w.store.assistant!);

test("the owner's words give the price, its note and the quantity by rule; a bare number is never money; two numbers give no quantity", () => {
  assert.deepEqual(readListingWords("two Persian kittens, ₹8,000 each"), { pricePaise: 800000, priceNote: "each", qty: 2, ownerLang: "en" });
  assert.deepEqual(readListingWords("3 cycles Rs 4500"), { pricePaise: 450000, qty: 3, ownerLang: "en" });
  assert.equal(readListingWords("Persian kitten 8000").pricePaise, undefined);
  assert.equal(readListingWords("2 kittens and 3 puppies ₹5000").qty, undefined);
  assert.equal(readListingWords("kitten 2 months old ₹5000").qty, undefined);
  assert.equal(readListingWords("पांच साइकिल ₹4500 प्रति नग").qty, 5);
  assert.equal(readListingWords("पांच साइकिल ₹4500 प्रति नग").ownerLang, "hi");
});

test("numbers are compared by value, in any language: a model may translate 'two' but may not invent 9000", () => {
  assert.ok(numbersIn("two kittens 8,000").has(2) && numbersIn("two kittens 8,000").has(8000));
  assert.ok(numbersIn("दो बच्चे").has(2) && numbersIn("രണ്ട് കുഞ്ഞുങ്ങൾ").has(2) && numbersIn("ಎರಡು ಮರಿಗಳು").has(2));
  assert.deepEqual(groundedIn("two Persian kittens, ₹8,000 each", { en: { title: "Persian kitten", text: "Two kittens." }, hi: { title: "बिल्ली", text: "दो बच्चे।" } }, []), { ok: true });
  assert.deepEqual(groundedIn("two Persian kittens, ₹8,000 each", { en: { title: "Persian kitten", text: "Only ₹9,000." } }, []), { ok: false, why: "numbers" });
  assert.deepEqual(groundedIn("two Persian kittens", { en: { title: "Persian kitten", text: "Three kittens." } }, []), { ok: false, why: "numbers" });
});

test("claims the owner did not make are refused: a guarantee, a discount, a health word; the owner's own are allowed", () => {
  assert.deepEqual(groundedIn("Persian kitten", { en: { title: "Kitten", text: "We guarantee it." } }, []), { ok: false, why: "claims" });
  assert.deepEqual(groundedIn("Persian kitten", { en: { title: "Kitten", text: "Free delivery." } }, []), { ok: false, why: "claims" });
  assert.deepEqual(groundedIn("Persian kitten", { en: { title: "Kitten", text: "Healthy and playful." } }, []), { ok: false, why: "health" });
  assert.deepEqual(groundedIn("Persian kitten, vaccinated", { en: { title: "Kitten", text: "Vaccinated and playful." } }, ["vaccinated"]), { ok: true });
  assert.deepEqual(groundedIn("Persian kitten", { en: { title: "Kitten", text: "Playful." } }, ["vaccinated"]), { ok: false, why: "claims" });
});

test("a photo waiting makes the owner's words a listing; ONE card is shown, nothing is public, and the tap publishes exactly its fields", async () => {
  const w = world();
  w.pend(2);
  const card = await w.sayOwner("two Persian kittens, ₹8,000 each");
  assert.equal(w.calls.length, 1);
  assert.ok(/8,000/u.test(JSON.stringify(card)), "the card shows the owner's price");
  assert.ok(JSON.stringify(card).includes(LISTING_WORDS.en.show) || /yes/u.test(JSON.stringify(card)));
  const l = state(w).items[0];
  assert.equal(l.state, "draft");
  assert.deepEqual([l.pricePaise, l.priceNote, l.qty, l.photos.length], [800000, "each", 2, 2]);
  assert.equal(publicListings(state(w), NOW).length, 0, "not public before the tap");
  assert.equal(w.store.assistant!.cards.filter((c) => c.state === "open").length, 1);
  await w.sayOwner("", { id: `card-yes:${w.codeOf(card)}`, kind: "button" });
  assert.equal(state(w).items[0].state, "live");
  assert.equal(publicListings(state(w), NOW).length, 1);
  assert.deepEqual([state(w).items[0].by, state(w).items[0].from], ["owner", "whatsapp"]);
  assert.ok(w.record.entries().some((e) => e.action === "listing" && e.refs.change === "published"));
});

test("the model's number is never used: a draft with a price the owner did not say is refused, with no listing and no card", async () => {
  const w = world();
  w.script.reply = good({ texts: { en: "Only ₹9,000.", hi: "x", ml: "x", kn: "x" } });
  w.pend();
  await w.sayOwner("two Persian kittens, ₹8,000 each");
  assert.equal(state(w).items.length, 0);
  assert.equal(w.store.assistant!.cards.length, 0);
});

test("a protected native animal is refused before the model is asked (nothing to pay for), in four languages", async () => {
  for (const text of ["Indian parakeet pair ₹2000 for sale", "बंदर बिक्री के लिए ₹5000", "കുരങ്ങ് വിൽപ്പനയ്ക്ക് ₹5000", "ಗೂಬೆ ಮಾರಾಟಕ್ಕೆ ₹5000"]) {
    const w = world();
    const said = await w.sayOwner(text);
    assert.equal(w.calls.length, 0, text);
    assert.equal(listingsOf(w.store.assistant ?? {} as AssistantState).items.length, 0);
    assert.ok(said, text);
  }
});

test("without a model, the owner is told to use the form; with no photo and no cue, the words are not a listing", async () => {
  const w = world({ model: false });
  w.pend();
  const said = await w.sayOwner("two Persian kittens, ₹8,000 each");
  assert.ok(JSON.stringify(said).includes("form"));
  assert.equal(LISTING_CUE.test("put this on my page"), true);
  assert.equal(LISTING_CUE.test("what is my day"), false);
});

test("a no drops the draft; it was never public, and the same words can be sent again", async () => {
  const w = world();
  w.pend();
  const card = await w.sayOwner("two Persian kittens, ₹8,000 each");
  await w.sayOwner("", { id: `card-no:${w.codeOf(card)}`, kind: "button" });
  assert.equal(state(w).items[0].state, "removed");
  assert.equal(publicListings(state(w), NOW).length, 0);
});

test("a customer's words never write a listing: the customer talk has no way in, and the source says so", async () => {
  const w = world();
  const sent = await w.assistant.talkToCustomer({ phone: CUSTOMER, text: "list my kitten for sale ₹5000 on my page", language: "en" });
  void sent;
  assert.equal(w.store.assistant?.listings?.items?.length ?? 0, 0);
});

test("'Still have it?' asks at most 3 a day after the morning hour; Yes renews, Sold hides it", async () => {
  const w = world();
  const ls = listingsOf((w.store.assistant ??= { seq: 0, cards: [], refused: [], closedDays: [], undo: [], talk: [], limitChanges: [] }));
  for (let i = 1; i <= 5; i++) ls.items.push({ id: `l-${i}`, state: "live", category: "other", ownerLang: "en", words: { en: { title: `Thing ${i}`, text: "" } }, photos: [], createdMs: NOW - 4 * DAY, publishedMs: NOW - 4 * DAY, confirmedMs: NOW - 4 * DAY, by: "owner", from: "app" });
  ls.seq = 5;
  w.clock.set(zonedToMs({ year: 2026, month: 11, day: 18 }, { hour: 8, minute: 30 }, TZ));
  await w.assistant.onTick();
  assert.equal(w.store.assistant!.cards.filter((c) => c.state === "open" && c.action.kind === "listing_ask").length, 3);
  await w.assistant.onTick();
  assert.equal(w.store.assistant!.cards.filter((c) => c.action.kind === "listing_ask").length, 3, "no more that day");
  const [first] = w.store.assistant!.cards;
  await w.assistant.onPageCard({ card: first.id, digest: first.digest, answer: "yes" });
  assert.equal(ls.items.find((l) => first.action.case === `listing:${l.id}`)!.confirmedMs, w.clock.now());
  const second = w.store.assistant!.cards[1];
  await w.assistant.onPageCard({ card: second.id, digest: second.digest, answer: "no" });
  assert.equal(ls.items.find((l) => second.action.case === `listing:${l.id}`)!.state, "sold");
  void HOUR;
});

test("pets: a customer's answer never says an animal is healthy or vaccinated unless the listing says so, and then as 'the owner says'", async () => {
  const w = world();
  const ls = listingsOf((w.store.assistant ??= { seq: 0, cards: [], refused: [], closedDays: [], undo: [], talk: [], limitChanges: [] }));
  ls.items.push({ id: "l-1", state: "live", category: "pets", ownerLang: "en", words: { en: { title: "Persian kitten", text: "Playful." } }, pricePaise: 800000, priceNote: "each", photos: [], createdMs: NOW, publishedMs: NOW, confirmedMs: NOW, by: "owner", from: "app", claims: ["vaccinated"] });
  ls.items.push({ id: "l-2", state: "live", category: "pets", ownerLang: "en", words: { en: { title: "Tabby kitten", text: "Playful." } }, photos: [], createdMs: NOW, publishedMs: NOW, confirmedMs: NOW, by: "owner", from: "app" });
  ls.seq = 2;
  const ask = async (reply: unknown) => { w.script.reply = reply; w.messaging.receive(CUSTOMER, "is the kitten healthy?"); /* the customer wrote, so their 24-hour window is open */ const before = w.messaging.sentTo(CUSTOMER).length; const sent = await w.assistant.talkToCustomer({ phone: CUSTOMER, text: "is the kitten healthy?", language: "en" }); return { sent, n: w.messaging.sentTo(CUSTOMER).length - before }; };
  const unsure = await ask({ sentences: [{ text: "The Tabby kitten is healthy.", sources: ["s:l-2"] }], ask_owner: false });
  assert.deepEqual([unsure.sent, unsure.n], [false, 0]);
  const none = await ask({ sentences: [{ text: "Yes, healthy and vaccinated.", sources: [] }], ask_owner: false });
  assert.deepEqual([none.sent, none.n], [false, 0]);
  const said = await ask({ sentences: [{ text: "The owner says: vaccinated.", sources: ["s:l-1"] }], ask_owner: false });
  assert.deepEqual([said.sent, said.n], [true, 1]);
});
