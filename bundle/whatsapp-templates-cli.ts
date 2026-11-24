// `geometer whatsapp-templates <shop>`: the same submission the panel makes when it saves a shop's WhatsApp connection (lib/wa-templates.ts holds all of it), from the
// server's command line. This file is the command line's side only: which shop, which account (runtime.json), which key (from the environment or the shop's secret
// file, never an argument) and what to print. Unlike the panel it talks to the provider itself, from the machine that holds the shop's key, not through the Guard.
// The default changes nothing (a dry run); --submit sends; --status lists each template's state.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkoutDirOf } from "./lib/pathways.ts";
import { readSecretFile, secretFile } from "./lib/secrets.ts";
import { serverPaths } from "./lib/server.ts";
import { accountOf, directCall, gupshupProvider, metaProvider, missingFor, run, select, shopParts, shopTemplateSet, templateSet } from "./lib/wa-templates.ts";
import type { Call, Provider } from "./lib/wa-templates.ts";

export interface TemplatesFlags { template?: string; languages?: string; only?: string; submit?: boolean; status?: boolean }
export interface TemplatesIo { log: (line: string) => void; env?: NodeJS.ProcessEnv; /** A test's own calls, in place of the provider's (the key is still read, and must be there). */ call?: Call; pause?: () => Promise<void> }

/** The providers' hosts. A test (or a person with a proxy) can point WHATSAPP_GRAPH_BASE or GUPSHUP_API_BASE somewhere else; plain http only on this machine. */
export const GRAPH_BASE = "https://graph.facebook.com";
export const GUPSHUP_API_BASE = "https://api.gupshup.io";

const list = (s: string | undefined): string[] => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const readJson = (file: string): unknown => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined);

/** The template a shop is pinned to ("bookings@0.1.0" in pathway.lock gives "bookings"). */
export function templateOf(serverDir: string, shop: string): string {
  const file = join(serverPaths(serverDir).shop(shop), "pathway.lock");
  if (!existsSync(file)) throw new Error(`${shop} has no pathway.lock; say the template with --template bookings|orders|fees.`);
  return readFileSync(file, "utf8").trim().split("@")[0];
}

/**
 * The shop's key as the header its provider reads: the environment first (WHATSAPP_TOKEN for Meta, sent as "Bearer <token>"; GUPSHUP_APIKEY for Gupshup), then the
 * shop's own secret file (secrets/g-<shop>-whatsapp/whatsapp_authorization), which the intake wrote from what was handed in: for Meta it already is "Bearer <token>",
 * the whole Authorization value its Guard sends (lib/secrets.ts INTAKE). Never an argument, never printed.
 */
export function keyHeaderOf(serverDir: string, shop: string, provider: "meta" | "gupshup-selfserve", env: NodeJS.ProcessEnv = process.env): { name: string; value: string } {
  const file = () => readSecretFile(secretFile(serverDir, `g-${shop}-whatsapp`, "whatsapp_authorization"));
  if (provider === "meta") {
    const token = env.WHATSAPP_TOKEN?.trim();
    const value = token ? `Bearer ${token}` : file();
    if (!value) throw new Error(`No WhatsApp access token found for ${shop}. Either set WHATSAPP_TOKEN in the environment for this one command, or hand the token in the usual way (the panel's WhatsApp step) so it is in the shop's secret file.`);
    if (!/^Bearer \S+$/u.test(value)) throw new Error("The WhatsApp access token must be on one line with no spaces.");
    return { name: "authorization", value };
  }
  const key = env.GUPSHUP_APIKEY?.trim() || file();
  if (!key) throw new Error(`No Gupshup API key found for ${shop}. Either set GUPSHUP_APIKEY in the environment for this one command, or hand the key in the usual way (the panel, or secrets-inbox/${shop}/gupshup_apikey) so it is in the shop's secret file.`);
  if (/\s/u.test(key)) throw new Error("The Gupshup API key must be on one line with no spaces.");
  return { name: "apikey", value: key };
}

export async function whatsappTemplatesCommand(appDir: string, serverDir: string, shop: string | undefined, flags: TemplatesFlags, io: TemplatesIo): Promise<number> {
  if (!shop) throw new Error("Say which shop: whatsapp-templates <shop> [--submit | --status] [--template bookings|orders|fees] [--languages hi,en] [--only name1,name2]");
  if (flags.submit && flags.status) throw new Error("--submit and --status cannot be used together.");
  const env = io.env ?? process.env;
  const dir = serverPaths(serverDir).shop(shop);
  const runtime = readJson(join(dir, "runtime.json"));
  if (runtime === undefined) throw new Error(`${shop} has no runtime.json yet, so it has no WhatsApp account set up. Set up its WhatsApp number in the panel first.`);
  const account = accountOf(runtime);
  if (!account) throw new Error(`${shop} has no WhatsApp (runtime.json names no messaging service), so it has no templates to submit.`);
  if (account.provider === "other") throw new Error(`${shop} is on a Gupshup partner app, whose templates the partner adds; this command submits to a shop's own Meta account or its own Gupshup app.`);
  const mode = flags.submit ? "submit" : flags.status ? "status" : "dry-run";
  const missing = missingFor(account, mode === "submit" ? "submit" : "read");
  if (missing === "account-id") throw new Error(`${shop} has no WhatsApp Business Account id in runtime.json (services.messaging.wabaId), and Meta's template calls need it. Add it in the panel's WhatsApp step (Meta shows it on the API Setup page, beside the phone number id).`);
  if (missing === "app-id") throw new Error(`The Gupshup app ${account.provider === "gupshup-selfserve" ? account.appName : ""} has no app id in runtime.json, and Gupshup's create call needs it. Add it in the panel's WhatsApp step (Gupshup shows it on the app's page).`);
  // the shop's own set (its parts, in its languages), unless --template names one template; --languages and --only narrow it for a careful first try
  const languages = list(flags.languages);
  const all = flags.template ? templateSet(shopParts(flags.template, (id) => checkoutDirOf(appDir, id)), languages)
    : shopTemplateSet({ templateId: templateOf(serverDir, shop), settings: readJson(join(dir, "settings.json")), folderOf: (id) => checkoutDirOf(appDir, id) });
  const entries = select(all, { languages, only: list(flags.only) });
  if (entries.length === 0) throw new Error(all.length === 0 ? `There is no list of WhatsApp templates for ${shop} in this checkout (templates/<domain>/<template>/whatsapp-templates.json).` : "No template matches --languages / --only.");
  // the key is read only now, and only handed to the calls; a dry run still reads the account's list, so it needs the key too
  const header = keyHeaderOf(serverDir, shop, account.provider, env);
  let provider: Provider;
  if (account.provider === "meta") provider = metaProvider(io.call ?? directCall(env.WHATSAPP_GRAPH_BASE?.trim() || GRAPH_BASE, "WHATSAPP_GRAPH_BASE", header), account.wabaId!);
  else provider = gupshupProvider(io.call ?? directCall(env.GUPSHUP_API_BASE?.trim() || GUPSHUP_API_BASE, "GUPSHUP_API_BASE", header), account);
  io.log(`${shop}: ${account.provider === "meta" ? `Meta, WhatsApp Business Account ${account.wabaId}` : `Gupshup app ${account.appName}`}, ${entries.length} templates${mode === "dry-run" ? " (dry run: nothing will be sent)" : ""}`);
  const r = await run({ entries, provider, mode, pause: io.pause ?? (() => new Promise((res) => setTimeout(res, 500))) });
  r.lines.forEach(io.log);
  return r.code;
}
