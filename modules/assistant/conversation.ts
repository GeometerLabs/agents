// The owner's conversation with the shop's assistant (item 11e): the owner asks (a day's list, who owes, open orders, what needs me, money in) and asks for things to be
// done (close or reopen a day, cancel, refund, message a customer, answer what waits), in their own words, typed or as a voice note, in four languages. A template's
// agent calls `onOwnerMessage` where it used to answer "I didn't understand", after every fixed phrase has had its turn, and `onTick` on the clock's beat. It runs
// inside the agent's step, so whatever it changes is saved with the step, whole or not at all (modules/runtime/core.ts). The design: modules/Explanation.md, "The shop's assistant".
//
// The rules it keeps:
//  - money or a limit, and a message to a customer, come back as a CARD (cards.ts) and are done only on its tap; nothing changes before the tap;
//  - closing a day is done at once, said in passing, and undoable for a day;
//  - loosening a limit is not possible here (the partner's panel does it), and the owner is told so;
//  - every value comes from the record or from the words by rule (intents.ts); a model only picks the kind;
//  - every word goes out through modules/messaging/say.ts with the outgoing check over the values it states (words.ts).
import { isRelayReply } from "../approvals/buttons.ts";
import { addDays, zonedToMs } from "../core/time.ts";
import type { LocalDate } from "../core/time.ts";
import type { Clock } from "../core/clock.ts";
import { checkText } from "../language/check.ts";
import type { CheckFacts } from "../language/check.ts";
import { resolveDate } from "../language/dates.ts";
import type { Choice } from "../language/interactive.ts";
import type { Language } from "../language/languages.ts";
import { createSay } from "../messaging/say.ts";
import type { SayArgs } from "../messaging/say.ts";
import type { InboundMessage, Messaging } from "../messaging/messaging.ts";
import type { Decision } from "../limits/limits.ts";
import type { Outcome, RecordEntry } from "../record/record.ts";
import { actionDigest, cardButtonId, cardByCode, closeCard, expireCards, judgeReply, makeCard, openCards, parseCardReply, refusedBefore } from "./cards.ts";
import type { CardReply } from "./cards.ts";
import type { OwnerContext, OwnerIntent, OwnerKind } from "./intents.ts";
import { moodOf, outsideHours, todayIn } from "./mood.ts";
import type { Mood } from "./mood.ts";
import { stickerFor } from "./character.ts";
import type { AssistantSettings } from "./settings.ts";
import { UNDO_FOR_MS, assistantOf, compactAssistant, nextId } from "./state.ts";
import type { AssistantState, CardRecord } from "./state.ts";
import type { DayRow, OwnerSkill, Prepared, Proposal } from "./skill.ts";
import { dayFacts, render as renderTemplate, templateMessageFor } from "./templates.ts";
import type { AssistantTemplateId, TemplateFacts } from "./templates.ts";
import { CARD_LABELS, write } from "./words.ts";
import type { MessageData, MessageId } from "./words.ts";

/** The record's names for what the assistant does. Each line also carries `skill` when a skill acted, so the record shows which one. */
export const ASSISTANT_ACTIONS = {
  /** The owner's message, read: refs.intent, and what reading it cost (the understanding refs). The words are not kept. */
  read: "owner_assistant",
  /** A card was made (held_for_owner), done (confirmed), refused (confirmed, refs.decision "no"), void or expired (blocked). */
  card: "owner_card",
  closeDay: "close_day",
  reopenDay: "reopen_day",
} as const;

/** The money-in lines every template writes the same way: a gateway's payment, and the owner's mark (B74: the owner's statement, counted as recorded). */
export const MONEY_IN_ACTIONS = ["record_deposit", "record_payment", "owner_marked_paid"] as const;

/** At most this many cards go out for one "what needs me": a phone screen, not a backlog. The count says how many there are. */
export const CARDS_PER_ASK = 5;

export interface AssistantShop {
  name: string;
  timezone: string;
  owner: { whatsapp: string; language: Language };
  settings: AssistantSettings;
}

/** What the owner's words came to: the intent, a note for the record (a fallback), and what reading cost (the understanding refs). */
export interface OwnerRead { intent: OwnerIntent; note?: string; refs: Record<string, string> }

