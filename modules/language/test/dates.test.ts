import { test } from "node:test";
import assert from "node:assert/strict";
import { findDatePhrase, findTimePhrase, resolveDate, resolveTime } from "../dates.ts";
import { formatDate, formatInr, formatSlot, formatTime } from "../format.ts";
import { addDays, localParts, weekdayOf, zonedToMs } from "../../core/time.ts";

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

// ---- Malayalam and Kannada ----

test("today, tomorrow and the day after, in Malayalam, Kannada and the Latin spellings people type", () => {
  for (const w of ["ഇന്ന്", "ഇന്ന് വൈകുന്നേരം", "ಇಂದು", "ಇವತ್ತು ಸಂಜೆ", "innu"]) assert.deepEqual(resolve(w, TUE_3_NOV), { year: 2026, month: 11, day: 3, confirm: false }, w);
  for (const w of ["നാളെ", "നാളെയ്ക്ക് ഹെയർകട്ട്", "നാളത്തേക്ക്", "ನಾಳೆ", "ನಾಳೆಗೆ ಹೇರ್ ಕಟ್", "nale", "naale"]) assert.deepEqual(resolve(w, TUE_3_NOV), { year: 2026, month: 11, day: 4, confirm: false }, w);
  for (const w of ["മറ്റന്നാൾ", "മറ്റന്നാള്‍", "ನಾಡಿದ್ದು", "ನಾಡಿದ್ದಿಗೆ", "mattannal", "naadiddu"]) assert.deepEqual(resolve(w, TUE_3_NOV), { year: 2026, month: 11, day: 5, confirm: false }, w);
});

test("നാളെ and ನಾಳೆ are tomorrow in the BUSINESS time zone, not in UTC", () => {
  const monNightUtc = Date.UTC(2026, 10, 2, 20, 0); // Tue 3 Nov 01:30 in India
  assert.deepEqual(resolve("നാളെ", monNightUtc), { year: 2026, month: 11, day: 4, confirm: false });
  assert.deepEqual(resolve("ನಾಳೆ", monNightUtc), { year: 2026, month: 11, day: 4, confirm: false });
});

test("yesterday is not today (ഇന്നലെ begins like ഇന്ന്), and a word that merely starts like a date word is not one", () => {
  assert.equal(findDatePhrase("ഇന്നലെ ഹെയർകട്ട് ചെയ്തു"), undefined);
  assert.equal(findDatePhrase("ನಿನ್ನೆ ಹೇರ್ ಕಟ್ ಮಾಡಿದೆ"), undefined);
  assert.equal(findDatePhrase("ഹെയർകട്ട് വേണം"), undefined);
  assert.equal(findDatePhrase("ಹೇರ್ ಕಟ್ ಬೇಕು"), undefined);
});

test("അടുത്ത ചൊവ്വാഴ്ച / ಮುಂದಿನ ಮಂಗಳವಾರ: the Tuesday of the NEXT calendar week, whatever day it is said", () => {
  const next = { year: 2026, month: 11, day: 10, confirm: true };
  for (const w of ["അടുത്ത ചൊവ്വാഴ്ച", "അടുത്ത ചൊവ്വ", "adutha chovvazhcha", "ಮುಂದಿನ ಮಂಗಳವಾರ", "mundina mangalavara"]) assert.deepEqual(resolve(w, TUE_3_NOV), next, w);
  assert.deepEqual(resolve("അടുത്ത ചൊവ്വാഴ്ച", at(2026, 11, 2)), next); // said on the Monday before: still the 10th, not tomorrow
  assert.deepEqual(resolve("ಮುಂದಿನ ಮಂಗಳವಾರ", at(2026, 11, 8)), next); // said on the Sunday of this week
  assert.deepEqual(resolve("അടുത്ത വെള്ളിയാഴ്ച", TUE_3_NOV), { year: 2026, month: 11, day: 13, confirm: true });
  assert.deepEqual(resolve("ಮುಂದಿನ ಶುಕ್ರವಾರ", TUE_3_NOV), { year: 2026, month: 11, day: 13, confirm: true });
});

