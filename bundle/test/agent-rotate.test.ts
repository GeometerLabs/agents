// An own agent's credentials (B51's rest, 12 Nov 2026): one per Guard, handed to the agent through secrets/agents/<name>/credentials.env, rotated with an overlap
// (agent/rotate.ts), and the shared credential of an agent made before then kept working until it is rotated. On the fake machine (test/world.ts): the deploys, the
// reloads and Guard's retire calls are the fake ops container's; the real Guard's side of rotation (two entries with one id, retire-static) is the monorepo's own test
// (adapters/boundaries/guard/tests/reload.rs, a_rotated_agent_credential_works_at_once_and_the_old_one_follows_the_overlap_rule).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addAgent, checkAgent, deployAgent } from "../agent/deploy.ts";
import type { AgentFlags } from "../agent/folder.ts";
import { MAX_OVERLAP_MINUTES, ROTATION_OVERLAP_MINUTES, finishRotations, rotateAgent } from "../agent/rotate.ts";
import { loadState } from "../lib/state.ts";
import { readStatus } from "../lib/status.ts";
import { sha256Hex } from "../lib/util.ts";
import { CALENDAR_ID, PHONE_NUMBER_ID } from "./helpers.ts";
import { composeCalls, read, secretsFor, world } from "./world.ts";
import type { World } from "./world.ts";

const NOW = new Date("2026-11-04T10:00:00Z"); // the fake machine's clock
const KINDS = ["razorpay", "whatsapp", "calendar"] as const;
const noFiles = (path: string): string => { throw new Error(`no file ${path}`); };
const flags: AgentFlags = { upstreams: "razorpay,whatsapp,calendar", "owner-whatsapp": "+919800000001", deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "calendar-id": CALENDAR_ID };
const agentSecrets = (): Record<string, string> => { const s = secretsFor("x"); return { razorpay_key: s.razorpay_key, whatsapp_token: s.whatsapp_token, whatsapp_app_secret: s.whatsapp_app_secret, whatsapp_verify_token: s.whatsapp_verify_token, "google_service_account.json": s["google_service_account.json"] }; };

const token = (w: World, kind: string) => read(join(w.paths.secrets, "agents", "my-agent", `${kind}_token`)).trim();
const envFile = (w: World) => read(join(w.paths.secrets, "agents", "my-agent", "credentials.env"));
const toml = (w: World, kind: string) => read(join(w.paths.generated, "guards", `g-my-agent-${kind}`, "guard.toml"));

async function deployed(): Promise<World> {
  const w = world({});
  addAgent(w.root, "my-agent", flags, noFiles, NOW);
  w.handIn("my-agent", agentSecrets());
  await deployAgent(w.ctx, "my-agent");
  return w;
}

