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
//   <server>/shops/<shop>/report.json          optional, by hand         who the owner's monthly report says set the shop up (`shop add --prepared-by`); wins over owner.json. See ReportFile.
//   <server>/secrets-inbox/<shop>/<name>       written by the panel      razorpay_key ("<key id>:<key secret>"), whatsapp_token, whatsapp_app_secret,
//                                                                        razorpay_webhook_secret, google_service_account.json. Write-only: never read back.
//   <server>/status/<shop>.json                written by the deployer   see ShopStatus. A missing or unreadable file is "not confirmed yet", never "live".
//   <server>/fleet/<shop>.json                 written by ops (read-only here)   fleet's last answer about the shop: its plan, the included messages, the Innovator badge,
//                                                                        button mode and warnings. See FleetAnswer. A missing or unreadable file is "fleet has said nothing", never "no plan".
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
    fleetFile: (shop: string) => join(root, "fleet", `${shop}.json`),
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
  /** The cost meter's cumulative counts over the shop's record, as of the last export (bundle/lib/usage.ts). Counts only. */
  usage?: { at?: string; messages: number; byStep: { rules: number; decision: number; model: number }; modelMicroInr: number; whatsapp: { service: number; utility: number; marketing: number; estMicroInr: number; estimated: boolean } };
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
  const u = raw.usage;
  if (isObj(u) && isObj(u.byStep) && isObj(u.whatsapp)) {
    const n = [u.messages, u.byStep.rules, u.byStep.decision, u.byStep.model, u.modelMicroInr, u.whatsapp.service, u.whatsapp.utility, u.whatsapp.marketing, u.whatsapp.estMicroInr].map(whole);
    if (!n.includes(undefined)) {
      status.usage = {
        ...(isoDay(u.at) ? { at: isoDay(u.at) as string } : {}),
        messages: n[0] as number, byStep: { rules: n[1] as number, decision: n[2] as number, model: n[3] as number }, modelMicroInr: n[4] as number,
        whatsapp: { service: n[5] as number, utility: n[6] as number, marketing: n[7] as number, estMicroInr: n[8] as number, estimated: u.whatsapp.estimated === true },
      };
    }
  }
  return { ok: true, status };
}

// ---- fleet's answer ------------------------------------------------------------------------------------------------------------------------------------------------

export const PLAN_NAMES = ["basic", "business", "operations"] as const;
export type PlanName = (typeof PLAN_NAMES)[number];

/** fleet/<shop>.json, as the panel reads it (the bundle's lib/fleet.ts writes it). Read field by field: a wrong field is dropped, never guessed. */
export interface FleetAnswer { at: string; plan: PlanName | null; allowance: number | null; innovator: boolean; ai: "normal" | "buttons"; reason?: string; warn: string[] }

export function parseFleetAnswer(textOrNothing: string | undefined): FleetAnswer | undefined {
  if (textOrNothing === undefined) return undefined;
  try {
    const r: unknown = JSON.parse(textOrNothing);
    if (!isObj(r) || r.schema !== 1 || !isoDay(r.at) || (r.ai !== "normal" && r.ai !== "buttons")) return undefined;
    const code = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9_]{1,40}$/u.test(v);
    return {
      at: r.at as string,
      plan: (PLAN_NAMES as readonly unknown[]).includes(r.plan) ? (r.plan as PlanName) : null,
      allowance: whole(r.allowance) ?? null,
      innovator: r.innovator === true,
      ai: r.ai,
      ...(r.ai === "buttons" && code(r.reason) ? { reason: r.reason } : {}),
      warn: Array.isArray(r.warn) ? r.warn.filter(code).slice(0, 8) : [],
    };
  } catch { return undefined; }
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

/** The longest name the runtime accepts for who set the agent up (validName in the pathway's server/config.ts); the owner reads it in the monthly message. */
export const PREPARED_BY_LIMIT = 120;
const oneLine = (v: string): string => v.replace(/\s+/gu, " ").trim();

/** "Divya, local partner" or "Divya, builder": the one way the owner is told who set the shop up, cut to what the runtime accepts, on one line. */
export function preparedByOf(owner: Pick<OwnerFile, "accountName" | "role">): string {
  const role = owner.role === "partner" ? "local partner" : "builder";
  let name = oneLine(owner.accountName);
  while (name !== "" && `${name}, ${role}`.length > PREPARED_BY_LIMIT) name = [...name].slice(0, -1).join("").trim();
  return name === "" ? role : `${name}, ${role}`;
}

/**
 * shops/<shop>/report.json: what a shop's monthly report says that only a person can say. Today that is who set the shop up, for a shop that has no owner.json (one made with
 * `geometer shop add`), or one whose builder wants another name on it. Optional. It wins over owner.json. The deployer reads it; nothing in the panel writes it.
 */
export interface ReportFile { schema: 1; preparedBy: string }

export function parseReportFile(textOrNothing: string | undefined): ReportFile | undefined {
  if (textOrNothing === undefined) return undefined;
  try {
    const r: unknown = JSON.parse(textOrNothing);
    if (isObj(r) && r.schema === 1 && typeof r.preparedBy === "string" && r.preparedBy === oneLine(r.preparedBy) && text(r.preparedBy, PREPARED_BY_LIMIT)) return { schema: 1, preparedBy: r.preparedBy };
  } catch { /* unreadable: the caller says so */ }
  return undefined;
}

/** Who set the shop up, for the monthly report: report.json first, then the shop's attribution. Undefined when neither says. */
export function resolvePreparedBy(files: { report?: ReportFile; owner?: OwnerFile }): { name: string; source: "report.json" | "owner.json" } | undefined {
  if (files.report) return { name: files.report.preparedBy, source: "report.json" };
  if (files.owner) return { name: preparedByOf(files.owner), source: "owner.json" };
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
