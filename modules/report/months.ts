// Months, for every report: "2026-11" in a time zone as [from, to) in epoch milliseconds, and the files a report is written into.
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { zonedToMs } from "../core/time.ts";

/** "2026-11" in a time zone as [from, to) in epoch milliseconds. */
export function monthRange(month: string, timeZone: string): { from: number; to: number } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new Error(`"${month}" is not a month. Write it like 2026-11.`);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const midnight = { hour: 0, minute: 0 };
  return {
    from: zonedToMs({ year, month: mon, day: 1 }, midnight, timeZone),
    to: zonedToMs(mon === 12 ? { year: year + 1, month: 1, day: 1 } : { year, month: mon + 1, day: 1 }, midnight, timeZone),
  };
}

/** The folder a report is written into: made if it is not there, and an error if the name is a file. Everything is written into this one folder and nowhere else. */
export function outFolder(out: string): string {
  const dir = resolve(out);
  try {
    if (!statSync(dir).isDirectory()) throw new Error(`${out} is a file, not a folder. Name a folder for --out.`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Writes files into the one folder; a file name is a plain name and never a path. */
export function writer(out: string) {
  const dir = outFolder(out);
  const files: string[] = [];
  return {
    files,
    write(name: string, content: string) {
      if (name !== name.replace(/[\\/]/g, "") || name.startsWith(".")) throw new Error(`"${name}" is not a plain file name.`);
      const path = join(dir, name);
      writeFileSync(path, content, "utf8");
      files.push(path);
    },
  };
}
