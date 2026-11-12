// What a template gives the shop's assistant (item 11e): a skill. Bookings, Fees and Orders each make one inside their agent (templates/<...>/src/assistant.ts), so the
// reads see the step's store and the acts use the agent's own paths (the same limits, Guards and words as the fixed phrases). Used by conversation.ts, morning.ts and
// mood.ts; route.ts reads the routing part.
//
// Two halves, kept apart on purpose:
//  - READS are pure functions of the store as it is in this step: a day's list, who owes, open orders, what waits for the owner, money in, problems. The owner's
//    app and the morning line read the same functions, so what the owner is told and what they see agree.
//  - ACTS change something. `prepare` turns what the owner asked into the EXACT action from the store (never from a model), or says why it cannot be done; `execute`
//    does a prepared action. A card is made from `prepare`, and on the tap `prepare` runs again and must give the same digest (cards.ts) before `execute` runs.
import type { Language } from "../language/languages.ts";
import type { LocalDate } from "../core/time.ts";
import type { CardAction } from "./state.ts";

/** A skill's name. The record's `skill` ref carries it, so a line says which skill acted. */
export type SkillName = "bookings" | "fees" | "orders" | (string & {});

/** One row of a day's list, already in the owner's language. */
export interface DayRow { case: string; startMs: number; what: string; who: string; state: string }
/** Someone who owes (Fees): who, for what, how much, and when it was due. */
export interface OweRow { case: string; who: string; what: string; amountPaise: number; dueMs?: number }
/** An open order (Orders). */
export interface OpenRow { case: string; who: string; what: string; amountPaise: number; state: string }

/** Something waiting for the owner's answer, read from the skill's saved state (a late refund to decide, a deposit to mark, a waiver, a big order). */
export interface WaitingItem {
  case: string;
  /** The skill's own kind ("late_refund", "calendar", "deposit", "refund_owed", "waiver", "big_order"): words.ts words each one. */
  kind: string;
  amountPaise: number;
  /** The customer as the owner knows them (a name when the record has one, else the number). */
  who: string;
  /** What it is about, in the owner's language (a service and a time, a month's fee, an order). */
  what: string;
  /** Does the yes move money (or a limit)? Then a card, always. Every waiting item today does. */
  money: boolean;
  /** The two answers a card offers: what yes does, and what no does (a refusal, or a second choice such as "cancel and refund"). */
  yes: string;
  no?: string;
}

/** What the owner asked the skill to do, before it is checked against the store. The values come from the owner's words by rule, never from a model. */
export type Proposal =
  | { kind: "cancel"; case: string }
  | { kind: "refund"; case: string; amountPaise?: number }
  | { kind: "answer"; case: string; answer: "yes" | "no"; itemKind: string }
  | { kind: "message"; case: string; words: string };

/** A proposal checked against the store as it is now: the exact action and what the card shows, or why it cannot be done. */
export type Prepared =
  | {
    ok: true;
    action: CardAction;
    /** What the card says, from the same fields: who, the case, what it is about, the amount (0 when none). */
    shown: { who: string; what: string; amountPaise: number; words?: string };
    /** Above the shop's limit: after the tap Guard holds it and the owner approves once more (the relay's card). The card says so before the tap. */
    aboveLimit?: boolean;
  }
  | { ok: false; why: PrepareRefusal; candidates?: DayRow[] };

/** Why a proposal cannot become a card. words.ts words each one. */
export type PrepareRefusal =
  | "no_case" // no case has that reference
  | "not_yours" // the reference is another skill's
  | "not_live" // it is cancelled, done or expired
  | "not_booked" // still being asked about (no time agreed yet): nothing to cancel
  | "already_back" // the deposit is already going back: the booking cannot be cancelled with a refund from here
  | "cancel_first" // a refund of a booking that still stands: cancel it (its own card) to give the deposit back
  | "not_here"; // the skill does not take this act from the chat in the first release (Fees and Orders: cancel and refund)
  | "nothing_paid" // a refund with nothing paid
  | "too_much" // more than was paid
  | "nothing_waiting" // no answer is waiting on that case
  | "no_window" // the customer has not written in 24 hours: WhatsApp allows only approved templates
  | "opted_out" // the customer sent STOP
  | "amount_not_on_record" // a message with an amount the case does not have
  | "busy" // the case is in the middle of something (a refund Guard holds, a check in progress)

/** What an executed action came to, for the owner's answer. `told`: the customer was told. */
export interface Executed { ok: boolean; note: "done" | "held_by_guard" | "owed_by_owner" | "sent" | "failed" | "not_sent"; told?: boolean }

/** The assistant's line to one customer about their booking on a closed (or reopened) day. True when it went out. */
export type DayNotice = (c: { case: string; phone: string; startMs: number }) => Promise<boolean>;

/** How a skill is reached by a customer's message, for the router (route.ts). */
export interface SkillRouting {
  /** The case references it issues: /^b-\d+$/ for Bookings. */
  refs: RegExp;
  /** The button and list id prefixes it issues to customers ("svc:", "slot:"). */
  buttonPrefixes: readonly string[];
  /** A few words per language that say a message is for this skill ("book", "fees", "order"). */
  words: Partial<Record<Language, readonly string[]>>;
  /** The live case this number has with the skill, if any (a booking waiting for its deposit, an open fee). */
  liveCaseOf(phone: string): string | undefined;
}

export interface OwnerSkill {
  name: SkillName;
  routing: SkillRouting;
  // ---- reads (pure over this step's store) ----
  /** The day's list (Bookings): confirmed bookings and those waiting for the owner, in time order. */
  day?(date: LocalDate): DayRow[];
  /** Who owes (Fees). */
  owes?(): OweRow[];
  /** Open orders (Orders). */
  open?(): OpenRow[];
  /** What waits for the owner, oldest first. */
  waiting(): WaitingItem[];
  /** Things a person must look at that the owner cannot answer (a refund that needs the builder, a message that failed): for the mood, never a card. */
  problems(): number;
  /** The opening hours on a date, as minutes from midnight, or null when closed that weekday (Bookings). Left out: the skill keeps no hours. */
  hours?(date: LocalDate): { open: number; close: number } | null;
  // ---- acts ----
  /**
   * Close a date: the date is already in the assistant's closed days (so the free times leave it out); the skill tells each customer booked that day, through `notify`
   * (the assistant's words, a template so it reaches them outside their window), and returns the cases told. Nothing is cancelled or refunded. Left out: no days.
   */
  closeDay?(date: LocalDate, notify: DayNotice): Promise<{ asked: string[] }>;
  /** Undo a close: the date is offered again; the skill tells the customers asked who are still booked that day that their booking stands. */
  reopenDay?(date: LocalDate, asked: readonly string[], notify: DayNotice): Promise<{ told: string[] }>;
  /** The exact action for what the owner asked, read from the store as it is now. Pure: changes nothing. */
  prepare(p: Proposal): Prepared;
  /** Do a prepared action, exactly. Called only after a card's tap, with the card's saved action, and only when `prepare` gave the same digest again. */
  execute(action: CardAction): Promise<Executed>;
}
