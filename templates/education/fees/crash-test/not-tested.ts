// What the hand check does NOT cover, and the words it uses for how it was run. The hand check prints this list every time, whatever the result, and a go-live
// certificate would carry the same list (in the centre's language, by id), so the two cannot drift apart. Nothing here runs anything.

/** How the hand check describes the services it ran against. */
export const STAND_IN_SERVICES = "stand-in services";
export const HAND_RUN = "hand-run";

export type NotTestedId =
  | "cash-and-bank-transfers" | "payments-outside-razorpay" | "real-whatsapp" | "real-razorpay" | "webhook-signatures" | "real-model"
  | "other-languages" | "native-review" | "restart-mid-step" | "same-instant" | "other-faults" | "upi-not-automatic" | "real-upi" | "two-children-one-message";

export interface NotTested {
  id: NotTestedId;
  /** The hand check's own words (English). */
  text: string;
}

export const NOT_TESTED: readonly NotTested[] = [
  { id: "cash-and-bank-transfers", text: "fees paid in cash or by bank transfer (a parent who says so is sent to the owner; nothing is marked paid)" },
  { id: "payments-outside-razorpay", text: "payments outside Razorpay (this centre takes Razorpay)" },
  { id: "real-whatsapp", text: "real WhatsApp" },
  { id: "real-razorpay", text: "real Razorpay (test mode or live)" },
  { id: "webhook-signatures", text: "webhook signatures" },
  { id: "real-model", text: "a real model (the rules and the stand-in decision and language models were run, not Laya, Jev or DeepInfra; and messages are templates only)" },
  { id: "other-languages", text: "Tamil, Telugu and other languages" },
  { id: "native-review", text: "a native speaker's review of the Malayalam and Kannada wording (machine-written, see REVIEW-ml.md and REVIEW-kn.md)" },
  { id: "restart-mid-step", text: "a crash or restart in the middle of a step" },
  { id: "same-instant", text: "two parents at the exact same instant" },
  { id: "two-children-one-message", text: "one message about two children at once (the oldest open fee is the one answered)" },
  { id: "other-faults", text: "faults beyond the ones listed above" },
];

/**
 * A UPI shop (B33) has no payment service the agent reads: the owner marks each payment. So its list says that automatic payment checking does not apply, and that no
 * real UPI payment was made (the owner's marks were what the checks tried), instead of the Razorpay lines.
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
