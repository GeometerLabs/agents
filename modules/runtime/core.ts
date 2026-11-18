// The runtime: an agent, the durable store and the task runner, wired so that every step is saved whole or not at all. The same for every template; what a template
// gives is its `kit`: how its store is made, saved and read back, the agent that handles one event, how its cases are counted, and how a held refund is looked up.
//
// How a step works:
//  1. Build a FRESH store and record from the last saved state, and a fresh agent over them. (The agent keeps nothing
//     of its own between steps, so this costs little, and it is what makes a retry start clean.)
//  2. Let the agent handle the event. It changes the store and appends to the record as it goes, in memory only.
//  3. Save, in one transaction: the new snapshot, the record entries the step made and the task's "done" mark.
//  4. Only then does this process treat the new state as the saved one.
// If step 2 or 3 throws, nothing was saved and nothing in memory is reused, so there is nothing to undo. If the process
// dies anywhere in 1 to 3, the task is still pending on disk and runs again from the last saved state.
//
// A step that finds a Guard down (guard-wait.ts) is thrown away the same way, after step 2, however the agent handled the failure; its task waits for the Guard.
import type { Clock } from "../core/clock.ts";
import { HOUR } from "../core/time.ts";
import type { Language } from "../language/languages.ts";
import type { InboundMessage, Messaging } from "../messaging/messaging.ts";
import type { RefundIssue, RefundIssueKind } from "../payments/refunds.ts";
import { createRecord } from "../record/record.ts";
import type { ActionRecord, RecordEntry } from "../record/record.ts";
import { summaryOf } from "../understanding/ai-state.ts";
import type { AiPolicy, AiState, AiSummary } from "../understanding/ai-state.ts";
import type { IncomingEvent, RuntimeEvent } from "./events.ts";
import type { LicenceNow } from "../licence/rules.ts";
import type { NoticeContext } from "../licence/notice.ts";
import type { DurableStore, PhotoRow, TaskCounts, WindowStore } from "./store.ts";
import { PHOTO_GRACE_MS, createListingsKit } from "../listings/kit.ts";
import type { ListingOp, OwnerListingsView, PublicListingsRead } from "../listings/kit.ts";
import type { Failure } from "../listings/listings.ts";
import { createStockKit } from "../stock/kit.ts";
import type { ItemRef, OwnerStockEvent, OwnerStockView } from "../stock/kit.ts";
import type { Failure as StockFailure } from "../stock/stock.ts";
import { menuStockId, supplyStockId } from "../stock/stock.ts";
import { createRunner } from "./tasks.ts";
import { WaitingForGuard, guardAnswers, sendMemory, watchStep } from "./guard-wait.ts";
import { afterRestore, readRestoreNote, retireRestoreNote } from "./restored.ts";
import { recordMessageStatus } from "../messaging/statuses.ts";
import type { OwnerSignin } from "../channels/owner-signin.ts";
import { chatConversationOf } from "../channels/conversation.ts";
import type { LimitsKit, LimitsView } from "../limits/runtime-limits.ts";
import { channelStartKey, chatTaskKey } from "../channels/events.ts";
import { chatAnswered, chatDay, chatKnown, chatThread } from "../channels/chat.ts";
import type { ChatThread } from "../channels/chat.ts";
import type { ChannelState } from "../channels/state.ts";
import type { StatusContext } from "../messaging/statuses.ts";
import type { DocumentsKey } from "../accounting/case-documents.ts";
import type { Document } from "../accounting/documents.ts";
import type { ExportFile } from "../accounting/export.ts";

/** Wait before the first, second and third retry; so four tries in all. For a step that failed: a step that found its Guard down waits by guard-wait.ts instead. */
export const RETRY_DELAYS_MS = [1_000, 5_000, 30_000];

/** Counts only: never a name, a number or a word of a message. A heartbeat can carry this as it is. */
export interface BaseStatus {
  pathway: string;
  version: string;
  refunds: RefundCounts;
  tasks: TaskCounts;
  oldestPendingAt: string | null;
  lastStepAt: string | null;
  lastFailureAt: string | null;
  recordLength: number;
  /** The service whose Guard the head of the queue is waiting for, or null when it is not waiting. Not in the heartbeat: fleet sees a Guard down from the Guard's own state. */
  waitingForGuard: string | null;
  /** Running totals since `startedAt` (this process): tasks finished and failed attempts. A new `startedAt` means the totals started again from zero. */
  steps: number;
  errors: number;
  startedAt: string;
  /** This month's understanding: messages read at each step, the estimated cost in micro-rupees, the allowance, and whether the agent is in button mode and why. Counts only. */
  ai: AiSummary;
}

/**
 * Refunds, counted. `waitingForOwner`: Guard holds them and the approvals relay has asked (or will ask) the owner. `beingSentAgain`: nothing
 * went out and the agent is trying again. `needBuilder`: refunds that need the builder and NOT the owner, by why: an unclear outcome
 * (`unknown`, `uncertain`, `unconfirmed`), Guard said no (`refused`, `failed`), the owner never answered (`expired`), or Guard let a refund
 * above the limit through unheld (`unheld`: its threshold does not match the settings).
 */
export interface RefundCounts {
  waitingForOwner: number;
  beingSentAgain: number;
  needBuilder: Partial<Record<RefundIssueKind, number>> & { total: number };
}

