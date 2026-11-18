// The shared process: ONE container's program for every listings-only shop on a server (modules/runtime/shared.ts says how it works).
//
//   SHOPS_DIR=/shops SECRETS_DIR=/run/secrets node templates/commerce/listings/server/shared-main.ts
//
//   /shops/<shop>/client/    the shop's settings.json, runtime.json, pathway.lock (read-only; the deployer writes pathway.lock last)
//   /run/secrets/<shop>/     the shop's internal_token, channel_token and record_key (one folder each, so a shop's files are never beside another's)
//   the shop's data          where its runtime.json `dataDir` says: /home/node/<shop>/data/agent.db, in the one shared volume, a folder of its own per shop
//
// The environment sets NO token and NO key: every shop's are files, handed to that shop's own start. (modules/runtime/start.ts falls back to INTERNAL_TOKEN_FILE and the like
// when a file is not given; they are never set here, so a shop with a missing file fails to start instead of running on another shop's token.)
// Press Ctrl+C (or send SIGTERM) to stop: each shop's step in hand finishes and its store is closed.
import { folderSource, startShared } from "../../../../modules/runtime/shared.ts";
import { startClient } from "./start.ts";

const dir = (name: string, fallback: string): string => process.env[name] || fallback;
const source = folderSource({ clientsDir: dir("SHOPS_DIR", "/shops"), secretsDir: dir("SECRETS_DIR", "/run/secrets") });
const shared = await startShared({
  source, host: process.env.HOST ?? "0.0.0.0", port: Number(process.env.PORT ?? 8780), scanSeconds: Number(process.env.SCAN_SECONDS ?? 5), log: (line) => console.log(line),
  start: (p, listen) => startClient({
    clientFolder: p.clientFolder, tokenFile: p.tokenFile, channelTokenFile: p.channelTokenFile, recordKeyFile: p.recordKeyFile, listen, log: (line) => console.log(`[${p.name}] ${line}`),
  }),
});
console.log(`Geometer · listings-only shops · ${shared.held().length} shop(s) held · ${shared.url}`);
const stop = (): void => { void shared.stop().then(() => process.exit(0)); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
