// The part of a crash-test world that is the same for every template on Go (owner, 24 Nov 2026: "Run the hand check on Go"). A world is ONE shop: the template's Go program
// started on the shop's own settings by go-shop.ts, in front of the template's stand-ins (the gateway's, WhatsApp's and, for Bookings, Google Calendar's wire formats over the
// in-memory fakes) and, in front of the refunds, the stub Guard (modules/standins/guard.ts, built from the limits spec the deployer generates from the same settings). Each
// template's crash-test/go-world.ts adds what is its own (an order's link, a parent's fee) on top of this.
//
// The situations judge from the fakes' own records (what the payments service, the calendar and the WhatsApp outbox hold) and from the program's agent.db, never from what the
// program said it did. What a step does here, and why:
//   * `say`, `tap`, `ownerSays`, `redeliver` post the message to /internal/events, as the inbox does, and wait until the shop's queue is empty; the stand-in WhatsApp is told
//     first (`receive`), so its 24-hour window opens as the provider's would;
//   * `deliverPaymentEvents` reads the payment service's new events as the inbox reads a Razorpay webhook (parseRazorpayEvent) and posts them as `payment_event`s;
//   * `advance`, `goto` and `tick` move the shop's test clock and wait for a beat of its clock to end (the program beats every second; nothing ticks it from outside);
//   * `store` and `record` are read from agent.db, read-only, after each step (the same file the TypeScript runtime wrote, read with its readers);
//   * the router's models (`models`) are stand-ins over HTTP the program reaches through runtime.json `decision` and `parser`, as a shop reaches its model Guard; the program's
//     rules always read first, as on a real shop;
//   * `ownerAnswers` is the approvals relay: Guard records the owner's decision, then the shop is told with an `approval_decision` event.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { assistantSettingsJson } from "../assistant/settings.ts";
import type { Clock } from "../core/clock.ts";
import { createFakeMessaging } from "../messaging/messaging.ts";
import type { FakeMessaging, InboundMessage } from "../messaging/messaging.ts";
import { createFakePayments } from "../payments/payments.ts";
import type { FakePayments, FakePaymentsOptions } from "../payments/payments.ts";
import type { LimitsSpec } from "../payments/guard-limits.ts";
import { razorpayWebhookBody } from "../payments/providers/razorpay/standin.ts";
import { parseRazorpayEvent } from "../payments/providers/razorpay/webhook.ts";
import { startStubGuard } from "../standins/guard.ts";
import type { RunningStubGuard } from "../standins/guard.ts";
import { LostReply, serveHandlers } from "../standins/http.ts";
import type { Handler } from "../standins/http.ts";
import { startFakeModel, statusReply } from "../test/contract/fake-model.ts";
import { goProgram, startGoShop } from "./go-shop.ts";
import { closeLater } from "./situations.ts";
import type { GoShop, MovableClock } from "./go-shop.ts";

/** The router's two models as stand-ins over HTTP (see `GoWorldBaseOptions.models`). */
export interface Models {
  /** Answers System One's POST /v1/systemone (modules/standins/system-one.ts systemOneStandin's handler). */
  decision?: Handler;
  /** Writes the language model's answer for the customer's words (or a FakeReply of modules/test/contract/fake-model.ts: a model that fails or is slow). */
  model?: (words: string) => unknown;
  /** While true, both fail as a model that cannot be reached does. */
  down?: () => boolean;
  /** The languages the decision model reads (runtime.json decision.languages); left out, the program's own default. */
  languages?: string[];
}

/** The services a template's stand-ins serve, started on the world's clock with the world's fakes. */
export interface StandinsServer { url: string; close(): Promise<void> }

