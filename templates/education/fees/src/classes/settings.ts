// Classes, the add-on of the Fees package (owner decision 50): the `classes` block of a centre's settings, and the words that read it.
//
// Why a block and not a second template: Classes shares Fees' money path (fees, payments, reminders, refunds, the report), so it grows inside the package and is
// switched on by this one block. A centre without the block is exactly the Fees centre it was: nothing in src/classes/ runs for it.
//
// The block holds what a teacher sets once: the timetable (which batch has a class on which day and hour, and for how long), how long before a class the link is
// sent, and the largest reading-material file the centre's server will hand out. Things the teacher changes often (the class link, a doubt, an attendance mark) are
// NOT here: they are conversation state (src/classes/state.ts), because the teacher says them on WhatsApp.
//
//   "classes": {
//     "timetable": { "class-10": [ { "day": "mon", "time": "17:00", "minutes": 60 }, { "day": "thu", "time": "17:00", "minutes": 60 } ] },
//     "linkLeadMinutes": 30,        the link goes this long before the class starts (5 to 180; default 30)
//     "materialMaxMb": 10,          the largest file a private material page hands out (1 to 100; default 10)
//     "oldDuesStopLink": false      true: a carried back due stops the class link and the material like an ordinary fee; false (default): only ordinary fees do (owner, 17 Nov 2026)
//   }
import type { Batch } from "../settings.ts";
import { parseClock } from "../../../../../modules/core/time.ts";

/** One weekly class: `day` 0 = Sunday ... 6 = Saturday, the start as hour and minute in the centre's time zone, and its length. */
export interface ClassSlot { day: number; hour: number; minute: number; minutes: number }

export interface ClassesSettings {
  /** By batch id. A batch with no entry has no class in the timetable (its students are still billed as in Fees). */
  timetable: Record<string, ClassSlot[]>;
  linkLeadMinutes: number;
  materialMaxMb: number;
  /** A carried back due stops the class link and the material (as an ordinary fee past its grace days does). Default false: only ordinary fees decide. */
  oldDuesStopLink: boolean;
}

export const DEFAULT_LEAD_MINUTES = 30;
export const DEFAULT_MATERIAL_MB = 10;
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const LONG_DAYS: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, tues: 2, thur: 4, thurs: 4 };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isWhole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** "mon", "Monday" or 1 as a weekday number, or undefined. */
export function dayNumber(v: unknown): number | undefined {
  if (isWhole(v) && v >= 0 && v <= 6) return v;
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  const short = DAY_NAMES.indexOf(t as (typeof DAY_NAMES)[number]);
  return short >= 0 ? short : LONG_DAYS[t];
}

/** Read the block (undefined: the centre has no Classes). Problems are pushed in plain words; the value returned is best effort. */
export function readClasses(v: unknown, batches: readonly Batch[], errors: string[]): ClassesSettings | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) { errors.push("The classes block (\"classes\") must look like {\"timetable\": {\"class-10\": [{\"day\": \"mon\", \"time\": \"17:00\", \"minutes\": 60}]}}."); return undefined; }
  for (const key of Object.keys(v)) if (!["timetable", "linkLeadMinutes", "materialMaxMb", "oldDuesStopLink"].includes(key)) errors.push(`I don't know what "${key}" means in the classes block. Allowed: timetable, linkLeadMinutes, materialMaxMb, oldDuesStopLink.`);

  const timetable: Record<string, ClassSlot[]> = {};
  if (!isObj(v.timetable) || Object.keys(v.timetable).length === 0) errors.push("Add the timetable (\"classes.timetable\"): for each batch id, a list of classes like {\"day\": \"mon\", \"time\": \"17:00\", \"minutes\": 60}.");
  else {
    for (const [batchId, raw] of Object.entries(v.timetable)) {
      if (!batches.some((b) => b.id === batchId)) { errors.push(`The timetable names the batch "${batchId}", which is not one of the batches.`); continue; }
      if (!Array.isArray(raw) || raw.length === 0 || raw.length > 14) { errors.push(`The timetable of "${batchId}" must be a list of 1 to 14 weekly classes.`); continue; }
      const slots: ClassSlot[] = [];
      raw.forEach((item, i) => {
        const where = `Class number ${i + 1} of "${batchId}"`;
        if (!isObj(item)) { errors.push(`${where} must look like {"day": "mon", "time": "17:00", "minutes": 60}.`); return; }
        for (const key of Object.keys(item)) if (!["day", "time", "minutes"].includes(key)) errors.push(`I don't know what "${key}" means in ${where}. Allowed: day, time, minutes.`);
        const day = dayNumber(item.day);
        const clock = typeof item.time === "string" ? parseClock(item.time) : null;
        const minutes = item.minutes === undefined ? 60 : item.minutes;
        if (day === undefined) errors.push(`${where} needs a day ("day"): mon, tue, wed, thu, fri, sat or sun.`);
        if (clock === null) errors.push(`${where} needs a start time ("time") like "17:00" (24-hour clock).`);
        if (!isWhole(minutes) || minutes < 10 || minutes > 240) errors.push(`${where}: the length ("minutes") must be a whole number from 10 to 240.`);
        if (day !== undefined && clock !== null && isWhole(minutes) && minutes >= 10 && minutes <= 240) {
          if (slots.some((s) => s.day === day && s.hour * 60 + s.minute === clock)) errors.push(`${where} is listed twice (same day and time).`);
          else slots.push({ day, hour: Math.floor(clock / 60), minute: clock % 60, minutes });
        }
      });
      timetable[batchId] = slots;
    }
  }
  const lead = v.linkLeadMinutes === undefined ? DEFAULT_LEAD_MINUTES : v.linkLeadMinutes;
  if (!isWhole(lead) || lead < 5 || lead > 180) errors.push("The minutes before a class when its link is sent (\"classes.linkLeadMinutes\") must be a whole number from 5 to 180.");
  const mb = v.materialMaxMb === undefined ? DEFAULT_MATERIAL_MB : v.materialMaxMb;
  if (!isWhole(mb) || mb < 1 || mb > 100) errors.push("The largest reading-material file (\"classes.materialMaxMb\") must be a whole number of megabytes from 1 to 100.");
  if (v.oldDuesStopLink !== undefined && typeof v.oldDuesStopLink !== "boolean") errors.push("Whether an old due stops the class link (\"classes.oldDuesStopLink\") must be true or false.");
  return { timetable, linkLeadMinutes: isWhole(lead) ? lead : DEFAULT_LEAD_MINUTES, materialMaxMb: isWhole(mb) ? mb : DEFAULT_MATERIAL_MB, oldDuesStopLink: v.oldDuesStopLink === true };
}
