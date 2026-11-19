// The Go Bookings runtime holds its validated settings tree, the owner-marked ledger and the UPI owner's buttons equal to the TypeScript's on vector files made by RUNNING the TypeScript
// (go/scripts/gen_bookings_settings.ts and gen_ownermarked_vectors.ts). This fails when a committed file is out of date: run the generator named in the message after a change to
// src/settings.ts, modules/approvals/people.ts, modules/assistant/{settings,character}.ts, modules/payments/owner-marked/ or src/language/interactive.ts, and commit the result. It needs no Go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as settingsGen from "../../../../go/scripts/gen_bookings_settings.ts";
import * as ownerMarkedGen from "../../../../go/scripts/gen_ownermarked_vectors.ts";

test("the Go validated settings tree (settings_check.json, settings-tree-vectors.json) equals a fresh run of the TypeScript", () => {
  assert.deepEqual([...settingsGen.generate().keys()].sort(), ["bookings/settings_check.json", "bookings/testdata/settings-tree-vectors.json"]);
  assert.deepEqual(settingsGen.staleFiles(), [], "run  node go/scripts/gen_bookings_settings.ts  and commit the result");
});

test("the Go owner-marked ledger vectors and the UPI owner's buttons equal a fresh run of the TypeScript", async () => {
  assert.deepEqual([...(await ownerMarkedGen.generate()).keys()].sort(), ["bookings/testdata/ownermark-buttons-vectors.json", "payments/ownermarked/testdata/vectors.json"]);
  assert.deepEqual(await ownerMarkedGen.staleFiles(), [], "run  node go/scripts/gen_ownermarked_vectors.ts  and commit the result");
});

test("the checks are not vacuous: a copy with one word changed is stale", async () => {
  const dir = mkdtempSync(join(tmpdir(), "books-fresh-"));
  try {
    cpSync(join(settingsGen.OUT, "bookings"), join(dir, "bookings"), { recursive: true });
    const f = join(dir, "bookings", "settings_check.json");
    writeFileSync(f, readFileSync(f, "utf8").replace('"clay"', '"clays"'));
    assert.deepEqual(settingsGen.staleFiles(dir).filter((n) => n.endsWith("settings_check.json")), ["bookings/settings_check.json"]);
    cpSync(join(ownerMarkedGen.OUT, "payments", "ownermarked"), join(dir, "payments", "ownermarked"), { recursive: true });
    const g = join(dir, "payments", "ownermarked", "testdata", "vectors.json");
    writeFileSync(g, readFileSync(g, "utf8").replace("upi-pay-2", "upi-pay-9"));
    assert.ok((await ownerMarkedGen.staleFiles(dir)).includes("payments/ownermarked/testdata/vectors.json"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
