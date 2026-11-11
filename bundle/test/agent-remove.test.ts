// `geometer agent remove` (B51's rest, 12 Nov 2026, agent/remove.ts): refused while something is open (a call held for the owner, an approved one not yet sent, an
// effect with no known outcome, unfinished work in the record, a Guard that cannot be asked), unless --force with a plain warning; then the Guards are stopped and gone
// from the configuration, the credentials revoked, and the record, settings and snapshots KEPT, with a tombstone that keeps the name. On the fake machine (test/world.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { addAgent, deployAgent } from "../agent/deploy.ts";
import type { AgentFlags } from "../agent/folder.ts";
import { openWorkOf, removeAgent } from "../agent/remove.ts";
import { applyOnce, processStopRequests } from "../apply.ts";
import { main } from "../geometer.ts";
import { loadState, shopIndex } from "../lib/state.ts";
import { CALENDAR_ID, PHONE_NUMBER_ID } from "./helpers.ts";
import { read, secretsFor, world } from "./world.ts";
import type { World } from "./world.ts";

const NOW = new Date("2026-11-04T10:00:00Z");
const noFiles = (path: string): string => { throw new Error(`no file ${path}`); };
const flags: AgentFlags = { upstreams: "razorpay,whatsapp,calendar", "owner-whatsapp": "+919800000001", deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "calendar-id": CALENDAR_ID };
const agentSecrets = (): Record<string, string> => { const s = secretsFor("x"); return { razorpay_key: s.razorpay_key, whatsapp_token: s.whatsapp_token, whatsapp_app_secret: s.whatsapp_app_secret, whatsapp_verify_token: s.whatsapp_verify_token, "google_service_account.json": s["google_service_account.json"] }; };
const GUARDS = ["g-my-agent-razorpay", "g-my-agent-whatsapp", "g-my-agent-calendar"];

/** A deployed agent whose Guards answer: nothing held, no effect in flight (unless a test says otherwise). */
async function deployed(): Promise<World> {
  const w = world({});
  addAgent(w.root, "my-agent", flags, noFiles, NOW);
  w.handIn("my-agent", agentSecrets());
  await deployAgent(w.ctx, "my-agent");
  w.adminAnswers.set("g-my-agent-razorpay GET /admin/approvals", { status: 200, body: { approvals: [] } });
  for (const g of GUARDS) w.adminAnswers.set(`${g} GET /admin/intents`, { status: 200, body: { intents: [] } });
  return w;
}
const held = (state: string, extra: Record<string, unknown> = {}) => ({ status: 200, body: { approvals: [{ id: "ap-1", operation: "refund", principal: "agent-my-agent", state, expires_at_ms: String(NOW.getTime() + 3_600_000), ...extra }] } });

