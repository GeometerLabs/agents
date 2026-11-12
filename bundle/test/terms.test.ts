// B72: the deployer hands a shop's terms file to its runtime only while the server's setting (geometer.json panel.termsOnWhatsapp) is on (lib/terms.ts syncTerms).
// Moved here from modules/terms/test/terms.test.ts, since a shared module's tests may not import the bundle (modules/test/boundary.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { termsReader } from "../../modules/terms/reader.ts";
import type { TermsFile } from "../../modules/terms/terms.ts";
import { syncTerms } from "../lib/terms.ts";

const FILE: TermsFile = { schema: 1, partnerName: "Divya", partnerPhone: "+919800000000", monthlyInr: 700, setupInr: 1500 };

test("the reader and the deployer follow the file and the server setting", () => {
  const dir = mkdtempSync(join(tmpdir(), "terms-"));
  try {
    mkdirSync(join(dir, "shops", "glow"), { recursive: true });
    writeFileSync(join(dir, "shops", "glow", "terms.json"), JSON.stringify(FILE));
    const handed = join(dir, "generated", "shops", "glow", "client", "terms.json");
    mkdirSync(join(dir, "generated", "shops", "glow", "client"), { recursive: true });
    syncTerms(dir, false, "glow");
    assert.equal(existsSync(handed), false, "setting off: nothing is handed over");
    syncTerms(dir, true, "glow");
    assert.deepEqual(termsReader(join(dir, "generated", "shops", "glow", "client"))(), FILE);
    syncTerms(dir, false, "glow");
    assert.equal(existsSync(handed), false, "turning the setting off takes the copy away");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
