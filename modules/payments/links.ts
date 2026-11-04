// Making a payment link, the careful way: look first, write, read back. For every template.
//
// A link is "made" only when the payments service's own list shows it. If the reply to a create was lost, the next try looks first, so a retry cannot make a
// second link. What a template decides is the reference (the booking, the student's fee) and the amount; the care is the same.
import { ApiError, TimeoutError } from "../core/faults.ts";
import type { PaymentLink, Payments } from "./payments.ts";

/** Look, try, read back; and once more if that did not settle it. */
export const ATTEMPTS = 2;

export interface LinkRequest {
  /** Our id for what the link pays for; the payments service keeps it, and the link is found again by it. */
  reference: string;
  /** In paise: the only amount this link may be for. */
  amountPaise: number;
  description: string;
  /** Let the customer pay part of it (the link stays open for the rest). Razorpay's `accept_partial`. */
  acceptPartial?: boolean;
  /** With `acceptPartial`: the least the first payment may be, in paise. */
  minPartialPaise?: number;
}

/** A link for this reference and amount that is still open: the payments service's own list is what counts. */
const live = (amountPaise: number) => (links: PaymentLink[]) => links.find((l) => l.status !== "cancelled" && l.amount === amountPaise);

export async function ensureLink(payments: Payments, request: LinkRequest): Promise<{ link: PaymentLink | null; error?: string }> {
  const find = live(request.amountPaise);
  let error: string | undefined;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const existing = find(await payments.listPaymentLinks({ reference_id: request.reference })); // look first: a lost reply may have created it
      if (existing) return { link: existing };
      await payments.createPaymentLink({
        amount: request.amountPaise, reference_id: request.reference, description: request.description,
        ...(request.acceptPartial ? { accept_partial: true, first_min_partial_amount: request.minPartialPaise ?? 100 } : {}),
      });
      const after = find(await payments.listPaymentLinks({ reference_id: request.reference })); // read back from the payments service's own list
      if (after) return { link: after };
    } catch (e) {
      if (!(e instanceof TimeoutError) && !(e instanceof ApiError)) throw e;
      error = (e as Error).message;
    }
  }
  const last = await payments.listPaymentLinks({ reference_id: request.reference }).then(find).catch(() => undefined);
  return last ? { link: last } : { link: null, error };
}
