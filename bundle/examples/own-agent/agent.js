// A tiny agent that is NOT one of Geometer's templates: plain Node, no dependencies, the kind of thing a builder writes (or has Claude Code write). It takes a booking and a
// deposit, and then tries to refund the deposit. Its only link to Geometer is where it sends its calls: instead of api.razorpay.com, www.googleapis.com and graph.facebook.com it
// calls the addresses `geometer agent add` printed, with the credential Geometer made for each (in secrets/agents/<name>/credentials.env on the server). Geometer does not run it,
// rebuild it or look inside it.
//
//   node --env-file=$HOME/geometer-server/secrets/agents/my-agent/credentials.env bundle/examples/own-agent/agent.js     (the addresses and the credentials, one per Guard)
//   with CALENDAR_ID=name@group.calendar.google.com  PHONE_NUMBER_ID=123456789012345  CUSTOMER=+919811111111 in the environment as well
//
// What it shows (and what any agent behind Guard has to do):
//   - It sends each Guard its own credential, as `Authorization: Bearer ...` (GEOMETER_RAZORPAY_CREDENTIAL to the Razorpay address, and so on). It never holds Razorpay's,
//     Google's or WhatsApp's own key. Given GEOMETER_CREDENTIALS_FILE it reads the file on each call, so a rotation (`geometer agent rotate`) needs no restart.
//   - A deposit link is only ever for the shop's deposit, a calendar event only on the shop's own calendar, a message only from the shop's own number: anything else is refused (HTTP 403).
//   - A refund above the owner's limit is held (HTTP 202). The owner is asked on WhatsApp. The agent sends the IDENTICAL call again until it is made (HTTP 200), and then stops:
//     the refund is made once, and a repeat of a refund already made would be held again as a new request to the owner. A refund carries a `receipt`: it is how the owner's request
//     finds the right booking. Guard's 202 names its request for the owner and when it runs out (`detail.approval`, `detail.expires_at_ms`).
//   - After the owner's NO, the identical call gets HTTP 403 with `guard.reason_code: "denied_by_approver"` (Guard since 12 Nov 2026): the owner said no, nobody is asked again,
//     and the agent stops and tells the customer. A Guard from before then answers with a 202 naming ANOTHER request instead: that too means the first ended without a yes, and
//     the agent stops. It never sends after the end (`expires_at_ms`), because a request that ran out unanswered is not a no, and the next one asks the owner again.

import { readFileSync } from "node:fs";

/** The last send of a held call goes this long before Guard's end for it, so it reaches Guard in time; nothing is sent after the end. */
export const LAST_SEND_MS = 2_000;

/** Guard's answer after the owner said no to this exact call (403, `reason_code: "denied_by_approver"`, monorepo ADR-0061 addendum): the owner's no, never "try again". */
export const saidNo = (result) => result.status === 403 && result.json?.guard?.reason_code === "denied_by_approver";

/** Guard's request for the owner, from a 202: its id and when it runs out (Guard's clock). A Guard that names no end is taken to give the shop's 24 hours. */
export const heldOf = (result, now = Date.now) => ({ id: result.json?.guard?.detail?.approval ?? result.held, until: Number(result.json?.guard?.detail?.expires_at_ms) || now() + 24 * 3_600_000 });

