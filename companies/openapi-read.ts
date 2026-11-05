// Reading an OpenAPI 3.x file (JSON) into the plain facts the limits draft needs: each call the API offers (method, path), the names of what a call carries
// (path parameters, query parameters, top-level body fields, and numeric fields nested in a body), and the idempotency header if one is declared.
//
// It follows `$ref`s that point inside the same file and refuses to follow any other. Where it cannot read something it says so in `skipped` or in an
// operation's `notes`; it never guesses. JSON only: YAML is a bigger parser than a limits tool should carry.
import { createHash } from "node:crypto";

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Method = (typeof METHODS)[number];

export interface Field {
  /** What a Guard rule would call it. Nested body fields have a dotted name (`amount.value`). */
  name: string;
  in: "path" | "query" | "body";
  type: string;
  required: boolean;
  /** Written as a plain number in JSON, so an `argument_bound` can read it. */
  numeric: boolean;
  /** A field inside an object inside the body. Only `argument_bound` can follow a dotted name. */
  nested: boolean;
  /** The API's own `minimum` and `maximum`, shown to the reviewer as a hint. They are the API's limits, not yours. */
  minimum?: number;
  maximum?: number;
}

export interface ApiOperation {
  /** The name Guard uses in rules and records: lower-case letters, digits and `_`. */
  operation: string;
  operationId?: string;
  method: Method;
  path: string;
  summary?: string;
  fields: Field[];
  /** Header parameters the call declares whose name says idempotency. */
  idempotencyHeaders: string[];
  /** Things this tool could not read about the call, in words. */
  notes: string[];
}

export interface Skipped { where: string; why: string }

export interface ApiRead {
  openapi: string;
  title: string;
  apiVersion: string;
  basePath: string;
  operations: ApiOperation[];
  skipped: Skipped[];
}

/** A file this tool cannot read at all, said so the person running it can act. */
export class UnreadableFile extends Error {}

export const sha256 = (data: string | Uint8Array): string => `sha256:${createHash("sha256").update(data).digest("hex")}`;

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Turn the file's text into a document, or say plainly why not. */
export function parseOpenApi(text: string): Obj {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    if (/^\s*(openapi|swagger)\s*:/mu.test(text) || /^---\s*$/mu.test(text)) {
      throw new UnreadableFile("This looks like YAML. This tool reads JSON only (a YAML parser is more code than a limits tool should carry). Convert the file first with a converter you trust, then run this again on the .json.");
    }
    throw new UnreadableFile("This is not JSON, so it is not an OpenAPI file this tool can read.");
  }
  if (!isObj(doc)) throw new UnreadableFile("The file is JSON but not an OpenAPI document (it is not an object).");
  if (typeof doc.swagger === "string") throw new UnreadableFile(`This is a Swagger ${doc.swagger} file. This tool reads OpenAPI 3.x; convert it to 3 first.`);
  if (typeof doc.openapi !== "string" || !doc.openapi.startsWith("3.")) throw new UnreadableFile(`Not an OpenAPI 3.x file (its "openapi" field is ${JSON.stringify(doc.openapi)}).`);
  if (!isObj(doc.paths)) throw new UnreadableFile('The file has no "paths", so there are no calls to list.');
  return doc;
}

const decodePointer = (s: string) => decodeURIComponent(s).replaceAll("~1", "/").replaceAll("~0", "~");

/** `deref` follows `$ref` inside the same file. It returns undefined, and remembers why, when it cannot. */
function resolver(doc: Obj, problems: Set<string>) {
  return (node: any): any => {
    const seen = new Set<string>();
    while (isObj(node) && typeof node.$ref === "string") {
      const ref: string = node.$ref;
      if (!ref.startsWith("#/")) { problems.add(`a reference to ${ref} is not followed (this tool reads one file)`); return undefined; }
      if (seen.has(ref)) { problems.add(`a reference loops at ${ref}`); return undefined; }
      seen.add(ref);
      let at: any = doc;
      for (const part of ref.slice(2).split("/")) at = isObj(at) || Array.isArray(at) ? at[decodePointer(part)] : undefined;
      if (at === undefined) { problems.add(`${ref} points at nothing`); return undefined; }
      node = at;
    }
    return node;
  };
}

const typeOf = (s: Obj): string => {
  const t = Array.isArray(s.type) ? s.type.find((x: unknown) => x !== "null") : s.type;
  if (typeof t === "string") return t;
  return isObj(s.properties) ? "object" : "unknown";
};

/** `createRefund` -> `create_refund`. Guard wants lower-case letters, digits and `_`, starting with a letter. */
export function snake(s: string): string {
  const out = s.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").replace(/([A-Z]+)([A-Z][a-z])/gu, "$1_$2").replace(/[^A-Za-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "").toLowerCase();
  return /^[a-z]/u.test(out) ? out : out === "" ? "" : `op_${out}`;
}

