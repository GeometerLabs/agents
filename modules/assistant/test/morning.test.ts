// The morning line (item 11e, modules/assistant/morning.ts): once a day from its hour, in the owner's language, silent on a closed day and on a day with nothing to
// say, and sent once even if the process dies (the claim is saved before the send; a claim with no ending is never sent again).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMorningJob } from "../morning.ts";
import type { MorningContext } from "../morning.ts";
import { emptyAssistantState } from "../state.ts";
import type { AssistantState } from "../state.ts";
import type { OwnerSkill, DayRow } from "../skill.ts";
import { defaultCharacter } from "../character.ts";
import type { CharacterPictures } from "../character.ts";
import type { Personality } from "../personality.ts";
import { fakeClock } from "../../core/clock.ts";
import { HOUR, zonedToMs } from "../../core/time.ts";
import type { LocalDate } from "../../core/time.ts";
import { createFakeMessaging } from "../../messaging/messaging.ts";
import { createRecord } from "../../record/record.ts";
import { LANGUAGES } from "../../language/languages.ts";
import type { Language } from "../../language/languages.ts";

const TZ = "Asia/Kolkata";
const OWNER = "+919000000000";
const THU = { year: 2026, month: 11, day: 12 };
const at = (d: LocalDate, h: number, m = 0) => zonedToMs(d, { hour: h, minute: m }, TZ);

/** A read-only skill with a day's list and an opening-hours rule (closed on Sundays). */
function skill(rows: DayRow[], waiting = 0): OwnerSkill {
  return {
    name: "bookings", routing: { refs: /^b-\d+$/u, buttonPrefixes: [], words: {}, liveCaseOf: () => undefined },
    day: (d) => rows.filter((r) => zonedToMs(d, { hour: 0, minute: 0 }, TZ) <= r.startMs && r.startMs < zonedToMs(d, { hour: 23, minute: 59 }, TZ)),
    waiting: () => Array.from({ length: waiting }, (_, i) => ({ case: `b-${i}`, kind: "late_refund", amountPaise: 20_000, who: "Priya", what: "Haircut", money: true, yes: "approve" })),
    problems: () => 0,
    hours: (d) => (new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() === 0 ? null : { open: 600, close: 1200 }),
    prepare: () => ({ ok: false, why: "busy" }), execute: async () => ({ ok: false, note: "failed" }),
  };
}

function world(o: { language?: Language; rows?: DayRow[]; waiting?: number; start?: number; state?: AssistantState; approved?: boolean; pictures?: CharacterPictures; personality?: Personality } = {}) {
  const clock = fakeClock(o.start ?? at(THU, 7, 55));
  const messaging = createFakeMessaging(clock);
  if (o.approved !== false) for (const language of LANGUAGES) for (const name of ["owner_morning", "owner_morning_cheerful", "owner_morning_brief"]) messaging.approve(name, language);
  const record = createRecord(clock);
  const store: { assistant?: AssistantState } = { assistant: o.state ?? emptyAssistantState() };
  let saves = 0;
  const job = createMorningJob({ shop: { name: "Glow Salon", timezone: TZ, owner: { whatsapp: OWNER, language: o.language ?? "en" }, settings: { morningAt: { hour: 8, minute: 0 }, character: { ...defaultCharacter(), ...(o.personality ? { personality: o.personality } : {}) } }, ...(o.pictures ? { pictures: () => o.pictures } : {}) }, skills: () => [skill(o.rows ?? [{ case: "b-1", startMs: at(THU, 10, 30), what: "Haircut", who: "Priya", state: "confirmed" }], o.waiting ?? 0)] });
  const ctx: MorningContext<typeof store> = { clock, messaging, record, store, log: () => undefined, save: () => { saves++; } };
  return { clock, messaging, record, job, ctx, saves: () => saves };
}

test("not before its hour; then once, as the template outside the window, naming the shop's mood and its picture", async () => {
  const w = world({ waiting: 2 });
  assert.deepEqual(await w.job.run(w.ctx), { done: false, why: "not-yet" });
  w.clock.set(at(THU, 8, 1));
  const r = await w.job.run(w.ctx);
  assert.equal(r.done && r.outcome, "confirmed");
  assert.equal(r.done && r.via, "template");
  const sent = w.messaging.sentTo(OWNER);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^Good morning from the assistant of Glow Salon\. Today, Thu 12 Nov: bookings: 1, the first at 10:30 am\. Recorded yesterday: nothing\. Waiting for you: 2\./u);
  const lines = w.record.entries().filter((e) => e.refs.morning === "2026-11-12");
  assert.deepEqual(lines.map((e) => e.outcome), ["attempted", "confirmed"]);
  assert.equal(lines[1].refs.mood, "waiting_for_owner");
  assert.equal(lines[1].refs.face, "needs");
  assert.equal(lines[1].refs.templates, "owner_morning");
  assert.equal(sent[0].headerImage, undefined, "no pictures drawn: no header picture");
  assert.equal(w.saves(), 2, "the claim is saved before the send, and the ending after");
  w.clock.advance(HOUR);
  assert.deepEqual(await w.job.run(w.ctx), { done: false, why: "already" });
  assert.equal(w.messaging.sentTo(OWNER).length, 1);
});

test("inside the owner's window it goes as plain text with the same words", async () => {
  const w = world({ language: "hi" });
  w.messaging.receive(OWNER, "hello");
  w.clock.set(at(THU, 8, 5));
  const r = await w.job.run(w.ctx);
  assert.equal(r.done && r.via, "text");
  assert.match(w.messaging.sentTo(OWNER)[0].text, /^सुप्रभात, मैं Glow Salon का असिस्टेंट।/u);
});

