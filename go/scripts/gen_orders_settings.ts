// Writes what the Go Orders shop (go/internal/orders, wave W4) needs to hold its settings, its store and its channel's reads equal to the TypeScript's:
//   go/internal/orders/settings_check.json          the lists and numbers the settings check reads that the TypeScript owns: the character's styles and palettes, the personalities and
//                                                   paints, the most approvers and the owner's approver id, the most a day's refunds may come to (DEFAULT_CAPS.refundPaisePerDay),
//                                                   LOWEST_LINK_INR, each payment module's capabilities, and the chat guest's words (chat-guest.ts CHAT_GUEST). Nothing is retyped in Go.
//   go/internal/orders/testdata/settings-vectors.json.gz   every example shop and many mutations of it through validateSettings: the plain-words problems, in order, for a refused one;
//                                                   for an accepted one the checked tree, its policy digest (report/data.ts policyDigest) and the helpers' answers (highestOrderInr,
//                                                   advanceFor, cutoffOf, allSlots, slotOf, itemOf, itemName, the payment module's capabilities)
//   go/internal/orders/testdata/store-vectors.json.gz   stores the TypeScript AGENT wrote (src/harness.ts worlds driven like the tests drive them: UPI, Razorpay, plans and a page order),
//                                                   serialized by server/snapshot.ts, with what order.ts and channel.ts read from each (the day's counts, a slot's count with the
//                                                   plans' meals, the stock taken, a slot fixed, the facts of a message, the page's offer and views, the owner's items and view with
//                                                   their digests and the Money section, the page's receipts) and the record the money is read from
// The owner's one-use codes are random in the TypeScript (approvals/code.ts randomInt): this script replaces node:crypto's randomInt with a counter
// (syncBuiltinESMExports) while generate() runs and puts the real one back after, so a run is the same every time and --check can compare. Everything else a world does runs on its fake clock.
// Run from the repository root:  node go/scripts/gen_orders_settings.ts   (--check only compares and exits 1 naming the stale files; `staleFiles` is async)
// The vectors name the Node that made them (`node`), left out of the freshness comparison.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

// ---- a counter for randomInt while the worlds run (generate puts the real one back after, so a test that imports this file draws real codes) -----------------------------------
const nodeCrypto = createRequire(import.meta.url)("node:crypto") as { randomInt: (...a: unknown[]) => number };
const realRandomInt = nodeCrypto.randomInt;
let draws = 0;
const countingRandomInt = ((a: number, b?: number) => { const lo = b === undefined ? 0 : a; const hi = b === undefined ? a : b; draws++; return lo + ((draws * 7919) % (hi - lo)); }) as never;

const ORDERS = "../../templates/commerce/orders";
const { validateSettings, highestOrderInr, advanceFor, cutoffOf, allSlots, slotOf, itemOf, itemName, LOWEST_LINK_INR } = await import(`${ORDERS}/src/settings.ts`);
const { policyDigest } = await import(`${ORDERS}/report/data.ts`);
const { createWorld, annapurna, annapurnaPlans, annapurnaRazorpay, sweetCrumbs, AMIT, SUNITA, RAJESH } = await import(`${ORDERS}/src/harness.ts`);
const { serializeStore } = await import(`${ORDERS}/server/snapshot.ts`);
const order = await import(`${ORDERS}/src/order.ts`);
const channel = await import(`${ORDERS}/src/channel.ts`);
const { planMealsInSlot } = await import(`${ORDERS}/src/plans/ledger.ts`);
const { CHARACTER_STYLES, STYLE_INFO } = await import("../../modules/assistant/character.ts");
const { PERSONALITIES } = await import("../../modules/assistant/personality.ts");
const { PAINT_IDS } = await import("../../modules/channels/chat-paint.ts");
const { MAX_PEOPLE, OWNER_APPROVER } = await import("../../modules/approvals/people.ts");
const { DEFAULT_CAPS } = await import("../../modules/payments/guard-limits.ts");
const { PROVIDERS, capabilitiesOf } = await import("../../modules/payments/providers/index.ts");
const { CHAT_GUEST } = await import("../../modules/channels/chat-guest.ts");
const { LANGUAGES } = await import("../../modules/language/languages.ts");
const { addDays, localParts } = await import("../../modules/core/time.ts");

const here = dirname(fileURLToPath(import.meta.url));
const INTERNAL = join(here, "..", "internal");
export const OUT = INTERNAL;
const SETTINGS_DIR = join(here, "..", "..", "templates", "commerce", "orders", "settings");
const stamp = (v: unknown): string => JSON.stringify({ node: process.version, ...(v as object) }, null, 1) + "\n";
const example = (name: string): Record<string, any> => JSON.parse(readFileSync(join(SETTINGS_DIR, name), "utf8"));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// ---- the settings ------------------------------------------------------------------------------------------------------------------------------------------------------------------

