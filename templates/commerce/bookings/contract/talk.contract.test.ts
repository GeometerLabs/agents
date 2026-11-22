// The owner's talk on a Bookings shop, and the assistant's approved templates outside the 24-hour window, end to end (22 Nov 2026). Black-box like every file here: the shop is
// a separate process (TypeScript, or Go with BOOKINGS_IMPL=go), and the test sees only its HTTP answers, the Guards' calls, the fake model's requests and the record.
//   - An open question the rules cannot place goes to the talk model with the Bookings skill's own numbers (skill.ts `facts`), what customers may be told (`publicContext`),
//     and the declared limits the owner may tighten (by id, in the prompt and in the schema's enum); the reply reaches the owner, a proposed note waits for its Remember
//     button, and a model that fails gives the fixed line with today's count and what waits.
//   - "Open my app." from the owner's own WhatsApp number sends the sign-in link back in the window it opened, before the agent or the assistant reads it; from a customer it
//     is a customer's message like any other.
//   - A UPI shop with a report block sends the customer the QR picture of the payment request before the words, hosted in the report's pages folder (start.ts folderQrImages).
//   - A WhatsApp customer whose window has closed (their message is 25 hours old) whose day the owner closes gets the approved "day closed" template, its values in Meta's order, exactly as
//     the TypeScript's templateMessageFor makes them; the morning line to an owner whose window is closed goes as its approved template.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { write } from "../../../../modules/assistant/words.ts";
import { MORNING_TEMPLATE_OF, dayFacts, render, templateMessageFor, templateNameOf } from "../../../../modules/assistant/templates.ts";
import { META_LANGUAGE } from "../../../../modules/language/meta-templates.ts";
import { callName, rawReply } from "../../../../modules/test/contract/fake-model.ts";
import { CUSTOMER, MIN, OWNER_BASE, OWNER_NUMBER, TZ, contract, makeShop, openStart, sleep, startFakeModel } from "./harness.ts";
import type { FakeModel, Shop } from "./harness.ts";

const shops: Shop[] = [];
const closers: { close(): Promise<void> }[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } for (const c of closers) await c.close(); });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
const owner = (s: Shop, text: string) => s.inbound(OWNER_NUMBER, text);
const lastOwner = (s: Shop) => s.sent(OWNER_NUMBER).at(-1)!;
const part = (ms: number, t: string, o: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...o }).formatToParts(ms).find((x) => x.type === t)!.value;
/** "25 Nov", a date the owner can type. */
const typed = (ms: number): string => `${part(ms, "day", { day: "numeric" })} ${part(ms, "month", { month: "short" })}`;
const localDate = (ms: number) => ({ year: Number(part(ms, "year", { year: "numeric" })), month: Number(part(ms, "month", { month: "numeric" })), day: Number(part(ms, "day", { day: "numeric" })) });
const QUESTION = "any thoughts on getting more customers in";
const systemOf = (req: { body: any }): string => req.body.messages.find((m: { role: string }) => m.role === "system").content;