/** Count the refunds of a template's cases (a booking, a fee): anything with a `pending` list and, maybe, `refundIssues`. */
export function countRefunds(cases: Iterable<{ pending: { kind: string }[]; refundIssues?: RefundIssue[] }>): RefundCounts {
  const counts: RefundCounts = { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } };
  for (const c of cases) {
    for (const p of c.pending) {
      if (p.kind === "guard_hold") counts.waitingForOwner++;
      else if (p.kind === "refund_retry") counts.beingSentAgain++;
    }
    for (const issue of c.refundIssues ?? []) {
      counts.needBuilder[issue.kind] = (counts.needBuilder[issue.kind] ?? 0) + 1;
      counts.needBuilder.total++;
    }
  }
  return counts;
}

const describe = (needBuilder: RefundCounts["needBuilder"]) => Object.entries(needBuilder).filter(([kind, n]) => kind !== "total" && n > 0).map(([kind, n]) => `${n} ${kind}`).join(", ");

/** What a template's agent is: it handles one event and returns. */
export interface RunnableAgent {
  handle(event: RuntimeEvent): Promise<void>;
  /**
   * The wait for a Guard is over and this event's work is not done: write the line the owner's to-do list reads (GUARD_WAIT_ENTRY, modules/unfinished/registry.ts), and with
   * `tell` also give the customer the template's words for it. `tell` is false when the customer already heard something from this step, so they are not told twice.
   */
  giveUp?(event: RuntimeEvent, why: { service: string; tell: boolean }): Promise<void>;
  /**
   * Send once (modules/messaging/send-once.ts): the agent records a message that commits someone (a purchase order) as an intent in the store instead of sending it in the
   * step, and this sends it. The runtime calls `run` AFTER the step's own save, so the claim, the send and the ending are each saved around the send: a process that dies
   * in between is never able to send the message twice. `save` writes the store and the record as they are now. Left out: the agent has no such message.
   */
  sendOnce?: { run(save: () => void): Promise<void> };
}

/** The monthly report's job, as the runtime uses it (modules/report/monthly-job.ts). */
export interface MonthlyRunner<Store, Settings> {
  run(ctx: { settings: Settings; clock: Clock; messaging: Messaging; record: ActionRecord; store: Store; log: (line: string) => void; save: () => void }): Promise<unknown>;
}

/** What the booking page asks for: the shop's services, and the free start times of one service from a day on (a template that has no times answers its own way). */
export interface OfferQuery { serviceId?: string; fromDate?: string; days?: number }

/**
 * What a template gives for its channels: the booking page, its API, the MCP endpoint and the owner's private page (modules/channels). Reads only, each from the last
 * saved state: every change is an event (channel_request, owner_action) that runs as a step like any message, through the same limits and Guards.
 */
export interface ChannelKit<Store> {
  /** The shop's public offer: its services and prices, and free times from the same source the agent books against. May read the calendar (through its Guard). */
  offer(store: Store, query: OfferQuery): Promise<unknown>;
  /** One request by its handle's hash, as its page may show it (an allowlist: never a code, never another customer); null when the saved state has none. */
  view(store: Store, handleHash: string): unknown | null;
  /**
   * What waits for the owner, each with the digest of exactly what is shown, and the coming bookings. `entries` is the saved record: the owner's Money section is
   * worked out from the accounts it holds (modules/accounting/owner-money.ts), which only the record has.
   */
  owner(store: Store, entries: readonly RecordEntry[]): unknown;
  /**
   * The documents (receipts, bills, refund notes) of the case or cases the page with this handle's hash (or, for a parent's page, this link's hash) shows, newest
   * first, drawn in `language` (modules/accounting/case-documents.ts). Empty for a key no page has. Left out by a template with no accounting.
   */
  documents?(store: Store, entries: readonly RecordEntry[], key: DocumentsKey, language: Language): Document[];
  /** The accountant's files for a period ("2026-11" or "26-27"), from the saved record (modules/accounting/export.ts). Throws for a text that is not a period. */
  accountantFiles?(store: Store, entries: readonly RecordEntry[], period: string): ExportFile[];
  /**
   * Item 11h (Fees): what a parent's private link opens, found by the link's HASH (modules/channels/handle.ts parentLinkHash): only that parent's students' fees.
   * Null for a hash no parent has now (never made, replaced, or revoked). Left out by a template with no parent links.
   */
  parent?(store: Store, linkHash: string): unknown | null;
  /** W2: how many bookings or orders this chat conversation has made (the page offers "keep this chat" only when it is more than none). Left out: 0. */
  chatWork?(store: Store, conversation: string): number;
  /**
   * Classes (Fees add-on): the reading material of one batch, for the parent whose private link has this hash NOW: the batch's files (from the centre's own folder), or the
   * one file `fileId` names. Null when the link opens nothing, or none of the parent's students in the batch may open it now. Async: it reads the disk. Left out by a template with no material.
   */
  material?(store: Store, linkHash: string, batchId: string, fileId?: string): Promise<unknown | null>;
  /**
   * Integration of items 11d and 11e: hold a recording the owner made on their page, in memory only, and give its reference for an `owner_message` event. Left out
   * when the shop has no voice service or no assistant: the page then shows no record button, and the route answers that voice is off.
   */
  ownerVoice?(audio: { bytes: Uint8Array; mime: string }): string;
  /**
   * W1 hold-to-talk: hold a recording a chat guest made on the shop's page, in memory only, and give its reference for a `chat_message`'s `voice`. A drop of its own (never the
   * owner's), so a flood of guests cannot push out the owner's recordings. Left out when the shop has no voice service: the chat then shows no button.
   */
  chatVoice?(audio: { bytes: Uint8Array; mime: string }): string;
}

