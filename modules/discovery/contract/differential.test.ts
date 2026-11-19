// The directory's answers to a fixed set of requests over a fixed set of shops, compared WHOLE with golden answers (golden/differential.json.gz): the search in four languages and
// Latin letters, every filter and refusal, every page state in four languages (the whole HTML, the response's nonce aside), the order page, the MCP endpoint, the notices, the
// assistant's answers to scripted model replies, and the headers that matter. A difference here is a difference a buyer, an assistant or a shop could see.
//
// Where the golden answers come from: until 19 Nov 2026 this test ran the TypeScript service and the Go service side by side and compared them. Before the TypeScript directory was
// deleted (decision 61, wave 1c), its answers were RECORDED here (`DIRECTORY_GOLDEN=write` with the TypeScript service, at the agents commit named in the file, impl "ts"; recorded twice,
// identical; the TypeScript and the Go service both matched it), so the Go directory is now held to what the TypeScript said. After an intended change to what the directory says (a word
// in modules/discovery/words.ts, a page change), record again with the Go directory and read the difference before committing it:
//
//   DIRECTORY_GOLDEN=write node --test --test-concurrency=1 modules/discovery/contract/differential.test.ts
//
// and read the difference before committing it. Time: the order turns by the day (India's), the pages say "Confirmed today", and a shop's answer counts only when it is from just now.
// So the golden file keeps the instant it was recorded, and a replay runs the fake shops (harness `now()`) and the Go directory (its test clock) at that instant; the few dates that
// still differ by the seconds a run takes (ISO times in JSON) are masked. A recording is refused between 23:40 and 01:10 in India, so a run never crosses midnight.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { IMPL, REPO, SKIP, directoryWith, fakeShop, item, now, setClockOffset, startFakeModel, typed, until } from "./harness.ts";
import type { Directory, FakeDoor, FakeModel, FakeShop } from "./harness.ts";

const GOLDEN = process.env.DIRECTORY_GOLDEN_FILE ?? join(dirname(fileURLToPath(import.meta.url)), "golden", "differential.json.gz");
const WRITE = process.env.DIRECTORY_GOLDEN === "write";
interface Golden { about: string; recordedAt: number; impl: string; commit: string; answers: { what: string; path: string; answer: unknown }[] }

const KEPT = ["content-type", "cache-control", "x-robots-tag", "access-control-allow-origin", "permissions-policy", "retry-after", "allow", "referrer-policy", "x-content-type-options", "content-security-policy", "set-cookie", "vary", "content-language"];
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/gu;
const mask = (v: unknown): unknown => typeof v === "string" ? v.replace(ISO, "<time>") : Array.isArray(v) ? v.map(mask) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mask(x)])) : v;
const sha = (b: string | Buffer): string => `sha256:${createHash("sha256").update(b).digest("hex")}`;
/**
 * What of an answer is compared: the status, the headers that matter, the body (JSON parsed; a font by its hash), with the nonce and ISO times masked. A page's style sheet is the same
 * on every page and compared by its hash, which keeps the golden file small.
 */
function norm(r: { status: number; text: string; headers: Headers }, raw?: ArrayBuffer): unknown {
  const csp = r.headers.get("content-security-policy") ?? "";
  const nonce = /'nonce-([A-Za-z0-9_-]+)'/u.exec(csp)?.[1];
  const headers: Record<string, string | null> = {};
  for (const k of KEPT) headers[k] = r.headers.get(k)?.replace(nonce ?? "\u0000", "NONCE") ?? null;
  const type = r.headers.get("content-type") ?? "";
  let body: unknown = (nonce ? r.text.replaceAll(nonce, "NONCE") : r.text).replace(/<style>([\s\S]*?)<\/style>/u, (_m, css: string) => `<style>${sha(css)}</style>`);
  if (type.startsWith("font/") && raw) body = sha(Buffer.from(raw));
  else if (type.startsWith("application/json")) { try { body = JSON.parse(r.text); } catch { /* keep the text */ } }
  return mask({ status: r.status, headers, body });
}

/** India's time of day, in minutes. */
const istMinutes = (ms: number): number => Math.floor(((ms + 19_800_000) % 86_400_000) / 60_000);

// ---- the world: the same shops, items and model every run --------------------------------------------------------------------------------------------------

