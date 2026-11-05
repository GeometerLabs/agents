// A busy month on the stand-in services, scripted with the harness: November 2026 at Bright Tuition Centre. The report tests and the sample-report script both run
// it, so the numbers they check are the numbers a real reader would see. Every parent is a made-up number; the money is test money; nothing here touches a real service.
//
// What November 2026 holds by design (the test pins each of these, and checks the money against the stand-ins' own lists):
//   five fees opened (one per student)
//   Rohan Mehta pays in full, Aarav Sharma pays in full, Kiran Gowda is given ₹100 off (within the limit) and pays the rest, Meera Nair pays part and then sends STOP,
//   Anaya Sharma asks for ₹300 off (above the limit), the owner says yes, and she does not pay
//   Rohan Mehta asks for ₹400 back, and the owner says yes: the refund goes out (the payments service's own list shows it)
//   Aarav's parent asks for ₹5,000 back when ₹1,800 was paid: the refund limit says no (one stop)
//   the late fee is added once, to Anaya's fee (Meera's parent sent STOP on 8 Nov, so she gets no late fee and no more reminders)
import { MEERA_PARENT, ROHAN_PARENT, SHARMA_PARENT, KIRAN_PARENT, createWorld, brightTuition } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { SAYS } from "../crash-test/says.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";

const TZ = "Asia/Kolkata";
export const at = (month: number, day: number, hour: number, minute = 0): number => zonedToMs({ year: 2026, month, day }, { hour, minute }, TZ);

export interface BusyMonth {
  world: World;
}

export async function runBusyMonth(): Promise<BusyMonth> {
  const settings = brightTuition();
  const w = createWorld({ settings, nowMs: at(11, 2, 9), interactive: false }); // a scripted month of records and money: every message is plain text, as it was written
  const goTo = async (month: number, day: number, hour = 10) => { await w.goto({ year: 2026, month, day }, { hour, minute: 0 }); };
  const pay = async (student: string, amountInr?: number) => { w.pays(student, amountInr === undefined ? {} : { amountInr }); await w.deliverPaymentEvents(); };

  // ---- 2 Nov: the first reminders go out and the month's fees open ----
  await goTo(11, 2);
  // ---- 3 Nov: two fees are paid in full ----
  await goTo(11, 3, 12);
  await pay("Rohan Mehta");
  await pay("Aarav Sharma");
  // ---- 4 Nov: a part payment, a small discount, a large one ----
  await goTo(11, 4, 11);
  await pay("Meera Nair", 600);
  await w.say(SAYS.kn.discountOff(100), { from: KIRAN_PARENT });
  await pay("Kiran Gowda");
  await w.say(SAYS.hi.discountOff(300), { from: SHARMA_PARENT });
  await w.ownerSays("approve q-1");
  // ---- 5 Nov: Rohan Mehta asks for part of a payment back, and the owner says yes; Aarav's parent asks for much more than was paid, and the limit says no ----
  await goTo(11, 5, 11);
  await w.say(SAYS.en.refund(400), { from: ROHAN_PARENT });
  await w.ownerSays("approve q-2");
  await w.deliverPaymentEvents();
  await w.say(SAYS.hi.refund(5000), { from: SHARMA_PARENT });
  // ---- 8 Nov: Meera's parent asks for no more messages ----
  await goTo(11, 8, 11);
  await w.say("STOP", { from: MEERA_PARENT });
  // ---- 10 to 30 Nov: the later reminders, the grace days, the late fee ----
  for (const day of [10, 11, 15, 20, 30]) await goTo(11, day);
  return { world: w };
}
