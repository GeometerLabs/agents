// The demo mode, driven through its HTTP endpoints. Outcomes are judged from what the stand-in services hold
// (state.record.fakes: the calendar's events, the payments service's links and refunds), not from message text alone.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import http from "node:http";
import vm from "node:vm";
import { MAX_BODY_BYTES, isLocalNetworkAddress, isPrivateIPv4, lanAddresses, startDemo } from "../demo/app.ts";
import type { DemoOptions, RunningDemo } from "../demo/app.ts";
import { applyLanguage, languageOptions } from "../demo/personalise.ts";
import { MAX_CUSTOMER_MESSAGES, chipsFor, createDemo } from "../demo/session.ts";
import { glowSalon } from "../src/harness.ts";
import { LANGUAGES, parseSettings } from "../src/settings.ts";
import { zonedToMs } from "../src/time.ts";

const NOW = zonedToMs({ year: 2026, month: 11, day: 3 }, { hour: 10, minute: 0 }, "Asia/Kolkata"); // Tue 3 Nov, 10:00 in India
const running: RunningDemo[] = [];
after(async () => { await Promise.all(running.map((d) => d.close())); });

async function boot(options: Partial<DemoOptions> = {}): Promise<RunningDemo> {
  const demo = await startDemo({ settings: glowSalon(), hosts: ["127.0.0.1"], port: 0, nowMs: NOW, ...options });
  running.push(demo);
  return demo;
}

interface Reply { status: number; headers: http.IncomingHttpHeaders; text: string; json: any }

function raw(demo: RunningDemo, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    let answered = false;
    const req = http.request({ host: "127.0.0.1", port: demo.port, method, path, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        answered = true;
        const text = Buffer.concat(chunks).toString("utf8");
        let json: any;
        try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
      });
    });
    req.on("error", (e) => { if (!answered) reject(e); });
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** A browser: keeps its own session cookie. */
function browser(demo: RunningDemo) {
  let cookie = "";
  const remember = (r: Reply) => { const set = r.headers["set-cookie"]; if (set?.[0]) cookie = set[0].split(";")[0]; return r; };
  const jsonHeaders = () => ({ "content-type": "application/json", host: `127.0.0.1:${demo.port}`, ...(cookie ? { cookie } : {}) });
  return {
    get cookie() { return cookie; },
    async state() { const r = remember(await raw(demo, "GET", "/api/state", cookie ? { cookie } : {})); assert.equal(r.status, 200); return r.json; },
    async post(path: string, body: unknown = {}) { return remember(await raw(demo, "POST", path, jsonHeaders(), JSON.stringify(body))); },
    /** A POST that must work: returns the new state. */
    async do(path: string, body: unknown = {}) { const r = await this.post(path, body); assert.equal(r.status, 200, r.text); return r.json; },
  };
}
type Browser = ReturnType<typeof browser>;

const BOOK = "I want a haircut tomorrow at 6pm";
const calendarOf = (s: any) => s.record.fakes.calendar as { bookingRef: string; status: string; start: string }[];
const linksOf = (s: any) => s.record.fakes.payments as { id: string; bookingRef: string; amountInr: number; status: string; paid: { id: string; amountInr: number; refundedInr: number }[] }[];
const refundsOf = (s: any) => s.record.fakes.refunds as { id: string; paymentId: string; amountInr: number }[];
const customerSaid = (s: any): string[] => s.customer.messages.filter((m: any) => m.who === "agent").map((m: any) => m.text as string);

// ---- the page ----------------------------------------------------------------------------------------------------------

