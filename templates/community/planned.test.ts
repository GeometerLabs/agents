// The planned templates (specs, not runnable). These tests keep them honest and comparable: every folder has the same headings, the
// lists in planned/README.md and the root README match the folders, nothing claims a built thing that is not built, and no spec uses
// a word the claim rules ban. Run it with: node --test templates/community/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { BANNED } from "../../modules/report/claims.ts";

const HERE = new URL("./", import.meta.url);
const ROOT = new URL("../../", import.meta.url);
const specs = readdirSync(HERE, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const read = (url: URL) => readFileSync(url, "utf8");
const spec = (name: string) => read(new URL(`${name}/README.md`, HERE));

const HEADINGS = ["The job", "Who it is for", "Settings", "Limits, in plain words", "How \"done\" is judged", "Privacy", "Legal care", "The human outcome to count",
  "What it reuses, and what is new", "The sell guide (outline)", "Questions for contributors", "What this spec does not claim"];
const SELL_GUIDE_HEADINGS = ["Is this", "Before you go", "The first three sentences", "Show it on", "Questions", "Price", "Never say", "The setup visit", "The first month", "When something goes wrong", "Be honest about what's true today"];

const headings = (text: string) => [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);

test("planned: the three specs the owner asked for are there, and nothing else is hiding in the folder", () => {
  assert.deepEqual(specs, ["community-fund", "meeting-follow-through", "self-help-group"]);
  for (const name of specs) assert.ok(existsSync(new URL(`${name}/README.md`, HERE)), name);
  assert.ok(existsSync(new URL("README.md", HERE)));
});

test("planned: every spec has the same headings, a statement section, and says plainly that it is a spec", () => {
  for (const name of specs) {
    const text = spec(name);
    const found = headings(text);
    for (const h of HEADINGS) assert.ok(found.includes(h), `${name}: missing the heading "${h}"`);
    assert.ok(found.some((h) => /statement/i.test(h)), `${name}: no statement section`);
    assert.ok(/^> \*\*Status: a spec, not a template\.\*\*/m.test(text), `${name}: the status line`);
    assert.ok(text.includes("Nothing here runs"), `${name}: it must say nothing runs`);
    assert.ok(text.includes("GitHub Discussions"), `${name}: it must say where to comment`);
    assert.ok(text.includes("(../README.md)") || text.includes("../README.md"), `${name}: it points to planned/README.md`);
  }
});

test("planned: every spec's sell-guide outline has the 11 headings, in order, and a row for each", () => {
  for (const name of specs) {
    const text = spec(name);
    const outline = text.slice(text.indexOf("## The sell guide (outline)"));
    const rows = [...outline.matchAll(/^\| (\d+) \| ([^|]+?) \| (.+) \|$/gm)].map((m) => [Number(m[1]), m[2]] as const);
    assert.equal(rows.length, 11, `${name}: expected 11 rows in the outline`);
    assert.deepEqual(rows.map((r) => r[0]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], `${name}: out of order`);
    rows.forEach(([, title], i) => assert.ok(title.includes(SELL_GUIDE_HEADINGS[i]), `${name}: row ${i + 1} should be "${SELL_GUIDE_HEADINGS[i]}", not "${title}"`));
    const sellSpec = read(new URL("templates/SELL-GUIDE.md", ROOT));
    const specTitles = [...sellSpec.matchAll(/^\| (\d+) \| ([^|]+?) \| /gm)].map((m) => m[2]);
    assert.equal(specTitles.length, 11);
    assert.ok(outline.includes("SELL-GUIDE.md"), `${name}: the outline names the spec it follows`);
  }
});

test("planned: the limits every community template shares are in every spec's own words", () => {
  for (const name of specs) {
    const text = spec(name).toLowerCase();
    assert.ok(/never (moves|move)[^.]*money|never pools, holds, lends or moves money|never moves money/.test(text), `${name}: the agent never moves money`);
    assert.ok(text.includes("no message after stop"), `${name}: no message after STOP`);
    assert.ok(text.includes("a correction never erases"), `${name}: corrections never erase`);
    assert.ok(text.includes("get legal review before launch"), `${name}: legal review comes first`);
    assert.ok(text.includes("b28 is not built"), `${name}: it must say the signed statements are not built`);
    assert.ok(text.includes("dpdp"), `${name}: data protection`);
    assert.ok(text.includes("counted, published beside the technical results, never graded"), `${name}: the human outcome is counted, not graded`);
  }
});

/** The text the banned-word check reads: every spec's "Never say" row of the outline is the one place that quotes the words. */
const checked = (text: string) => text.split("\n").filter((line) => !line.startsWith("| 7 | Never say |")).join("\n");

test("planned: no banned word in any spec, and none of the phrases the say/don't-say table rules out (the Never say row is the one place that quotes them)", () => {
  const phrases = [/tamper-?proof/i, /unhackable/i, /\bon the blockchain\b/i, /\bwe take the risk\b/i, /\bwill pay for itself\b/i];
  for (const name of specs) {
    const text = checked(spec(name));
    const hits = [...BANNED.any, ...BANNED.en].filter((re) => re.test(text)).map((re) => re.source);
    assert.deepEqual(hits, [], `${name}: ${hits.join(", ")}`);
    for (const re of phrases) assert.ok(!re.test(text), `${name}: ${re}`);
    assert.ok(/Never say/.test(spec(name)) && BANNED.any.some((re) => re.test(spec(name))), `${name}: the Never say row quotes banned phrases, so the skip is in use`);
  }
});

test("planned: the numbers in the example statements are made up and say so, and no spec says what anyone will make", () => {
  for (const name of specs) {
    const text = spec(name);
    assert.ok(/made-up numbers|made up/i.test(text) || name === "meeting-follow-through", `${name}: example statements say they are made up`);
    assert.ok(!/\b(you|they|members?|partners?|builders?) (will|can) (make|get paid|receive) ₹/i.test(text), `${name}: no earnings claim`);
    assert.ok(/Code [0-9A-Z]{6} /.test(text), `${name}: the example statement carries a verify code`);
  }
});

test("planned: planned/README.md and the root README list exactly these specs, and the built equipment-rental template", () => {
  const planned = read(new URL("README.md", HERE));
  const root = read(new URL("README.md", ROOT));
  const section = root.slice(root.indexOf("## Community templates"));
  assert.ok(section.length > 0 && root.includes("## Community templates"), "the root README has a Community templates section");
  for (const name of specs) {
    assert.ok(planned.includes(`](${name}/README.md)`), `planned/README.md must link ${name}`);
    assert.ok(section.includes(`templates/community/${name}`), `the root README must link ${name}`);
  }
  assert.ok(section.includes("equipment-rental") && section.includes("templates/commerce/bookings"), "the root README lists equipment rental, built as a Bookings variant");
  assert.ok(planned.includes("not runnable") || planned.includes("It is not runnable"), "planned/README.md says a planned template is not runnable");
  assert.ok(planned.includes("node --test templates/community/"));
  for (const word of ["B28 is not built"]) assert.ok(planned.includes(word));
});

test("planned: every relative link in the specs goes somewhere", () => {
  for (const name of [...specs, ""]) {
    const dir = new URL(name ? `${name}/` : "", HERE);
    const text = read(new URL("README.md", dir));
    for (const m of text.matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)(?:#[^)]*)?\)/g)) {
      assert.ok(existsSync(new URL(m[1], dir)), `${name || "planned"}/README.md links to ${m[1]}, which does not exist`);
    }
  }
});