type Mut = [name: string, change: (s: Record<string, any>) => void];
const ANYONE = { id: "ravi", whatsapp: "+919800000002", language: "hi" };
const PLAN = { id: "lunch-weekdays", names: { en: ["lunch plan"], hi: ["लंच प्लान"] }, slotId: "lunch", weekdays: [1, 2, 3, 4, 5], priceInr: 2400 };

const MUTATIONS: Mut[] = [
  ["as it is", () => {}],
  ["a name with spaces round it", (s) => { s.name = "  Annapurna Tiffins \t"; }],
  ["no address", (s) => { delete s.address; }],
  ["an address that is not text", (s) => { s.address = 5; }],
  ["the defaults left out", (s) => { delete s.timezone; delete s.languages; delete s.advance; delete s.orders.daysAhead; delete s.owner.language; delete s.owner.approveOverInr; delete s.cutoff; }],
  ["a null time zone and a null owner language take their defaults", (s) => { s.timezone = null; s.owner.language = null; }],
  ["null where null is not left out", (s) => { s.languages = null; s.orders.daysAhead = null; s.cutoff = null; s.owner.approveOverInr = null; s.reminder = null; s.plans = null; s.address = null; }],
  ["a null advance mode is part", (s) => { s.advance = { mode: null, percent: 40, holdMinutes: 20 }; }],
  ["null advance percent and hold", (s) => { s.advance = { mode: "part", percent: null, holdMinutes: null }; }],
  ["an advance that is not an object", (s) => { s.advance = "half"; }],
  ["the whole order in advance", (s) => { s.advance = { mode: "full" }; }],
  ["the whole order in advance with a percent", (s) => { s.advance = { mode: "full", percent: 30, holdMinutes: 15 }; }],
  ["a bad advance mode", (s) => { s.advance = { mode: "some", percent: 50 }; }],
  ["an advance percent of 150", (s) => { s.advance = { mode: "part", percent: 150, holdMinutes: 30 }; }],
  ["an advance percent that is not whole", (s) => { s.advance = { mode: "part", percent: 12.5 }; }],
  ["a hold too short and an unknown key", (s) => { s.advance = { mode: "part", holdMinutes: 2, deposit: 1 }; }],
  ["a bad time zone", (s) => { s.timezone = "Mars/Olympus"; }],
  ["a time zone that is not text", (s) => { s.timezone = 5; }],
  ["unknown keys in the order the file names them", (s) => { s.zeta = 1; s.alpha = 2; s.menu[0].colour = "red"; s.owner.email = "x"; }],
  ["one language: the names of the other are dropped", (s) => { s.languages = ["en"]; }],
  ["languages: empty, unknown and twice", (s) => { s.languages = []; }],
  ["languages with an unknown one and one twice", (s) => { s.languages = ["en", "fr", "en", 5, "hi"]; }],
  ["a language whose names are missing", (s) => { s.languages = ["en", "hi", "ml"]; }],
  ["no menu", (s) => { delete s.menu; }],
  ["an empty menu", (s) => { s.menu = []; }],
  ["a menu item that is not an object", (s) => { s.menu.push(5); }],
  ["two items share an id", (s) => { s.menu[1].id = s.menu[0].id; }],
  ["an item with a bad id", (s) => { s.menu[0].id = "Veg Thali"; }],
  ["an item with no id", (s) => { delete s.menu[0].id; }],
  ["an item with an id that is a number", (s) => { s.menu[0].id = 7; }],
  ["an item with no names", (s) => { delete s.menu[0].names; }],
  ["an item's names with an unknown language", (s) => { s.menu[0].names.fr = ["thali"]; }],
  ["an item whose name is empty", (s) => { s.menu[0].names.en = ["  "]; }],
  ["an item whose names are not a list", (s) => { s.menu[0].names.en = "thali"; }],
  ["two items share a name", (s) => { s.menu[1].names.en = ["Veg Thali"]; }],
  ["names with spaces round them, a quote, an ampersand and a joiner", (s) => { s.menu[0].names.en = [" veg \"thali\" & rice ", "<b>thali</b>"]; s.menu[0].names.hi = ["വെജ്‍ താലി"]; }],
  ["a price of 0, a price not whole, a price too high", (s) => { s.menu[0].priceInr = 0; s.menu[1].priceInr = 10.5; s.menu[2].priceInr = 200000; }],
  ["a stock of 0 and one too high", (s) => { s.menu[0].dailyStock = 0; s.menu[1].dailyStock = 20000; }],
  ["no order limits", (s) => { delete s.orders; }],
  ["order limits out of range", (s) => { s.orders = { maxPerDay: 0, maxItemsPerOrder: 101, daysAhead: 61, more: 1 }; }],
  ["order limits that are not whole", (s) => { s.orders = { maxPerDay: "8", maxItemsPerOrder: 2.5, daysAhead: -1 }; }],
  ["a huge number", (s) => { s.orders.maxPerDay = 1e21; }],
  ["an order that could come to more than a day's refunds", (s) => { s.orders.maxItemsPerOrder = 100; s.menu[1].priceInr = 60000; }],
  ["an order that could come to more than a day's refunds with another problem", (s) => { s.orders.maxItemsPerOrder = 100; s.menu[1].priceInr = 60000; s.refund = 1; }],
  ["a cut-off that is not an object", (s) => { s.cutoff = "20:00"; }],
  ["a cut-off with no days and a bad time", (s) => { s.cutoff = { time: "25:00" }; }],
  ["a cut-off eight days before", (s) => { s.cutoff = { daysBefore: 8, time: "20:00", extra: true }; }],
  ["a cut-off with no time", (s) => { s.cutoff = { daysBefore: 1 }; }],
  ["no pickup", (s) => { delete s.pickup; }],
  ["pickup with no slots", (s) => { s.pickup = { slots: [] }; }],
  ["pickup with an unknown key", (s) => { s.pickup.area = ["x"]; }],
  ["a slot that is not an object", (s) => { s.pickup.slots.push("lunch"); }],
  ["a slot with a bad id and no times", (s) => { s.pickup.slots[0] = { id: "Lunch!" }; }],
  ["a slot with an id that is not text", (s) => { s.pickup.slots[0].id = 3; }],
  ["a slot that ends before it starts", (s) => { s.pickup.slots[0].to = "11:00"; }],
  ["a slot with a time like 9:5", (s) => { s.pickup.slots[0].from = "9:5"; }],
  ["two slots share an id across pickup and delivery", (s) => { s.delivery.slots[0].id = "lunch"; }],
  ["two pickup slots share an id", (s) => { s.pickup.slots[1].id = "lunch"; }],
  ["a slot's own cut-off is broken", (s) => { s.pickup.slots[0].cutoff = { daysBefore: 9, time: "9" }; }],
  ["a slot's own cut-off is null", (s) => { s.pickup.slots[0].cutoff = null; }],
  ["a slot with a limit of its own", (s) => { s.pickup.slots[0].maxOrders = 5; s.delivery.slots[1].maxOrders = 1; }],
  ["a slot's limit of 0", (s) => { s.pickup.slots[1].maxOrders = 0; }],
  ["a slot's limit that is null", (s) => { s.delivery.slots[0].maxOrders = null; }],
  ["slot names that are not an object", (s) => { s.pickup.slots[0].names = ["lunch"]; }],
  ["slot names with an unknown language and a bad list", (s) => { s.pickup.slots[0].names = { en: "lunch", ml: ["ഊണ്"], fr: ["déjeuner"] }; }],
  ["slot names empty", (s) => { s.pickup.slots[0].names = {}; }],
  ["slot names with spaces round them", (s) => { s.pickup.slots[0].names = { en: [" lunch "], kn: ["ಊಟ"] }; }],
  ["no delivery", (s) => { delete s.delivery; }],
  ["delivery that is null", (s) => { s.delivery = null; }],
  ["delivery with no area", (s) => { delete s.delivery.area; }],
  ["delivery with an empty place and a place twice", (s) => { s.delivery.area = ["Kakkanad", " kakkanad ", "Edappally"]; }],
  ["delivery with a blank place", (s) => { s.delivery.area = ["Kakkanad", " "]; }],
  ["delivery with no slots", (s) => { s.delivery.slots = []; }],
  ["delivery with an unknown key", (s) => { s.delivery.fee = 20; }],
  ["a reminder two hours before", (s) => { s.reminder = { hoursBefore: 2 }; }],
  ["a reminder that is not an object", (s) => { s.reminder = 2; }],
  ["a reminder out of range with a key it does not know", (s) => { s.reminder = { hoursBefore: 200, minutes: 5 }; }],
  ["a reminder with no hours", (s) => { s.reminder = {}; }],
  ["no cancellation", (s) => { delete s.cancellation; }],
  ["a cancellation window out of range", (s) => { s.cancellation = { windowHours: 400, refund: true }; }],
  ["no refund limit", (s) => { delete s.refund; }],
  ["a refund limit not whole", (s) => { s.refund = { limitInr: "300" }; }],
  ["a refund limit of 0", (s) => { s.refund = { limitInr: 0 }; }],
  ["no payment block", (s) => { delete s.payment; }],
  ["a payment block that is not an object", (s) => { s.payment = "upi"; }],
  ["an unknown payment module", (s) => { s.payment = { module: "bitcoin" }; }],
  ["a UPI ID in capitals and a payee with spaces", (s) => { s.payment = { module: "upi", upi: { id: "  Annapurna@OkIcici ", payee: "  Annapurna Tiffins  " } }; }],
  ["a UPI shop with no UPI block", (s) => { s.payment = { module: "upi" }; }],
  ["a UPI ID with no @ and a payee on two lines", (s) => { s.payment = { module: "upi", upi: { id: "annapurna", payee: "Annapurna\nTiffins", bank: "x" }, extra: 1 }; }],
  ["a UPI ID that is not one and no payee", (s) => { s.payment = { module: "upi", upi: { id: "a@1bank" } }; }],
  ["a payee too long", (s) => { s.payment = { module: "upi", upi: { id: "annapurna@okicici", payee: "x".repeat(51) } }; }],
  ["a gateway shop", (s) => { s.payment = { module: "razorpay" }; }],
  ["a gateway shop with a UPI ID", (s) => { s.payment = { module: "razorpay", upi: { id: "annapurna@okicici", payee: "A" } }; }],
  ["no owner", (s) => { delete s.owner; }],
  ["an owner with a bad number, a bad language and a bad line", (s) => { s.owner = { whatsapp: "98000", language: "fr", approveOverInr: -1, name: "x" }; }],
  ["an owner who approves nothing", (s) => { s.owner.approveOverInr = 0; }],
  ["an owner's line that is too high", (s) => { s.owner.approveOverInr = 20_000_000; }],
  ["approvers: one person with no language", (s) => { s.approvers = { people: [{ id: "ravi", whatsapp: "+919800000002" }] }; }],
  ["approvers: two people and a two-above amount", (s) => { s.approvers = { people: [ANYONE, { id: "meena", whatsapp: "+919800000003", language: "ml" }], twoAboveInr: 5000 }; }],
  ["approvers: a two-above amount below the refund limit", (s) => { s.approvers = { people: [ANYONE], twoAboveInr: 100 }; }],
  ["approvers: a two-above amount with a broken refund block", (s) => { s.refund = { limitInr: -5 }; s.approvers = { people: [ANYONE], twoAboveInr: 100 }; }],
  ["approvers: every mistake", (s) => { s.approvers = { people: [{ id: "owner", whatsapp: "+91", language: "fr", extra: 1 }, { id: "Ravi", whatsapp: "+919800000002" }, { id: "x", whatsapp: "+919800000002", language: "hi" }, { id: "x", whatsapp: "+919800000009" }, 5], twoAboveInr: -1, more: 2 }; }],
  ["approvers: the owner's own number", (s) => { s.approvers = { people: [{ id: "ravi", whatsapp: s.owner.whatsapp }] }; }],
  ["approvers: the owner's own number with the owner's block broken", (s) => { s.owner.language = "fr"; s.approvers = { people: [{ id: "ravi", whatsapp: s.owner.whatsapp }] }; }],
  ["approvers: seven people", (s) => { s.approvers = { people: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, whatsapp: `+91980000010${i}` })) }; }],
  ["approvers: empty", (s) => { s.approvers = { people: [] }; }],
  ["approvers: not an object", (s) => { s.approvers = [1]; }],
  ["approvers: null", (s) => { s.approvers = null; }],
  ["the assistant on with its defaults", (s) => { s.assistant = {}; }],
  ["the assistant with no morning line", (s) => { s.assistant = { morning: false }; }],
  ["the assistant with a morning line at 07:30", (s) => { s.assistant = { morning: { at: "07:30" } }; }],
  ["the assistant's talk off for customers", (s) => { s.assistant = { talk: { customers: false } }; }],
  ["a whole character", (s) => { s.assistant = { morning: { at: "08:15" }, character: { name: " Mithra ", style: "critters", seed: "annapurna-3f2a1c-4", colour: "#" + STYLE_INFO.critters.palette[2].toUpperCase(), paint: "blue", personality: "brief" } }; }],
  ["the assistant: every mistake in the character", (s) => { s.assistant = { character: { name: "Mithra1", style: "x", seed: "Bad Seed", colour: "123456", paint: "red", personality: "loud", voice: "a", look: {} } }; }],
  ["the assistant: unknown keys, a bad morning, a bad talk", (s) => { s.assistant = { colour: "red", morning: { at: "8:00" }, talk: { customers: "no", also: 1 } }; }],
  ["the assistant: not an object", (s) => { s.assistant = "on"; }],
  ["plans: one plan", (s) => { s.plans = { types: [PLAN] }; }],
  ["plans: refunded credits, their own cut-off, weekday names", (s) => { s.plans = { types: [{ ...PLAN, weekdays: ["Mon", "wednesday", "fri"] }, { ...PLAN, id: "home-dinner", names: { en: [" home dinner "], hi: ["घर डिनर"] }, slotId: "dinner-home", weekdays: [6, 0], priceInr: 3000 }], cutoff: { daysBefore: 0, time: "07:00" }, credits: "refund" }; }],
  ["plans: not an object", (s) => { s.plans = [PLAN]; }],
  ["plans: no types, bad credits, an unknown key", (s) => { s.plans = { credits: "both", extra: 1 }; }],
  ["plans: a broken cut-off", (s) => { s.plans = { types: [PLAN], cutoff: { daysBefore: 1 } }; }],
  ["plans: the shop's cut-off broken and none of its own", (s) => { s.cutoff = { daysBefore: 1, time: "late" }; s.plans = { types: [PLAN] }; }],
  ["plans: every mistake in a plan", (s) => { s.plans = { types: [{ id: "Bad Id", names: { en: [], fr: ["x"] }, slotId: "brunch", weekdays: [7, "noday", 1, 1, 2.5, { d: 1 }], priceInr: 0, colour: "red" }, 5, { ...PLAN, names: "lunch" }] }; }],
  ["plans: two plans share an id", (s) => { s.plans = { types: [PLAN, { ...PLAN }] }; }],
  ["plans: no weekdays and a price over a day's refunds", (s) => { s.plans = { types: [{ ...PLAN, weekdays: [], priceInr: 6000 }] }; }],
  ["plans: a price over a day's refunds", (s) => { s.plans = { types: [{ ...PLAN, priceInr: 6000 }] }; }],
  ["plans: a plan with no names", (s) => { s.plans = { types: [{ ...PLAN, names: undefined }] }; }],
  // E1, the discount authority (24 Nov 2026): read last; only a shop that has the block reads back any different
  ["discounts: a floor and a cap", (s) => { s.discounts = { capPercent: 10, capInr: 100, floors: { "veg-thali": 100, curd: 15 } }; }],
  ["discounts: a floor exactly the menu price", (s) => { s.discounts = { capPercent: 0, capInr: 0, floors: { curd: 20 } }; }],
  ["discounts: every mistake", (s) => { s.discounts = { capPercent: -1, capInr: 100001, floors: { "veg-thali": 121, pizza: 10, curd: 0.5 }, also: true }; }],
  ["discounts: no floors", (s) => { s.discounts = { capPercent: 10, capInr: 100 }; }],
  ["discounts: not an object", (s) => { s.discounts = [1]; }],
  // the pickup hold (advance "none", 24 Nov 2026): percent 0, the hold minutes kept but not used; no delivery and no plans with it
  ["the pickup hold: no advance, no delivery", (s) => { s.advance = { mode: "none" }; delete s.delivery; }],
  ["the pickup hold with a percent and hold minutes", (s) => { s.advance = { mode: "none", percent: 40, holdMinutes: 10 }; delete s.delivery; }],
  ["the pickup hold with delivery", (s) => { s.advance = { mode: "none" }; }],
  ["the pickup hold with plans and delivery", (s) => { s.advance = { mode: "none" }; s.plans = { types: [PLAN] }; }],
  ["the pickup hold with a broken delivery block", (s) => { s.advance = { mode: "none" }; s.delivery = { slots: [] }; }],
  ["problems in several places come in the TypeScript's order", (s) => { s.orders.maxPerDay = 0; s.approvers = { people: [] }; s.payment = { module: "bitcoin" }; s.assistant = { morning: true }; s.plans = { types: [] }; s.menu[0].priceInr = 0; }],
];

