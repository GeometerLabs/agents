// `geometer agent add / check / deploy`: the Guards go in front of the services an agent someone else wrote calls. The same checked deploy as a shop's: every spec is compiled by the
// real compiler, every tripwire must pass (a rule that would let a forbidden call through refuses the deploy, by name, and nothing is started), the files are written, only what
// changed is brought up, and the number in the certificate ("N of M limits proven to bite") is read from the RUNNING Guards. There is no runtime: the agent runs wherever its
// builder runs it, and calls the Guards by the addresses printed here.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Refused, bringUp, compileAndVerify, contentHash, guardLicenceOn, licenceFor, ops, ownNumbersOf, proveRunning, renewRelayCredential, serverProblems, writeServer } from "../deploy.ts";
import type { Context, PreparedGuard } from "../deploy.ts";
import { agentBaseUrl } from "../generate/compose.ts";
import type { GuardKind } from "../generate/guards.ts";
import { names } from "../generate/shop.ts";
import { noSecretsIn, provenLine } from "../generate/rules.ts";
import { ensureAgentLabelKey, ensureSecret, prepareSecretsRoot, readSecretFile, secretFile, takeSecrets, writeSecretFile } from "../lib/secrets.ts";
import { loadServer, publicUrl, serverPaths } from "../lib/server.ts";
import type { ServerConfig } from "../lib/server.ts";
import { loadState, saveState, shopIndex } from "../lib/state.ts";
import type { State } from "../lib/state.ts";
import { readStatus, refusalMessage, updateStatus } from "../lib/status.ts";
import type { GuardProof } from "../lib/status.ts";
import { ensureDir, mintGuardToken, mintSecret, sha256Hex, shopNameProblem, stableJson, writeAtomic } from "../lib/util.ts";
import type { Problem } from "../lib/util.ts";
import { agentFromFlags, agentGuardPart, readAgent } from "./folder.ts";
import type { AgentFlags, AgentFolder } from "./folder.ts";
import { RECORD_READS, agentNames, planAgent } from "./plan.ts";
import type { AgentPlan } from "./plan.ts";

const sha = (value: string) => sha256Hex(value);
const have = (dir: string, container: string, ...file: string[]) => !!readSecretFile(secretFile(dir, container, ...file));
type Kind = Exclude<GuardKind, "model">;

// ---- agent add ---------------------------------------------------------------------------------------------------------------------------

export interface AgentConnection {
  /** The addresses the builder's agent calls instead of the services themselves. */
  baseUrls: Partial<Record<Kind, string>>;
  /** The one credential for all of them. It replaces the services' own keys, which only the Guards hold. */
  credential: string | undefined;
  /** Where WhatsApp should send the shop's webhooks (the inbox checks them, keeps the owner's replies to approval requests and passes the rest on). */
  whatsappWebhook?: string;
}

export function connectionOf(dir: string, server: ServerConfig, folder: AgentFolder): AgentConnection {
  const agent = folder.agent!;
  return {
    baseUrls: Object.fromEntries(agent.upstreams.map((u) => [u, agentBaseUrl(server, folder.name, u)])),
    credential: readSecretFile(secretFile(dir, "agents", folder.name, "agent_token")),
    ...(agent.upstreams.includes("whatsapp") ? { whatsappWebhook: `${publicUrl(server)}/c/${folder.name}/webhooks/whatsapp` } : {}),
  };
}

