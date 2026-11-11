// The licence lease on this server (plan B13; the contract is the monorepo's apps/fleet/README.md, "What the bundle does with the lease"). The deployer's side:
//
//   <fleet>/lease                    the last lease token fleet sent back to a heartbeat, written as it came by ops (the one folder ops can write). Never trusted as it is.
//   state/licence/lease              the newest GOOD lease: checked with the key pinned in geometer.json (`licence.keys`), for this server's own id, and newer than
//                                    the one kept (a higher serial and an issue time no earlier). One line, written atomically.
//   state/licence/seen.json          { newest_issued_at, kept: {serial, issued_at}, inbox }: the highest `issued_at` of any lease or extension ever taken (a clock set back
//                                    never stretches a lease past it), the kept lease's place in the order (so a deleted or broken lease file cannot let an older
//                                    lease back in), and which inbox token was last looked at.
//   state/licence/extensions/*.gx1   emergency extensions handed in with `geometer licence extension <file>`, each checked like a lease.
//   generated/shops/<shop>/client/licence.json   what the shop's runtime is handed: its entry in the kept lease (or none), newest_issued_at, the extensions' latest
//                                    `until`, and the partner's name. The runtime works the state out itself with its own clock (modules/licence/rules.ts, licenceNow).
//   status/<shop>.json `licence`     the same state, for the panel and `geometer status`.
//
// A key that comes inside a token is never trusted: the kid only picks among the pinned keys. A refused lease, a missing one or a quiet fleet changes nothing: the kept
// lease stays in force until it expires, and then the shop winds down at most (never the final stop).
//
// Decision 39 (monorepo ADR-0070): `init` requires the key and the deploy refuses a server without one, and a release's Guard holds a shop to the lease. A shop the
// kept lease does not list, or a server with no lease kept yet, has NO LICENCE at its Guards: only refunds, cancellations, reads and a send to the owner go through.
// Its runtime is handed `shop: null` (it does not restrict itself; Guard's 402 is its pause), and its status says `listed: false`, which the panel shows as no licence.
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkToken, CHECK_WORDS, keysFromHex } from "../../modules/licence/token.ts";
import { licenceNow, newerThan, serverNow } from "../../modules/licence/rules.ts";
import type { ExtensionPayload, LeasePayload, LeaseState, LicenceFile } from "../../modules/licence/rules.ts";
import { fleetIdOf, readShop, serverPaths } from "./server.ts";
import type { ServerConfig } from "./server.ts";
import { readStatus, updateStatus } from "./status.ts";
import { sha256Hex, stableJson, writeAtomic } from "./util.ts";

// Where the licence files live on the server, in one place for the deployer and the status writer; `inbox` is the one folder ops may write, so nothing in it is trusted until checked.
export const licencePaths = (dir: string) => {
  const root = join(serverPaths(dir).state, "licence");
  return { root, lease: join(root, "lease"), seen: join(root, "seen.json"), extensions: join(root, "extensions"), inbox: join(serverPaths(dir).fleet, "lease") };
};
// The licence.json copy placed in a shop's generated client folder, so the shop's own agent can read its licence state without reaching the server's state folder.
export const clientLicenceFile = (dir: string, shop: string): string => join(serverPaths(dir).generated, "shops", shop, "client", "licence.json");

interface Mark { serial: number; issued_at: number }
export interface Seen { schema: 1; newest_issued_at: number; kept: Mark | null; inbox: string | null }

const whole = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

// Reads the remembered newest issue time; a missing or damaged file falls back to zeros, which can only make the server stricter about old leases, never accept one it should not.
export function readSeen(dir: string): Seen {
  try {
    const r = JSON.parse(readFileSync(licencePaths(dir).seen, "utf8")) as Record<string, any>;
    const kept = r.kept && whole(r.kept.serial) && whole(r.kept.issued_at) ? { serial: r.kept.serial, issued_at: r.kept.issued_at } : null;
    return { schema: 1, newest_issued_at: whole(r.newest_issued_at) ? r.newest_issued_at : 0, kept, inbox: typeof r.inbox === "string" ? r.inbox : null };
  } catch { return { schema: 1, newest_issued_at: 0, kept: null, inbox: null }; }
}
const writeSeen = (dir: string, seen: Seen): void => writeAtomic(licencePaths(dir).seen, stableJson(seen));

const pinned = (server: Pick<ServerConfig, "licence">): Buffer[] => keysFromHex(server.licence?.keys ?? []);
const NO_KEY = "no licence key is pinned in geometer.json (licence.keys), so no lease is kept and no shop is restricted by one";

/** The kept lease, checked again with the pinned keys (a file someone changed by hand is not a lease). Undefined when there is none, or it does not check. */
export function keptLease(dir: string, server: Pick<ServerConfig, "licence" | "id" | "fleet">): LeasePayload | undefined {
  const keys = pinned(server);
  if (keys.length === 0 || !existsSync(licencePaths(dir).lease)) return undefined;
  const c = checkToken<LeasePayload>(readFileSync(licencePaths(dir).lease, "utf8").trim(), "lease", keys);
  return c.ok && c.payload.deployment === fleetIdOf(server) ? c.payload : undefined; // fleet's id for this server (a late pairing keeps its own `id`)
}

