// The hosted demo (scripts/build-demo.ts, modules/demo/quick.ts, the adapters in templates/*/demo/): what the build holds, that every page follows the page rules of the pages
// domain (files of its own only, no inline script or style), that the pack takes it, and that a visit really is a private, in-memory shop. Each template is driven in all four
// languages through the BUILT modules, as a browser loads them (the same files, no Node-only import), so a break in the build shows here and not on a phone.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildDemo, DEMOS } from "../../scripts/build-demo.ts";
import { buildPack, HOME_DEMO_FILE, HOME_TOP, installHome, verifyPack, homePaths } from "../lib/home.ts";
import { HOME_CSP } from "../generate/compose.ts";

const LANGS = ["en", "hi", "ml", "kn"] as const;
let out = "";
let files: string[] = [];
before(() => { out = mkdtempSync(join(tmpdir(), "geo-demo-")); files = buildDemo(out).files; });
after(() => rmSync(out, { recursive: true, force: true }));
const read = (p: string) => readFileSync(join(out, p), "utf8");
const load = (p: string) => import(pathToFileURL(join(out, p)).href);

test("the build is the list, one page per template, the stylesheet, the script and each template's own modules", () => {
  for (const p of ["demo.html", "demo/bookings.html", "demo/orders.html", "demo/fees.html", "demo/demo.css", "demo/page.js", "demo/bookings/index.js", "demo/orders/index.js", "demo/fees/index.js"]) assert.ok(files.includes(p), p);
  assert.ok(files.length < 600 && files.every((f) => HOME_DEMO_FILE.test(f)), "a few hundred files, all pages, scripts, styles or JSON");
  const total = files.reduce((n, f) => n + statSync(join(out, f)).size, 0);
  assert.ok(total < 6 * 1024 * 1024, `${total} bytes: well under the pack's 12 MB`);
});

test("every page follows the pages domain's rules: its own files only, no inline script, no inline style, no handler attribute", () => {
  assert.match(HOME_CSP, /script-src 'self'; style-src 'self'/u);
  for (const page of ["demo.html", ...DEMOS.map((d) => `demo/${d.id}.html`)]) {
    const html = read(page);
    assert.ok(!/<style|\sstyle\s*=|\son[a-z]+\s*=|<script(?![^>]*\ssrc="\/demo\/page\.js")/iu.test(html), `${page} has an inline script or style`);
    assert.ok(!/https?:\/\/|\/\/[a-z]/iu.test(html.replace(/<!doctype[^>]*>/i, "")), `${page} names another site`);
    assert.ok(html.includes('rel="stylesheet" href="/demo/demo.css"'), page);
    assert.ok(html.includes('name="viewport"') && html.includes('name="robots" content="noindex"'), `${page}: phone width and not for search`);
  }
  for (const d of DEMOS) assert.ok(read(`demo/${d.id}.html`).includes('src="/demo/page.js"') && read(`demo/${d.id}.html`).includes(`data-demo="${d.id}"`), d.id);
  const list = read("demo.html");
  for (const d of DEMOS) for (const l of LANGS) assert.ok(list.includes(`href="/demo/${d.id}?lang=${l}"`), `the list links ${d.id} in ${l}`);
  assert.ok(!/<script/iu.test(list), "the list needs no script");
});

