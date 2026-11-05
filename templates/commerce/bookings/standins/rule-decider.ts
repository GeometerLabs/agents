// The decider the Bookings stand-ins give the System One stand-in, so a local run of the whole stack has a decision model to talk to: it answers from
// the rule parser's reading of the state, at 0.9. Good enough to run the stack; it is not a model.
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Decider } from "../../../../modules/standins/system-one.ts";
import type { Question } from "../../../../modules/understanding/system-one.ts";
import { parseIntent } from "../src/adapters/rule-parser.ts";
import type { Service } from "../src/settings.ts";

/** The services the questions describe, so the rule parser can find them: the `service` question lists each id with the names customers use. */
function servicesIn(questions: Record<string, Question>): Service[] {
  const q = questions.service;
  if (!q || q.type !== "choice") return [];
  return Object.entries(q.criteria).filter(([id]) => id !== "no_service").map(([id, names]) => ({ id, names: { en: String(names).split(" / ").filter(Boolean) }, priceInr: 1, durationMinutes: 30 }));
}

export const ruleDecider: Decider = (name, question, state) => {
  if (question.type !== "choice") return { noul: 0.5 };
  const labels = Object.keys(question.criteria);
  const pick = (label: string | undefined) => ({ choice: label !== undefined && labels.includes(label) ? label : labels[labels.length - 1], p: 0.9 });
  if (name === "intent") {
    const kind = parseIntent(state, { services: [], languages: [...LANGUAGES] }).kind;
    return pick(kind === "unknown" || kind === "stop" || kind === "keep" ? "other" : kind);
  }
  if (name === "service") {
    const services = servicesIn({ service: question });
    return pick(parseIntent(state, { services, languages: [...LANGUAGES] }).serviceId ?? "no_service");
  }
  return pick("no_slot");
};
