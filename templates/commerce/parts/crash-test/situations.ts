// The crash-test situations of a shop of several parts (decision 65), the shop's own: what only a parts shop can get wrong, on its own Go program (go/cmd/parts) and its own
// settings. Each part's own situations are its template's (templates/*/*/crash-test/situations.ts), run on that part's settings in this shop (hand-check.ts runs both). Each
// situation judges from the stand-in WhatsApp's outbox and the shop's own record and saved state, never from what the program said it did:
//
//   parts-owner-words      the owner's words for each part reach that part: "<name> owes <n>" the credit book, "order <n> <unit> <item> from <supplier>" Stock orders
//   parts-customers        a new customer's message the hold, a listed supplier's Stock orders, someone in the credit book the credit book (and a STOP there is theirs)
//   parts-unclear          words two parts could take ("<name> paid <n>" with a purchase order open): ONE short question, nothing about money done; the answer sends it to the part
//   parts-redelivered      a message delivered twice: read once, by the part it took it, and nobody is sent anything twice
//   parts-owner-page       one owner's page: what waits in each part, the credit book's rows, the one assistant
//   parts-shared-stock     one count for an item two parts know: the last unit held for one customer is not held for another; collected once, it is one reorder, not two
//
// A situation these settings cannot express (no credit book, no Stock orders part, no pickup hold, no counted item) is listed as not run, with the reason.
import { checker, runOnProgram } from "../../../../modules/crash-test/situations.ts";
import type { CheckResult, HandCheckRun, Situation, Skipped } from "../../../../modules/crash-test/situations.ts";
import { PROGRAM, VERSION, createPartsWorld } from "./go-world.ts";
import type { PartsFile, PartsWorld } from "./go-world.ts";

type Obj = Record<string, any>;

/** What the situations need of the shop's settings, read once: the credit book's first person, Stock orders' first item, unit and approved supplier, the hold's first item and slot. */
interface Plan {
  settings: PartsFile;
  credit?: { name: string; phone: string };
  stock?: { item: string; itemName: string; unit: string; supplier: string; supplierPhone: string };
  hold?: { item: string; itemName: string; slot: string };
  shared?: string; // an item id the hold and Stock orders both have
}

function planOf(settings: PartsFile): Plan {
  const p: Plan = { settings };
  const fees = settings.parts.fees as Obj | undefined;
  const person = fees?.creditBook?.people?.[0];
  if (person) p.credit = { name: person.name, phone: person.phone };
  const so = settings.parts["stock-orders"] as Obj | undefined;
  const approved = (so?.suppliers ?? []).find((s: Obj) => s.approved);
  const line = approved && (so?.catalogue ?? []).find((c: Obj) => c.supplier === approved.id);
  if (line) {
    const item = (so!.items as Obj[]).find((i) => i.id === line.item)!;
    const unit = (so!.units as Obj[]).find((u) => u.id === line.unit)!;
    p.stock = { item: item.id, itemName: item.names.en[0], unit: unit.names.en[0], supplier: approved.name, supplierPhone: approved.whatsapp };
  }
  const orders = settings.parts.orders as Obj | undefined;
  if (orders?.advance?.mode === "none" && orders.menu?.length && orders.pickup?.slots?.length) {
    const slot = orders.pickup.slots.at(-1);
    // the hold's item: one Stock orders also has, when there is one (the shared count's situation needs it), else the first
    const both = (orders.menu as Obj[]).find((m) => (so?.items ?? []).some((i: Obj) => i.id === m.id));
    const item = both ?? orders.menu[0];
    p.hold = { item: item.id, itemName: item.names.en[0], slot: slot.names.en[0] };
    if (both && (so?.catalogue ?? []).some((c: Obj) => c.item === both.id && (so?.suppliers ?? []).some((s: Obj) => s.id === c.supplier && s.approved) && c.reorderQty)) p.shared = both.id;
  }
  return p;
}

const lines = (w: PartsWorld, part: string, action?: string, outcome?: string): any[] => w.linesOf(part).filter((e) => (action === undefined || e.action === action) && (outcome === undefined || e.outcome === outcome));
const moneyLines = (w: PartsWorld): any[] => w.record.entries().filter((e) => ["owner_marked_paid", "record_payment", "upi_paid", "mark_paid", "supplier_paid"].includes(e.action) || (e.action === "owner_credit" && e.refs?.kind === "paid") || (e.refs?.command === "paid" && e.outcome === "confirmed"));
const evening = (p: Plan): string => `1 ${p.hold!.itemName} today ${p.hold!.slot}`;

type Build = (p: Plan) => Situation | { skip: string; title: string };

