// Every Guard the bundle runs, defined ONCE: its tool name, its upstream, the header it adds, and the limits spec and guard.toml that are
// generated from that one definition. The tool name in a spec and the tool name in its guard.toml come from the same line here, so they
// cannot disagree (Guard refuses a pair that does, and the generator checks it again, see rules.ts).
//
// A gateway's Guard (B71: only for a shop that chose one) is defined by the gateway's own folder (modules/payments/providers/<name>/guard.ts): its tool name,
// upstream and credential file. Its spec has one source: the template's gatewayLimitsSpec (templates/commerce/bookings/src/guard-limits.ts for Bookings), which
// turns the shop's own settings into the deposit bound and the refund threshold. The others are generated here from the shop's runtime.json (the WhatsApp
// number, the calendar) and the server's settings. The monorepo copies in deploy/pathways/bookings/ are fixtures: test/drift.test.ts compares the shapes.
import { ANTHROPIC_VERSION } from "../../modules/understanding/model-llm.ts";
import { gatewayLimitsSpec } from "../../templates/commerce/bookings/src/guard-limits.ts";
import type { LimitsSpec, PaymentCaps } from "../../modules/payments/guard-limits.ts";
import type { Settings } from "../../templates/commerce/bookings/src/settings.ts";
import type { ModelConfig, Upstream } from "../lib/server.ts";
import { GATEWAYS, GATEWAY_KINDS, OWN_API, providerById } from "../../modules/payments/providers/index.ts";
import { OWN_API_SECRET } from "../lib/secrets.ts";

/** How long a Guard waits for its provider. The runtime must wait LONGER, or it gives up on a call Guard is still making (rules.ts). */
export const GUARD_UPSTREAM_TIMEOUT_MS = 15_000;

/** A gateway's id (providers/index.ts GATEWAY_KINDS), "whatsapp", "calendar" or "model". */
export type GuardKind = string;

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

export const GUARD_KINDS: readonly GuardKind[] = [...GATEWAY_KINDS, "whatsapp", "calendar", "model"];

/**
 * The Guard in front of an agent's own gateway API, which has no module here (B71 step 6): its tool is the reviewed spec's, its upstream is where the builder said the
 * API is. Everything else is the same as a gateway module's Guard: one credential file, sent as the Authorization header.
 */
export function ownApiGuardDef(tool: string, upstream: string): GuardDef {
  return { kind: OWN_API, tool, upstream, secretFile: OWN_API_SECRET, headers: { Authorization: `\${file:/run/secrets/${OWN_API_SECRET}}` } };
}

