// From an OpenAPI file to a Guard limits spec, with a person in the middle.
//
//   node companies/openapi-to-spec.ts draft <openapi.json> --out draft.json
//        Reads the API and writes a DRAFT: every call it finds, and suggested rules and limits for the calls that look consequential, each with a
//        "review" note and blanks (numbers, thresholds) that only you can fill. A draft is not a Guard spec and Guard cannot load it. It also writes
//        accept.template.json: the same suggestions, all switched off, with the blanks empty.
//   node companies/openapi-to-spec.ts build --draft draft.json --accept accept.json --out spec.json
//        Writes a Guard limits spec from the parts you kept in your accept file, then compiles it with the real `geo-guard compile` and checks the
//        result with `geo-guard verify-bundle`. With no accept file, or with a blank left in a part you kept, it writes nothing.
//
// Zero dependencies. JSON only (a YAML parser is more code than this should carry). The format Guard reads is monorepo/docs/guard-limits-spec.md.
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compileSpec, findGuard, NO_GUARD_REASON, verifyBundle } from "./guard-binary.ts";
import type { CompileSummary } from "./guard-binary.ts";
import { guardToml } from "./guard-config.ts";
import { UnreadableFile, parseOpenApi, readOpenApi, sha256, snake, words } from "./openapi-read.ts";
import type { ApiOperation, ApiRead, Field } from "./openapi-read.ts";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = Record<string, any>;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface Fill { name: string; required: boolean; help: string; default?: Json }
export type SuggestionKind = "argument_bound" | "call_bound_approval" | "at_most_once_effect" | "forbidden_call" | "spend" | "count";
export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  operation: string;
  /** The call field this is about: the bounded field, the approval's amount, the spend limit's amount. */
  field?: string;
  /** For `at_most_once_effect`: the API's idempotency header, if the call declares one. */
  idempotency_header?: string;
  review: string;
  fill: Fill[];
}
export interface DraftRoute {
  operation: string;
  method: string;
  path: string;
  operation_id?: string;
  summary?: string;
  /** What the call carries, by the names a Guard rule would use. */
  fields: { name: string; in: string; type: string; required: boolean; nested: boolean }[];
  consequential: boolean;
  why: string;
  review: string;
}
export interface Draft {
  draft: 1;
  status: string;
  source: { openapi: string; title: string; api_version: string; base_path: string; file_sha256: string };
  tool: string;
  routes: DraftRoute[];
  suggestions: Suggestion[];
  skipped: { where: string; why: string }[];
}

const DRAFT_STATUS = "A DRAFT for a person to review. It is not a Guard limits spec and Guard cannot load it. Nothing in it is in force until you keep parts of it in an accept file and build.";

// Words that make a number a sum of money, and words that make a number something else.
const MONEY = new Set(["amount", "price", "total", "sum", "fee", "cost", "cents", "paise", "balance", "credit", "debit", "payout", "refund", "charge", "tip", "discount", "subtotal", "budget", "deposit", "withdrawal"]);
const NOT_MONEY = new Set(["count", "quantity", "qty", "limit", "offset", "page", "size", "days", "hours", "minutes", "seconds", "index", "number", "percent", "pct", "rate", "ratio", "version", "id"]);
// Words in an operation's name or path that make a call consequential, and the ones that make it destructive.
const CONSEQUENTIAL = new Set(["refund", "charge", "transfer", "delete", "cancel", "payout", "payment", "withdraw", "void", "capture", "debit", "credit", "remove", "terminate", "close"]);
const DESTRUCTIVE = new Set(["delete", "remove", "transfer", "payout", "withdraw", "terminate"]);

const tokens = (s: string) => snake(s).split("_").filter(Boolean);
const isMoneyName = (name: string): boolean => {
  const t = tokens(name).map((w) => (MONEY.has(w) || !w.endsWith("s") ? w : w.slice(0, -1)));
  return t.some((w) => MONEY.has(w)) && !t.some((w) => NOT_MONEY.has(w));
};
const isIdName = (name: string): boolean => ["id", "ref", "reference", "key", "uuid"].includes(tokens(name).at(-1) ?? "");
const literalWords = (path: string) => path.split("/").filter((s) => s && !s.startsWith("{")).flatMap(words);

function moneyFields(op: ApiOperation): Field[] {
  return op.fields.filter((f) => f.numeric && f.in !== "path" && isMoneyName(f.name));
}

/** The one money field a hold or a spend limit can read: a top-level one, preferring `amount`. A nested one can be bounded but not held or counted. */
function primaryMoney(fields: Field[]): Field | undefined {
  const top = fields.filter((f) => !f.nested);
  return top.find((f) => f.name === "amount") ?? top[0];
}

