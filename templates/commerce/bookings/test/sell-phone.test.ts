// The phone-first parts of the three sell guides (Bookings, Orders, Fees), checked together because they are the same text in every guide (14 Nov 2026, batch 2a):
// the three pieces an Operator copies (the help line, which is write-to-hello@geometer.dev until an Operators' WhatsApp group exists, "Your first week", the letter-of-intent message)
// are in each guide word for word AND as standalone files the sites link to; the pilot fee line is in section 6; the hosted demo's addresses are in section 4 (no placeholder is left);
// no laptop, Node, Wi-Fi or printer is needed. The per-template tests (sell-guide.test.ts) check the rest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { bannedIn } from "../../../../modules/report/claims.ts";

const TEMPLATES = ["commerce/bookings", "commerce/orders", "education/fees"];
const file = (t: string, name: string) => readFileSync(new URL(`../../../${t}/sell/${name}`, import.meta.url), "utf8");
const PIECES = ["partner-group", "first-week", "letter-of-intent"] as const;
const numbers = (text: string) => [...new Set((text.match(/\d[\d,]*/g) ?? []).map((x) => x.replace(/,/g, "")))].sort();
/** The standalone file's body: everything after its title, its banner and its one-line note. */
const body = (text: string) => { const parts = text.trim().split("\n\n"); return parts.slice(parts[1].startsWith(">") ? 3 : 2).join("\n\n").trim(); };

test("the three pieces are in every guide word for word, and stand alone as files in every language", () => {
  for (const t of TEMPLATES) for (const l of LANGUAGES) {
    const guide = file(t, `guide.${l}.src.md`);
    for (const piece of PIECES) {
      const standalone = file(t, `${piece}.${l}.md`);
      const b = body(standalone);
      assert.ok(b.length > 200, `${t} ${piece}.${l}.md has a body`);
      assert.ok(guide.includes(b), `${t} ${l}: ${piece} in the guide is the standalone file's text, word for word`);
      if (l !== "en") assert.ok(/Machine-written/.test(standalone) && /native speaker/.test(standalone), `${t} ${piece}.${l}.md carries the machine-written banner`);
      assert.deepEqual(bannedIn(standalone, l), [], `${t} ${piece}.${l}.md has no banned word`);
      if (l !== "en") assert.deepEqual(numbers(b), numbers(body(file(t, `${piece}.en.md`))), `${t} ${piece}.${l}.md has the same numbers as the English`);
    }
  }
});

const DEMO = { "commerce/bookings": "bookings", "commerce/orders": "orders", "education/fees": "fees" } as const;

test("the hosted demo's address for the template is in section 4 with one address per language, and no placeholder is left anywhere", () => {
  for (const t of TEMPLATES) for (const l of LANGUAGES) {
    const guide = file(t, `guide.${l}.src.md`);
    const url = `https://streetlist.in/demo/${DEMO[t as keyof typeof DEMO]}`;
    const four = guide.split(/^## 5\. /m)[0].split(/^## 4\. /m)[1];
    assert.ok(four.includes(`\`${url}\``), `${t} ${l}: the template's demo address is in section 4`);
    for (const code of ["hi", "ml", "kn"]) assert.ok(four.includes(`\`${url}?lang=${code}\``), `${t} ${l}: the address for ?lang=${code}`);
    assert.ok(four.includes("`?lang=en`") && four.includes("`https://streetlist.in/demo`"), `${t} ${l}: the English form and the landing page`);
    assert.ok(four.includes("https://streetlist.in/examples/"), `${t} ${l}: the example pages are still named, as pictures`);
    for (const piece of ["guide", "partner-group", "first-week", "letter-of-intent"]) {
      const text = piece === "guide" ? guide : file(t, `${piece}.${l}.md`);
      assert.ok(!/DEMO_URL|PARTNER_GROUP_LINK/.test(text), `${t} ${l} ${piece}: no placeholder left`);
    }
    assert.ok(!/Until that address is here|एड्रेस यहाँ नहीं|वह पता यहाँ नहीं/.test(guide), `${t} ${l}: no "until the address is here" sentence`);
  }
});

test("the help line is the email address, with the hours, in every guide and its standalone piece; no WhatsApp group is promised", () => {
  for (const t of TEMPLATES) for (const l of LANGUAGES) {
    const guide = file(t, `guide.${l}.src.md`);
    const help = body(file(t, `partner-group.${l}.md`));
    assert.ok(help.includes("```text\nhello@geometer.dev\n```"), `${t} ${l}: the standalone help piece has the email line`);
    assert.ok(help.includes("10:00") && help.includes("19:00"), `${t} ${l}: the help hours`);
    assert.ok(guide.includes(help), `${t} ${l}: the guide has the help piece word for word`);
    assert.ok(!/WhatsApp group|WhatsApp ग्रुप|WhatsApp ഗ്രൂപ്പ്|WhatsApp ഗ്രൂപ്പിൽ|WhatsApp ಗುಂಪ|partners' group/.test(guide), `${t} ${l}: no Operators' WhatsApp group is mentioned`);
    const six = guide.split(/^## 7\. /m)[0].split(/^## 6\. /m)[1];
    assert.ok(/2027/.test(six) && /31/.test(six), `${t} ${l}: section 6 has the pilot fee line (join before 31 January 2027)`);
  }
});

test("no laptop, Node command, Wi-Fi address or stale status line is left in any guide", () => {
  for (const t of TEMPLATES) for (const l of LANGUAGES) {
    const guide = file(t, `guide.${l}.src.md`);
    assert.ok(!/192\.168|node templates\/[a-z]+\/[a-z]+\/(demo|scripts\/walkthrough)|Ctrl\+C/.test(guide), `${t} ${l}: no laptop demo command`);
    assert.ok(!/not built yet|As of 3 November 2026/i.test(guide), `${t} ${l}: no stale status line`);
    assert.ok(!/Meta business portfolio/.test(guide), `${t} ${l}: not the Meta-direct route`);
  }
});