export interface GoWorldBaseOptions<Settings> {
  /** The program (go/cmd/<name>) and the template version it serves (pathway.lock). */
  program: string;
  version: string;
  settings: Settings;
  /** The shop's time when it starts. */
  at: number;
  /** The customer a step is from when it names none. */
  customer: string;
  /** Start the template's stand-ins on this clock, in front of these fakes (each template's standins/server.ts). */
  standins: (clock: Clock, fakes: { payments: FakePayments; messaging: FakeMessaging }) => Promise<StandinsServer>;
  /** The limits spec the deployer generates from the settings (src/guard-limits.ts gatewayLimitsSpec): the stub Guard holds and refuses by it. Made only for a shop with a gateway (the deployer makes none for a UPI shop). */
  spec?: () => LimitsSpec;
  /** The shop has a payment gateway (a UPI shop has none: the owner marks payments). */
  gateway: boolean;
  /** More services to name in runtime.json beside payments and messaging (Bookings' calendar), given the stand-ins' address. */
  services?: (standinsUrl: string) => Record<string, { baseUrl: string; [member: string]: unknown }>;
  payments?: FakePaymentsOptions;
  models?: Models;
  runtime?: Record<string, unknown>;
  /** licence.json as the deployer writes it before the first start. */
  licence?: unknown;
  /** The situation makes the provider refuse sends on purpose (a template it says is not approved), so a refused send is not a failure of its own. */
  sendFailuresPlanned?: boolean;
  /** Read the template's saved state (its server/snapshot.ts parseStore). */
  parseStore: (json: string) => any;
  /** The template's empty state (its createStore): what the shop holds before its first step has saved anything. */
  emptyStore: () => any;
  /** The template's own settings check (its parseSettings): the file the program is given must read back as exactly these settings. */
  parseSettings: (raw: unknown) => Settings;
  /** settings.json for parsed settings, where the file's shape is not the parsed one (Fees' students name their batch as `batch`). Left out: `settingsJson`. */
  settingsFile?: (settings: Settings) => Record<string, unknown>;
}

/** JSON with every object's members in name order, so two values with the same members compare equal whatever order they were made in. */
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

export interface GoWorldBase<Settings, Store> {
  settings: Settings;
  clock: MovableClock;
  payments: FakePayments;
  messaging: FakeMessaging;
  /** The stub Guard in front of the gateway: its model holds what is above the limit. None for a shop with no gateway (UPI). */
  guard: RunningStubGuard | undefined;
  /** The record's lines, as agent.db keeps them. */
  record: { entries(): any[] };
  /** The shop's saved state, read from agent.db. */
  readonly store: Store;
  owner: string;
  shop: GoShop;
  /** How many times each model was asked, answered or not. */
  asked: { decision: number; model: number };
  /** Someone writes (or, with `reply`, taps a button as WhatsApp reports it: its id and title). */
  say(text: string, options?: { from?: string; id?: string; image?: boolean; reply?: { id: string; kind: "button" | "list" } }): Promise<InboundMessage>;
  tap(id: string, options?: { from?: string }): Promise<InboundMessage>;
  ownerSays(text: string, options?: { id?: string }): Promise<InboundMessage>;
  redeliver(message: InboundMessage): Promise<void>;
  deliverPaymentEvents(options?: { twice?: boolean }): Promise<void>;
  advance(minutes: number): Promise<void>;
  tick(): Promise<void>;
  /** The approvals relay carries the owner's answer: Guard records it, then the shop is told. Without an id it is the only refund waiting. */
  ownerAnswers(decision: "approve" | "deny", approval?: string): Promise<void>;
  /** The same answer reaching the shop again (the relay sent it twice); Guard is not asked again. */
  answerArrivesAgain(decision: "approve" | "deny", approval: string): Promise<void>;
  heldForOwner(): { id: string; amountPaise: number; paymentId: string; receipt: string }[];
  /** The amounts (paise) the shop asked to refund, as they reached Guard's door (Guard refuses some before the service sees them). */
  refundsAsked(): number[];
  textsTo(number: string): string[];
  lastTextTo(number: string): string;
  writeLicence(licence: unknown): void;
  /** Wait until `done()` holds (the program works on its own beat, as at its first start), up to `ms`; throws naming `what` when it never does. */
  waitFor(what: string, done: () => boolean, ms?: number): Promise<void>;
  /** The UPI QR pictures the program wrote into its pages folder: `get(address)` the bytes of the picture it sent at that address, `size` how many it wrote. */
  qrImages: { get(address: string): Buffer | undefined; readonly size: number };
}

