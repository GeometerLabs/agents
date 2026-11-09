// One shop, planned: from its settings and runtime.json to the specs for its three Guards and the runtime config its container will read.
// This file is pure (no files, no Docker, no clock), so every rule that can refuse a deploy is tested without a machine.
import type { LimitsSpec } from "../../modules/payments/guard-limits.ts";
import { OWNER_APPROVER } from "../../modules/approvals/people.ts";
import type { ApproversSettings } from "../../modules/approvals/people.ts";
import { KINDS, kindFor, guardsOf } from "../lib/kinds.ts";
import type { Kind } from "../lib/kinds.ts";
import { DEFAULT_PREPARED_BY, publicUrl } from "../lib/server.ts";
import type { ModelConfig, PanelRuntime, Pins, ServerConfig, ShopFolder, Upstream } from "../lib/server.ts";
import { stableJson } from "../lib/util.ts";
import type { Problem } from "../lib/util.ts";
import { GUARD_UPSTREAM_TIMEOUT_MS, calendarSpec, guardDef, modelPath, modelSpec, gatewaySpec, whatsappSpec } from "./guards.ts";
import type { GuardDef, GuardKind } from "./guards.ts";

/** What the runtime waits for a call when runtime.json says nothing: longer than Guard's own wait for the provider. */
export const DEFAULT_RUNTIME_TIMEOUT_MS = 20_000;

/** In the runtime's container: its home (the data volume is mounted here), the folder it keeps its data in, and where its monthly report pages go. */
export const HOME_DIR = "/home/node";
export const DATA_DIR = `${HOME_DIR}/data`;
export const REPORTS_DIR = `${DATA_DIR}/reports`;
/** The reports folder as a path inside the data volume (which is mounted at HOME_DIR): what Caddy mounts, read-only, and nothing else of the volume. */
export const REPORTS_SUBPATH = REPORTS_DIR.slice(HOME_DIR.length + 1);
/** The public address of a shop's report pages: https://<domain>/r/<shop>/<32 hex digits>/<file>. Caddy serves exactly that shape (generate/compose.ts, reportsMatcher). */
export const REPORTS_ROUTE = "/r";
export const reportBaseUrl = (server: Pick<ServerConfig, "domain" | "ports">, shop: string): string => `${publicUrl(server)}${REPORTS_ROUTE}/${shop}`;

/** Names of everything a shop owns, in one place. */
export const names = {
  net: (shop: string) => `net-${shop}`,
  runtime: (shop: string) => `rt-${shop}`,
  guard: (shop: string, kind: GuardKind) => `g-${shop}-${kind}`,
  forwarder: (shop: string, kind: GuardKind) => `fwd-${shop}-${kind}`,
  door: (shop: string) => `door-${shop}`,
  dataVolume: (shop: string) => `rt-data-${shop}`,
  /** The one-shot that makes the shop's reports folder in its data volume, so Caddy can mount it before the runtime has ever written a report. */
  reportsDir: (shop: string) => `rd-${shop}`,
  stateVolume: (shop: string, kind: GuardKind) => `gs-${shop}-${kind}`,
  /** The model Guard is one per server. */
  modelGuard: "g-model",
  modelStateVolume: "gs-model",
  agentId: (shop: string) => `runtime-${shop}`,
  relayAgentId: (shop: string) => `relay-${shop}`,
  panelAgentId: (shop: string) => `panel-${shop}`,
  /** The one token file the panel presents to every Guard it checks (secrets/panel/<this>); the panel reads a single file (golive.ts). */
  panelGuardToken: "guard_agent_token",
  approverId: (shop: string) => `owner-${shop}`,
  /**
   * B37: the owner's id in the Razorpay Guard's directory. A shop of the owner alone keeps `owner-<shop>`; one with other approvers names the owner `owner`, the
   * id the runtime puts in Geo-Requested-By when the owner asks for a refund (modules/approvals/people.ts), beside each person's own id.
   */
  ownerApproverId: (shop: string, group: boolean) => (group ? OWNER_APPROVER : `owner-${shop}`),
  /** B37: the file, in the Razorpay Guard's and the relay's secret folders, that holds one person's signing secret. */
  approverSecretFile: (person: string) => `approver_${person}_notify_secret`,
};

