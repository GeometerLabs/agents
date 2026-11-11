// The same kind of agent as agent.js, as a web server: the shape the crash test can drive (README, "A crash test for your agent"). Plain Node, no dependencies, not one of Geometer's
// templates. Geometer does not run it outside the crash test, rebuild it or read its code; its only link to Geometer is where it sends its calls and the credential it sends.
//
//   POST /webhooks/whatsapp   a customer's message, in Meta's format, signed with the app secret (X-Hub-Signature-256)
//   POST /webhooks/razorpay   a payment event, signed with the webhook secret (X-Razorpay-Signature)
//
//   "book ..."    makes a deposit link (looking for it by reference if the answer was lost, never making a second) and sends it
//   a payment     saves the booking in the calendar, LOOKS at the calendar to see that it is there, and only then says "Booked!"
//   "cancel ..."  asks for the deposit back, for what Razorpay says was paid and no more. A refund Guard holds is sent again, identical, until the owner has answered: made
//                 (200), or no (Guard names another request in its 202), or never (the request's end, expires_at_ms in the 202, passes: nothing is sent after it). The customer
//                 is told each way, and never that a refund was made that was not. If the answer to a refund never came back, it LOOKS at Razorpay's refunds and never sends
//                 the refund again.
//   anything else with a price in it gets the list price back
//
// With GEOMETER_UPI_URL set (UPI, B71) there is no gateway: "book" asks Geometer's desk for a request and sends its upi:// link; "I paid" (or a picture) only asks the owner
// to look; the agent looks at the desk until the OWNER has marked the money received, and only then books and says so; "cancel" owes the deposit back through the desk,
// and the customer hears that the owner will send it, never that it was sent.
//
// What it reads from the environment (the crash test sets all of these; so can you, with node --env-file=<the server's credentials.env> for the addresses and credentials):
//   PORT, GEOMETER_RAZORPAY_URL or GEOMETER_UPI_URL, GEOMETER_CALENDAR_URL, GEOMETER_WHATSAPP_URL, a credential for each (GEOMETER_RAZORPAY_CREDENTIAL, ...; or
//   GEOMETER_CREDENTIALS_FILE, read on each call; or the one GEOMETER_CREDENTIAL of an agent made before 12 Nov 2026), CALENDAR_ID, PHONE_NUMBER_ID,
//   GEOMETER_WHATSAPP_APP_SECRET, GEOMETER_RAZORPAY_WEBHOOK_SECRET, GEOMETER_DEPOSIT_INR, GEOMETER_PRICE_INR, GEOMETER_RETRY_MS (wait between sends of a held refund, default 5 minutes)
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { LAST_SEND_MS, createAgent, credentialsFromEnv, heldOf } from "./agent.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hmac = (secret, raw) => createHmac("sha256", secret).update(raw).digest("hex");
const same = (a, b) => typeof a === "string" && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** What to do when the answer to a refund did not come back or says nothing useful. The good way: look at what Razorpay holds, and never send the refund again. */
export async function lookBeforeRetrying({ agent, refund, done, giveUp }) {
  const list = await agent.listRefunds(refund.paymentId).catch(() => ({ status: 0 }));
  const made = list.status === 200 && (list.json?.items ?? []).some((item) => item.amount === refund.amountPaise);
  return made ? done(refund.amountPaise) : giveUp("We could not confirm your refund yet. The owner will check it and write to you.");
}

/** The wrong way, on purpose (the broken example): the answer was lost, so ask again straight away, with a new idempotency key each time. */
export async function retryWithNewKey({ agent, refund, done, giveUp }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const again = await agent.refundOnce({ ...refund, idempotencyKey: `retry-${randomUUID()}` }).catch(() => ({ status: 0 }));
    if (again.status === 200) return done(refund.amountPaise);
  }
  return giveUp("Sorry, the refund did not go through. Please ask the shop.");
}

/**
 * The agent as an http.Server (not listening yet). `agent` is the calls to the three services (agent.js). `onRefundUnknown` is the one place the good and the broken
 * example differ. Everything is kept in memory: it is an example.
 */
/**
 * How a held refund is followed (the good way: both true). `watchRequest`: a 202 naming another request means the owner said no (or it ran out): stop. `watchEnd`: never send after
 * the request's end (expires_at_ms). The broken examples turn one off each (server-asks-again.js, server-past-end.js).
 */
