// Run one client's Bookings agent as a server.
//
//   INTERNAL_TOKEN_FILE=/run/secrets/inbox-token node pathways/bookings/server/main.ts --client clients/glow-salon
//
// The folder holds settings.json, runtime.json and pathway.lock (see README.md). The token file holds the secret the inbox sends as "Authorization: Bearer ...". Press
// Ctrl+C (or send SIGTERM) to stop: the step in hand finishes, the rest waits in the store for the next start. The command line is the same for every template
// (modules/runtime/main.ts).
import { runMain } from "../../../modules/runtime/main.ts";
import { startClient } from "./start.ts";

await runMain({ title: "Bookings", mainPath: "pathways/bookings/server/main.ts", exampleClient: "pathways/bookings/clients/glow-salon.example", start: startClient as never });