/** Shops made to reach every state a buyer can see: a shop that answers, one that does not, one whose answer drops and reprices, one with no map point, words in some languages only, text that must be escaped, more than ten results. */
function shops(): FakeShop[] {
  const a = fakeShop("rani-pets", { name: "Rani Pets", town: "Thrissur", lat: "10.527642" });
  a.items = [item(a.page, "l-3"), item(a.page, "l-4", { title: { en: "Persian cat toy <b>&</b>" }, text: {}, price: { value: "1234567.50", currency: "INR" }, quantity: 1000 }), item(a.page, "l-5", { price: null, availability: "call_to_check", photos: [] }),
    item(a.page, "l-6", { category: "food", title: { en: "Cat food", ml: "പൂച്ച ഭക്ഷണം" }, text: {}, ownerLanguage: "en", machineWritten: ["ml"], price: { value: "450.00", currency: "INR", note: "a packet" } })];
  const b = fakeShop("kochi-cycles", { name: "Kochi \"Cycles\" & Co", town: "Kochi", lat: "9.9312", lon: "76.2673" });
  b.items = [item(b.page, "b-1", { category: "vehicles_and_cycles", title: { en: "Second-hand bicycle", hi: "पुरानी साइकिल", ml: "പഴയ സൈക്കിൾ", kn: "ಹಳೆಯ ಸೈಕಲ್" }, text: {}, machineWritten: [], ownerLanguage: "en", price: { value: "3000.00", currency: "INR" } })];
  // no map point, in Thrissur; never answers a check (an error at once, so no search waits): its items are shown from the index with "Call to check"
  const c = fakeShop("silent-tailor", { name: "Silent Tailor", town: "Thrissur" });
  c.items = [item(c.page, "s-1", { category: "clothes", title: { en: "Cotton kurta", ml: "കോട്ടൺ കുർത്ത" }, text: { ml: "തയ്യൽ" }, ownerLanguage: "ml", machineWritten: ["en"], price: { value: "799.00", currency: "INR", note: "per piece <i>stitched</i>" }, quantity: 3 })];
  c.checkAnswer = () => ({ status: 500, body: "{}" });
  // its answer says one item is gone and gives another a new price and count
  const d = fakeShop("gone-shop", { name: "<script>alert(1)</script> & \"Shop\"", town: "Kunnamkulam <b>", lat: "10.6500", lon: "76.0700" });
  d.items = [item(d.page, "g-1", { title: { en: "Kitten <img src=x onerror=alert(1)>" } }), item(d.page, "g-2", { category: "pets", title: { en: "Parrot", kn: "ಗಿಳಿ" }, text: {}, ownerLanguage: "en", machineWritten: ["kn"] })];
  d.checkAnswer = (ids, at) => ({ format: "shop-check/1", page: d.page, at, items: ids.map((id) => (id === "g-1" ? { id, availability: "gone" } : { id, availability: "in_stock", price: { value: "999.00", currency: "INR" }, quantity: 1 })) });
  // twelve listings, so there is a second page
  const e = fakeShop("big-market", { name: "Big Market", town: "Thrissur", lat: "10.5200", lon: "76.2100" });
  e.items = Array.from({ length: 12 }, (_, j) => item(e.page, `m-${j}`, { title: { en: `Kitten number ${j}`, ml: "പൂച്ചക്കുട്ടി", hi: "बिल्ली" }, category: j % 3 ? "pets" : "home", price: { value: `${1000 + j * 10}.00`, currency: "INR" } }));
  return [a, b, c, d, e];
}

/** The model: its answer chosen by the question it is sent (so the answers do not depend on the order of calls). */
function modelReply(user: string): unknown {
  if (/zebra/iu.test(user)) return typed({ words: ["zebra"], words_en: ["zebra"] });
  if (/cheap/iu.test(user)) return typed({ words: ["kitten"], words_en: ["kitten"], category: "pets", max_price: 1050 });
  if (/പൂച്ച|बिल्ली|ಬೆಕ್ಕು/u.test(user)) return typed({ words: ["പൂച്ച"], words_en: ["kitten"], category: "pets", place: "none" });
  if (/near me/iu.test(user)) return typed({ words: ["bicycle"], words_en: ["bicycle"], place: "near_me" });
  return typed({ words: ["kitten"], words_en: ["kitten"], category: "pets", place: "town", town: "Thrissur" });
}

