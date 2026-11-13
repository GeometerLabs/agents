// The character and the settings block (item 11e; item 11i, decision 47): a character is a name, one of the five approved DiceBear styles, a seed, an optional colour
// from that style's own palette and a personality, with no voice (the assistant answers in text, owner 12 Nov); the old hand-drawn "look" is refused in words. The mood
// is computed from the shop's real state only, in a fixed order, and maps to one picture; the public sees only all well, busy or closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHARACTER_STYLES, EYES_AND_MOUTH, FACES, FACE_OF_MOOD, FACE_WORDS, STYLE_INFO, defaultCharacter, pictureUrl, publicFace, readCharacter, themeColour } from "../character.ts";
import { MOODS, moodOf, outsideHours } from "../mood.ts";
import { PERSONALITIES, SMALL_TALK, greeting } from "../personality.ts";
import { DEFAULT_MORNING, readAssistantSettings } from "../settings.ts";
import { assistantCatalogue, assistantSubmissions } from "../templates.ts";
import { HEADER_HANDLE_TO_UPLOAD } from "../../language/meta-templates.ts";
import { LANGUAGES } from "../../language/languages.ts";
import { zonedToMs } from "../../core/time.ts";

const TZ = "Asia/Kolkata";
const THU = { year: 2026, month: 11, day: 12 };
const at = (h: number, m = 0) => zonedToMs(THU, { hour: h, minute: m }, TZ);

test("a character is a name, a style, a seed, a colour from the style's own palette and a personality; anything else is refused in words", () => {
  const errors: string[] = [];
  const c = { name: "Mithra", style: "critters", seed: "glow-salon-3f2a1c-4", colour: "fda4af", personality: "cheerful" };
  assert.deepEqual(readCharacter(c, errors), c);
  assert.deepEqual(errors, []);
  assert.deepEqual(readCharacter({ name: "Golu" }, []), { name: "Golu", style: "clay", personality: "warm" }, "the defaults: Golu, the shop's id as seed, Auto colour, warm");
  assert.equal(readCharacter({ name: "Golu", colour: "#C4795C" }, [])?.colour, "c4795c", "a colour may be written with a # and capitals");
  for (const [raw, says] of [
    [{ name: "R2D2" }, /no digits/u], [{ name: "" }, /1 to 24 letters/u], [{ name: "Mithra", style: "avataaars" }, /must be one of: clay/u],
    [{ name: "Mithra", style: "clay", colour: "fda4af" }, /one of the Golu colours/u], [{ name: "Mithra", seed: "Has Spaces" }, /small letters, digits and hyphens/u],
    [{ name: "Mithra", personality: "grumpy" }, /warm, cheerful, brief/u], [{ name: "Mithra", voice: "warm" }, /answers in text/u], ["Mithra", /must be an object/u],
    [{ name: "Mithra", look: { base: "tall", colour: "pink", accessory: "scissors" } }, /no longer a setting/u],
  ] as const) {
    const e: string[] = [];
    readCharacter(raw, e);
    assert.ok(e.some((x) => says.test(x)), `${JSON.stringify(raw)}: ${e.join(" | ")}`);
  }
  assert.ok(!("voice" in defaultCharacter()));
  // names in the shop's own scripts are fine
  for (const name of ["मित्रा", "മിത്ര", "ಮಿತ್ರ", "O'Neil"]) { const e: string[] = []; readCharacter({ name }, e); assert.deepEqual(e, [], name); }
});

test("the five styles, each with eight colours and an eyes-and-mouth pair for every mood; the words never say \"bot\"", () => {
  assert.deepEqual([...CHARACTER_STYLES], ["clay", "critters", "sprouts", "moods", "pixelbot"]);
  for (const s of CHARACTER_STYLES) {
    assert.equal(STYLE_INFO[s].palette.length, 8, s);
    assert.ok(!/bot/iu.test(STYLE_INFO[s].name), STYLE_INFO[s].name);
    for (const f of FACES) assert.equal(EYES_AND_MOUTH[s][f].length, 2, `${s} ${f}`);
  }
  assert.deepEqual(new Set(Object.values(FACE_OF_MOOD)), new Set(FACES), "every picture stands for a mood");
  for (const l of LANGUAGES) for (const f of FACES) assert.ok(FACE_WORDS[l][f].length > 0, `${l} ${f}: the mood in words`);
  assert.equal(themeColour(undefined), "#0f766e");
  assert.equal(themeColour({ colour: "fda4af" }), "#fda4af");
  assert.equal(pictureUrl({ base: "https://p.example/glow", version: "0123456789abcdef" }, "busy", "webp"), "https://p.example/glow/character/busy.webp?v=0123456789abcdef");
});