/** settings.json for parsed settings, as the Operator's form writes it (the assistant block back in its file shape, as each crash test's withSettings does). */
export function settingsJson(settings: unknown): Record<string, unknown> {
  const raw = JSON.parse(JSON.stringify(settings)) as Record<string, unknown>;
  const assistant = (settings as { assistant?: unknown }).assistant;
  if (assistant) raw.assistant = assistantSettingsJson(assistant as never);
  return raw;
}

/**
 * A value of the shop's saved state that is read again at every use: `live(() => w.orderOf(x))`. The demo engine's world handed out its live objects, so a situation could keep
 * one and read it after the next step; the program's state is read from agent.db, so a kept copy would be the state of when it was read. Reading through this keeps the
 * situation's words and always reads now. Throws, naming nothing, when the value is gone (a situation that reads a case that does not exist fails rather than reads undefined).
 */
export function live<T extends object>(read: () => T | undefined): T {
  return new Proxy({} as T, { get: (_t, key) => { const v = read(); if (v === undefined) throw new Error("the value read from the shop's saved state is not there"); return (v as Record<PropertyKey, unknown>)[key]; } });
}

/**
 * Two PNG files show the same picture: the same header (IHDR) and the same scanlines once decompressed. The Go program's QR picture is the TypeScript's picture but not its
 * bytes (go/internal/qr/image.go: Go's zlib writes other bytes for the same scanlines), so a situation compares pictures, not files.
 */
export function samePicture(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (!a || !b) return false;
  const read = (png: Uint8Array): { header: string; pixels: string } | undefined => {
    const buf = Buffer.from(png);
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return undefined;
    let header = "";
    const idat: Buffer[] = [];
    for (let at = 8; at + 8 <= buf.length;) {
      const length = buf.readUInt32BE(at);
      const type = buf.toString("latin1", at + 4, at + 8);
      const data = buf.subarray(at + 8, at + 8 + length);
      if (type === "IHDR") header = data.toString("hex");
      if (type === "IDAT") idat.push(data);
      at += 12 + length;
    }
    try { return { header, pixels: inflateSync(Buffer.concat(idat)).toString("hex") }; } catch { return undefined; }
  };
  const x = read(a);
  const y = read(b);
  return !!x && !!y && x.header !== "" && x.header === y.header && x.pixels === y.pixels;
}

/**
 * A test that needs the record of every world a run makes (each template's test/accounting-figures.test.ts: the books against the report's sums over every situation's record)
 * sets `closing`; it is called with each world's settings and record lines just before the world closes. Nothing else uses it.
 */
export const goWorldHook: { closing?: (world: { settings: unknown; entries: any[] }) => void } = {};

const PHONE_NUMBER_ID = "100000000000001";
const PAGES = "https://reports.example.com/r";

