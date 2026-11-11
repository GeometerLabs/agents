// Item 17b: the deployer lists this server's paper signing key with fleet (lib/signer-claim.ts, apply.ts runDueJobs). The claim against a stand-in for fleet's
// POST /v1/paper-signers: what it sends (the deployment key, and a proof fleet's own check accepts), when it sends nothing, that a failure is a line and never a
// throw, and that the deployer sends it when it starts and then once a day. Written 11 Nov 2026; not run yet (the owner runs every test once, together).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDueJobs } from "../apply.ts";
import { claimPaperSigner, SIGNERS_PATH } from "../lib/signer-claim.ts";
import { ensurePanelSigningKey, panelSigningKeyFile } from "../lib/secrets.ts";
import { loadServer } from "../lib/server.ts";
import { loadState } from "../lib/state.ts";
import { loadPrivateKey } from "../../modules/report/sign.ts";
import { signerClaimBytes } from "../../modules/report/summary-sign.ts";
import { world } from "./world.ts";

const DEPLOYMENT_KEY = `gfk_${"k".repeat(40)}`;

/** A stand-in for fleet's route: records each claim and answers as fleet does ({ok, key_id, since, new}); `fail` makes it answer 503. */
async function fakeFleet(o: { fail?: boolean } = {}) {
  const claims: { auth: string | undefined; body: { public_key: string; proof: string } }[] = [];
  const server = createServer((req, res) => {
    let text = "";
    req.on("data", (c: Buffer) => { text += c; });
    req.on("end", () => {
      if (req.method !== "POST" || req.url !== SIGNERS_PATH) { res.writeHead(404); res.end(); return; }
      claims.push({ auth: req.headers.authorization, body: JSON.parse(text) });
      if (o.fail) { res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "fleet is down for a moment" })); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, key_id: "key:abc", since: "2026-11-11", new: claims.length === 1 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, claims, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** A paired server folder (fleet's address and the deployment key) with the panel's signing key made. */
function paired(fleetUrl: string) {
  const w = world({}, { fleet: { url: fleetUrl, keyFile: "fleet_key" }, panel: { enabled: true } });
  writeFileSync(join(w.root, "fleet_key"), `${DEPLOYMENT_KEY}\n`, { mode: 0o600 });
  ensurePanelSigningKey(w.root);
  return w;
}

test("the claim carries the deployment key and a proof fleet's check accepts: the server's key, over its own deployment id", async () => {
  const fleet = await fakeFleet();
  const w = paired(fleet.url);
  try {
    const line = await claimPaperSigner({ dir: w.root, server: loadServer(w.root) });
    assert.match(line, /signing key is now on Geometer's list \(key:abc\)/u);
    assert.equal(fleet.claims.length, 1);
    const [c] = fleet.claims;
    assert.equal(c.auth, `Bearer ${DEPLOYMENT_KEY}`);
    // what fleet's paper-signers.ts checks: the proof is the key's signature over "geo-paper-signer/1\n<deployment id>\n<public key>"
    const key = loadPrivateKey(panelSigningKeyFile(w.root));
    const publicRaw = createPublicKey(key).export({ format: "jwk" }).x!;
    assert.equal(c.body.public_key, Buffer.from(publicRaw, "base64url").toString("hex"));
    assert.equal(verify(null, signerClaimBytes("acme-vps-1", c.body.public_key), createPublicKey(key), Buffer.from(c.body.proof, "hex")), true);
    assert.ok(!JSON.stringify(c.body).includes("PRIVATE"), "never the private half");
    // sent again: fleet says it is not new, and the deployer says nothing
    assert.equal(await claimPaperSigner({ dir: w.root, server: loadServer(w.root) }), "");
  } finally { w.done(); await fleet.close(); }
});

test("nothing is sent by a server that is not paired or has no signing key; a fleet that refuses or cannot be reached is a log line, never a throw", async () => {
  const fleet = await fakeFleet({ fail: true });
  const w = paired(fleet.url);
  try {
    const notPaired = world({}, { panel: { enabled: true } });
    try { assert.equal(await claimPaperSigner({ dir: notPaired.root, server: loadServer(notPaired.root) }), ""); } finally { notPaired.done(); }
    const noKey = world({}, { fleet: { url: fleet.url, keyFile: "fleet_key" } });
    try { assert.equal(await claimPaperSigner({ dir: noKey.root, server: loadServer(noKey.root) }), ""); assert.equal(fleet.claims.length, 0); } finally { noKey.done(); }
    assert.match(await claimPaperSigner({ dir: w.root, server: loadServer(w.root) }), /did not list this server's signing key \(HTTP 503: fleet is down for a moment\); it is sent again tomorrow/u);
    assert.match(await claimPaperSigner({ dir: w.root, server: loadServer(w.root), fetchImpl: () => Promise.reject(new Error("connect ECONNREFUSED")) }), /the claim was not sent \(connect ECONNREFUSED\)/u);
  } finally { w.done(); await fleet.close(); }
});

test("the deployer sends the claim when it starts, even with no shop yet, and then once a day; a new deployer process sends it again at its start", async () => {
  const fleet = await fakeFleet();
  const w = paired(fleet.url);
  try {
    assert.ok((await runDueJobs(w.ctx)).includes("paper signer"), "at start, on a server with no shop");
    assert.equal(fleet.claims.length, 1);
    assert.ok(loadState(w.root).jobs?.signerClaimAt, "saved, though a server with no shop returns early");
    assert.ok(!(await runDueJobs(w.ctx)).includes("paper signer"), "not again on the next pass");
    // a restart: a new deployer context sends it at its own start
    assert.ok((await runDueJobs({ ...w.ctx })).includes("paper signer"));
    assert.equal(fleet.claims.length, 2);
  } finally { w.done(); await fleet.close(); }
});
