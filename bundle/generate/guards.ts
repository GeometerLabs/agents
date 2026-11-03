// Every Guard the bundle runs, defined ONCE: its tool name, its upstream, the header it adds, and the limits spec and guard.toml that are
// generated from that one definition. The tool name in a spec and the tool name in its guard.toml come from the same line here, so they
// cannot disagree (Guard refuses a pair that does, and the generator checks it again, see rules.ts).
//
// The Razorpay spec has one source: razorpayLimitsSpec in pathways/bookings/src/guard-limits.ts, which turns the shop's own settings into
// the deposit bound and the refund threshold. The others are generated here from the shop's runtime.json (the WhatsApp number, the calendar)
// and the server's settings. The monorepo copies in deploy/pathways/bookings/ are fixtures: test/drift.test.ts compares the shapes.
import { ANTHROPIC_VERSION } from "../../pathways/bookings/src/adapters/model-llm.ts";
import { razorpayLimitsSpec } from "../../pathways/bookings/src/guard-limits.ts";
import type { LimitsSpec } from "../../pathways/bookings/src/guard-limits.ts";
import type { Settings } from "../../pathways/bookings/src/settings.ts";
import type { ModelConfig, Upstream } from "../lib/server.ts";

/** How long a Guard waits for its provider. The runtime must wait LONGER, or it gives up on a call Guard is still making (rules.ts). */
export const GUARD_UPSTREAM_TIMEOUT_MS = 15_000;

export type GuardKind = "razorpay" | "whatsapp" | "calendar" | "model";

export interface GuardDef {
  kind: GuardKind;
  /** The one tool name. Written into the spec and into guard.toml. */
  tool: string;
  upstream: string;
  /** Header name -> value; `${file:...}` means Guard reads the value from that file when it starts or reloads. */
  headers: Record<string, string>;
  /** The provider secret this Guard reads, as a file name under /run/secrets in its container (none for the calendar: the token refresher writes it). */
  secretFile?: string;
}

export const GUARD_KINDS: readonly GuardKind[] = ["razorpay", "whatsapp", "calendar", "model"];

export function guardDef(kind: GuardKind, model?: ModelConfig): GuardDef {
  switch (kind) {
    case "razorpay": return { kind, tool: "razorpay", upstream: "api.razorpay.com:443", secretFile: "razorpay_authorization", headers: { Authorization: "${file:/run/secrets/razorpay_authorization}" } };
    case "whatsapp": return { kind, tool: "whatsapp", upstream: "graph.facebook.com:443", secretFile: "whatsapp_authorization", headers: { Authorization: "${file:/run/secrets/whatsapp_authorization}" } };
    case "calendar": return { kind, tool: "google-calendar", upstream: "www.googleapis.com:443", headers: { Authorization: "${file:/run/google/authorization}" } };
    case "model":
      if (model?.wire === "anthropic") return { kind, tool: "model", upstream: model.upstream ?? "api.anthropic.com:443", secretFile: "model_api_key", headers: { "x-api-key": "${file:/run/secrets/model_api_key}", "anthropic-version": ANTHROPIC_VERSION } };
      return { kind, tool: "model", upstream: model?.upstream ?? "api.openai.com:443", secretFile: "model_authorization", headers: { Authorization: "${file:/run/secrets/model_authorization}" } };
  }
}

export interface SpecIdentity { tenant: string; name: string; version: number; reviewedBy: string }

const base = (def: GuardDef, id: SpecIdentity, approvalTtlSeconds = 900) => ({ schema: 1, tenant: id.tenant, tool: def.tool, name: id.name, version: id.version, reviewed_by: id.reviewedBy, approval_ttl_seconds: approvalTtlSeconds });
const count = (id: string, operation: string, cap: number, windowSeconds: number) => ({ id, kind: "count", operation, scope: [], cap: String(cap), window_seconds: windowSeconds });

export function razorpaySpec(settings: Settings, id: SpecIdentity, approvalHours: number, linksPerHour?: number): LimitsSpec {
  return razorpayLimitsSpec(settings, { tenant: id.tenant, name: id.name, version: id.version, reviewedBy: id.reviewedBy }, { approvalTtlSeconds: approvalHours * 3600, ...(linksPerHour !== undefined ? { caps: { linksPerHour } } : {}) });
}

