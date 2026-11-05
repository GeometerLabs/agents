// Reminders, for every template: when they are due, and how many are sent when several fell due at once.
//
// A reminder is a moment and a flag. The template decides the moments (Bookings: some hours before the start; Fees: some days around the due date) and
// whether a message may go at all (the limits' call: Bookings stops one after a cancellation, Fees stops one once the record shows the fee paid).
// What is the same for all: past moments are never scheduled, and if the agent was not running when several fell due, it sends ONE, the latest, not a burst.
import { DAY, HOUR } from "../core/time.ts";

export interface Reminder { atMs: number; sent: boolean }

/** Reminders at these offsets from a moment (negative: before it), in the order given, leaving out any that is already past. */
export function scheduleAround(anchorMs: number, offsetsMs: readonly number[], nowMs: number): Reminder[] {
  return offsetsMs.map((offset) => anchorMs + offset).filter((at) => at > nowMs).map((atMs) => ({ atMs, sent: false }));
}

/** `hours` before a moment, as offsets. */
export const hoursBefore = (hours: readonly number[]): number[] => hours.map((h) => -h * HOUR);

/** `days` from a moment, as offsets: a negative number is before it. */
export const daysFrom = (days: readonly number[]): number[] => days.map((d) => d * DAY);

/**
 * Take the reminders that have fallen due. Every one is marked sent (so none comes back), and the answer is whether a message should go: one message,
 * however many fell due. Whether it may actually go is the limits' call.
 */
export function takeDue(reminders: Reminder[], nowMs: number): { due: boolean; atMs: number | null } {
  const due = reminders.filter((r) => !r.sent && r.atMs <= nowMs);
  for (const r of due) r.sent = true;
  return { due: due.length > 0, atMs: due.length > 0 ? Math.max(...due.map((r) => r.atMs)) : null };
}

/** The reminders that have not been taken yet and are not yet due: what is still to come. */
export const upcoming = (reminders: readonly Reminder[], nowMs: number): Reminder[] => reminders.filter((r) => !r.sent && r.atMs > nowMs);
