// The runtime: the Fees agent, the durable store and the task runner, wired so that every step is saved whole or not at all. How a step works, and why a crash leaves nothing
// half done, is explained once for every template in modules/runtime/core.ts. This file gives it Fees: its store, its agent, how its fees are counted and how a held refund
// is found from its receipt.
import { createAgent } from "../src/agent.ts";
import type { AgentEvent } from "../src/agent.ts";
import { createStore, monthLabel } from "../src/due.ts";
import type { Store } from "../src/due.ts";
import type { Messaging } from "../../../../modules/messaging/messaging.ts";
import type { IntentParser } from "../src/adapters/model.ts";
import type { AiPolicy } from "../../../../modules/understanding/ai-state.ts";
import type { Payments } from "../../../../modules/payments/payments.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { createMonthlyReport } from "../report/monthly-job.ts";
import type { MonthlyReportSetup } from "../report/monthly-job.ts";
import { batchName } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { RETRY_DELAYS_MS, createRuntimeCore } from "../../../../modules/runtime/core.ts";
import type { LicenceNow } from "../../../../modules/licence/rules.ts";
import { createFeesLicenceNotice } from "./licence.ts";
import type { BaseStatus, RefundCounts, Runtime as CoreRuntime, RuntimeKit } from "../../../../modules/runtime/core.ts";
import { parseStore, serializeStore, keepStoreCounters, skipStoreCounters } from "./snapshot.ts";
import { createMorningJob } from "../../../../modules/assistant/morning.ts";
import type { OwnerParser } from "../../../../modules/assistant/reading.ts";
import { feesSkill } from "../src/assistant.ts";
import type { DurableStore } from "./store.ts";
import type { OwnerSignin } from "../../../../modules/channels/owner-signin.ts";
import type { PagesFile } from "../../../../modules/channels/pages-file.ts";
import { createAudioDrop } from "../../../../modules/channels/owner-audio.ts";
import { ownerAppView } from "../../../../modules/assistant/app/view.ts";
import { UNRESTRICTED } from "../../../../modules/licence/rules.ts";
import { feeConfirmView, feesOffer, ownerView, parentView } from "../src/channel.ts";

export const PATHWAY = "fees";
export { RETRY_DELAYS_MS };
export type { RefundCounts };

/** Fees calls two services: payments and messaging. It has no calendar. */
export interface Services { payments: Payments; messaging: Messaging; /** A UPI shop: where its QR pictures go (modules/payments/owner-marked/qr-image.ts). Left out: the words alone. */ qrImage?: (text: string) => Promise<string | null> }

export interface RuntimeOptions {
  /** B29: the shop's voice service (modules/voice), built from runtime.json `speech`. Not one of `services`. Left out: voice is off. */
  voice?: import("../../../../modules/voice/voice.ts").VoiceService;
  settings: Settings;
  store: DurableStore;
  clock: Clock;
  services: Services;
  parser: IntentParser;
  pathwayVersion: string;
  /** The monthly AI allowance and the outside switch for this centre (modules/understanding/ai-state.ts). Left out: no limit and no switch. */
  ai?: AiPolicy;
  /** The record's key (B69, RECORD_KEY_FILE): the inputs' digest and message ids are written with it. Left out (fakes mode): written plain. */
  recordKey?: Buffer;
  /** The monthly report to the owner (report/monthly-job.ts). Left out: none is made and nothing is sent. */
  report?: MonthlyReportSetup;
  /** The shop's licence right now (modules/licence; the start reads client/licence.json). Left out: never restricted. */
  licence?: () => LicenceNow;
  /** B72: the shop terms the owner can agree to on WhatsApp (modules/terms/reader.ts). Left out: off. */
  terms?: () => import("../../../../modules/terms/terms.ts").TermsFile | undefined;
  /** Item 11e: the owner's router for the shop's assistant (modules/assistant/reading.ts). Left out: the rules alone read the owner's words. */
  ownerParser?: OwnerParser;
  /** Item 11f: the owner's sign-in on the shop's page (modules/channels/owner-signin.ts), made by the shared start. Left out: none. */
  ownerSignin?: OwnerSignin;
  /**
   * Item 11h: the centre's page addresses (its pages.json, read on every use), so a reminder can carry a parent's private link under the centre's page. Left out, or
   * no file: no page, and the reminders are as they were.
   */
  pages?: () => PagesFile | undefined;
  retryDelaysMs?: number[];
  guardWaitMs?: number;
  guardLookAgainMs?: number[];
  /** Runs around every agent step (`run` is the step itself). A seam for tests, to see order, hold a step or make one fail. */
  aroundStep?: (event: AgentEvent, run: () => Promise<void>) => Promise<void>;
  log?: (line: string) => void;
}

/** Counts only: never a name, a number or a word of a message. A heartbeat can carry this as it is. `fees` is the fees by state (open, paid, closed); a state with none is left out. */
export type Status = BaseStatus & { fees: Record<string, number> };

/**
 * What the approvals relay may know about a refund Guard is holding, found by the receipt the agent put on it (the fee's id and the payment: "f-3:pay_..."). Read-only.
 * `booking` is the fee's id (the shared relay calls any case that). The student, the batch and the month are worded in the OWNER's language, from the fee itself.
 */
export interface RefundContext {
  booking: string;
  customerPhone: string;
  businessName: string;
  timeZone: string;
  ownerLanguage: Language;
  studentName: string;
  batchName: string;
  monthLabel: string;
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
  for (const d of store.dues.values()) counts[d.state] = (counts[d.state] ?? 0) + 1;
  return counts;
}

/** Item 11h: how long a confirmation page whose fee is settled is kept after its press, beyond the conversation retention: a parent may come back to it. */
const CONFIRMATION_KEEP_MS = 90 * 24 * 3_600_000;

