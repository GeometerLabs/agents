// The approvals relay as its own process: node templates/commerce/orders/approvals/main.ts. The program is the same for every template (modules/approvals/main.ts, which lists the
// environment it reads); this file gives it Orders' words.
import { runRelayMain } from "../../../../modules/approvals/main.ts";
import { createRelay } from "./relay.ts";

await runRelayMain(createRelay);
