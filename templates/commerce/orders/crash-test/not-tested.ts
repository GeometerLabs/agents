// What the hand check does NOT cover, and the words it uses for how it was run. The hand check prints this list every time, whatever the result, and a go-live certificate
// carries the same list (in the shop's language, by id), so the two cannot drift apart. Nothing here runs anything.

/** How the hand check describes the services it ran against. */
export const STAND_IN_SERVICES = "stand-in services";
export const HAND_RUN = "hand-run";

export type NotTestedId =
  | "balance-at-pickup" | "kitchen-and-delivery" | "order-changes" | "payments-outside-razorpay" | "real-whatsapp" | "real-razorpay" | "webhook-signatures" | "real-model"
  | "other-languages" | "native-review" | "restart-mid-step" | "same-instant" | "number-words" | "other-faults" | "upi-not-automatic" | "real-upi";

export interface NotTested {
  id: NotTestedId;
  /** The hand check's own words (English). */
  text: string;
}

export const NOT_TESTED: readonly NotTested[] = [
  { id: "balance-at-pickup", text: "the rest of the price, paid in cash or by UPI at pickup or delivery (only the advance is tracked)" },
  { id: "kitchen-and-delivery", text: "whether the food was made, collected or delivered (an order is completed when its slot ends)" },
  { id: "order-changes", text: "changing a confirmed order (a customer cancels and orders again)" },
  { id: "payments-outside-razorpay", text: "payments outside Razorpay (this shop takes Razorpay)" },
  { id: "real-whatsapp", text: "real WhatsApp" },
  { id: "real-razorpay", text: "real Razorpay (test mode or live)" },
  { id: "webhook-signatures", text: "webhook signatures" },
  { id: "real-model", text: "a real model (the rules and the stand-in decision and language models were run, not Laya, Jev or DeepInfra; and messages are templates only)" },
  { id: "other-languages", text: "Tamil, Telugu and other languages" },
  { id: "native-review", text: "a native speaker's review of the Hindi, Malayalam and Kannada wording (machine-written, see REVIEW-hi.md, REVIEW-ml.md and REVIEW-kn.md)" },
  { id: "restart-mid-step", text: "a crash or restart in the middle of a step" },
  { id: "same-instant", text: "two customers taking the last portion at the exact same instant" },
  { id: "number-words", text: "quantities written in words other than one to ten in English and Hindi, and the Malayalam and Kannada words for one to five" },
  { id: "other-faults", text: "faults beyond the ones listed above" },
];

/**
 * A UPI shop (B33) has no payment service the agent reads: the owner marks each payment. So its list says that automatic payment checking does not apply, and that no real UPI
 * payment was made (the owner's marks were what the checks tried), instead of the Razorpay lines.
 */
export const UPI_NOT_TESTED: readonly NotTested[] = [
  { id: "upi-not-automatic", text: "automatic payment checking: it does not apply to UPI, where the owner marks each payment received" },
  { id: "real-upi", text: "a real UPI app paying a real UPI ID (the owner's marks were tried, not a payment)" },
];

/** What the checks do not cover for these settings: the list above, and for a UPI shop the UPI lines in place of the Razorpay ones. */
export function notTestedOf(settings: { payment?: { module: string } }): readonly NotTested[] {
  if (settings.payment?.module !== "upi") return NOT_TESTED;
  return [...NOT_TESTED.filter((n) => n.id !== "payments-outside-razorpay" && n.id !== "real-razorpay"), ...UPI_NOT_TESTED];
}