export function createRuntime(options: RuntimeOptions): Runtime {
  const { settings, clock, services, parser } = options;
  const policy: AiPolicy = options.ai ?? {};
  // item 11h: the parents' links this process made (in memory only: the store keeps their hashes), so a reminder resends the link a parent already has
  const linkMemory = new Map<string, string>();
  // the pages domain's address when the centre has one (that is where its QR codes and printed links point), else its own server's
  const pageBase = () => { const p = options.pages?.(); return p ? p.url ?? p.base : undefined; };
  // the owner's recordings from their page, in memory only until their step listens (only with a voice service and the assistant: otherwise there is no record button)
  const pageAudio = options.voice && settings.assistant ? createAudioDrop({ now: () => clock.now() }) : undefined;
  const skillOver = (store: Store) => feesSkill({ settings, store, nowMs: () => clock.now(), optedOut: (phone) => store.customers.get(phone)?.optedOut ?? false });
  const kit: RuntimeKit<Store, Settings, RefundContext> = {
    pathway: PATHWAY,
    casesName: "fees",
    createStore,
    serialize: serializeStore,
    parse: parseStore,
    skipCounters: skipStoreCounters,
    keepCounters: keepStoreCounters,
    services: services as unknown as Record<string, unknown>,
    createAgent: ({ store, record, services: watched }) => createAgent({
      settings, clock, ...(watched as unknown as Services), parser, record, store, ai: policy, ...(options.voice ? { voice: options.voice } : {}), ...(options.licence ? { licence: options.licence } : {}), ...(options.terms ? { terms: options.terms } : {}), ...(options.ownerParser ? { ownerParser: options.ownerParser } : {}),
      pageBase, linkMemory, ...(pageAudio ? { pageAudio: (ref: string) => pageAudio.get(ref) } : {}),
    }),
    // Item 11h: a confirmation page is kept while its fee is open, and for CONFIRMATION_KEEP_MS after it was pressed once the fee is settled. A parent's link is never
    // taken off here: it is the parent's until a new one replaces it or the owner switches it off.
    compactStore(store, beforeMs) {
      let changed = 0;
      for (const [hash, c] of Object.entries(store.confirmations ?? {})) {
        const due = store.dues.get(c.dueId);
        // a refused press goes with the conversations' retention; a settled fee's page stays longer, so the parent can still open it
        const keepFrom = c.refused !== undefined ? beforeMs : Math.min(beforeMs, clock.now() - CONFIRMATION_KEEP_MS);
        if ((due?.state === "open" && c.refused === undefined) || c.atMs >= keepFrom) continue;
        delete store.confirmations![hash];
        changed++;
      }
      return changed;
    },
    // Item 11h: what the centre's page, a parent's private page, a payment's confirmation page and the owner's page read, each from the last saved state
    channel: {
      offer: async () => feesOffer(settings, !(options.licence?.() ?? UNRESTRICTED).takesNewWork),
      view: (store, handleHash) => feeConfirmView(settings, store, handleHash),
      parent: (store, linkHash) => parentView(settings, store, linkHash),
      ...(pageAudio ? { ownerVoice: (audio: { bytes: Uint8Array; mime: string }) => pageAudio.put(audio.bytes, audio.mime) } : {}),
      owner: (store) => ({
        ...ownerView(settings, store),
        ...(settings.assistant ? { app: { ...ownerAppView({ skills: [skillOver(store)], state: store.assistant, nowMs: clock.now(), timeZone: settings.timezone, settings: settings.assistant }), listen: pageAudio !== undefined } } : {}),
      }),
    },
    countCases: countByState,
    casesOf: (store) => store.dues.values(),
    refundContext(store, _settings, receipt) {
      const match = /^(f-\d+):/u.exec(receipt);
      const due = match ? store.dues.get(match[1]) : undefined;
      const hold = due?.pending.find((p) => p.kind === "guard_hold" && p.receipt === receipt);
      if (!due || !hold || hold.kind !== "guard_hold") return null;
      const language = settings.owner.language;
      const batch = settings.batches.find((b) => b.id === due.batchId);
      return {
        booking: due.id, customerPhone: due.customer, businessName: settings.name, timeZone: settings.timezone, ownerLanguage: language,
        studentName: due.studentName, batchName: batch ? batchName(batch, language) : due.batchId, monthLabel: monthLabel(due, language),
        paymentId: hold.paymentId, amountPaise: hold.amountInr * 100, approval: hold.approval, expiresAtMs: hold.expiresAtMs, ...(hold.requestedBy ? { requestedBy: hold.requestedBy } : {}),
      };
    },
  };
  return createRuntimeCore({
    settings, store: options.store, clock, messaging: services.messaging, pathwayVersion: options.pathwayVersion, kit, ai: policy,
    monthly: options.report ? createMonthlyReport(options.report) : undefined,
    // Item 11e: the owner's morning line, from this template's skill read-only over the store
    ...(settings.assistant ? { daily: createMorningJob<Store>({
      shop: { name: settings.name, timezone: settings.timezone, owner: settings.owner, settings: settings.assistant },
      skills: (store) => [skillOver(store)],
    }) } : {}),
    ...(options.licence ? { licence: options.licence, licenceNotice: createFeesLicenceNotice(settings, options.licence) } : {}),
    ...(options.recordKey ? { recordKey: options.recordKey } : {}), ...(options.ownerSignin ? { ownerSignin: options.ownerSignin } : {}), retryDelaysMs: options.retryDelaysMs, guardWaitMs: options.guardWaitMs, guardLookAgainMs: options.guardLookAgainMs, aroundStep: options.aroundStep as never, log: options.log,
  }) as unknown as Runtime;
}
