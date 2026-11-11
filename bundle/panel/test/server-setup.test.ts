// The panel's first run on a builder's server (plan item 14b, part 2a), through a real panel and a small browser: only a builder, only on their own server;
// the model chosen as a request (never geometer.json), its key and the bucket's key through the write-only inbox (never in a request or a page); the backup
// key pair made here, its secret half shown and downloadable until the builder types its last characters back, then deleted; Google optional. And the
// panel at phone width: no inline style (the CSP never let one apply), the open tab marked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recipientOf } from "../../backup/age.ts";
import { serverSettingsPaths } from "../server-contract.ts";
import { boot } from "./helpers.ts";

const KEY = "sk-test-0123456789abcdef";
const BUCKET_KEY = "GOOG1EXAMPLEKEY:secretpart0123456789abcdef";
const GOOGLE = JSON.stringify({ type: "service_account", client_email: "shops@my-project.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n", token_uri: "https://oauth2.googleapis.com/token" });
const read = (path: string) => readFileSync(path, "utf8");

test("only a builder, and only on their own server, sees This server", async () => {
  const b = await boot({}, { key: true });
  try {
    const arjun = await b.account("arjun", "builder");
    const divya = await b.account("divya", "partner");
    assert.equal((await arjun.get("/server")).status, 200);
    assert.equal((await divya.get("/server")).status, 404);
    assert.equal((await divya.req("GET", "/server/backup-key")).status, 404);
    const shops = await arjun.get("/shops");
    assert.match(shops.plain, /Finish setting up this server first/u);
    assert.doesNotMatch((await divya.get("/shops")).plain, /Finish setting up this server/u);
  } finally { await b.close(); }
  const hosted = await boot({}, { mode: "hosted" });
  try {
    const ops = await hosted.account("ops", "builder");
    assert.equal((await ops.get("/server")).status, 404, "Geometer's hosted panel sets its server up by hand");
  } finally { await hosted.close(); }
});