const PLAIN = ["the pickup hold: no advance, no delivery", "discounts: a floor and a cap", "as it is", "a name with spaces round it", "no address", "the defaults left out", "the assistant on with its defaults", "a gateway shop", "plans: one plan", "a slot with a limit of its own", "a reminder two hours before"];

/** What the helpers answer for one accepted shop. */
function helpers(s: any): unknown {
  const totals = [1, 2, 3, 99, 100, 101, 119, 240, 333, 999, 12345];
  return {
    highestOrderInr: highestOrderInr(s),
    advanceFor: totals.map((t) => [t, advanceFor(s, t)]),
    allSlots: allSlots(s).map(({ slot, mode }: any) => ({ id: slot.id, mode, cutoff: cutoffOf(s, slot) })),
    slotOf: ["lunch", "dinner-home", "morning", "nope", ""].map((id) => { const f = slotOf(s, id); return f ? { id, slot: f.slot.id, mode: f.mode } : { id, none: true }; }),
    itemOf: [...s.menu.map((i: any) => i.id), "nope"].map((id: string) => ({ id, found: itemOf(s, id) !== undefined })),
    itemName: s.menu.map((i: any) => LANGUAGES.map((l: string) => itemName(i, l))),
    capabilities: capabilitiesOf(s.payment),
  };
}

