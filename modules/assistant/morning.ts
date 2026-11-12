// The morning line (item 11e): one short message a day to the owner, in their language: what today holds (a booking shop's bookings and the first time, a centre's unpaid
// fees, a shop's open orders), money recorded yesterday, and how
// many things wait for them. A runtime job on the clock's beat (modules/runtime/core.ts `daily`), beside the monthly report, because like it it must save its claim
// before it sends (the agent's step saves only at its end). Each template hands it its skills, read-only over the store (templates/<...>/src/assistant.ts).
//
// WHEN. From the shop's `assistant.morning.at` (08:00 when not set), for four hours. A process that was down all morning does not send a stale morning line in the
// afternoon. SILENT on a closed day (the weekday has no opening hours, or the owner closed the date) and on a day with nothing to say (no bookings today, nothing
// recorded yesterday, nothing waiting), so the owner is not paid for, or woken by, an empty message.
//
// ONCE, EVEN IF THE PROCESS DIES: the monthly report's protocol (modules/report/monthly-job.ts), keyed by the date in `refs.morning`. A claim (`send_message`
// attempted) is written and saved before the send; the ending (confirmed, unconfirmed, failed) after. A claim with no ending is never sent again; only `failed` (nothing
// went out) is tried again, after an hour, three times at most.
//
// WHAT GOES OUT. The template `owner_morning` (templates.ts): as plain text while the owner's 24-hour window is open, as the approved template outside it. The words are
// the template's body filled in, either way, and checked against the values first. The record line names the sticker for the shop's mood (character.ts), for when the
// drawings exist; no picture is sent yet.
import { HOUR, addDays, zonedToMs } from "../core/time.ts";
import type { Clock } from "../core/clock.ts";
import { checkText } from "../language/check.ts";
import { WindowClosedError } from "../core/faults.ts";
import type { Messaging, OutboundMessage } from "../messaging/messaging.ts";
import type { ActionRecord, Outcome } from "../record/record.ts";
import { nothingWasSent } from "../report/monthly-job.ts";
import { isClosedDay, isoDate, moneyOn, shopMood } from "./conversation.ts";
import type { AssistantShop } from "./conversation.ts";
import { openCards } from "./cards.ts";
import { todayIn } from "./mood.ts";
import type { OwnerSkill } from "./skill.ts";
import type { AssistantState } from "./state.ts";
import { morningFacts, render, templateMessageFor } from "./templates.ts";
import type { MorningToday } from "./templates.ts";

/** How long after its hour the morning line may still go. */
export const MORNING_WINDOW_MS = 4 * HOUR;
export const RETRY_AFTER_MS = HOUR;
export const MAX_TRIES = 3;

export interface MorningContext<Store extends { assistant?: AssistantState }> {
  clock: Clock;
  messaging: Messaging;
  record: ActionRecord;
  store: Store;
  log: (line: string) => void;
  /** Save the record and the store as they are now: after the claim and after the ending. */
  save: () => void;
}

export interface MorningSetup<Store extends { assistant?: AssistantState }> {
  /** The shop as the assistant knows it; undefined when the shop has no assistant (no morning line). */
  shop: AssistantShop | undefined;
  /** The skills over this store, read-only. */
  skills(store: Store): OwnerSkill[];
}

export type MorningResult =
  | { done: false; why: "off" | "not-yet" | "too-late" | "already" | "closed" | "quiet" | "waiting" | "gave-up" | "check" }
  | { done: true; date: string; outcome: Outcome; via: "template" | "text" };

