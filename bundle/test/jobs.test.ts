// The deployer's scheduled jobs: each runs once when it is due, is remembered across a restart, and the snapshot waits for the small hours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateIdentity } from "../backup/age.ts";
import { runDueJobs } from "../apply.ts";
import { deploy } from "../deploy.ts";
import { fakeRunner, ok } from "../lib/runner.ts";
import { secretFile, writeSecretFile } from "../lib/secrets.ts";
import { loadState } from "../lib/state.ts";
import { panelRuntime } from "./helpers.ts";
import { world } from "./world.ts";

async function ready() {
  const w = world({ "glow-salon": undefined as never }, { backup: { snapshots: { url: "s3://snaps/a" }, ageRecipient: generateIdentity().recipient } });
  writeSecretFile(secretFile(w.root, "backup", "snapshots"), "A:B");
  writeFileSync(join(w.paths.shop("glow-salon"), "runtime.json"), JSON.stringify(panelRuntime()));
  w.handIn("glow-salon"); await deploy(w.ctx);
  const docker: string[][] = [];
  const real = w.ctx.runner;
  w.ctx.runner = fakeRunner((c, a, o) => { docker.push(a); if (a[0] === "run" && a.includes("/app/bundle/backup/snapshot.ts")) return ok(JSON.stringify({ results: [{ name: "glow-salon", ok: true, stamp: "x", files: 1, bytes: 1, seal: { stamp: "20261104T023000Z", objects: [], record: null } }] })); if (a[0] === "run") return ok(JSON.stringify({ results: [{ name: "glow-salon", ok: true, detail: "fine" }] })); return real.run(c, a, o) as never; });
  return { w, docker };
}
const at = (w: Awaited<ReturnType<typeof ready>>["w"], iso: string) => { w.ctx.now = () => new Date(iso); };

test("the relay's credential is renewed on the first pass and then once a day; the snapshot waits until 02:00; the drill is weekly; none runs twice", async () => {
  const { w, docker } = await ready(); try {
    at(w, "2026-11-04T01:00:00");
    assert.deepEqual(await runDueJobs(w.ctx), ["relay credentials", "exports", "fingerprints"], "01:00: too early for a snapshot or a drill; the first daily fingerprint follows the first export");
    at(w, "2026-11-04T02:30:00");
    assert.deepEqual(await runDueJobs(w.ctx), ["exports", "snapshot"], "02:30: the snapshot is due; the credential was renewed 90 minutes ago; the exports are quarter-hourly");
    assert.deepEqual(await runDueJobs(w.ctx), [], "and not again");
    at(w, "2026-11-05T02:30:00");
    assert.deepEqual(await runDueJobs(w.ctx), ["relay credentials", "exports", "fingerprints", "snapshot"]);
    at(w, "2026-11-11T03:30:00");
    const week = await runDueJobs(w.ctx);
    assert.ok(week.includes("drill") || week.includes("drill FAILED"), week.join(","));
    assert.ok(loadState(w.root).jobs?.drillAt, "remembered, so a restart of the deployer does not run it again");
    assert.ok(docker.some((a) => a.includes("/app/bundle/backup/drill-check.ts")), "the drill restored the newest snapshot");
  } finally { w.done(); }
});

test("with no backup configured the deployer only renews credentials", async () => {
  const w = world(); try {
    w.handIn("glow-salon"); await deploy(w.ctx);
    at(w, "2026-11-04T03:30:00");
    assert.deepEqual(await runDueJobs(w.ctx), ["relay credentials", "exports", "fingerprints"]);
  } finally { w.done(); }
});