/** `agent add`: make the agent's folder and its one credential. Starts nothing. */
export function addAgent(dir: string, name: string, flags: AgentFlags, readFile: (path: string) => string, now: Date): AgentFolder {
  const problem = shopNameProblem(name);
  if (problem) throw new Error(problem.replace(/shop name/gu, "agent name"));
  const paths = serverPaths(dir);
  if (existsSync(paths.agent(name))) throw new Error(`There is already an agent called ${name}.`);
  // one name is one set of container names and one place on the network, whether it is a shop or an agent
  if (existsSync(paths.shop(name)) || loadState(dir).shops[name]) throw new Error(`There is already a shop called ${name}: a name is used once, because it becomes the names of the Guards.`);
  const waiting = paths.inbox(name);
  if (existsSync(waiting) && readdirSync(waiting).length > 0) throw new Error(`The secrets inbox for ${name} already holds files, so that name is taken by a setup in progress. Choose another name.`);
  const made = agentFromFlags(name, flags, readFile, now);
  writeAtomic(join(paths.agent(name), "agent.json"), made.agentText);
  writeAtomic(join(paths.agent(name), "settings.json"), made.settingsText);
  prepareSecretsRoot(dir);
  ensureSecret(secretFile(dir, "agents", name, "agent_token"), mintGuardToken);
  return readAgent(dir, name);
}

// ---- credentials -------------------------------------------------------------------------------------------------------------------------

interface Credentials { agent: string; record: string; relay: string; admin: Record<Kind, string> }

/** Every credential an agent's containers share: made once, kept in the folder of the container that owns it, copied to the ones that must match. */
function ensureCredentials(dir: string, name: string, kinds: Kind[]): Credentials {
  const agent = ensureSecret(secretFile(dir, "agents", name, "agent_token"), mintGuardToken);
  const record = ensureSecret(secretFile(dir, "ops", name, "record_token"), mintGuardToken);
  ensureAgentLabelKey(dir, name); // B69: the label key in ops' folder, derived from the agent's own
  const relay = ensureSecret(secretFile(dir, "relay", name, "agent_whatsapp"), mintGuardToken);
  writeSecretFile(secretFile(dir, "relay", name, "record_token"), record);
  const admin = Object.fromEntries(kinds.map((k) => [k, ensureSecret(secretFile(dir, "ops", name, `admin_${k}`), mintGuardToken)])) as Credentials["admin"];
  if (kinds.includes("whatsapp")) writeSecretFile(secretFile(dir, "inbox", name, "relay_token"), ensureSecret(secretFile(dir, "relay", name, "relay_token"), mintSecret));
  if (kinds.includes("razorpay")) writeSecretFile(secretFile(dir, "relay", name, "owner_notify_secret"), ensureSecret(secretFile(dir, `g-${name}-razorpay`, "owner_notify_secret"), mintSecret));
  if (kinds.includes("calendar")) { writeSecretFile(secretFile(dir, "refresher", name, "admin_token"), admin.calendar); ensureDir(secretFile(dir, `g-${name}-calendar`)); }
  return { agent, record, relay, admin };
}

/** Who may call each Guard: the builder's agent (everything its spec lists), the relay (sends to the owner), and the reading agent (looks at the service's own state, changes nothing). */
function whoOf(name: string, kind: Kind, c: Credentials) {
  return {
    admin: sha(c.admin[kind]),
    agents: [
      { id: agentNames.agentId(name), sha: sha(c.agent) },
      ...(kind === "whatsapp" ? [{ id: names.relayAgentId(name), sha: sha(c.relay), operations: ["send"] }] : []),
      ...(RECORD_READS[kind] ? [{ id: agentNames.recordId(name), sha: sha(c.record), operations: RECORD_READS[kind]! }] : []),
    ],
  };
}

// ---- preparing an agent ------------------------------------------------------------------------------------------------------------------

export interface PreparedAgent { folder: AgentFolder; plan: AgentPlan; guards: PreparedGuard[]; desiredHash: string }

/** What an agent is asked to be: its two files. */
export const agentDesiredHash = (f: Pick<AgentFolder, "agentText" | "settingsText">): string => sha256Hex(stableJson({ agent: agentGuardPart(f.agentText), settings: f.settingsText }));