test("rotate: a new credential at each Guard, the old one listed FIRST beside it for the overlap, the agent's file changed only after the Guards took it, Guard told to retire the old one, nothing printed", async () => {
  const w = await deployed(); try {
    const old = Object.fromEntries(KINDS.map((k) => [k, token(w, k)]));
    const restartsBefore = composeCalls(w).filter((c) => c[0] === "restart").length;
    const r = await rotateAgent(w.ctx, "my-agent");
    const until = new Date(NOW.getTime() + ROTATION_OVERLAP_MINUTES * 60_000).toISOString();
    assert.equal(r.overlapUntil, until);
    for (const k of KINDS) {
      const now = token(w, k);
      assert.notEqual(now, old[k], `${k} has a new credential`);
      const t = toml(w, k);
      const at = { old: t.indexOf(sha256Hex(old[k])), now: t.indexOf(sha256Hex(now)) };
      assert.ok(at.old > 0 && at.now > at.old, `${k}'s guard.toml lists the old hash first, then the new one (Guard's retire call retires the first entry with the id)`);
      assert.equal(t.match(/id = "agent-my-agent"/gu)?.length, 2, "both under the agent's one id, so its held calls and its record stay its own");
      assert.ok(envFile(w).includes(`GEOMETER_${k.toUpperCase()}_CREDENTIAL=${now}`) && !envFile(w).includes(old[k]), "the agent's file has the new one, and not the old");
      const p = loadState(w.root).agents!["my-agent"].credentials![k].previous!;
      assert.deepEqual([p.sha256, p.until, p.retired], [sha256Hex(old[k]), until, true], "the state keeps the old one's hash and its end, never the credential");
      assert.ok(w.adminBodies.includes(`g-my-agent-${k} POST /admin/credentials/retire-static ${JSON.stringify({ kind: "agent", subject: "agent-my-agent", after_seconds: ROTATION_OVERLAP_MINUTES * 60 })}`), `${k}'s Guard ends the old one by its own clock`);
      assert.ok(w.admin.includes(`g-my-agent-${k} POST /admin/reload`), `${k}'s Guard read its guard.toml again`);
    }
    assert.equal(composeCalls(w).filter((c) => c[0] === "restart").length, restartsBefore, "no Guard was restarted: a call in flight is not cut off");
    const state = readFileSync(join(w.paths.state, "state.json"), "utf8");
    for (const k of KINDS) assert.ok(!state.includes(old[k]) && !state.includes(token(w, k)), "no credential is in the state file");
    for (const line of r.lines) for (const k of KINDS) assert.ok(!line.includes(token(w, k)) && !line.includes(old[k]), "nothing printed holds a credential");
    assert.ok(r.lines.join(" ").includes("secrets/agents/my-agent/credentials.env"));
    const st = readStatus(w.root, "my-agent")!;
    assert.equal(st.own?.credentials?.guards.razorpay?.oldUntil, until, "the panel is told when the old one ends");
  } finally { w.done(); }
});

test("rotate --guard: one Guard only; a second rotation while its overlap runs is refused; the overlap is 0 to a day", async () => {
  const w = await deployed(); try {
    const before = Object.fromEntries(KINDS.map((k) => [k, token(w, k)]));
    await rotateAgent(w.ctx, "my-agent", { guard: "razorpay", overlapMinutes: 5 });
    assert.notEqual(token(w, "razorpay"), before.razorpay);
    assert.deepEqual([token(w, "whatsapp"), token(w, "calendar")], [before.whatsapp, before.calendar], "the other Guards keep theirs");
    assert.ok(!toml(w, "whatsapp").includes(sha256Hex(token(w, "razorpay"))), "the new Razorpay credential opens nothing at the WhatsApp Guard");
    await assert.rejects(rotateAgent(w.ctx, "my-agent", { guard: "razorpay" }), /rotated already; its old one keeps working until 2026-11-04T10:05:00\.000Z/u);
    await assert.rejects(rotateAgent(w.ctx, "my-agent", { guard: "stripe" }), /has no stripe Guard/u);
    await assert.rejects(rotateAgent(w.ctx, "my-agent", { guard: "whatsapp", overlapMinutes: MAX_OVERLAP_MINUTES + 1 }), /from 0 to 1440/u);
    // 0: a leaked credential ends at once
    await rotateAgent(w.ctx, "my-agent", { guard: "whatsapp", overlapMinutes: 0 });
    assert.ok(w.adminBodies.some((b) => b.startsWith("g-my-agent-whatsapp POST /admin/credentials/retire-static") && b.endsWith('"after_seconds":0}')));
  } finally { w.done(); }
});

test("the deployer ends an overlap when its time comes: the old hash leaves guard.toml and the state, and not before", async () => {
  const w = await deployed(); try {
    const old = token(w, "razorpay");
    await rotateAgent(w.ctx, "my-agent", { guard: "razorpay" });
    assert.deepEqual(await finishRotations(w.ctx), [], "nothing is done before the end");
    assert.ok(toml(w, "razorpay").includes(sha256Hex(old)));
    w.ctx.now = () => new Date(NOW.getTime() + (ROTATION_OVERLAP_MINUTES + 1) * 60_000);
    const lines = await finishRotations(w.ctx);
    assert.match(lines.join(" "), /my-agent: the old razorpay credential has ended/u);
    assert.ok(!toml(w, "razorpay").includes(sha256Hex(old)), "the old hash is gone from guard.toml");
    assert.ok(toml(w, "razorpay").includes(sha256Hex(token(w, "razorpay"))), "the new one stays");
    assert.equal(loadState(w.root).agents!["my-agent"].credentials!.razorpay.previous, undefined);
    assert.equal(readStatus(w.root, "my-agent")?.own?.credentials?.guards.razorpay?.oldUntil, undefined);
  } finally { w.done(); }
});

