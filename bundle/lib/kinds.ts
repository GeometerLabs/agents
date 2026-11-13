// The templates the bundle can run, in one place. Everything the bundle needs to know about a template that is not the same for every template is here: which Guards a shop
// of it has (Bookings: Razorpay, WhatsApp, Calendar; Fees: Razorpay and WhatsApp, no calendar), how its settings are checked, how its Razorpay limits are made from them, how
// its runtime.json is checked, and the checks and papers the panel makes for it (the hand check, the go-live certificate).
//
// A shop says which template it is in its pathway.lock (`fees@0.1.0`). The rest of the bundle asks `kindFor(lock.pathway)` instead of importing a template, so a Fees shop never
// goes through Bookings' code, and a third template is one more entry here, plus its `template.json`.
//
// The templates are imported by path from this repository. A shop pinned to an OLDER version of a template keeps that version's own runtime config check (lib/pathways.ts,
// pinnedRuntimeCheck); the settings check and the Guard limits here are the current ones, as they have always been.
import type { LimitsSpec, LimitsSpecIdentity, PaymentCaps } from "../../modules/payments/guard-limits.ts";
import type { ReportLanguage } from "../../modules/report/text.ts";
import { runOn as bookingsRunOn } from "../../templates/commerce/bookings/crash-test/situations.ts";
import { buildGoLiveCertificate as bookingsCertificate, summariseRun as bookingsSummary } from "../../templates/commerce/bookings/report/certificate.ts";
import { policyDigest as bookingsDigest } from "../../templates/commerce/bookings/report/data.ts";
import { writeGoLiveCertificate as bookingsWrite } from "../../templates/commerce/bookings/report/run.ts";
import { gatewayLimitsSpec as bookingsSpec } from "../../templates/commerce/bookings/src/guard-limits.ts";
import { validateSettings as bookingsSettings } from "../../templates/commerce/bookings/src/settings.ts";
import { validateRuntimeConfig as bookingsRuntime } from "../../templates/commerce/bookings/server/config.ts";
import { runOn as ordersRunOn } from "../../templates/commerce/orders/crash-test/situations.ts";
import { buildGoLiveCertificate as ordersCertificate, summariseRun as ordersSummary } from "../../templates/commerce/orders/report/certificate.ts";
import { policyDigest as ordersDigest } from "../../templates/commerce/orders/report/data.ts";
import { writeGoLiveCertificate as ordersWrite } from "../../templates/commerce/orders/report/run.ts";
import { gatewayLimitsSpec as ordersSpec } from "../../templates/commerce/orders/src/guard-limits.ts";
import { validateSettings as ordersSettings } from "../../templates/commerce/orders/src/settings.ts";
import { validateRuntimeConfig as ordersRuntime } from "../../templates/commerce/orders/server/config.ts";
import { runOn as feesRunOn } from "../../templates/education/fees/crash-test/situations.ts";
import { buildGoLiveCertificate as feesCertificate, summariseRun as feesSummary } from "../../templates/education/fees/report/certificate.ts";
import { policyDigest as feesDigest } from "../../templates/education/fees/report/data.ts";
import { writeGoLiveCertificate as feesWrite } from "../../templates/education/fees/report/run.ts";
import { gatewayLimitsSpec as feesSpec } from "../../templates/education/fees/src/guard-limits.ts";
import { validateSettings as feesSettings } from "../../templates/education/fees/src/settings.ts";
import { validateRuntimeConfig as feesRuntime } from "../../templates/education/fees/server/config.ts";

/** The services a template calls, each of which has a Guard. The order fixes each Guard's address on the admin network (generate/compose.ts). */
export type ServiceKind = "razorpay" | "whatsapp" | "calendar";

/**
 * The Guards one shop runs: its template's, with the gateway's only when the shop CHOSE the gateway (settings "payment": {"module": "razorpay"}). UPI is the default (B71):
 * a UPI shop, and settings with no payment block at all, get no gateway Guard, no gateway key to hand in, no gateway webhook and no approvals relay (no refund is ever
 * held for the owner: the owner sends UPI refunds). This is the one place that decides it, and it fails closed: anything but an explicit choice is no gateway.
 */
export function guardsOf(kind: { guards: readonly ServiceKind[] }, settings: unknown): ServiceKind[] {
  const gateway = (settings as { payment?: { module?: string } } | undefined)?.payment?.module === "razorpay";
  const ownCalendar = hasOwnCalendar(settings);
  return kind.guards.filter((g) => (gateway || g !== "razorpay") && (!ownCalendar || g !== "calendar"));
}

/**
 * B72: a shop whose settings say `"calendar": {"module": "own"}` runs on its own booking list: no calendar Guard, no Google key, no calendar id. Anything else (no "calendar" key
 * at all, "google") keeps the calendar, exactly as every shop did before 12 Nov 2026. The one place that decides it, beside the gateway rule above.
 */
