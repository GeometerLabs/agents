// What is particular to Bookings in understanding a message (the shared readers are in modules/understanding/): its rules, its intents, the checks on a
// model's answer, the prompt, and the questions a System One decision model is asked. The router and the language-model parser take this as their `reading`.
import { chosenProbability } from "../../../../modules/understanding/router.ts";
import type { ChoiceAnswer, ChoiceQuestion } from "../../../../modules/understanding/system-one.ts";
import type { DecisionPlan, Reading } from "../../../../modules/understanding/model.ts";
import { coerceIntent } from "./model.ts";
import type { CandidateSlot, Intent, IntentKind, ParseContext, ParseOptions } from "./model.ts";
import { intentSchema, systemPrompt, toIntentShape } from "./model-prompt.ts";
import { parseIntent } from "./rule-parser.ts";

const INTENT_LABELS: Record<string, string> = {
  book: "wants to book an appointment, or asks about a service, a price or a time",
  cancel: "wants to cancel a booking",
  reschedule: "wants a different day or time for a booking they already have",
  yes: "agrees, confirms, or says yes",
  no: "declines, or says no, or says something is wrong",
  greeting: "only says hello",
  owner: "asks to talk to the owner or to a person",
  other: "anything else",
};
const NO_SERVICE = "no_service"; // a label with an underscore: a service id never has one
const NO_SLOT = "no_slot";

const WHAT = "A customer wrote this WhatsApp message to a small shop that takes bookings, in Hindi, English, Malayalam or Kannada (in their own script or in Latin letters). ";

/** Is the rule parser's reading enough on its own? A booking with no service or no time is not: the next step may know. */
export function rulesAreSure(i: Intent): boolean {
  if (i.overrideAttempt) return true; // a trick is answered by the rules; paying for a model to read it helps nobody
  switch (i.kind) {
    case "stop": case "yes": case "no": case "cancel": case "greeting": case "owner": case "keep": return true;
    case "reschedule": return i.date !== undefined || i.time !== undefined;
    case "book": return i.serviceId !== undefined && i.date !== undefined && i.time !== undefined;
    default: return false;
  }
}

function questionsFor(context: ParseContext, slots: CandidateSlot[]): Record<string, ChoiceQuestion> {
  const questions: Record<string, ChoiceQuestion> = {
    intent: { type: "choice", instructions: `${WHAT}What does the customer want?`, criteria: INTENT_LABELS },
    service: {
      type: "choice", instructions: `${WHAT}Which of the shop's services does the customer mean?`,
      criteria: {
        ...Object.fromEntries(context.services.map((s) => [s.id, Object.values(s.names).flat().join(" / ")])),
        [NO_SERVICE]: "no service is named or meant",
      },
    },
  };
  if (slots.length > 0) {
    questions.slot = {
      type: "choice", instructions: `${WHAT}Which of these free times does the customer mean? Answer ${NO_SLOT} unless the message points at one of them.`,
      criteria: { ...Object.fromEntries(slots.map((s, i) => [`slot_${i + 1}`, s.label])), [NO_SLOT]: "none of these times" },
    };
  }
  return questions;
}

/** The decision model's reading, or null when it is unsure. */
function readDecision(answers: Record<string, ChoiceAnswer>, ruled: Intent, slots: CandidateSlot[], threshold: number): Intent | null {
  const intent = answers.intent;
  if (chosenProbability(intent) < threshold) return null;
  const kind: IntentKind = intent.choice === "other" ? "unknown" : (intent.choice as IntentKind);
  const read: Intent = { kind };
  if (ruled.language) read.language = ruled.language;
  if (ruled.offerInr !== undefined) read.offerInr = ruled.offerInr;
  if (ruled.overrideAttempt) read.overrideAttempt = true;
  const wantsDetails = kind === "book" || kind === "reschedule";

  // The service: the rules' own match wins (it is exact); otherwise what the decision model is sure of.
  const service = answers.service;
  if (ruled.serviceId) read.serviceId = ruled.serviceId;
  else if (wantsDetails && kind === "book") {
    if (chosenProbability(service) < threshold) return null;
    if (service.choice !== NO_SERVICE) read.serviceId = service.choice;
  }

  // The time: the rules' date and time win; otherwise a candidate slot the decision model is sure of.
  if (ruled.date) read.date = ruled.date;
  if (ruled.time) read.time = ruled.time;
  const slot = answers.slot;
  if (wantsDetails && slot && !(ruled.date && ruled.time)) {
    if (chosenProbability(slot) < threshold) return null;
    const picked = slot.choice === NO_SLOT ? undefined : slots[Number(slot.choice.slice("slot_".length)) - 1];
    if (picked) { read.date = ruled.date ?? picked.date; read.time = ruled.time ?? picked.time; }
  }
  return read;
}

export const bookingsReading: Reading<Intent, ParseContext, ParseOptions> = {
  rules: parseIntent,
  coerce: coerceIntent,
  prompt: systemPrompt,
  schema: intentSchema,
  shape: toIntentShape,
  sure: rulesAreSure,
  async decision(context, ruled, options): Promise<DecisionPlan<Intent>> {
    const slots = !(ruled.date && ruled.time) && options.slots ? await options.slots().catch(() => []) : [];
    return { questions: questionsFor(context, slots), read: (answers, threshold) => readDecision(answers, ruled, slots, threshold) };
  },
  merge(intent, ruled) {
    if (!intent.serviceId && ruled.serviceId) intent.serviceId = ruled.serviceId;
    return intent;
  },
};
