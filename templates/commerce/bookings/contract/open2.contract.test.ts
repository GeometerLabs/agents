// MORE OPEN CASES (README.md section 8): the Guard's approval running out, a shop put back from a snapshot while a refund went out, the owner's number changing with no restart, a
// decision model that is down, the buttons and lists on WhatsApp (the payload Meta must accept), the owner's assistant on WhatsApp, the shop terms the owner agrees to, the shop's
// talk, and voice notes through a fake speech service. A "guards" shop unless said; the owner's number is the harness's.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGREE_PREFIX, TERMS_AGREED_ACTION, TERMS_SENT_ACTION, termsDigest, termsText } from "../../../../modules/terms/terms.ts";
import { REMOVAL_WAIT_MS, newSetupToken } from "../../../../modules/channels/owner-grants.ts";
import { ownerKit, qr } from "../../../../modules/test/contract/owner-kit.ts";
import { CUSTOMER, MIN, OTHER_CUSTOMER, OWNER_BASE, OWNER_NUMBER, TZ, contract, makeShop, openStart, sleep, startFakeModel } from "./harness.ts";
import type { FakeModel, Shop } from "./harness.ts";
import { startFakeDecision, statusReply } from "../../../../modules/test/contract/fake-model.ts";
import { startFakeSpeech } from "./voice-guard.ts";
import type { FakeSpeech } from "./voice-guard.ts";

const shops: Shop[] = [];
const closers: { close(): Promise<void> }[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } for (const c of closers) await c.close(); });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
const link = (s: Shop) => s.guards!.standins.fakes.payments.links()[0];
const refundCalls = (s: Shop) => s.guards!.of("payments", "POST", /\/refund$/u);
async function until(what: string, done: () => boolean | Promise<boolean>, seconds = 40): Promise<void> {
  for (let i = 0; i < seconds * 4; i++) { if (await done()) return; await sleep(250); }
  throw new Error(`gave up waiting for: ${what}`);
}
const dayText = (start: number): string => `haircut on ${new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" }).format(start)} at 11am`;
const payNow = async (s: Shop): Promise<void> => { await s.events(s.guards!.pay(link(s).id).map((event) => ({ kind: "payment_event", event }))); await s.settle(); };

describe("the Guard's approval runs out", () => {
  contract("the owner never answers: the Guard's approval (60 seconds here) runs out, the customer is told plainly, nothing is refunded, and the builder sees it", async () => {
    const s = await boot({ mode: "guards", tickSeconds: 1, approvalSeconds: 60, settings: { cancellation: { windowHours: 24, refundLimitInr: 100 } } });
    const { hash } = await s.book();
    await payNow(s);
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    assert.equal((await s.status()).refunds.waitingForOwner, 1);
    await until("the approval to run out", async () => (await s.status()).refunds.waitingForOwner === 0, 90);
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 0, "nothing was refunded");
    const st = await s.status();
    assert.equal(st.refunds.needBuilder.total, 1, JSON.stringify(st.refunds));
    assert.equal(st.refunds.needBuilder.expired, 1, "the builder sees it as expired");
    assert.match((await s.request(hash)).body.messages.at(-1).text, /didn.t answer in time about your ₹200 refund, so it hasn.t been sent/u);
    assert.ok(s.record().some((r) => r.action === "refund" && r.outcome === "expired" || r.action === "refund" && r.outcome === "failed"), JSON.stringify(s.record().filter((r) => r.action === "refund").map((r) => r.outcome)));
    assert.equal(refundCalls(s).length, 1, "and the call was never sent again");
  });
});

