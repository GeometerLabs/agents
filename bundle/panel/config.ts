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
  /** Where each shop's fingerprint key (B69) is, as secrets/panel/person-keys/<shop>: what matches a typed number to the record's fingerprints. Left out: a person's statement is refused, and the panel says why. */
  personKeysDir?: string;
  /** The Google address a calendar is shared with (a service account's), when the server has one for every shop. */
  calendarShareAddress?: string;
  templatesDir: string;
  /** Where to ask a shop's runtime for /status, and the file holding its bearer token. `{shop}` is filled in. Left out: not asked. */
  runtimeUrl?: string;
  runtimeTokenFile?: string;
  /** Where the panel reads the shop's Guards for connection checks (`{shop}` and `{kind}`: whatsapp, calendar, or the gateway's id) and the panel's own credential for them. */
  guardUrl?: string;
  guardAgentTokenFile?: string;
  /** Where a provider's webhook should point, for the guide (`{shop}`, `{kind}`). */
  webhookUrl?: string;
  /** The cost line's settings. */
  whatsappProvider?: string;
  /** The model Guard the server runs, from the server's own geometer.json: a shop's runtime.json must ask for exactly this wire and model. */
  serverModel?: { wire: "openai" | "anthropic"; model: string };
  hostingSharePaise?: number;
  /** How many hours an answer from the owner may wait before the to-do list says it has waited too long (PANEL_APPROVAL_WAIT_HOURS). Left out: 12. */
  approvalWaitHours?: number;
  /**
   * Hosted mode: the geometer.dev account page, where a local partner opens this panel with their geometer.dev sign-in (fleet-signin.ts). The sign-in page links
   * to it. PANEL_ACCOUNT_URL; left out: https://geometer.dev/account/. Not used on a builder's own server.
   */
  accountUrl?: string;
  staleMinutes: number;
  now?: () => number;
}

// Thrown for a bad environment at start-up so the panel refuses to run, with a message the operator can act on, instead of limping along half set up.
export class ConfigError extends Error {}

const fill = (template: string | undefined, values: Record<string, string>): string | undefined =>
  template === undefined ? undefined : template.replace(/\{(\w+)\}/gu, (_, k: string) => values[k] ?? "");

// The URL templates in the config hold `{shop}` and `{kind}` slots; these small helpers fill them so every caller addresses a shop's services the same way.
export const runtimeUrlFor = (c: PanelConfig, shop: string) => fill(c.runtimeUrl, { shop });
// Per-shop path of the bearer-token file for that shop's runtime, read by the panel only to call the runtime's /status.
export const runtimeTokenFileFor = (c: PanelConfig, shop: string) => fill(c.runtimeTokenFile, { shop });
// Per-shop, per-kind address of the shop's Guard, used by the read-only connection checks (checks.ts).
export const guardUrlFor = (c: PanelConfig, shop: string, kind: string) => fill(c.guardUrl, { shop, kind });
// Where a provider's webhook should point for a shop and kind, shown in the setup guide.
export const webhookUrlFor = (c: PanelConfig, shop: string, kind: string) => fill(c.webhookUrl, { shop, kind });
// True only for an https public address; server.ts uses it to decide whether cookies get the Secure flag.
export const isSecure = (c: PanelConfig): boolean => c.publicUrl?.startsWith("https://") === true;

const num = (v: string | undefined, name: string): number | undefined => {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new ConfigError(`${name} must be a whole number, not "${v}".`);
  return n;
};

/**
 * The model geometer.json names now. Read when a shop's runtime.json is written, not only at start: on a new server the panel's first run chooses the model
 * while the panel is already running (plan item 14b). Undefined when none is chosen or the file cannot be read (the bundle says why).
 */
export function readServerModel(serverDir: string): { wire: "openai" | "anthropic"; model: string } | undefined {
  const geometer = join(resolve(serverDir), "geometer.json");
  if (!existsSync(geometer)) return undefined;
  try {
    const g = JSON.parse(readFileSync(geometer, "utf8")) as { model?: { wire?: unknown; model?: unknown } };
    if ((g.model?.wire === "openai" || g.model?.wire === "anthropic") && typeof g.model.model === "string" && g.model.model !== "") return { wire: g.model.wire, model: g.model.model };
  } catch { /* the bundle reports a broken geometer.json; the panel just has no model to name */ }
  return undefined;
}

