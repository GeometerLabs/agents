// Small helpers the report scripts share. The command-line frame and the readers of the options every script takes (a JSON file, the record, the language, what the numbers
// were counted from, the key, the time) are the same for every template (modules/report/cli.ts); this file adds Fees' own: its settings, its fees, its go-live certificate.
import { readFileSync } from "node:fs";
import { UsageError, main, readEntries, readJson, readKey, readLanguage, readNow, readSource } from "../../../modules/report/cli.ts";
import type { Due } from "../src/due.ts";
import { validateSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { noReading, readGoLiveCertificate, untrustedReading } from "./go-live.ts";
import type { GoLiveReading } from "./go-live.ts";

export { UsageError, main, readEntries, readJson, readKey, readLanguage, readNow, readSource };

export function readSettings(path: string | undefined): Settings {
  const result = validateSettings(readJson(path, "the settings file", "--settings"));
  if (!result.ok) throw new UsageError(`The settings need fixing:\n- ${result.errors.join("\n- ")}`);
  return result.settings;
}

/** The conversation store's fees: a list, or an object with "dues" as a list or as [id, due] pairs (a Map saved as JSON). */
export function readDues(path: string | undefined): Due[] {
  const value = readJson(path, "the fees", "--dues");
  const list = Array.isArray(value) ? value : (value as { dues?: unknown })?.dues;
  if (!Array.isArray(list)) throw new UsageError(`The fees at ${path} should be a list of fees (or an object with "dues").`);
  return list.map((d) => (Array.isArray(d) ? d[1] : d)) as Due[];
}

/**
 * The go-live certificate for a monthly report. Unlike the other inputs, a file that is missing, unreadable, unsigned, changed or not a go-live certificate is NOT a
 * reason to stop: it becomes a reading that says the certificate could not be trusted, the report says so, and it is still made.
 */
export function readGoLive(path: string | undefined, settings: Settings): GoLiveReading {
  if (!path) return noReading();
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return untrustedReading(`I cannot read ${path}`); }
  return readGoLiveCertificate(text, settings);
}
