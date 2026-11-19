// Writes internal/bookings/reading.json: what the Go Bookings runtime reads a customer's message with, as the TypeScript BUILT it, so nothing is retyped (decision 61, wave 2):
// the rule parser's own patterns (src/adapters/rule-parser.ts: cancel, reschedule, book; each RegExp's `.source` and `.flags`), the intents a model may answer, the decision
// model's questions and labels (src/adapters/reading.ts), and the language model's system prompt and answer schema (src/adapters/model-prompt.ts) as templates: they are
// rendered here for a shop with one sentinel service, and the sentinel is turned into a placeholder the Go side fills with the shop's own services (its `prompt` and `schema`
// vectors prove the fill on the example shop). The shared patterns (yes, no, STOP, a price, a time) are in internal/language/patterns.json (gen_patterns.ts).
// Run with node from the repository root:   node go/scripts/gen_bookings_reading.ts          (add --check to only compare with the committed file)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BOOK_RE, CANCEL_RE, RESCHEDULE_DRAVIDIAN_RE, RESCHEDULE_RE } from "../../templates/commerce/bookings/src/adapters/rule-parser.ts";
import { INTENT_LABELS, NO_SERVICE, NO_SLOT, bookingsReading } from "../../templates/commerce/bookings/src/adapters/reading.ts";
import { KINDS, MODEL_KINDS } from "../../templates/commerce/bookings/src/adapters/model.ts";
import { intentSchema, systemPrompt } from "../../templates/commerce/bookings/src/adapters/model-prompt.ts";
import type { Service } from "../../templates/commerce/bookings/src/settings.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = join(here, "..", "internal", "bookings", "reading.json");

const ID = "\u0001id\u0001";
const NAME = "\u0001name\u0001";
const SLOT = "\u0001slot\u0001";

export async function generate(): Promise<string> {
  const sentinel = { id: ID, names: { en: [NAME] }, priceInr: 1, durationMinutes: 30 } as Service;
  const ctx = { services: [sentinel], languages: ["en" as const] };
  const prompt = systemPrompt(ctx).replace(`\n- ${ID} = en: ${NAME}\n`, "\n{{services}}\n").replaceAll(ID, "{{id}}").replaceAll(NAME, "{{name}}");
  if (prompt.includes("\u0001")) throw new Error("the prompt has a sentinel left in it: model-prompt.ts changed its services block");
  const schema = intentSchema(ctx) as { properties: { serviceId: { anyOf: { enum?: string[] }[] } } };
  schema.properties.serviceId.anyOf[0].enum = []; // the shop's service ids, filled by the Go side
  const plan = await bookingsReading.decision!(ctx, { kind: "book" }, { slots: async () => [{ startMs: 0, date: { kind: "relative", offsetDays: 0 }, time: { hour: 1, minute: 0 }, label: SLOT }] });
  const q = plan.questions;
  const pattern = (re: RegExp) => ({ source: re.source, flags: re.flags });
  return JSON.stringify({
    patterns: { cancel: pattern(CANCEL_RE), reschedule: pattern(RESCHEDULE_RE), rescheduleDravidian: pattern(RESCHEDULE_DRAVIDIAN_RE), book: pattern(BOOK_RE) },
    kinds: KINDS, modelKinds: MODEL_KINDS,
    questions: {
      intent: { instructions: q.intent.instructions, criteria: Object.entries(INTENT_LABELS) },
      service: { instructions: q.service.instructions, none: [NO_SERVICE, q.service.criteria[NO_SERVICE]] },
      slot: { instructions: q.slot.instructions, none: [NO_SLOT, q.slot.criteria[NO_SLOT]] },
    },
    prompt, schema,
  }, null, 1) + "\n";
}

/** Whether the committed file is out of date with a fresh render. */
export async function stale(path = OUT): Promise<boolean> {
  let have = "";
  try { have = readFileSync(path, "utf8"); } catch { /* missing */ }
  return have !== (await generate());
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    const s = await stale();
    if (s) console.error(`stale: ${OUT}`);
    process.exitCode = s ? 1 : 0;
  } else {
    writeFileSync(OUT, await generate());
    console.log(`wrote ${OUT}`);
  }
}
