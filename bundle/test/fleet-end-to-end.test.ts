// The bundle's sender against fleet's REAL server and billing engine (not a stub), when the monorepo is at hand: a heartbeat with the cost meter's counts is accepted, fleet's
// per-shop answer comes back in the shape the bundle reads, and "buttons" arrives when the partner's balance cannot pay for the next block of extra messages. This is the
// contract tested in practice; the two sides' own tests pin it from each end. Skipped, saying why, when the monorepo's fleet is not there or is too old to know `usage`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fleetFile } from "./monorepo.ts";
import { parseFleetAnswer } from "../lib/fleet.ts";
import { buildHeartbeat, sendHeartbeat } from "../services/heartbeat.ts";
import type { ShopObservation } from "../services/heartbeat.ts";
import type { UsageTotals } from "../lib/usage.ts";

const src = (name: string) => fleetFile("src", name);
const needed = ["store.ts", "server.ts", "billing-api.ts", "keys.ts", "registry.ts", "schema.ts"].map(src);
const present = needed.every((f) => f !== undefined);
let skip: string | false = present ? false : "the monorepo's apps/fleet is not at a sibling path (set GEOMETER_MONOREPO)";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fleet: any;
if (!skip) {
  try {
    const [store, server, billing, keys] = await Promise.all([import(src("store.ts")!), import(src("server.ts")!), import(src("billing-api.ts")!), import(src("keys.ts")!)]);
    fleet = { ...store, ...server, ...billing, ...keys };
    if (typeof fleet.createBillingApi !== "function") skip = "the fleet found does not have the billing engine yet (merge apps/fleet's billing first, or set GEOMETER_MONOREPO)";
  } catch (e) { skip = `the fleet found could not be loaded: ${(e as Error).message.slice(0, 120)}`; }
}

const totals = (messages: number): UsageTotals => ({ messages, byStep: { rules: messages, decision: 0, model: 0 }, modelMicroInr: 0, whatsapp: { service: 0, utility: 0, marketing: 0, estMicroInr: 0, estimated: true } });
const NOW = new Date("2026-11-05T10:00:00.000Z");
const shop = (usage: UsageTotals): ShopObservation => ({ id: "glow-salon", pathway: "bookings", pathwayVersion: "0.1.0", up: true, ready: true, status: null, guards: [], usage });

test("fleet's real answer is read by the bundle: plan and allowance, then buttons with the reason once the allowance is passed and the balance is empty", { skip }, async () => {
  const store = fleet.openStore(":memory:");
  const key = fleet.newSecret(fleet.DEPLOYMENT_KEY_PREFIX);
  store.addDeployment({ id: "acme-vps-1", keyHash: fleet.hashSecret(key), contact: "b@example.com", founderCopy: false, hosting: "geometer" }, NOW.getTime());
  const api = fleet.createBillingApi({ store, now: () => NOW.getTime(), liveDayMinMinutes: 60, config: { prices_dir: null, whatsapp_route: "gupshup", razorpay: null } });
  api.billing.registry.addPartner({ id: "asha", name: "Asha Digital", contact: "asha@example.com", kind: "partner" }, NOW.getTime());
  api.billing.registry.setShopPlan({ deployment: "acme-vps-1", agent: "glow-salon", partner: "asha", plan: "basic" }, NOW.getTime());
  const server = await fleet.startServer({ store, now: () => NOW.getTime(), quietAfterS: 180, port: 0, billing: api });
  after(async () => { await server.close(); store.close(); });

  // The first heartbeat has no baseline: it sends no usage, as it must (history is never replayed), and fleet answers with the plan.
  let base: Record<string, unknown> = {};
  const first = buildHeartbeat({ deploymentId: "acme-vps-1", bundleVersion: "0.1.0", now: NOW, shops: [shop(totals(900))], baseline: {}, usageBaseline: base as never });
  base = first.nextUsage as never;
  const r1 = await sendHeartbeat(server.url, key, first.body);
  assert.equal(r1.accepted, true, JSON.stringify(r1));
  assert.deepEqual(r1.answer?.["glow-salon"], { plan: "basic", allowance: 1000, innovator: false, ai: "normal", warn: [] }, "plan and allowance, nothing to pay yet");

  // 1,100 more messages in the month fleet has counted (the first 900 were history, not replayed): fleet's own validator accepted the usage block; the shop is over its allowance and the balance is empty.
  const second = buildHeartbeat({ deploymentId: "acme-vps-1", bundleVersion: "0.1.0", now: new Date(NOW.getTime() + 60_000), shops: [shop(totals(2000))], baseline: {}, usageBaseline: base as never });
  assert.equal((second.body.agents as { usage: { messages: number } }[])[0].usage.messages, 1100);
  const r2 = await sendHeartbeat(server.url, key, second.body);
  assert.equal(r2.accepted, true, JSON.stringify(r2));
  const entry = r2.answer?.["glow-salon"];
  assert.deepEqual([entry?.ai, entry?.reason, entry?.plan, entry?.allowance], ["buttons", "overage_unfunded", "basic", 1000]);
  assert.deepEqual(entry?.warn, ["allowance_80"]);
  assert.deepEqual(parseFleetAnswer({ shops: { "glow-salon": entry } })?.["glow-salon"], entry, "what the bundle reads is what fleet said");
  assert.equal((second.nextUsage as Record<string, { messages: number }>)["glow-salon"].messages, 2000, "the baseline moved by what was sent");
});
