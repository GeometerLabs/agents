// The character's mood (item 11e, decision 43): the shop's real state at a glance, computed from the skills' reads and the clock every time it is asked for, never
// stored and never earned. No points, chores or streaks: a mood says what is true now, and changes when the shop does. Used by the owner's app (the face it shows)
// and the morning line (which sticker). character.ts names the sticker.
import type { LocalDate } from "../core/time.ts";
import { localParts, zonedToMs, HOUR } from "../core/time.ts";

/** The moods, in the order they win: something wrong first, quiet last. */
export const MOODS = ["something_wrong", "waiting_for_owner", "closed", "busy", "quiet"] as const;
export type Mood = (typeof MOODS)[number];

/** What a mood is computed from. Every field is a count or a fact read from the store this step, or the clock. */
export interface MoodFacts {
  /** Things a person must look at that the owner cannot answer (a refund that needs the builder, a message that failed, a task that gave up on a Guard). */
  problems: number;
  /** Cards and items waiting for the owner's answer. */
  waiting: number;
  /** Today is closed: the weekday has no hours, or the owner closed the date. */
  closedToday: boolean;
  /** Now is outside today's opening hours (before opening or after closing). */
  outsideHours: boolean;
  /** Starts of today's bookings (Bookings), to see whether one is within the hour. */
  todayStartsMs: readonly number[];
  /** How many bookings make a busy day: at or above this, the day is busy whatever the hour. */
  busyDay?: number;
  nowMs: number;
}

/** A day with this many bookings is busy even when none is within the hour. A shop of one chair fills about eight. */
export const BUSY_DAY = 8;

/** The mood now. Something wrong outranks waiting, waiting outranks closed (a closed shop can still owe a refund), and closed outranks busy. */
export function moodOf(f: MoodFacts): Mood {
  if (f.problems > 0) return "something_wrong";
  if (f.waiting > 0) return "waiting_for_owner";
  if (f.closedToday || f.outsideHours) return "closed";
  const soon = f.todayStartsMs.some((s) => s >= f.nowMs - HOUR && s <= f.nowMs + HOUR);
  if (soon || f.todayStartsMs.length >= (f.busyDay ?? BUSY_DAY)) return "busy";
  return "quiet";
}

/** Is `nowMs` outside the hours on `today`? Hours are minutes from midnight; null hours mean the day is closed (and so outside). */
export function outsideHours(hours: { open: number; close: number } | null, today: LocalDate, nowMs: number, timeZone: string): boolean {
  if (!hours) return true;
  const open = zonedToMs(today, { hour: Math.floor(hours.open / 60), minute: hours.open % 60 }, timeZone);
  const close = zonedToMs(today, { hour: Math.floor(hours.close / 60), minute: hours.close % 60 }, timeZone);
  return nowMs < open || nowMs >= close;
}

/** Today's date in the shop's zone (the mood and the morning line read the same day). */
export const todayIn = (nowMs: number, timeZone: string): LocalDate => { const p = localParts(nowMs, timeZone); return { year: p.year, month: p.month, day: p.day }; };