/** Words in a name, lower case and singular: `createRefunds` -> create, refund. For matching words like refund or delete without matching `discharge`. */
export function words(s: string): string[] {
  return snake(s).split("_").filter(Boolean).map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/** The path Guard would list. Guard's routes allow `{name}` or `{name}suffix` in a segment, no trailing slash, no `.` or `..`. Returns why not when it cannot. */
function guardPath(path: string): { path: string } | { why: string } {
  if (!path.startsWith("/")) return { why: "the path does not start with /" };
  if (path.includes("?") || path.includes("#")) return { why: "the path has a query or fragment" };
  if (path.includes("//")) return { why: "the path has an empty segment" };
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (trimmed === "/") return { why: "the root path / is not listed (Guard's routes have no trailing slash)" };
  for (const seg of trimmed.slice(1).split("/")) {
    if (seg === "." || seg === "..") return { why: "the path has a . or .. segment" };
    if (!/^(?:[^{}]*|\{[^{}]+\}[^{}]*)$/u.test(seg)) return { why: `the segment "${seg}" is not a literal, {name} or {name}suffix (Guard cannot match a parameter in the middle of a segment)` };
  }
  return { path: trimmed };
}

/** A base path from the first server (`https://api.example.com/v2` -> `/v2`). The agent's calls will carry it, so Guard's routes must too. */
function basePathOf(doc: Obj, override: string | undefined, skipped: Skipped[]): string {
  if (override !== undefined) return override === "/" ? "" : override.replace(/\/+$/u, "");
  const server = Array.isArray(doc.servers) ? doc.servers.find(isObj) : undefined;
  if (!server || typeof server.url !== "string") return "";
  let url: string = server.url;
  for (const [name, v] of Object.entries(isObj(server.variables) ? server.variables : {})) if (isObj(v) && typeof v.default === "string") url = url.replaceAll(`{${name}}`, v.default);
  if (url.includes("{")) { skipped.push({ where: "servers", why: `the server url ${server.url} has a variable with no default, so no base path was added; pass --base-path if the API lives under one` }); return ""; }
  const m = /^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/]*(\/.*)?$/iu.exec(url);
  const p = m ? (m[1] ?? "") : url.startsWith("/") ? url : "";
  return p.replace(/\/+$/u, "");
}

/** The properties a schema offers at its top level, with `allOf` merged and `oneOf` / `anyOf` joined. `required` is what the schema (or its allOf parts) require. */
function schemaProps(schema: any, deref: (n: any) => any, path: Set<object> = new Set()): { props: Map<string, any>; required: Set<string> } {
  const out = { props: new Map<string, any>(), required: new Set<string>() };
  const s = deref(schema);
  if (!isObj(s) || path.has(s)) return out;
  const next = new Set(path).add(s);
  const merge = (part: any, takeRequired: boolean) => {
    const r = schemaProps(part, deref, next);
    for (const [k, v] of r.props) if (!out.props.has(k)) out.props.set(k, v);
    if (takeRequired) for (const k of r.required) out.required.add(k);
  };
  for (const part of Array.isArray(s.allOf) ? s.allOf : []) merge(part, true);
  for (const part of [...(Array.isArray(s.oneOf) ? s.oneOf : []), ...(Array.isArray(s.anyOf) ? s.anyOf : [])]) merge(part, false);
  if (isObj(s.properties)) for (const [k, v] of Object.entries(s.properties)) out.props.set(k, v);
  if (Array.isArray(s.required)) for (const k of s.required) if (typeof k === "string") out.required.add(k);
  return out;
}

const NUMERIC = new Set(["integer", "number"]);

function bodyFields(schema: any, deref: (n: any) => any): Field[] {
  const fields: Field[] = [];
  // `inside` holds the objects we are already inside, so an object that contains itself is walked once
  const walk = (node: any, prefix: string, depth: number, inside: Set<object>) => {
    const { props, required } = schemaProps(node, deref);
    for (const [name, raw] of props) {
      const s = deref(raw);
      if (!isObj(s)) continue;
      const type = typeOf(s);
      const full = `${prefix}${name}`;
      const nested = prefix !== "";
      // a nested field that is not a number is left out: no rule can read it
      if (!nested || NUMERIC.has(type)) {
        fields.push({ name: full, in: "body", type, required: !nested && required.has(name), numeric: NUMERIC.has(type), nested, ...(typeof s.minimum === "number" ? { minimum: s.minimum } : {}), ...(typeof s.maximum === "number" ? { maximum: s.maximum } : {}) });
      }
      if (type === "object" && depth < 3 && !inside.has(s)) walk(s, `${full}.`, depth + 1, new Set(inside).add(s));
    }
  };
  walk(schema, "", 0, new Set());
  return fields;
}

