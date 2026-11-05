// A busy month on the stand-in services, scripted with the harness: late October to the start of December 2026 at Glow
// Salon. The report tests and the sample-report script both run it, so the numbers they check are the numbers a real
// reader would see. Every customer is a made-up number; the money is test money; nothing here touches a real service.
//
// What November 2026 holds by design (the test pins each of these, and checks the money against the stand-ins' own lists):
//   bookings made 26      (2 more happened outside the month: one on 29 Oct, one on 1 Dec)
//   cancelled 6           (one made in October; three inside the window and refunded, three late and sent to the owner)
//   dropped before booked 1, moved 2 bookings (three moves)
//   deposits 27 x ₹200    refunds 5 x ₹200 (four deposits, one second payment)
//   asked the owner 3     approved 1, said no 1, left 1 waiting; retried the calendar once
//   stopped 10 times      (3 prices below the list, 2 double bookings, 2 closed hours, 1 second payment, 2 reminders after STOP)
//   left unconfirmed 2    (a "booked" that the calendar never showed, and a message whose reply was lost); one more was settled by a retry
import { createWorld, glowSalon } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { DAY_PART_WORDS, dayPartOf } from "../../../modules/language/format.ts";
import { serviceName } from "../src/settings.ts";
import type { Language } from "../../../modules/language/languages.ts";
import { MINUTE, zonedToMs } from "../../../modules/core/time.ts";

const TZ = "Asia/Kolkata";
export const at = (month: number, day: number, hour: number, minute = 0): number => zonedToMs({ year: 2026, month, day }, { hour, minute }, TZ);
export const phone = (n: number): string => `+91980000${String(n).padStart(4, "0")}`;

const settings = glowSalon();
type ServiceId = "haircut" | "beard-trim" | "facial" | "hair-colour";
const nameOf = (id: ServiceId, language: Language): string => serviceName(settings.services.find((s) => s.id === id)!, language);

/** What a customer writes to ask for a service on a day in November, in each language (whole hours, an explicit date). */
export function ask(language: Language, service: ServiceId, day: number, hour: number, offerInr?: number): string {
  const name = nameOf(service, language);
  const hour12 = hour % 12 || 12;
  const offer = offerInr === undefined ? "" : language === "en" ? ` for ${offerInr}` : language === "hi" ? ` ${offerInr} में` : language === "kn" ? ` ${offerInr}ಕ್ಕೆ` : ` ${offerInr} രൂപയ്ക്ക്`;
  if (language === "en") return `${name} on ${day} November at ${hour12}${hour < 12 ? "am" : "pm"}${offer}`;
  const part = DAY_PART_WORDS[language][dayPartOf(hour)];
  if (language === "hi") return `${day} नवंबर ${part} ${hour12} बजे ${name}${offer}`;
  if (language === "ml") return `${day} നവംബർ ${part} ${hour12} മണിക്ക് ${name}${offer}`;
  return `${day} ನವೆಂಬರ್ ${part} ${hour12} ಗಂಟೆಗೆ ${name}${offer}`;
}

export interface BusyMonth {
  world: World;
  /** Booking id of each customer's latest booking, by phone. */
  refOf(customer: string): string;
}

