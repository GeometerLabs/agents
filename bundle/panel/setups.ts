// What the panel does differently for each template, in one table. Bookings is the default (setup.ts, views.ts, the demo's form); every other template the phone can set up has a
// row here, so a new template is one more row, not one more `if` in server.ts and views.ts. A row holds the phone form's two steps (its starting draft, how a saved shop becomes a
// draft, what each step refuses, how the draft becomes settings), the pieces of the shop page and the checks page that are the template's own, and the monthly report. The row for a
// shop is found by its template's id (the lock's name), the row for a form by the manifest's `setup`: they are the same word for every template so far.
import { readGoLiveCertificate as bookingsGoLive } from "../../templates/commerce/bookings/report/go-live.ts";
import { writeClientReport } from "../../templates/commerce/bookings/report/run.ts";
import { readGoLiveCertificate as feesGoLive } from "../../templates/education/fees/report/go-live.ts";
import { writeFeesReport } from "../../templates/education/fees/report/run.ts";
import { readGoLiveCertificate as ordersGoLive } from "../../templates/commerce/orders/report/go-live.ts";
import { writeOrdersReport } from "../../templates/commerce/orders/report/run.ts";
import type { Exported } from "./activity.ts";
import { feesMonthlyFromExport, ordersMonthlyFromExport } from "./activity.ts";
import { applyFeesBusiness, applyFeesRules, buildFeesSettings, feesDraftFromShop, feesLimitLines, newFeesDraft, runtimeForFees } from "./fees.ts";
import { applyOrdersBusiness, applyOrdersRules, buildOrdersSettings, newOrdersDraft, ordersDraftFromShop, ordersLimitLines } from "./orders.ts";
import type { Built, Draft, StepResult, Body } from "./setup.ts";
import type { ShopMeta } from "./shops.ts";
import type { Template } from "./templates.ts";
import type { Words } from "./words.ts";
import { feesBusinessBody, feesRulesBody, activityFees, messageCeiling, summaryFees } from "./views-fees.ts";
import type { Helpers } from "./views-fees.ts";
import { activityOrders, ordersBusinessBody, ordersMessageCeiling, ordersRulesBody, summaryOrders } from "./views-orders.ts";
import type { Ctx, TemplatePieces } from "./views.ts";
import type { Raw } from "./html.ts";
import type { Language } from "../../modules/language/languages.ts";

/** What the monthly report route needs of a template: how a go-live certificate is read for its settings, and how its report is written from the export. */
export interface ReportKind {
  readGoLive(text: string, settings: any): { finding: any };
  write(run: { settings: any; data: Exported; month: string; language: Language; out: string; source: "stand-in" | "test-mode" | "live"; key?: import("node:crypto").KeyObject; preparedBy?: string; innovator: boolean; goLive?: any; now: number; tenant: string }): unknown;
}

/** The monthly report of each template. A shop with no lock the panel knows is a Bookings shop. */
export const REPORTS: Record<string, ReportKind> = {
  bookings: { readGoLive: bookingsGoLive, write: ({ data, ...run }) => writeClientReport({ ...run, entries: data.entries, bookings: data.bookings }) },
  fees: { readGoLive: feesGoLive, write: ({ data, ...run }) => writeFeesReport({ ...run, entries: data.entries, dues: data.dues ?? [] }) },
  orders: { readGoLive: ordersGoLive, write: ({ data, ...run }) => writeOrdersReport({ ...run, entries: data.entries, orders: data.orders ?? [] }) },
};
export const reportOf = (kind: string): ReportKind => (Object.hasOwn(REPORTS, kind) ? REPORTS[kind] : REPORTS.bookings);

/** A template the phone sets up with its own two forms (every one but Bookings). */
export interface Setup {
  newDraft(id: string, accountId: string, template: Template, example: any, now: string): Draft;
  draftFromShop(id: string, accountId: string, templateId: string, shopId: string, settings: any, runtime: Record<string, any> | undefined, meta: ShopMeta, now: string): Draft;
  applyBusiness(draft: Draft, body: Body, w: Words): StepResult;
  applyRules(draft: Draft, body: Body, w: Words): StepResult;
  /** The settings the draft makes (`raw`, when there is one, is what a builder would write and what is saved). */
  build(draft: Draft, example: any): Built;
  /** runtime.json: who things are. */
  runtime(phoneNumberId: string, serverModel?: { wire: string; model: string }, gateway?: boolean): Record<string, unknown>;
  /** The shop's limits as one sentence each, in the person's language (the certificate's own lines). */
  limitLines(draft: Draft, example: any, language: Language, saved?: any): string[];
  /** The titles of the two forms. */
  titles(w: Words): { business: string; rules: string };
  businessBody(c: Ctx, d: Draft, action: string, back: Raw | string, next: Raw, h: Helpers): Raw;
  rulesBody(c: Ctx, d: Draft, action: string, back: Raw | string, next: Raw, lines: string[], h: Helpers): Raw;
  /** The pieces of the shop page: the settings in plain words, this month's counts when the record is shared, the labels of the live states, and the messages the rules allow. */
  pieces(c: Ctx, settings: any, data: Exported | null, month: string, included: number | null, nowMs: number): TemplatePieces;
  /** The messages the rules allow, for the checks page (settings of the saved shop, or of the draft, or the example's). */
  messages(c: Ctx, settings: any, included: number | null): TemplatePieces["messages"];
}

export const SETUPS: Record<string, Setup> = {
  fees: {
    newDraft: newFeesDraft, draftFromShop: feesDraftFromShop, applyBusiness: applyFeesBusiness, applyRules: applyFeesRules, build: buildFeesSettings, runtime: runtimeForFees, limitLines: feesLimitLines,
    titles: (w) => w.setup.fees.steps, businessBody: feesBusinessBody, rulesBody: feesRulesBody,
    pieces: (c, settings, data, month, included, nowMs) => {
      const report = data ? feesMonthlyFromExport(settings, data, month, "live", nowMs) : undefined;
      return { summary: summaryFees(c, settings), ...(report ? { activity: activityFees(c, report) } : {}), states: c.w.shop.feeStates, messages: messageCeiling(c, settings, included) };
    },
    messages: messageCeiling,
  },
  orders: {
    newDraft: newOrdersDraft, draftFromShop: ordersDraftFromShop, applyBusiness: applyOrdersBusiness, applyRules: applyOrdersRules, build: buildOrdersSettings,
    // an Orders shop calls payments and messaging and no calendar, exactly as a Fees centre does: the same runtime.json
    runtime: runtimeForFees, limitLines: ordersLimitLines,
    titles: (w) => w.setup.orders.steps, businessBody: ordersBusinessBody, rulesBody: ordersRulesBody,
    pieces: (c, settings, data, month, included, nowMs) => {
      const report = data ? ordersMonthlyFromExport(settings, data, month, "live", nowMs) : undefined;
      return { summary: summaryOrders(c, settings), ...(report ? { activity: activityOrders(c, report) } : {}), states: c.w.ordersShop.states, messages: ordersMessageCeiling(c, settings, included) };
    },
    messages: ordersMessageCeiling,
  },
};

/** The row for a template's id or `setup` word; undefined for Bookings (and for any template this panel cannot set up). */
export const setupOf = (key: string | undefined): Setup | undefined => (key !== undefined && Object.hasOwn(SETUPS, key) ? SETUPS[key] : undefined);
