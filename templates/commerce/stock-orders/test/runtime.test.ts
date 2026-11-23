// The Stock orders runtime keeps the agent honest across restarts: steps are saved whole and picked up again after a restart, the store round-trips every field, and a step
// that fails before the order message is sent sends it once when it runs again. The shared parts (the queue, the retries) are tried through Bookings and Fees.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { defaultCharacter } from "../../../../modules/assistant/character.ts";
import { createFakeMessaging } from "../../../../modules/messaging/messaging.ts";
import { RAVI, createWorld, glowSalon } from "../src/harness.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import { META_TEMPLATE_NAMES } from "../src/language/meta-templates.ts";
import { REPORT_TEMPLATE_NAMES } from "../report/whatsapp.ts";
import { createRuntime } from "../server/runtime.ts";
import { openStore } from "../server/store.ts";
import { parseStore, serializeStore } from "../server/snapshot.ts";
import { validateRuntimeConfig } from "../server/config.ts";

const settings = glowSalon();
const START = zonedToMs({ year: 2026, month: 11, day: 9 }, { hour: 10, minute: 0 }, settings.timezone);

function kit() {
  const dir = mkdtempSync(join(tmpdir(), "geo-stock-runtime-"));
  const clock = fakeClock(START);
  const messaging = createFakeMessaging(clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES, ...REPORT_TEMPLATE_NAMES]) for (const l of LANGUAGES) messaging.approve(name, l);
  const opened: ReturnType<typeof openStore>[] = [];
  const open = (options: Partial<Parameters<typeof createRuntime>[0]> = {}) => { const db = openStore(join(dir, "data")); opened.push(db); return { db, runtime: createRuntime({ settings, store: db, clock, services: { messaging }, pathwayVersion: "0.1.0", retryDelaysMs: [0, 0, 0], ...options }) }; };
  const say = async (runtime: ReturnType<typeof open>["runtime"], text: string, from = settings.owner.whatsapp) => { runtime.submit([{ kind: "message", message: messaging.receive(from, text) }]); runtime.kick(); await runtime.idle(); };
  const done = () => { for (const db of opened) { try { db.close(); } catch { /* already closed */ } } rmSync(dir, { recursive: true, force: true }); };
  return { clock, messaging, open, say, done };
}

test("an approval, a restart and a supplier's answer end exactly as they do in the in-memory harness; one order message goes out", async () => {
  const k = kit();
  try {
    const first = k.open();
    await k.say(first.runtime, "order 10 boxes of hair colour from Ravi Traders");
    assert.deepEqual(first.runtime.status().orders, { awaiting_approval: 1 });
    first.db.close(); // the process is gone with the card open

    const second = k.open();
    const code = /\byes ([A-Z0-9]{4,6})\b/u.exec(k.messaging.sentTo(settings.owner.whatsapp).map((m) => m.text).join("\n"));
    await k.say(second.runtime, `yes ${code?.[1] ?? code?.[2]}`);
    assert.deepEqual(second.runtime.status().orders, { sent: 1 });
    second.db.close();

    const third = k.open();
    await k.say(third.runtime, "ok", RAVI);
    const saved = third.db.loadState();
    const restored = parseStore(saved.snapshot);
    assert.equal(restored.orders.get("po-1")?.ack, "accepted");
    assert.equal(k.messaging.sentTo(RAVI).filter((m) => m.templateName === "stock_order_to_supplier").length, 1, "the order went to the supplier once across two restarts");
    assert.equal(restored.seq, 1);
  } finally { k.done(); }
});

test("the store round-trips every field: the orders, the handled messages, the requests, opt-outs, the question asked, the assistant's part and the counter", async () => {
  const w = createWorld({ settings: { ...settings, assistant: { morningAt: null, character: defaultCharacter() } } });
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays("shampoo");
  w.store.optedOut.add("919999999999");
  const again = parseStore(serializeStore(w.store));
  assert.deepEqual(JSON.parse(JSON.stringify([...again.orders])), JSON.parse(JSON.stringify([...w.store.orders])));
  assert.deepEqual([...again.handled], [...w.store.handled]);
  assert.deepEqual([...again.requests], [...w.store.requests]);
  assert.deepEqual([...again.optedOut], [...w.store.optedOut]);
  assert.deepEqual(again.asking, w.store.asking);
  assert.deepEqual(again.assistant, w.store.assistant);
  assert.equal(again.seq, w.store.seq);
});

test("po-N is a counter that survives a restart, so a new order never takes a number already quoted to a supplier", async () => {
  const k = kit();
  try {
    const first = k.open();
    await k.say(first.runtime, "order 10 boxes of hair colour from Ravi Traders");
    first.db.close();
    const second = k.open();
    await k.say(second.runtime, "order 12 shampoo from ravi");
    assert.deepEqual([...parseStore(second.db.loadState().snapshot).orders.keys()], ["po-1", "po-2"]);
    assert.equal(parseStore(second.db.loadState().snapshot).seq, 2);
  } finally { k.done(); }
});

test("a step that fails before the order message is sent runs again and sends it once", async () => {
  const k = kit();
  try {
    const { runtime } = k.open();
    await k.say(runtime, "order 10 boxes of hair colour from Ravi Traders");
    const text = k.messaging.sentTo(settings.owner.whatsapp).map((m) => m.text).join("\n");
    const code = /\byes ([A-Z0-9]{4,6})\b/u.exec(text);
    let failed = false;
    const second = k.open({ aroundStep: async (_event, run) => { if (!failed) { failed = true; throw new Error("the process died before the step ran"); } await run(); } });
    await k.say(second.runtime, `yes ${code?.[1] ?? code?.[2]}`);
    await second.runtime.idle();
    assert.equal(k.messaging.sentTo(RAVI).filter((m) => m.templateName === "stock_order_to_supplier").length, 1);
  } finally { k.done(); }
});

test("runtime.json must name WhatsApp (messaging): a supplier is reached on it, and there is no payment service to name", () => {
  const without = validateRuntimeConfig({ mode: "live", services: {} }, "/tmp");
  assert.equal(without.ok, false);
  const withIt = validateRuntimeConfig({ mode: "live", services: { messaging: { baseUrl: "http://guard:8080", phoneNumberId: "123456789" } } }, "/tmp");
  assert.equal(withIt.ok, true);
});
