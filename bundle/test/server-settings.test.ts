// The deployer's side of the panel's first run (plan item 14b, part 2a: bundle/server-settings.ts), against the fake Docker of world.ts and a bucket in memory
// behind fetch: a model request written into geometer.json only when the bundle's own check passes; a model the builder hosts refused while this bundle cannot
// run one; the model of a server that runs shops left alone; each key moved to its one container and deleted from the inbox, the model's key only once the model
// is chosen; the bucket's test write (written, read back, deleted) made again only when something changes; and status/_server.json, which never holds a key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyServerSettings } from "../server-settings.ts";
import * as serverLib from "../lib/server.ts";
import { loadServer } from "../lib/server.ts";
import { loadState, saveState } from "../lib/state.ts";
import { secretFile } from "../lib/secrets.ts";
import { serverSettingsPaths } from "../panel/server-contract.ts";
import { generateIdentity } from "../backup/age.ts";
import { world } from "./world.ts";

const KEY = "sk-test-0123456789abcdef";
const BUCKET_KEY = "GOOG1EXAMPLEKEY:secretpart0123456789abcdef";
const by = { id: "acc_1", name: "Arjun", role: "builder" };
const request = (kind: "model" | "backup", body: unknown, id = `${kind}_0123456789abcdef`) => JSON.stringify({ schema: 1, requestId: id, requestedAt: "2026-11-04T10:00:00Z", requestedBy: by, [kind]: body });

/** A server folder with no model and no shop yet (as the one-step install leaves it). */
function fresh() {
  const w = world({});
  const raw = JSON.parse(readFileSync(w.paths.config, "utf8")) as Record<string, unknown>;
  delete raw.model;
  writeFileSync(w.paths.config, JSON.stringify(raw));
  const p = serverSettingsPaths(w.root);
  mkdirSync(join(w.root, "requests"), { recursive: true });
  const put = (name: string, text: string) => { mkdirSync(p.inbox, { recursive: true }); writeFileSync(join(p.inbox, name), text); };
  const status = () => JSON.parse(readFileSync(p.status, "utf8"));
  return { w, p, put, status };
}

