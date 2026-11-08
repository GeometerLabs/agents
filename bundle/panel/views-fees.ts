// The Fees template's own pages, apart from views.ts so that file stays Bookings' and the two do not grow into each other: the form for the centre and its batches and
// students, the form for the rules of the month, the centre's settings in plain words on the shop page, the month's counts, and the messages a centre can use. The shell,
// the steps bar and the shared steps (languages, accounts, checks) are views.ts's; it hands over the two small helpers it shares.
import { formatInr } from "../../modules/language/format.ts";
import { batchName } from "../../templates/education/fees/src/settings.ts";
import type { Settings } from "../../templates/education/fees/src/settings.ts";
import type { FeesReport } from "../../templates/education/fees/report/data.ts";
import type { FeesForm } from "./fees.ts";
import { MAX_BATCHES } from "./fees.ts";
import { html, raw } from "./html.ts";
import type { Raw } from "./html.ts";
import { languageOptions } from "../../templates/commerce/bookings/demo/personalise.ts";
import type { Ctx, TemplateActivity, TemplateMessages, TemplateSummary } from "./views.ts";
import { formatRupees } from "./cost.ts";
import type { Draft } from "./setup.ts";

/** The helpers views.ts shares with the Fees pages. */
export interface Helpers {
  csrf: Raw;
  text(label: string, name: string, value: string, o?: { type?: string; help?: string; mode?: string; autocomplete?: string; max?: number }): Raw;
}

const feesOf = (d: Draft): FeesForm => (d as unknown as { fees: FeesForm }).fees;

/** Step 1: the centre, its batches and fees, and its students. */
export function feesBusinessBody(c: Ctx, d: Draft, action: string, back: Raw | string, next: Raw, h: Helpers): Raw {
  const b = c.w.setup.fees.business;
  const f = feesOf(d);
  return html`<form method="post" action="${action}">${h.csrf}
  ${h.text(b.name, "name", d.form.name, { max: 80 })}
  ${h.text(b.address, "address", f.address, { max: 120 })}
  <h2>${b.batches}</h2><p class="note">${b.batchesHint}</p>
  ${f.batches.slice(0, MAX_BATCHES).map((r, i) => html`<div class="svc"><div class="row">${h.text(b.batchName, `batch_name_${i}`, r.name, { max: 60 })}${h.text(b.batchFee, `batch_fee_${i}`, r.fee, { mode: "numeric", max: 9 })}</div></div>`)}
  <label class="field"><span>${b.students}</span><textarea name="students" rows="8" autocomplete="off" spellcheck="false">${f.students}</textarea><p class="help">${b.studentsHelp}</p></label>
  ${back}${next}</form>`;
}

/** Step 2: the rules of the month, and what they mean in plain words. */
export function feesRulesBody(c: Ctx, d: Draft, action: string, back: Raw | string, next: Raw, lines: string[], h: Helpers): Raw {
  const r = c.w.setup.fees.rules;
  const f = feesOf(d);
  return html`<form method="post" action="${action}">${h.csrf}
  ${h.text(r.dueDay, "dueDay", f.dueDay, { mode: "numeric", max: 3 })}
  ${h.text(r.graceDays, "graceDays", f.graceDays, { mode: "numeric", max: 3 })}
  ${h.text(r.lateFee, "lateFee", f.lateFee, { mode: "numeric", max: 9 })}
  ${h.text(r.reminderDays, "reminderDays", f.reminderDays, { max: 60, help: r.reminderDaysHelp })}
  <div class="row">${h.text(r.reminderHour, "reminderHour", f.reminderHour, { mode: "numeric", max: 3 })}${h.text(r.reminderMost, "reminderMost", f.reminderMost, { mode: "numeric", max: 3 })}</div>
  <div class="field"><div class="days"><label><input type="checkbox" name="partAllowed" ${f.partAllowed ? raw("checked") : ""}> ${r.partAllowed}</label></div></div>
  ${h.text(r.partMin, "partMin", f.partMin, { mode: "numeric", max: 9 })}
  ${h.text(r.waiver, "waiver", f.waiver, { mode: "numeric", max: 9, help: r.waiverHelp })}
  ${h.text(r.refund, "refund", f.refund, { mode: "numeric", max: 9, help: r.refundHelp })}
  ${lines.length > 0 ? html`<h2>${c.w.setup.depositStep.whatThisMeans}</h2><ul class="plain">${lines.map((t) => html`<li><span class="mark">✓</span><span>${t}</span></li>`)}</ul>` : ""}
  ${back}${next}</form>`;
}

/** The centre on the shop page: each batch with its fee and its students, the languages and the owner. The rules are the certificate's own lines (fees.ts, feesLimitLines). */
export function summaryFees(c: Ctx, s: Settings): TemplateSummary {
  const w = c.w.feesShop;
  const language = s.languages.includes(c.lang) ? c.lang : s.languages[0];
  return {
    heading: c.w.shop.summaryFees, rulesHeading: c.w.shop.summaryRules,
    lines: s.batches.map((b) => `${batchName(b, language)} · ${formatInr(b.monthlyFeeInr)} · ${w.studentsIn(s.students.filter((x) => x.batchId === b.id).length)}`),
    languages: s.languages.map((l) => languageOptions().find((o) => o.code === l)?.label.split(" · ")[0] ?? l).join(", "),
    owner: s.owner.whatsapp,
  };
}

/** This month in counts, as the shop page shows them. */
export function activityFees(c: Ctx, r: FeesReport): TemplateActivity {
  const a = c.w.feesShop.activity;
  return {
    lines: [
      `${a.opened}: ${r.fees.opened} · ${a.paidInFull}: ${r.fees.paidInFull} · ${a.partlyPaid}: ${r.fees.partlyPaid} · ${a.stillOpen}: ${r.fees.stillOpen}`,
      `${a.collected}: ${formatRupees(r.money.collected.paise)} · ${a.stillToCollect}: ${formatRupees(r.fees.stillToCollect.paise)}`,
      `${a.reminders}: ${r.reminders.sent} · ${c.w.shop.saidNo}: ${r.stopped.total}`,
    ],
    owner: r.owner,
  };
}

/**
 * The most messages a centre's own rules allow in a month, from its settings: each student's fee can be reminded up to the most reminders, and a receipt follows a payment.
 * It is a ceiling from the rules, not a forecast, and replies to parents' own messages come on top. `included` is the plan's allowance from the proposed price list, if it has one.
 */
export function messageCeiling(c: Ctx, s: Settings, included: number | null): TemplateMessages {
  const w = c.w.feesShop.messages;
  const students = s.students.length;
  const mostReminders = s.reminders.maxPerMonth;
  return { heading: w.heading, lines: [w.ceiling(students, mostReminders, students * (mostReminders + 1)), ...(included !== null ? [w.included(included)] : [])], note: w.note };
}
