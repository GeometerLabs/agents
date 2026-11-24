// The CONTRACT of a shop of several template parts (decision 65), over HTTP and its own files only: the starter shop (the credit book, Stock orders and the pickup hold behind
// one number, settings/ganesh-electricals-starter.example.json) on its Go program (go/cmd/parts, or PARTS_GO_BIN), one situation per test: each is the shop's own hand-check
// situation (crash-test/situations.ts), so the contract and the go-live check are the same cases. Each part's own contract suite also runs through this program with
// CONTRACT_PARTS=first or last (via-parts.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSituations } from "../crash-test/situations.ts";
import type { PartsFile } from "../crash-test/go-world.ts";
import { runSituation } from "../../../../modules/crash-test/situations.ts";
import { goProgramsDir } from "../../../../modules/crash-test/programs.ts";

if (process.env.PARTS_GO_BIN) process.env.GEOMETER_GO_PROGRAMS = join(process.env.PARTS_GO_BIN, "..");
const SKIP = existsSync(join(goProgramsDir(), "parts")) ? undefined : "the Go program parts is not built (cd go && go build -o bin/ ./cmd/parts, or set PARTS_GO_BIN)";
const starter = JSON.parse(readFileSync(new URL("../settings/ganesh-electricals-starter.example.json", import.meta.url), "utf8")) as PartsFile;

const built = buildSituations(starter);

test("the starter shop's settings express every parts situation", () => {
  assert.deepEqual(built.skipped, [], "no situation is left out on the starter shop");
  assert.equal(built.situations.length, 6);
});

for (const s of built.situations) {
  test(`${s.id}: ${s.title}`, SKIP ? { skip: SKIP } : {}, async () => {
    const r = await runSituation(s);
    const failed = r.checks.filter((c) => !c.passed);
    assert.deepEqual(failed, [], `${s.id} did not hold`);
  });
}