/** A bucket in memory behind fetch, for the test write. `mayDelete` false: a create-only key. */
function bucket(o: { mayDelete?: boolean; failPut?: boolean } = {}) {
  const objects = new Map<string, Buffer>();
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}`);
    if (method === "PUT") { if (o.failPut) return new Response("AccessDenied", { status: 403 }); objects.set(url.pathname, Buffer.from(init!.body as Uint8Array)); return new Response("", { status: 200 }); }
    if (method === "GET") { const b = objects.get(url.pathname); return b ? new Response(b, { status: 200 }) : new Response("", { status: 404 }); }
    if (method === "DELETE") { if (o.mayDelete === false) return new Response("AccessDenied", { status: 403 }); objects.delete(url.pathname); return new Response("", { status: 204 }); }
    return new Response("", { status: 400 });
  }) as typeof fetch;
  return { objects, calls, restore: () => { globalThis.fetch = real; } };
}

test("a model request is checked, written into geometer.json, and said in the status file; a bad one is refused and changes nothing", async () => {
  const { w, p, status } = fresh();
  try {
    writeFileSync(p.modelRequest, request("model", { wire: "openai", model: "gpt 4o" }));
    await applyServerSettings(w.ctx);
    assert.equal(status().requests.model.state, "refused");
    assert.match(status().requests.model.message, /model's name is missing/u);
    assert.equal(loadServer(w.root).model.model, "", "nothing was written");
    assert.ok(!existsSync(p.modelRequest), "a refused request is taken away too");
    writeFileSync(p.modelRequest, request("model", { wire: "anthropic", model: "claude-haiku-4-5", extra: "x" }));
    await applyServerSettings(w.ctx);
    assert.match(status().requests.model.message, /"extra", which this panel does not set/u);
    writeFileSync(p.modelRequest, request("model", { wire: "openai", model: "gpt-4o-mini" }));
    await applyServerSettings(w.ctx);
    assert.equal(status().requests.model.state, "applied");
    assert.deepEqual(loadServer(w.root).model, { wire: "openai", model: "gpt-4o-mini" });
  } finally { w.done(); }
});

test("a model the builder hosts is refused while this bundle cannot run one (its key would go to OpenAI), and applied once it can", async () => {
  const { w, p, status } = fresh();
  try {
    writeFileSync(p.modelRequest, request("model", { wire: "openai", model: "llama-3.1-8b", selfHosted: { url: "https://models.example.in/v1" } }));
    await applyServerSettings(w.ctx);
    const runs = typeof (serverLib as Record<string, unknown>).selfHostedTarget === "function";
    if (runs) assert.equal(status().requests.model.state, "applied");
    else {
      assert.equal(status().requests.model.state, "refused");
      assert.match(status().requests.model.message, /cannot run a model you host yet/u);
      assert.equal(loadServer(w.root).model.model, "");
    }
  } finally { w.done(); }
});

test("the model of a server that already runs shops is left as it is", async () => {
  const { w, p, status } = fresh();
  try {
    writeFileSync(p.modelRequest, request("model", { wire: "openai", model: "gpt-4o-mini" }));
    await applyServerSettings(w.ctx);
    const state = loadState(w.root);
    state.shops["glow-salon"] = { index: 1, guards: {}, lockHistory: [], applied: {} as never };
    saveState(w.root, state);
    writeFileSync(p.modelRequest, request("model", { wire: "openai", model: "gpt-4.1-mini" }, "model_fedcba9876543210"));
    await applyServerSettings(w.ctx);
    assert.equal(status().requests.model.state, "refused");
    assert.match(status().requests.model.message, /already runs glow-salon.*stays gpt-4o-mini/u);
    assert.equal(loadServer(w.root).model.model, "gpt-4o-mini");
  } finally { w.done(); }
});

test("the model's key waits for the model, then goes to the model Guard only; a key of the wrong shape is dropped and said by name, never repeated", async () => {
  const { w, p, put, status } = fresh();
  try {
    put("model_key", `${KEY}\n`);
    await applyServerSettings(w.ctx);
    assert.ok(existsSync(join(p.inbox, "model_key")), "it waits");
    assert.match(status().inbox[0].message, /waits until the model is chosen/u);
    writeFileSync(p.modelRequest, request("model", { wire: "openai", model: "gpt-4o-mini" }));
    await applyServerSettings(w.ctx);
    await applyServerSettings(w.ctx); // the pass after: the model is chosen now
    assert.equal(readFileSync(secretFile(w.root, "g-model", "model_authorization"), "utf8").trim(), `Bearer ${KEY}`);
    assert.ok(!existsSync(join(p.inbox, "model_key")));
    assert.ok(status().keys.model.at);
    put("model_key", "two words");
    await applyServerSettings(w.ctx);
    assert.match(status().inbox[0].message, /not a key's shape/u);
    assert.ok(!readFileSync(p.status, "utf8").includes(KEY) && !readFileSync(p.status, "utf8").includes("two words"), "no key in the status file");
  } finally { w.done(); }
});

test("the backup place and its key: geometer.json gets the bucket and the public key, the key goes to the backup jobs, and the test write is made once per change", async () => {
  const { w, p, put, status } = fresh();
  const b = bucket();
  try {
    const age = generateIdentity();
    writeFileSync(p.backupRequest, request("backup", { url: "s3://my-bucket/snapshots", endpoint: "https://storage.example.com", ageRecipient: age.recipient }));
    put("backup_key", BUCKET_KEY);
    await applyServerSettings(w.ctx);
    const server = loadServer(w.root);
    assert.deepEqual(server.backup, { snapshots: { url: "s3://my-bucket/snapshots", endpoint: "https://storage.example.com", keepDays: 30 }, ageRecipient: age.recipient });
    assert.equal(readFileSync(secretFile(w.root, "backup", "snapshots"), "utf8").trim(), BUCKET_KEY);
    const s = status();
    assert.equal(s.backupTest.ok, true, s.backupTest.detail);
    assert.match(s.backupTest.detail, /Written, read back and deleted at s3:\/\/my-bucket\/snapshots/u);
    assert.deepEqual(b.calls.map((c) => c.split(" ")[0]), ["PUT", "GET", "DELETE"]);
    assert.ok(b.calls[0].startsWith("PUT /my-bucket/snapshots/geometer-test/"));
    assert.equal(b.objects.size, 0, "the test object is gone");
    await applyServerSettings(w.ctx);
    assert.equal(b.calls.length, 3, "nothing changed, so no second test");
    writeFileSync(p.backupRequest, request("backup", { url: "s3://my-bucket/snapshots", endpoint: "https://storage.example.com", ageRecipient: age.recipient }, "backup_fedcba9876543210"));
    await applyServerSettings(w.ctx);
    assert.equal(b.calls.length, 6, "asked again (Test the bucket again): tested again");
    for (const secret of [BUCKET_KEY, age.identity]) assert.ok(!readFileSync(p.status, "utf8").includes(secret));
  } finally { b.restore(); w.done(); }
});

test("a key that may not delete passes and says the lifecycle rule removes the test object; a key that may not write fails, in the bucket's words", async () => {
  const age = generateIdentity();
  for (const [o, ok, said] of [[{ mayDelete: false }, true, /may not delete, so the test object stays until the bucket's lifecycle rule removes it/u], [{ failPut: true }, false, /Writing to s3:\/\/my-bucket failed: .*403/u]] as const) {
    const { w, p, put, status } = fresh();
    const b = bucket(o);
    try {
      writeFileSync(p.backupRequest, request("backup", { url: "s3://my-bucket", ageRecipient: age.recipient }));
      put("backup_key", BUCKET_KEY);
      await applyServerSettings(w.ctx);
      assert.equal(status().backupTest.ok, ok);
      assert.match(status().backupTest.detail, said);
    } finally { b.restore(); w.done(); }
  }
});

test("a server-wide Google key goes to the token refresher; on a server with no shop, its own services are brought up again so the panel learns the address", async () => {
  const { w, put, status } = fresh();
  try {
    mkdirSync(join(w.root, "generated"), { recursive: true });
    writeFileSync(join(w.root, "generated", "compose.yaml"), "services: {}\n");
    put("google_service_account.json", JSON.stringify({ type: "service_account", client_email: "shops@p.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n", token_uri: "https://oauth2.googleapis.com/token" }));
    await applyServerSettings(w.ctx);
    assert.equal(status().keys.google.clientEmail, "shops@p.iam.gserviceaccount.com");
    assert.ok(existsSync(secretFile(w.root, "refresher", "_server", "google_service_account.json")));
    assert.ok(w.calls.some((c) => c.args.join(" ").includes("up -d --remove-orphans")), "up ran");
    put("google_service_account.json", "{\"not\": \"a key\"}");
    await applyServerSettings(w.ctx);
    assert.match(status().inbox[0].message, /google_service_account\.json must be the service account's key file/u);
  } finally { w.done(); }
});
