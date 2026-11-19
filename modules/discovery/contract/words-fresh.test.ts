// The Go directory's generated words must be as the TypeScript sources that are still theirs now make them (go/scripts/gen_directory.ts: the words in four languages from
// modules/discovery/words.ts, the shops' style sheet, paints and MCP versions from modules/channels, the font). When this fails, run `node go/scripts/gen_directory.ts` from the
// repository root and commit the result. (The vectors the TypeScript directory made are Go source since it was deleted: go/internal/directory/testdata.) Not about the directory's
// behaviour, so it needs no binary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
for (const script of ["gen_directory.ts"]) {
  test(`${script} --check: the committed files are up to date`, () => {
    const out = execFileSync(process.execPath, [join(root, "go", "scripts", script), "--check"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.match(out, /fresh/u);
  });
}