export const FOLLOW_HELD = { watchRequest: true, watchEnd: true };

export function createApp({ agent, appSecret, webhookSecret, depositInr, priceInr, hasCalendar = true, retryMs = 5 * 60_000, onRefundUnknown = lookBeforeRetrying, held = FOLLOW_HELD, log = () => undefined, upi = false }) {
  const seenMessages = new Set();
  const seenEvents = new Set();
  const bookings = new Map(); // customer -> booking
  const byLink = new Map();
  let counter = 0;

  const say = async (to, text) => { try { await agent.tell({ to, text }); } catch (e) { log(`could not write to the customer: ${e.message}`); } };

  /** A link for the deposit: if the answer is lost, look for it by its reference. Only a key that is refused ends the asking. */
  async function makeLink(reference) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const made = await agent.createDepositLink({ reference, amountInr: depositInr }).catch(() => ({ status: 0 }));
      if (made.status === 200) return made.json;
      if (made.status === 401 || made.status === 403) return null; // the key is refused: asking again changes nothing
      const found = await agent.findLink(reference).catch(() => ({ status: 0 }));
      const link = found.status === 200 ? (found.json?.payment_links ?? []).find((l) => l.reference_id === reference) : undefined;
      if (link) return link;
    }
    return null;
  }

  /** UPI: a request at the desk, its link to the customer, and a look at the desk now and then until the owner has marked the money received. */
  async function bookByUpi(customer) {
    const open = bookings.get(customer);
    if (open?.state === "link") return say(customer, `Pay the Rs ${depositInr} deposit by UPI to ${open.payee}: ${open.shortUrl}`);
    if (open) return say(customer, "You already have a booking with us.");
    const booking = { customer, ref: `b-${++counter}`, state: "creating" };
    bookings.set(customer, booking);
    const made = await agent.upiRequest({ reference: booking.ref, amountInr: depositInr, customer }).catch(() => ({ status: 0 }));
    if (made.status !== 200) { bookings.delete(customer); return say(customer, "Sorry, we cannot take a booking right now. Please try again later."); }
    Object.assign(booking, { linkId: made.json.id, shortUrl: made.json.pay_url, payee: `${made.json.pay_to.name} (${made.json.pay_to.id})`, state: "link" });
    await say(customer, `Pay the Rs ${depositInr} deposit by UPI to ${booking.payee}: ${booking.shortUrl}`);
    const look = setInterval(async () => {
      if (booking.state !== "link") { clearInterval(look); return; }
      const now = await agent.upiRead(booking.linkId).catch(() => ({ status: 0 }));
      if (now.status !== 200 || !now.json?.paid) return; // only the owner's mark makes it paid
      clearInterval(look);
      Object.assign(booking, { state: "paid", paymentId: now.json.payments[0]?.id, amountPaise: now.json.paid_paise });
      await confirm(booking);
    }, Math.max(200, Math.min(retryMs, 5_000)));
    return undefined;
  }

  async function claimPaid(customer, via) {
    const booking = bookings.get(customer);
    if (booking?.state !== "link") return say(customer, "I cannot find a payment we are waiting for.");
    await agent.upiClaim(booking.linkId, via).catch(() => undefined);
    return say(customer, "Thank you. The owner will check the payment in their UPI app. You will hear from us once the owner has checked it.");
  }

  async function book(customer) {
    if (upi) return bookByUpi(customer);
    const open = bookings.get(customer);
    if (open?.state === "link") return say(customer, `Pay the Rs ${depositInr} deposit to book: ${open.shortUrl}`);
    if (open && open.state !== "creating") return say(customer, "You already have a booking with us.");
    if (open) return undefined; // the link is being made for this very customer
    const booking = { customer, ref: `b-${++counter}`, state: "creating" };
    bookings.set(customer, booking);
    const link = await makeLink(booking.ref);
    if (!link) { bookings.delete(customer); return say(customer, "Sorry, we cannot take a booking right now. Please try again later."); }
    Object.assign(booking, { linkId: link.id, shortUrl: link.short_url, state: "link" });
    byLink.set(link.id, booking);
    return say(customer, `Pay the Rs ${depositInr} deposit to book: ${link.short_url}`);
  }

  /** The payment is in. Save the slot, then LOOK at the calendar: only an event that is there is a booking. */
  async function confirm(booking) {
    let saved = !hasCalendar;
    if (hasCalendar) {
      const made = await agent.bookSlot({ summary: `Booking ${booking.ref}`, startsAt: Date.now() + 86_400_000 }).catch(() => ({ status: 0 }));
      if (made.status === 200 && made.json?.id) {
        const read = await agent.getEvent(made.json.id).catch(() => ({ status: 0 }));
        saved = read.status === 200 && read.json?.status === "confirmed";
      }
    }
    booking.state = saved ? "booked" : "unconfirmed";
    await say(booking.customer, saved ? `Booked! Your Rs ${depositInr} deposit is received.` : `We received your Rs ${depositInr} deposit but could not save your slot yet. The owner will write to you.`);
  }

  async function cancel(customer) {
    const booking = bookings.get(customer);
    if (!booking?.paymentId || !["booked", "unconfirmed"].includes(booking.state)) return say(customer, "I cannot find a paid booking for you.");
    booking.state = "refunding";
    if (upi) {
      // the owner sends it from their own UPI app; the agent never sends money and never says it was sent
      const owed = await agent.upiOwe({ paymentId: booking.paymentId, amountPaise: booking.amountPaise, why: "cancelled" }).catch(() => ({ status: 0 }));
      return say(customer, owed.status === 200 ? "OK. The owner will send your deposit back by UPI." : "I could not ask the owner yet. The owner will write to you.");
    }
    await say(customer, "OK. I am asking for your deposit back.");
    // not waited for: a refund the owner has to approve can take hours
    refund(booking).catch((e) => log(`refund: ${e.message}`));
    return undefined;
  }

  async function refund(booking) {
    // what Razorpay says was paid, and no more, whatever the customer asked for
    const money = { paymentId: booking.paymentId, amountPaise: booking.amountPaise, receipt: booking.ref };
    const done = async (paise) => { booking.state = "refunded"; await say(booking.customer, `Your deposit of Rs ${paise / 100} is refunded.`); };
    const giveUp = async (text) => { booking.state = "refund-open"; await say(booking.customer, text); };
    const rupees = money.amountPaise / 100;
    // the request Guard opened for the owner: its id and its end, from Guard's first 202; a clock of our own only when Guard names no end (it ran its 24 hours)
    let asked;
    const ownClockEnd = Date.now() + 24 * 3_600_000;
    for (;;) {
      const result = await agent.refundOnce(money).catch(() => ({ status: 0 }));
      if (result.status === 200) return done(money.amountPaise);
      if (result.status === 202) {
        // held for the owner: send the identical call again until it is made. A hold with no approval id cannot be approved on WhatsApp, so sending again is no use.
        if (!result.held) return giveUp("Your refund needs the owner. The owner will write to you.");
        const now = heldOf(result);
        // another request: the first ended without a yes. Sending it again would only ask the owner again, so stop and say so
        if (held.watchRequest && asked && now.id !== asked.id) return giveUp(`The owner decided not to refund your Rs ${rupees} deposit. Please contact the shop if you have questions.`);
        asked ??= now;
        const end = held.watchEnd ? asked.until : ownClockEnd;
        const left = end - Date.now();
        // the last send goes just before the end; after it, nothing: the owner did not answer in time
        if (left <= LAST_SEND_MS) { await sleep(Math.max(0, left) + 1000); return giveUp(`The owner did not answer in time, so your Rs ${rupees} refund was not sent. Please contact the shop directly.`); }
        await sleep(Math.min(retryMs, left - LAST_SEND_MS));
        continue;
      }
      if (result.status === 403 || result.status === 409) return giveUp("I could not make that refund. The owner will write to you.");
      return onRefundUnknown({ agent, booking, refund: money, result, done, giveUp });
    }
  }

  async function onText(customer, text) {
    if (/cancel/iu.test(text)) return cancel(customer);
    if (upi && /\b(i have |i've |i )?paid\b/iu.test(text)) return claimPaid(customer, "words");
    if (/book/iu.test(text)) return book(customer);
    if (/[₹]|\brs\b|rupee/iu.test(text)) return say(customer, `The price is Rs ${priceInr}. I cannot change it.`);
    return say(customer, "Write 'book' to book, or 'cancel' to cancel.");
  }

  const rawBody = (req) => new Promise((resolve) => { const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => resolve(Buffer.concat(chunks))); });

  return createServer(async (req, res) => {
    const raw = await rawBody(req);
    const reply = (status) => { res.writeHead(status); res.end(); };
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET") return reply(200);
    let body;
    try { body = JSON.parse(raw.toString("utf8")); } catch { return reply(400); }
    try {
      if (path === "/webhooks/whatsapp") {
        if (!same(req.headers["x-hub-signature-256"], `sha256=${hmac(appSecret, raw)}`)) return reply(401);
        for (const entry of body.entry ?? []) for (const change of entry.changes ?? []) for (const m of change.value?.messages ?? []) {
          if (seenMessages.has(m.id)) continue; // the provider sends a message again when it is not sure it was taken: once is enough
          if (upi && m.type === "image") { seenMessages.add(m.id); await claimPaid(`+${m.from}`, "screenshot"); continue; } // a screenshot is not proof: the owner looks
          if (m.type !== "text") continue;
          seenMessages.add(m.id);
          await onText(`+${m.from}`, m.text?.body ?? "");
        }
        return reply(200);
      }
      if (path === "/webhooks/razorpay") {
        if (!same(req.headers["x-razorpay-signature"], hmac(webhookSecret, raw))) return reply(401);
        const eventId = String(req.headers["x-razorpay-event-id"] ?? "");
        if (eventId && seenEvents.has(eventId)) return reply(200);
        if (eventId) seenEvents.add(eventId);
        const link = body.payload?.payment_link?.entity;
        const payment = body.payload?.payment?.entity;
        const booking = body.event === "payment_link.paid" && link ? byLink.get(link.id) : undefined;
        if (booking && booking.state === "link") {
          Object.assign(booking, { state: "paid", paymentId: payment?.id, amountPaise: payment?.amount });
          await confirm(booking);
        }
        return reply(200);
      }
    } catch (e) { log(`error: ${e.message}`); return reply(500); }
    return reply(404);
  });
}

