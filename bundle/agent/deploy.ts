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
import { OWN_API, isGatewayKind } from "../../modules/payments/providers/index.ts";
import { DESK_SECRET, OWNER_MARKED_KINDS } from "../generate/guards.ts";
import { noSecretsIn, provenLine } from "../generate/rules.ts";
import { INTAKE, ensureAgentLabelKey, ensureSecret, prepareSecretsRoot, readSecretFile, secretFile, takeSecrets, writeSecretFile } from "../lib/secrets.ts";
import { loadServer, publicUrl, serverPaths } from "../lib/server.ts";
import type { ServerConfig } from "../lib/server.ts";
import { loadState, saveState, shopIndex } from "../lib/state.ts";
import type { State } from "../lib/state.ts";
import { readStatus, refusalMessage, updateStatus } from "../lib/status.ts";
import type { GuardProof } from "../lib/status.ts";
import { ensureDir, mintGuardToken, mintSecret, sha256Hex, shopNameProblem, stableJson, writeAtomic } from "../lib/util.ts";
import { SHARED_ENV_NAME, credentialEnvName, credentialStatusOf, credentialsEnvShown, dropUnusedLegacyCredential, ensureAgentCredentials, readAgentCredentials, sharesOneCredential, writeCredentialsEnv } from "./credentials.ts";
import type { Problem } from "../lib/util.ts";
import { OWN_API_FILES, agentFromFlags, agentGuardPart, paymentUpstreamOf, readAgent } from "./folder.ts";
import type { AgentFlags, AgentFolder } from "./folder.ts";
import { RECORD_READS, agentNames, ownApiSpec, planAgent } from "./plan.ts";
import { heldRulesOf } from "../../modules/approvals/held-call.ts";
import { providerById } from "../../modules/payments/providers/index.ts";
import type { AgentPlan } from "./plan.ts";

const sha = (value: string) => sha256Hex(value);
const have = (dir: string, container: string, ...file: string[]) => !!readSecretFile(secretFile(dir, container, ...file));
type Kind = Exclude<GuardKind, "model">;

// ---- agent add ---------------------------------------------------------------------------------------------------------------------------

export interface AgentConnection {
  /** The addresses the builder's agent calls instead of the services themselves. */
  baseUrls: Partial<Record<Kind, string>>;
  /**
   * Where the agent's credentials are (agent/credentials.ts): one per Guard, in the file the agent reads, under these names. They replace the services' own keys, which
   * only the Guards hold. The credentials themselves are never in this object, so nothing that prints it can print one.
   */
  credentials: { file: string; names: Partial<Record<Kind, string>>; /** Every Guard still takes the one credential an agent from before 12 Nov 2026 has. */ shared: boolean };
  /** Where WhatsApp should send the shop's webhooks (the inbox checks them, keeps the owner's replies to approval requests and passes the rest on). */
  whatsappWebhook?: string;
  /** B71: the agent takes money with a module the owner marks (UPI): its address in `baseUrls` is the desk's Guard, and the desk is served on this server (part 2). */
  desk?: { module: string; displayName: string };
}

// The addresses a builder points their agent at (one per Guard) and the credential for them; derived from the folder alone so `agent add` and `agent show` print the same thing.
export function connectionOf(dir: string, server: ServerConfig, folder: AgentFolder): AgentConnection {
  const agent = folder.agent!;
  const paying = paymentUpstreamOf(agent.upstreams);
  const ownerMarked = paying?.ownerMarked ? paying : undefined;
  return {
    // every upstream is a Guard's address, the owner-marked module's too: its Guard is in front of the desk (B71 part 2)
    baseUrls: Object.fromEntries(agent.upstreams.map((u) => [u, agentBaseUrl(server, folder.name, u)])),
    ...(ownerMarked ? { desk: { module: ownerMarked.id, displayName: ownerMarked.displayName } } : {}),
    credentials: (() => {
      const tokens = readAgentCredentials(dir, folder.name, agent.upstreams);
      return { file: credentialsEnvShown(folder.name), names: Object.fromEntries(agent.upstreams.map((u) => [u, credentialEnvName(u)])), shared: sharesOneCredential(tokens) };
    })(),
    ...(agent.upstreams.includes("whatsapp") ? { whatsappWebhook: `${publicUrl(server)}/c/${folder.name}/webhooks/whatsapp` } : {}),
  };
}

