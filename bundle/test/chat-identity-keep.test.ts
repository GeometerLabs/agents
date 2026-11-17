// W2 fix (a), 17 Nov 2026: the customers' chat keys, ties and numbers (modules/channels/chat-identity.ts, chat-identity.sqlite) go through a backup and a restore with the owner's
// passkeys and alerts (bundle/backup/owner-keep.ts). A restored shop must not turn every returning customer back into a stranger. Written, not run when written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHAT_IDENTITY_FILE, openChatIdentity } from "../../modules/channels/chat-identity.ts";
import { newSoftPasskey, softRegister, softSignin } from "../../modules/channels/test/soft-authenticator.ts";
import { ownerKeepProblem, putOwnerKeep, readOwnerKeep } from "../backup/owner-keep.ts";
import type { OwnerKeep } from "../backup/owner-keep.ts";

const T0 = Date.parse("2026-11-17T10:00:00Z");
const RP = { rpId: "pages.example", origin: "https://pages.example" };
const H1 = "1".repeat(64); const H2 = "2".repeat(64); const H3 = "3".repeat(64);
const dirs: string[] = [];
const folder = () => { const d = mkdtempSync(join(tmpdir(), "geo-chatkeep-")); dirs.push(d); const data = join(d, "data"); mkdirSync(data); return data; };
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("the chat keys, the number, the phones that hold a key and the ties are in the snapshot's file, and a restored shop opens the thread with the same key", () => {
  const live = folder();
  const a = openChatIdentity(join(live, CHAT_IDENTITY_FILE));
  const p = newSoftPasskey(RP.rpId);
  const options = a.keepOptions(H1, RP, "Glow", T0) as { challenge: string; user: { id: string } };
  assert.equal(a.keep(H1, RP, softRegister(p, options, RP.origin), T0).ok, true);
  a.setNumber(H1, "919811111111", T0);
  a.tie(H2, H1, T0);
  const link = a.issueLink(H1, T0); // short-lived: not carried
  a.close();

  const keep = readOwnerKeep(live);
  assert.ok(keep?.chatIdentity, "a shop with only chat keys still has something to keep");
  assert.deepEqual([keep!.chatIdentity!.creds.length, keep!.chatIdentity!.contact.length, keep!.chatIdentity!.alias.length, keep!.chatIdentity!.users.length], [1, 1, 1, 1]);
  assert.ok(!JSON.stringify(keep).includes(link.token), "no link token is in the snapshot");
  assert.equal(ownerKeepProblem(JSON.parse(JSON.stringify(keep))), null);

  const fresh = folder();
  const put = putOwnerKeep(fresh, JSON.parse(JSON.stringify(keep)) as OwnerKeep);
  assert.equal(put.chatKeys, 1);
  const b = openChatIdentity(join(fresh, CHAT_IDENTITY_FILE));
  assert.deepEqual(b.state(H1), { keys: 1, here: true, number: true });
  assert.equal(b.resolve(H2), H1, "a tied phone is still tied");
  assert.equal(b.guestOfNumber("919811111111"), H1);
  const o = b.signinOptions(RP, T0 + 1) as { challenge: string };
  assert.deepEqual(b.signin(H3, RP, softSignin(p, o, RP.origin), T0 + 2), { ok: true, thread: H1 }, "the customer's own key opens the thread on the restored shop");
  b.close();
});

test("a restore merges: what the live file already has is left as it is, and putting the same snapshot back twice adds nothing", () => {
  const live = folder();
  const a = openChatIdentity(join(live, CHAT_IDENTITY_FILE));
  const p = newSoftPasskey(RP.rpId);
  a.keep(H1, RP, softRegister(p, a.keepOptions(H1, RP, "Glow", T0) as { challenge: string; user: { id: string } }, RP.origin), T0);
  a.close();
  const keep = readOwnerKeep(live)!;
  const target = folder();
  assert.equal(putOwnerKeep(target, keep).chatKeys, 1);
  assert.equal(putOwnerKeep(target, keep).chatKeys, 0);
  const b = openChatIdentity(join(target, CHAT_IDENTITY_FILE));
  assert.equal(b.state(H1).keys, 1);
  b.close();
});

test("a snapshot made before the chat's keys existed is still good, and a damaged chat part is refused", () => {
  const old = { schema: 1, ownerAccess: { meta: [], passkeys: [], grantsUsed: [] }, push: { meta: [], subs: [] } } as unknown as OwnerKeep;
  assert.equal(ownerKeepProblem(old), null);
  assert.deepEqual(putOwnerKeep(folder(), old).chatKeys, undefined);
  assert.match(ownerKeepProblem({ ...old, chatIdentity: { creds: [], users: "no" } } as never) ?? "", /chat identity/u);
  assert.equal(readOwnerKeep(folder()), null, "nothing to keep: nothing in the snapshot");
});
