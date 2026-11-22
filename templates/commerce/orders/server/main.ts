// Run one shop's Orders agent as a server.
//
//   INTERNAL_TOKEN_FILE=/run/secrets/inbox-token node templates/commerce/orders/server/main.ts --client clients/annapurna-tiffins.example
//
// The folder holds settings.json, runtime.json and pathway.lock (see README.md). The token file holds the secret the inbox sends as "Authorization: Bearer ...". Press
// Ctrl+C (or send SIGTERM) to stop: the step in hand finishes, the rest waits in the store for the next start. The command line is the same for every template
// (modules/runtime/main.ts).
// The runtime contract (templates/commerce/orders/contract/) may ask for a TEST clock through the environment, the same seam the Bookings shop's main has (and the listings
// shop, now go/cmd/listings, had first); modules/runtime/test-clock.ts says why that can never be on for a real shop (a "live" shop refuses to start with it). With neither
// variable set nothing here changes.
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

await runMain({ title: "Orders", mainPath: "templates/commerce/orders/server/main.ts", exampleClient: "templates/commerce/orders/clients/annapurna-tiffins.example", start: start as never });