/** What an agent needs before it can run, said by the name `agent add` printed it under. */
function missingSecrets(dir: string, name: string, f: AgentFolder): Problem[] {
  const need = (container: string, file: string, handIn: string): Problem[] => have(dir, container, ...file.split("/")) ? [] : [{ rule: `secret-missing:${handIn}`, message: `${name}: ${handIn} has not been handed in. Put it in secrets-inbox/${name}/${handIn}; it is moved to where only the right container can read it.` }];
  const kinds = f.agent?.upstreams ?? [];
  return [
    ...(kinds.includes("razorpay") ? need(`g-${name}-razorpay`, "razorpay_authorization", "razorpay_key") : []),
    ...(kinds.includes("whatsapp") ? [
      ...need(`g-${name}-whatsapp`, "whatsapp_authorization", "whatsapp_token"),
      // the owner's reply to an approval request comes to Geometer's inbox, so it has to be able to check it
      ...(have(dir, "inbox", name, "whatsapp_path_token") && !have(dir, "inbox", name, "whatsapp_app_secret") ? [] : [...need("inbox", `${name}/whatsapp_app_secret`, "whatsapp_app_secret"), ...need("inbox", `${name}/whatsapp_verify_token`, "whatsapp_verify_token")]),
    ] : []),
    ...(kinds.includes("calendar") ? (have(dir, "refresher", "_server", "google_service_account.json") ? [] : need("refresher", `${name}/google_service_account.json`, "google_service_account.json")) : []),
  ];
}

export function prepareAgent(ctx: Context, server: ServerConfig, state: State, name: string): { prepared?: PreparedAgent; problems: Problem[]; notes: string[] } {
  const folder = readAgent(ctx.dir, name);
  const taken = takeSecrets(ctx.dir, name);
  const problems: Problem[] = [...taken.problems];
  const notes = taken.unknown.map((u) => `${name}: secrets-inbox/${name}/${u} is not a name the bundle knows, so it was left where it is.`);
  const first = planAgent(server, folder);
  problems.push(...first.problems);
  if (folder.agent && folder.settings) problems.push(...missingSecrets(ctx.dir, name, folder));
  if (first.problems.length > 0) return { problems, notes };
  // Guard loads a bundle only if its version is HIGHER than the one it already has: the same content keeps its version, changed content gets the next.
  const prev = state.agents?.[name]?.guards ?? {};
  const versions: Record<string, number> = {};
  for (const g of first.guards) versions[g.kind] = prev[g.kind]?.contentHash === contentHash(g.spec) ? prev[g.kind].version : (prev[g.kind]?.version ?? 0) + 1;
  const plan = planAgent(server, folder, versions);
  // reserve the network index now, so two added together never share one (it is saved only when the deploy goes through)
  (state.agents ??= {})[name] ??= { index: shopIndex(state, name), guards: {} };
  return { prepared: { folder, plan, desiredHash: agentDesiredHash(folder), guards: plan.guards.map((g) => ({ plan: g, version: versions[g.kind], contentHash: contentHash(g.spec) })) }, problems, notes };
}

/** The model's key is for the model Guard, which serves the shops' runtimes. A server that holds no deployed shop does not run it, and an agent someone else wrote never calls a model. */
const withoutUnusedModelKey = (problems: Problem[], state: State): Problem[] => (Object.values(state.shops).some((s) => s.applied) ? problems : problems.filter((p) => p.rule !== "secret-missing:model_key"));

/** `check <agent>`: everything a deploy would check, offline. Starts nothing. */
export async function checkAgent(ctx: Context, name: string): Promise<{ ok: boolean; problems: Problem[]; notes: string[]; lines: string[] }> {
  const server = loadServer(ctx.dir);
  const state = loadState(ctx.dir);
  const { prepared, problems, notes } = prepareAgent(ctx, server, state, name);
  problems.push(...await serverProblems(ctx, server).then((p) => withoutUnusedModelKey(p, state)));
  const lines: string[] = [];
  if (prepared) {
    const creds = ensureCredentials(ctx.dir, name, prepared.guards.map((g) => g.plan.kind as Kind));
    const licence = await guardLicenceOn(ctx, server);
    if (licence.why) notes.push(licence.why);
    for (const g of prepared.guards) {
      problems.push(...await compileAndVerify(ctx, server, name, g, whoOf(name, g.plan.kind as Kind, creds), licenceFor(server, licence.on, g.plan.kind, name, ownNumbersOf(prepared.folder))));
      if (g.tripwires) lines.push(`${g.plan.service}: ${provenLine(g.tripwires)}`);
    }
  }
  return { ok: problems.length === 0, problems, notes, lines };
}

