// The draft, the accept step and the build, on the refunds example and on small files of their own. The tests that need the real geo-guard say so and are
// skipped without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileSpec, verifyBundle } from "../guard-binary.ts";
import { Refusal, acceptTemplate, draftFromText, main, specFromAccept } from "../openapi-to-spec.ts";
import type { Draft } from "../openapi-to-spec.ts";
import { sha256 } from "../openapi-read.ts";
import { GUARD, captureIo, exampleFile, exampleJson, exampleText, skipWithoutGuard, tempDir } from "./helpers.ts";

const REGENERATE = "Regenerate the example files (see companies/README.md, 'Regenerating the example').";
const draftText = () => exampleText("draft.json");
const draft = () => JSON.parse(draftText()) as Draft;
const accept = () => exampleJson("accept.json");

/** The reasons the accept step gives for refusing `mutate(accept)`. */
function refusal(mutate: (a: any) => void): string[] {
  const a = accept();
  mutate(a);
  try { specFromAccept(draft(), a, sha256(draftText())); } catch (e) { if (e instanceof Refusal) return e.problems; throw e; }
  assert.fail("expected a refusal");
}
const has = (problems: string[], re: RegExp) => assert.ok(problems.some((p) => re.test(p)), `no problem matches ${re}:\n${problems.join("\n")}`);

// ---- the draft -----------------------------------------------------------------------------------------------------------------------------

test("the checked-in example draft and accept template are what the tool writes today", () => {
  const text = exampleText("refunds-api.openapi.json");
  const fresh = draftFromText(text, { tool: "refunds" });
  assert.equal(`${JSON.stringify(fresh, null, 2)}\n`, draftText(), REGENERATE);
  assert.equal(`${JSON.stringify(acceptTemplate(fresh, sha256(draftText())), null, 2)}\n`, exampleText("accept.template.json"), REGENERATE);
  assert.equal(JSON.stringify(draftFromText(text, { tool: "refunds" })), JSON.stringify(fresh), "the same file gives the same draft");
});

test("a draft is not a Guard spec, says so, and every call and suggestion carries a review note", () => {
  const d = draft();
  assert.equal("schema" in d, false);
  assert.match(d.status, /not a Guard limits spec/u);
  for (const r of d.routes) assert.ok(r.review.length > 20, `${r.operation} has a review note`);
  for (const s of d.suggestions) {
    assert.ok(s.review.length > 20, `${s.id} has a review note`);
    for (const f of s.fill) assert.ok(f.help.length > 5, `${s.id}.${f.name} says what to fill in`);
  }
  assert.deepEqual(d.routes.filter((r) => r.consequential).map((r) => r.operation).sort(), ["cancel_refund", "create_refund", "create_transfer", "delete_customer"]);
  const note = d.routes.find((r) => r.operation === "add_customer_note")!;
  assert.equal(note.consequential, false);
  assert.match(note.review, /Read it yourself/u);
});

