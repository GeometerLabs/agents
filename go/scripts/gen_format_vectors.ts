// Writes internal/assistant/testdata/format-vectors.json: what the TypeScript formatters (modules/language/format.ts formatInr, formatDate, formatTime) write, for the Go formatters of
// internal/assistant/words.go to be proved equal. Run with node from the repository root:  node go/scripts/gen_format_vectors.ts
import { writeFileSync } from "node:fs";
import { formatDate, formatInr, formatTime } from "../../modules/language/format.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";

const paise = [0, 1, 7, 10, 99, 100, 150, 199, 12050, 99999, 100000, 800000, 1234567, 12345600, 123456789, 1000000000, 123456789012];
const out = {
  inr: paise.map((p) => ({ paise: p, text: formatInr(p / 100) })),
  date: LANGUAGES.flatMap((l) => [[2026, 1, 1], [2026, 2, 28], [2026, 11, 18], [2026, 12, 31], [2027, 5, 9], [2028, 2, 29]].map(([y, m, d]) => ({ lang: l, y, m, d, text: formatDate({ year: y, month: m, day: d }, l) }))),
  time: LANGUAGES.flatMap((l) => [0, 5, 6, 11, 12, 13, 17, 18, 21, 23].flatMap((h) => [0, 5, 30, 59].map((min) => ({ lang: l, h, min, text: formatTime({ hour: h, minute: min }, l) })))),
};
writeFileSync(new URL("../internal/assistant/testdata/format-vectors.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
