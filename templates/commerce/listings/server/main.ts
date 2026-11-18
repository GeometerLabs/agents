// Run one listings-only shop on its own, for a local try or a test:
//
//   INTERNAL_TOKEN_FILE=token.txt node templates/commerce/listings/server/main.ts --client templates/commerce/listings/clients/<name>
//
// On a server, many such shops share one process instead (shared-main.ts), each with its own folder and store file. The command line is the same for every template.
// The runtime contract (templates/commerce/listings/contract/) may ask for a TEST clock through the environment; modules/runtime/test-clock.ts says why that can never be on
// for a real shop (a "live" shop refuses to start with it), and it is asked here only, never in the shared process.
import { runMain } from "../../../../modules/runtime/main.ts";
import { testClock } from "../../../../modules/runtime/test-clock.ts";
import { loadClient } from "./config.ts";
import { startClient } from "./start.ts";
import type { StartOptions } from "./start.ts";

const start = (o: StartOptions) => {
  // runtime.json's mode is read only when a test clock is asked for (loadClient refuses a broken folder with the same sentence the start would say)
  const clock = testClock(process.env, () => loadClient(o.clientFolder).runtime.mode);
  return startClient({ ...o, ...(clock ? { clock } : {}) });
};

await runMain({ title: "Listings only", mainPath: "templates/commerce/listings/server/main.ts", exampleClient: "templates/commerce/listings/clients/example", start: start as never });
