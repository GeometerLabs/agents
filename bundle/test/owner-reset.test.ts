// `geometer owner reset <shop> --reason "..." --by NAME [--qr-out F]` (owner's item 2, bundle/owner-cli.ts): Geometer's reset of a shop owner's sign-in. It writes the
// admin-only reset file and replaces the panel's grants with ONE new setup QR (hashes only), prints the link once (and a PNG of the QR on request), refuses without a reason or
// a name, and is only a command line command: the panel has no route that writes the reset file. The runtime's side (voiding, sessions, the request) is tested in
// modules/channels/test/owner-control.test.ts; here the files it leaves and what the deployer hands over.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grantInFile, readOwnerGrants, readOwnerReset, setupHash } from "../../modules/channels/owner-grants.ts";
import { main } from "../geometer.ts";
import { tempServer } from "./helpers.ts";

async function geometer(root: string, ...args: string[]): Promise<{ code: number; out: string; error?: string }> {
  const out: string[] = []; const err: string[] = []; const log = console.log; const error = console.error;
  console.log = (...a: unknown[]) => out.push(a.join(" "));
  console.error = (...a: unknown[]) => err.push(a.join(" "));
  try { const code = await main([...args, "--server", root]); return { code, out: out.join("\n"), ...(err.length > 0 ? { error: err.join("\n") } : {}) }; }
  finally { console.log = log; console.error = error; }
}

test("owner reset: one new QR as a link and a PNG, the reason and the name kept in the admin's file, the old QR, card and request gone from the grants", async () => {
  const t = tempServer(); const scratch = mkdtempSync(join(tmpdir(), "owner-reset-"));
  try {
    const grants = join(t.paths.shop("glow-salon"), "owner-grants.json");
    // the Operator had made a QR, a card and (the owner holds a passkey) a request: a reset replaces the lot
    const { makeOwnerRecovery, makeOwnerSetup, requestOwnerPasskeyRemoval } = await import("../lib/pages.ts");
    const old = makeOwnerSetup(t.root, "glow-salon", new Date("2026-11-19T04:00:00Z"));
    makeOwnerRecovery(t.root, "glow-salon", new Date("2026-11-19T04:00:00Z"));
    requestOwnerPasskeyRemoval(t.root, "glow-salon", "Divya", new Date("2026-11-19T05:00:00Z"));

    const png = join(scratch, "owner.png");
    const r = await geometer(t.root, "owner", "reset", "glow-salon", "--reason", "owner lost every phone; checked on a video call", "--by", "Naval", "--qr-out", png);
    assert.equal(r.code, 0, r.out + (r.error ?? ""));
    const link = /(https:\/\/\S+\/owner\/setup\/([A-Za-z0-9_-]{43}))/u.exec(r.out);
    assert.ok(link, "the link is printed once");
    assert.match(r.out, /Every phone, setup QR, recovery code and signed-in device of the owner stops working/u);
    assert.deepEqual([...readFileSync(png).subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "a PNG of the same QR");

    const reset = readOwnerReset(readFileSync(t.paths.adminOwnerReset("glow-salon"), "utf8"))!;
    assert.deepEqual([reset.reason, reset.by], ["owner lost every phone; checked on a video call", "Naval"]);
    assert.ok(!t.paths.adminOwnerReset("glow-salon").includes(`${"shops"}${"/"}`), "not under shops/, which the panel mounts read-write");
    const text = readFileSync(grants, "utf8");
    assert.ok(!text.includes(link![2]), "only the QR's hash is kept");
    const file = readOwnerGrants(text)!;
    assert.deepEqual([file.recovery, file.pendingRemoval, file.passkeysBefore, file.setup], [undefined, undefined, undefined, undefined], "the QR, the card, the request and the old values are gone from the panel's file");
    assert.equal(reset.setup?.sha256, setupHash(link![2]), "the QR's hash is in the admin's reset file");
    assert.equal(Date.parse(reset.setup!.expiresAt) - Date.parse(reset.at), 60 * 60_000, "an hour, for the admin to hand it over");
    assert.equal(grantInFile({ kind: "setup", token: old.token }, file, Date.parse(reset.at) + 1000), "unknown", "the Operator's old QR");
  } finally { t.done(); rmSync(scratch, { recursive: true, force: true }); }
});

test("owner reset: a reason and a name are needed, the shop must exist, and nothing is written when it is refused", async () => {
  const t = tempServer();
  try {
    const resetFile = t.paths.adminOwnerReset("glow-salon");
    assert.match((await geometer(t.root, "owner", "reset", "glow-salon", "--by", "Naval")).error ?? "", /Say why/u);
    assert.match((await geometer(t.root, "owner", "reset", "glow-salon", "--reason", "owner lost every phone")).error ?? "", /Say who is resetting it/u);
    assert.match((await geometer(t.root, "owner", "reset", "nope", "--reason", "owner lost every phone", "--by", "Naval")).error ?? "", /no shop called nope/u);
    assert.match((await geometer(t.root, "owner", "wipe", "glow-salon")).error ?? "", /Usage: geometer owner reset/u);
    assert.equal(existsSync(resetFile), false);
  } finally { t.done(); }
});
