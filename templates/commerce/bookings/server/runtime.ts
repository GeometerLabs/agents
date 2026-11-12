// The runtime: the agent, the durable store and the task runner, wired so that every step is saved whole or not at all. How a step works, and why a crash leaves nothing
// half done, is explained once for every template in modules/runtime/core.ts. This file gives it Bookings: its store, its agent, how its bookings are counted and how a
// held refund is found from its receipt.
import { createAgent } from "../src/agent.ts";
import type { AgentEvent } from "../src/agent.ts";
import { createStore } from "../src/booking.ts";
import type { Store } from "../src/booking.ts";
import type { Calendar } from "../src/adapters/calendar.ts";
import { createOwnCalendar } from "../src/adapters/own-calendar.ts";
import type { Messaging } from "../../../../modules/messaging/messaging.ts";
import type { IntentParser } from "../src/adapters/model.ts";
import type { AiPolicy } from "../../../../modules/understanding/ai-state.ts";
import type { Payments } from "../../../../modules/payments/payments.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { createMonthlyReport } from "../report/monthly-job.ts";
import type { MonthlyReportSetup } from "../report/monthly-job.ts";
import { serviceName } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { RETRY_DELAYS_MS, createRuntimeCore } from "../../../../modules/runtime/core.ts";
import type { OwnerSignin } from "../../../../modules/channels/owner-signin.ts";
import type { LicenceNow } from "../../../../modules/licence/rules.ts";
import { createBookingsLicenceNotice } from "./licence.ts";
import type { BaseStatus, RefundCounts, Runtime as CoreRuntime, RuntimeKit } from "../../../../modules/runtime/core.ts";
import { parseStore, serializeStore, keepStoreCounters, skipStoreCounters } from "./snapshot.ts";
import { createRecord } from "../../../../modules/record/record.ts";
import { channelMessaging } from "../../../../modules/channels/outbox.ts";
import { isChannelConversation } from "../../../../modules/channels/conversation.ts";
import { compactChannel, emptyChannelState } from "../../../../modules/channels/state.ts";
import { bookingView, ownerView, publicServices, shopInfo } from "../src/channel.ts";
import { ownerAppView } from "../../../../modules/assistant/app/view.ts";
import { createAudioDrop } from "../../../../modules/channels/owner-audio.ts";
import { UNRESTRICTED } from "../../../../modules/licence/rules.ts";
import { createMorningJob } from "../../../../modules/assistant/morning.ts";
import type { OwnerParser } from "../../../../modules/assistant/reading.ts";
import { bookingsSkill } from "../src/assistant.ts";
import type { DurableStore } from "./store.ts";

export const PATHWAY = "bookings";
export { RETRY_DELAYS_MS };
export type { RefundCounts };

export interface Services { /** Left out for a shop with no Google Calendar (B72): the agent then uses the shop's own booking list (src/adapters/own-calendar.ts). */ calendar?: Calendar; payments: Payments; messaging: Messaging; /** A UPI shop: where its QR pictures go (modules/payments/owner-marked/qr-image.ts). Left out: the words alone. */ qrImage?: (text: string) => Promise<string | null> }

export interface RuntimeOptions {
  /** B29: the shop's voice service (modules/voice), built from runtime.json `speech`. Not one of `services`: it never reaches a Guard the step waits on (it answers, it does not throw). Left out: voice is off. */
  voice?: import("../../../../modules/voice/voice.ts").VoiceService;
  settings: Settings;
  store: DurableStore;
  clock: Clock;
  services: Services;
  parser: IntentParser;
  pathwayVersion: string;
  /** The monthly AI allowance and the outside switch for this shop (modules/understanding/ai-state.ts). Left out: no limit and no switch. */
  ai?: AiPolicy;
  /** The record's key (B69, RECORD_KEY_FILE): the inputs' digest and message ids are written with it. Left out (fakes mode): written plain. */
  recordKey?: Buffer;
  /** Item 11f: the owner's sign-in on the shop's page (modules/channels/owner-signin.ts), made by the shared start. Left out: none. */
  ownerSignin?: OwnerSignin;
  /** The monthly report to the owner (report/monthly-job.ts). Left out: none is made and nothing is sent. */
  report?: MonthlyReportSetup;
  /** The shop's licence right now (modules/licence; the start reads client/licence.json). Left out: never restricted. */
  licence?: () => LicenceNow;
  /** B72: the shop terms the owner can agree to on WhatsApp (modules/terms/reader.ts). Left out: off. */
  terms?: () => import("../../../../modules/terms/terms.ts").TermsFile | undefined;
  /** Item 11e: the owner's router for the shop's assistant (modules/assistant/reading.ts). Left out: the rules alone read the owner's words. */
  ownerParser?: OwnerParser;
  retryDelaysMs?: number[];
  guardWaitMs?: number;
  guardLookAgainMs?: number[];
  /** Runs around every agent step (`run` is the step itself). A seam for tests, to see order, hold a step or make one fail. */
  aroundStep?: (event: AgentEvent, run: () => Promise<void>) => Promise<void>;
  log?: (line: string) => void;
}

