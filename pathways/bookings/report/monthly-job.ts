// The monthly job (plan B54): on the first morning of the month, in the shop's time zone, the owner gets last month's report on WhatsApp, once.
//
// WHEN. From 09:00 on the 1st, not midnight: the owner is not woken, and a webhook that came in late on the last night has been handled by then. The job reports the month
// that has just ended and only that one. If the process was down on the 1st, the first tick after it is back sends it (a late report is better than none); a month before
// the last one is never made up. A month in which the record holds nothing but this job's own entries gets no message (a page of zeros tells the owner nothing they do not know) and no record
// entry; the job looks again after a restart and finds the same.
//
// ONCE, EVEN IF THE PROCESS DIES. The key is the shop (this record is one shop's) and the month ("2026-11", in `refs.report`). The record is the only memory:
//   1. an entry `send_message` / `attempted` with the key is written and SAVED before anything is sent (the runtime saves it through `save`);
//   2. the message is sent;
//   3. a second entry with the key says how it ended (`confirmed`, `unconfirmed`, or `failed`) and is saved.
// A month with an entry that is `attempted`, `confirmed` or `unconfirmed` is never sent again: each of those may have gone out. If the process died between 1 and 3 the next
// tick finds a claim with no ending, writes `unconfirmed` for it ("may or may not have gone out") and does not send. Only `failed` is tried again, and `failed` is only a
// refusal that says nothing was sent: an answer with a 4xx status (a template that is not approved, a wrong number of values), the connection refused, or Guard not able to
// decide. Anything else is `unconfirmed`: a timeout, a lost reply, a 5xx (WhatsApp may have taken the message and failed after it), a reply that gave no message id, or an
// error nobody expected. A retry is after an hour, at most three times in all. Then the builder is told in the log, and the page and the numbers are still in the report folder.
//
// THE RECORD. The entries are `send_message` to the owner, so the report counts them as messages to the owner, and the cost meter (bundle/lib/usage.ts, whatsappTypeOf)
// already counts a message to the owner as a utility message. Nothing new needs teaching to either.
//
// WHAT GOES OUT. The same report the builder's tools make (report/run.ts writes the page, the certificate and the signed data into a folder with a name nobody can guess),
// and the message built from it (report/whatsapp.ts): a template when the owner's 24-hour window is closed, plain text with the same words when it is open. When it is open
// the certificate's text also goes as a document, once, by link. The folder is meant to be served read-only at `pages.baseUrl`; this file does not serve it.
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { KeyObject } from "node:crypto";
import { ApiError, GuardUnavailableError, NotSentError, WindowClosedError } from "../src/adapters/faults.ts";
import type { Messaging, OutboundMessage } from "../src/adapters/messaging.ts";
import type { Store } from "../src/booking.ts";
import type { Clock } from "../src/clock.ts";
import type { ActionRecord, Outcome, RecordEntry } from "../src/record.ts";
import type { Language, Settings } from "../src/settings.ts";
import { HOUR, localParts, zonedToMs } from "../src/time.ts";
import { monthRange } from "./data.ts";
import type { GoLiveFinding, Source } from "./data.ts";
import { writeClientReport } from "./run.ts";
import { STRINGS } from "./strings.ts";
import { monthlyReportMessage } from "./whatsapp.ts";

/** The local hour from which last month's report may go. */
export const SEND_FROM_HOUR = 9;
/** After a refusal, how long before the next try, and how many tries in all. */
export const RETRY_AFTER_MS = HOUR;
export const MAX_TRIES = 3;

export interface MonthlyReportSetup {
  /** What the numbers were counted from: written on the report and in the message. */
  source: Source;
  /** Where the report folders go (one folder per report, named by a random token) and the address that folder is served at (https, no trailing slash). */
  pages: { dir: string; baseUrl: string };
  /** Read when the report is made, so a change to the badge or the name needs no restart. */
  options: () => { preparedBy: string; innovator: boolean };
  /** Signs the report and the certificate. Left out, they carry a digest and a code and say they are not signed. */
  key?: KeyObject;
  /** What the go-live certificate the shop was given shows. Left out, the report says none was given. */
  goLive?: () => GoLiveFinding;
  /** Test seam: the random part of the folder name. */
  token?: () => string;
}

export interface MonthlyReportContext {
  settings: Settings;
  clock: Clock;
  messaging: Messaging;
  record: ActionRecord;
  store: Store;
  /** Save the record as it is now. Called after the claim and after the ending, so a restart in between finds the claim. */
  save: () => void;
  log?: (line: string) => void;
}

