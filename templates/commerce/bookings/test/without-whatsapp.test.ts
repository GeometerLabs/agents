// Item 11h's second half (decision 45, "works without WhatsApp") end to end, through a real Bookings runtime and the real public front over HTTP: a UPI shop with no
// WhatsApp at all (its runtime.json names a push Guard and no messaging service). The owner registers a passkey from the Operator's setup QR and signs in with it
// later (a software authenticator answering for the phone); the owner's phone and the customer's phone allow alerts; every push reaches a stand-in push Guard as the
// JSON the real one checks, and the test opens it with the phone's own keys, as the browser does. What it shows: the customer books and pays on the page, the
// owner hears by push and marks the deposit from the page, the customer hears "booked" by push, cancels early, the owner marks the refund sent from the page the
// alert opens, and the customer's confirmation page and push say so. Nothing is ever sent to WhatsApp, no push carries words in clear, and the record says it all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { frontHandler } from "../../../../modules/channels/front.ts";
import type { FrontShop } from "../../../../modules/channels/front.ts";
import { runtimeBackend } from "../../../../modules/channels/backend.ts";
import { OWNER_GRANTS_FILE, SETUP_MS, newSetupToken, setupHash } from "../../../../modules/channels/owner-grants.ts";
import { OWNER_COOKIE, csrfFor } from "../../../../modules/channels/owner-session.ts";
import { newSoftPasskey, softRegister, softSignin } from "../../../../modules/channels/test/soft-authenticator.ts";
import { OWNER_LINK_FILE, newOwnerToken, ownerLinkFile } from "../../../../modules/channels/owner-link.ts";
import { decryptPush, readVapidHeader, vapidVerifies } from "../../../../modules/push/crypto.ts";
import { pushCallProblem } from "../../../../modules/push/hosts.ts";
import type { PushCall } from "../../../../modules/push/hosts.ts";
import { openStore } from "../server/store.ts";
import { startClient } from "../server/start.ts";

const INTERNAL = "internal-0123456789abcdef0123";
const CHANNEL = "channel-0123456789abcdef01234";
const UPI_SETTINGS = new URL("../settings/glow-salon-upi.example.json", import.meta.url);
const RUNTIME_OWNER_BASE = "https://pages.example/glow-salon/owner";
const PAGES_ORIGIN = "https://pages.example";

/** A phone that allows alerts: its own P-256 key pair and auth secret, and the subscription it hands the page. */
function phone(endpoint: string) {
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    subscription: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } },
    open: (body: string) => JSON.parse(decryptPush(Buffer.from(body, "base64url"), { privateKey: ecdh.getPrivateKey(), publicKey: ecdh.getPublicKey(), auth }).toString()) as { title: string; body: string; tag: string },
    path: new URL(endpoint).pathname,
  };
}

