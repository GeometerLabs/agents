// Issuing an agent's go-live certificate from a crash test, and writing down which version it was issued for. Used by `geometer agent go-live` and by an `update` that moves an agent.
// The certificate goes to exports/<agent>/ (where `agent report` looks for it, so the monthly report can say what the go-live checks ran on) and, when asked, to a folder of the builder's.
import { existsSync } from "node:fs";
import type { Context } from "../../deploy.ts";
import { secretFile } from "../../lib/secrets.ts";
import { serverPaths } from "../../lib/server.ts";
import { loadState, saveState, shopIndex } from "../../lib/state.ts";
import { loadPrivateKey } from "../../../modules/report/sign.ts";
import { readAgent } from "../folder.ts";
import { writeAgentCertificate } from "./certificate.ts";
import type { CrashResult } from "./run.ts";
import { writeInService } from "../requests.ts";

export interface Issued { files: string[]; code: string; text: string; signed: boolean }

// Writes the certificate for a crash-test result and notes which agent version it was for. Signs it when the panel's key exists; otherwise issues it unsigned and says so, never a signature that is not there.
export function issueGoLive(ctx: Context, name: string, result: CrashResult, extraOut?: string): Issued {
  const folder = readAgent(ctx.dir, name);
  if (!folder.settings) throw new Error(`${name}'s settings are not usable: ${folder.problems.join(" ")}`);
  const keyFile = secretFile(ctx.dir, "panel", "signing_key");
  const key = existsSync(keyFile) ? loadPrivateKey(keyFile) : undefined;
  const input = { settings: folder.settings, agent: name, result, issuedAt: ctx.now().getTime() };
  const made = writeAgentCertificate({ ...input, out: serverPaths(ctx.dir).exportsOf(name), ...(key ? { key } : {}) });
  const files = [...made.files];
  if (extraOut) files.push(...writeAgentCertificate({ ...input, out: extraOut, ...(key ? { key } : {}) }).files);
  return { files, code: made.code, text: made.text, signed: key !== undefined };
}

/** The version "in service" as far as Geometer knows: the one it last crash-tested with everything holding. Read by the next `update`. */
export function recordService(ctx: Context, name: string, result: CrashResult, code: string): void {
  const state = loadState(ctx.dir);
  const agents = (state.agents ??= {});
  // an agent that has not been deployed yet has no entry: make one the way a deploy would (the network index is kept for its life)
  agents[name] ??= { index: shopIndex(state, name), guards: {} };
  agents[name].service = { version: result.version, at: ctx.now().toISOString(), held: result.held, of: result.total, code };
  saveState(ctx.dir, state);
  writeInService(ctx.dir, name); // the panel's copy (agent/requests.ts)
}