/** Counts only: never a name, a number or a word of a message. A heartbeat can carry this as it is. `bookings` is the bookings by state; a state with none is left out. */
export type Status = BaseStatus & { bookings: Record<string, number> };

/** What the approvals relay may know about a refund Guard is holding, found by the receipt the agent put on it (the booking id and the payment). Read-only. */
export interface RefundContext {
  booking: string;
  customerPhone: string;
  businessName: string;
  timeZone: string;
  /** The owner's language, and the service named in it. */
  ownerLanguage: Language;
  serviceName: string;
  slotMs: number;
  paymentId: string;
  amountPaise: number;
  approval: string;
  expiresAtMs: number | null;
  /** B37: who asked for this refund (the owner, by their command, in a shop with other approvers). The relay never asks them to approve it. */
  requestedBy?: string[];
}

export type Runtime = CoreRuntime<Status, RefundContext>;

function countByState(store: Store): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const b of store.bookings.values()) counts[b.state] = (counts[b.state] ?? 0) + 1;
  return counts;
}

export function createRuntime(options: RuntimeOptions): Runtime {
  const { settings, clock, services, parser } = options;
  const policy: AiPolicy = options.ai ?? {};
  /**
   * The agent over one step's store. Its messaging keeps a message to a booking page's conversation in that same store (item 11d, modules/channels/outbox.ts), so the
   * words a web customer is given are saved whole or not at all with the step, and never go to WhatsApp.
   */
  // the owner's recordings from their page, in memory only until their step listens (only with a voice service and the assistant: otherwise there is no record button)
  const pageAudio = options.voice && settings.assistant ? createAudioDrop({ now: () => clock.now() }) : undefined;
  const agentOver = (store: Store, record: ReturnType<typeof createRecord>, use: Services) => createAgent({
    settings, clock, ...use, messaging: channelMessaging(use.messaging, () => (store.channel ??= emptyChannelState()), clock),
    calendar: use.calendar ?? createOwnCalendar(store, () => clock.now()), parser, record, store, ai: policy,
    // B29: the shop's voice service reaches the agent here, so a voice note from WhatsApp is heard the same whichever path built the agent
    ...(options.voice ? { voice: options.voice } : {}),
    ...(options.licence ? { licence: options.licence } : {}), ...(options.terms ? { terms: options.terms } : {}),
    // item 11e: how the shop's assistant reads the owner's words (only when the assistant is on)
    ...(options.ownerParser ? { ownerParser: options.ownerParser } : {}),
    ...(pageAudio ? { pageAudio: (ref: string) => pageAudio.get(ref) } : {}),
  });
  const kit: RuntimeKit<Store, Settings, RefundContext> = {
    pathway: PATHWAY,
    casesName: "bookings",
    createStore,
    serialize: serializeStore,
    parse: parseStore,
    skipCounters: skipStoreCounters,
    keepCounters: keepStoreCounters,
    services: services as unknown as Record<string, unknown>,
    createAgent: ({ store, record, services: watched }) => agentOver(store, record, watched as unknown as Services),
    countCases: countByState,
    casesOf: (store) => store.bookings.values(),
    // Item 11d: the words of a channel's finished conversations go with the retention, like a WhatsApp chat's; the typed name of a booking that ended goes too. The number
    // stays on the booking as a WhatsApp customer's does (it is how the owner reaches them), and the record is kept whole.
    compactStore(store, beforeMs) {
      const ended = (id: string) => { const b = store.bookings.get(id); return !b || ["cancelled", "completed", "expired"].includes(b.state) || (b.state === "enquiry" && b.startMs === undefined); };
      let changed = compactChannel(store.channel, beforeMs, ended);
      for (const b of store.bookings.values()) {
        if (!b.contact?.name || !ended(b.id) || (b.endMs ?? 0) >= beforeMs) continue;
        delete b.contact.name;
        changed++;
      }
      // a channel conversation is one booking's: once that booking is over and its request gone, its customer entry (its language) has nothing left to serve
      for (const conversation of [...store.customers.keys()]) {
        if (!isChannelConversation(conversation) || Object.values(store.channel?.requests ?? {}).some((r) => r.booking !== undefined && store.bookings.get(r.booking)?.customer === conversation)) continue;
        store.customers.delete(conversation);
        changed++;
      }
      return changed;
    },
    // Item 11d: what the booking page, its API, the MCP endpoint and the owner's page read. Free times come from the agent's own freeOnDay, over the last saved state
    // (the shop's holds) and the calendar (through its Guard, a read). Nothing here is saved: a fresh parse each time.
    channel: {
      async offer(store, query) {
        const shop = shopInfo(settings, !(options.licence?.() ?? UNRESTRICTED).takesNewWork);
        const base = { shop, services: publicServices(settings) };
        if (!query.serviceId || !settings.services.some((x) => x.id === query.serviceId)) return base;
        const from = query.fromDate ? (([y, m, d]) => ({ year: y, month: m, day: d }))(query.fromDate.split("-").map(Number)) : undefined;
        const agent = agentOver(store, createRecord(clock, []), services);
        try { return { ...base, serviceId: query.serviceId, days: await agent.freeStarts(query.serviceId, from, Math.min(query.days ?? 7, 14)) }; }
        catch { return { ...base, serviceId: query.serviceId, days: [], calendarUnread: true }; }
      },
      view: (store, handleHash) => bookingView(settings, store, handleHash),
      ...(pageAudio ? { ownerVoice: (audio: { bytes: Uint8Array; mime: string }) => pageAudio.put(audio.bytes, audio.mime) } : {}),
      // item 11e on item 11d's page: with the shop's assistant on, the owner's read also carries the app's view (its cards by id and digest, the mood, the talk),
      // read-only over the same saved state as the page's items, so the page's cards are exactly the ones a WhatsApp tap would answer
      owner: (store) => ({
        ...ownerView(settings, store, clock.now()),
        ...(settings.assistant ? { app: { ...ownerAppView({ skills: [bookingsSkill({ settings, store, nowMs: () => clock.now(), entries: () => [], optedOut: (phone) => store.customers.get(phone)?.optedOut ?? false })], state: store.assistant, nowMs: clock.now(), timeZone: settings.timezone, settings: settings.assistant }), listen: pageAudio !== undefined } } : {}),
      }),
    },
    refundContext(store, _settings, receipt) {
      const match = /^(b-\d+):/u.exec(receipt);
      const b = match ? store.bookings.get(match[1]) : undefined;
      const hold = b?.pending.find((p) => p.kind === "guard_hold" && p.receipt === receipt);
      if (!b || !hold || hold.kind !== "guard_hold" || b.startMs === undefined) return null;
      const service = settings.services.find((s) => s.id === b.serviceId);
      if (!service) return null;
      return {
        booking: b.id, customerPhone: b.contact?.phone ?? b.customer, businessName: settings.name, timeZone: settings.timezone, // a booking page's: the number its customer typed
        ownerLanguage: settings.owner.language, serviceName: serviceName(service, settings.owner.language), slotMs: b.startMs,
        paymentId: hold.paymentId, amountPaise: hold.amountInr * 100, approval: hold.approval, expiresAtMs: hold.expiresAtMs, ...(hold.requestedBy ? { requestedBy: hold.requestedBy } : {}),
      };
    },
  };
  return createRuntimeCore({
    settings, store: options.store, clock, messaging: services.messaging, pathwayVersion: options.pathwayVersion, kit, ai: policy,
    monthly: options.report ? createMonthlyReport(options.report) : undefined,
    // Item 11e: the owner's morning line, from Bookings read-only over the store (no acts; the record's money lines are the job's own to read)
    ...(settings.assistant ? { daily: createMorningJob<Store>({
      shop: { name: settings.name, timezone: settings.timezone, owner: settings.owner, settings: settings.assistant },
      skills: (store) => [bookingsSkill({ settings, store, nowMs: () => clock.now(), entries: () => [], optedOut: (phone) => store.customers.get(phone)?.optedOut ?? false })],
    }) } : {}),
    ...(options.licence ? { licence: options.licence, licenceNotice: createBookingsLicenceNotice(settings, options.licence) } : {}),
    ...(options.recordKey ? { recordKey: options.recordKey } : {}), ...(options.ownerSignin ? { ownerSignin: options.ownerSignin } : {}), retryDelaysMs: options.retryDelaysMs, guardWaitMs: options.guardWaitMs, guardLookAgainMs: options.guardLookAgainMs, aroundStep: options.aroundStep as never, log: options.log,
  }) as unknown as Runtime;
}
