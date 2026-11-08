// The Orders template's own pages, apart from views.ts and views-fees.ts so the three do not grow into each other: the form for the shop and its menu, the form for the rules
// (cut-off, slots, advance and limits), the shop's settings in plain words on the shop page, the month's counts, and the messages a shop can use. The shell, the steps bar and the
// shared steps (languages, accounts, checks) are views.ts's; it hands over the two small helpers it shares (views-fees.ts `Helpers`).
import { formatInr } from "../../modules/language/format.ts";
import { itemName } from "../../templates/commerce/orders/src/settings.ts";
import type { Settings, Slot } from "../../templates/commerce/orders/src/settings.ts";
import type { OrdersReport } from "../../templates/commerce/orders/report/data.ts";
import { languageOptions } from "../../templates/commerce/bookings/demo/personalise.ts";
import { formatRupees } from "./cost.ts";
import type { OrdersForm } from "./orders.ts";
import { html, raw } from "./html.ts";
import type { Raw } from "./html.ts";
import type { Helpers } from "./views-fees.ts";
import type { Ctx, TemplateActivity, TemplateMessages, TemplateSummary } from "./views.ts";
import type { Draft } from "./setup.ts";

const ordersOf = (d: Draft): OrdersForm => (d as unknown as { orders: OrdersForm }).orders;
const area = (id: string, label: string, value: string, rows: number, help?: string): Raw =>
  html`<label class="field"><span>${label}</span><textarea name="${id}" rows="${rows}" autocomplete="off" spellcheck="false">${value}</textarea>${help ? html`<p class="help">${help}</p>` : ""}</label>`;

/** Step 1: the shop, its address and its menu. */
export function ordersBusinessBody(c: Ctx, d: Draft, action: string, back: Raw | string, next: Raw, h: Helpers): Raw {
  const b = c.w.setup.orders.business;
  const f = ordersOf(d);
  return html`<form method="post" action="${action}">${h.csrf}
  ${h.text(b.name, "name", d.form.name, { max: 80 })}
  ${h.text(b.address, "address", f.address, { max: 120 })}
  ${area("menu", b.menu, f.menu, 8, b.menuHelp)}
  ${back}${next}</form>`;
}

/** Step 2: the rules, and what they mean in plain words. */
export function ordersRulesBody(c: Ctx, d: Draft, action: string, back: Raw | string, next: Raw, lines: string[], h: Helpers): Raw {
  const r = c.w.setup.orders.rules;
  const f = ordersOf(d);
  return html`<form method="post" action="${action}">${h.csrf}
  <div class="row">${h.text(r.cutoffDays, "cutoffDays", f.cutoffDays, { mode: "numeric", max: 2 })}${h.text(r.cutoffTime, "cutoffTime", f.cutoffTime, { max: 5, help: r.cutoffHelp })}</div>
  ${area("pickup", r.pickup, f.pickup, 4, r.slotsHelp)}
  ${area("delivery", r.delivery, f.delivery, 3, r.deliveryHelp)}
  ${area("area", r.area, f.area, 2, r.areaHelp)}
  <div class="field"><span>${r.advance}</span><div class="days">
    <label><input type="radio" name="advanceMode" value="part" ${f.advanceMode === "part" ? raw("checked") : ""}> ${r.advancePart}</label>
    <label><input type="radio" name="advanceMode" value="full" ${f.advanceMode === "full" ? raw("checked") : ""}> ${r.advanceFull}</label></div></div>
  <div class="row">${h.text(r.percent, "advancePercent", f.advancePercent, { mode: "numeric", max: 3 })}${h.text(r.hold, "holdMinutes", f.holdMinutes, { mode: "numeric", max: 4 })}</div>
  <div class="row">${h.text(r.perDay, "maxPerDay", f.maxPerDay, { mode: "numeric", max: 5 })}${h.text(r.perOrder, "maxItems", f.maxItems, { mode: "numeric", max: 3 })}</div>
  <div class="row">${h.text(r.daysAhead, "daysAhead", f.daysAhead, { mode: "numeric", max: 2 })}${h.text(r.window, "windowHours", f.windowHours, { mode: "numeric", max: 3 })}</div>
  ${h.text(r.refund, "refund", f.refund, { mode: "numeric", max: 9, help: r.refundHelp })}
  ${h.text(r.approveOver, "approveOver", f.approveOver, { mode: "numeric", max: 9, help: r.approveHelp })}
  ${lines.length > 0 ? html`<h2>${c.w.setup.depositStep.whatThisMeans}</h2><ul class="plain">${lines.map((t) => html`<li><span class="mark">✓</span><span>${t}</span></li>`)}</ul>` : ""}
  ${back}${next}</form>`;
}

