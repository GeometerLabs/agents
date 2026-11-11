// The same agent as server.js with ONE thing done wrong, on purpose, for the crash test's "The owner never answers: the held refund runs out": it keeps a 24-hour clock of
// its own instead of Guard's end for the request (expires_at_ms in the 202), so it sends the refund again after the request has run out. Guard opens a new request, and the
// owner is asked a second time about a refund they never answered. Everything else (the owner's no, a lost answer, the calendar, the price) is server.js's, imported unchanged.
import { startFromEnv } from "./server.js";

if (import.meta.main) startFromEnv({ held: { watchRequest: true, watchEnd: false } });
