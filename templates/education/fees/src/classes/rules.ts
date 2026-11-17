// Classes' pure rules: when the classes are, which class is next, and who may receive a class link or reading material. No clock, no store, no disk: every function
// is given what it needs, so a test (and later Guard) can run the very same code.
//
// The one rule that matters (owner decision 50): a class link and the reading material go ONLY to a student who is in the batch, whose contact has agreed, and
// whose fee is paid or still within the centre's grace days. It is judged at the moment of sending (and, for the material page, at the moment it is opened), from the
// fees as the payment record shows them, never from a flag kept earlier. `checkClassAccess` is that rule as a Decision like every other limit (src/limits.ts), so it
// is recorded beside the message it allowed or stopped.
//
// "Within the grace days" is the very boundary addLateFee uses (src/agent.ts): a fee is late from the start of the day after due date + grace days. So a student is
// never given a link on a day the agent would already have added the late fee.
import { addDays, localParts, weekdayOf, zonedToMs } from "../../../../../modules/core/time.ts";
import type { LocalDate } from "../../../../../modules/core/time.ts";
import { allow, block } from "../limits.ts";
import type { Decision } from "../limits.ts";
import type { ClassesSettings } from "./settings.ts";

const MIDNIGHT = { hour: 0, minute: 0 };
const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** One class on the calendar: the batch, its start and end, and an id that names it (the batch and its start in the centre's time zone: "class-10@202611091700"). */
export interface Occurrence { id: string; batchId: string; startMs: number; endMs: number }

/** The id of a class: stable for the same batch and start, so a restart or a second look never makes the class twice. */
export function occurrenceId(batchId: string, startMs: number, timeZone: string): string {
  const p = localParts(startMs, timeZone);
  return `${batchId}@${p.year}${pad(p.month)}${pad(p.day)}${pad(p.hour)}${pad(p.minute)}`;
}

/** Every class that STARTS in [fromMs, toMs), soonest first, from the weekly timetable. */
export function occurrencesBetween(classes: ClassesSettings, timeZone: string, fromMs: number, toMs: number): Occurrence[] {
  const out: Occurrence[] = [];
  const first = localParts(fromMs, timeZone);
  const last = localParts(toMs, timeZone);
  let day: LocalDate = { year: first.year, month: first.month, day: first.day };
  const end: LocalDate = { year: last.year, month: last.month, day: last.day };
  for (let guard = 0; guard < 400; guard++) {
    const weekday = weekdayOf(day);
    for (const [batchId, slots] of Object.entries(classes.timetable)) {
      for (const slot of slots) {
        if (slot.day !== weekday) continue;
        const startMs = zonedToMs(day, { hour: slot.hour, minute: slot.minute }, timeZone);
        if (startMs >= fromMs && startMs < toMs) out.push({ id: occurrenceId(batchId, startMs, timeZone), batchId, startMs, endMs: startMs + slot.minutes * 60_000 });
      }
    }
    if (day.year === end.year && day.month === end.month && day.day === end.day) break;
    day = addDays(day, 1);
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.batchId.localeCompare(b.batchId));
}

/** The next class of a batch that has not ended yet (one in progress counts), looking up to 14 days ahead; undefined when the timetable has none. */
export function nextClass(classes: ClassesSettings, timeZone: string, batchId: string, nowMs: number): Occurrence | undefined {
  const only: ClassesSettings = { ...classes, timetable: classes.timetable[batchId] ? { [batchId]: classes.timetable[batchId] } : {} };
  // a class that started up to four hours ago may still be going; the one found is dropped if it has ended
  return occurrencesBetween(only, timeZone, nowMs - 4 * 3_600_000, nowMs + 14 * 24 * 3_600_000).find((o) => o.endMs > nowMs);
}

/** A fee as the access rule reads it: what the payment record says about it now. The agent builds these from its dues after it has read the payments service again. */
export interface FeeSnapshot { state: "open" | "paid" | "closed"; dueDate: LocalDate; balancePaise: number }

/** Is this fee late: open, something owed, and the grace days over (from the start of the day after due date + grace days, as addLateFee counts)? */
export function isPastGrace(fee: FeeSnapshot, graceDays: number, nowMs: number, timeZone: string): boolean {
  if (fee.state !== "open" || fee.balancePaise <= 0) return false;
  return nowMs >= zonedToMs(addDays(fee.dueDate, graceDays + 1), MIDNIGHT, timeZone);
}

export interface AccessInput {
  /** The student is in the batch the class or the material belongs to (the centre's settings). */
  inBatch: boolean;
  /** The contact agreed to receive class links and material (an adult student's own number needs no consent). */
  consent: "yes" | "no" | "waiting" | "adult";
  /** False when the payments service could not be read just now: what cannot be read is not known, so nothing is sent. */
  readOk: boolean;
  /** Every fee the student has, as the payment record shows it. */
  fees: readonly FeeSnapshot[];
  graceDays: number;
  nowMs: number;
  timeZone: string;
}

/**
 * class-access: may this student's contact receive a class link, or open the reading material, right now? One Decision; the first reason that stops it is the one
 * said. A student with an unpaid fee past its grace days (a carried back due included: it is owed and past grace) gets nothing until it is paid or the owner waives it.
 */
export function checkClassAccess(input: AccessInput): Decision {
  const rule = "class-access";
  if (!input.inBatch) return block(rule, "The student is not in this batch (any more), so nothing of its classes goes to them.");
  if (input.consent === "no") return block(rule, "The contact said no to class links and material.");
  if (input.consent === "waiting") return block(rule, "The contact has not yet agreed to receive class links and material (the consent question is asked first).");
  if (!input.readOk) return block(rule, "The payment record could not be read just now, so it cannot be known that the fee is paid or within its grace days. Nothing is sent.");
  const late = input.fees.find((f) => isPastGrace(f, input.graceDays, input.nowMs, input.timeZone));
  if (late) return block(rule, "A fee of the student is not paid and its grace days are over.");
  return allow(rule, "The student is in the batch, the contact agreed, and every fee is paid or within its grace days.");
}

/**
 * missed-note-after-teacher-mark: a parent hears that a child missed a class only when the TEACHER marked the child absent and confirmed the class's attendance. A class
 * link having gone out, a join that never happened, a silence: none of these is attendance, so none sends this note.
 */
export function checkNoteAfterMark(input: { mark: "present" | "absent" | undefined; closed: boolean }): Decision {
  const rule = "missed-note-after-teacher-mark";
  if (!input.closed) return block(rule, "The teacher has not confirmed this class's attendance yet, so no one is told a child missed it.");
  if (input.mark !== "absent") return block(rule, "The teacher did not mark this student absent.");
  return allow(rule, "The teacher marked the student absent and confirmed the class's attendance.");
}