function settingsCases(): unknown[] {
  const out: unknown[] = [];
  for (const file of ["annapurna-tiffins.example.json", "annapurna-tiffins-razorpay.example.json", "annapurna-tiffins-plans.example.json", "sweet-crumbs.example.json", "ganesh-electricals-hold.example.json"]) {
    for (const [name, change] of MUTATIONS) {
      if (file !== "annapurna-tiffins.example.json" && !PLAIN.includes(name)) continue;
      const input = clone(example(file));
      try { change(input); } catch { continue; }
      const text = JSON.stringify(input);
      const r = validateSettings(JSON.parse(text));
      if (r.ok) out.push({ name: `${file}: ${name}`, input: JSON.parse(text), ok: true, tree: clone(r.settings), digest: policyDigest(r.settings), helpers: helpers(r.settings) });
      else out.push({ name: `${file}: ${name}`, input: JSON.parse(text), ok: false, errors: r.errors });
    }
  }
  return out;
}

// ---- stores the agent wrote, and what is read from them ----------------------------------------------------------------------------------------------------------------------------

const PAGE_HANDLE = "a1".repeat(32);
const PAGE_HANDLE_2 = "b2".repeat(32);
const REFUSED_HANDLE = "c3".repeat(32);
const DAY_MS = 86_400_000;