test("ഈ ചൊവ്വാഴ്ച / ಈ ಮಂಗಳವಾರ and a bare weekday, in every inflected form people write", () => {
  assert.deepEqual(resolve("ഈ ചൊവ്വാഴ്ച", TUE_3_NOV), { year: 2026, month: 11, day: 3, confirm: true }); // today counts
  assert.deepEqual(resolve("ಈ ಮಂಗಳವಾರ", TUE_3_NOV), { year: 2026, month: 11, day: 3, confirm: true });
  assert.deepEqual(resolve("ഈ തിങ്കളാഴ്ച", TUE_3_NOV), { year: 2026, month: 11, day: 9, confirm: true }); // already passed this week
  for (const w of ["ചൊവ്വാഴ്ച", "ചൊവ്വാഴ്ചയ്ക്ക്", "ചൊവ്വ", "വരുന്ന ചൊവ്വാഴ്ച", "chovvazhcha", "ಮಂಗಳವಾರ", "ಮಂಗಳವಾರದಂದು", "ಮಂಗಳವಾರಕ್ಕೆ", "ಬರುವ ಮಂಗಳವಾರ", "mangalavara"]) {
    assert.deepEqual(resolve(w, TUE_3_NOV), { year: 2026, month: 11, day: 10, confirm: true }, w); // a Tuesday said on a Tuesday
  }
  const names: [string, number][] = [["ഞായറാഴ്ച", 8], ["തിങ്കളാഴ്ച", 9], ["ബുധനാഴ്ച", 4], ["വ്യാഴാഴ്ച", 5], ["വെള്ളിയാഴ്ച", 6], ["ശനിയാഴ്ച", 7],
    ["ഞായർ", 8], ["തിങ്കൾ", 9], ["ബുധൻ", 4], ["വ്യാഴം", 5], ["വെള്ളി", 6], ["ശനി", 7],
    ["ಭಾನುವಾರ", 8], ["ಸೋಮವಾರ", 9], ["ಬುಧವಾರ", 4], ["ಗುರುವಾರ", 5], ["ಶುಕ್ರವಾರ", 6], ["ಶನಿವಾರ", 7]];
  for (const [w, day] of names) assert.deepEqual(resolve(w, TUE_3_NOV), { year: 2026, month: 11, day, confirm: true }, w);
});

test("a written date in Malayalam and Kannada; a time such as '5 മണി' next to a month is not the day", () => {
  for (const w of ["10 നവംബർ", "നവംബർ 10", "10 ನವೆಂಬರ್", "ನವೆಂಬರ್ 10", "10 നവംബർ വൈകുന്നേരം 5 മണി", "ನವೆಂಬರ್ 10 ಸಂಜೆ 5 ಗಂಟೆ"]) {
    assert.deepEqual(resolve(w, TUE_3_NOV), { year: 2026, month: 11, day: 10, confirm: false }, w);
  }
  assert.deepEqual(resolve("1 നവംബർ", TUE_3_NOV), { year: 2027, month: 11, day: 1, confirm: false });
  assert.equal(findDatePhrase("നവംബർ 5 മണി") === undefined || (resolve("നവംബർ 5 മണി", TUE_3_NOV).day !== 5), true);
  assert.deepEqual(resolve("10 ഡിസംബർ", TUE_3_NOV), { year: 2026, month: 12, day: 10, confirm: false });
  assert.deepEqual(resolve("10 ಡಿಸೆಂಬರ್", TUE_3_NOV), { year: 2026, month: 12, day: 10, confirm: false });
});

test("times in Malayalam and Kannada: period word, hour, 'മണി' and 'ಗಂಟೆ', Latin spellings", () => {
  const cases: [string, { hour: number; minute: number; period?: "am" | "pm" }][] = [
    ["വൈകുന്നേരം 6 മണിക്ക്", { hour: 6, minute: 0, period: "pm" }],
    ["വൈകുന്നേരം 6:30", { hour: 6, minute: 30, period: "pm" }],
    ["രാവിലെ 10 മണി", { hour: 10, minute: 0, period: "am" }],
    ["രാവിലെ 10:30 ന്", { hour: 10, minute: 30, period: "am" }],
    ["ഉച്ചയ്ക്ക് 2 മണിക്ക്", { hour: 2, minute: 0, period: "pm" }],
    ["രാത്രി 8 മണി", { hour: 8, minute: 0, period: "pm" }],
    ["6 മണി", { hour: 6, minute: 0 }],
    ["6 മണിക്ക്", { hour: 6, minute: 0 }],
    ["൬ മണിക്ക് വൈകുന്നേരം", { hour: 6, minute: 0, period: "pm" }], // Malayalam digit
    ["ಸಂಜೆ 6 ಗಂಟೆಗೆ", { hour: 6, minute: 0, period: "pm" }],
    ["ಸಂಜೆ 6:30", { hour: 6, minute: 30, period: "pm" }],
    ["ಬೆಳಿಗ್ಗೆ 10 ಗಂಟೆ", { hour: 10, minute: 0, period: "am" }],
    ["ಬೆಳಗ್ಗೆ 10 ಗಂಟೆಗೆ", { hour: 10, minute: 0, period: "am" }],
    ["ಮಧ್ಯಾಹ್ನ 2 ಗಂಟೆಗೆ", { hour: 2, minute: 0, period: "pm" }],
    ["ರಾತ್ರಿ 8 ಗಂಟೆಗೆ", { hour: 8, minute: 0, period: "pm" }],
    ["ಸಂಜೆ 6ಕ್ಕೆ", { hour: 6, minute: 0, period: "pm" }],
    ["6ಕ್ಕೆ", { hour: 6, minute: 0 }],
    ["೬ ಗಂಟೆಗೆ ಸಂಜೆ", { hour: 6, minute: 0, period: "pm" }], // Kannada digit
    ["6 mani", { hour: 6, minute: 0 }],
    ["6 manikku", { hour: 6, minute: 0 }],
    ["vaikunneram 6 mani", { hour: 6, minute: 0, period: "pm" }],
    ["naale sanje 6 gante", { hour: 6, minute: 0, period: "pm" }],
    ["6 gantege", { hour: 6, minute: 0 }],
  ];
  for (const [text, expected] of cases) assert.deepEqual(findTimePhrase(text), expected, text);
});

