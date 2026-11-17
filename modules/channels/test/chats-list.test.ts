// W3 (17 Nov 2026), the shop's side of the Streetlist app: the list entry the chat page writes (its plain-JavaScript rules, run against a fake storage), the install prompt's
// rules and words, the page served through the Streetlist door (the manifest link, the list, the install slot, the app's worker only with a relay) and not served anywhere
// else, and that the page's script is still valid JavaScript with all of it in. Written 17 Nov, not run when written.
//
// When the streetlist checkout sits beside this one (or STREETLIST_DIR names it) the rules are also checked against that site's own reader and words, so the two copies cannot drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { CHATS_KEY, CHATS_LIST_WORDS, CHATS_MAX_SHOPS, CHATS_VERSION, INSTALL_SCRIPT, INSTALL_SNOOZE_MS, JOIN_SCRIPT } from "../chats-list.ts";
import { chatPage } from "../chat-page.ts";
import { LANGUAGES } from "../../language/languages.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** A fake localStorage. `broken`: every call throws, as a blocked store does. */
function storage(initial?: unknown, broken = false) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(CHATS_KEY, JSON.stringify(initial));
  return { data, getItem: (k: string) => { if (broken) throw new Error("blocked"); return data.get(k) ?? null; }, setItem: (k: string, v: string) => { if (broken) throw new Error("blocked"); data.set(k, v); } };
}
const run = (store: ReturnType<typeof storage>, entry: unknown, extra = "") => vm.runInNewContext(`${JOIN_SCRIPT};${extra};joinChat(entry);`, { localStorage: store, entry, Date, JSON, Math, Array, RegExp, Number, String });
const doc = (store: ReturnType<typeof storage>) => JSON.parse(store.data.get(CHATS_KEY) ?? "null") as { v: number; visits: number; dismissedAt?: number; shops: Record<string, unknown>[] };
const entry = (o: Record<string, unknown> = {}) => ({ slug: "glow-salon", name: "Glow Salon", face: "/glow-salon/character/well.svg", paint: "E91E8C", last: "Your slot is confirmed", lastBy: "shop", at: 1_000, seen: 3, answered: true, ...o });

test("the key and version are the Streetlist site's: the customer's whole list lives under them", () => {
  assert.equal(CHATS_KEY, "streetlist-chats");
  assert.equal(CHATS_VERSION, 1);
});

test("a shop joins the list with a checked entry; joined is set once; seen only goes up; answered is never taken back", () => {
  const s = storage();
  run(s, entry());
  const first = doc(s).shops[0]!;
  assert.deepEqual({ slug: first.slug, name: first.name, face: first.face, paint: first.paint, last: first.last, lastBy: first.lastBy, at: first.at, seen: first.seen, answered: first.answered }, { slug: "glow-salon", name: "Glow Salon", face: "/glow-salon/character/well.svg", paint: "e91e8c", last: "Your slot is confirmed", lastBy: "shop", at: 1_000, seen: 3, answered: true });
  assert.equal(typeof first.joined, "number");
  run(s, entry({ seen: 1, answered: false, last: undefined, at: undefined }));
  const again = doc(s).shops[0]!;
  assert.equal(doc(s).shops.length, 1, "the same shop again is one row");
  assert.equal(again.joined, first.joined);
  assert.equal(again.seen, 3, "seen never goes back");
  assert.equal(again.answered, true);
  assert.equal(again.last, "Your slot is confirmed", "no new line given: the old one stays");
});

test("what is written is what the Streetlist reader accepts: a bad slug, no name, a foreign face or a bad paint is dropped, text is cut", () => {
  const s = storage();
  for (const bad of [{ slug: "Glow" }, { slug: "../x" }, { slug: "a--b" }, { slug: "12345" }, { name: "" }, { name: "   " }, null, undefined, "str"]) run(s, bad === null || bad === undefined || typeof bad === "string" ? bad : entry(bad));
  assert.equal(s.data.has(CHATS_KEY), false, "nothing is written for a bad entry");
  run(s, entry({ face: "https://evil.example/x.svg", paint: "red", name: "N".repeat(200), last: "L".repeat(500) }));
  const e = doc(s).shops[0]!;
  assert.equal(e.face, undefined);
  assert.equal(e.paint, undefined);
  assert.equal((e.name as string).length, 60);
  assert.equal((e.last as string).length, 120);
  run(s, entry({ slug: "vidya-tuition", name: "Vidya", face: "/glow-salon/character/well.svg" }));
  assert.equal(doc(s).shops.find((x) => x.slug === "vidya-tuition")!.face, undefined, "another shop's picture is not accepted as this shop's");
});

