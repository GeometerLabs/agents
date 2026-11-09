// The gateways' wire code, for whatever runs on a server or in a test: the live adapters, the inbox (webhooks), the relay of an agent we did not write, the stand-ins
// and the contract test. Node only. The plain declarations (capabilities, Guard routes, words) are providers/index.ts, which the agent and the browser demo read;
// keeping the two apart is what keeps node:http and node:crypto out of the agent's import graph. A new gateway adds its runtime.ts here and its index.ts there.
import { noGateway } from "../owner-marked/ledger.ts";
import { GATEWAYS, gatewayOf } from "./index.ts";
import type { PaymentSettings } from "./index.ts";
import { razorpayRuntime } from "./razorpay/runtime.ts";
import type { GatewayRuntime } from "./types.ts";

const RUNTIMES: Record<string, GatewayRuntime> = { razorpay: razorpayRuntime };

/** The wire code of the gateway with this id; it throws, in plain words, for an id that has none (a typing slip, or a provider with no API). */
export function gatewayRuntime(id: string): GatewayRuntime {
  const r = Object.hasOwn(RUNTIMES, id) ? RUNTIMES[id] : undefined;
  if (!r) throw new Error(`"${id}" is not a gateway this checkout has wire code for. It knows: ${Object.keys(RUNTIMES).join(", ")}.`);
  return r;
}

/**
 * The live adapter of the gateway a shop's runtime talks to. The runtime is given the shop's payment block (its settings). A shop whose module is not a gateway gets
 * `noGateway`, as before B71: a payments service its runtime.json names is not used, and any call is a loud bug. Without the block (a test, or a template built before
 * B71) a payments service is only ever configured for a gateway shop, and the gateway is the only one there is; with more than one and none named, it refuses.
 */
export function gatewayAdapter(payment: PaymentSettings | undefined, config: { baseUrl: string; timeoutMs?: number; agentToken?: string }) {
  if (payment && !gatewayOf(payment)) return noGateway;
  const chosen = gatewayOf(payment);
  if (!chosen && GATEWAYS.length !== 1) throw new Error("runtime.json names a payments service, but the shop's settings were not given to say which gateway it is.");
  return gatewayRuntime((chosen ?? GATEWAYS[0]).id).adapter(config);
}