export type Take<T> = { taken: true; payload: T } | { taken: false; why: string; same?: boolean };

/** Keep a lease if it is good, for this server, and newer than the one kept. Anything else is never written. */
export function takeLease(dir: string, server: Pick<ServerConfig, "licence" | "id" | "fleet">, token: string): Take<LeasePayload> {
  const keys = pinned(server);
  if (keys.length === 0) return { taken: false, why: NO_KEY };
  const text = token.trim();
  const c = checkToken<LeasePayload>(text, "lease", keys);
  if (!c.ok) return { taken: false, why: CHECK_WORDS[c.code] };
  if (c.payload.deployment !== fleetIdOf(server)) return { taken: false, why: `it is a lease for another server, not this one (${fleetIdOf(server)})` };
  const seen = readSeen(dir);
  const file = keptLease(dir, server);
  const kept: Mark | null = seen.kept ?? (file ? { serial: file.serial, issued_at: file.issued_at } : null);
  const same = kept !== null && c.payload.serial === kept.serial && c.payload.issued_at === kept.issued_at;
  // The lease file went missing or broken after this very lease was taken: the same lease again puts it back. Nothing older ever does.
  const restoring = same && (!file || file.serial !== kept.serial);
  if (!restoring && !newerThan(c.payload, kept)) return { taken: false, same, why: same ? "it is the lease already kept" : "it is older than the lease already kept (an old lease played back)" };
  // seen first: a stop between the two writes leaves the lease file older than `kept`, which the same lease again puts right (above), and lets nothing older in
  writeSeen(dir, { ...seen, newest_issued_at: Math.max(seen.newest_issued_at, c.payload.issued_at), kept: { serial: c.payload.serial, issued_at: c.payload.issued_at } });
  writeAtomic(licencePaths(dir).lease, `${text}\n`);
  return { taken: true, payload: c.payload };
}

/** The good extensions that cover this server, from state/licence/extensions/. */
export function keptExtensions(dir: string, server: Pick<ServerConfig, "licence" | "id" | "fleet">): ExtensionPayload[] {
  const keys = pinned(server);
  const folder = licencePaths(dir).extensions;
  if (keys.length === 0 || !existsSync(folder)) return [];
  const out: ExtensionPayload[] = [];
  for (const name of readdirSync(folder).filter((n) => n.endsWith(".gx1")).sort()) {
    const c = checkToken<ExtensionPayload>(readFileSync(join(folder, name), "utf8").trim(), "extension", keys);
    if (c.ok && (c.payload.deployments.includes("*") || c.payload.deployments.includes(fleetIdOf(server)))) out.push(c.payload);
  }
  return out;
}

/**
 * Keep an emergency extension (`geometer licence extension <file>`): checked like a lease, `kind` "extension", naming this server or `*`, and not already over. It only
 * pushes out when a lease's cover ends: it never lifts a wind-down or a stop a lease states.
 */
export function takeExtension(dir: string, server: Pick<ServerConfig, "licence" | "id" | "fleet">, token: string, clockS: number): Take<ExtensionPayload> {
  const keys = pinned(server);
  if (keys.length === 0) return { taken: false, why: NO_KEY };
  const text = token.trim();
  const c = checkToken<ExtensionPayload>(text, "extension", keys);
  if (!c.ok) return { taken: false, why: CHECK_WORDS[c.code] };
  if (!c.payload.deployments.includes("*") && !c.payload.deployments.includes(fleetIdOf(server))) return { taken: false, why: `it does not name this server (${fleetIdOf(server)})` };
  const seen = readSeen(dir);
  if (c.payload.until <= serverNow(clockS, seen.newest_issued_at)) return { taken: false, why: `it ended on ${new Date(c.payload.until * 1000).toISOString().slice(0, 10)}, so it would change nothing` };
  const file = join(licencePaths(dir).extensions, `${sha256Hex(text).slice(0, 16)}.gx1`);
  if (existsSync(file)) return { taken: false, same: true, why: "it is already kept" };
  mkdirSync(dirname(file), { recursive: true });
  writeSeen(dir, { ...seen, newest_issued_at: Math.max(seen.newest_issued_at, c.payload.issued_at) });
  writeAtomic(file, `${text}\n`);
  return { taken: true, payload: c.payload };
}

/** Everything the server holds about its licence, checked again: the kept lease, the newest issue time taken, and the latest `until` of the extensions that cover it. */
export interface KeptLicence { lease?: LeasePayload; newestIssuedAt: number; extensionUntil: number; pinned: boolean }

// Re-checks everything held (lease and extensions) against the pinned keys each time, so a file edited by hand after being stored stops counting.
export function keptLicence(dir: string, server: Pick<ServerConfig, "licence" | "id" | "fleet">): KeptLicence {
  const lease = keptLease(dir, server);
  const extensions = keptExtensions(dir, server);
  const seen = readSeen(dir);
  const newest = Math.max(seen.newest_issued_at, lease?.issued_at ?? 0, ...extensions.map((e) => e.issued_at));
  return { ...(lease ? { lease } : {}), newestIssuedAt: newest, extensionUntil: Math.max(0, ...extensions.map((e) => e.until)), pinned: pinned(server).length > 0 };
}

