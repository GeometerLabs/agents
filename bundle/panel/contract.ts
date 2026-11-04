// Every file shape the panel shares with the deploy bundle's host-side deployer, in one place, with a checker for each. The panel never has the
// Docker socket: it writes DESIRED STATE and requests as files, and reads RESULTS the deployer writes. Where the bundle's own code already fixes a
// shape (shops/<shop>/{settings.json, runtime.json, pathway.lock}, secrets-inbox/<shop>/<name>, status/<shop>.json), this follows it; the rest
// (the stop request, owner.json, pins.json, exports/) are PROPOSALS the bundle agent is asked to adopt, and each is marked so below.
//
//   <server>/shops/<shop>/settings.json        written by the panel      settings, checked by validateSettings
//   <server>/shops/<shop>/runtime.json         written by the panel      who things are: calendarId, phoneNumberId (the deployer owns where things are)
//   <server>/shops/<shop>/pathway.lock         written by the panel      bookings@<version>
//   <server>/shops/<shop>/owner.json           PROPOSAL, panel, once     who set the shop up (permanent attribution), written with flag wx
//   <server>/shops/<shop>/pins.json            PROPOSAL, panel           the ids the connection checks confirmed (none of them secret)
//   <server>/secrets-inbox/<shop>/<name>       written by the panel      razorpay_key ("<key id>:<key secret>"), whatsapp_token, whatsapp_app_secret,
//                                                                        razorpay_webhook_secret, google_service_account.json. Write-only: never read back.
//   <server>/status/<shop>.json                written by the deployer   see ShopStatus. A missing or unreadable file is "not confirmed yet", never "live".
//   <server>/requests/<shop>.stop.json         PROPOSAL, panel           a request to stop; the deployer acts, then shows `stopped` in status/<shop>.json
//   <server>/exports/<shop>/{record,bookings}.json   PROPOSAL, deployer  what scripts/client-report.ts reads, for the monthly report
//   <server>/panel/                            the panel's own data (accounts, invites, drafts, receipts, audit trail, documents)
import { join, resolve } from "node:path";

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function serverPaths(dir: string) {
  const root = resolve(dir);
  return {
    root,
    shops: join(root, "shops"),
    shop: (shop: string) => join(root, "shops", shop),
    secretsInbox: join(root, "secrets-inbox"),
    inbox: (shop: string) => join(root, "secrets-inbox", shop),
    statusFile: (shop: string) => join(root, "status", `${shop}.json`),
    stopFile: (shop: string) => join(root, "requests", `${shop}.stop.json`),
    exports: (shop: string) => join(root, "exports", shop),
    panel: join(root, "panel"),
    documents: (shop: string) => join(root, "panel", "documents", shop),
  };
}

/** Shop names go into container names, DNS names and URLs, and the id is also a path: so letters, digits and dashes only (the bundle's rule). */
export const SHOP_ID = /^[a-z0-9][a-z0-9-]{0,39}$/u;
export function shopIdProblem(id: string): string | undefined {
  if (!SHOP_ID.test(id)) return "use lowercase letters, digits and dashes, starting with a letter or digit, at most 40 characters";
  if (/\d(?:[ .\-()]?\d){6,}/u.test(id)) return "it has seven or more digits in a row, so it looks like a phone number (Geometer's heartbeat would refuse it)";
  return undefined;
}

/** A name for the shop folder, from the shop's name: "Glow Salon" -> "glow-salon". Never empty, never a phone number. */
export function shopIdFromName(name: string, taken: ReadonlySet<string>): string {
  let base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 32).replace(/-+$/u, "");
  if (base !== "" && shopIdProblem(base) !== undefined) base = base.replace(/\d+/gu, "").replace(/-+/gu, "-").replace(/^-+|-+$/gu, ""); // a long number in a name would look like a phone number
  if (base === "" || shopIdProblem(base) !== undefined) base = "shop";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

// ---- the accounts a template uses, and the secrets each one takes ----------------------------------------------------------------------