export async function runBusyMonth(): Promise<BusyMonth> {
  const w = createWorld({ settings, nowMs: at(10, 28, 10), interactive: false }); // a scripted month of records and money: every message is plain text, as it was written
  const ref = (customer: string) => [...w.store.bookings.values()].filter((b) => b.customer === customer).at(-1)!.id;
  const goTo = async (ms: number) => { while (w.clock.now() < ms) await w.advance(Math.min(30, (ms - w.clock.now()) / MINUTE)); }; // small steps, so no reminder is skipped
  const pay = async (customer: string, times = 1) => {
    const link = w.linkFor(ref(customer))!;
    for (let i = 0; i < times; i++) w.payments.customerPays(link.id);
    await w.deliverPaymentEvents();
  };
  const book = async (customer: string, language: Language, service: ServiceId, day: number, hour: number, offerInr?: number) => w.say(ask(language, service, day, hour, offerInr), { from: customer });

  // ---- the end of October: one booking, one refused price that is never paid ----
  await goTo(at(10, 29, 10));
  const c1 = phone(1);
  await book(c1, "hi", "haircut", 2, 18); await pay(c1); // made on 29 Oct
  await goTo(at(10, 30, 11));
  await book(phone(3), "en", "haircut", 9, 11, 300); // refused in October; the hold runs out
  // ---- just before midnight on 31 Oct: asked then, paid after midnight, so the booking and the deposit are November's ----
  await goTo(at(10, 31, 23, 50));
  const c2 = phone(2);
  await book(c2, "en", "facial", 3, 11);
  await goTo(at(11, 1, 0, 3));
  await pay(c2);
  await goTo(at(11, 1, 10));
  await w.say("मेरी बुकिंग रद्द कर दीजिए", { from: c1 }); // 32 hours ahead: inside the window, refunded alone

  // ---- 2 November: twenty bookings, each asked for and paid ----
  await goTo(at(11, 2, 10));
  const languages: Language[] = ["hi", "en", "en", "hi", "ml", "kn", "en", "hi", "en", "hi", "en", "hi", "en", "hi", "en", "ml", "kn", "en", "hi", "en"];
  const services: ServiceId[] = ["haircut", "beard-trim", "facial", "hair-colour"];
  const days = [4, 5, 6, 7, 9, 10, 11, 12, 13, 14]; // no Sundays: the salon is closed
  const batch = languages.map((language, i) => ({ customer: phone(10 + i), language, day: days[Math.floor(i / 2)], hour: i % 2 === 0 ? 11 : 14, service: services[i % 4] }));
  for (const b of batch) { await book(b.customer, b.language, b.service, b.day, b.hour); await pay(b.customer); }

  // a customer asks for less than the list price, in three languages; two go on to pay, one lets the hold run out
  await goTo(at(11, 2, 11));
  const c40 = phone(40), c41 = phone(41), c42 = phone(42);
  await book(c40, "en", "haircut", 16, 11, 300); await pay(c40);
  await book(c41, "hi", "beard-trim", 16, 14, 100); await pay(c41);
  await book(c42, "kn", "haircut", 17, 11, 300);
  // two customers ask for a time that is already taken (the second only overlaps it)
  await goTo(at(11, 2, 11, 30));
  await book(phone(43), "en", "haircut", 4, 11);
  await w.say("haircut on 4 November at 11:30am", { from: phone(44) });
  // two requests the salon cannot take: a Sunday, and a booking that would run past closing time
  await book(phone(45), "en", "haircut", 8, 11);
  await w.say("haircut on 9 November at 8:30pm", { from: phone(46) });
  // paid twice by mistake: the second payment is not a deposit, and goes back
  await goTo(at(11, 2, 12));
  const c47 = phone(47);
  await book(c47, "en", "haircut", 17, 14); await pay(c47, 2);
  // someone asks, then thinks better of it before paying
  await w.say(ask("en", "haircut", 25, 11), { from: phone(52) });
  await w.say("please cancel my booking", { from: phone(52) });

  // ---- cancelling inside the window: the deposit goes back by itself ----
  await goTo(at(11, 2, 13));
  await w.say("please cancel my booking", { from: batch[2].customer });
  await w.say("please cancel my booking", { from: batch[5].customer });

  // ---- moving bookings ----
  await goTo(at(11, 2, 15));
  await w.say("reschedule to 18 November 5pm", { from: batch[6].customer });
  await w.say("reschedule to 19 November 5pm", { from: batch[6].customer }); // the same booking moves twice
  await w.say("reschedule to 20 November 5pm", { from: batch[8].customer });

  // ---- the calendar cannot show a booking that was paid for ----
  await goTo(at(11, 3, 9));
  const c48 = phone(48), c49 = phone(49);
  await book(c48, "en", "haircut", 20, 11);
  w.calendar.inject("update", "silentFailure", { times: 2 });
  await pay(c48);
  await w.say(`retry ${ref(c48)}`, { from: w.owner }); // the calendar works again: booked after all
  await book(c49, "en", "haircut", 21, 11);
  w.calendar.inject("update", "silentFailure", { times: 2 });
  await pay(c49); // the owner is told and never answers

  // ---- late cancellations: the owner decides ----
  await goTo(at(11, 3, 15));
  await w.say("please cancel my booking", { from: batch[0].customer }); // 20 hours ahead
  await w.say(`approve ${ref(batch[0].customer)}`, { from: w.owner });
  await goTo(at(11, 4, 9));
  await w.say("please cancel my booking", { from: batch[1].customer }); // 5 hours ahead
  await w.say(`deny ${ref(batch[1].customer)}`, { from: w.owner });
  await goTo(at(11, 4, 20));
  await w.say("please cancel my booking", { from: batch[3].customer }); // unanswered

  // ---- a customer sends STOP; their two reminders are held back ----
  await goTo(at(11, 10, 9));
  const c50 = phone(50);
  await book(c50, "en", "haircut", 24, 11); await pay(c50);
  await w.say("STOP", { from: c50 });

  // ---- a message whose reply is lost ----
  await goTo(at(11, 12, 10));
  w.messaging.inject("sendText", "lostReply");
  await w.say("hello", { from: phone(51) });

  // ---- the start of December: the same record, but not November's ----
  await goTo(at(12, 1, 10));
  const c60 = phone(60);
  await w.say("haircut tomorrow at 11am", { from: c60 });
  await pay(c60);

  return { world: w, refOf: ref };
}