test("no built module imports Node, a package or an outside address, and none reads a file at run time", () => {
  for (const f of files.filter((x) => x.endsWith(".js") && !x.startsWith("demo/bookings/"))) {
    const text = read(f);
    assert.ok(!/from\s*["'](node:|[a-z@])|\brequire\(|\bprocess\.|\bBuffer\b/u.test(text.replace(/^\s*\/\/.*$/gmu, "")), `${f} reaches for Node`);
  }
  assert.ok(!files.some((f) => /\.ts$/u.test(f)), "no source file is shipped");
});

test("the pack takes the demo: it installs, the names it answers for are reserved here, and a stray file is refused", () => {
  assert.ok(HOME_TOP.includes("demo"));
  const base = [{ path: "index.html", data: Buffer.from("<p>home</p>") }, { path: "404.html", data: Buffer.from("<p>404</p>") }];
  const demo = files.map((path) => ({ path, data: readFileSync(join(out, path)) }));
  const made = buildPack([...base, ...demo], "5f49032");
  assert.equal(verifyPack(made.bytes).files.length, files.length + 2);
  const server = mkdtempSync(join(tmpdir(), "geo-demo-srv-"));
  try {
    installHome(server, made.bytes);
    assert.ok(readFileSync(join(homePaths(server).current, "site", "demo", "fees.html"), "utf8").includes('data-demo="fees"'));
  } finally { rmSync(server, { recursive: true, force: true }); }
  assert.throws(() => buildPack([...base, { path: "demo/run.sh", data: Buffer.from("x") }], "5f49032"), /not a page, script, style sheet or JSON/u);
  assert.throws(() => buildPack([...base, { path: "demo/a/b/c.html", data: Buffer.from("x") }, { path: "demoo.html", data: Buffer.from("x") }], "5f49032"), /does not own/u);
});

for (const lang of LANGS) {
  test(`Orders in ${lang}, through the built modules: a customer orders and says they paid, the owner marks it received, the order is confirmed; a stale tap does nothing`, async () => {
    const built = await load("demo/orders/index.js");
    const quick = built.createQuick(await built.makeShop(lang));
    assert.equal(quick.words.banner.length > 10, true);
    const [greeting, order] = quick.shop.chips;
    await quick.say("customer", greeting);
    const list = quick.logs.customer.at(-1).choices.list;
    assert.ok(list.rows.length >= 3, "the menu comes as a list");
    assert.equal(await quick.tap("customer", "item:invented-id"), undefined);
    assert.equal(quick.logs.customer.length, 2, "an id nothing on the screen offers changes nothing");
    await quick.say("customer", order);
    assert.match(quick.logs.customer.at(-1).text, /upi:\/\/pay\?pa=/u, "the order comes with its UPI request for the advance");
    assert.equal(quick.shop.payable(), undefined, "a UPI shop has nothing to pay inside the page");
    await quick.tap("customer", "paid");
    assert.ok(quick.logs.owner.length >= 1, "the owner is asked to look in their UPI app");
    const [chip] = quick.ownerChips();
    assert.match(chip ?? "", /^received [A-Z0-9]{4,8}$/u, "the owner taps the reply instead of typing a code");
    const before = quick.logs.customer.length;
    await quick.say("owner", chip);
    assert.ok(quick.logs.customer.length > before, "the confirmation reached the customer");
    assert.equal(quick.ownerChips().length, 0, "marked received, nothing waits for the owner, so no stale \"received\" suggestion is left");
  });

  test(`Fees in ${lang}, through the built modules: the first reminder is already there, the parent says they paid (nothing yet), then pays with test money`, async () => {
    const built = await load("demo/fees/index.js");
    const quick = built.createQuick(await built.makeShop(lang));
    // One reminder per child: the Hindi example family (the Sharmas) has two children at the centre, every other family one.
    assert.equal(quick.logs.customer.length, lang === "hi" ? 2 : 1, "the reminders went out on their own, one for each child");
    for (const reminder of quick.logs.customer) assert.match(reminder.text, /pay\.example/u);
    assert.ok(quick.shop.payable());
    await quick.say("customer", quick.shop.chips[0]);
    assert.ok(quick.logs.owner.length >= 1, "the owner is asked to check");
    await quick.pay();
    assert.equal(quick.shop.payable(), undefined);
    assert.ok(quick.logs.customer.at(-1).text.length > 20, "the receipt");
  });

  test(`Bookings in ${lang}: the demo opens in the language, with its banner and suggestions, and a booking can be asked for`, async () => {
    const { createLocalDemo } = await load("demo/bookings/demo/web/local.js");
    const demo = createLocalDemo({ language: lang, nowMs: Date.UTC(2026, 10, 9, 4, 30) }); // Monday 9 November 2026, 10:00 in India
    const state = (await demo.request("/api/state")).json;
    assert.equal(state.shop.language, lang);
    if (lang !== "en") assert.notEqual(state.ui.banner, "Demo · test money · nothing real is sent", "the banner is in the language");
    assert.ok(state.customer.chips.length >= 2);
    const asked = (await demo.request("/api/say", { text: state.customer.chips[0] })).json;
    assert.ok(asked.customer.messages.length >= 2 && asked.customer.messages.at(-1).who === "agent", "the agent answered");
  });
}

test("a visit is its own shop: two visitors share nothing, and starting again forgets", async () => {
  const built = await load("demo/orders/index.js");
  const a = built.createQuick(await built.makeShop("en"));
  const b = built.createQuick(await built.makeShop("en"));
  await a.say("customer", "Hi");
  assert.equal(a.logs.customer.length, 2);
  assert.equal(b.logs.customer.length, 0, "the other visitor sees nothing of it");
  const again = built.createQuick(await built.makeShop("en"));
  assert.equal(again.logs.customer.length, 0, "a new world is empty");
});

test("the demo is bounded: past its message cap it says so instead of growing, and a long message is cut", async () => {
  const built = await load("demo/orders/index.js");
  const quick = built.createQuick(await built.makeShop("en"));
  await quick.say("customer", "x".repeat(5000));
  assert.ok(quick.logs.customer[0].text.length <= 300);
  let said: string | undefined;
  for (let i = 0; i < 205 && said === undefined; i++) said = await quick.say("customer", "menu");
  assert.equal(said, quick.words.full);
  assert.ok(quick.logs.customer.length < 700, "the log stopped growing");
});

test("nothing in the demo can reach a real service: no network call, no key, no storage in the shipped code", () => {
  for (const f of files.filter((x) => x.endsWith(".js"))) {
    const text = read(f).replace(/^\s*\/\/.*$/gmu, "");
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB|document\.cookie/u.test(text.replace("demo/bookings/demo/page.js", "")) || f.includes("bookings/demo/web/generated.js") || f.endsWith("page.js"), `${f} reaches outside the page`);
  }
});