/** `agent add`: make the agent's folder, a credential for each Guard and the file that hands them to the agent (agent/credentials.ts). Starts nothing. */
export function addAgent(dir: string, name: string, flags: AgentFlags, readFile: (path: string) => string, now: Date): AgentFolder {
  const problem = shopNameProblem(name);
  if (problem) throw new Error(problem.replace(/shop name/gu, "agent name"));
  const paths = serverPaths(dir);
  if (existsSync(paths.agent(name))) throw new Error(`There is already an agent called ${name}.`);
  // one name is one set of container names and one place on the network, whether it is a shop or an agent
  if (existsSync(paths.shop(name)) || loadState(dir).shops[name]) throw new Error(`There is already a shop called ${name}: a name is used once, because it becomes the names of the Guards.`);
  // an agent removed from this server keeps its name while what it kept is here (its Guards' stores carry the name): lib/state.ts says the same at deploy
  const gone = loadState(dir).removed?.[name];
  if (gone) throw new Error(`${name} is the name of an agent removed from this server on ${gone.at.slice(0, 10)} (what it kept is in ${gone.keptIn}). Choose another name: its Guards' kept stores carry this one.`);
  const waiting = paths.inbox(name);
  if (existsSync(waiting) && readdirSync(waiting).length > 0) throw new Error(`The secrets inbox for ${name} already holds files, so that name is taken by a setup in progress. Choose another name.`);
  const made = agentFromFlags(name, flags, readFile, now);
  // an own gateway API's reviewed rules are checked now, the way every plan will check them, so a held rule or an edited draft is refused before anything is written
  if (made.ownApi) {
    const checked = ownApiSpec(made.ownApi, { tenant: name, name: `${name}-${OWN_API}`, version: 1 });
    if (checked.problems.length > 0) throw new Error(`The reviewed rules for your own gateway's API need fixing:\n- ${checked.problems.join("\n- ")}`);
  }
  writeAtomic(join(paths.agent(name), "agent.json"), made.agentText);
  writeAtomic(join(paths.agent(name), "settings.json"), made.settingsText);
  // an own gateway API's reviewed spec: the kit's two files, byte for byte (the accept file names the draft by its hash)
  if (made.ownApi) { writeAtomic(join(paths.agent(name), OWN_API_FILES.draft), made.ownApi.draftText); writeAtomic(join(paths.agent(name), OWN_API_FILES.accept), made.ownApi.acceptText); }
  prepareSecretsRoot(dir);
  writeCredentialsEnv(dir, loadServer(dir), name, ensureAgentCredentials(dir, name, made.agent.upstreams));
  return readAgent(dir, name);
}

// ---- credentials -------------------------------------------------------------------------------------------------------------------------

/** `agent`: the builder's agent's credential at each Guard (one per Guard since 12 Nov 2026). The rest are the bundle's own and never reach the agent. */
interface Credentials { agent: Record<string, string>; record: string; relay: string; admin: Record<Kind, string> }

/**
 * The Guard the owner answers through, if any: a gateway's (a refund above the limit is held), or the agent's own API's when its reviewed spec holds a call for a
 * person (B71 part 2), with the operations held. An owner-marked module's desk Guard holds nothing: the owner sends every refund themselves.
 */
function approvalGuardOf(kinds: Kind[], holds: string[]): { kind: Kind; operations?: string[] } | undefined {
  const gateway = kinds.find((k) => isGatewayKind(k));
  if (gateway) return { kind: gateway };
  if (kinds.includes(OWN_API) && holds.length > 0) return { kind: OWN_API, operations: holds };
  return undefined;
}

/** The operations an own-API agent's applied or planned spec holds for the owner (none for any other agent). */
const holdsOf = (plan: AgentPlan): string[] => {
  const g = plan.guards.find((x) => x.kind === OWN_API);
  return g ? [...new Set(heldRulesOf(g.spec).rules.map((r) => r.operation))] : [];
};

