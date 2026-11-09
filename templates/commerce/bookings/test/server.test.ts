// The runtime's HTTP face: events are saved before the 200, a redelivery is a no-op, only the inbox's token gets in, and the
// status and health endpoints say counts and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { CUSTOMER } from "../src/harness.ts";
import { startServer } from "../server/server.ts";
import type { RunningServer, ServerOptions } from "../server/server.ts";
import type { RuntimeOptions } from "../server/runtime.ts";
import { createKit } from "./runtime-kit.ts";

const TOKEN = "test-token-0123456789abcdef";
const auth = { authorization: `Bearer ${TOKEN}` };

async function boot(options: { runtime?: Partial<RuntimeOptions>; server?: Partial<ServerOptions> } = {}) {
  const kit = createKit();
  const { runtime, db } = kit.open(options.runtime);
  const server: RunningServer = await startServer(runtime, { token: TOKEN, port: 0, ...options.server });
  const post = (body: unknown, headers: Record<string, string> = auth) =>
    fetch(`${server.url}/internal/events`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${server.url}${path}`, { headers });
  const rows = () => { const raw = new DatabaseSync(db.file); try { return raw.prepare("SELECT id, state, attempts FROM tasks ORDER BY seq").all().map((r) => ({ ...r })); } finally { raw.close(); } };
  return { kit, runtime, db, server, post, get, rows, close: async () => { await server.close(); await runtime.close(); kit.cleanup(); } };
}

const customerMessage = (kit: ReturnType<typeof createKit>, text: string, id?: string) => ({ kind: "message", message: kit.messaging.receive(CUSTOMER, text, id ? { id } : {}) });

test("the events are saved before the 200 is sent, even while the step is still running", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const t = await boot({ runtime: { aroundStep: async (_e, run) => { await held; await run(); } } });
  try {
    const reply = await t.post({ events: [customerMessage(t.kit, "hello")] });
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), { saved: 1, duplicates: 0 });
    // The answer is back, the step has not finished, and a different connection to the file already sees the task.
    const [row] = t.rows();
    assert.equal(row.state, "pending");
    assert.equal(row.id, "message:wamid.in_1");
    assert.equal(t.kit.messaging.outbox().length, 0);
    release();
    await t.runtime.idle();
    assert.equal(t.rows()[0].state, "done");
    assert.equal(t.kit.messaging.sentTo(CUSTOMER).length, 1);
  } finally { release(); await t.close(); }
});

test("a message is answered end to end, and writing opens the sender's WhatsApp window", async () => {
  const t = await boot();
  try {
    const event = customerMessage(t.kit, "I want a haircut tomorrow at 6pm") as any;
    assert.equal((await t.post({ events: [event] })).status, 200);
    await t.runtime.idle();
    assert.equal(t.runtime.status().bookings.awaiting_deposit, 1);
    assert.equal(t.db.lastInboundAt(CUSTOMER), event.message.timestamp);
  } finally { await t.close(); }
});

test("an event id that was saved before is a no-op, in one request or across requests", async () => {
  const t = await boot();
  try {
    const event = customerMessage(t.kit, "hello", "wamid.same");
    assert.deepEqual(await (await t.post({ events: [event, event] })).json(), { saved: 1, duplicates: 1 });
    await t.runtime.idle();
    assert.deepEqual(await (await t.post({ events: [event] })).json(), { saved: 0, duplicates: 1 });
    await t.runtime.idle();
    assert.equal(t.rows().length, 1);
    assert.equal(t.kit.messaging.sentTo(CUSTOMER).length, 1, "the customer got one answer, not two");
  } finally { await t.close(); }
});

test("without the right token, nothing is read and nothing is saved", async () => {
  const t = await boot();
  try {
    const body = { events: [customerMessage(t.kit, "hello")] };
    for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: `Bearer ${TOKEN}x` }, { authorization: "Bearer " }, { authorization: `Basic ${TOKEN}` }, { authorization: TOKEN }]) {
      const reply = await t.post(body, headers);
      assert.equal(reply.status, 401, JSON.stringify(headers));
      assert.equal(reply.headers.get("www-authenticate"), "Bearer");
    }
    assert.equal((await t.get("/status")).status, 401);
    assert.equal((await t.get("/status", { authorization: "Bearer nope" })).status, 401);
    assert.equal(t.rows().length, 0);
    assert.equal((await t.post(body)).status, 200); // and the right one gets in
  } finally { await t.close(); }
});

test("a body over the limit is refused with 413 and nothing is saved", async () => {
  const t = await boot({ server: { maxBodyBytes: 1024 } });
  try {
    const big = { events: [customerMessage(t.kit, "x".repeat(4096))] };
    assert.equal((await t.post(big)).status, 413);

    // The same without a Content-Length: a body that only turns out too big as it arrives.
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: t.server.port, method: "POST", path: "/internal/events", headers: { ...auth, "transfer-encoding": "chunked" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on("error", reject);
      for (let i = 0; i < 8; i++) req.write("x".repeat(512));
      req.end();
    });
    assert.equal(status, 413);
    assert.equal(t.rows().length, 0);
    assert.equal((await t.post({ events: [customerMessage(t.kit, "ok")] })).status, 200);
  } finally { await t.close(); }
});

test("a bad body is refused whole with 400: a tick, a half-formed event, not JSON, or one bad event among good ones", async () => {
  const t = await boot();
  try {
    const good = customerMessage(t.kit, "hello");
    const bad: unknown[] = [
      "not json",
      {},
      { events: [] },
      { events: [{ kind: "tick" }] },
      { events: [{ kind: "message", message: { id: "m", from: CUSTOMER } }] },
      { events: [{ kind: "payment_event", event: { id: "e", event: "request.paid", created_at: 1, payload: {} } }] },
      { events: [{ kind: "payment_event", event: { id: "e", event: "refund.done", created_at: 1, payload: { refund: { id: "r" } } } }] },
      { events: [{ kind: "payment_event", event: { id: "e", event: "payment.received", created_at: 1, payload: { payment: {} } } }] },
      { events: [good, { kind: "nonsense" }] },
    ];
    for (const body of bad) assert.equal((await t.post(body)).status, 400, JSON.stringify(body)?.slice(0, 80));
    assert.equal(t.rows().length, 0, "the good event in a bad batch was not saved either");
    const reply = await t.post({ events: [good, { kind: "nonsense" }] });
    assert.match((await reply.json() as any).error, /Event 2/);
  } finally { await t.close(); }
});

test("a real payment.captured, which names the payment and not its link, is accepted (the inbox would otherwise answer its provider 503 for ever)", async () => {
  const t = await boot();
  try {
    const captured = { kind: "payment_event", event: { id: "evt_captured", event: "payment.received", created_at: 1, payload: { payment: { id: "pmt_1" } } } };
    assert.deepEqual(await (await t.post({ events: [captured] })).json(), { saved: 1, duplicates: 0 });
  } finally { await t.close(); }
});

test("a payment event is saved and reaches the agent", async () => {
  const t = await boot();
  try {
    await t.post({ events: [customerMessage(t.kit, "I want a haircut tomorrow at 6pm")] });
    await t.runtime.idle();
    t.kit.payments.customerPays(t.kit.linkFor("b-1")!.id);
    const events = t.kit.payments.events.map((event) => ({ kind: "payment_event", event }));
    assert.deepEqual(await (await t.post({ events })).json(), { saved: events.length, duplicates: 0 });
    await t.runtime.idle();
    assert.deepEqual(t.runtime.status().bookings, { confirmed: 1 });
  } finally { await t.close(); }
});

test("healthz and readyz need no token; readyz turns 503 when the store cannot be read", async () => {
  const t = await boot();
  try {
    assert.deepEqual(await (await t.get("/healthz")).json(), { ok: true });
    assert.deepEqual(await (await t.get("/readyz")).json(), { ok: true });
    t.db.close();
    const reply = await t.get("/readyz");
    assert.equal(reply.status, 503);
    assert.match((await reply.json() as any).reason, /store cannot be read/);
    assert.equal((await t.get("/healthz")).status, 200, "the process is still up");
  } finally { await t.close(); }
});

test("status is counts only: bookings by state, tasks, the last step, the record length and the version, and never a word of a message", async () => {
  const t = await boot({ runtime: { retryDelaysMs: [0] } });
  try {
    await t.post({ events: [customerMessage(t.kit, "I want a haircut tomorrow at 6pm")] });
    await t.runtime.idle();
    const reply = await t.get("/status", auth);
    assert.equal(reply.status, 200);
    const status = await reply.json() as any;
    assert.deepEqual(Object.keys(status).sort(), ["ai", "bookings", "errors", "lastFailureAt", "lastStepAt", "oldestPendingAt", "pathway", "recordLength", "refunds", "startedAt", "steps", "tasks", "version"]);
    assert.deepEqual(status.refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } });
    assert.deepEqual([status.ai.month, status.ai.messages, status.ai.mode, status.ai.reason], ["2026-11", { rules: 1, decision: 0, model: 0 }, "ai", null], "this month's understanding: counts, never a word");
    assert.equal(status.pathway, "bookings");
    assert.equal(status.version, "0.1.0");
    assert.deepEqual(status.bookings, { awaiting_deposit: 1 });
    assert.deepEqual(status.tasks, { pending: 0, done: 1, failed: 0 });
    assert.ok(status.recordLength > 5 && status.lastStepAt && status.lastFailureAt === null);
    // Running totals for a heartbeat: one task finished, none failed; startedAt says when they started from zero.
    assert.deepEqual([status.steps, status.errors], [1, 0]);
    assert.match(status.startedAt, /^\d{4}-\d\d-\d\dT/);
    const text = JSON.stringify(status);
    for (const secret of ["haircut", "6pm", CUSTOMER.slice(3), "Glow", "plink", "rzp"]) assert.ok(!text.includes(secret), `status leaked ${secret}`);
  } finally { await t.close(); }
});

test("it listens on 127.0.0.1 unless told otherwise; other paths and methods are refused", async () => {
  const t = await boot();
  try {
    assert.equal(t.server.host, "127.0.0.1");
    assert.equal((await t.get("/nope")).status, 404);
    const wrong = await fetch(`${t.server.url}/internal/events`, { headers: auth });
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.get("allow"), "POST");
    assert.equal((await fetch(`${t.server.url}/healthz`, { method: "POST" })).status, 405);
  } finally { await t.close(); }
});

test("two requests at the same moment are saved both and handled one at a time", async () => {
  let inStep = 0;
  let most = 0;
  const order: string[] = [];
  const t = await boot({ runtime: { aroundStep: async (event, run) => {
    inStep++; most = Math.max(most, inStep);
    if (event.kind === "message") order.push(event.message.text);
    await new Promise((r) => setTimeout(r, 15));
    await run();
    inStep--;
  } } });
  try {
    const replies = await Promise.all(["hello", "hi there", "namaste"].map((text) => t.post({ events: [customerMessage(t.kit, text)] })));
    assert.deepEqual(replies.map((r) => r.status), [200, 200, 200]);
    await t.runtime.idle();
    assert.equal(most, 1, "no two steps overlapped");
    assert.deepEqual(order.slice().sort(), ["hello", "hi there", "namaste"]);
    assert.deepEqual(t.runtime.status().tasks, { pending: 0, done: 3, failed: 0 });
    assert.equal(t.kit.messaging.outbox().length, 3, "each customer message was answered once");
  } finally { await t.close(); }
});