/**
 * What one shop's runtime is handed. A shop the kept lease does not list, or no lease at all, gets `shop: null`: the runtime does not restrict itself, and Guard (which
 * has no licence for the shop, ADR-0070) refuses its new work with the 402 the runtime takes as its pause.
 */
export const licenceFileFor = (kept: KeptLicence, shop: string, partner: string): LicenceFile => ({
  schema: 1, shop: kept.lease?.shops.find((s) => s.id === shop) ?? null, newest_issued_at: kept.newestIssuedAt, extension_until: kept.extensionUntil, partner,
});

/** The licence block of status/<shop>.json (the panel reads it with its own checker). Times are ISO; `leaseIssuedAt` says how fresh the kept lease is. */
export interface StatusLicence {
  state: LeaseState;
  /**
   * False for a shop the lease does not list, and when no lease is kept: the shop has no licence, so a release's Guard takes no new work for it (ADR-0070). It comes
   * with the answer to the heartbeat that first reports the shop, when the account's trial or a plan covers it.
   */
  listed: boolean;
  paidThrough: string | null;
  windDownOn: string | null;
  stopOn: string | null;
  exportUntil: string | null;
  leaseIssuedAt: string | null;
  /** The kept extensions push the wind-down out to here. */
  extendedUntil: string | null;
}

const iso = (s: number | null | undefined): string | null => (typeof s === "number" && s > 0 ? new Date(s * 1000).toISOString() : null);

// Turns the checked licence into the small block written to the status file and shown by the panel, with dates as ISO strings and the wind-down extended by any kept extension.
export function statusLicence(kept: KeptLicence, file: LicenceFile, nowMs: number): StatusLicence {
  const now = licenceNow(file, nowMs);
  const s = file.shop;
  return {
    state: now.state, listed: s !== null, paidThrough: iso(s?.paid_through), windDownOn: iso(s ? Math.max(s.expires, kept.extensionUntil) : null), stopOn: iso(s?.stop_at),
    exportUntil: iso(s?.export_until), leaseIssuedAt: iso(kept.lease?.issued_at), extendedUntil: iso(kept.extensionUntil || null),
  };
}

const sameLicence = (a: StatusLicence | undefined, b: StatusLicence): boolean => !!a && (Object.keys(b) as (keyof StatusLicence)[]).every((k) => a[k] === b[k]);

/**
 * One pass of the licence (the deployer runs it on every loop, and every deploy runs it once): take the lease ops kept from fleet's last answer, if it is one not
 * looked at yet; then hand each deployed shop its entry (client/licence.json, which its runtime reads by its modified time, so no restart) and write the state the panel
 * shows (status/<shop>.json `licence`). A shop is handed a file only once a key is pinned (or it already has one, which is then cleared). Returns lines for the log.
 */
export function syncLicence(dir: string, server: ServerConfig, shops: readonly string[], now: Date): string[] {
  const lines: string[] = [];
  const p = licencePaths(dir);
  let token = "";
  try { token = readFileSync(p.inbox, "utf8").trim(); } catch { /* fleet has sent no lease (an older fleet, or its licence is off) */ }
  const mark = token ? sha256Hex(token) : null;
  if (mark && readSeen(dir).inbox !== mark) {
    const r = takeLease(dir, server, token);
    writeSeen(dir, { ...readSeen(dir), inbox: mark });
    if (r.taken) lines.push(`licence: fleet's lease ${r.payload.serial} (signed ${new Date(r.payload.issued_at * 1000).toISOString()}) is kept.`);
    else if (!r.same) lines.push(`licence: fleet's last lease was not kept: ${r.why}. The lease kept before it stays in force until it runs out.`);
  }
  const kept = keptLicence(dir, server);
  for (const shop of shops) {
    const file = clientLicenceFile(dir, shop);
    if (!existsSync(dirname(file)) || (!kept.pinned && !existsSync(file))) continue; // not deployed yet (the deploy writes it), or nothing to say
    const content = licenceFileFor(kept, shop, readShop(dir, shop).preparedBy);
    const text = stableJson(content);
    let before = "";
    try { before = readFileSync(file, "utf8"); } catch { /* the first one */ }
    if (before !== text) writeAtomic(file, text);
    const next = statusLicence(kept, content, now.getTime());
    const was = readStatus(dir, shop)?.licence;
    if (!sameLicence(was, next)) {
      updateStatus(dir, shop, now, (s) => { s.licence = { ...next, at: now.toISOString() }; }, false);
      if (was && was.state !== next.state) lines.push(`${shop}: licence ${was.state.replace("_", " ")} -> ${next.state.replace("_", " ")}${next.state === "wind_down" ? ": no new bookings or links; refunds, cancellations and existing bookings go on" : next.state === "stopped" ? ": the final stop; nothing is deleted, and the export stays free" : ""}.`);
    }
  }
  return lines;
}