function guessKeyFields(op: ApiOperation): { fields: string[]; basis: string } {
  const callable = op.fields.filter((f) => !f.nested);
  const byIdempotency = callable.filter((f) => f.in !== "path" && /idempot/iu.test(f.name));
  if (byIdempotency.length > 0) return { fields: byIdempotency.map((f) => f.name), basis: "an idempotency field the call carries" };
  const ids = callable.filter((f) => isIdName(f.name));
  const required = ids.filter((f) => f.required);
  const chosen = required.length > 0 ? required : ids;
  const where = [...new Set(chosen.map((f) => f.in))].map((w) => (w === "body" ? "body" : w === "path" ? "path" : "query")).join(" and ");
  return { fields: chosen.map((f) => f.name), basis: chosen.length > 0 ? `the ${where} field${chosen.length > 1 ? "s" : ""} that look like ids` : "" };
}

const q = (names: string[]) => names.map((n) => `"${n}"`).join(", ");

function suggestionsFor(op: ApiOperation, destructive: boolean): Suggestion[] {
  const out: Suggestion[] = [];
  const money = moneyFields(op);
  const main = primaryMoney(money);
  const name = op.operation;

  for (const f of money) {
    const apiLimits = [f.minimum !== undefined ? `minimum ${f.minimum}` : "", f.maximum !== undefined ? `maximum ${f.maximum}` : ""].filter(Boolean).join(", ");
    out.push({
      id: `${name}-${f.name.replaceAll(".", "-")}-bound`, kind: "argument_bound", operation: name, field: f.name,
      review: `Refuses a ${name} call whose "${f.name}" is outside min..max, before it is sent. Fill in the highest amount ONE call may move, in the API's own units (cents, paise, whole currency: check its docs). Fill in min as well: 0 or 1 keeps zero and negative amounts out.${apiLimits ? ` The API's own schema says ${apiLimits}; that is the API's limit, not yours.` : ""}${f.nested ? ` "${f.name}" sits inside an object in the body. Guard can bound it, but cannot hold a call on it or count it in a limit.` : ""} A call with no "${f.name}" is refused, never passed.`,
      fill: [
        { name: "min", required: true, help: "The lowest amount one call may carry, as a string, for example \"1\"." },
        { name: "max", required: true, help: "The highest amount one call may carry, as a string, for example \"50000\"." },
        { name: "unit", required: false, help: "A word for the record, for example \"cents\"." },
      ],
    });
  }
  if (main) {
    out.push({
      id: `${name}-needs-approval`, kind: "call_bound_approval", operation: name, field: main.name,
      review: `Holds a ${name} call whose "${main.name}" is above the threshold, until a named person approves THAT exact call. The agent sends the identical call again after the approval. Fill in the threshold. It must be below the bound's max, or no call can ever be held.`,
      fill: [
        { name: "threshold", required: true, help: "Amounts above this wait for a person, as a string, for example \"10000\"." },
        { name: "unit", required: false, help: "A word for the record, for example \"cents\"." },
      ],
    });
  }

  const key = guessKeyFields(op);
  const header = op.idempotencyHeaders[0];
  const partial = main && !key.fields.some((k) => isMoneyName(k));
  out.push({
    id: `${name}-once`, kind: "at_most_once_effect", operation: name, ...(header ? { idempotency_header: header } : {}),
    review: [
      `Money moves, or the action happens, at most once for the same action. "The same action" is decided by the fields in key_fields.`,
      key.fields.length > 0 ? `Guessed from ${key.basis}: ${q(key.fields)}. Check the guess against how your API names things.` : `No field looked like an id for this call, so nothing is guessed: fill in key_fields.`,
      partial ? `Two different ${name} calls with the same key fields count as the same action, and the second is refused (409). If several partial amounts against one id are normal, choose fields that tell them apart.` : "",
      header ? `The call declares the ${header} header, so Guard sends its own key in it and replaces any key the agent sent.` : `No idempotency header is declared for this call, so Guard cannot ask the API to ignore a repeat.`,
      `If a reply is lost, Guard does not send the call again: it holds it for a person, who checks with the API whether it happened. Guard repeats an uncertain call by itself only when the spec says the API keeps its keys (retry_safe), and this draft never says that.`,
    ].filter(Boolean).join(" "),
    fill: [{ name: "key_fields", required: true, help: "The call's fields that make two calls 'the same action' (path, query or top-level body names).", ...(key.fields.length > 0 ? { default: key.fields } : {}) }],
  });

  if (destructive) {
    out.push({
      id: `${name}-forbidden`, kind: "forbidden_call", operation: name,
      review: `Always refused, whatever the call says. Keep this if your agent should never make this call. Keep the route as well, so the refusal names this rule; a route you leave out is refused as "unlisted" instead.`,
      fill: [],
    });
  }

  if (main) {
    out.push({
      id: `${name}-spend-per-day`, kind: "spend", operation: name, field: main.name,
      review: `Caps the total "${main.name}" that ${name} calls may move in a window (a day by default). A call that would take the total over the cap is refused before it is sent. Days start at midnight UTC (05:30 in India). It counts only calls that go through this Guard. Fill in the cap.`,
      fill: [
        { name: "cap", required: true, help: "The most that may be moved in one window, as a string, for example \"200000\"." },
        { name: "window_seconds", required: false, help: "The window in seconds. 86400 is a day.", default: 86400 },
        { name: "scope", required: false, help: "Field names that get a counter each, for example [\"customer_id\"]. Empty: one counter for everything.", default: [] },
      ],
    });
  }
  out.push({
    id: `${name}-count-per-day`, kind: "count", operation: name,
    review: `Caps how many ${name} calls may go through in a window (a day by default). The cap is a whole number. It counts only calls that go through this Guard. Fill in the cap.`,
    fill: [
      { name: "cap", required: true, help: "The most calls in one window, as a whole number, for example 100." },
      { name: "window_seconds", required: false, help: "The window in seconds. 86400 is a day.", default: 86400 },
      { name: "scope", required: false, help: "Field names that get a counter each, for example [\"customer_id\"]. Empty: one counter for everything.", default: [] },
    ],
  });
  return out;
}