export type MonthlyResult =
  | { done: false; why: "not-yet" | "already" | "quiet" | "waiting" | "gave-up" }
  | { done: true; month: string; outcome: Outcome; via: "template" | "text" };

const monthKey = (year: number, month: number): string => `${year}-${String(month).padStart(2, "0")}`;

/** The month before the one it is now in this time zone, as "2026-11" (December of the year before for January). */
export function lastMonth(now: number, timeZone: string): string {
  const t = localParts(now, timeZone);
  return t.month === 1 ? monthKey(t.year - 1, 12) : monthKey(t.year, t.month - 1);
}

/**
 * Did WhatsApp (or Guard in front of it) say no before anything was sent? Only then is it safe to send the same report again. A 5xx or a reply that is not understood
 * can come after the message was taken, so those are never "nothing was sent": the report is not sent twice for the sake of a retry.
 */
export function nothingWasSent(e: unknown): boolean {
  if (e instanceof NotSentError || e instanceof GuardUnavailableError) return true;
  return e instanceof ApiError && e.status >= 400 && e.status < 500;
}

/** The moment, in the shop's time zone, from which the report for the month before `now`'s may go: 09:00 on the 1st. */
export function sendFrom(now: number, timeZone: string): number {
  const t = localParts(now, timeZone);
  return zonedToMs({ year: t.year, month: t.month, day: 1 }, { hour: SEND_FROM_HOUR, minute: 0 }, timeZone);
}

export function createMonthlyReport(setup: MonthlyReportSetup) {
  let finished: { month: string; why: "already" | "gave-up" } | undefined; // the month this process found done or given up on, so a tick does not look again
  let quiet: string | undefined;

  async function run(ctx: MonthlyReportContext): Promise<MonthlyResult> {
    const { settings, clock, record } = ctx;
    const log = ctx.log ?? (() => undefined);
    const now = clock.now();
    const tz = settings.timezone;
    if (now < sendFrom(now, tz)) return { done: false, why: "not-yet" };
    const month = lastMonth(now, tz);
    if (finished?.month === month) return { done: false, why: finished.why };
    if (quiet === month) return { done: false, why: "quiet" };
    const owner = settings.owner.whatsapp;
    const language = settings.owner.language;

    // ---- has this month been sent, or tried? The record is the only memory. ----
    const mine = record.entries().filter((e) => e.action === "send_message" && e.refs.report === month);
    const last = mine.at(-1);
    if (last?.outcome === "attempted") { // the process stopped between the claim and the ending: it may have gone out
      record.append({
        conversation: owner, action: "send_message", outcome: "unconfirmed", inputs: { to: "owner", report: month }, language,
        notes: "The process stopped while this report was being sent, so it may or may not have reached the owner. It is not sent again.",
        refs: { to: "owner", report: month, ...(last.refs.code ? { code: last.refs.code } : {}), ...(last.refs.page ? { page: last.refs.page } : {}) },
      });
      ctx.save();
      log(`The monthly report for ${month} was being sent when the process stopped. It may or may not have reached the owner, and it will not be sent again. The record says so.`);
      finished = { month, why: "already" };
      return { done: false, why: "already" };
    }
    if (mine.some((e) => e.outcome === "confirmed" || e.outcome === "unconfirmed")) { finished = { month, why: "already" }; return { done: false, why: "already" }; }
    const refused = mine.filter((e) => e.outcome === "failed");
    if (refused.length >= MAX_TRIES) { finished = { month, why: "gave-up" }; return { done: false, why: "gave-up" }; }
    if (last && Date.parse(last.time) + RETRY_AFTER_MS > now) return { done: false, why: "waiting" };

    // ---- a month with nothing in the record gets no message ----
    const { from, to } = monthRange(month, tz);
    if (!hasActivity(record.entries(), from, to)) { quiet = month; return { done: false, why: "quiet" }; }

    // ---- make the report: the page, the certificate and the signed data, in a folder of their own ----
    const { preparedBy, innovator } = setup.options();
    const token = (setup.token ?? (() => randomBytes(16).toString("hex")))();
    const folder = join(setup.pages.dir, token);
    const made = writeClientReport({
      settings, entries: record.entries(), bookings: [...ctx.store.bookings.values()], month, language, out: folder, source: setup.source,
      preparedBy, innovator, now, ...(setup.key ? { key: setup.key } : {}), ...(setup.goLive ? { goLive: setup.goLive() } : {}),
    });
    const base = `${setup.pages.baseUrl}/${token}`;
    const message = monthlyReportMessage(made.report, language, { link: `${base}/report-${month}-${language}.html` });
    const refs = { to: "owner", report: month, code: made.code, page: token, templates: message.template.name };

    // ---- 1. claim the month, and save the claim before anything goes out ----
    record.append({ conversation: owner, action: "send_message", outcome: "attempted", inputs: { to: "owner", report: month, code: made.code }, language, refs });
    ctx.save();

    // ---- 2. send it ----
    let outcome: Outcome;
    let via: "template" | "text" = "template";
    let sent: OutboundMessage | undefined;
    let note: string | undefined;
    try {
      if (await ctx.messaging.isWindowOpen(owner).catch(() => false)) {
        try { sent = await ctx.messaging.sendText(owner, message.text); via = "text"; } catch (e) { if (!(e instanceof WindowClosedError)) throw e; sent = undefined; }
      }
      if (!sent) sent = await ctx.messaging.sendTemplate(owner, message.template);
      outcome = (await ctx.messaging.getMessage(sent.id)) ? "confirmed" : "unconfirmed";
    } catch (e) {
      outcome = !sent && nothingWasSent(e) ? "failed" : "unconfirmed"; // once WhatsApp has taken it (`sent`), whatever happens next, it went out
      note = (e as Error).message;
    }

    // ---- 3. say how it ended ----
    record.append({
      conversation: owner, action: "send_message", outcome, inputs: { to: "owner", report: month, code: made.code }, language,
      ...(note ? { notes: note } : {}), refs: { ...refs, ...(sent ? { messageId: sent.id, via } : {}) },
    });
    ctx.save();
    if (outcome === "failed") {
      const tries = refused.length + 1;
      log(`The monthly report for ${month} could not be sent to the owner (${note}). ${tries < MAX_TRIES ? `It will be tried again in an hour (try ${tries} of ${MAX_TRIES}).` : `That was the last try. The page is in ${folder}.`}`);
    } else {
      log(`The monthly report for ${month} was ${outcome === "confirmed" ? "sent" : "sent, but WhatsApp did not show it back"} to the owner as ${via === "text" ? "a message" : "a template"} (code ${made.code}).`);
      finished = { month, why: "already" };
    }

    // ---- the certificate's text as a document, once, only when the owner's window is open (a file is a session message); a missing copy costs nothing ----
    if (outcome === "confirmed" && via === "text" && typeof ctx.messaging.sendDocument === "function") await sendCertificate(ctx, { month, language, base, refs, certificateCode: made.certificateCode });
    return { done: true, month, outcome, via };
  }

  return { run };
}