test("the page is one self-contained document with a strict policy and the demo banner", async () => {
  const demo = await boot();
  const r = await raw(demo, "GET", "/", { host: `127.0.0.1:${demo.port}` });
  assert.equal(r.status, 200);
  assert.match(String(r.headers["content-type"]), /text\/html/);
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  const csp = String(r.headers["content-security-policy"]);
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
  assert.ok(nonce, "the policy names a nonce for scripts");
  assert.ok(r.text.includes(`<script nonce="${nonce}">`) && r.text.includes(`<style nonce="${nonce}">`), "only the nonced blocks may run");
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(r.text.includes("Demo · test money · nothing real is sent"), "the banner is in the page itself, before any script runs");
  assert.ok(!/<script[^>]*\ssrc=/i.test(r.text) && !/<link\b/i.test(r.text) && !/https?:\/\//i.test(r.text), "nothing is loaded from anywhere else");
  assert.ok(!/\son[a-z]+\s*=/i.test(r.text), "no inline event handlers");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(r.text), "the script never turns text into markup");
  const second = await raw(demo, "GET", "/", { host: `127.0.0.1:${demo.port}` });
  assert.notEqual(/nonce-([^']+)'/.exec(String(second.headers["content-security-policy"]))?.[1], nonce, "a new nonce each time");
});

test("the demo makes no network calls of its own", () => {
  const dir = new URL("../demo/", import.meta.url);
  for (const file of readdirSync(dir)) {
    const source = readFileSync(new URL(file, dir), "utf8");
    assert.ok(!/node:https|node:net\b|node:tls|node:dgram|node:dns|http\.request|http\.get|XMLHttpRequest|WebSocket/.test(source), `${file} opens no connection out`);
    if (file.endsWith(".ts")) assert.ok(!/\bfetch\(/.test(source), `${file} does not call fetch`);
    if (file === "page.js") assert.ok([...source.matchAll(/fetch\(([^)]*)\)/g)].every((m) => /^path\b/.test(m[1])), "the page fetches only the paths it is given");
    assert.ok(!/https?:\/\/(?!demo\.local)/.test(source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")), `${file} has no web address in its code`);
  }
});

// ---- a booking, from the fakes' own records --------------------------------------------------------------------------------

test("message -> deposit link -> pay -> booked, judged from the calendar and the payments service", async () => {
  const demo = await boot();
  const b = browser(demo);
  let s = await b.do("/api/say", { text: BOOK });
  assert.deepEqual(calendarOf(s).map((e) => [e.bookingRef, e.status, e.start]), [["b-1", "tentative", "Wed 4 Nov, 6:00 pm"]], "a held slot, not yet a booking");
  assert.equal(linksOf(s).length, 1);
  assert.equal(linksOf(s)[0].amountInr, 200, "the link asks for the deposit");
  assert.equal(linksOf(s)[0].status, "created");
  assert.equal(s.customer.canPay, true);
  assert.ok(!s.owner.summary.some((l: any) => /in your calendar/.test(l.text)), "no booking is claimed yet");

  s = await b.do("/api/pay", { times: 1 });
  assert.deepEqual(calendarOf(s).map((e) => [e.bookingRef, e.status]), [["b-1", "confirmed"]], "now the calendar shows it");
  assert.equal(linksOf(s)[0].status, "paid");
  assert.equal(linksOf(s)[0].paid.length, 1);
  assert.deepEqual(refundsOf(s), []);
  assert.ok(customerSaid(s).some((t) => /Booked!/.test(t)));
  assert.ok(s.owner.summary.some((l: any) => l.kind === "ok" && /in your calendar/.test(l.text)), "the owner's summary says what was checked");
  const confirmed = s.record.rows.filter((r: any) => r.outcome === "confirmed").map((r: any) => r.action);
  assert.ok(confirmed.includes("Confirmed the booking in the calendar") && confirmed.includes("Recorded the deposit"));
  assert.equal(s.customer.canPay, false);
});

test("a price below the list is refused: the link is for the deposit, never the offer", async () => {
  const demo = await boot();
  const b = browser(demo);
  const s = await b.do("/api/say", { text: `${BOOK}, can you do it for ₹300?` });
  assert.equal(linksOf(s)[0].amountInr, 200);
  assert.ok(!linksOf(s).some((l) => l.amountInr === 300));
  const decisions = s.record.rows.flatMap((r: any) => r.decisions);
  assert.ok(decisions.some((d: any) => d.rule === "Price list" && d.verdict === "block" && d.reason.includes("₹300")), "the rule that said no is in the record");
  assert.ok(s.owner.summary.some((l: any) => l.kind === "ok" && l.text.includes("₹300")), "the owner is told it said no to ₹300");
  assert.ok(customerSaid(s).some((t) => /₹450/.test(t) && /can't go lower/.test(t)));
  const other = browser(demo); // a free haircut is a price below the list too
  const free = await other.do("/api/say", { text: "can I get the haircut tomorrow at 6pm for free?" });
  assert.ok(free.record.rows.some((r: any) => r.decisions.some((d: any) => d.rule === "Price list" && d.verdict === "block")));
  assert.equal(linksOf(free)[0].amountInr, 200);
});

test("paying twice: one booking, the extra payment goes back, the owner can see it", async () => {
  const demo = await boot();
  const b = browser(demo);
  await b.do("/api/say", { text: BOOK });
  const s = await b.do("/api/pay", { times: 2 });
  assert.equal(linksOf(s)[0].paid.length, 2);
  assert.deepEqual(refundsOf(s).map((r) => r.amountInr), [200]);
  assert.equal(linksOf(s)[0].paid.filter((p) => p.refundedInr > 0).length, 1, "exactly one of the two payments was refunded");
  assert.equal(calendarOf(s).filter((e) => e.status === "confirmed").length, 1, "still one booking");
  assert.ok(s.owner.summary.some((l: any) => /paid twice/.test(l.text)));
  assert.ok(s.owner.messages.some((m: any) => /paid the deposit twice/.test(m.text)), "the owner's WhatsApp was told");
});

test("a confusing date: it checks back first and holds nothing until the customer says yes", async () => {
  const demo = await boot();
  const b = browser(demo);
  let s = await b.do("/api/say", { text: "I want a haircut next Tuesday at 6pm" });
  assert.deepEqual(calendarOf(s), [], "no slot held yet");
  assert.deepEqual(linksOf(s), [], "no payment link yet");
  assert.ok(customerSaid(s).some((t) => /Just to be sure/.test(t) && /Tue 10 Nov, 6:00 pm/.test(t)), "it says the full date back");
  s = await b.do("/api/say", { text: "yes" });
  assert.deepEqual(calendarOf(s).map((e) => [e.status, e.start]), [["tentative", "Tue 10 Nov, 6:00 pm"]]);
  assert.equal(linksOf(s).length, 1);
});

test("time passes: an unpaid hold is released, and a paid booking gets its reminder", async () => {
  const demo = await boot();
  const b = browser(demo);
  await b.do("/api/say", { text: BOOK });
  let s = await b.do("/api/time", { minutes: 60 });
  assert.deepEqual(calendarOf(s), [], "the hold ran out and the calendar is free again");
  assert.equal(linksOf(s)[0].status, "cancelled");
  assert.equal(s.customer.canPay, false);
  assert.ok(customerSaid(s).some((t) => /hold on .* has ended/.test(t)));

  await b.do("/api/reset");
  await b.do("/api/say", { text: BOOK });
  await b.do("/api/pay", { times: 1 });
  s = await b.do("/api/time", { minutes: 1440 });
  assert.ok(customerSaid(s).some((t) => /^Reminder:/.test(t)), "the 24-hour reminder went out");
  assert.equal(s.clock, "Wed 4 Nov, 10:00 am");
});

// ---- the owner ---------------------------------------------------------------------------------------------------------------

async function bookPayAndCancelLate(b: Browser) {
  await b.do("/api/say", { text: BOOK });
  await b.do("/api/pay", { times: 1 });
  await b.do("/api/time", { minutes: 1440 }); // it is now 8 hours before the start: inside the 24-hour window
  return b.do("/api/cancel");
}

test("owner approval: a late cancellation waits for the owner, and Approve gives the money back", async () => {
  const demo = await boot();
  const b = browser(demo);
  let s = await bookPayAndCancelLate(b);
  assert.deepEqual(refundsOf(s), [], "nothing was given back yet");
  assert.equal(s.owner.waiting.length, 1);
  assert.deepEqual(s.owner.waiting[0].buttons.map((x: any) => x.command), ["approve", "deny"]);
  assert.ok(s.owner.messages.some((m: any) => /Reply "approve b-1"/.test(m.text)), "the owner was asked on WhatsApp");
  assert.equal(calendarOf(s).length, 0, "the slot is free again");

  assert.ok(s.owner.summary.some((l: any) => l.kind === "ok" && /made and then cancelled/.test(l.text)), "the owner is told the booking was made and is now off the calendar");
  assert.ok(!s.owner.summary.some((l: any) => /No bookings yet/.test(l.text)), "a cancelled booking is not 'no bookings'");

  s = await b.do("/api/owner", { command: "approve", ref: s.owner.waiting[0].ref });
  assert.deepEqual(refundsOf(s).map((r) => r.amountInr), [200]);
  assert.ok(s.owner.summary.some((l: any) => /₹200 in deposits came in and ₹200 went back\. You keep ₹0/.test(l.text)), "collected, given back and kept are all said");
  assert.equal(s.owner.waiting.length, 0);
  assert.ok(s.owner.messages.some((m: any) => m.who === "me" && m.text === "approve b-1"), "the owner's command is shown as sent");
  assert.ok(customerSaid(s).some((t) => /owner approved your refund/.test(t)));
});

test("owner denial keeps the deposit; bad owner commands are refused or ignored", async () => {
  const demo = await boot();
  const b = browser(demo);
  let s = await bookPayAndCancelLate(b);
  s = await b.do("/api/owner", { command: "deny", ref: "b-1" });
  assert.deepEqual(refundsOf(s), [], "no money went back");
  assert.equal(s.owner.waiting.length, 0);
  assert.equal(linksOf(s)[0].paid[0].refundedInr, 0);
  assert.ok(customerSaid(s).some((t) => /decided not to refund/.test(t)));

  for (const body of [{ command: "delete", ref: "b-1" }, { command: "approve", ref: "../x" }, { command: "approve" }, {}]) {
    assert.equal((await b.post("/api/owner", body)).status, 400);
  }
  const unknown = await b.do("/api/owner", { command: "approve", ref: "b-99" });
  assert.deepEqual(refundsOf(unknown), [], "approving a booking that is not waiting changes nothing");
  assert.ok(unknown.owner.messages.some((m: any) => /didn't understand/.test(m.text)));
});

test("the same tap three times at once is handled one at a time: one payment, one booking", async () => {
  const demo = await boot();
  const b = browser(demo);
  await b.do("/api/say", { text: BOOK });
  const replies = await Promise.all([b.post("/api/pay", { times: 1 }), b.post("/api/pay", { times: 1 }), b.post("/api/pay", { times: 1 })]);
  assert.ok(replies.every((r) => r.status === 200));
  const s = await b.state();
  assert.equal(linksOf(s)[0].paid.length, 1);
  assert.deepEqual(calendarOf(s).map((e) => e.status), ["confirmed"]);
  assert.deepEqual(refundsOf(s), []);
});

// ---- making it about this shop -----------------------------------------------------------------------------------------------

test("the shop form rebuilds the demo with the shop's own prices, for every device", async () => {
  const demo = await boot();
  const a = browser(demo);
  const state = await a.state();
  await a.do("/api/say", { text: BOOK });
  const form = structuredClone(state.form);
  form.name = "Shiva Salon";
  form.services = [
    { id: "", name: "gents cut", also: "haircut", price: "350", minutes: "30" },
    { id: "", name: "shave", also: "", price: "150", minutes: "20" },
    { id: "", name: "", also: "", price: "", minutes: "30" },
    { id: "", name: "", also: "", price: "", minutes: "30" },
  ];
  form.deposit = "100";
  form.opens = "09:00";
  form.closes = "19:00";
  const s = await a.do("/api/shop", { form });
  assert.equal(s.shop.name, "Shiva Salon");
  assert.deepEqual(s.shop.services.map((x: any) => [x.name, x.priceInr]), [["gents cut", 350], ["shave", 150]]);
  assert.equal(s.shop.depositInr, 100);
  assert.deepEqual(s.customer.messages, [], "a fresh world");
  const hello = await a.do("/api/say", { text: "hello" });
  const menu = customerSaid(hello)[0];
  assert.ok(menu.includes("Shiva Salon") && menu.includes("gents cut ₹350") && menu.includes("shave ₹150") && !menu.includes("₹450"), menu);
  const booked = await a.do("/api/say", { text: "I want a shave tomorrow at 6pm" });
  assert.equal(linksOf(booked)[0].amountInr, 100, "the link asks for the shop's own deposit");

  const owner = browser(demo); // a second device (the owner's phone) sees the same shop
  const theirs = await owner.state();
  assert.equal(theirs.shop.name, "Shiva Salon");
  assert.deepEqual(theirs.customer.messages, []);
});

test("a form with mistakes shows the settings check's plain words and keeps the old demo", async () => {
  const demo = await boot();
  const a = browser(demo);
  await a.do("/api/say", { text: BOOK });
  const form = structuredClone((await a.state()).form);
  form.services[0].price = "abc";
  form.deposit = "9000";
  form.services[1].price = "250";
  const bad = await a.post("/api/shop", { form });
  assert.equal(bad.status, 422);
  assert.ok(bad.json.errors.some((e: string) => /needs a price in whole rupees/.test(e)), bad.text);
  form.services[0].price = "450";
  const tooHigh = await a.post("/api/shop", { form });
  assert.equal(tooHigh.status, 422);
  assert.ok(tooHigh.json.errors.some((e: string) => /deposit \(₹9000\) is more than the cheapest service/.test(e)), tooHigh.text);
  const after = await a.state();
  assert.equal(after.shop.name, "Glow Salon");
  assert.equal(linksOf(after).length, 1, "the booking in progress is still there");
  assert.equal((await a.post("/api/shop", { form: null })).status, 422);
  const noOpen = await a.post("/api/shop", { form: { ...form, deposit: "200", days: [false, false, false, false, false, false, false] } });
  assert.ok(noOpen.json.errors.some((e: string) => /closed every day/.test(e)));
});

test("a shop name with digits or Hindi words works like any other", async () => {
  const demo = await boot();
  const a = browser(demo);
  const form = structuredClone((await a.state()).form);
  form.name = "Studio 24";
  form.language = "hi";
  form.services[0] = { id: "", name: "हेयरकट", also: "haircut", price: "300", minutes: "30" };
  form.deposit = "100";
  const s = await a.do("/api/shop", { form });
  assert.equal(s.ui.tabCustomer, "ग्राहक", "the screens follow the shop's language");
  const hello = await a.do("/api/say", { text: "नमस्ते" });
  assert.ok(customerSaid(hello)[0].includes("Studio 24") && customerSaid(hello)[0].includes("हेयरकट ₹300"), customerSaid(hello)[0]);
});

test("languages come from LANGUAGES, so a new language pack appears on its own", async () => {
  const demo = await boot();
  const s = await browser(demo).state();
  assert.deepEqual(s.languages.map((l: any) => l.code), [...LANGUAGES]);
  assert.deepEqual(languageOptions().map((l) => l.code), [...LANGUAGES]);
  for (const code of LANGUAGES) {
    const settings = applyLanguage(glowSalon(), code);
    assert.ok(settings.ok, `${code}: ${settings.ok ? "" : settings.errors.join(" ")}`);
    if (settings.ok) {
      assert.equal(settings.settings.languages[0], code);
      assert.equal(createDemo(settings.settings, NOW).chips().length >= 3, true);
    }
  }
  assert.equal(applyLanguage(glowSalon(), "xx").ok, false);
});

test("the demo can start in Hindi: screens, suggestions and replies", async () => {
  const settings = applyLanguage(glowSalon(), "hi");
  assert.ok(settings.ok);
  if (!settings.ok) return;
  const demo = await boot({ settings: settings.settings });
  const b = browser(demo);
  let s = await b.state();
  assert.equal(s.ui.banner, "डेमो · टेस्ट पैसा · कुछ भी असली नहीं भेजा जाता");
  assert.equal(s.customer.payLabel, "₹200 जमा करें (टेस्ट पैसा)");
  s = await b.do("/api/say", { text: s.customer.chips[0] });
  assert.equal(calendarOf(s)[0].status, "tentative", `the first suggestion books: ${s.customer.chips[0]}`);
  s = await b.do("/api/pay", { times: 1 });
  assert.equal(calendarOf(s)[0].status, "confirmed");
  assert.ok(s.owner.summary[0].text.includes("कैलेंडर"), "the owner's summary is in Hindi");
  assert.ok(customerSaid(s).some((t) => /बुक हो गया/.test(t)));
});

test("every suggestion does what it says, in both languages, even when tomorrow is a closed day", async () => {
  for (const language of ["en", "hi"]) {
    for (const closedDay of [undefined, "wed", "thu"] as const) {
      const base = applyLanguage(glowSalon(), language);
      assert.ok(base.ok);
      if (!base.ok) return;
      const raw = structuredClone(base.settings);
      if (closedDay) raw.openingHours[closedDay] = null;
      const settings = parseSettings(raw);
      const chips = chipsFor(settings, language, NOW).map((c) => c.text);
      const label = `${language}${closedDay ? ` with ${closedDay} closed` : ""}`;
      const book = createDemo(settings, NOW);
      await book.say(chips[0]);
      assert.ok(book.world.calendar.events().some((e) => e.status === "tentative"), `${label}: "${chips[0]}" holds a slot`);
      const haggle = createDemo(settings, NOW);
      await haggle.say(chips[1]);
      assert.ok(haggle.world.record.entries().some((e) => e.decisions.some((d) => d.ruleId === "price-at-or-above-list" && d.verdict === "block")), `${label}: "${chips[1]}" asks for a lower price`);
      assert.equal(haggle.world.payments.links()[0]?.amount, 20000, `${label}: the link is still for the deposit`);
      const loose = createDemo(settings, NOW);
      await loose.say(chips[2]);
      assert.equal(loose.world.calendar.events().length, 0, `${label}: "${chips[2]}" is read back, nothing held`);
      await loose.say(chips.at(-1)!);
      assert.equal(loose.world.calendar.events().filter((e) => e.status === "tentative").length, 1, `${label}: after "${chips.at(-1)}" it holds the slot`);
    }
  }
});

// ---- the page's own script, against the real server ----------------------------------------------------------------------

test("escaping: what people type is drawn as text, never as markup", async () => {
  const demo = await boot();
  const a = browser(demo);
  const evilShop = "<img src=x onerror=boom>";
  const evilMessage = "<script>window.pwned=1</script> haircut";
  const form = structuredClone((await a.state()).form);
  form.name = evilShop;
  await a.do("/api/shop", { form });
  await a.do("/api/say", { text: evilMessage });

  // The page holds none of it; the data comes as JSON strings.
  const page = await raw(demo, "GET", "/", { host: `127.0.0.1:${demo.port}` });
  assert.ok(!page.text.includes("boom") && !page.text.includes("pwned"));
  const stateReply = await raw(demo, "GET", "/api/state", { cookie: a.cookie });
  assert.match(String(stateReply.headers["content-type"]), /^application\/json/);
  assert.equal(stateReply.headers["x-content-type-options"], "nosniff");
  assert.equal(stateReply.json.shop.name, evilShop);
  assert.ok(stateReply.json.customer.messages.some((m: any) => m.text === evilMessage));

  // Run the page's real script against a tiny stand-in for the browser's page, talking to the real server.
  const created: string[] = [];
  const ids = new Map<string, FakeElement>();
  class FakeElement {
    tag: string; children: FakeElement[] = []; attrs: Record<string, string> = {}; own = ""; listeners: Record<string, Function[]> = {};
    hidden = false; disabled = false; value = ""; checked = false; selected = false; className = ""; type = ""; scrollTop = 0; scrollHeight = 0;
    constructor(tag: string) { this.tag = tag; created.push(tag); }
    set textContent(v: string) { this.own = String(v); this.children = []; }
    get textContent(): string { return this.own + this.children.map((c) => c.textContent).join(""); }
    get firstChild() { return this.children[0] ?? null; }
    set innerHTML(_v: string) { throw new Error("innerHTML was used"); }
    set outerHTML(_v: string) { throw new Error("outerHTML was used"); }
    insertAdjacentHTML() { throw new Error("insertAdjacentHTML was used"); }
    appendChild(c: FakeElement) { this.children.push(c); return c; }
    removeChild(c: FakeElement) { this.children = this.children.filter((x) => x !== c); return c; }
    setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
    addEventListener(type: string, fn: Function) { (this.listeners[type] ??= []).push(fn); }
    getElementsByTagName(tag: string): FakeElement[] { return this.children.flatMap((c) => [...(c.tag === tag ? [c] : []), ...c.getElementsByTagName(tag)]); }
    scrollIntoView() {}
    all(): FakeElement[] { return [this, ...this.children.flatMap((c) => c.all())]; }
  }
  for (const m of page.text.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)) ids.set(m[1], new FakeElement("div"));
  const document = {
    getElementById: (id: string) => ids.get(id) ?? (() => { throw new Error(`the page has no element ${id}`); })(),
    createElement: (tag: string) => new FakeElement(tag),
    createTextNode: (text: string) => { const e = new FakeElement("#text"); e.own = text; return e; },
    documentElement: new FakeElement("html"),
    body: new FakeElement("body"),
  };
  created.length = 0; // from here on, count only what the script makes
  const fetchLikeBrowser = async (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const r = await raw(demo, init.method ?? "GET", path, { cookie: a.cookie, host: `127.0.0.1:${demo.port}`, ...(init.headers ?? {}) }, init.body);
    return { ok: r.status < 300, json: async () => r.json };
  };
  const script = /<script nonce="[^"]+">\n([\s\S]*?)<\/script>/.exec(page.text)![1];
  vm.runInNewContext(script, { document, fetch: fetchLikeBrowser, window: { scrollTo() {} }, setTimeout: () => 0, clearTimeout: () => {} });
  for (let i = 0; i < 200 && ids.get("shopName")!.textContent === ""; i++) await new Promise((r) => setTimeout(r, 10));

  assert.equal(ids.get("shopName")!.textContent, evilShop, "the shop name is on the page as text");
  const chatText = ids.get("chat")!.all().map((e) => e.textContent).join("|");
  assert.ok(chatText.includes(evilMessage), "the customer's words are on the page as text");
  const allowed = new Set(["div", "span", "p", "time", "button", "ul", "li", "h2", "h3", "b", "label", "input", "select", "option", "#text"]);
  assert.deepEqual([...new Set(created)].filter((t) => !allowed.has(t)), [], "the script made no element a person could have typed (no img, script, iframe...)");
});

// ---- limits and safety ------------------------------------------------------------------------------------------------------

test("who may connect: only this computer and private networks, never the whole internet", async () => {
  for (const ok of ["127.0.0.1", "::1", "192.168.1.20", "10.4.5.6", "172.16.0.9", "172.31.255.1", "::ffff:192.168.0.7", "fe80::1", "fd12:3456::1", "169.254.1.1"]) assert.equal(isLocalNetworkAddress(ok), true, ok);
  for (const no of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "::ffff:8.8.8.8", "2001:4860:4860::8888", "", undefined]) assert.equal(isLocalNetworkAddress(no), false, String(no));
  assert.equal(isPrivateIPv4("192.168.0.1") && !isPrivateIPv4("11.0.0.1"), true);
  assert.ok(lanAddresses().every(isPrivateIPv4));

  const demo = await startDemo({ settings: glowSalon(), port: 0, nowMs: NOW }); // the default addresses
  running.push(demo);
  for (const server of demo.servers) {
    const address = (server.address() as { address: string }).address;
    assert.ok(address === "127.0.0.1" || isPrivateIPv4(address), `listening on ${address}`);
    assert.notEqual(address, "0.0.0.0");
    assert.notEqual(address, "::");
  }
});

test("a name that is not an address, a foreign page, the wrong type or a huge body is refused", async () => {
  const demo = await boot();
  const host = `127.0.0.1:${demo.port}`;
  const json = { "content-type": "application/json", host };
  const body = JSON.stringify({ text: "hello" });
  assert.equal((await raw(demo, "GET", "/api/state", { host: `evil.example:${demo.port}` })).status, 403, "a name a web page controls");
  assert.equal((await raw(demo, "POST", "/api/say", { ...json, origin: "http://evil.example" }, body)).status, 403, "another page");
  assert.equal((await raw(demo, "POST", "/api/say", { ...json, origin: `http://${host}` }, body)).status, 200, "this page");
  assert.equal((await raw(demo, "POST", "/api/say", { "content-type": "text/plain", host }, body)).status, 415);
  assert.equal((await raw(demo, "POST", "/api/say", json, "{not json")).status, 400);
  assert.equal((await raw(demo, "POST", "/api/say", json, "[1]")).status, 400);
  const big = await raw(demo, "POST", "/api/say", json, JSON.stringify({ text: "x".repeat(MAX_BODY_BYTES + 10) }));
  assert.equal(big.status, 413);
  assert.equal((await raw(demo, "POST", "/api/say", json, JSON.stringify({ text: "x".repeat(301) }))).status, 400, "a message that is too long");
  assert.equal((await raw(demo, "POST", "/api/say", json, JSON.stringify({ text: "   " }))).status, 400, "an empty message");
  assert.equal((await raw(demo, "POST", "/api/time", json, JSON.stringify({ minutes: 99999 }))).status, 400);
  assert.equal((await raw(demo, "POST", "/api/pay", json, JSON.stringify({ times: 50 }))).status, 400);
  assert.equal((await raw(demo, "GET", "/nothing", { host })).status, 404);
  assert.equal((await raw(demo, "DELETE", "/api/state", { host })).status, 405);
  assert.equal((await raw(demo, "GET", "/" + "a".repeat(2100), { host })).status, 414);
});

test("a device that asks too fast is slowed down", async () => {
  const demo = await boot({ ratePerSecond: 5 });
  const statuses: number[] = [];
  for (let i = 0; i < 60; i++) statuses.push((await raw(demo, "GET", "/api/state", { host: `127.0.0.1:${demo.port}` })).status);
  assert.equal(statuses[0], 200);
  assert.ok(statuses.includes(429), "some were turned away");
});

test("one world per browser: sessions are separate, cookies are private to the page, and Start again resets", async () => {
  const demo = await boot({ maxSessions: 2 });
  const a = browser(demo);
  const b = browser(demo);
  await a.do("/api/say", { text: BOOK });
  const first = await raw(demo, "GET", "/api/state", {});
  const cookie = String(first.headers["set-cookie"]);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  const theirs = await b.state();
  assert.deepEqual(theirs.customer.messages, [], "the other browser sees nothing of it");
  assert.deepEqual(linksOf(theirs), []);
  const forged = await raw(demo, "GET", "/api/state", { cookie: "geo_demo=not-a-real-session" });
  assert.deepEqual(forged.json.customer.messages, []);
  assert.ok(String(forged.headers["set-cookie"]).startsWith("geo_demo="), "an unknown id gets a fresh session, never the one it named");
  assert.ok(demo.sessionCount() <= 2, "the number of sessions is capped");

  const solo = await boot();
  const c = browser(solo);
  await c.do("/api/say", { text: BOOK });
  await c.do("/api/time", { minutes: 60 });
  const reset = await c.do("/api/reset");
  assert.deepEqual(reset.customer.messages, []);
  assert.deepEqual(calendarOf(reset), []);
  assert.deepEqual(linksOf(reset), []);
  assert.equal(reset.clock, "Tue 3 Nov, 10:00 am");
});

test("started without a chosen time, the clock is the morning of the real date, so every suggestion is still ahead", async () => {
  const demo = await startDemo({ settings: glowSalon(), hosts: ["127.0.0.1"], port: 0 });
  running.push(demo);
  const s = await browser(demo).state();
  assert.match(s.clock, /10:00 am$/);
});

test("the world in memory cannot grow for ever, and a port already in use is explained", async () => {
  const demo = createDemo(glowSalon(), NOW);
  let notice: string | undefined;
  for (let i = 0; i <= MAX_CUSTOMER_MESSAGES; i++) notice = await demo.say("hello");
  assert.equal(notice, demo.ui.demoFull, "after the limit it says to start again");
  assert.equal(demo.customerLog.filter((b) => b.who === "me").length, MAX_CUSTOMER_MESSAGES);

  const first = await boot();
  await assert.rejects(startDemo({ settings: glowSalon(), hosts: ["127.0.0.1"], port: first.port }), /already in use.*--port/);
});
