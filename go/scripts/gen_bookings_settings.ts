// Writes what the Go Bookings runtime needs to hold validateSettings' CHECKED TREE equal to the TypeScript's (decision 61, wave 2, slice 6):
//   go/internal/bookings/settings_check.json              the lists readCharacter and readApprovers check against (the character's styles with their palettes, the personalities, the
//                                                         paints, the most people besides the owner and the owner's approver id): the TypeScript's own, so nothing is retyped
//   go/internal/bookings/testdata/settings-tree-vectors.json   the settings the Bookings shops are made from, run through validateSettings: the checked tree and its POLICY DIGEST
//                                                         (report/data.ts policyDigest) for every shop that is accepted, the plain-words problems (in order) for every one that is not
// The policy digest is the digest of the validated tree, not of the file as written: a raw settings.json gives another digest and the go-live reading says "different". The Go
// tests hold (*Settings).Tree and bookingsreport.PolicyDigest equal to these on the same files.
// Run from the repository root:  node go/scripts/gen_bookings_settings.ts   (--check only compares; templates/commerce/bookings/test/go-books-fresh.test.ts calls `staleFiles`)
// The vectors name the Node that made them (`node`), left out of the freshness comparison.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSettings } from "../../templates/commerce/bookings/src/settings.ts";
import { policyDigest } from "../../templates/commerce/bookings/report/data.ts";
import { CHARACTER_STYLES, STYLE_INFO } from "../../modules/assistant/character.ts";
import { PERSONALITIES } from "../../modules/assistant/personality.ts";
import { PAINT_IDS } from "../../modules/channels/chat-paint.ts";
import { MAX_PEOPLE, OWNER_APPROVER } from "../../modules/approvals/people.ts";

const here = dirname(fileURLToPath(import.meta.url));
const INTERNAL = join(here, "..", "internal");
export const OUT = INTERNAL;
const BOOKINGS = join(here, "..", "..", "templates", "commerce", "bookings");
const stamp = (v: unknown): string => JSON.stringify({ node: process.version, ...(v as object) }, null, 1) + "\n";
const example = (name: string): Record<string, any> => JSON.parse(readFileSync(join(BOOKINGS, "settings", name), "utf8"));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

type Mut = [name: string, change: (s: Record<string, any>) => void];
const ANYONE = { id: "ravi", whatsapp: "+919800000002", language: "hi" };

