// Start the panel, or make an invitation link.
//
//   PANEL_SERVER_DIR=/srv/geometer PANEL_PUBLIC_URL=https://shops.example.com node bundle/panel/main.ts            serve
//   PANEL_SERVER_DIR=/srv/geometer node bundle/panel/main.ts invite --role builder --note "Arjun"                  an invitation link, once
//
// Everything else is set by environment variables (see README.md in this folder). Hosted mode (PANEL_MODE=hosted) is Geometer's own server for the
// partners' shops: it refuses to start without PANEL_DATA_KEY_FILE, and invitations are made only here, on the command line.
import { parseArgs } from "node:util";
import { ConfigError, configFromEnv } from "./config.ts";
import { makeInviteLink, startPanel } from "./server.ts";
import { VaultError } from "./vault.ts";

try {
  const config = configFromEnv(process.env);
  const [command = "serve", ...rest] = process.argv.slice(2);
  if (command === "invite") {
    const { values } = parseArgs({ args: rest, options: { role: { type: "string" }, note: { type: "string" }, hours: { type: "string" } } });
    if (values.role !== "builder" && values.role !== "partner") throw new ConfigError('Say who the invitation is for: --role builder or --role partner.');
    const hours = values.hours === undefined ? 72 : Number(values.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw new ConfigError("--hours must be a whole number from 1 to 720.");
    console.log(makeInviteLink(config, values.role, values.note ?? "", hours));
    console.log(`\nThis link works once and runs out in ${hours} hours. Send it only to that person. It is not kept anywhere else.`);
  } else if (command === "serve") {
    const panel = await startPanel(config);
    console.log(`Geometer panel (${config.mode}) is open at ${panel.url}${config.publicUrl ? `, served to people as ${config.publicUrl}` : ""}.`);
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void panel.close().then(() => process.exit(0)); });
  } else throw new ConfigError(`I don't know "${command}". Use serve (the default) or invite.`);
} catch (e) {
  if (e instanceof ConfigError || e instanceof VaultError) { console.error(e.message); process.exit(2); }
  throw e;
}
