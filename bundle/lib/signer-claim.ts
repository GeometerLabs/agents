// This server's paper signing key on Geometer's public list of signers (plan item 17b, decision 40). Who uses it: the deployer's loop (apply.ts runDueJobs), when
// it starts and once a day.
//
// A paper's summary link (modules/report/summary.ts) is checked on geometer.dev/verify against the list fleet publishes (GET /v1/paper-signers). Fleet lists a key
// only when the server shows it holds the private half: the claim modules/report/summary-sign.ts `signerClaim` makes (the key signs the deployment id and its own
// public half), sent to POST /v1/paper-signers with the server's deployment key. The deployer sends it because it is the one process that holds both keys: the
// panel's signing key (secrets/panel/signing_key) and the deployment key (geometer.json fleet.keyFile). Ops sends the heartbeat but holds no signing key, and the
// key is not copied into one more container for this.
//
// Never fatal: a server whose claim does not reach fleet runs exactly as before, and its papers say "not on Geometer's list" until a later claim gets through.
// Sending the same claim again changes nothing at fleet, so a retry is always harmless.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadPrivateKey } from "../../modules/report/sign.ts";
import { signerClaim } from "../../modules/report/summary-sign.ts";
import { panelSigningKeyFile, readSecretFile } from "./secrets.ts";
import type { ServerConfig } from "./server.ts";

/** Fleet's route for the claim (the monorepo's apps/fleet/src/paper-signers-api.ts). */
export const SIGNERS_PATH = "/v1/paper-signers";

/**
 * Send this server's claim once. Returns one line for the deployer's log, or "" when there is nothing to send: a server not paired with fleet, or with no signing
 * key yet (the panel is off, so no paper here is signed). Never throws.
 */
export async function claimPaperSigner(o: { dir: string; server: ServerConfig; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<string> {
  const { server } = o;
  if (!server.fleet) return "";
  const keyFile = panelSigningKeyFile(o.dir);
  if (!existsSync(keyFile)) return "";
  try {
    const deploymentKey = readSecretFile(resolve(o.dir, server.fleet.keyFile));
    if (!deploymentKey) return `paper signer: not sent: there is no deployment key at ${server.fleet.keyFile}, so fleet would not take the claim.`;
    const body = signerClaim(loadPrivateKey(keyFile), server.id);
    const r = await (o.fetchImpl ?? fetch)(`${server.fleet.url.replace(/\/+$/u, "")}${SIGNERS_PATH}`, {
      method: "POST", headers: { authorization: `Bearer ${deploymentKey}`, "content-type": "application/json" }, body: JSON.stringify(body),
      redirect: "error", signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
    });
    const answer = await r.json().catch(() => undefined) as { ok?: boolean; key_id?: string; new?: boolean; error?: string } | undefined;
    if (!r.ok || answer?.ok !== true) return `paper signer: fleet did not list this server's signing key (HTTP ${r.status}${answer?.error ? `: ${String(answer.error).slice(0, 160)}` : ""}); it is sent again tomorrow.`;
    return answer.new ? `paper signer: this server's signing key is now on Geometer's list (${answer.key_id}).` : "";
  } catch (e) {
    return `paper signer: the claim was not sent (${(e as Error).message.slice(0, 160)}); it is sent again tomorrow.`;
  }
}
