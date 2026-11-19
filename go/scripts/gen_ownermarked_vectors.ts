// Writes the TEST VECTORS of the Go owner-marked ledger (go/internal/payments/ownermarked/testdata/vectors.json) and of the UPI owner's buttons for Bookings
// (go/internal/bookings/testdata/ownermark-buttons-vectors.json), made by RUNNING the TypeScript of modules/payments/owner-marked (ledger.ts, owner.ts, buttons.ts) on Node
// (decision 61, wave 2). The Go tests compare the state after EVERY step, the results and the thrown words.
//
// The ledger draws its one-use codes with approvals/code.ts newCode, which uses node:crypto randomInt. Here randomInt is replaced by a replay of a list of draws the scenario
// names (`rolls`, each below 31, taken in order and wrapping), so a code is a function of the draws and the Go test replays the very same draws. The codes in a step ("mark",
// "markRefund") are resolved here and written as plain text, so the Go side needs no lookup of its own.
// Run from the repository root:  node go/scripts/gen_ownermarked_vectors.ts   (--check only compares; templates/commerce/bookings/test/go-ownermarked-fresh.test.ts calls `staleFiles`)
// The vectors name the Node that made them (`node`), left out of the freshness comparison so a newer Node that writes the same figures is not "stale".
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../../modules/language/languages.ts";
import { CODE_ALPHABET } from "../../modules/approvals/code.ts";
import { emptyMarkState, markReceived, markRefund, markedPayments, noGateway, oweRefund, openRequest, closeRequest, reminded, remindersDue, owedOn, requestOfMark, leftOn } from "../../modules/payments/owner-marked/ledger.ts";
import type { MarkState } from "../../modules/payments/owner-marked/ledger.ts";
import { parseMarkReply, markButtonId } from "../../modules/payments/owner-marked/owner.ts";
import { ownerMarkButtons } from "../../templates/commerce/bookings/src/language/interactive.ts";

const here = dirname(fileURLToPath(import.meta.url));
const INTERNAL = join(here, "..", "internal");
export const OUT = INTERNAL;
const stamp = (v: unknown): string => JSON.stringify({ node: process.version, ...(v as object) }, null, 1) + "\n";

// ---- the draws ----
let rolls: number[] = [];
let drawn = 0;
(crypto as unknown as { randomInt: (n: number) => number }).randomInt = (n: number) => {
  if (n !== CODE_ALPHABET.length) throw new Error(`unexpected randomInt(${n})`);
  return rolls[drawn++ % rolls.length];
};
syncBuiltinESMExports();
const counting = (): number[] => Array.from({ length: CODE_ALPHABET.length }, (_, i) => i);

/** The pay link both sides use: a note holding "BAD" is a field a UPI app would not take. */
const payLink = (r: { amountPaise: number; note: string }): string => {
  if (r.note.includes("BAD")) throw new Error("The note is not one a UPI app would take.");
  return `upi://pay?am=${r.amountPaise}&tn=${r.note}`;
};

type Spec = Record<string, unknown>;
const J = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

/** A code named in a scenario step: the live code of a request or refund, a used one, or a literal. Resolved to text. */
function resolve(state: MarkState, spec: Spec): string {
  if (typeof spec.literal === "string") return spec.literal;
  if (typeof spec.live === "string") { const r = state.requests.find((x) => x.id === spec.live); if (r?.code) return r.code; const f = state.refunds.find((x) => x.id === spec.live); return f?.code ?? "NOCODE"; }
  if (typeof spec.used === "string") { const r = state.requests.find((x) => x.id === spec.used) ?? state.refunds.find((x) => x.id === spec.used); return r?.usedCodes[Number(spec.index ?? 0)] ?? "NOUSED"; }
  throw new Error("a code spec names a live code, a used one or a literal");
}

interface Scenario { name: string; rolls: number[]; steps: Spec[] }

const REQ = (amount: number, ref: string, extra: Spec = {}) => ({ amount, reference_id: ref, description: `Deposit for ${ref}`, ...extra });

