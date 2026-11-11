// The deployer's side of the panel's first run (plan item 14b, part 2): the server's own settings, which the panel asks for and the deployer applies.
//
// The panel cannot write geometer.json (it is mounted read-only into the panel) or reach secrets/, so it writes requests and keys as files
// (panel/server-contract.ts lists them). On every pass of `apply --watch` this module:
//   1. takes a model request: checks it (the panel's own check, again, then the bundle's whole geometer.json check), and writes geometer.json's `model`;
//   2. takes a backup request: the bucket, its endpoint and region, and the age PUBLIC key the snapshots are encrypted to, into geometer.json's `backup`;
//   3. takes the server's keys from secrets-inbox/_server/: the model's key to the model Guard's folder, the bucket's key to the backup jobs' folder, a Google
//      service account to the token refresher; each checked by shape, never repeated in a message;
//   4. makes the bucket's test write (an object written, read back, deleted) whenever the bucket's settings or key change, or the builder asks again;
//   5. writes status/_server.json: what was applied or refused and why, which keys are in place (never a key), the test's result.
// A server with no shop yet then has its own services brought up again (`up`), so the panel sees what changed (the address calendars are shared with).
//
// What it will not do: change the model of a server that already runs shops (every shop's runtime names the model; that is a deploy's job, not yet built:
// Deferred.md), or accept a model the builder hosts (B73's `model.selfHosted`) from a bundle that cannot run one, which would send that model's key to OpenAI.
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { Context } from "./deploy.ts";
import { compose, composeFile, upServer } from "./deploy.ts";
import { storeFor } from "./backup/snapshot.ts";
import * as serverLib from "./lib/server.ts";
import { loadServer, modelChosen, parseServer } from "./lib/server.ts";
import { INTAKE, readSecretFile, secretFile, writeModelKey, writeSecretFile, prepareSecretsRoot } from "./lib/secrets.ts";
import { loadState, saveState } from "./lib/state.ts";
import { stableJson, writeAtomic } from "./lib/util.ts";
import { backupChoiceProblems, modelChoiceProblems, parseBackupRequest, parseModelRequest, parseServerStatus, serverKeyShapeOk, serverSettingsPaths } from "./panel/server-contract.ts";
import type { BackupChoice, ModelChoice, Outcome, ServerSecretName, ServerStatus } from "./panel/server-contract.ts";

/**
 * Can this bundle run a model the builder hosts? B73 (agents branch model-gateway-11nov) adds `selfHostedTarget` to lib/server.ts; until it is merged here, a
 * `model.selfHosted` in geometer.json would be ignored and the model Guard would send the builder's own key to api.openai.com. So the request is refused until then.
 * Once B73 is merged this is always true, and the check can go (Deferred.md).
 */
const SELF_HOSTED_RUNS = typeof (serverLib as Record<string, unknown>).selfHostedTarget === "function";

const nowIso = (ctx: Context) => ctx.now().toISOString();
const readText = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, "utf8") : undefined);

