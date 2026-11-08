// Run one shop's Orders agent as a server.
//
//   INTERNAL_TOKEN_FILE=/run/secrets/inbox-token node templates/commerce/orders/server/main.ts --client clients/annapurna-tiffins.example
//
// The folder holds settings.json, runtime.json and pathway.lock (see README.md). The token file holds the secret the inbox sends as "Authorization: Bearer ...". Press
// Ctrl+C (or send SIGTERM) to stop: the step in hand finishes, the rest waits in the store for the next start. The command line is the same for every template
// (modules/runtime/main.ts).
import { runMain } from "../../../../modules/runtime/main.ts";
import { startClient } from "./start.ts";

await runMain({ title: "Orders", mainPath: "templates/commerce/orders/server/main.ts", exampleClient: "templates/commerce/orders/clients/annapurna-tiffins.example", start: startClient as never });