const SCENARIOS: Scenario[] = [
  { name: "a deposit paid in full by one mark", rolls: counting(), steps: [
    { op: "open", req: REQ(20_000, "b-1"), now: 1_000 },
    { op: "mark", code: { live: "upi-1" }, now: 2_000 },
    { op: "mark", code: { used: "upi-1" }, now: 3_000 },
    { op: "mark", code: { literal: "ZZZZZZ" }, now: 3_500 },
  ] },
  { name: "a deposit paid in two marks, the second asked by its new code", rolls: counting(), steps: [
    { op: "open", req: REQ(20_000, "b-2", { part_payments: true }), now: 1_000 },
    { op: "mark", code: { live: "upi-1" }, amountPaise: 5_000, now: 2_000 },
    { op: "mark", code: { used: "upi-1" }, now: 2_500 },
    { op: "mark", code: { live: "upi-1" }, now: 3_000 },
    { op: "view", call: "fetchRequest", id: "upi-1", now: 3_100 },
    { op: "view", call: "listRequests", query: { payment_id: "upi-pay-2" }, now: 3_100 },
    { op: "view", call: "fetchPayment", id: "upi-pay-2", now: 3_100 },
    { op: "view", call: "fetchPayment", id: "nope", now: 3_100 },
  ] },
  { name: "a bad amount: nothing, a negative one, over ten times the request, exactly ten times", rolls: counting(), steps: [
    { op: "open", req: REQ(10_000, "b-3"), now: 1_000 },
    { op: "mark", code: { live: "upi-1" }, amountPaise: 0, now: 2_000 },
    { op: "mark", code: { live: "upi-1" }, amountPaise: -5, now: 2_000 },
    { op: "mark", code: { live: "upi-1" }, amountPaise: 100_001, now: 2_000 },
    { op: "mark", code: { live: "upi-1" }, amountPaise: 100_000, now: 2_100 },
  ] },
  { name: "a request the agent closed still takes a late mark, recorded as after the close", rolls: counting(), steps: [
    { op: "open", req: REQ(15_000, "b-4"), now: 1_000 },
    { op: "close", id: "upi-1", now: 1_500 },
    { op: "close", id: "upi-1", now: 1_600 },
    { op: "mark", code: { live: "upi-1" }, now: 2_000 },
    { op: "view", call: "listRequests", query: { reference_id: "b-4" }, now: 2_100 },
    { op: "close", id: "upi-1", now: 2_200 },
  ] },
  { name: "a closed part-paid request, then the rest", rolls: counting(), steps: [
    { op: "open", req: REQ(30_000, "b-5", { part_payments: true }), now: 1_000 },
    { op: "mark", code: { live: "upi-1" }, amountPaise: 10_000, now: 2_000 },
    { op: "close", id: "upi-1", now: 2_500 },
    { op: "mark", code: { live: "upi-1" }, amountPaise: 20_000, now: 3_000 },
  ] },
  { name: "a refund owed, reminded, and marked done; a second mark of the same code is already", rolls: counting(), steps: [
    { op: "open", req: REQ(20_000, "b-6"), now: 1_000 },
    { op: "mark", code: { live: "upi-1" }, now: 2_000 },
    { op: "owe", refund: { caseId: "b-6", customer: "+919800000001", paymentId: "upi-pay-2", amountPaise: 20_000, why: "cancelled" }, now: 3_000 },
    { op: "owedOn", paymentId: "upi-pay-2" },
    { op: "requestOfMark", paymentId: "upi-pay-2" },
    { op: "due", now: 3_000 },
    { op: "due", now: 3_000 + 86_400_000 },
    { op: "reminded", id: "upr-3", now: 3_000 + 86_400_000 },
    { op: "due", now: 3_000 + 86_400_000 },
    { op: "due", now: 3_000 + 2 * 86_400_000 },
    { op: "reminded", id: "upr-3", now: 3_000 + 2 * 86_400_000 },
    { op: "reminded", id: "upr-3", now: 3_000 + 3 * 86_400_000 },
    { op: "due", now: 3_000 + 9 * 86_400_000 },
    { op: "view", call: "listRefunds", id: "upi-pay-2", now: 4_000 },
    { op: "markRefund", code: { live: "upr-3" }, how: "kept", now: 5_000 },
    { op: "markRefund", code: { live: "upr-3" }, how: "done", now: 6_000 },
    { op: "markRefund", code: { used: "upr-3" }, how: "done", now: 7_000 },
    { op: "markRefund", code: { literal: "QQQQQQ" }, how: "done", now: 7_000 },
    { op: "mark", code: { used: "upr-3" }, now: 8_000 },
    { op: "view", call: "listRefunds", id: "upi-pay-2", now: 9_000 },
    { op: "view", call: "fetchPayment", id: "upi-pay-2", now: 9_000 },
  ] },
  { name: "a refund the owner keeps, where that is allowed", rolls: counting(), steps: [
    { op: "open", req: REQ(20_000, "b-7"), now: 1_000 },
    { op: "mark", code: { live: "upi-1" }, now: 2_000 },
    { op: "owe", refund: { caseId: "b-7", customer: "+919800000002", paymentId: "upi-pay-2", amountPaise: 20_000, why: "paid twice", keepAllowed: true }, now: 3_000 },
    { op: "markRefund", code: { live: "upr-3" }, how: "kept", now: 4_000 },
    { op: "owedOn", paymentId: "upi-pay-2" },
    { op: "view", call: "listRefunds", id: "upi-pay-2", now: 4_100 },
  ] },
  { name: "a code already held is drawn again", rolls: [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], steps: [
    { op: "open", req: REQ(10_000, "b-8"), now: 1_000 },
    { op: "open", req: REQ(12_000, "b-9"), now: 1_100 },
    { op: "owe", refund: { caseId: "b-8", customer: "+919800000003", paymentId: "upi-pay-9", amountPaise: 100, why: "test" }, now: 1_200 },
  ] },
  { name: "fifty-one draws that all collide give the last code, as the loop ends", rolls: [0, 1, 2, 3, 4, 5], steps: [
    { op: "open", req: REQ(10_000, "b-10"), now: 1_000 },
    { op: "open", req: REQ(10_000, "b-11"), now: 1_100 },
  ] },
  { name: "a link that cannot be made counts the number and writes nothing", rolls: counting(), steps: [
    { op: "open", req: REQ(10_000, "b-12"), now: 1_000 },
    { op: "open", req: REQ(10_000, "b-BAD"), now: 1_100 },
    { op: "open", req: REQ(10_000, "b-13"), now: 1_200 },
    { op: "view", call: "createRequest", req: REQ(5_000, "b-14", { part_payments: true }), now: 1_300 },
    { op: "view", call: "createRequest", req: REQ(5_000, "b-BAD"), now: 1_400 },
  ] },
  { name: "what the neutral view cannot do", rolls: counting(), steps: [
    { op: "open", req: REQ(10_000, "b-15"), now: 1_000 },
    { op: "view", call: "refund", id: "upi-pay-9", now: 1_100 },
    { op: "view", call: "resendRefund", id: "upi-pay-9", now: 1_100 },
    { op: "view", call: "cancelRequest", id: "upi-9", now: 1_100 },
    { op: "view", call: "cancelRequest", id: "upi-1", now: 1_200 },
    { op: "view", call: "fetchRequest", id: "upi-9", now: 1_300 },
    { op: "view", call: "listRequests", query: {}, now: 1_300 },
    { op: "view", call: "listRequests", query: { reference_id: "nothing" }, now: 1_300 },
  ] },
  { name: "a request time that is not a whole second", rolls: counting(), steps: [
    { op: "open", req: REQ(10_000, "b-16"), now: 1_999 },
    { op: "mark", code: { live: "upi-1" }, now: 2_999 },
    { op: "view", call: "fetchRequest", id: "upi-1", now: 3_000 },
  ] },
];

