// The approvals relay for an agent someone else wrote has no runtime to ask "which booking is this refund for?". What the owner is asked to approve is what Guard holds, as for a
// template: the payment and the amount, from Guard's held call and nowhere else. The rest of the message (who paid, and when) is Razorpay's own record of that payment, read through
// the reading agent, which each Guard allows to look and not to change. The business is the settings'. Nothing comes from the agent's own say-so but the `receipt` it put on the
// refund, which only finds the held call. The owner's answer is not passed on to the agent: the agent sends the identical call again, and Guard releases it.
import { readHeld } from "../../pathways/bookings/approvals/clients.ts";
import type { Context, GuardClient, RuntimeClient } from "../../pathways/bookings/approvals/clients.ts";

export interface OwnAgentContextOptions {
  /** Guard's held calls (the relay's reading credential). */
  guard: GuardClient;
  /** Razorpay's Guard agent port, and the reading agent's credential (read on every call, so a replaced token needs no restart). */
  razorpay: { baseUrl: string; token: () => string };
  business: { name: string; timeZone: string; ownerLanguage: "en" | "hi" | "ml" | "kn" };
  fetchFn?: typeof fetch;
}

const TIMEOUT_MS = 5_000;

export function ownAgentRuntime(o: OwnAgentContextOptions): RuntimeClient {
  const fetchFn = o.fetchFn ?? fetch;
  return {
    async context(receipt): Promise<Context> {
      const reviews = await o.guard.reviews();
      if (!reviews.ok) return { kind: "error", error: reviews.error };
      const held = reviews.items.map(readHeld).flatMap((p) => (p.ok && p.held.receipt === receipt ? [p.held] : []));
      if (held.length === 0) return { kind: "missing" };
      if (held.length > 1) return { kind: "error", error: "more than one held refund has this receipt, so it cannot be told which one the owner would be approving" };
      const h = held[0];
      try {
        const r = await fetchFn(`${o.razorpay.baseUrl.replace(/\/+$/u, "")}/v1/payments/${encodeURIComponent(h.paymentId)}`, { headers: { authorization: `Bearer ${o.razorpay.token()}`, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const text = await r.text();
        if (r.status === 400 || r.status === 404) return { kind: "missing" }; // Razorpay says it has no such payment
        if (r.status !== 200) return { kind: "error", error: `Razorpay answered ${r.status} when asked about the payment` };
        const p = JSON.parse(text) as { contact?: unknown; created_at?: unknown };
        const createdMs = typeof p.created_at === "number" ? p.created_at * 1000 : NaN;
        if (!Number.isFinite(createdMs)) return { kind: "error", error: "Razorpay's record of the payment has no time" };
        // who paid, as Razorpay has it: the number the customer gave when paying. When it shows none, the payment itself stands in.
        const customer = typeof p.contact === "string" && p.contact.trim() !== "" ? p.contact.trim() : `the customer of ${h.paymentId}`;
        return { kind: "found", context: { booking: receipt, customerPhone: customer, businessName: o.business.name, timeZone: o.business.timeZone, ownerLanguage: o.business.ownerLanguage, serviceName: `payment ${h.paymentId}`, slotMs: createdMs, paymentId: h.paymentId, amountPaise: h.amountPaise, approval: h.id, expiresAtMs: h.expiresAtMs } };
      } catch (e) { return { kind: "error", error: `Razorpay could not be asked (${(e as { cause?: { code?: string } })?.cause?.code ?? (e as Error)?.name ?? "error"})` }; }
    },
    // The agent is not told: it sends the identical call again, and Guard releases it if the owner approved. What Guard does with the call after a "no" is Guard's own.
    async decided() { return true; },
  };
}
