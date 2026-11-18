// Writes internal/assistant/testdata/format-vectors.json: what the TypeScript formatters (modules/language/format.ts formatInr, formatDate, formatTime, and the owner-control alerts'
// moment, modules/channels/owner-phones.ts dayAndTime) write, for the Go formatters of internal/assistant/words.go to be proved equal. Run with node from the repository root:
//   node go/scripts/gen_format_vectors.ts
import { writeFileSync } from "node:fs";
import { formatDate, formatInr, formatTime } from "../../modules/language/format.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import { dayAndTime } from "../../modules/channels/owner-phones.ts";

const paise = [0, 1, 7, 10, 99, 100, 150, 199, 12050, 99999, 100000, 800000, 1234567, 12345600, 123456789, 1000000000, 123456789012];
const out = {
  inr: paise.map((p) => ({ paise: p, text: formatInr(p / 100) })),
  date: LANGUAGES.flatMap((l) => [[2026, 1, 1], [2026, 2, 28], [2026, 11, 18], [2026, 12, 31], [2027, 5, 9], [2028, 2, 29]].map(([y, m, d]) => ({ lang: l, y, m, d, text: formatDate({ year: y, month: m, day: d }, l) }))),
  time: LANGUAGES.flatMap((l) => [0, 5, 6, 11, 12, 13, 17, 18, 21, 23].flatMap((h) => [0, 5, 30, 59].map((min) => ({ lang: l, h, min, text: formatTime({ hour: h, minute: min }, l) })))),
  // moments in UTC whose India time crosses midnight, noon, a month's end and a leap day
  moment: LANGUAGES.flatMap((l) => [Date.UTC(2026, 0, 1, 0, 0), Date.UTC(2026, 0, 31, 18, 29), Date.UTC(2026, 0, 31, 18, 30), Date.UTC(2026, 5, 9, 6, 30), Date.UTC(2026, 8, 15, 11, 5),
    Date.UTC(2026, 10, 19, 10, 12), Date.UTC(2026, 11, 31, 23, 59), Date.UTC(2028, 1, 28, 20, 0), 1_763_500_000_123].map((ms) => ({ lang: l, ms, text: dayAndTime(ms, l) }))),
};
writeFileSync(new URL("../internal/assistant/testdata/format-vectors.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