// ---- deploy ------------------------------------------------------------------------------------------------------------------------------

export interface AgentResult { agent: string; proven: { passed: number; of: number; line: string }; guards: Record<string, GuardProof>; connection: AgentConnection }

/** Deploy one agent's Guards. Throws Refused, naming every broken rule, before anything is changed. */
export async function deployAgent(ctx: Context, name: string): Promise<AgentResult> {
  updateStatus(ctx.dir, name, ctx.now(), (s) => { s.deploy = { state: "in-progress", at: ctx.now().toISOString() }; });
  const before = readStatus(ctx.dir, name)?.deploy;
  try { return await deployChecked(ctx, name); } catch (e) {
    if (e instanceof Refused) updateStatus(ctx.dir, name, ctx.now(), (s) => { s.deploy = { state: "failed", at: ctx.now().toISOString(), message: refusalMessage(e.problems), refusal: e.problems }; });
    else updateStatus(ctx.dir, name, ctx.now(), (s) => { s.deploy = before && before.state !== "in-progress" ? before : { state: "never" }; }, false);
    throw e;
  }
}

async function deployChecked(ctx: Context, name: string): Promise<AgentResult> {
  const server = loadServer(ctx.dir);
  prepareSecretsRoot(ctx.dir);
  const state = loadState(ctx.dir);
  const { prepared, problems, notes } = prepareAgent(ctx, server, state, name);
  notes.forEach((n) => ctx.log(`note: ${n}`));
  problems.push(...await serverProblems(ctx, server).then((p) => withoutUnusedModelKey(p, state)));
  if (problems.length > 0 || !prepared) throw new Refused(problems);

  const kinds = prepared.guards.map((g) => g.plan.kind as Kind);
  const creds = ensureCredentials(ctx.dir, name, kinds);
  // B13: an agent someone else wrote is restricted by the lease at its Guards, as a shop is (its id is the shop's id in the lease)
  const licence = await guardLicenceOn(ctx, server);
  if (licence.why) ctx.log(`note: ${licence.why}`);
  for (const g of prepared.guards) problems.push(...await compileAndVerify(ctx, server, name, g, whoOf(name, g.plan.kind as Kind, creds), licenceFor(server, licence.on, g.plan.kind, name, ownNumbersOf(prepared.folder))));
  if (problems.length > 0) throw new Refused(problems);

  // nothing broken: no secret in any file we are about to write, then write
  const configs: Record<string, string> = {};
  for (const g of prepared.guards) { configs[`${g.plan.service}/spec.json`] = g.plan.specText; configs[`${g.plan.service}/guard.toml`] = g.toml!; }
  const provider = kinds.flatMap((k) => (k === "razorpay" || k === "whatsapp" ? [readSecretFile(secretFile(ctx.dir, `g-${name}-${k}`, `${k}_authorization`)) ?? ""] : []));
  const leaks = noSecretsIn(configs, [creds.agent, creds.record, creds.relay, ...Object.values(creds.admin), ...provider].filter(Boolean));
  if (leaks.length > 0) throw new Refused(leaks);

  const at = ctx.now().toISOString();
  const s = state.agents![name];
  for (const g of prepared.guards) s.guards[g.plan.kind] = { version: g.version, contentHash: g.contentHash, digest: g.compiled!.digest, tripwires: { passed: g.tripwires!.passed, of: g.tripwires!.of, notSelfTestable: g.tripwires!.notSelfTestable } };
  s.applied = {
    appliedAt: at, settingsText: prepared.folder.settingsText, agentText: prepared.folder.agentText, desiredHash: prepared.desiredHash,
    guards: Object.fromEntries(prepared.guards.map((g) => [g.plan.kind, { kind: g.plan.kind, service: g.plan.service, specText: g.plan.specText, bundleText: g.compiled!.text, tomlText: g.toml! }])),
  };
  s.lastDeployAt = at;
  const composed = writeServer(ctx, server, state);
  const changed = await bringUp(ctx, state, composed, [name]);

  // the RUNNING Guards say what they enforce
  const proof = await proveRunning(ctx, prepared.guards);
  if (proof.problems.length === 0 && kinds.includes("razorpay")) await renewRelayCredential(ctx, name);
  if (s.stopped) await ops(ctx, ["stop", name, "on", "-", s.stopped.reason]); // a recreated Guard keeps its kill switch in its store; this makes sure
  const total = Object.values(proof.guards).reduce((t, g) => ({ passed: t.passed + g.passed, of: t.of + g.of }), { passed: 0, of: 0 });
  const line = provenLine({ ...total, notSelfTestable: Object.values(proof.guards).flatMap((g) => g.notSelfTestable) });
  const connection = connectionOf(ctx.dir, server, prepared.folder);
  updateStatus(ctx.dir, name, ctx.now(), (st) => {
    const failedBy = [...proof.problems, ...proof.licence];
    st.deploy = failedBy.length === 0 ? { state: "applied", at } : { state: "failed", at, message: refusalMessage(failedBy), refusal: failedBy };
    st.limits = { proven: total.passed, of: total.of, unprovable: [...new Set(Object.values(proof.guards).flatMap((g) => g.notSelfTestable))], line, perGuard: proof.guards };
    st.versions = { pathway: "own-agent", bundle: "0.1.0", guard: server.guardImage, guards: Object.fromEntries(Object.entries(s.guards).map(([k, v]) => [k, v.version])) };
    if (s.stopped) st.stopped = { at: s.stopped.at, by: s.stopped.by, reason: s.stopped.reason }; else delete st.stopped;
    st.own = { baseUrls: connection.baseUrls as Record<string, string>, ...(connection.whatsappWebhook ? { whatsappWebhook: connection.whatsappWebhook } : {}) };
  });
  saveState(ctx.dir, state);
  if (proof.problems.length > 0) {
    await ops(ctx, ["stop", name, "on", "the deployer", "a running Guard did not match what was checked"]);
    throw new Refused(proof.problems);
  }
  if (proof.licence.length > 0) throw new Refused(proof.licence); // refused, but the kill switch is not pulled (refunds owed must still go through)
  ctx.log(`Changed services: ${changed.length === 0 ? "none" : changed.join(", ")}`);
  return { agent: name, proven: { ...total, line }, guards: proof.guards, connection };
}

// ---- the lines `agent add` and `agent show` print ----------------------------------------------------------------------------------------

export function connectionText(name: string, c: AgentConnection, withCredential: boolean): string {
  const label: Record<string, string> = { razorpay: "Razorpay", whatsapp: "WhatsApp", calendar: "Google Calendar" };
  return [
    `Point ${name} at these addresses instead of the services themselves. The path after each one is the service's own (for Razorpay, /v1/payment_links and so on):`,
    ...Object.entries(c.baseUrls).map(([k, url]) => `  ${(label[k] ?? k).padEnd(16)}${url}`),
    withCredential
      ? `The credential, for all of them (send it as "Authorization: Bearer <credential>" in place of the service's own key; the real keys stay in the Guards and are never given to the agent):\n  ${c.credential ?? "(not made yet)"}`
      : `The credential is in secrets/agents/${name}/agent_token on this server; \`geometer agent show ${name} --credential\` prints it.`,
    ...(c.whatsappWebhook ? [`In WhatsApp's settings, send this shop's webhooks to:\n  ${c.whatsappWebhook}`] : []),
  ].join("\n");
}
