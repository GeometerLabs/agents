// Writes go/internal/bookings/testdata/talk-facts-vectors.json: what the owner's talk on a Bookings shop is given, as the TypeScript makes it. For a few stores (bookings today,
// this week, over the last 28 days, in every state) and an owner who speaks English or Hindi: the Bookings skill's `facts` and `publicContext("")` (templates/commerce/bookings/src/
// assistant.ts talkReads), and the system prompt and schema of the owner's talk with those sources and the shop's declared limit (modules/assistant/talk-prompt.ts ownerPrompt).
// The Go Bookings skill (internal/bookings/agent_talkfacts.go) and the packed prompt (gen_words.ts talk.system.*.limits) are proved equal on them. Run from the repository root:
//   node go/scripts/gen_talk_facts_vectors.ts        (add --check to only compare with the committed file)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bookingsSkill } from "../../templates/commerce/bookings/src/assistant.ts";
import { createStore, newDraft, register } from "../../templates/commerce/bookings/src/booking.ts";
import type { Booking } from "../../templates/commerce/bookings/src/booking.ts";
import { parseSettings } from "../../templates/commerce/bookings/src/settings.ts";
import { ownerPrompt } from "../../modules/assistant/talk-prompt.ts";
import { zonedToMs } from "../../modules/core/time.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = join(here, "..", "internal", "bookings", "testdata", "talk-facts-vectors.json");
const SETTINGS = join(here, "..", "..", "templates", "commerce", "bookings", "settings", "glow-salon.example.json");
const TZ = "Asia/Kolkata";
const NOW = zonedToMs({ year: 2026, month: 11, day: 25 }, { hour: 10, minute: 0 }, TZ); // a Wednesday

/** A booking as the vectors give it to both sides. */
type Row = { customer: string; state: Booking["state"]; serviceId?: string; startMs?: number; minutes?: number };

function rows(): Row[][] {
  const at = (days: number, h: number, m = 0) => zonedToMs({ year: 2026, month: 11, day: 25 + days }, { hour: h, minute: m }, TZ);
  return [
    [],
    [
      { customer: "+919811111111", state: "confirmed", serviceId: "haircut", startMs: at(0, 15), minutes: 30 },
      { customer: "+919822222222", state: "confirmed", serviceId: "haircut", startMs: at(0, 11, 30), minutes: 30 },
      { customer: "+919833333333", state: "awaiting_deposit", serviceId: "facial", startMs: at(0, 12), minutes: 60 },
      { customer: "+919844444444", state: "needs_owner", serviceId: "beard-trim", startMs: at(1, 12), minutes: 15 },
      { customer: "+919855555555", state: "completed", serviceId: "beard-trim", startMs: at(-3, 17), minutes: 15 },
      { customer: "+919866666666", state: "completed", serviceId: "hair-colour", startMs: at(-10, 10), minutes: 90 },
      { customer: "+919877777777", state: "cancelled", serviceId: "haircut", startMs: at(-5, 18), minutes: 30 },
      { customer: "+919888888888", state: "cancelled", serviceId: "haircut", startMs: at(-40, 18), minutes: 30 },
      { customer: "+919899999999", state: "completed", serviceId: "facial", startMs: at(-30, 11), minutes: 60 },
      { customer: "+919800000000", state: "enquiry" },
    ],
  ];
}

/** The vectors' text. */
export function generate(): string {
  const base = JSON.parse(readFileSync(SETTINGS, "utf8"));
  const cases = [];
  for (const lang of ["en", "hi"] as const) {
    const raw = { ...base, owner: { ...base.owner, language: lang } };
    const settings = parseSettings(raw);
    for (const list of rows()) {
      const store = createStore();
      for (const r of list) {
        const b = newDraft(r.customer, "en");
        b.state = r.state;
        if (r.serviceId) b.serviceId = r.serviceId;
        if (r.startMs !== undefined) { b.startMs = r.startMs; b.endMs = r.startMs + (r.minutes ?? 30) * 60_000; }
        register(store, b);
      }
      const skill = bookingsSkill({ settings, store, nowMs: () => NOW, entries: () => [], optedOut: () => false });
      const facts = skill.facts!(NOW);
      const pub = skill.publicContext!("", NOW).sources;
      const limits = [{ id: "refund_limit", about: lang === "hi" ? "रिफंड की सीमा" : "refund limit" }];
      const prompt = ownerPrompt({ shop: { name: settings.name, character: { personality: "warm" } }, language: lang, sources: [...facts, ...pub], limits });
      cases.push({ lang, settings: raw, nowMs: NOW, rows: list, facts, public: pub, limits, system: prompt.system, schema: prompt.schema });
    }
  }
  return `${JSON.stringify({ cases }, null, 1)}\n`;
}

/** True when the committed file differs from a fresh render. */
export function stale(file = OUT): boolean {
  try { return readFileSync(file, "utf8") !== generate(); } catch { return true; }
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    if (stale()) { console.error(`${OUT} is out of date: run node go/scripts/gen_talk_facts_vectors.ts`); process.exit(1); }
    console.log("talk facts vectors are fresh");
  } else {
    writeFileSync(OUT, generate());
    console.log(`wrote ${OUT}`);
  }
}
