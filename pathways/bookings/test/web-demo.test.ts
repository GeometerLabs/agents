// The browser build of the demo (scripts/build-web-demo.ts): "Build your first agent, in the browser".
// The build is made fresh in a temp folder for these tests, so they do not depend on a dist/ having been built.
// The built files are plain ES modules; these tests import them as a browser would (relative paths, no Node-only imports) and run a
// scripted session through them: book a slot with a deposit, then ask for a price below the list and see it refused.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { buildWebDemo, scopeCss } from "../scripts/build-web-demo.ts";
import type { BuildResult } from "../scripts/build-web-demo.ts";

const ROOT = new URL("../", import.meta.url).pathname;
let dist = "";
let built: BuildResult;
before(() => {
  dist = mkdtempSync(join(tmpdir(), "geo-web-demo-"));
  built = buildWebDemo(dist);
});
after(() => { rmSync(dist, { recursive: true, force: true }); });

const load = (path: string) => import(pathToFileURL(join(dist, path)).href);
const builtJs = () => built.files.filter((f) => f.endsWith(".js"));
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"'\n]+)\2/g;

// ---- what the build contains ---------------------------------------------------------------------------------------------

test("web build: no file imports a node: module, a package, or anything that is not in the folder", () => {
  assert.ok(builtJs().length > 20, "the template's modules are there");
  for (const file of builtJs()) {
    const text = readFileSync(join(dist, file), "utf8");
    const code = text.split("\n").filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line)).join("\n"); // comments may mention an import; code may not have one
    for (const [, , , specifier] of code.matchAll(SPECIFIER)) {
      assert.ok(!specifier.startsWith("node:"), `${file} imports ${specifier}`);
      assert.ok(specifier.startsWith("./") || specifier.startsWith("../"), `${file} imports ${specifier}, which is not a file in the folder`);
      assert.ok(specifier.endsWith(".js"), `${file} imports ${specifier}, which a browser cannot load as it is`);
      assert.ok(existsSync(join(dist, dirname(file), specifier)), `${file} imports ${specifier}, which is not there`);
    }
    assert.ok(!/["'`]node:/.test(code), `${file} still names a node: module`);
    assert.ok(!/\brequire\(|\bprocess\.|\bBuffer\b|import\.meta\.dirname|import\.meta\.filename/.test(code), `${file} uses something only Node has`);
  }
});

test("web build: the template's code is the code that runs live, only its types and import names changed", () => {
  const shim = (spec: string) => (spec === "node:fs" ? "demo/web/shims/fs.js" : "demo/web/shims/crypto.js");
  let compared = 0;
  for (const file of builtJs()) {
    const source = file.replace(/\.js$/, ".ts");
    if (!/^(src|demo)\//.test(file) || file.startsWith("demo/web/")) continue;
    const original = stripTypeScriptTypes(readFileSync(join(ROOT, source), "utf8"), { mode: "strip" });
    const expected = original
      .replace(/(["'])(node:fs|node:crypto)\1/g, (_all, q: string, spec: string) => `${q}${relative(dirname(file), shim(spec)).replace(/^(?!\.)/, "./")}${q}`)
      .replace(/(["'])(\.{1,2}\/[^"'\n]+)\.ts\1/g, "$1$2.js$1");
    assert.equal(readFileSync(join(dist, file), "utf8"), expected, `${file} differs from ${source} by more than its types and import names`);
    compared++;
  }
  assert.ok(compared >= 20, `compared ${compared} files`);
  for (const must of ["src/agent.js", "src/limits.js", "src/guard-limits.js", "src/record.js", "src/harness.js", "demo/session.js", "demo/view.js", "demo/api.js"]) {
    assert.ok(built.files.includes(must), `${must} is in the build`);
  }
});

test("web build: the output is a folder to host as it is, and it reports its size", () => {
  for (const file of ["index.js", "package.json", "demo/web/mount.js", "demo/web/local.js", "demo/web/generated.js"]) assert.ok(built.files.includes(file), file);
  assert.ok(built.bytes > 100_000 && built.gzipBytes < built.bytes / 2, `${built.bytes} bytes, ${built.gzipBytes} gzipped`);
  assert.match(readFileSync(join(dist, "index.js"), "utf8"), /export \{ mountDemo \} from "\.\/demo\/web\/mount\.js"/);
});

test("web build: it writes only into an empty folder or its own earlier output", () => {
  const other = mkdtempSync(join(tmpdir(), "geo-web-demo-other-"));
  try {
    writeFileSync(join(other, "notes.txt"), "mine");
    assert.throws(() => buildWebDemo(other), /already holds other files/);
    assert.equal(readFileSync(join(other, "notes.txt"), "utf8"), "mine");
    rmSync(join(other, "notes.txt"));
    assert.doesNotThrow(() => buildWebDemo(other), "an empty folder is fine");
    assert.doesNotThrow(() => buildWebDemo(other), "so is its own earlier output");
  } finally { rmSync(other, { recursive: true, force: true }); }
});

// ---- the stand-ins for node:fs and node:crypto ---------------------------------------------------------------------------

test("web build: the SHA-256 stand-in gives the same fingerprints as Node, so a browser's record equals a live shop's", async () => {
  const mine = await load("demo/web/shims/crypto.js");
  const texts = ["", "a", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64), "x".repeat(65), "x".repeat(1000), "₹450 के लिए", "ഇന്ന് വൈകുന്നേരം", "ನಾಳೆ ಸಂಜೆ", "\u{1F600} outside the BMP", '{"a":1,"b":[true,null]}'];
  for (const text of texts) {
    assert.equal(mine.createHash("sha256").update(text).digest("hex"), createHash("sha256").update(text).digest("hex"), JSON.stringify(text.slice(0, 20)));
  }
  assert.equal(mine.createHash("sha256").update("ab").update("c").digest("hex"), createHash("sha256").update("abc").digest("hex"), "in pieces");
  assert.throws(() => mine.createHash("md5"), /sha256/);
  // The record uses it for real: the built record's fingerprints are the live record's.
  const record = await load("src/record.js");
  const live = await import("../src/record.ts");
  for (const value of [{ b: 1, a: [1, "₹"] }, "text", null, { nested: { z: 1, y: undefined } }]) assert.equal(record.digest(value), live.digest(value));
  const draws = new Set<number>();
  for (let i = 0; i < 200; i++) draws.add(mine.randomInt(10));
  assert.ok([...draws].every((n) => Number.isInteger(n) && n >= 0 && n < 10) && draws.size > 5, "randomInt gives whole numbers in range");
  assert.ok([...Array(50)].every(() => { const n = mine.randomInt(5, 7); return n === 5 || n === 6; }));
  assert.throws(() => mine.randomInt(0), RangeError);
  const { newCode, CODE_ALPHABET } = await load("src/approval-code.js");
  assert.match(newCode(), new RegExp(`^[${CODE_ALPHABET}]{6}$`));
});

test("web build: the file-reading stand-in serves the example shop and nothing else", async () => {
  const { readFileSync: read } = await load("demo/web/shims/fs.js");
  const text = read(new URL("https://example.test/anywhere/dist/settings/glow-salon.example.json"), "utf8");
  assert.equal(text, readFileSync(join(ROOT, "settings/glow-salon.example.json"), "utf8"));
  assert.throws(() => read(new URL("https://example.test/etc/passwd"), "utf8"), { code: "ENOENT" });
  const { glowSalon } = await load("src/harness.js");
  assert.equal(glowSalon().name, "Glow Salon");
});

// ---- a session through the built modules ---------------------------------------------------------------------------------

test("web build: a scripted session in the built modules books a slot with a deposit, then refuses a price below the list", async () => {
  const { zonedToMs } = await load("src/time.js");
  const { createLocalDemo } = await load("demo/web/local.js");
  const demo = createLocalDemo({ nowMs: zonedToMs({ year: 2026, month: 11, day: 3 }, { hour: 10, minute: 0 }, "Asia/Kolkata") }); // Tue 3 Nov, 10:00 in India
  const act = async (path: string, body?: unknown) => {
    const answer = await demo.request(path, body);
    assert.equal(answer.status, 200, JSON.stringify(answer.json));
    return answer.json as any;
  };
  const said = (s: any) => s.customer.messages.filter((m: any) => m.who === "agent").map((m: any) => m.text as string);

  const start = await act("/api/state");
  assert.equal(start.shop.name, "Glow Salon");
  assert.equal(start.ui.banner, "Demo · test money · nothing real is sent");
  assert.deepEqual(start.record.fakes.payments, []);

  // 1. A slot, with a deposit.
  let s = await act("/api/say", { text: "I want a haircut tomorrow at 6pm" });
  assert.equal(s.record.fakes.payments.length, 1);
  assert.equal(s.record.fakes.payments[0].amountInr, 200, "the link is for the deposit");
  assert.equal(s.record.fakes.calendar[0].status, "tentative", "the slot is held, not yet booked");
  assert.ok(s.customer.canPay);
  s = await act("/api/pay", { times: 1 });
  assert.deepEqual(s.record.fakes.calendar.map((e: any) => [e.bookingRef, e.status, e.start]), [["b-1", "confirmed", "Wed 4 Nov, 6:00 pm"]], "booked, from the calendar's own list");
  assert.equal(s.record.fakes.payments[0].status, "paid");
  assert.equal(s.record.fakes.payments[0].paid[0].amountInr, 200);
  assert.ok(said(s).some((t: string) => /Booked!/.test(t)));
  assert.ok(s.owner.summary.some((l: any) => l.kind === "ok" && /in your calendar/.test(l.text)));

  // 2. A price below the list: refused. The link is for the deposit, never the offer.
  s = await act("/api/say", { text: "I want a haircut the day after tomorrow at 6pm, can you do it for ₹300?" });
  assert.ok(said(s).some((t: string) => /₹450/.test(t) && /can't go lower/.test(t)), "it says the list price and that it cannot go lower");
  assert.ok(s.record.fakes.payments.every((l: any) => l.amountInr === 200), "no link is for the offer");
  assert.ok(!s.record.fakes.payments.some((l: any) => l.amountInr === 300));
  const decisions = s.record.rows.flatMap((r: any) => r.decisions);
  assert.ok(decisions.some((d: any) => d.rule === "Price list" && d.verdict === "block" && d.reason.includes("₹300")), "the rule that said no is in the record");
  assert.ok(s.owner.summary.some((l: any) => l.kind === "ok" && l.text.includes("₹300")), "the owner is told it said no to ₹300");
  // Free is a price below the list too.
  s = await act("/api/say", { text: "can I get the haircut tomorrow at 6pm for free?" });
  assert.ok(s.record.fakes.payments.every((l: any) => l.amountInr === 200));

  // The shop form works here too: a new floor, and the same refusal at it.
  const form = structuredClone(s.form);
  form.name = "Asha Tuition";
  form.services[0].name = "Maths class";
  form.services[0].price = "800";
  form.deposit = "240";
  const rebuilt = await act("/api/shop", { form });
  assert.equal(rebuilt.shop.name, "Asha Tuition");
  assert.equal(rebuilt.shop.depositInr, 240);
  assert.deepEqual(rebuilt.record.fakes.payments, [], "a new shop starts with an empty world");
  const again = await act("/api/say", { text: "I want a maths class tomorrow at 6pm, can you do it for ₹500?" });
  assert.ok(again.record.fakes.payments.every((l: any) => l.amountInr === 240), "the deposit link, never the offer");
  assert.ok(again.record.rows.flatMap((r: any) => r.decisions).some((d: any) => d.rule === "Price list" && d.verdict === "block" && d.reason.includes("₹500")));

  // Mistakes in the form come back in plain words, and change nothing.
  const bad = structuredClone(form);
  bad.deposit = "free";
  const refused = await demo.request("/api/shop", { form: bad });
  assert.equal(refused.status, 422);
  assert.ok((refused.json as any).errors.length > 0);
  assert.equal((await act("/api/state")).shop.name, "Asha Tuition");
  // What the page may ask is limited to what the local-network demo allows.
  assert.equal((await demo.request("/api/pay", { times: 5 })).status, 400);
  assert.equal((await demo.request("/api/nothing", {})).status, 404);
  assert.equal((await demo.request("/api/say", { text: "" })).status, 400);
});

test("web build: the page's own script gets the answers it expects, shaped like fetch", async () => {
  const { createLocalDemo } = await load("demo/web/local.js");
  const demo = createLocalDemo();
  const state = await demo.fetch("/api/state", {});
  assert.equal(state.ok, true);
  assert.equal(((await state.json()) as any).shop.name, "Glow Salon");
  const refused = await demo.fetch("/api/say", { method: "POST", body: JSON.stringify({ text: "" }) });
  assert.equal(refused.ok, false);
  assert.match(((await refused.json()) as any).error, /Write a message first/);
  const notJson = await demo.fetch("/api/say", { method: "POST", body: "{" });
  assert.equal(notJson.ok, false);
  const hindi = createLocalDemo({ language: "hi" });
  assert.match(((await (await hindi.fetch("/api/state", {})).json()) as any).ui.banner, /डेमो/);
  assert.throws(() => createLocalDemo({ language: "xx" }), /not one this demo knows/);
});

// ---- the page: labels, markup, styles ----------------------------------------------------------------------------------------

test("web build: both labels are always there, and the markup has every element the page's script looks for", async () => {
  const mount = await load("demo/web/mount.js");
  const generated = await load("demo/web/generated.js");
  assert.equal(mount.GUARD_NOTE, "In this demo the template's own code checks the limit. On a live shop, Guard holds it outside the AI.");
  assert.ok(generated.MARKUP.includes("Demo · test money · nothing real is sent"), "the banner is in the markup before any script runs");
  assert.ok(!/<script|<noscript/i.test(generated.MARKUP) && !/\son[a-z]+\s*=/i.test(generated.MARKUP));
  const mountSource = readFileSync(join(ROOT, "demo/web/mount.ts"), "utf8");
  assert.ok(mountSource.includes("GUARD_NOTE") && /notes\.append\(banner, note\)/.test(mountSource), "the second label is its own element beside the banner, which the page's script rewrites");
  const script = readFileSync(join(ROOT, "demo/page.js"), "utf8");
  const wanted = new Set([...script.matchAll(/\$\("([A-Za-z-]+)"\)/g)].map((m) => m[1]));
  for (const name of ["Customer", "Owner", "Record"]) { wanted.add(`tab${name}`); wanted.add(`panel-${name.toLowerCase()}`); } // $("tab" + ...) and $("panel-" + ...)
  const have = new Set([...generated.MARKUP.matchAll(/\sid="([A-Za-z-]+)"/g)].map((m) => m[1]));
  assert.ok(wanted.size > 30);
  assert.deepEqual([...wanted].filter((id) => !have.has(id)), [], "the markup has an element for every id the script uses");
  // The script is the page's own, whole, with the browser's pieces handed in.
  assert.ok(readFileSync(join(dist, "demo/web/generated.js"), "utf8").includes(script), "the page's script is in the build whole");
  assert.equal(generated.startPage.length, 5);
  assert.equal(mount.mountDemo.length, 1, "mountDemo(element, options?)");
});

test("web build: every style rule is under the root class, so it cannot reach the host page", async () => {
  const { CSS } = await load("demo/web/generated.js");
  const heads = [...CSS.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((h) => !h.startsWith("@"));
  assert.ok(heads.length > 80, `${heads.length} rules`);
  for (const head of heads) for (const selector of head.split(",").map((s) => s.trim())) assert.ok(selector === ".geo-demo" || selector.startsWith(".geo-demo ") || selector.startsWith(".geo-demo:") || selector.startsWith(".geo-demo>"), `a rule outside the root class: ${selector}`);
  assert.ok(!/(^|[\s,}])(html|body|:root|\*)\s*[,{]/.test(CSS.replace(/\.geo-demo \*/g, "")), "no bare html, body, :root or * is left");
  assert.match(CSS, /\.geo-demo \{ all: initial; \}/, "the host page's text styles stop at the edge");
  assert.ok(/\.geo-demo \.banner \{/.test(CSS) && /\.geo-demo \.tabbar \{/.test(CSS) && /\.geo-demo > \.sheet \{[^}]*position: static/.test(CSS), "the page's fixed bars are held inside the frame");
  // scopeCss on its own, including the shapes in page.css: lists, :root, *, pseudo-classes and @media.
  const scoped = scopeCss(":root { --a: 1; }\n* { box-sizing: border-box; }\nbody { margin: 0; }\nbutton, input { font: inherit; }\nbutton.btn:hover:not(:disabled) { x: y; }\n@media (min-width: 700px) { body { font-size: 18px; } .a { b: c; } }\n");
  assert.equal(scoped, [
    ".geo-demo { --a: 1; }",
    ".geo-demo,\n.geo-demo * { box-sizing: border-box; }",
    ".geo-demo { margin: 0; }",
    ".geo-demo button,\n.geo-demo input { font: inherit; }",
    ".geo-demo button.btn:hover:not(:disabled) { x: y; }",
    "@media (min-width: 700px) {\n.geo-demo { font-size: 18px; }\n.geo-demo .a { b: c; }\n}",
    "",
  ].join("\n"));
  assert.throws(() => scopeCss("@font-face { src: url(x); }"), /does not handle/);
  assert.throws(() => scopeCss(".a { b: c; "), /without its/);
});

test("web build: the mount code adds no way for typed text to become markup", () => {
  const source = readFileSync(join(ROOT, "demo/web/mount.ts"), "utf8").replace(/\/\/[^\n]*/g, "");
  const uses = [...source.matchAll(/\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\()/g)].map((m) => m[1]);
  assert.deepEqual(uses, ["innerHTML"], "the only markup written is the build's fixed markup");
  assert.ok(/template\.innerHTML = MARKUP;/.test(source), "and it is only that");
  assert.ok(/attachShadow\(\{ mode: "open" \}\)/.test(source) && /host\.remove\(\)/.test(source), "the demo lives in a shadow root of its own, which unmount takes out");
  const both = source + readFileSync(join(ROOT, "demo/web/local.ts"), "utf8");
  assert.deepEqual([...both.matchAll(/(\w+[. ])fetch\(/g)].map((m) => m[1]).sort(), ["async ", "local."], "the only fetch is the in-page demo's own");
  assert.ok(!/XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB|document\.cookie/.test(both), "no network, no storage, no cookies");
});
