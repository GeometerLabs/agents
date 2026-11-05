// Small helpers the report scripts share: read a JSON file or stop with a plain sentence, and read the options.
import { readFileSync } from "node:fs";
import { validateSettings } from "../src/settings.ts";
import { LANGUAGES } from "../../../modules/language/languages.ts";
import type { Settings } from "../src/settings.ts";
import type { Booking } from "../src/booking.ts";
import type { RecordEntry } from "../../../modules/record/record.ts";
import { SOURCES } from "./data.ts";
import type { Source } from "./data.ts";
import { noReading, readGoLiveCertificate, untrustedReading } from "./go-live.ts";
import type { GoLiveReading } from "./go-live.ts";
import { loadPrivateKey } from "../../../modules/report/sign.ts";
import type { ReportLanguage } from "../../../modules/report/text.ts";
import { UsageError, main } from "../../../modules/report/cli.ts";

export { UsageError, main };

export function readJson(path: string | undefined, what: string, option: string): unknown {
  if (!path) throw new UsageError(`Say where ${what} is: ${option} <file>.`);
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { throw new UsageError(`I cannot read ${what} at ${path}.`); }
  try { return JSON.parse(text); } catch (e) { throw new UsageError(`${what} at ${path} is not valid JSON (${(e as Error).message}).`); }
}

export function readSettings(path: string | undefined): Settings {
  const result = validateSettings(readJson(path, "the settings file", "--settings"));
  if (!result.ok) throw new UsageError(`The settings need fixing:\n- ${result.errors.join("\n- ")}`);
  return result.settings;
}

export function readEntries(path: string | undefined): RecordEntry[] {
  const value = readJson(path, "the record", "--record");
  const list = Array.isArray(value) ? value : (value as { entries?: unknown })?.entries;
  if (!Array.isArray(list)) throw new UsageError(`The record at ${path} should be a list of entries (or an object with "entries").`);
  return list as RecordEntry[];
}

/** The conversation store's bookings: a list, or an object with "bookings" as a list or as [id, booking] pairs (a Map saved as JSON). */
export function readBookings(path: string | undefined): Booking[] {
  const value = readJson(path, "the bookings", "--bookings");
  const list = Array.isArray(value) ? value : (value as { bookings?: unknown })?.bookings;
  if (!Array.isArray(list)) throw new UsageError(`The bookings at ${path} should be a list of bookings (or an object with "bookings").`);
  return list.map((b) => (Array.isArray(b) ? b[1] : b)) as Booking[];
}

/**
 * The go-live certificate for a monthly report. Unlike the other inputs, a file that is missing, unreadable, unsigned, changed or not a go-live
 * certificate is NOT a reason to stop: it becomes a reading that says the certificate could not be trusted, the report says so, and it is still made.
 */
export function readGoLive(path: string | undefined, settings: Settings): GoLiveReading {
  if (!path) return noReading();
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return untrustedReading(`I cannot read ${path}`); }
  return readGoLiveCertificate(text, settings);
}

export function readLanguage(value: string | undefined): ReportLanguage {
  if (value === "both" || (LANGUAGES as readonly string[]).includes(value ?? "")) return value as ReportLanguage;
  throw new UsageError(`Say the language: --lang ${[...LANGUAGES, "both"].join(" | ")}  ("both" is Hindi and English).`);
}

export function readSource(value: string | undefined): Source {
  if ((SOURCES as readonly string[]).includes(value ?? "")) return value as Source;
  throw new UsageError(`Say what the numbers were counted from, so the report can say it: --source ${SOURCES.join(" | ")}.`);
}

export function readKey(path: string | undefined) {
  return path ? loadPrivateKey(path) : undefined;
}

export function readNow(value: string | undefined): number {
  if (value === undefined) return Date.now();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new UsageError(`--now ${value} is not a date and time. Write it like 2026-12-02T10:00:00+05:30.`);
  return ms;
}