test("the suggestions for the example: bounds, approvals, once, forbidden, spend and count, with the key and the header guessed", () => {
  const d = draft();
  const kinds = (op: string) => d.suggestions.filter((s) => s.operation === op).map((s) => s.kind).sort();
  assert.deepEqual(kinds("create_refund"), ["argument_bound", "at_most_once_effect", "call_bound_approval", "count", "spend"]);
  assert.deepEqual(kinds("create_transfer"), ["argument_bound", "at_most_once_effect", "call_bound_approval", "count", "forbidden_call", "spend"]);
  assert.deepEqual(kinds("delete_customer"), ["at_most_once_effect", "count", "forbidden_call"]);
  assert.deepEqual(kinds("cancel_refund"), ["at_most_once_effect", "count"]);
  assert.deepEqual(kinds("get_charge"), []);
  const once = d.suggestions.find((s) => s.id === "create_refund-once")!;
  assert.equal(once.idempotency_header, "Idempotency-Key");
  assert.deepEqual(once.fill[0]!.default, ["charge_id"]);
  assert.match(once.review, /Guessed from the body field that look like ids/u);
  assert.match(once.review, /retry_safe/u);
  assert.match(d.suggestions.find((s) => s.id === "create_refund-amount-bound")!.review, /minimum 1, maximum 100000000; that is the API's limit, not yours/u);
  assert.deepEqual(d.suggestions.find((s) => s.id === "create_transfer-once")!.fill[0]!.default, ["from_account_id", "to_account_id"]);
});

test("numbers that are not money get no bound; a string amount gets none; a nested amount is bounded but not held or counted", () => {
  const body = (props: Record<string, unknown>) => ({ requestBody: { content: { "application/json": { schema: { type: "object", properties: props } } } }, responses: {} });
  const d = draftFromText(JSON.stringify({
    openapi: "3.1.0", info: { title: "Odd API", version: "1" },
    paths: {
      "/orders": { post: { operationId: "createOrder", ...body({ quantity: { type: "integer" }, page_size: { type: "integer" }, fee_rate: { type: "number" }, order_id: { type: "string" }, amount: { type: "string", format: "decimal" } }) } },
      "/charges": { post: { operationId: "createCharge", ...body({ amount: { type: "object", properties: { value: { type: "integer" }, currency: { type: "string" } } } }) } },
      "/prices": { put: { operationId: "setPrice", ...body({ unitPriceCents: { type: ["integer", "null"] } }) } },
    },
  }));
  assert.equal(d.routes.find((r) => r.operation === "create_order")!.consequential, false, "no money field, no word like refund: not consequential");
  assert.deepEqual(d.suggestions.filter((s) => s.operation === "create_order"), []);
  const charge = d.suggestions.filter((s) => s.operation === "create_charge").map((s) => s.id);
  assert.ok(charge.includes("create_charge-amount-value-bound"));
  assert.ok(!charge.includes("create_charge-needs-approval") && !charge.includes("create_charge-spend-per-day"));
  assert.match(d.suggestions.find((s) => s.id === "create_charge-amount-value-bound")!.review, /cannot hold a call on it or count it/u);
  assert.ok(d.suggestions.some((s) => s.id === "set_price-unitPriceCents-bound"), "camelCase and a nullable number are read");
});

// ---- the accept step ---------------------------------------------------------------------------------------------------------------------

test("the example accept file builds the checked-in spec, and the order of the accept file does not change it", () => {
  const built = specFromAccept(draft(), accept(), sha256(draftText()));
  assert.equal(`${JSON.stringify(built.spec, null, 2)}\n`, exampleText("spec.json"), REGENERATE);
  assert.deepEqual(built.kept.routes, ["get_charge", "list_refunds", "get_refund", "create_refund", "cancel_refund", "create_transfer"].sort((a, b) => draft().routes.findIndex((r) => r.operation === a) - draft().routes.findIndex((r) => r.operation === b)));
  const shuffled = accept();
  shuffled.suggestions = Object.fromEntries(Object.entries(shuffled.suggestions).reverse());
  assert.deepEqual(specFromAccept(draft(), shuffled, sha256(draftText())).spec, built.spec);
  assert.equal(built.spec.reviewed_by, "priya.nair");
});

test("the template, switched on nowhere, is refused for every missing thing at once", () => {
  const template = acceptTemplate(draft(), sha256(draftText()));
  try { specFromAccept(draft(), template, sha256(draftText())); assert.fail("built from a template"); } catch (e) {
    assert.ok(e instanceof Refusal);
    has(e.problems, /"reviewed_by" is empty/u);
    has(e.problems, /"tenant" is empty/u);
    has(e.problems, /No route is kept/u);
    has(e.problems, /No rule is kept/u);
  }
});

test("a blank left in a part you kept stops the build and says which blank and what goes in it", () => {
  has(refusal((a) => { a.suggestions["create_refund-amount-bound"].max = null; }), /create_refund-amount-bound: "max" is blank/u);
  has(refusal((a) => { a.suggestions["create_refund-needs-approval"].threshold = ""; }), /create_refund-needs-approval: "threshold" is blank/u);
  has(refusal((a) => { a.suggestions["create_refund-spend-per-day"].cap = null; }), /create_refund-spend-per-day: "cap" is blank/u);
  has(refusal((a) => { a.suggestions["create_refund-once"].key_fields = null; }), /create_refund-once: "key_fields" is blank/u);
});

test("reviewed_by is never filled in for you", () => {
  has(refusal((a) => { delete a.reviewed_by; }), /"reviewed_by" is empty.*will not choose one for you/u);
  has(refusal((a) => { a.reviewed_by = "has space"; }), /"reviewed_by" is "has space"/u);
});

test("amounts are strings of digits; a float, an exponent or a comma is refused with an example", () => {
  has(refusal((a) => { a.suggestions["create_refund-amount-bound"].max = 12.5; }), /"max" is 12\.5\. Write an amount as a string/u);
  has(refusal((a) => { a.suggestions["create_refund-amount-bound"].max = "1e5"; }), /"max" is "1e5"/u);
  has(refusal((a) => { a.suggestions["create_refund-amount-bound"].max = "50,000"; }), /"max" is "50,000"/u);
  has(refusal((a) => { a.suggestions["create_refund-count-per-day"].cap = "1.5"; }), /whole number above zero/u);
  has(refusal((a) => { a.suggestions["create_refund-count-per-day"].cap = 0; }), /whole number above zero/u);
  has(refusal((a) => { a.suggestions["create_refund-spend-per-day"].cap = "0"; }), /string above zero/u);
  // a whole number written as a number is read as that number
  const ok = accept(); ok.suggestions["create_refund-amount-bound"].max = 50000; ok.suggestions["create_refund-count-per-day"].cap = 100;
  assert.equal(specFromAccept(draft(), ok, sha256(draftText())).spec.rules[0].max, "50000");
});

test("a threshold at or above the bound's max would never hold anything, so it is refused; so is min above max", () => {
  has(refusal((a) => { a.suggestions["create_refund-needs-approval"].threshold = "50000"; }), /threshold is not below the bound's max/u);
  has(refusal((a) => { a.suggestions["create_refund-needs-approval"].threshold = "60000"; }), /no call could ever wait for a person/u);
  has(refusal((a) => { a.suggestions["create_refund-amount-bound"].min = "60000"; }), /min 60000 is above max 50000/u);
});

test("an accept file made for another draft, with an id the draft lacks, or with a typo is refused", () => {
  has(refusal((a) => { a.draft_sha256 = "sha256:" + "1".repeat(64); }), /made for a different draft/u);
  has(refusal((a) => { a.suggestions["no-such-rule"] = { keep: true }; }), /"no-such-rule", which is not in the draft/u);
  has(refusal((a) => { a.routes.no_such_call = true; }), /"no_such_call", which is not in the draft/u);
  has(refusal((a) => { a.suggestions["create_refund-amount-bound"].mx = "5"; }), /"mx" is not one of its choices/u);
  has(refusal((a) => { a.suggestions["create_refund-amount-bound"].keep = "yes"; }), /"keep": true or false/u);
  has(refusal((a) => { a.reviewer = "x"; }), /does not know: "reviewer"/u);
});

test("a rule on a route you did not keep, key fields the call does not carry, and a scope it does not carry are refused", () => {
  has(refusal((a) => { a.routes.create_refund = false; }), /create_refund-amount-bound is kept, but the route create_refund is not/u);
  has(refusal((a) => { a.suggestions["create_refund-once"].key_fields = ["order_id"]; }), /key_fields names "order_id", which create_refund does not carry/u);
  has(refusal((a) => { a.suggestions["create_refund-count-per-day"].scope = ["customer_id"]; }), /"scope" must be a list of fields create_refund carries/u);
});

test("a kept consequential route with no rule is built, with a warning; a forbidden route with other rules gets one too", () => {
  const a = accept();
  a.routes.delete_customer = true;
  a.suggestions["create_transfer-amount-bound"].keep = true; a.suggestions["create_transfer-amount-bound"].min = "1"; a.suggestions["create_transfer-amount-bound"].max = "5";
  const built = specFromAccept(draft(), a, sha256(draftText()));
  assert.ok(built.warnings.some((w) => /delete_customer .* no rule or limit/u.test(w)));
  assert.ok(built.warnings.some((w) => /create_transfer is forbidden and also has other rules/u.test(w)));
});

// ---- the command line ----------------------------------------------------------------------------------------------------------------------

function workFolder() {
  const dir = tempDir();
  for (const f of ["draft.json", "accept.json"]) copyFileSync(exampleFile(f), join(dir, f));
  return dir;
}

test("build without an --accept file writes nothing and says why", () => {
  const dir = workFolder();
  const io = captureIo();
  const code = main(["build", "--draft", join(dir, "draft.json"), "--out", join(dir, "spec.json")], io);
  assert.equal(code, 2);
  assert.match(io.text(), /no --accept file/u);
  assert.equal(existsSync(join(dir, "spec.json")), false);
  assert.equal(main(["build", "--draft", join(dir, "draft.json"), "--accept", join(dir, "missing.json"), "--out", join(dir, "spec.json")], captureIo()), 2);
});

test("the accept template given as the accept file writes nothing", () => {
  const dir = workFolder();
  const d = draft();
  writeFileSync(join(dir, "accept.json"), JSON.stringify(acceptTemplate(d, sha256(draftText()))));
  const io = captureIo();
  assert.equal(main(["build", "--draft", join(dir, "draft.json"), "--accept", join(dir, "accept.json"), "--out", join(dir, "spec.json"), "--no-compile"], io), 1);
  assert.match(io.text(), /Refused\. Nothing was built\./u);
  assert.equal(existsSync(join(dir, "spec.json")), false);
});

test("build --no-compile writes the spec and says it did not compile it", () => {
  const dir = workFolder();
  const io = captureIo();
  assert.equal(main(["build", "--draft", join(dir, "draft.json"), "--accept", join(dir, "accept.json"), "--out", join(dir, "spec.json"), "--no-compile"], io), 0);
  assert.equal(readFileSync(join(dir, "spec.json"), "utf8"), exampleText("spec.json"));
  assert.match(io.text(), /Not compiled/u);
  assert.equal(existsSync(join(dir, "bundle.json")), false);
});

test("draft from the command line writes the draft and the template, and refuses a YAML file in plain words", () => {
  const dir = tempDir();
  const io = captureIo();
  assert.equal(main(["draft", exampleFile("refunds-api.openapi.json"), "--out", join(dir, "draft.json"), "--tool", "refunds"], io), 0);
  assert.equal(readFileSync(join(dir, "draft.json"), "utf8"), draftText());
  assert.equal(readFileSync(join(dir, "accept.template.json"), "utf8"), exampleText("accept.template.json"));
  writeFileSync(join(dir, "api.yaml"), "openapi: 3.0.0\ninfo:\n  title: x\n  version: '1'\npaths: {}\n");
  const yaml = captureIo();
  assert.equal(main(["draft", join(dir, "api.yaml"), "--out", join(dir, "y.json")], yaml), 2);
  assert.match(yaml.text(), /JSON only/u);
  assert.equal(existsSync(join(dir, "y.json")), false);
});

// ---- with the real geo-guard ---------------------------------------------------------------------------------------------------------------

test("Guard's own compiler accepts the example spec and gives the checked-in bundle; verify-bundle agrees", { skip: skipWithoutGuard }, () => {
  const dir = tempDir();
  const c = compileSpec(GUARD!, exampleFile("spec.json"), join(dir, "bundle.json"));
  assert.ok(c.ok, c.ok ? "" : c.problems.join("\n"));
  if (!c.ok) return;
  assert.equal(c.summary.tripwires.passed, c.summary.tripwires.of);
  assert.equal(readFileSync(join(dir, "bundle.json"), "utf8"), exampleText("bundle.json"), `Guard's compiler gives other bytes than the checked-in bundle.json: ${REGENERATE}`);
  const v = verifyBundle(GUARD!, join(dir, "bundle.json"));
  assert.ok(v.ok, v.ok ? "" : v.problems.join("\n"));
});

test("build compiles with the real Guard, prints what it cannot test, and writes a starter guard.toml it then checks the bundle against", { skip: skipWithoutGuard }, () => {
  const dir = workFolder();
  const io = captureIo();
  const args = ["build", "--draft", join(dir, "draft.json"), "--accept", join(dir, "accept.json"), "--out", join(dir, "spec.json"), "--bundle", join(dir, "guard", "bundle.json"), "--guard-toml", join(dir, "guard", "guard.toml"), "--upstream", "refunds.brightside.example:443", "--listen", "127.0.0.1:8080", "--agent-id", "support-bot"];
  assert.equal(main(args, io), 0, io.text());
  const text = io.text();
  assert.match(text, /Tripwires: passed 4 of 4/u);
  assert.match(text, /rule create_refund-once: whether a repeat is stopped depends on the intent ledger/u);
  assert.match(text, /only the provider's receipt lookup or idempotency key can show whether it happened/u);
  assert.match(text, /checked against guard\.toml/u);
  const toml = readFileSync(join(dir, "guard", "guard.toml"), "utf8");
  assert.match(toml, /bundle_digest = "sha256:[0-9a-f]{64}"/u);
  assert.match(toml, /operations = \["create_refund"\]/u);
  assert.match(toml, /^listen = "127\.0\.0\.1:8080"$/mu, "a sidecar listens on the pod's own loopback");
  assert.match(toml, /\[\[agents\]\]\nid = "support-bot"/u);
  assert.match(toml, /token_sha256 = "0{64}"/u, "no real credential is written");
  // the starter file is not overwritten a second time
  const again = captureIo();
  assert.equal(main(args, again), 2);
  assert.match(again.text(), /Not overwritten/u);
  assert.equal(main([...args, "--force"], captureIo()), 0);
});

test("when Guard's compiler refuses the spec, the lines come back as they are, the exit is 1, and no bundle is written", { skip: skipWithoutGuard }, () => {
  const dir = workFolder();
  // two kept routes that could both match the same request: the compiler calls them ambiguous
  const d = draft();
  d.routes.push({ operation: "get_thing_a", method: "GET", path: "/v1/things/{a}", fields: [], consequential: false, why: "a read", review: "A test route, long enough." }, { operation: "get_thing_b", method: "GET", path: "/v1/things/{b}", fields: [], consequential: false, why: "a read", review: "A test route, long enough." });
  const text = `${JSON.stringify(d, null, 2)}\n`;
  writeFileSync(join(dir, "draft.json"), text);
  const a = accept();
  a.draft_sha256 = sha256(text); a.routes.get_thing_a = true; a.routes.get_thing_b = true;
  writeFileSync(join(dir, "accept.json"), JSON.stringify(a));
  const io = captureIo();
  assert.equal(main(["build", "--draft", join(dir, "draft.json"), "--accept", join(dir, "accept.json"), "--out", join(dir, "spec.json")], io), 1);
  assert.match(io.text(), /Guard's compiler refused the spec/u);
  assert.match(io.text(), /refused: /u);
  assert.equal(existsSync(join(dir, "bundle.json")), false);
});
