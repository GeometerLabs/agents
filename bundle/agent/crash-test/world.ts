// One world for one crash-test situation: fresh stand-in services (Razorpay, Google Calendar and WhatsApp over HTTP, in front of the in-memory fakes), a fresh REAL Guard in front of
// each service the agent uses (the specs and guard.toml the deploy would make, compiled and run by the real geo-guard program), and a fresh copy of the builder's agent, started by its
// own command with the Guards' addresses in its environment. A situation plays the customer and the provider, makes something go wrong at a stand-in, and then reads two things that
// are not the agent: what the stand-ins hold (the payment links, the refunds, the calendar's events, the WhatsApp outbox) and what each Guard decided about each call the agent made.
//
// Every world is new because the stand-ins number their payments from one again, and a Guard remembers a refund whose outcome it does not know: reusing either would carry one
// situation into the next.
import { createFakePayments } from "../../../modules/payments/payments.ts";
import { createGuardClient } from "../../../modules/approvals/clients.ts";
import { systemClock } from "../../../modules/core/clock.ts";
import { signMeta } from "../../../modules/messaging/webhooks.ts";
import { signRazorpay } from "../../../modules/payments/providers/razorpay/webhook.ts";
import type { InboundMessage } from "../../../modules/messaging/messaging.ts";
import type { Payment, PaymentRequest, Refund } from "../../../modules/payments/payments.ts";
import { whatsappWebhookBody } from "../../../templates/commerce/bookings/standins/control.ts";
import { razorpayWebhookBody } from "../../../modules/payments/providers/razorpay/standin.ts";
import { startStandins } from "../../../templates/commerce/bookings/standins/server.ts";
import type { RunningStandins } from "../../../templates/commerce/bookings/standins/server.ts";
import type { CalendarEvent } from "../../../templates/commerce/bookings/src/adapters/calendar.ts";
import type { Settings } from "../../../templates/commerce/bookings/src/settings.ts";
import { names } from "../../generate/shop.ts";
import { createDesk } from "../../../modules/payments/owner-marked/desk.ts";
import type { Desk, DeskNotice } from "../../../modules/payments/owner-marked/desk.ts";
import { emptyMarkState } from "../../../modules/payments/owner-marked/ledger.ts";
import type { MarkState } from "../../../modules/payments/owner-marked/ledger.ts";
import { serveRaw } from "../../../modules/standins/http.ts";
import { paymentUpstreamOf } from "../folder.ts";
import type { GuardPlan } from "../../generate/shop.ts";
import type { ServerConfig } from "../../lib/server.ts";
import { typedText } from "../facts.ts";
import type { Approval, Decision } from "../facts.ts";
import type { AgentFolder, AgentUpstream } from "../folder.ts";
import { STANDIN_PROVIDER_AUTHORIZATION, credential, freeLocalPort, startRealGuard } from "../guard-process.ts";
import type { RealGuard } from "../guard-process.ts";
import { agentNames } from "../plan.ts";
import { NotDrivable, contractEnv, startAgent } from "./driver.ts";
import type { AgentProcess, ResolvedDriver } from "./driver.ts";

export const CUSTOMER = "+919811111111";
const digits = (n: string) => n.replace(/\D/gu, "");
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Everything a world is made from. */
export interface CrashPlan {
  name: string;
  folder: AgentFolder;
  settings: Settings;
  server: ServerConfig;
  guards: GuardPlan[];
  guardBinary: string;
  command: string;
  cwd: string;
  version?: string;
  driver: ResolvedDriver;
}

export interface WorldOptions {
  /** A provider that refuses a second payment link with the same reference (Razorpay does). Off for the situation where the first link's answer is lost, so a blind second try makes a second link. Default on. */
  uniqueReference?: boolean;
}

/** One call the agent made to a service, as the service's Guard decided it (GET /admin/decisions), oldest first in the lists below. */
export interface GuardCall {
  id: string;
  at: number;
  operation: string;
  outcome: "allow" | "deny" | "hold";
  /** Guard sent it on to the service. */
  dispatched: boolean;
  amountPaise?: number;
  paymentId?: string;
  reference?: string;
  reason: string;
}

