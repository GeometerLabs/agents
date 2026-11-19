// Vector cases for the in-memory stand-in gateway (go/internal/payments/fake.go): a script of calls on createFakePayments with a fixed clock, and what each one gave (a result or an
// error's words) with the links, refunds and events at the end. The Go fake must give the same ids, the same answers and the same events.
import { createFakePayments } from "../../../modules/payments/payments.ts";

type Step = { op: string; args?: any[] };

const scripts: { name: string; steps: Step[] }[] = [
  { name: "a link, paid in full, then refunded in two parts", steps: [
    { op: "createRequest", args: [{ amount: 60000, reference_id: "b-1", description: "Deposit" }] },
    { op: "customerPays", args: ["req_1"] },
    { op: "listRequests", args: [{ reference_id: "b-1" }] },
    { op: "fetchPayment", args: ["pmt_3"] },
    { op: "refund", args: ["pmt_3", { amount: 20000, receipt: "b-1:pmt_3" }] },
    { op: "refund", args: ["pmt_3", { amount: 40000 }] },
    { op: "refund", args: ["pmt_3", { amount: 1, receipt: "x" }] },
    { op: "listRefunds", args: ["pmt_3"] },
    { op: "fetchPayment", args: ["pmt_3"] },
    { op: "listRequests", args: [{ payment_id: "pmt_3" }] },
  ] },
  { name: "the same reference twice is refused", steps: [
    { op: "createRequest", args: [{ amount: 100, reference_id: "b-2", description: "d" }] },
    { op: "createRequest", args: [{ amount: 100, reference_id: "b-2", description: "d" }] },
    { op: "listRequests", args: [] },
    { op: "fetchRequest", args: ["req_1"] },
    { op: "fetchRequest", args: ["nope"] },
  ] },
  { name: "cancel, then pay a cancelled link", steps: [
    { op: "createRequest", args: [{ amount: 100, reference_id: "b-3", description: "d" }] },
    { op: "cancelRequest", args: ["req_1"] },
    { op: "customerPays", args: ["req_1"] },
    { op: "cancelRequest", args: ["nope"] },
    { op: "customerPays", args: ["nope"] },
  ] },
  { name: "two phones pay the same link", steps: [
    { op: "createRequest", args: [{ amount: 500, reference_id: "b-4", description: "d" }] },
    { op: "customerPays", args: ["req_1"] },
    { op: "customerPays", args: ["req_1"] },
    { op: "fetchRequest", args: ["req_1"] },
  ] },
  { name: "part payments", steps: [
    { op: "createRequest", args: [{ amount: 1000, reference_id: "b-5", description: "d", part_payments: true, min_first_payment: 300 }] },
    { op: "customerPays", args: ["req_1", { amount: 200 }] },
    { op: "customerPays", args: ["req_1", { amount: 300 }] },
    { op: "customerPays", args: ["req_1", { amount: 900 }] },
    { op: "customerPays", args: ["req_1", { amount: 700 }] },
    { op: "customerPays", args: ["req_1"] },
    { op: "fetchRequest", args: ["req_1"] },
  ] },
  { name: "part payments, default minimum, the rest is paid by default", steps: [
    { op: "createRequest", args: [{ amount: 1000, reference_id: "b-6", description: "d", part_payments: true }] },
    { op: "customerPays", args: ["req_1", { amount: 400 }] },
    { op: "customerPays", args: ["req_1"] },
  ] },
  { name: "refund errors", steps: [
    { op: "refund", args: ["pmt_none", { amount: 100 }] },
    { op: "createRequest", args: [{ amount: 500, reference_id: "b-7", description: "d" }] },
    { op: "customerPays", args: ["req_1"] },
    { op: "refund", args: ["pmt_3", { amount: 0 }] },
    { op: "refund", args: ["pmt_3", { amount: 501 }] },
    { op: "resendRefund", args: ["pmt_3", "{\"amount\":200,\"receipt\":\"r\"}"] },
    { op: "resendRefund", args: ["pmt_3", "{\"amount\":100}"] },
    { op: "listRefunds", args: ["pmt_3"] },
  ] },
];

export async function fakeCases(): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const sc of scripts) {
    const fake: any = createFakePayments({ now: () => 1_793_700_000_000 } as any);
    const results: unknown[] = [];
    for (const s of sc.steps) {
      try { const r = await fake[s.op](...(s.args ?? [])); results.push({ ok: r === undefined ? null : r }); } catch (e) { results.push({ error: { name: (e as Error).name, message: (e as Error).message, ...((e as any).status !== undefined ? { status: (e as any).status } : {}) } }); }
    }
    out.push({ name: sc.name, steps: sc.steps, results: JSON.parse(JSON.stringify(results)), links: JSON.parse(JSON.stringify(fake.links())), refunds: JSON.parse(JSON.stringify(fake.refunds())), events: JSON.parse(JSON.stringify(fake.events)) });
  }
  return out;
}

export async function files(): Promise<[string, unknown][]> {
  return [["payments/testdata/fake-vectors.json", { cases: await fakeCases() }]];
}