/** Every credential an agent's containers share: made once, kept in the folder of the container that owns it, copied to the ones that must match. */
function ensureCredentials(dir: string, name: string, kinds: Kind[], approval?: { kind: Kind }): Credentials {
  const agent = ensureAgentCredentials(dir, name, kinds);
  const record = ensureSecret(secretFile(dir, "ops", name, "record_token"), mintGuardToken);
  ensureAgentLabelKey(dir, name); // B69: the label key in ops' folder, derived from the agent's own
  const relay = ensureSecret(secretFile(dir, "relay", name, "agent_whatsapp"), mintGuardToken);
  writeSecretFile(secretFile(dir, "relay", name, "record_token"), record);
  const admin = Object.fromEntries(kinds.map((k) => [k, ensureSecret(secretFile(dir, "ops", name, `admin_${k}`), mintGuardToken)])) as Credentials["admin"];
  if (kinds.includes("whatsapp")) writeSecretFile(secretFile(dir, "inbox", name, "relay_token"), ensureSecret(secretFile(dir, "relay", name, "relay_token"), mintSecret));
  // the owner's signing secret, in the Guard the owner answers through and in the relay, which signs the owner's answers (a gateway's, or its own API's when it holds calls)
  if (approval) writeSecretFile(secretFile(dir, "relay", name, "owner_notify_secret"), ensureSecret(secretFile(dir, names.guard(name, approval.kind), "owner_notify_secret"), mintSecret));
  // B71 part 2: the desk's token. The desk Guard sends it as its whole Authorization header; the desk (in the relay's container) knows the agent by it
  for (const k of kinds.filter((x) => OWNER_MARKED_KINDS.includes(x))) {
    const token = ensureSecret(secretFile(dir, "relay", name, "desk_token"), mintGuardToken);
    writeSecretFile(secretFile(dir, names.guard(name, k), DESK_SECRET), `Bearer ${token}`);
  }
  if (kinds.includes("calendar")) { writeSecretFile(secretFile(dir, "refresher", name, "admin_token"), admin.calendar); ensureDir(secretFile(dir, `g-${name}-calendar`)); }
  return { agent, record, relay, admin };
}

/**
 * Who may call each Guard: the builder's agent (everything its spec lists), the relay (sends to the owner), and the reading agent (looks at the service's own state, changes
 * nothing). While a rotation's overlap runs (agent/rotate.ts) the agent has two entries under ONE id: the old credential's hash FIRST, because Guard's retire call retires the
 * first entry with that id, then the new one. One id keeps the agent's held calls (Guard keys them by it) and its record (agent/facts.ts filters on it) the same.
 */
function whoOf(name: string, kind: Kind, c: Credentials, previous: readonly string[] = []) {
  return {
    admin: sha(c.admin[kind]),
    agents: [
      ...previous.filter((p) => p !== sha(c.agent[kind])).map((p) => ({ id: agentNames.agentId(name), sha: p })),
      { id: agentNames.agentId(name), sha: sha(c.agent[kind]) },
      ...(kind === "whatsapp" ? [{ id: names.relayAgentId(name), sha: sha(c.relay), operations: ["send"] }] : []),
      ...(RECORD_READS[kind] ? [{ id: agentNames.recordId(name), sha: sha(c.record), operations: RECORD_READS[kind]! }] : []),
    ],
  };
}

// ---- preparing an agent ------------------------------------------------------------------------------------------------------------------

export interface PreparedAgent { folder: AgentFolder; plan: AgentPlan; guards: PreparedGuard[]; desiredHash: string }

/** What an agent is asked to be: its two files, and an own gateway API's reviewed spec (its two files) when it has one, so a changed accept file is a change to deploy. */
export const agentDesiredHash = (f: Pick<AgentFolder, "agentText" | "settingsText" | "ownApi">): string => sha256Hex(stableJson({ agent: agentGuardPart(f.agentText), settings: f.settingsText, ...(f.ownApi ? { ownApi: f.ownApi } : {}) }));

