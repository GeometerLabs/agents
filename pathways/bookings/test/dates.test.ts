import { test } from "node:test";
import assert from "node:assert/strict";
import { findDatePhrase, findTimePhrase, resolveDate, resolveTime } from "../src/language/dates.ts";
import { formatDate, formatInr, formatSlot, formatTime } from "../src/language/format.ts";
import { addDays, localParts, weekdayOf, zonedToMs } from "../src/time.ts";

const TZ = "Asia/Kolkata";
const at = (y: number, m: number, d: number, h = 10, min = 0) => zonedToMs({ year: y, month: m, day: d }, { hour: h, minute: min }, TZ);
const resolve = (text: string, now: number) => {
  const phrase = findDatePhrase(text);
  assert.ok(phrase, `no date found in ${text}`);
  const r = resolveDate(phrase, now, TZ);
  assert.ok(r, `could not resolve ${text}`);
  return { ...r.date, confirm: r.needsConfirmation };
};

const TUE_3_NOV = at(2026, 11, 3); // the day this was written; a Tuesday
test("the calendar is what we think it is", () => {
  assert.equal(weekdayOf({ year: 2026, month: 11, day: 3 }), 2);
  assert.equal(weekdayOf({ year: 2026, month: 11, day: 11 }), 3);
});

test("today, tomorrow and the day after, in Hindi, English and Hindi in Latin letters", () => {
  assert.deepEqual(resolve("आज", TUE_3_NOV), { year: 2026, month: 11, day: 3, confirm: false });
  for (const w of ["कल", "tomorrow", "kal"]) assert.deepEqual(resolve(w, TUE_3_NOV), { year: 2026, month: 11, day: 4, confirm: false }, w);
  for (const w of ["परसों", "day after tomorrow", "parso"]) assert.deepEqual(resolve(w, TUE_3_NOV), { year: 2026, month: 11, day: 5, confirm: false }, w);
});

test("कल is tomorrow in the BUSINESS time zone, not in UTC", () => {
  const monNightUtc = Date.UTC(2026, 10, 2, 20, 0); // Mon 2 Nov 20:00 UTC = Tue 3 Nov 01:30 in India
  assert.equal(new Date(monNightUtc).getUTCDate(), 2);
  assert.deepEqual(localParts(monNightUtc, TZ).day, 3);
  assert.deepEqual(resolve("कल", monNightUtc), { year: 2026, month: 11, day: 4, confirm: false });
  assert.deepEqual(resolve("today", monNightUtc), { year: 2026, month: 11, day: 3, confirm: false });
});

test("अगले मंगलवार / next Tuesday: the Tuesday of the NEXT calendar week, whatever day it is said", () => {
  const next = { year: 2026, month: 11, day: 10, confirm: true };
  assert.deepEqual(resolve("अगले मंगलवार", TUE_3_NOV), next); // said on a Tuesday
  assert.deepEqual(resolve("next Tuesday", TUE_3_NOV), next);
  assert.deepEqual(resolve("next tuesday", at(2026, 11, 2)), next); // said on the Monday before: still the 10th, not tomorrow
  assert.deepEqual(resolve("next Tuesday", at(2026, 11, 8)), next); // said on the Sunday of this week
  assert.deepEqual(resolve("next Friday", TUE_3_NOV), { year: 2026, month: 11, day: 13, confirm: true });
  assert.deepEqual(resolve("next Monday", at(2026, 11, 8)), { year: 2026, month: 11, day: 9, confirm: true });
});

test("इस मंगलवार / this Tuesday, and a bare weekday", () => {
  assert.deepEqual(resolve("इस मंगलवार", TUE_3_NOV), { year: 2026, month: 11, day: 3, confirm: true }); // today counts
  assert.deepEqual(resolve("this Friday", TUE_3_NOV), { year: 2026, month: 11, day: 6, confirm: true });
  assert.deepEqual(resolve("this Monday", TUE_3_NOV), { year: 2026, month: 11, day: 9, confirm: true }); // already passed this week
  assert.deepEqual(resolve("मंगलवार", TUE_3_NOV), { year: 2026, month: 11, day: 10, confirm: true }); // a Tuesday said on a Tuesday
  assert.deepEqual(resolve("Friday", TUE_3_NOV), { year: 2026, month: 11, day: 6, confirm: true });
  assert.deepEqual(resolve("mangalvar", TUE_3_NOV), { year: 2026, month: 11, day: 10, confirm: true });
});

test("a written date is the next time it comes round; a date that does not exist is refused", () => {
  assert.deepEqual(resolve("11 नवंबर", TUE_3_NOV), { year: 2026, month: 11, day: 11, confirm: false });
  assert.deepEqual(resolve("on 11 Nov", TUE_3_NOV), { year: 2026, month: 11, day: 11, confirm: false });
  assert.deepEqual(resolve("Nov 11", TUE_3_NOV), { year: 2026, month: 11, day: 11, confirm: false });
  assert.deepEqual(resolve("1 Nov", TUE_3_NOV), { year: 2027, month: 11, day: 1, confirm: false });
  const impossible = findDatePhrase("31 November");
  assert.ok(impossible);
  assert.equal(resolveDate(impossible, TUE_3_NOV, TZ), null);
});