const BUILDERS: Build[] = [
  (p) => !p.credit || !p.stock ? { title: "The owner's words for each part reach that part", skip: "it needs the credit book and a Stock orders part with an approved supplier" } : ({
    id: "parts-owner-words", title: "The owner's words for each part reach that part, and no other",
    how: "the owner writes a credit-book entry and a reorder, each read by its part's own rules",
    async run() {
      const { results, expect } = checker();
      const w = await createPartsWorld(p.settings);
      await w.ownerSays(`${p.credit!.name} owes 500`);
      expect("The credit book wrote the entry", lines(w, "fees", "owner_credit", "confirmed").some((e) => e.refs.kind === "owes"), JSON.stringify(w.linesOf("fees").map((e) => e.action)));
      expect("No other part read the entry", lines(w, "stock-orders", "receive_message").length === 0 && lines(w, "orders", "receive_message").length === 0, "another part read it");
      await w.ownerSays(`order 10 ${p.stock!.unit} ${p.stock!.itemName} from ${p.stock!.supplier}`);
      expect("Stock orders read the reorder", lines(w, "stock-orders", "receive_message", "confirmed").length === 1, `${lines(w, "stock-orders", "receive_message").length} lines`);
      expect("The owner was sent the reorder's card", /\byes [A-Z0-9]{4,6}\b/u.test(w.lastTextTo(w.owner)), w.lastTextTo(w.owner));
      expect("The credit book did not read the reorder", lines(w, "fees", "owner_credit").length === 1, `${lines(w, "fees", "owner_credit").length} credit lines`);
      return results;
    },
  }),
  (p) => !p.credit || !p.stock || !p.hold ? { title: "Each customer reaches the part they belong to", skip: "it needs the credit book, Stock orders and the pickup hold" } : ({
    id: "parts-customers", title: "A new customer reaches the hold, a supplier Stock orders, someone in the credit book the credit book",
    how: "three people write to the shop's one number: one it has never met, its supplier, and a person in the credit book (who sends STOP)",
    async run() {
      const { results, expect } = checker();
      const w = await createPartsWorld(p.settings);
      await w.say(evening(p));
      expect("The hold read the new customer's message", lines(w, "orders", "receive_message", "confirmed").length === 1, JSON.stringify(w.record.entries().map((e) => `${e.refs?.part}:${e.action}`)));
      expect("The owner was asked about the hold", w.textsTo(w.owner).length >= 1, "nothing to the owner");
      await w.say("ok", { from: p.stock!.supplierPhone });
      expect("Stock orders read the supplier's message", lines(w, "stock-orders", "receive_message").length === 1, JSON.stringify(w.linesOf("stock-orders").map((e) => e.action)));
      await w.say("STOP", { from: p.credit!.phone });
      expect("The credit book read the STOP of someone in its book", lines(w, "fees", "receive_message", "confirmed").length === 1 && lines(w, "fees", "opt_out").length + lines(w, "fees", "stop").length >= 1, JSON.stringify(w.linesOf("fees").map((e) => `${e.action}:${e.outcome}`)));
      expect("No part read a message that was not its own", lines(w, "orders", "receive_message").length === 1, `${lines(w, "orders", "receive_message").length} hold lines`);
      return results;
    },
  }),
  (p) => !p.credit || !p.stock ? { title: "Words two parts could take: one question, nothing done on a guess", skip: "it needs the credit book and a Stock orders part with an approved supplier" } : ({
    id: "parts-unclear", title: "Words two parts could take are asked about once, and nothing about money is done on a guess",
    how: "with a purchase order open, the owner writes \"<name> paid 1000\": the credit book and Stock orders both read it as theirs",
    async run() {
      const { results, expect } = checker();
      const w = await createPartsWorld(p.settings);
      await w.ownerSays(`order 10 ${p.stock!.unit} ${p.stock!.itemName} from ${p.stock!.supplier}`);
      await w.ownerSays(`yes ${w.cardCode()}`);
      const before = w.textsTo(w.owner).length;
      const money = moneyLines(w).length;
      await w.ownerSays(`${p.credit!.name} paid 1000`);
      const asked = w.textsTo(w.owner).slice(before);
      expect("The owner was asked one short question", asked.length === 1, JSON.stringify(asked));
      expect("Nothing about money was recorded on a guess", moneyLines(w).length === money, JSON.stringify(moneyLines(w)));
      expect("The router kept the message until the answer", lines(w, "parts", "receive_message", "held").length === 1, JSON.stringify(w.linesOf("parts").map((e) => `${e.action}:${e.outcome}`)));
      await w.tap("part:fees", { from: w.owner });
      expect("The answer sent it to the credit book", lines(w, "fees", "owner_credit", "confirmed").some((e) => e.refs.kind === "paid"), JSON.stringify(w.linesOf("fees").map((e) => `${e.action}:${e.refs?.kind}`)));
      expect("Stock orders did nothing with it", lines(w, "stock-orders").every((e) => e.refs?.command !== "paid"), "a paid command line");
      return results;
    },
  }),
  (p) => !p.hold ? { title: "A message delivered twice is read once", skip: "it needs the pickup hold" } : ({
    id: "parts-redelivered", title: "A message delivered twice is read once, by the part that took it, and nobody hears anything twice",
    how: "the inbox hands the same WhatsApp message on twice",
    async run() {
      const { results, expect } = checker();
      const w = await createPartsWorld(p.settings);
      const m = await w.say(evening(p));
      const toOwner = w.textsTo(w.owner).length;
      const toCustomer = w.textsTo(m.from).length;
      await w.redeliver(m);
      const got = w.record.entries().filter((e) => e.action === "receive_message" && e.outcome === "confirmed");
      expect("The message was read once, by the hold", got.length === 1 && got[0].refs?.part === "orders", JSON.stringify(got.map((e) => `${e.refs?.part}:${e.outcome}`)));
      expect("The second delivery sent nobody anything", w.textsTo(w.owner).length === toOwner && w.textsTo(m.from).length === toCustomer, `owner ${w.textsTo(w.owner).length - toOwner}, customer ${w.textsTo(m.from).length - toCustomer} more`);
      return results;
    },
  }),
  (p) => !p.credit || !p.hold ? { title: "One owner's page for every part", skip: "it needs the credit book and the pickup hold" } : ({
    id: "parts-owner-page", title: "The owner's page shows every part: what waits in each, the credit book, one assistant",
    how: "a hold waits for the owner while the credit book has its people",
    async run() {
      const { results, expect } = checker();
      const w = await createPartsWorld(p.settings);
      await w.tick(); // the shop's first beat: the credit book opens the people its settings name
      await w.say(evening(p));
      const page = await w.ownerPage();
      const v = page.body as Obj;
      expect("The page answered", page.status === 200, `status ${page.status}`);
      expect("It names every part", JSON.stringify(v.parts) === JSON.stringify(Object.keys(p.settings.parts)), JSON.stringify(v.parts));
      expect("The hold waiting is on it", (v.items ?? []).some((i: Obj) => String(i.kind).startsWith("hold")), JSON.stringify(v.items));
      expect("The credit book's people are on it", (v.credit ?? []).length === (p.settings.parts.fees as Obj).creditBook.people.length, JSON.stringify(v.credit));
      expect("It has the one assistant", typeof v.app === "object" && v.app !== null, "no app view");
      return results;
    },
  }),
  (p) => !p.shared ? { title: "One count for an item two parts know", skip: "it needs an item the pickup hold and Stock orders both have, with a supplier and a reorder quantity" } : ({
    id: "parts-shared-stock", title: "One count for an item two parts know: the last unit is held once, and collecting it makes one reorder",
    how: "the owner counts one unit; two customers ask to keep it; the owner says yes to both; the first collects it; the beat runs several times",
    async run() {
      const { results, expect } = checker();
      const w = await createPartsWorld(p.settings);
      const started = await w.stockOp({ op: "start", id: `menu:${p.shared}`, count: 1, low: 0 });
      const line = w.stock()?.lines.find((l) => l.id === `supply:${p.shared}`);
      expect("The count is one line for both parts", started.status === 200 && line !== undefined && (line.aliases ?? []).includes(`menu:${p.shared}`), JSON.stringify(w.stock()));
      await w.say(evening(p));
      await w.say(evening(p), { from: "+919833333333" });
      await w.ownerSays("approve o-1");
      await w.ownerSays("approve o-2");
      const held = lines(w, "orders", "pickup_hold", "confirmed").filter((e) => e.refs.step === "held");
      expect("Only one customer has the last unit held", held.length === 1, `${held.length} held`);
      const cardsBefore = w.textsTo(w.owner).filter((t) => /\byes [A-Z0-9]{4,6}\b/u.test(t)).length;
      await w.ownerSays("collected o-1");
      for (let i = 0; i < 3; i++) await w.tick();
      const after = w.stock()?.lines.find((l) => l.id === `supply:${p.shared}`);
      expect("Collecting it took the unit off the one count", after?.count === 0, JSON.stringify(after));
      const reorders = lines(w, "stock-orders", "stock", "confirmed").filter((e) => e.refs?.change === "low");
      expect("Stock orders started one reorder, not two", reorders.length === 1, `${reorders.length} low lines`);
      const cards = w.textsTo(w.owner).filter((t) => /\byes [A-Z0-9]{4,6}\b/u.test(t)).length - cardsBefore;
      expect("The owner was asked once to approve the reorder", cards === 1, `${cards} cards`);
      return results;
    },
  }),
];

export function buildSituations(settings: PartsFile): { situations: Situation[]; skipped: Skipped[] } {
  const plan = planOf(settings);
  const situations: Situation[] = [];
  const skipped: Skipped[] = [];
  for (const build of BUILDERS) {
    const s = build(plan);
    if ("skip" in s) skipped.push({ id: "skipped", title: s.title, reason: s.skip });
    else situations.push(s);
  }
  return { situations, skipped };
}

/** Run every situation these settings can express, on the shop's own Go program (go/cmd/parts). */
export async function runOn(settings: PartsFile): Promise<HandCheckRun<PartsFile>> {
  return runOnProgram(PROGRAM, VERSION, () => buildSituations(settings), settings);
}

export type { CheckResult };