async function sendCertificate(ctx: MonthlyReportContext, a: { month: string; language: Language; base: string; refs: Record<string, string>; certificateCode: string }): Promise<void> {
  const { settings, record } = ctx;
  const owner = settings.owner.whatsapp;
  const filename = `certificate-${a.month}-${a.language}.txt`;
  const refs = { to: "owner", reportFile: a.month, kind: "document", code: a.certificateCode, page: a.refs.page };
  const s = STRINGS[a.language];
  const doc = { link: `${a.base}/${filename}`, filename, caption: `${s.monthlyCertificate} · ${s.page.code}: ${a.certificateCode}` };
  record.append({ conversation: owner, action: "send_message", outcome: "attempted", inputs: { to: "owner", reportFile: a.month }, language: a.language, refs });
  ctx.save();
  let outcome: Outcome;
  let note: string | undefined;
  let id: string | undefined;
  try {
    const sent = await ctx.messaging.sendDocument!(owner, doc);
    id = sent.id;
    outcome = (await ctx.messaging.getMessage(sent.id)) ? "confirmed" : "unconfirmed";
  } catch (e) {
    outcome = nothingWasSent(e) ? "failed" : "unconfirmed";
    note = (e as Error).message;
  }
  record.append({ conversation: owner, action: "send_message", outcome, inputs: { to: "owner", reportFile: a.month }, language: a.language, ...(note ? { notes: note } : {}), refs: { ...refs, ...(id ? { messageId: id } : {}) } });
  ctx.save();
}

/** An entry this job wrote itself (the claim, the ending, the document). They are not the shop's activity: a month holding only these would otherwise be reported forever. */
const isOwn = (e: RecordEntry): boolean => e.action === "send_message" && (e.refs.report !== undefined || e.refs.reportFile !== undefined);

/** Is there any entry of the shop's in [from, to)? The record is in time order, so look from the end and stop as soon as it is before the month. */
function hasActivity(entries: readonly RecordEntry[], from: number, to: number): boolean {
  for (let i = entries.length - 1; i >= 0; i--) {
    const t = Date.parse(entries[i].time);
    if (t >= to || isOwn(entries[i])) continue;
    return t >= from;
  }
  return false;
}
