// The payment modules a shop can choose, and the one way every template, the panel and the bundle read that choice (B71). A provider is a folder beside this file
// (providers/<name>/index.ts, declared as in types.ts); this list is the only place that names them all. Everything else asks `providerOf(settings.payment)` for its
// capabilities, its Guard, its webhook or its words, and never compares a provider's name.
//
// In the settings it is
//   "payment": { "module": "upi", "upi": { "id": "glowsalon@okicici", "payee": "Glow Salon" } }      the default: the shop's own UPI ID, marked paid by the owner
//   "payment": { "module": "razorpay" }                                                               the shop's own gateway account, through Guard
// Geometer never opens either for a shop. A settings file without the block is NOT a gateway shop: it is refused and told to give the shop's UPI ID (owner, 10 Nov:
// no paperwork for partners), so a shop can never end up behind a gateway nobody chose for it. Nothing was live when this flipped (before it, no block meant Razorpay).
import type { PaymentCapabilities } from "../payments.ts";
import type { PaymentProvider, ProviderSettings } from "./types.ts";
import { razorpay } from "./razorpay/index.ts";
import { upi } from "./upi/index.ts";

/** Every provider, the default first. A new gateway is one more folder and one more entry here; its Guard gets the next free address (bundle/generate/compose.ts). */
export const PROVIDERS: readonly PaymentProvider[] = [upi, razorpay];

/** The default for a shop that has not chosen: the first provider, which needs no account. */
export const DEFAULT_PROVIDER: PaymentProvider = PROVIDERS[0];

export type PaymentSettings = ProviderSettings;
export type PaymentModule = string;
export const PAYMENT_MODULES: readonly PaymentModule[] = PROVIDERS.map((p) => p.id);

/** The providers with an API Guard sits in front of. Their ids are Guard kinds in the bundle. */
export const GATEWAYS: readonly PaymentProvider[] = PROVIDERS.filter((p) => p.gateway !== undefined);
export const GATEWAY_KINDS: readonly string[] = GATEWAYS.map((p) => p.id);
export const isGatewayKind = (kind: string): boolean => GATEWAY_KINDS.includes(kind);

/** What a settings file with no "payment" block is told: the default first, because it needs no account, then how a gateway shop says so. */
export const MISSING_PAYMENT = `Add how customers pay ("payment"). ${DEFAULT_PROVIDER.displayName} is the default: ${DEFAULT_PROVIDER.example}, with the shop's own ${DEFAULT_PROVIDER.displayName} ID and the name its customers see. A shop with its own gateway account names it instead: ${GATEWAYS.map((g) => g.example).join(" or ")}.`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Read the "payment" block. Pushes plain-words problems and returns undefined when it is missing or wrong. A missing block asks for the UPI ID; it never picks a gateway. */
export function readPaymentSettings(v: unknown, errors: string[]): PaymentSettings | undefined {
  if (v === undefined) { errors.push(MISSING_PAYMENT); return undefined; }
  const shape = `The payment module ("payment") must look like ${PROVIDERS.map((p) => p.example).join(" or ")}.`;
  if (!isObj(v)) { errors.push(shape); return undefined; }
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
 * The live adapter of the gateway a shop's runtime talks to. The runtime is told the shop's payment block (its settings); without it (a test, or a template built before
 * B71) a payments service is only ever configured for a gateway shop, and the gateway is the only one there is. With more than one and none named, it refuses rather than guess.
 */
export function gatewayAdapter(payment: PaymentSettings | undefined, config: { baseUrl: string; timeoutMs?: number; agentToken?: string }) {
  const named = payment ? gatewayOf(payment) : undefined;
  if (payment && !named) throw new Error(`This shop's payment module (${payment.module}) has no gateway, so its runtime.json must not name a payments service.`);
  if (!named && GATEWAYS.length !== 1) throw new Error("runtime.json names a payments service, but the shop's settings were not given to say which gateway it is.");
  return (named ?? GATEWAYS[0]).gateway!.adapter(config);
}

/** Who the customer pays and the link for one request, for a module whose payments a person confirms; undefined for a gateway. */
export function ownerMarkedOf(payment: PaymentSettings | undefined): { payTo: { id: string; name: string }; payLink: (r: { amountPaise: number; note: string }) => string } | undefined {
  const p = providerOf(payment);
  if (!p?.ownerMarked || !payment) return undefined;
  const om = p.ownerMarked;
  return { payTo: om.payTo(payment), payLink: (r) => om.payLink(payment, r) };
}
