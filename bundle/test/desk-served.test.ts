// B71 part 2: the owner-marked desk served on a server, so an agent someone else wrote can take UPI live. The agent reaches the desk only through its desk Guard
// (its address, its credential, the deposit and refund bounds); the desk runs in the relay's container with the owner's replies from the inbox, its notices through
// the relay's WhatsApp principal, and its ledger in one file that a restart keeps. What the owner marks is recorded as the owner's statement, never as a provider's
// confirmation (B74), and the report labels it so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addAgent, connectionText, deployAgent } from "../agent/deploy.ts";
import { readAgent } from "../agent/folder.ts";
import type { AgentFlags } from "../agent/folder.ts";
import { RECORD_READS, agentNames, planAgent } from "../agent/plan.ts";
import { emptyRecord, foldFacts } from "../agent/record.ts";
import type { Facts } from "../agent/facts.ts";
import { DESK_PORT, DESK_SECRET } from "../generate/guards.ts";
import { createDeskHost, deskServer } from "../services/desk.ts";
import type { DeskHost } from "../services/desk.ts";
import { relayHandler } from "../../modules/approvals/server.ts";
import { fakeClock } from "../../modules/core/clock.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";
import type { Messaging, OutboundMessage } from "../../modules/messaging/messaging.ts";
import { markObligations } from "../../modules/payments/owner-marked/obligations.ts";
import { buildMonthlyReport } from "../../templates/commerce/bookings/report/data.ts";
import { monthRange } from "../../modules/report/months.ts";
import { PHONE_NUMBER_ID, serverConfig, tempServer } from "./helpers.ts";
import { read, secretsFor, world } from "./world.ts";
import { credential, skipWithoutBinary, startRealGuard } from "./real-guard.ts";
import { STANDIN_PROVIDER_AUTHORIZATION } from "../agent/guard-process.ts";

const NOW = new Date("2026-11-11T09:00:00Z");
const NAME = "upi-agent";
const OWNER = "+919800000001";
const CUSTOMER = "+919811111111";
const noFiles = (path: string): string => { throw new Error(`no file ${path}`); };
const flags = (change: AgentFlags = {}): AgentFlags => ({ upstreams: "upi,whatsapp", "owner-whatsapp": OWNER, deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "upi-id": "glowsalon@okicici", payee: "Glow Salon", ...change });

// ---- the deploy ------------------------------------------------------------------------------------------------------------------------------------------------