type World = Awaited<ReturnType<typeof createWorld>>;

/** Everything order.ts and channel.ts read from one saved store, at one moment. */
function reads(w: World, nowMs: number): unknown {
  const s = w.settings;
  const st = w.store;
  const today = localParts(nowMs, s.timezone);
  const dates = [-1, 0, 1, 2, 3].map((d) => addDays({ year: today.year, month: today.month, day: today.day }, d));
  const slots = allSlots(s).map(({ slot }: any) => slot.id);
  const orders = [...st.orders.values()];
  const handles = Object.keys(st.channel?.requests ?? {});
  const entries = w.record.entries();
  return {
    nowMs,
    days: dates.map((date) => ({
      date,
      ordersOn: order.ordersOn(st, date, nowMs),
      ordersOnExcept: orders.map((o: any) => order.ordersOn(st, date, nowMs, o.id)),
      inSlot: slots.map((id: string) => [id, order.ordersInSlot(st, date, id, nowMs), planMealsInSlot(st.plans, date, id, nowMs)]),
      taken: s.menu.map((i: any) => [i.id, order.takenOf(st, date, i.id, nowMs), ...orders.map((o: any) => order.takenOf(st, date, i.id, nowMs, o.id))]),
      moments: { pickup: order.slotMoments(s, "pickup", date), delivery: order.slotMoments(s, "delivery", date) },
    })),
    orders: orders.map((o: any) => {
      const fixed = { ...clone(o), date: o.date ?? dates[2], slotId: o.slotId ?? slots[0] };
      const ok = order.fixSlot(s, fixed);
      return {
        id: o.id,
        holds: order.holdsStock(o, nowMs),
        total: order.totalOf(s, o.lines), count: order.countOf(o.lines),
        itemsText: LANGUAGES.map((l: string) => (o.lines.every((x: any) => itemOf(s, x.itemId)) ? order.itemsText(s, o.lines, l) : null)),
        fix: ok ? { mode: fixed.mode, from: fixed.slotStartMs, to: fixed.slotEndMs, cutoff: fixed.cutoffMs, date: fixed.date, slotId: fixed.slotId } : null,
        facts: o.plan && !s.plans ? null : clone(order.factsFor(s, o, o.language, { nowMs })),
        factsMenu: o.plan && !s.plans ? null : clone(order.factsFor(s, o, "en", { menu: true, areas: true, refundInr: 50, itemId: s.menu[0].id, leftCount: 3, customerPhone: "+919899999999", upiCode: "ABC234", markedInr: 10, leftInr: 5, link: "https://pay.example/x" })),
        what: channel.orderWhat(s, o),
      };
    }),
    factsNone: clone(order.factsFor(s, null, "hi", {})),
    lines: [[], [{ itemId: s.menu[0].id, qty: 2 }]].map((l) => { const lines = clone(l) as any[]; order.addLine(lines, s.menu[0].id, 1); order.addLine(lines, s.menu[1].id, 3); return lines; }),
    latest: [AMIT, SUNITA, RAJESH, ...orders.map((o: any) => o.customer)].map((c: string) => [c, order.latestOrder(st, c, order.LIVE_STATES)?.id ?? null, order.latestOrder(st, c, ["cancelled", "expired", "completed"])?.id ?? null]),
    facts: order.orderFacts(st, nowMs),
    offer: clone(channel.orderOffer(s, st, nowMs, false)),
    offerPaused: clone(channel.orderOffer(s, st, nowMs, true)).shop,
    views: [...handles, "d4".repeat(32)].map((h) => [h, clone(channel.orderView(s, st, h))]),
    items: channel.ownerItems(s, st, nowMs),
    owner: clone(channel.ownerView(s, st, nowMs, entries)),
    documents: [...handles, "d4".repeat(32)].map((h) => [h, LANGUAGES.map((l: string) => clone(channel.documentsOf(s, st, entries, { handle: h }, l)))]),
    chatWork: [...new Set(orders.map((o: any) => o.customer))].map((c) => [c, orders.filter((o: any) => o.customer === c && o.state !== "enquiry").length]),
  };
}

