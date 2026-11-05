// The same agent as server.js with ONE thing done wrong, on purpose, so the crash test has something to find: when the answer to a refund is lost, it asks for the refund again
// straight away with a new idempotency key, instead of looking at what Razorpay holds. Everything else (looking for a lost payment link, looking at the calendar before saying
// "Booked!", sending a held refund again, taking the amount from Razorpay) is server.js's, imported unchanged.
//
// What happens behind Guard: the first refund is made, its answer is lost, Guard says the outcome is unknown. The new key does not help: Guard replaces the agent's key with one it
// derives from the payment, sees an attempt whose outcome it does not know, and holds the repeat. So Razorpay still holds ONE refund (Guard's at-most-once did that), and the
// crash test marks the one situation where the agent asked twice.
import { retryWithNewKey, startFromEnv } from "./server.js";

if (import.meta.main) startFromEnv({ onRefundUnknown: retryWithNewKey });