test("B71 part 2: an agent on UPI deploys a desk Guard in front of the desk: its address, its spec, the desk's own token and the relay's entry", async () => {
  const w = world({}); try {
    addAgent(w.root, NAME, flags(), noFiles, NOW);
    const { whatsapp_token, whatsapp_app_secret, whatsapp_verify_token } = secretsFor(NAME);
    w.handIn(NAME, { whatsapp_token, whatsapp_app_secret, whatsapp_verify_token });
    const r = await deployAgent(w.ctx, NAME);
    assert.equal(r.connection.baseUrls.upi, `https://shops.example.com/g/${NAME}/upi`, "the agent's UPI address is its desk Guard");
    const caddy = read(join(w.paths.generated, "Caddyfile"));
    assert.match(caddy, new RegExp(`handle_path /g/${NAME}/upi/\\* \\{\\n\\t\\treverse_proxy g-${NAME}-upi:8080`, "u"));
    // the desk Guard's spec: the deposit and nothing else, a refund owed never more than one deposit, the day's caps, and no hold
    const spec = JSON.parse(read(join(w.paths.generated, "guards", `g-${NAME}-upi`, "spec.json")));
    assert.equal(spec.tool, "owner-marked-desk");
    assert.deepEqual(spec.rules.map((x: { id: string; min?: string; max?: string }) => [x.id, x.min, x.max]), [["deposit-amount", "20000", "20000"], ["refund-at-most-deposit", "1", "20000"]]);
    assert.ok(!spec.rules.some((x: { kind: string }) => x.kind === "call_bound_approval"), "no hold: the owner sends every UPI refund themselves");
    const toml = read(join(w.paths.generated, "guards", `g-${NAME}-upi`, "guard.toml"));
    assert.match(toml, new RegExp(`^upstream = "relay:${DESK_PORT}"$`, "mu"));
    assert.doesNotMatch(toml, /\[upstream_tls\]/u, "plain HTTP on the server's own network");
    assert.doesNotMatch(toml, /\[\[approvers\]\]/u);
    assert.match(toml, new RegExp(`id = "record-${NAME}"[\\s\\S]*operations = \\["list_links", "list_refunds"\\]`, "u"), "the reading agent reads the desk's lists and changes nothing");
    // the desk's token: in the relay's folder, and as a whole header in the Guard's; in no generated file
    const token = read(join(w.paths.secrets, "relay", NAME, "desk_token")).trim();
    assert.match(token, /^gg_[0-9a-f]{32}$/u);
    assert.equal(read(join(w.paths.secrets, `g-${NAME}-upi`, DESK_SECRET)).trim(), `Bearer ${token}`);
    for (const f of ["compose.yaml", "Caddyfile", join("relay", "relay.json"), join("guards", `g-${NAME}-upi`, "guard.toml")]) assert.ok(!read(join(w.paths.generated, f)).includes(token), `${f} holds no token`);
    // the relay keeps the desk (and asks about nothing: no Guard admin to read), on its own port; the inbox gives it the owner's replies
    const relay = JSON.parse(read(join(w.paths.generated, "relay", "relay.json"))).shops[NAME];
    assert.deepEqual(relay.desk, { payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } } });
    assert.equal(relay.guardAdminUrl, undefined);
    assert.equal(JSON.parse(read(join(w.paths.generated, "inbox", "inbox.json"))).shops[NAME].relayUrl, `http://relay:8795/c/${NAME}`);
    assert.match(read(join(w.paths.generated, "compose.yaml")), new RegExp(`DESK_PORT: "${DESK_PORT}"`, "u"));
    const text = connectionText(NAME, r.connection);
    assert.match(text, /UPI desk +https:\/\/shops\.example\.com\/g\/upi-agent\/upi/u);
    assert.doesNotMatch(text, /not served/u);
  } finally { w.done(); }
});

// ---- the desk on the server ------------------------------------------------------------------------------------------------------------------------------------

/** A WhatsApp that keeps every text it was handed, with the template's name when it went as one. The owner's window is open for 24 hours after they wrote, by `now`. */
function recordingWhatsApp(now: () => number = Date.now) {
  const sent: { text: string; template?: string; buttons?: string[] }[] = [];
  const make = (window: { lastInboundAt(phone: string): number | undefined }): Messaging => {
    const out = (to: string, text: string, kind: OutboundMessage["kind"]): OutboundMessage => ({ id: `m${sent.length}`, to, kind, text, sentAt: 0, afterOptOut: false });
    return {
      async sendText(to, text) { sent.push({ text }); return out(to, text, "text"); },
      async sendTemplate(to, t) { sent.push({ text: t.text, template: t.name }); return out(to, t.text, "template"); },
      async sendInteractive(to, m) { sent.push({ text: m.body, buttons: (m.buttons ?? []).map((b) => b.id) }); return out(to, m.body, "interactive"); },
      async isWindowOpen(to) { const last = window.lastInboundAt(to); return last !== undefined && now() - last < 24 * 3_600_000; },
      async getMessage() { return null; },
    };
  };
  return { make, sent };
}

function hostIn(dir: string, wa: ReturnType<typeof recordingWhatsApp>, language: Language = "en", lines: string[] = [], clock = fakeClock(Date.now())): DeskHost {
  return createDeskHost({
    name: NAME, config: { payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } } }, ownerWhatsapp: OWNER,
    business: { name: "Glow Salon", timeZone: "Asia/Kolkata", ownerLanguage: language }, file: join(dir, "desk.json"), messaging: wa.make, clock, log: (l) => lines.push(l),
  });
}

const listen = (handler: Parameters<typeof createServer>[1]) => new Promise<{ url: string; close(): Promise<void> }>((resolve) => {
  const s = createServer(handler);
  s.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, close: () => new Promise<void>((done) => { s.closeAllConnections(); s.close(() => done()); }) }));
});