export interface GuardPlan {
  kind: GuardKind;
  /** The compose service (and container) name. */
  service: string;
  tenant: string;
  deployment: string;
  def: GuardDef;
  upstream: Upstream;
  spec: LimitsSpec;
  /** The spec as written to disk. The same value is the same bytes, so an unchanged shop is not recompiled. */
  specText: string;
  /** B37, the Razorpay Guard only: the shop's other approvers and its two-person amount, from its settings. Left out: the owner alone. */
  approvers?: ApproversSettings;
}

export interface ShopPlan {
  shop: string;
  guards: GuardPlan[];
  /** The runtime.json the container reads (host, port, folders, Guard addresses and credential files are the bundle's; who things are comes from the panel's file). */
  runtime: Record<string, unknown>;
  /** Things in the panel's runtime.json the bundle set itself, said so nobody wonders. */
  notes: string[];
  problems: Problem[];
}

export const RUNTIME_PORT = 8780;
export const GUARD_PORT = 8080;
export const guardUrl = (service: string) => `http://${service}:${GUARD_PORT}`;
/** In the runtime container, the folder that holds the agent's credentials for its Guards, one file per Guard. */
const SECRETS = "/run/secrets";

export const upstreamOf = (server: ServerConfig, kind: GuardKind, def: GuardDef): Upstream => server.upstreams?.[kind] ?? { host: def.upstream, tls: true };

/** The model's address for a runtime: the Guard's base, plus whatever the provider puts before /chat/completions. */
export function modelBaseUrl(model: ModelConfig): string {
  const path = modelPath(model);
  return `${guardUrl(names.modelGuard)}${model.wire === "openai" ? path.replace(/\/chat\/completions$/u, "") : ""}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The pieces of runtime.json the generator needs, checked. */
function runtimeFacts(server: ServerConfig, panel: PanelRuntime, pins: Pins, problems: Problem[], notes: string[], kind: Kind) {
  const hasCalendar = kind.guards.includes("calendar");
  const services = isObj(panel.services) ? panel.services : {};
  // The ids the providers CONFIRMED (pins.json, written after the panel's connection checks) win over what runtime.json says, for the Guards AND for the
  // runtime, so the two always agree. A runtime.json that differs is said so.
  const written = { calendar: isObj(services.calendar) ? services.calendar.calendarId : undefined, whatsapp: isObj(services.messaging) ? services.messaging.phoneNumberId : undefined };
  const calendarId = pins.calendar?.calendarId ?? written.calendar;
  const phoneNumberId = pins.whatsapp?.phoneNumberId ?? written.whatsapp;
  if (pins.calendar && written.calendar !== undefined && written.calendar !== pins.calendar.calendarId) notes.push("runtime.json names another calendar than the one the connection check confirmed (pins.json); the confirmed one is used.");
  if (pins.whatsapp && written.whatsapp !== undefined && written.whatsapp !== pins.whatsapp.phoneNumberId) notes.push("runtime.json names another WhatsApp number id than the one the connection check confirmed (pins.json); the confirmed one is used.");
  if (hasCalendar && (typeof calendarId !== "string" || calendarId.trim() === "")) problems.push({ rule: "calendar-id", message: 'runtime.json needs services.calendar.calendarId: the shop\'s own Google calendar. The calendar Guard allows exactly that one and refuses every other.' });
  if (typeof phoneNumberId !== "string" || !/^\d{6,20}$/u.test(phoneNumberId)) problems.push({ rule: "whatsapp-number-id", message: 'runtime.json needs services.messaging.phoneNumberId: the shop\'s own WhatsApp phone number id (digits only). The WhatsApp Guard allows exactly that one and refuses every other.' });

  // The runtime waits longer than Guard, or it gives up on a call Guard is still making and sends the same thing again.
  const timeoutMs = services.timeoutMs === undefined ? DEFAULT_RUNTIME_TIMEOUT_MS : services.timeoutMs;
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs)) problems.push({ rule: "runtime-timeout-exceeds-guard", message: "services.timeoutMs in runtime.json must be a whole number of milliseconds." });
  else if (timeoutMs <= GUARD_UPSTREAM_TIMEOUT_MS) problems.push({ rule: "runtime-timeout-exceeds-guard", message: `services.timeoutMs is ${timeoutMs} ms, but Guard waits ${GUARD_UPSTREAM_TIMEOUT_MS} ms for the payment provider. The runtime must wait LONGER (use ${DEFAULT_RUNTIME_TIMEOUT_MS}), or it would give up on a payment Guard is still making and could send it again.` });

  if (panel.mode !== undefined && panel.mode !== "live") problems.push({ rule: "runtime-mode-live", message: `runtime.json says mode "${String(panel.mode)}". A deployed shop runs in "live" mode: every call goes through its Guards. ("fakes" runs the stand-ins inside the runtime, with no Guard in the way.)` });

  for (const [what, v] of [["payments", services.payments], ["calendar", services.calendar], ["messaging", services.messaging]] as const) {
    if (what === "calendar" && !hasCalendar) {
      // a template with no calendar has no calendar Guard and no calendar in its runtime: whatever runtime.json says about one (an old file, the panel's) is left out, and said
      if (v !== undefined) notes.push(`services.calendar: the ${kind.id} template has no calendar, so what runtime.json says there is left out of the generated config.`);
      continue;
    }
    if (isObj(v) && (v.baseUrl !== undefined || v.agentTokenFile !== undefined)) notes.push(`services.${what}: the bundle sets baseUrl and agentTokenFile itself (the shop's own Guard), so what runtime.json says there is not used.`);
  }

  let parser: { wire: string; model: string; timeoutMs?: number } | undefined;
  if (panel.parser !== undefined) {
    const p = isObj(panel.parser) ? panel.parser : {};
    if (p.wire !== server.model.wire) problems.push({ rule: "model-matches-guard", message: `runtime.json asks for the "${String(p.wire)}" wire, but this server's model Guard speaks "${server.model.wire}". Use "${server.model.wire}".` });
    else if (p.model !== server.model.model) problems.push({ rule: "model-matches-guard", message: `runtime.json asks for the model "${String(p.model)}", but this server's model Guard allows only "${server.model.model}" and would refuse every call. Use "${server.model.model}".` });
    else parser = { wire: p.wire as string, model: p.model as string, ...(typeof p.timeoutMs === "number" ? { timeoutMs: p.timeoutMs } : {}) };
    if (p.baseUrl !== undefined || p.agentTokenFile !== undefined) notes.push("parser: the bundle sets baseUrl and agentTokenFile itself (the server's model Guard).");
  }
  return { calendarId: calendarId as string, phoneNumberId: phoneNumberId as string, timeoutMs: timeoutMs as number, parser, tickSeconds: typeof panel.tickSeconds === "number" ? panel.tickSeconds : undefined };
}

