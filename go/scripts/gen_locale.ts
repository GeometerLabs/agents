// Writes what the books and the report need of modules/language/format.ts and modules/core/time.ts as DATA for Go: internal/locale/names.json (the month and weekday names and the
// day-part words, in four languages) and the test vectors of the formatters (internal/locale/testdata/vectors.json) and of the time helpers (internal/zone/testdata/vectors.json),
// made by RUNNING the TypeScript on Node (Intl). The names are never retyped. Run from the repository root:  node go/scripts/gen_locale.ts   (--check only compares)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DAY_PART_WORDS, MONTH_NAMES, WEEKDAY_NAMES, formatDate, formatInr, formatTime } from "../../modules/language/format.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import { addDays, daysBetween, localParts, weekdayOf, zonedToMs } from "../../modules/core/time.ts";

const here = dirname(fileURLToPath(import.meta.url));
const INTERNAL = join(here, "..", "internal");

export function generate(): Map<string, string> {
  const out = new Map<string, string>();
  out.set("locale/names.json", JSON.stringify({ months: MONTH_NAMES, weekdays: WEEKDAY_NAMES, dayParts: DAY_PART_WORDS }, null, 1) + "\n");
  const dates = [[2026, 1, 1], [2026, 2, 28], [2026, 11, 18], [2026, 12, 31], [2027, 5, 9], [2028, 2, 29]];
  const inr = [0, 1, 7, 99, 100, 150, 12050, 99999, 100000, 800000, 1234567, 12345600, 123456789, 100000000000];
  out.set("locale/testdata/vectors.json", JSON.stringify({
    inr: inr.flatMap((r) => [r, -r].map((rupees) => ({ rupees, text: formatInr(rupees) }))),
    date: LANGUAGES.flatMap((l) => dates.map(([y, m, d]) => ({ lang: l, y, m, d, text: formatDate({ year: y, month: m, day: d }, l) }))),
    time: LANGUAGES.flatMap((l) => [0, 5, 6, 11, 12, 13, 17, 18, 21, 23].flatMap((h) => [0, 5, 30, 59].map((min) => ({ lang: l, h, min, text: formatTime({ hour: h, minute: min }, l) })))),
  }, null, 1) + "\n");
  // time zones: India (no DST), New York and Sydney (DST gaps and overlaps in both hemispheres), Kathmandu (+5:45) and UTC
  const zones = ["Asia/Kolkata", "America/New_York", "Australia/Sydney", "Asia/Kathmandu", "UTC"];
  const instants = [0, 1_000_000_000_000, 1_731_978_000_000, 1_735_669_800_000 - 1, 1_735_669_800_000, 1_743_445_199_999, 1_743_445_200_000, 1_762_000_000_000, 1_772_303_399_999, 1_772_303_400_000, 1_784_000_000_000,
    Date.UTC(2026, 2, 8, 6, 59), Date.UTC(2026, 2, 8, 7, 0), Date.UTC(2026, 10, 1, 5, 59), Date.UTC(2026, 10, 1, 6, 0), Date.UTC(2026, 3, 4, 15, 59), Date.UTC(2026, 3, 4, 16, 0), Date.UTC(2028, 1, 29, 18, 29), -86_400_000 * 40];
  const wall = [[2026, 3, 8, 2, 30], [2026, 3, 8, 1, 59], [2026, 11, 1, 1, 30], [2026, 11, 1, 2, 0], [2026, 4, 5, 2, 30], [2026, 10, 4, 2, 30], [2026, 1, 1, 0, 0], [2026, 12, 31, 23, 59], [2026, 3, 31, 0, 0], [2027, 4, 1, 0, 0], [2028, 2, 29, 12, 0]];
  const days = [[2026, 3, 8], [2026, 12, 31], [2028, 2, 28], [2026, 1, 31]] as const;
  out.set("zone/testdata/vectors.json", JSON.stringify({
    parts: zones.flatMap((tz) => instants.map((ms) => ({ tz, ms, parts: localParts(ms, tz) }))),
    zoned: zones.flatMap((tz) => wall.map(([y, m, d, h, mi]) => ({ tz, y, m, d, h, mi, ms: zonedToMs({ year: y, month: m, day: d }, { hour: h, minute: mi }, tz) }))),
    addDays: days.flatMap(([y, m, d]) => [-40, -1, 0, 1, 2, 31, 366].map((n) => ({ y, m, d, n, to: addDays({ year: y, month: m, day: d }, n) }))),
    between: days.flatMap((a) => days.map((b) => ({ a: { year: a[0], month: a[1], day: a[2] }, b: { year: b[0], month: b[1], day: b[2] }, n: daysBetween({ year: a[0], month: a[1], day: a[2] }, { year: b[0], month: b[1], day: b[2] }) }))),
    weekday: days.map(([y, m, d]) => ({ y, m, d, w: weekdayOf({ year: y, month: m, day: d }) })),
  }, null, 1) + "\n");
  return out;
}

export function staleFiles(root = INTERNAL): string[] {
  return [...generate()].filter(([name, text]) => !existsSync(join(root, name)) || readFileSync(join(root, name), "utf8") !== text).map(([name]) => name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles();
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}  (run node go/scripts/gen_locale.ts)`); process.exit(1); }
  } else {
    for (const [name, text] of generate()) { mkdirSync(dirname(join(INTERNAL, name)), { recursive: true }); writeFileSync(join(INTERNAL, name), text); }
  }
}
