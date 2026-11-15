// The rule that lets a release skip the Docker proof (test/proof/provenance.ts): skip only for a clean, full, passing proof of the same bundle, modules and Guard.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, SKIP, CORE, FULL } from "./proof/provenance.ts";
import type { Provenance } from "./proof/provenance.ts";

const P: Provenance = { bundleTree: "b1", modulesTree: "m1", agentsCommit: "a".repeat(40), dirty: false, guardInputDigest: "g1", guardImage: "x", onlyPhases: null, shopSizes: [1, 5, 10] };
const PASSED = { provenance: P, summary: { passed: 200, failed: [] } };

test("the same bundle, modules and Guard as a clean full passing proof may skip it", () => assert.equal(decide(PASSED, P).code, SKIP));
test("a changed bundle or modules tree, or a changed Guard, means the full proof", () => {
  assert.equal(decide(PASSED, { ...P, bundleTree: "b2" }).code, FULL);
  assert.equal(decide(PASSED, { ...P, modulesTree: "m2" }).code, FULL);
  assert.equal(decide(PASSED, { ...P, guardInputDigest: "g2" }).code, FULL);
});
test("an unknown Guard digest means the core set, never a skip", () => {
  assert.equal(decide(PASSED, { ...P, guardInputDigest: "" }).code, CORE);
  assert.equal(decide({ ...PASSED, provenance: { ...P, guardInputDigest: "" } }, P).code, CORE);
});
test("no earlier proof, a failed one, a partial one, a short one or a dirty tree means the full proof", () => {
  assert.equal(decide(null, P).code, FULL);
  assert.equal(decide({ provenance: P, summary: { passed: 3, failed: [{}] } }, P).code, FULL);
  assert.equal(decide({ provenance: { ...P, onlyPhases: ["kill"] }, summary: { passed: 3, failed: [] } }, P).code, FULL);
  assert.equal(decide({ provenance: { ...P, shopSizes: [1, 5] }, summary: { passed: 3, failed: [] } }, P).code, FULL);
  assert.equal(decide({ provenance: { ...P, dirty: true }, summary: { passed: 3, failed: [] } }, P).code, FULL);
  assert.equal(decide(PASSED, { ...P, dirty: true }).code, FULL);
});
