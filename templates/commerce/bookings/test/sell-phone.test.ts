// The phone-first parts of the three sell guides (Bookings, Orders, Fees), checked together because they are the same text in every guide (14 Nov 2026, batch 2a):
// the three pieces a partner copies (the partners' WhatsApp group, "Your first week", the letter-of-intent message) are in each guide word for word AND as
// standalone files the sites link to; the pilot fee line is in section 6; the placeholders (DEMO_URL, PARTNER_GROUP_LINK) are there until real addresses replace them;
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

test("the placeholders are there, the same in every language: the group's link, the hosted demo's address, and the pilot fee line in section 6", () => {
  for (const t of TEMPLATES) for (const l of LANGUAGES) {
    const guide = file(t, `guide.${l}.src.md`);
    assert.equal(guide.split("PARTNER_GROUP_LINK").length - 1, 1, `${t} ${l}: one PARTNER_GROUP_LINK placeholder`);
    assert.equal(guide.split("`DEMO_URL`").length - 1, 1, `${t} ${l}: one DEMO_URL placeholder line`);
    assert.ok(guide.includes("10:00") && guide.includes("19:00"), `${t} ${l}: the group's hours`);
    assert.ok(guide.includes("hello@geometer.dev"));
    const six = guide.split(/^## 7\. /m)[0].split(/^## 6\. /m)[1];
    assert.ok(/2027/.test(six) && /31/.test(six), `${t} ${l}: section 6 has the pilot fee line (join before 31 January 2027)`);
  }
});

test("no laptop, Node command, Wi-Fi address or stale status line is left in any guide", () => {
  for (const t of TEMPLATES) for (const l of LANGUAGES) {
    const guide = file(t, `guide.${l}.src.md`);
    assert.ok(!/192\.168|node templates\/[a-z]+\/[a-z]+\/(demo|scripts\/walkthrough)|Ctrl\+C/.test(guide), `${t} ${l}: no laptop demo command`);
    assert.ok(!/not built yet|As of 3 November 2026|As of [58] November 2026/i.test(guide), `${t} ${l}: no stale status line`);
    assert.ok(!/Meta business portfolio/.test(guide), `${t} ${l}: not the Meta-direct route`);
  }
});