export interface AssistantDeps {
  shop: AssistantShop;
  /** The template's store: the assistant's part lives under `assistant` and is saved with the step. */
  store: { assistant?: AssistantState };
  /** The skills this runtime hosts (one today; modules/Explanation.md says why). */
  skills: OwnerSkill[];
  clock: Clock;
  messaging: Messaging;
  /** Read the owner's words: the owner's router through the template's reader (the same AI spend and button mode as a customer's). reading.ts makes it. */
  read(text: string): Promise<OwnerRead>;
  /** The template's record writer, by case id. */
  log(caseId: string | null, conversation: string, action: string, outcome: Outcome, inputs: unknown, more: { notes?: string; refs?: Record<string, string>; decisions?: Decision[]; language?: Language }): void;
  /** The record as it is in this step, for money in. */
  entries(): readonly RecordEntry[];
  /** A customer's language and STOP, for the lines the assistant sends customers (a closed day). */
  languageOf(phone: string): Language;
  optedOut(phone: string): boolean;
  /**
   * The owner's voice note as words, through the voice notes job's service (modules/voice, `hear`). Left out: an owner's voice note gets the line asking to type, as
   * before. The structure is the voice service's own, so it is handed in as it is.
   */
  hearing?: { hear(ref: unknown): Promise<{ ok: true; text: string; costMicroInr: number } | { ok: false; reason: string; costMicroInr: number }> };
}

/** Everything a message to say carries here: the words, already written for the language say() picks (the owner's, or the customer's). */
interface Said extends SayArgs {
  booking: string | null;
  write(language: Language): { text: string; check: CheckFacts; template?: { id: AssistantTemplateId; facts: TemplateFacts } };
  buttons?: Choice[];
}
interface SaidFacts { language: Language; text: string; check: CheckFacts; template?: { id: AssistantTemplateId; facts: TemplateFacts } }

/** The kinds a shop offers, from its skills: what intents.ts may read as more than "not offered". */
export function kindsOf(skills: readonly OwnerSkill[]): OwnerKind[] {
  const kinds: OwnerKind[] = ["waiting", "money", "cancel", "refund", "message", "undo", "limit", "help"];
  if (skills.some((s) => s.day)) kinds.push("day");
  if (skills.some((s) => s.owes)) kinds.push("owes");
  if (skills.some((s) => s.open)) kinds.push("open_orders");
  if (skills.some((s) => s.closeDay)) kinds.push("close_day", "reopen_day");
  if (skills.some((s) => s.move)) kinds.push("move");
  return kinds;
}