/** The pathway's own check of a runtime config (server/config.ts). A parameter so a test can stand in for a pathway version that knows more. */
export type RuntimeValidator = (config: unknown, folder: string) => { ok: boolean; errors?: string[] };

/**
 * Fleet's button mode (B48): when fleet said `ai: "buttons"` for this shop, the GENERATED runtime config gets `"ai": "buttons"` (the template's runtime reads that
 * override and answers from menus with no AI; every limit still holds). It goes into the generated config only, never into the panel's runtime.json, which the
 * panel rewrites and whose checker refuses a key it does not know. And it goes in ONLY if the pathway's own validator accepts the key: a runtime that does not
 * know `ai` refuses to start, and a shop that cannot start is worse off than a shop that keeps its AI. Then the override is skipped and a note says so.
 */
export function withFleetAi(runtime: Record<string, unknown>, fleetAi: "buttons" | undefined, validate: RuntimeValidator, notes: string[]): Record<string, unknown> {
  if (fleetAi !== "buttons" || Object.keys(runtime).length === 0) return runtime;
  const withIt = { ...runtime, ai: "buttons" };
  if (validate(withIt, "/").ok) return withIt;
  if (validate(runtime, "/").ok) notes.push("fleet asked for button mode, but this template version does not know the ai setting yet, so the shop keeps its AI. Update the template, and the setting is written on the next deploy.");
  return runtime;
}

/**
 * The month's AI cap: when fleet said `model: "off"` for this shop, the GENERATED runtime config gets `"model": "off"` (the runtime leaves the language model out; the rules
 * and the decision model keep answering; every limit still holds). Like `ai` above: the generated config only, and only if the pathway's own validator accepts the key,
 * because a runtime that does not know it refuses to start. Then the shop keeps its model and a note says so.
 */
