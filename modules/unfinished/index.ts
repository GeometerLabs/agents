// The one registry the panel, the heartbeat code and the templates share. Other modules add their kinds by calling `obligations.register(...)` (registry.ts), or by
// being listed in BUILT_IN (builtin.ts).
import { BUILT_IN } from "./builtin.ts";
import { createObligationRegistry } from "./registry.ts";

export const obligations = createObligationRegistry(BUILT_IN);
export * from "./registry.ts";
