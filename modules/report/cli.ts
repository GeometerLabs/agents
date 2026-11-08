// What every report script shares: a sentence said to the person, a main function that prints it without a stack, and the readers of the options every script takes (a JSON
// file, the record, the language, what the numbers were counted from, the signing key, the time). A template adds the readers of its own files (its settings, its cases).
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../language/languages.ts";
import type { RecordEntry } from "../record/record.ts";
import { loadPrivateKey } from "./sign.ts";
import { tenantOf } from "../record/ledger.ts";
import { SOURCES } from "./text.ts";
import type { ReportLanguage, Source } from "./text.ts";

/** Said to the person, then the script stops. */
export class UsageError extends Error {}

/** Run a script's main function; a UsageError (or any error with a plain message) is printed without a stack. */
export async function main(run: () => Promise<number | void>): Promise<void> {
  try {
    process.exitCode = (await run()) ?? 0;
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = e instanceof UsageError ? 64 : 1;
  }
}

export function readJson(path: string | undefined, what: string, option: string): unknown {
  if (!path) throw new UsageError(`Say where ${what} is: ${option} <file>.`);
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { throw new UsageError(`I cannot read ${what} at ${path}.`); }
  try { return JSON.parse(text); } catch (e) { throw new UsageError(`${what} at ${path} is not valid JSON (${(e as Error).message}).`); }
}

export function readEntries(path: string | undefined): RecordEntry[] {
  const value = readJson(path, "the record", "--record");
  const list = Array.isArray(value) ? value : (value as { entries?: unknown })?.entries;
  if (!Array.isArray(list)) throw new UsageError(`The record at ${path} should be a list of entries (or an object with "entries").`);
  return list as RecordEntry[];
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

/**
 * The ledger tenant a report or paper is anchored to: --tenant when given (it must be an id: letters, digits and . _ : / @ + -), otherwise a slug of the shop's name
 * ("Glow Salon" is glow-salon). On a server the tenant is the shop's id, which the bundle passes. A name with no Latin letters or digits gives no slug, and then the
 * paper is not anchored (its anchor is null) and the script says so.
 */
export function ledgerTenant(option: string | undefined, shopName: string): { tenant?: string } {
  if (option !== undefined) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/u.test(option)) throw new UsageError(`--tenant ${option} is not an id: use letters, digits and . _ : / @ + - (the shop's id on the server, like glow-salon).`);
    return { tenant: option };
  }
  try { return { tenant: tenantOf(shopName) }; } catch { return {}; }
}