test("silent on a closed day: a closed weekday, or a date the owner closed", async () => {
  const sunday = { year: 2026, month: 11, day: 15 };
  const w = world({ start: at(sunday, 8, 30) });
  assert.deepEqual(await w.job.run(w.ctx), { done: false, why: "closed" });
  const state = emptyAssistantState();
  state.closedDays = ["2026-11-12"];
  const v = world({ start: at(THU, 8, 30), state });
  assert.deepEqual(await v.job.run(v.ctx), { done: false, why: "closed" });
  assert.equal(v.messaging.sentTo(OWNER).length + w.messaging.sentTo(OWNER).length, 0);
});

test("silent when there is nothing to say, and not sent late in the day", async () => {
  const quiet = world({ rows: [], start: at(THU, 8, 30) });
  assert.deepEqual(await quiet.job.run(quiet.ctx), { done: false, why: "quiet" });
  const late = world({ start: at(THU, 15, 0) });
  assert.deepEqual(await late.job.run(late.ctx), { done: false, why: "too-late" });
  assert.equal(quiet.messaging.sentTo(OWNER).length + late.messaging.sentTo(OWNER).length, 0);
});

test("a claim with no ending (the process died mid-send) is never sent again: it is marked as may-have-gone", async () => {
  const w = world({ start: at(THU, 8, 10) });
  w.record.append({ conversation: OWNER, action: "send_message", outcome: "attempted", inputs: {}, language: "en", refs: { to: "owner", morning: "2026-11-12" } });
  assert.deepEqual(await w.job.run(w.ctx), { done: false, why: "already" });
  assert.equal(w.messaging.sentTo(OWNER).length, 0);
  assert.equal(w.record.entries().at(-1)?.outcome, "unconfirmed");
});

test("a refusal that sent nothing (a template WhatsApp has not approved yet: a 4xx) is tried again after an hour", async () => {
  const w = world({ start: at(THU, 8, 10), approved: false });
  const first = await w.job.run(w.ctx);
  assert.equal(first.done && first.outcome, "failed");
  assert.deepEqual(await w.job.run(w.ctx), { done: false, why: "waiting" });
  for (const language of LANGUAGES) w.messaging.approve("owner_morning", language);
  w.clock.advance(HOUR + 1);
  const again = await w.job.run(w.ctx);
  assert.equal(again.done && again.outcome, "confirmed");
  assert.equal(w.messaging.sentTo(OWNER).length, 1);
});

// ---- item 11i: the character's picture on the morning line ------------------------------------------------------------------------------------------------

const PICS: CharacterPictures = { base: "https://pages.example/glow-salon", version: "0123456789abcdef" };

test("outside the window the template carries the picture of the owner's mood now as its image header (the PNG), and no sticker goes", async () => {
  const w = world({ waiting: 2, pictures: PICS });
  w.clock.set(at(THU, 8, 1));
  const r = await w.job.run(w.ctx);
  assert.equal(r.done && r.via, "template");
  const sent = w.messaging.sentTo(OWNER);
  assert.equal(sent.length, 1, "a sticker never goes outside the window");
  assert.equal(sent[0].kind, "template");
  assert.equal(sent[0].headerImage, "https://pages.example/glow-salon/character/needs.png?v=0123456789abcdef", "the owner's real mood: two things wait");
  const end = w.record.entries().filter((e) => e.refs.morning === "2026-11-12").at(-1)!;
  assert.equal(end.refs.picture, "header");
  assert.equal(end.refs.sticker, undefined);
});

test("inside the window the mood's sticker (the WebP) goes just before the words, and the ending names it", async () => {
  const w = world({ pictures: PICS });
  w.messaging.receive(OWNER, "hello");
  w.clock.set(at(THU, 8, 5));
  const r = await w.job.run(w.ctx);
  assert.equal(r.done && r.via, "text");
  const sent = w.messaging.sentTo(OWNER);
  assert.deepEqual(sent.map((m) => m.kind), ["sticker", "text"]);
  assert.equal(sent[0].sticker?.link, "https://pages.example/glow-salon/character/closed.webp?v=0123456789abcdef", "at 08:05 the shop opens at 10:00: closed (the true mood, to the owner)");
  const end = w.record.entries().filter((e) => e.refs.morning === "2026-11-12").at(-1)!;
  assert.equal(end.refs.sticker, "closed", "the picture's name, never WhatsApp's id (the record keeps ids only as fingerprints, B69)");
});

test("a sticker that fails is only a line in the log: the words still go, once", async () => {
  const w = world({ pictures: PICS });
  w.messaging.receive(OWNER, "hello");
  w.messaging.inject("sendSticker", "error");
  w.clock.set(at(THU, 8, 5));
  const r = await w.job.run(w.ctx);
  assert.equal(r.done && r.outcome, "confirmed");
  assert.deepEqual(w.messaging.sentTo(OWNER).map((m) => m.kind), ["text"]);
  w.clock.advance(2 * HOUR);
  assert.deepEqual(await w.job.run(w.ctx), { done: false, why: "already" }, "not sent again for the sticker");
});

test("the personality picks its own morning template; only the opening and the sign-off differ", async () => {
  const w = world({ personality: "cheerful", pictures: PICS });
  w.clock.set(at(THU, 8, 1));
  await w.job.run(w.ctx);
  const sent = w.messaging.sentTo(OWNER)[0];
  assert.equal(sent.templateName, "owner_morning_cheerful");
  assert.match(sent.text, /^Good morning! Glow Salon's assistant here\. Today, Thu 12 Nov: bookings: 1, the first at 10:30 am\. Recorded yesterday: nothing\. Waiting for you: nothing\. Reply here to see more\. Have a lovely day!$/u);
});