/** Start a world. It is closed when the situation that made it ends (situations.ts closeLater). Throws when the program is not there: runOnProgram checks first. */
export async function openGoWorld<Settings extends { owner: { whatsapp: string } }, Store>(o: GoWorldBaseOptions<Settings>): Promise<GoWorldBase<Settings, Store>> {
  const program = goProgram(o.program);
  if (!program.ok) throw new Error(program.reason);
  // the program runs on a settings.json made from the settings the situation planned with: it must read back as exactly those, or the run would not be on this shop's settings
  const file = (o.settingsFile ?? settingsJson)(o.settings);
  if (canonical(o.parseSettings(file)) !== canonical(o.settings)) throw new Error("The settings file made for the program does not read back as the shop's own settings, so the situation was not run on them.");
  // the stand-ins read the shop's clock (go-shop.ts makes it with the shop); until the shop exists, the start instant
  let clock: MovableClock = { now: () => o.at, set: () => undefined, advanceMinutes: () => undefined };
  const viaShop: Clock = { now: () => clock.now() };
  const payments = createFakePayments(viaShop, o.payments ?? {});
  const messaging = createFakeMessaging(viaShop);
  const agentToken = randomBytes(16).toString("hex");
  const closers: (() => Promise<void>)[] = [];
  let shop: GoShop | undefined;
  // a send the provider refused is a failure of the situation unless the situation planned one (a fault put on the stand-in WhatsApp, or a template it was told is not
  // approved): "nothing was sent to the owner" must not pass because a send failed. Read from the record as the world closes.
  let sendFaultsPlanned = o.sendFailuresPlanned === true;
  const inject = messaging.inject.bind(messaging);
  messaging.inject = ((...a: Parameters<typeof inject>) => { sendFaultsPlanned = true; return inject(...a); }) as typeof inject;
  closeLater(async () => {
    const lines = shop ? shop.record() : [];
    if (shop && goWorldHook.closing) goWorldHook.closing({ settings: o.settings, entries: lines });
    await shop?.close();
    for (const c of closers.reverse()) await c();
    return sendFaultsPlanned ? [] : lines.filter((e) => e.action === "send_message" && e.outcome === "failed").map((e) => `a message ${e.refs?.to ? `to the ${e.refs.to} ` : ""}was refused by the provider: ${String(e.notes ?? "").slice(0, 160)}`);
  });
  const standins = await o.standins(viaShop, { payments, messaging });
  closers.push(() => standins.close());
  // a shop with a gateway reaches it through Guard: the stub Guard holds and refuses by the shop's own limits. A UPI shop has no gateway and so no payments Guard.
  const guard = o.gateway && o.spec ? await startStubGuard({
    clock: viaShop, upstreamUrl: standins.url, spec: o.spec(), agentToken,
    approver: { id: "owner", secret: randomBytes(16).toString("hex") }, readToken: randomBytes(16).toString("hex"),
  }) : undefined;
  if (guard) closers.push(() => guard.close());
  const asked = { decision: 0, model: 0 };
  const down = o.models?.down ?? (() => false);
  const answer = o.models?.model;
  const model = answer ? await startFakeModel((words) => { asked.model++; return down() ? statusReply(503) : answer(words); }) : undefined;
  if (model) closers.push(() => model.close());
  const decide = o.models?.decision;
  // a decision model that is down cuts the connection (LostReply), as one that cannot be reached
  const decision = decide ? await serveHandlers([async (r) => { if (r.path.endsWith("/systemone")) { asked.decision++; if (down()) throw new LostReply(); } return decide(r); }]) : undefined;
  if (decision) closers.push(() => decision.close());

  shop = await startGoShop({
    program: program.path, pathway: o.program, version: o.version, settings: file, at: o.at, slug: "hand-check",
    services: {
      ...(guard ? { payments: { baseUrl: guard.agentUrl, agentToken } } : {}),
      ...(o.services?.(standins.url) ?? {}),
      messaging: { baseUrl: standins.url, phoneNumberId: PHONE_NUMBER_ID },
    },
    runtime: {
      ...(model ? { parser: { wire: "openai", baseUrl: `http://127.0.0.1:${model.port}/v1`, model: "stand-in-model", provider: "deepinfra", timeoutMs: 1000 } } : {}),
      ...(decision ? { decision: { provider: "laya", baseUrl: decision.url, model: "laya", timeoutMs: 1000, ...(o.models?.languages ? { languages: o.models.languages } : {}) } } : {}),
      ...(o.runtime ?? {}),
    },
    ...(o.licence !== undefined ? { files: { "licence.json": o.licence } } : {}),
    report: true, // the monthly report's block: a report situation needs it, and a UPI shop writes its QR pictures into the same pages folder
  });
  clock = shop.clock;
  const s = shop;

  let deliveredEvents = 0;
  let inbound = 0;
  const handle = async (message: InboundMessage): Promise<void> => { await s.events([{ kind: "message", message }]); };
  const world: GoWorldBase<Settings, Store> = {
    settings: o.settings, clock, payments, messaging, guard, owner: o.settings.owner.whatsapp, shop: s, asked,
    record: { entries: () => s.record() },
    get store(): Store { const text = s.snapshot(); return (text === null ? o.emptyStore() : o.parseStore(text)) as Store; },
    async say(text, m = {}) {
      // a provider's message id is unique per message, as the inbox hands it on (unless the situation gives one)
      const message = messaging.receive(m.from ?? o.customer, text, { id: m.id ?? `wamid.hc_${++inbound}`, ...(m.image ? { image: true } : {}), ...(m.reply ? { reply: m.reply } : {}) });
      await handle(message);
      return message;
    },
    async tap(id, m = {}) {
      const from = m.from ?? o.customer;
      // the newest message that has this option on it: a customer can scroll up and tap an older button
      const shown = messaging.sentTo(from).filter((x) => x.interactive).reverse().map((x) => x.interactive!).find((i) => [...(i.buttons ?? []), ...(i.list?.rows ?? [])].some((c) => c.id === id));
      const option = [...(shown?.buttons ?? []), ...(shown?.list?.rows ?? [])].find((c) => c.id === id);
      if (!shown || !option) throw new Error(`No buttons or list ${from} was sent have an option with the id "${id}".`);
      const message = messaging.receive(from, option.title, { id: `wamid.hc_${++inbound}`, reply: { id, kind: shown.buttons ? "button" : "list" } });
      await handle(message);
      return message;
    },
    ownerSays: (text, m = {}) => world.say(text, { from: world.owner, ...m }),
    redeliver: (message) => handle(message),
    async deliverPaymentEvents(d = {}) {
      const fresh = payments.events.slice(deliveredEvents);
      deliveredEvents = payments.events.length;
      // as the inbox reads a Razorpay webhook (it checked the signature; the runtime never holds the secret): the provider's body, then the neutral event
      for (const e of fresh) {
        const event = parseRazorpayEvent(JSON.parse(razorpayWebhookBody(e, payments)), e.id);
        if (!event) continue;
        await s.events([{ kind: "payment_event", event }]);
        if (d.twice) await s.events([{ kind: "payment_event", event }]);
      }
    },
    async advance(minutes) { clock.advanceMinutes(minutes); await s.tick(); },
    tick: () => s.tick(),
    async ownerAnswers(decision, approval) {
      const waiting = world.heldForOwner();
      const id = approval ?? (waiting.length === 1 ? waiting[0].id : undefined);
      if (!id) throw new Error(`ownerAnswers needs an approval id: ${waiting.length} refund(s) wait for the owner.`);
      if (!guard) throw new Error("This shop has no payments Guard (no gateway), so nothing waits for the owner there.");
      const decided = guard.model.decide(id, decision === "approve", "owner");
      if (decided.status !== 200) throw new Error(`Guard would not record that: ${JSON.stringify(decided)}`);
      await s.events([{ kind: "approval_decision", approval: id, decision }]);
    },
    async answerArrivesAgain(decision, approval) { await s.events([{ kind: "approval_decision", approval, decision }]); },
    heldForOwner: () => (guard?.model.reviews("owner", true) ?? []).map((r: any) => ({ id: r.id, amountPaise: Number(r.amount), paymentId: r.arguments[1].payment_id[1], receipt: r.arguments[1].receipt?.[1] ?? "" })),
    refundsAsked: () => (guard?.calls ?? []).filter((c) => c.method === "POST" && /\/refunds?$/u.test(c.path)).map((c) => { try { return Number(JSON.parse(c.body).amount); } catch { return NaN; } }),
    textsTo: (number) => messaging.sentTo(number).map((m) => m.text),
    lastTextTo: (number) => messaging.sentTo(number).at(-1)?.text ?? "",
    writeLicence: (licence) => s.writeFile("licence.json", licence),
    async waitFor(what, done, ms = 10_000) {
      const until = Date.now() + ms;
      while (!done()) {
        if (Date.now() > until) throw new Error(`${what} did not happen in ${ms / 1000} s`);
        await new Promise((r) => setTimeout(r, 50));
      }
      await s.settle();
    },
    qrImages: {
      get(address) {
        const m = new RegExp(`^${PAGES.replace(/[.]/g, "\\.")}/([0-9a-f]{32})/upi-qr\\.png$`, "u").exec(address);
        if (!m) return undefined;
        try { return readFileSync(join(s.pagesDir, m[1], "upi-qr.png")); } catch { return undefined; }
      },
      get size() { try { return readdirSync(s.pagesDir).filter((d) => existsSync(join(s.pagesDir, d, "upi-qr.png"))).length; } catch { return 0; } },
    },
  };
  return world;
}
