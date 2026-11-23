// The world an Orders crash-test situation runs in, on the shop's own Go program (go/cmd/orders; owner, 24 Nov 2026: "Run the hand check on Go"). The shared part (the program
// started on the shop's settings in front of the stand-ins and the stub Guard, the steps, the reads of agent.db) is modules/crash-test/go-world.ts; what is Orders' own is
// here: its stand-ins (standins/server.ts), its limits spec, its saved state, and the members its situations read (a customer's latest order, its link, its UPI request),
// named as in the demo engine's world (src/harness.ts) so a situation reads the same.
import { readFileSync } from "node:fs";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { openGoWorld } from "../../../../modules/crash-test/go-world.ts";
import type { GoWorldBase, Models } from "../../../../modules/crash-test/go-world.ts";
import type { InboundMessage } from "../../../../modules/messaging/messaging.ts";
import type { FakePaymentsOptions, PaymentRequest } from "../../../../modules/payments/payments.ts";
import type { OwedRefund, MarkedRequest } from "../../../../modules/payments/owner-marked/ledger.ts";
import { capabilitiesOf } from "../../../../modules/payments/providers/index.ts";
import { parseStore } from "../server/snapshot.ts";
import { createStore } from "../src/order.ts";
import { startStandins } from "../standins/server.ts";
import { gatewayLimitsSpec } from "../src/guard-limits.ts";
import { AMIT } from "../src/harness.ts";
import type { Order, Store } from "../src/order.ts";
import { parseSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";

/** The program the hand check runs (go/cmd/orders), and the template version it serves (pathway.lock). */
export const PROGRAM = "orders";
export const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

export interface GoWorldOptions {
  settings: Settings;
  /** The shop's time when it starts; default Mon 9 Nov 2026, 10:00 in the shop's zone (the demo world's). */
  nowMs?: number;
  payments?: FakePaymentsOptions;
  models?: Models;
  runtime?: Record<string, unknown>;
  licence?: unknown;
}

export interface GoWorld extends GoWorldBase<Settings, Store> {
  /** Jump to a moment in the shop's time zone, then wait for a beat of the shop's clock. */
  goto(day: { year: number; month: number; day: number }, time?: { hour: number; minute: number }): Promise<void>;
  orderOf(customer: string): Order | undefined;
  linkFor(customer: string): PaymentRequest | undefined;
  pays(customer: string, options?: { amountInr?: number }): void;
  upiRequest(customer: string): MarkedRequest | undefined;
  upiRefunds(customer: string): OwedRefund[];
  ownerMarksReceived(customer: string, options?: { amountInr?: number; code?: string; tap?: boolean }): Promise<InboundMessage>;
  ownerMarksRefund(customer: string, options?: { code?: string; tap?: boolean }): Promise<InboundMessage>;
}

export async function createGoWorld(o: GoWorldOptions): Promise<GoWorld> {
  const { settings } = o;
  const base = await openGoWorld<Settings, Store>({
    program: PROGRAM, version: VERSION, settings, at: o.nowMs ?? zonedToMs({ year: 2026, month: 11, day: 9 }, { hour: 10, minute: 0 }, settings.timezone), customer: AMIT, parseStore, emptyStore: createStore, parseSettings,
    gateway: capabilitiesOf(settings.payment).confirmsAutomatically,
    spec: () => gatewayLimitsSpec(settings, { tenant: "hand-check", version: 1, reviewedBy: "hand-check" }),
    standins: (clock, fakes) => startStandins({ clock, gatewayWebhookSecret: "hand-check", whatsappAppSecret: "hand-check", phoneNumberId: "100000000000001", fakes }, { port: 0 }),
    ...(o.payments ? { payments: o.payments } : {}), ...(o.models ? { models: o.models } : {}), ...(o.runtime ? { runtime: o.runtime } : {}), ...(o.licence !== undefined ? { licence: o.licence } : {}),
  });
  const orderOf = (customer: string): Order | undefined => [...base.store.orders.values()].reverse().find((x) => x.customer === customer);
  const world: GoWorld = Object.assign(base, {
    async goto(day: { year: number; month: number; day: number }, time = { hour: 10, minute: 0 }) { base.clock.set(zonedToMs(day, time, settings.timezone)); await base.tick(); },
    orderOf,
    linkFor(customer: string) { const x = orderOf(customer); return x?.linkId ? base.payments.links().find((l) => l.id === x.linkId) : undefined; },
    pays(customer: string, m: { amountInr?: number } = {}) {
      const link = world.linkFor(customer);
      if (!link) throw new Error(`${customer} has no payment link to pay.`);
      base.payments.customerPays(link.id, m.amountInr !== undefined ? { amount: m.amountInr * 100 } : {});
    },
    upiRequest(customer: string) { const x = orderOf(customer); return x?.linkId ? base.store.upi?.requests.find((r) => r.id === x.linkId) : undefined; },
    upiRefunds(customer: string) { const x = orderOf(customer); return base.store.upi?.refunds.filter((r) => r.caseId === x?.id) ?? []; },
    async ownerMarksReceived(customer: string, m: { amountInr?: number; code?: string; tap?: boolean } = {}) {
      const request = world.upiRequest(customer);
      const code = m.code ?? request?.code ?? request?.usedCodes.at(-1);
      if (!code) throw new Error(`No UPI request for ${customer}.`);
      if (m.tap) return base.tap(`upi-received:${code}`, { from: base.owner });
      return base.ownerSays(m.amountInr !== undefined ? `received ${code} ${m.amountInr}` : `received ${code}`);
    },
    async ownerMarksRefund(customer: string, m: { code?: string; tap?: boolean } = {}) {
      const refunds = world.upiRefunds(customer);
      const refund = refunds.find((r) => r.code !== null) ?? refunds.at(-1);
      const code = m.code ?? refund?.code ?? refund?.usedCodes.at(-1);
      if (!code) throw new Error(`No refund owed for ${customer}.`);
      if (m.tap) return base.tap(`upi-refunded:${code}`, { from: base.owner });
      return base.ownerSays(`refunded ${code}`);
    },
  });
  return world;
}
