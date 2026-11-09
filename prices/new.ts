// Start a new dated price list: `node prices/new.ts 2026-12-01`.
//
// It copies the newest list in this folder to <date>.json with only its `date` changed, and refuses to overwrite a file or to go backwards (a date on or before
// the newest list's). Then edit the new file: the prices that change, each one's `read` day, `source` and `note`, and the `about` text. Never edit a list that
// is already committed; old months are worked out again from the list that was in force for them. README.md says who reads this folder.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** This folder: the only place a price is written. */
export const PRICES_DIR = fileURLToPath(new URL(".", import.meta.url));
const DATED = /^(\d{4}-\d{2}-\d{2})\.json$/u;

/** Is this a real calendar day written YYYY-MM-DD (so 2026-02-30 is not)? */
export function isRealDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The dated lists in a folder, oldest first. */
export const listFiles = (dir: string): string[] => readdirSync(dir).filter((f) => DATED.test(f)).sort();

/** Copy the newest list in `dir` to `<date>.json`, with its date changed. Returns the two file names. Throws, in plain words, when it may not. */
export function newList(dir: string, date: string): { from: string; to: string } {
  if (!isRealDay(date)) throw new Error(`"${date}" is not a day. Write it as YYYY-MM-DD, like 2026-12-01.`);
  const files = listFiles(dir);
  const newest = files.at(-1);
  if (newest === undefined) throw new Error(`There is no price list in ${dir} to copy from.`);
  const newestDay = newest.slice(0, 10);
  if (date <= newestDay) throw new Error(`The newest list is ${newest}. A new list must be dated after it, never on or before: an old month is always worked out with the list that was in force then.`);
  const to = `${date}.json`;
  if (existsSync(join(dir, to))) throw new Error(`${to} already exists. A price list is never overwritten.`);
  const list = JSON.parse(readFileSync(join(dir, newest), "utf8")) as Record<string, unknown>;
  list.date = date;
  writeFileSync(join(dir, to), `${JSON.stringify(list, null, 2)}\n`, { flag: "wx" });
  return { from: newest, to };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const date = process.argv[2];
  if (date === undefined || process.argv.length > 3) {
    console.error("Usage: node prices/new.ts <YYYY-MM-DD>   copies the newest price list to that date, for you to edit.");
    process.exit(2);
  }
  try {
    const { from, to } = newList(PRICES_DIR, date);
    console.log(`Copied ${from} to ${to}. Now edit ${to}: the prices that change, each one's read day, source and note, and the about text. Then run the tests, and the copies that read it (fleet: npm run prices:sync).`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
