// The shop owner's one plain service notice for the licence's wind-down and final stop (plan B13), the same for every template. ONCE for each `paid_through`, even
// if the process dies: the record is the only memory, the way the monthly report keeps it (modules/report/monthly-job.ts).
//
//   1. Is the shop restricted (the wind-down or the final stop) by a lease that lists it? No: nothing to say.
//   2. The notice's key is "<wind_down|stop>:<paid_through>". A send_message to the owner with `refs.licence` = that key that went out (confirmed or unconfirmed)
//      means it was sent; a claim with no ending (the process stopped between the two) may have gone out, so it is closed as unconfirmed and NOT sent again.
//   3. Otherwise: claim it (`attempted`), save, send (as text in the owner's open window, else the approved utility template), read it back, write how it ended, save.
//      A refusal before anything went out is tried again an hour later, three tries in all.
//
// The template gives the words (`message`): what the notice says, in the owner's language, naming the partner. It is about the service, never about money. The stop's says
// the partner's service has ended and that the owner can write to hello@geometer.dev to be connected with another local partner; it offers no copy or export (that is the builder's or partner's). It runs on the
// clock's beat after the agent's own work, from the runtime core, like the monthly report. In the final stop it is the one message that still goes from the shop.
import { WindowClosedError } from "../core/faults.ts";
import { HOUR } from "../core/time.ts";
import type { Language } from "../language/languages.ts";
import type { Messaging, OutboundMessage, TemplateMessage } from "../messaging/messaging.ts";
import type { Clock } from "../core/clock.ts";
import type { ActionRecord, Outcome } from "../record/record.ts";
import { nothingWasSent } from "../report/monthly-job.ts";
import type { LicenceNow } from "./rules.ts";

export type NoticeKind = "wind_down" | "stop";
export const NOTICE_RETRY_MS = HOUR;
export const NOTICE_TRIES = 3;

export interface NoticeContext<Store> {
  settings: { timezone: string; owner: { whatsapp: string; language: Language } };
  clock: Clock;
  messaging: Messaging;
  record: ActionRecord;
  store: Store;
  save: () => void;
  log?: (line: string) => void;
}

export interface LicenceNoticeSetup<Store> {
  licence: () => LicenceNow;
  /** The notice in the owner's language: the words for an open window, and the approved template that carries the same words when it is closed. */
  message(kind: NoticeKind, a: { store: Store; record: ActionRecord; now: number; licence: LicenceNow }): { text: string; template: TemplateMessage };
}

/** The notice due now, and its key, or undefined. The stop's notice replaces the wind-down's: a shop that went straight to the stop hears of the stop only. */
export function noticeDue(l: LicenceNow): { kind: NoticeKind; key: string } | undefined {
  if (!l.restricted || l.paidThrough === null) return undefined;
  const kind: NoticeKind = l.state === "stopped" ? "stop" : "wind_down";
  return { kind, key: `${kind}:${l.paidThrough}` };
}

export function createLicenceNotice<Store>(setup: LicenceNoticeSetup<Store>) {
  async function run(ctx: NoticeContext<Store>): Promise<{ sent: false; why: string } | { sent: true; outcome: Outcome }> {
    const l = setup.licence();
    const due = noticeDue(l);
    if (!due) return { sent: false, why: "none-due" };
    const { record, settings } = ctx;
    const owner = settings.owner.whatsapp;
    const language = settings.owner.language;
    const now = ctx.clock.now();
    const mine = record.entries().filter((e) => e.action === "send_message" && e.refs.licence === due.key);
    const last = mine.at(-1);
    if (last?.outcome === "attempted") {
      record.append({ conversation: owner, action: "send_message", outcome: "unconfirmed", inputs: { to: "owner", licence: due.key }, language, notes: "The process stopped while this service notice was being sent, so it may or may not have reached the owner. It is not sent again.", refs: { to: "owner", licence: due.key } });
      ctx.save();
      return { sent: false, why: "already" };
    }
    if (mine.some((e) => e.outcome === "confirmed" || e.outcome === "unconfirmed")) return { sent: false, why: "already" };
    const refused = mine.filter((e) => e.outcome === "failed");
    if (refused.length >= NOTICE_TRIES) return { sent: false, why: "gave-up" };
    if (last && Date.parse(last.time) + NOTICE_RETRY_MS > now) return { sent: false, why: "waiting" };

    const message = setup.message(due.kind, { store: ctx.store, record, now, licence: l });
    const refs = { to: "owner", licence: due.key, templates: message.template.name };
    record.append({ conversation: owner, action: "send_message", outcome: "attempted", inputs: { to: "owner", licence: due.key }, language, refs });
    ctx.save();
    let sent: OutboundMessage | undefined;
    let via: "template" | "text" = "template";
    let outcome: Outcome;
    let note: string | undefined;
    try {
      if (await ctx.messaging.isWindowOpen(owner).catch(() => false)) {
        try { sent = await ctx.messaging.sendText(owner, message.text); via = "text"; } catch (e) { if (!(e instanceof WindowClosedError)) throw e; sent = undefined; }
      }
      if (!sent) sent = await ctx.messaging.sendTemplate(owner, message.template);
      outcome = (await ctx.messaging.getMessage(sent.id)) ? "confirmed" : "unconfirmed";
    } catch (e) {
      outcome = !sent && nothingWasSent(e) ? "failed" : "unconfirmed";
      note = (e as Error).message;
    }
    record.append({ conversation: owner, action: "send_message", outcome, inputs: { to: "owner", licence: due.key }, language, ...(note ? { notes: note } : {}), refs: { ...refs, ...(sent ? { messageId: sent.id, via } : {}) } });
    ctx.save();
    ctx.log?.(outcome === "failed"
      ? `The owner's service notice (${due.kind === "stop" ? "the final stop" : "the wind-down"}) could not be sent (${note}). ${refused.length + 1 < NOTICE_TRIES ? "It is tried again in an hour." : "That was the last try."}`
      : `The owner was sent the service notice for ${due.kind === "stop" ? "the final stop" : "the wind-down"}${outcome === "unconfirmed" ? ", but WhatsApp did not show it back" : ""}.`);
    return { sent: true, outcome };
  }
  return { run };
}