// The runtime's daily job for the owner's morning line. It keeps, per process, only the day it found done, so a tick does not read the record again.
export function createMorningJob<Store extends { assistant?: AssistantState }>(setup: MorningSetup<Store>) {
  let finished: string | undefined;

  async function run(ctx: MorningContext<Store>): Promise<MorningResult> {
    const shop = setup.shop;
    if (!shop?.settings.morningAt) return { done: false, why: "off" };
    const tz = shop.timezone;
    const now = ctx.clock.now();
    const today = todayIn(now, tz);
    const key = isoDate(today);
    if (finished === key) return { done: false, why: "already" };
    const from = zonedToMs(today, shop.settings.morningAt, tz);
    if (now < from) return { done: false, why: "not-yet" };
    const owner = shop.owner.whatsapp;
    const language = shop.owner.language;

    // ---- has today's been sent, or tried? The record is the only memory. ----
    const mine = ctx.record.entries().filter((e) => e.action === "send_message" && e.refs.morning === key);
    const last = mine.at(-1);
    if (last?.outcome === "attempted") {
      ctx.record.append({ conversation: owner, action: "send_message", outcome: "unconfirmed", inputs: { to: "owner", morning: key }, language, refs: { to: "owner", morning: key }, notes: "The process stopped while the morning line was being sent, so it may or may not have reached the owner. It is not sent again." });
      ctx.save();
      finished = key;
      return { done: false, why: "already" };
    }
    if (mine.some((e) => e.outcome === "confirmed" || e.outcome === "unconfirmed" || e.outcome === "blocked")) { finished = key; return { done: false, why: "already" }; }
    const refused = mine.filter((e) => e.outcome === "failed");
    if (refused.length >= MAX_TRIES) { finished = key; return { done: false, why: "gave-up" }; }
    if (last && Date.parse(last.time) + RETRY_AFTER_MS > now) return { done: false, why: "waiting" };
    if (refused.length === 0 && now >= from + MORNING_WINDOW_MS) { finished = key; return { done: false, why: "too-late" }; }

    // ---- silent on a closed day, and on a day with nothing to say ----
    const skills = setup.skills(ctx.store);
    const state = ctx.store.assistant;
    const hoursSkill = skills.find((s) => s.hours);
    if (isClosedDay(state, today) || (hoursSkill && hoursSkill.hours!(today) === null)) { finished = key; return { done: false, why: "closed" }; }
    // what today holds, per skill: a day's bookings, the fees not paid, the open orders
    const parts: MorningToday[] = [];
    for (const s of skills) {
      if (s.day) { const rows = s.day(today); parts.push({ bookings: rows.length, ...(rows[0] ? { firstMs: Math.min(...rows.map((r) => r.startMs)) } : {}) }); }
      if (s.owes) { const owes = s.owes(); parts.push({ owes: owes.length, owedPaise: owes.reduce((n, r) => n + r.amountPaise, 0) }); }
      if (s.open) parts.push({ open: s.open().length });
    }
    const something = parts.some((t) => ("bookings" in t ? t.bookings : "owes" in t ? t.owes : t.open) > 0);
    const waiting = skills.reduce((n, s) => n + s.waiting().length, 0) + (state ? openCards(state, now).length : 0);
    const money = moneyOn(ctx.record.entries(), addDays(today, -1), tz);
    if (!something && money.paise === 0 && waiting === 0) { finished = key; return { done: false, why: "quiet" }; }

    // ---- the words: the template's body filled in, and checked against its own values ----
    const facts = morningFacts({ language, timeZone: tz, shop: shop.name, name: shop.settings.character.name, today, parts, moneyPaise: money.paise, waiting });
    const text = render("morning", facts);
    const { sticker, mood } = shopMood(skills, state, now, tz, shop.settings);
    const refs = { to: "owner", morning: key, templates: "owner_morning", mood, sticker };
    const check = checkText(text, facts.check);
    if (!check.ok) {
      ctx.record.append({ conversation: owner, action: "send_message", outcome: "blocked", inputs: { to: "owner", morning: key }, language, refs, notes: `The morning line did not match its record, so it was not sent: ${check.problems.join(" ")}` });
      ctx.save();
      finished = key;
      return { done: false, why: "check" };
    }

    // ---- 1. claim the day, and save the claim before anything goes out ----
    ctx.record.append({ conversation: owner, action: "send_message", outcome: "attempted", inputs: { to: "owner", morning: key }, language, refs });
    ctx.save();

    // ---- 2. send it ----
    let outcome: Outcome;
    let via: "template" | "text" = "template";
    let sent: OutboundMessage | undefined;
    let note: string | undefined;
    try {
      if (await ctx.messaging.isWindowOpen(owner).catch(() => false)) {
        try { sent = await ctx.messaging.sendText(owner, text); via = "text"; } catch (e) { if (!(e instanceof WindowClosedError)) throw e; sent = undefined; }
      }
      if (!sent) sent = await ctx.messaging.sendTemplate(owner, templateMessageFor("morning", facts, text));
      outcome = (await ctx.messaging.getMessage(sent.id)) ? "confirmed" : "unconfirmed";
    } catch (e) {
      outcome = !sent && nothingWasSent(e) ? "failed" : "unconfirmed";
      note = (e as Error).message;
    }

    // ---- 3. say how it ended ----
    ctx.record.append({ conversation: owner, action: "send_message", outcome, inputs: { to: "owner", morning: key }, language, ...(note ? { notes: note } : {}), refs: { ...refs, ...(sent ? { messageId: sent.id, via } : {}) } });
    ctx.save();
    if (outcome === "failed") ctx.log(`The morning line could not be sent to the owner (${note}). ${refused.length + 1 < MAX_TRIES ? "It is tried again in an hour." : "That was the last try for today."}`);
    else finished = key;
    return { done: true, date: key, outcome, via };
  }

  return { run };
}