/** What an agent needs before it can run, said by the name `agent add` printed it under. */
function missingSecrets(dir: string, name: string, f: AgentFolder): Problem[] {
  const need = (container: string, file: string, handIn: string): Problem[] => have(dir, container, ...file.split("/")) ? [] : [{ rule: `secret-missing:${handIn}`, message: `${name}: ${handIn} has not been handed in. Put it in secrets-inbox/${name}/${handIn}; it is moved to where only the right container can read it.` }];
  const kinds = f.agent?.upstreams ?? [];
  // each Guard's own credential, by the name it is handed in under (lib/secrets.ts INTAKE says which container each goes to): one list, so a new kind of Guard is never skipped
  const guardCredentials = Object.entries(INTAKE).flatMap(([handIn, rule]) => {
    const [container, ...file] = rule.to(name);
    return kinds.some((k) => container === names.guard(name, k)) ? need(container, file.join("/"), handIn) : [];
  });
  return [
    ...guardCredentials,
    ...(kinds.includes("whatsapp") ? [
      // the owner's reply to an approval request comes to Geometer's inbox, so it has to be able to check it
      ...(have(dir, "inbox", name, "whatsapp_path_token") && !have(dir, "inbox", name, "whatsapp_app_secret") ? [] : [...need("inbox", `${name}/whatsapp_app_secret`, "whatsapp_app_secret"), ...need("inbox", `${name}/whatsapp_verify_token`, "whatsapp_verify_token")]),
    ] : []),
    ...(kinds.includes("calendar") ? (have(dir, "refresher", "_server", "google_service_account.json") ? [] : need("refresher", `${name}/google_service_account.json`, "google_service_account.json")) : []),
  ];
}

// The agent twin of prepareShop: everything that can be decided and refused before any container starts. Takes the agent's handed-in secrets as a side effect.
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
    const kinds = prepared.guards.map((g) => g.plan.kind as Kind);
    const approval = approvalGuardOf(kinds, holdsOf(prepared.plan));
    const creds = ensureCredentials(ctx.dir, name, kinds, approval);
    const licence = await guardLicenceOn(ctx, server);
    if (!licence.on) problems.push(licence.problem);
    if (sharesOneCredential(creds.agent)) notes.push(`${name}'s Guards still share one credential (made before 12 Nov 2026, ${SHARED_ENV_NAME} in ${credentialsEnvShown(name)}). \`geometer agent rotate ${name}\` gives each Guard its own, with an overlap so the running agent does not fail mid-call.`);
    for (const g of prepared.guards) {
      problems.push(...await compileAndVerify(ctx, server, name, g, whoOf(name, g.plan.kind as Kind, creds, previousHashes(state, name, g.plan.kind)), licenceFor(server, licence.on, g.plan.kind, name, ownNumbersOf(prepared.folder)), approval?.operations && g.plan.kind === approval.kind ? approval.operations : undefined));
      if (g.tripwires) lines.push(`${g.plan.service}: ${provenLine(g.tripwires)}`);
    }
  }
  return { ok: problems.length === 0, problems, notes, lines };
}

// ---- deploy ------------------------------------------------------------------------------------------------------------------------------

export interface AgentResult { agent: string; proven: { passed: number; of: number; line: string }; guards: Record<string, GuardProof>; connection: AgentConnection }

/** The hashes of credentials a Guard still accepts while a rotation's overlap runs (lib/state.ts AgentState.credentials). */
const previousHashes = (state: State, name: string, kind: string): string[] => { const p = state.agents?.[name]?.credentials?.[kind]?.previous; return p ? [p.sha256] : []; };

export interface AgentDeployOptions {
  /**
   * Only who may call a Guard changed (a rotation): ask a running Guard to read its guard.toml again (POST /admin/reload) instead of restarting it, so a call in
   * flight is not cut off. A Guard whose reload is refused or needs a restart is restarted as before. Every other deploy restarts, as a shop's does.
   */
  reloadGuards?: boolean;
}

