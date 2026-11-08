// A busy month on the stand-in services, scripted with the harness: November 2026 at Annapurna Tiffins (a UPI shop: the owner marks each advance received). The report
// tests and the sample-report script both run it, so the numbers they check are the numbers a real reader would see. Every customer is a made-up number; the money is test
// money; nothing here touches a real service.
//
// What November 2026 holds by design (the test pins each of these):
//   orders taken 7        c1 (3 Nov dinner pickup), c2 (3 Nov dinner delivery), c3 (cancelled), c4 (a big order the owner approves), c5 (10 Nov lunch), c9 (12 Nov lunch, cancelled late), c10 (30 Nov, still to be collected)
//   completed 4           c1, c2, c4, c5 (their slots ended); cancelled 2: c3 cancels well before the window (the owner owes the advance back and marks it sent), c9 cancels late (the owner is asked, approves, and sends it back)
//   holds that ran out 2  c6 (who haggled; the agent held the order at the menu price) and c8 never paid
//   asked the owner 2     the big order (approved) and the late cancellation (approved)
//   stopped 5 times       a price below the menu, 11 items in one order, more than the day's stock, lunch after its cut-off, an address outside the delivery area
//   a customer stopped 1  c11 sends STOP
//   money                 advance marked paid ₹1,660 (7 payments), given back ₹180 (2), ₹240 still to collect on c10's order, items sold 10 veg thali and 11 chicken meal (5 orders: 4 pickup, 1 delivery)
import { createWorld, annapurna } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";

const TZ = "Asia/Kolkata";
export const at = (month: number, day: number, hour: number, minute = 0): number => zonedToMs({ year: 2026, month, day }, { hour, minute }, TZ);
export const phone = (n: number): string => `+91981000${String(n).padStart(4, "0")}`;

export interface BusyMonth {
  world: World;
  /** The order id of each customer's latest order, by customer number (1 to 11). */
  orderOf(n: number): string;
}

export async function runBusyMonth(): Promise<BusyMonth> {
  const settings = annapurna();
  const w = createWorld({ settings, nowMs: at(11, 2, 9), interactive: false }); // a scripted month of records and money: every message is plain text, as it was written
  const goTo = async (month: number, day: number, hour = 10, minute = 0) => { await w.goto({ year: 2026, month, day }, { hour, minute }); };
  const say = (n: number, text: string) => w.say(text, { from: phone(n) });
  const orderOf = (n: number) => w.orderOf(phone(n))!.id;
  const paid = (n: number) => w.ownerMarksReceived(phone(n));

  // ---- 3 Nov: two dinners, one to pick up and one delivered ----
  await goTo(11, 3);
  await say(1, "2 veg thali 3 nov 7:00 pm pickup");
  await paid(1);
  await say(2, "1 chicken meal 3 nov 7:30 pm delivery");
  await say(2, "Flat 4, Lake View Apartments, Kakkanad");
  await paid(2);
  // ---- 4 Nov: an order for tomorrow, paid, then cancelled well before the window: the owner sends the advance back ----
  await goTo(11, 4, 11);
  await say(3, "1 veg thali 5 nov 12:00 pm pickup");
  await paid(3);
  await say(3, "cancel my order");
  await w.ownerMarksRefund(phone(3));
  // ---- 5 Nov: an order above the owner's line waits for the owner, who says yes ----
  await goTo(11, 5, 11);
  await say(4, "7 chicken meal 6 nov 12:00 pm pickup");
  await w.ownerSays(`approve ${orderOf(4)}`);
  await paid(4);
  // ---- 6 Nov: a price below the menu, and 11 items in one order: the limits say no ----
  await goTo(11, 6, 11);
  await say(6, "1 veg thali 7 nov 12:00 pm pickup ₹80");
  await say(7, "11 veg thali 7 nov 12:00 pm pickup");
  // ---- 9 Nov: eight thalis for tomorrow's lunch, then another customer asks for five (four are left), and one asks for lunch today, after its cut-off ----
  await goTo(11, 9, 10);
  await say(5, "8 veg thali 10 nov 12:00 pm pickup");
  await paid(5);
  await say(8, "5 veg thali 10 nov 12:00 pm pickup");
  await say(9, "1 curd 9 nov 12:00 pm pickup");
  await goTo(11, 9, 11);
  await say(10, "1 veg thali 11 nov 7:30 pm delivery");
  await say(10, "12 Park Street, Colaba, Mumbai");
  // ---- 10 Nov: an order that is never paid: its hold runs out ----
  await goTo(11, 10, 9);
  await say(8, "1 curd 11 nov 12:00 pm pickup");
  await goTo(11, 10, 10);
  // ---- 11 Nov: one customer asks for no more messages ----
  await goTo(11, 11, 10);
  await say(11, "STOP");
  // ---- 11 Nov: lunch for 12 Nov, paid, and then cancelled the morning of: inside the window's end, so the owner is asked ----
  await say(9, "2 veg thali 12 nov 12:00 pm pickup");
  await paid(9);
  await goTo(11, 12, 8);
  await say(9, "cancel my order");
  await w.ownerSays(`approve ${orderOf(9)}`);
  await w.ownerMarksRefund(phone(9));
  // ---- 25 Nov: an order for the last day of the month, paid, and still to be collected when the month ends ----
  await goTo(11, 25, 10);
  await say(10, "3 chicken meal 30 nov 7:00 pm pickup");
  await paid(10);
  await goTo(11, 30, 10);
  return { world: w, orderOf };
}