function classify(op: ApiOperation): { consequential: boolean; destructive: boolean; why: string } {
  if (op.method === "GET") return { consequential: false, destructive: false, why: "a read" };
  const money = moneyFields(op).map((f) => f.name);
  const named = [...new Set([...words(op.operationId ?? ""), ...words(op.operation), ...literalWords(op.path)].filter((w) => CONSEQUENTIAL.has(w)))];
  const reasons = [
    op.method === "DELETE" ? "it removes something" : "",
    money.length > 0 ? `it carries a money field (${money.join(", ")})` : "",
    named.length > 0 ? `its name says ${named.join(", ")}` : "",
  ].filter(Boolean);
  const destructive = op.method === "DELETE" || named.some((w) => DESTRUCTIVE.has(w));
  return reasons.length > 0 ? { consequential: true, destructive, why: `${op.method}: ${reasons.join("; ")}` } : { consequential: false, destructive: false, why: `${op.method}, but nothing in it looked like money or a destructive action` };
}

export function makeDraft(read: ApiRead, o: { tool: string; fileSha256: string }): Draft {
  const routes: DraftRoute[] = [];
  const suggestions: Suggestion[] = [];
  for (const op of read.operations) {
    const c = classify(op);
    const review = c.consequential
      ? `Looks consequential: ${c.why}. Keep the route if the agent must make this call, then look at the suggestions for it. A route you leave out is refused as unlisted.${op.notes.length > 0 ? ` Could not read: ${op.notes.join("; ")}.` : ""}`
      : op.method === "GET"
        ? `A read. Keep the route if the agent needs to look this up; reads get no rules unless you add them by hand.${op.notes.length > 0 ? ` Could not read: ${op.notes.join("; ")}.` : ""}`
        : `Changes something, but ${c.why}. Read it yourself before keeping it: a kept route with no rule is let through as it is.${op.notes.length > 0 ? ` Could not read: ${op.notes.join("; ")}.` : ""}`;
    routes.push({
      operation: op.operation, method: op.method, path: op.path, ...(op.operationId ? { operation_id: op.operationId } : {}), ...(op.summary ? { summary: op.summary } : {}),
      fields: op.fields.map((f) => ({ name: f.name, in: f.in, type: f.type, required: f.required, nested: f.nested })),
      consequential: c.consequential, why: c.why, review,
    });
    if (c.consequential) suggestions.push(...suggestionsFor(op, c.destructive));
  }
  return { draft: 1, status: DRAFT_STATUS, source: { openapi: read.openapi, title: read.title, api_version: read.apiVersion, base_path: read.basePath, file_sha256: o.fileSha256 }, tool: o.tool, routes, suggestions, skipped: read.skipped };
}