/** Deploy one agent's Guards. Throws Refused, naming every broken rule, before anything is changed. */
export async function deployAgent(ctx: Context, name: string, o: AgentDeployOptions = {}): Promise<AgentResult> {
  updateStatus(ctx.dir, name, ctx.now(), (s) => { s.deploy = { state: "in-progress", at: ctx.now().toISOString() }; });
  const before = readStatus(ctx.dir, name)?.deploy;
  try { return await deployChecked(ctx, name, o); } catch (e) {
    if (e instanceof Refused) updateStatus(ctx.dir, name, ctx.now(), (s) => { s.deploy = { state: "failed", at: ctx.now().toISOString(), message: refusalMessage(e.problems), refusal: e.problems }; });
    else updateStatus(ctx.dir, name, ctx.now(), (s) => { s.deploy = before && before.state !== "in-progress" ? before : { state: "never" }; }, false);
    throw e;
  }
}

async function deployChecked(ctx: Context, name: string, o: AgentDeployOptions): Promise<AgentResult> {
  const server = loadServer(ctx.dir);
  prepareSecretsRoot(ctx.dir);
  const state = loadState(ctx.dir);
  const { prepared, problems, notes } = prepareAgent(ctx, server, state, name);
  notes.forEach((n) => ctx.log(`note: ${n}`));
  problems.push(...await serverProblems(ctx, server).then((p) => withoutUnusedModelKey(p, state)));
  if (problems.length > 0 || !prepared) throw new Refused(problems);

  const kinds = prepared.guards.map((g) => g.plan.kind as Kind);
  const approval = approvalGuardOf(kinds, holdsOf(prepared.plan));
  const creds = ensureCredentials(ctx.dir, name, kinds, approval);
  // B13: an agent someone else wrote is restricted by the lease at its Guards, as a shop is (its id is the shop's id in the lease)
  const licence = await guardLicenceOn(ctx, server);
  if (!licence.on) problems.push(licence.problem);
  for (const g of prepared.guards) problems.push(...await compileAndVerify(ctx, server, name, g, whoOf(name, g.plan.kind as Kind, creds, previousHashes(state, name, g.plan.kind)), licenceFor(server, licence.on, g.plan.kind, name, ownNumbersOf(prepared.folder)), approval?.operations && g.plan.kind === approval.kind ? approval.operations : undefined));
  if (problems.length > 0) throw new Refused(problems);

  // nothing broken: no secret in any file we are about to write, then write
  const configs: Record<string, string> = {};
  for (const g of prepared.guards) { configs[`${g.plan.service}/spec.json`] = g.plan.specText; configs[`${g.plan.service}/guard.toml`] = g.toml!; }
  // every provider credential a Guard of this agent reads (its def says which file), so none of them can end up in a file written beside it
  const provider = prepared.guards.flatMap((g) => (g.plan.def.secretFile ? [readSecretFile(secretFile(ctx.dir, g.plan.service, g.plan.def.secretFile)) ?? ""] : []));
  const leaks = noSecretsIn(configs, [...Object.values(creds.agent), creds.record, creds.relay, ...Object.values(creds.admin), ...provider].filter(Boolean));
  if (leaks.length > 0) throw new Refused(leaks);

  const at = ctx.now().toISOString();
  const s = state.agents![name];
  // a Guard whose policy is the one it already runs, when only its callers changed (a rotation): reloaded rather than restarted
  const reload = o.reloadGuards ? prepared.guards.filter((g) => s.guards[g.plan.kind]?.digest === g.compiled!.digest).map((g) => g.plan.service) : [];
  for (const g of prepared.guards) s.guards[g.plan.kind] = { version: g.version, contentHash: g.contentHash, digest: g.compiled!.digest, tripwires: { passed: g.tripwires!.passed, of: g.tripwires!.of, notSelfTestable: g.tripwires!.notSelfTestable } };
  s.applied = {
    appliedAt: at, settingsText: prepared.folder.settingsText, agentText: prepared.folder.agentText, desiredHash: prepared.desiredHash,
    guards: Object.fromEntries(prepared.guards.map((g) => [g.plan.kind, { kind: g.plan.kind, service: g.plan.service, specText: g.plan.specText, bundleText: g.compiled!.text, tomlText: g.toml! }])),
  };
  s.lastDeployAt = at;
  // since when each Guard's credential is in force (a rotation sets its own; the first deploy of a Guard sets it here)
  s.credentials ??= {};
  for (const k of kinds) s.credentials[k] ??= { since: at };
  const composed = writeServer(ctx, server, state);
  const changed = await bringUp(ctx, state, composed, [name], { reload });

  // the RUNNING Guards say what they enforce
  const proof = await proveRunning(ctx, prepared.guards);
  if (proof.problems.length === 0 && approval) await renewRelayCredential(ctx, name); // the relay's reading credential, at the Guard the owner answers through
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
    // the rest of `own` (the last crash test, what was asked from the panel) is kept: a deploy changes only what it knows
    st.own = { ...st.own, baseUrls: connection.baseUrls as Record<string, string>, ...(connection.whatsappWebhook ? { whatsappWebhook: connection.whatsappWebhook } : {}), credentials: credentialStatusOf(s.credentials, creds.agent) };
  });
  saveState(ctx.dir, state);
  if (proof.problems.length > 0) {
    await ops(ctx, ["stop", name, "on", "the deployer", "a running Guard did not match what was checked"]);
    throw new Refused(proof.problems);
  }
  if (proof.licence.length > 0) throw new Refused(proof.licence); // refused, but the kill switch is not pulled (refunds owed must still go through)
  // only now, with every Guard taking them, does the agent's file change (a new Guard's credential, a new address); a Guard rotated earlier keeps its own
  writeCredentialsEnv(ctx.dir, server, name, creds.agent);
  if (dropUnusedLegacyCredential(ctx.dir, name, creds.agent)) ctx.log(`${name}: no Guard uses the one shared credential any more, so its file is deleted.`);
  ctx.log(`Changed services: ${changed.length === 0 ? "none" : changed.join(", ")}`);
  return { agent: name, proven: { ...total, line }, guards: proof.guards, connection };
}

