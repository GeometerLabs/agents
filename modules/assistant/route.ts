// Which skill a message to the shop's one WhatsApp number is for (item 11e, "one front door"). A pure function: given the message and the skills' routing (skill.ts),
// it names the skill, or says the assistant itself takes it (the owner's conversation, a card's tap), or that the customer should be asked with a menu. No model is
// ever asked to route a customer: the menu is free, exact, and in the customer's language.
//
// Used today by the shop's one runtime only in the trivial way (one skill: always that skill); it is the first step of the composite runtime a two-skill shop needs,
// which waits for the bundle to deploy several skills per shop (modules/Deferred.md). Built and tested now so that design is code, not only words.
import { isRelayReply } from "../approvals/buttons.ts";
import { wordRe } from "../language/dates.ts";
import { canon } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import { parseCardReply } from "./cards.ts";
import type { SkillName, SkillRouting } from "./skill.ts";

export type Route =
  /** The relay's reply (typed or tapped): nobody in the runtime answers it. */
  | { to: "relay" }
  /** The owner's message, or a tap on an assistant card: the owner's conversation (conversation.ts), which may hand it to a skill. */
  | { to: "assistant"; why: "owner" | "card" }
  /** A skill, and the step of the router that decided it (the record keeps it). */
  | { to: "skill"; skill: SkillName; why: "button" | "reference" | "open_case" | "words" | "only_skill" }
  /** More than one skill could be meant, or none: ask the customer with a menu of the skills. */
  | { to: "menu"; candidates: SkillName[] };

export interface RouteInput { from: string; text: string; reply?: { id: string } }
export interface RoutingSkill { name: SkillName; routing: SkillRouting }

/** Cheapest first: who wrote, a tapped id, a case reference, the customer's open case, the skills' own words, one skill; otherwise a menu. */
export function routeMessage(m: RouteInput, a: { owner: string; approvers?: readonly string[]; skills: readonly RoutingSkill[] }): Route {
  const digits = (s: string) => s.replace(/\D/gu, "");
  const fromOwner = digits(m.from) === digits(a.owner);
  const fromApprover = (a.approvers ?? []).some((p) => digits(p) === digits(m.from));
  if ((fromOwner || fromApprover) && isRelayReply(m)) return { to: "relay" };
  if (fromOwner) return { to: "assistant", why: parseCardReply(m) ? "card" : "owner" };
  // 1. a tapped button or list row: its id names the skill that issued it
  if (m.reply) {
    const chosen = menuChoice(m.reply.id); // a row of the menu below
    if (chosen !== undefined && a.skills.some((s) => s.name === chosen)) return { to: "skill", skill: chosen, why: "button" };
    const owner = a.skills.find((s) => s.routing.buttonPrefixes.some((p) => m.reply!.id.startsWith(p)));
    if (owner) return { to: "skill", skill: owner.name, why: "button" };
  }
  if (a.skills.length === 1) return { to: "skill", skill: a.skills[0].name, why: "only_skill" };
  // 2. a case reference in the words names the skill that owns it
  const text = canon(m.text);
  const byRef = a.skills.find((s) => text.split(/\s+/u).some((w) => s.routing.refs.test(w.replace(/[^\p{L}\p{N}-]/gu, ""))));
  if (byRef) return { to: "skill", skill: byRef.name, why: "reference" };
  // 3. the customer's open case: one skill has a live case with this number (several: the words or the menu decide)
  const open = a.skills.filter((s) => s.routing.liveCaseOf(m.from) !== undefined);
  // 4. the skills' own few words
  const worded = a.skills.filter((s) => Object.values(s.routing.words).some((list) => list && list.length > 0 && wordRe([...list], "iu").test(text)));
  if (worded.length === 1) return { to: "skill", skill: worded[0].name, why: "words" };
  if (open.length === 1) return { to: "skill", skill: open[0].name, why: "open_case" };
  const candidates = (worded.length > 1 ? worded : open.length > 1 ? open : a.skills).map((s) => s.name);
  return { to: "menu", candidates };
}

/** The menu's row ids: "skill:<name>". A tap on one is routed by its prefix, like any skill's own button. */
export const menuRowId = (skill: SkillName): string => `skill:${skill}`;
export const menuChoice = (id: string): SkillName | undefined => (id.startsWith("skill:") ? id.slice("skill:".length) : undefined);

/** The menu's words: what the customer is asked when the words do not say which. Its rows are the skills' names in the customer's language (the template gives them). */
export const MENU_PROMPT: Record<Language, string> = {
  en: "What can we help you with?",
  hi: "हम आपकी किस बात में मदद करें?",
  ml: "ഞങ്ങൾ എന്തിനാണ് സഹായിക്കേണ്ടത്?",
  kn: "ನಾವು ಯಾವುದಕ್ಕೆ ಸಹಾಯ ಮಾಡಬೇಕು?",
};