test("other things in the document are kept: visits and the install snooze; the newest activity first; at most the cap", () => {
  const s = storage({ v: 1, visits: 7, dismissedAt: 555, shops: [{ slug: "old-shop", name: "Old", seen: 0, joined: 1, answered: false, at: 5 }] });
  run(s, entry());
  const d = doc(s);
  assert.equal(d.visits, 7);
  assert.equal(d.dismissedAt, 555);
  assert.deepEqual(d.shops.map((x) => x.slug), ["glow-salon", "old-shop"]);
  const many = storage({ v: 1, visits: 0, shops: Array.from({ length: CHATS_MAX_SHOPS + 5 }, (_, i) => ({ slug: `shop-${String(i).padStart(2, "0")}`, name: `S${i}`, seen: 0, joined: 1, answered: false, at: 10 + i })) });
  run(many, entry({ at: 99_999 }));
  assert.equal(doc(many).shops.length, CHATS_MAX_SHOPS);
  assert.equal(doc(many).shops[0]!.slug, "glow-salon");
});

test("another version or a broken document is replaced by a fresh one; a blocked store never throws", () => {
  const other = storage({ v: 9, shops: "x" });
  run(other, entry());
  assert.equal(doc(other).v, 1);
  const broken = storage(); broken.data.set(CHATS_KEY, "{nope");
  assert.doesNotThrow(() => run(broken, entry()));
  assert.equal(doc(broken).shops.length, 1);
  assert.doesNotThrow(() => run(storage(undefined, true), entry()));
});

test("the install snooze: not now holds the prompt back for 14 days", () => {
  const s = storage();
  const ask = (now: number) => vm.runInNewContext(`${JOIN_SCRIPT};chatsSnoozed()`, { localStorage: s, Date: { now: () => now }, JSON, Math, Array, RegExp, Number, String });
  assert.equal(ask(1_000), false);
  vm.runInNewContext(`${JOIN_SCRIPT};snoozeChats()`, { localStorage: s, Date: { now: () => 1_000 }, JSON, Math, Array, RegExp, Number, String });
  assert.equal(doc(s).dismissedAt, 1_000);
  assert.equal(ask(1_000 + INSTALL_SNOOZE_MS - 1), true);
  assert.equal(ask(1_000 + INSTALL_SNOOZE_MS + 1), false);
  assert.equal(INSTALL_SNOOZE_MS, 14 * 24 * 3600 * 1000);
  assert.doesNotThrow(() => vm.runInNewContext(`${JOIN_SCRIPT};snoozeChats();chatsSnoozed()`, { localStorage: storage(undefined, true), Date, JSON, Math, Array, RegExp, Number, String }));
});

// ---- the page ----

const shop = { name: "Glow Salon", languages: [...LANGUAGES], paused: false, character: { face: "well" as const, picture: "data:image/svg+xml;base64,AAAA" }, contact: { phone: "+919811111111" } };
const page = (o: Record<string, unknown> = {}) => chatPage({ shop, kind: "bookings", language: "en", base: "https://streetlist.in/glow-salon/chat", home: "https://streetlist.in/glow-salon", nonce: "N0NCE", thread: { lines: [], answered: false, capped: false, retentionDays: 30 }, onStreetlist: true, fontUrl: "https://streetlist.in/glow-salon/chat/font.woff2", pushKey: "RELAYKEY", pushVia: { sw: "https://streetlist.in/sw.js", scope: "https://streetlist.in/" }, ...o });
const scriptOf = (html: string) => /<script nonce="N0NCE">([\s\S]*?)<\/script>/u.exec(html)![1]!;

test("through the door the page links the app (manifest, iPhone icon), a Your chats link, the install slot, and the list entry; the script is still valid JavaScript", () => {
  const html = page();
  assert.match(html, /<link rel="manifest" href="https:\/\/streetlist\.in\/manifest\.webmanifest">/u);
  assert.match(html, /<link rel="apple-touch-icon" href="https:\/\/streetlist\.in\/apple-touch-icon\.png">/u);
  assert.match(html, /<a href="\/chats">Your chats<\/a>/u);
  assert.match(html, /id="install-slot"[^>]*hidden/u);
  assert.match(html, /id="install-go"[^>]*hidden/u);
  assert.match(html, /id="install-ios"[^>]*hidden/u);
  assert.match(html, /class="share-i"/u, "the iPhone hint has the Share icon");
  const script = scriptOf(html);
  assert.doesNotThrow(() => new vm.Script(script), "the page's script has a syntax error");
  assert.match(script, /const joinChat/u);
  assert.match(script, /installMaybe\(\)/u);
  assert.match(script, /"\/" \+ slugNow \+ "\/character\/well\.svg"/u);
  assert.match(html, /data-signer="streetlist"/u);
  assert.match(html, /data-sw="https:\/\/streetlist\.in\/sw\.js" data-scope="https:\/\/streetlist\.in\/"/u);
});

