// The company or business name: an optional line on an account, kept on owner.json and assignment.json, and read by the owner as "Divya, Sri Sai Digital".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXAMPLE_CLIENT } from "../../test/helpers.ts";
import { world } from "../../test/world.ts";
import { main } from "../../geometer.ts";
import { PREPARED_BY_LIMIT, parseOwner, preparedByOf, resolvePreparedBy, servedByOf } from "../contract.ts";
import type { AssignmentFile, OwnerFile } from "../contract.ts";
import { WORDS } from "../languages.ts";
import { Browser, PASS, boot, tokenOf } from "./helpers.ts";
import { setUp } from "./flow.ts";

test("preparedByOf: 'Name, Company' with a company, else the role as before; one line, 120 characters, nothing cut mid-character", () => {
  assert.equal(preparedByOf({ accountName: "Divya", role: "partner", company: "Sri Sai Digital" }), "Divya, Sri Sai Digital");
  assert.equal(preparedByOf({ accountName: "Kiran", role: "builder", company: "Hexa Labs" }), "Kiran, Hexa Labs");
  assert.equal(preparedByOf({ accountName: "Divya", role: "partner" }), "Divya, local partner");
  assert.equal(preparedByOf({ accountName: "Kiran", role: "builder", company: "   " }), "Kiran, builder");
  assert.equal(preparedByOf({ accountName: " Divya \n K ", role: "partner", company: "Sri \t Sai\nDigital" }), "Divya K, Sri Sai Digital", "one line, single spaces");
  assert.equal(preparedByOf({ accountName: "Divya", role: "partner", company: 7 as unknown as string }), "Divya, local partner", "a company that is not text is ignored");
  assert.equal(preparedByOf({ accountName: "Divya", role: "partner", company: "x".repeat(61) }), "Divya, local partner", "a company over 60 characters is not a usable one");

  // too long: the company is cut first
  const name = "N".repeat(100);
  const long = preparedByOf({ accountName: name, role: "partner", company: "C".repeat(60) });
  assert.equal(long, `${name}, ${"C".repeat(18)}`);
  assert.equal(long.length, PREPARED_BY_LIMIT);
  // then the name, when no room is left for the company
  const huge = preparedByOf({ accountName: "N".repeat(119), role: "builder", company: "Acme" });
  assert.equal(huge, `${"N".repeat(PREPARED_BY_LIMIT - ", builder".length)}, builder`);
  assert.ok(huge.length <= PREPARED_BY_LIMIT);

  // never mid-character: an astral letter and a Malayalam letter with its vowel sign stay whole
  const emoji = preparedByOf({ accountName: "N".repeat(115), role: "partner", company: "🙂🙂🙂🙂" });
  assert.equal(emoji, `${"N".repeat(115)}, 🙂`);
  for (const company of ["കൊച്ചി ഡിജിറ്റൽ സൊല്യൂഷൻസ്", "ಬೆಂಗಳೂರು ಡಿಜಿಟಲ್"]) for (let n = 100; n <= 118; n++) {
    const line = preparedByOf({ accountName: "N".repeat(n), role: "partner", company });
    assert.ok(line.length <= PREPARED_BY_LIMIT && line === line.trim() && !line.includes("\n"), line);
    if (line.endsWith(", local partner")) continue; // no room for even a character of the company: the role, as before
    const tail = line.slice(n + 2);
    assert.ok(company.startsWith(tail), "a clean prefix of the company");
    const marks = /[ാ-്ಾ-್]/u;
    const next = company.slice(tail.length, tail.length + 1);
    assert.ok(!marks.test(next), "the cut is not left in front of a vowel sign that belongs to the last letter");
  }
});

test("a company on the owner file or the handover person reaches the line; report.json still wins; old files read as before", () => {
  const owner: OwnerFile = { schema: 1, accountId: "a", accountName: "Divya", company: "Sri Sai Digital", role: "partner", createdAt: "2026-11-01T10:00:00Z", template: "bookings" };
  assert.equal(resolvePreparedBy({ owner })?.name, "Divya, Sri Sai Digital");
  assert.equal(resolvePreparedBy({ owner, report: { schema: 1, preparedBy: "Meera, Kochi partner" } })?.name, "Meera, Kochi partner");
  const assignment: AssignmentFile = { schema: 1, current: { accountId: "b", accountName: "Kiran", company: "Hexa Labs", role: "builder", since: "2026-11-05T10:00:00Z" }, history: [] };
  assert.equal(resolvePreparedBy({ owner, assignment })?.name, "Kiran, Hexa Labs");
  assert.equal(servedByOf(owner, assignment)?.company, "Hexa Labs");
  assert.equal(servedByOf(owner, undefined)?.company, "Sri Sai Digital");
  const old = parseOwner(JSON.stringify({ schema: 1, accountId: "a", accountName: "Divya", role: "partner", createdAt: "2026-11-01T10:00:00Z", template: "bookings" }));
  assert.equal(resolvePreparedBy({ owner: old })?.name, "Divya, local partner");
});

