// The Bookings demo kept honest against the Go shop (decision 61; modules/test/contract/demo-differential.ts says how). The public demo (demo/session.ts) runs the
// TypeScript agent on src/harness.ts createWorld; this walks the demo's own paths on that world and on the Go shop (a "guards" shop on the real clock, its WhatsApp read from
// the stand-in behind the fake Guard), with the demo's shop (settings/glow-salon.example.json, glowSalon()), the demo's customer and the demo's own sentences (chipsFor: the
// chips the page offers, made for the instant the walk starts), and compares every WhatsApp message each person was sent after each step.
//
// The demo's paths walked: a booking from the first chip, the deposit paid, the haggling chip (the price refusal and the other free times as a list), a time picked from that
// list, a deposit paid twice (the second payment goes back), cancelling (the deposit goes back), the "next week" chip, "Talk to the owner" (the owner is told), and "yes".
// Not walked here, with where their words are held instead: time passing (the hold that lapses after 15 minutes, the reminder and the booking done: the demo's "+1 hour"
// buttons) needs the test clock, which a guards shop does not take, and the in-memory stand-ins of a "fakes" shop keep no outbox to read, so the agent's words when time passes
// are held by go/internal/bookings/testdata/scenarios-vectors.json (the agent on scripted conversations, the clock moved, the words sent and the record lines) and by
// flow.contract.test.ts (hold expiry and reminders on the beat, in a fakes shop). The owner's "approve"/"deny" answers need a refund that Guard holds above the owner's limit,
// which the demo's shop never asks for (its deposit is under the limit); money.contract.test.ts walks that path on the Go shop.
//
// What is normalised (differs by design between two runs, nothing else): a payment link's id (the stand-in numbers links per process, and the guards stand-in serves more than
// this one shop's links in its life) and the booking page's random handle.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CUSTOMER, PAGE, contract, makeShop } from "./harness.ts";
import { handleHash, newHandle } from "../../../../modules/channels/handle.ts";
import type { Shop } from "./harness.ts";
import { createWorld, glowSalon } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { chipsFor } from "../demo/session.ts";
import { applyLanguage } from "../demo/personalise.ts";
import { validateSettings } from "../src/settings.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { assertBites, walk } from "../../../../modules/test/contract/demo-differential.ts";
import type { Normalise, Side, Step } from "../../../../modules/test/contract/demo-differential.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });

const RULES: Normalise = [
  [/https:\/\/pay\.example\/[A-Za-z0-9_]+/gu, "<payment link>"],
  [/\/b\/[A-Za-z0-9_-]{32}/gu, "/b/<handle>"],
];

interface Both { w: World; s: Shop; chips: string[] }

/** The deposit link of the customer's newest booking on each side, paid `times` times by the customer, and the provider's webhooks delivered. */
const payTS = async (b: Both, times: number): Promise<void> => {
  const booking = [...b.w.store.bookings.values()].reverse().find((x) => x.customer === CUSTOMER && x.linkId);
  const link = booking ? b.w.linkFor(booking.id) : undefined;
  if (!link) throw new Error("the demo has no deposit link to pay");
  for (let i = 0; i < times; i++) b.w.payments.customerPays(link.id);
  await b.w.deliverPaymentEvents();
};
const payGo = async (b: Both, times: number): Promise<void> => {
  const link = b.s.guards!.standins.fakes.payments.links().at(-1);
  if (!link) throw new Error("the Go shop made no deposit link");
  const events = []; for (let i = 0; i < times; i++) events.push(...b.s.guards!.pay(link.id));
  await b.s.events(events.map((event) => ({ kind: "payment_event", event })));
  await b.s.settle();
};
/** The id of the first list row on the newest message to the customer that has a list (the TypeScript demo's; the Go shop must have sent the same row, or the walk failed before). */
const firstRow = (b: Both): string => b.w.messaging.sentTo(CUSTOMER).reverse().find((m) => m.interactive?.list)!.interactive!.list!.rows[0].id;

/** A number that holds no booking (25 Nov 2026): it names the customer's booking. */
const STRANGER = "+919833333333";

const say = (n: number | "last"): Step<Both> => ({
  name: `the customer says chip ${n}`,
  ts: (b) => b.w.say(n === "last" ? b.chips.at(-1)! : b.chips[n]),
  go: (b) => b.s.inbound(CUSTOMER, n === "last" ? b.chips.at(-1)! : b.chips[n]),
});
/** The walk, for the chips the demo offers in a language: four in English and Hindi (book, haggle, next week, yes), three in Malayalam and Kannada (book, haggle, yes). */
const stepsFor = (chips: string[]): Step<Both>[] => [
  say(0),
  { name: "the customer pays the deposit", ts: (b) => payTS(b, 1), go: (b) => payGo(b, 1) },
  // 25 Nov 2026 (modules/record/case-asked.ts): another number names that booking: the one line that shows nothing, and the owner's notice
  { name: "another number names the booking (B1)", ts: (b) => b.w.say("what about B1?", { from: STRANGER }).then(() => undefined), go: (b) => b.s.inbound(STRANGER, "what about B1?").then(() => undefined) },
  say(1),
  { name: "the customer picks the first free time of the list", ts: (b) => b.w.tap(firstRow(b)), go: (b) => b.s.tap(firstRow(b)) },
  { name: "the customer pays that deposit twice (two phones): the second payment goes back, and the owner is told", ts: (b) => payTS(b, 2), go: (b) => payGo(b, 2) },
  { name: "the customer cancels", ts: (b) => b.w.say("cancel").then(() => b.w.deliverPaymentEvents()), go: (b) => b.s.inbound(CUSTOMER, "cancel") },
  ...(chips.length > 3 ? [say(2)] : []),
  { name: "the customer taps Talk to the owner", ts: (b) => b.w.tap("owner"), go: (b) => b.s.tap("owner") },
  say("last"),
];

describe("the Bookings demo and the Go shop say the same on the demo's paths", () => {
  for (const language of LANGUAGES) {
    contract(`in ${language}: the demo's chips, payments, a pick from the list, cancelling and the owner told: every WhatsApp message to the customer and the owner, whole`, async () => {
      // the demo's shop in this language, as demo/server.ts --lang makes it (applyLanguage), written whole as the Go shop's settings.json
      const applied = applyLanguage(glowSalon(), language);
      assert.ok(applied.ok, JSON.stringify(applied));
      const settings = applied.settings;
      const s = await makeShop({ mode: "guards", settings: JSON.parse(JSON.stringify(settings)) }); shops.push(s);
      assert.deepEqual(validateSettings(JSON.parse(readFileSync(join(s.client, "settings.json"), "utf8"))), { ok: true, settings }, "the Go shop was given the demo's very shop");
      await s.start();
      // the shop has a page (the deployer writes pages.json), so a WhatsApp booking carries its own page link: the world is given the same maker the runtime has
      const w = createWorld({ settings, nowMs: s.now(), pageLink: () => { const h = newHandle(); return { url: `${PAGE}/b/${h}`, hash: handleHash(h) }; } });
      const chips = chipsFor(settings, language, w.clock.now()).map((c) => c.text);
      const ts: Side = { name: "TypeScript demo", sentTo: (n) => w.messaging.sentTo(n), sync: () => w.clock.set(Date.now()) };
      const go: Side = { name: "Go shop", sentTo: (n) => s.sent(n), sync: () => undefined };
      const t = await walk({ steps: stepsFor(chips), people: { customer: CUSTOMER, owner: w.owner, stranger: STRANGER }, ts, go, world: { w, s, chips }, rules: RULES });
      assertBites(t);
    });
  }
});