// ---- the requests --------------------------------------------------------------------------------------------------------------------------------------------

type Ask = (what: string, path: string, o?: Parameters<Directory["call"]>[1]) => Promise<void>;

async function requests(d: Directory, shopList: FakeShop[], ask: Ask): Promise<void> {
  const qs = ["kitten", "persian", "പൂച്ച", "ಬೆಕ್ಕಿನ", "बिल्ली", "billi", "poocha", "bekku", "bicycle", "साइकिल", "pets", "kitten thrissur", "bicycle thrissur", "nothing-here", "kitten near me",
    "%E0%B4%AA%E0%B5%82%E0%B4%9A%E0%B5%8D%E0%B4%9A", "a+b", "<script>", "kurta", "കുർത്ത", "cat food", "food", "parrot", "ಗಿಳಿ", "toy", "number", "THRISSUR", "kitten dog thrissur"];
  for (const lang of ["", "&lang=hi", "&lang=ml", "&lang=kn"]) for (const q of qs) {
    await ask("json", `/search?format=json&q=${q}${lang}`);
    await ask("page", `/search?q=${q}${lang}`);
  }
  for (const extra of ["&lat=10.52&lon=76.21", "&lat=10.52&lon=76.21&radius_km=10", "&lat=10.52&lon=76.21&radius_km=5&town=Thrissur", "&town=Kochi", "&town=THRISSUR", "&town=%E0%B4%A4%E0%B5%83%E0%B4%B6%E0%B5%8D%E0%B4%B6%E0%B5%82%E0%B5%BC",
    "&category=pets", "&category=clothes", "&category=weapons", "&lat=10", "&radius_km=0", "&offset=10", "&offset=5", "&lat=1e1&lon=2", "&lang=fr"]) {
    for (const lang of ["", "&lang=hi", "&lang=ml", "&lang=kn"]) {
      await ask("filters json", `/search?format=json&q=kitten${extra}${lang}`);
      await ask("filters page", `/search?q=kitten${extra}${lang}`);
    }
  }
  // no words: a category alone, everything, the second page and the last
  for (const path of ["/search?format=json&category=pets", "/search?category=pets&lang=ml", "/search?format=json", "/search?format=json&offset=10", "/search?q=kitten&offset=10", "/search?format=json&q=kitten&offset=10&lang=hi", "/search?q=&category=home"]) await ask("no words", path);
  for (const path of ["/search", "/search?lang=hi", "/search?lang=ml", "/search?lang=kn", "/search?category=pets", "/order", "/order/", "/order?lang=hi", "/order?lang=ml", "/order?lang=kn", "/healthz", "/nowhere", "/search/ask", "/feed-changed", "/mcp", "/search/../order", "/search%2Fx", "/search/font.woff2"]) await ask("page", path);
  await ask("accept json", "/search?q=kitten", { headers: { accept: "application/json" } });
  await ask("accept both", "/search?q=kitten", { headers: { accept: "text/html,application/json" } });
  for (const al of ["kn-IN, en;q=0.5", "hi", "ml-IN", "fr, ta;q=0.9", ""]) await ask("accept-language", "/search", { headers: { "accept-language": al } });
  // the limit pages, in four languages: forty searches a minute from one address, then "wait a minute"
  for (const lang of ["", "&lang=hi", "&lang=ml", "&lang=kn"]) {
    const who = d.visitor();
    for (let i = 0; i < 40; i++) await d.call(`/search?format=json&q=kitten${lang}`, { who });
    await ask("busy page", `/search?q=kitten${lang}`, { who });
    await ask("busy json", `/search?format=json&q=kitten${lang}`, { who });
  }
  const page = (slug: string) => shopList.find((s) => s.slug === slug)!.page;
  const mcp: unknown[] = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, { jsonrpc: "2.0", id: "a", method: "tools/list" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_listings", arguments: { q: "kitten", lang: "hi" } } },
    { jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "search_listings", arguments: { q: "kurta", lang: "kn" } } },
    { jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "search_listings", arguments: { category: "weapons" } } },
    { jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "search_listings", arguments: { q: "kitten", offset: 10, lat: "10.52", lon: "76.21" } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_listing", arguments: { shop: page("rani-pets"), id: "l-4" } } },
    { jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "get_listing", arguments: { shop: page("silent-tailor"), id: "s-1" } } },
    { jsonrpc: "2.0", id: 32, method: "tools/call", params: { name: "get_listing", arguments: { shop: page("gone-shop"), id: "g-1" } } },
    { jsonrpc: "2.0", id: 33, method: "tools/call", params: { name: "get_listing", arguments: { shop: page("gone-shop"), id: "g-2" } } },
    { jsonrpc: "2.0", id: 34, method: "tools/call", params: { name: "get_listing", arguments: { shop: "https://pages.example/nobody/", id: "x" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "shop_page", arguments: { shop: page("rani-pets"), lang: "ml" } } },
    { jsonrpc: "2.0", id: 41, method: "tools/call", params: { name: "shop_page", arguments: { shop: page("gone-shop"), lang: "kn" } } },
    { jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "shop_page", arguments: { shop: page("big-market") } } },
    { jsonrpc: "2.0", id: 43, method: "tools/call", params: { name: "shop_page", arguments: { shop: "https://pages.example/nobody/" } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_listing", arguments: { shop: page("rani-pets"), id: "nope" } } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "ask", arguments: { question: "kitten near Thrissur" } } },
    { jsonrpc: "2.0", id: 61, method: "tools/call", params: { name: "ask", arguments: { question: "zebra please", lang: "ml" } } },
    { jsonrpc: "2.0", id: 62, method: "tools/call", params: { name: "ask", arguments: {} } },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: 5 } }, { jsonrpc: "2.0", id: 8, method: "nope" }, { jsonrpc: "1.0", id: 9, method: "ping" }, { id: 10 }, null, 5, [], [{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }],
    { jsonrpc: "2.0", method: "notifications/initialized" },
  ];
  for (const body of mcp) await ask("mcp", "/mcp", { body });
  await ask("mcp junk", "/mcp", { raw: "{not json", headers: { "content-type": "application/json" } });
  await ask("mcp too big", "/mcp", { raw: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", pad: "x".repeat(17_000) }), headers: { "content-type": "application/json" } });
  // the per-buyer cap of the `ask` tool: twelve a day, then the plain search
  const asker = d.visitor();
  for (let i = 0; i < 13; i++) await ask("mcp ask cap", "/mcp", { who: asker, body: { jsonrpc: "2.0", id: 100 + i, method: "tools/call", params: { name: "ask", arguments: { question: "kitten near Thrissur" } } } });
  // notices: refused ones answer the same
  const shop = fakeShop("rani-pets");
  for (const body of [{}, [], { format: "shop-feed-changed/1" }, shop.notice({ feed: "https://other.example/x/listings.json" }), shop.notice({ feed: "https://pages.example/x/other.json" })]) await ask("notice", "/feed-changed", { body });
  // the assistant over a form: the page and the JSON, in four languages, and its other answers
  for (const lang of ["en", "hi", "ml", "kn"]) {
    for (const accept of ["application/json", "text/html"]) await ask("ask", "/search/ask", { form: { ask: "Persian kitten near Thrissur?", lang }, headers: { accept, origin: "https://pages.example" } });
    await ask("ask own words", "/search/ask", { form: { ask: lang === "hi" ? "बिल्ली चाहिए" : lang === "kn" ? "ಬೆಕ್ಕು ಬೇಕು" : "പൂച്ച വേണം", lang }, headers: { origin: "https://pages.example" } });
    await ask("ask nothing found", "/search/ask", { form: { ask: "a zebra please", lang }, headers: { origin: "https://pages.example" } });
  }
  await ask("ask near me", "/search/ask", { form: { ask: "a bicycle near me", lat: "10.52", lon: "76.21" }, headers: { origin: "https://pages.example" } });
  await ask("ask cheap", "/search/ask", { form: { ask: "a cheap kitten under 1050 rupees within 10 km", lat: "10.52", lon: "76.21" }, headers: { origin: "https://pages.example", accept: "application/json" } });
  await ask("ask private words", "/search/ask", { form: { ask: "my name is Ravi Kumar, call 98470 12345, house no 12/4 MG Road, kitten?" }, headers: { origin: "https://pages.example", accept: "application/json" } });
  await ask("ask, empty", "/search/ask", { form: { ask: " " }, headers: { origin: "https://pages.example" } });
  await ask("ask, other site", "/search/ask", { form: { ask: "kitten" }, headers: { origin: "https://evil.example" } });
  await ask("ask, in the address", "/search?ask=kitten");
  await ask("ask, GET", "/search/ask?ask=kitten");
}

// ---- the run -------------------------------------------------------------------------------------------------------------------------------------------------

async function world(clock: boolean): Promise<{ d: Directory; door: FakeDoor; model: FakeModel; list: FakeShop[] }> {
  const list = shops();
  const model = await startFakeModel();
  model.replyFor = modelReply;
  const { d, door } = await directoryWith(list, { assistant: { model }, clock });
  await until("the shops to be read", async () => ((await d.searchJson({ q: "kitten" })).body.results?.length ?? 0) > 0);
  return { d, door, model, list };
}

const golden = (): Golden | undefined => (existsSync(GOLDEN) ? JSON.parse(gunzipSync(readFileSync(GOLDEN)).toString("utf8")) as Golden : undefined);

test(WRITE ? "record the directory's answers as the golden file" : "the same requests, the same answers as the golden file", { skip: SKIP }, async () => {
  let g: Golden | undefined;
  if (WRITE) {
    const m = istMinutes(Date.now());
    assert.ok(m < 23 * 60 + 40 && m > 70, "not recorded between 23:40 and 01:10 in India: a run must not cross midnight, the day the order turns on");
  } else {
    g = golden();
    assert.ok(g, `there is no golden file at ${GOLDEN}`);
    // the directory runs on its test clock at the recorded instant, and the fake shops with it
    setClockOffset(g.recordedAt - Date.now());
  }
  const recordedAt = now();
  const { d, door, model, list } = await world(!WRITE);
  try {
    const got: Golden["answers"] = [];
    const differences: string[] = [];
    let i = 0;
    await requests(d, list, async (what, path, o = {}) => {
      const r = await d.call(path, { who: o.who ?? d.visitor(), ...o });
      const raw = (r.headers.get("content-type") ?? "").startsWith("font/") ? await (await fetch(`${d.base}${path}`, { headers: { "x-forwarded-for": d.visitor() } })).arrayBuffer() : undefined;
      const answer = norm(r, raw);
      if (g) {
        const want = g.answers[i];
        assert.ok(want, `request ${i} (${what} ${path}) is not in the golden file: record it again`);
        assert.equal(want.path, path, `request ${i}: the golden file's requests are not this test's: record it again`);
        // every difference is collected (and the first ones shown whole) so one run shows them all
        try { assert.deepEqual(answer, want.answer); } catch (e) { differences.push(`${what}: ${path} (request ${i})\n${String((e as Error).message).slice(0, 3000)}`); }
      }
      got.push({ what, path, answer });
      i++;
    });
    // the Agent Card: its body (its signature is over a key made by this run)
    const card = await d.call("/.well-known/agent-card.json");
    const { signatures: _s, ...body } = card.body;
    const cardAnswer = mask({ status: card.status, body });
    if (g) {
      assert.deepEqual(differences.slice(0, 8), [], `${differences.length} answers differ from the golden file (the first 8 shown)`);
      assert.equal(got.length, g.answers.length - 1, "as many answers as the golden file holds");
      assert.deepEqual(cardAnswer, g.answers.at(-1)!.answer, "the Agent Card's body");
      assert.ok(card.body.signatures[0].protected.length > 0);
    }
    got.push({ what: "card", path: "/.well-known/agent-card.json", answer: cardAnswer });
    if (WRITE) {
      let commit = "";
      try { commit = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* no git */ }
      const out: Golden = { about: "The directory's answers to differential.test.ts's requests, recorded by that test (DIRECTORY_GOLDEN=write); masked: nonces, ISO times, the card's signature.", recordedAt, impl: IMPL, commit, answers: got };
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, gzipSync(Buffer.from(JSON.stringify(out)), { level: 9 }));
    }
    assert.ok(model.calls > 0, "the assistant asked the model");
  } finally {
    await d.stop();
    await door.close();
    await model.close();
    setClockOffset(0);
  }
});
