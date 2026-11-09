// Read-only connection checks (B26): confirm that the WhatsApp number, the payment key and the calendar are THIS shop's, before anything goes live.
// The pattern comes from the owner's Lorelei project (internal/channel/verify.go):
//  - bounded GET requests only. Nothing is sent, charged or booked, and every result says `sentNothing: true` because the tests prove it;
//  - identity is separate from permission: what a read shows is said, and what it cannot show is named in `notChecked` (never "all fine");
//  - the id the shop gave is immutable: finding a different account is an error with its own code, never a silent switch to what was found;
//  - the reply is checked for shape (an id that is not an id is `unexpected_response`), and a reply that holds the credential is thrown away;
//  - the ids the PROVIDER reported are what come back as `pins`, and those are what Guard's exact allowlists are written with.
// The functions take base URLs and the ids the shop gave. They never take a provider key: in production the base URL is a Guard that holds the
// keys, and the panel presents only its own Guard credential (`agentToken`). The calls go through the same createHttp the live adapters use, so
// Guard's answers (refused, held, unavailable) are told apart in the same one place.
import { providerById } from "../../modules/payments/providers/index.ts";
import { ApiError, GuardError, GuardUnauthenticatedError, NotSentError, TimeoutError } from "../../modules/core/faults.ts";
import { GRAPH_VERSION } from "../../modules/messaging/whatsapp.ts";
import { createHttp, isObject, str } from "../../modules/core/http.ts";
import type { Http, HttpReply } from "../../modules/core/http.ts";

/** "whatsapp", "calendar", or a gateway's id (modules/payments/providers). */
export type Service = string;
export type CheckCode =
  | "confirmed"
  | "account_mismatch" // the provider shows a different account from the one the shop gave
  | "wrong_mode" // a practice (test) key where a live one is needed, or the reverse
  | "not_writable" // the calendar is shared, but not with "Make changes to events"
  | "not_found" // the account behind the credential cannot see that id
  | "not_allowed" // the credential was not accepted
  | "refused_by_guard" // Guard did not let the read through (its own words are in `detail`)
  | "unreachable"
  | "unexpected_response"
  | "not_configured";

/** What a read cannot show, named so a page never claims more than it checked. */
export type NotChecked = "sending" | "templates-approved" | "payments-account" | "events-private-properties";

export interface CheckResult {
  service: Service;
  ok: boolean;
  code: CheckCode;
  /** What the provider itself reported: ids, never what the shop typed. */
  confirmed?: { phoneNumberId?: string; displayNumber?: string; verifiedName?: string; calendarId?: string; calendarName?: string; timeZone?: string; accessRole?: string; keyId?: string; mode?: "test" | "live" };
  /** On a mismatch: the last four digits of the number that was found, so a person can see it is not theirs without the page showing a whole number. */
  foundEnding?: string;
  /** The calendar role found, or Guard's own reason. Plain words from the provider or Guard, never a credential. */
  detail?: string;
  notChecked: NotChecked[];
  /** Always true: the checks only read. */
  sentNothing: true;
}

export interface ConnectionTargets {
  timeoutMs?: number;
  /** The credential the panel presents to Guard (a Guard bearer). Never a provider key; left out, no Authorization header is sent (a stand-in). */
  agentToken?: string;
  whatsapp?: { baseUrl: string; phoneNumberId: string; /** The number customers write to, with +country code. NOT the owner's number. */ businessNumber: string };
  /** B71: the shop's gateway (its provider id), only for a shop that chose one. */
  gateway?: { provider: string; baseUrl: string; /** The key id the shop gave (it is public, not the secret). */ keyId?: string; expectedMode: "test" | "live"; /** The key id confirmed earlier: a different one now is an error. */ pinnedKeyId?: string };
  calendar?: { baseUrl: string; calendarId: string };
}

export interface Pins {
  whatsapp?: { phoneNumberId: string; displayNumber: string };
  calendar?: { calendarId: string };
  gateway?: { provider: string; keyId: string; mode: "test" | "live" };
}

export interface ConnectionReport {
  results: CheckResult[];
  /** True when every requested check came back ok. */
  allOk: boolean;
  /** Only from checks that confirmed. Guard's allowlists and runtime.json are written from these. */
  pins: Pins;
}

const digits = (s: string) => s.replace(/\D/gu, "");
const NUMBER_ID = /^\d{6,20}$/u;

function result(service: Service, code: CheckCode, rest: Partial<CheckResult> = {}): CheckResult {
  return { service, ok: code === "confirmed", code, notChecked: [], sentNothing: true, ...rest };
}

/** A reply that holds the credential is not used at all. */
const holdsSecret = (body: unknown, secrets: (string | undefined)[]): boolean => {
  const text = JSON.stringify(body ?? null);
  return secrets.some((s) => s !== undefined && s.length >= 8 && text.includes(s));
};

