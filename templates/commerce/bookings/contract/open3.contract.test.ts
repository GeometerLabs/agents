// THE LAST OPEN CASES (README.md section 8): the owner's assistant on WhatsApp beyond the cancel card (a day's list, money, close a day and undo, move a booking, a message to a
// customer, a limit by card, the morning line), the decision model's step-breaker through its pause and its resume (on the TEST clock, in a "fakes" shop, read from the record),
// the cancel-confirmation buttons and "Talk to the owner", and voice notes from the owner and from the owner's page. A "guards" shop with the real clock, unless said; days are
// the first open day three or more days ahead, named as the shop names them ("Wed 25 Nov").
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { systemOneStandin } from "../../../../modules/standins/system-one.ts";
import { fakeWebmVoiceNote } from "../../../../modules/voice/standin.ts";
import { CUSTOMER, MIN, OTHER_CUSTOMER, OWNER_NUMBER, TZ, contract, makeShop, openStart, sleep, startFakeModel } from "./harness.ts";
import type { FakeModel, Shop } from "./harness.ts";
import { startFakeSpeech } from "./voice-guard.ts";

const shops: Shop[] = [];
const closers: { close(): Promise<void> }[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } for (const c of closers) await c.close(); });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
const link = (s: Shop) => s.guards!.standins.fakes.payments.links()[0];
const refundCalls = (s: Shop) => s.guards!.of("payments", "POST", /\/refund$/u);
const part = (ms: number, t: string, o: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...o }).formatToParts(ms).find((x) => x.type === t)!.value;
/** "Wed 25 Nov", the way the shop names a day. */
const label = (ms: number): string => `${part(ms, "weekday", { weekday: "short" })} ${part(ms, "day", { day: "numeric" })} ${part(ms, "month", { month: "short" })}`;
/** "25 Nov", a date the owner can type. */
const typed = (ms: number): string => `${part(ms, "day", { day: "numeric" })} ${part(ms, "month", { month: "short" })}`;
const owner = (s: Shop, text: string) => s.inbound(OWNER_NUMBER, text);
const lastOwner = (s: Shop): string => s.sent(OWNER_NUMBER).at(-1)!.text;
const lastCustomer = (s: Shop, who = CUSTOMER): string => s.sent(who).at(-1)!.text;
/** The shop with an assistant and a paid WhatsApp booking at 11:00 on an open day: b-1 of +919811111111. */
async function booked(o: Parameters<typeof makeShop>[0] = {}): Promise<{ s: Shop; start: number }> {
  const s = await boot({ mode: "guards", settings: { assistant: {} }, ...o });
  const start = openStart(s.now(), 3);
  await s.inbound(CUSTOMER, `haircut on ${typed(start)} at 11am`);
  await s.events(s.guards!.pay(link(s).id).map((event) => ({ kind: "payment_event", event }))); await s.settle();
  assert.equal((await s.status()).bookings.confirmed, 1);
  return { s, start };
}
const cardOf = (s: Shop) => { const m = s.sent(OWNER_NUMBER).filter((x) => x.interactive?.buttons?.some((b: { id: string }) => b.id.startsWith("card-"))).at(-1)!; return { text: m.text, yes: m.interactive.buttons[0].id as string }; };