/** KEY=value lines (credentials.env's form): `#` lines and blank ones are skipped. */
export const readEnvFile = (path) => Object.fromEntries(readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

/**
 * An agent for one shop. `credentials` has each Guard's own credential by service (razorpay, upi, calendar, whatsapp); `credentialsFile`, when given, is read on each call
 * instead, so new credentials are picked up without a restart; `credential` is the one shared credential of an agent made before 12 Nov 2026. `fetchFn` is for a test.
 */
export function createAgent({ razorpay, upi, calendar, whatsapp, credentials = {}, credentialsFile, credential, calendarId, phoneNumberId, fetchFn = fetch }) {
  const credentialFor = (service) => {
    const name = `GEOMETER_${service.toUpperCase()}_CREDENTIAL`;
    if (credentialsFile) { try { const v = readEnvFile(credentialsFile)[name]; if (v) return v; } catch { /* the file is being replaced: use what we had */ } }
    return credentials[service] ?? credential;
  };
  const call = async (service, method, url, body, extraHeaders = {}) => {
    const response = await fetchFn(url, { method, headers: { authorization: `Bearer ${credentialFor(service)}`, "content-type": "application/json", ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, json, held: response.headers.get("guard-held") };
  };
  const events = `${calendar}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

  return {
    /** A payment link for the deposit. Any other amount is refused by Guard, however the agent asks. */
    createDepositLink: ({ reference, amountInr }) => call("razorpay", "POST", `${razorpay}/v1/payment_links`, { amount: amountInr * 100, currency: "INR", reference_id: reference, description: `Deposit ${reference}`, accept_partial: false }),
    /** Has the customer paid? The payment id is in Razorpay's record of the link. */
    readLink: (id) => call("razorpay", "GET", `${razorpay}/v1/payment_links/${encodeURIComponent(id)}`),
    bookSlot: ({ summary, startsAt, minutes = 30 }) => call("calendar", "POST", events, { summary, start: { dateTime: new Date(startsAt).toISOString() }, end: { dateTime: new Date(startsAt + minutes * 60_000).toISOString() } }),
    tell: ({ to, text }) => call("whatsapp", "POST", `${whatsapp}/v26.0/${phoneNumberId}/messages`, { messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
    /** One try at a refund. 202 means the owner has been asked and the call is waiting; 200 means it was made. `idempotencyKey` is Razorpay's own header, which Guard replaces with a key it derives. */
    refundOnce: ({ paymentId, amountPaise, receipt, idempotencyKey }) => call("razorpay", "POST", `${razorpay}/v1/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise, receipt }, idempotencyKey ? { "X-Refund-Idempotency": idempotencyKey } : {}),
    /** What Razorpay holds as links with this reference: how to find a link whose creation answer was lost (HTTP 504 from Guard) without making a second one. */
    findLink: (reference) => call("razorpay", "GET", `${razorpay}/v1/payment_links?reference_id=${encodeURIComponent(reference)}`),
    /** The calendar's own record of one event: how to know that a booking was really saved. */
    getEvent: (id) => call("calendar", "GET", `${events}/${encodeURIComponent(id)}`),
    /** What Razorpay holds as refunds against a payment: how to know a refund whose answer was lost was made. */
    listRefunds: (paymentId) => call("razorpay", "GET", `${razorpay}/v1/payments/${encodeURIComponent(paymentId)}/refunds`),
    // UPI (B71): no gateway. Geometer's desk keeps the request, the owner's marks and the refunds owed; "paid" is true only after the owner marks the money received.
    /** A UPI request for the deposit: the shop's own upi:// link and who is paid. Asked again for the same reference and amount, the same request. */
    upiRequest: ({ reference, amountInr, customer }) => call("upi", "POST", `${upi}/requests`, { reference, amount_paise: amountInr * 100, customer }),
    /** The desk's own record of one request: `paid` is the owner's word, never the customer's. */
    upiRead: (id) => call("upi", "GET", `${upi}/requests/${encodeURIComponent(id)}`),
    /** The customer says they paid: the owner is asked to look. It marks nothing paid. */
    upiClaim: (id, via) => call("upi", "POST", `${upi}/requests/${encodeURIComponent(id)}/claim`, { via }),
    /** A refund the owner owes and sends from their own UPI app: never sent by the agent, never more than was marked. */
    upiOwe: ({ paymentId, amountPaise, why }) => call("upi", "POST", `${upi}/refunds`, { payment_id: paymentId, amount_paise: amountPaise, why }),
    /**
     * Keep sending the identical refund while Guard holds it for the owner, and stop at the first of: it is made (200, or any other answer); the owner said no (Guard's 403
     * `denied_by_approver`, or, from a Guard before 12 Nov 2026, a 202 naming another request: `ended: "no"`); the request's own end, Guard's `expires_at_ms`
     * (`ended: "ran-out"`; the last send goes LAST_SEND_MS before it, never after). Nothing else is done to hurry it: only the owner can approve.
     */
    async refundUntilDone(refund, { everyMs = 5_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
      let asked;
      for (;;) {
        const result = await this.refundOnce(refund);
        if (saidNo(result)) return { ...result, ended: "no" };
        if (result.status !== 202) return result;
        const held = heldOf(result, now);
        if (asked && held.id !== asked.id) return { ...result, ended: "no" };
        asked ??= held;
        const left = asked.until - now();
        if (left <= LAST_SEND_MS) { await sleep(Math.max(0, left) + 1000); return { ...result, ended: "ran-out" }; }
        await sleep(Math.min(everyMs, left - LAST_SEND_MS));
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

/**
 * Where the credentials come from, in the names Geometer uses (credentials.env, and the crash test's environment): the file on each call when GEOMETER_CREDENTIALS_FILE names
 * it, each Guard's own (GEOMETER_<SERVICE>_CREDENTIAL), or the one shared credential of an agent made before 12 Nov 2026 (GEOMETER_CREDENTIAL).
 */
export function credentialsFromEnv(env = process.env) {
  const credentials = Object.fromEntries(["razorpay", "upi", "calendar", "whatsapp"].map((s) => [s, env[`GEOMETER_${s.toUpperCase()}_CREDENTIAL`]]).filter(([, v]) => v));
  return { credentials, ...(env.GEOMETER_CREDENTIALS_FILE ? { credentialsFile: env.GEOMETER_CREDENTIALS_FILE } : {}), ...(env.GEOMETER_CREDENTIAL ? { credential: env.GEOMETER_CREDENTIAL } : {}) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = (name) => { const v = process.env[name]; if (!v) { console.error(`Set ${name} (see the top of this file).`); process.exit(2); } return v; };
  const agent = createAgent({ razorpay: env("GEOMETER_RAZORPAY_URL"), calendar: env("GEOMETER_CALENDAR_URL"), whatsapp: env("GEOMETER_WHATSAPP_URL"), ...credentialsFromEnv(), calendarId: env("CALENDAR_ID"), phoneNumberId: env("PHONE_NUMBER_ID") });
  // Looking at the link until Razorpay says it is paid. Every look is a call through Guard, so not every second; a Razorpay webhook is better still.
  const paidLink = async (id) => {
    for (let i = 0; i < 120; i++) {
      const link = await agent.readLink(id);
      const p = link.json?.payments?.[0];
      if (link.json?.status === "paid" && p) return { paymentId: p.payment_id, amountPaise: p.amount };
      await new Promise((r) => setTimeout(r, 15_000));
    }
    throw new Error("The deposit was not paid in time.");
  };
  await run(agent, { customer: env("CUSTOMER"), reference: process.env.BOOKING ?? `b-${Date.now()}`, depositInr: Number(process.env.DEPOSIT_INR ?? 200), startsAt: Date.now() + 86_400_000, paid: paidLink });
}
