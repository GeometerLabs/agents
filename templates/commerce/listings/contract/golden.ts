// GOLDEN answers for the listings contract (see README.md "The golden answers"). Until 19 Nov 2026 several tests ran a TypeScript shop and a Go shop side by side and compared what the
// owner reads, the record and the files; before the TypeScript runtime was deleted (decision 61, wave 1b) those answers were RECORDED from the TypeScript shop into golden/<test file>.json
// (one file per test file, keys = the names the tests give), so the Go shop is now held to what the TypeScript said.
//
//   LISTINGS_GOLDEN=write  record: the value each `golden(name, run)` produces is normalized and kept (the file starts empty, a name may not be used twice)
//   (unset)                replay: the value is normalized and compared whole with the recorded one; a name that is not recorded FAILS (it is never skipped)
//   LISTINGS_GOLDEN_DIR    where the files are (default contract/golden/): a second recording goes elsewhere, to be diffed with the first
//   LISTINGS_GOLDEN_SHIFT  write mode only: milliseconds added to the recording's instant (a rehearsal that the replay really puts the shop at the recorded day, weekday and time)
//
// Time. What the owner reads names days ("Nothing recorded on Tue 24 Nov", the month's "back on" date, the morning line's day), so each entry keeps the shop's instant when it was
// recorded, and a replay runs every shop the test makes on the TEST clock at that instant (harness.ts `setGoldenClock`: the clock file starts at the offset). Both a recording and a
// replay run on the test clock, so the two runs differ only in the implementation. A recording is refused within 40 minutes of midnight in India (the shop's zone), so a run never
// crosses into another day. What still differs from run to run is masked: signatures, ISO instants and epoch-millisecond numbers (the seconds a run takes); the tests keep their own
// masks for random ids (an ask's id, a message id).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { REPO, IMPL, setGoldenClock } from "./harness.ts";

export const WRITE = process.env.LISTINGS_GOLDEN === "write";
const DIR = process.env.LISTINGS_GOLDEN_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "golden");
const SHIFT = Number(process.env.LISTINGS_GOLDEN_SHIFT ?? 0);
/** Over this many bytes of JSON a golden file is kept gzipped (the JSON is easier to read in a diff, so small files stay plain). */
const GZIP_OVER = 200_000;

interface Entry { at: number; value: unknown }
interface GoldenFile { about: string; impl: string; commit: string; entries: Record<string, Entry> }

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/gu;
/** What legitimately differs between two recordings: a signature's bytes, ISO instants, epoch milliseconds. Days and dates are NOT masked (the clock makes them the same). */
export const norm = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null, (k, x) => (k === "signature" ? "<sig>"
  : typeof x === "number" && Number.isInteger(x) && x > 1e12 && x < 1e14 ? "<ms>"
  : typeof x === "string" ? x.replace(ISO, "<iso>") : x)));

/** India's time of day of an instant, in minutes. */
const istMinutes = (ms: number): number => Math.floor(((ms + 19_800_000) % 86_400_000) / 60_000);

function read(file: string): GoldenFile | undefined {
  if (existsSync(`${file}.gz`)) return JSON.parse(gunzipSync(readFileSync(`${file}.gz`)).toString("utf8")) as GoldenFile;
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as GoldenFile;
  return undefined;
}

/**
 * The golden check of one test file: `golden(name, run)` runs `run` with every shop it makes on the test clock at the recorded instant, normalizes what it returns and records it
 * (LISTINGS_GOLDEN=write) or compares it with the recording. It returns what `run` returned, so the test goes on checking its own fields.
 */
export function goldenFor(testFileUrl: string): <T>(name: string, run: () => Promise<T>) => Promise<T> {
  const file = join(DIR, `${basename(fileURLToPath(testFileUrl)).replace(/\.test\.ts$/u, "")}.json`);
  let commit = "";
  try { commit = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* no git */ }
  const out: GoldenFile = { about: `What ${basename(fileURLToPath(testFileUrl))} saw, recorded by golden.ts (LISTINGS_GOLDEN=write); masked: signatures, ISO instants, epoch ms.`, impl: IMPL, commit, entries: {} };
  let recorded: GoldenFile | undefined;
  const save = (): void => {
    mkdirSync(DIR, { recursive: true });
    const text = `${JSON.stringify(out, null, 1)}\n`;
    if (text.length > GZIP_OVER) { writeFileSync(`${file}.gz`, gzipSync(Buffer.from(text), { level: 9 })); rmSync(file, { force: true }); }
    else { writeFileSync(file, text); rmSync(`${file}.gz`, { force: true }); }
  };
  return async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    let at: number;
    if (WRITE) {
      assert.ok(!(name in out.entries), `the golden name "${name}" is used twice in ${basename(file)}`);
      at = Date.now() + SHIFT;
      const m = istMinutes(at);
      assert.ok(m > 40 && m < 24 * 60 - 40, "a golden answer is not recorded within 40 minutes of midnight in India: the run must not cross into another day");
    } else {
      recorded ??= read(file);
      assert.ok(recorded, `there is no golden file ${file}: record it (LISTINGS_GOLDEN=write, see README.md)`);
      const entry = recorded.entries[name];
      assert.ok(entry, `"${name}" is not in the golden file ${basename(file)}: record it (LISTINGS_GOLDEN=write, see README.md)`);
      at = entry.at;
    }
    setGoldenClock(at - Date.now());
    let value: T;
    try { value = await run(); } finally { setGoldenClock(undefined); }
    const seen = norm(value);
    if (WRITE) { out.entries[name] = { at, value: seen }; save(); }
    else assert.deepEqual(seen, recorded!.entries[name].value, `${name}: the answer differs from the golden one (recorded by ${recorded!.impl} at ${recorded!.commit.slice(0, 8)})`);
    return value;
  };
}
