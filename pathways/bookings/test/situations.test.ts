// The crash-test situations, one test each. Every check inside a situation reads the fakes' own records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSituation, situations } from "../crash-test/situations.ts";

for (const situation of situations) {
  const number = situation.planNumber ? `#${situation.planNumber} ` : "";
  test(`${number}${situation.title}`, async () => {
    const result = await runSituation(situation);
    assert.ok(result.checks.length > 0, "a situation with no checks proves nothing");
    const failed = result.checks.filter((c) => !c.passed).map((c) => `${c.label}${c.detail ? ` [${c.detail}]` : ""}`);
    assert.deepEqual(failed, []);
  });
}
