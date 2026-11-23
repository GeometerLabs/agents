// What the owner's app shows (item 11e): the character and its mood, today's list, what needs the owner (each skill's waiting items and the assistant's open cards, by id
// and digest so a press can be checked against what waits now), and the last lines of talk. The shop runtime makes it (the Go program since 24 Nov 2026,
// go/internal/assistant) and adds it to item 11d's owner view as `app`; this file keeps its shape, which the front reads (modules/channels/backend.ts) and the notes list
// draws from (app/notes.ts). The TypeScript that computed it went with the TypeScript runtime.
import type { Character, Face } from "../character.ts";
import type { Mood } from "../mood.ts";
import type { DayRow, SkillName, WaitingItem } from "../skill.ts";
import type { TalkLine } from "../state.ts";

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
  /** Block M: the notes the assistant remembers (every open note: the owner may see all), for the app's list with a delete button. */
  notes: { id: string; text: string; kind: string; audience: "owner" | "everyone"; untilMs?: number }[];
}