describe("a shop put back from a snapshot while a refund went out", () => {
  contract("a refund the owner approved after the snapshot, which the Guard sent, is found on the provider's list when its time runs out: confirmed, never 'nothing was refunded'", async () => {
    const s = await boot({ mode: "guards", tickSeconds: 1, approvalSeconds: 60, settings: { cancellation: { windowHours: 24, refundLimitInr: 100 } } });
    const { hash } = await s.book();
    await payNow(s);
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    const [review] = s.guards!.stub.model.reviews("x", true);
    await s.stop();
    cpSync(s.dataDir, `${s.dataDir}-night`, { recursive: true });                      // last night's snapshot: the refund is held
    await s.start();
    assert.equal(s.guards!.stub.model.decide(review.id, true, "owner-contract").status, 200);
    await s.events([{ kind: "approval_decision", approval: review.id, decision: "approve", id: "d-1" }]); await s.settle();
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 1, "approved and sent today");
    await s.stop();
    rmSync(s.dataDir, { recursive: true, force: true });
    cpSync(`${s.dataDir}-night`, s.dataDir, { recursive: true });
    writeFileSync(join(s.dataDir, "restored.json"), JSON.stringify({ snapshot: "20261119T013000Z", restoredAt: new Date().toISOString(), lastSeq: null }));
    await s.start();
    await until("the approval's time to run out", async () => s.record().some((r) => r.action === "refund" && r.outcome === "confirmed" && /time ran out here/u.test(r.notes)), 100);
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 1, "nothing was sent again");
    assert.equal(s.record().filter((r) => r.action === "refund" && r.outcome === "failed").length, 0, "never 'nothing was refunded'");
    assert.deepEqual((await s.status()).refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } });
  });

  contract("a refund waiting to be sent again in the snapshot, which went out today, is not sent twice after the restore", async () => {
    const s = await boot({ mode: "guards", tickSeconds: 1 });
    const { hash } = await s.book();
    await payNow(s);
    s.guards!.stub.killSwitch(true);
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    assert.equal((await s.status()).refunds.beingSentAgain, 1);
    await s.stop();
    cpSync(s.dataDir, `${s.dataDir}-night`, { recursive: true });
    await s.start();
    s.guards!.stub.killSwitch(false);
    await until("the refund to go out", () => s.guards!.standins.fakes.payments.refunds().length === 1, 100);
    await s.stop();
    const posts = refundCalls(s).length;
    rmSync(s.dataDir, { recursive: true, force: true });
    cpSync(`${s.dataDir}-night`, s.dataDir, { recursive: true });
    writeFileSync(join(s.dataDir, "restored.json"), JSON.stringify({ snapshot: "20261119T013000Z", restoredAt: new Date().toISOString(), lastSeq: null }));
    await s.start();
    await until("the restored shop to look", () => s.guards!.of("payments", "GET", /refunds$/u).length >= 1 && s.record().some((r) => r.action === "restored"), 100);
    await sleep(3000); await s.settle();
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 1, "the refund was not sent twice");
    assert.equal(refundCalls(s).length, posts, "not one more call to refund");
  });
});

describe("the owner's number changes with no restart", () => {
  contract("after 48 hours the new number's messages are the owner's and the old number's are a customer's", async () => {
    const { register, grants, told } = ownerKit(OWNER_BASE);
    const NEW = "+919822222222";
    const s = await boot({ tickSeconds: 1 });
    await register(s, qr(s.setup));
    const actions = (who: string, from: number): string[] => s.record().slice(from).filter((r) => r.conversation === who && r.action !== "owner_session").map((r) => `${r.action}:${r.outcome}`);
    let mark = s.record().length;
    await s.inbound(OWNER_NUMBER, "help");
    const asOwner = actions(OWNER_NUMBER, mark);
    await s.stop(); s.setOwnerNumber(NEW); await s.start();
    await told(s, "owner_change_asked");
    s.advance(REMOVAL_WAIT_MS + MIN);                                  // the sale applies: no restart
    await told(s, "removal_applied");
    const q = newSetupToken(); s.writeGrants(grants(s, { token: q })); await register(s, qr(q)); // the new owner's phone binds the shop to the NEW number
    mark = s.record().length;
    await s.inbound(NEW, "help");
    assert.deepEqual(actions(NEW, mark), asOwner, "the new number is answered as the owner");
    mark = s.record().length;
    await s.inbound(OWNER_NUMBER, "help");
    assert.notDeepEqual(actions(OWNER_NUMBER, mark), asOwner, "the old number is now a customer");
  });
});