test("'6 മണിക്കൂർ' is six hours, not six o'clock; a price and a greeting are not times", () => {
  assert.equal(findTimePhrase("6 മണിക്കൂർ"), undefined);
  assert.equal(findTimePhrase("300 രൂപയ്ക്ക് ചെയ്യാമോ?"), undefined);
  assert.equal(findTimePhrase("300ಕ್ಕೆ ಮಾಡ್ತೀರಾ?"), undefined);
  assert.deepEqual(findTimePhrase("സുപ്രഭാതം, ഹെയർകട്ട് 6 മണിക്ക്"), { hour: 6, minute: 0 }); // a greeting is not a time of day
  assert.deepEqual(findTimePhrase("ಶುಭ ಸಂಜೆ, ಹೇರ್ ಕಟ್ 6 ಗಂಟೆಗೆ"), { hour: 6, minute: 0 });
});

test("formats: Malayalam and Kannada dates and times, with the period word that fits the hour", () => {
  const d = { year: 2026, month: 11, day: 10 };
  assert.equal(formatDate(d, "ml"), "ചൊവ്വ, 10 നവംബർ");
  assert.equal(formatDate(d, "kn"), "ಮಂಗಳವಾರ, 10 ನವೆಂಬರ್");
  assert.equal(formatTime({ hour: 18, minute: 0 }, "ml"), "വൈകുന്നേരം 6:00");
  assert.equal(formatTime({ hour: 18, minute: 0 }, "kn"), "ಸಂಜೆ 6:00");
  assert.equal(formatTime({ hour: 10, minute: 30 }, "ml"), "രാവിലെ 10:30");
  assert.equal(formatTime({ hour: 10, minute: 30 }, "kn"), "ಬೆಳಿಗ್ಗೆ 10:30");
  assert.equal(formatTime({ hour: 12, minute: 0 }, "ml"), "ഉച്ചയ്ക്ക് 12:00");
  assert.equal(formatTime({ hour: 14, minute: 0 }, "kn"), "ಮಧ್ಯಾಹ್ನ 2:00");
  assert.equal(formatTime({ hour: 21, minute: 0 }, "ml"), "രാത്രി 9:00");
  assert.equal(formatTime({ hour: 0, minute: 15 }, "kn"), "ರಾತ್ರಿ 12:15");
  assert.equal(formatSlot(at(2026, 11, 10, 18), TZ, "ml"), "ചൊവ്വ, 10 നവംബർ, വൈകുന്നേരം 6:00");
  assert.equal(formatSlot(at(2026, 11, 10, 18), TZ, "kn"), "ಮಂಗಳವಾರ, 10 ನವೆಂಬರ್, ಸಂಜೆ 6:00");
});

test("what the formatters write, the parser reads back as the same date and time (every weekday, every part of the day)", () => {
  for (const language of ["ml", "kn"] as const) {
    for (let offset = 0; offset < 7; offset++) {
      for (const hour of [7, 10, 12, 14, 18, 21]) {
        const ms = at(2026, 11, 3 + offset, hour);
        const written = formatSlot(ms, TZ, language); // e.g. "ബുധൻ, 4 നവംബർ, വൈകുന്നേരം 6:00"
        const dateMatch = findDatePhrase(written);
        assert.ok(dateMatch, written);
        const date = resolveDate(dateMatch, TUE_3_NOV, TZ);
        assert.deepEqual(date?.date, { year: 2026, month: 11, day: 3 + offset }, written);
        const time = findTimePhrase(written);
        assert.ok(time, written);
        assert.deepEqual(resolveTime(time, { open: 0, close: 1440 }).time, { hour, minute: 0 }, written);
      }
    }
  }
});