describe("the owner's assistant: asks, closing a day, moving a booking", () => {
  contract("a day's list, money in, and what needs me are answered by the rules for nothing", async () => {
    const { s, start } = await booked();
    await owner(s, `bookings ${typed(start)}`);
    assert.equal(lastOwner(s), `${label(start)}, bookings: 1\n11:00 am haircut, +919811111111 (b-1)`);
    await owner(s, "how much money today");
    assert.match(lastOwner(s), /^Recorded on [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}: ₹200 from payments: 1\.$/u);
    await owner(s, "what needs me");
    assert.equal(lastOwner(s), "Nothing needs you right now.");
    assert.ok(s.record().filter((r) => r.action === "owner_assistant").every((r) => r.refs.step === "rules" && r.refs.costMicroInr === "0"), "the rules read them, for nothing");
  });

  contract("close a day: the customers that day are asked to move and stay booked, nobody else can book it, and undo opens it again", async () => {
    const { s, start } = await booked();
    await owner(s, `close ${typed(start)}`);
    assert.equal(lastOwner(s), `Closed ${label(start)}. Bookings that day: 1. I've asked them to pick another day. Reply undo to open it again.`);
    assert.equal(lastCustomer(s), `Sorry: Glow Salon is closed on ${label(start)}, so your booking at 11:00 am cannot go ahead that day. Reply with another day and time to move it, or CANCEL to cancel it.`);
    assert.equal((await s.status()).bookings.confirmed, 1, "nothing is cancelled by closing a day");
    assert.equal(refundCalls(s).length, 0);
    const posts = s.guards!.of("calendar", "POST", /\/events$/u).length;
    await s.inbound(OTHER_CUSTOMER, `haircut on ${typed(start)} at 3pm`);
    assert.equal(s.guards!.of("calendar", "POST", /\/events$/u).length, posts, "a closed day is outside the hours: no hold");
    await owner(s, "undo");
    assert.equal(lastOwner(s), `Open again on ${label(start)}. I've told customers their booking stands: 1.`);
    assert.equal(lastCustomer(s), `Good news: Glow Salon is open on ${label(start)} after all. Your booking at 11:00 am stands. Reply here if you have already made other plans.`);
    await owner(s, "undo");
    assert.equal(lastOwner(s), "There is nothing to undo.");
  });

  contract("move b-1: done at once through the agent's own reschedule, the customer told, undo moves it back; a time that cannot be had is said to the owner only", async () => {
    const { s, start } = await booked();
    await owner(s, "move b-1 to 3pm");
    assert.equal(lastOwner(s), `Moved b-1 to ${label(start)}, 3:00 pm. I've told the customer. Reply undo to move it back.`);
    assert.match(lastCustomer(s), /3:00 pm/u);
    const patched = s.guards!.of("calendar", "PATCH").at(-1)!;
    assert.equal(patched.body.start.dateTime, new Date(start + 4 * 60 * MIN).toISOString(), "the calendar event moved");
    await owner(s, "undo");
    assert.equal(lastOwner(s), `b-1 is back at ${label(start)}, 11:00 am. I've told the customer.`);
    const told = s.sent(CUSTOMER).length;
    await owner(s, "move b-1 to 11pm");
    assert.equal(lastOwner(s), `I couldn't move b-1 to ${label(start)}, 11:00 pm: the shop is closed then.`);
    assert.equal(s.sent(CUSTOMER).length, told, "the customer hears nothing of it");
    await owner(s, "move b-1");
    assert.equal(lastOwner(s), "To when? For example: move b-1 to 5pm, or move b-1 to Friday.");
  });

  contract("message a customer: a preview card, the owner's words as typed, nothing before the tap, and never an amount that is not on the booking", async () => {
    const { s } = await booked();
    await owner(s, "message b-1 Running 15 minutes late, sorry!");
    const card = cardOf(s);
    assert.match(card.text, /^Send this to \+919811111111 \(b-1\)\?\n“Running 15 minutes late, sorry!”/u);
    assert.equal(lastCustomer(s).startsWith("Message from"), false, "nothing goes before the tap");
    await s.tap(card.yes, { from: OWNER_NUMBER });
    assert.equal(lastCustomer(s), "Message from Glow Salon: Running 15 minutes late, sorry!");
    await owner(s, "message b-1 we will give you ₹500 back");
    assert.equal(lastOwner(s), "I can only send amounts that are on b-1. To give money back, say: refund b-1.");
  });
});

