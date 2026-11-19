// The Go directory's generated files must be as the TypeScript directory now makes them (go/scripts/gen_directory.ts: the words in four languages, the style sheet and script, the MCP tool
// definitions, the card text, the assistant's prompt, the romanise tables and the font; go/scripts/gen_directory_vectors.ts: the vectors the Go unit tests compare with). When this fails,
// run `node go/scripts/gen_directory.ts` and `node go/scripts/gen_directory_vectors.ts` from the repository root and commit the result. Not about either runtime's behaviour, so it runs once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
for (const script of ["gen_directory.ts", "gen_directory_vectors.ts"]) {
  test(`${script} --check: the committed files are up to date`, () => {
    const out = execFileSync(process.execPath, [join(root, "go", "scripts", script), "--check"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.match(out, /fresh/u);
  });
}
