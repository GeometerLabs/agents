// The world a Bookings crash-test situation runs in, on the shop's own Go program (go/cmd/bookings; owner, 24 Nov 2026: "Run the hand check on Go"). The shared part (the
// program started on the shop's settings in front of the stand-ins and the stub Guard, the steps, the reads of agent.db) is modules/crash-test/go-world.ts; what is Bookings'
// own is here: its stand-ins (standins/server.ts, with Google Calendar's wire format), its calendar fake, its limits spec, its saved state, and the members its situations read
// (a booking's payment link, its UPI request), named as in the demo engine's world (src/harness.ts) so a situation reads the same.
import { readFileSync } from "node:fs";
import { openGoWorld } from "../../../../modules/crash-test/go-world.ts";
import type { GoWorldBase, Models } from "../../../../modules/crash-test/go-world.ts";
import type { InboundMessage } from "../../../../modules/messaging/messaging.ts";
import type { FakePaymentsOptions, PaymentRequest } from "../../../../modules/payments/payments.ts";
import type { OwedRefund, MarkedRequest } from "../../../../modules/payments/owner-marked/ledger.ts";
import { capabilitiesOf } from "../../../../modules/payments/providers/index.ts";
import { parseStore } from "../server/snapshot.ts";
import { createStore } from "../src/booking.ts";
import { startStandins } from "../standins/server.ts";
import { createFakeCalendar } from "../src/adapters/calendar.ts";
import type { FakeCalendar } from "../src/adapters/calendar.ts";
import type { Store } from "../src/booking.ts";
import { gatewayLimitsSpec } from "../src/guard-limits.ts";
import { CUSTOMER } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";

/** The program the hand check runs (go/cmd/bookings), and the template version it serves (pathway.lock). */
export const PROGRAM = "bookings";
export const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** The unit tests' instant: Tue 3 Nov 2026, 10:00 in India (the instant the situations were written for). */
const START = Date.UTC(2026, 10, 3, 4, 30);

export interface GoWorldOptions {
  settings: Settings;
  nowMs?: number;
  payments?: FakePaymentsOptions;
  models?: Models;
  /** More of runtime.json (allowance, budget, ...). */
  runtime?: Record<string, unknown>;
  licence?: unknown;
}

export interface GoWorld extends GoWorldBase<Settings, Store> {
  calendar: FakeCalendar;
  linkFor(bookingRef: string): PaymentRequest | undefined;
  upiRequest(bookingRef: string): MarkedRequest | undefined;
  upiRefunds(bookingRef: string): OwedRefund[];
  ownerMarksReceived(bookingRef: string, options?: { amountInr?: number; code?: string; tap?: boolean }): Promise<InboundMessage>;
  ownerMarksRefund(bookingRef: string, options?: { kept?: boolean; code?: string; tap?: boolean }): Promise<InboundMessage>;
}

export async function createGoWorld(o: GoWorldOptions): Promise<GoWorld> {
  const { settings } = o;
  const calendar = createFakeCalendar();
  const base = await openGoWorld<Settings, Store>({
    program: PROGRAM, version: VERSION, settings, at: o.nowMs ?? START, customer: CUSTOMER, parseStore, emptyStore: createStore, parseSettings,
    gateway: capabilitiesOf(settings.payment).confirmsAutomatically,
    spec: () => gatewayLimitsSpec(settings, { tenant: "hand-check", version: 1, reviewedBy: "hand-check" }),
    standins: (clock, fakes) => startStandins({ clock, razorpayWebhookSecret: "hand-check", whatsappAppSecret: "hand-check", phoneNumberId: "100000000000001", calendarId: "shop@example.com", fakes: { ...fakes, calendar } }, { port: 0 }),
    // a shop on its own booking list (calendar.module "own") has no calendar service
    services: (url) => (settings.calendar?.module === "own" ? {} : { calendar: { baseUrl: url, calendarId: "shop@example.com" } }),
    ...(o.payments ? { payments: o.payments } : {}), ...(o.models ? { models: o.models } : {}), ...(o.runtime ? { runtime: o.runtime } : {}), ...(o.licence !== undefined ? { licence: o.licence } : {}),
  });
  const world: GoWorld = Object.assign(base, {
    calendar,
    linkFor: (ref: string) => base.payments.links().find((l) => l.reference_id === ref),
    upiRequest: (ref: string) => base.store.upi?.requests.find((r) => r.reference === ref),
    upiRefunds: (ref: string) => base.store.upi?.refunds.filter((r) => r.caseId === ref) ?? [],
    async ownerMarksReceived(ref: string, m: { amountInr?: number; code?: string; tap?: boolean } = {}) {
      const request = world.upiRequest(ref);
      const code = m.code ?? request?.code ?? request?.usedCodes.at(-1);
      if (!code) throw new Error(`No UPI request for ${ref}.`);
      if (m.tap) return base.tap(`upi-received:${code}`, { from: base.owner });
      return base.ownerSays(m.amountInr !== undefined ? `received ${code} ${m.amountInr}` : `received ${code}`);
    },
    async ownerMarksRefund(ref: string, m: { kept?: boolean; code?: string; tap?: boolean } = {}) {
      const refund = world.upiRefunds(ref).find((r) => r.code !== null) ?? world.upiRefunds(ref).at(-1);
      const code = m.code ?? refund?.code ?? refund?.usedCodes.at(-1);
      if (!code) throw new Error(`No refund owed for ${ref}.`);
      if (m.tap) return base.tap(`${m.kept ? "upi-kept" : "upi-refunded"}:${code}`, { from: base.owner });
      return base.ownerSays(`${m.kept ? "kept" : "refunded"} ${code}`);
    },
  });
  return world;
}
