// The approvals relay as its own process: node templates/commerce/bookings/approvals/main.ts. The program is the same for every template (modules/approvals/main.ts, which lists the
// environment it reads); this file gives it Bookings' words.
import { runRelayMain } from "../../../../modules/approvals/main.ts";
import { createRelay } from "./relay.ts";

await runRelayMain(createRelay);
