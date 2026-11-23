// The world a Fees crash-test situation runs in, on the centre's own Go program (go/cmd/fees; owner, 24 Nov 2026: "Run the hand check on Go"). The shared part (the program
// started on the centre's settings in front of the stand-ins and the stub Guard, the steps, the reads of agent.db) is modules/crash-test/go-world.ts; what is Fees' own is
// here: its stand-ins (standins/server.ts), its limits spec, its saved state, and the members its situations read (a student's fee, its link, its UPI request), named as in
// the demo engine's world (src/harness.ts) so a situation reads the same. A student's name is read from the centre's own agent.db on this machine and goes nowhere else.
import { readFileSync } from "node:fs";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { openGoWorld, settingsJson } from "../../../../modules/crash-test/go-world.ts";
import type { GoWorldBase, Models } from "../../../../modules/crash-test/go-world.ts";
import type { InboundMessage } from "../../../../modules/messaging/messaging.ts";
import type { FakePaymentsOptions, PaymentRequest } from "../../../../modules/payments/payments.ts";
import type { OwedRefund, MarkedRequest } from "../../../../modules/payments/owner-marked/ledger.ts";
import { capabilitiesOf } from "../../../../modules/payments/providers/index.ts";
import { parseStore } from "../server/snapshot.ts";
import { startStandins } from "../standins/server.ts";
import type { Due, Store } from "../src/due.ts";
import { gatewayLimitsSpec } from "../src/guard-limits.ts";
import { ROHAN_PARENT } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";

/** The program the hand check runs (go/cmd/fees), and the template version it serves (pathway.lock). */
export const PROGRAM = "fees";
export const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

export interface GoWorldOptions {
  settings: Settings;
  /** The centre's time when it starts; default Mon 2 Nov 2026, 09:00 in the centre's zone (the demo world's). */
  nowMs?: number;
  payments?: FakePaymentsOptions;
  models?: Models;
  runtime?: Record<string, unknown>;
  licence?: unknown;
}

export interface GoWorld extends GoWorldBase<Settings, Store> {
  /** Jump to a moment in the centre's time zone, then wait for a beat of the centre's clock. */
  goto(day: { year: number; month: number; day: number }, time?: { hour: number; minute: number }): Promise<void>;
  dueOf(student: string): Due | undefined;
  linkFor(student: string): PaymentRequest | undefined;
  pays(student: string, options?: { amountInr?: number }): void;
  upiRequest(student: string): MarkedRequest | undefined;
  upiRefunds(student: string): OwedRefund[];
  ownerMarksReceived(student: string, options?: { amountInr?: number; code?: string; tap?: boolean }): Promise<InboundMessage>;
  ownerMarksRefund(student: string, options?: { code?: string; tap?: boolean }): Promise<InboundMessage>;
}

/** settings.json for parsed settings: as they read, except that a student names their batch as `batch` in the file (src/settings.ts readStudents). */
export function settingsFile(settings: Settings): Record<string, unknown> {
  const raw = settingsJson(settings);
  raw.students = settings.students.map(({ batchId, ...s }) => ({ ...s, batch: batchId }));
  return raw;
}

export async function createGoWorld(o: GoWorldOptions): Promise<GoWorld> {
  const { settings } = o;
  const base = await openGoWorld<Settings, Store>({
    program: PROGRAM, version: VERSION, settings, at: o.nowMs ?? zonedToMs({ year: 2026, month: 11, day: 2 }, { hour: 9, minute: 0 }, settings.timezone), customer: ROHAN_PARENT, parseStore, parseSettings,
    gateway: capabilitiesOf(settings.payment).confirmsAutomatically, settingsFile,
    spec: () => gatewayLimitsSpec(settings, { tenant: "hand-check", version: 1, reviewedBy: "hand-check" }),
    standins: (clock, fakes) => startStandins({ clock, gatewayWebhookSecret: "hand-check", whatsappAppSecret: "hand-check", phoneNumberId: "100000000000001", fakes }, { port: 0 }),
    ...(o.payments ? { payments: o.payments } : {}), ...(o.models ? { models: o.models } : {}), ...(o.runtime ? { runtime: o.runtime } : {}), ...(o.licence !== undefined ? { licence: o.licence } : {}),
  });
  // the first beat saves the day the agent first ran (`startedAtMs`), and a month's fees are opened from it: wait for it before the situation moves the clock, as the
  // contract does (contract/harness.ts started), or the first beat would see the moved clock and take that for the first day
  await base.waitFor("the first beat to save the day the centre first ran", () => { const shape = base.shop.snapshot(); return shape !== null && /"startedAtMs"/u.test(shape); });
  const dueOf = (student: string): Due | undefined => [...base.store.dues.values()].reverse().find((d) => d.studentName === student);
  const world: GoWorld = Object.assign(base, {
    async goto(day: { year: number; month: number; day: number }, time = { hour: 10, minute: 0 }) { base.clock.set(zonedToMs(day, time, settings.timezone)); await base.tick(); },
    dueOf,
    linkFor(student: string) { const due = dueOf(student); return due?.currentLinkId ? base.payments.links().find((l) => l.id === due.currentLinkId) : undefined; },
    pays(student: string, m: { amountInr?: number } = {}) {
      const link = world.linkFor(student);
      if (!link) throw new Error(`${student} has no payment link to pay.`);
      base.payments.customerPays(link.id, m.amountInr !== undefined ? { amount: m.amountInr * 100 } : {});
    },
    upiRequest(student: string) { const due = dueOf(student); return due?.currentLinkId ? base.store.upi?.requests.find((r) => r.id === due.currentLinkId) : undefined; },
    upiRefunds(student: string) { const due = dueOf(student); return base.store.upi?.refunds.filter((r) => r.caseId === due?.id) ?? []; },
    async ownerMarksReceived(student: string, m: { amountInr?: number; code?: string; tap?: boolean } = {}) {
      const request = world.upiRequest(student);
      const code = m.code ?? request?.code ?? request?.usedCodes.at(-1);
      if (!code) throw new Error(`No UPI request for ${student}.`);
      if (m.tap) return base.tap(`upi-received:${code}`, { from: base.owner });
      return base.ownerSays(m.amountInr !== undefined ? `received ${code} ${m.amountInr}` : `received ${code}`);
    },
    async ownerMarksRefund(student: string, m: { code?: string; tap?: boolean } = {}) {
      const refunds = world.upiRefunds(student);
      const refund = refunds.find((r) => r.code !== null) ?? refunds.at(-1);
      const code = m.code ?? refund?.code ?? refund?.usedCodes.at(-1);
      if (!code) throw new Error(`No refund owed for ${student}.`);
      if (m.tap) return base.tap(`upi-refunded:${code}`, { from: base.owner });
      return base.ownerSays(`refunded ${code}`);
    },
  });
  return world;
}