test("the install prompt waits for an answer: the slot is hidden at first and the script shows it only after the shop has replied", () => {
  const fresh = scriptOf(page());
  assert.match(fresh, /answeredSeen = false/u);
  assert.match(fresh, /if \(answeredSeen\) installMaybe\(\);/u, "an answered chat shows it on load; an unanswered one only when a reply arrives");
  const answered = scriptOf(page({ thread: { lines: [{ n: 1, who: "shop", text: "Hello", atMs: 1 }], answered: true, capped: false, retentionDays: 30 } }));
  assert.match(answered, /answeredSeen = true/u);
  assert.match(fresh, /d\.answered\) \{ answeredSeen = true;[^}]*installMaybe\(\)/u, "a reply arriving by the poll shows it");
});

test("a page not through the door has no app, no list and no install slot, and keeps the shop's own worker and key", () => {
  const html = page({ onStreetlist: false, pushVia: undefined, pushKey: "OWNKEY" });
  assert.doesNotMatch(html, /manifest|install-slot|joinChat|apple-touch-icon|\/chats/u);
  assert.match(html, /data-sw="https:\/\/streetlist\.in\/glow-salon\/chat\/sw\.js"/u);
  assert.doesNotMatch(html, /data-signer/u);
  assert.doesNotThrow(() => new vm.Script(scriptOf(html)));
});

test("a shop through the door with push off still joins the list and offers the app, but names no worker of the app", () => {
  const html = page({ pushKey: undefined, pushVia: undefined });
  assert.match(html, /id="install-slot"/u);
  assert.doesNotMatch(html, /id="alerts"/u);
  assert.doesNotThrow(() => new vm.Script(scriptOf(html)));
});

test("the install script's own rules: never when installed, never while snoozed, the browser's button or the iPhone line", () => {
  assert.match(INSTALL_SCRIPT, /display-mode: standalone/u);
  assert.match(INSTALL_SCRIPT, /navigator\.standalone/u);
  assert.match(INSTALL_SCRIPT, /chatsSnoozed\(\)/u);
  assert.match(INSTALL_SCRIPT, /beforeinstallprompt/u);
  assert.match(INSTALL_SCRIPT, /iphone\|ipad\|ipod/u);
  assert.match(INSTALL_SCRIPT, /snoozeChats\(\)/u);
  assert.doesNotThrow(() => new vm.Script(`(function(){${JOIN_SCRIPT}${INSTALL_SCRIPT}})`));
});

// ---- the words ----

test("the install words exist in all four languages, in each script, with no banned word", () => {
  const keys = Object.keys(CHATS_LIST_WORDS.en).sort();
  for (const l of LANGUAGES) {
    assert.deepEqual(Object.keys(CHATS_LIST_WORDS[l]).sort(), keys, l);
    for (const [k, v] of Object.entries(CHATS_LIST_WORDS[l])) {
      assert.ok(v.length > 0, `${l}.${k}`);
      assert.doesNotMatch(v, /\b(safe|guaranteed?|proves?|certified|earn|income|bot|founder)\b|100\s?%/iu, `${l}.${k}`);
    }
  }
  assert.match(CHATS_LIST_WORDS.hi.installHead, /[ऀ-ॿ]/u);
  assert.match(CHATS_LIST_WORDS.ml.installHead, /[ഀ-ൿ]/u);
  assert.match(CHATS_LIST_WORDS.kn.installHead, /[ಀ-೿]/u);
  assert.match(CHATS_LIST_WORDS.en.iphone, /Share.*Add to Home Screen/u);
});

function streetlist(): string | undefined {
  const candidates = [process.env.STREETLIST_DIR, resolve(here, "../../../../streetlist"), resolve(here, "../../../../../../../streetlist")].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(join(p, "src/client/chats-store.ts")));
}

test("the Streetlist site's own reader and words agree with these (when its checkout is beside this one)", (t) => {
  const dir = streetlist();
  if (!dir) { t.skip("the streetlist checkout is not beside this one (set STREETLIST_DIR)"); return; }
  const store = readFileSync(join(dir, "src/client/chats-store.ts"), "utf8");
  assert.match(store, new RegExp(`CHATS_KEY = "${CHATS_KEY}"`, "u"));
  assert.match(store, new RegExp(`CHATS_VERSION = ${CHATS_VERSION}\\b`, "u"));
  assert.match(store, new RegExp(`MAX_SHOPS = ${CHATS_MAX_SHOPS}\\b`, "u"));
  assert.match(store, new RegExp(`INSTALL_SNOOZE_MS = 14 \\* 24 \\* 3600 \\* 1000`, "u"));
  const words = readFileSync(join(dir, "src/chats-words.ts"), "utf8");
  for (const l of LANGUAGES) {
    for (const [mine, theirs] of [["installHead", "installTitle"], ["installBody", "installBody"], ["installButton", "installButton"], ["notNow", "notNow"], ["iphone", "iphone"], ["yourChats", "title"]] as const) {
      const text = (CHATS_LIST_WORDS[l] as unknown as Record<string, string>)[mine]!;
      assert.ok(words.includes(`${theirs}: ${JSON.stringify(text)}`), `${l}.${mine} is not the same line as the site's ${theirs}`);
    }
  }
});
