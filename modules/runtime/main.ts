// Run one client's agent as a server: the command line every template's server/main.ts is a few lines around.
//
//   INTERNAL_TOKEN_FILE=/run/secrets/inbox-token node templates/<domain>/<template>/server/main.ts --client clients/<name>
//
// The folder holds settings.json, runtime.json and pathway.lock (see the template's README.md). The token file holds the secret the inbox sends as
// "Authorization: Bearer ...". Press Ctrl+C (or send SIGTERM) to stop: the step in hand finishes, the rest waits in the store for the next start.
import { ClientError } from "./config.ts";
import type { RunningClient } from "./start.ts";

export interface MainOptions {
  /** "Bookings", "Fees": for the first line. */
  title: string;
  /** For the usage lines: where this template's main.ts and an example client are. */
  mainPath: string;
  exampleClient: string;
  start(o: { clientFolder: string; tokenFile: string | undefined }): Promise<RunningClient<{ name: string }, any>>;
}

export async function runMain(options: MainOptions, args: string[] = process.argv.slice(2)): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: INTERNAL_TOKEN_FILE=<file> node ${options.mainPath} --client <folder>`);
    process.exit(0);
  }
  const at = args.indexOf("--client");
  const folder = at === -1 ? undefined : args[at + 1];
  if (!folder || folder.startsWith("--") || args.length !== 2) {
    console.error(`Say which client to run: --client <folder>   (for example --client ${options.exampleClient})`);
    process.exit(2);
  }

  try {
    const running = await options.start({ clientFolder: folder, tokenFile: process.env.INTERNAL_TOKEN_FILE });
    const { client, server } = running;
    console.log(`Geometer · ${options.title} agent · ${client.settings.name} (${client.name}) · ${client.lock.pathway}@${client.lock.version}`);
    console.log(client.runtime.mode === "fakes" ? "Stand-in services: nothing real is contacted." : "Live: every call to a service goes through Guard.");
    const { parser, decision, ai, allowance } = client.runtime;
    console.log(parser || decision
      ? `Messages are read by the rules first${decision ? `, then a decision model (${decision.provider}, ${new URL(decision.baseUrl).origin})` : ""}${parser ? `, then a language model (${parser.wire} wire, ${new URL(parser.baseUrl).origin})` : ""}; a tapped button or list row is never read by a model. If a model cannot answer, the rules read the message.`
      : "Messages are read by the built-in rules (no model).");
    if (allowance) console.log(`AI allowance this month: ${[allowance.messages !== undefined ? `${allowance.messages} messages` : "", allowance.costInr !== undefined ? `about ₹${allowance.costInr}` : ""].filter(Boolean).join(" or ")}; when it is used up the agent answers with buttons and lists.`);
    if (ai === "buttons") console.log('runtime.json says "ai": "buttons", so no model is asked: the agent answers with buttons and lists.');
    console.log(`Listening on ${server.url} · data in ${client.runtime.dataDir} · a tick every ${client.runtime.tickSeconds} s`);
    console.log("Press Ctrl+C to stop.");
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => { void running.stop().then(() => process.exit(0), (e: Error) => { console.error(e.message); process.exit(1); }); });
    }
  } catch (e) {
    console.error(e instanceof ClientError || (e as NodeJS.ErrnoException).code === "EADDRINUSE" ? (e as Error).message : `The agent could not start: ${(e as Error).stack ?? e}`);
    process.exit(1);
  }
}
