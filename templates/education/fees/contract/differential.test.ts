// The Fees demo kept honest against the Go centre (decision 61; modules/test/contract/demo-differential.ts says how). The public demo (demo/quick.ts, drawn by
// modules/demo/quick.ts) runs the TypeScript agent on src/harness.ts createWorld: Bright Tuition Centre on the Razorpay example, the owner reading the demo's language, a
// parent of that language as the visitor; it opens on the first morning with the month's reminders already sent, and the visitor can pay the link with test money, say
// "I already paid the fee" and say "STOP". Two walks, because a Fees demo starts with time passing and then needs messages read whole:
//
//   1. The first morning, on the demo's own clock and with the demo's own centre (feesShop, unchanged): a "fakes" Go centre on the TEST clock put at the demo's instant (Mon
//      2 Nov 2026, 09:00 in India), moved on a day as feesShop moves its world, so the reminder three days before the 5th goes out at 10:00. A fakes centre's WhatsApp is its
//      in-memory stand-in, which prints each message it sends ("[stand-in WhatsApp] to <number>: <words>"); those words are compared, per number and in order, with what the
//      demo's world sent. (The kind and template name are not printed; on this step every message is a template on both sides, as the demo's own outbox shows.)
//   2. The visitor's steps, on a "guards" Go centre on the real clock (its WhatsApp read whole from the stand-in behind the fake Guard) against the demo's world made at the
//      same instant: the parent pays the link of a reminder, says the first chip, then the second. A guards centre cannot take the test clock, and a month whose first
//      reminder came before the centre first ran is never chased, so the reminder here is the one a centre sends at once: an earlier unpaid month, given in the settings
//      (backDues) for the demo parent's own child, reminded at the centre's reminder hour (06:00 here, the earliest a centre may name: the harness's guards month). Before
//      06:00 in India there is no such reminder yet, so walk 2 is skipped then and says why.
//
// What is normalised (differs by design between two runs, nothing else): a payment link's id (the stand-in numbers links per process).
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GUARDS_MONTH, SKIP, START, TZ, contract, makeCentre, withBackDues } from "./harness.ts";
import { gatewayCaseThroughParts } from "../../../commerce/parts/contract/via-parts.ts";
import type { Centre } from "./harness.ts";
import { createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { validateSettings } from "../src/settings.ts";
import { feesShop } from "../demo/quick.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { HOUR, localParts } from "../../../../modules/core/time.ts";
import { assertBites, walk } from "../../../../modules/test/contract/demo-differential.ts";
import type { Normalise, Side, Step } from "../../../../modules/test/contract/demo-differential.ts";

const centres: Centre[] = [];
after(async () => { for (const c of centres) await c.cleanup(); });

const LINK = /https:\/\/pay\.example\/[A-Za-z0-9_]+/gu;
const RULES: Normalise = [[LINK, "<payment link>"]];
const RAW = JSON.parse(readFileSync(new URL("../settings/bright-tuition.example.json", import.meta.url), "utf8")) as Record<string, any>;
const MARK = "[stand-in WhatsApp] to ";

interface Both { w: World; c: Centre; parent: string; chips: string[]; people: Record<string, string> }

/** The newest payment link a parent was sent, as its id. */
const linkIn = (texts: string[]): string => { for (const t of [...texts].reverse()) { const m = /https:\/\/pay\.example\/([A-Za-z0-9_]+)/u.exec(t); if (m) return m[1]; } throw new Error("the parent was sent no payment link"); };

const STEPS: Step<Both>[] = [
  {
    name: "the first beat: the earlier month opens and the parent is reminded, with a link",
    ts: (b) => b.w.tick(),
    // the Go centre does its first beat as it starts (tickSeconds 1): wait until each person has as many messages as the demo's world sent (what they say is compared after)
    go: (b) => b.c.waitFor(() => Object.values(b.people).every((n) => b.c.sent(n).length >= b.w.messaging.sentTo(n).length), "the reminders were sent", 10_000),
  },
  {
    name: "the parent pays the link with test money",
    ts: async (b) => { b.w.payments.customerPays(linkIn(b.w.messaging.sentTo(b.parent).map((m) => m.text))); await b.w.deliverPaymentEvents(); },
    go: async (b) => {
      const events = b.c.guards!.pay(linkIn(b.c.sent(b.parent).map((m) => m.text)));
      await b.c.events(events.map((event) => ({ kind: "payment_event", event })));
      await b.c.settle();
    },
  },
  { name: "the parent says the first chip (I already paid the fee)", ts: (b) => b.w.say(b.chips[0], { from: b.parent }), go: (b) => b.c.inbound(b.parent, b.chips[0]) },
  { name: "the parent says the second chip (STOP)", ts: (b) => b.w.say(b.chips[1], { from: b.parent }), go: (b) => b.c.inbound(b.parent, b.chips[1]) },
];

describe("the Fees demo and the Go centre say the same on the demo's paths", () => {
  for (const language of LANGUAGES) {
    contract(`in ${language}, the demo's first morning on the demo's own clock and centre: every reminder's words, to every parent, in order`, async () => {
      const demo = await feesShop(language); // the demo's world, as the page opens it: a day on, the reminders sent
      const w = demo.world as unknown as World;
      // noPages: the demo's centre has no page, so its reminders carry no private page link (a centre with pages.json adds one)
      const c = await makeCentre({ example: "razorpay", noPages: true, settings: { owner: { ...RAW.owner, language } } }); centres.push(c);
      assert.deepEqual(validateSettings(JSON.parse(readFileSync(join(c.client, "settings.json"), "utf8"))), { ok: true, settings: w.settings }, "the Go centre was given the demo's very centre");
      assert.ok(Math.abs(c.now() - START) < 1000, "the Go centre's clock is at the demo's start (the clock file holds an offset from the machine's clock)");
      await c.start();
      await c.started();
      c.advance(24 * HOUR); // as feesShop moves its world
      const want = w.messaging.outbox().map((m) => ({ to: m.to, text: m.text.replace(LINK, "<payment link>") }));
      assert.ok(want.length >= 4 && w.messaging.outbox().every((m) => m.kind === "template"), "the demo's first morning: a reminder template to each family");
      const printed = (): { to: string; text: string }[] => c.log().split("\n").filter((l) => l.startsWith(MARK)).map((l) => {
        const at = l.indexOf(": ", MARK.length);
        return { to: l.slice(MARK.length, at), text: l.slice(at + 2).replace(LINK, "<payment link>") };
      });
      await c.waitFor(() => printed().length >= want.length, "the Go centre's reminders", 10_000);
      const byPerson = (list: { to: string; text: string }[]) => Object.fromEntries([...new Set(want.map((m) => m.to))].map((to) => [to, list.filter((m) => m.to === to).map((m) => m.text)]));
      assert.deepEqual(byPerson(printed()), byPerson(want), "what the Go centre sent each parent on the first morning (actual) and what the demo's world sent (expected)");
      assert.notDeepEqual(byPerson(printed().map((m, i) => (i === 0 ? { ...m, text: `${m.text}!` } : m))), byPerson(want), "the check bites: one changed word is a difference");
    });

    const early = localParts(Date.now(), TZ).hour < 6 ? "before 06:00 in India a guards centre sends no reminder yet (06:00 is the earliest hour a centre may name), so there is no link to pay: run it after six" : undefined;
    test(`in ${language}, the visitor's steps: a reminder's link paid with test money, I already paid the fee, STOP: every WhatsApp message to every parent and the owner, whole`, SKIP ?? early ?? gatewayCaseThroughParts() ? { skip: SKIP ?? early ?? gatewayCaseThroughParts() } : {}, async () => {
      const demo = await feesShop(language);
      const child = (demo.world as unknown as World).settings.students.find((x) => x.parent === demo.customer)!;
      const batch = RAW.students.find((x: { name: string }) => x.name === child.name).batch as string;
      const fee = RAW.batches.find((x: { id: string }) => x.id === batch).monthlyFeeInr as number;
      // the demo's centre with the harness's guards month and an earlier month owed by the demo parent's own child, the batch's monthly fee (see the header), written whole
      // as the Go centre's settings
      const given = { ...RAW, owner: { ...RAW.owner, language }, ...GUARDS_MONTH, ...withBackDues(RAW, { [child.name]: fee }) };
      const checked = validateSettings(given);
      assert.ok(checked.ok, JSON.stringify(checked));
      const settings = checked.settings;
      const c = await makeCentre({ mode: "guards", example: "razorpay", noPages: true, settings: given }); centres.push(c); // no page, as the demo has none
      assert.deepEqual(validateSettings(JSON.parse(readFileSync(join(c.client, "settings.json"), "utf8"))), { ok: true, settings }, "the Go centre was given the same centre");
      const w = createWorld({ settings, nowMs: Date.now() });
      await c.start();
      const people: Record<string, string> = { owner: w.owner, ...Object.fromEntries([...new Set(settings.students.map((x) => x.parent))].map((p) => [`parent ${p}`, p])) };
      const ts: Side = { name: "TypeScript demo", sentTo: (n) => w.messaging.sentTo(n), sync: () => w.clock.set(Date.now()) };
      const go: Side = { name: "Go shop", sentTo: (n) => c.sent(n), sync: () => undefined };
      const walked = await walk({ steps: STEPS, people, ts, go, world: { w, c, parent: demo.customer, chips: demo.chips, people }, rules: RULES });
      assertBites(walked);
    });
  }
});