export function draftFromText(text: string, o: { tool?: string; basePath?: string } = {}): Draft {
  const doc = parseOpenApi(text);
  const read = readOpenApi(doc, o.basePath !== undefined ? { basePath: o.basePath } : {});
  const tool = o.tool ?? (read.title.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "api");
  if (!ID.test(tool)) throw new UsageError(`The tool name ${JSON.stringify(tool)} is not a Guard id (letters, digits and . _ : / @ + -, starting with a letter or digit). Pass --tool.`);
  return makeDraft(read, { tool, fileSha256: sha256(text) });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The accept file
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** Every suggestion switched off, every blank empty, the review notes beside them. The reviewer saves a filled copy under another name and builds from that. */
export function acceptTemplate(draft: Draft, draftSha256: string): Obj {
  const suggestions: Obj = {};
  for (const s of draft.suggestions) {
    suggestions[s.id] = { _review: s.review, keep: false };
    for (const f of s.fill) suggestions[s.id][f.name] = f.default ?? null;
  }
  return {
    accept: 1,
    _help: "Copy this file to accept.json and fill it in. Set \"keep\": true on a suggestion to keep it, and fill every blank (null) in the ones you keep. Set a route to true to list it. Anything left false is dropped. Fields that start with _ are notes and are ignored.",
    draft_sha256: draftSha256,
    reviewed_by: null,
    tenant: null,
    name: null,
    version: 1,
    approval_ttl_seconds: 3600,
    routes: Object.fromEntries(draft.routes.map((r) => [r.operation, false])),
    _routes: Object.fromEntries(draft.routes.map((r) => [r.operation, `${r.method} ${r.path}${r.consequential ? " (consequential)" : ""}`])),
    suggestions,
  };
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/u;
const AMOUNT = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/u;
const COUNT = /^[1-9][0-9]*$/u;

/** An exact decimal in millionths, so two amounts can be compared without rounding. */
function micro(s: string): bigint {
  const neg = s.startsWith("-");
  const [whole, frac = ""] = (neg ? s.slice(1) : s).split(".");
  const v = BigInt(whole!) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
  return neg ? -v : v;
}

export class UsageError extends Error {}
/** The accept file cannot be turned into a spec. `problems` is every reason, each a sentence. */
export class Refusal extends Error {
  problems: string[];
  constructor(problems: string[]) { super(problems.join("\n")); this.problems = problems; }
}

const present = (v: unknown) => v !== undefined && v !== null && v !== "";

export interface Built {
  spec: Obj;
  kept: { routes: string[]; rules: string[]; limits: string[] };
  warnings: string[];
}

/** Turn what the reviewer kept into a Guard limits spec (schema 1). Every problem is collected, and nothing is built if there is one. */
export function specFromAccept(draft: Draft, accept: unknown, draftSha256: string): Built {
  const problems: string[] = [];
  const warnings: string[] = [];
  const bad = (m: string) => { problems.push(m); };
  if (!accept || typeof accept !== "object" || Array.isArray(accept)) throw new Refusal(["The accept file is not a JSON object."]);
  const a = accept as Obj;
  if (a.accept !== 1) bad('The accept file must say "accept": 1.');
  if (a.draft_sha256 !== draftSha256) bad(`The accept file was made for a different draft (it names ${String(a.draft_sha256)}, this draft is ${draftSha256}). The API file changed since: read the new draft, then make a new accept file.`);
  const known = new Set(["accept", "draft_sha256", "reviewed_by", "tenant", "name", "version", "approval_ttl_seconds", "routes", "suggestions"]);
  for (const k of Object.keys(a)) if (!known.has(k) && !k.startsWith("_")) bad(`The accept file has a field this tool does not know: "${k}".`);

  const idField = (k: string, v: unknown, why: string) => { if (typeof v !== "string" || !ID.test(v)) bad(`"${k}" is ${present(v) ? JSON.stringify(v) : "empty"}: ${why}`); };
  if (!present(a.reviewed_by)) bad('"reviewed_by" is empty. Put the name of the person who reviewed these numbers; this tool will not choose one for you. Guard records the reviews under that name.');
  else idField("reviewed_by", a.reviewed_by, "it must be letters, digits and . _ : / @ + -.");
  if (!present(a.tenant)) bad('"tenant" is empty. It names your company or environment, and must match "tenant" in guard.toml.');
  else idField("tenant", a.tenant, "it must be letters, digits and . _ : / @ + -.");
  const name = present(a.name) ? a.name : `${a.tenant}-${draft.tool}`;
  if (present(a.name)) idField("name", a.name, "it must be letters, digits and . _ : / @ + -.");
  const version = a.version ?? 1;
  if (!Number.isInteger(version) || version < 1) bad('"version" must be a whole number, 1 or more. Raise it on every change.');
  if (a.approval_ttl_seconds !== undefined && (!Number.isInteger(a.approval_ttl_seconds) || a.approval_ttl_seconds < 60 || a.approval_ttl_seconds > 604_800)) bad('"approval_ttl_seconds" must be a whole number from 60 to 604800 (how long a held call waits for a person).');

  // routes
  const routeByName = new Map(draft.routes.map((r) => [r.operation, r]));
  const keptRoutes = new Set<string>();
  if (!a.routes || typeof a.routes !== "object" || Array.isArray(a.routes)) bad('"routes" must be an object of operation name to true or false.');
  else {
    for (const [k, v] of Object.entries(a.routes as Obj)) {
      if (!routeByName.has(k)) { bad(`"routes" names ${JSON.stringify(k)}, which is not in the draft.`); continue; }
      if (typeof v !== "boolean") { bad(`The route ${k} must be true or false.`); continue; }
      if (v) keptRoutes.add(k);
    }
  }
  if (keptRoutes.size === 0) bad("No route is kept. Set the calls the agent may make to true under \"routes\".");

  // suggestions
  const byId = new Map(draft.suggestions.map((s) => [s.id, s]));
  const kept: { s: Suggestion; v: Obj }[] = [];
  if (!a.suggestions || typeof a.suggestions !== "object" || Array.isArray(a.suggestions)) bad('"suggestions" must be an object of suggestion id to its choices.');
  else {
    for (const [id, raw] of Object.entries(a.suggestions as Obj)) {
      const s = byId.get(id);
      if (!s) { bad(`"suggestions" names ${JSON.stringify(id)}, which is not in the draft.`); continue; }
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof (raw as Obj).keep !== "boolean") { bad(`${id}: it must be an object with "keep": true or false.`); continue; }
      const v = raw as Obj;
      const allowed = new Set(["keep", ...s.fill.map((f) => f.name)]);
      for (const k of Object.keys(v)) if (!allowed.has(k) && !k.startsWith("_")) bad(`${id}: "${k}" is not one of its choices (${[...allowed].join(", ")}).`);
    }
    // in the draft's order, whatever order the accept file lists them in
    for (const s of draft.suggestions) { const v = (a.suggestions as Obj)[s.id]; if (v && typeof v === "object" && v.keep === true) kept.push({ s, v }); }
  }

  const route = (op: string) => routeByName.get(op)!;
  const fieldNames = (op: string, topOnly: boolean) => new Set(route(op).fields.filter((f) => !topOnly || !f.nested).map((f) => f.name));
  const rules: Obj[] = [];
  const limits: Obj[] = [];
  const intents: Obj[] = [];
  const keptIds = { rules: [] as string[], limits: [] as string[] };
  const maxOf = new Map<string, bigint>(); // operation|field -> the bound's max, to check the threshold against
  const thresholds: { id: string; key: string; value: bigint }[] = [];
  const unitOf = (id: string, field: string, v: Obj) => (present(v.unit) ? (typeof v.unit === "string" && v.unit.length <= 40 && !/[\u0000-\u001f]/u.test(v.unit) ? { units: { [field]: v.unit } } : (bad(`${id}: "unit" must be a short word.`), {})) : {});

  for (const { s, v } of kept) {
    if (!keptRoutes.has(s.operation)) { bad(`${s.id} is kept, but the route ${s.operation} is not. A rule on a call nobody can make protects nothing: keep the route or drop the rule.`); continue; }
    const need = (f: Fill) => { if (f.required && !present(v[f.name])) bad(`${s.id}: "${f.name}" is blank. ${f.help}`); return v[f.name]; };
    const amount = (f: string, label = f): string | undefined => {
      const raw = need(s.fill.find((x) => x.name === f)!);
      if (!present(raw)) return undefined;
      const text = typeof raw === "number" && Number.isSafeInteger(raw) ? String(raw) : raw;
      if (typeof text !== "string" || !AMOUNT.test(text)) { bad(`${s.id}: "${label}" is ${JSON.stringify(raw)}. Write an amount as a string of digits with an optional decimal point, for example "50000" or "12.50" (no exponent, no commas, at most six decimal places).`); return undefined; }
      return text;
    };
    if (s.kind === "argument_bound") {
      const min = amount("min"), max = amount("max");
      if (min !== undefined && max !== undefined && micro(min) > micro(max)) bad(`${s.id}: min ${min} is above max ${max}.`);
      if (max !== undefined) maxOf.set(`${s.operation}|${s.field}`, micro(max));
      rules.push({ id: s.id, kind: "argument_bound", operation: s.operation, field: s.field, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...unitOf(s.id, s.field!, v) });
      keptIds.rules.push(s.id);
    } else if (s.kind === "call_bound_approval") {
      const threshold = amount("threshold");
      if (threshold !== undefined) thresholds.push({ id: s.id, key: `${s.operation}|${s.field}`, value: micro(threshold) });
      rules.push({ id: s.id, kind: "call_bound_approval", operation: s.operation, amount_field: s.field, ...(threshold !== undefined ? { threshold } : {}), ...unitOf(s.id, s.field!, v) });
      keptIds.rules.push(s.id);
    } else if (s.kind === "at_most_once_effect") {
      const raw = need(s.fill[0]!);
      const names = fieldNames(s.operation, true);
      if (present(raw)) {
        if (!Array.isArray(raw) || raw.length === 0 || raw.some((k) => typeof k !== "string")) bad(`${s.id}: "key_fields" must be a list of field names.`);
        else {
          const missing = (raw as string[]).filter((k) => !names.has(k));
          if (missing.length > 0) bad(`${s.id}: key_fields names ${missing.map((m) => JSON.stringify(m)).join(", ")}, which ${route(s.operation).operation} does not carry. It carries: ${[...names].join(", ") || "nothing a rule can read"}.`);
          else intents.push({ operation: s.operation, key_fields: raw, ...(s.idempotency_header ? { idempotency_header: s.idempotency_header, derive_key: true } : {}) });
        }
      }
      rules.push({ id: s.id, kind: "at_most_once_effect", operation: s.operation });
      keptIds.rules.push(s.id);
    } else if (s.kind === "forbidden_call") {
      rules.push({ id: s.id, kind: "forbidden_call", operation: s.operation });
      keptIds.rules.push(s.id);
    } else {
      const cap = need(s.fill.find((x) => x.name === "cap")!);
      let capText: string | undefined;
      if (present(cap)) {
        const t = typeof cap === "number" && Number.isSafeInteger(cap) ? String(cap) : cap;
        if (s.kind === "count" && !(typeof t === "string" && COUNT.test(t))) bad(`${s.id}: "cap" is ${JSON.stringify(cap)}. A count cap is a whole number above zero.`);
        else if (s.kind === "spend" && !(typeof t === "string" && AMOUNT.test(t) && micro(t) > 0n)) bad(`${s.id}: "cap" is ${JSON.stringify(cap)}. Write it as a string above zero, for example "200000".`);
        else capText = t as string;
      }
      const window = present(v.window_seconds) ? v.window_seconds : 86_400;
      if (!Number.isInteger(window) || window < 1 || window > 31_622_400) bad(`${s.id}: "window_seconds" must be a whole number from 1 to 31622400.`);
      const scope = present(v.scope) ? v.scope : [];
      const top = fieldNames(s.operation, true);
      if (!Array.isArray(scope) || scope.some((k) => typeof k !== "string" || !top.has(k))) bad(`${s.id}: "scope" must be a list of fields ${s.operation} carries (${[...top].join(", ") || "none"}).`);
      limits.push({ id: s.id, kind: s.kind, operation: s.operation, ...(s.kind === "spend" ? { amount_field: s.field } : {}), scope, ...(capText !== undefined ? { cap: capText } : {}), window_seconds: window });
      keptIds.limits.push(s.id);
    }
  }
  for (const t of thresholds) {
    const max = maxOf.get(t.key);
    if (max !== undefined && t.value >= max) bad(`${t.id}: the threshold is not below the bound's max for the same field. A call above the max is refused before it can be held, so no call could ever wait for a person. Lower the threshold or raise the max.`);
  }
  if (rules.length === 0) bad("No rule is kept. Guard will not run a bundle with no reviewed rule. Keep at least one suggestion (set \"keep\": true and fill its blanks).");
  for (const op of keptRoutes) {
    const r = route(op);
    if (r.consequential && !rules.some((x) => x.operation === op) && !limits.some((x) => x.operation === op)) warnings.push(`${op} (${r.method} ${r.path}) looks consequential and is kept with no rule or limit on it, so Guard lets it through as it is.`);
    if (rules.some((x) => x.operation === op && x.kind === "forbidden_call") && rules.some((x) => x.operation === op && x.kind !== "forbidden_call")) warnings.push(`${op} is forbidden and also has other rules; the other rules never matter, because every call is refused first.`);
  }
  if (problems.length > 0) throw new Refusal(problems);

  const order = { argument_bound: 0, call_bound_approval: 1, at_most_once_effect: 2, forbidden_call: 3 } as Record<string, number>;
  const spec: Obj = {
    schema: 1, tenant: a.tenant, tool: draft.tool, name, version, reviewed_by: a.reviewed_by,
    ...(a.approval_ttl_seconds !== undefined ? { approval_ttl_seconds: a.approval_ttl_seconds } : {}),
    routes: draft.routes.filter((r) => keptRoutes.has(r.operation)).map((r) => ({ method: r.method, path: r.path, operation: r.operation })),
    rules: [...rules].sort((x, y) => (order[x.kind] ?? 9) - (order[y.kind] ?? 9) || 0),
    limits, intents, fail_policy: [],
  };
  return { spec, kept: { routes: [...keptRoutes], rules: keptIds.rules, limits: keptIds.limits }, warnings };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface Io { out(line: string): void; err(line: string): void }
const stdio: Io = { out: (l) => console.log(l), err: (l) => console.error(l) };

const USAGE = `Usage:
  node companies/openapi-to-spec.ts draft <openapi.json> --out draft.json [--tool NAME] [--base-path /v1] [--accept-template accept.template.json]
  node companies/openapi-to-spec.ts build --draft draft.json --accept accept.json --out spec.json [--bundle bundle.json]
        [--guard-toml guard.toml --upstream host:443 [--listen 127.0.0.1:8080] [--agent-id NAME] [--plain-http] [--force]] [--no-compile]

  draft   reads the API and writes a DRAFT with suggested rules (not a Guard spec), plus a template for your accept file.
  build   writes a Guard limits spec from the parts you kept, compiles it with geo-guard, and verifies the result.

Exit codes: 0 done; 1 refused (the accept file, or Guard's compiler); 2 used wrongly or no accept file; 3 the spec was written but not compiled (no geo-guard found).`;

function writeAtomic(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const readText = (path: string, what: string) => {
  try { return readFileSync(path, "utf8"); } catch { throw new UsageError(`Cannot read ${what} at ${path}.`); }
};

function summaryLines(s: CompileSummary): string[] {
  const lines = [`Guard compiled it: ${s.rules} rules, ${s.limits} limits, ${s.routes} routes, digest ${s.digest}`, `Tripwires: passed ${s.tripwires.passed} of ${s.tripwires.of}.`];
  if (s.tripwires.not_self_testable_items.length > 0) {
    lines.push(`Guard cannot test these without writing (read them; they are part of what you are told was not covered):`);
    for (const i of s.tripwires.not_self_testable_items) lines.push(`  - ${i.item}: ${i.why}`);
  }
  if (s.needs_provider_coordination.length > 0) {
    lines.push(`Only the API itself can settle these:`);
    for (const i of s.needs_provider_coordination) lines.push(`  - ${i}`);
  }
  lines.push(`reviewed_by is the spec's own word; the compiler cannot know a person looked at the numbers.`);
  return lines;
}

export function main(argv: string[], io: Io = stdio): number {
  try {
    const [command, ...rest] = argv;
    if (command === "draft") return runDraft(rest, io);
    if (command === "build") return runBuild(rest, io);
    io.err(USAGE);
    return 2;
  } catch (e) {
    if (e instanceof Refusal) { io.err("Refused. Nothing was built.\n" + e.problems.map((p) => `  - ${p}`).join("\n")); return 1; }
    if (e instanceof UsageError || e instanceof UnreadableFile) { io.err(e.message); return 2; }
    throw e;
  }
}

function runDraft(args: string[], io: Io): number {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { out: { type: "string" }, tool: { type: "string" }, "base-path": { type: "string" }, "accept-template": { type: "string" } } });
  if (positionals.length !== 1 || !values.out) { io.err(USAGE); return 2; }
  const text = readText(positionals[0]!, "the OpenAPI file");
  const draft = draftFromText(text, { ...(values.tool ? { tool: values.tool } : {}), ...(values["base-path"] !== undefined ? { basePath: values["base-path"] } : {}) });
  const draftText = json(draft);
  const out = resolve(values.out);
  const template = resolve(values["accept-template"] ?? join(dirname(out), "accept.template.json"));
  writeAtomic(out, draftText);
  writeAtomic(template, json(acceptTemplate(draft, sha256(draftText))));
  const consequential = draft.routes.filter((r) => r.consequential);
  io.out(`Read ${draft.source.title || positionals[0]} (OpenAPI ${draft.source.openapi}): ${draft.routes.length} calls, ${consequential.length} look consequential, ${draft.suggestions.length} suggestions, ${draft.skipped.length} skipped.`);
  io.out(`Wrote the draft:  ${out}`);
  io.out(`Wrote the accept template:  ${template}`);
  for (const s of draft.skipped) io.out(`  skipped ${s.where}: ${s.why}`);
  io.out(`This is a DRAFT. Read every "review" note. Then copy the template to accept.json, switch on what you keep, fill the blanks, and run build.`);
  return 0;
}

function runBuild(args: string[], io: Io): number {
  const { values } = parseArgs({ args, options: { draft: { type: "string" }, accept: { type: "string" }, out: { type: "string" }, bundle: { type: "string" }, "guard-toml": { type: "string" }, upstream: { type: "string" }, "plain-http": { type: "boolean" }, listen: { type: "string" }, "agent-id": { type: "string" }, force: { type: "boolean" }, "no-compile": { type: "boolean" } } });
  if (!values.accept) {
    io.err("Refused: no --accept file. This tool writes a spec only from a file in which you list what you kept.\nRun `draft` to get accept.template.json, fill it in, and pass it as --accept.");
    return 2;
  }
  if (!values.draft || !values.out) { io.err(USAGE); return 2; }
  const draftText = readText(values.draft, "the draft");
  const acceptText = readText(values.accept, "the accept file");
  let draft: Draft, accept: unknown;
  try { draft = JSON.parse(draftText) as Draft; } catch { throw new UsageError(`${values.draft} is not JSON.`); }
  if (draft.draft !== 1) throw new UsageError(`${values.draft} is not a draft this tool wrote.`);
  try { accept = JSON.parse(acceptText); } catch { throw new UsageError(`${values.accept} is not JSON.`); }

  const built = specFromAccept(draft, accept, sha256(draftText));
  const out = resolve(values.out);
  writeAtomic(out, json(built.spec));
  io.out(`Kept ${built.kept.routes.length} routes, ${built.kept.rules.length} rules, ${built.kept.limits.length} limits.`);
  for (const w of built.warnings) io.out(`Warning: ${w}`);
  io.out(`Wrote the spec:  ${out}`);
  if (values["no-compile"]) { io.out("Not compiled (--no-compile)."); return 0; }

  const bin = findGuard();
  if (!bin) { io.err(`The spec was written but NOT compiled or checked: ${NO_GUARD_REASON}. Run \`geo-guard compile --spec ${out} --out bundle.json\` where Guard is installed.`); return 3; }
  const bundle = resolve(values.bundle ?? join(dirname(out), "bundle.json"));
  const c = compileSpec(bin, out, bundle);
  if (!c.ok) { io.err("Guard's compiler refused the spec:\n" + c.problems.map((p) => `  ${p}`).join("\n")); return 1; }
  for (const l of summaryLines(c.summary)) io.out(l);
  io.out(`Wrote the bundle:  ${bundle}`);

  let config: string | undefined;
  if (values["guard-toml"]) {
    if (!values.upstream) throw new UsageError("--guard-toml needs --upstream host:port (where the API is, for example api.example.com:443).");
    config = resolve(values["guard-toml"]);
    if (existsSync(config) && !values.force) throw new UsageError(`${config} exists; it may hold your real credentials' hashes. Not overwritten (use --force to replace it).`);
    const approvalOperations = [...new Set((built.spec.rules as Obj[]).filter((r) => r.kind === "call_bound_approval").map((r) => r.operation as string))];
    writeAtomic(config, guardToml({ tenant: built.spec.tenant, tool: built.spec.tool, deployment: built.spec.name, upstream: values.upstream, tls: !values["plain-http"], bundleDigest: c.summary.digest, agents: [{ id: values["agent-id"] ?? "agent", sha256: "0".repeat(64) }], approvalOperations, ...(values.listen ? { paths: { listen: values.listen } } : {}) }));
    io.out(`Wrote a starter guard.toml:  ${config}  (credential hashes are all zeros: put real ones in, see README)`);
  }
  const v = verifyBundle(bin, bundle, config);
  if (!v.ok) { io.err("verify-bundle refused:\n" + v.problems.map((p) => `  ${p}`).join("\n")); return 1; }
  io.out(`verify-bundle: ${v.lines[0] ?? "ok"}${config ? " (checked against guard.toml)" : " (no guard.toml given, so tenant and tool were not compared)"}`);
  io.out(`Put this digest in guard.toml as bundle_digest: ${c.summary.digest}`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
