// Shared by the tests: where the example is, a temp folder, the command line with its output captured, and the real Guard (or the reason a test did not run it).
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_GUARD_REASON, findGuard } from "../guard-binary.ts";
import { acceptTemplate, draftFromText, specFromAccept } from "../openapi-to-spec.ts";
import type { Io } from "../openapi-to-spec.ts";
import { sha256 } from "../openapi-read.ts";

export const EXAMPLE = join(import.meta.dirname!, "..", "examples", "refunds-api");
export const exampleFile = (name: string) => join(EXAMPLE, name);
export const exampleText = (name: string) => readFileSync(exampleFile(name), "utf8");
export const exampleJson = (name: string) => JSON.parse(exampleText(name));

export const tempDir = (): string => mkdtempSync(join(tmpdir(), "geo-companies-"));

/** A small API whose money travels as text: `amount` in the query of a refund (the same path as the example's, so the made-up API answers it), and in the path of a payout. */
export const textMoneyApi = (): string => JSON.stringify({
  openapi: "3.1.0", info: { title: "Text Money API", version: "1" },
  paths: {
    "/v1/refunds": { post: { operationId: "createRefund", parameters: [{ name: "amount", in: "query", required: true, schema: { type: "integer", minimum: 1 } }, { name: "charge_id", in: "query", required: true, schema: { type: "string" } }], responses: {} } },
    "/v1/payouts/{amount}": { post: { operationId: "createPayout", parameters: [{ name: "amount", in: "path", required: true, schema: { type: "integer" } }], responses: {} } },
  },
});

/** The spec a reviewer builds from that API's draft, keeping both bounds (refunds up to 50000, payouts up to 90000) and nothing else. */
export function textMoneySpec(): Record<string, any> {
  const d = draftFromText(textMoneyApi(), { tool: "refunds" });
  const sha = sha256(`${JSON.stringify(d, null, 2)}\n`);
  const a = acceptTemplate(d, sha);
  Object.assign(a, { reviewed_by: "priya.nair", tenant: "brightside" });
  a.routes.create_refund = true; a.routes.create_payout = true;
  Object.assign(a.suggestions["create_refund-amount-bound"], { keep: true, min: "1", max: "50000" });
  Object.assign(a.suggestions["create_payout-amount-bound"], { keep: true, min: "1", max: "90000" });
  return specFromAccept(d, a, sha).spec;
}

/** The command line's output, kept for the test to read. */
export function captureIo(): Io & { out_: string[]; err_: string[]; text(): string } {
  const out_: string[] = [], err_: string[] = [];
  return { out: (l) => out_.push(l), err: (l) => err_.push(l), out_, err_, text: () => [...out_, ...err_].join("\n") };
}

export const GUARD = findGuard();
/** Passed to `test(..., { skip })`: a test that needs the real geo-guard says why it did not run. */
export const skipWithoutGuard: string | false = GUARD ? false : NO_GUARD_REASON;

/** An API whose refund takes its amount as a JSON string (`"amount": "500"`): the case the draft once said nothing about. */
export const stringBodyApi = (): string => JSON.stringify({
  openapi: "3.1.0", info: { title: "String Body API", version: "1" },
  paths: {
    "/v1/refunds": { post: { operationId: "createRefund", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["charge_id", "customer_id", "amount"], properties: { charge_id: { type: "string" }, customer_id: { type: "string" }, amount: { type: "string", pattern: "^[0-9]+$" } } } } } }, responses: {} } },
  },
});

/** An API whose refund names the customer in the body: what a limit's `scope` can count by. */
export const customerApi = (): string => JSON.stringify({
  openapi: "3.1.0", info: { title: "Customer API", version: "1" },
  paths: {
    "/v1/refunds": { post: { operationId: "createRefund", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["charge_id", "customer_id", "amount"], properties: { charge_id: { type: "string" }, customer_id: { type: "string" }, amount: { type: "integer", minimum: 1 } } } } } }, responses: {} } },
  },
});

/** The spec a reviewer builds from the draft of `api`, keeping the amount bound (1 to 50000) and the extra suggestions given (id -> what to fill in). */
export function specWith(api: string, extra: Record<string, Record<string, unknown>> = {}): Record<string, any> {
  const d = draftFromText(api, { tool: "refunds" });
  const sha = sha256(`${JSON.stringify(d, null, 2)}\n`);
  const a = acceptTemplate(d, sha);
  Object.assign(a, { reviewed_by: "priya.nair", tenant: "brightside" });
  a.routes.create_refund = true;
  Object.assign(a.suggestions["create_refund-amount-bound"], { keep: true, min: "1", max: "50000" });
  for (const [id, fill] of Object.entries(extra)) Object.assign(a.suggestions[id], { keep: true, ...fill });
  return specFromAccept(d, a, sha).spec;
}
