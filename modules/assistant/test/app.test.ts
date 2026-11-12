// The owner's app pieces that do not wait for item 11d (item 11e, modules/assistant/app): the manifest scoped to the owner's own link, the service worker that keeps
// the last page for reading and never touches a POST, the talk box that works without JavaScript and escapes what it shows, and the view the page is drawn from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNER_APP_SW, ownerAppManifest } from "../app/pwa.ts";
import { talkBox } from "../app/talk.ts";
import { ownerAppView } from "../app/view.ts";
import { LANGUAGES } from "../../language/languages.ts";
import { defaultCharacter } from "../character.ts";
import { emptyAssistantState } from "../state.ts";
import { makeCard } from "../cards.ts";
import type { OwnerSkill } from "../skill.ts";
import { zonedToMs } from "../../core/time.ts";

const BASE = "https://shop.example/s/glow/o/abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456";

test("the manifest opens this shop's owner page and nothing else, in the owner's language and the character's colour", () => {
  for (const language of LANGUAGES) {
    const m = ownerAppManifest({ base: BASE, shop: "Glow Salon", language, colour: "pink" });
    assert.equal(m.start_url, `${BASE}/`);
    assert.equal(m.scope, `${BASE}/`);
    assert.equal(m.lang, language);
    assert.equal(m.theme_color, "#be185d");
    assert.equal(m.display, "standalone");
    assert.match(String((m.icons as { src: string }[])[0].src), /^data:image\/svg\+xml;base64,/u);
  }
});

test("the service worker keeps the page for reading only: a POST is never cached, kept or replayed", () => {
  assert.match(OWNER_APP_SW, /req\.method === "GET"/u);
  assert.match(OWNER_APP_SW, /if \(!isPage\) return;/u);
  // no queue of taps: no background-sync listener, no store to keep requests in, no messages to replay them ("async" in the code is not one of these)
  assert.ok(!/addEventListener\("sync"|indexedDB|postMessage|\breplay/u.test(OWNER_APP_SW), "no queue of taps");
  assert.match(OWNER_APP_SW, /x-owner-app-offline/u);
});

test("the talk box works without JavaScript, posts to the link, hides the record button until the phone can record, and escapes what it shows", () => {
  for (const language of LANGUAGES) {
    const html = talkBox({ base: BASE, language, assistantName: "Mithra", lines: [{ atMs: 1, from: "owner", text: "<script>alert(1)</script>" }, { atMs: 2, from: "assistant", text: "Closed Sun 15 Nov." }] });
    assert.ok(html.includes(`<form method="post" action="${BASE}/talk">`));
    assert.ok(html.includes('<button type="button" id="talk-rec" hidden'));
    assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(html.includes('"audio/ogg;codecs=opus"'), "a voice note in the format WhatsApp's have");
  }
});

test("the view: the mood, today's list and the open cards by id and digest, never a code", () => {
  const tz = "Asia/Kolkata";
  const day = { year: 2026, month: 11, day: 12 };
  const now = zonedToMs(day, { hour: 11, minute: 0 }, tz);
  const skill: OwnerSkill = {
    name: "bookings", routing: { refs: /^b-\d+$/u, buttonPrefixes: [], words: {}, liveCaseOf: () => undefined },
    day: () => [{ case: "b-1", startMs: now + 30 * 60_000, what: "haircut", who: "Priya", state: "confirmed" }],
    waiting: () => [], problems: () => 0, hours: () => ({ open: 600, close: 1200 }),
    prepare: () => ({ ok: false, why: "busy" }), execute: async () => ({ ok: false, note: "failed" }),
  };
  const state = emptyAssistantState();
  const { code } = makeCard(state, { kind: "refund", skill: "bookings", case: "b-1", fields: { who: "Priya", amountPaise: 20_000, paymentId: "pay_1" } }, {}, now);
  const view = ownerAppView({ skills: [skill], state, nowMs: now, timeZone: tz, settings: { morningAt: null, character: defaultCharacter() } });
  assert.equal(view.mood, "waiting_for_owner");
  assert.equal(view.sticker, "round-teal-waiting_for_owner");
  assert.equal(view.today.length, 1);
  assert.deepEqual(view.cards.map((c) => [c.case, c.amountPaise, c.who]), [["b-1", 20_000, "Priya"]]);
  assert.ok(!JSON.stringify(view).includes(code));
});
