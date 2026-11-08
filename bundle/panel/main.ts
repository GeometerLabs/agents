// Start the panel, or make an invitation link.
//
//   PANEL_SERVER_DIR=/srv/geometer PANEL_PUBLIC_URL=https://shops.example.com node bundle/panel/main.ts            serve
//   PANEL_SERVER_DIR=/srv/geometer node bundle/panel/main.ts invite --role builder --note "Arjun"                  an invitation link, once
//
// Everything else is set by environment variables (see README.md in this folder). Hosted mode (PANEL_MODE=hosted) is Geometer's own server for the
// partners' shops: it refuses to start without PANEL_DATA_KEY_FILE, and invitations are made only here, on the command line.
import { parseArgs } from "node:util";
import { ConfigError, configFromEnv } from "./config.ts";
import { writeFileSync } from "node:fs";
import { ExportError } from "../export/build.ts";
import { createDocuments } from "./documents.ts";
import { exportShop } from "./export.ts";
import { createShops } from "./shops.ts";
import { makeInviteLink, openStores, startPanel } from "./server.ts";
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
  } else if (command === "export") {
    // the panel builds the shop's export (it alone can open the papers it keeps): `--json` prints one line the deployer's CLI reads, `--out FILE` writes the .tar.gz here
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { json: { type: "boolean" }, out: { type: "string" } } });
    const shop = positionals[0];
    if (!shop) throw new ConfigError("Say which shop: export <shop> [--out FILE | --json].");
    try {
      const { store } = openStores(config);
      const { built, tgz } = exportShop(config, createShops(config, store), createDocuments(store), shop, Date.now(), { name: "geometer export", role: "server" });
      if (values.out) { writeFileSync(values.out, tgz, { mode: 0o644 }); console.log(`Wrote ${values.out} (${built.manifest.files.length} files).`); }
      else console.log(JSON.stringify({ ok: true, name: built.name, warnings: built.warnings, tgz: tgz.toString("base64") }));
    } catch (e) {
      if (!(e instanceof ExportError) && !/not a shop name/u.test((e as Error).message)) throw e;
      if (values.json) console.log(JSON.stringify({ ok: false, error: (e as Error).message })); else console.error((e as Error).message);
      process.exitCode = 1;
    }
  } else if (command === "serve") {
    const panel = await startPanel(config);
    console.log(`Geometer panel (${config.mode}) is open at ${panel.url}${config.publicUrl ? `, served to people as ${config.publicUrl}` : ""}.`);
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void panel.close().then(() => process.exit(0)); });
  } else throw new ConfigError(`I don't know "${command}". Use serve (the default), invite or export.`);
} catch (e) {
  if (e instanceof ConfigError || e instanceof VaultError) { console.error(e.message); process.exit(2); }
  throw e;
}
