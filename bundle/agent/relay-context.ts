// The approvals relay for an agent someone else wrote has no runtime to ask "which booking is this refund for?". What the owner is asked to approve is what Guard holds,
// as for a template: the call and its amount, from Guard's held call and nowhere else. Two kinds of money Guard, two contexts:
//   - a gateway with a payment module (ownAgentRuntime): the held refund's payment, and who paid and when, read from the gateway's own record of that payment
//     (its folder's `paymentContext`, through the reading agent, which each Guard allows to look and not to change). Nothing comes from the agent's own say-so
//     but the `receipt` it put on the refund, which only finds the held call;
//   - the agent's own API (ownApiRuntime, B71 part 2): there is no record of ours to read, so the context is the held call itself, found by its approval id, with
//     the operation, the amount's unit and a few plain fields (modules/approvals/held-call.ts).
// The business is the settings'. The owner's answer is not passed on to the agent: the agent sends the identical call again, and Guard releases it.
import { readHeld } from "../../modules/approvals/clients.ts";
import type { Context, GuardClient, RuntimeClient } from "../../modules/approvals/clients.ts";
import { readHeldCall } from "../../modules/approvals/held-call.ts";
import type { HeldCallSpec } from "../../modules/approvals/held-call.ts";
import { gatewayRuntime } from "../../modules/payments/providers/runtime.ts";

type Business = { name: string; timeZone: string; ownerLanguage: "en" | "hi" | "ml" | "kn" };

export interface OwnAgentContextOptions {
  /** Guard's held calls (the relay's reading credential). */
  guard: GuardClient;
  /** The gateway's Guard agent port, the gateway's id (its folder's wire code reads the payment), and the reading agent's credential (read on every call, so a replaced token needs no restart). */
  gateway: { id: string; baseUrl: string; token: () => string };
  business: Business;
  fetchFn?: typeof fetch;
}

const TIMEOUT_MS = 5_000;

// Stands in for the runtime the relay would ask which booking a refund is for. An agent someone else wrote has no such runtime, so the context is read from its own gateway's reviews instead.
export function ownAgentRuntime(o: OwnAgentContextOptions): RuntimeClient {
  const fetchFn = o.fetchFn ?? fetch;
  const wire = gatewayRuntime(o.gateway.id);
  return {
    async context(receipt): Promise<Context> {
      const reviews = await o.guard.reviews();
      if (!reviews.ok) return { kind: "error", error: reviews.error };
      const held = reviews.items.map(readHeld).flatMap((p) => (p.ok && p.held.receipt === receipt ? [p.held] : []));
      if (held.length === 0) return { kind: "missing" };
      if (held.length > 1) return { kind: "error", error: "more than one held refund has this receipt, so it cannot be told which one the owner would be approving" };
      const h = held[0];
      const paid = await wire.paymentContext(o.gateway.baseUrl, o.gateway.token(), h.paymentId, fetchFn, TIMEOUT_MS);
      if (paid.kind !== "found") return paid;
      // who paid, as the gateway has it: the number the customer gave when paying. When it shows none, the payment itself stands in.
      const customer = paid.customer ?? `the customer of ${h.paymentId}`;
      return { kind: "found", context: { booking: receipt, customerPhone: customer, businessName: o.business.name, timeZone: o.business.timeZone, ownerLanguage: o.business.ownerLanguage, serviceName: `payment ${h.paymentId}`, slotMs: paid.atMs, paymentId: h.paymentId, amountPaise: h.amountPaise, approval: h.id, expiresAtMs: h.expiresAtMs } };
    },
    // The agent is not told: it sends the identical call again, and Guard releases it if the owner approved. What Guard does with the call after a "no" is Guard's own.
    async decided() { return true; },
  };
}

/**
 * The context of a call held on the agent's own API: Guard's held call itself, found by its approval id (readHeldCall made the approval id its receipt). The payment and
 * the amount the relay cross-checks are Guard's on both sides, so they always agree; what the owner reads is the held call's operation, amount and plain fields.
 */
export function ownApiRuntime(o: { guard: GuardClient; spec: HeldCallSpec; business: Business }): RuntimeClient {
  return {
    async context(receipt): Promise<Context> {
      const reviews = await o.guard.reviews();
      if (!reviews.ok) return { kind: "error", error: reviews.error };
      const found = reviews.items.map((item) => readHeldCall(item, o.spec)).find((p) => p.ok && p.held.id === receipt);
      if (!found || !found.ok || !found.call) return { kind: "missing" };
      const h = found.held;
      return { kind: "found", context: { booking: h.id, customerPhone: "", businessName: o.business.name, timeZone: o.business.timeZone, ownerLanguage: o.business.ownerLanguage, paymentId: h.paymentId, amountPaise: h.amountPaise, approval: h.id, expiresAtMs: h.expiresAtMs, call: found.call } };
    },
    async decided() { return true; },
  };
}