/**
 * What the panel's own agent (`panel-<shop>`) may call at each Guard: the READ operations its connection checks use, and nothing else. The agent is limited to these
 * operations in guard.toml; the routes are in the specs below (Razorpay's `list_links` and the calendar's `list` were already there). The calendar check reads the
 * calendar (`get_calendar`) and then asks for ONE event (`list`, `maxResults=1`) because the access role (can it write?) only comes back with an events list: so the
 * panel's agent can list that one calendar's events, which Guard's exact-id rule confines to the shop's own calendar and which its checker throws away (it keeps the role).
 */
export const PANEL_READS: Record<Exclude<GuardKind, "model">, string[]> = { razorpay: ["list_links"], whatsapp: ["read_number"], calendar: ["get_calendar", "list"] };

/** The shop's own WhatsApp number, exactly: not a longer number that ends the same way. `read_number` is the panel's check that the number is the shop's own. */
export function whatsappSpec(id: SpecIdentity, o: { phoneNumberId: string; messagesPerHour: number }): LimitsSpec {
  return {
    ...base(guardDef("whatsapp"), id),
    routes: [{ method: "POST", path: "/{version}/{phone_number_id}/messages", operation: "send" }, { method: "GET", path: "/{version}/{phone_number_id}", operation: "read_number" }],
    rules: [
      { id: "own-number-only", kind: "argument_allowlist", operation: "send", field: "phone_number_id", match: "exact", allowed_values: [o.phoneNumberId] },
      { id: "own-number-read", kind: "argument_allowlist", operation: "read_number", field: "phone_number_id", match: "exact", allowed_values: [o.phoneNumberId] },
    ],
    limits: [count("messages-per-hour", "send", o.messagesPerHour, 3600)],
    intents: [], fail_policy: [],
  };
}

const EVENT_OPERATIONS = ["insert", "list", "get", "patch", "delete"] as const;
/** The calendar itself (not an event in it) can be read, to confirm it is the shop's own; nothing about a calendar can be changed. */
const CALENDAR_READ = { operation: "get_calendar", ruleId: "own-calendar-get-calendar" } as const;

/** The shop's own calendar, exactly, on every event operation. Nothing else is listed: clearing or deleting a calendar is refused as unlisted. */
export function calendarSpec(id: SpecIdentity, o: { calendarId: string; createdPerHour: number; deletedPerDay: number }): LimitsSpec {
  return {
    ...base(guardDef("calendar"), id),
    routes: [
      { method: "POST", path: "/calendar/v3/calendars/{calendarId}/events", operation: "insert" },
      { method: "GET", path: "/calendar/v3/calendars/{calendarId}/events", operation: "list" },
      { method: "GET", path: "/calendar/v3/calendars/{calendarId}/events/{eventId}", operation: "get" },
      { method: "PATCH", path: "/calendar/v3/calendars/{calendarId}/events/{eventId}", operation: "patch" },
      { method: "DELETE", path: "/calendar/v3/calendars/{calendarId}/events/{eventId}", operation: "delete" },
      { method: "POST", path: "/calendar/v3/freeBusy", operation: "free_busy" },
      { method: "GET", path: "/calendar/v3/calendars/{calendarId}", operation: CALENDAR_READ.operation },
    ],
    rules: [...EVENT_OPERATIONS.map((operation) => ({ id: `own-calendar-${operation}`, kind: "argument_allowlist", operation, field: "calendarId", match: "exact", allowed_values: [o.calendarId] })),
      { id: CALENDAR_READ.ruleId, kind: "argument_allowlist", operation: CALENDAR_READ.operation, field: "calendarId", match: "exact", allowed_values: [o.calendarId] }],
    limits: [count("events-created-per-hour", "insert", o.createdPerHour, 3600), count("events-deleted-per-day", "delete", o.deletedPerDay, 86_400)],
    intents: [], fail_policy: [],
  };
}

/** The path the model provider is called on. A provider whose compatible endpoint lives elsewhere says so in geometer.json (`model.path`). */
export const modelPath = (m: ModelConfig): string => m.path ?? (m.wire === "anthropic" ? "/v1/messages" : "/v1/chat/completions");

