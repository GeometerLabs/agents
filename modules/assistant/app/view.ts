// What the owner's app shows (item 11e), read from the step's store like every other read: the character and its mood, today's list, what needs the owner (each skill's
// waiting items and the assistant's open cards, by id and digest so a press can be checked against what waits now), and the last lines of talk. Pure. Used by the
// runtime's owner read once item 11d's owner page lands (it grows that page's `owner` read; modules/Deferred.md).
import type { Character } from "../character.ts";
import { isClosedDay, shopMood } from "../conversation.ts";
import { openCards } from "../cards.ts";
import type { Mood } from "../mood.ts";
import { todayIn } from "../mood.ts";
import type { AssistantSettings } from "../settings.ts";
import type { DayRow, OwnerSkill, SkillName, WaitingItem } from "../skill.ts";
import type { AssistantState, TalkLine } from "../state.ts";

export interface OwnerAppView {
  character: Character;
  mood: Mood;
  sticker: string;
  closedToday: boolean;
  today: DayRow[];
  /** Each skill's waiting items: on the page each is answered as item 11d's page answers it (its own digest, read by the skill). */
  waiting: (WaitingItem & { skill: SkillName })[];
  /** The assistant's open cards: answered on the page by card id and digest, with the owner's link as the authority (no code is ever on the page). */
  cards: { id: string; digest: string; skill: SkillName; kind: string; case: string; amountPaise: number; who: string; expiresAtMs: number }[];
  talk: readonly TalkLine[];
}

export function ownerAppView(a: { skills: readonly OwnerSkill[]; state: AssistantState | undefined; nowMs: number; timeZone: string; settings: AssistantSettings }): OwnerAppView {
  const d = todayIn(a.nowMs, a.timeZone);
  const { mood, sticker } = shopMood(a.skills, a.state, a.nowMs, a.timeZone, a.settings);
  return {
    character: a.settings.character, mood, sticker,
    closedToday: isClosedDay(a.state, d),
    today: a.skills.flatMap((s) => s.day?.(d) ?? []).sort((x, y) => x.startMs - y.startMs),
    waiting: a.skills.flatMap((s) => s.waiting().map((w) => ({ ...w, skill: s.name }))),
    cards: (a.state ? openCards(a.state, a.nowMs) : []).map((c) => ({
      id: c.id, digest: c.digest, skill: c.action.skill, kind: c.action.kind, case: c.action.case,
      amountPaise: typeof c.action.fields.amountPaise === "number" ? c.action.fields.amountPaise : 0, who: String(c.action.fields.who ?? c.action.case), expiresAtMs: c.expiresAtMs,
    })),
    talk: a.state?.talk ?? [],
  };
}