test("no date phrase where there is none, and 'कलर' (colour) is not 'कल'", () => {
  assert.equal(findDatePhrase("हेयर कलर करवाना है"), undefined);
  assert.equal(findDatePhrase("I want a haircut"), undefined);
});

test("times: 6pm, 6:30 pm, 18:00, 6 बजे, शाम 6 बजे, सुबह 10 बजे, रात 8 बजे, evening 6", () => {
  assert.deepEqual(findTimePhrase("tomorrow at 6pm"), { hour: 6, minute: 0, period: "pm" });
  assert.deepEqual(findTimePhrase("6:30 pm"), { hour: 6, minute: 30, period: "pm" });
  assert.deepEqual(findTimePhrase("18:00"), { hour: 18, minute: 0 });
  assert.deepEqual(findTimePhrase("6 बजे"), { hour: 6, minute: 0 });
  assert.deepEqual(findTimePhrase("कल शाम 6 बजे"), { hour: 6, minute: 0, period: "pm" });
  assert.deepEqual(findTimePhrase("सुबह 10 बजे"), { hour: 10, minute: 0, period: "am" });
  assert.deepEqual(findTimePhrase("रात 8 बजे"), { hour: 8, minute: 0, period: "pm" });
  assert.deepEqual(findTimePhrase("kal shaam 6 baje"), { hour: 6, minute: 0, period: "pm" });
  assert.deepEqual(findTimePhrase("evening 6"), { hour: 6, minute: 0, period: "pm" });
  assert.deepEqual(findTimePhrase("शाम ६ बजे"), { hour: 6, minute: 0, period: "pm" }); // Devanagari digit
  assert.equal(findTimePhrase("300 में हो जाएगा?"), undefined); // a price is not a time
  assert.equal(findTimePhrase("can you do it for 300"), undefined);
});

test("a greeting is not a time of day", () => {
  assert.deepEqual(findTimePhrase("good morning, haircut at 6"), { hour: 6, minute: 0 });
});

test("a time without am/pm is resolved against opening hours, and flagged as inferred", () => {
  const hours = { open: 600, close: 1200 }; // 10:00 - 20:00
  assert.deepEqual(resolveTime({ hour: 6, minute: 0 }, hours), { time: { hour: 18, minute: 0 }, inferred: true });
  assert.deepEqual(resolveTime({ hour: 10, minute: 30 }, hours), { time: { hour: 10, minute: 30 }, inferred: true });
  assert.deepEqual(resolveTime({ hour: 6, minute: 0, period: "pm" }, hours), { time: { hour: 18, minute: 0 }, inferred: false });
  assert.deepEqual(resolveTime({ hour: 18, minute: 0 }, hours), { time: { hour: 18, minute: 0 }, inferred: false });
  assert.deepEqual(resolveTime({ hour: 12, minute: 0, period: "am" }, hours).time, { hour: 0, minute: 0 });
  assert.deepEqual(resolveTime({ hour: 9, minute: 0 }, hours), { time: { hour: 9, minute: 0 }, inferred: true }); // neither is open: 9 stays morning, the hours rule will say no
});

test("formats: amounts, dates and times in both languages", () => {
  assert.equal(formatInr(450), "₹450");
  assert.equal(formatInr(1200), "₹1,200");
  assert.equal(formatInr(125000), "₹1,25,000");
  const d = { year: 2026, month: 11, day: 10 };
  assert.equal(formatDate(d, "en"), "Tue 10 Nov");
  assert.equal(formatDate(d, "hi"), "मंगलवार, 10 नवंबर");
  assert.equal(formatTime({ hour: 18, minute: 0 }, "en"), "6:00 pm");
  assert.equal(formatTime({ hour: 18, minute: 0 }, "hi"), "शाम 6:00 बजे");
  assert.equal(formatTime({ hour: 10, minute: 30 }, "hi"), "सुबह 10:30 बजे");
  assert.equal(formatTime({ hour: 12, minute: 0 }, "en"), "12:00 pm");
  assert.equal(formatTime({ hour: 0, minute: 15 }, "en"), "12:15 am");
  assert.equal(formatTime({ hour: 14, minute: 0 }, "hi"), "दोपहर 2:00 बजे");
  assert.equal(formatTime({ hour: 21, minute: 0 }, "hi"), "रात 9:00 बजे");
  assert.equal(formatSlot(at(2026, 11, 10, 18), TZ, "en"), "Tue 10 Nov, 6:00 pm");
  assert.equal(formatSlot(at(2026, 11, 10, 18), TZ, "hi"), "मंगलवार, 10 नवंबर, शाम 6:00 बजे");
});

test("time helpers round-trip through the zone", () => {
  const ms = at(2026, 11, 10, 18, 30);
  assert.equal(new Date(ms).toISOString(), "2026-11-10T13:00:00.000Z"); // IST is UTC+5:30
  assert.deepEqual(addDays({ year: 2026, month: 12, day: 31 }, 1), { year: 2027, month: 1, day: 1 });
});
