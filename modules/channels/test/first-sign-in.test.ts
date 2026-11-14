// The owner's first sign-in and "who to call" (release-flow batches 3 and 5, 14 Nov 2026), the pieces that need no server: the pages file carries the partner, the shop's
// phone and a map link (and drops a bad one); the partner bar and the shop's links; the passkey page's Chrome fallback, screen-lock words and fresh-QR words; the
// owner's app's alerts line and step 2; and that no new words use a word the pages must not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES } from "../../language/languages.ts";
import { chromeIntent, passkeyButton } from "../owner-passkey-page.ts";
import { isMapLink, readPagesFile } from "../pages-file.ts";
import { partnerBar, sendLinkBox, shopContact, telLink } from "../contact-bar.ts";
import { FIRST_WORDS } from "../words-owner-first.ts";

const base = { schema: 1, base: "https://s.example/s/glow", ownerBase: "https://s.example/s/glow/owner" };

test("pages.json carries the partner, the shop's phone (a landline too) and a map link with a query; a bad one is dropped, not the file", () => {
  const f = readPagesFile(JSON.stringify({ ...base, phone: "+918012345678", map: "https://www.google.com/maps/search/?api=1&query=Glow+Salon", partner: { name: "Divya", phone: "+919800000000" } }))!;
  assert.equal(f.phone, "+918012345678");
  assert.equal(f.map, "https://www.google.com/maps/search/?api=1&query=Glow+Salon");
  assert.deepEqual(f.partner, { name: "Divya", phone: "+919800000000" });
  const bad = readPagesFile(JSON.stringify({ ...base, phone: "98000", map: "https://evil.example/maps", partner: { name: "", phone: "+919800000000" } }))!;
  assert.equal(bad.phone, undefined); assert.equal(bad.map, undefined); assert.equal(bad.partner, undefined);
  assert.equal(isMapLink("https://maps.app.goo.gl/AbC123"), true);
  assert.equal(isMapLink("http://maps.app.goo.gl/AbC123"), false, "https only");
  assert.equal(isMapLink('https://www.google.com/maps"onclick="x'), false, "no quote or markup");
});

test("the partner bar names the partner with a call link and a WhatsApp link, in every language; nothing without a partner", () => {
  for (const l of LANGUAGES) {
    const bar = partnerBar(l, { partner: { name: "Divya", phone: "+91 98000 00000".replace(/\s/gu, "") } }).markup;
    assert.match(bar, /href="tel:\+919800000000"/u);
    assert.match(bar, /href="https:\/\/wa\.me\/919800000000"/u);
    assert.ok(bar.includes("Divya"));
  }
  assert.equal(partnerBar("en", undefined).markup, "");
  assert.equal(telLink("+91 98000-00000"), "tel:+919800000000");
});

test("the shop's links: call and map, nothing when it has neither; the share link carries the page's address", () => {
  const c = shopContact("hi", { phone: "+918012345678", map: "https://maps.app.goo.gl/AbC123" }).markup;
  assert.match(c, /tel:\+918012345678/u); assert.match(c, /maps\.app\.goo\.gl/u);
  assert.equal(shopContact("en", {}).markup, "");
  const s = sendLinkBox("en", "Glow Salon", "https://s.example/glow/b/abc").markup;
  assert.match(s, /https:\/\/wa\.me\/\?text=Glow%20Salon%3A%20https%3A%2F%2Fs\.example%2Fglow%2Fb%2Fabc/u);
});

test("the passkey button carries the Chrome fallback (an intent link and the address to copy) and the screen-lock words", () => {
  const b = passkeyButton({ mode: "register", options: "/o", finish: "/f", label: "Go", language: "en", address: "https://s.example/glow/owner/setup/TOKEN" }).markup;
  assert.match(b, /id="pk-alt"[^>]* hidden/u, "hidden until the script finds the browser cannot make a passkey");
  assert.match(b, /intent:\/\/s\.example\/glow\/owner\/setup\/TOKEN#Intent;scheme=https;package=com\.android\.chrome;end/u);
  assert.match(b, /data-nolock="Your phone needs a screen lock/u);
  assert.equal(chromeIntent("https://a.b/c?d=1"), "intent://a.b/c?d=1#Intent;scheme=https;package=com.android.chrome;end");
});

test("the new words are in four languages, plain, and use none of the words the pages must not", () => {
  const banned = /\b(safe|safely|guaranteed?|proves?|certified|earn|income|bot|leaderboard|streak|founder)\b|100%/iu;
  for (const l of LANGUAGES) {
    const w = FIRST_WORDS[l];
    const all = Object.values(w).map((v) => (typeof v === "function" ? v(2 as never) : v)).concat([w.partner("Divya"), w.alertsOn(1)]);
    for (const t of all) { assert.ok(String(t).length > 0); assert.doesNotMatch(String(t), banned); }
  }
  assert.equal(FIRST_WORDS.en.alertsOn(1), "Alerts: on, on 1 phone");
});
