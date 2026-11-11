// The deployer's half of the panel's own-agent page (B51's rest, 12 Nov 2026): the stop request pulls the agent's kill switch and marks the agent (not a shop), a rotate
// request rotates, a crash-test request runs beside the loop and leaves its summary (or why it could not run) in exports/<agent>/crash-test.json, a summary left "running"
// by a restarted deployer is said to have no result, the minute's status refresh confirms the agent and counts its held calls, and its licence line is written. Fake machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addAgent, deployAgent } from "../agent/deploy.ts";
import type { AgentFlags } from "../agent/folder.ts";
import { crashSummaryFile, crashTestsRunning, processAgentRequests, rotationFile } from "../agent/requests.ts";
import { processStopRequests, refreshStatuses, runLicence } from "../apply.ts";
import { loadState } from "../lib/state.ts";
import { readStatus } from "../lib/status.ts";
import { CALENDAR_ID, PHONE_NUMBER_ID } from "./helpers.ts";
import { read, secretsFor, world } from "./world.ts";
import type { World } from "./world.ts";

const NOW = new Date("2026-11-04T10:00:00Z");
const noFiles = (path: string): string => { throw new Error(`no file ${path}`); };
const flags: AgentFlags = { upstreams: "razorpay,whatsapp,calendar", "owner-whatsapp": "+919800000001", deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "calendar-id": CALENDAR_ID };
const agentSecrets = (): Record<string, string> => { const s = secretsFor("x"); return { razorpay_key: s.razorpay_key, whatsapp_token: s.whatsapp_token, whatsapp_app_secret: s.whatsapp_app_secret, whatsapp_verify_token: s.whatsapp_verify_token, "google_service_account.json": s["google_service_account.json"] }; };
const by = { id: "acc_1", name: "Asha", role: "builder" };

async function deployed(): Promise<World> {
  const w = world({});
  addAgent(w.root, "my-agent", flags, noFiles, NOW);
  w.handIn("my-agent", agentSecrets());
  await deployAgent(w.ctx, "my-agent");
  return w;
}
const ask = (w: World, file: string, body: Record<string, unknown>) => { const dir = join(w.root, "requests"); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, file), JSON.stringify({ schema: 1, requestId: "r-1", requestedAt: NOW.toISOString(), requestedBy: by, ...body })); return join(dir, file); };

test("the panel's stop for an own agent pulls the kill switch on its Guards and marks the agent, never a shop", async () => {
  const w = await deployed(); try {
    const file = ask(w, "my-agent.stop.json", { shop: "my-agent" });
    assert.deepEqual(await processStopRequests(w.ctx), ["my-agent"]);
    assert.ok(w.admin.some((a) => /^stop my-agent on Asha \(builder, from the panel\)/u.test(a)));
    const state = loadState(w.root);
    assert.match(state.agents!["my-agent"].stopped!.by, /Asha/u);
    assert.equal(state.shops["my-agent"], undefined, "no shop entry is made for an agent's name");
    assert.ok(readStatus(w.root, "my-agent")?.stopped);
    assert.equal(existsSync(file), false, "the request is removed once it is carried out");
  } finally { w.done(); }
});

test("the panel's rotate request rotates (one Guard, as asked) and says how it went; a crash-test request runs beside the loop and leaves its summary, or why it could not run", async () => {
  const w = await deployed(); try {
    const before = read(join(w.paths.secrets, "agents", "my-agent", "whatsapp_token")).trim();
    ask(w, "my-agent.rotate.json", { agent: "my-agent", guard: "whatsapp" });
    ask(w, "my-agent.crash-test.json", { agent: "my-agent" });
    const done = await processAgentRequests(w.ctx);
    assert.deepEqual(done.sort(), ["my-agent: crash test started", "my-agent: rotated"]);
    assert.notEqual(read(join(w.paths.secrets, "agents", "my-agent", "whatsapp_token")).trim(), before);
    const rotation = JSON.parse(readFileSync(rotationFile(w.root, "my-agent"), "utf8"));
    assert.deepEqual([rotation.ok, rotation.guards], [true, ["whatsapp"]]);
    assert.ok(!readFileSync(rotationFile(w.root, "my-agent"), "utf8").includes("gg_"), "no credential in what the panel reads");
    // this agent has no run command, so the crash test cannot start: the summary says why, in the agent's own words
    await crashTestsRunning();
    const summary = JSON.parse(readFileSync(crashSummaryFile(w.root, "my-agent"), "utf8"));
    assert.equal(summary.running, undefined);
    assert.match(summary.error, /has no command to start it with/u);
    assert.match(summary.by, /Asha \(builder, from the panel\)/u);
    assert.equal(existsSync(join(w.root, "requests", "my-agent.crash-test.json")), false);
  } finally { w.done(); }
});

test("a request for an agent that is not on this server, or not a request, is left alone; a crash test left running by a restarted deployer is said to have no result", async () => {
  const w = await deployed(); try {
    const stray = ask(w, "nobody.crash-test.json", { agent: "nobody" });
    const bad = ask(w, "my-agent.rotate.json", { agent: "someone-else" });
    assert.deepEqual(await processAgentRequests(w.ctx), []);
    assert.ok(existsSync(stray) && existsSync(bad));
    mkdirSync(join(w.root, "exports", "my-agent"), { recursive: true });
    writeFileSync(crashSummaryFile(w.root, "my-agent"), JSON.stringify({ at: NOW.toISOString(), version: null, held: 0, of: 0, failed: [], notRun: [], goLive: false, running: true }));
    await processAgentRequests(w.ctx);
    const summary = JSON.parse(readFileSync(crashSummaryFile(w.root, "my-agent"), "utf8"));
    assert.equal(summary.running, false);
    assert.match(summary.error, /restarted before this crash test finished/u);
  } finally { w.done(); }
});

test("the minute's status refresh confirms an own agent from its running Guards and counts what they hold for the owner; its licence line is written", async () => {
  const w = await deployed(); try {
    const guard = (id: string, held: number | null) => ({ id, healthReady: true, held, admin: { tripwires: { ran: true, ok: true, passed: 4, of: 4, not_self_testable_items: [] } } });
    (w.observe as unknown as { agents: unknown[] }).agents = [{ id: "my-agent", up: true, ready: true, guards: [guard("guard-razorpay", 2), guard("guard-whatsapp", 0), guard("guard-calendar", 0)] }];
    w.ctx.now = () => new Date(NOW.getTime() + 60_000);
    assert.ok((await refreshStatuses(w.ctx)).includes("my-agent"));
    const s = readStatus(w.root, "my-agent")!;
    assert.equal(s.updatedAt, new Date(NOW.getTime() + 60_000).toISOString(), "confirmed now, so the panel does not say 'not confirmed' for good");
    assert.deepEqual([s.limits?.proven, s.limits?.of, s.own?.held?.calls], [12, 12, 2]);
    runLicence(w.ctx);
    assert.equal(readStatus(w.root, "my-agent")?.licence?.listed, false, "no lease kept here lists it yet: the panel says it has no licence");
  } finally { w.done(); }
});
