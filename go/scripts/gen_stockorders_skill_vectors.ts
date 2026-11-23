// Writes go/internal/stockorders/testdata/skill-vectors.json: what the TypeScript Stock orders skill (templates/commerce/stock-orders/src/assistant.ts stockSkill) reads and prepares over
// a store with an order in every state, so the Go skill (go/internal/stockorders/skill.go) is held equal to it where no contract can reach: the owner's talk reads (`facts`, and
// `publicContext` for each supplier, a stranger and nobody), the open list, what waits, the count of problems, and `prepare` for every kind of proposal on every order (a cancel
// is prepared only for an order that has not gone out and shows no money moving; an answer is bound to the exact action the agent's own card is). The shop is the Glow salon
// example with the owner's language en, hi and ml, at a fixed time in November 2026.
// Run from the repository root:   node go/scripts/gen_stockorders_skill_vectors.ts        (add --check to only compare with the committed file; words-fresh runs the check too)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zonedToMs } from "../../modules/core/time.ts";
import { stockSkill } from "../../templates/commerce/stock-orders/src/assistant.ts";
import { createStore, monthOf } from "../../templates/commerce/stock-orders/src/order.ts";
import type { OrderState, PurchaseOrder } from "../../templates/commerce/stock-orders/src/order.ts";
import { lineKey, parseSettings } from "../../templates/commerce/stock-orders/src/settings.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = join(here, "..", "internal", "stockorders", "testdata", "skill-vectors.json");
const SETTINGS_FILE = join(here, "..", "..", "templates", "commerce", "stock-orders", "settings", "glow-salon.example.json");
const NOW = zonedToMs({ year: 2026, month: 11, day: 25 }, { hour: 10, minute: 0 }, "Asia/Kolkata");

/** One order of the example shop: the catalogue line by its position (0 hair colour per box from Ravi, ...), a quantity, a state and what else it carries. */
type Spec = { state: OrderState; line: number; qty: number; extra?: Partial<PurchaseOrder>; month?: string };
const SPECS: Spec[] = [
  { state: "awaiting_approval", line: 0, qty: 10 },
  { state: "sent", line: 0, qty: 4, extra: { ack: "none", sentMs: NOW - 3_600_000 } },
  { state: "sent", line: 1, qty: 5, extra: { ack: "accepted", receipt: "part", receivedQty: 2 } },
  { state: "send_failed", line: 2, qty: 3 },
  { state: "send_blocked", line: 3, qty: 6 },
  { state: "send_unknown", line: 0, qty: 2, extra: { silentToldMs: NOW - 1000 } },
  { state: "approved", line: 2, qty: 7 },
  { state: "cancelled", line: 0, qty: 1 },
  { state: "sent", line: 0, qty: 8, extra: { ack: "accepted", receipt: "full", receivedQty: 8 } },
  { state: "sent", line: 2, qty: 2, extra: { receipt: "wrong_item" } },
  { state: "supplier_declined", line: 1, qty: 9, extra: { ack: "declined" } },
  { state: "sent", line: 3, qty: 12, month: "2026-10", extra: { ack: "none" } },
  { state: "awaiting_approval", line: 3, qty: 1 },
  { state: "sent", line: 0, qty: 3, extra: { ack: "none", silentToldMs: NOW - 5000 } },
];

function ordersFor(settings: ReturnType<typeof parseSettings>): PurchaseOrder[] {
  return SPECS.map((s, i) => {
    const l = settings.catalogue[s.line % settings.catalogue.length];
    const unitPaise = Math.round(l.priceInr * 100);
    const held = ["approved", "sent", "send_unknown", "send_failed", "send_blocked"].includes(s.state);
    return {
      id: `po-${i + 1}`, requestId: `wamid.${i + 1}`, lowStock: false, supplier: l.supplier, line: lineKey(l), item: l.item, unit: l.unit, qty: s.qty, unitPaise, totalPaise: unitPaise * s.qty,
      state: s.state, createdMs: NOW - 86_400_000, ack: "none", receipt: "none", receivedQty: 0, asks: [],
      ...(held || s.state === "supplier_declined" || s.state === "cancelled" ? { approvedMs: NOW - 7_200_000, budgetMonth: s.month ?? monthOf(NOW, settings.timezone) } : {}),
      ...(s.extra ?? {}),
    } as PurchaseOrder;
  });
}

const PHONES = ["+919876500001", "+91 98765 00002", "+919876500003", "+919811199999", ""];

const PROPOSALS = (id: string) => [
  { kind: "answer", case: id, answer: "yes", itemKind: "order_approval" }, { kind: "answer", case: id, answer: "no", itemKind: "order_approval" },
  { kind: "cancel", case: id }, { kind: "refund", case: id }, { kind: "message", case: id },
];

export function generate(): string {
  const base = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
  const cases = ["en", "hi", "ml"].map((lang) => {
    const raw = { ...base, owner: { ...base.owner, language: lang } };
    const settings = parseSettings(raw);
    const store = createStore();
    for (const o of ordersFor(settings)) store.orders.set(o.id, o);
    const skill = stockSkill({ settings, store, nowMs: () => NOW, optedOut: () => false });
    const prepared: { proposal: unknown; result: unknown }[] = [];
    for (const p of [...[...store.orders.keys(), "po-99"].flatMap(PROPOSALS), { kind: "limit", case: "limit:refund_limit" }]) {
      const r = skill.prepare(p as never);
      prepared.push({ proposal: p, result: r.ok ? { ok: true, action: { kind: r.action.kind, skill: r.action.skill, case: r.action.case, fields: r.action.fields }, shown: r.shown } : { ok: false, why: r.why } });
    }
    return {
      lang, settings: raw, orders: [...store.orders.values()], nowMs: NOW,
      facts: skill.facts!(NOW), publicContext: PHONES.map((phone) => ({ phone, sources: skill.publicContext!(phone, NOW) })),
      open: skill.open!(), waiting: skill.waiting!(), problems: skill.problems!(), prepared,
    };
  });
  return `${JSON.stringify({ cases }, null, 1)}\n`;
}

export function stale(file = OUT): boolean {
  try { return readFileSync(file, "utf8") !== generate(); } catch { return true; }
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    if (stale()) { console.error(`${OUT} is out of date: run node go/scripts/gen_stockorders_skill_vectors.ts`); process.exit(1); }
    console.log("stock-orders skill vectors are fresh");
  } else { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, generate()); console.log(`wrote ${OUT}`); }
}
