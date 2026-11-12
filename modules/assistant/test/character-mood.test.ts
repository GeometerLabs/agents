// The character's hooks and the settings block (item 11e): a character is a name and a look from fixed lists, with no voice (the assistant answers in text, owner 12 Nov);
// the mood is computed from the shop's real state only, in a fixed order, and names a sticker. The settings block turns the assistant on with its defaults.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOK_OPTIONS, defaultCharacter, readCharacter, stickerFor } from "../character.ts";
import { MOODS, moodOf, outsideHours } from "../mood.ts";
import { DEFAULT_MORNING, readAssistantSettings } from "../settings.ts";
import { zonedToMs } from "../../core/time.ts";

const TZ = "Asia/Kolkata";
const THU = { year: 2026, month: 11, day: 12 };
const at = (h: number, m = 0) => zonedToMs(THU, { hour: h, minute: m }, TZ);

test("a character is a name and a look from the lists; anything else is refused in words", () => {
  const errors: string[] = [];
  assert.deepEqual(readCharacter({ name: "Mithra", look: { base: "tall", colour: "pink", accessory: "scissors" } }, errors), { name: "Mithra", look: { base: "tall", colour: "pink", accessory: "scissors" } });
  assert.deepEqual(errors, []);
  for (const [raw, says] of [
    [{ name: "R2D2" }, /no digits/u], [{ name: "" }, /1 to 24 letters/u], [{ name: "Mithra", look: { colour: "gold" } }, /one of: teal/u],
    [{ name: "Mithra", look: { hat: "red" } }, /not an option/u], [{ name: "Mithra", voice: "warm" }, /answers in text/u], ["Mithra", /must be an object/u],
  ] as const) {
    const e: string[] = [];
    readCharacter(raw, e);
    assert.ok(e.some((x) => says.test(x)), `${JSON.stringify(raw)}: ${e.join(" | ")}`);
  }
  assert.ok(LOOK_OPTIONS.accessory.includes("none"));
  assert.ok(!("voice" in defaultCharacter()));
  // names in the shop's own scripts are fine
  for (const name of ["मित्रा", "മിത്ര", "ಮಿತ್ರ", "O'Neil"]) { const e: string[] = []; readCharacter({ name }, e); assert.deepEqual(e, [], name); }
});

test("the settings block: left out is off; {} is on with the defaults; the morning line can be moved or turned off", () => {
  assert.equal(readAssistantSettings(undefined, []), undefined);
  assert.deepEqual(readAssistantSettings({}, []), { morningAt: DEFAULT_MORNING, character: defaultCharacter() });
  assert.deepEqual(readAssistantSettings({ morning: { at: "07:30" } }, [])?.morningAt, { hour: 7, minute: 30 });
  assert.equal(readAssistantSettings({ morning: false }, [])?.morningAt, null);
  const errors: string[] = [];
  readAssistantSettings({ morning: { at: "8am" }, points: 3 }, errors);
  assert.equal(errors.length, 2, errors.join(" | "));
});

test("the mood is the shop's real state, in a fixed order", () => {
  const base = { problems: 0, waiting: 0, closedToday: false, outsideHours: false, todayStartsMs: [] as number[], nowMs: at(12) };
  assert.equal(moodOf(base), "quiet");
  assert.equal(moodOf({ ...base, todayStartsMs: [at(12, 30)] }), "busy");
  assert.equal(moodOf({ ...base, todayStartsMs: Array.from({ length: 8 }, (_, i) => at(14 + Math.floor(i / 2), (i % 2) * 30)) }), "busy");
  assert.equal(moodOf({ ...base, outsideHours: true, todayStartsMs: [at(12, 30)] }), "closed");
  assert.equal(moodOf({ ...base, closedToday: true, waiting: 1 }), "waiting_for_owner", "a closed shop can still owe an answer");
  assert.equal(moodOf({ ...base, waiting: 2, problems: 1 }), "something_wrong");
  assert.deepEqual([...MOODS], ["something_wrong", "waiting_for_owner", "closed", "busy", "quiet"]);
});

test("outside the hours: before opening, after closing, and all day when closed", () => {
  const hours = { open: 10 * 60, close: 20 * 60 };
  assert.equal(outsideHours(hours, THU, at(9, 59), TZ), true);
  assert.equal(outsideHours(hours, THU, at(10), TZ), false);
  assert.equal(outsideHours(hours, THU, at(20), TZ), true);
  assert.equal(outsideHours(null, THU, at(12), TZ), true);
});

test("a mood names its sticker from the look, so the drawings can follow the shop", () => {
  assert.equal(stickerFor({ name: "Mithra", look: { base: "round", colour: "teal", accessory: "scissors" } }, "busy"), "round-teal-busy");
});