/** The one model every shop on the server may ask for, and a cap for the whole server. */
export function modelSpec(id: SpecIdentity, m: ModelConfig): LimitsSpec {
  return {
    ...base(guardDef("model", m), id),
    routes: [{ method: "POST", path: modelPath(m), operation: "chat" }],
    rules: [{ id: "model-pin", kind: "argument_allowlist", operation: "chat", field: "model", match: "exact", allowed_values: [m.model] }],
    limits: [count("model-calls-per-day", "chat", m.callsPerDay ?? 2000, 86_400)],
    intents: [], fail_policy: [],
  };
}

export interface TomlOptions {
  def: GuardDef;
  tenant: string;
  /** The Guard's name in its own records and in the ledger. */
  deployment: string;
  bundleDigest: string;
  upstream: Upstream;
  /** sha256 of the admin credential (the token itself lives in the files of the containers that use it). */
  adminSha: string;
  /** Who may call this Guard. `operations` limits an agent to some operations (empty: all in the bundle). */
  agents: { id: string; sha: string; operations?: string[] }[];
  /** The owner's approver id (Razorpay only): the approvals relay signs the owner's answers with the owner's secret. */
  approver?: { id: string; secretFile: string };
  /** Seconds between tripwire runs; Guard's default is 300. */
  tripwireIntervalS?: number;
}

/** guard.toml for one Guard, in Guard's production profile. It holds no secret: only hashes, and the names of files. */
export function guardToml(o: TomlOptions): string {
  const q = (s: string) => JSON.stringify(s);
  const lines = [
    `# guard.toml for ${o.deployment}. Written by the Geometer deploy bundle: do not edit; change the shop's settings and deploy again.`,
    `# It holds no secret: the credentials are sha256 hashes, and the provider's key is read from a file only this Guard can read.`,
    `schema = 2`,
    `profile = "production"`,
    `# The runtime reaches the agent port on a network with no way out. The admin port stays on loopback; a forwarder in this Guard's network`,
    `# namespace gives the services that need it (ops, the relay, the token refresher) a way in, on a network the runtime is not on.`,
    `listen = "0.0.0.0:8080"`,
    `admin_listen = "127.0.0.1:8082"`,
    `health_listen = "0.0.0.0:8081"`,
    `deployment = ${q(o.deployment)}`,
    `tenant = ${q(o.tenant)}`,
    `tool = ${q(o.def.tool)}`,
    `mode = "enforce"`,
    `upstream = ${q(o.upstream.host)}`,
    `upstream_timeout_ms = ${GUARD_UPSTREAM_TIMEOUT_MS}`,
    `state = "/var/lib/geo-guard/state.db"`,
    `bundle = "/etc/geo-guard/bundle.json"`,
    `bundle_digest = ${q(o.bundleDigest)}`,
    `unlisted_tools = "deny"`,
    ...(o.tripwireIntervalS !== undefined ? [`tripwire_interval_s = ${o.tripwireIntervalS}`] : []),
    ``,
    `[[admins]]`,
    `id = "ops"`,
    `token_sha256 = ${q(o.adminSha)}`,
  ];
  for (const a of o.agents) {
    lines.push(``, `[[agents]]`, `id = ${q(a.id)}`, `token_sha256 = ${q(a.sha)}`, `tenant = ${q(o.tenant)}`);
    if (a.operations && a.operations.length > 0) lines.push(`operations = [${a.operations.map(q).join(", ")}]`);
  }
  lines.push(``, `[upstream_headers]`, ...Object.entries(o.def.headers).map(([k, v]) => `${/^[A-Za-z0-9_-]+$/u.test(k) ? k : q(k)} = ${q(v)}`));
  if (o.upstream.tls) lines.push(``, `[upstream_tls]`);
  if (o.approver) {
    lines.push(
      ``, `# Who may approve a held refund: the shop's owner, through the approvals relay, which signs each answer with the owner's secret (POST /admin/notify).`,
      `[[roles]]`, `id = "shop-owner"`, `tools = [${q(o.def.tool)}]`, `operations = ["refund"]`, `rules = ["*"]`, `tenants = [${q(o.tenant)}]`,
      ``, `[[approvers]]`, `id = ${q(o.approver.id)}`, `roles = ["shop-owner"]`,
      ``, `[notify_secrets]`, `${o.approver.id} = ${q("${file:" + o.approver.secretFile + "}")}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
