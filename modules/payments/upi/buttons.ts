// The owner's UPI buttons, for every template: "Received ₹200" (the exact amount still asked), "Refund sent", and, where it is true, "Kept for booking". Each
// button's id carries its one-use code (owner.ts reads it back). The words are the template's own labels, in the owner's language; the amount is the record's.
import { LIMITS, clip } from "../../language/interactive.ts";
import type { Choice } from "../../language/interactive.ts";
import { formatInr } from "../../language/format.ts";
import { upiButtonId } from "./owner.ts";

export interface UpiButtonLabels { received: string; refundSent: string; keptForBooking?: string }

export function ownerUpiChoices(labels: UpiButtonLabels, a: { kind: "received"; code: string; amountInr: number } | { kind: "refund"; code: string; keepAllowed: boolean }): Choice[] {
  if (a.kind === "received") return [{ id: upiButtonId("received", a.code), title: clip(`${labels.received} ${formatInr(a.amountInr)}`, LIMITS.buttonTitle) }];
  return [
    { id: upiButtonId("refunded", a.code), title: clip(labels.refundSent, LIMITS.buttonTitle) },
    ...(a.keepAllowed && labels.keptForBooking ? [{ id: upiButtonId("kept", a.code), title: clip(labels.keptForBooking, LIMITS.buttonTitle) }] : []),
  ];
}