describe("a limit by card", () => {
  contract("tightened by a card and the owner's tap (pending at once, active when the deployer says so, once); a rule looser than the limit in force gets no card", async () => {
    const s = await boot({ mode: "guards", tickSeconds: 1, settings: { assistant: {} } });
    await owner(s, "refunds above ₹500 need my OK");
    assert.match(lastOwner(s), /would loosen it/u);
    assert.deepEqual((await s.call("/internal/limit-changes")).body.changes, []);
    await owner(s, "refunds above ₹100 need my OK");
    const card = cardOf(s);
    assert.match(card.text, /Refunds above ₹100 need your approval\. Now: ₹200\./u);
    assert.deepEqual((await s.call("/internal/limit-changes")).body.changes, [], "nothing is changed before the tap");
    await s.tap(card.yes, { from: OWNER_NUMBER });
    const [change] = (await s.call("/internal/limit-changes")).body.changes;
    assert.deepEqual([change.state, change.from, change.to, change.by], ["pending", 200, 100, "owner_chat"]);
    assert.match(lastOwner(s), /^Pending: Refunds above ₹100 need your approval/u);
    assert.equal((await s.call("/internal/limit-changes")).body.limits[0].inForce, 100, "the shop's own checks use the tighter value at once");
    assert.equal((await s.call("/internal/limit-changes", { body: { id: "r-1", change: change.id, result: "active" } })).status, 200);
    for (let i = 0; i < 40 && !/^Active:/u.test(lastOwner(s)); i++) await sleep(250);
    assert.match(lastOwner(s), /^Active: Refunds above ₹100 need your approval/u);
    const told = s.sent(OWNER_NUMBER).length;
    await sleep(2500);
    assert.equal(s.sent(OWNER_NUMBER).length, told, "said once");
  });

  contract("a failed change is told with the previous limit still in force; a rule that names no limit gets the list of limits", async () => {
    const s = await boot({ mode: "guards", tickSeconds: 1, settings: { assistant: {} } });
    await owner(s, "refunds above ₹100 need my OK");
    await s.tap(cardOf(s).yes, { from: OWNER_NUMBER });
    const [change] = (await s.call("/internal/limit-changes")).body.changes;
    await s.call("/internal/limit-changes", { body: { id: "r-1", change: change.id, result: "failed", why: "the deploy did not go through" } });
    for (let i = 0; i < 40 && !/previous limit is still in force/u.test(lastOwner(s)); i++) await sleep(250);
    assert.match(lastOwner(s), /previous limit is still in force: Refunds above ₹200 need your approval/u);
    await owner(s, "limit the dress colours to 3");
    assert.match(lastOwner(s), /Which limit do you mean\?/u);
  });
});

describe("the morning line", () => {
  contract("once a day, from the morning hour, plain text in the owner's open window, in the shop's words; never twice", async () => {
    const india = new Date(Date.now() + 330 * MIN);
    const at = `${String(india.getUTCHours()).padStart(2, "0")}:${String(Math.max(0, india.getUTCMinutes() - 1)).padStart(2, "0")}`;
    // a UPI shop with a deposit waiting for the owner's mark: the line is silent with nothing to say, so there is something
    const s = await boot({ mode: "guards", tickSeconds: 1, settings: { assistant: { morning: { at } }, payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } }, calendar: { module: "own" } } });
    await s.book();
    await owner(s, "hello");                      // the owner's window opens: the line goes as text
    const before = s.sent(OWNER_NUMBER).length;
    for (let i = 0; i < 40 && s.sent(OWNER_NUMBER).length === before; i++) await sleep(250);
    const line = s.sent(OWNER_NUMBER).at(-1)!;
    assert.match(line.text, /^Good morning from the assistant of Glow Salon\./u, line.text);
    assert.equal(line.kind, "text");
    const n = s.sent(OWNER_NUMBER).length;
    await sleep(3000);
    assert.equal(s.sent(OWNER_NUMBER).length, n, "not again the same day");
    assert.equal(s.record().filter((r) => r.action === "send_message" && r.refs.morning !== undefined).length, 1);
  });
});