test("the join form asks for a company in every language, keeps it on the account and on the shops the account sets up", async () => {
  for (const lang of ["en", "hi", "ml", "kn"] as const) {
    assert.ok(WORDS[lang].join.company.length > 3 && WORDS[lang].join.companyHelp.length > 10 && WORDS[lang].join.problems["company-bad"].length > 10, lang);
  }
  assert.equal(new Set(["en", "hi", "ml", "kn"].map((l) => WORDS[l as "en"].join.company)).size, 4, "each language has its own words");
  const b = await boot({}, { standins: true });
  try {
    const join_ = async (handle: string, role: "builder" | "partner", company: string) => {
      const anon = new Browser(b.panel.url);
      const link = new URL(b.invite(role)).pathname;
      const page = await anon.get(link);
      assert.match(page.text, /name="company"/u);
      return anon.req("POST", "/join", { _csrf: tokenOf(page.text), token: link.slice("/join/".length), name: handle.toUpperCase(), company, handle, passphrase: PASS, language: "en" });
    };
    const bad = await join_("nocomp", "partner", "x".repeat(61));
    assert.equal(bad.status, 400);
    assert.ok(bad.plain.includes(WORDS.en.join.problems["company-bad"]));
    assert.equal((await join_("plain", "partner", "")).status, 303, "the company is optional");

    const divyaBrowser = new Browser(b.panel.url);
    const link = new URL(b.invite("partner")).pathname;
    const page = await divyaBrowser.get(link);
    const done = await divyaBrowser.req("POST", "/join", { _csrf: tokenOf(page.text), token: link.slice("/join/".length), name: "Divya", company: "  Sri   Sai Digital ", handle: "divya", passphrase: PASS, language: "en" });
    assert.equal(done.status, 303);
    const accounts = JSON.parse(readFileSync(join(b.dir, "panel", "data", "accounts.json"), "utf8")).accounts as { handle: string; company?: string }[];
    assert.equal(accounts.find((a) => a.handle === "divya")?.company, "Sri Sai Digital");
    assert.equal(accounts.find((a) => a.handle === "plain")?.company, undefined);

    const f = await setUp(b, divyaBrowser);
    await divyaBrowser.post(`/setup/${f.draft}/save`, {}, `/setup/${f.draft}/5`);
    const owner = JSON.parse(readFileSync(join(b.dir, "shops", f.shop, "owner.json"), "utf8"));
    assert.equal(owner.company, "Sri Sai Digital");
    assert.equal(preparedByOf(owner), "Divya, Sri Sai Digital");
  } finally { await b.close(); }
});

test("geometer shop add --company: the person's name and the company make report.json's line", async () => {
  const w = world({});
  const add = async (...a: string[]) => {
    const [log, error] = [console.log, console.error]; let err = "";
    console.log = () => {}; console.error = (...m: unknown[]) => { err += `${m.join(" ")}\n`; };
    try { return { code: await main(["shop", "add", ...a, "--from", EXAMPLE_CLIENT, "--server", w.root]), err }; } finally { console.log = log; console.error = error; }
  };
  const said = (n: string) => JSON.parse(readFileSync(join(w.paths.shop(n), "report.json"), "utf8"));
  try {
    assert.equal((await add("one", "--prepared-by", "Divya", "--company", "Sri Sai Digital")).code, 0);
    assert.deepEqual(said("one"), { schema: 1, preparedBy: "Divya, Sri Sai Digital" });
    assert.equal((await add("two", "--prepared-by", "Divya, local partner")).code, 0);
    assert.equal(said("two").preparedBy, "Divya, local partner", "without --company the line is taken as it is");
    const alone = await add("three", "--company", "Sri Sai Digital");
    assert.notEqual(alone.code, 0);
    assert.match(alone.err, /--company goes with --prepared-by/u);
    const tooLong = await add("four", "--prepared-by", "Divya", "--company", "x".repeat(61));
    assert.notEqual(tooLong.code, 0);
    assert.match(tooLong.err, /--company must be/u);
  } finally { w.done(); }
});
