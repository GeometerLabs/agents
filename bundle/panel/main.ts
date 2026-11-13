// Start the panel, or make an invitation link.
//
//   PANEL_SERVER_DIR=/srv/geometer PANEL_PUBLIC_URL=https://shops.example.com node bundle/panel/main.ts            serve
//   PANEL_SERVER_DIR=/srv/geometer node bundle/panel/main.ts invite --role builder --note "Arjun"                  an invitation link, once
//   ... main.ts reset --handle divya [--hours 72]          a one-time link to choose a new passphrase (a forgotten one); every session of the account ends when it is used
//   ... main.ts signout --handle divya                     end every session of one account now
//   ... main.ts accounts                                   the accounts: sign-in name, role, how they sign in (one JSON line each; no hash, no token)
//   ... main.ts link-partner --handle divya --partner p-x  hosted mode: an invited partner signs in with geometer.dev from now on and keeps their shops
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
import { PaperError, createPapers } from "./papers.ts";
import { linkFleetPartner, listAccounts, makeConfirmLink, makeInviteLink, makeResetLink, openStores, signOutAccount, startPanel } from "./server.ts";
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
  } else if (command === "reset") {
    // a forgotten passphrase: a one-time link for the person, sent by whoever runs the server; an account that signs in with geometer.dev has none to reset
    const { values } = parseArgs({ args: rest, options: { handle: { type: "string" }, hours: { type: "string" } } });
    if (!values.handle) throw new ConfigError("Say whose passphrase: --handle <sign-in name> (main.ts accounts lists them).");
    const hours = values.hours === undefined ? 72 : Number(values.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw new ConfigError("--hours must be a whole number from 1 to 720.");
    const made = makeResetLink(config, values.handle, hours);
    console.log(made.link);
    console.log(`\nFor ${made.name}. This link works once and runs out ${made.expiresAt}. Send it only to that person: whoever opens it chooses the passphrase. Using it signs every session of the account out.`);
  } else if (command === "signout") {
    const { values } = parseArgs({ args: rest, options: { handle: { type: "string" } } });
    if (!values.handle) throw new ConfigError("Say whose sessions: --handle <sign-in name> (main.ts accounts lists them).");
    const a = signOutAccount(config, values.handle);
    console.log(`Every session of ${a.handle} (${a.name}) has ended. They sign in again ${a.fleetPartner ? "with geometer.dev" : "with their passphrase"}.`);
  } else if (command === "accounts") {
    for (const a of listAccounts(config)) console.log(JSON.stringify(a));
  } else if (command === "link-partner") {
    const { values } = parseArgs({ args: rest, options: { handle: { type: "string" }, partner: { type: "string" } } });
    if (!values.handle || !values.partner) throw new ConfigError("Say which account and which partner: --handle <sign-in name> --partner <partner id in fleet>.");
    const a = linkFleetPartner(config, values.handle, values.partner);
    console.log(`${a.handle} (${a.name}) now signs in with the geometer.dev account of partner ${a.fleetPartner}, and keeps their shops. Their passphrase no longer works, and every session of theirs has ended.`);
  } else if (command === "confirm-link") {
    // Asks for a person's yes (plan B11, the Claude Code plugin): prints one JSON line with a one-time link. It only ASKS; there is no command that applies anything.
    const { values } = parseArgs({ args: rest, options: { kind: { type: "string" }, shop: { type: "string" }, changes: { type: "string" }, note: { type: "string" } } });
    if (values.kind !== "limits" && values.kind !== "go-live") throw new ConfigError("Say what is asked: --kind limits or --kind go-live.");
    if (!values.shop) throw new ConfigError("Say which shop: --shop <id>.");
    let changes;
    if (values.kind === "limits") {
      try { changes = JSON.parse(values.changes ?? "") as { path: string; value: number }[]; } catch { throw new ConfigError('--changes must be JSON: [{"path":"cancellation.refundLimitInr","value":100}].'); }
      if (!Array.isArray(changes)) throw new ConfigError("--changes must be a list.");
    }
    console.log(JSON.stringify({ ok: true, ...makeConfirmLink(config, { kind: values.kind, shop: values.shop, ...(changes ? { changes } : {}), ...(values.note ? { note: values.note } : {}) }) }));
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
  } else if (command === "anchor" || command === "paper") {
    // B28: `anchor <shop> --json` signs the checkpoint over the head of the shop's ledger for the deployer's daily fingerprint (the deployer holds no key).
    // B35, B36: `paper dispute|identity|ledger <shop> [--case b-3] [--lang en] --json` makes a paper for `geometer paper`; each file comes back as text.
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { json: { type: "boolean" }, case: { type: "string" }, lang: { type: "string" } } });
    const [kindOrShop, maybeShop] = positionals;
    const shop = command === "anchor" ? kindOrShop : maybeShop;
    try {
      if (!shop || !/^[a-z0-9-]{1,40}$/u.test(shop)) throw new PaperError(command === "anchor" ? "Say which shop: anchor <shop>." : "Say which paper and which shop: paper dispute|identity|ledger <shop>.");
      const { store } = openStores(config);
      const shops = createShops(config, store);
      if (!shops.exists(shop)) throw new PaperError(`There is no shop ${shop} on this server.`);
      const papers = createPapers(config, shops, createDocuments(store), Date.now);
      if (command === "anchor") console.log(JSON.stringify({ ok: true, anchor: papers.anchor(shop) }));
      else {
        const files = kindOrShop === "dispute" ? papers.dispute(shop, values.case ?? "", values.lang) : kindOrShop === "identity" ? (() => { const i = papers.identity(shop, values.lang); return [...i.full, ...i.public]; })() : kindOrShop === "ledger" ? papers.ledger(shop) : undefined;
        if (!files) throw new PaperError(`"${kindOrShop}" is not a paper the command line makes: dispute, identity or ledger (a statement is made in the panel, so the person's number stays out of the command line).`);
        console.log(JSON.stringify({ ok: true, files: files.map((f) => ({ file: f.file, text: f.text })) }));
      }
    } catch (e) {
      if (!(e instanceof PaperError)) throw e;
      if (values.json) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
      process.exitCode = 1;
    }
  } else if (command === "serve") {
    const panel = await startPanel(config);
    console.log(`Geometer panel (${config.mode}) is open at ${panel.url}${config.publicUrl ? `, served to people as ${config.publicUrl}` : ""}.`);
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void panel.close().then(() => process.exit(0)); });
  } else throw new ConfigError(`I don't know "${command}". Use serve (the default), invite, reset, signout, accounts, link-partner, confirm-link, export, anchor or paper.`);
} catch (e) {
  if (e instanceof ConfigError || e instanceof VaultError) { console.error(e.message); process.exit(2); }
  throw e;
}
