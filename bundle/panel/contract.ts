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
//   <server>/secrets-inbox/<shop>/<name>       written by the panel      whatsapp_token, whatsapp_app_secret, google_service_account.json, and for a shop that
//                                                                        chose a gateway its key ("<key id>:<key secret>") and webhook secret, named by its folder. Write-only.
//   <server>/status/<shop>.json                written by the deployer   see ShopStatus. A missing or unreadable file is "not confirmed yet", never "live".
//   <server>/fleet/<shop>.json                 written by ops (read-only here)   fleet's last answer about the shop: its plan, the included messages, the Innovator badge,
//                                                                        button mode and warnings. See FleetAnswer. A missing or unreadable file is "fleet has said nothing", never "no plan".
//   <server>/requests/<shop>.stop.json         PROPOSAL, panel           a request to stop; the deployer acts, then shows `stopped` in status/<shop>.json
//   <server>/requests/<shop>.recover.<id>.json  panel                    a request that the shop's agent look again or ask again about one booking or fee (the to-do list); the deployer carries it to the runtime, then removes it
//   <server>/exports/<shop>/{record,bookings}.json   PROPOSAL, deployer  what scripts/client-report.ts reads, for the monthly report
//   <server>/panel/                            the panel's own data (accounts, invites, drafts, receipts, audit trail, documents)
import { GATEWAYS } from "../../modules/payments/providers/index.ts";
import { join, resolve } from "node:path";

// The shared "is a plain object" check every parser below starts with, so a file that is a string, array or null is rejected before any field is read.
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// Every folder and file the panel and the deployer agree on, derived from one root, so neither side builds a path by hand and the two cannot drift apart.
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
    recoverFile: (shop: string, id: string) => join(root, "requests", `${shop}.recover.${id}.json`),
    exports: (shop: string) => join(root, "exports", shop),
    panel: join(root, "panel"),
    documents: (shop: string) => join(root, "panel", "documents", shop),
  };
}

/** Shop names go into container names, DNS names and URLs, and the id is also a path: so letters, digits and dashes only (the bundle's rule). */
export const SHOP_ID = /^[a-z0-9][a-z0-9-]{0,39}$/u;
// Explains in words why a shop id is not allowed (undefined means fine); the second rule keeps ids from looking like phone numbers, which fleet's heartbeat refuses to carry.
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

/** "payment" is how customers pay (B71): UPI asks for no secret; a gateway asks for the ones its folder names (providers/<name>/index.ts, setup.secrets). */
export type AccountKind = "whatsapp" | "payment" | "calendar";
const GATEWAY_SECRETS: readonly string[] = GATEWAYS.flatMap((g) => [g.gateway!.setup.secrets.key, g.gateway!.setup.secrets.webhook]);
export const SECRET_NAMES: readonly string[] = ["whatsapp_token", "whatsapp_app_secret", "google_service_account.json", ...GATEWAY_SECRETS];
export type SecretName = string;
export const SECRETS_OF: Record<AccountKind, readonly SecretName[]> = {
  whatsapp: ["whatsapp_token", "whatsapp_app_secret"],
  payment: GATEWAY_SECRETS,
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
  usage?: { at?: string; messages: number; byStep: { rules: number; decision: number; model: number }; modelMicroInr: number; /** Calls with no price: their cost is unknown, so `modelMicroInr` is a floor when this is above 0. Absent in an older file. */ unpriced?: number; whatsapp: { service: number; utility: number; marketing: number; estMicroInr: number; estimated: boolean } };
  /** The shop's licence (B13), worked out on the server from the signed lease (bundle/lib/licence.ts): what the runtime acts on. Times are ISO. */
  licence?: { state: "active" | "reminder" | "warning" | "wind_down" | "stopped"; listed: boolean; paidThrough: string | null; windDownOn: string | null; stopOn: string | null; exportUntil: string | null; leaseIssuedAt: string | null; extendedUntil: string | null };
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
        ...(whole(u.unpriced) !== undefined ? { unpriced: u.unpriced as number } : {}),
        whatsapp: { service: n[5] as number, utility: n[6] as number, marketing: n[7] as number, estMicroInr: n[8] as number, estimated: u.whatsapp.estimated === true },
      };
    }
  }
  const l = raw.licence;
  if (isObj(l) && ["active", "reminder", "warning", "wind_down", "stopped"].includes(l.state as string)) {
    const t = (v: unknown): string | null => isoDay(v) ?? null;
    status.licence = { state: l.state as "active", listed: l.listed === true, paidThrough: t(l.paidThrough), windDownOn: t(l.windDownOn), stopOn: t(l.stopOn), exportUntil: t(l.exportUntil), leaseIssuedAt: t(l.leaseIssuedAt), extendedUntil: t(l.extendedUntil) };
  }
  return { ok: true, status };
}

