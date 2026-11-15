// The lists of which module each template uses (modules/README.md's "Who imports it" column, each template README's "Modules it uses") are what the code's
// imports say. They were kept by hand and fell behind; now modules/module-map.ts makes them, and this fails when one is behind, naming the command that fixes it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { expected, moduleNames, readmeColumn, readmeWritten, templateReadmeWritten, usesOf, usersText, SECTION_START } from "../module-map.ts";

const FIX = "run  node modules/module-map.ts --write";

test("every module folder has a row in modules/README.md, and every list says what the imports say", () => {
  const files = expected();
  assert.deepEqual(files[0].missing, [], "a module folder with no row in modules/README.md");
  for (const f of files) assert.equal(readFileSync(f.path, "utf8"), f.text, `${relative(process.cwd(), f.path)} is behind the imports: ${FIX}`);
});

test("the lists are read from code only, and a row keeps its own note after the users", () => {
  const uses = usesOf();
  // accounting is used by the three templates' code and not by the bundle's
  assert.equal(usersText("accounting", uses), "Bookings, Orders, Fees");
  assert.ok(moduleNames().includes("ask-card") && usersText("ask-card", uses) === "no template's code", "ask-card makes the sell-guide cards; only a script and tests import it");
  const row = "| `qr/` | the QR code | what text to encode | Bookings · also used by `report/` |";
  const written = readmeWritten(row, uses).text;
  assert.equal(readmeColumn(written).get("qr")!.note, "also used by `report/`");
  assert.equal(readmeColumn(written).get("qr")!.users, usersText("qr", uses));
});

test("a template README gets its section once: added at the end the first time, replaced in place after", () => {
  const once = templateReadmeWritten("# Orders\n\nText.\n", "Orders");
  assert.ok(once.includes("## Modules it uses") && once.includes(SECTION_START) && once.includes("[`accounting/`]"));
  assert.equal(templateReadmeWritten(once, "Orders"), once);
});