async function run(sc: Scenario): Promise<unknown> {
  rolls = sc.rolls; drawn = 0;
  const state = emptyMarkState();
  let now = 0;
  const view = markedPayments(state, payLink, { now: () => now });
  const out: unknown[] = [];
  for (const raw of sc.steps) {
    const step: Spec = { ...raw };
    now = Number(step.now ?? 0);
    let result: unknown;
    try {
      switch (step.op) {
        case "open": { const r = openRequest(state, payLink, step.req as never, now); result = J(r); break; }
        case "mark": { const code = resolve(state, step.code as Spec); step.code = code; result = J(markReceived(state, code, step.amountPaise as number | undefined, now)); break; }
        case "markRefund": { const code = resolve(state, step.code as Spec); step.code = code; result = J(markRefund(state, code, step.how as "done" | "kept", now)); break; }
        case "owe": result = J(oweRefund(state, step.refund as never, now)); break;
        case "close": { const r = state.requests.find((x) => x.id === step.id)!; closeRequest(r, now); result = J(r); break; }
        case "due": result = remindersDue(state, now).map((r) => r.id); break;
        case "reminded": { const r = state.refunds.find((x) => x.id === step.id)!; reminded(r, now); result = J(r); break; }
        case "owedOn": result = owedOn(state, step.paymentId as string); break;
        case "requestOfMark": result = J(requestOfMark(state, step.paymentId as string) ?? null); break;
        case "view": {
          const id = step.id as string;
          const v = view as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
          result = J(await (step.call === "createRequest" ? v.createRequest(step.req) : step.call === "listRequests" ? v.listRequests(step.query) : step.call === "refund" ? v.refund() : step.call === "resendRefund" ? v.resendRefund() : v[step.call as string](id)));
          break;
        }
        default: throw new Error(`unknown step ${String(step.op)}`);
      }
    } catch (e) { result = { threw: (e as Error).message, class: (e as Error).constructor.name }; }
    out.push({ ...step, result, state: J(state) });
  }
  return { name: sc.name, rolls: sc.rolls, steps: out, leftOn: state.requests.map((r) => ({ id: r.id, left: leftOn(r) })) };
}