// ---- fleet's answer ------------------------------------------------------------------------------------------------------------------------------------------------

export const PLAN_NAMES = ["basic", "business", "operations"] as const;
export type PlanName = (typeof PLAN_NAMES)[number];

/** fleet/<shop>.json, as the panel reads it (the bundle's lib/fleet.ts writes it). Read field by field: a wrong field is dropped, never guessed. */
export interface FleetAnswer {
  at: string; plan: PlanName | null; allowance: number | null; innovator: boolean; ai: "normal" | "buttons"; reason?: string; warn: string[];
  /**
   * Fleet's unsigned copy of the licence for the panel (B13): its days and the renew link, and for a shop the builder's trial covers, the day the trial ends
   * (decision 39). The state that restricts the shop is the signed one in the status file.
   */
  licence?: { state: string; paid_through: string | null; wind_down_on: string | null; stop_on: string | null; export_until: string | null; renew_url: string | null; trial_ends?: string };
}

// Reads fleet's last answer file; returns undefined for anything malformed, because a file the deployer half-wrote must show as "unknown", not crash the page.
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
      ...(isObj(r.licence) && typeof r.licence.state === "string" && /^[a-z_]{1,20}$/u.test(r.licence.state) ? { licence: fleetLicence(r.licence) } : {}),
    };
  } catch { return undefined; }
}

/** The unsigned licence entry, field by field: a day that is not a day is null, and a renew link that is not https is null (it becomes a link on the page). */
function fleetLicence(l: Record<string, unknown>): NonNullable<FleetAnswer["licence"]> {
  const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(v) ? v : null);
  const url = typeof l.renew_url === "string" && l.renew_url.length <= 300 && /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*)?$/u.test(l.renew_url) ? l.renew_url : null;
  const trial = day(l.trial_ends);
  return { state: l.state as string, paid_through: day(l.paid_through), wind_down_on: day(l.wind_down_on), stop_on: day(l.stop_on), export_until: day(l.export_until), renew_url: url, ...(trial ? { trial_ends: trial } : {}) };
}

export interface StopRequest { schema: 1; requestId: string; shop: string; requestedAt: string; requestedBy: { id: string; name: string; role: string } }

// Checks a stop request file; the deployer acts on it, so only a well-formed one is accepted.
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
export interface OwnerFile { schema: 1; accountId: string; accountName: string; company?: string; role: "builder" | "partner"; createdAt: string; template: string }

/** The longest company or business name an account may give; the owner reads it after the person's name, as in "Divya, Sri Sai Digital". */
export const COMPANY_LIMIT = 60;
/** A company name as it is kept: one line, single spaces, 1 to COMPANY_LIMIT characters; undefined when empty or not usable. */
export function companyOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const c = v.replace(/\s+/gu, " ").trim();
  return c !== "" && [...c].length <= COMPANY_LIMIT ? c : undefined;
}

// Checks the shop's owner.json (who the shop's owner is and how to reach them); malformed means "no owner on record", never a guessed one.
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

const graphemes = (v: string): string[] => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(v)].map((g) => g.segment);
/** Cut to at most `max` string length (what the runtime counts) without splitting a character as people see it (a letter with its marks stays whole), then trim. */
function cut(v: string, max: number): string {
  let out = "";
  for (const g of graphemes(v)) { if (out.length + g.length > max) break; out += g; }
  return out.trim();
}

/**
 * "Divya, Sri Sai Digital" when the account gave a company or business name, else "Divya, local partner" or "Divya, builder": the one way the owner is told who set the shop up, on
 * one line and cut to what the runtime accepts. When it is too long the company is shortened first, then the name; a company that cannot keep even one character is left out for the role.
 */
export function preparedByOf(owner: Pick<OwnerFile, "accountName" | "role"> & { company?: string }): string {
  const role = owner.role === "partner" ? "local partner" : "builder";
  let name = oneLine(owner.accountName);
  const company = companyOf(owner.company);
  if (company !== undefined && name !== "") {
    const room = PREPARED_BY_LIMIT - name.length - 2;
    const kept = cut(company, room);
    if (kept !== "") return `${name}, ${kept}`;
  }
  while (name !== "" && `${name}, ${role}`.length > PREPARED_BY_LIMIT) name = graphemes(name).slice(0, -1).join("").trim();
  return name === "" ? role : `${name}, ${role}`;
}

