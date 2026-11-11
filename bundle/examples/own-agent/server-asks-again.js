// The same agent as server.js with ONE thing done wrong, on purpose, for the crash test's "The owner says no to a held refund": it never looks at which request Guard's 202
// names, so after the owner's no it keeps sending the identical refund. Guard opens a new request for the owner and the agent keeps sending into it: the owner would be asked
// again, and again after each no. Razorpay still refunds nothing (only the owner's yes releases a held refund), so the money check holds and the agent check does not.
// Everything else (the request's end, a lost answer, the calendar, the price) is server.js's, imported unchanged.
import { startFromEnv } from "./server.js";

if (import.meta.main) startFromEnv({ held: { watchRequest: false, watchEnd: true } });