/** Guard's refusal, a stopped connection or a bad answer, as a result. Never throws. */
function failure(service: Service, e: unknown, notChecked: NotChecked[]): CheckResult {
  if (e instanceof GuardUnauthenticatedError) return result(service, "not_allowed", { notChecked, detail: "Guard did not accept the panel's credential." });
  if (e instanceof GuardError) return result(service, "refused_by_guard", { notChecked, ...(e.guard.reason ? { detail: e.guard.reason } : {}) });
  if (e instanceof NotSentError || e instanceof TimeoutError) return result(service, "unreachable", { notChecked });
  if (e instanceof ApiError) return result(service, "unreachable", { notChecked });
  return result(service, "unexpected_response", { notChecked });
}

const providerStatus = (reply: HttpReply, service: Service, notChecked: NotChecked[]): CheckResult | undefined => {
  if (reply.status >= 200 && reply.status < 300) return undefined;
  if (reply.status === 401 || reply.status === 403) return result(service, "not_allowed", { notChecked });
  if (reply.status === 404) return result(service, "not_found", { notChecked });
  if (reply.status === 400 && service === "whatsapp") {
    const error = isObject(reply.body) && isObject(reply.body.error) ? reply.body.error : undefined;
    return result(service, error?.code === 190 ? "not_allowed" : "not_found", { notChecked }); // 190: the token is no good; 100: this account cannot see that id
  }
  return result(service, "unexpected_response", { notChecked });
};

// ---- WhatsApp: the number id's own details --------------------------------------------------------------------------------------------
// GET /{version}/{phone-number-id}?fields=id,display_phone_number,verified_name
// https://developers.facebook.com/docs/whatsapp/cloud-api/reference/phone-numbers/  (read 3 Nov 2026: "Get Phone Number")

export async function checkWhatsApp(target: NonNullable<ConnectionTargets["whatsapp"]>, options: { timeoutMs?: number; agentToken?: string; http?: Http } = {}): Promise<CheckResult> {
  const notChecked: NotChecked[] = ["sending", "templates-approved"];
  if (!NUMBER_ID.test(target.phoneNumberId) || digits(target.businessNumber).length < 8) return result("whatsapp", "not_configured", { notChecked });
  try {
    const http = options.http ?? createHttp(target.baseUrl, "WhatsApp", options.timeoutMs, options.agentToken);
    const reply = await http.request("GET", `/${GRAPH_VERSION}/${encodeURIComponent(target.phoneNumberId)}`, { query: { fields: "id,display_phone_number,verified_name" } });
    const bad = providerStatus(reply, "whatsapp", notChecked);
    if (bad) return bad;
    const b = reply.body;
    const id = isObject(b) ? str(b.id) : undefined;
    const shown = isObject(b) ? str(b.display_phone_number) : undefined;
    if (!isObject(b) || !id || !NUMBER_ID.test(id) || !shown || digits(shown).length < 8 || holdsSecret(b, [options.agentToken])) return result("whatsapp", "unexpected_response", { notChecked });
    if (id !== target.phoneNumberId) return result("whatsapp", "account_mismatch", { notChecked });
    if (digits(shown) !== digits(target.businessNumber)) return result("whatsapp", "account_mismatch", { notChecked, foundEnding: digits(shown).slice(-4) });
    return result("whatsapp", "confirmed", { notChecked, confirmed: { phoneNumberId: id, displayNumber: `+${digits(shown)}`, ...(str(b.verified_name) ? { verifiedName: str(b.verified_name) as string } : {}) } });
  } catch (e) {
    return failure("whatsapp", e, notChecked);
  }
}

// ---- a gateway: the key works, in the right mode, and is the key already confirmed -----------------------------------------------------------
// One read its folder names (providers/<name>/index.ts, setup.probe): a call only a working key answers, through Guard with the panel's reading credential. What this
// does NOT prove: whose account the key belongs to (a gateway may document no call that tells an ordinary key its own account). So the result says
// `payments-account` was not checked, and the panel shows the gateway's own sentence about it (its words.whose).

export async function checkGateway(target: NonNullable<ConnectionTargets["gateway"]>, options: { timeoutMs?: number; agentToken?: string; http?: Http } = {}): Promise<CheckResult> {
  const notChecked: NotChecked[] = ["payments-account"];
  const provider = providerById(target.provider);
  const setup = provider?.gateway?.setup;
  if (!provider || !setup) return result(target.provider, "not_configured", { notChecked });
  let mode: "test" | "live" | undefined;
  if (target.keyId !== undefined) {
    mode = setup.keyId.test(target.keyId) ? setup.modeOf(target.keyId) : undefined;
    if (!mode) return result(provider.id, "not_configured", { notChecked });
    if (mode !== target.expectedMode) return result(provider.id, "wrong_mode", { notChecked, confirmed: { mode } });
    if (target.pinnedKeyId !== undefined && target.pinnedKeyId !== target.keyId) return result(provider.id, "account_mismatch", { notChecked });
  }
  try {
    const http = options.http ?? createHttp(target.baseUrl, provider.displayName, options.timeoutMs, options.agentToken);
    const reply = await http.request("GET", setup.probe.path, { query: setup.probe.query });
    const bad = providerStatus(reply, provider.id, notChecked);
    if (bad) return bad;
    if (!setup.probe.looksRight(reply.body) || holdsSecret(reply.body, [options.agentToken])) return result(provider.id, "unexpected_response", { notChecked });
    return result(provider.id, "confirmed", { notChecked, confirmed: { ...(target.keyId ? { keyId: target.keyId } : {}), ...(mode ? { mode } : {}) } });
  } catch (e) {
    return failure(provider.id, e, notChecked);
  }
}

