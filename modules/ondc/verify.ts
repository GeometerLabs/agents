// What the tests hold a built message to, kept with the mapping so the module's tests and each template's example-shop tests ask the very same questions: every required
// field of the contract is there (or its gap is reported), the enums are ONDC's, every amount is an exact decimal string, and a quote's breakup adds up to its total.
// Not used by the mapping itself. The sample caller is made-up test data (a buyer app, a transaction, a buyer) and nothing in it is real.
import { checkRequired } from "./contract.ts";
import type { Problem, Spec } from "./contract.ts";
import { paiseOf } from "./money.ts";
import type { Caller } from "./common.ts";
import type { Out } from "./common.ts";

export const SAMPLE_CALLER: Caller = {
  transactionId: "t-1", messageId: "m-1", timestampMs: Date.UTC(2026, 10, 17, 6, 30), bapId: "buyer.example", bapUri: "https://buyer.example/ondc", bppId: "seller.example", bppUri: "https://seller.example/ondc", cityCode: "std:0484",
  buyer: { name: "Test Buyer", phone: "9000000000", email: "buyer@example.invalid", address: { name: "Home", building: "Flat 1", locality: "Test Road", city: "Kochi", state: "Kerala", country: "IND", areaCode: "682030" }, gps: "10.0,76.3", at: "2026-11-17T06:00:00.000Z" },
  pay: { uri: "upi://pay?pa=test@bank&am=1.00", method: "upi", reference: "ref-1" },
  // what a supplier's on_init would have said, for a B2B confirm to echo
  supplierTerms: { cancellation_terms: [{ fulfillment_state: { descriptor: { code: "Pending" } }, cancellation_fee: { percentage: "0" } }], tags: [{ descriptor: { code: "bpp_terms" }, list: [{ descriptor: { code: "max_liability" }, value: "0" }] }] },
};

export const RETAIL_ORDER_STATES = ["Created", "Accepted", "In-progress", "Completed", "Cancelled"];
export const FULFILLMENT_TYPES = ["Delivery", "Self-Pickup"];
export const FULFILLMENT_STATES = ["Pending", "Packed", "Order-picked-up", "Out-for-delivery", "Order-delivered", "Completed"];

type J = Record<string, unknown>;
const walk = (v: unknown, f: (k: string, v: unknown, parent: J) => void): void => {
  if (Array.isArray(v)) v.forEach((x) => walk(x, f));
  else if (typeof v === "object" && v !== null) for (const [k, x] of Object.entries(v)) { f(k, x, v as J); walk(x, f); }
};

/** Every `{currency, value}` in a message holds an exact decimal string. */
export function badMoney(msg: unknown): string[] {
  const bad: string[] = [];
  walk(msg, (k, v, parent) => { if (k === "value" && "currency" in parent && paiseOf(v) === undefined) bad.push(String(v)); });
  return bad;
}

/** A quote's lines add up to its price. Null when there is no quote. */
export function quoteAdds(msg: unknown): boolean | null {
  const q = ((msg as J)?.order as J | undefined)?.quote as J | undefined;
  if (!q) return null;
  const total = paiseOf((q.price as J).value);
  const sum = (q.breakup as J[]).reduce((n, b) => n + (paiseOf((b.price as J).value) ?? NaN), 0);
  return total !== undefined && total === sum;
}

/** The enums of a retail order or catalogue message. */
export function badRetailEnums(msg: unknown): string[] {
  const bad: string[] = [];
  const order = (msg as J)?.order as J | undefined;
  if (order) {
    if (order.state !== undefined && !RETAIL_ORDER_STATES.includes(order.state as string)) bad.push(`state ${String(order.state)}`);
    for (const f of (order.fulfillments as J[] | undefined) ?? []) {
      if (!FULFILLMENT_TYPES.includes(f.type as string)) bad.push(`fulfillment type ${String(f.type)}`);
      const code = ((f.state as J | undefined)?.descriptor as J | undefined)?.code as string;
      if (!FULFILLMENT_STATES.includes(code)) bad.push(`fulfillment state ${code}`);
    }
    const p = order.payment as J | undefined;
    if (p) {
      if (!["PAID", "NOT-PAID"].includes(p.status as string)) bad.push(`payment status ${String(p.status)}`);
      if (!["ON-ORDER", "ON-FULFILLMENT", "POST-FULFILLMENT"].includes(p.type as string)) bad.push(`payment type ${String(p.type)}`);
      if (!["BAP", "BPP"].includes(p.collected_by as string)) bad.push(`collected_by ${String(p.collected_by)}`);
    }
  }
  return bad;
}

export interface Audit { missing: Problem[]; money: string[]; sums: boolean | null; enums: string[]; gaps: string[] }
/** All the checks on one built message against its required list. */
export function audit(out: Out, spec: Spec, retail: boolean, callerGave = true): Audit {
  const gaps = out.gaps.map((g) => g.missing);
  return { missing: checkRequired(out.body, spec, gaps, callerGave), money: badMoney(out.body), sums: quoteAdds(out.message), enums: retail ? badRetailEnums(out.message) : [], gaps };
}
