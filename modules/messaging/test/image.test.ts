// Pictures out (a UPI QR code, B33): the fake, the Cloud API body, the stand-in, the outgoing check of a upi:// link, and `say` sending the picture before the words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../core/clock.ts";
import { ApiError, WindowClosedError } from "../../core/faults.ts";
import { checkText } from "../../language/check.ts";
import type { CheckFacts } from "../../language/check.ts";
import { allow, block } from "../../limits/limits.ts";
import { createFakeMessaging } from "../messaging.ts";
import { createSay } from "../say.ts";
import { imageBody } from "../whatsapp.ts";
import { whatsappStandin } from "../../standins/whatsapp.ts";

const LINK = "upi://pay?pa=glowsalon@okicici&pn=Glow%20Salon&am=200.00&tn=b-1&cu=INR";

test("the fake takes a picture by its https address inside the window only, and the Cloud API body is Meta's", async () => {
  const m = createFakeMessaging(fakeClock(0));
  await assert.rejects(m.sendImage("+919811111111", { link: "https://x.example/q.png", caption: "Scan" }), WindowClosedError);
  m.receive("+919811111111", "hi");
  await assert.rejects(m.sendImage("+919811111111", { link: "http://x.example/q.png" }), ApiError);
  const sent = await m.sendImage("+919811111111", { link: "https://x.example/q.png", caption: "Scan" });
  assert.equal(sent.kind, "image");
  assert.deepEqual(sent.image, { link: "https://x.example/q.png", caption: "Scan" });
  assert.deepEqual(imageBody("+919811111111", { link: "https://x.example/q.png", caption: "Scan" }), { messaging_product: "whatsapp", recipient_type: "individual", to: "+919811111111", type: "image", image: { link: "https://x.example/q.png", caption: "Scan" } });
  const standin = whatsappStandin(m, { templates: [] });
  const reply = await standin({ method: "POST", path: "/v26.0/100000000000001/messages", query: new URLSearchParams(), headers: {}, body: imageBody("+919811111111", { link: "https://x.example/2.png" }) });
  assert.equal(reply?.status, 200);
  assert.equal(m.outbox().at(-1)?.image?.link, "https://x.example/2.png");
  assert.equal(m.receive("+919811111111", "", { image: true }).image, true, "a picture coming in is only the fact of it");
});

test("the outgoing check: a upi:// link must be the record's own, whole; its UPI ID and amount are not read on their own", () => {
  const facts: CheckFacts = { language: "en", timeZone: "Asia/Kolkata", amountsInr: [200], counts: [], momentsMs: [], links: [LINK], literals: ["glowsalon@okicici"] };
  assert.deepEqual(checkText(`Pay ₹200 to glowsalon@okicici: ${LINK}.`, facts), { ok: true, problems: [] });
  const other = LINK.replace("200.00", "20.00");
  const r = checkText(`Pay ₹200: ${other}`, facts);
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /UPI link .* not the payment request in the record/);
  assert.equal(checkText(`Pay ₹200: ${LINK.replace("glowsalon", "evil")}`, facts).ok, false);
});

test("say: the picture goes first with a checked caption, then the words; outside the window, or with a caption that fails the check, the words go alone", async () => {
  const clock = fakeClock(0);
  const m = createFakeMessaging(clock);
  const entries: { action: string; outcome: string; refs?: Record<string, string> }[] = [];
  const words: Record<string, (f: { language: "en"; amount: number }) => string> = { pay: (f) => `Pay ₹${f.amount} by UPI: ${LINK}`, caption: (f) => `Scan to pay ₹${f.amount}` };
  const say = createSay<{ booking: null; phone: string; to: "customer" | "owner"; templates: string[]; image?: { link: string; caption: string[] }; amount: number }, { language: "en"; amount: number }>({
    messaging: m,
    voice: { render: (id, f) => words[id](f), templateMessage: (a) => ({ name: "x", language: "en", text: a.text }), genericNames: { customer: "c", reminder: "r", owner: "o" }, matches: (text, f) => (text.includes(`₹${f.amount}`) && !text.includes("₹999") ? allow("message-matches-record", "ok") : block("message-matches-record", "no")) },
    owner: { whatsapp: "+919000000000", language: "en" },
    languageOf: () => "en", optedOut: () => false,
    factsFor: (a) => ({ language: "en", amount: a.amount }),
    log: (_b, _p, action, outcome, _i, more) => { entries.push({ action, outcome, refs: more.refs }); },
    heldBack: async () => undefined,
  });
  m.receive("+919811111111", "hi");
  assert.equal(await say({ booking: null, phone: "+919811111111", to: "customer", templates: ["pay"], image: { link: "https://qr.stand-in/1.png", caption: ["caption"] }, amount: 200 }), true);
  assert.deepEqual(m.outbox().map((x) => [x.kind, x.text]), [["image", "Scan to pay ₹200"], ["text", `Pay ₹200 by UPI: ${LINK}`]]);
  assert.equal(entries[0].refs?.image, "qr");
  clock.advanceMinutes(25 * 60);
  m.approve("x", "en");
  await say({ booking: null, phone: "+919811111111", to: "customer", templates: ["pay"], image: { link: "https://qr.stand-in/2.png", caption: ["caption"] }, amount: 200 });
  assert.deepEqual(m.outbox().slice(2).map((x) => x.kind), ["template"], "outside the window: no picture, the words as a template");
});
