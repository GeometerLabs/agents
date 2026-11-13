// What the owner's app shows (item 11e), read from the step's store like every other read: the character and its mood, today's list, what needs the owner (each skill's
// waiting items and the assistant's open cards, by id and digest so a press can be checked against what waits now), and the last lines of talk. Pure. Used by the
// runtime's owner read (templates/commerce/bookings/server/runtime.ts), which adds it to item 11d's owner view as `app`.
import type { Character, Face } from "../character.ts";
import { isClosedDay, shopMood } from "../conversation.ts";
import { cardHasNo, openCards } from "../cards.ts";
import type { Mood } from "../mood.ts";
import { todayIn } from "../mood.ts";
import type { AssistantSettings } from "../settings.ts";
import type { DayRow, OwnerSkill, SkillName, WaitingItem } from "../skill.ts";
import type { AssistantState, TalkLine } from "../state.ts";

export interface OwnerAppView {
  character: Character;
  mood: Mood;
  /** Item 11i: the picture of the mood (character.ts FACES), all five, since this is the owner's view. */
  face: Face;
  closedToday: boolean;
  today: DayRow[];
  /** Each skill's waiting items: on the page each is answered as item 11d's page answers it (its own digest, read by the skill). */
  waiting: (WaitingItem & { skill: SkillName })[];
  /** The assistant's open cards: answered on the page by card id and digest, with the owner's link as the authority (no code is ever on the page). */
  cards: { id: string; digest: string; skill: SkillName; kind: string; case: string; amountPaise: number; who: string; expiresAtMs: number; question?: string; hasNo: boolean }[];
  talk: readonly TalkLine[];
}

export function ownerAppView(a: { skills: readonly OwnerSkill[]; state: AssistantState | undefined; nowMs: number; timeZone: string; settings: AssistantSettings }): OwnerAppView {
  const d = todayIn(a.nowMs, a.timeZone);
  const { mood, face } = shopMood(a.skills, a.state, a.nowMs, a.timeZone);
  return {
    character: a.settings.character, mood, face,
    closedToday: isClosedDay(a.state, d),
    today: a.skills.flatMap((s) => s.day?.(d) ?? []).sort((x, y) => x.startMs - y.startMs),
    waiting: a.skills.flatMap((s) => s.waiting().map((w) => ({ ...w, skill: s.name }))),
    cards: (a.state ? openCards(a.state, a.nowMs) : []).map((c) => ({
      id: c.id, digest: c.digest, skill: c.action.skill, kind: c.action.kind, case: c.action.case,
      amountPaise: typeof c.action.fields.amountPaise === "number" ? c.action.fields.amountPaise : 0, who: String(c.action.fields.who ?? c.action.case), expiresAtMs: c.expiresAtMs,
      ...(c.question ? { question: c.question } : {}), hasNo: cardHasNo(c),
    })),
    talk: a.state?.talk ?? [],
  };
}

/**
 * Item 11i: the shop's character as its public pages show it (the offer's `shop.character`): its name when the partner gave one, and the mood the PUBLIC sees now (all well, busy or closed;
 * character.ts publicFace), from the same reads as the owner's app. Undefined for a shop without the assistant. The front adds the picture itself.
 */
export function publicCharacter(a: { skills: readonly OwnerSkill[]; state: AssistantState | undefined; nowMs: number; timeZone: string; settings: AssistantSettings | undefined }): { name?: string; face: Face } | undefined {
  if (!a.settings) return undefined;
  const name = a.settings.character.name;
  return { ...(name ? { name } : {}), face: shopMood(a.skills, a.state, a.nowMs, a.timeZone).publicFace };
}
