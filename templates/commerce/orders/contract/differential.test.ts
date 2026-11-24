// The Orders demo kept honest against the Go shop (decision 61; modules/test/contract/demo-differential.ts says how). The public demo (demo/quick.ts, drawn by
// modules/demo/quick.ts) runs the TypeScript agent on src/harness.ts createWorld; this walks the demo's own paths on that world and on the Go shop (a "guards" shop on the real
// clock, its WhatsApp read from the stand-in behind the fake Guard), with the demo's shop in each language (ordersShop: Annapurna Tiffins on UPI, its menu named in the
// language), the demo's customer (Amit) and the demo's chips, and compares every WhatsApp message to the customer and the owner after each step.
//
// The paths walked: the greeting chip (the menu), a tap on a menu item, the whole-order chip, "I have paid", the owner's "received <code>" (the owner's chip on the page),
// "Talk to the owner", and a second order cancelled with its button. The order chip names a day: the demo's clock starts on Mon 9 Nov and the chip says "10 nov"; here both
// sides run at the real instant, so the chip is re-dated, identically on both, to the day after tomorrow (clear of the shop's cut-off of 20:00 the day before, and of the
// lunch slot's own 09:00 cut-off on the day). Not walked: time passing (the 30-minute hold that lapses, the reminder before the slot and the order done after it: the demo's
// "time passes" button) needs the test clock, which a guards shop does not take, and a fakes shop keeps no outbox to read. flow.contract.test.ts walks those three on the Go
// shop (a fakes shop on the test clock: the page, the record and the owner's page), so what happens is held; the WORDS sent when time passes are not compared with the
// demo's anywhere (go/TRIAL.md lists it).
//
// What is normalised (differs by design between two runs, nothing else): the owner's UPI code (random per request, the owner's and never the customer's), and a page
// link's random handle.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CUSTOMER, TZ, contract, makeShop } from "./harness.ts";
import type { Shop } from "./harness.ts";
import { createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { validateSettings } from "../src/settings.ts";
import { ordersShop } from "../demo/quick.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { DAY } from "../../../../modules/core/time.ts";
import { assertBites, walk } from "../../../../modules/test/contract/demo-differential.ts";
import type { Normalise, Side, Step } from "../../../../modules/test/contract/demo-differential.ts";

/** A number that holds no order (25 Nov 2026): it names the customer's order. */
const STRANGER = "+919877777777";
const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });

const RULES: Normalise = [
  [/\breceived [A-Z0-9]{4,8}\b/gu, "received <code>"],
  [/\bupi-received:[A-Z0-9]{4,8}\b/gu, "upi-received:<code>"], // the owner's Received button carries the same code in its id
  [/\/o\/[A-Za-z0-9_-]{32}/gu, "/o/<handle>"],
];

interface Both { w: World; s: Shop; chips: string[] }

/** The owner's code in the newest message that asks for it (each side has its own: it is random per request). */
const codeIn = (texts: string[]): string => { for (const t of [...texts].reverse()) { const m = /\breceived ([A-Z0-9]{4,8})\b/u.exec(t); if (m) return m[1]; } throw new Error("no message asked the owner to reply received <code>"); };
/** The id of a button the newest message to the customer offers (the TypeScript demo's; the Go shop must have sent the same, or the walk failed before). */
const offered = (b: Both, prefix: string): string => b.w.messaging.sentTo(CUSTOMER).reverse().flatMap((m) => [...(m.interactive?.buttons ?? []), ...(m.interactive?.list?.rows ?? [])]).find((o) => o.id.startsWith(prefix))!.id;

const steps = (owner: string): Step<Both>[] => [
  { name: "the customer says the greeting chip", ts: (b) => b.w.say(b.chips[0], { from: CUSTOMER }), go: (b) => b.s.inbound(CUSTOMER, b.chips[0]) },
  { name: "the customer taps the first item of the menu", ts: (b) => b.w.tap(offered(b, "item:"), { from: CUSTOMER }), go: (b) => b.s.tap(offered(b, "item:")) },
  { name: "the customer says the whole-order chip", ts: (b) => b.w.say(b.chips[1], { from: CUSTOMER }), go: (b) => b.s.inbound(CUSTOMER, b.chips[1]) },
  { name: "the customer taps I have paid", ts: (b) => b.w.tap("paid", { from: CUSTOMER }), go: (b) => b.s.tap("paid") },
  {
    name: "the owner replies received <code>",
    ts: (b) => b.w.say(`received ${codeIn(b.w.messaging.sentTo(owner).map((m) => m.text))}`, { from: owner }),
    go: (b) => b.s.inbound(owner, `received ${codeIn(b.s.sent(owner).map((m) => m.text))}`),
  },
  // 25 Nov 2026 (modules/record/case-asked.ts): another number names the order: the one line that shows nothing, and the owner's notice
  { name: "another number names the order (O1)", ts: (b) => b.w.say("where is O1?", { from: STRANGER }).then(() => undefined), go: (b) => b.s.inbound(STRANGER, "where is O1?").then(() => undefined) },
  { name: "the customer taps Talk to the owner", ts: (b) => b.w.tap("owner", { from: CUSTOMER }), go: (b) => b.s.tap("owner") },
  { name: "the customer orders again with the chip", ts: (b) => b.w.say(b.chips[1], { from: CUSTOMER }), go: (b) => b.s.inbound(CUSTOMER, b.chips[1]) },
  { name: "the customer cancels that order with its button", ts: (b) => b.w.tap("cancel", { from: CUSTOMER }), go: (b) => b.s.tap("cancel") },
];

describe("the Orders demo and the Go shop say the same on the demo's paths", () => {
  for (const language of LANGUAGES) {
    contract(`in ${language}: the menu, an order from the chip, I have paid, the owner's received, Talk to the owner and a cancel: every WhatsApp message, whole`, async () => {
      const demo = await ordersShop(language);
      const settings = (demo.world as unknown as World).settings;
      const s = await makeShop({ mode: "guards", settings: JSON.parse(JSON.stringify(settings)) }); shops.push(s);
      assert.deepEqual(validateSettings(JSON.parse(readFileSync(join(s.client, "settings.json"), "utf8"))), { ok: true, settings }, "the Go shop was given the demo's very shop");
      assert.equal(demo.customer, CUSTOMER, "the demo's customer is the one the walk writes from");
      await s.start();
      const w = createWorld({ settings, nowMs: s.now() });
      // the chip's day, re-dated: "10 nov" on the demo's clock (Mon 9 Nov) is the day after tomorrow here, written the same way
      const day = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" }).format(s.now() + 2 * DAY).toLowerCase();
      const chips = demo.chips.map((c) => c.replace("10 nov", day));
      assert.notDeepEqual(chips, demo.chips, "the order chip was re-dated");
      const ts: Side = { name: "TypeScript demo", sentTo: (n) => w.messaging.sentTo(n), sync: () => w.clock.set(Date.now()) };
      const go: Side = { name: "Go shop", sentTo: (n) => s.sent(n), sync: () => undefined };
      const t = await walk({ steps: steps(w.owner), people: { customer: CUSTOMER, owner: w.owner, stranger: STRANGER }, ts, go, world: { w, s, chips }, rules: RULES });
      assertBites(t);
    });
  }
});