describe("the decision model's pause and its resume", () => {
  /** The System One stand-in over HTTP with a switch: down answers 500, unsure picks at 0.4, else sure of a greeting at 0.95. */
  async function decision(): Promise<{ url: string; state: { down: boolean; unsure: boolean; calls: number }; close(): Promise<void> }> {
    const state = { down: false, unsure: false, calls: 0 };
    const standin = systemOneStandin({ decider: (name) => ({ choice: name === "intent" ? "greeting" : name === "service" ? "no_service" : "no_slot", p: state.unsure ? 0.4 : 0.95 }) });
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", async () => {
        state.calls += 1;
        if (state.down) { res.writeHead(500, { "content-type": "application/json" }); res.end("{}"); return; }
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
        const reply = await standin.handler({ method: req.method ?? "POST", path: new URL(req.url ?? "/", "http://x").pathname, query: new URLSearchParams(), body, headers: req.headers });
        res.writeHead(reply?.status ?? 404, { "content-type": "application/json" }); res.end(JSON.stringify(reply?.body ?? {}));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const handle = { url, state, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
    closers.push(handle);
    return handle;
  }
  const model = async (): Promise<FakeModel> => { const m = await startFakeModel(() => ({ kind: "greeting", language: "en", serviceId: null, offerInr: null, date: null, time: null, overrideAttempt: false })); closers.push(m); return m; };
  const UNCLEAR = "asdf qwer zxcv";
  const say = async (s: Shop, n: number): Promise<void> => { for (let i = 0; i < n; i++) { const g = s.guest(); await s.chat(g.hash, UNCLEAR, { id: `u-${Math.random().toString(36).slice(2)}` }); } };
  const lines = (s: Shop) => s.record().filter((r) => r.action === "ai_mode");
  const received = (s: Shop) => s.record().filter((r) => r.action === "receive_message");
  const config = (d: { url: string }, m: FakeModel) => ({ modelPort: m.port, runtime: { decision: { provider: "laya", baseUrl: d.url, model: "laya", timeoutMs: 1500 } } });

  contract("after the pause one message tries the decision model again: still down it pauses again at once and says nothing new; back, it resumes and says so once", async () => {
    const d = await decision(); const m = await model();
    const s = await boot(config(d, m));
    d.state.down = true;
    await say(s, 3);
    assert.equal(d.state.calls, 3);
    assert.equal(lines(s).length, 1, "the pause was announced once");
    s.advance(10 * MIN + 1000);
    await say(s, 1);                                   // the try
    assert.equal(d.state.calls, 4);
    assert.equal(received(s).at(-1)!.refs.failed, "decision");
    await say(s, 1);                                   // paused again at once
    assert.equal(d.state.calls, 4);
    assert.equal(received(s).at(-1)!.refs.skipped, "decision");
    assert.equal(lines(s).length, 1, "the outage was announced when it began");
    s.advance(10 * MIN + 1000);
    d.state.down = false;
    await say(s, 1);                                   // the second try works
    assert.equal(d.state.calls, 5);
    assert.deepEqual(lines(s).map((r) => r.refs.mode), ["step_paused", "step_resumed"]);
    assert.equal((await s.status()).ai.paused.decision, null);
    await say(s, 1);
    assert.equal(d.state.calls, 6, "the decision model is asked first again");
    assert.equal(lines(s).length, 2);
  });

  contract("an unsure decision model is not a failing one: no pause, however many messages it hands on", async () => {
    const d = await decision(); const m = await model();
    const s = await boot(config(d, m));
    d.state.unsure = true;
    await say(s, 6);
    assert.equal(d.state.calls, 6);
    assert.equal(lines(s).length, 0);
    assert.equal((await s.status()).ai.paused.decision, null);
  });

  contract("with no language model after it, a failing decision model is never skipped: button mode answers, once, and no step pause is written", async () => {
    const d = await decision();
    const s = await boot({ runtime: { decision: { provider: "laya", baseUrl: d.url, model: "laya", timeoutMs: 1500 } } });
    d.state.down = true;
    await say(s, 1);
    assert.equal(lines(s).length, 1);
    assert.equal(lines(s)[0].refs.reason, "fault");
    assert.equal((await s.status()).ai.paused.decision, null);
    assert.equal((await s.status()).ai.mode, "buttons");
  });
});

describe("the cancel-confirmation buttons and talking to the owner", () => {
  async function toBooked(s: Shop): Promise<void> {
    await s.inbound(CUSTOMER, "hello");
    await s.tap("svc:haircut");
    const rows = s.sent(CUSTOMER).at(-1)!.interactive.list.rows as { id: string }[];
    await s.tap(rows[0].id);
    await s.events(s.guards!.pay(link(s).id).map((event) => ({ kind: "payment_event", event }))); await s.settle();
    assert.match(lastCustomer(s), /You're booked!/u);
  }
  const ids = (s: Shop): string[] => (s.sent(CUSTOMER).at(-1)!.interactive?.buttons ?? []).map((b: { id: string }) => b.id);
  contract("the booked message offers Cancel and Talk to the owner; Cancel asks once with two buttons and cancels nothing; Keep leaves the booking; Yes, cancel cancels it", async () => {
    const s = await boot({ mode: "guards" });
    await toBooked(s);
    assert.deepEqual(ids(s), ["cancel", "owner"]);
    await s.tap("cancel");
    assert.deepEqual(ids(s), ["cancel_yes", "keep"]);
    assert.equal((await s.status()).bookings.confirmed, 1, "nothing is cancelled by the first tap");
    await s.tap("keep");
    assert.equal((await s.status()).bookings.confirmed, 1);
    assert.match(lastCustomer(s), /stays as it is/u);
    await s.tap("cancel"); await s.tap("cancel_yes");
    assert.equal((await s.status()).bookings.cancelled, 1);
  });
  contract("Talk to the owner tells the owner and the customer; a second tap within the hour tells the owner nothing more", async () => {
    const s = await boot({ mode: "guards" });
    await s.inbound(CUSTOMER, "hello");
    await s.tap("owner");
    const toOwner = () => s.guards!.of("messaging", "POST").filter((c) => c.body.to === OWNER_NUMBER);
    assert.equal(toOwner().length, 1);
    assert.ok(JSON.stringify(toOwner()[0].body).includes("+91 98111 11111"), "it names the customer's number");
    assert.match(lastCustomer(s), /told the owner/u);
    await s.inbound(CUSTOMER, "hello"); await s.tap("owner");
    assert.equal(toOwner().length, 1, "the owner is not told twice in an hour");
    assert.match(lastCustomer(s), /told the owner/u, "the customer is still answered");
  });
});

describe("voice notes from the owner and from the owner's page", () => {
  const note = { voiceNote: true, media: { id: "MEDIA1", mime: "audio/ogg; codecs=opus" } };
  async function voiceShop(transcript: string, o: Parameters<typeof makeShop>[0] = {}) {
    const speech = await startFakeSpeech(); closers.push(speech);
    speech.transcript = { text: transcript, language: "en", confidence: 0.95 };
    return { s: await boot({ mode: "guards", settings: { assistant: {} }, runtime: { speech: speech.block() }, ...o }), speech };
  }
  const stt = (sp: { requests: { method: string; path: string }[] }) => sp.requests.filter((r) => r.method === "POST" && r.path === "/stt");
  contract("with the assistant, the owner's voice note is heard and read like their typed words: a spoken fixed phrase answers in text, and the hearing is on an owner_assistant line", async () => {
    const { s, speech } = await voiceShop("today");
    await s.inbound(OWNER_NUMBER, "", { extra: note });
    assert.equal(stt(speech).length, 1, "the owner is listened to when the shop has the assistant");
    assert.equal(lastOwner(s), "No bookings today.");
    const heard = s.record().filter((r) => r.action === "owner_assistant" && r.refs.intent === "voice_note");
    assert.equal(heard.length, 1);
    assert.equal(heard[0].refs.via, "voice");
    assert.ok(!JSON.stringify(heard).includes("today"), "the owner's words are not kept on the line");
  });
  contract("without the assistant, or with voice off, the owner's voice note gets the one 'please type' line and nothing is listened to", async () => {
    const { s, speech } = await voiceShop("today", { settings: { assistant: null } });
    await s.inbound(OWNER_NUMBER, "", { extra: note });
    assert.equal(stt(speech).length, 0);
    assert.equal(s.sent(OWNER_NUMBER).length, 1, "the owner got the one line");
    const off = await boot({ mode: "guards", settings: { assistant: {} } });
    await off.inbound(OWNER_NUMBER, "", { extra: { voiceNote: true } });
    assert.equal(off.sent(OWNER_NUMBER).length, 1);
  });
  contract("a WebM recording from the owner's page is heard like an Ogg one: the page route takes audio/ogg or audio/webm only, from the owner only, and the hearing is on an owner_assistant line", async () => {
    const { s, speech } = await voiceShop("today");
    const bytes = fakeWebmVoiceNote(12);
    assert.equal((await s.call("/internal/channel/owner-voice", { raw: bytes, type: "audio/webm" })).status, 403, "the owner's credential first");
    assert.equal((await s.call("/internal/channel/owner-voice", { owner: s.owner, raw: bytes, type: "audio/mpeg" })).status, 415);
    assert.equal((await s.call("/internal/channel/owner-voice", { owner: s.owner, raw: new Uint8Array(0), type: "audio/webm" })).status, 400);
    const sent = await s.call("/internal/channel/owner-voice", { owner: s.owner, raw: bytes, type: "audio/webm" });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    await s.settle();
    assert.equal(stt(speech).length, 1, "listened to once");
    assert.equal(speech.requests.filter((r) => r.path === "/stt").length, 1);
    assert.ok(s.record().some((r) => r.action === "owner_assistant" && r.refs.intent === "voice_note" && r.refs.via === "voice"));
    assert.ok((await s.ownerView()).body.app, "the owner's page carries the assistant's view");
    const none = await boot({ mode: "guards" });
    assert.equal((await none.call("/internal/channel/owner-voice", { owner: none.owner, raw: bytes, type: "audio/webm" })).status, 404, "no voice, no route");
  });
});

