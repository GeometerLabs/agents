// B72: the deployer hands a shop's terms file to its runtime only while the server's setting (geometer.json panel.termsOnWhatsapp) is on (lib/terms.ts syncTerms).
// Moved here from modules/terms/test/terms.test.ts, since a shared module's tests may not import the bundle (modules/test/boundary.test.ts). The shop runtime that reads the
// handed file is the Go program since 24 Nov 2026 (go/internal/terms); this reads the file the deployer hands over as JSON, as that runtime does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TermsFile } from "../../modules/terms/terms.ts";
import { syncTerms } from "../lib/terms.ts";

const FILE: TermsFile = { schema: 1, partnerName: "Divya", partnerPhone: "+919800000000", monthlyInr: 700, setupInr: 1500 };

test("the deployer hands the file over, and takes it away, as the server setting says", () => {
  const dir = mkdtempSync(join(tmpdir(), "terms-"));
  try {
    mkdirSync(join(dir, "shops", "glow"), { recursive: true });
    writeFileSync(join(dir, "shops", "glow", "terms.json"), JSON.stringify(FILE));
    const handed = join(dir, "generated", "shops", "glow", "client", "terms.json");
    mkdirSync(join(dir, "generated", "shops", "glow", "client"), { recursive: true });
    syncTerms(dir, false, "glow");
    assert.equal(existsSync(handed), false, "setting off: nothing is handed over");
    syncTerms(dir, true, "glow");
    assert.deepEqual(JSON.parse(readFileSync(handed, "utf8")), FILE, "setting on: the shop's own file, whole");
    syncTerms(dir, false, "glow");
    assert.equal(existsSync(handed), false, "turning the setting off takes the copy away");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