export type AccountKind = "whatsapp" | "razorpay" | "calendar";
export const SECRET_NAMES = ["razorpay_key", "whatsapp_token", "whatsapp_app_secret", "razorpay_webhook_secret", "google_service_account.json"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];
export const SECRETS_OF: Record<AccountKind, readonly SecretName[]> = {
  whatsapp: ["whatsapp_token", "whatsapp_app_secret"],
  razorpay: ["razorpay_key", "razorpay_webhook_secret"],
  calendar: ["google_service_account.json"],
};

// ---- the deployer's results ------------------------------------------------------------------------------------------------------------------

/** What the deployer writes to status/<shop>.json. Every field is optional on the way in: what cannot be read is left out and shows as "not confirmed". */
export interface ShopStatus {
  updatedAt?: string;
  deploy?: { state: "applied" | "failed" | "in-progress" | "never"; at?: string; message?: string };
  /** "N of M limits proven to bite on the running Guard" (the tripwires). `unprovable` names rules that cannot be self-tested. */
  limits?: { proven: number; of: number; unprovable: string[] };
  versions?: { pathway?: string; bundle?: string; guard?: string };
  stopped?: { at: string; requestId?: string };
  backups?: { lastCopyAt?: string | null; lastDrillAt?: string | null; drillOk?: boolean | null };
}

const isoDay = (v: unknown): string | undefined => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : undefined);
const whole = (v: unknown): number | undefined => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined);
const text = (v: unknown, max = 200): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);

export type StatusRead = { ok: true; status: ShopStatus } | { ok: false; reason: "missing" | "unreadable" };

/** Tolerant: a field of the wrong type is dropped, not guessed. An unreadable file is a reason, never a default. */
export function parseStatus(textOrNothing: string | undefined): StatusRead {
  if (textOrNothing === undefined) return { ok: false, reason: "missing" };
  let raw: unknown;
  try { raw = JSON.parse(textOrNothing); } catch { return { ok: false, reason: "unreadable" }; }
  if (!isObj(raw)) return { ok: false, reason: "unreadable" };
  const status: ShopStatus = {};
  const updatedAt = isoDay(raw.updatedAt);
  if (updatedAt) status.updatedAt = updatedAt;
  if (isObj(raw.deploy) && ["applied", "failed", "in-progress", "never"].includes(raw.deploy.state as string)) {
    status.deploy = { state: raw.deploy.state as "applied", ...(isoDay(raw.deploy.at) ? { at: isoDay(raw.deploy.at) as string } : {}), ...(text(raw.deploy.message, 500) ? { message: text(raw.deploy.message, 500) as string } : {}) };
  }
  if (isObj(raw.limits) && whole(raw.limits.proven) !== undefined && whole(raw.limits.of) !== undefined) {
    status.limits = { proven: raw.limits.proven as number, of: raw.limits.of as number, unprovable: Array.isArray(raw.limits.unprovable) ? raw.limits.unprovable.filter((x): x is string => typeof x === "string").slice(0, 50) : [] };
  }
  if (isObj(raw.versions)) status.versions = { ...(text(raw.versions.pathway, 50) ? { pathway: text(raw.versions.pathway, 50) as string } : {}), ...(text(raw.versions.bundle, 50) ? { bundle: text(raw.versions.bundle, 50) as string } : {}), ...(text(raw.versions.guard, 120) ? { guard: text(raw.versions.guard, 120) as string } : {}) };
  if (isObj(raw.stopped) && isoDay(raw.stopped.at)) status.stopped = { at: isoDay(raw.stopped.at) as string, ...(text(raw.stopped.requestId, 80) ? { requestId: text(raw.stopped.requestId, 80) as string } : {}) };
  if (isObj(raw.backups)) {
    const day = (v: unknown) => (v === null ? null : isoDay(v));
    status.backups = { ...(day(raw.backups.lastCopyAt) !== undefined ? { lastCopyAt: day(raw.backups.lastCopyAt) as string | null } : {}), ...(day(raw.backups.lastDrillAt) !== undefined ? { lastDrillAt: day(raw.backups.lastDrillAt) as string | null } : {}), ...(typeof raw.backups.drillOk === "boolean" || raw.backups.drillOk === null ? { drillOk: raw.backups.drillOk as boolean | null } : {}) };
  }
  return { ok: true, status };
}

