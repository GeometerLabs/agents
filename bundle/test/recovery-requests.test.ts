// The to-do list's recovery buttons (B31) on the deployer's side: the panel writes a request (a name and an id), the deployer carries it to the shop's runtime through ops, which holds the
// runtime's token, and removes the file only when the runtime took it. Nothing the panel writes can send a message or move money by itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processRecoveryRequests } from "../apply.ts";
import { deploy } from "../deploy.ts";
import { RECOVERY_FILE, parseRecoveryRequest } from "../lib/requests.ts";
import { recoverCase } from "../services/ops.ts";
import type { OpsConfig } from "../services/ops.ts";
import { panelRuntime } from "./helpers.ts";
import { world } from "./world.ts";

const withPanel = { panel: { enabled: true } };
const request = (shop: string, id: string, extra: object = {}) => JSON.stringify({ schema: 1, requestId: id, shop, case: "b-1", action: "recheck_payment", requestedAt: "2026-11-04T09:59:00Z", requestedBy: { id: "acct-1", name: "Divya", role: "partner" }, ...extra });

test("a recovery request is carried to the shop's runtime through ops and only then removed", async () => {
  const w = world({ "glow-salon": panelRuntime() }, withPanel);
  try {
    w.handIn("glow-salon"); await deploy(w.ctx);
    mkdirSync(join(w.root, "requests"), { recursive: true });
    const file = join(w.root, "requests", "glow-salon.recover.rc-1a2b.json");
    writeFileSync(file, request("glow-salon", "rc-1a2b"));
    w.recover.status = 0; // the runtime did not answer
    assert.deepEqual(await processRecoveryRequests(w.ctx), []);
    assert.ok(existsSync(file), "a request the runtime did not take stays, and is tried again");
    w.recover.status = 503;
    assert.deepEqual(await processRecoveryRequests(w.ctx), []);
    assert.ok(existsSync(file));
    w.recover.status = 200;
    w.admin.length = 0;
    assert.deepEqual(await processRecoveryRequests(w.ctx), ["rc-1a2b"]);
    assert.ok(!existsSync(file));
    assert.deepEqual(w.admin, ["recover glow-salon rc-1a2b b-1 recheck_payment"], "a name and an id are all that is carried");
  } finally { w.done(); }
});

test("a request that waits more than an hour is dropped and said; one for a shop that is not running yet waits; one that is not a request is left alone", async () => {
  const w = world({ "glow-salon": panelRuntime() }, withPanel);
  const logs: string[] = [];
  const ctx = { ...w.ctx, log: (l: string) => logs.push(l) };
  try {
    mkdirSync(join(w.root, "requests"), { recursive: true });
    const waiting = join(w.root, "requests", "glow-salon.recover.rc-1.json");
    writeFileSync(waiting, request("glow-salon", "rc-1"));
    assert.deepEqual(await processRecoveryRequests(ctx), []);
    assert.ok(existsSync(waiting) && logs.some((l) => /waits: the shop is not running yet/u.test(l)));
    w.handIn("glow-salon"); await deploy(w.ctx);
    w.recover.status = 0;
    const old = join(w.root, "requests", "glow-salon.recover.rc-2.json");
    writeFileSync(old, request("glow-salon", "rc-2", { requestedAt: "2026-11-04T07:00:00Z" }));
    await processRecoveryRequests(ctx);
    assert.ok(existsSync(waiting), "a young request stays");
    assert.ok(!existsSync(old), "an old one is dropped");
    assert.ok(logs.some((l) => /rc-2 .*was dropped/u.test(l)));
    for (const [name, content] of [["glow-salon.recover.rc-3.json", "{not json"], ["glow-salon.recover.rc-4.json", request("other-shop", "rc-4")], ["glow-salon.recover.rc-5.json", request("glow-salon", "rc-5", { action: "Refund Everything" })], ["glow-salon.recover.rc-6.json", request("glow-salon", "rc-6", { case: "../etc" })], ["glow-salon.recover.rc-7.json", request("glow-salon", "rc-other")]] as const) writeFileSync(join(w.root, "requests", name), content);
    w.recover.status = 200; w.admin.length = 0;
    assert.deepEqual(await processRecoveryRequests(ctx), ["rc-1"]);
    for (const n of [3, 4, 5, 6, 7]) assert.ok(existsSync(join(w.root, "requests", `glow-salon.recover.rc-${n}.json`)), `rc-${n} is left alone`);
    assert.deepEqual(w.admin, ["recover glow-salon rc-1 b-1 recheck_payment"]);
  } finally { w.done(); }
});

test("the request file's name and shape are read strictly", () => {
  assert.ok(RECOVERY_FILE.test("glow-salon.recover.rc-1a2b.json"));
  assert.ok(!RECOVERY_FILE.test("glow-salon.stop.json") && !RECOVERY_FILE.test("../x.recover.rc-1.json") && !RECOVERY_FILE.test("glow-salon.recover.rc 1.json"));
  assert.ok(parseRecoveryRequest(request("glow-salon", "rc-1"), "glow-salon", "rc-1"));
  assert.equal(parseRecoveryRequest(request("glow-salon", "rc-1"), "glow-salon", "rc-2"), undefined);
  assert.equal(parseRecoveryRequest(request("glow-salon", "rc-1", { schema: 2 }), "glow-salon", "rc-1"), undefined);
  assert.equal(parseRecoveryRequest(undefined, "glow-salon", "rc-1"), undefined);
});

test("ops hands the request to the shop's runtime with the runtime's own token, and says 0 when it cannot be reached", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-ops-"));
  try {
    writeFileSync(join(dir, "token"), "runtime-token-0123456789\n");
    const config = { deploymentId: "d", bundleVersion: "0", shops: { "glow-salon": { pathway: "bookings", pathwayVersion: "0.1.0", runtimeUrl: "http://runtime-glow-salon:8780/", internalTokenFile: join(dir, "token"), guards: [] } }, model: {} } as unknown as OpsConfig;
    const seen: { url: string; init: RequestInit }[] = [];
    const answer = (status: number) => (async (url: string, init: RequestInit) => { seen.push({ url, init }); return { status } as Response; }) as unknown as typeof fetch;
    assert.deepEqual(await recoverCase(config, "glow-salon", "rc-1", "b-1", "ask_owner_again", answer(200)), { shop: "glow-salon", status: 200 });
    assert.equal(seen[0].url, "http://runtime-glow-salon:8780/internal/recover");
    assert.equal(seen[0].init.method, "POST");
    assert.equal((seen[0].init.headers as Record<string, string>).authorization, "Bearer runtime-token-0123456789");
    assert.deepEqual(JSON.parse(seen[0].init.body as string), { id: "rc-1", case: "b-1", action: "ask_owner_again" });
    assert.equal((await recoverCase(config, "glow-salon", "rc-1", "b-1", "x_y", (async () => { throw new Error("down"); }) as unknown as typeof fetch)).status, 0);
    await assert.rejects(() => recoverCase(config, "nobody", "rc-1", "b-1", "ask_owner_again", answer(200)), /no shop nobody/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