describe("the owner's open question on a Bookings shop", () => {
  contract("goes to the talk model with the skill's numbers, the settings and the declared limits; the reply reaches the owner and a proposed note waits for Remember", async () => {
    let reply: unknown = { sentences: [{ text: "Bookings in the next 7 days: 1.", sources: ["r:week"] }], ask_owner: null, note: { kind: "fact", text: "We close early on Fridays", audience: null }, limit: null };
    const talk: FakeModel = await startFakeModel((_u, body) => (callName(body) === "talk" ? reply : {})); closers.push(talk);
    const s = await boot({ mode: "guards", settings: { assistant: {} }, runtime: { talk: { wire: "openai", baseUrl: `http://127.0.0.1:${talk.port}/v1`, model: "fake-model", timeoutMs: 5000 } } });
    const start = openStart(s.now(), 3);
    await s.inbound(CUSTOMER, `haircut on ${typed(start)} at 11am`);
    await s.events(s.guards!.pay(s.guards!.standins.fakes.payments.links()[0].id).map((event) => ({ kind: "payment_event", event }))); await s.settle();
    await owner(s, QUESTION);
    const calls = talk.requests.filter((r) => callName(r.body) === "talk");
    assert.equal(calls.length, 1, "one talk call");
    const system = systemOf(calls[0]);
    // the Bookings skill's own numbers (counts only, never a customer), then what customers may be told
    assert.match(system, /\n\[r:today\] Bookings today: 0\.\n\[r:week\] Bookings in the last 7 days: 0\. In the next 7 days: 1\.\n\[r:weekdays\] Bookings by weekday over the last 28 days: Sun 0, /u);
    assert.match(system, /\n\[r:top\] Top services over the last 28 days: haircut 1\.\n\[r:cancelled\] Cancelled bookings over the last 28 days: 0\. Waiting for the owner now: 0\.\n\[s:shop\] Glow Salon/u);
    assert.match(system, /\n\[s:svc:haircut\] [^\n:]+: ₹450, 45 minutes\./u, "the services, named in the shop's first language (publicContext with no customer)");
    assert.ok(!system.includes(CUSTOMER), "no customer's number in the owner's prompt");
    // the declared limits, by id, in the prompt and as the schema's only allowed values
    assert.match(system, /If the owner asks to make one of these limits stricter, set "limit" to its id, never to a value, and say nothing about the new value: [a-z_]+ \([^)]+\)/u);
    const limit = calls[0].body.response_format.json_schema.schema.properties.limit;
    assert.ok(Array.isArray(limit.anyOf?.[0]?.enum) && limit.anyOf[0].enum.length >= 1 && limit.anyOf[0].enum.every((id: string) => system.includes(`${id} (`)), JSON.stringify(limit));
    // the reply, then the proposed note with its two buttons; nothing is saved before the tap
    const sent = s.sent(OWNER_NUMBER);
    assert.equal(sent.at(-2)!.text, "Bookings in the next 7 days: 1.");
    const proposal = sent.at(-1)!;
    assert.equal(proposal.text, write("note_proposal", { text: "We close early on Fridays", audience: "owner" }, "en", TZ).text);
    assert.deepEqual(proposal.interactive.buttons.map((b: { id: string; title: string }) => [b.id, b.title]), [["note-yes:p-1", "Remember"], ["note-no:p-1", "No"]]);
    assert.equal(s.record().filter((r) => r.action === "memory").length, 0, "nothing saved before the tap");
    await s.tap("note-yes:p-1", { from: OWNER_NUMBER });
    assert.equal(lastOwner(s).text, write("note_saved", { id: "n-2", text: "We close early on Fridays", audience: "owner", undoable: false }, "en", TZ).text);
    assert.deepEqual(s.record().filter((r) => r.action === "memory").map((r) => [r.outcome, r.refs.note, r.refs.change]), [["confirmed", "n-2", "added"]]);
    // a model that fails: the fixed line, with today's count and what waits
    reply = rawReply("this is not JSON");
    await owner(s, "and what about the weekends then");
    assert.equal(lastOwner(s).text, write("talk_fallback", { waiting: 0, today: 0 }, "en", TZ).text);
  });
});

describe("the assistant's templates outside the 24-hour window", () => {
  contract("a WhatsApp customer whose window has closed gets the approved day-closed template when the owner closes their day, its values in Meta's order, as the TypeScript makes them", async () => {
    const s = await boot({ mode: "guards", settings: { assistant: {} } });
    const start = openStart(s.now(), 3);
    // the customer's message is 25 hours old: the shop's window store keeps when they last wrote, so their 24-hour window is closed and only a template may reach them
    await s.inbound(CUSTOMER, `haircut on ${typed(start)} at 11am`, { extra: { timestamp: s.now() - 25 * 60 * MIN } });
    await s.events(s.guards!.pay(s.guards!.standins.fakes.payments.links()[0].id).map((event) => ({ kind: "payment_event", event }))); await s.settle();
    await owner(s, `close ${typed(start)}`);
    const toCustomer = s.guards!.of("messaging", "POST").filter((c) => c.body.to === CUSTOMER);
    assert.ok(toCustomer.length >= 1, "the customer was told");
    const last = toCustomer.at(-1)!.body;
    assert.equal(last.type, "template", "a closed window takes only an approved template");
    const facts = dayFacts({ language: "en", timeZone: TZ, shop: "Glow Salon", date: localDate(start), startMs: start });
    const want = templateMessageFor("day_closed", facts, render("day_closed", facts));
    assert.equal(want.name, templateNameOf("day_closed"));
    assert.equal(last.template.name, want.name);
    assert.equal(last.template.language.code, META_LANGUAGE.en);
    const values = last.template.components.filter((c: { type: string }) => c.type === "body").flatMap((c: { parameters: { text: string }[] }) => c.parameters.map((p) => p.text));
    assert.deepEqual(values, want.parameters);
    const told = s.record().filter((r) => r.action === "send_message" && r.refs.to === "customer" && String(r.refs.templates).includes("assistant_day_closed")).map((r) => r.outcome);
    assert.ok(told.length === 1 && ["confirmed", "unconfirmed"].includes(told[0]), JSON.stringify(told));
  });

  // What is not asserted here: that the provider takes it. The morning templates were made with an image header (templates.ts, item 11i), and a shop with no mood pictures in
  // pages.json (this harness; every Go shop, whose morning line has no picture yet: internal/runtime/Deferred.md) sends it without one, which Meta refuses (132012) on BOTH
  // runtimes: the record then ends the try "failed" and it is tried again in an hour. Found 22 Nov 2026 (go/TRIAL.md, stream A).
  contract("the morning line to an owner who has not written goes as its approved template, by its name with the shop's name first, and not twice", async () => {
    const india = new Date(Date.now() + 330 * MIN);
    const at = `${String(india.getUTCHours()).padStart(2, "0")}:${String(Math.max(0, india.getUTCMinutes() - 1)).padStart(2, "0")}`;
    const s = await boot({ mode: "guards", tickSeconds: 1, settings: { assistant: { morning: { at } }, payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } }, calendar: { module: "own" } } });
    await s.book();                                       // a deposit waiting for the owner's mark: there is something to say
    const morning = () => s.guards!.of("messaging", "POST").filter((c) => c.body.to === OWNER_NUMBER && c.body.template?.name === templateNameOf(MORNING_TEMPLATE_OF.warm));
    for (let i = 0; i < 40 && morning().length === 0; i++) await sleep(250);
    const toOwner = () => s.guards!.of("messaging", "POST").filter((c) => c.body.to === OWNER_NUMBER).map((c) => [c.body.type, c.body.template?.name, c.status]);
    assert.equal(morning().length, 1, `the morning template went: ${JSON.stringify({ toOwner: toOwner(), lines: s.record().filter((r) => r.action === "send_message").map((r) => [r.outcome, r.refs.morning, r.refs.templates, r.notes.slice(0, 160)]) })}`);
    const body = morning()[0].body;
    assert.equal(body.template.language.code, META_LANGUAGE.en);
    const values = body.template.components.filter((c: { type: string }) => c.type === "body").flatMap((c: { parameters: { text: string }[] }) => c.parameters.map((p) => p.text));
    assert.equal(values[0], "Glow Salon", "the shop's name first, as the template's order has it");
    await sleep(3000);
    assert.equal(morning().length, 1, "not again the same day");
    // the claim first, then one ending, never a plain text to an owner whose window is closed
    const lines = s.record().filter((r) => r.action === "send_message" && r.refs.morning !== undefined).map((r) => r.outcome);
    assert.deepEqual(lines.slice(0, 1), ["attempted"], JSON.stringify(lines));
    assert.equal(lines.length, 2, JSON.stringify(lines));
    assert.ok(!s.guards!.of("messaging", "POST").some((c) => c.body.to === OWNER_NUMBER && c.body.type === "text"), "no plain text to the owner");
  });
});

