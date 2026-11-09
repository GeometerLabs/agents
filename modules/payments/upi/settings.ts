// The payment module a shop's settings choose, read the same way by every template: "upi" (the shop's own UPI ID, marked paid by the owner) or "razorpay" (the shop's
// own Razorpay account, through Guard). In the settings it is
//   "payment": { "module": "upi", "upi": { "id": "glowsalon@okicici", "payee": "Glow Salon" } }
//   "payment": { "module": "razorpay" }
// Geometer never opens either for a shop: the UPI ID is the shop's own, and so is a Razorpay account. UPI is the default (B71, owner 10 Nov: no gateway account, no
// gateway fee, no paperwork for the shop). A settings file without the block is NOT a gateway shop: it is refused and told to give the shop's UPI ID, so a shop can
// never end up behind a gateway nobody chose for it. Nothing was live when this flipped (before it, no block meant Razorpay).
import { normaliseVpa, payeeProblem, vpaProblem } from "./link.ts";

export type PaymentSettings = { module: "razorpay" } | { module: "upi"; upi: { id: string; payee: string } };
export type PaymentModule = PaymentSettings["module"];
export const PAYMENT_MODULES: readonly PaymentModule[] = ["upi", "razorpay"];

/** What a settings file with no "payment" block is told: UPI first, because it is the default and needs no account. */
export const MISSING_PAYMENT = "Add how customers pay (\"payment\"). UPI is the default: {\"module\": \"upi\", \"upi\": {\"id\": \"glowsalon@okicici\", \"payee\": \"Glow Salon\"}}, with the shop's own UPI ID and the name its customers see. A shop with its own gateway account names it instead: {\"module\": \"razorpay\"}.";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Read the "payment" block. Pushes plain-words problems and returns undefined when it is missing or wrong. A missing block asks for the UPI ID; it never picks a gateway. */
export function readPaymentSettings(v: unknown, errors: string[]): PaymentSettings | undefined {
  if (v === undefined) { errors.push(MISSING_PAYMENT); return undefined; }
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

/** The shop's UPI ID and payee name when it takes UPI; undefined for a Razorpay shop. */
export const upiOf = (payment: PaymentSettings | undefined): { id: string; payee: string } | undefined => (payment?.module === "upi" ? payment.upi : undefined);

/** "upi" or "razorpay"; undefined while there is no block yet (a draft). Undefined is never read as a gateway: a Guard and keys are made only for a shop that chose one. */
export const moduleOf = (payment: PaymentSettings | undefined): PaymentModule | undefined => payment?.module;

/** Did this shop choose the gateway? Only then does it get a gateway Guard, keys, a webhook and connection checks. */
export const choseGateway = (payment: PaymentSettings | undefined): boolean => payment?.module === "razorpay";
