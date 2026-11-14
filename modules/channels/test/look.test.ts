// Plan item 11i's design pass: the rules the shared look keeps (channels/look.ts, words-look.ts) that a screenshot cannot hold by itself. Nothing in a sheet loads
// anything or reads the phone's own colour setting; dark is only in the owner's app, behind the switch; the new words exist in four languages with no banned word;
// a page that reloads itself leaves the face's picture out; and the owner's app still runs exactly one script, in its head, by the response's nonce.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER_CSS, OWNER_CSS, SIGNIN_CSS, THEME_KEY, themeScript } from "../look.ts";
import { OWNER_LOOK, STAMP, STAMP_TONE } from "../words-look.ts";
import { bookingPage, statusPage } from "../page.ts";
import { ownerPage } from "../owner-page.ts";
import { LANGUAGES } from "../../language/languages.ts";
import type { BookingView, Offer, OwnerView } from "../backend.ts";

const PICTURE = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E";
const OFFER: Offer = {
  shop: { name: "Glow Salon", timezone: "Asia/Kolkata", languages: ["en", "hi"], deposit: { amountInr: 200, holdMinutes: 60 }, cancellation: { windowHours: 24 }, payment: { kind: "upi", payee: "Glow Salon" }, paused: false, character: { face: "busy", picture: PICTURE } },
  services: [{ id: "haircut", names: { en: "Haircut", hi: "हेयरकट", ml: "ഹെയർകട്ട്", kn: "ಹೇರ್‌ಕಟ್" }, priceInr: 450, durationMinutes: 30 }],
  serviceId: "haircut", days: [{ date: "2026-11-16", starts: [Date.UTC(2026, 10, 16, 5, 0), Date.UTC(2026, 10, 16, 5, 30)] }],
};
const SHOP = { name: "glow", publicUrl: "https://pages.example/glow" };
const booking = (status: "held" | "booked"): BookingView => ({ status, ref: "b-1", channel: "web", service: OFFER.services[0], startMs: Date.UTC(2026, 10, 16, 5, 0), depositInr: 200, holdExpiresAt: Date.UTC(2026, 10, 16, 4, 30), canCancel: true, canSayPaid: true, messages: [] });
const OWNER_VIEW: OwnerView = {
  shop: { name: "Glow Salon", timezone: "Asia/Kolkata", ownerLanguage: "en" }, services: OFFER.services, items: [], upcoming: [],
  app: { character: { style: "clay", personality: "warm" }, mood: "quiet", face: "well", closedToday: false, today: [], waiting: [], cards: [], talk: [], listen: true },
};

test("the sheets load nothing and never read the phone's colour setting; dark tokens are the owner's app's only", () => {
  for (const [name, css] of Object.entries({ CUSTOMER_CSS, OWNER_CSS, SIGNIN_CSS })) {
    for (const banned of ["url(", "@import", "@font-face", "prefers-color-scheme", "</"]) assert.ok(!css.includes(banned), `${name}: ${banned}`);
    assert.ok(!/gradient|blur\(|glow/iu.test(css), `${name}: flat colours only, no gradients or glows`);
  }
  assert.ok(OWNER_CSS.includes(':root[data-theme="dark"]'));
  assert.ok(!CUSTOMER_CSS.includes("data-theme") && !SIGNIN_CSS.includes("data-theme"), "the customer's pages have no dark: nothing can pick it there");
  assert.doesNotThrow(() => new Function(themeScript([])));
  assert.ok(themeScript([]).includes(`localStorage.getItem("${THEME_KEY}")`));
});

test("the new words: every stamp and tag in four languages, each its own, none of the banned words", () => {
  for (const language of LANGUAGES) {
    assert.deepEqual(Object.keys(STAMP[language]).sort(), Object.keys(STAMP_TONE).sort(), language);
    assert.deepEqual(Object.keys(OWNER_LOOK[language].tag).sort(), Object.keys(OWNER_LOOK.en.tag).sort(), language);
    for (const word of [...Object.values(STAMP[language]), ...Object.values(OWNER_LOOK[language].tag), OWNER_LOOK[language].theme]) {
      assert.ok(word.trim().length > 0, language);
      assert.doesNotMatch(word, /\b(safe|guaranteed|proves?|certified|100%|bot|earn|income)\b/iu, `${language}: ${word}`);
    }
  }
  for (const language of ["hi", "ml", "kn"] as const) assert.notDeepEqual(STAMP[language], STAMP.en, `${language} is translated`);
});

test("the customer's page: the face and the mood chip in the head, times as tiles with their radios, no script; a page that reloads itself leaves the picture out", () => {
  const page = bookingPage({ shop: SHOP, offer: OFFER, language: "en", serviceId: "haircut", date: "2026-11-16" });
  assert.ok(page.includes('<img class="face-c"') && page.includes('class="mood m-busy"'), "the face and the mood in its colour");
  assert.match(page, /<label><input type="radio" name="start" value="\d+" required checked><span>/u, "a time is a radio inside its tile");
  assert.ok(!/<script|style="/iu.test(page), "no script and no inline style");
  const held = statusPage({ shop: SHOP, offer: OFFER, language: "en", handle: "h".repeat(32), view: booking("held") });
  assert.ok(held.includes('http-equiv="refresh"') && !held.includes("<img"), "held reloads itself every 15 s: no picture");
  assert.ok(held.includes('class="mood m-busy"'), "the mood in words stays");
  assert.match(held, /class="state s-wait"><span class="stamp">Held<\/span>/u, "a held booking wears an amber stamp");
  const booked = statusPage({ shop: SHOP, offer: OFFER, language: "en", handle: "h".repeat(32), view: booking("booked") });
  assert.ok(booked.includes('<img class="face-c"') && /class="state s-ok"><span class="stamp">Booked<\/span>/u.test(booked), "booked: the face, and a green stamp");
});

test("the owner's app: with a nonce, one script, in the head, and the dark/light switch; without one, no script and no switch", () => {
  const withApp = ownerPage({ base: "https://pages.example/glow/owner", language: "en", view: OWNER_VIEW, relayAsks: [], nonce: "bm9uY2Utb25l", csrf: "c".repeat(32) });
  assert.equal(withApp.match(/<script/gu)?.length, 1, "one script");
  assert.ok(withApp.indexOf('<script nonce="bm9uY2Utb25l">') < withApp.indexOf("</head>"), "in the head, so a dark pick is set before the first paint");
  assert.ok(withApp.includes('id="theme"') && withApp.includes('id="talk-rec" hidden'));
  const plain = ownerPage({ base: "https://pages.example/glow/o/x", language: "en", view: { ...OWNER_VIEW, app: undefined }, relayAsks: [] });
  assert.ok(!/<script|id="theme"/u.test(plain));
  assert.match(plain, /class="calm"/u, "nothing waiting: a calm line");
});