/** What a template gives the runtime. */
export interface RuntimeKit<Store extends { ai?: AiState }, Settings extends { timezone: string }, Context> {
  /** The pathway's name ("bookings", "fees"). */
  pathway: string;
  /** What the status calls this template's cases: "bookings", "fees". The fleet's contract reads the counts as the runtime's `bookings`; the bundle's heartbeat maps the name. */
  casesName: string;
  createStore(): Store;
  serialize(store: Store): string;
  parse(json: string): Store;
  /** The services this template's agent calls, by name ("payments", "calendar", "messaging"). Given here so each step can watch them (guard-wait.ts). Left out: a step cannot wait for a Guard. */
  services?: Record<string, unknown>;
  /** A fresh agent over this step's store and record. Use `services` for this step's calls, when given: they are watched. */
  createAgent(deps: { store: Store; record: ActionRecord; services?: Record<string, unknown> }): RunnableAgent;
  /** The cases (bookings, fees) counted by state. A state with none is left out. */
  countCases(store: Store): Record<string, number>;
  /** The cases that can hold a refund. */
  casesOf(store: Store): Iterable<{ pending: { kind: string }[]; refundIssues?: RefundIssue[] }>;
  /** What the approvals relay may know about the held refund with this receipt; null if none is held. */
  refundContext(store: Store, settings: Settings, receipt: string): Context | null;
  /** The saved store with every id counter moved on by `gap` (the codec's own, modules/runtime/snapshot.ts): used once after a restore from a snapshot (restored.ts). */
  skipCounters?(json: string, gap: number): string;
  /** The saved store with every id counter at least where a thrown-away step's store had it (the codec's own): used when a task ends without running again (endTask). */
  keepCounters?(json: string, taken: string): string;
  /**
   * Words a customer wrote that the store keeps on a case (Orders: the delivery address), taken off the cases that ended before `beforeMs`; the outcome stays. Returns
   * how many cases it changed. A template whose store keeps no such words has none.
   */
  compactStore?(store: Store, beforeMs: number): number;
  /** The template's channels (modules/channels). Left out: the runtime has no booking page, API or owner page. */
  channel?: ChannelKit<Store>;
}

/** How long the text of a finished conversation is kept, when the shop sets nothing else: the chat itself is on the customer's and the owner's WhatsApp. */
export const CONVERSATION_RETENTION_DAYS = 30;

export interface RuntimeCoreOptions<Store extends { ai?: AiState }, Settings extends { timezone: string }, Context> {
  settings: Settings;
  store: DurableStore;
  clock: Clock;
  messaging: Messaging;
  pathwayVersion: string;
  kit: RuntimeKit<Store, Settings, Context>;
  /** The monthly AI allowance and the outside switch for this shop (modules/understanding/ai-state.ts). Left out: no limit and no switch. */
  ai?: AiPolicy;
  /** The record's key (B69, RECORD_KEY_FILE): the inputs' digest and message ids are written with it. Left out (fakes mode): written plain. */
  recordKey?: Buffer;
  /** The monthly report job, made from the template's report. Left out: none is made and nothing is sent. */
  monthly?: MonthlyRunner<Store, Settings>;
  /**
   * Item 11e: the owner's morning line (modules/assistant/morning.ts), run on the tick after the monthly report, with the same `save` so its claim is on disk before it
   * sends. Left out (a shop without the assistant): nothing is sent.
   */
  daily?: MonthlyRunner<Store, Settings>;
  /**
   * The shop's licence right now (plan B13; modules/licence), read from client/licence.json with this runtime's clock. Left out: never restricted. In the final stop
   * the monthly report is not sent (the shop sends nothing more), and `licenceNotice` tells the owner, once for each `paid_through`.
   */
  licence?: () => LicenceNow;
  licenceNotice?: { run(ctx: NoticeContext<Store>): Promise<unknown> };
  retryDelaysMs?: number[];
  /** How long a task may wait for its Guard (GUARD_WAIT_MS when not given). */
  guardWaitMs?: number;
  /** How long between looks at a Guard that is down (GUARD_LOOK_AGAIN_MS when not given). */
  guardLookAgainMs?: number[];
  /** Days the text of a finished conversation is kept (CONVERSATION_RETENTION_DAYS when not given). The record is kept whole, always. */
  retentionDays?: number;
  /** Item 11f: the owner's sign-in on the shop's page (modules/channels/owner-signin.ts). Left out: no sign-in links, and "open my app" goes to the agent. */
  ownerSignin?: OwnerSignin;
  /**
   * "Limits, tightened by a tap" (modules/limits/runtime-limits.ts): the settings the agent reads get what is in force before every step, and the deployer's `limit_settled`
   * and the owner's own limits page (`owner_limit`) are run here, in the step, like the sign-in's events. Left out: no limit changes, as before.
   */
  limits?: LimitsKit<Store & { assistant?: import("../assistant/state.ts").AssistantState }>;
  /** Runs around every agent step (`run` is the step itself). A seam for tests, to see order, hold a step or make one fail. */
  aroundStep?: (event: RuntimeEvent, run: () => Promise<void>) => Promise<void>;
  log?: (line: string) => void;
}