/** One pass. Returns the lines it logged. Never throws for a bad request or key: it is refused, said in the status file, and the next pass goes on. */
export async function applyServerSettings(ctx: Context): Promise<string[]> {
  const p = serverSettingsPaths(ctx.dir);
  const lines: string[] = [];
  const say = (line: string) => { lines.push(line); ctx.log(line); };
  const before = readText(p.status);
  const status: ServerStatus = parseServerStatus(before) ?? { schema: 1, updatedAt: nowIso(ctx), requests: {}, keys: {} };
  const state = loadState(ctx.dir);
  const deployed = [...Object.entries(state.shops).filter(([, s]) => s.applied).map(([n]) => n), ...Object.entries(state.agents ?? {}).filter(([, a]) => a.applied).map(([n]) => n)];
  let refreshServices = false;

  // ---- 1. the model ----------------------------------------------------------------------------------------------------------------------------------
  const modelText = readText(p.modelRequest);
  if (modelText !== undefined) {
    const req = parseModelRequest(modelText);
    const outcome = (state_: Outcome["state"], message: string): Outcome => ({ requestId: req?.requestId ?? "unreadable", state: state_, at: nowIso(ctx), message });
    let result: Outcome;
    if (!req) result = outcome("refused", "The model request could not be read. Choose the model again in the panel.");
    else {
      const problems = modelChoiceProblems(req.model);
      const server = loadServer(ctx.dir);
      const same = stableJson(server.model) === stableJson(cleanModel(req.model));
      if (problems.length > 0) result = outcome("refused", problems.map((x) => x.message).join(" "));
      else if (req.model.selfHosted && !SELF_HOSTED_RUNS) result = outcome("refused", "This server's bundle cannot run a model you host yet (its model Guard would send your model's key to OpenAI). Update the bundle to a release with B73, then choose it again.");
      else if (deployed.length > 0 && modelChosen(server) && !same) result = outcome("refused", `This server already runs ${deployed.join(", ")}, and each shop's agent names the model it was deployed with. Changing the model of a running server is not built yet; it stays ${server.model.model}.`);
      else {
        const written = writeConfig(ctx.dir, (raw) => { raw.model = cleanModel(req.model); });
        result = written.ok ? outcome("applied", `The model is ${req.model.model}${req.model.selfHosted ? `, which you host at ${new URL(req.model.selfHosted.url).host}` : ""}. Hand in its key next.`) : outcome("refused", written.why);
        if (written.ok) refreshServices = true;
      }
    }
    rmSync(p.modelRequest, { force: true });
    status.requests.model = result;
    say(`The server's model: ${result.state}. ${result.message}`);
  }

  // ---- 2. the backup place ----------------------------------------------------------------------------------------------------------------------------
  const backupText = readText(p.backupRequest);
  if (backupText !== undefined) {
    const req = parseBackupRequest(backupText);
    const outcome = (state_: Outcome["state"], message: string): Outcome => ({ requestId: req?.requestId ?? "unreadable", state: state_, at: nowIso(ctx), message });
    let result: Outcome;
    if (!req) result = outcome("refused", "The backup request could not be read. Set the backup place again in the panel.");
    else {
      const problems = backupChoiceProblems(req.backup);
      if (problems.length > 0) result = outcome("refused", problems.map((x) => x.message).join(" "));
      else {
        const written = writeConfig(ctx.dir, (raw) => {
          const prev = (raw.backup as { snapshots?: { keepDays?: number } } | undefined)?.snapshots;
          raw.backup = { snapshots: cleanBackup(req.backup, prev?.keepDays ?? 30), ageRecipient: req.backup.ageRecipient };
        });
        result = written.ok ? outcome("applied", `Snapshots go to ${req.backup.url}, encrypted to the key you hold. The test write follows once the bucket's key is in place.`) : outcome("refused", written.why);
      }
    }
    rmSync(p.backupRequest, { force: true });
    status.requests.backup = result;
    say(`The server's backups: ${result.state}. ${result.message}`);
  }

  // ---- 3. the server's keys ----------------------------------------------------------------------------------------------------------------------------
  const waiting: NonNullable<ServerStatus["inbox"]> = [];
  if (existsSync(p.inbox)) {
    for (const name of readdirSync(p.inbox).filter((n) => !n.startsWith(".")).sort()) {
      const file = join(p.inbox, name);
      const text = readFileSync(file, "utf8");
      const server = loadServer(ctx.dir);
      if (name === "model_key") {
        if (!modelChosen(server)) { waiting.push({ name, message: "The model's key waits until the model is chosen (its file depends on the model's wire)." }); continue; }
        if (!serverKeyShapeOk("model_key", text)) { rmSync(file, { force: true }); waiting.push({ name, message: "What was handed in as the model's key is not a key's shape (spaces, line breaks, or too short), so it was not used. Hand it in again." }); continue; }
        writeModelKey(ctx.dir, server.model.wire, text.trim());
        rmSync(file, { force: true });
        status.keys.model = { at: nowIso(ctx) };
        // a model Guard already running reads its key at start: restart it, or it keeps the old one
        if (state.serviceHashes?.["g-model"]) await compose(ctx, ["restart", "g-model"], { timeoutMs: 120_000 });
        say("The model's key is in place, for the model Guard only.");
      } else if (name === "backup_key") {
        if (!serverKeyShapeOk("backup_key", text)) { rmSync(file, { force: true }); waiting.push({ name, message: "What was handed in as the bucket's key is not access-key-id:secret on one line, so it was not used. Hand it in again." }); continue; }
        prepareSecretsRoot(ctx.dir);
        writeSecretFile(secretFile(ctx.dir, "backup", "snapshots"), text.trim());
        rmSync(file, { force: true });
        status.keys.backup = { at: nowIso(ctx) };
        say("The bucket's key is in place, for the snapshot job, the drill and restore only.");
      } else if (name === "google_service_account.json") {
        const problem = INTAKE["google_service_account.json"].check(text);
        if (problem) { rmSync(file, { force: true }); waiting.push({ name, message: `${problem} It was not used. Hand it in again.` }); continue; }
        prepareSecretsRoot(ctx.dir);
        writeSecretFile(secretFile(ctx.dir, "refresher", "_server", "google_service_account.json"), text.trim());
        rmSync(file, { force: true });
        status.keys.google = { at: nowIso(ctx), clientEmail: (JSON.parse(text) as { client_email: string }).client_email };
        refreshServices = true; // the panel names this address for calendars, and learns it when its container is made again
        say(`The server-wide Google key is in place (${status.keys.google.clientEmail}).`);
      } else waiting.push({ name: name as ServerSecretName, message: "This is not a key the server takes, so it was left alone." });
    }
  }
  if (waiting.length > 0) status.inbox = waiting; else delete status.inbox;

  // ---- 4. the bucket's test write ----------------------------------------------------------------------------------------------------------------------
  const server = loadServer(ctx.dir);
  const key = readSecretFile(secretFile(ctx.dir, "backup", "snapshots"));
  if (server.backup && key && server.backup.snapshots.url.startsWith("s3://")) {
    const digest = createHash("sha256").update(`${stableJson(server.backup)}\n${createHash("sha256").update(key).digest("hex")}\n${status.requests.backup?.requestId ?? ""}`).digest("hex");
    const fresh = loadState(ctx.dir);
    if (fresh.backupTestFor !== digest) {
      status.backupTest = { at: nowIso(ctx), ...(await testBucket(server.backup.snapshots, key, ctx.now())) };
      fresh.backupTestFor = digest;
      saveState(ctx.dir, fresh);
      say(`The bucket's test write: ${status.backupTest.ok ? "passed" : "FAILED"}. ${status.backupTest.detail}`);
    }
  }

  // ---- 5. the services, and what the panel reads ------------------------------------------------------------------------------------------------------
  if (refreshServices && deployed.length === 0 && existsSync(composeFile(ctx.dir))) {
    try { await upServer(ctx); } catch (e) { say(`The server's own services were not brought up again: ${(e as Error).message}`); }
  }
  status.updatedAt = before === undefined || lines.length > 0 ? nowIso(ctx) : status.updatedAt;
  const text = stableJson(status);
  if (text !== before) writeAtomic(p.status, text);
  return lines;
}