export function guardDef(kind: GuardKind, model?: ModelConfig): GuardDef {
  const gateway = providerById(kind)?.gateway?.guard;
  // a gateway's Guard is its folder's: the key order is the deployed definition's, and the bytes of every Razorpay shop's plan are pinned (payment-guard-golden)
  if (gateway) return { kind, tool: gateway.tool, upstream: gateway.upstream, secretFile: gateway.secretFile, headers: { Authorization: `\${file:/run/secrets/${gateway.secretFile}}` } };
  switch (kind) {
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

/**
 * `caps` is for an agent we did not write, whose builder sets the daily refund caps too (agent.json); a shop passes none and gets the template's. `build` is the template's own
 * way of turning its settings into the gateway's numbers (lib/kinds.ts): Bookings' unless a shop of another template is planned.
 */
export function gatewaySpec(settings: Settings, id: SpecIdentity, approvalHours: number, linksPerHour?: number, caps?: Partial<PaymentCaps>, build: (settings: any, identity: Parameters<typeof gatewayLimitsSpec>[1], options: { approvalTtlSeconds: number; caps?: Partial<PaymentCaps> }) => LimitsSpec = gatewayLimitsSpec): LimitsSpec {
  const merged = { ...(linksPerHour !== undefined ? { linksPerHour } : {}), ...caps };
  return build(settings, { tenant: id.tenant, name: id.name, version: id.version, reviewedBy: id.reviewedBy }, { approvalTtlSeconds: approvalHours * 3600, ...(Object.keys(merged).length > 0 ? { caps: merged } : {}) });
}

/**
 * What the panel's own agent (`panel-<shop>`) may call at each Guard: the READ operations its connection checks use, and nothing else. The agent is limited to these
 * operations in guard.toml; the routes are in the specs below (a gateway's own, from its folder, and the calendar's `list` were already there). The calendar check reads the
 * calendar (`get_calendar`) and then asks for ONE event (`list`, `maxResults=1`) because the access role (can it write?) only comes back with an events list: so the
 * panel's agent can list that one calendar's events, which Guard's exact-id rule confines to the shop's own calendar and which its checker throws away (it keeps the role).
 */
export const PANEL_READS: Record<string, string[]> = { ...Object.fromEntries(GATEWAYS.map((g) => [g.id, g.gateway!.guard.reads.panel])), whatsapp: ["read_number"], calendar: ["get_calendar", "list"] };

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
  /**
   * The owner's approver id (Razorpay only): the approvals relay signs the owner's answers with the owner's secret. B37: `group` adds the shop's other people,
   * each with their own secret file, and the amount (in paise) above which two different people must approve. Without it the file is the one it always was.
   */
  approver?: { id: string; secretFile: string; group?: { people: { id: string; secretFile: string }[]; twoAbovePaise?: number } };
  /** Seconds between tripwire runs; Guard's default is 300. */
  tripwireIntervalS?: number;
  /** Where this Guard listens and keeps its files. The defaults are the container's; a test that runs the real binary on this computer gives its own. */
  paths?: Partial<typeof CONTAINER_PATHS>;
  /**
   * Fleet's licence lease (plan B13, monorepo ADR-0062), for a per-shop Guard only (never the model Guard, which serves the whole server). Given only when the
   * Guard image reads `[licence]` (an older one ignores the table: it would do nothing while reading as if it did) and geometer.json pins `licence.keys`.
   */
  licence?: GuardLicence;
}

/** What a per-shop Guard is told about the lease. `deployment` is the SERVER's id (the one fleet's lease names), not the Guard's own name (`TomlOptions.deployment`). */
export interface GuardLicence {
  deployment: string;
  /** The shop's id, or the id of an agent someone else wrote. */
  shop: string;
  /**
   * The shop's own people's WhatsApp numbers: the owner, and the other people who approve refunds (B37). In the final stop a send to one of them still goes (the
   * owner's notice; the relay asking about a refund Guard holds). Guard's field is `owner_numbers`. Only numbers Guard reads as numbers (`ownerNumbers`).
   */
  ownerNumbers: string[];
}

/** Where a per-shop Guard sees the server's state/licence/ folder (read-only; the folder, not single files, because the deployer replaces the lease by rename). */
export const LICENCE_MOUNT = "/run/geometer/licence";
/**
 * The operations held back. In the wind-down: a new payment link and a new calendar event. In the final stop also a WhatsApp send, except to the owner. Guard's
 * configuration refuses a list that names a refund, a cancellation, a read, a list, `patch` or `delete`, so money owed to a customer always goes through.
 */
export const LICENCE_WIND_DOWN_REFUSES: readonly string[] = ["create_link", "insert"];
export const LICENCE_STOPPED_REFUSES: readonly string[] = ["create_link", "insert", "send"];
/** The argument of a send that names who it goes to: WhatsApp's `to`. Guard's default too; written out so the file says which field the owner's exception reads. */
export const LICENCE_RECIPIENT_FIELD = "to";

/** The owner's numbers as Guard will take them: 6 to 15 digits, with `+`, spaces, dashes and brackets allowed (Guard refuses the whole file for one it cannot read). */
export const ownerNumbers = (numbers: readonly (string | undefined)[]): string[] =>
  numbers.filter((n): n is string => typeof n === "string" && /^[\d+ ()-]+$/u.test(n.trim()) && (n.match(/\d/gu)?.length ?? 0) >= 6 && (n.match(/\d/gu)?.length ?? 0) <= 15).map((n) => n.trim());

/** The `[licence]` lines of guard.toml (ADR-0062 decision 1). The paths are the mount's. */
function licenceLines(l: GuardLicence): string[] {
  const q = (s: string) => JSON.stringify(s);
  const list = (xs: readonly string[]) => `[${xs.map(q).join(", ")}]`;
  return [
    ``,
    `# Fleet's signed licence lease (plan B13, monorepo ADR-0059 and ADR-0062), checked offline with the public keys built into Guard's binary. Read again`,
    `# when the files change; never a restart. No lease file, or a shop the lease does not list, restricts nothing. The folder is this server's state/licence/.`,
    `[licence]`,
    `lease_file = ${q(`${LICENCE_MOUNT}/lease`)}`,
    `seen_file = ${q(`${LICENCE_MOUNT}/seen.json`)}`,
    `extensions_dir = ${q(`${LICENCE_MOUNT}/extensions`)}`,
    `deployment = ${q(l.deployment)}`,
    `shop = ${q(l.shop)}`,
    `# In the wind-down, refused with reason subscription_suspended (not a policy denial); in the final stop, also a send, except to the owner's number.`,
    `# Never refused, in any state: refunds, cancel_link, reads, lists, patch, delete.`,
    `wind_down_refuses = ${list(LICENCE_WIND_DOWN_REFUSES)}`,
    `stopped_refuses = ${list(LICENCE_STOPPED_REFUSES)}`,
    `owner_numbers = ${list(l.ownerNumbers)}`,
    `recipient_field = ${q(LICENCE_RECIPIENT_FIELD)}`,
  ];
}

/** Inside the Guard's container. A test running the binary directly overrides these (TomlOptions.paths). */
export const CONTAINER_PATHS = { listen: "0.0.0.0:8080", adminListen: "127.0.0.1:8082", healthListen: "0.0.0.0:8081", state: "/var/lib/geo-guard/state.db", bundle: "/etc/geo-guard/bundle.json" };

/** guard.toml for one Guard, in Guard's production profile. It holds no secret: only hashes, and the names of files. */
export function guardToml(o: TomlOptions): string {
  const q = (s: string) => JSON.stringify(s);
  const where = { ...CONTAINER_PATHS, ...o.paths };
  const lines = [
    `# guard.toml for ${o.deployment}. Written by the Geometer deploy bundle: do not edit; change the shop's settings and deploy again.`,
    `# It holds no secret: the credentials are sha256 hashes, and the provider's key is read from a file only this Guard can read.`,
    `schema = 2`,
    `profile = "production"`,
    `# The runtime reaches the agent port on a network with no way out. The admin port stays on loopback; a forwarder in this Guard's network`,
    `# namespace gives the services that need it (ops, the relay, the token refresher) a way in, on a network the runtime is not on.`,
    `listen = ${q(where.listen)}`,
    `admin_listen = ${q(where.adminListen)}`,
    `health_listen = ${q(where.healthListen)}`,
    `deployment = ${q(o.deployment)}`,
    `tenant = ${q(o.tenant)}`,
    `tool = ${q(o.def.tool)}`,
    `mode = "enforce"`,
    `upstream = ${q(o.upstream.host)}`,
    `upstream_timeout_ms = ${GUARD_UPSTREAM_TIMEOUT_MS}`,
    `state = ${q(where.state)}`,
    `bundle = ${q(where.bundle)}`,
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
  if (o.approver?.group) lines.push(...groupApprovers(o, { ...o.approver, group: o.approver.group }));
  else if (o.approver) {
    lines.push(
      ``, `# Who may approve a held refund: the shop's owner, through the approvals relay, which signs each answer with the owner's secret (POST /admin/notify).`,
      `[[roles]]`, `id = "shop-owner"`, `tools = [${q(o.def.tool)}]`, `operations = ["refund"]`, `rules = ["*"]`, `tenants = [${q(o.tenant)}]`,
      ``, `[[approvers]]`, `id = ${q(o.approver.id)}`, `roles = ["shop-owner"]`,
      ``, `[notify_secrets]`, `${o.approver.id} = ${q("${file:" + o.approver.secretFile + "}")}`,
    );
  }
  if (o.licence && o.def.kind !== "model") lines.push(...licenceLines(o.licence));
  return `${lines.join("\n")}\n`;
}

/**
 * B37 (Guard's ADR-0061, the monorepo's Deferred D82): the owner and the shop's other people, one role per amount tier. `shop-owner` covers refunds up to
 * the two-person amount (one approval: the owner is asked, unless the owner asked for it) and keeps its id, so the relay's reading credential
 * (ops `issue-approver`, role shop-owner) still sees and may decide those. `shop-two` covers the rest and needs two different people. The reading
 * credential does not hold `shop-two`: it is not counted as a holder, and could not cast one of the two answers.
 */
function groupApprovers(o: TomlOptions, a: { id: string; secretFile: string; group: { people: { id: string; secretFile: string }[]; twoAbovePaise?: number } }): string[] {
  const q = (s: string) => JSON.stringify(s);
  const two = a.group.twoAbovePaise !== undefined;
  const role = (id: string, extra: string[]) => [``, `[[roles]]`, `id = ${q(id)}`, `tools = [${q(o.def.tool)}]`, `operations = ["refund"]`, `rules = ["*"]`, `tenants = [${q(o.tenant)}]`, ...extra];
  const everyone = [{ id: a.id, secretFile: a.secretFile }, ...a.group.people];
  const roles = two ? `["shop-owner", "shop-two"]` : `["shop-owner"]`;
  return [
    ``, `# Who may approve a held refund: the owner and ${a.group.people.length} other ${a.group.people.length === 1 ? "person" : "people"}, each through the approvals relay, which signs each`,
    `# person's answer with that person's own secret (POST /admin/notify). The person who asked for a refund never approves it (Geo-Requested-By).`,
    ...(two
      ? [...role("shop-owner", [`max_amount = ${q(String(a.group.twoAbovePaise))}`, `amount_unit = "paise"`]), ...role("shop-two", [`approvals_needed = 2`])]
      : role("shop-owner", [])),
    ...everyone.flatMap((p) => [``, `[[approvers]]`, `id = ${q(p.id)}`, `roles = ${roles}`]),
    ``, `[notify_secrets]`, ...everyone.map((p) => `${p.id} = ${q("${file:" + p.secretFile + "}")}`),
  ];
}