test("B71 part 2: the desk on a server takes calls only with its token, takes the owner's tapped Received through the relay's intake, counts a redelivery once, and a restart keeps everything", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-desk-"));
  const wa = recordingWhatsApp();
  let host = hostIn(dir, wa);
  const desk = await listen(deskServer([{ host: { handle: (...a) => host.handle(...a), receive: (m) => host.receive(m), tick: () => host.tick(), idle: () => host.idle(), status: () => host.status() }, token: () => "gg_desk_token" }]));
  const intake = await listen((req, res) => relayHandler(host, "relay-token-0123456789")(req, res));
  const call = async (method: string, path: string, body?: unknown, token = "gg_desk_token") => {
    const r = await fetch(`${desk.url}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json() as any };
  };
  const owner = (messages: unknown[]) => fetch(`${intake.url}/internal/owner-messages`, { method: "POST", headers: { authorization: "Bearer relay-token-0123456789", "content-type": "application/json" }, body: JSON.stringify({ messages }) }).then(async (r) => ({ status: r.status, body: await r.json() as any }));
  try {
    assert.equal((await call("POST", "/requests", { reference: "b-1", amount_paise: 20000, customer: CUSTOMER }, "gg_wrong")).status, 401, "only the desk Guard's token");
    const made = await call("POST", "/requests", { reference: "b-1", amount_paise: 20000, customer: CUSTOMER, service: "haircut", slot_ms: Date.UTC(2026, 10, 13, 12, 30) });
    assert.equal(made.status, 200);
    assert.match(made.body.pay_url, /^upi:\/\/pay\?/u);
    assert.equal(made.body.paid, false);
    await host.idle();
    assert.equal(wa.sent.length, 1, "the owner was told to expect it");
    assert.equal(wa.sent[0].template, "owner_upi_check", "outside the owner's window, as its approved template");
    const code = JSON.parse(readFileSync(join(dir, "desk.json"), "utf8")).marks.requests[0].code as string;
    // the owner taps Received: the button's id (it carries the code) survives the relay's intake
    const tapped = { id: "wamid.tap-1", from: OWNER, text: "Received ₹200", timestamp: Date.now(), reply: { id: `upi-received:${code}` } };
    assert.deepEqual((await owner([tapped])).body, { saved: 1, duplicates: 0 });
    await host.idle();
    const after = await call("GET", "/requests?reference=b-1");
    assert.equal(after.body.requests[0].paid, true);
    assert.deepEqual(after.body.requests[0].payments.map((p: any) => [p.amount_paise, p.marked_by, typeof p.marked_at_ms]), [[20000, "owner", "number"]], "the owner's mark, with who made it and when");
    const told = wa.sent.length;
    // the provider sends the same webhook again: counted once, and the owner is not told "already marked"
    assert.deepEqual((await owner([tapped])).body, { saved: 0, duplicates: 1 });
    await host.idle();
    assert.equal(wa.sent.length, told);
    // a refund owed, and the owner's "refunded <code>" in words
    const owed = await call("POST", "/refunds", { payment_id: after.body.requests[0].payments[0].id, amount_paise: 20000, why: "cancelled" });
    assert.equal(owed.status, 200);
    assert.equal(owed.body.sent, false);
    assert.equal((await call("POST", "/refunds", { payment_id: after.body.requests[0].payments[0].id, amount_paise: 100, why: "again" })).status, 409, "never more than was marked");
    await host.idle();
    const refundCode = JSON.parse(readFileSync(join(dir, "desk.json"), "utf8")).marks.refunds[0].code as string;
    await owner([{ id: "wamid.2", from: OWNER, text: `refunded ${refundCode}`, timestamp: Date.now() }]);
    await host.idle();
    // a restart: a new host reads the same file
    host = hostIn(dir, wa);
    const kept = await call("GET", "/refunds");
    assert.deepEqual(kept.body.refunds.map((x: any) => [x.state, x.sent, x.reference, typeof x.settled_at_ms]), [["done", true, "b-1", "number"]]);
    assert.equal((await call("GET", "/requests")).body.requests[0].paid, true);
    // a stranger's "received <code>" marks nothing
    assert.deepEqual((await owner([{ id: "wamid.3", from: "+919899999999", text: `received ${code}`, timestamp: Date.now() }])).body, { saved: 0, duplicates: 0 });
  } finally { await desk.close(); await intake.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("B71 part 2: every notice the desk sends the owner is worded and passes its check in all four languages, the claim with no service or slot included", async () => {
  for (const language of LANGUAGES) {
    const dir = mkdtempSync(join(tmpdir(), "geo-desk-lang-"));
    const wa = recordingWhatsApp(); const lines: string[] = [];
    const host = hostIn(dir, wa, language, lines);
    try {
      // the owner has written today, so the notices go as text with their buttons (the window is open)
      host.receive([{ id: "wamid.hi", from: OWNER, text: "hello", timestamp: Date.now() }]);
      await host.idle();
      const a = await host.handle("POST", "/requests", new URLSearchParams(), { reference: "b-1", amount_paise: 20000, customer: CUSTOMER, service: "haircut", slot_ms: Date.UTC(2026, 10, 13, 12, 30) });
      const b = await host.handle("POST", "/requests", new URLSearchParams(), { reference: "b-2", amount_paise: 20000, customer: CUSTOMER });
      await host.handle("POST", `/requests/${(b.body as any).id}/claim`, new URLSearchParams(), { via: "screenshot" });
      const file = () => JSON.parse(readFileSync(join(dir, "desk.json"), "utf8")).marks;
      host.receive([{ id: "wamid.part", from: OWNER, text: `received ${file().requests[0].code} 150`, timestamp: Date.now() }]); // part of it
      await host.idle();
      host.receive([{ id: "wamid.rest", from: OWNER, text: `received ${file().requests[0].code}`, timestamp: Date.now() }]); // the rest
      await host.idle();
      await host.handle("POST", `/requests/${(b.body as any).id}/close`, new URLSearchParams(), undefined);
      host.receive([{ id: "wamid.late", from: OWNER, text: `received ${file().requests[1].code}`, timestamp: Date.now() }]); // after the close
      await host.idle();
      host.receive([{ id: "wamid.again", from: OWNER, text: `received ${file().requests[1].usedCodes[0]}`, timestamp: Date.now() }]); // the same code again
      host.receive([{ id: "wamid.unknown", from: OWNER, text: "received ZZZZZZ", timestamp: Date.now() }]);
      await host.idle();
      const pay = file().requests[0].marks[0].id as string;
      await host.handle("POST", "/refunds", new URLSearchParams(), { payment_id: pay, amount_paise: 15000, why: "cancelled" });
      host.receive([{ id: "wamid.ref", from: OWNER, text: `refunded ${file().refunds[0].code}`, timestamp: Date.now() }]);
      await host.idle();
      assert.deepEqual(lines.filter((l) => /could not be worded|did not match|not sent/u.test(l)), [], `${language}: every notice was worded, checked and sent`);
      assert.ok(wa.sent.length >= 8, `${language}: ${wa.sent.length} notices`);
      assert.ok((a.body as any).pay_url);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("B71 part 2: outside the owner's 24-hour window the desk's own notices go as their approved templates, in all four languages: what to expect, a claim, a refund to send and its reminder", async () => {
  const HOUR = 3_600_000;
  for (const language of LANGUAGES) {
    const dir = mkdtempSync(join(tmpdir(), "geo-desk-closed-"));
    const clock = fakeClock(Date.UTC(2026, 10, 11, 4, 0));
    const wa = recordingWhatsApp(() => clock.now()); const lines: string[] = [];
    const host = hostIn(dir, wa, language, lines, clock);
    const q = new URLSearchParams();
    try {
      const a = (await host.handle("POST", "/requests", q, { reference: "b-1", amount_paise: 20000, customer: CUSTOMER, service: "haircut", slot_ms: Date.UTC(2026, 10, 13, 12, 30) })).body as any;
      const b = (await host.handle("POST", "/requests", q, { reference: "b-2", amount_paise: 20000, customer: CUSTOMER })).body as any;
      await host.handle("POST", `/requests/${b.id}/claim`, q, { via: "words" });
      const code = JSON.parse(readFileSync(join(dir, "desk.json"), "utf8")).marks.requests[0].code as string;
      host.receive([{ id: "wamid.mark", from: OWNER, text: `received ${code}`, timestamp: clock.now() }]);
      await host.idle();
      clock.advance(25 * HOUR); // the owner's window has closed
      const paid = (await host.handle("GET", `/requests/${a.id}`, q, undefined)).body as any;
      await host.handle("POST", "/refunds", q, { payment_id: paid.payments[0].id, amount_paise: 20000, why: "cancelled" });
      clock.advance(25 * HOUR);
      await host.tick(); // the first reminder of the refund still owed
      const templates = wa.sent.filter((m) => m.template).map((m) => m.template);
      assert.deepEqual(templates, ["owner_upi_check", "owner_upi_customer_says_paid", "owner_upi_refund_to_send", "owner_upi_refund_reminder"], `${language}: each as its own template, never the generic one`);
      assert.deepEqual(lines.filter((l) => /could not be worded|did not match|not sent/u.test(l)), [], language);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

// ---- the record (B74: the owner's statement, never a provider's confirmation) ----------------------------------------------------------------------------------

test("B71 part 2 and B74: the own agent's record keeps the owner's UPI mark as the owner's statement, never as a payment service's confirmation, and the report says so", () => {
  const t = tempServer({});
  try {
    addAgent(t.root, NAME, flags(), noFiles, NOW);
    const settings = readAgent(t.root, NAME).settings!;
    const at = Date.UTC(2026, 10, 11, 9, 0);
    const typed = (v: string | number) => (typeof v === "number" ? ["int", String(v)] : ["str", v]);
    const decision = (id: string, operation: string, args: Record<string, string | number>, atMs: number) => ({ id, at_ms: String(atMs), operation, outcome: "allow" as const, dispatched: true, prevented: false, principal: { workload: agentNames.agentId(NAME) }, arguments: Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typed(v)])), call: `c-${id}`, evaluations: [], reasons: ["the provider answered 200"] });
    const facts: Facts = {
      at: new Date(at + 3_600_000).toISOString(), problems: [],
      guards: { upi: { decisions: [decision("d1", "create_link", { reference: "b-1", amount_paise: 20000, customer: CUSTOMER }, at), decision("d2", "claim", { id: "upi-1", via: "screenshot" }, at + 60_000), decision("d3", "refund", { payment_id: "upi-pay-2", amount_paise: 20000 }, at + 300_000)], intents: [], approvals: [], counts: {}, windowFull: false } },
      service: {
        links: {}, refunds: {}, events: null, eventsById: {},
        desk: {
          requests: [{ id: "upi-1", reference: "b-1", amount_paise: 20000, pay_url: "upi://pay?pa=glowsalon@okicici", pay_to: { id: "glowsalon@okicici", name: "Glow Salon" }, status: "paid", paid_paise: 20000, left_paise: 0, paid: true, payments: [{ id: "upi-pay-2", amount_paise: 20000, after_close: false, marked_at_ms: at + 120_000, marked_by: "owner" }] }],
          refunds: [
            { id: "upr-3", reference: "b-1", payment_id: "upi-pay-2", amount_paise: 20000, state: "done", sent: true, owed_at_ms: at + 300_000, settled_at_ms: at + 900_000 },
            // owed by the desk itself: money the owner marked after a request was closed (no agent call asked for it)
            { id: "upr-5", reference: "b-4", payment_id: "upi-pay-4", amount_paise: 20000, state: "owed", sent: false, owed_at_ms: at + 1_000_000 },
          ],
        },
      },
    };
    const { state } = foldFacts(emptyRecord(), facts, { settings, agentId: agentNames.agentId(NAME), relayId: `relay-${NAME}`, now: at + 3_600_000, labelKey: Buffer.alloc(32, 9) });
    const by = (action: string) => state.entries.filter((e) => e.action === action);
    assert.deepEqual(by("record_deposit"), [], "no payment service saw this money: nothing is written as its confirmation");
    const marked = by("owner_marked_paid");
    assert.equal(marked.length, 1);
    assert.deepEqual({ ...marked[0].refs }, { paymentId: "upi-pay-2", requestId: "upi-1", amountPaise: "20000", markedBy: "owner" });
    assert.equal(marked[0].conversation, "owner");
    assert.match(marked[0].notes, /the owner's statement/u);
    assert.deepEqual(by("upi_request").map((e) => [e.outcome, e.refs.requestId]), [["confirmed", "upi-1"]]);
    assert.ok(!JSON.stringify(state.entries).includes(CUSTOMER.slice(1)), "the customer's number is a fingerprint in the record, never the number");
    assert.deepEqual(by("upi_paid_claim").map((e) => [e.outcome, e.refs.via]), [["confirmed", "screenshot"]], "a claim is recorded as the customer's word; it marks nothing paid");
    assert.deepEqual(by("upi_refund_owed").map((e) => [e.outcome, e.refs.refundId]), [["held_for_owner", "upr-3"], ["held_for_owner", "upr-5"]], "one entry per refund owed, the agent's and the desk's own");
    assert.deepEqual(by("upi_refund_marked_done").map((e) => e.refs.refundId), ["upr-3"]);
    assert.deepEqual(markObligations(state.entries).map((x) => [x.kind, x.amountPaise]), [["upi_refund_owed", 20000]], "the late money is still owed back: the owner's unfinished work shows it");
    // the report counts it as money the owner marked, and says so
    const report = buildMonthlyReport({ settings, entries: state.entries, bookings: [], ...monthRange("2026-11", settings.timezone), source: "live", madeAt: at + 86_400_000 });
    assert.equal(report.paidBy, "owner-marked");
    assert.equal(report.money.deposits.paise, 20000);
  } finally { t.done(); }
});

// ---- the real Guard in front of the desk -----------------------------------------------------------------------------------------------------------------------

test("B71 part 2, against the real Guard: the desk Guard lets the agent's request for the deposit through to the desk, refuses another amount before the desk sees it, and lets the reading agent list but not change", { skip: skipWithoutBinary }, async () => {
  const t = tempServer({});
  const dir = mkdtempSync(join(tmpdir(), "geo-desk-guard-"));
  const wa = recordingWhatsApp();
  const host = hostIn(dir, wa);
  const desk = await listen(deskServer([{ host, token: () => STANDIN_PROVIDER_AUTHORIZATION.replace(/^Bearer /u, "") }]));
  try {
    addAgent(t.root, NAME, flags(), noFiles, NOW);
    const g = planAgent(serverConfig(), readAgent(t.root, NAME)).guards.find((x) => x.kind === "upi")!;
    const agent = credential(); const reader = credential();
    const real = await startRealGuard({ def: g.def, spec: g.spec, tenant: NAME, deployment: g.deployment, upstreamPort: Number(new URL(desk.url).port), agents: [{ id: agentNames.agentId(NAME), token: agent.token }, { id: agentNames.recordId(NAME), token: reader.token, operations: RECORD_READS.upi! }] });
    try {
      const post = (path: string, body: unknown, token = agent.token) => fetch(`${real.agentUrl}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      const ok = await post("/requests", { reference: "b-1", amount_paise: 20000, customer: CUSTOMER });
      assert.equal(ok.status, 200, await ok.text());
      const other = await post("/requests", { reference: "b-2", amount_paise: 25000, customer: CUSTOMER });
      assert.equal(other.status, 403, "another amount is refused by the deposit bound, before the desk");
      assert.equal(host.status().requests, 1);
      const list = await fetch(`${real.agentUrl}/requests`, { headers: { authorization: `Bearer ${reader.token}` } });
      assert.equal(list.status, 200);
      assert.equal(((await list.json()) as any).requests.length, 1);
      assert.equal((await post("/requests", { reference: "b-3", amount_paise: 20000, customer: CUSTOMER }, reader.token)).status, 403, "the reading agent cannot make a request");
      assert.equal((await post("/refunds", { payment_id: "upi-pay-9", amount_paise: 30000 })).status, 403, "a refund owed above one deposit is refused");
    } finally { await real.stop(); }
  } finally { await desk.close(); t.done(); rmSync(dir, { recursive: true, force: true }); }
});
