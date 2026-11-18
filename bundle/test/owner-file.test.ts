// "Get my shop's file", the deployer's part: the owner's ask in the exported record makes the owner's file and copies it into THAT shop's own client folder; the runtime's own
// reader then gives it once; a taken or expired file is deleted at once; a failed build is told and tried again later; another shop's ask never makes this shop's file.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RETRY_MS, leaveStatusFile, readLeaveStatus, syncOwnerFiles } from "../lib/owner-file.ts";
import type { OwnerFileIO } from "../lib/owner-file.ts";
import { OWNER_FILE_BODY, OWNER_FILE_META, readOwnerFileMeta } from "../../modules/channels/owner-file.ts";
import { openOwnerFile } from "../../modules/runtime/owner-file.ts";
import { FILE_ASKED, FILE_TAKEN } from "../../modules/approvals/leave.ts";

const dirs: string[] = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const T0 = new Date("2026-11-18T10:00:00Z");
const ASK = "ask_0123456789ab";

function server(shops: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "owner-file-"));
  dirs.push(dir);
  for (const s of shops) { mkdirSync(join(dir, "generated", "shops", s, "client"), { recursive: true }); mkdirSync(join(dir, "exports", s), { recursive: true }); mkdirSync(join(dir, "shops", s), { recursive: true }); }
  const record = (shop: string, entries: unknown[]) => writeFileSync(join(dir, "exports", shop, "record.json"), JSON.stringify(entries));
  const client = (shop: string) => join(dir, "generated", "shops", shop, "client");
  let builds = 0;
  let fail: string | undefined;
  const io: OwnerFileIO = {
    async build(shop) {
      builds++;
      if (fail) return { ok: false, error: fail };
      const staged = join(dir, "shops", shop, "owner-file-staged.tar.gz");
      writeFileSync(staged, `the package of ${shop}`);
      return { ok: true, name: `geometer-export-${shop}-20261118`, staged, warnings: [] };
    },
  };
  const run = (at: Date = T0, list = shops) => syncOwnerFiles({ dir, shops: list, now: at, io });
  return { dir, record, client, run, builds: () => builds, failWith: (m?: string) => { fail = m; } };
}
const asked = (id = ASK, time = "2026-11-18T09:50:00Z", action = FILE_ASKED) => ({ seq: 1, time, action, outcome: "confirmed", refs: { ask: id, via: "page" } });
const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);

test("the owner's ask makes the file in that shop's own client folder, ready for 72 hours, and nowhere else", async () => {
  const s = server(["glow", "other"]);
  s.record("glow", [asked()]);
  s.record("other", []);
  const lines = await s.run();
  assert.equal(lines.length, 1);
  const meta = readOwnerFileMeta(readFileSync(join(s.client("glow"), OWNER_FILE_META), "utf8"))!;
  assert.equal(meta.ask, ASK);
  assert.equal(meta.expiresAt, hours(72).toISOString());
  assert.equal(readFileSync(join(s.client("glow"), OWNER_FILE_BODY), "utf8"), "the package of glow");
  assert.equal(existsSync(join(s.client("other"), OWNER_FILE_META)), false, "another shop's folder is not touched");
  assert.equal(existsSync(join(s.dir, "shops", "glow", "owner-file-staged.tar.gz")), false, "no second copy is left");
  assert.equal(readLeaveStatus(s.dir, "glow")!.file!.state, "ready");
  assert.equal(JSON.stringify(readLeaveStatus(s.dir, "glow")).includes(meta.id), false, "the status the panel reads never holds the link's id");
});

test("another shop's ask never makes this shop's file, and no ask makes none", async () => {
  const s = server(["glow", "other"]);
  s.record("glow", []);
  s.record("other", [asked()]);
  await s.run();
  assert.equal(existsSync(join(s.client("glow"), OWNER_FILE_META)), false);
  assert.equal(existsSync(join(s.client("other"), OWNER_FILE_META)), true);
});

test("the runtime's own reader gives the file once, and a second pass of the deployer does not make another", async () => {
  const s = server(["glow"]);
  s.record("glow", [asked()]);
  await s.run();
  const data = mkdtempSync(join(tmpdir(), "owner-file-data-"));
  dirs.push(data);
  const store = openOwnerFile({ clientFolder: s.client("glow"), dataDir: data, now: () => T0.getTime() });
  const meta = readOwnerFileMeta(readFileSync(join(s.client("glow"), OWNER_FILE_META), "utf8"))!;
  assert.equal(store.take(meta.id)?.bytes.toString(), "the package of glow");
  assert.equal(store.take(meta.id), undefined);
  await s.run(hours(1));
  assert.equal(s.builds(), 1, "the same ask is answered once");
});

test("once the record says the owner took it, the server's copy is deleted at once", async () => {
  const s = server(["glow"]);
  s.record("glow", [asked()]);
  await s.run();
  s.record("glow", [asked(), asked(ASK, "2026-11-18T10:05:00Z", FILE_TAKEN)]);
  await s.run(hours(1));
  assert.equal(existsSync(join(s.client("glow"), OWNER_FILE_META)), false);
  assert.equal(existsSync(join(s.client("glow"), OWNER_FILE_BODY)), false);
  assert.equal(readLeaveStatus(s.dir, "glow")!.file!.state, "taken");
});

test("a file nobody took is deleted when its 72 hours are over; a new ask makes a new one", async () => {
  const s = server(["glow"]);
  s.record("glow", [asked()]);
  await s.run();
  await s.run(hours(71));
  assert.equal(existsSync(join(s.client("glow"), OWNER_FILE_META)), true);
  await s.run(hours(72));
  assert.equal(existsSync(join(s.client("glow"), OWNER_FILE_META)), false);
  assert.equal(readLeaveStatus(s.dir, "glow")!.file!.state, "expired");
  s.record("glow", [asked(), asked("ask_aaaaaaaaaaaa", "2026-11-21T11:00:00Z")]);
  await s.run(hours(73));
  assert.equal(readOwnerFileMeta(readFileSync(join(s.client("glow"), OWNER_FILE_META), "utf8"))!.ask, "ask_aaaaaaaaaaaa");
});

test("a build that fails is told in the status and tried again only after a few minutes", async () => {
  const s = server(["glow"]);
  s.record("glow", [asked()]);
  s.failWith("The shop's record has not been exported in the keyed form yet");
  await s.run();
  assert.equal(readLeaveStatus(s.dir, "glow")!.file!.state, "problem");
  await s.run(new Date(T0.getTime() + RETRY_MS - 1));
  assert.equal(s.builds(), 1);
  s.failWith(undefined);
  await s.run(new Date(T0.getTime() + RETRY_MS));
  assert.equal(s.builds(), 2);
  assert.equal(readLeaveStatus(s.dir, "glow")!.file!.state, "ready");
});

test("a redeploy that cleared the client folder makes the same ask's file again; a shop that is not deployed is skipped", async () => {
  const s = server(["glow"]);
  s.record("glow", [asked()]);
  await s.run();
  rmSync(join(s.client("glow"), OWNER_FILE_META));
  rmSync(join(s.client("glow"), OWNER_FILE_BODY));
  await s.run(hours(1));
  assert.equal(existsSync(join(s.client("glow"), OWNER_FILE_META)), true);
  assert.equal(s.builds(), 2);
  assert.deepEqual(await s.run(hours(1), ["not-deployed"]), []);
  assert.equal(existsSync(leaveStatusFile(s.dir, "not-deployed")), false);
});