function pageOrder(w: World, handle: string, o: { lines: { itemId: string; qty: number }[]; date: string; mode: "pickup" | "delivery"; slotId: string; address?: string; name: string; phone: string; channel?: "web" | "mcp" }) {
  return w.agent.handle({ kind: "channel_request", id: `req-${handle.slice(0, 6)}`, channel: o.channel ?? "web", handle, op: "order", lines: o.lines, date: o.date, mode: o.mode, slotId: o.slotId, ...(o.address ? { address: o.address } : {}), name: o.name, phone: o.phone, language: "en" });
}

async function scenarios(): Promise<unknown[]> {
  const out: unknown[] = [];
  const keep = (name: string, w: World, moments: number[]) => {
    out.push({ name, settings: clone(w.settings), snapshot: serializeStore(w.store), entries: clone(w.record.entries()), reads: moments.map((m) => reads(w, m)) });
  };

  // a UPI shop: an order held for its advance, one marked paid and then cancelled in time (a refund the owner owes), a delivery with its address, a big order waiting
  // for the owner, a page order with its channel block, a refused page request, and a hold that ran out (the "time ran out" card)
  {
    const w = createWorld({ settings: annapurna() });
    await w.say("2 veg thali 10 nov 12:00 pm pickup", { from: AMIT });
    await w.say("2 वेज थाली 10 nov 12:00 pm पिकअप", { from: SUNITA });
    await w.ownerMarksReceived(SUNITA);
    await w.say("1 chicken meal 10 nov delivery", { from: RAJESH });
    await w.tap("slot:dinner-home", { from: RAJESH });
    await w.say("Flat 2, Infopark road", { from: RAJESH });
    await w.say("7 chicken meal 11 nov 12:00 pm pickup", { from: "+919855555555" });
    await w.say("1 veg thali 11 nov lunch", { from: "+919822222222" });
    await pageOrder(w, PAGE_HANDLE, { lines: [{ itemId: "curd", qty: 2 }, { itemId: "veg-thali", qty: 1 }], date: "2026-11-10", mode: "pickup", slotId: "dinner", name: "Meera", phone: "+919866666666" });
    await pageOrder(w, PAGE_HANDLE_2, { lines: [{ itemId: "veg-thali", qty: 1 }], date: "2026-11-11", mode: "delivery", slotId: "dinner-home", address: "Edappally, near the church", name: "Joseph", phone: "+919877777777", channel: "mcp" });
    await w.ownerMarksReceived(`web:${PAGE_HANDLE.slice(0, 16)}`); // the page order paid: its page then has a receipt
    await pageOrder(w, REFUSED_HANDLE, { lines: [{ itemId: "veg-thali", qty: 1 }], date: "2026-12-30", mode: "pickup", slotId: "lunch", name: "Far", phone: "+919888888888" });
    const t0 = w.clock.now();
    keep("upi: held, marked, delivery, big order, page orders", w, [t0, t0 + 25 * 60_000]);
    await w.say("cancel", { from: SUNITA });
    await w.advance(40);
    await w.say("I have paid", { from: AMIT });
    keep("upi: a refund owed, a hold that ran out, a claim", w, [w.clock.now(), w.clock.now() + 3 * DAY_MS]);
    await w.goto({ year: 2026, month: 11, day: 12 }, { hour: 10, minute: 0 });
    keep("upi: two days on", w, [w.clock.now()]);
  }
  // a gateway shop: one paid and confirmed, one cancelled above the refund limit (Guard holds the refund for the owner), one cancelled late (the owner's own call)
  {
    const w = createWorld({ settings: annapurnaRazorpay() });
    await w.say("2 veg thali 10 nov 12:00 pm pickup", { from: AMIT });
    w.pays(AMIT); await w.deliverPaymentEvents();
    await w.say("5 chicken meal 11 nov 12:00 pm pickup", { from: SUNITA });
    w.pays(SUNITA); await w.deliverPaymentEvents();
    await w.say("cancel", { from: SUNITA });
    await w.say("1 chicken meal 9 nov 7:00 pm pickup", { from: RAJESH });
    w.pays(RAJESH); await w.deliverPaymentEvents();
    await w.goto({ year: 2026, month: 11, day: 9 }, { hour: 14, minute: 0 });
    await w.say("cancel", { from: RAJESH });
    keep("razorpay: paid, a held refund, a late cancellation", w, [w.clock.now()]);
    await w.goto({ year: 2026, month: 11, day: 10 }, { hour: 15, minute: 0 });
    keep("razorpay: the next day, done", w, [w.clock.now()]);
  }
  // monthly plans: a plan's first period paid, its meals in the lunch slot beside a meal order, and a skipped day
  {
    const w = createWorld({ settings: annapurnaPlans() });
    await w.say("I want the monthly lunch plan", { from: AMIT });
    await w.ownerMarksReceived(AMIT);
    await w.say("skip 12 nov", { from: AMIT });
    await w.say("I want the monthly lunch plan", { from: RAJESH });
    await w.say("2 veg thali 10 nov 12:00 pm pickup", { from: SUNITA });
    keep("plans: a paid plan, a skipped day, an asked plan, an order", w, [w.clock.now(), w.clock.now() + 2 * DAY_MS]);
  }
  // the second example: Malayalam, the whole order in advance, pickup only, on a gateway
  {
    const w = createWorld({ settings: sweetCrumbs() });
    await w.say("2 plum cake 12 nov 10:00 am", { from: AMIT });
    keep("sweet crumbs: the whole order in advance", w, [w.clock.now()]);
  }
  return out;
}

