// The Bookings limits the owner may change from their assistant or their app (modules/limits/chat-limits.ts): the refund the agent makes without asking. It is the one
// limit Bookings has that is an amount the owner sets and Guard also holds (cancellation.refundLimitInr is Guard's call_bound_approval threshold, guard-limits.ts).
// "Bookings per number a day" is not here: Bookings has no such setting, so there is nothing real to change (modules/Deferred.md says what would make it a limit).
// Kept apart from settings.ts so the template's settings code is untouched.
import type { ChatLimit } from "../../../../modules/limits/chat-limits.ts";
import { refundLimit } from "../../../../modules/limits/chat-limit-kinds.ts";
import type { Settings } from "./settings.ts";

/** The most a refund limit may be set to: a refund is never more than one deposit (Guard's refund-at-most-deposit bound), and never more than ₹5,000 from a phone. */
const MOST_RUPEES = 5_000;

export const CHAT_LIMITS: readonly ChatLimit[] = [
  refundLimit("cancellation.refundLimitInr", (s) => ({ min: 0, max: Math.min(MOST_RUPEES, Math.max(1, (s as Settings).deposit?.amountInr ?? MOST_RUPEES)) })),
];
