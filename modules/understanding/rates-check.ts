// The checks on a file of the model price table (rates/<date>.json), kept apart from rates.ts so the runtime, and the browser build of the demo, carry the table
// and not its checker. A test runs every committed file through it, and the bytes of each file are pinned, so a file that is wrong never reaches a shop.
export const QUALITIES = ["assumed", "conflicting", "second-hand", "official-undated", "official"] as const; // weakest first
export type Quality = (typeof QUALITIES)[number];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/u;
const price = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const goodSource = (s: unknown) => typeof s === "string" && (/^https:\/\/\S+$/u.test(s) || /^docs\//u.test(s));
const LINE_KEYS = ["provider", "model", "modelPattern", "inputUsdPerMillion", "outputUsdPerMillion", "cachedInputUsdPerMillion", "quality", "source", "read", "note"];

/** Everything wrong with a parsed rate file, in plain words; an empty list means it is good. */
export function problemsIn(raw: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(raw) || raw.format !== "geometer-model-rates/1") return ['it is not a Geometer model rate table (format "geometer-model-rates/1")'];
  const date = typeof raw.date === "string" && ISO_DAY.test(raw.date) ? raw.date : "";
  if (date === "") problems.push("it needs a date (YYYY-MM-DD)");
  const rate = isObj(raw.inrPerUsd) ? raw.inrPerUsd : {};
  if (typeof rate.rate !== "number" || !(rate.rate > 0) || !Number.isFinite(rate.rate)) problems.push("inrPerUsd.rate must be a number above zero");
  if (!goodSource(rate.source) || typeof rate.read !== "string" || !ISO_DAY.test(rate.read) || typeof rate.note !== "string" || rate.note.trim() === "") problems.push("inrPerUsd needs a source, the day it was read and a note");
  if (!Array.isArray(raw.rates) || raw.rates.length === 0) problems.push("rates must be a list with at least one line");
  (Array.isArray(raw.rates) ? raw.rates : []).forEach((line: unknown, i: number) => {
    const at = `rates[${i}]`;
    if (!isObj(line)) { problems.push(`${at} must be an object`); return; }
    for (const key of Object.keys(line)) if (!LINE_KEYS.includes(key)) problems.push(`${at} has a field this table does not know: ${key}`);
    if (typeof line.provider !== "string" || !/^[a-z][a-z0-9-]{0,39}$/u.test(line.provider)) problems.push(`${at}.provider must be a short lowercase name`);
    if (typeof line.model !== "string" || line.model === "") problems.push(`${at}.model must be a model id, or "*"`);
    if (!price(line.inputUsdPerMillion) || !price(line.outputUsdPerMillion)) problems.push(`${at} needs inputUsdPerMillion and outputUsdPerMillion, numbers of 0 or more`);
    if (line.cachedInputUsdPerMillion !== undefined && !price(line.cachedInputUsdPerMillion)) problems.push(`${at}.cachedInputUsdPerMillion must be a number of 0 or more`);
    if (!(QUALITIES as readonly string[]).includes(line.quality as string)) problems.push(`${at} must say how sure we are (quality: ${QUALITIES.join(", ")})`);
    if (!goodSource(line.source)) problems.push(`${at} must say where it was read (an https address, or a docs/ path)`);
    if (typeof line.read !== "string" || !ISO_DAY.test(line.read) || (date !== "" && line.read > date)) problems.push(`${at} must say the day it was read, not after the file's own date`);
    if (typeof line.note !== "string" || line.note.trim() === "") problems.push(`${at} needs a note`);
    if (line.modelPattern !== undefined) {
      try { new RegExp(line.modelPattern as string, "iu"); } catch { problems.push(`${at}.modelPattern is not a pattern`); }
      if (line.model !== "*") problems.push(`${at}: a modelPattern goes with model "*"`);
    }
  });
  const notPriced = isObj(raw.notPriced) ? raw.notPriced : {};
  for (const [key, why] of Object.entries(notPriced)) if (typeof why !== "string" || !/^[a-z][a-z0-9-]*\/\S+$/u.test(key)) problems.push(`notPriced "${key}" must be provider/model with a reason`);
  return problems;
}