describe("the owner's \"open my app\" on WhatsApp", () => {
  contract("from the owner's number the sign-in link comes back at once, in their language's words, and the assistant never reads it; from a customer it is nothing of the kind", async () => {
    const s = await boot({ mode: "guards", settings: { assistant: {} } });
    await owner(s, "Open my app.");
    const link = new RegExp(`${OWNER_BASE.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/in/([A-Za-z0-9_-]{20,})`, "u").exec(lastOwner(s).text);
    assert.ok(link, `the link is in the answer: ${lastOwner(s).text}`);
    const lines = s.record().filter((r) => r.action === "owner_signin");
    assert.deepEqual(lines.map((r) => [r.outcome, r.refs.via, r.refs.to]), [["confirmed", "whatsapp", "owner"]]);
    assert.ok(!s.record().some((r) => r.action === "owner_assistant"), "the assistant did not read it");
    assert.ok(!JSON.stringify(s.record()).includes(link![1]), "no token in the record");
    await s.inbound(CUSTOMER, "open my app");
    assert.equal(s.record().filter((r) => r.action === "owner_signin").length, 1, "a customer's words ask for no link");
  });
});

describe("a UPI shop's QR picture", () => {
  contract("with a report block, the customer gets the request's QR picture before the words, from the report's pages folder; the same picture again for the same request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bookings-qr-"));
    closers.push({ close: async () => rmSync(dir, { recursive: true, force: true }) });
    const s = await boot({ mode: "guards", settings: { payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } }, calendar: { module: "own" } }, runtime: { report: { preparedBy: "Divya, local Operator", innovator: false, pageBaseUrl: "https://reports.example/r", pagesDir: dir, source: "test-mode" } } });
    const start = openStart(s.now(), 3);
    await s.inbound(CUSTOMER, `haircut on ${typed(start)} at 11am`);
    const bodies = s.guards!.of("messaging", "POST").filter((c) => c.body.to === CUSTOMER).map((c) => c.body);
    const at = bodies.findIndex((b) => b.type === "image");
    assert.ok(at >= 0, `a picture went: ${JSON.stringify(bodies.map((b) => b.type))}`);
    const link: string = bodies[at].image.link;
    const found = /^https:\/\/reports\.example\/r\/([0-9a-f]{32})\/upi-qr\.png$/u.exec(link);
    assert.ok(found, link);
    const png = join(dir, found![1], "upi-qr.png");
    assert.ok(existsSync(png), "the picture is in the pages folder");
    assert.deepEqual([...readFileSync(png).subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "a PNG");
    assert.ok(bodies.slice(at + 1).some((b) => b.type === "text" || b.type === "interactive"), "the words after it");
    await s.inbound(CUSTOMER, `haircut on ${typed(start)} at 11am`);
    const again = s.guards!.of("messaging", "POST").filter((c) => c.body.to === CUSTOMER && c.body.type === "image").map((c) => c.body.image.link);
    assert.ok(again.every((l: string) => l === link), "the request's one picture, made once");
  });
});
