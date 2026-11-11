// The payment modules a shop can choose, and the one way every template, the panel and the bundle read that choice (B71). A provider is a folder beside this file
// (providers/<name>/index.ts, declared as in types.ts); this list is the only place that names them all. Everything else asks `providerOf(settings.payment)` for its
// capabilities, its Guard routes or its words, and never compares a provider's name. Everything here is plain data, because the agent's import graph (and the browser
// demo's) reaches it; a gateway's wire code (adapter, webhook, stand-in) is in providers/runtime.ts, for servers and tests.
//
// In the settings it is
//   "payment": { "module": "upi", "upi": { "id": "glowsalon@okicici", "payee": "Glow Salon" } }      the default: the shop's own UPI ID, marked paid by the owner
//   "payment": { "module": "razorpay" }                                                               the shop's own gateway account, through Guard
// Geometer never opens either for a shop. A settings file without the block is NOT a gateway shop: it is refused and told to give the shop's UPI ID (owner, 10 Nov:
// no paperwork for partners), so a shop can never end up behind a gateway nobody chose for it. Nothing was live when this flipped (before it, no block meant Razorpay).
import type { PaymentCapabilities } from "../payments.ts";
import type { GatewayGuard, PaymentProvider, ProviderSettings } from "./types.ts";
import { razorpay } from "./razorpay/index.ts";
import { upi } from "./upi/index.ts";

/**
 * Every provider, the default first. A new gateway is one more folder, one more entry here, and its runtime.ts in providers/runtime.ts. A shop has at most one gateway,
 * so every gateway's Guard takes the same address slot a shop's gateway Guard always had (bundle/generate/compose.ts).
 */
export const PROVIDERS: readonly PaymentProvider[] = [upi, razorpay];

/** An agent's own gateway with no module here (B71 step 6): its Guard spec is the one the builder reviewed through the companies kit. Never a template shop's. */
export const OWN_API = "own-api";

/** The default for a shop that has not chosen: the first provider, which needs no account. */
export const DEFAULT_PROVIDER: PaymentProvider = PROVIDERS[0];

export type PaymentSettings = ProviderSettings;
export type PaymentModule = string;
export const PAYMENT_MODULES: readonly PaymentModule[] = PROVIDERS.map((p) => p.id);

/** The providers with an API Guard sits in front of. Their ids are Guard kinds in the bundle. */
export const GATEWAYS: readonly PaymentProvider[] = PROVIDERS.filter((p) => p.gateway !== undefined);
export const GATEWAY_KINDS: readonly string[] = GATEWAYS.map((p) => p.id);
// Gateway providers (with an API for Guard to sit in front of) are handled differently from owner-marked ones; this is the one place that tells them apart.
export const isGatewayKind = (kind: string): boolean => GATEWAY_KINDS.includes(kind);

/** What a settings file with no "payment" block is told: the default first, because it needs no account, then how a gateway shop says so. */
export const MISSING_PAYMENT = `Add how customers pay ("payment"). ${DEFAULT_PROVIDER.displayName} is the default: ${DEFAULT_PROVIDER.example}, with the shop's own ${DEFAULT_PROVIDER.displayName} ID and the name its customers see. A shop with its own gateway account names it instead: ${GATEWAYS.map((g) => g.example).join(" or ")}.`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Read the "payment" block. Pushes plain-words problems and returns undefined when it is missing or wrong. A missing block asks for the UPI ID; it never picks a gateway. */
export function readPaymentSettings(v: unknown, errors: string[], options: { ownApi?: boolean } = {}): PaymentSettings | undefined {
  if (v === undefined) { errors.push(MISSING_PAYMENT); return undefined; }
  const shape = `The payment module ("payment") must look like ${PROVIDERS.map((p) => p.example).join(" or ")}.`;
  if (!isObj(v)) { errors.push(shape); return undefined; }
  // B71 step 6: an agent someone else wrote may take money through its own gateway's API, with no module here: Guard stands in front of it with a spec the builder
  // reviewed (companies/openapi-to-spec.ts, kept in the agent's folder). Only an agent folder passes `ownApi`, so a template's shop can never choose it: no template
  // code knows such an API. Nothing else goes in the block; the API's address and rules are the folder's.
  if (options.ownApi && v.module === OWN_API) {
    const extra = Object.keys(v).filter((k) => k !== "module");
    if (extra.length > 0) { errors.push(`An agent's own gateway is just {"module": "${OWN_API}"}: its address is agent.json's ownApi.upstream and its rules are the reviewed spec. Leave out ${extra.join(", ")}.`); return undefined; }
    return { module: OWN_API };
  }
  const provider = PROVIDERS.find((p) => p.id === v.module);
  if (!provider) { errors.push(`The payment module ${JSON.stringify(v.module)} is not one I know. Use ${PROVIDERS.map((p) => `"${p.id}"`).join(" or ")}: ${PROVIDERS.map((p) => p.example).join(" or ")}.`); return undefined; }
  return provider.readSettings(v, errors);
}

/** The provider a shop chose. Undefined only for settings that were never checked (a draft); that is never read as a gateway. */
export function providerOf(payment: PaymentSettings | undefined): PaymentProvider | undefined {
  return payment === undefined ? undefined : PROVIDERS.find((p) => p.id === payment.module);
}

/** The provider with this id (a Guard kind, an `--upstreams` name), or undefined. */
export const providerById = (id: string): PaymentProvider | undefined => PROVIDERS.find((p) => p.id === id);

/** What the shop's payment module can do. With no choice yet: what the default can do, never a gateway's. */
export const capabilitiesOf = (payment: PaymentSettings | undefined): PaymentCapabilities => (providerOf(payment) ?? DEFAULT_PROVIDER).capabilities;

/** The module's id; undefined while there is no block yet (a draft). Undefined is never read as a gateway: a Guard and keys are made only for a shop that chose one. */
export const moduleOf = (payment: PaymentSettings | undefined): PaymentModule | undefined => payment?.module;

/** The gateway this shop chose, or undefined (UPI, or no choice yet). Only a shop with one gets a gateway Guard, keys, a webhook and connection checks. */
export const gatewayOf = (payment: PaymentSettings | undefined): PaymentProvider | undefined => {
  const p = providerOf(payment);
  return p?.gateway ? p : undefined;
};

/**
 * The Guard declaration a shop's limits spec is written for: the gateway it chose. A shop with no gateway (UPI) runs no gateway Guard and never deploys this spec; a
 * spec is still made for it in a harness or an export, and then it is the one gateway there is, so the numbers can be read the same way.
 */
export function gatewayGuardOf(payment: PaymentSettings | undefined): GatewayGuard {
  const chosen = gatewayOf(payment);
  if (chosen) return chosen.gateway!.guard;
  if (GATEWAYS.length !== 1) throw new Error("This shop chose no gateway, and there is more than one: say which gateway's spec to make.");
  return GATEWAYS[0].gateway!.guard;
}

/** Who the customer pays and the link for one request, for a module whose payments a person confirms; undefined for a gateway. */
export function ownerMarkedOf(payment: PaymentSettings | undefined): { payTo: { id: string; name: string }; payLink: (r: { amountPaise: number; note: string }) => string } | undefined {
  const p = providerOf(payment);
  if (!p?.ownerMarked || !payment) return undefined;
  const om = p.ownerMarked;
  return { payTo: om.payTo(payment), payLink: (r) => om.payLink(payment, r) };
}

/** The default module's own checks of what a person types (the shop's UPI ID and the payee name), for the panel's payment step: plain words, never a payment. */
export { normaliseVpa, payeeProblem, vpaProblem } from "./upi/link.ts";