export const hasOwnCalendar = (settings: unknown): boolean => (settings as { calendar?: { module?: string } } | undefined)?.calendar?.module === "own";

/**
 * Item 11h (decision 45): does this shop have WhatsApp? Its runtime.json (the panel's) names a messaging service. A shop set up without a WhatsApp number has none:
 * no WhatsApp Guard, no WhatsApp secrets, no WhatsApp in its runtime; customers book on its page, and the owner signs in with a passkey and hears by web push.
 * WhatsApp is reach, not a need. The one place that decides it, as `hasOwnCalendar` is for the calendar.
 */
export const runtimeHasWhatsApp = (runtime: unknown): boolean => {
  const m = (runtime as { services?: { messaging?: unknown } } | undefined)?.services?.messaging;
  return typeof m === "object" && m !== null && !Array.isArray(m);
};

/** Does this shop have a Google Calendar? Its template has one AND its settings did not choose the booking list. */
export const hasCalendar = (kind: { guards: readonly ServiceKind[] }, settings: unknown): boolean => guardsOf(kind, settings).includes("calendar");

/** What the panel needs of a hand check's summary and of a go-live certificate, whichever template made them. */
export interface HandCheckSummaryLike { held: number; total: number; checks: number; failedTitles: string[]; ranOn?: string; notRun?: string[] }
export interface GoLiveCertificateLike { checks: { failed: number }; notTested: unknown[] }

export interface Kind {
  id: "bookings" | "fees" | "orders";
  /** The file the deployer exports this template's cases to (backup/export.ts), and what the runtime's status and the export call them. */
  casesFile: "bookings.json" | "dues.json" | "orders.json";
  casesName: "bookings" | "fees" | "orders";
  /** The Guards a shop of this template has. */
  guards: readonly ServiceKind[];
  /** Check a settings.json; the settings come back in the template's own shape (`any`: the bundle reads only what every template has: name, timezone, owner). */
  validateSettings(input: unknown): { ok: true; settings: any } | { ok: false; errors: string[] };
  /** The template's own check of a runtime.json (server/config.ts). */
  validateRuntimeConfig(config: unknown, folder: string): { ok: boolean; errors?: string[] };
  /** The Razorpay limits spec made from the settings, the template's own numbers in the shared shape. */
  gatewaySpec(settings: any, identity: LimitsSpecIdentity, options: { approvalTtlSeconds: number; caps?: Partial<PaymentCaps> }): LimitsSpec;
  /** The checks and papers the panel makes: the same hand check the template's scripts run, on this shop's own settings, and the go-live certificate from it. */
  papers: {
    runOn(settings: any): Promise<unknown>;
    summariseRun(run: any): HandCheckSummaryLike;
    buildGoLiveCertificate(input: { settings: any; handCheck: any; issuedAt: number }): GoLiveCertificateLike;
    policyDigest(settings: any): string;
    writeGoLiveCertificate(run: { settings: any; handCheck: any; language: ReportLanguage; out: string; key?: import("node:crypto").KeyObject; preparedBy?: string; now: number }): { files: string[] };
  };
}

export const KINDS: Record<string, Kind> = {
  bookings: {
    id: "bookings",
    casesFile: "bookings.json", casesName: "bookings",
    guards: ["razorpay", "whatsapp", "calendar"],
    validateSettings: bookingsSettings,
    validateRuntimeConfig: bookingsRuntime,
    gatewaySpec: bookingsSpec,
    papers: { runOn: bookingsRunOn, summariseRun: bookingsSummary, buildGoLiveCertificate: bookingsCertificate, policyDigest: bookingsDigest, writeGoLiveCertificate: bookingsWrite },
  },
  fees: {
    id: "fees",
    casesFile: "dues.json", casesName: "fees",
    guards: ["razorpay", "whatsapp"],
    validateSettings: feesSettings,
    validateRuntimeConfig: feesRuntime,
    gatewaySpec: feesSpec,
    papers: { runOn: feesRunOn, summariseRun: feesSummary, buildGoLiveCertificate: feesCertificate, policyDigest: feesDigest, writeGoLiveCertificate: feesWrite },
  },
  orders: {
    id: "orders",
    casesFile: "orders.json", casesName: "orders",
    guards: ["razorpay", "whatsapp"],
    validateSettings: ordersSettings,
    validateRuntimeConfig: ordersRuntime,
    gatewaySpec: ordersSpec,
    papers: { runOn: ordersRunOn, summariseRun: ordersSummary, buildGoLiveCertificate: ordersCertificate, policyDigest: ordersDigest, writeGoLiveCertificate: ordersWrite },
  },
};

/** The template a pathway name stands for, or undefined for one this bundle does not know. */
export const kindFor = (pathway: string | undefined): Kind | undefined => (pathway !== undefined && Object.hasOwn(KINDS, pathway) ? KINDS[pathway] : undefined);

/** The names of the templates this bundle runs, for a sentence that lists them. */
export const kindNames = (): string => Object.keys(KINDS).join(", ");
