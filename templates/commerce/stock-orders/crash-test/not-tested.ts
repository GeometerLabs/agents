// What the hand check does not test, in its own words: printed under every run, so the result line is never read as more than it is. If you add a situation, remove its line;
// if you find a gap, add one (CONTRIBUTING.md).
import type { Settings } from "../src/settings.ts";

export const STAND_IN_SERVICES = "stand-in WhatsApp only: no payments service is used";
export const HAND_RUN = "run by hand";

export interface NotTested { id: string; text: string }

export function notTestedOf(_settings: Settings): NotTested[] {
  return [
    { id: "real-whatsapp", text: "a real WhatsApp account, a real Meta template approval, a real supplier's phone (the order text and the buttons are read only against the stand-in)" },
    { id: "native-review", text: "the Hindi, Malayalam and Kannada wording (machine-written, no native speaker has read it)" },
    { id: "model-reading", text: "an owner's request read by a language model (only the rule reader is used; an unreadable request is asked about, not guessed)" },
    { id: "supplier-formats", text: "the many ways real suppliers answer (a voice note, a photo of a bill, \"ok bhai\" in another script, a reply that quotes an older message)" },
    { id: "restart", text: "a restart in the middle of an approval (the store is in memory here; a saved store, the runtime and the owner's page are not built, Deferred.md)" },
    { id: "paying", text: "paying a supplier (not built: the owner pays as today and marks it, and the agent cannot check it)" },
    { id: "invoice", text: "a supplier's invoice, a price quote that differs from the catalogue, a part-shipment note from the supplier, a return of goods" },
    { id: "real-month", text: "a month that turns while a card is open across the turn (the card's month is bound, so it asks again; tested once with a moved clock only in test/)" },
  ];
}
