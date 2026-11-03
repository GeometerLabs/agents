// One shop, planned: from its settings and runtime.json to the specs for its three Guards and the runtime config its container will read.
// This file is pure (no files, no Docker, no clock), so every rule that can refuse a deploy is tested without a machine.
import type { LimitsSpec } from "../../pathways/bookings/src/guard-limits.ts";
import type { ModelConfig, PanelRuntime, ServerConfig, ShopFolder, Upstream } from "../lib/server.ts";
import { stableJson } from "../lib/util.ts";
import type { Problem } from "../lib/util.ts";
import { GUARD_UPSTREAM_TIMEOUT_MS, calendarSpec, guardDef, modelPath, modelSpec, razorpaySpec, whatsappSpec } from "./guards.ts";
import type { GuardDef, GuardKind } from "./guards.ts";

/** What the runtime waits for a call when runtime.json says nothing: longer than Guard's own wait for the provider. */
export const DEFAULT_RUNTIME_TIMEOUT_MS = 20_000;

/** Names of everything a shop owns, in one place. */
export const names = {
  net: (shop: string) => `net-${shop}`,
  runtime: (shop: string) => `rt-${shop}`,
  guard: (shop: string, kind: GuardKind) => `g-${shop}-${kind}`,
  forwarder: (shop: string, kind: GuardKind) => `fwd-${shop}-${kind}`,
  dataVolume: (shop: string) => `rt-data-${shop}`,
  stateVolume: (shop: string, kind: GuardKind) => `gs-${shop}-${kind}`,
  /** The model Guard is one per server. */
  modelGuard: "g-model",
  modelStateVolume: "gs-model",
  agentId: (shop: string) => `runtime-${shop}`,
  relayAgentId: (shop: string) => `relay-${shop}`,
  approverId: (shop: string) => `owner-${shop}`,
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

const upstreamOf = (server: ServerConfig, kind: GuardKind, def: GuardDef): Upstream => server.upstreams?.[kind] ?? { host: def.upstream, tls: true };

/** The model's address for a runtime: the Guard's base, plus whatever the provider puts before /chat/completions. */
export function modelBaseUrl(model: ModelConfig): string {
  const path = modelPath(model);
  return `${guardUrl(names.modelGuard)}${model.wire === "openai" ? path.replace(/\/chat\/completions$/u, "") : ""}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The pieces of runtime.json the generator needs, checked. */
function runtimeFacts(server: ServerConfig, panel: PanelRuntime, problems: Problem[], notes: string[]) {
  const services = isObj(panel.services) ? panel.services : {};
  const calendarId = isObj(services.calendar) ? services.calendar.calendarId : undefined;
  const phoneNumberId = isObj(services.messaging) ? services.messaging.phoneNumberId : undefined;
  if (typeof calendarId !== "string" || calendarId.trim() === "") problems.push({ rule: "calendar-id", message: 'runtime.json needs services.calendar.calendarId: the shop\'s own Google calendar. The calendar Guard allows exactly that one and refuses every other.' });
  if (typeof phoneNumberId !== "string" || !/^\d{6,20}$/u.test(phoneNumberId)) problems.push({ rule: "whatsapp-number-id", message: 'runtime.json needs services.messaging.phoneNumberId: the shop\'s own WhatsApp phone number id (digits only). The WhatsApp Guard allows exactly that one and refuses every other.' });

  // The runtime waits longer than Guard, or it gives up on a call Guard is still making and sends the same thing again.
  const timeoutMs = services.timeoutMs === undefined ? DEFAULT_RUNTIME_TIMEOUT_MS : services.timeoutMs;
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs)) problems.push({ rule: "runtime-timeout-exceeds-guard", message: "services.timeoutMs in runtime.json must be a whole number of milliseconds." });
  else if (timeoutMs <= GUARD_UPSTREAM_TIMEOUT_MS) problems.push({ rule: "runtime-timeout-exceeds-guard", message: `services.timeoutMs is ${timeoutMs} ms, but Guard waits ${GUARD_UPSTREAM_TIMEOUT_MS} ms for the payment provider. The runtime must wait LONGER (use ${DEFAULT_RUNTIME_TIMEOUT_MS}), or it would give up on a payment Guard is still making and could send it again.` });

  if (panel.mode !== undefined && panel.mode !== "live") problems.push({ rule: "runtime-mode-live", message: `runtime.json says mode "${String(panel.mode)}". A deployed shop runs in "live" mode: every call goes through its Guards. ("fakes" runs the stand-ins inside the runtime, with no Guard in the way.)` });

  for (const [what, v] of [["payments", services.payments], ["calendar", services.calendar], ["messaging", services.messaging]] as const) {
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

/** Plan one shop. `versions` are the bundle versions Guard will be given (raise them on every change; see state.ts). */
export function planShop(server: ServerConfig, shop: ShopFolder, versions: Partial<Record<GuardKind, number>> = {}): ShopPlan {
  const problems: Problem[] = shop.problems.map((message) => ({ rule: "shop-folder", message }));
  const notes: string[] = [];
  const facts = runtimeFacts(server, shop.runtime, problems, notes);
  const guards: GuardPlan[] = [];
  let runtime: Record<string, unknown> = {};

  if (shop.settings && problems.length === 0) {
    const identity = (kind: GuardKind) => ({ tenant: shop.name, name: `${shop.name}-${kind}`, version: versions[kind] ?? 1, reviewedBy: server.reviewedBy });
    const specs: Record<Exclude<GuardKind, "model">, LimitsSpec | undefined> = { razorpay: undefined, whatsapp: undefined, calendar: undefined };
    try { specs.razorpay = razorpaySpec(shop.settings, identity("razorpay"), server.approvalHours); } catch (e) { problems.push({ rule: "razorpay-limits", message: (e as Error).message }); }
    specs.whatsapp = whatsappSpec(identity("whatsapp"), { phoneNumberId: facts.phoneNumberId, messagesPerHour: server.limits.whatsappMessagesPerHour });
    specs.calendar = calendarSpec(identity("calendar"), { calendarId: facts.calendarId, createdPerHour: server.limits.calendarEventsCreatedPerHour, deletedPerDay: server.limits.calendarEventsDeletedPerDay });
    for (const kind of ["razorpay", "whatsapp", "calendar"] as const) {
      const spec = specs[kind];
      if (!spec) continue;
      const def = guardDef(kind);
      guards.push({ kind, service: names.guard(shop.name, kind), tenant: shop.name, deployment: `${shop.name}-${kind}`, def, upstream: upstreamOf(server, kind, def), spec, specText: stableJson(spec) });
    }
    runtime = {
      mode: "live", host: "0.0.0.0", port: RUNTIME_PORT, dataDir: "/home/node/data",
      ...(facts.tickSeconds !== undefined ? { tickSeconds: facts.tickSeconds } : {}),
      services: {
        payments: { baseUrl: guardUrl(names.guard(shop.name, "razorpay")), agentTokenFile: `${SECRETS}/agent_razorpay` },
        calendar: { baseUrl: guardUrl(names.guard(shop.name, "calendar")), calendarId: facts.calendarId, agentTokenFile: `${SECRETS}/agent_calendar` },
        messaging: { baseUrl: guardUrl(names.guard(shop.name, "whatsapp")), phoneNumberId: facts.phoneNumberId, agentTokenFile: `${SECRETS}/agent_whatsapp` },
        timeoutMs: facts.timeoutMs,
      },
      ...(facts.parser ? { parser: { wire: facts.parser.wire, baseUrl: modelBaseUrl(server.model), model: facts.parser.model, agentTokenFile: `${SECRETS}/agent_model`, ...(facts.parser.timeoutMs !== undefined ? { timeoutMs: facts.parser.timeoutMs } : {}) } } : {}),
    };
  }
  return { shop: shop.name, guards, runtime, notes, problems };
}

/** The server's one model Guard. Its tenant is the server; every shop's runtime is an agent of it. */
export function planModelGuard(server: ServerConfig, version = 1): GuardPlan {
  const def = guardDef("model", server.model);
  const spec = modelSpec({ tenant: server.id, name: `${server.id}-model`, version, reviewedBy: server.reviewedBy }, server.model);
  return { kind: "model", service: names.modelGuard, tenant: server.id, deployment: `${server.id}-model`, def, upstream: upstreamOf(server, "model", def), spec, specText: stableJson(spec) };
}