export function withFleetModel(runtime: Record<string, unknown>, fleetModel: "off" | undefined, validate: RuntimeValidator, notes: string[]): Record<string, unknown> {
  if (fleetModel !== "off" || Object.keys(runtime).length === 0) return runtime;
  const withIt = { ...runtime, model: "off" };
  if (validate(withIt, "/").ok) return withIt;
  if (validate(runtime, "/").ok) notes.push("fleet says this shop has used its AI allowance for the month, but this template version does not know the model setting yet, so the shop keeps its language model. Update the template, and the setting is written on the next deploy.");
  return runtime;
}

/** What the monthly report block is made from. */
export interface ReportFacts {
  /** "Divya, local partner": who the owner is told set the agent up (the shop's report.json, else the panel's attribution). */
  preparedBy: string;
  /** Fleet's answer: the Innovator badge on the message, the page and the certificate. */
  innovator: boolean;
  /** Where Caddy serves this shop's pages (reportBaseUrl). */
  pageBaseUrl: string;
  /** What the numbers were counted from: "live" only when the connection checks confirmed a live Razorpay account, otherwise test money. */
  source: "live" | "test-mode";
  /** The shop's id: the tenant of its record's ledger (B28), so the report is anchored under the same id the daily fingerprint uses. */
  tenant?: string;
}

/**
 * The monthly report to the owner on WhatsApp (B54): the GENERATED runtime config gets a `report` block, and the job (report/monthly-job.ts) is on for every shop the bundle
 * deploys, now that the link in the message opens (Caddy serves the shop's reports folder, generate/compose.ts). Like `ai` above it goes into the generated config only, and ONLY if
 * the pathway's own validator accepts it: a runtime from before the report refuses a `report` key as an unknown setting and would not start, and a shop that cannot start is worse
 * off than one that sends no report. Then the block is skipped and a note says so. The runtime reads `preparedBy` and `innovator` again whenever runtime.json changes.
 */
export function withReport(runtime: Record<string, unknown>, facts: ReportFacts, validate: RuntimeValidator, notes: string[]): Record<string, unknown> {
  if (Object.keys(runtime).length === 0) return runtime;
  const plain = { ...runtime, report: { preparedBy: facts.preparedBy, innovator: facts.innovator, pageBaseUrl: facts.pageBaseUrl, pagesDir: REPORTS_DIR, source: facts.source } };
  // the ledger tenant (B28) anchors the report to the record's head; a template version from before it would refuse the key, and then gets its report unanchored
  const withIt = facts.tenant ? { ...plain, report: { ...plain.report, tenant: facts.tenant } } : plain;
  const checked = validate(withIt, "/");
  if (checked.ok) return withIt;
  if (withIt !== plain && validate(plain, "/").ok) { notes.push("the monthly report is not anchored to the record's ledger: this template version does not know report.tenant. Update the pathway, and it is written on the next deploy."); return plain; }
  if (validate(runtime, "/").ok) notes.push(`the monthly report to the owner is not switched on for this shop: this template version did not accept the report setting${checked.errors?.[0] ? ` (${checked.errors[0]})` : ""}, so the shop starts without it. Update the pathway, and it is written on the next deploy.`);
  return runtime;
}

