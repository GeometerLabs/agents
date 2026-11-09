// UPI, marked paid by the owner (B33): the default payment module (B71). The customer pays the shop's own UPI ID from their own UPI app; nothing the agent can
// reach sees that payment, so "paid" is the owner's mark from their own number (modules/payments/owner-marked), and a refund is paid by the owner by hand and
// tracked until they mark it. No gateway account, no gateway fee, no Guard in front of a provider API (there is none), and no paperwork for the shop beyond
// the UPI ID it already has. Its price is the owner's tap on "Received" for every payment.
//
// In the settings: "payment": {"module": "upi", "upi": {"id": "glowsalon@okicici", "payee": "Glow Salon"}}. Sign-up notes: SIGNUP.md beside this file.
import type { PaymentProvider, ProviderSettings } from "../types.ts";
import { normaliseVpa, payeeProblem, upiPayLink, vpaProblem } from "./link.ts";

export interface UpiSettings extends ProviderSettings { module: "upi"; upi: { id: string; payee: string } }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const block = (p: ProviderSettings): UpiSettings["upi"] => (p as UpiSettings).upi;

export const upi: PaymentProvider = {
  id: "upi",
  displayName: "UPI",
  // Nothing about a UPI payment can be seen by the agent, so every capability is a person's: the owner marks money received and pays refunds back. A request
  // asks for one exact amount (the payer's app cannot change it), and one already sent can still be paid after the agent stops counting on it.
  capabilities: { confirmsAutomatically: false, refundsAutomatically: false, takesPartPayments: false, cancels: false, readsBack: false },
  example: "{\"module\": \"upi\", \"upi\": {\"id\": \"glowsalon@okicici\", \"payee\": \"Glow Salon\"}}",
  readSettings(v, errors) {
    for (const key of Object.keys(v)) if (key !== "module" && key !== "upi") errors.push(`I don't know what "${key}" means in the payment module. Allowed: module, upi.`);
    if (!isObj(v.upi)) { errors.push("A UPI shop needs its UPI ID and the payee name: \"payment\": {\"module\": \"upi\", \"upi\": {\"id\": \"glowsalon@okicici\", \"payee\": \"Glow Salon\"}}."); return undefined; }
    for (const key of Object.keys(v.upi)) if (key !== "id" && key !== "payee") errors.push(`I don't know what "${key}" means in "payment.upi". Allowed: id, payee.`);
    const idIssue = vpaProblem(v.upi.id);
    const payeeIssue = payeeProblem(v.upi.payee);
    if (idIssue) errors.push(`"payment.upi.id": ${idIssue}`);
    if (payeeIssue) errors.push(`"payment.upi.payee": ${payeeIssue}`);
    if (idIssue || payeeIssue) return undefined;
    return { module: "upi", upi: { id: normaliseVpa(v.upi.id as string), payee: (v.upi.payee as string).trim() } } as UpiSettings;
  },
  ownerMarked: {
    payTo: (p) => ({ id: block(p).id, name: block(p).payee }),
    // The reference travels in the note, so the owner sees it beside the money in their UPI app; the owner's one-use code never does (link.ts).
    payLink: (p, r) => upiPayLink({ vpa: block(p).id, payee: block(p).payee, amountPaise: r.amountPaise, note: r.note }),
  },
  signup: "modules/payments/providers/upi/SIGNUP.md",
};
