// The payment module a shop's settings choose, read the same way by every template: "upi" (the shop's own UPI ID, marked paid by the owner) or "razorpay" (the shop's
// own Razorpay account, through Guard). In the settings it is
//   "payment": { "module": "upi", "upi": { "id": "glowsalon@okicici", "payee": "Glow Salon" } }
//   "payment": { "module": "razorpay" }
// Geometer never opens either for a shop: the UPI ID is the shop's own, and so is a Razorpay account. UPI is the default the panel offers partner shops (no gateway
// account, no gateway fee); a settings file without the key is a Razorpay shop, as every shop was before UPI, so nothing already set up changes.
import { normaliseVpa, payeeProblem, vpaProblem } from "./link.ts";

export type PaymentSettings = { module: "razorpay" } | { module: "upi"; upi: { id: string; payee: string } };
export type PaymentModule = PaymentSettings["module"];
export const PAYMENT_MODULES: readonly PaymentModule[] = ["upi", "razorpay"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Read the "payment" block. Pushes plain-words problems; returns undefined when it is missing (the template decides what that means) or wrong. */
export function readPaymentSettings(v: unknown, errors: string[]): PaymentSettings | undefined {
  if (v === undefined) return undefined;
  const shape = "The payment module (\"payment\") must look like {\"module\": \"upi\", \"upi\": {\"id\": \"glowsalon@okicici\", \"payee\": \"Glow Salon\"}} or {\"module\": \"razorpay\"}.";
  if (!isObj(v)) { errors.push(shape); return undefined; }
  for (const key of Object.keys(v)) if (key !== "module" && key !== "upi") errors.push(`I don't know what "${key}" means in the payment module. Allowed: module, upi.`);
  if (v.module === "razorpay") {
    if (v.upi !== undefined) { errors.push("A Razorpay shop has no UPI ID in its settings: take out \"payment.upi\", or set \"payment.module\" to \"upi\"."); return undefined; }
    return { module: "razorpay" };
  }
  if (v.module !== "upi") { errors.push(`The payment module ${JSON.stringify(v.module)} is not one I know. Use "upi" (the shop's own UPI ID, marked paid by the owner) or "razorpay" (the shop's own Razorpay account).`); return undefined; }
  if (!isObj(v.upi)) { errors.push("A UPI shop needs its UPI ID and the payee name: \"payment\": {\"module\": \"upi\", \"upi\": {\"id\": \"glowsalon@okicici\", \"payee\": \"Glow Salon\"}}."); return undefined; }
  for (const key of Object.keys(v.upi)) if (key !== "id" && key !== "payee") errors.push(`I don't know what "${key}" means in "payment.upi". Allowed: id, payee.`);
  const idIssue = vpaProblem(v.upi.id);
  const payeeIssue = payeeProblem(v.upi.payee);
  if (idIssue) errors.push(`"payment.upi.id": ${idIssue}`);
  if (payeeIssue) errors.push(`"payment.upi.payee": ${payeeIssue}`);
  if (idIssue || payeeIssue) return undefined;
  return { module: "upi", upi: { id: normaliseVpa(v.upi.id as string), payee: (v.upi.payee as string).trim() } };
}

/** The shop's UPI ID and payee name when it takes UPI; undefined for a Razorpay shop (or settings with no payment block). */
export const upiOf = (payment: PaymentSettings | undefined): { id: string; payee: string } | undefined => (payment?.module === "upi" ? payment.upi : undefined);

/** "upi" or "razorpay": no block is a Razorpay shop. */
export const moduleOf = (payment: PaymentSettings | undefined): PaymentModule => payment?.module ?? "razorpay";
