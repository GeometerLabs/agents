// Writes go/internal/runtime/testdata/assistant-lines.json: lines the owner's assistant says on a Bookings shop, as the TypeScript writes them (modules/assistant/words.ts
// `write`, templates.ts for a customer's closed-day template) in en, hi, ml and kn, with what the outgoing check (modules/language/check.ts checkText) finds in each over the
// Writer's own facts: nothing in the line as written, and the exact problems once the line is tampered with (a stray number, a changed amount, a link, another date). The Go
// runtime builds the same lines from the same data (internal/runtime/assistantlines_test.go) and must give the same words and, over the facts ITS writer noted, the same problems
// word for word. The combined lines are here on purpose: the day's list (head, rows, "and N more", the closed-day line), a closed day with the customers not reached, and every
// limit line. Run from the repository root:   node go/scripts/gen_assistant_vectors.ts        (add --check to only compare with the committed file)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { write } from "../../modules/assistant/words.ts";
import type { MessageData, MessageId } from "../../modules/assistant/words.ts";
import { dayFacts, render } from "../../modules/assistant/templates.ts";
import { LIMIT_WORDS } from "../../modules/limits/chat-limit-kinds.ts";
import type { LimitView } from "../../modules/assistant/limits-card.ts";
import { checkText } from "../../modules/language/check.ts";
import type { CheckFacts } from "../../modules/language/check.ts";
import { formatDate } from "../../modules/language/format.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";
import { zonedToMs } from "../../modules/core/time.ts";

export const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "internal", "runtime", "testdata", "assistant-lines.json");
const TZ = "Asia/Kolkata";
const D = { year: 2026, month: 11, day: 25 };
const at = (h: number, m: number, d = D) => zonedToMs(d, { hour: h, minute: m }, TZ);

/** The tampered forms of a line: each is checked by the TypeScript over the line's own facts, and Go must find the same problems. */
function tampered(text: string, l: Language): string[] {
  const out = [`${text} 7`, `${text} https://pay.example.in/x`];
  const amount = /₹\s*\d[\d,]*/u.exec(text);
  if (amount) out.push(text.replace(amount[0], `${amount[0]}9`));
  const date = formatDate(D, l);
  if (text.includes(date)) out.push(text.replace(date, formatDate({ ...D, day: 26 }, l)));
  return out;
}

type Case = { lang: Language; kind: string; go: Record<string, unknown>; text: string; problems: string[]; tampered: { text: string; problems: string[] }[] };

function one(lang: Language, kind: string, go: Record<string, unknown>, text: string, facts: CheckFacts): Case {
  const own = checkText(text, facts);
  return { lang, kind, go, text, problems: own.problems, tampered: tampered(text, lang).map((t) => ({ text: t, problems: checkText(t, facts).problems })) };
}

function said<K extends MessageId>(lang: Language, kind: string, go: Record<string, unknown>, id: K, data: MessageData[K]): Case {
  const w = write(id, data, lang, TZ);
  return one(lang, kind, go, w.text, w.facts);
}

const view = (kind: keyof typeof LIMIT_WORDS, id: string, unit: "inr" | "count", zeroIsOff = false): LimitView => ({ id, unit, zeroIsOff, name: LIMIT_WORDS[kind].name, rule: LIMIT_WORDS[kind].rule });