/**
 * shops/<shop>/report.json: what a shop's monthly report says that only a person can say. Today that is who set the shop up, for a shop that has no owner.json (one made with
 * `geometer shop add`), or one whose builder wants another name on it. Optional. It wins over owner.json. The deployer reads it; nothing in the panel writes it.
 */
export interface ReportFile { schema: 1; preparedBy: string }

// Checks a report file the deployer wrote for a shop, so the papers page only shows numbers it could actually read.
export function parseReportFile(textOrNothing: string | undefined): ReportFile | undefined {
  if (textOrNothing === undefined) return undefined;
  try {
    const r: unknown = JSON.parse(textOrNothing);
    if (isObj(r) && r.schema === 1 && typeof r.preparedBy === "string" && r.preparedBy === oneLine(r.preparedBy) && text(r.preparedBy, PREPARED_BY_LIMIT)) return { schema: 1, preparedBy: r.preparedBy };
  } catch { /* unreadable: the caller says so */ }
  return undefined;
}

// ---- handover (B38) ----------------------------------------------------------------------------------------------------------------------------

export const HANDOVER_REASONS = ["stopped_paying", "stopped_serving", "owner_request"] as const;
export type HandoverReason = (typeof HANDOVER_REASONS)[number];

/** Someone who serves a shop: an account of the panel. */
export interface Person { accountId: string; accountName: string; company?: string; role: "builder" | "partner" }

/**
 * shops/<shop>/assignment.json: who serves the shop NOW, once it has been moved to someone else, and every move. owner.json stays as it is (who set the shop up, written once);
 * this file is written only by a handover, and wins over owner.json and report.json for who may see the shop and whose name the owner's monthly report carries. Each move keeps the
 * reason and the owner's agreement: the hash of the one-use code and the time the owner's own number sent it (the record has the entry itself).
 */
export interface AssignmentFile {
  schema: 1;
  current: Person & { since: string };
  history: { at: string; from: Person; to: Person; reason: HandoverReason; ownerAgreed: { at: string; codeHash: string } }[];
}

const person = (v: unknown): Person | undefined => (isObj(v) && text(v.accountId, 80) && text(v.accountName, 120) && (v.role === "builder" || v.role === "partner") ? { accountId: v.accountId as string, accountName: v.accountName as string, role: v.role } : undefined);

// Checks the file that says which account set up (and may see) which shop; a partner's visibility rests on it, so a broken file shows nothing rather than everything.
export function parseAssignmentFile(textOrNothing: string | undefined): AssignmentFile | undefined {
  if (textOrNothing === undefined) return undefined;
  try {
    const r: unknown = JSON.parse(textOrNothing);
    if (!isObj(r) || r.schema !== 1 || !isObj(r.current) || !person(r.current) || !isoDay(r.current.since) || !Array.isArray(r.history)) return undefined;
    for (const h of r.history) if (!isObj(h) || !isoDay(h.at) || !person(h.from) || !person(h.to) || !(HANDOVER_REASONS as readonly unknown[]).includes(h.reason) || !isObj(h.ownerAgreed)) return undefined;
    return r as unknown as AssignmentFile;
  } catch { return undefined; }
}

/** Who serves the shop in the panel's terms (an OwnerFile-shaped record): the latest move if there has been one, else who set it up. */
export function servedByOf(owner: OwnerFile | undefined, assignment: AssignmentFile | undefined): OwnerFile | undefined {
  if (!assignment) return owner;
  return { schema: 1, accountId: assignment.current.accountId, accountName: assignment.current.accountName, ...(companyOf(assignment.current.company) ? { company: companyOf(assignment.current.company) as string } : {}), role: assignment.current.role, createdAt: assignment.current.since, template: owner?.template ?? "bookings" };
}

/** Who set the shop up, for the monthly report: a handover's new person first (the owner agreed to it), then report.json, then the shop's attribution. Undefined when none says. */
export function resolvePreparedBy(files: { report?: ReportFile; owner?: OwnerFile; assignment?: AssignmentFile }): { name: string; source: "assignment.json" | "report.json" | "owner.json" } | undefined {
  if (files.assignment) return { name: preparedByOf(files.assignment.current), source: "assignment.json" };
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
  /** B71: the gateway key the connection check confirmed, and whose (the provider's id). */
  gateway?: { provider: string; keyId: string; mode: "test" | "live" };
}