test("the model is a request the deployer applies, and its key goes only to the write-only inbox", async () => {
  const b = await boot({}, { key: true });
  try {
    const arjun = await b.account("arjun", "builder");
    const p = serverSettingsPaths(b.dir);
    const bad = await arjun.post("/server/model", { kind: "openai", model: "gpt 4o", key: "has a space in it" }, "/server");
    assert.equal(bad.status, 400);
    assert.match(bad.plain, /model's name is missing, or has spaces/u);
    assert.match(bad.plain, /key has spaces or line breaks/u);
    assert.ok(!existsSync(p.modelRequest), "nothing is asked for while a field is wrong");
    const ok = await arjun.post("/server/model", { kind: "openai", model: "gpt-4o-mini", key: KEY }, "/server");
    assert.equal(ok.status, 303);
    assert.equal(ok.location, "/server?saved=model");
    const req = JSON.parse(read(p.modelRequest));
    assert.deepEqual(req.model, { wire: "openai", model: "gpt-4o-mini" });
    assert.equal(req.requestedBy.name, "ARJUN");
    assert.ok(!read(p.modelRequest).includes(KEY), "the key is not in the request");
    assert.equal(read(join(p.inbox, "model_key")).trim(), KEY);
    assert.equal(statSync(join(p.inbox, "model_key")).mode & 0o777, 0o600);
    const page = await arjun.get("/server?saved=model");
    assert.match(page.plain, /Waiting for the server to apply it/u);
    assert.ok(!page.text.includes(KEY), "the key is never put back into a page");

    // a model the builder hosts, and another provider: the shapes geometer.json takes (B73's selfHosted)
    await arjun.post("/server/model", { kind: "own", model: "llama-3.1-8b", url: "https://models.example.in/v1/", rateIn: "0.1", rateOut: "0.2" }, "/server");
    assert.deepEqual(JSON.parse(read(p.modelRequest)).model, { wire: "openai", model: "llama-3.1-8b", selfHosted: { url: "https://models.example.in/v1", rate: { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.2 } } });
    const plain = await arjun.post("/server/model", { kind: "own", model: "llama", url: "http://models.example.in/v1" }, "/server");
    assert.equal(plain.status, 400);
    assert.match(plain.plain, /Plain http to models\.example\.in would send the model's key unencrypted/u);
    await arjun.post("/server/model", { kind: "other", model: "gemini-2.0-flash", upstream: "generativelanguage.googleapis.com:443", path: "/v1beta/openai/chat/completions" }, "/server");
    assert.deepEqual(JSON.parse(read(p.modelRequest)).model, { wire: "openai", model: "gemini-2.0-flash", upstream: "generativelanguage.googleapis.com:443", path: "/v1beta/openai/chat/completions" });

    // what the deployer said, read from status/_server.json
    writeFileSync(p.status, JSON.stringify({ schema: 1, updatedAt: "2026-11-04T05:00:00Z", requests: { model: { requestId: "model_x", state: "refused", at: "2026-11-04T05:00:00Z", message: "This server already runs glow-salon." } }, keys: {} }));
    rmSync(p.modelRequest); // the deployer took the request
    assert.match((await arjun.get("/server")).plain, /This server already runs glow-salon\./u);
  } finally { await b.close(); }
});

test("backups: a key pair made here, its secret half shown until the builder types its end back, then deleted; the bucket's key only in the inbox", async () => {
  const b = await boot({}, { key: true });
  try {
    const arjun = await b.account("arjun", "builder");
    const p = serverSettingsPaths(b.dir);
    const noKey = await arjun.post("/server/backup", { url: "s3://my-bucket/snapshots", endpoint: "https://storage.googleapis.com", age: "new" }, "/server");
    assert.equal(noKey.status, 400);
    assert.match(noKey.plain, /bucket's key is needed once/u);
    const made = await arjun.post("/server/backup", { url: "s3://my-bucket/snapshots", endpoint: "https://storage.googleapis.com", bucketKey: BUCKET_KEY, age: "new" }, "/server");
    assert.equal(made.status, 303);
    assert.equal(made.location, "/server/backup-key", "the secret half is shown next, before anything else");
    const req = JSON.parse(read(p.backupRequest));
    assert.match(req.backup.ageRecipient, /^age1[02-9ac-hj-np-z]{58}$/u);
    assert.deepEqual({ url: req.backup.url, endpoint: req.backup.endpoint }, { url: "s3://my-bucket/snapshots", endpoint: "https://storage.googleapis.com" });
    assert.equal(read(join(p.inbox, "backup_key")).trim(), BUCKET_KEY);
    assert.ok(!read(p.backupRequest).includes(BUCKET_KEY));

    const page = await arjun.get("/server/backup-key");
    const identity = /(AGE-SECRET-KEY-1[0-9A-Z]+)/u.exec(page.text)?.[1];
    assert.ok(identity, "the secret half is on its own page");
    assert.equal(recipientOf(identity), req.backup.ageRecipient, "it is the pair of the public half the backups are locked with");
    assert.equal(page.headers.get("cache-control"), "no-store");
    const file = await arjun.bytes("/server/backup-key.txt");
    assert.equal(file.status, 200);
    assert.match(file.headers.get("content-disposition") ?? "", /^attachment; filename="geometer-backup-key/u);
    assert.ok(file.body.toString().includes(identity));
    // sealed in the panel's store with its data key: no file under panel/ holds it in the clear
    const clear = (dir: string): boolean => readdirSync(dir, { withFileTypes: true }).some((e) => e.isDirectory() ? clear(join(dir, e.name)) : read(join(dir, e.name)).includes(identity));
    assert.ok(!clear(join(b.dir, "panel")), "the secret half is not in the clear on disk");
    assert.match((await arjun.get("/server")).plain, /backup key's secret half is still on this server/u);
    const own = await arjun.post("/server/backup", { url: "s3://my-bucket/snapshots", age: "own", ageRecipient: req.backup.ageRecipient }, "/server");
    assert.equal(own.status, 400, "a held pair is never dropped for another key before it is confirmed");

    // a second save uses the same pair: no new key the builder has not seen
    await arjun.post("/server/backup", { url: "s3://my-bucket/other", endpoint: "https://storage.googleapis.com", age: "new" }, "/server");
    assert.equal(JSON.parse(read(p.backupRequest)).backup.ageRecipient, req.backup.ageRecipient);

    const wrong = await arjun.post("/server/backup-key/confirm", { last: "ZZZZZZ", off: "yes" }, "/server/backup-key");
    assert.equal(wrong.status, 400);
    assert.match(wrong.plain, /not the last 6 characters/u);
    const unticked = await arjun.post("/server/backup-key/confirm", { last: identity.slice(-6) }, "/server/backup-key");
    assert.equal(unticked.status, 400);
    const done = await arjun.post("/server/backup-key/confirm", { last: identity.slice(-6).toLowerCase(), off: "yes" }, "/server/backup-key");
    assert.equal(done.status, 303);
    assert.equal((await arjun.bytes("/server/backup-key.txt")).status, 404, "the panel stops offering it");
    const after = await arjun.get("/server/backup-key");
    assert.ok(!after.text.includes(identity));
    assert.match(after.plain, /deleted its copy/u);
  } finally { await b.close(); }
});

test("Google is optional and goes to the inbox; a file that is not a service account's key is refused without being repeated", async () => {
  const b = await boot({}, { key: true });
  try {
    const arjun = await b.account("arjun", "builder");
    const p = serverSettingsPaths(b.dir);
    const bad = await arjun.post("/server/google", { google: "{\"type\": \"user\", \"secret\": \"do-not-show\"}" }, "/server");
    assert.equal(bad.status, 400);
    assert.ok(!bad.text.includes("do-not-show"));
    assert.equal((await arjun.post("/server/google", { google: GOOGLE }, "/server")).status, 303);
    assert.match(read(join(p.inbox, "google_service_account.json")), /shops@my-project/u);
  } finally { await b.close(); }
});

test("the phone pass: no inline style anywhere (the CSP lets in only the nonce'd sheet), the open tab is marked, and the sheet keeps a phone from scrolling sideways", async () => {
  const dir = new URL("../", import.meta.url).pathname;
  for (const f of readdirSync(dir).filter((n) => /^views.*\.ts$/u.test(n))) assert.doesNotMatch(read(join(dir, f)), /style="/u, `${f} has an inline style`);
  const css = read(join(dir, "panel.css"));
  for (const rule of [/@media \(max-width: 420px\)/u, /\.tabbar \.tab:focus-visible/u, /main \{ overflow-wrap: anywhere; \}/u, /\.field textarea, \.field input, \.field select \{ font-size: 16px/u, /\.tab\[aria-current="page"\]/u]) assert.match(css, rule);
  const b = await boot({}, { key: true });
  try {
    const arjun = await b.account("arjun", "builder");
    const page = await arjun.get("/shops");
    assert.match(page.text, /<a class="tab" href="\/shops" aria-current="page">/u);
    assert.match(page.text, /<meta name="viewport" content="width=device-width, initial-scale=1/u);
  } finally { await b.close(); }
});