const slotText = (slots: Slot[], language: string): string => slots.map((s) => `${s.from}–${s.to}${s.names?.[language as "en"]?.[0] ? ` ${s.names[language as "en"]![0]}` : ""}`).join(", ");

/** The shop on the shop page: its menu with prices and daily stock, its slots, the languages and the owner. The rules are the certificate's own lines (orders.ts, ordersLimitLines). */
export function summaryOrders(c: Ctx, s: Settings): TemplateSummary {
  const w = c.w.ordersShop;
  const language = s.languages.includes(c.lang) ? c.lang : s.languages[0];
  return {
    heading: w.summaryMenu, rulesHeading: w.summaryRules,
    lines: [
      ...s.menu.map((i) => `${itemName(i, language)} · ${formatInr(i.priceInr)} · ${w.perDay(i.dailyStock)}`),
      `${w.pickup}: ${slotText(s.pickup.slots, language)}`,
      s.delivery ? `${w.delivery}: ${slotText(s.delivery.slots, language)} · ${s.delivery.area.join(", ")}` : w.noDelivery,
    ],
    languages: s.languages.map((l) => languageOptions().find((o) => o.code === l)?.label.split(" · ")[0] ?? l).join(", "),
    owner: s.owner.whatsapp,
  };
}

/** This month in counts, as the shop page shows them. Money is in rupees, as the owner's report says it. */
export function activityOrders(c: Ctx, r: OrdersReport): TemplateActivity {
  const a = c.w.ordersShop.activity;
  return {
    lines: [
      `${a.taken}: ${r.orders.taken} · ${a.completed}: ${r.orders.completed} · ${a.cancelled}: ${r.orders.cancelled} · ${a.holdsRanOut}: ${r.orders.holdsRanOut}`,
      `${a.collected}: ${formatRupees(r.money.collected.paise)} · ${a.toCollect}: ${formatRupees(r.sold.toCollect.paise)}`,
      `${a.pickup}: ${r.sold.pickup} · ${a.delivery}: ${r.sold.delivery} · ${c.w.shop.saidNo}: ${r.stopped.total}`,
    ],
    owner: r.owner,
  };
}

/** What each order can cost in messages, at most: the customer's confirmation, the notice to the owner, and one follow-up (a refund, or a hold that ran out). */
export const MESSAGES_PER_ORDER = 3;
/** The longest month. */
export const DAYS_IN_A_MONTH = 31;

/**
 * The most messages a shop's own rules allow in a month, from its settings: most orders a day for a month of 31 days, each with at most three messages. It is a ceiling from the
 * rules, not a forecast, and replies to customers' own messages come on top. `included` is the plan's allowance from the proposed price list, if it has one.
 */
export function ordersMessageCeiling(c: Ctx, s: Settings, included: number | null): TemplateMessages {
  const w = c.w.ordersShop.messages;
  const total = s.orders.maxPerDay * DAYS_IN_A_MONTH * MESSAGES_PER_ORDER;
  return { heading: w.heading, lines: [w.ceiling(s.orders.maxPerDay, MESSAGES_PER_ORDER, total), ...(included !== null ? [w.included(included)] : [])], note: w.note };
}