export interface StopRequest { schema: 1; requestId: string; shop: string; requestedAt: string; requestedBy: { id: string; name: string; role: string } }

export function parseStopRequest(textOrNothing: string | undefined): StopRequest | undefined {
  if (textOrNothing === undefined) return undefined;
  try {
    const r: unknown = JSON.parse(textOrNothing);
    if (isObj(r) && r.schema === 1 && text(r.requestId, 80) && text(r.shop, 40) && isoDay(r.requestedAt) && isObj(r.requestedBy) && text(r.requestedBy.id, 80)) return r as unknown as StopRequest;
  } catch { /* an unreadable request is no request: the page does not claim a stop it cannot show */ }
  return undefined;
}

/** What the page says about a shop's life, as a code; views.ts turns it into the shop's language. */
export type LiveCode = "unknown" | "setting-up" | "live" | "attention" | "stopping" | "stopped";
export type Why = "no-status" | "status-unreadable" | "status-old" | "deploy-failed" | "limits-not-proven" | "runtime-unreachable" | "runtime-not-ready" | "refunds-need-builder";

export interface RuntimeProbe { reachable: boolean; ready?: boolean; refundsNeedBuilder?: number }

export interface LiveView { code: LiveCode; why: Why[] }

/**
 * "Stopped" is said only when the deployer's status shows it; a stop request alone is "stopping". "Live" is said only when the deployer's status is
 * fresh, the last deploy applied, every limit is proven, and (when it was asked) the runtime answered ready.
 */
export function liveView(read: StatusRead, stop: StopRequest | undefined, runtime: RuntimeProbe | undefined, nowMs: number, staleMs: number): LiveView {
  if (!read.ok) return { code: stop ? "stopping" : "unknown", why: [read.reason === "missing" ? "no-status" : "status-unreadable"] };
  const s = read.status;
  if (s.stopped) return { code: "stopped", why: [] };
  if (stop) return { code: "stopping", why: [] };
  const why: Why[] = [];
  if (!s.deploy || s.deploy.state === "never" || s.deploy.state === "in-progress") return { code: "setting-up", why: [] };
  if (s.deploy.state === "failed") why.push("deploy-failed");
  if (!s.limits || s.limits.of === 0 || s.limits.proven < s.limits.of) why.push("limits-not-proven");
  const updated = s.updatedAt ? Date.parse(s.updatedAt) : NaN;
  if (!Number.isFinite(updated) || nowMs - updated > staleMs) why.push("status-old");
  if (runtime) {
    if (!runtime.reachable) why.push("runtime-unreachable");
    else if (runtime.ready === false) why.push("runtime-not-ready");
    if ((runtime.refundsNeedBuilder ?? 0) > 0) why.push("refunds-need-builder");
  }
  return { code: why.length === 0 ? "live" : "attention", why };
}

// ---- attribution and pins ----------------------------------------------------------------------------------------------------------------------

/** shops/<shop>/owner.json: who set the shop up. Written once, with flag wx, and never changed: the permanent attribution. */
export interface OwnerFile { schema: 1; accountId: string; accountName: string; role: "builder" | "partner"; createdAt: string; template: string }

export function parseOwner(textOrNothing: string | undefined): OwnerFile | undefined {
  if (textOrNothing === undefined) return undefined;
  try {
    const r: unknown = JSON.parse(textOrNothing);
    if (isObj(r) && r.schema === 1 && text(r.accountId, 80) && text(r.accountName, 120) && (r.role === "builder" || r.role === "partner") && isoDay(r.createdAt)) return r as unknown as OwnerFile;
  } catch { /* no attribution is readable: only a builder sees the shop */ }
  return undefined;
}

/** shops/<shop>/pins.json: the ids the checks confirmed. None is a secret. */
export interface PinsFile {
  schema: 1;
  checkedAt: string;
  whatsapp?: { phoneNumberId: string; displayNumber: string };
  calendar?: { calendarId: string };
  razorpay?: { keyId: string; mode: "test" | "live" };
}
