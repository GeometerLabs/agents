// Reading an OpenAPI file: names Guard accepts, paths Guard can match, what a call carries, and what is said when something cannot be read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { UnreadableFile, parseOpenApi, readOpenApi, snake } from "../openapi-read.ts";

const doc = (paths: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ openapi: "3.0.3", info: { title: "T", version: "1" }, paths, ...extra });
const ok = { responses: { "200": { description: "ok" } } };
const read = (d: unknown, o = {}) => readOpenApi(parseOpenApi(JSON.stringify(d)), o);

test("operation names become lower-case words joined with _, never empty, never mcp, never twice", () => {
  assert.equal(snake("createRefund"), "create_refund");
  assert.equal(snake("GetV2HTTPThing"), "get_v2_http_thing");
  assert.equal(snake("refunds.create-one"), "refunds_create_one");
  assert.equal(snake("2fa"), "op_2fa");
  const r = read(doc({
    "/a": { get: { operationId: "mcp", ...ok }, post: { operationId: "doIt", ...ok } },
    "/b": { get: { operationId: "do_it", ...ok } },
    "/c/{id}": { get: ok },
  }));
  assert.deepEqual(r.operations.map((o) => `${o.method} ${o.path} ${o.operation}`), ["GET /a mcp_call", "POST /a do_it", "GET /b do_it_2", "GET /c/{id} get_c_by_id"]);
});

test("a path Guard cannot match is skipped with the reason, not listed", () => {
  const r = read(doc({
    "/ok/": { get: ok },
    "/": { get: ok },
    "/file-{id}": { get: ok },
    "/v/{id}.json": { get: ok },
    "/a//b": { get: ok },
    "/x": { head: ok, options: ok, trace: ok, get: ok },
  }));
  assert.deepEqual(r.operations.map((o) => o.path), ["/ok", "/v/{id}.json", "/x"]);
  const why = Object.fromEntries(r.skipped.map((s) => [s.where, s.why]));
  assert.match(why["GET /"]!, /root path/u);
  assert.match(why["GET /file-{id}"]!, /middle of a segment/u);
  assert.match(why["GET /a//b"]!, /empty segment/u);
  assert.match(why["HEAD /x"]!, /only GET, POST, PUT, PATCH and DELETE/u);
  assert.equal(why["OPTIONS /x"] !== undefined && why["TRACE /x"] !== undefined, true);
});

test("the base path of the first server is put in front of every path, and --base-path replaces it", () => {
  const d = doc({ "/refunds": { post: ok } }, { servers: [{ url: "https://api.example.com/{version}", variables: { version: { default: "v2" } } }] });
  assert.equal(read(d).operations[0]!.path, "/v2/refunds");
  assert.equal(read(d, { basePath: "/internal/" }).operations[0]!.path, "/internal/refunds");
  assert.equal(read(d, { basePath: "/" }).operations[0]!.path, "/refunds");
  const unknown = read(doc({ "/r": { get: ok } }, { servers: [{ url: "https://{tenant}.example.com/{v}" }] }));
  assert.equal(unknown.operations[0]!.path, "/r");
  assert.match(unknown.skipped[0]!.why, /no default/u);
});

test("what a call carries: path and query parameters, top-level body fields, numeric fields nested in the body, and the idempotency header", () => {
  const r = read(doc({
    "/pay/{order_id}": {
      parameters: [{ name: "order_id", in: "path", required: true, schema: { type: "string" } }],
      post: {
        parameters: [{ name: "dry_run", in: "query", schema: { type: "boolean" } }, { name: "X-Idempotency-Key", in: "header", schema: { type: "string" } }, { name: "trace", in: "cookie", schema: { type: "string" } }],
        requestBody: { content: { "application/json; charset=utf-8": { schema: { allOf: [{ $ref: "#/components/schemas/Base" }, { type: "object", properties: { amount: { type: "object", properties: { value: { type: "integer" }, currency: { type: "string" } } }, note: { type: ["string", "null"] } } }] } } } },
      },
    },
  }, { components: { schemas: { Base: { type: "object", required: ["order_ref"], properties: { order_ref: { type: "string" }, tip: { type: "number", maximum: 500 } } } } } }));
  const op = r.operations[0]!;
  assert.deepEqual(op.fields.map((f) => `${f.in}:${f.name}:${f.type}${f.required ? "!" : ""}${f.nested ? "~" : ""}`).sort(), ["body:amount.value:integer~", "body:amount:object", "body:note:string", "body:order_ref:string!", "body:tip:number", "path:order_id:string!", "query:dry_run:boolean"]);
  assert.equal(op.fields.find((f) => f.name === "tip")!.maximum, 500);
  assert.deepEqual(op.idempotencyHeaders, ["X-Idempotency-Key"]);
});

test("a reference loop, an outside reference and a missing one are named, and reading goes on", () => {
  const r = read(doc({
    "/a": { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Loop" } } } } } },
    "/b": { post: { requestBody: { content: { "application/json": { schema: { $ref: "other.json#/X" } } } } } },
    "/c": { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Missing" } } } } } },
  }, { components: { schemas: { Loop: { $ref: "#/components/schemas/Loop2" }, Loop2: { $ref: "#/components/schemas/Loop" } } } }));
  assert.equal(r.operations.length, 3);
  const whys = r.skipped.filter((s) => s.where === "$ref").map((s) => s.why).join(" | ");
  assert.match(whys, /loops/u);
  assert.match(whys, /other\.json/u);
  assert.match(whys, /points at nothing/u);
});

test("an object that contains itself does not loop forever", () => {
  const r = read(doc({ "/n": { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Node" } } } } } } }, { components: { schemas: { Node: { type: "object", properties: { child: { $ref: "#/components/schemas/Node" }, weight: { type: "integer" } } } } } }));
  assert.ok(r.operations[0]!.fields.some((f) => f.name === "weight"));
});

test("a body that is not JSON is said so; a body field with a path parameter's name is not listed twice", () => {
  const r = read(doc({
    "/form": { post: { requestBody: { content: { "application/x-www-form-urlencoded": { schema: { type: "object", properties: { amount: { type: "integer" } } } } } } } },
    "/x/{id}": { put: { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } } } } },
  }));
  const form = r.operations.find((o) => o.path === "/form")!;
  assert.equal(form.fields.length, 0);
  assert.match(form.notes[0]!, /not JSON/u);
  const put = r.operations.find((o) => o.path === "/x/{id}")!;
  assert.equal(put.fields.length, 1);
  assert.match(put.notes[0]!, /same name/u);
});

test("a file that is not an OpenAPI 3 JSON document is refused in plain words", () => {
  assert.throws(() => parseOpenApi("openapi: 3.0.0\ninfo:\n  title: x\n"), (e: Error) => e instanceof UnreadableFile && /YAML/u.test(e.message) && /JSON only/u.test(e.message));
  assert.throws(() => parseOpenApi("{\"swagger\":\"2.0\",\"paths\":{}}"), /Swagger 2\.0/u);
  assert.throws(() => parseOpenApi("{\"openapi\":\"4.0.0\",\"paths\":{}}"), /Not an OpenAPI 3\.x/u);
  assert.throws(() => parseOpenApi("{\"openapi\":\"3.0.0\"}"), /no "paths"/u);
  assert.throws(() => parseOpenApi("<html>"), /not JSON/u);
  assert.throws(() => parseOpenApi("[]"), /not an object/u);
});
