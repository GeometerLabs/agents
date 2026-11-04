// A tiny agent that is NOT one of Geometer's templates: plain Node, no dependencies, the kind of thing a builder writes (or has Claude Code write). It takes a booking and a
// deposit, and then tries to refund the deposit. Its only link to Geometer is where it sends its calls: instead of api.razorpay.com, www.googleapis.com and graph.facebook.com it
// calls the three addresses `geometer agent add` printed, with the one credential printed beside them. Geometer does not run it, rebuild it or look inside it.
//
//   GEOMETER_RAZORPAY_URL=https://shops.example.com/g/my-agent/razorpay  GEOMETER_CALENDAR_URL=.../calendar  GEOMETER_WHATSAPP_URL=.../whatsapp \
//   GEOMETER_CREDENTIAL=gg_...  CALENDAR_ID=name@group.calendar.google.com  PHONE_NUMBER_ID=123456789012345  CUSTOMER=+919811111111 \
//   node bundle/examples/own-agent/agent.js
//
// What it shows (and what any agent behind Guard has to do):
//   - It sends the credential Geometer printed, as `Authorization: Bearer ...`. It never holds Razorpay's, Google's or WhatsApp's own key.
//   - A deposit link is only ever for the shop's deposit, a calendar event only on the shop's own calendar, a message only from the shop's own number: anything else is refused (HTTP 403).
//   - A refund above the owner's limit is held (HTTP 202). The owner is asked on WhatsApp. The agent sends the IDENTICAL call again until it is made (HTTP 200), and then stops:
//     the refund is made once, and a repeat of a refund already made would be held again as a new request to the owner. A refund carries a `receipt`: it is how the owner's request
//     finds the right booking.

/** An agent for one shop. `fetchFn` is for a test; everything else is where the three services' addresses are now. */
export function createAgent({ razorpay, calendar, whatsapp, credential, calendarId, phoneNumberId, fetchFn = fetch }) {
  const call = async (method, url, body) => {
    const response = await fetchFn(url, { method, headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, json, held: response.headers.get("guard-held") };
  };
  const events = `${calendar}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

  return {
    /** A payment link for the deposit. Any other amount is refused by Guard, however the agent asks. */
    createDepositLink: ({ reference, amountInr }) => call("POST", `${razorpay}/v1/payment_links`, { amount: amountInr * 100, currency: "INR", reference_id: reference, description: `Deposit ${reference}`, accept_partial: false }),
    /** Has the customer paid? The payment id is in Razorpay's record of the link. */
    readLink: (id) => call("GET", `${razorpay}/v1/payment_links/${encodeURIComponent(id)}`),
    bookSlot: ({ summary, startsAt, minutes = 30 }) => call("POST", events, { summary, start: { dateTime: new Date(startsAt).toISOString() }, end: { dateTime: new Date(startsAt + minutes * 60_000).toISOString() } }),
    tell: ({ to, text }) => call("POST", `${whatsapp}/v26.0/${phoneNumberId}/messages`, { messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
    /** One try at a refund. 202 means the owner has been asked and the call is waiting; 200 means it was made. */
    refundOnce: ({ paymentId, amountPaise, receipt }) => call("POST", `${razorpay}/v1/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise, receipt }),
    /** Keep sending the identical refund until it is no longer held, or `timeoutMs` is up. Nothing else is done to hurry it: only the owner can approve. */
    async refundUntilDone(refund, { everyMs = 5_000, timeoutMs = 24 * 3_600_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
      const stop = now() + timeoutMs;
      for (;;) {
        const result = await this.refundOnce(refund);
        if (result.status !== 202) return result;
        if (now() >= stop) return result;
        await sleep(everyMs);
      }
    },
  };
}

/** The whole story for one customer: deposit link, wait for the payment, book, tell them, then ask for the deposit back. */
export async function run(agent, { customer, reference, depositInr, startsAt, paid, retry = {}, log = console.log }) {
  const link = await agent.createDepositLink({ reference, amountInr: depositInr });
  if (link.status !== 200) throw new Error(`The deposit link was not made (HTTP ${link.status}).`);
  log(`Deposit link: ${link.json.short_url}`);
  const payment = await paid(link.json.id); // however the agent learns of a payment: a webhook, or looking at the link
  const booked = await agent.bookSlot({ summary: `Booking ${reference}`, startsAt });
  if (booked.status !== 200) throw new Error(`The slot was not booked (HTTP ${booked.status}).`);
  await agent.tell({ to: customer, text: `Booked. Your deposit of Rs ${depositInr} is received.` });
  log("Booked, and the customer is told. Now the customer cancels and the agent refunds the deposit.");
  const refund = { paymentId: payment.paymentId, amountPaise: payment.amountPaise, receipt: reference };
  const first = await agent.refundOnce(refund);
  if (first.status === 202) log(`Held for the owner (${first.held ?? "approval pending"}). The owner has been asked on WhatsApp; the same refund is sent again until the owner answers.`);
  const result = first.status === 202 ? await agent.refundUntilDone(refund, retry) : first;
  log(result.status === 200 ? `Refunded once: ${result.json.id}.` : `Not refunded (HTTP ${result.status}).`);
  return { link, booked, first, result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = (name) => { const v = process.env[name]; if (!v) { console.error(`Set ${name} (see the top of this file).`); process.exit(2); } return v; };
  const agent = createAgent({ razorpay: env("GEOMETER_RAZORPAY_URL"), calendar: env("GEOMETER_CALENDAR_URL"), whatsapp: env("GEOMETER_WHATSAPP_URL"), credential: env("GEOMETER_CREDENTIAL"), calendarId: env("CALENDAR_ID"), phoneNumberId: env("PHONE_NUMBER_ID") });
  const paidLink = async (id) => { // looking at the link until Razorpay says it is paid
    for (let i = 0; i < 600; i++) {
      const link = await agent.readLink(id);
      const p = link.json?.payments?.[0];
      if (link.json?.status === "paid" && p) return { paymentId: p.payment_id, amountPaise: p.amount };
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error("The deposit was not paid in time.");
  };
  await run(agent, { customer: env("CUSTOMER"), reference: process.env.BOOKING ?? `b-${Date.now()}`, depositInr: Number(process.env.DEPOSIT_INR ?? 200), startsAt: Date.now() + 86_400_000, paid: paidLink });
}
