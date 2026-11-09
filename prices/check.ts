// The checks every price list in this folder must pass, beyond what the readers check when they load one (bundle/panel/cost.ts, fleet's prices.ts):
//  - it is JSON, and no object in it has the same key twice (JSON.parse keeps the last one silently, so a repeated rate id would hide a price);
//  - its date is the date in its file name;
//  - every amount is a whole number: micro, basisPoints, count, freePerMonth, paisePerUnit.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

/** Every key that appears twice in the same object, as "path.key". Strings are skipped with their escapes; nothing else of JSON matters here. */
export function duplicateKeys(text: string): string[] {
  const out: string[] = [];
  const stack: Array<{ keys: Set<string> | null; expectKey: boolean; path: string }> = [];
  let lastKey = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{" || ch === "[") {
      const top = stack.at(-1);
      const path = top ? (top.keys ? `${top.path}${top.path ? "." : ""}${lastKey}` : `${top.path}[]`) : "";
      stack.push({ keys: ch === "{" ? new Set() : null, expectKey: ch === "{", path });
    } else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === ",") { const top = stack.at(-1); if (top?.keys) top.expectKey = true; }
    else if (ch === '"') {
      let j = i + 1, s = "";
      while (j < text.length && text[j] !== '"') { if (text[j] === "\\") { s += text[j + 1]; j += 2; } else { s += text[j]; j++; } }
      const top = stack.at(-1);
      if (top?.keys && top.expectKey) {
        if (top.keys.has(s)) out.push(`${top.path}${top.path ? "." : ""}${s}`);
        top.keys.add(s);
        top.expectKey = false;
        lastKey = s;
      }
      i = j;
    }
  }
  return out;
}

const WHOLE_FIELDS = ["micro", "basisPoints", "count", "freePerMonth", "paisePerUnit"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** What is wrong with one list file, in plain words; empty when nothing is. */
export function checkListFile(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const problems: string[] = [];
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return [`${basename(file)} is not valid JSON: ${(e as Error).message}`]; }
  for (const k of duplicateKeys(text)) problems.push(`${basename(file)} has ${k} twice`);
  if (!isObj(raw)) return [...problems, `${basename(file)} is not a JSON object`];
  const nameDate = /^(\d{4}-\d{2}-\d{2})\.json$/u.exec(basename(file))?.[1];
  if (raw.date !== nameDate) problems.push(`${basename(file)} says its date is ${JSON.stringify(raw.date)}`);
  for (const block of ["rates", "exchange"]) {
    const entries = isObj(raw[block]) ? Object.entries(raw[block] as Record<string, unknown>) : [];
    for (const [id, r] of entries) {
      if (!isObj(r)) { problems.push(`${basename(file)}: ${block}.${id} is not an object`); continue; }
      for (const f of WHOLE_FIELDS) {
        if (r[f] !== undefined && !(typeof r[f] === "number" && Number.isSafeInteger(r[f]) && (r[f] as number) >= 0)) problems.push(`${basename(file)}: ${block}.${id}.${f} must be a whole number, not ${JSON.stringify(r[f])}`);
      }
    }
  }
  return problems;
}
