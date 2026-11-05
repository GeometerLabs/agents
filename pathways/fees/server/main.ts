// Run one centre's Fees agent as a server.
//
//   INTERNAL_TOKEN_FILE=/run/secrets/inbox-token node pathways/fees/server/main.ts --client clients/bright-tuition.example
//
// The folder holds settings.json, runtime.json and pathway.lock (see README.md). The token file holds the secret the inbox sends as "Authorization: Bearer ...". Press
// Ctrl+C (or send SIGTERM) to stop: the step in hand finishes, the rest waits in the store for the next start. The command line is the same for every template
// (modules/runtime/main.ts).
import { runMain } from "../../../modules/runtime/main.ts";
import { startClient } from "./start.ts";

await runMain({ title: "Fees", mainPath: "pathways/fees/server/main.ts", exampleClient: "pathways/fees/clients/bright-tuition.example", start: startClient as never });