/** Read every call in the file. `basePath` (when given) replaces the one in `servers`. */
export function readOpenApi(doc: Obj, o: { basePath?: string } = {}): ApiRead {
  const problems = new Set<string>();
  const deref = resolver(doc, problems);
  const skipped: Skipped[] = [];
  const base = basePathOf(doc, o.basePath, skipped);
  const found: Omit<ApiOperation, "operation">[] = [];
  const used = new Set<string>();

  for (const [rawPath, rawItem] of Object.entries(doc.paths as Obj)) {
    const item = deref(rawItem);
    if (!isObj(item)) { skipped.push({ where: rawPath, why: "the path item could not be read" }); continue; }
    const shown = (m: string) => `${m} ${rawPath}`;
    const gp = guardPath(`${base}${rawPath}`);
    for (const key of Object.keys(item)) {
      const m = key.toUpperCase();
      if (!["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"].includes(m) || !isObj(item[key])) continue;
      if (!(METHODS as readonly string[]).includes(m)) { skipped.push({ where: shown(m), why: "Guard lists only GET, POST, PUT, PATCH and DELETE; a call with this method is refused as unlisted" }); continue; }
      if ("why" in gp) { skipped.push({ where: shown(m), why: gp.why }); continue; }
      const op: Obj = item[key];
      const notes: string[] = [];
      const fields: Field[] = [];
      const idempotencyHeaders: string[] = [];
      // path-level parameters first, then the call's own, which replace a path-level one of the same name and place
      const params = new Map<string, Obj>();
      for (const raw of [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])]) {
        const p = deref(raw);
        if (isObj(p) && typeof p.name === "string" && typeof p.in === "string") params.set(`${p.in}:${p.name}`, p);
      }
      for (const p of params.values()) {
        if (p.in === "header" && /idempot/iu.test(p.name)) { idempotencyHeaders.push(p.name); continue; }
        if (p.in !== "path" && p.in !== "query") continue;
        const s = deref(p.schema) ?? {};
        const type = isObj(s) ? typeOf(s) : "unknown";
        fields.push({ name: p.name, in: p.in, type, required: p.in === "path" || p.required === true, numeric: NUMERIC.has(type), nested: false, ...(isObj(s) && typeof s.minimum === "number" ? { minimum: s.minimum } : {}), ...(isObj(s) && typeof s.maximum === "number" ? { maximum: s.maximum } : {}) });
      }
      const body = deref(op.requestBody);
      if (isObj(body) && isObj(body.content)) {
        const jsonKey = Object.keys(body.content).find((k) => /^application\/(?:[a-z0-9.+-]+\+)?json\b/iu.test(k));
        if (jsonKey) {
          const have = new Set(fields.map((f) => f.name));
          for (const f of bodyFields(body.content[jsonKey]?.schema, deref)) {
            if (have.has(f.name)) { notes.push(`the body field "${f.name}" has the same name as a path or query parameter, and Guard reads the path parameter first; the body field is not listed`); continue; }
            fields.push(f);
          }
        } else notes.push(`the request body is ${Object.keys(body.content).join(", ")}, not JSON, so its fields are not listed here; add rules for them by hand and test them`);
      }
      found.push({ operationId: typeof op.operationId === "string" ? op.operationId : undefined, method: m as Method, path: gp.path, summary: typeof op.summary === "string" ? op.summary : undefined, fields, idempotencyHeaders, notes });
    }
  }

  // stable order: by path, then method
  found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : METHODS.indexOf(a.method) - METHODS.indexOf(b.method)));
  const seenRoute = new Set<string>();
  const operations: ApiOperation[] = [];
  for (const f of found) {
    const key = `${f.method} ${f.path}`;
    if (seenRoute.has(key)) { skipped.push({ where: key, why: "listed twice in the file" }); continue; }
    seenRoute.add(key);
    let name = f.operationId ? snake(f.operationId) : "";
    if (name === "") name = snake(`${f.method} ${f.path.slice(1).split("/").map((s) => (s.startsWith("{") ? `by ${s.slice(1, s.indexOf("}"))}` : s)).join(" ")}`);
    if (name === "mcp") name = "mcp_call";
    let unique = name;
    for (let n = 2; used.has(unique); n++) unique = `${name}_${n}`;
    used.add(unique);
    operations.push({ ...f, operation: unique });
  }
  for (const why of problems) skipped.push({ where: "$ref", why });
  const info = isObj(doc.info) ? doc.info : {};
  return { openapi: doc.openapi, title: typeof info.title === "string" ? info.title : "", apiVersion: typeof info.version === "string" ? info.version : "", basePath: base, operations, skipped };
}
