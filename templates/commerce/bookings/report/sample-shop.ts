// The sample shop behind the sample report (plan B66): a small UPI salon on the stand-in services, one scripted November with test money and made-up customers, so a
// reader sees a month that is not tidy. Used by scripts/sample-report.ts (which writes the committed files in sample-report/) and by test/sample-report.test.ts (which
// makes them again and fails when the committed copy differs). Nothing here is random: the clock is the harness's own, every customer is a made-up number, and the
// one-use codes the owner types are read from the shop's ledger, never written into the record, so the same script gives the same record and the same report.
//
// What November holds by design (test/sample-report.test.ts pins each of these):
//   seven bookings made and paid (the owner marked each UPI payment received), one of them cancelled early and its refund marked sent: completed
//   one cancelled less than 24 hours ahead: the refund is held for the owner, the owner approves, the refund is marked sent: completed (settled by the owner)
//   one cancelled less than 24 hours ahead and the owner has not answered by the end of the month: a HELD REFUND, unresolved
//   one customer who says they paid on the last evening and whose money the owner has not seen: unresolved (a screenshot confirms nothing)
//   three conversations that stopped before any payment (a hold that ran out, a customer who dropped it, a Sunday request): abandoned
import { createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { readFileSync } from "node:fs";
import { MINUTE, zonedToMs } from "../../../../modules/core/time.ts";

const TZ = "Asia/Kolkata";
/** A moment in November 2026 in the shop's time zone. */
export const at = (month: number, day: number, hour: number, minute = 0): number => zonedToMs({ year: 2026, month, day }, { hour, minute }, TZ);
const phone = (n: number): string => `+91980001${String(n).padStart(4, "0")}`;

/** The UPI example shop, renamed so nothing on the sample page reads as a real business. */
export function sampleSettings(): Settings {
  const base = JSON.parse(readFileSync(new URL("../settings/glow-salon-upi.example.json", import.meta.url), "utf8"));
  return parseSettings({ ...base, name: "Sample Salon", address: "A made-up address" });
}

export interface SampleMonth { world: World }

export async function runSampleMonth(): Promise<SampleMonth> {
  const settings = sampleSettings();
  const w = createWorld({ settings, nowMs: at(11, 2, 9), interactive: false });
  const ref = (customer: string) => [...w.store.bookings.values()].filter((b) => b.customer === customer).at(-1)!.id;
  const goTo = async (ms: number) => { while (w.clock.now() < ms) await w.advance(Math.min(30, (ms - w.clock.now()) / MINUTE)); };
  const book = (customer: string, text: string) => w.say(text, { from: customer });
  /** A normal booking: asked for, then the owner sees the money and marks it received. */
  const bookAndPay = async (customer: string, text: string) => { await book(customer, text); await w.ownerMarksReceived(ref(customer)); };

  // ---- seven bookings, paid and marked by the owner ----
  await goTo(at(11, 2, 10));
  const paid = [
    [1, "haircut on 5 November at 11am"], [2, "beard trim on 5 November at 2pm"], [3, "facial on 6 November at 11am"], [4, "haircut on 7 November at 4pm"],
    [5, "hair colour on 9 November at 11am"], [6, "haircut on 12 November at 3pm"], [7, "facial on 13 November at 1pm"],
  ] as const;
  for (const [n, text] of paid) { await bookAndPay(phone(n), text); await w.advance(7); } // minutes apart, as a real morning goes

  // ---- an early cancellation: the owner owes the deposit back and marks it sent ----
  await goTo(at(11, 2, 12));
  await book(phone(7), "please cancel my booking");
  await w.ownerMarksRefund(ref(phone(7)));

  // ---- a late cancellation: the refund is held, the owner decides, then marks it sent ----
  await goTo(at(11, 5, 9));
  await book(phone(1), "please cancel my booking"); // 2 hours ahead of an 11am booking
  await w.say(`approve ${ref(phone(1))}`, { from: w.owner });
  await w.ownerMarksRefund(ref(phone(1)));

  // ---- a late cancellation the owner has not answered by the end of the month: the held refund ----
  await goTo(at(11, 6, 8));
  await book(phone(3), "please cancel my booking");

  // ---- three conversations that stop before any payment: a hold that runs out, a customer who drops it, a request the shop cannot take (Sunday) ----
  await goTo(at(11, 10, 10));
  await book(phone(30), "haircut on 16 November at 11am"); // the hold runs out
  await goTo(at(11, 11, 10));
  await book(phone(31), "facial on 17 November at 11am");
  await book(phone(31), "please cancel my booking"); // dropped
  await book(phone(32), "haircut on 15 November at 11am"); // the salon is closed on Sundays

  // ---- the last evening: a customer says they paid and the owner has not seen the money yet (a screenshot confirms nothing) ----
  await goTo(at(11, 30, 22, 30));
  await book(phone(20), "haircut on 3 December at 11am");
  await w.say("", { from: phone(20), image: true });
  await goTo(at(11, 30, 23));
  return { world: w };
}
