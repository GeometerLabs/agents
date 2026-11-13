// A shop's page on the pages domain, the server's side (plan item 11f, decision 44). Used by the deployer's loop (apply.ts runPages), by the panel (which writes the
// shop's choice and reads what came of it) and by the tests.
//
//   shops/<shop>/page.json            DESIRED, the panel writes it: {"schema": 1, "pages": "hub" | "own", "slug": "veena-salon", "whatsapp": "+919800000000"}.
//                                     "hub": a slug and a page id on the pages domain (fleet's registry), served through the front door. "own": the shop's
//                                     views are at https://<this server>/s/<shop>/ only. Geometer's partner server is always "hub"; a builder's default is "own".
//   shops/<shop>/owner-sessions.json  the panel's "sign out every device": {"schema": 1, "endBefore": "<ISO>"}
//   status/pages/<shop>.json          RESULT, the deployer writes it for the panel: the slug fleet confirmed, its address, the stable page address, or the problem
//   pages.json (two copies)           what the shop's runtime (client folder) and the inbox's front (the shop's secrets folder) read on every request
//                                     (modules/channels/pages-file.ts): the shop's addresses, where the owner's view is, the WhatsApp number to show
//   owner-sessions.json (one copy)    the panel's file, handed to the runtime's client folder (removed again when the panel's is gone)
//   shops/<shop>/owner-grants.json    item 11h: the partner's setup QR, recovery card and "remove the owner's passkeys", as hashes only (modules/channels/owner-grants.ts);
//                                     handed to the runtime's client folder the same way, so a QR shown on the panel works within one pass (10 s)
//
// Fleet is asked only when something changed (a new slug, a choice of "own", a removed shop) or once a day (the claim is idempotent), and a refused claim is not
// sent again for ten minutes unless the slug changes. The deployment key is the deployer's (as for the paper signer's claim); no other container holds it.
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { OWNER_SESSIONS_FILE } from "../../modules/channels/owner-access.ts";
import { OWNER_GRANTS_FILE, RECOVERY_CODES, SETUP_MS, newRecoveryCode, newSetupToken, readOwnerGrants, recoveryHash, setupHash } from "../../modules/channels/owner-grants.ts";
import type { OwnerGrants } from "../../modules/channels/owner-grants.ts";
import { PAGES_FILE, readPagesFile } from "../../modules/channels/pages-file.ts";
import type { PagesFile } from "../../modules/channels/pages-file.ts";
import { readSecretFile, secretFile } from "./secrets.ts";
import { publicUrl, serverPaths } from "./server.ts";
import type { ServerConfig } from "./server.ts";
import { stableJson, writeAtomic } from "./util.ts";

export const PAGE_SETTINGS_FILE = "page.json";
/** Fleet's routes (monorepo apps/fleet/src/page-slugs-api.ts). */
export const SLUGS_PATH = "/v1/page-slugs";
const DAY_MS = 24 * 60 * 60_000;
/** A refused claim (taken, cooling) is not asked again for this long, unless the partner picks another name. */
export const CLAIM_RETRY_MS = 10 * 60_000;

/** What the panel chose for a shop. */
export interface PageSettings { pages: "hub" | "own"; slug?: string; whatsapp?: string }
/** What came of it, for the panel. */
export interface PageStatus {
  schema: 1; at: string;
  slug?: string; url?: string; pageId?: string; pageUrl?: string;
  problem?: { code: string; message: string };
  /** The last claim that was refused or did not reach fleet: its slug and when, so it is not sent again every pass. */
  tried?: { slug: string; at: string };
}

