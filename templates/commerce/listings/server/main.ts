// Run one listings-only shop on its own, for a local try or a test:
//
//   INTERNAL_TOKEN_FILE=token.txt node templates/commerce/listings/server/main.ts --client templates/commerce/listings/clients/<name>
//
// On a server, many such shops share one process instead (shared-main.ts), each with its own folder and store file. The command line is the same for every template.
import { runMain } from "../../../../modules/runtime/main.ts";
import { startClient } from "./start.ts";

await runMain({ title: "Listings only", mainPath: "templates/commerce/listings/server/main.ts", exampleClient: "templates/commerce/listings/clients/example", start: startClient as never });
