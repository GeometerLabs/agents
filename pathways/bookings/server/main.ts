// Run one client's Bookings agent as a server.
//
//   INTERNAL_TOKEN_FILE=/run/secrets/inbox-token node pathways/bookings/server/main.ts --client clients/glow-salon
//
// The folder holds settings.json, runtime.json and pathway.lock (see README.md). The token file holds the secret the inbox
// sends as "Authorization: Bearer ...". Press Ctrl+C (or send SIGTERM) to stop: the step in hand finishes, the rest waits
// in the store for the next start.
import { ClientError } from "./config.ts";
import { startClient } from "./start.ts";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: INTERNAL_TOKEN_FILE=<file> node pathways/bookings/server/main.ts --client <folder>");
  process.exit(0);
}
const at = args.indexOf("--client");
const folder = at === -1 ? undefined : args[at + 1];
if (!folder || folder.startsWith("--") || args.length !== 2) {
  console.error("Say which client to run: --client <folder>   (for example --client pathways/bookings/clients/glow-salon.example)");
  process.exit(2);
}

try {
  const running = await startClient({ clientFolder: folder, tokenFile: process.env.INTERNAL_TOKEN_FILE });
  const { client, server } = running;
  console.log(`Geometer · Bookings agent · ${client.settings.name} (${client.name}) · ${client.lock.pathway}@${client.lock.version}`);
  console.log(client.runtime.mode === "fakes" ? "Stand-in services: nothing real is contacted." : "Live: every call to a service goes through Guard.");
  console.log(`Listening on ${server.url} · data in ${client.runtime.dataDir} · a tick every ${client.runtime.tickSeconds} s`);
  console.log("Press Ctrl+C to stop.");
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => { void running.stop().then(() => process.exit(0), (e: Error) => { console.error(e.message); process.exit(1); }); });
  }
} catch (e) {
  console.error(e instanceof ClientError || (e as NodeJS.ErrnoException).code === "EADDRINUSE" ? (e as Error).message : `The agent could not start: ${(e as Error).stack ?? e}`);
  process.exit(1);
}
