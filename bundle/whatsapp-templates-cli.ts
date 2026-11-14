// `geometer whatsapp-templates <shop>`: put a shop's WhatsApp templates into its own Gupshup account by script (lib/gupshup-templates.ts says how and why). This file is
// the command line's side only: which entries, which app, which key (from the environment or the shop's secret file, never an argument), and what to print.
// The default changes nothing; --submit sends; --status lists each template's state.
import { GUPSHUP_API_BASE, apiKeyOf, appOf, gupshupApi, readEntries, run, select, templateOf } from "./lib/gupshup-templates.ts";
import type { Gupshup } from "./lib/gupshup-templates.ts";

export interface TemplatesFlags { template?: string; languages?: string; only?: string; submit?: boolean; status?: boolean }
export interface TemplatesIo { log: (line: string) => void; env?: NodeJS.ProcessEnv; api?: Gupshup; pause?: () => Promise<void> }

const list = (s: string | undefined): string[] => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export async function whatsappTemplatesCommand(appDir: string, serverDir: string, shop: string | undefined, flags: TemplatesFlags, io: TemplatesIo): Promise<number> {
  if (!shop) throw new Error("Say which shop: whatsapp-templates <shop> [--submit | --status] [--template bookings|orders|fees] [--languages hi,en] [--only name1,name2]");
  if (flags.submit && flags.status) throw new Error("--submit and --status cannot be used together.");
  const env = io.env ?? process.env;
  const template = flags.template ?? templateOf(serverDir, shop);
  const entries = select(readEntries(appDir, template), { languages: list(flags.languages), only: list(flags.only) });
  if (entries.length === 0) throw new Error("No template matches --languages / --only.");
  const app = appOf(serverDir, shop);
  const mode = flags.submit ? "submit" : flags.status ? "status" : "dry-run";
  io.log(`${shop}: ${template}, Gupshup app ${app.appName}${app.appId ? "" : " (no app id)"}, ${entries.length} templates${mode === "dry-run" ? " (dry run: nothing will be sent)" : ""}`);
  // the key is read only now, and only handed to the Gupshup calls; a dry run still reads the app's list, so it needs the key too
  const api = io.api ?? gupshupApi(env.GUPSHUP_API_BASE?.trim() || GUPSHUP_API_BASE, apiKeyOf(serverDir, shop, env));
  const r = await run({ entries, app, api, mode, pause: io.pause ?? (() => new Promise((res) => setTimeout(res, 500))) });
  r.lines.forEach(io.log);
  return r.code;
}
