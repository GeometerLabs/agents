// The same agent as server.js with ONE thing done wrong, on purpose, for the crash test's "The owner says no to a held refund": it does not read Guard's answer after a no
// (a 403 with reason_code denied_by_approver) as the owner's no, nor a 202 naming another request; it takes either for "not yet" and keeps sending the identical refund until
// the request's end. Since 12 Nov 2026 Guard refuses every one of those sends and asks nobody again (an older Guard opened a new request each time, so the owner was asked
// again). Razorpay still refunds nothing, so the money check holds and the agent check does not. Everything else is server.js's, imported unchanged.
import { FOLLOW_HELD, startFromEnv } from "./server.js";

if (import.meta.main) startFromEnv({ held: { ...FOLLOW_HELD, readNo: false, watchRequest: false } });
