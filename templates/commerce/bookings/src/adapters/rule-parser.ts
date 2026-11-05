// A deterministic parser for Hindi, English, Malayalam and Kannada (and the Hindi, Malayalam and Kannada people type in
// Latin letters), good enough to drive the tests and the hand check. The Malayalam and Kannada words are in
// language/words.ts, so they can be read and reviewed in one place. It reads a message and returns an Intent. It never
// decides anything: prices, hours and slots are decided by the limits, so a smarter (or fooled) parser changes nothing
// about what is allowed.
import { canon } from "../../../../modules/language/format.ts";
import { GREETING_RE, NO_RE, YES_RE, detectLanguage, findOffer, isOverrideAttempt, isStop, nfc } from "../../../../modules/understanding/rules.ts";
import { findDatePhrase, findTimePhrase, phraseRe, wordRe } from "../../../../modules/language/dates.ts";
import { inBoth } from "../../../../modules/language/words.ts";
import type { Intent, IntentParser, ParseContext } from "./model.ts";

const CANCEL_RE = wordRe(["cancel", "cancelled", "canceled", "cancellation", "कैंसल", "रद्द", "रद", "निरस्त", "radd", "cancle", ...inBoth((w) => w.cancel)]);
const RESCHEDULE_RE = new RegExp(nfc("(?:re-?schedul|postpone|change\\s+(?:the\\s+|my\\s+)?(?:time|date|slot|booking|appointment)|move\\s+(?:it|my\\s+(?:booking|appointment))|समय\\s+बदल|तारीख\\s+बदल|दिन\\s+बदल|रीशेड्यूल|रीसेट|time\\s+badal|date\\s+badal)"), "u");
const RESCHEDULE_DRAVIDIAN_RE = phraseRe(inBoth((w) => w.reschedule));
const BOOK_RE = wordRe(["book", "booking", "appointment", "slot", "reserve", "बुक", "बुकिंग", "अपॉइंटमेंट", "चाहिए", "करवाना", "कटवाना", "chahiye", "karwana", "available", ...inBoth((w) => w.book)]);

function findService(t: string, context: ParseContext): string | undefined {
  let best: { id: string; length: number } | undefined;
  for (const service of context.services) {
    for (const names of Object.values(service.names)) {
      for (const name of names ?? []) {
        if (wordRe([name]).test(t) && (!best || name.length > best.length)) best = { id: service.id, length: name.length };
      }
    }
  }
  return best?.id;
}

/** Read one message. Pure and synchronous; the async wrapper is only there to fit the IntentParser seam. */
export function parseIntent(text: string, context: ParseContext): Intent {
  const t = canon(text);
  const intent: Intent = { kind: "unknown" };
  const language = detectLanguage(text);
  if (language) intent.language = language;
  if (isOverrideAttempt(t)) intent.overrideAttempt = true;

  if (isStop(t)) return { ...intent, kind: "stop" };

  const serviceId = findService(t, context);
  const offerInr = findOffer(t);
  const date = findDatePhrase(text);
  const time = findTimePhrase(text);
  if (serviceId) intent.serviceId = serviceId;
  if (offerInr !== undefined) intent.offerInr = offerInr;
  if (date) intent.date = date;
  if (time) intent.time = time;

  const hasDetails = serviceId !== undefined || offerInr !== undefined || date !== undefined || time !== undefined;
  const shortReply = t.trim().split(/\s+/u).length <= 5 && !hasDetails;

  if (RESCHEDULE_RE.test(t) || RESCHEDULE_DRAVIDIAN_RE.test(t)) intent.kind = "reschedule";
  else if (CANCEL_RE.test(t)) intent.kind = "cancel";
  else if (hasDetails || BOOK_RE.test(t)) intent.kind = "book";
  else if (shortReply && NO_RE.test(t) && !YES_RE.test(t)) intent.kind = "no";
  else if (shortReply && YES_RE.test(t)) intent.kind = "yes";
  else if (GREETING_RE.test(t)) intent.kind = "greeting";
  return intent;
}

export function createRuleParser(): IntentParser {
  return { parse: async (text, context) => parseIntent(text, context) };
}