/** Start the agent from the environment (the list at the top of this file). `extra` replaces parts of it: the broken example gives its own `onRefundUnknown`. */
export function startFromEnv(extra = {}) {
  const env = (name, fallback) => { const v = process.env[name] ?? fallback; if (v === undefined || v === "") { console.error(`Set ${name} (see the top of this file).`); process.exit(2); } return v; };
  const upi = process.env.GEOMETER_UPI_URL;
  const creds = credentialsFromEnv();
  if (!creds.credentialsFile && !creds.credential && !creds.credentials.whatsapp) { console.error("Set the credentials: GEOMETER_CREDENTIALS_FILE, or GEOMETER_<SERVICE>_CREDENTIAL for each service (see the top of this file)."); process.exit(2); }
  const agent = createAgent({
    razorpay: upi ? "" : env("GEOMETER_RAZORPAY_URL"), upi, calendar: process.env.GEOMETER_CALENDAR_URL ?? "", whatsapp: env("GEOMETER_WHATSAPP_URL"), ...creds,
    calendarId: process.env.CALENDAR_ID ?? "", phoneNumberId: env("PHONE_NUMBER_ID"),
  });
  const app = createApp({
    agent, upi: !!upi, appSecret: env("GEOMETER_WHATSAPP_APP_SECRET"), webhookSecret: upi ? "" : env("GEOMETER_RAZORPAY_WEBHOOK_SECRET"), depositInr: Number(env("GEOMETER_DEPOSIT_INR")), priceInr: Number(env("GEOMETER_PRICE_INR", env("GEOMETER_DEPOSIT_INR"))),
    hasCalendar: !!process.env.GEOMETER_CALENDAR_URL, retryMs: Number(process.env.GEOMETER_RETRY_MS ?? 5 * 60_000), log: (line) => console.error(line), ...extra,
  });
  app.listen(Number(env("PORT")), "127.0.0.1", () => console.log(`own agent listening on ${env("PORT")}`));
  return app;
}

if (import.meta.main) startFromEnv();