export interface Runtime<Status = BaseStatus, Context = unknown> {
  /** The WhatsApp windows, for the live adapters. */
  readonly window: WindowStore;
  /** Save events as tasks. They are on disk when this returns; call `kick` afterwards to let the queue run. */
  submit(events: IncomingEvent[]): { saved: number; duplicates: number };
  kick(): void;
  tick(): Promise<void>;
  idle(): Promise<void>;
  status(): Status;
  /** The held refund with this receipt, for the approvals relay to cross-check against what Guard says it holds; null if none is held. */
  refundContext(receipt: string): Context | null;
  ready(): { ok: true } | { ok: false; reason: string };
  close(): Promise<void>;
  /** The template's channel reads (modules/channels), from the last saved state. Left out when the template has none. */
  channel?: RuntimeChannel;
  /** The limits the owner may change, their value in force and the changes so far, from the last saved state (the deployer and the owner's limits page read it). Left out: no limit kit. */
  limits?: { view(): LimitsView };
}

/** A channel request's status when the saved state has no answer for it yet: its task is waiting, or it ended without its work done. */
export type PendingView = { status: "pending" } | { status: "not_done" };

export interface RuntimeChannel {
  offer(query: OfferQuery): Promise<unknown>;
  /** The request with this handle's hash, or where its task is; null when there is neither. */
  view(handleHash: string): unknown | PendingView | null;
  owner(): unknown;
  /** The kit's documents read, when it has one. */
  documents?(key: DocumentsKey, language: Language): Document[];
  /** The kit's accountant's files, when it has them. The runtime's http route lets only a signed-in owner's session reach this. */
  accountantFiles?(period: string): ExportFile[];
  /** The kit's parent read (above), when it has one. */
  parent?(linkHash: string): unknown | null;
  /** The kit's material read (above), when it has one. */
  material?(linkHash: string, batchId: string, fileId?: string): Promise<unknown | null>;
  /** The kit's ownerVoice (above), when it has one. */
  ownerVoice?(audio: { bytes: Uint8Array; mime: string }): string;
  /** W1: the kit's chatVoice (above), when it has one. */
  chatVoice?(audio: { bytes: Uint8Array; mime: string }): string;
  /** W1: a chat guest's thread by its hash (an empty one for a guest never seen), and where its latest send stands (`cid`: the page's id for it). */
  chat(handleHash: string, q: { after?: number; cid?: string }): ChatRead;
  /** W2: how many bookings or orders a guest's thread has made. */
  chatWork(handleHash: string): number;
  /** W1: has this guest written, and has the shop answered? The push route reads these (alerts are offered only after an answer). */
  chatState(handleHash: string): { known: boolean; answered: boolean };
  /**
   * Block S, the shop's listings, generic over every template (the store's `assistant.listings`): what the public may see, what the owner's page shows, what an op would do (a
   * pre-check for the page's notice), the photos (the public gets only those of a public listing now; the owner any the shop holds) and the photo upload's day bound. Left out for a
   * shop with no assistant, or a store with no photo table.
   */
  listings?: {
    publicRead(): PublicListingsRead;
    ownerView(): OwnerListingsView;
    check(op: ListingOp): Failure | undefined;
    publicPhoto(id: string): PhotoRow | undefined;
    ownerPhoto(id: string): PhotoRow | undefined;
    putPhoto(row: Omit<PhotoRow, "atMs">): void;
    uploadsLeft(): number;
  };
  /**
   * Block S phase A3, the shop's one stock count (the store's `assistant.stock`, modules/stock): the owner's Stock page's data in their language, and what an owner op would do now (a
   * pre-check for the page's notice). Left out for a shop with no assistant.
   */
  stock?: {
    ownerView(language?: Language): OwnerStockView;
    check(event: OwnerStockEvent): StockFailure | undefined;
  };
}

/** What the page reads of a chat: the thread, how the latest send stands, the character's small-talk personality (settings.assistant.character) and whether hold-to-talk is on. The signboard's paint is not here: it travels in the shop's pages file (pages-file.ts). */
export interface ChatRead extends ChatThread {
  send?: "pending" | "done" | "failed";
  personality?: string;
  /** Hold-to-talk is on (the shop has a voice service): the page draws the button; without it there is none, not a hidden one. */
  listen?: true;
}

export type { InboundMessage, Language };