/** Item 11h: the pages domain geometer.json names (Geometer's partner server), read when the owner's setup QR is made, so it names the owner's view's real address. */
export function readPagesDomain(serverDir: string): string | undefined {
  try {
    const g = JSON.parse(readFileSync(join(resolve(serverDir), "geometer.json"), "utf8")) as { pages?: { domain?: unknown } };
    return typeof g.pages?.domain === "string" && g.pages.domain !== "" ? g.pages.domain : undefined;
  } catch { return undefined; }
}

/** Where a partner opens this panel with their geometer.dev sign-in, unless PANEL_ACCOUNT_URL says otherwise. */
export const DEFAULT_ACCOUNT_URL = "https://geometer.dev/account/";
/** The geometer.dev account page a hosted panel sends partners to: https only, or the default. */
function accountUrlOf(v: string | undefined): string {
  if (v === undefined || v === "") return DEFAULT_ACCOUNT_URL;
  if (!/^https:\/\/[^\s"<>]+$/u.test(v)) throw new ConfigError("PANEL_ACCOUNT_URL must be an https:// address, like https://geometer.dev/account/.");
  return v;
}

// Turns the environment into a PanelConfig (everything comes from env so the compose file is the only place to set it); throws ConfigError on a missing or bad value, notably the data key on a hosted server.
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
  // The server's own settings name the model every shop uses (read again when a shop is written: server.ts).
  const serverModel = readServerModel(dir);
  return {
    serverDir: dir, mode, host: env.PANEL_HOST ?? "127.0.0.1", port, ...(publicUrl ? { publicUrl } : {}),
    trustProxy: env.PANEL_TRUST_PROXY === "1",
    ...(env.PANEL_DATA_KEY_FILE ? { dataKeyFile: env.PANEL_DATA_KEY_FILE } : {}),
    ...(env.PANEL_SIGNING_KEY_FILE ? { signingKeyFile: env.PANEL_SIGNING_KEY_FILE } : {}),
    ...(env.PANEL_PERSON_KEYS_DIR ? { personKeysDir: env.PANEL_PERSON_KEYS_DIR } : {}),
    ...(env.PANEL_CALENDAR_SHARE_ADDRESS ? { calendarShareAddress: env.PANEL_CALENDAR_SHARE_ADDRESS } : {}),
    templatesDir: env.PANEL_TEMPLATES_DIR ? resolve(env.PANEL_TEMPLATES_DIR) : new URL("../../templates/", import.meta.url).pathname,
    ...(env.PANEL_RUNTIME_URL ? { runtimeUrl: env.PANEL_RUNTIME_URL } : {}), ...(env.PANEL_RUNTIME_TOKEN_FILE ? { runtimeTokenFile: env.PANEL_RUNTIME_TOKEN_FILE } : {}),
    ...(env.PANEL_GUARD_URL ? { guardUrl: env.PANEL_GUARD_URL } : {}), ...(env.PANEL_GUARD_AGENT_TOKEN_FILE ? { guardAgentTokenFile: env.PANEL_GUARD_AGENT_TOKEN_FILE } : {}),
    ...(env.PANEL_WEBHOOK_URL ? { webhookUrl: env.PANEL_WEBHOOK_URL } : {}),
    ...(env.PANEL_WHATSAPP_PROVIDER ? { whatsappProvider: env.PANEL_WHATSAPP_PROVIDER } : {}),
    ...(serverModel ? { serverModel } : {}),
    ...(num(env.PANEL_HOSTING_SHARE_PAISE, "PANEL_HOSTING_SHARE_PAISE") !== undefined ? { hostingSharePaise: num(env.PANEL_HOSTING_SHARE_PAISE, "PANEL_HOSTING_SHARE_PAISE") as number } : {}),
    ...(num(env.PANEL_APPROVAL_WAIT_HOURS, "PANEL_APPROVAL_WAIT_HOURS") !== undefined ? { approvalWaitHours: num(env.PANEL_APPROVAL_WAIT_HOURS, "PANEL_APPROVAL_WAIT_HOURS") as number } : {}),
    staleMinutes: num(env.PANEL_STALE_MINUTES, "PANEL_STALE_MINUTES") ?? 30,
    accountUrl: accountUrlOf(env.PANEL_ACCOUNT_URL),
  };
}