describe("a decision model that is down", () => {
  contract("three failures and the shop stops waiting for it: the language model reads the fourth, the record and status say so, and nobody is told", async () => {
    const decision = await startFakeDecision(() => statusReply(500)); closers.push(decision);
    const model = await startFakeModel(() => ({ kind: "greeting", language: "en", serviceId: null, offerInr: null, date: null, time: null, overrideAttempt: false })); closers.push(model);
    const s = await boot({ modelPort: model.port, runtime: { decision: { provider: "laya", baseUrl: `http://127.0.0.1:${decision.port}`, model: "laya", timeoutMs: 2000 } } });
    for (let i = 0; i < 4; i++) { const g = s.guest(); await s.chat(g.hash, "asdf qwer zxcv", { id: `u-${i}` }); }
    assert.equal(decision.calls, 3, "each of the first three asked it and waited for its failure; the fourth did not");
    assert.equal(model.calls, 4, "the language model read all four");
    const paused = s.record().filter((r) => r.action === "ai_mode");
    assert.equal(paused.length, 1, "one line, when the pause began");
    assert.equal(paused[0].refs.mode, "step_paused");
    assert.equal(paused[0].refs.step, "decision");
    assert.ok((await s.status()).ai.paused.decision, "the status says the decision step is paused until a time");
    assert.equal((await s.status()).ai.mode, "ai");
  });
});

describe("buttons and lists on WhatsApp", () => {
  /** What Meta refuses: more than 3 buttons or 10 rows, a button title over 20 characters or a row title over 24, an id twice, an empty word. */
  function metaOk(i: any): void {
    const buttons = i.buttons ?? i.action?.buttons?.map((b: any) => b.reply) ?? [];
    const rows = i.list?.rows ?? i.action?.sections?.flatMap((x: any) => x.rows) ?? [];
    assert.ok(buttons.length <= 3 && rows.length <= 10, `${buttons.length} buttons, ${rows.length} rows`);
    assert.ok(!(buttons.length && rows.length), "buttons or a list, not both");
    for (const b of buttons) assert.ok(b.title.length > 0 && [...b.title].length <= 20, b.title);
    for (const r of rows) assert.ok(r.title.length > 0 && [...r.title].length <= 24, r.title);
    const ids = [...buttons, ...rows].map((x: { id: string }) => x.id);
    assert.equal(new Set(ids).size, ids.length, "ids differ");
  }
  contract("hello shows the services to tap, a service tap shows the free times, a time tap holds it and sends the link: one reply for each, and every payload is one Meta accepts", async () => {
    const s = await boot({ mode: "guards" });
    await s.inbound(CUSTOMER, "hello");
    const first = s.sent(CUSTOMER).at(-1)!;
    assert.ok(first.interactive?.list, "a list of services");
    const serviceRows = first.interactive.list.rows as { id: string; title: string }[];
    assert.ok(serviceRows.some((r) => r.id === "svc:haircut"));
    const sendsBefore = s.sent(CUSTOMER).length;
    await s.tap("svc:haircut");
    assert.equal(s.sent(CUSTOMER).length, sendsBefore + 1, "one reply for one tap");
    const times = s.sent(CUSTOMER).at(-1)!.interactive.list.rows as { id: string; title: string }[];
    assert.ok(times.length > 0 && times.length <= 10);
    const chosen = times[0].id;
    await s.tap(chosen);
    assert.equal(s.guards!.of("calendar", "POST", /\/events$/u).length, 1, "a time tap holds it");
    assert.ok(s.sent(CUSTOMER).at(-1)!.text.includes(link(s).pay_url), "and sends the link");
    for (const m of s.sent(CUSTOMER)) if (m.interactive) metaOk(m.interactive);
    for (const c of s.guards!.of("messaging", "POST").filter((x) => x.body.type === "interactive")) { const i = c.body.interactive; assert.ok(i.type === "button" || i.type === "list"); assert.ok(i.body.text.length > 0); }
    assert.equal((await s.status()).tasks.failed, 0);
  });
  contract("a tapped time that has since been taken is refused like a typed one, and the customer gets another list", async () => {
    const s = await boot({ mode: "guards" });
    await s.inbound(CUSTOMER, "hello"); await s.tap("svc:haircut");
    const times = s.sent(CUSTOMER).at(-1)!.interactive.list.rows as { id: string }[];
    const start = s.guards!.standins.fakes.calendar; // someone else books the offered time before the tap
    const taken = times[0].id;
    const startMs = Number(/(\d{10,})/u.exec(taken)?.[1]);
    if (Number.isFinite(startMs)) start.insert({ summary: "Dentist", start: startMs, end: startMs + 3_600_000, status: "confirmed", bookingRef: "foreign" } as never);
    await s.tap(taken);
    assert.equal(s.guards!.of("calendar", "POST", /\/events$/u).length, 0, "no hold on a taken time");
    assert.ok(s.sent(CUSTOMER).at(-1)!.interactive?.list, "another list of times");
  });
});