/** Only the fields the panel may set, in a fixed order: nothing else the request might carry reaches geometer.json. */
function cleanModel(m: ModelChoice): ModelChoice {
  return {
    wire: m.wire, model: m.model,
    ...(m.upstream ? { upstream: m.upstream } : {}), ...(m.path ? { path: m.path } : {}), ...(m.provider ? { provider: m.provider } : {}),
    ...(m.selfHosted ? { selfHosted: { url: m.selfHosted.url, ...(m.selfHosted.rate ? { rate: { inputUsdPerMillion: m.selfHosted.rate.inputUsdPerMillion, outputUsdPerMillion: m.selfHosted.rate.outputUsdPerMillion } } : {}) } } : {}),
  };
}

function cleanBackup(b: BackupChoice, keepDays: number): Record<string, unknown> {
  return { url: b.url, ...(b.endpoint ? { endpoint: b.endpoint.replace(/\/+$/u, "") } : {}), ...(b.region ? { region: b.region } : {}), keepDays };
}

/** Change geometer.json, but only to something the bundle's own check passes as a whole; otherwise nothing is written and the reason is returned. */
function writeConfig(dir: string, change: (raw: Record<string, unknown>) => void): { ok: true } | { ok: false; why: string } {
  const path = resolve(dir, "geometer.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  change(raw);
  const checked = parseServer(raw);
  if (checked.errors.length > 0) return { ok: false, why: `geometer.json would not be usable: ${checked.errors.join(" ")}` };
  writeAtomic(path, stableJson(raw));
  return { ok: true };
}

/**
 * Write a small object with the bucket's key, read it back, and delete it. A key that may not delete passes (the bucket's lifecycle rule removes old snapshots,
 * and the test object with them), and says so. The store's errors name the bucket and the HTTP answer, never the key (backup/store.ts).
 */
async function testBucket(target: { url: string; endpoint?: string; region?: string }, keyText: string, now: Date): Promise<{ ok: boolean; detail: string }> {
  const short = (e: unknown) => String((e as Error).message ?? e).slice(0, 300);
  let store;
  try { store = storeFor(target, keyText); } catch (e) { return { ok: false, detail: short(e) }; }
  const name = `geometer-test/${now.toISOString().replace(/[:.]/gu, "-")}-${randomBytes(4).toString("hex")}.txt`;
  const body = Buffer.from(`Geometer's test write from this server, ${now.toISOString()}. It can be deleted.\n`);
  try { await store.put(name, body); } catch (e) { return { ok: false, detail: `Writing to ${target.url} failed: ${short(e)}` }; }
  let back: Buffer | undefined;
  try { back = await store.get(name); } catch (e) { return { ok: false, detail: `Written, but reading it back failed (the weekly restore drill needs to read): ${short(e)}` }; }
  if (!back || !back.equals(body)) return { ok: false, detail: "Written, but reading it back gave something else." };
  try { await store.delete(name); } catch { return { ok: true, detail: `Written and read back at ${target.url}. The key may not delete, so the test object stays until the bucket's lifecycle rule removes it (set one: 30 days or more).` }; }
  return { ok: true, detail: `Written, read back and deleted at ${target.url}.` };
}