test("remove is refused while a refund is held for the owner, or approved and not sent again, or its outcome is not known, and nothing is changed", async () => {
  const w = await deployed(); try {
    for (const [answer, words] of [[held("pending"), /a refund is held for the owner \(Guard's request ap-1\)/u], [held("approved"), /the owner approved a refund that the agent has not sent again yet/u]] as const) {
      w.adminAnswers.set("g-my-agent-razorpay GET /admin/approvals", answer);
      await assert.rejects(removeAgent(w.ctx, "my-agent"), (e: Error) => /was not removed, and nothing was changed/u.test(e.message) && words.test(e.message) && /--force/u.test(e.message));
    }
    w.adminAnswers.set("g-my-agent-razorpay GET /admin/approvals", { status: 200, body: { approvals: [] } });
    w.adminAnswers.set("g-my-agent-razorpay GET /admin/intents", { status: 200, body: { intents: [{ intent: "i-1", operation: "refund", state: "outcome_unknown" }] } });
    await assert.rejects(removeAgent(w.ctx, "my-agent"), /a refund whose outcome Guard does not know yet \(outcome unknown\)/u);
    assert.ok(existsSync(join(w.paths.root, "agents", "my-agent", "agent.json")), "its folder is where it was");
    assert.ok(loadState(w.root).agents?.["my-agent"]?.applied, "and it is still deployed");
    assert.ok(!w.admin.some((a) => a.startsWith("stop my-agent")), "no kill switch was pulled");
  } finally { w.done(); }
});

test("a Guard that cannot be asked refuses the removal too: nothing open is never assumed", async () => {
  const w = await deployed(); try {
    w.adminAnswers.set("g-my-agent-razorpay GET /admin/approvals", { status: 0, body: { error: "could not be reached (ECONNREFUSED)" } });
    const open = await openWorkOf(w.ctx, "my-agent");
    assert.deepEqual(open.notAsked, ["g-my-agent-razorpay"]);
    await assert.rejects(removeAgent(w.ctx, "my-agent"), /g-my-agent-razorpay could not be asked whether it holds a call for the owner/u);
  } finally { w.done(); }
});

test("unfinished work in the agent's record refuses the removal (the panel's own list, read the same way)", async () => {
  const w = await deployed(); try {
    const out = join(w.paths.root, "exports", "my-agent");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "record.json"), "[]");
    // what the record job exports for a refund Guard holds for the owner: one case with a guard_hold, waiting longer than the panel's limit
    writeFileSync(join(out, "bookings.json"), JSON.stringify([{ id: "ap-9", customer: "agent", language: "en", state: "confirmed", dateNeedsConfirmation: false, timeInferred: false, handledPayments: [], reminders: [], pending: [{ kind: "guard_hold", approval: "ap-9", paymentId: "pay_1", amountInr: 200, receipt: "b-1", expiresAtMs: NOW.getTime() + 3_600_000, heldAtMs: NOW.getTime() - 20 * 3_600_000 }] }]));
    const open = await openWorkOf(w.ctx, "my-agent");
    assert.ok(open.unfinished.some((u) => /ap-9/u.test(u)), JSON.stringify(open));
    await assert.rejects(removeAgent(w.ctx, "my-agent"), /ap-9/u);
  } finally { w.done(); }
});

test("--force removes it anyway, with a plain warning; its Guards go, its credentials are revoked, and its record, settings and keys are KEPT, the name with them", async () => {
  const w = await deployed(); try {
    w.adminAnswers.set("g-my-agent-razorpay GET /admin/approvals", held("pending"));
    const r = await removeAgent(w.ctx, "my-agent", { force: true });
    assert.match(r.lines[0], /^WARNING: my-agent is being removed with this still open\. Nothing on this server will finish it: a held call is never made/u);
    assert.ok(w.admin.some((a) => /^stop my-agent on the deployer being removed/u.test(a)), "the kill switch first: nothing new goes out while it is taken down");
    // gone from what the deployer and the panel read
    assert.equal(existsSync(join(w.paths.root, "agents", "my-agent")), false, "its folder is out of agents/, so the deployer's loop cannot deploy it again");
    assert.equal(loadState(w.root).agents?.["my-agent"], undefined);
    assert.equal(existsSync(join(w.paths.root, "status", "my-agent.json")), false);
    const compose = read(join(w.paths.generated, "compose.yaml"));
    for (const g of GUARDS) { assert.ok(!compose.includes(`${g}:`), `${g} is not in the compose file`); assert.equal(existsSync(join(w.paths.generated, "guards", g)), false); }
    assert.deepEqual((await applyOnce(w.ctx)).applied, [], "the next pass deploys nothing");
    // kept
    const kept = join(w.paths.root, r.keptIn);
    assert.match(r.keptIn, /^removed\/my-agent-20261104T100000Z$/u);
    for (const f of ["agent/agent.json", "agent/settings.json", "state.json", "status.json", "README.txt"]) assert.ok(existsSync(join(kept, f)), `${f} is kept`);
    assert.match(read(join(kept, "README.txt")), /Open when it was removed:\n {2}- razorpay: a refund is held for the owner/u);
    assert.ok(existsSync(join(w.paths.secrets, "g-my-agent-razorpay", "razorpay_authorization")), "the shop's own key is not deleted");
    assert.ok(existsSync(join(w.paths.secrets, "person-keys", "my-agent")), "nor its fingerprint key");
    assert.match(r.lines.join("\n"), /Kept, not deleted: removed\/my-agent-20261104T100000Z\/ .*Docker volumes .*gs-my-agent-razorpay/u);
    // revoked
    assert.equal(existsSync(join(w.paths.secrets, "agents", "my-agent")), false, "the agent's credentials and its file are deleted");
    assert.equal(existsSync(join(w.paths.secrets, "relay", "my-agent")), false, "the relay's credentials for it too");
    assert.equal(existsSync(join(w.paths.secrets, "ops", "my-agent", "record_token")), false);
    assert.ok(existsSync(join(w.paths.secrets, "ops", "my-agent", "label_key")), "the label key stays: the kept record's labels were made with it");
    // the tombstone keeps the name
    const state = loadState(w.root);
    assert.equal(state.removed?.["my-agent"]?.keptIn, r.keptIn);
    assert.throws(() => addAgent(w.root, "my-agent", flags, noFiles, NOW), /name of an agent removed from this server on 2026-11-04/u);
    assert.throws(() => shopIndex(state, "my-agent"), /choose another name/u);
    assert.notEqual(shopIndex(state, "glow-salon"), state.removed!["my-agent"].index, "its network index is not given to anything else");
    await assert.rejects(removeAgent(w.ctx, "my-agent"), /was removed already, on 2026-11-04/u);
  } finally { w.done(); }
});

test("a panel request for an agent being removed is dropped, and a stop request for a removed name is left alone without stopping the deployer's pass", async () => {
  const w = await deployed(); try {
    const requests = join(w.paths.root, "requests");
    mkdirSync(requests, { recursive: true });
    writeFileSync(join(requests, "my-agent.crash-test.json"), "{}");
    await removeAgent(w.ctx, "my-agent");
    assert.equal(existsSync(join(requests, "my-agent.crash-test.json")), false);
    // the panel's stop arrives after the removal (it was on the page before): left alone, said once, and the pass goes on
    writeFileSync(join(requests, "my-agent.stop.json"), JSON.stringify({ schema: 1, requestId: "stop_1", shop: "my-agent", requestedAt: NOW.toISOString(), requestedBy: { id: "a", name: "Asha", role: "builder" } }));
    assert.deepEqual(await processStopRequests(w.ctx), []);
    assert.equal(loadState(w.root).shops["my-agent"], undefined, "no shop entry under a removed agent's name");
  } finally { w.done(); }
});

test("a server that cannot bring the configuration up still leaves the removal done but for that, with the credentials gone, and says how to finish", async () => {
  const w = await deployed(); try {
    w.adminAnswers.set("g-my-agent-razorpay GET /admin/approvals", { status: 200, body: { approvals: [] } });
    const failingUp = w.ctx.runner;
    w.ctx.runner = { run: async (command, args, o) => (args.includes("up") ? { code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" } : failingUp.run(command, args, o)) };
    const r = await removeAgent(w.ctx, "my-agent");
    assert.match(r.lines[0], /its Guards could not be taken down .*geometer deploy. takes them down/u);
    assert.equal(existsSync(join(w.paths.secrets, "agents", "my-agent")), false, "the credentials are deleted before the configuration is brought up");
    assert.ok(existsSync(join(w.paths.root, r.keptIn, "README.txt")));
  } finally { w.done(); }
});

test("with nothing open it is removed without --force, and the command says what it kept and where", async () => {
  const w = await deployed(); try {
    const lines: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
    let code: number;
    try { code = await main(["agent", "remove", "my-agent", "--server", w.root], w.ctx); } finally { console.log = log; }
    assert.equal(code, 0);
    assert.ok(!lines.join("\n").includes("WARNING"));
    assert.match(lines.join("\n"), /my-agent is removed: its Guards are stopped and gone from this server's configuration, and its credentials are revoked\./u);
    assert.match(lines.join("\n"), /Nothing else was deleted\. Your agent still runs wherever you run it: stop it there\./u);
    assert.equal(readdirSync(join(w.paths.root, "removed")).length, 1);
  } finally { w.done(); }
});