/** "2026-11-16" for a date: how a closed day is kept. */
export const isoDate = (d: LocalDate): string => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** Is this date one the owner closed? The skills read it too, so the free times leave it out (each template's slot finder). */
export const isClosedDay = (state: AssistantState | undefined, d: LocalDate): boolean => state?.closedDays.includes(isoDate(d)) ?? false;

// The owner's side of the shop's assistant, made fresh in each step over that step's store (the agent is, too), so it keeps nothing between steps.
export function createAssistant(deps: AssistantDeps) {
  const { shop, clock, skills } = deps;
  const owner = shop.owner.whatsapp;
  const tz = shop.timezone;
  const state = (): AssistantState => assistantOf(deps.store);
  const context: OwnerContext = { kinds: kindsOf(skills) };

  // ---- saying ----
  const sayVoice = {
    render: (_id: string, f: SaidFacts) => f.text,
    templateMessage: (a: { facts: SaidFacts; text: string }) => {
      if (!a.facts.template) throw new Error("this reply has no approved WhatsApp template, so it goes only while the person's 24-hour window is open");
      return templateMessageFor(a.facts.template.id, a.facts.template.facts, a.text);
    },
    genericNames: { customer: "assistant_no_template", reminder: "assistant_no_template", owner: "assistant_no_template" },
    matches(text: string, f: SaidFacts): Decision {
      const r = checkText(text, f.check);
      return r.ok ? { ruleId: "message-matches-record", verdict: "allow", reason: "every value in the message is on the record" } : { ruleId: "message-matches-record", verdict: "block", reason: r.problems.join(" ") };
    },
  };
  const say = createSay<Said, SaidFacts>({
    messaging: deps.messaging, voice: sayVoice as never, owner: shop.owner,
    languageOf: (phone) => (phone === owner ? shop.owner.language : deps.languageOf(phone)),
    optedOut: (phone) => phone !== owner && deps.optedOut(phone),
    factsFor: (a, language) => { const w = a.write(language); return { language, ...w }; },
    interactiveFor: (a, f) => ({ body: f.text, buttons: a.buttons! }),
    inputsOf: (a) => ({ templates: a.templates }),
    log: (caseId, phone, action, outcome, inputs, more) => deps.log(caseId, phone, action, outcome, inputs, more),
    heldBack: async () => undefined, // a line to a customer that fails the check is the assistant's own words: it is recorded as blocked, and the owner sees the result in the reply
  });

  /** Tell the owner something, in their language. `buttons` make it a card (while their window is open; otherwise the text, which says how to answer). */
  async function tell<K extends MessageId>(id: K, data: MessageData[K], more: { caseId?: string | null; buttons?: Choice[] } = {}): Promise<boolean> {
    return say({
      booking: more.caseId ?? null, phone: owner, to: "owner", templates: [`assistant_${id}`],
      write: (language) => { const w = write(id, data, language, tz); return { text: w.text, check: w.facts }; },
      ...(more.buttons ? { offer: { kind: "card" }, buttons: more.buttons } : {}),
    });
  }

  /** Tell a customer about their booking on a closed or reopened day: a template, so it can go outside their window too. */
  async function tellCustomer(id: "day_closed" | "day_open", caseId: string, phone: string, date: LocalDate, startMs: number): Promise<boolean> {
    return say({
      booking: caseId, phone, to: "customer", templates: [`assistant_${id}`],
      write: (language) => {
        const facts = dayFacts({ language, timeZone: tz, shop: shop.name, date, startMs });
        return { text: renderTemplate(id, facts), check: facts.check, template: { id, facts } };
      },
    });
  }

  const logLine = (caseId: string | null, action: string, outcome: Outcome, inputs: unknown, refs: Record<string, string>, notes?: string) =>
    deps.log(caseId, owner, action, outcome, inputs, { refs, ...(notes ? { notes } : {}), language: shop.owner.language });

  const skillOf = (ref: string): OwnerSkill | undefined => skills.find((s) => s.routing.refs.test(ref));
  const skillNamed = (name: string): OwnerSkill | undefined => skills.find((s) => s.name === name);
  const today = (): LocalDate => todayIn(clock.now(), tz);
  const dateOf = (intent: OwnerIntent): LocalDate | undefined => (intent.date ? resolveDate(intent.date, clock.now(), tz)?.date : undefined);
  const before = (a: LocalDate, b: LocalDate) => isoDate(a) < isoDate(b);

  // ---- cards ----
  const buttonsFor = (kind: string, code: string, hasNo: boolean): Choice[] => {
    const l = CARD_LABELS[shop.owner.language];
    const yes = kind === "message" ? l.send : l.approve;
    const no = kind === "message" ? l.dontSend : l.refuse;
    return [{ id: cardButtonId("yes", code), title: yes }, ...(hasNo ? [{ id: cardButtonId("no", code), title: no }] : [])];
  };

  /** A card for a prepared action: unless the owner said no to this same action in the last day. Sends it; returns whether a card went. */
  async function offerCard(skill: OwnerSkill, proposal: Proposal, prepared: Extract<Prepared, { ok: true }>): Promise<boolean> {
    const now = clock.now();
    const s = state();
    const digest = actionDigest(prepared.action);
    const no = refusedBefore(s, digest, now);
    if (no) { await tell("refused_before", { atMs: no.atMs }, { caseId: proposal.case }); return false; }
    const { card, code } = makeCard(s, prepared.action, proposal as unknown as Record<string, unknown>, now);
    // A "no" is offered when it means something: a refusal. A deposit to mark and a refund sent have only the one answer (the owner taps when it is true).
    const hasNo = !(proposal.kind === "answer" && (proposal.itemKind === "deposit" || proposal.itemKind === "refund_owed"));
    logLine(proposal.case, ASSISTANT_ACTIONS.card, "held_for_owner", { card: card.id, kind: proposal.kind },
      { card: card.id, skill: skill.name, kind: proposal.kind, digest, case: proposal.case, ...(prepared.shown.amountPaise > 0 ? { amountPaise: String(prepared.shown.amountPaise) } : {}) },
      "a card with the exact change was shown to the owner; nothing is done until they tap it");
    await tell("card", {
      kind: proposal.kind, ...(proposal.kind === "answer" ? { itemKind: proposal.itemKind } : {}), who: prepared.shown.who, ref: proposal.case, what: prepared.shown.what,
      amountPaise: prepared.shown.amountPaise, ...(prepared.shown.words !== undefined ? { words: prepared.shown.words } : {}), ...(prepared.aboveLimit ? { aboveLimit: true } : {}), code, hasNo,
    }, { caseId: proposal.case, buttons: buttonsFor(proposal.kind, code, hasNo) });
    return true;
  }

  /** Prepare and offer; a refusal is said in words. A message is offered only while the customer's window is open: a free text cannot go outside it. */
  async function propose(proposal: Proposal): Promise<void> {
    const skill = skillOf(proposal.case);
    if (!skill) { await tell("refusal", { why: "no_case", ref: proposal.case }); return; }
    const prepared = skill.prepare(proposal);
    if (!prepared.ok) { await tell("refusal", { why: prepared.why, ref: proposal.case }); return; }
    if (prepared.action.kind === "message" && !(await windowOpen(String(prepared.action.fields.phone)))) { await tell("refusal", { why: "no_window", ref: proposal.case, who: prepared.shown.who }); return; }
    await offerCard(skill, proposal, prepared);
  }

  const windowOpen = (phone: string): Promise<boolean> => deps.messaging.isWindowOpen(phone).catch(() => false);

  /**
   * A message card's yes: the owner's words, as typed, under the shop's name, to the customer the card named. Only while their window is open (checked again: it may
   * have closed since the card), through the outgoing check, and never after STOP (say() holds it back).
   */
  async function sendWords(card: CardRecord): Promise<{ ok: boolean; note: "sent" | "not_sent" }> {
    const phone = String(card.action.fields.phone);
    const words = String(card.action.fields.words);
    if (!(await windowOpen(phone))) return { ok: false, note: "not_sent" };
    const sent = await say({ booking: card.action.case, phone, to: "customer", templates: ["assistant_owner_words"], write: (language) => { const w = write("owner_words", { shop: shop.name, words }, language, tz); return { text: w.text, check: w.facts }; } });
    return sent ? { ok: true, note: "sent" } : { ok: false, note: "not_sent" };
  }

  async function onCardReply(reply: CardReply): Promise<void> {
    const now = clock.now();
    const s = state();
    const current = (card: CardRecord) => {
      const skill = skillNamed(card.action.skill);
      if (!skill) return { ok: false as const, why: "not_yours" };
      const p = skill.prepare(card.proposal as unknown as Proposal);
      return p.ok ? { ok: true as const, action: p.action } : { ok: false as const, why: p.why };
    };
    const v = judgeReply(s, reply, now, current);
    const refs = (card: CardRecord, decision: string) => ({ card: card.id, skill: card.action.skill, kind: card.action.kind, digest: card.digest, decision, via: reply.via });
    if (v.verdict === "unknown") { logLine(null, ASSISTANT_ACTIONS.card, "blocked", { via: reply.via }, { decision: reply.answer, via: reply.via }, "a reply with a card code no card has"); await tell("card_unknown", {}); return; }
    const card = v.card;
    const caseId = card.action.case;
    if (v.verdict === "closed") { logLine(caseId, ASSISTANT_ACTIONS.card, "blocked", { card: card.id }, refs(card, reply.answer), `the card is already ${card.state}: nothing was done`); await tell("card_closed", {}, { caseId }); return; }
    if (v.verdict === "expired") { closeCard(s, card, "expired", now); logLine(caseId, ASSISTANT_ACTIONS.card, "blocked", { card: card.id }, refs(card, reply.answer), "the card ran out before the tap: nothing was done"); await tell("card_expired", {}, { caseId }); return; }
    if (v.verdict === "refuse") {
      closeCard(s, card, "refused", now);
      logLine(caseId, ASSISTANT_ACTIONS.card, "confirmed", { card: card.id }, refs(card, "no"), "the owner said no; the same action is not offered again for 24 hours");
      await tell("refused", {}, { caseId });
      return;
    }
    if (v.verdict === "gone") {
      closeCard(s, card, "void", now);
      logLine(caseId, ASSISTANT_ACTIONS.card, "blocked", { card: card.id }, refs(card, "yes"), `the action can no longer be done (${v.why}): nothing was done`);
      await tell("refusal", { why: v.why as never, ref: caseId }, { caseId });
      return;
    }
    if (v.verdict === "changed") {
      // The amount, the payment or the customer is not what the card showed. Nothing is done: the old card is void and a new one shows the action as it is now.
      closeCard(s, card, "void", now);
      logLine(caseId, ASSISTANT_ACTIONS.card, "blocked", { card: card.id }, refs(card, "yes"), "what the card showed is not what the store holds now (a changed amount, payment or customer): nothing was done, and a new card was made");
      await tell("card_changed", {}, { caseId });
      const skill = skillNamed(card.action.skill)!;
      const proposal = card.proposal as unknown as Proposal;
      const prepared = skill.prepare(proposal);
      if (prepared.ok) await offerCard(skill, proposal, prepared);
      return;
    }
    // "do": the saved action, exactly, by the skill that owns it.
    const skill = skillNamed(card.action.skill)!;
    const executed = card.action.kind === "message" ? await sendWords(card) : await skill.execute(card.action);
    closeCard(s, card, "done", now);
    logLine(caseId, ASSISTANT_ACTIONS.card, executed.ok ? "confirmed" : "failed", { card: card.id }, { ...refs(card, "yes"), result: executed.note }, "the owner tapped yes; the skill did the card's saved action");
    const amountPaise = typeof card.action.fields.amountPaise === "number" ? card.action.fields.amountPaise : 0;
    // "done" in the owner's words: a cancel that gave money back says the money is on its way (the card asked for both), a cancel with nothing paid says cancelled
    const kind = card.action.kind;
    const note = executed.note !== "done" ? executed.note : kind === "refund" || (kind === "cancel" && amountPaise > 0) ? "refund_sent" : kind === "cancel" ? "cancelled" : kind === "message" ? "sent" : "answered";
    const who = typeof card.action.fields.who === "string" ? card.action.fields.who : caseId;
    await tell("done", { note, who, ref: caseId, amountPaise }, { caseId });
  }

  // ---- asking ----
  /** The cases the owner might mean when no reference was given: the named day's, or today's and the next two days'. */
  function candidates(intent: OwnerIntent): DayRow[] {
    const dayOf = skills.find((s) => s.day);
    if (!dayOf) return [];
    const named = dateOf(intent);
    const days = named ? [named] : [0, 1, 2].map((n) => addDays(today(), n));
    return days.flatMap((d) => dayOf.day!(d));
  }

  /** What waits for the owner: each skill's waiting items as cards (the oldest first), and any card the owner was shown and has not answered, shown again with a fresh code. */
  async function showWaiting(): Promise<void> {
    const now = clock.now();
    const offers: { skill: OwnerSkill; proposal: Proposal }[] = [];
    for (const skill of skills) for (const item of skill.waiting()) offers.push({ skill, proposal: { kind: "answer", case: item.case, answer: "yes", itemKind: item.kind } });
    for (const card of openCards(state(), now)) {
      const skill = skillNamed(card.action.skill);
      const proposal = card.proposal as unknown as Proposal;
      if (skill && !offers.some((o) => o.proposal.case === proposal.case && o.proposal.kind === proposal.kind)) offers.push({ skill, proposal });
    }
    await tell("waiting_head", { count: offers.length });
    for (const o of offers.slice(0, CARDS_PER_ASK)) {
      const prepared = o.skill.prepare(o.proposal);
      if (prepared.ok) await offerCard(o.skill, o.proposal, prepared);
    }
  }

  // ---- a closed day ----
  async function closeDay(date: LocalDate): Promise<void> {
    const skill = skills.find((s) => s.closeDay);
    if (!skill) { await tell("not_offered", {}); return; }
    const s = state();
    if (before(date, today())) { await tell("past_day", { date }); return; }
    if (skill.hours && skill.hours(date) === null) { await tell("weekday_closed", { date }); return; }
    if (isClosedDay(s, date)) { await tell("already_closed", { date }); return; }
    // Close first, so the free times stop offering the date in this same step, then ask the customers booked that day to pick another one.
    s.closedDays = [...s.closedDays, isoDate(date)].sort();
    const { asked } = await skill.closeDay!(date, (c) => tellCustomer("day_closed", c.case, c.phone, date, c.startMs));
    const undo = nextId(s, "u");
    s.undo.push({ id: undo, kind: "close_day", skill: skill.name, date: isoDate(date), asked, atMs: clock.now(), untilMs: clock.now() + UNDO_FOR_MS });
    logLine(null, ASSISTANT_ACTIONS.closeDay, "confirmed", { date: isoDate(date) }, { skill: skill.name, date: isoDate(date), asked: String(asked.length), undo },
      "the owner closed this date: it is no longer offered, and the customers booked that day were asked to pick another day; nothing was cancelled or refunded");
    await tell("closed", { date, asked: asked.length });
  }

  async function reopenDay(date: LocalDate): Promise<void> {
    const s = state();
    if (!isClosedDay(s, date)) { await tell("not_closed", { date }); return; }
    const record = [...s.undo].reverse().find((u) => u.kind === "close_day" && u.date === isoDate(date) && !u.done);
    const skill = skillNamed(record?.skill ?? "") ?? skills.find((x) => x.reopenDay);
    s.closedDays = s.closedDays.filter((d) => d !== isoDate(date));
    const { told } = skill?.reopenDay ? await skill.reopenDay(date, record?.asked ?? [], (c) => tellCustomer("day_open", c.case, c.phone, date, c.startMs)) : { told: [] };
    if (record) record.done = true;
    logLine(null, ASSISTANT_ACTIONS.reopenDay, "confirmed", { date: isoDate(date) }, { ...(skill ? { skill: skill.name } : {}), date: isoDate(date), told: String(told.length), ...(record ? { undo: record.id } : {}) },
      "the owner opened this date again; the customers asked to move who are still booked that day were told their booking stands");
    await tell("reopened", { date, told: told.length });
  }

  // ---- a booking moved by the owner (not money: done at once, said in passing, undoable) ----
  async function move(intent: OwnerIntent): Promise<void> {
    if (!intent.ref) { await tell("need_ref", { kind: "move", rows: candidates(intent) }); return; }
    const skill = skillOf(intent.ref);
    if (!skill) { await tell("refusal", { why: "no_case", ref: intent.ref }); return; }
    if (!skill.move || !skill.moveTarget) { await tell("not_offered", {}); return; }
    if (!intent.date && !intent.time) { await tell("need_when", { ref: intent.ref }); return; }
    const target = skill.moveTarget(intent.ref, { ...(dateOf(intent) ? { date: dateOf(intent)! } : {}), ...(intent.time ? { time: intent.time } : {}) });
    if (!target.ok) { await tell("move_failed", { ref: intent.ref, why: target.why }); return; }
    const r = await skill.move(intent.ref, target.startMs);
    if (!r.ok) { await tell("move_failed", { ref: intent.ref, why: r.why, toMs: target.startMs }); return; }
    const s = state();
    const undo = nextId(s, "u");
    s.undo.push({ id: undo, kind: "move", skill: skill.name, date: isoDate(todayIn(r.fromMs, tz)), asked: [], case: intent.ref, fromMs: r.fromMs, toMs: r.toMs, atMs: clock.now(), untilMs: clock.now() + UNDO_FOR_MS });
    logLine(intent.ref, "move_booking", "confirmed", { from: r.fromMs, to: r.toMs }, { skill: skill.name, from: new Date(r.fromMs).toISOString(), to: new Date(r.toMs).toISOString(), undo }, "the owner moved this booking; the customer was told by the agent's own reschedule message");
    await tell("moved", { ref: intent.ref, toMs: r.toMs }, { caseId: intent.ref });
  }

  async function undoLast(): Promise<void> {
    const now = clock.now();
    const last = [...state().undo].reverse().find((u) => !u.done && u.untilMs > now);
    if (!last) { await tell("undo_none", {}); return; }
    if (last.kind === "move") {
      const skill = skillNamed(last.skill);
      const r = skill?.move ? await skill.move(last.case!, last.fromMs!) : { ok: false as const, why: "failed" as const };
      if (!r.ok) { await tell("move_failed", { ref: last.case!, why: r.why, toMs: last.fromMs! }); return; }
      last.done = true;
      logLine(last.case!, "move_booking", "confirmed", { from: r.fromMs, to: r.toMs }, { skill: last.skill, undo: last.id }, "the owner undid their move: the booking is back at its old time");
      await tell("moved_back", { ref: last.case!, toMs: r.toMs }, { caseId: last.case! });
      return;
    }
    const [y, m, d] = last.date.split("-").map(Number);
    await reopenDay({ year: y, month: m, day: d });
  }

  // ---- the owner's message ----
  /**
   * The owner's message, after the template's fixed phrases. True when the assistant took it (it always does, except a message that is not the owner's: the caller
   * checks the sender first). The relay's replies are dropped without a word, as the agents drop them.
   */
  async function onOwnerMessage(msg: InboundMessage): Promise<boolean> {
    if (msg.from !== owner) return false;
    if (isRelayReply(msg)) return true;
    // A tap is always a card's. Typed, "no thanks" has the shape of "no <code>": it is a card's reply only when a card has that code; otherwise it is words to read.
    const card = parseCardReply(msg);
    if (card && (card.via === "button" || cardByCode(state(), card.code))) { await onCardReply(card); return true; }
    const read = await deps.read(msg.text);
    const intent = read.intent;
    logLine(null, ASSISTANT_ACTIONS.read, "confirmed", { intent: intent.kind }, { intent: intent.kind, ...read.refs, ...(intent.ref ? { case: intent.ref } : {}) }, read.note);
    const offered = intent.kind === "unknown" || context.kinds.includes(intent.kind);
    if (!offered) { await tell("not_offered", {}); return true; }
    switch (intent.kind) {
      case "help": await tell("help", { name: shop.settings.character.name, shop: shop.name, kinds: context.kinds }); break;
      case "limit": await tell("limit_no", {}); break;
      case "day": {
        const date = dateOf(intent) ?? today();
        const rows = skills.flatMap((s) => s.day?.(date) ?? []).sort((a, b) => a.startMs - b.startMs);
        await tell("day_list", { date, rows, closed: isClosedDay(state(), date) });
        break;
      }
      case "owes": await tell("owes_list", { rows: skills.flatMap((s) => s.owes?.() ?? []) }); break;
      case "open_orders": await tell("open_list", { rows: skills.flatMap((s) => s.open?.() ?? []) }); break;
      case "waiting": await showWaiting(); break;
      case "money": { const date = dateOf(intent) ?? today(); await tell("money_in", { date, ...moneyOn(deps.entries(), date, tz) }); break; }
      case "close_day": { const date = dateOf(intent); if (!date) await tell("need_date", { kind: "close_day" }); else await closeDay(date); break; }
      case "reopen_day": { const date = dateOf(intent); if (!date) await tell("need_date", { kind: "reopen_day" }); else await reopenDay(date); break; }
      case "undo": await undoLast(); break;
      case "move": await move(intent); break;
      case "cancel": case "refund": case "message": {
        if (!intent.ref) { await tell("need_ref", { kind: intent.kind, rows: candidates(intent) }); break; }
        if (intent.kind === "message" && !intent.words) { await tell("need_words", { ref: intent.ref }); break; }
        const proposal: Proposal = intent.kind === "cancel" ? { kind: "cancel", case: intent.ref }
          : intent.kind === "refund" ? { kind: "refund", case: intent.ref, ...(intent.amountPaise !== undefined ? { amountPaise: intent.amountPaise } : {}) }
            : { kind: "message", case: intent.ref, words: intent.words! };
        await propose(proposal);
        break;
      }
      default: await tell("not_understood", { kinds: context.kinds });
    }
    return true;
  }

  /**
   * The owner's voice note as words, or null (no voice service for the owner, or the note could not be made out: the owner is then told to type it). The caller reads
   * the words as the owner's typed message. The audio is never kept; what it cost is the voice service's to count (modules/voice).
   */
  async function hearOwner(msg: InboundMessage & { media?: unknown }): Promise<InboundMessage | null> {
    if (!deps.hearing || msg.media === undefined) return null;
    const heard = await deps.hearing.hear(msg.media);
    if (!heard.ok) { logLine(null, ASSISTANT_ACTIONS.read, "blocked", { voiceNote: true }, { voice: heard.reason }, "the owner's voice note could not be made out"); await tell("voice_unheard", {}); return { ...msg, text: "" }; }
    return { id: msg.id, from: msg.from, text: heard.text, timestamp: msg.timestamp };
  }

  /** On the clock's beat: cards past their time are closed, and what is no longer needed is taken off the store. The morning line is its own job (morning.ts). */
  function onTick(): void {
    const now = clock.now();
    const s = state();
    for (const c of expireCards(s, now)) logLine(c.action.case, ASSISTANT_ACTIONS.card, "blocked", { card: c.id }, { card: c.id, skill: c.action.skill, kind: c.action.kind, digest: c.digest, decision: "none" }, "the card ran out without a tap: nothing was done");
    compactAssistant(s, now, isoDate(today()));
  }

  /** The mood now, from the skills' reads and the clock (mood.ts), and the sticker that shows it. */
  const mood = () => shopMood(skills, state(), clock.now(), tz, shop.settings);

  return { onOwnerMessage, hearOwner, onTick, mood, kinds: context.kinds };
}
export type Assistant = ReturnType<typeof createAssistant>;

/** The shop's mood from its skills' reads, the assistant's cards and closed days, and the clock; and the sticker for it. Pure: the owner's app and the morning line call it. */
export function shopMood(skills: readonly OwnerSkill[], state: AssistantState | undefined, nowMs: number, timeZone: string, settings: AssistantSettings): { mood: Mood; sticker: string } {
  const d = todayIn(nowMs, timeZone);
  const bookings = skills.find((s) => s.day);
  const hoursSkill = skills.find((s) => s.hours);
  const hours = hoursSkill ? hoursSkill.hours!(d) : null;
  const m = moodOf({
    problems: skills.reduce((n, s) => n + s.problems(), 0),
    waiting: skills.reduce((n, s) => n + s.waiting().length, 0) + (state ? openCards(state, nowMs).length : 0),
    closedToday: isClosedDay(state, d) || (hoursSkill !== undefined && hours === null),
    outsideHours: hoursSkill !== undefined && outsideHours(hours, d, nowMs, timeZone),
    todayStartsMs: bookings ? bookings.day!(d).map((r) => r.startMs) : [],
    nowMs,
  });
  return { mood: m, sticker: stickerFor(settings.character, m) };
}

/** Money recorded on a date, read from the record: every confirmed payment line, the owner's marks included (they are the owner's statement, B74). */
export function moneyOn(entries: readonly RecordEntry[], date: LocalDate, timeZone: string): { paise: number; payments: number } {
  const from = zonedToMs(date, { hour: 0, minute: 0 }, timeZone);
  const to = zonedToMs(addDays(date, 1), { hour: 0, minute: 0 }, timeZone);
  let paise = 0;
  let payments = 0;
  for (const e of entries) {
    if (e.outcome !== "confirmed" || !(MONEY_IN_ACTIONS as readonly string[]).includes(e.action)) continue;
    const t = Date.parse(e.time);
    const amount = Number(e.refs.amountPaise);
    if (t < from || t >= to || !Number.isSafeInteger(amount) || amount <= 0) continue;
    paise += amount;
    payments += 1;
  }
  return { paise, payments };
}
