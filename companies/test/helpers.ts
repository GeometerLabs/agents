// Shared by the tests: where the example is, a temp folder, the command line with its output captured, and the real Guard (or the reason a test did not run it).
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_GUARD_REASON, findGuard } from "../guard-binary.ts";
import type { Io } from "../openapi-to-spec.ts";

export const EXAMPLE = join(import.meta.dirname!, "..", "examples", "refunds-api");
export const exampleFile = (name: string) => join(EXAMPLE, name);
export const exampleText = (name: string) => readFileSync(exampleFile(name), "utf8");
export const exampleJson = (name: string) => JSON.parse(exampleText(name));

export const tempDir = (): string => mkdtempSync(join(tmpdir(), "geo-companies-"));

/** The command line's output, kept for the test to read. */
export function captureIo(): Io & { out_: string[]; err_: string[]; text(): string } {
  const out_: string[] = [], err_: string[] = [];
  return { out: (l) => out_.push(l), err: (l) => err_.push(l), out_, err_, text: () => [...out_, ...err_].join("\n") };
}

export const GUARD = findGuard();
/** Passed to `test(..., { skip })`: a test that needs the real geo-guard says why it did not run. */
export const skipWithoutGuard: string | false = GUARD ? false : NO_GUARD_REASON;