/** The vectors' text. */
export function generate(): string {
  const cases: Case[] = [];
  const rows = [
    { case: "b-7", startMs: at(10, 30), what: "Haircut", who: "Asha", state: "confirmed" },
    { case: "b-12", startMs: at(16, 5), what: "Beard trim", who: "Room 4 Ravi", state: "confirmed" },
  ];
  const many = Array.from({ length: 14 }, (_, i) => ({ case: `b-${i + 1}`, startMs: at(9 + Math.floor(i / 2), (i % 2) * 30), what: "Haircut", who: `Guest ${i + 1}`, state: "confirmed" }));
  const owes = [
    { case: "f-1", who: "Meera Nair", what: "Sep 2026", amountPaise: 150000, dueMs: at(9, 0) },
    { case: "f-2", who: "Rohan Mehta", what: "Sep 2026", amountPaise: 180050, dueMs: at(9, 0) },
  ];
  const owesMany = Array.from({ length: 14 }, (_, i) => ({ case: `f-${i + 1}`, who: `Student ${i + 1}`, what: "Nov 2026", amountPaise: 120000 + i * 100, dueMs: at(9, 0) }));
  const refund = view("refund", "refund_limit", "inr");
  const perDay = view("perDay", "per_day", "count");
  const bigOrder = view("bigOrder", "big_order", "inr", true);
  for (const lang of LANGUAGES) {
    cases.push(said(lang, "day_list", { date: D, rows, closed: false }, "day_list", { date: D, rows, closed: false }));
    cases.push(said(lang, "day_list", { date: D, rows: many, closed: true }, "day_list", { date: D, rows: many, closed: true }));
    cases.push(said(lang, "day_list", { date: D, rows: [], closed: true }, "day_list", { date: D, rows: [], closed: true }));
    const booked = [{ case: "b-1", who: "Asha" }, { case: "b-2", who: "Ravi" }, { case: "b-3", who: "Meena 2" }];
    cases.push(said(lang, "closed", { date: D, booked, told: ["b-2"] }, "closed", { date: D, booked: 3, missed: [booked[0], booked[2]] }));
    cases.push(said(lang, "closed", { date: D, booked, told: ["b-1", "b-2", "b-3"] }, "closed", { date: D, booked: 3, missed: [] }));
    cases.push(said(lang, "closed", { date: D, booked: [], told: [] }, "closed", { date: D, booked: 0, missed: [] }));
    cases.push(said(lang, "say", { key: "reopened.n", date: D, n: 2 }, "reopened", { date: D, told: 2 }));
    for (const [what, value] of [["pending", 500], ["active", 300], ["failed", 1000]] as const) {
      const d = what === "failed" ? { what, limit: refund, from: value } : { what, limit: refund, to: value };
      cases.push(said(lang, "limit", { what, kind: "refund", unit: "inr", value }, "limit", d as never));
    }
    cases.push(said(lang, "limit", { what: "active", kind: "perDay", unit: "count", value: 12 }, "limit", { what: "active", limit: perDay, to: 12 }));
    cases.push(said(lang, "limit", { what: "active", kind: "bigOrder", unit: "inr", zeroIsOff: true, value: 0 }, "limit", { what: "active", limit: bigOrder, to: 0 }));
    cases.push(said(lang, "not_tighter", { kind: "refund", unit: "inr", now: 500, to: 800 }, "limit", { what: "not_tighter", limit: refund, now: 500, to: 800 }));
    cases.push(said(lang, "which", { kinds: ["refund", "perDay"] }, "limit", { what: "which", limits: [refund, perDay] }));
    cases.push(said(lang, "card_limit", { kind: "refund", unit: "inr", now: 1000, to: 500, code: "K7M2QX" }, "card", { kind: "limit", skill: "limits", who: "", ref: "limit:refund_limit", what: "", amountPaise: 0, code: "K7M2QX", hasNo: true, limit: { ...refund, now: 1000, to: 500 } }));
    cases.push(said(lang, "card", { kind: "cancel", ref: "b-12", who: "Room 4 Ravi", what: "Beard trim", amountPaise: 50000, code: "K7M2QX", hasNo: true }, "card", { kind: "cancel", skill: "bookings", who: "Room 4 Ravi", ref: "b-12", what: "Beard trim", amountPaise: 50000, code: "K7M2QX", hasNo: true }));
    cases.push(said(lang, "say", { key: "refusal.no_window", ref: "b-12", who: "Room 4 Ravi" }, "refusal", { why: "no_window", ref: "b-12", who: "Room 4 Ravi" }));
    cases.push(said(lang, "say", { key: "money_in.some", date: D, paise: 150050, n: 3 }, "money_in", { date: D, paise: 150050, payments: 3 }));
    cases.push(said(lang, "say", { key: "help.warm.plain@bookings", shop: "Sharma Salon 2" }, "help", { shop: "Sharma Salon 2", kinds: ["waiting", "money", "cancel", "refund", "message", "undo", "limit", "help", "remember", "notes", "forget", "leave_file", "leave_operator", "day", "close_day", "reopen_day", "move"], personality: "warm" }));
    cases.push(said(lang, "need_ref", { kind: "cancel", rows }, "need_ref", { kind: "cancel", rows }));
    // a Fees centre's (23 Nov 2026): who owes (none, two rows, fourteen with "and 2 more"), the waiver card, and the Fees skill's own cancel and refund cards
    cases.push(said(lang, "owes_list", { rows: owes }, "owes_list", { rows: owes }));
    cases.push(said(lang, "owes_list", { rows: owesMany }, "owes_list", { rows: owesMany }));
    cases.push(said(lang, "owes_list", { rows: [] }, "owes_list", { rows: [] }));
    for (const c of [
      { kind: "answer", itemKind: "waiver", ref: "f-2", who: "Rohan Mehta", what: "Sep 2026", amountPaise: 50000, hasNo: true },
      { kind: "answer", itemKind: "refund_request", ref: "f-2", who: "Rohan Mehta", what: "Sep 2026", amountPaise: 40000, hasNo: true },
      { kind: "cancel", ref: "f-2", who: "Rohan Mehta", what: "Sep 2026", amountPaise: 0, hasNo: true },
      { kind: "refund", ref: "f-2", who: "Rohan Mehta", what: "Sep 2026", amountPaise: 180000, hasNo: true },
    ]) cases.push(said(lang, "card", { ...c, skill: "fees", code: "K7M2QX" }, "card", { ...c, skill: "fees", code: "K7M2QX" }));
    cases.push(said(lang, "say", { key: "help.warm.plain@fees", shop: "Bright Tuition Centre" }, "help", { shop: "Bright Tuition Centre", kinds: ["waiting", "money", "cancel", "refund", "message", "undo", "limit", "help", "remember", "notes", "forget", "leave_file", "leave_operator", "owes"], personality: "warm" }));
    const facts = dayFacts({ language: lang, timeZone: TZ, shop: "Sharma Salon 2", date: D, startMs: at(16, 5) });
    cases.push(one(lang, "tmpl", { id: "day_closed", shop: "Sharma Salon 2", date: D, startMs: at(16, 5) }, render("day_closed", facts), facts.check));
  }
  return `${JSON.stringify({ timeZone: TZ, cases }, null, 1)}\n`;
}

/** True when the committed file differs from a fresh render. */
export function stale(file = OUT): boolean {
  try { return readFileSync(file, "utf8") !== generate(); } catch { return true; }
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    if (stale()) { console.error(`${OUT} is out of date: run node go/scripts/gen_assistant_vectors.ts`); process.exit(1); }
    console.log("assistant line vectors are fresh");
  } else {
    writeFileSync(OUT, generate());
    console.log(`wrote ${OUT}`);
  }
}