// Wires agent, store and runner once for all templates so 'saved whole or not at all' is enforced in one place, not per template.
export function createRuntimeCore<Store extends { ai?: AiState }, Settings extends { timezone: string }, Context>(options: RuntimeCoreOptions<Store, Settings, Context>): Runtime<BaseStatus & Record<string, unknown>, Context> {
  const { settings, store: db, clock, messaging, pathwayVersion, kit } = options;
  const policy: AiPolicy = options.ai ?? {};
  const log = options.log ?? (() => undefined);
  // Block S: the shop's listings, for every template at once. The owner's steps (a photo, the form, Confirm, Sold, the switch) are events the runtime's HTTP layer makes after it
  // checked the owner; they are run here, in the step, like the limits' events, so the change is saved with everything else and no template's agent has to know about them.
  const shopPeople = settings as { owner?: { whatsapp: string; language: Language }; assistant?: unknown };
  const listings = shopPeople.assistant && shopPeople.owner && db.photos ? createListingsKit<Store & { assistant?: import("../assistant/state.ts").AssistantState }>({ owner: shopPeople.owner, timezone: settings.timezone }) : undefined;

  // Block S phase A3: the shop's one stock count. The owner's steps on their Stock page are events (like the listings'), run here in the step. The items the owner may count besides the shop's
  // listings come from the template's own settings (Orders' menu, Stock orders' items), read without importing any template: only the fields' names are known here.
  const stock = shopPeople.assistant && shopPeople.owner ? createStockKit<Store & { assistant?: import("../assistant/state.ts").AssistantState }>({ owner: shopPeople.owner, items: (language) => templateItems(settings, language) }) : undefined;

  // What the last saved step left. Replaced only after a save succeeds. The status reads these, never a step in progress.
  const saved = db.loadState();
  let snapshot = saved.snapshot ?? kit.serialize(kit.createStore());
  let entries: readonly RecordEntry[] = saved.record;
  // Put back from a nightly snapshot? Then, before any step, the ids move on and the record says so (restored.ts).
  const restoreNote = readRestoreNote(db.file);
  if (restoreNote) {
    const owner = (settings as { owner?: { whatsapp?: string; language?: Language } }).owner;
    const done = afterRestore({ note: restoreNote.note, snapshot, entries, clock, ...(kit.skipCounters ? { skipCounters: (json, gap) => kit.skipCounters!(json, gap) } : {}), ...(owner ? { owner } : {}), ...(options.recordKey ? { recordKey: options.recordKey } : {}) });
    if (done) {
      kit.parse(done.snapshot); // it must still read
      db.commitStep({ snapshot: done.snapshot, entries: done.fresh, nowMs: clock.now() });
      snapshot = done.snapshot;
      entries = [...entries, ...done.fresh];
      log(done.said);
    }
    retireRestoreNote(restoreNote.file, clock.now());
  }
  let cases = kit.countCases(kit.parse(snapshot));
  let refunds = countRefunds(kit.casesOf(kit.parse(snapshot)));

  const monthly = options.monthly;
  let lastReportError = { same: "", at: 0 };
  let lastCompactAt = Number.NEGATIVE_INFINITY;

  /**
   * Once a day, on the clock's beat: the text of conversations that ended more than the retention ago is deleted (a failed task's message, and words the template keeps
   * on a finished case); what happened stays (the case, its state, the record). The record is never compacted, rewritten or pruned: it is not touched here.
   */
  function compact(store: Store): void {
    if (clock.now() - lastCompactAt < 24 * HOUR) return;
    lastCompactAt = clock.now();
    const before = clock.now() - (options.retentionDays ?? CONVERSATION_RETENTION_DAYS) * 24 * HOUR;
    const cases = kit.compactStore?.(store, before) ?? 0;
    const turns = db.compactTurns?.(before) ?? 0;
    // photos no listing holds any more (a draft that was never shown, a removed listing's, an upload nobody used) go, once they are a day old: a photo uploaded a moment ago may still
    // be waiting for its event to be saved
    if (listings && db.photos) db.photos.prune(listings.keepIds(store), clock.now() - PHOTO_GRACE_MS);
    if (cases + turns > 0) log(`Deleted the text of conversations that ended more than ${options.retentionDays ?? CONVERSATION_RETENTION_DAYS} days ago: ${turns} failed message(s), ${cases} finished case(s). The record is kept whole.`);
  }

  // Guards this runtime gave up waiting for in this outage. Tasks do not wait for them again until one answers, so a Guard that stays down costs the shop the bound once,
  // not the bound for every message. In memory only: a restart waits again, and that wait is still bounded by each message's own time.
  const givenUp = new Set<string>();
  const tickMemory = sendMemory();
  // whose number a status report names: the owner's and the approvers' (B37), from the shop's settings
  const people = settings as { owner?: { whatsapp: string; language: Language }; approvers?: { people?: { whatsapp: string }[] } };
  const statusContext: StatusContext = { ...(people.owner ? { owner: people.owner } : {}), approvers: (people.approvers?.people ?? []).map((p) => p.whatsapp), ...(options.recordKey ? { recordKey: options.recordKey } : {}) };

  /**
   * A task's step or a tick. Decided right after the agent returns, and BEFORE the compact, the licence notice and the monthly report: those two save for themselves, so a
   * step that got past them could not be thrown away whole. The order of the checks is what keeps it right: a stopped step is thrown away; one that threw after sending
   * something, or at the end of its wait, cannot be run again, so it ends here, once; anything else that threw is the runner's usual retry.
   */
  async function step(event: RuntimeEvent, taskId?: string, stepOptions?: { lastTry?: boolean }): Promise<void> {
    const lastTry = stepOptions?.lastTry === true;
    const isTask = taskId !== undefined;
    const store = kit.parse(snapshot);
    const limits = options.limits;
    limits?.apply(store); // what is in force now (a tapped, still pending tightening included) is what this step's agent reads
    const record = createRecord(clock, entries, options.recordKey ? { key: options.recordKey } : {});
    if (!isTask) tickMemory.begin();
    const watch = watchStep(kit.services, { mode: isTask && !lastTry ? "wait" : "observe", givenUp, ...(isTask ? {} : { memory: tickMemory }) });
    const agent = kit.createAgent({ store, record, services: watch.services });
    // a status report is recorded against the message it is about and never handed to the agent (modules/messaging/statuses.ts)
    // Item 11f: the owner's sign-in (a link asked for on the page, the owner's "open my app", a session's line for the record) is the core's, like a status
    // report: it changes no case, and the agent and the assistant never see it. A runtime without the owner's sign-in drops those events.
    const signin = options.ownerSignin;
    const run = async () => {
      if (event.kind === "message_status") recordMessageStatus(record, event.status, statusContext);
      else if (signin?.takes(event)) await signin.run(event as Parameters<typeof signin.run>[0], { messaging, record, store }); // W2: the store too, for the chat links (chat-link-send.ts, composed into the sign-in in start.ts)
      else if (event.kind === "owner_signin" || event.kind === "owner_access") log("A sign-in event came for a shop with no owner sign-in (no pages file yet); it was dropped.");
      else if (listings?.takes(event)) listings.run(event as Parameters<typeof listings.run>[0], { store, record, nowMs: clock.now() });
      else if (event.kind === "owner_listing" || event.kind === "owner_photo") log("A listings event came for a shop that has no assistant; it was dropped.");
      else if (stock?.takes(event)) stock.run(event as OwnerStockEvent, { store, record, nowMs: clock.now() });
      else if (event.kind === "owner_stock") log("A stock event came for a shop that has no assistant; it was dropped.");
      else if (limits?.takes(event)) { limits.run(event as Parameters<typeof limits.run>[0], { store, record }); limits.apply(store); }
      else if (event.kind === "limit_settled" || event.kind === "owner_limit") log("A limit event came for a shop that has no limits the owner may change; it was dropped.");
      else await agent.handle(event);
    };
    let thrown: { error: unknown } | undefined;
    try { await (options.aroundStep ? options.aroundStep(event, run) : run()); } catch (error) { thrown = { error }; }
    for (const service of watch.answered) givenUp.delete(service);
    if (watch.stopped) throw new WaitingForGuard(watch.stopped.service, watch.stopped.error);
    const down = isTask ? watch.down : undefined;
    const givenUpOn = down !== undefined && (lastTry || givenUp.has(down));
    if (thrown) {
      if (down !== undefined && (givenUpOn || watch.oneTime)) return endTask(event, taskId!, down, !watch.oneTime, kit.serialize(store));
      throw thrown.error;
    }
    if (givenUpOn) {
      // The agent got through on its own "could not confirm" path; the customer has heard what they can. Only the owner's item is left to write, and it is saved with the step.
      await agent.giveUp?.(event, { service: down!, tell: false });
      givenUp.add(down!);
    }
    if (event.kind === "tick") { compact(store); signin?.tick({ record, store }); } // W2: the store too, so the chat identity can drop what a cleared thread leaves (chat-link-send.ts)

    // The owner's licence notice rides on the clock's beat too, after the agent's own work, and saves around its send the same way (modules/licence/notice.ts).
    if (event.kind === "tick" && options.licenceNotice) {
      try { await options.licenceNotice.run({ settings: settings as unknown as NoticeContext<Store>["settings"], clock, messaging, record, store, log, save: () => save(store, record) }); }
      catch (e) { log(`The owner's licence notice could not be sent: ${(e as Error).message}`); }
    }
    // The monthly report rides on the clock's beat, after the agent's own work. It saves twice itself (before it sends, and after), through `save`. A report that cannot be
    // made is said once and never holds up the beat: holds still expire and reminders still go. In the licence's final stop the shop sends nothing more, so no report goes.
    if (event.kind === "tick" && monthly && options.licence?.().state !== "stopped") {
      try { await monthly.run({ settings, clock, messaging, record, store, log, save: () => save(store, record) }); }
      catch (e) {
        // said once, and again each hour it goes on: the paths in the message (a new random folder each time) are left out of the comparison
        const same = (e as NodeJS.ErrnoException).code ?? (e as Error).message.replace(/\S*[\\/]\S*/gu, "…");
        if (same !== lastReportError.same || clock.now() - lastReportError.at >= HOUR) { log(`The monthly report could not be made: ${(e as Error).message}`); lastReportError = { same, at: clock.now() }; }
      }
    }
    if (event.kind === "tick" && options.daily && options.licence?.().state !== "stopped") {
      try { await options.daily.run({ settings, clock, messaging, record, store, log, save: () => save(store, record) }); }
      catch (e) { log(`The owner's morning line could not be made: ${(e as Error).message}`); }
    }
    save(store, record, taskId);
    // Send once: what the step asked to be sent (a purchase order) goes now that the step is saved, claim first, ending after, each saved (modules/messaging/send-once.ts).
    // It also runs on every tick, so a refused message is tried again when its hour is up and a claim left by a dead process is found and never sent again. In the licence's
    // final stop nothing is sent: the intent waits. This is the same agent as the step's: its calls are watched like the step's, but the step is over, so a Guard down here
    // is only a refusal ("nothing went out") that the next run tries again.
    if (agent.sendOnce && options.licence?.().state !== "stopped") {
      try { await agent.sendOnce.run(() => save(store, record)); }
      catch (e) { log(`A message waiting to be sent could not be sent: ${(e as Error).message}`); }
    }
    if (!isTask) tickMemory.clear(); // what it sent is saved as sent now, so the memory of it is done with
  }

  /**
   * A task whose step can neither wait nor run again: a fresh store and agent from the saved state, so nothing of the failed step is kept, then the to-do item (and, when the
   * customer has heard nothing, the template's words) and the failed mark in one transaction. Once only: the task leaves the queue here.
   *
   * Except its ids (B75, 11 Nov 2026). The step, or an earlier try of it that waited, may have made a calendar hold or a payment link under the case id it took ("b-7"),
   * and those stay at the providers. If that id were given out again, the next customer's "look first" would find them and take them as its own: another customer's hold,
   * and a link someone else may hold. So the id counters stay where the thrown-away step left them (`taken`), and the next case gets a new number.
   */
  async function endTask(event: RuntimeEvent, taskId: string, service: string, tell: boolean, taken: string): Promise<void> {
    givenUp.add(service);
    const store = kit.parse(kit.keepCounters ? kit.keepCounters(snapshot, taken) : snapshot);
    const record = createRecord(clock, entries, options.recordKey ? { key: options.recordKey } : {});
    const agent = kit.createAgent({ store, record, services: kit.services });
    try { await agent.giveUp?.(event, { service, tell }); }
    catch (e) { log(`The note that a task gave up waiting for its Guard could not be written: ${(e as Error).message}`); }
    save(store, record, taskId, `The ${service} Guard could not be reached, and the wait for it is over.`);
  }

  /** Save what the step has done so far, whole or not at all, and only then treat it as the saved state. */
  function save(store: Store, record: ActionRecord, taskId?: string, failedWith?: string): void {
    const after = kit.serialize(store);
    const all = record.entries();
    if (taskId === undefined && after === snapshot && all.length === entries.length) return; // a quiet tick has nothing to save
    const fresh = all.slice(entries.length);
    db.commitStep({ taskId, snapshot: after, entries: fresh, nowMs: clock.now(), ...(failedWith !== undefined ? { failedWith } : {}) });
    snapshot = after;
    entries = all;
    // The builder or Operator is told once, here, when the agent moves to buttons: the agent writes one ai_mode line per episode (its reason is in the line and in /status).
    // The AI cap is not button mode: only the language model is left out, for the rest of the month.
    for (const e of fresh) {
      if (e.action !== "ai_mode") continue;
      if (e.refs.mode === "model_off") log("The month's AI cap is reached: the language model is left out until the 1st; the rules and the decision model keep answering. The record's ai_mode line says so.");
      else log(`The agent now answers with buttons and lists, no AI (${e.refs.reason}). The record's ai_mode line says why; /status counts the month.`);
    }
    cases = kit.countCases(store);
    const was = refunds.needBuilder.total;
    refunds = countRefunds(kit.casesOf(store));
    if (refunds.needBuilder.total > was) log(`A refund needs the builder, not the owner (${describe(refunds.needBuilder)}). The record says why; /status counts them.`);
  }

  const startedAt = new Date(clock.now()).toISOString();
  const runner = createRunner({
    db, step, retryDelaysMs: options.retryDelaysMs ?? RETRY_DELAYS_MS, log, now: () => clock.now(),
    guardAnswers: (service) => guardAnswers(service, kit.services),
    ...(options.guardWaitMs !== undefined ? { guardWaitMs: options.guardWaitMs } : {}),
    ...(options.guardLookAgainMs ? { guardLookAgainMs: options.guardLookAgainMs } : {}),
  });
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

  return {
    window: { lastInboundAt: (phone) => db.lastInboundAt(phone) },
    submit: (events) => db.saveEvents(events, clock.now()),
    kick: runner.kick,
    tick: runner.tick,
    idle: runner.idle,

    status: () => ({
      pathway: kit.pathway,
      version: pathwayVersion,
      [kit.casesName]: cases,
      refunds,
      tasks: db.taskCounts(),
      oldestPendingAt: iso(db.oldestPendingAt()),
      waitingForGuard: db.nextPending()?.waitingOn ?? null,
      lastStepAt: iso(runner.lastStepAt()),
      lastFailureAt: iso(runner.lastFailureAt()),
      recordLength: entries.length,
      ...runner.counters(),
      startedAt,
      ai: summaryOf(kit.parse(snapshot), policy, clock.now(), settings.timezone),
    }) as BaseStatus & Record<string, unknown>,

    refundContext: (receipt) => kit.refundContext(kit.parse(snapshot), settings, receipt),
    ...(options.limits ? { limits: { view: () => options.limits!.view(kit.parse(snapshot)) } } : {}),

    // Reads for the template's channels: each from a fresh parse of the last saved state, never a step in progress, and never one that saves anything.
    ...(kit.channel ? {
      channel: {
        offer: (query: OfferQuery) => kit.channel!.offer(kit.parse(snapshot), query),
        view(handleHash: string) {
          const found = kit.channel!.view(kit.parse(snapshot), handleHash);
          if (found) return found;
          const task = db.taskState?.(channelStartKey(handleHash));
          return task === "pending" ? { status: "pending" as const } : task === "failed" ? { status: "not_done" as const } : null;
        },
        owner: () => kit.channel!.owner(kit.parse(snapshot), entries),
        // W1: the chat's reads, generic over every template (its state is the store's `channel`, where the outbox already is). Nothing is saved here.
        chat(handleHash: string, q: { after?: number; cid?: string }): ChatRead {
          const channel = (kit.parse(snapshot) as { channel?: ChannelState }).channel;
          const now = clock.now();
          const read: ChatRead = chatThread(channel, handleHash, { ...(q.after !== undefined ? { after: q.after } : {}), retentionDays: options.retentionDays ?? CONVERSATION_RETENTION_DAYS, now, dayKey: chatDay(now, settings.timezone) });
          const task = q.cid ? db.taskState?.(chatTaskKey(handleHash, q.cid)) : undefined;
          const character = (settings as { assistant?: { character?: { personality?: string } } }).assistant?.character;
          return { ...read, ...(task ? { send: task === "failed" ? "failed" as const : task === "done" ? "done" as const : "pending" as const } : {}), ...(character?.personality ? { personality: character.personality } : {}), ...(kit.channel!.chatVoice ? { listen: true as const } : {}) };
        },
        chatWork: (handleHash: string) => kit.channel!.chatWork?.(kit.parse(snapshot), chatConversationOf(handleHash)) ?? 0,
        chatState(handleHash: string) {
          const channel = (kit.parse(snapshot) as { channel?: ChannelState }).channel;
          return { known: chatKnown(channel, handleHash), answered: chatAnswered(channel, handleHash) };
        },
        ...(listings && db.photos ? {
          listings: {
            publicRead: () => listings.publicRead(kit.parse(snapshot), clock.now()),
            ownerView: () => listings.ownerView(kit.parse(snapshot), clock.now()),
            check: (op: ListingOp) => listings.check(kit.parse(snapshot), op, clock.now()),
            publicPhoto: (id: string) => (listings.publicPhoto(kit.parse(snapshot), id, clock.now()) ? db.photos!.get(id) : undefined),
            ownerPhoto: (id: string) => (listings.ownerPhoto(kit.parse(snapshot), id) ? db.photos!.get(id) : undefined),
            putPhoto: (row: Omit<PhotoRow, "atMs">) => db.photos!.put({ ...row, atMs: clock.now() }),
            uploadsLeft: () => listings.uploadsLeft(kit.parse(snapshot), clock.now()),
          },
        } : {}),
        ...(stock ? {
          stock: {
            ownerView: (language?: Language) => stock.ownerView(kit.parse(snapshot), clock.now(), language),
            check: (event: OwnerStockEvent) => stock.check(kit.parse(snapshot), event, clock.now()),
          },
        } : {}),
        ...(kit.channel.documents ? { documents: (key: DocumentsKey, language: Language) => kit.channel!.documents!(kit.parse(snapshot), entries, key, language) } : {}),
        ...(kit.channel.accountantFiles ? { accountantFiles: (period: string) => kit.channel!.accountantFiles!(kit.parse(snapshot), entries, period) } : {}),
        ...(kit.channel.parent ? { parent: (linkHash: string) => kit.channel!.parent!(kit.parse(snapshot), linkHash) } : {}),
        ...(kit.channel.material ? { material: (linkHash: string, batchId: string, fileId?: string) => kit.channel!.material!(kit.parse(snapshot), linkHash, batchId, fileId) } : {}),
        ...(kit.channel.ownerVoice ? { ownerVoice: (audio: { bytes: Uint8Array; mime: string }) => kit.channel!.ownerVoice!(audio) } : {}),
        ...(kit.channel.chatVoice ? { chatVoice: (audio: { bytes: Uint8Array; mime: string }) => kit.channel!.chatVoice!(audio) } : {}),
      } satisfies RuntimeChannel,
    } : {}),

    ready() {
      try { db.ping(); } catch (e) { return { ok: false, reason: `The store cannot be read: ${(e as Error).message}` }; }
      return runner.health();
    },

    async close() {
      await runner.stop();
      db.close();
    },
  };
}

