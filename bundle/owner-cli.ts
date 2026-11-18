// `geometer owner reset <shop> --reason "..." --by NAME [--qr-out <file>]`: Geometer's reset of a shop owner's sign-in (owner's item 2, "no Operator holds a shop hostage"),
// for a dispute, or an Operator who kept the first setup QR. A command line command and nothing else on purpose, like `shop budget` (budget-cli.ts): the panel is the
// Operator's, and the panel has no route that writes this file. On a builder's own server the builder is the server's admin and runs it.
//
// What it does, in one step: writes shops/<shop>/owner-reset.json ({at, reason, by}) and replaces the panel's owner-grants.json with ONE new setup QR (one use, an hour).
// The deployer hands both to the shop's runtime within a pass (10 s); the runtime, which is the authority (modules/channels/owner-access.ts), then sets passkeysBefore to the
// reset moment, voids the old setup QR, every recovery code (the Operator's card and the owner's own) and every "add a phone" link, ends every owner session, cancels any
// pending removal request, and writes the reset in the shop's record. The panel shows the Operator "Geometer reset the owner's sign-in on <day>: <reason>".
// The new QR is shown ONCE here: as a link, and as a PNG when --qr-out names a file. Only its hash is kept on the server.
//
// It does NOT check who is asking: whoever can run commands on the server is its admin. Geometer's own rule for a request to hello@geometer.dev (checking the owner is the owner
// before running it) is in bundle/Explanation.md, "Who controls the owner's sign-in".
import { existsSync, writeFileSync } from "node:fs";
import { textQrPng } from "../modules/qr/png.ts";
import { ownerBaseOf, readPageSettings, readPagesStatus, resetOwnerSignin } from "./lib/pages.ts";
import { loadServer, publicUrl, serverPaths } from "./lib/server.ts";
import { shopNameProblem } from "./lib/util.ts";

export interface OwnerResetFlags { reason?: string; by?: string; qrOut?: string }

export function ownerCommand(dir: string, sub: string | undefined, shop: string | undefined, flags: OwnerResetFlags, io: { log: (line: string) => void; now: () => Date }): number {
  if (sub !== "reset") throw new Error('Usage: geometer owner reset <shop> --reason "..." --by NAME [--qr-out <file.png>]');
  const problem = shop === undefined ? 'Say which shop: geometer owner reset <shop> --reason "..." --by NAME [--qr-out <file.png>]' : shopNameProblem(shop);
  if (problem || shop === undefined) throw new Error(problem as string);
  if (!existsSync(serverPaths(dir).shop(shop))) throw new Error(`There is no shop called ${shop} on this server.`);
  if (!flags.reason || flags.reason.trim().length < 5) throw new Error('Say why, in a line the Operator will read in the panel: --reason "owner lost every phone; checked on a video call".');
  if (!flags.by || flags.by.trim() === "") throw new Error("Say who is resetting it: --by NAME.");
  const server = loadServer(dir);
  const now = io.now();
  // the address in the QR is the owner's view's own (the runtime checks the passkey against that origin), worked out as the panel and the deployer work it out
  const settings = readPageSettings(dir, shop, server.panel.mode === "hosted");
  const base = ownerBaseOf({ publicUrl: publicUrl(server), ...(server.pages ? { pagesDomain: server.pages.domain } : {}), shop, settings, status: readPagesStatus(dir, shop) });
  const made = resetOwnerSignin(dir, shop, { reason: flags.reason.trim(), by: flags.by.trim(), now });
  const link = `${base}/setup/${made.token}`;
  io.log(`The owner's sign-in of ${shop} is reset. Every phone, setup QR, recovery code and signed-in device of the owner stops working, and any pending removal request is cancelled.`);
  io.log(`The deployer hands this to the shop's runtime within about 15 seconds; scan or open the link only after that, once. It works once, until ${made.expiresAt.toISOString().slice(11, 16)} UTC, for this shop only:`);
  io.log(link);
  if (flags.qrOut) {
    writeFileSync(flags.qrOut, textQrPng(link), { mode: 0o600 });
    io.log(`The same QR as a picture: ${flags.qrOut} (delete it after the owner has scanned it).`);
  }
  io.log("The Operator sees \"Geometer reset the owner's sign-in\" with your reason in the panel. The shop's record says it too.");
  return 0;
}