/** The same shape fleet checks first (its page-slugs.ts slugCheck); fleet alone knows which names are reserved or taken. */
export const SLUG_SHAPE = /^(?!.*--)(?![0-9]+$)[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/u;
export const WHATSAPP_NUMBER = /^\+91\d{10}$/u;

const read = (path: string): string | undefined => { try { return readFileSync(path, "utf8"); } catch { return undefined; } };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const pageSettingsFile = (dir: string, shop: string): string => join(serverPaths(dir).shop(shop), PAGE_SETTINGS_FILE);
export const pagesStatusFile = (dir: string, shop: string): string => join(serverPaths(dir).status, "pages", `${shop}.json`);
/** The two copies of pages.json the deployer keeps: the runtime's client folder and the inbox's folder for the shop. */
export const pagesCopies = (dir: string, shop: string): string[] => [join(serverPaths(dir).generated, "shops", shop, "client", PAGES_FILE), secretFile(dir, "inbox", shop, PAGES_FILE)];

/** The shop's choice, read field by field. Without a file: "hub" on Geometer's partner server (panel mode hosted), "own" on a builder's server (decision 44). */
export function readPageSettings(dir: string, shop: string, hosted: boolean): PageSettings {
  let f: Record<string, unknown> = {};
  try { const raw = JSON.parse(read(pageSettingsFile(dir, shop)) ?? "{}") as unknown; if (isObj(raw)) f = raw; } catch { f = {}; }
  const pages = hosted ? "hub" : f.pages === "hub" ? "hub" : "own";
  return {
    pages,
    ...(typeof f.slug === "string" && SLUG_SHAPE.test(f.slug) ? { slug: f.slug } : {}),
    ...(typeof f.whatsapp === "string" && WHATSAPP_NUMBER.test(f.whatsapp) ? { whatsapp: f.whatsapp } : {}),
  };
}

/** The panel writes the shop's choice (checked by the panel's form first). */
export function writePageSettings(dir: string, shop: string, s: PageSettings): void {
  writeAtomic(pageSettingsFile(dir, shop), `${stableJson({ schema: 1, pages: s.pages, ...(s.slug ? { slug: s.slug } : {}), ...(s.whatsapp ? { whatsapp: s.whatsapp } : {}) })}\n`);
}

/** The panel's "sign out every device": every owner session made before now ends (the runtime refuses it from its next request, and records it once). */
export function endOwnerSessions(dir: string, shop: string, now: Date): void {
  writeAtomic(join(serverPaths(dir).shop(shop), OWNER_SESSIONS_FILE), `${stableJson({ schema: 1, endBefore: now.toISOString() })}\n`);
}

// ---- item 11h: the owner's passkeys, the panel's side -------------------------------------------------------------------------------------------------------

export const ownerGrantsFile = (dir: string, shop: string): string => join(serverPaths(dir).shop(shop), OWNER_GRANTS_FILE);
const readGrants = (dir: string, shop: string): OwnerGrants => readOwnerGrants(read(ownerGrantsFile(dir, shop))) ?? { schema: 1 };
const writeGrants = (dir: string, shop: string, g: OwnerGrants): void => writeAtomic(ownerGrantsFile(dir, shop), `${stableJson(g)}\n`);

/** A new setup QR for the shop (one use, SETUP_MS, this shop only): the token to show ONCE; only its hash is written. Any earlier QR stops working. */
export function makeOwnerSetup(dir: string, shop: string, now: Date): { token: string; expiresAt: Date } {
  const token = newSetupToken();
  const expiresAt = new Date(now.getTime() + SETUP_MS);
  writeGrants(dir, shop, { ...readGrants(dir, shop), setup: { sha256: setupHash(token), createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() } });
  return { token, expiresAt };
}

/** A new recovery card: RECOVERY_CODES codes to print ONCE; only their hashes are written. Every code of an earlier card stops working. */
export function makeOwnerRecovery(dir: string, shop: string, now: Date): string[] {
  const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
  writeGrants(dir, shop, { ...readGrants(dir, shop), recovery: { codes: codes.map(recoveryHash), createdAt: now.toISOString() } });
  return codes;
}

/** "Remove the owner's passkeys" (a lost phone): every passkey made before now stops working, and the setup QR and recovery card are cleared too. */
export function removeOwnerPasskeys(dir: string, shop: string, now: Date): void {
  writeGrants(dir, shop, { schema: 1, passkeysBefore: now.toISOString() });
}

/** When the current card and the last QR were made, and passkeys last removed, for the panel's block. Never a hash. */
export function ownerGrantsSummary(dir: string, shop: string): { setupAt?: string; recoveryAt?: string; removedAt?: string } {
  const g = readGrants(dir, shop);
  return { ...(g.setup ? { setupAt: g.setup.createdAt } : {}), ...(g.recovery ? { recoveryAt: g.recovery.createdAt } : {}), ...(g.passkeysBefore ? { removedAt: g.passkeysBefore } : {}) };
}

export function readPagesStatus(dir: string, shop: string): PageStatus | undefined {
  try { const s = JSON.parse(read(pagesStatusFile(dir, shop)) ?? "") as PageStatus; return s.schema === 1 ? s : undefined; } catch { return undefined; }
}

/** The slug fleet confirmed for the shop's current choice, or undefined. */
const claimedOf = (settings: PageSettings, status: PageStatus | undefined): PageStatus | undefined =>
  settings.pages === "hub" && status?.slug !== undefined && status.slug === settings.slug && status.url !== undefined ? status : undefined;

/**
 * Where the owner's view is: on the pages domain only for a shop this server's door serves (its `pagesDomain`), else at this server's own address. One rule for
 * the deployer (pagesFileFor) and the panel (item 11h: the setup QR and the recovery card must name the same address the runtime checks passkeys against).
 */
export function ownerBaseOf(o: { publicUrl: string; pagesDomain?: string; shop: string; settings: PageSettings; status: PageStatus | undefined }): string {
  const claimed = claimedOf(o.settings, o.status);
  let served = false;
  try { served = claimed !== undefined && o.pagesDomain !== undefined && new URL(claimed.url!).hostname === o.pagesDomain; } catch { served = false; }
  return `${served ? claimed!.url : `${o.publicUrl}/s/${o.shop}`}/owner`;
}

/** The addresses a shop's runtime and front are handed (pages-file.ts). The owner's view is on the pages domain only for a shop this server's door serves. */
export function pagesFileFor(server: ServerConfig, shop: string, settings: PageSettings, status: PageStatus | undefined): PagesFile {
  const base = `${publicUrl(server)}/s/${shop}`;
  const claimed = claimedOf(settings, status);
  return {
    schema: 1, base, ownerBase: ownerBaseOf({ publicUrl: publicUrl(server), ...(server.pages ? { pagesDomain: server.pages.domain } : {}), shop, settings, status }),
    ...(claimed ? { slug: claimed.slug!, url: claimed.url!, ...(claimed.pageUrl ? { pageUrl: claimed.pageUrl } : {}) } : {}),
    ...(settings.whatsapp ? { whatsapp: settings.whatsapp } : {}),
    ...(server.panel.enabled ? { panelUrl: `${publicUrl(server)}/shops/${shop}` } : {}),
  };
}

type Fetch = typeof fetch;

/** One call to fleet with the deployment key. Never throws: a failure is an answer with no `ok`. */
async function callFleet(server: ServerConfig, dir: string, path: string, body: unknown, fetchImpl: Fetch): Promise<{ status: number; answer: Record<string, unknown> }> {
  const key = readSecretFile(resolve(dir, server.fleet!.keyFile));
  if (!key) return { status: 0, answer: { error: `there is no deployment key at ${server.fleet!.keyFile}`, code: "no_key" } };
  try {
    const r = await fetchImpl(`${server.fleet!.url.replace(/\/+$/u, "")}${path}`, {
      method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    const answer = await r.json().catch(() => ({})) as Record<string, unknown>;
    return { status: r.status, answer: isObj(answer) ? answer : {} };
  } catch (e) { return { status: 0, answer: { error: (e as Error).message.slice(0, 160), code: "unreachable" } }; }
}

/** Write a file only when its content changed; remove it when `text` is undefined. Only into a folder that exists (a shop not deployed yet has none). */
function keep(path: string, text: string | undefined): boolean {
  const have = read(path);
  if (text === undefined) { if (have === undefined) return false; rmSync(path, { force: true }); return true; }
  if (!existsSync(dirname(path)) || have === text) return false;
  writeAtomic(path, text, 0o644); // no secret in it, readable by the container's own user like the files beside it
  return true;
}

/**
 * One pass: for each deployed shop, claim or release its slug at fleet when its choice changed (or once a day), write the result for the panel, and hand the
 * shop's runtime and front their pages.json (and the runtime the panel's sign-out-every-device file). A shop no longer deployed gives its slug back. Returns
 * a line for each change, for the deployer's log.
 */
export async function syncPages(o: { dir: string; server: ServerConfig; shops: readonly string[]; now: Date; fetchImpl?: Fetch }): Promise<string[]> {
  const { dir, server } = o;
  const lines: string[] = [];
  const fetchImpl = o.fetchImpl ?? fetch;
  const hosted = server.panel.mode === "hosted";
  const t = o.now.getTime();
  const at = o.now.toISOString();
  const writeStatus = (shop: string, s: PageStatus) => writeAtomic(pagesStatusFile(dir, shop), `${stableJson(s)}\n`);

  for (const shop of o.shops) {
    const settings = readPageSettings(dir, shop, hosted);
    let status = readPagesStatus(dir, shop);
    if (settings.pages === "hub" && settings.slug) {
      const wanted = settings.slug;
      const confirmed = status?.slug === wanted && status.url !== undefined;
      // on the server that answers for the pages domain, an address on another domain (the domain was just changed) is asked again at once, not in a day:
      // until then forms would post to the old domain and lose their POST on its redirect
      let otherDomain = false;
      try { otherDomain = confirmed && server.pages !== undefined && new URL(status!.url!).hostname !== server.pages.domain; } catch { otherDomain = true; }
      const due = !confirmed || otherDomain || t - Date.parse(status!.at) >= DAY_MS;
      // a claim that was refused, or that found fleet unreachable, waits CLAIM_RETRY_MS before the same name is asked again
      const waiting = status?.tried?.slug === wanted && t - Date.parse(status.tried.at) < CLAIM_RETRY_MS;
      if (!server.fleet) {
        if (status?.problem?.code !== "no_fleet") { status = { schema: 1, at, problem: { code: "no_fleet", message: "This server is not paired with fleet, so a page name cannot be claimed." } }; writeStatus(shop, status); }
      } else if (due && !waiting) {
        const r = await callFleet(server, dir, SLUGS_PATH, { agent_id: shop, slug: wanted }, fetchImpl);
        const a = r.answer;
        if (r.status === 200 && a.ok === true && typeof a.url === "string" && /^https:\/\//u.test(a.url)) {
          status = { schema: 1, at, slug: wanted, url: a.url, ...(typeof a.page_id === "string" ? { pageId: a.page_id } : {}), ...(typeof a.page_url === "string" && /^https:\/\//u.test(a.page_url) ? { pageUrl: a.page_url } : {}) };
          // fleet still answers another domain than this server's (its config and geometer.json disagree): kept, and not asked again for ten minutes
          if (server.pages && new URL(a.url).hostname !== server.pages.domain) { status.tried = { slug: wanted, at }; lines.push(`${shop}: fleet gives its page on ${new URL(a.url).hostname}, but geometer.json's pages domain is ${server.pages.domain}. Make the two the same.`); }
          if (!confirmed) lines.push(`${shop}: its page is ${a.url}${status.pageUrl ? ` (stable address ${status.pageUrl})` : ""}.`);
        } else if (r.status === 0 && confirmed) {
          status = { ...status!, tried: { slug: wanted, at } }; // fleet unreachable: the confirmed name stands, and fleet is asked again in ten minutes
        } else {
          const code = typeof a.code === "string" ? a.code : r.status === 0 ? "unreachable" : `http_${r.status}`;
          status = { schema: 1, at, problem: { code, message: typeof a.error === "string" ? a.error.slice(0, 300) : "Fleet did not take the page name." }, tried: { slug: wanted, at } };
          lines.push(`${shop}: the page name ${wanted} was not taken (${code}).`);
        }
        writeStatus(shop, status);
      }
    } else if (status?.slug && server.fleet) {
      // "own", or no name: the slug goes back to fleet (it cools before anyone else may take it)
      const r = await callFleet(server, dir, `${SLUGS_PATH}/release`, { agent_id: shop, reason: "removed" }, fetchImpl);
      if (r.status === 200) { lines.push(`${shop}: its page name ${status.slug} is given back.`); status = { schema: 1, at }; writeStatus(shop, status); }
    }
    // the addresses, for the runtime (its owner's sign-in links) and the front (the door's slug, the QR's stable address)
    const text = `${stableJson(pagesFileFor(server, shop, settings, status))}\n`;
    if (readPagesFile(text) === undefined) { lines.push(`${shop}: its pages file would not read back; not written.`); continue; }
    for (const copy of pagesCopies(dir, shop)) if (keep(copy, text)) lines.push(`${shop}: its page addresses are handed to ${copy.includes(join("secrets", "inbox")) ? "the front" : "the runtime"}.`);
    // the panel's "sign out every device", to the runtime, which reads it on every request
    const endAll = read(join(serverPaths(dir).shop(shop), OWNER_SESSIONS_FILE));
    keep(join(serverPaths(dir).generated, "shops", shop, "client", OWNER_SESSIONS_FILE), endAll);
    // item 11h: the partner's setup QR, recovery card and "remove the owner's passkeys" (hashes only), to the runtime, which reads it on every request
    if (keep(join(serverPaths(dir).generated, "shops", shop, "client", OWNER_GRANTS_FILE), read(ownerGrantsFile(dir, shop)))) lines.push(`${shop}: the owner's sign-in codes are handed to the runtime.`);
  }

  // a shop that is no longer deployed here gives its name back (it cools at fleet; a mistaken removal undone within 90 days keeps it and its page id)
  const statusDir = join(serverPaths(dir).status, "pages");
  const listed = existsSync(statusDir) ? readdirSync(statusDir).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)) : [];
  for (const shop of listed.filter((s) => !o.shops.includes(s) && !existsSync(serverPaths(dir).shop(s)))) {
    const status = readPagesStatus(dir, shop);
    if (status?.slug && server.fleet) {
      const r = await callFleet(server, dir, `${SLUGS_PATH}/release`, { agent_id: shop, reason: "removed" }, fetchImpl);
      if (r.status !== 200) continue; // asked again next pass
      lines.push(`${shop}: removed from this server, so its page name ${status.slug} is given back.`);
    }
    rmSync(pagesStatusFile(dir, shop), { force: true });
  }
  return lines;
}