// ---- Calendar: it is the calendar given, and the account can change events on it ---------------------------------------------------------
// GET /calendar/v3/calendars/{calendarId}               -> { id, summary, timeZone }   https://developers.google.com/workspace/calendar/api/v3/reference/calendars/get
// GET /calendar/v3/calendars/{calendarId}/events?maxResults=1  -> { accessRole, ... }  https://developers.google.com/workspace/calendar/api/v3/reference/events/list
// (calendarList.get also has an accessRole, but a calendar shared with a service account is not in its calendar list unless it was inserted.)

const WRITE_ROLES = new Set(["owner", "writer"]);

export async function checkCalendar(target: NonNullable<ConnectionTargets["calendar"]>, options: { timeoutMs?: number; agentToken?: string; http?: Http } = {}): Promise<CheckResult> {
  const notChecked: NotChecked[] = ["sending", "events-private-properties"];
  if (target.calendarId.trim() === "" || /[\s/?#]/u.test(target.calendarId)) return result("calendar", "not_configured", { notChecked });
  try {
    const http = options.http ?? createHttp(target.baseUrl, "Google Calendar", options.timeoutMs, options.agentToken);
    const path = `/calendar/v3/calendars/${encodeURIComponent(target.calendarId)}`;
    const meta = await http.request("GET", path);
    const badMeta = providerStatus(meta, "calendar", notChecked);
    if (badMeta) return badMeta;
    const m = meta.body;
    const id = isObject(m) ? str(m.id) : undefined;
    if (!isObject(m) || !id || holdsSecret(m, [options.agentToken])) return result("calendar", "unexpected_response", { notChecked });
    if (id.toLowerCase() !== target.calendarId.toLowerCase()) return result("calendar", "account_mismatch", { notChecked });
    const list = await http.request("GET", `${path}/events`, { query: { maxResults: 1 } });
    const badList = providerStatus(list, "calendar", notChecked);
    if (badList) return badList;
    const role = isObject(list.body) ? str(list.body.accessRole) : undefined;
    if (!role || holdsSecret(list.body, [options.agentToken])) return result("calendar", "unexpected_response", { notChecked });
    const confirmed = { calendarId: id, ...(str(m.summary) ? { calendarName: str(m.summary) as string } : {}), ...(str(m.timeZone) ? { timeZone: str(m.timeZone) as string } : {}), accessRole: role };
    // "writerWithoutPrivateAccess" can change events but cannot read the private properties the agent writes its booking ids into, so it is not enough.
    if (!WRITE_ROLES.has(role)) return result("calendar", "not_writable", { notChecked, confirmed, detail: role });
    return result("calendar", "confirmed", { notChecked, confirmed });
  } catch (e) {
    return failure("calendar", e, notChecked);
  }
}

// ---- all of them ---------------------------------------------------------------------------------------------------------------------------

/** Run the checks for the services given, side by side. Never throws. */
export async function checkConnections(targets: ConnectionTargets): Promise<ConnectionReport> {
  const o = { timeoutMs: targets.timeoutMs, agentToken: targets.agentToken };
  const jobs: Promise<CheckResult>[] = [];
  if (targets.whatsapp) jobs.push(checkWhatsApp(targets.whatsapp, o));
  if (targets.gateway) jobs.push(checkGateway(targets.gateway, o));
  if (targets.calendar) jobs.push(checkCalendar(targets.calendar, o));
  const results = await Promise.all(jobs);
  const pins: Pins = {};
  for (const r of results) {
    const c = r.confirmed;
    if (!r.ok || !c) continue;
    if (r.service === "whatsapp" && c.phoneNumberId && c.displayNumber) pins.whatsapp = { phoneNumberId: c.phoneNumberId, displayNumber: c.displayNumber };
    if (r.service === "calendar" && c.calendarId) pins.calendar = { calendarId: c.calendarId };
    if (targets.gateway && r.service === targets.gateway.provider && c.keyId && c.mode) pins.gateway = { provider: r.service, keyId: c.keyId, mode: c.mode };
  }
  return { results, allOk: results.length > 0 && results.every((r) => r.ok), pins };
}