export interface World {
  plan: CrashPlan;
  /** The stand-ins' own records. */
  standins: RunningStandins;
  customer: string;
  owner: string;
  uses: Record<AgentUpstream, boolean>;
  agent: AgentProcess;
  guards: Partial<Record<AgentUpstream, RealGuard>>;
  /** The customer writes. Rejects with NotDrivable if the agent does not take the message. */
  say(text: string, options?: { id?: string }): Promise<void>;
  /** The customer pays the link; the provider tells the agent (every event not yet sent, each signed). */
  pay(linkId: string): Promise<Payment>;
  /** The provider sends every event so far again, each signed: a late repeat. */
  repeatPaymentEvents(): Promise<void>;
  links(): PaymentRequest[];
  refunds(): Refund[];
  /** Everything the calendar holds. Nobody but the agent writes to it here (an event the agent made carries no booking reference, so the stand-in lists it as another party's). */
  events(): CalendarEvent[];
  /** The texts the WhatsApp stand-in was given to send to the customer, oldest first. */
  toCustomer(): string[];
  /** What the Guard of this service decided about the agent's calls, oldest first. */
  calls(kind: AgentUpstream): Promise<GuardCall[]>;
  approvals(): Promise<Approval[]>;
  /** The owner says yes to a held refund, signed with the owner's secret, to Guard's admin port. */
  approve(approvalId: string): Promise<boolean>;
  /** Wait until nothing new has happened at any Guard or stand-in for a moment (and, if `from` is given, until something has). */
  settle(from?: string): Promise<void>;
  /** A number that changes whenever the agent, a Guard or a stand-in does anything. */
  activity(): Promise<string>;
  until(condition: () => boolean | Promise<boolean>, ms?: number): Promise<boolean>;
  /** The agent is still running. */
  alive(): boolean;
  /** An agent that takes UPI: the desk it calls, its state, and what it told the owner. The owner marks with `ownerMarks`. */
  desk?: { desk: Desk; state: MarkState; notices: DeskNotice[]; entries: { action: string; outcome: string }[] };
  /** The owner taps Received for this request's code (or, given one, sends that code again). Returns what the desk made of it. */
  ownerMarks(requestId: string, code?: string): Promise<string>;
  close(): Promise<void>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export async function buildWorld(plan: CrashPlan, options: WorldOptions = {}): Promise<World> {
  const { name, folder, settings, driver } = plan;
  const agentFile = folder.agent!;
  const uses: Record<string, boolean> = Object.fromEntries(agentFile.upstreams.map((u) => [u, true]));
  const paying = paymentUpstreamOf(agentFile.upstreams);
  const phoneNumberId = agentFile.whatsapp?.phoneNumberId ?? "100000000000001";
  const calendarId = agentFile.calendar?.calendarId;
  const secrets = { whatsapp: `crash-test-app-secret-${credential().token.slice(0, 12)}`, razorpay: `crash-test-webhook-secret-${credential().token.slice(0, 12)}` };
  const closers: (() => Promise<void>)[] = [];
  const close = async () => { await Promise.all(closers.map((c) => c().catch(() => undefined))); };
  try {
    const standins = await startStandins({
      razorpayWebhookSecret: secrets.razorpay, whatsappAppSecret: secrets.whatsapp, phoneNumberId, ...(calendarId ? { calendarId } : {}),
      fakes: { payments: createFakePayments(systemClock, { enforceUniqueReference: options.uniqueReference !== false }) },
    }, { port: 0 });
    closers.push(() => standins.close());
    const cred = credential();
    const guards: Partial<Record<AgentUpstream, RealGuard>> = {};
    for (const kind of agentFile.upstreams) {
      if (!uses[kind] || (paying?.ownerMarked && kind === paying.id)) continue; // an owner-marked module's Guard is in front of the desk, started below with it
      const g = plan.guards.find((x) => x.kind === kind);
      if (!g) throw new Error(`There is no ${kind} Guard in the plan for ${name}.`);
      const real = await startRealGuard({
        binary: plan.guardBinary, def: g.def, spec: g.spec, tenant: name, deployment: g.deployment, upstreamPort: standins.port,
        agents: [{ id: agentNames.agentId(name), token: cred.token }], ...(kind === "razorpay" ? { approver: { id: names.approverId(name) } } : {}),
      });
      closers.push(real.stop);
      guards[kind] = real;
    }
    // UPI (B71): the desk on Geometer's side, as the agent will call it, with the agent's one credential. What it tells the owner is kept to read.
    let deskParts: World["desk"];
    let deskUrl: string | undefined;
    if (paying?.ownerMarked) {
      const state = emptyMarkState();
      const notices: DeskNotice[] = [];
      const entries: { action: string; outcome: string }[] = [];
      const desk = createDesk({ clock: systemClock, payment: settings.payment, owner: settings.owner.whatsapp, state, save: () => undefined, record: (e) => entries.push({ action: e.action, outcome: e.outcome }), tellOwner: async (n) => { notices.push(n); return true; }, labels: { received: "Received", refundSent: "Refund sent" } });
      // B71 part 2: as on a server, the agent reaches the desk through the desk's own Guard (its credential, the deposit and refund bounds, the day's caps), and only
      // that Guard reaches the desk, with the key it holds (here the stand-in key every Guard of the crash test sends)
      const served = await serveRaw(async (r) => (r.headers.authorization === STANDIN_PROVIDER_AUTHORIZATION ? desk.handle(r.method, r.path, r.query, r.body) : { status: 401, body: { error: "the desk's Guard's key is needed" } }));
      closers.push(() => served.close());
      const g = plan.guards.find((x) => x.kind === paying.id);
      if (!g) throw new Error(`There is no ${paying.id} desk Guard in the plan for ${name}.`);
      const real = await startRealGuard({ binary: plan.guardBinary, def: g.def, spec: g.spec, tenant: name, deployment: g.deployment, upstreamPort: served.port, agents: [{ id: agentNames.agentId(name), token: cred.token }] });
      closers.push(real.stop);
      guards[paying.id] = real;
      deskParts = { desk, state, notices, entries };
      deskUrl = real.agentUrl;
    }
    const port = await freeLocalPort();
    const agent = await startAgent({
      command: plan.command, cwd: plan.cwd, port, startMs: driver.startMs,
      env: contractEnv({
        port, razorpay: guards.razorpay?.agentUrl, ...(deskUrl ? { upi: deskUrl } : {}), calendar: guards.calendar?.agentUrl, whatsapp: guards.whatsapp?.agentUrl, credential: cred.token, calendarId, phoneNumberId,
        whatsappAppSecret: secrets.whatsapp, razorpayWebhookSecret: secrets.razorpay, depositInr: settings.deposit.amountInr, priceInr: settings.services[0].priceInr,
        ownerWhatsapp: settings.owner.whatsapp, version: plan.version ?? agentFile.version, retryMs: 300,
      }),
    });
    closers.push(() => agent.stop());

    const fakes = standins.fakes;
    const owner = settings.owner.whatsapp;
    const agentId = agentNames.agentId(name);
    const timeout = driver.situationMs;

    const adminGet = async (kind: AgentUpstream, path: string): Promise<unknown> => {
      const g = guards[kind];
      if (!g) return null;
      try {
        const r = await fetch(`${g.adminUrl}${path}`, { headers: { authorization: `Bearer ${g.adminToken}`, accept: "application/json" }, signal: AbortSignal.timeout(5000) });
        return r.ok ? await r.json() : null;
      } catch { return null; }
    };

    const post = async (path: string, headers: Record<string, string>, body: string, what: string): Promise<void> => {
      let status: number;
      try {
        const r = await fetch(`${agent.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body, signal: AbortSignal.timeout(timeout) });
        await r.arrayBuffer().catch(() => undefined);
        status = r.status;
      } catch (e) {
        if (!agent.alive()) throw new NotDrivable(`the agent stopped while ${what} was being sent to it${agent.output() ? ` (it printed: ${agent.output()})` : ""}`);
        throw new NotDrivable(`the agent did not answer ${what} at ${path} (${(e as Error).name === "TimeoutError" ? `no answer in ${Math.round(timeout / 1000)} seconds` : (e as Error).message})`);
      }
      if (status === 404 || status === 405) throw new NotDrivable(`the agent has nothing at ${path} (HTTP ${status}), so ${what} could not be sent to it. If it takes them somewhere else, say where in agent.json (driver)`);
      if (status === 401 || status === 403) throw new NotDrivable(`the agent refused ${what} at ${path} (HTTP ${status}). It has to check the signature with the secret in its environment (${path === driver.razorpayPath ? "GEOMETER_RAZORPAY_WEBHOOK_SECRET" : "GEOMETER_WHATSAPP_APP_SECRET"}); the run command can pass it on under the name the agent reads`);
      if (status >= 300) throw new NotDrivable(`the agent answered HTTP ${status} to ${what} at ${path}`);
    };

    let delivered = 0;
    const deliverEvents = async (all: boolean): Promise<void> => {
      const events = fakes.payments.events.slice(all ? 0 : delivered);
      delivered = fakes.payments.events.length;
      for (const event of events) {
        const body = razorpayWebhookBody(event, fakes.payments);
        await post(driver.razorpayPath, { "x-razorpay-signature": signRazorpay(Buffer.from(body), secrets.razorpay), "x-razorpay-event-id": event.id }, body, "a payment event");
      }
    };

    const decisionsOf = async (kind: AgentUpstream): Promise<Decision[]> => {
      const body = await adminGet(kind, "/admin/decisions?limit=500");
      const list = isObj(body) && Array.isArray(body.decisions) ? body.decisions as Decision[] : [];
      return list.filter((d) => d.principal?.workload === agentId).reverse();
    };
    const toCall = (d: Decision): GuardCall => {
      const amount = Number(typedText(d.arguments.amount));
      return {
        id: d.id, at: Number(d.at_ms), operation: d.operation, outcome: d.outcome, dispatched: d.dispatched === true,
        ...(Number.isFinite(amount) ? { amountPaise: amount } : {}), ...(typedText(d.arguments.payment_id) ? { paymentId: typedText(d.arguments.payment_id) } : {}),
        ...(typedText(d.arguments.reference_id) ? { reference: typedText(d.arguments.reference_id) } : {}), reason: (d.reasons ?? []).join(" | "),
      };
    };

    const world: World = {
      plan, standins, customer: CUSTOMER, owner, uses, agent, guards,
      async say(text, o = {}) {
        // the customer wrote first, so the 24-hour window is open for the agent's answer under either spelling of the number
        const message: InboundMessage = fakes.messaging.receive(CUSTOMER, text, o.id ? { id: o.id } : {});
        fakes.messaging.receive(digits(CUSTOMER), text);
        const body = whatsappWebhookBody(message, phoneNumberId);
        await post(driver.whatsappPath, { "x-hub-signature-256": signMeta(Buffer.from(body), secrets.whatsapp) }, body, "the customer's message");
      },
      async pay(linkId) {
        const payment = fakes.payments.customerPays(linkId);
        await deliverEvents(false);
        return payment;
      },
      repeatPaymentEvents: () => deliverEvents(true),
      links: () => fakes.payments.links(),
      refunds: () => fakes.payments.refunds(),
      events: () => fakes.calendar.events(),
      toCustomer: () => fakes.messaging.outbox().filter((m) => digits(m.to) === digits(CUSTOMER)).map((m) => m.text),
      async calls(kind) { return (await decisionsOf(kind)).map(toCall); },
      async approvals() {
        const body = await adminGet("razorpay", "/admin/approvals");
        return isObj(body) && Array.isArray(body.approvals) ? body.approvals as Approval[] : [];
      },
      async approve(approvalId) {
        const g = guards.razorpay;
        if (!g?.ownerSecret) return false;
        const client = createGuardClient({ adminUrl: g.adminUrl, readToken: "not-used", approverId: names.approverId(name), approverSecret: g.ownerSecret, now: () => Date.now() });
        const result = await client.notify(approvalId, "approve");
        return result.kind === "recorded" || result.kind === "already";
      },
      async activity() {
        const newest = await Promise.all((["razorpay", "whatsapp", "calendar"] as const).filter((k) => guards[k]).map(async (k) => {
          const body = await adminGet(k, "/admin/decisions?limit=1");
          return isObj(body) && Array.isArray(body.decisions) ? String((body.decisions[0] as Decision | undefined)?.id ?? "") : "?";
        }));
        return [...newest, JSON.stringify(deskParts?.state ?? null).length, fakes.payments.calls.length, fakes.calendar.calls.length, fakes.messaging.outbox().length, fakes.payments.events.length].join("|");
      },
      async settle(from) {
        const started = Date.now();
        const deadline = started + timeout;
        let last = await world.activity();
        let changedAt = Date.now();
        let moved = from === undefined || last !== from;
        while (Date.now() < deadline) {
          await sleep(100);
          const now = await world.activity();
          if (now !== last) { last = now; changedAt = Date.now(); moved = true; }
          // quiet for most of a second after something happened; if nothing happens at all for a few seconds, there is nothing to wait for
          else if (moved && Date.now() - changedAt >= 800) return;
          else if (!moved && Date.now() - started >= 4000) return;
        }
      },
      async until(condition, ms = timeout) {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          if (await condition()) return true;
          await sleep(100);
        }
        return await condition();
      },
      alive: () => agent.alive(),
      ...(deskParts ? { desk: deskParts } : {}),
      async ownerMarks(requestId, code) {
        if (!deskParts) throw new Error("This agent does not take UPI.");
        const r = deskParts.state.requests.find((x) => x.id === requestId);
        const use = code ?? r?.code ?? undefined;
        if (!use) return "unknown";
        return deskParts.desk.ownerSays({ from: settings.owner.whatsapp, text: `received ${use}` });
      },
      close,
    };
    return world;
  } catch (e) {
    await close();
    throw e;
  }
}