/** `whatsapp`: the shop also has (the stand-in) WhatsApp, so the owner's choice can be tried. */
async function world(o: { whatsapp?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "geo-nowa-"));
  const folder = join(root, "glow");
  mkdirSync(folder);
  // the stand-in push Guard: takes exactly what the real one would pass on (the JSON the push sender reads), and answers as a push service does
  const pushes: { route: string; call: PushCall }[] = [];
  const guard = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const call = JSON.parse(Buffer.concat(chunks).toString("utf8")) as PushCall;
      pushes.push({ route: req.url ?? "", call });
      res.writeHead(pushCallProblem(call) ? 400 : 201, { "content-type": "application/json" }); res.end("{}");
    });
  });
  const guardPort = await new Promise<number>((r) => guard.listen(0, "127.0.0.1", () => r((guard.address() as { port: number }).port)));
  const settings = { ...JSON.parse(readFileSync(UPI_SETTINGS, "utf8")), calendar: { module: "own" } };
  writeFileSync(join(folder, "settings.json"), JSON.stringify(settings));
  // no messaging service: no WhatsApp. A push Guard: every push goes through it
  writeFileSync(join(folder, "runtime.json"), JSON.stringify({ mode: "fakes", port: 0, tickSeconds: 3600, services: { push: { baseUrl: `http://127.0.0.1:${guardPort}` }, ...(o.whatsapp ? { messaging: { baseUrl: "http://whatsapp.invalid", phoneNumberId: "123456789012345" } } : {}) } }));
  writeFileSync(join(folder, "pathway.lock"), "bookings@0.1.0\n");
  writeFileSync(join(folder, "pages.json"), JSON.stringify({ schema: 1, base: "https://partners.example/s/glow", ownerBase: RUNTIME_OWNER_BASE, slug: "glow-salon", url: "https://pages.example/glow-salon" }));
  // the Operator's setup QR, as the deployer copies the panel's file (hashes only)
  const setupToken = newSetupToken();
  const clock = fakeClock(Date.UTC(2026, 10, 16, 3, 30));
  writeFileSync(join(folder, OWNER_GRANTS_FILE), JSON.stringify({ schema: 1, setup: { sha256: setupHash(setupToken), createdAt: new Date(clock.now()).toISOString(), expiresAt: new Date(clock.now() + SETUP_MS).toISOString() } }));
  writeFileSync(join(root, "token"), INTERNAL);
  writeFileSync(join(root, "channel"), CHANNEL);
  const shops: Record<string, FrontShop> = {};
  const front = createServer(frontHandler({ shops, waitMs: 1_500 }));
  const port = await new Promise<number>((r) => front.listen(0, "127.0.0.1", () => r((front.address() as { port: number }).port)));
  const origin = `http://127.0.0.1:${port}`;
  const pagesFile = { schema: 1, base: `${origin}/s/glow`, ownerBase: `${origin}/s/glow/owner` };
  const lines: string[] = [];
  const client = await startClient({ clientFolder: folder, tokenFile: join(root, "token"), channelTokenFile: join(root, "channel"), clock, log: (l) => lines.push(l) });
  shops.glow = { publicUrl: `${origin}/s/glow`, backend: runtimeBackend({ url: client.server.url, token: CHANNEL }), pages: () => pagesFile as never };
  let cookie = "";
  const page = (path: string, init: RequestInit = {}) => fetch(`${origin}/s/glow${path}`, { redirect: "manual", ...init, headers: { origin, ...(cookie ? { cookie } : {}), ...(init.headers as Record<string, string> | undefined) } });
  const json = (path: string, body: unknown, headers: Record<string, string> = {}) => page(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const form = (path: string, fields: Record<string, string>) => page(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
  const record = () => { const s = openStore(join(folder, "data")); try { return s.loadState().record; } finally { s.close(); } };
  /** Wait for the sender (it runs outside the steps) to hand the Guard a push on `route` after the first `from` pushes, and return the pushes since `from`.
   *  It waits for the route, not for a count: one step can send to the owner and the customer, and their order is not fixed (a count made the test pass
   *  or fail by which push arrived first). */
  const pushedTo = async (from: number, route: string) => { for (let i = 0; i < 100 && !pushes.slice(from).some((p) => p.route === route); i++) await new Promise((r) => setTimeout(r, 30)); return pushes.slice(from); };
  const ownerToken = newOwnerToken();
  writeFileSync(join(folder, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(ownerToken, new Date(clock.now()))));
  return {
    origin, page, json, form, record, lines, client, clock, setupToken, pushes, pushedTo, ownerToken,
    setCookie(session: string) { cookie = `${OWNER_COOKIE}=${session}`; }, signOut() { cookie = ""; },
    async done() { await new Promise<void>((r) => { front.closeAllConnections(); front.close(() => r()); }); guard.close(); await client.stop(); rmSync(root, { recursive: true, force: true }); },
  };
}

const sessionOf = (setCookie: string | null): string => new RegExp(`${OWNER_COOKIE}=([A-Za-z0-9_-]{43})`, "u").exec(setCookie ?? "")?.[1] ?? "";
const startsOn = (html: string): number[] => [...html.matchAll(/name="start" value="(\d+)"/gu)].map((m) => Number(m[1]));
const handleOf = (location: string | null): string => /\/b\/([A-Za-z0-9_-]{32})/u.exec(location ?? "")?.[1] ?? "";

test("a shop with no WhatsApp: passkey sign-in from the Operator's QR, push alerts both ways, page booking and payment, a refund marked from the alert, the refund on the confirmation page", async () => {
  const w = await world();
  try {
    // ---- the owner, at the setup visit: the Operator's QR opens the setup page; the phone makes a passkey; a session follows ----
    const setup = await w.page(`/owner/setup/${w.setupToken}?lang=en`);
    assert.equal(setup.status, 200);
    const setupHtml = await setup.text();
    assert.match(setupHtml, /Set up sign-in on this phone/u);
    assert.match(setup.headers.get("content-security-policy") ?? "", /script-src 'nonce-[^']+'; connect-src \S+\/owner\/setup\/\S+\/options \S+\/owner\/setup\/\S+\/finish$/u, "its script, and only its two addresses");
    const opts = await (await w.json(`/owner/setup/${w.setupToken}/options`, {})).json() as { options: { challenge: string; user: { id: string }; rp: { id: string } } };
    assert.equal(opts.options.rp.id, "pages.example", "the RP ID is the owner view's host");
    const ownerPhone = newSoftPasskey("pages.example");
    const reg = await w.json(`/owner/setup/${w.setupToken}/finish`, { response: softRegister(ownerPhone, opts.options, PAGES_ORIGIN) });
    assert.equal(reg.status, 200);
    const session = sessionOf(reg.headers.get("set-cookie"));
    assert.ok(session, "signed in on this phone");
    w.setCookie(session);
    assert.equal((await w.page(`/owner/setup/${w.setupToken}?lang=en`)).status, 410, "the QR works once");

    // ---- the owner turns on alerts: the alerts box, then the phone's subscription ----
    const app = await w.page("/owner/?lang=en");
    assert.equal(app.status, 200);
    const appHtml = await app.text();
    assert.match(appHtml, /Alerts on this phone/u);
    assert.doesNotMatch(appHtml, /Where should alerts go\?/u, "no WhatsApp: no choice to make");
    assert.match(app.headers.get("content-security-policy") ?? "", /worker-src \S+\/owner\/sw\.js/u, "the worker is the owner view's own");
    const ownerAlerts = phone("https://fcm.googleapis.com/fcm/send/owner-phone-1");
    const csrf = csrfFor(session);
    assert.equal((await w.json("/owner/push/subscribe", { subscription: ownerAlerts.subscription })).status, 403, "the form token is needed");
    const sub = await w.json("/owner/push/subscribe", { subscription: ownerAlerts.subscription }, { "x-owner-csrf": csrf });
    assert.equal(sub.status, 200);
    assert.equal((await w.json("/owner/push/subscribe", { subscription: phone("https://evil.example/push/1").subscription }, { "x-owner-csrf": csrf })).status, 400, "a push service the Guard does not allow is refused");
    const sw = await w.page("/owner/sw.js");
    assert.match(await sw.text(), /addEventListener\("push"/u, "the owner's worker shows alerts");

    // ---- a customer books on the page, three days ahead, and allows alerts on their booking's page; the owner hears of the payment to look for, by push ----
    const before = w.pushes.length;
    const slots = await (await w.page("/?lang=en&service=haircut&date=2026-11-19")).text();
    const start = startsOn(slots).find((t) => t >= Date.UTC(2026, 10, 19, 5, 0))!;
    const nonce = /name="nonce" value="([A-Za-z0-9_-]{32})"/u.exec(slots)?.[1] ?? "";
    const booked = await w.form("/book", { service: "haircut", start: String(start), name: "Asha", phone: "98111 11111", lang: "en", nonce });
    const handle = handleOf(booked.headers.get("location"));
    assert.ok(handle);
    await w.client.runtime.idle();
    const held = await w.page(`/b/${handle}?lang=en`);
    const heldHtml = await held.text();
    assert.match(heldHtml, /Tell me on this phone/u);
    assert.match(heldHtml, /booking\.ics/u, "a calendar file is offered");
    assert.match(held.headers.get("content-security-policy") ?? "", new RegExp(`worker-src \\S+/b/${handle}/sw\\.js`, "u"), "the customer's worker is this page's own");
    const customerAlerts = phone("https://updates.push.services.mozilla.com/wpush/v2/customer-phone-1");
    assert.equal((await w.json(`/b/${handle}/push`, { subscription: customerAlerts.subscription })).status, 200);
    assert.equal((await w.json(`/b/${"A".repeat(32)}/push`, { subscription: customerAlerts.subscription })).status, 404, "a made-up handle subscribes nothing");
    const ics = await w.page(`/b/${handle}/booking.ics?lang=en`);
    assert.equal(ics.headers.get("content-type"), "text/calendar; charset=utf-8");
    const icsText = await ics.text();
    assert.match(icsText, /BEGIN:VEVENT\r\n/u);
    assert.match(icsText, /DTSTART:20261119T\d{6}Z/u);
    assert.ok(!icsText.includes(handle), "the booking's bearer link is not in the calendar file");

    // ---- the owner heard of the held booking by push (not WhatsApp); "I have paid" on the page goes no further than asking the owner to look ----
    await w.form(`/b/${handle}/paid`, { lang: "en" });
    await w.client.runtime.idle();
    const p1 = await w.pushedTo(before, "/v1/push/owner");
    assert.ok(p1.length >= 1, "a push went to the owner");
    const toOwner = p1.find((p) => p.route === "/v1/push/owner")!;
    assert.equal(toOwner.call.host, "fcm.googleapis.com");
    assert.equal(toOwner.call.path, ownerAlerts.path);
    const said = ownerAlerts.open(toOwner.call.body);
    assert.match(said.body, /₹200/u, "the owner's phone reads the alert");
    assert.ok(!JSON.stringify(toOwner.call).includes("₹200") && !JSON.stringify(toOwner.call).includes("Asha"), "nothing on the way can read it");
    const vapid = readVapidHeader(toOwner.call.vapid)!;
    assert.ok(vapidVerifies(vapid.t, vapid.k), "signed with the shop's own key");
    assert.equal(JSON.parse(Buffer.from(vapid.t.split(".")[1], "base64url").toString()).aud, "https://fcm.googleapis.com");

    // ---- the owner marks the deposit from the page: booked; the customer hears it by push ----
    const state = await (await w.page("/owner/api/v1/state")).json() as { waiting: { source: string; kind: string; case: string; digest: string; actions: string[] }[] };
    const deposit = state.waiting.find((x) => x.kind === "deposit")!;
    const before2 = w.pushes.length;
    const mark = await w.json("/owner/api/v1/answer", { source: "runtime", action: "received", case: deposit.case, digest: deposit.digest }, { "x-owner-csrf": csrf });
    assert.deepEqual(await mark.json(), { result: "done" });
    await w.client.runtime.idle();
    assert.match(await (await w.page(`/b/${handle}?lang=en`)).text(), /Booked: /u);
    const p2 = await w.pushedTo(before2, "/v1/push/customer");
    const toCustomer = p2.find((p) => p.route === "/v1/push/customer");
    assert.ok(toCustomer, "the customer's phone gets the news");
    assert.equal(toCustomer!.call.host, "updates.push.services.mozilla.com");
    assert.match(customerAlerts.open(toCustomer!.call.body).body, /booked/iu);

    // ---- the customer cancels early: a refund is owed; the owner hears by push, opens the page and marks it sent ----
    const before3 = w.pushes.length;
    await w.form(`/b/${handle}/cancel`, { lang: "en" });
    await w.client.runtime.idle();
    const p3 = await w.pushedTo(before3, "/v1/push/owner");
    const refundAlert = p3.find((p) => p.route === "/v1/push/owner");
    assert.ok(refundAlert, "the refund to send reaches the owner as an alert");
    assert.match(ownerAlerts.open(refundAlert!.call.body).body, /₹200/u);
    const owed = (await (await w.page("/owner/api/v1/state")).json() as typeof state).waiting.find((x) => x.kind === "refund_owed")!;
    assert.ok(owed, "the page the alert opens lists the refund");
    assert.match(await (await w.page(`/b/${handle}?lang=en`)).text(), /Your refund of ₹200 is on its way from the shop\./u, "the confirmation page shows the refund as owed");
    const before4 = w.pushes.length;
    assert.deepEqual(await (await w.json("/owner/api/v1/answer", { source: "runtime", action: "refunded", case: owed.case, digest: owed.digest }, { "x-owner-csrf": csrf })).json(), { result: "done" });
    await w.client.runtime.idle();
    assert.match(await (await w.page(`/b/${handle}?lang=en`)).text(), /The shop has sent your refund of ₹200\./u, "and then as sent");
    const p4 = await w.pushedTo(before4, "/v1/push/customer");
    const refundNotice = p4.find((p) => p.route === "/v1/push/customer");
    assert.ok(refundNotice, "the customer's refund notice arrives by push");
    assert.match(customerAlerts.open(refundNotice!.call.body).body, /refund/iu);

    // ---- asking the page for a sign-in link on a shop with no WhatsApp: nothing goes (never as a push), and the record says why ----
    w.signOut();
    const pushesBefore = w.pushes.length;
    await w.form("/owner/signin", { lang: "en" });
    await w.client.runtime.idle();
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(w.pushes.length, pushesBefore, "no sign-in link is pushed");
    assert.ok(w.record().some((e) => e.action === "owner_signin" && e.outcome === "blocked" && /no WhatsApp/u.test(e.notes ?? "")), "the record says no link went, and why");

    // ---- signing in again later: the passkey, no WhatsApp ----
    const signin = await w.page("/owner?lang=en");
    const signinHtml = await signin.text();
    assert.match(signinHtml, /Sign in with your fingerprint/u);
    assert.doesNotMatch(signinHtml, /Send me a sign-in link/u, "no WhatsApp, no link to ask for");
    const o2 = await (await w.json("/owner/passkey/options", {})).json() as { options: { challenge: string } };
    const again = await w.json("/owner/passkey/finish", { response: softSignin(ownerPhone, o2.options, PAGES_ORIGIN) });
    assert.equal(again.status, 200);
    assert.ok(sessionOf(again.headers.get("set-cookie")));

    // ---- the record: every owner notice went by push; nothing went to WhatsApp; no push address or word in the record ----
    const entries = w.record();
    const ownerSends = entries.filter((e) => e.refs.to === "owner" && e.action === "send_message");
    assert.ok(ownerSends.length >= 3 && ownerSends.every((e) => e.outcome === "confirmed" && String(e.refs.messageId ?? "").startsWith("push-")), "each alert to the owner is a push, named by its id");
    assert.ok(entries.some((e) => e.action === "owner_session" && e.refs.what === "passkey_added" && e.refs.how === "setup"), "the passkey from the Operator's QR is in the record");
    assert.equal(entries.filter((e) => e.action === "owner_session" && e.refs.what === "signed_in" && e.refs.how === "passkey").length, 2);
    assert.ok(!w.lines.some((l) => l.startsWith("[stand-in WhatsApp]")), "nothing was sent on WhatsApp");
    const text = JSON.stringify(entries);
    assert.ok(!text.includes("fcm.googleapis.com") && !text.includes("customer-phone-1") && !text.includes(handle), "no push address and no handle in the record");
  } finally { await w.done(); }
});

test("with no phone allowing alerts and no WhatsApp, nothing is sent, the record says so, and the owner's page still lists what waits", async () => {
  const w = await world();
  try {
    const slots = await (await w.page("/?lang=en&service=haircut&date=2026-11-19")).text();
    const start = startsOn(slots)[0];
    const nonce = /name="nonce" value="([A-Za-z0-9_-]{32})"/u.exec(slots)?.[1] ?? "";
    const booked = await w.form("/book", { service: "haircut", start: String(start), name: "Ravi", phone: "98222 22222", lang: "en", nonce });
    const handle = handleOf(booked.headers.get("location"));
    await w.client.runtime.idle();
    await w.form(`/b/${handle}/paid`, { lang: "en" });
    await w.client.runtime.idle();
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(w.pushes.length, 0, "no phone allowed alerts: no push");
    const failed = w.record().filter((e) => e.refs.to === "owner" && e.action === "send_message");
    assert.ok(failed.length >= 1 && failed.every((e) => e.outcome === "failed" && /no WhatsApp number/u.test(e.notes ?? "")), "the record says the owner could not be told, and why");
    assert.match(await (await w.page(`/b/${handle}?lang=en`)).text(), /held until/u, "the confirmation page shows the state");
  } finally { await w.done(); }
});

/** Book `service` at the first free start on `date` from the page; the handle. */
async function book(w: Awaited<ReturnType<typeof world>>, date: string, name: string, phone: string, after = 0): Promise<string> {
  const slots = await (await w.page(`/?lang=en&service=haircut&date=${date}`)).text();
  const start = startsOn(slots).find((t) => t >= after)!;
  const nonce = /name="nonce" value="([A-Za-z0-9_-]{32})"/u.exec(slots)?.[1] ?? "";
  const r = await w.form("/book", { service: "haircut", start: String(start), name, phone, lang: "en", nonce });
  await w.client.runtime.idle();
  return handleOf(r.headers.get("location"));
}
/** The owner presses on their page (the panel-made link: no form token needed) and the step runs. */
async function press(w: Awaited<ReturnType<typeof world>>, kind: string, action: string): Promise<void> {
  const state = await (await w.page(`/o/${w.ownerToken}/api/v1/state`)).json() as { waiting: { kind: string; case: string; digest: string }[] };
  const item = state.waiting.find((x) => x.kind === kind);
  assert.ok(item, `the owner's page lists the ${kind}`);
  assert.deepEqual(await (await w.json(`/o/${w.ownerToken}/api/v1/answer`, { source: "runtime", action, case: item!.case, digest: item!.digest })).json(), { result: "done" });
  await w.client.runtime.idle();
}

test("the owner's choice is followed: the first phone gives both, then push alone, then WhatsApp alone", async () => {
  const w = await world({ whatsapp: true });
  try {
    const ownerPhone = phone("https://fcm.googleapis.com/fcm/send/choice-phone");
    assert.equal((await w.json(`/o/${w.ownerToken}/push/subscribe`, { subscription: ownerPhone.subscription })).status, 200);
    const app = await (await w.page(`/o/${w.ownerToken}/?lang=en`)).text();
    assert.match(app, /Where should alerts go\?/u, "with WhatsApp, the owner may choose");
    assert.match(app, /value="both" checked/u, "the first phone with alerts: both");
    const waTo = () => w.lines.filter((l) => l.startsWith("[stand-in WhatsApp] to +919000000000")).length;
    const toOwner = () => w.pushes.filter((p) => p.route === "/v1/push/owner").length;
    const step = async (date: string, n: string, ph: string) => { const wa = waTo(); const pu = toOwner(); const n0 = w.pushes.length; await book(w, date, n, ph); await w.pushedTo(n0, "/v1/push/owner"); await new Promise((r) => setTimeout(r, 150)); return { wa: waTo() - wa, push: toOwner() - pu }; };
    assert.deepEqual(await step("2026-11-18", "Asha", "98111 11111"), { wa: 1, push: 1 }, "both");
    await w.form(`/o/${w.ownerToken}/push/choice`, { choice: "push" });
    assert.deepEqual(await step("2026-11-18", "Ravi", "98222 22222"), { wa: 0, push: 1 }, "push alone");
    await w.form(`/o/${w.ownerToken}/push/choice`, { choice: "whatsapp" });
    const wa = waTo(); const pu = toOwner();
    await book(w, "2026-11-19", "Meera", "98333 33333");
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual({ wa: waTo() - wa, push: toOwner() - pu }, { wa: 1, push: 0 }, "WhatsApp alone");
  } finally { await w.done(); }
});

test("a customer who allowed alerts gets the reminder by push; a late cancellation's refund is approved from the owner's alert and shown on the confirmation page", async () => {
  const w = await world();
  try {
    const ownerPhone = phone("https://fcm.googleapis.com/fcm/send/late-owner");
    assert.equal((await w.json(`/o/${w.ownerToken}/push/subscribe`, { subscription: ownerPhone.subscription })).status, 200);
    // today, a few hours ahead: inside the 24-hour cancellation window
    const handle = await book(w, "2026-11-16", "Asha", "98111 11111", Date.UTC(2026, 10, 16, 9, 0));
    const customer = phone("https://web.push.apple.com/late-customer");
    assert.equal((await w.json(`/b/${handle}/push`, { subscription: customer.subscription })).status, 200);
    await press(w, "deposit", "received");
    assert.match(await (await w.page(`/b/${handle}?lang=en`)).text(), /Booked: /u);
    // the 2-hours-before reminder, by push only (there is no WhatsApp)
    const before = w.pushes.length;
    w.clock.advance(4 * 60 * 60_000);
    await w.client.runtime.tick(); await w.client.runtime.idle();
    const reminder = (await w.pushedTo(before, "/v1/push/customer")).find((p) => p.route === "/v1/push/customer");
    assert.ok(reminder, "the reminder reached the customer's phone");
    assert.equal(reminder!.call.host, "web.push.apple.com");
    assert.match(customer.open(reminder!.call.body).body, /Haircut|haircut|today|reminder/iu);
    // a late cancellation: the owner is asked, by push, whether to refund
    const before2 = w.pushes.length;
    await w.form(`/b/${handle}/cancel`, { lang: "en" });
    await w.client.runtime.idle();
    for (let i = 0; i < 100 && !w.pushes.slice(before2).some((p) => p.route === "/v1/push/owner"); i++) await new Promise((r) => setTimeout(r, 30));
    const ask = w.pushes.slice(before2).find((p) => p.route === "/v1/push/owner");
    assert.ok(ask, "the owner's alert");
    assert.match(ownerPhone.open(ask!.call.body).body, /₹200/u);
    assert.match(await (await w.page(`/b/${handle}?lang=en`)).text(), /The shop is deciding about a refund of ₹200\./u, "the page says the shop is deciding");
    await press(w, "late_refund", "approve");
    assert.match(await (await w.page(`/b/${handle}?lang=en`)).text(), /Your refund of ₹200 is on its way from the shop\./u, "approved: on its way");
    await press(w, "refund_owed", "refunded");
    assert.match(await (await w.page(`/b/${handle}?lang=en`)).text(), /The shop has sent your refund of ₹200\./u, "and sent");
  } finally { await w.done(); }
});

// Owner's item 2 ("no Operator holds a shop hostage") through the real runtime and front: the owner's phones page, a new phone announced by a banner on the first phone and by a
// push to its alerts, the owner's own recovery codes, and removing a phone (the last one only after a second, stronger confirm). The phones are software passkeys; the
// browser's User-Agent only becomes a coarse label ("Android, Chrome"), which the runtime keeps and the page shows.
test("the owner's phones: the list with labels, a new phone is announced by banner and push, own codes, remove one, and the last only after the second confirm", async () => {
  const UA_A = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
  const UA_B = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const w = await world();
  try {
    /** Register a new phone with a setup token, from a browser with this User-Agent; the session it gets. */
    const regPhone = async (token: string, ua: string): Promise<string> => {
      const opts = await (await w.json(`/owner/setup/${token}/options`, {}, { "user-agent": ua })).json() as { options: never };
      const reg = await w.json(`/owner/setup/${token}/finish`, { response: softRegister(newSoftPasskey("pages.example"), opts.options, PAGES_ORIGIN) }, { "user-agent": ua });
      assert.equal(reg.status, 200);
      return sessionOf(reg.headers.get("set-cookie"));
    };
    const A = await regPhone(w.setupToken, UA_A);
    assert.ok(A);
    w.setCookie(A);
    const ownerAlerts = phone("https://fcm.googleapis.com/fcm/send/owner-phone-1");
    assert.equal((await w.json("/owner/push/subscribe", { subscription: ownerAlerts.subscription }, { "x-owner-csrf": csrfFor(A) })).status, 200);

    // the list: one phone, with its label, "this phone", and the prompt to make the owner's own codes; the page runs no script
    const list = await w.page("/owner/phones?lang=en");
    assert.equal(list.status, 200);
    assert.match(list.headers.get("content-security-policy") ?? "", /^default-src 'none'; style-src 'unsafe-inline'; form-action 'self'/u);
    const listHtml = await list.text();
    assert.match(listHtml, /Android, Chrome/u);
    assert.match(listHtml, /This phone/u);
    assert.match(listHtml, /Only one phone can open your shop now/u);
    assert.doesNotMatch(listHtml, /<script/u);
    const home = await (await w.page("/owner/?lang=en")).text();
    assert.match(home, /Make your own codes now, so only you hold them/u, "right after the first sign-in");
    assert.match(home, /Phones that can open your shop/u, "the link from the owner's page");

    // the owner adds a phone from this phone: a one-use address (and its QR); the new phone registers with it and is labelled by ITS browser
    const added = await w.form("/owner/phones/add", { csrf: csrfFor(A) });
    assert.equal(added.status, 200);
    const token = /\/owner\/setup\/([A-Za-z0-9_-]{43})/u.exec(await added.text())?.[1] ?? "";
    assert.ok(token, "the page shows the one-use address");
    const before = w.pushes.length;
    const B = await regPhone(token, UA_B);
    assert.ok(B);
    assert.equal((await w.page(`/owner/setup/${token}?lang=en`)).status, 410, "the owner's own link works once too");

    // announced: a push to the owner's alerts says when and which phone, and the first phone's next open shows the banner; the new phone is not told about itself
    const pushed = await w.pushedTo(before, "/v1/push/owner");
    const alert = pushed.filter((p) => p.route === "/v1/push/owner").map((p) => ownerAlerts.open(p.call.body)).find((m) => /new phone was added/u.test(m.body));
    assert.ok(alert, "the owner's phone with alerts on was told");
    assert.match(alert.body, /iPhone, Safari/u);
    assert.doesNotMatch(alert.body, /https?:/u);
    w.setCookie(A);
    const banner = await (await w.page("/owner/?lang=en")).text();
    assert.match(banner, /A new phone was added on .*\(iPhone, Safari\)\. Not you\? Remove it\./u);
    w.setCookie(B);
    assert.doesNotMatch(await (await w.page("/owner/?lang=en")).text(), /A new phone was added/u, "the new phone is not told about itself");
    w.setCookie(A);
    assert.equal((await w.form("/owner/phones/dismiss", { csrf: csrfFor(A) })).status, 303);
    assert.doesNotMatch(await (await w.page("/owner/?lang=en")).text(), /A new phone was added/u, "dismissed");
    assert.equal((await w.form("/owner/phones/dismiss", { csrf: "x".repeat(32) })).status, 403, "the form token is needed");

    // the owner's own codes: five, shown once, never cached; the prompt goes
    const codes = await w.form("/owner/phones/codes", { csrf: csrfFor(A) });
    assert.equal(codes.status, 200);
    assert.equal(codes.headers.get("cache-control"), "no-store");
    assert.equal((await codes.text()).match(/[A-HJ-KM-NP-Z2-9]{5}-[A-HJ-KM-NP-Z2-9]{5}/gu)?.length, 5);
    assert.doesNotMatch(await (await w.page("/owner/?lang=en")).text(), /Make your own codes now/u);
    // a session made by the panel's owner link (the Operator's) has no phones page at all
    const opened = await w.page(`/o/${w.ownerToken}/phones?lang=en`);
    assert.ok(opened.status === 404 || opened.status === 303, "the panel's link opens nothing here");

    // two phones listed; remove the second (one confirm), and its session ends
    const two = await (await w.page("/owner/phones?lang=en")).text();
    const ids = [...two.matchAll(/phones\?remove=([0-9a-f]{12})/gu)].map((m) => m[1]);
    assert.equal(ids.length, 2);
    assert.match(await (await w.page(`/owner/phones?remove=${ids[1]}&lang=en`)).text(), /Remove this phone\?/u);
    const gone = await w.form("/owner/phones/remove", { csrf: csrfFor(A), id: ids[1] });
    assert.equal(gone.status, 303);
    assert.match(gone.headers.get("location") ?? "", /n=removed/u);
    w.setCookie(B);
    assert.equal((await w.page("/owner/?lang=en")).status, 303, "the removed phone is signed out");

    // the last phone: a plain remove is refused at the runtime and the page asks again in stronger words; only the second yes removes it
    w.setCookie(A);
    const ask = await w.form("/owner/phones/remove", { csrf: csrfFor(A), id: ids[0] });
    assert.equal(ask.status, 200);
    assert.match(await ask.text(), /This is your only phone/u);
    assert.equal((await w.page("/owner/?lang=en")).status, 200, "still signed in: nothing was removed");
    const done = await w.form("/owner/phones/remove", { csrf: csrfFor(A), id: ids[0], confirm_last: "yes" });
    assert.equal(done.status, 303);
    assert.equal((await w.page("/owner/?lang=en")).status, 303, "no phone opens the shop now");
    // the record says each step, with the label and no secret
    await w.client.runtime.idle();
    const said = w.record().filter((e) => e.action === "owner_session").map((e) => `${e.refs.what}:${e.refs.label ?? ""}`);
    assert.ok(said.includes("passkey_added:Android, Chrome") && said.includes("passkey_added:iPhone, Safari") && said.includes("codes_made:") && said.some((s) => s.startsWith("phone_removed")), said.join(" | "));
  } finally { await w.done(); }
});