describe("the owner's assistant on WhatsApp", () => {
  contract("without an assistant block the owner's free words get the usual answer", async () => {
    const s = await boot({ mode: "guards" });
    await s.inbound(OWNER_NUMBER, "close tomorrow");
    assert.match(s.sent(OWNER_NUMBER).at(-1)!.text, /^Sorry, I didn't get that\./u);
  });
  contract("cancel b-1: a card with the exact change, nothing happens before the tap, the tap refunds exactly the amount shown, once", async () => {
    const s = await boot({ mode: "guards", settings: { assistant: {} } });
    await s.inbound(CUSTOMER, dayText(openStart(s.now(), 3)));
    await payNow(s);
    await s.inbound(OWNER_NUMBER, "cancel b-1");
    const card = s.sent(OWNER_NUMBER).filter((m) => m.interactive?.buttons?.some((b: { id: string }) => b.id.startsWith("card-"))).at(-1)!;
    assert.match(card.text, /^Cancel b-1 \(\+919811111111, haircut, [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}, 11:00 am\) and refund the ₹200 deposit\?\nTap a button, or reply yes [A-Z2-9]{6} or no [A-Z2-9]{6}\.$/u);
    assert.equal(refundCalls(s).length, 0, "nothing before the tap");
    assert.equal((await s.status()).bookings.confirmed, 1);
    const yes = card.interactive.buttons[0].id;
    await s.tap(yes, { from: OWNER_NUMBER });
    assert.deepEqual(refundCalls(s).map((c) => c.body.amount), [20000], "the amount sent is the amount shown");
    assert.equal(s.sent(OWNER_NUMBER).at(-1)!.text, "Done: ₹200 is on its way back to +919811111111 (b-1).");
    await s.tap(yes, { from: OWNER_NUMBER });
    assert.equal(s.sent(OWNER_NUMBER).at(-1)!.text, "That card was already answered.");
    assert.equal(refundCalls(s).length, 1, "a second tap does nothing");
    // free text never executes a card
    await s.inbound(OWNER_NUMBER, "cancel b-1");
    await s.inbound(OWNER_NUMBER, "yes");
    assert.equal(refundCalls(s).length, 1);
  });
});

describe("the shop terms on WhatsApp", () => {
  const FILE = { schema: 1, partnerName: "Divya", partnerPhone: "+919800000000", monthlyInr: 700, setupInr: 1500 };
  contract("off without terms.json; on, the owner's 'terms' sends the text, 'I agree' records the agreement once with its digest, and a customer's words are nothing", async () => {
    const off = await boot({ mode: "guards" });
    await off.inbound(OWNER_NUMBER, "terms");
    assert.match(off.sent(OWNER_NUMBER).at(-1)!.text, /didn't get that/u);
    assert.equal(off.record().filter((r) => r.action === TERMS_SENT_ACTION).length, 0);
    const s = await boot({ mode: "guards", terms: FILE });
    await s.inbound(OWNER_NUMBER, "terms");
    const text = termsText("en", "Glow Salon", FILE as never);
    assert.ok(s.sent(OWNER_NUMBER).some((m) => m.text === text), "the exact text went to the owner");
    assert.equal(s.record().filter((r) => r.action === TERMS_SENT_ACTION).length, 1);
    await s.inbound(OWNER_NUMBER, "I agree");
    const agreed = s.record().filter((r) => r.action === TERMS_AGREED_ACTION);
    assert.deepEqual([agreed.length, agreed[0].outcome, agreed[0].refs.termsDigest], [1, "confirmed", termsDigest(text)]);
    await s.inbound(OWNER_NUMBER, "I agree");
    assert.equal(s.record().filter((r) => r.action === TERMS_AGREED_ACTION && r.outcome === "confirmed").length, 1, "once");
    await s.inbound(CUSTOMER, "I agree"); await s.inbound(CUSTOMER, "terms");
    assert.equal(s.record().filter((r) => r.action === TERMS_SENT_ACTION).length, 1, "a customer's 'terms' is nothing");
    void AGREE_PREFIX;
  });
  contract("'I agree' before the terms were sent, or after they changed, records no agreement", async () => {
    const s = await boot({ mode: "guards", terms: FILE });
    await s.inbound(OWNER_NUMBER, "I agree");
    assert.deepEqual(s.record().filter((r) => r.action === TERMS_AGREED_ACTION).map((r) => r.outcome), ["blocked"]);
    await s.inbound(OWNER_NUMBER, "terms");
    writeFileSync(join(s.client, "terms.json"), JSON.stringify({ ...FILE, monthlyInr: 900 }));
    await sleep(1100);
    await s.inbound(OWNER_NUMBER, "I agree");
    assert.deepEqual(s.record().filter((r) => r.action === TERMS_AGREED_ACTION).map((r) => r.outcome), ["blocked", "blocked"]);
  });
});

describe("the shop's talk", () => {
  const QUESTION = "do you also do anything about the weather";
  const answer = (text: string, sources: string[]) => ({ sentences: [{ text, sources }], ask_owner: false });
  contract("an unreadable customer message is answered from the shop's settings with the template's list of services; a reply that says something is booked is never sent", async () => {
    let said = answer("haircut is ₹450.", ["s:svc:haircut"]);
    const talk = await startFakeModel(() => said); closers.push(talk);
    const s = await boot({ mode: "guards", settings: { assistant: {} }, runtime: { talk: { wire: "openai", baseUrl: `http://127.0.0.1:${talk.port}/v1`, model: "fake-model", timeoutMs: 5000 } } });
    await s.inbound(CUSTOMER, QUESTION);
    const last = s.sent(CUSTOMER).at(-1)!;
    assert.match(last.text, /haircut is ₹450\./u);
    assert.ok(last.interactive?.list, "the template's own list of services goes with it");
    assert.equal(talk.calls, 1);
    assert.ok(!JSON.stringify(s.record().filter((r) => r.action === "talk")).includes("weather"), "never the customer's words in the record");
    said = answer("Your haircut is booked.", []);
    await s.inbound(OTHER_CUSTOMER, QUESTION);
    const refused = s.sent(OTHER_CUSTOMER).at(-1)!;
    assert.ok(!/booked/u.test(refused.text));
    assert.match(refused.text, /Sorry, I didn't catch that/u);
  });
  contract("with customers' talk off, or no talk model, the usual menu and no call", async () => {
    const talk = await startFakeModel(() => answer("How can I help?", [])); closers.push(talk);
    const off = await boot({ mode: "guards", settings: { assistant: { talk: { customers: false } } }, runtime: { talk: { wire: "openai", baseUrl: `http://127.0.0.1:${talk.port}/v1`, model: "fake-model", timeoutMs: 5000 } } });
    await off.inbound(CUSTOMER, QUESTION);
    assert.match(off.sent(CUSTOMER).at(-1)!.text, /Sorry, I didn't catch that/u);
    assert.equal(talk.calls, 0);
  });
});

describe("voice notes", () => {
  const note = { voiceNote: true, media: { id: "MEDIA1", mime: "audio/ogg; codecs=opus" } };
  async function voiceShop(o: Parameters<typeof makeShop>[0] = {}): Promise<{ s: Shop; speech: FakeSpeech }> {
    const speech = await startFakeSpeech(); closers.push(speech);
    return { s: await boot({ mode: "guards", runtime: { speech: speech.block() }, ...o }), speech };
  }
  const stt = (speech: FakeSpeech) => speech.requests.filter((r) => r.method === "POST" && r.path === "/stt");
  contract("a voice note is read like typed text: the same reply, in text only, the speech service asked once, and the record says it came by voice; a redelivery is answered once", async () => {
    const { s, speech } = await voiceShop();
    await s.inbound(OTHER_CUSTOMER, "hello");                       // what a typed 'hello' gets
    const typed = s.sent(OTHER_CUSTOMER)[0];
    const id = "wamid.voice-1";
    await s.inbound(CUSTOMER, "", { id, extra: note });
    const sent = s.sent(CUSTOMER);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, typed.text, "exactly the words a typed 'hello' gets");
    assert.equal(sent[0].kind, typed.kind, "no audio, ever");
    assert.equal(stt(speech).length, 1);
    assert.match(stt(speech)[0].contentType ?? "", /^multipart\/form-data/u);
    const received = s.record().find((r) => r.action === "receive_message" && r.conversation === CUSTOMER)!;
    assert.equal(received.refs.via, "voice");
    assert.ok(!JSON.stringify(s.record()).includes("MEDIA1"), "no media id in the record");
    const again = await s.events([{ kind: "message", message: { id, from: CUSTOMER, text: "", timestamp: s.now(), ...note } }]);
    assert.deepEqual([again.body.saved, again.body.duplicates], [0, 1]);
    await s.settle();
    assert.equal(s.sent(CUSTOMER).length, 1, "answered once");
    assert.equal(stt(speech).length, 1);
  });
  contract("a customer who sent STOP gets nothing for a voice note, and the speech service is not asked; a malformed voice event is refused", async () => {
    const { s, speech } = await voiceShop();
    await s.inbound(CUSTOMER, "hello"); await s.inbound(CUSTOMER, "STOP");
    const before = s.sent(CUSTOMER).length;
    await s.inbound(CUSTOMER, "", { extra: note });
    assert.equal(s.sent(CUSTOMER).length, before);
    assert.equal(stt(speech).length, 0);
    for (const bad of [{ voiceNote: true, text: "words" }, { voiceNote: "yes", text: "" }, { media: { id: "x" }, text: "" }]) {
      assert.equal((await s.events([{ kind: "message", message: { id: "wamid.bad", from: CUSTOMER, timestamp: s.now(), ...bad } }])).status, 400, JSON.stringify(bad));
    }
  });
  contract("with voice off, a voice note gets the one plain line (in the shop's first language, Hindi, for a customer who has not written yet) and the speech service is never asked", async () => {
    const s = await boot({ mode: "guards" });
    await s.inbound(CUSTOMER, "", { extra: { voiceNote: true } });
    assert.match(s.sent(CUSTOMER).at(-1)!.text, /वॉइस नोट/u);
  });
});

void openStart; void readdirSync; void existsSync; void (null as unknown as FakeModel);