// ---- the files ---------------------------------------------------------------------------------------------------------------------------------------------------------------------

export async function generate(): Promise<Map<string, Buffer | string>> {
  draws = 0;
  nodeCrypto.randomInt = countingRandomInt;
  syncBuiltinESMExports();
  try { return await files(); } finally { nodeCrypto.randomInt = realRandomInt; syncBuiltinESMExports(); }
}

async function files(): Promise<Map<string, Buffer | string>> {
  const out = new Map<string, Buffer | string>();
  out.set("orders/settings_check.json", JSON.stringify({
    styles: CHARACTER_STYLES.map((id: string) => ({ id, name: STYLE_INFO[id].name, palette: [...STYLE_INFO[id].palette] })),
    personalities: [...PERSONALITIES], paints: [...PAINT_IDS], maxPeople: MAX_PEOPLE, ownerApprover: OWNER_APPROVER,
    refundPaisePerDay: DEFAULT_CAPS.refundPaisePerDay, lowestLinkInr: LOWEST_LINK_INR,
    capabilities: Object.fromEntries(PROVIDERS.map((p: any) => [p.id, p.capabilities])), defaultModule: PROVIDERS[0].id,
    chatGuest: CHAT_GUEST,
  }, null, 1) + "\n");
  out.set("orders/testdata/settings-vectors.json.gz", gzipSync(Buffer.from(stamp({ cases: settingsCases() })), { level: 9 }));
  out.set("orders/testdata/store-vectors.json.gz", gzipSync(Buffer.from(stamp({ cases: await scenarios() })), { level: 9 }));
  return out;
}

const withoutNode = (text: string): string => { try { const o = JSON.parse(text); delete o.node; return JSON.stringify(o); } catch { return text; } };
const textOf = (name: string, v: Buffer | string): string => (typeof v === "string" ? v : name.endsWith(".gz") ? gunzipSync(v).toString("utf8") : v.toString("utf8"));

export async function staleFiles(root = INTERNAL): Promise<string[]> {
  const stale: string[] = [];
  for (const [name, v] of await generate()) {
    const path = join(root, name);
    if (!existsSync(path)) { stale.push(name); continue; }
    const have = readFileSync(path);
    if (withoutNode(textOf(name, have)) !== withoutNode(textOf(name, v))) stale.push(name);
  }
  return stale;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = await staleFiles();
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}  (run node go/scripts/gen_orders_settings.ts)`); process.exit(1); }
  } else {
    for (const [name, v] of await generate()) { mkdirSync(dirname(join(INTERNAL, name)), { recursive: true }); writeFileSync(join(INTERNAL, name), v); }
    console.log(`written with Node ${process.version}`);
  }
}
