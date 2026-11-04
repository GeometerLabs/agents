// What the hand check does NOT cover, and the words it uses for how it was run. The hand check prints this list every
// time, whatever the result, and the go-live certificate carries the same list (in the shop's language, by id), so the
// two cannot drift apart. Nothing here runs anything.

/** How the hand check describes the services it ran against. The go-live certificate says exactly this. */
export const STAND_IN_SERVICES = "stand-in services";
export const HAND_RUN = "hand-run";

export type NotTestedId =
  | "voice-calls" | "group-bookings" | "walk-ins" | "payments-outside-razorpay" | "real-whatsapp" | "real-razorpay" | "real-calendar"
  | "webhook-signatures" | "real-model" | "other-languages" | "native-review" | "restart-mid-step" | "same-instant" | "other-faults";

export interface NotTested {
  id: NotTestedId;
  /** The hand check's own words (English). */
  text: string;
  /** Something a shop owner would expect to be covered, so the owner's short form names it. */
  forOwner: boolean;
}

export const NOT_TESTED: readonly NotTested[] = [
  { id: "voice-calls", text: "voice calls", forOwner: true },
  { id: "group-bookings", text: "group bookings", forOwner: false },
  { id: "walk-ins", text: "walk-ins", forOwner: true },
  { id: "payments-outside-razorpay", text: "payments outside Razorpay", forOwner: false },
  { id: "real-whatsapp", text: "real WhatsApp", forOwner: false },
  { id: "real-razorpay", text: "real Razorpay (test mode or live)", forOwner: false },
  { id: "real-calendar", text: "a real calendar", forOwner: false },
  { id: "webhook-signatures", text: "webhook signatures", forOwner: false },
  { id: "real-model", text: "a real model (the rules and the stand-in decision and language models were run, not Laya, Jev or DeepInfra; and messages are templates only)", forOwner: false },
  { id: "other-languages", text: "Tamil, Telugu and other languages", forOwner: false },
  { id: "native-review", text: "a native speaker's review of the Malayalam and Kannada wording (machine-written, see REVIEW-ml.md and REVIEW-kn.md)", forOwner: false },
  { id: "restart-mid-step", text: "a crash or restart in the middle of a step", forOwner: false },
  { id: "same-instant", text: "two customers at the exact same instant", forOwner: false },
  { id: "other-faults", text: "faults beyond the ones listed above", forOwner: false },
];
