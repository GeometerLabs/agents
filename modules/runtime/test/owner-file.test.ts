// "Get my shop's file", the runtime's side: the file the server copied into the shop's client folder is given out once, only while it has not run out, only when its bytes are the
// ones the meta describes, and "once" survives a restart (the use is written down before the bytes leave). Also the meta's own reading.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OWNER_FILE_BODY, OWNER_FILE_META, newOwnerFileId, readOwnerFileMeta } from "../../channels/owner-file.ts";
import { openOwnerFile } from "../owner-file.ts";

const dirs: string[] = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const NOW = Date.parse("2026-11-18T10:00:00Z");

function shop(o: { bytes?: Buffer; expiresInHours?: number; claim?: Buffer } = {}) {
  const client = mkdtempSync(join(tmpdir(), "of-client-"));
  const data = mkdtempSync(join(tmpdir(), "of-data-"));
  dirs.push(client, data);
  const bytes = o.bytes ?? Buffer.from("the shop's file");
  const id = newOwnerFileId();
  const meta = { schema: 1, ask: "ask_0123456789ab", id, name: "glow-shop-file-20261118.tar.gz", bytes: (o.claim ?? bytes).length, sha256: createHash("sha256").update(o.claim ?? bytes).digest("hex"), madeAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + (o.expiresInHours ?? 72) * 3_600_000).toISOString() };
  writeFileSync(join(client, OWNER_FILE_META), JSON.stringify(meta));
  writeFileSync(join(client, OWNER_FILE_BODY), bytes);
  let now = NOW;
  const open = () => openOwnerFile({ clientFolder: client, dataDir: data, now: () => now });
  return { client, data, id, meta, open, at: (ms: number) => { now = ms; } };
}

test("the file is ready, given once, and then it is taken; a restart does not give it again", () => {
  const s = shop();
  const store = s.open();
  assert.equal(store.state().state, "ready");
  const got = store.take(s.id);
  assert.equal(got?.bytes.toString(), "the shop's file");
  assert.equal(got?.meta.ask, "ask_0123456789ab");
  assert.equal(store.take(s.id), undefined, "a second use");
  assert.equal(store.state().state, "taken");
  assert.equal(s.open().take(s.id), undefined, "a restarted runtime reads the use from the data folder");
});

test("another id, and an id out of shape, open nothing and do not use the file up", () => {
  const s = shop();
  const store = s.open();
  assert.equal(store.take(newOwnerFileId()), undefined);
  assert.equal(store.take("short"), undefined);
  assert.equal(store.state().state, "ready", "a wrong try leaves the owner's file alone");
});

test("a file that ran out is not given, and its state says so", () => {
  const s = shop({ expiresInHours: 72 });
  const store = s.open();
  s.at(NOW + 72 * 3_600_000 - 1);
  assert.equal(store.state().state, "ready");
  s.at(NOW + 72 * 3_600_000);
  assert.equal(store.state().state, "expired");
  assert.equal(store.take(s.id), undefined);
});

test("bytes that are not the ones the meta describes (a half-copied file) are never handed over, and are not counted as used", () => {
  const s = shop({ claim: Buffer.from("something else entirely") });
  const store = s.open();
  assert.equal(store.take(s.id), undefined);
  assert.equal(store.state().state, "ready");
});

test("no file at all is 'none'; a meta that does not read offers nothing", () => {
  const client = mkdtempSync(join(tmpdir(), "of-empty-"));
  const data = mkdtempSync(join(tmpdir(), "of-data-"));
  dirs.push(client, data);
  assert.equal(openOwnerFile({ clientFolder: client, dataDir: data, now: () => NOW }).state().state, "none");
  assert.equal(readOwnerFileMeta("{not json"), undefined);
  assert.equal(readOwnerFileMeta(JSON.stringify({ schema: 1, id: "../../etc/passwd" })), undefined);
});