test("a deploy that is refused during a rotation puts the old credential back: the agent's file never changed, and its credentials still work", async () => {
  const w = await deployed(); try {
    const old = token(w, "razorpay");
    const env = envFile(w);
    w.failVerify("g-my-agent-razorpay", ["refund-needs-owner"]);
    await assert.rejects(rotateAgent(w.ctx, "my-agent", { guard: "razorpay" }), /was not done, and nothing changed for the agent/u);
    assert.equal(token(w, "razorpay"), old);
    assert.equal(envFile(w), env);
    assert.equal(loadState(w.root).agents!["my-agent"].credentials?.razorpay?.previous, undefined, "the rotation is forgotten");
  } finally { w.done(); }
});

test("an agent made before 12 Nov 2026 keeps its one credential through the deploy that brings this in, until it is rotated", async () => {
  const w = world({}); try {
    addAgent(w.root, "my-agent", flags, noFiles, NOW);
    // what `agent add` made before: one agent_token, no file per Guard
    const legacy = `gg_${"1".repeat(32)}`;
    for (const k of KINDS) rmSync(join(w.paths.secrets, "agents", "my-agent", `${k}_token`));
    writeFileSync(join(w.paths.secrets, "agents", "my-agent", "agent_token"), `${legacy}\n`);
    w.handIn("my-agent", agentSecrets());
    await deployAgent(w.ctx, "my-agent");
    for (const k of KINDS) {
      assert.equal(token(w, k), legacy, `${k}'s Guard starts with the shared credential`);
      assert.ok(toml(w, k).includes(sha256Hex(legacy)));
    }
    assert.ok(envFile(w).includes(`GEOMETER_CREDENTIAL=${legacy}`), "the name the agent reads is still there");
    assert.match((await checkAgent(w.ctx, "my-agent")).notes.join(" "), /still share one credential .* agent rotate my-agent/u);
    assert.equal(readStatus(w.root, "my-agent")?.own?.credentials?.shared, true);
    const r = await rotateAgent(w.ctx, "my-agent");
    assert.match(r.lines.join(" "), /no longer share one credential, so GEOMETER_CREDENTIAL is gone/u);
    assert.ok(!envFile(w).includes("GEOMETER_CREDENTIAL="));
    assert.equal(new Set(KINDS.map((k) => token(w, k))).size, 3, "now one each");
    assert.equal(existsSync(join(w.paths.secrets, "agents", "my-agent", "agent_token")), false, "the shared one's file is deleted once no Guard uses it");
    for (const k of KINDS) assert.ok(toml(w, k).includes(sha256Hex(legacy)), "the shared one still works through the overlap");
  } finally { w.done(); }
});

test("an agent not deployed yet: new credentials, nothing to overlap, nothing deployed", async () => {
  const w = world({}); try {
    addAgent(w.root, "my-agent", flags, noFiles, NOW);
    const old = token(w, "whatsapp");
    const r = await rotateAgent(w.ctx, "my-agent", { guard: "whatsapp" });
    assert.notEqual(token(w, "whatsapp"), old);
    assert.equal(r.overlapUntil, null);
    assert.match(r.lines[0], /not deployed, so no Guard knew its old credentials/u);
    assert.ok(!composeCalls(w).some((c) => c[0] === "up"), "nothing was started");
    assert.ok(envFile(w).includes(token(w, "whatsapp")));
  } finally { w.done(); }
});
