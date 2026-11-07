// How the panel is started. One panel, two ways to run it: on a builder's own server ("own": builders may invite people from the panel, and the data
// key is optional) and on Geometer's server for the partners' shops ("hosted": invitations come only from the server's owner on the command line,
// and the panel refuses to start without its data key). Everything is read from the environment, so the bundle's compose file sets it.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface PanelConfig {
  serverDir: string;
  mode: "own" | "hosted";
  host: string;
  port: number;
  /** The address people open, for example https://shops.example.com. Decides Secure cookies and the Origin the panel accepts. */
  publicUrl?: string;
  /** Believe X-Forwarded-For (the bundle's HTTPS entry sets it). Off by default: an open port must not let a visitor choose their own address. */
  trustProxy: boolean;
  dataKeyFile?: string;
  signingKeyFile?: string;
  /** The Google address a calendar is shared with (a service account's), when the server has one for every shop. */
  calendarShareAddress?: string;
  templatesDir: string;
  /** Where to ask a shop's runtime for /status, and the file holding its bearer token. `{shop}` is filled in. Left out: not asked. */
  runtimeUrl?: string;
  runtimeTokenFile?: string;
  /** Where the panel reads the shop's Guards for connection checks (`{shop}` and `{kind}`: whatsapp, razorpay, calendar) and the panel's own credential for them. */
  guardUrl?: string;
  guardAgentTokenFile?: string;
  /** Where a provider's webhook should point, for the guide (`{shop}`, `{kind}`). */
  webhookUrl?: string;
  /** The cost line's settings. */
  whatsappProvider?: string;
  /** The model Guard the server runs, from the server's own geometer.json: a shop's runtime.json must ask for exactly this wire and model. */
  serverModel?: { wire: "openai" | "anthropic"; model: string };
  hostingSharePaise?: number;
  staleMinutes: number;
  now?: () => number;
}

export class ConfigError extends Error {}

const fill = (template: string | undefined, values: Record<string, string>): string | undefined =>
  template === undefined ? undefined : template.replace(/\{(\w+)\}/gu, (_, k: string) => values[k] ?? "");

export const runtimeUrlFor = (c: PanelConfig, shop: string) => fill(c.runtimeUrl, { shop });
export const runtimeTokenFileFor = (c: PanelConfig, shop: string) => fill(c.runtimeTokenFile, { shop });
export const guardUrlFor = (c: PanelConfig, shop: string, kind: string) => fill(c.guardUrl, { shop, kind });
export const webhookUrlFor = (c: PanelConfig, shop: string, kind: string) => fill(c.webhookUrl, { shop, kind });
export const isSecure = (c: PanelConfig): boolean => c.publicUrl?.startsWith("https://") === true;

const num = (v: string | undefined, name: string): number | undefined => {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new ConfigError(`${name} must be a whole number, not "${v}".`);
  return n;
};

export function configFromEnv(env: Record<string, string | undefined>): PanelConfig {
  const serverDir = env.PANEL_SERVER_DIR;
  if (!serverDir) throw new ConfigError("Say which server folder the panel serves: PANEL_SERVER_DIR=/path/to/server (the folder with geometer.json and shops/).");
  const mode = env.PANEL_MODE ?? "own";
  if (mode !== "own" && mode !== "hosted") throw new ConfigError('PANEL_MODE must be "own" (a builder\'s server) or "hosted" (Geometer\'s partner server).');
  const port = num(env.PANEL_PORT, "PANEL_PORT") ?? 8790;
  if (port > 65535) throw new ConfigError("PANEL_PORT must be 0 to 65535.");
  const publicUrl = env.PANEL_PUBLIC_URL?.replace(/\/+$/u, "");
  if (publicUrl !== undefined && !/^https?:\/\/[^/\s]+$/u.test(publicUrl)) throw new ConfigError("PANEL_PUBLIC_URL must look like https://shops.example.com (no path).");
  const dir = resolve(serverDir);
  // The server's own settings name the model every shop uses; a setting here wins.
  let serverModel: { wire: "openai" | "anthropic"; model: string } | undefined;
  const geometer = join(dir, "geometer.json");
  if (existsSync(geometer)) {
    try {
      const g = JSON.parse(readFileSync(geometer, "utf8")) as { model?: { wire?: unknown; model?: unknown } };
      if ((g.model?.wire === "openai" || g.model?.wire === "anthropic") && typeof g.model.model === "string") serverModel = { wire: g.model.wire, model: g.model.model };
    } catch { /* the bundle reports a broken geometer.json; the panel just has no model to name */ }
  }
  return {
    serverDir: dir, mode, host: env.PANEL_HOST ?? "127.0.0.1", port, ...(publicUrl ? { publicUrl } : {}),
    trustProxy: env.PANEL_TRUST_PROXY === "1",
    ...(env.PANEL_DATA_KEY_FILE ? { dataKeyFile: env.PANEL_DATA_KEY_FILE } : {}),
    ...(env.PANEL_SIGNING_KEY_FILE ? { signingKeyFile: env.PANEL_SIGNING_KEY_FILE } : {}),
    ...(env.PANEL_CALENDAR_SHARE_ADDRESS ? { calendarShareAddress: env.PANEL_CALENDAR_SHARE_ADDRESS } : {}),
    templatesDir: env.PANEL_TEMPLATES_DIR ? resolve(env.PANEL_TEMPLATES_DIR) : new URL("../../templates/", import.meta.url).pathname,
    ...(env.PANEL_RUNTIME_URL ? { runtimeUrl: env.PANEL_RUNTIME_URL } : {}), ...(env.PANEL_RUNTIME_TOKEN_FILE ? { runtimeTokenFile: env.PANEL_RUNTIME_TOKEN_FILE } : {}),
    ...(env.PANEL_GUARD_URL ? { guardUrl: env.PANEL_GUARD_URL } : {}), ...(env.PANEL_GUARD_AGENT_TOKEN_FILE ? { guardAgentTokenFile: env.PANEL_GUARD_AGENT_TOKEN_FILE } : {}),
    ...(env.PANEL_WEBHOOK_URL ? { webhookUrl: env.PANEL_WEBHOOK_URL } : {}),
    ...(env.PANEL_WHATSAPP_PROVIDER ? { whatsappProvider: env.PANEL_WHATSAPP_PROVIDER } : {}),
    ...(serverModel ? { serverModel } : {}),
    ...(num(env.PANEL_HOSTING_SHARE_PAISE, "PANEL_HOSTING_SHARE_PAISE") !== undefined ? { hostingSharePaise: num(env.PANEL_HOSTING_SHARE_PAISE, "PANEL_HOSTING_SHARE_PAISE") as number } : {}),
    staleMinutes: num(env.PANEL_STALE_MINUTES, "PANEL_STALE_MINUTES") ?? 30,
  };
}
