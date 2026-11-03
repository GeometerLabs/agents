// One demo world: the REAL agent on the in-memory stand-ins (createWorld) with a fake clock, plus the little the demo
// adds around it: a chat transcript (the fakes keep only what was sent OUT), the buttons' meaning, and one-at-a-time
// handling (the agent has no locking, so two quick taps must not interleave at its await points).
// Nothing here talks to a network. Everything is test money in memory.
import { LIVE_STATES, latestBooking } from "../src/booking.ts";
import type { Booking } from "../src/booking.ts";
import { WEEKDAY_NAMES, hindiPeriod } from "../src/language/format.ts";
import { formatTime } from "../src/language/format.ts";
import { CUSTOMER, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { LANGUAGES, hoursOn, serviceName } from "../src/settings.ts";
import type { Language, Settings } from "../src/settings.ts";
import { addDays, localParts, weekdayOf } from "../src/time.ts";
import { CUSTOMER_WORDS, uiFor } from "./strings.ts";
import type { Ui } from "./strings.ts";

export const MAX_CUSTOMER_MESSAGES = 200; // per world; the page offers "Start again" after that
export const MAX_MESSAGE_LENGTH = 300;
const TICK_MINUTES = 15; // time passes in steps: one big jump would skip reminders the agent sends one tick at a time

export interface Bubble { who: "me" | "agent"; text: string; time: string; template: boolean }
export interface Chip { text: string }
export type OwnerCommand = "approve" | "deny" | "retry";

export interface Demo {
  readonly settings: Settings;
  readonly world: World;
  readonly uiLanguage: string;
  readonly ui: Ui;
  readonly customerLog: Bubble[];
  readonly ownerLog: Bubble[];
  lastUsed: number;
  /** Run one action after the ones before it finish. */
  run<T>(action: () => Promise<T>): Promise<T>;
  say(text: string): Promise<string | undefined>;
  pay(times: 1 | 2): Promise<string | undefined>;
  advance(minutes: number): Promise<string | undefined>;
  cancel(): Promise<string | undefined>;
  owner(command: OwnerCommand, ref: string): Promise<string | undefined>;
  payTarget(): { booking: Booking; mode: "first" | "again" } | undefined;
  canCancel(): boolean;
  chips(): Chip[];
}

const fmtLanguage = (language: string): Language => ((LANGUAGES as readonly string[]).includes(language) ? language : "en") as Language;

export function createDemo(settings: Settings, nowMs: number): Demo {
  const uiLanguage = settings.owner.language;
  const ui = uiFor(uiLanguage);
  const world = createWorld({ settings, nowMs });
  const customerLog: Bubble[] = [];
  const ownerLog: Bubble[] = [];
  let sentSeen = 0;
  let customerMessages = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const clockText = (ms: number) => {
    const p = localParts(ms, settings.timezone);
    return formatTime(p, fmtLanguage(uiLanguage));
  };

  /** Copy anything the agent has sent since last time into the right chat, in the order it was sent. */
  function collect(): void {
    const outbox = world.messaging.outbox();
    for (; sentSeen < outbox.length; sentSeen++) {
      const m = outbox[sentSeen];
      const bubble: Bubble = { who: "agent", text: m.text, time: clockText(m.sentAt), template: m.kind === "template" };
      if (m.to === CUSTOMER) customerLog.push(bubble);
      else if (m.to === world.owner) ownerLog.push(bubble);
    }
  }

  /** After every tap: the payment provider's webhooks reach the agent (once each), then the chats are brought up to date. */
  async function settle(): Promise<void> {
    await world.deliverPaymentEvents();
    collect();
  }

  const demo: Demo = {
    settings, world, uiLanguage, ui, customerLog, ownerLog, lastUsed: Date.now(),

    run(action) {
      const next = queue.then(action, action);
      queue = next.catch(() => undefined);
      return next;
    },

    async say(text) {
      if (customerMessages >= MAX_CUSTOMER_MESSAGES) return ui.demoFull;
      customerMessages++;
      customerLog.push({ who: "me", text, time: clockText(world.clock.now()), template: false });
      await world.say(text);
      await settle();
      return undefined;
    },

    payTarget() {
      const booking = [...world.store.bookings.values()].reverse().find((b) => b.customer === CUSTOMER && (b.state === "awaiting_deposit" || b.state === "confirmed") && b.linkId);
      const link = booking ? world.linkFor(booking.id) : undefined;
      if (!booking || !link || link.status === "cancelled") return undefined;
      return { booking, mode: link.status === "created" ? "first" : "again" };
    },

    async pay(times) {
      const target = demo.payTarget();
      // A deposit nobody has paid can be paid once or twice (two phones); one already paid can only be paid again ("twice").
      if (!target || (target.mode === "again" && times === 1)) return ui.nothingToPay;
      const link = world.linkFor(target.booking.id)!;
      for (let i = 0; i < (target.mode === "first" ? times : 1); i++) world.payments.customerPays(link.id);
      await settle();
      return undefined;
    },

    async advance(minutes) {
      for (let left = minutes; left > 0; left -= TICK_MINUTES) await world.advance(Math.min(TICK_MINUTES, left));
      await settle();
      return undefined;
    },

    canCancel: () => latestBooking(world.store, CUSTOMER, LIVE_STATES) !== undefined,

    async cancel() {
      const language = world.store.customers.get(CUSTOMER)?.language ?? settings.languages[0];
      return demo.say((CUSTOMER_WORDS[language] ?? CUSTOMER_WORDS.en).cancel);
    },

    async owner(command, ref) {
      const text = `${command} ${ref}`;
      ownerLog.push({ who: "me", text, time: clockText(world.clock.now()), template: false });
      await world.say(text, { from: world.owner });
      await settle();
      return undefined;
    },

    chips: () => chipsFor(settings, uiLanguage, world.clock.now()),
  };
  return demo;
}

// ---- the suggestions under the chat ----------------------------------------------------------------------------------

const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Sentences a partner can tap instead of typing, written for THIS shop's first service, prices and opening days. */
export function chipsFor(settings: Settings, language: string, nowMs: number): Chip[] {
  const hindi = language === "hi";
  const service = settings.services[0];
  const name = serviceName(service, (hindi ? "hi" : "en") as Language);
  const today = localParts(nowMs, settings.timezone);
  const openOn = (ahead: number) => {
    const d = addDays(today, ahead);
    const hours = hoursOn(settings, weekdayOf(d));
    return hours ? { weekday: weekdayOf(d), hours } : undefined;
  };
  const firstOpen = (from: number) => {
    for (let ahead = from; ahead < from + 7; ahead++) { const o = openOn(ahead); if (o) return { ahead, ...o }; }
    return undefined;
  };
  const wordsFor = (hours: { open: number; close: number }) => {
    const candidates = [18 * 60, 11 * 60, 12 * 60, 15 * 60, hours.open];
    const minutes = candidates.find((m) => m >= hours.open && m + service.durationMinutes <= hours.close && m % settings.slotMinutes === 0)
      ?? Math.ceil(hours.open / settings.slotMinutes) * settings.slotMinutes;
    const h = Math.floor(minutes / 60);
    const mm = minutes % 60;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const clock = mm === 0 ? `${h12}` : `${h12}:${String(mm).padStart(2, "0")}`;
    return hindi ? `${hindiPeriod(h)} ${clock} बजे` : `${clock}${h < 12 ? "am" : "pm"}`;
  };

  const chips: Chip[] = [];
  const soon = firstOpen(1);
  if (soon) {
    const when = soon.ahead === 1 ? (hindi ? "कल" : "tomorrow") : soon.ahead === 2 ? (hindi ? "परसों" : "the day after tomorrow")
      : (hindi ? WEEKDAY_NAMES.hi[soon.weekday] : EN_DAYS[soon.weekday]);
    const at = wordsFor(soon.hours);
    chips.push({ text: hindi ? `${when} ${at} ${name} चाहिए` : `I want a ${name} ${when} at ${at}` });
    const offer = service.priceInr >= 20 ? Math.round((service.priceInr * 2) / 3 / 10) * 10 : Math.floor(service.priceInr / 2);
    if (offer >= 1 && offer < service.priceInr) {
      chips.push({ text: hindi ? `${when} ${at} ${name}, ₹${offer} में हो जाएगा?` : `${name} ${when} at ${at}, can you do it for ₹${offer}?` });
    }
  }
  const later = firstOpen(3);
  if (later) {
    const at = wordsFor(later.hours);
    chips.push({ text: hindi ? `अगले ${WEEKDAY_NAMES.hi[later.weekday]} ${at} ${name} चाहिए` : `I want a ${name} next ${EN_DAYS[later.weekday]} at ${at}` });
  }
  chips.push({ text: (CUSTOMER_WORDS[language] ?? CUSTOMER_WORDS.en).yes });
  return chips;
}