test("the public sees only all well, busy or closed: what waits for the owner and what went wrong stay the owner's", () => {
  assert.equal(publicFace("something_wrong", "busy"), "busy");
  assert.equal(publicFace("waiting_for_owner", "closed"), "closed");
  assert.equal(publicFace("waiting_for_owner", "quiet"), "well");
  assert.equal(publicFace("busy", "busy"), "busy");
});

test("a personality changes only small talk: warm is today's words exactly, and every line names only the character and the shop", () => {
  // the warm morning template is word for word what owner_morning said before item 11i, so a shop that never picked one reads what it read before
  const OLD: Record<string, string> = {
  en: "Good morning from {name}, the assistant of {shop}. Today, {date}: {today}. Recorded yesterday: {money}. Waiting for you: {waiting}. Reply here to see more.",
  hi: "सुप्रभात, मैं {name}, {shop} का असिस्टेंट। आज, {date}: {today}। कल दर्ज: {money}। आपके लिए बाकी: {waiting}। और देखने के लिए यहाँ जवाब दें।",
  ml: "സുപ്രഭാതം, ഞാൻ {name}, {shop}-ന്റെ അസിസ്റ്റന്റ്. ഇന്ന്, {date}: {today}. ഇന്നലെ രേഖപ്പെടുത്തിയത്: {money}. നിങ്ങൾക്കായി കാത്തിരിക്കുന്നവ: {waiting}. കൂടുതൽ കാണാൻ ഇവിടെ മറുപടി നൽകുക.",
  kn: "ಶುಭೋದಯ, ನಾನು {name}, {shop} ನ ಸಹಾಯಕ. ಇಂದು, {date}: {today}. ನಿನ್ನೆ ದಾಖಲಾದದ್ದು: {money}. ನಿಮಗಾಗಿ ಕಾಯುತ್ತಿರುವವು: {waiting}. ಹೆಚ್ಚು ನೋಡಲು ಇಲ್ಲಿ ಉತ್ತರಿಸಿ.",
  };
  const t = assistantCatalogue.templates;
  for (const l of LANGUAGES) assert.equal(t.find((x) => x.name === "owner_morning")!.bodies[l], OLD[l], l);
  assert.deepEqual(t.filter((x) => x.usedFor.startsWith("morning")).map((x) => x.name), ["owner_morning", "owner_morning_cheerful", "owner_morning_brief"]);
  for (const p of PERSONALITIES) for (const l of LANGUAGES) {
    const words = SMALL_TALK[p][l];
    for (const [k, v] of Object.entries(words)) {
      assert.ok(!/\d/u.test(v), `${p} ${l} ${k}: no digit`);
      assert.ok(!/\b(safe|guaranteed|proves|certified|bot|earn|income)\b|100%/iu.test(v), `${p} ${l} ${k}: a banned word`);
      assert.deepEqual([...v.matchAll(/\{(\w+)\}/gu)].map((m) => m[1]).filter((x) => x !== "name" && x !== "shop"), [], `${p} ${l} ${k}: only {name} and {shop}`);
    }
    assert.ok(!words.morningOpening.startsWith("{"), `${p} ${l}: a template body may not start with a value`);
    assert.ok(greeting(p, l, "Golu", "Glow Salon").includes("Golu"), `${p} ${l}`);
  }
});

test("every morning template has an image header, submitted with an example picture's handle; the customers' templates have none", () => {
  for (const sub of assistantSubmissions()) {
    const header = sub.components.find((c) => c.type === "HEADER");
    if (sub.name.startsWith("owner_morning")) assert.deepEqual(header, { type: "HEADER", format: "IMAGE", example: { header_handle: [HEADER_HANDLE_TO_UPLOAD] } }, sub.name);
    else assert.equal(header, undefined, sub.name);
  }
  assert.equal(assistantSubmissions().length, 5 * LANGUAGES.length);
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
