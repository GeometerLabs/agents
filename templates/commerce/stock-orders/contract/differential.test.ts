// The Stock orders agent's TypeScript world kept honest against the Go shop (decision 61; modules/test/contract/demo-differential.ts says how). Stock orders has no public
// demo page (no demo/ folder); what shows its TypeScript agent to people is the hand check (scripts/hand-check.ts, crash-test/situations.ts on src/harness.ts createWorld),
// which prints the go-live certificate's "held" lines. So this walks the hand check's own paths, with its own planner (crash-test/plan.ts planShop on the example shop) and
// the owner's own sentences, on that world and on the Go shop (a "guards" shop on the real clock, its WhatsApp read from the stand-in behind the fake Guard), with the owner
// reading each of the four languages, and compares every WhatsApp message to the owner and to each supplier after each step.
//
// The paths walked: the owner asks for the usual reorder (the card), approves it with the card's code (the order goes to the supplier as a template), the supplier says OK,
// an order from a supplier not on the list and one from the paused supplier (both refused, nothing sent), and "10" of an item that comes by the box and by the piece (the
// owner is asked which, and picks the second from the list). Not walked: time passing (the supplier asked again after the follow-up time, the month's budget turning over)
// needs the test clock, which a guards shop does not take; time.contract.test.ts walks it on the Go shop in a fakes shop (the record and the saved orders), so what happens
// is held, but those WORDS are not compared with the TypeScript world's (go/TRIAL.md lists it).
//
// What is normalised (differs by design between two runs, nothing else): the one-use code of an approval card (random per card), in its words and its buttons' ids.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KUMAR, MEENA, OWNER, RAVI, contract, makeShop } from "./harness.ts";
import type { Shop } from "./harness.ts";
import { createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { validateSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { planShop } from "../crash-test/plan.ts";
import type { Plan } from "../crash-test/plan.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { assertBites, walk } from "../../../../modules/test/contract/demo-differential.ts";
import type { Normalise, Side, Step } from "../../../../modules/test/contract/demo-differential.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });

const RULES: Normalise = [
  [/\b(yes|no) [A-Z0-9]{4,8}\b/gu, "$1 <code>"],
  [/\bcard-(yes|no):[A-Z0-9]{4,8}\b/gu, "card-$1:<code>"], // the card's buttons carry the same code in their ids
];

interface Both { w: World; s: Shop; p: Plan }

/** The newest card's code in what the owner was sent (each side has its own: it is random per card). */
const codeIn = (texts: string[]): string => { for (const t of [...texts].reverse()) { const m = /\byes ([A-Z0-9]{4,8})\b/u.exec(t); if (m) return m[1]; } throw new Error("no approval card was sent to the owner"); };
/** An item's or unit's first English name, as the hand check writes the owner's words. */
const english = (list: { id: string; names: Record<string, string[] | undefined> }[], id: string): string => list.find((x) => x.id === id)!.names.en![0];

const owner = (name: string, text: (b: Both) => string): Step<Both> => ({ name, ts: (b) => b.w.ownerSays(text(b)), go: (b) => b.s.ownerSays(text(b)) });
const STEPS: Step<Both>[] = [
  owner("the owner asks for the usual reorder", (b) => b.p.say()),
  {
    name: "the owner approves the card with its code: the order goes to the supplier",
    ts: (b) => b.w.ownerSays(`yes ${codeIn(b.w.messaging.sentTo(b.w.owner).map((m) => m.text))}`),
    go: (b) => b.s.ownerSays(`yes ${codeIn(b.s.sent(OWNER).map((m) => m.text))}`),
  },
  { name: "the supplier says OK", ts: (b) => b.w.supplierSays(b.p.supplier.whatsapp, "ok"), go: (b) => b.s.inbound(b.p.supplier.whatsapp, "ok") },
  owner("the owner asks a supplier who is not on the list", (b) => `order ${b.p.qty} ${b.p.unit} ${b.p.item} from Sharma Stores`),
  owner("the owner asks the paused supplier", (b) => `order 3 ${english(b.p.settings.units, b.p.paused!.line.unit)} ${english(b.p.settings.items, b.p.paused!.line.item)} from ${b.p.paused!.supplier.name}`),
  owner("the owner says 10 of an item that comes by the box and by the piece", (b) => `order 10 ${english(b.p.settings.items, b.p.twoUnits!.item)} from ${b.p.twoUnits!.supplier.name}`),
  { name: "the owner picks the second way from the list", ts: (b) => b.w.ownerTaps("pick:1"), go: (b) => b.s.tap(OWNER, "pick:1") },
];

describe("the Stock orders world of the hand check and the Go shop say the same on the hand check's paths", () => {
  for (const language of LANGUAGES) {
    contract(`with the owner in ${language}: a reorder, its approval, the supplier's OK, two refusals and a unit picked from a list: every WhatsApp message, whole`, async () => {
      const raw = JSON.parse(readFileSync(new URL("../settings/glow-salon.example.json", import.meta.url), "utf8")) as Record<string, any>;
      const given = { ...raw, owner: { ...raw.owner, language } };
      const checked = validateSettings(given);
      assert.ok(checked.ok, JSON.stringify(checked));
      const settings: Settings = checked.settings;
      const planned = planShop(settings);
      assert.ok("plan" in planned && planned.plan.paused && planned.plan.twoUnits, "the example shop has a paused supplier and an item in two units, so every step runs");
      const p = (planned as { plan: Plan }).plan;
      const s = await makeShop({ mode: "guards", settings: given }); shops.push(s);
      assert.deepEqual(validateSettings(JSON.parse(readFileSync(join(s.client, "settings.json"), "utf8"))), { ok: true, settings }, "the Go shop was given the same shop");
      await s.start();
      const w = createWorld({ settings, nowMs: s.now() });
      const ts: Side = { name: "TypeScript demo", sentTo: (n) => w.messaging.sentTo(n), sync: () => w.clock.set(Date.now()) };
      const go: Side = { name: "Go shop", sentTo: (n) => s.sent(n), sync: () => undefined };
      const t = await walk({ steps: STEPS, people: { owner: OWNER, "Ravi (supplier)": RAVI, "Meena (supplier)": MEENA, "Kumar (paused supplier)": KUMAR }, ts, go, world: { w, s, p }, rules: RULES });
      assertBites(t);
    });
  }
});