// ---- the lines `agent add` and `agent show` print ----------------------------------------------------------------------------------------

/** The plain-language lines `agent add`, `deploy` and `show` print. Never a credential (since 12 Nov 2026): the agent reads them from its file (agent/credentials.ts). */
export function connectionText(name: string, c: AgentConnection): string {
  // a gateway's or an owner-marked module's label is its own display name (the registry's), so nothing here names a provider
  const label = (k: string): string => (k === OWN_API ? "Your gateway" : k === "whatsapp" ? "WhatsApp" : k === "calendar" ? "Google Calendar" : k === c.desk?.module ? `${c.desk.displayName} desk` : providerById(k)?.displayName ?? k);
  return [
    `Point ${name} at these addresses instead of the services themselves. The path after each one is the service's own (for a gateway, its own API's paths; for the desk, /requests and /refunds):`,
    ...Object.entries(c.baseUrls).map(([k, url]) => `  ${label(k).padEnd(16)}${url}`),
    c.credentials.shared
      ? `Its Guards still share one credential (made before 12 Nov 2026), ${SHARED_ENV_NAME} in ${c.credentials.file} on this server. \`geometer agent rotate ${name}\` gives each Guard its own.`
      : `Each Guard has a credential of its own, in ${c.credentials.file} on this server (${Object.values(c.credentials.names).join(", ")}). Send each as "Authorization: Bearer <credential>" to its own address, in place of the service's own key; the real keys stay in the Guards. Load the file when the agent starts (node --env-file=...), or read it on each call. Credentials are never printed.`,
    ...(c.whatsappWebhook ? [`In WhatsApp's settings, send this shop's webhooks to:\n  ${c.whatsappWebhook}`] : []),
    ...(c.baseUrls[OWN_API] ? [`Your own gateway's API: the Guard holds its key (hand it in as secrets-inbox/${name}/gateway_authorization, the whole Authorization header) and enforces only the rules you kept in gateway-accept.json. A rule that waits for a person asks the owner on WhatsApp; after the owner's yes, your agent sends the identical call again and the Guard lets it through.`] : []),
    ...(c.desk ? [`${c.desk.displayName}: customers pay the shop's own ${c.desk.displayName} ID and the owner marks each payment received on WhatsApp. Your agent asks the desk for each request and reads it back at the address above (POST /requests, GET /requests?reference=..., POST /refunds; \`geometer agent crash-test ${name}\` runs the same desk, GEOMETER_UPI_URL). A request counts as paid only when the owner has marked it.`] : []),
  ].join("\n");
}