/** Every reply the owner might type or tap, and what parseMarkReply reads of it. */
const REPLIES: { text: string; id?: string }[] = [
  { text: "", id: "upi-received:K7M2QX" }, { text: "", id: "upi-refunded:k7m2qx" }, { text: "", id: "upi-kept:K7M2" }, { text: "", id: "upi-received:K7M2QXY" }, { text: "", id: "upi-received:K70M2Q" },
  { text: "", id: "upi-other:K7M2QX" }, { text: "words", id: "bogus" }, { text: "received K7M2QX" }, { text: "Received k7m2qx" }, { text: "RECEIVED K7M2QX 150" }, { text: "received K7M2QX 1,500" },
  { text: "received K7M2QX rs 150" }, { text: "received K7M2QX Rs. 150" }, { text: "received K7M2QX inr 150.5" }, { text: "received K7M2QX ₹150.50" }, { text: "received K7M2QX ₹ 150" }, { text: "received K7M2QX 150.555" },
  { text: "received K7M2QX 1,50,000" }, { text: "received K7M2QX 12,34" }, { text: "received K7M2QX 99999999999999999999" }, { text: "received K7M2QX 0" }, { text: "received K7M2QX 0.05" }, { text: "recieved K7M2QX" },
  { text: "got K7M2QX 200" }, { text: "paid K7M2QX" }, { text: "  paid   K7M2QX   " }, { text: "paid K7M2QX" }, { text: "paid K7M2QX 100" }, { text: "paid K7M2QX 100 rupees" }, { text: "paid K7M2Q" }, { text: "paid K7M" },
  { text: "paid K7M2QXY" }, { text: "paid O0O0O0" }, { text: "refunded K7M2QX" }, { text: "Returned k7m2qx" }, { text: "kept K7M2QX" }, { text: "KEPT k7m2qx" }, { text: "refunded K7M2QX now" }, { text: "refund K7M2QX" },
  { text: "approve K7M2QX" }, { text: "received" }, { text: "received 150" }, { text: "yes" }, { text: "ſ" }, { text: "paid K7M2QX" }, { text: "received K7M2QX 150\n" }, { text: "received\nK7M2QX" },
];

function replies(): unknown {
  return REPLIES.map((m) => ({ text: m.text, ...(m.id !== undefined ? { id: m.id } : {}), out: J(parseMarkReply({ text: m.text, ...(m.id !== undefined ? { reply: { id: m.id } } : {}) }) ?? null) }));
}

function buttons(): unknown {
  const out: unknown[] = [];
  for (const language of LANGUAGES) {
    for (const amountInr of [200, 1250, 99.5, 0, 100000]) out.push({ language, kind: "received", code: "K7M2QX", amountInr, out: ownerMarkButtons(language, { kind: "received", code: "K7M2QX", amountInr }) });
    for (const keepAllowed of [false, true]) out.push({ language, kind: "refund", code: "K7M2QX", keepAllowed, out: ownerMarkButtons(language, { kind: "refund", code: "K7M2QX", keepAllowed }) });
  }
  return { cases: out, ids: (["received", "refunded", "kept"] as const).map((k) => ({ kind: k, code: "AB23CD", out: markButtonId(k, "AB23CD") })) };
}

export async function generate(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const scenarios: unknown[] = [];
  for (const sc of SCENARIOS) scenarios.push(await run(sc));
  // the placeholder gateway: every call says so, with the method's own name
  const gw: Record<string, string> = {};
  for (const name of ["createRequest", "fetchRequest", "listRequests", "cancelRequest", "fetchPayment", "refund", "resendRefund", "listRefunds"]) {
    try { await (noGateway as unknown as Record<string, () => Promise<unknown>>)[name](); } catch (e) { gw[name] = (e as Error).message; }
  }
  out.set("payments/ownermarked/testdata/vectors.json", stamp({ alphabet: CODE_ALPHABET, scenarios, replies: replies(), noGateway: gw }));
  out.set("bookings/testdata/ownermark-buttons-vectors.json", stamp(buttons()));
  return out;
}

/** The text of a vector file without its `node` member, so a newer Node that writes the same figures is not reported stale. */
const withoutNode = (text: string): string => { const o = JSON.parse(text); delete o.node; return JSON.stringify(o); };

export async function staleFiles(root = INTERNAL): Promise<string[]> {
  return [...(await generate())].filter(([name, text]) => !existsSync(join(root, name)) || withoutNode(readFileSync(join(root, name), "utf8")) !== withoutNode(text)).map(([name]) => name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = await staleFiles();
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}  (run node go/scripts/gen_ownermarked_vectors.ts)`); process.exit(1); }
  } else {
    for (const [name, text] of await generate()) { mkdirSync(dirname(join(INTERNAL, name)), { recursive: true }); writeFileSync(join(INTERNAL, name), text); }
    console.log(`written with Node ${process.version}`);
  }
}