/** Plan one shop. `versions` are the bundle versions Guard will be given (raise them on every change; see state.ts). */
export function planShop(server: ServerConfig, shop: ShopFolder, versions: Partial<Record<GuardKind, number>> = {}, validate?: RuntimeValidator): ShopPlan {
  // The template is the one the shop's pathway.lock names (a lock that is missing is a problem readShop already said; Bookings is assumed until it is fixed).
  const template: Kind = kindFor(shop.lock?.pathway) ?? KINDS.bookings;
  const check: RuntimeValidator = validate ?? template.validateRuntimeConfig;
  const problems: Problem[] = shop.problems.map((message) => ({ rule: "shop-folder", message }));
  const notes: string[] = [];
  const facts = runtimeFacts(server, shop.runtime, shop.pins, problems, notes, template);
  const guards: GuardPlan[] = [];
  let runtime: Record<string, unknown> = {};

  if (shop.settings && problems.length === 0) {
    const identity = (kind: GuardKind) => ({ tenant: shop.name, name: `${shop.name}-${kind}`, version: versions[kind] ?? 1, reviewedBy: server.reviewedBy });
    const specs: Record<Exclude<GuardKind, "model">, LimitsSpec | undefined> = { razorpay: undefined, whatsapp: undefined, calendar: undefined };
    const kinds = guardsOf(template, shop.settings); // a UPI shop (B33) has no Razorpay Guard
    const razorpay = kinds.includes("razorpay");
    if (razorpay) { try { specs.razorpay = gatewaySpec(shop.settings, identity("razorpay"), server.approvalHours, server.limits.razorpayLinksPerHour, undefined, template.gatewaySpec); } catch (e) { problems.push({ rule: "razorpay-limits", message: (e as Error).message }); } }
    specs.whatsapp = whatsappSpec(identity("whatsapp"), { phoneNumberId: facts.phoneNumberId, messagesPerHour: server.limits.whatsappMessagesPerHour });
    if (template.guards.includes("calendar")) specs.calendar = calendarSpec(identity("calendar"), { calendarId: facts.calendarId, createdPerHour: server.limits.calendarEventsCreatedPerHour, deletedPerDay: server.limits.calendarEventsDeletedPerDay });
    for (const kind of kinds) {
      const spec = specs[kind];
      if (!spec) continue;
      const def = guardDef(kind);
      const approvers = kind === "razorpay" ? (shop.settings as { approvers?: ApproversSettings }).approvers : undefined;
      guards.push({ kind, service: names.guard(shop.name, kind), tenant: shop.name, deployment: `${shop.name}-${kind}`, def, upstream: upstreamOf(server, kind, def), spec, specText: stableJson(spec), ...(approvers ? { approvers } : {}) });
    }
    runtime = {
      mode: "live", host: "0.0.0.0", port: RUNTIME_PORT, dataDir: DATA_DIR,
      ...(facts.tickSeconds !== undefined ? { tickSeconds: facts.tickSeconds } : {}),
      services: {
        ...(razorpay ? { payments: { baseUrl: guardUrl(names.guard(shop.name, "razorpay")), agentTokenFile: `${SECRETS}/agent_razorpay` } } : {}),
        ...(template.guards.includes("calendar") ? { calendar: { baseUrl: guardUrl(names.guard(shop.name, "calendar")), calendarId: facts.calendarId, agentTokenFile: `${SECRETS}/agent_calendar` } } : {}),
        messaging: { baseUrl: guardUrl(names.guard(shop.name, "whatsapp")), phoneNumberId: facts.phoneNumberId, agentTokenFile: `${SECRETS}/agent_whatsapp` },
        timeoutMs: facts.timeoutMs,
      },
      ...(facts.parser ? { parser: { wire: facts.parser.wire, baseUrl: modelBaseUrl(server.model), model: facts.parser.model, agentTokenFile: `${SECRETS}/agent_model`, ...(facts.parser.timeoutMs !== undefined ? { timeoutMs: facts.parser.timeoutMs } : {}) } } : {}),
    };
    runtime = withFleetAi(runtime, shop.fleetAi, check, notes);
    runtime = withFleetModel(runtime, shop.fleetModel, check, notes);
    runtime = withReport(runtime, { preparedBy: shop.preparedBy, innovator: shop.innovator, pageBaseUrl: reportBaseUrl(server, shop.name), source: !razorpay || shop.pins.razorpay?.mode === "live" ? "live" : "test-mode", tenant: shop.name }, check, notes); // a UPI shop's money is the owner's real marks
    if (shop.preparedBySource === "default") notes.push(`nobody is named as having set ${shop.name} up (no shops/${shop.name}/report.json, no owner.json), so the owner's monthly message says "${DEFAULT_PREPARED_BY}". Name them with \`geometer shop add --prepared-by\`, or write {"schema": 1, "preparedBy": "Divya, local partner"} in shops/${shop.name}/report.json.`);
  }
  return { shop: shop.name, guards, runtime, notes, problems };
}

/** The server's one model Guard. Its tenant is the server; every shop's runtime is an agent of it. */
export function planModelGuard(server: ServerConfig, version = 1): GuardPlan {
  const def = guardDef("model", server.model);
  const spec = modelSpec({ tenant: server.id, name: `${server.id}-model`, version, reviewedBy: server.reviewedBy }, server.model);
  return { kind: "model", service: names.modelGuard, tenant: server.id, deployment: `${server.id}-model`, def, upstream: upstreamOf(server, "model", def), spec, specText: stableJson(spec) };
}
