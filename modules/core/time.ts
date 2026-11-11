// Time helpers: instants are epoch milliseconds, "local" values are read in the business's time zone.
// Intl is used only to convert between the two; every name and format lives in language/format.ts.

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export interface LocalDate { year: number; month: number; day: number } // month 1-12
export interface LocalTime { hour: number; minute: number } // 24-hour clock
export interface LocalParts extends LocalDate, LocalTime { weekday: number } // weekday 0 = Sunday

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

// Settings accept a time zone name typed by a person; this is how a bad name is caught at setup instead of throwing deep in a booking.
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The calendar date and clock time at an instant, in a time zone. */
export function localParts(ms: number, timeZone: string): LocalParts {
  const got: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== "literal") got[p.type] = Number(p.value);
  }
  const date = { year: got.year, month: got.month, day: got.day };
  return { ...date, hour: got.hour % 24, minute: got.minute, weekday: weekdayOf(date) };
}

/** Day of the week for a calendar date: 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(d: LocalDate): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

// Goes through UTC date arithmetic so month ends and leap days roll over correctly without touching any time zone (no DST surprises).
export function addDays(d: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

// Compares fields rather than objects, since LocalDate values are built fresh each time.
export function sameDate(a: LocalDate, b: LocalDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY);
}

/** The instant at which the clock in a time zone shows this date and time. */
export function zonedToMs(date: LocalDate, time: LocalTime, timeZone: string): number {
  const asUtc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  let guess = asUtc;
  for (let i = 0; i < 2; i++) { // a second pass settles zones whose offset changes near the guess
    const p = localParts(guess, timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += asUtc - shown;
  }
  return guess;
}

// Slots and opening hours are compared as plain minutes, which avoids string or Date comparison.
export function minutesOfDay(t: LocalTime): number {
  return t.hour * 60 + t.minute;
}

// The inverse of minutesOfDay, used when slot arithmetic produces a minute count that must be shown or stored as a clock time.
export function timeFromMinutes(m: number): LocalTime {
  return { hour: Math.floor(m / 60), minute: m % 60 };
}

/** "HH:MM" to minutes since midnight, or null when it is not a valid 24-hour time. */
export function parseClock(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}