const MUTATIONS: Mut[] = [
  ["as it is", () => {}],
  ["a name with spaces round it", (s) => { s.name = "  Glow Salon \t"; }],
  ["no address", (s) => { delete s.address; }],
  ["no time zone, buffer, languages, hold, owner language or reminders", (s) => { delete s.timezone; delete s.bufferMinutes; delete s.languages; delete s.deposit.holdMinutes; delete s.owner.language; delete s.reminders; }],
  ["one language: the names of the others are dropped", (s) => { s.languages = ["en"]; }],
  ["reminders out of order", (s) => { s.reminders = { hoursBefore: [2, 24, 12] }; }],
  ["a reminder listed twice", (s) => { s.reminders = { hoursBefore: [2, 24, 2] }; }],
  ["the calendar left to the shop's own list", (s) => { s.calendar = { module: "own" }; }],
  ["the calendar named google", (s) => { s.calendar = { module: "google" }; }],
  ["a bad calendar", (s) => { s.calendar = { module: "outlook" }; }],
  ["two chairs, a service on its own resource", (s) => { s.resources = { shop: 2, "pedicure-chair": 1 }; s.services[0].resource = "pedicure-chair"; s.services[1].resource = "shop"; }],
  ["a UPI ID in capitals and a payee with spaces", (s) => { s.payment = { module: "upi", upi: { id: "  GlowSalon@OkIcici ", payee: "  Glow Salon  " } }; }],
  ["a gateway shop", (s) => { s.payment = { module: "razorpay" }; }],
  ["approvers: one person with no language", (s) => { s.approvers = { people: [{ id: "ravi", whatsapp: "+919800000002" }] }; }],
  ["approvers: two people and a two-above amount", (s) => { s.approvers = { people: [ANYONE, { id: "meena", whatsapp: "+919800000003", language: "ml" }], twoAboveInr: 5000 }; }],
  ["approvers: nothing wrong with the shape but a two-above amount below the refund limit", (s) => { s.cancellation.refundLimitInr = 200; s.approvers = { people: [ANYONE], twoAboveInr: 100 }; }],
  ["approvers: every mistake", (s) => { s.approvers = { people: [{ id: "owner", whatsapp: "+91", language: "fr", extra: 1 }, { id: "Ravi", whatsapp: "+919800000002" }, { id: "x", whatsapp: "+919800000002", language: "hi" }, { id: "x", whatsapp: "+919800000009" }, 5], twoAboveInr: -1, more: 2 }; }],
  ["approvers: the owner's own number", (s) => { s.approvers = { people: [{ id: "ravi", whatsapp: s.owner.whatsapp }] }; }],
  ["approvers: seven people", (s) => { s.approvers = { people: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, whatsapp: `+91980000010${i}` })) }; }],
  ["approvers: empty, not an object, null", (s) => { s.approvers = { people: [] }; }],
  ["approvers: not an object", (s) => { s.approvers = [1]; }],
  ["approvers: null", (s) => { s.approvers = null; }],
  ["the assistant on with its defaults", (s) => { s.assistant = {}; }],
  ["the assistant with no morning line", (s) => { s.assistant = { morning: false }; }],
  ["the assistant with a morning line at 07:30", (s) => { s.assistant = { morning: { at: "07:30" } }; }],
  ["the assistant's talk off for customers", (s) => { s.assistant = { talk: { customers: false } }; }],
  ["the assistant's talk on for customers", (s) => { s.assistant = { talk: { customers: true } }; }],
  ["a whole character", (s) => { s.assistant = { morning: { at: "08:15" }, character: { name: " Mithra ", style: "critters", seed: "glow-salon-3f2a1c-4", colour: "#" + STYLE_INFO.critters.palette[2].toUpperCase(), paint: "blue", personality: "brief" } }; }],
  ["a character with only a style", (s) => { s.assistant = { character: { style: "pixelbot" } }; }],
  ["a character with an empty name", (s) => { s.assistant = { character: { name: "  " } }; }],
  ["a name in another script", (s) => { s.assistant = { character: { name: "മിത്ര" } }; }],
  ["the assistant: every mistake in the character", (s) => { s.assistant = { character: { name: "Mithra1", style: "x", seed: "Bad Seed", colour: "123456", paint: "red", personality: "loud", voice: "a", look: {} } }; }],
  ["the assistant: a colour of another style", (s) => { s.assistant = { character: { style: "clay", colour: STYLE_INFO.critters.palette[1] } }; }],
  ["the assistant: a name that is not text", (s) => { s.assistant = { character: { name: 5 } }; }],
  ["the assistant: not an object", (s) => { s.assistant = "on"; }],
  ["the assistant: null", (s) => { s.assistant = null; }],
  ["the assistant: unknown keys, a bad morning, a bad talk", (s) => { s.assistant = { colour: "red", morning: { at: "8:00" }, talk: { customers: "no", also: 1 } }; }],
  ["the assistant: a morning that is not an object", (s) => { s.assistant = { morning: true }; }],
  ["the assistant: a character that is not an object", (s) => { s.assistant = { character: "clay" }; }],
  ["the assistant: null character", (s) => { s.assistant = { character: null }; }],
  ["the assistant: a talk that is not an object", (s) => { s.assistant = { talk: false }; }],
  ["problems in several places come in the TypeScript's order", (s) => { s.slotMinutes = 0; s.approvers = { people: [] }; s.payment = { module: "bitcoin" }; s.assistant = { morning: true }; s.calendar = 5; }],
];

function cases(): unknown[] {
  const out: unknown[] = [];
  for (const file of ["glow-salon.example.json", "glow-salon-upi.example.json", "equipment-rental.example.json"]) {
    for (const [name, change] of MUTATIONS) {
      // the equipment shop has other services and one language set: only the plain cases are run on it
      if (file === "equipment-rental.example.json" && !["as it is", "a name with spaces round it", "no address", "the assistant on with its defaults", "a whole character"].includes(name)) continue;
      const input = clone(example(file));
      try { change(input); } catch { continue; }
      const text = JSON.stringify(input);
      const r = validateSettings(JSON.parse(text));
      if (r.ok) out.push({ name: `${file}: ${name}`, input: JSON.parse(text), ok: true, tree: clone(r.settings), digest: policyDigest(r.settings) });
      else out.push({ name: `${file}: ${name}`, input: JSON.parse(text), ok: false, errors: r.errors });
    }
  }
  return out;
}

export function generate(): Map<string, string> {
  const out = new Map<string, string>();
  out.set("bookings/settings_check.json", JSON.stringify({
    styles: CHARACTER_STYLES.map((id) => ({ id, name: STYLE_INFO[id].name, palette: [...STYLE_INFO[id].palette] })),
    personalities: [...PERSONALITIES], paints: [...PAINT_IDS], maxPeople: MAX_PEOPLE, ownerApprover: OWNER_APPROVER,
  }, null, 1) + "\n");
  out.set("bookings/testdata/settings-tree-vectors.json", stamp({ cases: cases() }));
  return out;
}

const withoutNode = (text: string): string => { try { const o = JSON.parse(text); delete o.node; return JSON.stringify(o); } catch { return text; } };

export function staleFiles(root = INTERNAL): string[] {
  return [...generate()].filter(([name, text]) => !existsSync(join(root, name)) || withoutNode(readFileSync(join(root, name), "utf8")) !== withoutNode(text)).map(([name]) => name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles();
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}  (run node go/scripts/gen_bookings_settings.ts)`); process.exit(1); }
  } else {
    for (const [name, text] of generate()) { mkdirSync(dirname(join(INTERNAL, name)), { recursive: true }); writeFileSync(join(INTERNAL, name), text); }
    console.log(`written with Node ${process.version}`);
  }
}