/**
 * The items of the template's own settings that the owner may count (modules/stock): Orders' menu items ("menu:<id>") and Stock orders' items ("supply:<id>", with the unit when every catalogue
 * line for the item uses the same one). The runtime core is generic, so it reads only these two field names and imports nothing from a template; a template with neither (Bookings, Fees)
 * offers none, and the owner counts only their listings.
 */
function templateItems(settings: object, language: Language): ItemRef[] {
  const s = settings as { menu?: { id?: unknown; names?: Record<string, unknown> }[]; items?: { id?: unknown; names?: Record<string, unknown> }[]; catalogue?: { item?: unknown; unit?: unknown }[] };
  const nameOf = (names: Record<string, unknown> | undefined, id: string): string => {
    const v = names?.[language] ?? names?.en;
    return (Array.isArray(v) ? String(v[0] ?? "") : typeof v === "string" ? v : "") || id;
  };
  const out: ItemRef[] = [];
  for (const m of s.menu ?? []) if (typeof m.id === "string") out.push({ id: menuStockId(m.id), name: nameOf(m.names, m.id) });
  for (const i of s.items ?? []) {
    if (typeof i.id !== "string") continue;
    const units = new Set((s.catalogue ?? []).filter((l) => l.item === i.id).map((l) => String(l.unit)));
    out.push({ id: supplyStockId(i.id), name: nameOf(i.names, i.id), ...(units.size === 1 ? { unit: [...units][0] } : {}) });
  }
  return out;
}
