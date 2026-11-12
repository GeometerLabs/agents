// Deploy: from a shop's desired state to running containers, checked before anything starts.
//
//   1. take the secrets handed in, plan the shop, resolve its pathway pin, decide each Guard's bundle version (always higher than the last)
//   2. compile every spec and render every guard.toml, then `geo-guard verify-bundle --config` on each: EVERY tripwire must pass
//   3. if any rule is broken, stop. Nothing running is touched, nothing is started, and every broken rule is named
//   4. write the files, then `docker compose up -d`, then restart only the services whose files changed under an unchanged compose entry
//   5. wait for the Guards, ask each RUNNING Guard for its policy and its tripwires: its digest must be the one compiled, and the number in the shop's
//      certificate ("N of M limits proven to bite") is read from there. A mismatch stops the shop with the kill switch.
//   6. write status/<shop>.json for the panel
// Docker, the clock and sleeping go through the context, so the tests run all of this against a fake.
import { gatewayOf, isGatewayKind } from "../modules/payments/providers/index.ts";
import type { PaymentSettings } from "../modules/payments/providers/index.ts";
import { chownSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { composeServer } from "./generate/compose.ts";
import type { Composed, Dirs, PanelOptions, ShopDeploy } from "./generate/compose.ts";
import { GUPSHUP_GUARD_ADMIN_FILE, GUPSHUP_UNIVERSAL_TOKEN_FILE, doorConfig, inboxConfig, opsConfig, refresherConfig, relayConfig } from "./generate/configs.ts";
import type { ShopWebhooks } from "./generate/configs.ts";
import { PANEL_READS, guardToml, ownerNumbers } from "./generate/guards.ts";
import type { GuardLicence } from "./generate/guards.ts";
import { agentFacts } from "./agent/applied.ts";
import { noSecretsIn, provenLine, toolNamesMatch, tripwiresHold } from "./generate/rules.ts";
import { names, planModelGuard, planShop } from "./generate/shop.ts";
import type { GuardPlan, ShopPlan } from "./generate/shop.ts";
import type { CompileResult, GuardTool, TripwireResult } from "./generate/verify.ts";
import { licencePaths, syncLicence } from "./lib/licence.ts";
import { syncTerms } from "./lib/terms.ts";
import { kidOf } from "../modules/licence/token.ts";
import { KINDS, kindFor, guardsOf } from "./lib/kinds.ts";
import { appliedPathwayDir, keptDirFor, pathwayDirFor, pinnedRuntimeCheck } from "./lib/pathways.ts";
import type { Runner } from "./lib/runner.ts";
import { RECORD_KEY_FILE, ensurePanelSigningKey, ensureSecret, ensureShopPersonKeys, panelUser, personKeyFile, prepareSecretsRoot, readSecretFile, secretFile, speechKeyHandedIn, takeSecrets, writeSecretFile } from "./lib/secrets.ts";
import { placeRuntimeReportKey } from "./lib/report-key.ts";
import { NO_MODEL, fleetIdOf, listShops, loadServer, modelChosen, readShop, serverPaths } from "./lib/server.ts";
import type { ServerConfig, ShopFolder } from "./lib/server.ts";
import { loadState, saveState, shopIndex } from "./lib/state.ts";
import type { Snapshot, State } from "./lib/state.ts";
import { readStatus, refusalMessage, updateStatus } from "./lib/status.ts";
import type { GuardProof } from "./lib/status.ts";
import { Refused, ensureDir, mintGuardToken, mintSecret, sha256Hex, stableJson, writeAtomic } from "./lib/util.ts";
import type { Problem } from "./lib/util.ts";
import type { ApproversSettings } from "../modules/approvals/people.ts";

export interface Context {
  /** The server folder. */
  dir: string;
  /** The agents repository: the bundle's own code and the current pathway. */
  appDir: string;
  runner: Runner;
  tool: GuardTool;
  log: (line: string) => void;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  docker: string;
  /** Seconds to wait for the Guards after `up`. Default 120. */
  waitSeconds?: number;
  /** More compose files merged over the generated one (a test adds its stand-ins and a bucket this way). Never used by a real server. */
  extraComposeFiles?: string[];
}

// One place for the generated compose path, so every docker call and the status checks agree on the file.
export const composeFile = (dir: string) => join(serverPaths(dir).generated, "compose.yaml");

// Turns the deployer's context into the folder map the generators take, so they stay pure functions of paths and never reach for the context.
export function dirsOf(ctx: Context): Dirs {
  const p = serverPaths(ctx.dir);
  return { app: ctx.appDir, generated: p.generated, secrets: p.secrets, status: p.status, fleet: p.fleet, shops: p.shops, secretsInbox: p.secretsInbox, requests: p.requests, exports: p.exports, panelData: p.panel, config: p.config, licence: licencePaths(ctx.dir).root };
}

/** `docker compose` on this server's generated file. */
export function compose(ctx: Context, args: string[], options: { timeoutMs?: number } = {}) {
  return ctx.runner.run(ctx.docker, ["compose", "-f", composeFile(ctx.dir), ...(ctx.extraComposeFiles ?? []).flatMap((f) => ["-f", f]), "--project-directory", serverPaths(ctx.dir).generated, ...args], { timeoutMs: options.timeoutMs ?? 600_000 });
}

/** One command inside the ops container: the only way to a Guard's admin port. */
export const ops = (ctx: Context, args: string[]) => compose(ctx, ["exec", "-T", "ops", "node", "/app/bundle/services/ops.ts", ...args], { timeoutMs: 60_000 });

/** An admin call on one Guard, through ops. */
export async function adminCall(ctx: Context, service: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const r = await ops(ctx, ["admin", service, method, path, ...(body !== undefined ? [JSON.stringify(body)] : [])]);
  try { return JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "") as { status: number; body: any }; } catch { return { status: 0, body: { error: `ops did not answer (${r.stderr.trim().slice(0, 200) || `exit ${r.code}`})` } }; }
}

// ---- secrets ---------------------------------------------------------------------------------------------------------------------------------

const pathOf = (dir: string, container: string, file: string) => secretFile(dir, container, ...file.split("/"));
const have = (dir: string, container: string, file: string) => !!readSecretFile(pathOf(dir, container, file));

/** `calendar`: whether the shop's template has a calendar. One that has none has no Google key to hand in and nothing for the token refresher to look after, however many keys the server holds. */
function webhooksFor(dir: string, shop: string, calendar = true): ShopWebhooks {
  const meta = have(dir, "inbox", `${shop}/whatsapp_app_secret`);
  return { verification: !meta && have(dir, "inbox", `${shop}/whatsapp_path_token`) ? "path-token" : "meta-signature", hasGoogle: calendar && (have(dir, "refresher", `${shop}/google_service_account.json`) || have(dir, "refresher", "_server/google_service_account.json")), ownGoogleKey: calendar && have(dir, "refresher", `${shop}/google_service_account.json`) };
}

/**
 * Follow-up 2: is this Gupshup shop's app token renewed by the refresher? Only when no static token was handed in for it (`gupshup_authorization`, which always wins:
 * it is the shop's own choice) and the server holds a Gupshup universal token (`geometer gupshup-token <file>`). Decided at each deploy from the secrets on disk, and kept
 * in the applied snapshot (`whatsappTokens`), so the compose file always matches the Guard it was compiled with.
 */
function gupshupRenewedFor(dir: string, shop: string, gupshup: boolean): boolean {
  return gupshup && !have(dir, `g-${shop}-whatsapp`, "whatsapp_authorization") && have(dir, "refresher", `_server/${GUPSHUP_UNIVERSAL_TOKEN_FILE}`);
}

/** Does this shop's template have a calendar? (Its Guards are what it was planned with.) */
const hasCalendar = (guards: readonly { kind: string }[]): boolean => guards.some((g) => g.kind === "calendar");
/** Does this shop take Razorpay? A UPI shop (B33) was planned with no Razorpay Guard, and so has no Razorpay key, webhook or approvals relay. */
export const hasRazorpay = (guards: readonly { kind: string }[]): boolean => guards.some((g) => g.kind === "razorpay");

/**
 * The shop's own people's WhatsApp numbers in its (or an agent's) settings: the owner (Bookings and Fees both keep it at owner.whatsapp) and, B37, each other
 * person who approves refunds. In the final stop the WhatsApp Guard still lets a send to these through: the owner's notice, and the approvals relay asking any of
 * them about a refund Guard holds (a refund owed must still go through, and the person who asked for it never approves it).
 */
export const ownNumbersOf = (folder: { settings?: unknown }): (string | undefined)[] => {
  const s = folder.settings as { owner?: { whatsapp?: unknown }; approvers?: { people?: { whatsapp?: unknown }[] } } | undefined;
  return [s?.owner?.whatsapp, ...(s?.approvers?.people ?? []).map((p) => p?.whatsapp)].map((n) => (typeof n === "string" ? n : undefined));
};

/** What a shop needs before it can run, said by the name the panel hands it in under. `calendar`: whether the shop's template has one. */
function missingSecrets(dir: string, shop: string, webhooks: ShopWebhooks, calendar = true, razorpay = true, gupshup = false, gupshupRenewed = false, selfServe = false): Problem[] {
  const need = (container: string, file: string, handIn: string): Problem[] => have(dir, container, file) ? [] : [{ rule: `secret-missing:${handIn}`, message: `${shop}: ${handIn} has not been handed in. Put it in secrets-inbox/${shop}/${handIn} (the panel does this); it is moved to where only the right container can read it.` }];
  return [
    // a UPI shop (B33) has no Razorpay account: no key and no webhook secret are asked for
    ...(razorpay ? need(`g-${shop}-razorpay`, "razorpay_authorization", "razorpay_key") : []),
    // item 11b: a shop on Gupshup hands its token in under Gupshup's own name; it fills the same file. Follow-up 2: none is needed when the refresher renews one
    ...(gupshupRenewed ? [] : need(`g-${shop}-whatsapp`, "whatsapp_authorization", selfServe ? "gupshup_apikey" : gupshup ? "gupshup_authorization" : "whatsapp_token")),
    ...(razorpay ? need("inbox", `${shop}/razorpay_webhook_secret`, "razorpay_webhook_secret") : []),
    ...(webhooks.verification === "path-token" ? need("inbox", `${shop}/whatsapp_path_token`, "whatsapp_path_token") : [...need("inbox", `${shop}/whatsapp_app_secret`, "whatsapp_app_secret"), ...need("inbox", `${shop}/whatsapp_verify_token`, "whatsapp_verify_token")]),
    // the shop's own Google key, or (hosted mode) the one the server holds for every shop: `geometer google-key <file>`
    ...(!calendar || have(dir, "refresher", "_server/google_service_account.json") ? [] : need("refresher", `${shop}/google_service_account.json`, "google_service_account.json")),
  ];
}

type Three = "razorpay" | "whatsapp" | "calendar";
interface Credentials { agent: Partial<Record<Three, string>> & Record<"model" | "relay", string>; admin: Partial<Record<Three, string>>; /** the panel's own agent at each Guard (only when the panel is on): the connection checks' reads, nothing else. One token: the panel reads ONE token file (golive.ts) and presents it to every Guard. */ panel?: string }

/**
 * Every credential a shop's containers share: made once, kept in the file of the container that owns it, copied to the containers that must match. `calendar`: whether the shop's
 * template has a calendar. One that has none gets no calendar credentials, no folder for a calendar Guard, and nothing in the token refresher's folder.
 */
function ensureCredentials(dir: string, shop: string, panelOn: boolean, calendar = true, razorpay = true, people: string[] = [], gupshupRenewed = false): Credentials {
  const rt = names.runtime(shop);
  const internal = ensureSecret(secretFile(dir, rt, "internal_token"), mintSecret);
  const agent = {
    ...(razorpay ? { razorpay: ensureSecret(secretFile(dir, rt, "agent_razorpay"), mintGuardToken) } : {}),
    whatsapp: ensureSecret(secretFile(dir, rt, "agent_whatsapp"), mintGuardToken),
    ...(calendar ? { calendar: ensureSecret(secretFile(dir, rt, "agent_calendar"), mintGuardToken) } : {}),
    model: ensureSecret(secretFile(dir, rt, "agent_model"), mintGuardToken),
    relay: ensureSecret(secretFile(dir, "relay", shop, "agent_whatsapp"), mintGuardToken),
  };
  const admin = Object.fromEntries((["razorpay", "whatsapp", "calendar"] as const).filter((k) => (k !== "calendar" || calendar) && (k !== "razorpay" || razorpay)).map((k) => [k, ensureSecret(secretFile(dir, "ops", shop, `admin_${k}`), mintGuardToken)])) as Credentials["admin"];
  for (const container of ["ops", "inbox", "relay"]) writeSecretFile(secretFile(dir, container, shop, "internal_token"), internal);
  // item 11d: the channel token, the runtime's and the public front's (served by the inbox process). It can send only a booking-page request or an owner's press (which the
  // runtime checks against the owner's link itself): never a WhatsApp message or a payment event, which only the internal token can.
  writeSecretFile(secretFile(dir, "inbox", shop, "channel_token"), ensureSecret(secretFile(dir, rt, "channel_token"), mintSecret));
  writeSecretFile(secretFile(dir, "inbox", shop, "relay_token"), ensureSecret(secretFile(dir, "relay", shop, "relay_token"), mintSecret));
  if (razorpay) writeSecretFile(secretFile(dir, "relay", shop, "owner_notify_secret"), ensureSecret(secretFile(dir, `g-${shop}-razorpay`, "owner_notify_secret"), mintSecret));
  // A UPI shop has no Razorpay webhook: its inbox still holds a secret for that route, made here and given to nobody, so a call to it can never be signed.
  else ensureSecret(secretFile(dir, "inbox", shop, "razorpay_webhook_secret"), mintSecret);
  // B37: each other approver signs with their own secret, kept in the Razorpay Guard's folder and copied to the relay's, like the owner's (a UPI shop has neither)
  if (razorpay) for (const person of people) writeSecretFile(secretFile(dir, "relay", shop, names.approverSecretFile(person)), ensureSecret(secretFile(dir, `g-${shop}-razorpay`, names.approverSecretFile(person)), mintSecret));
  if (calendar) {
    writeSecretFile(secretFile(dir, "refresher", shop, "admin_token"), admin.calendar as string);
    ensureDir(secretFile(dir, `g-${shop}-calendar`));
  }
  // follow-up 2: the refresher asks a renewed Gupshup shop's WhatsApp Guard to read each new app token (/admin/reload), with that Guard's admin token, as for the calendar
  if (gupshupRenewed) {
    writeSecretFile(secretFile(dir, "refresher", shop, GUPSHUP_GUARD_ADMIN_FILE), admin.whatsapp as string);
    ensureDir(secretFile(dir, `g-${shop}-whatsapp`)); // its folder holds no token now, but Docker must find it to mount (a missing one it would make as root)
  } else rmSync(secretFile(dir, "refresher", shop, GUPSHUP_GUARD_ADMIN_FILE), { force: true });
  // The panel's agent token lives ONLY in the panel's folder (every Guard keeps its hash, under the agent `panel-<shop>`, allowed the reads and nothing else). 0600: the
  // panel runs as the user who wrote it. One token for the panel, not one per Guard: the panel reads a single token file and presents it to each Guard it checks.
  // B69: the shop's fingerprint key and its copies (lib/secrets.ts)
  ensureShopPersonKeys(dir, shop, rt, panelOn);
  // Item 17b's runtime copy of the server's paper key is not made here: a deploy places it through a short-lived container (lib/report-key.ts, from prepareShop), so it
  // is the runtime's own whoever runs the deployer (follow-up 6, 12 Nov 2026).
  const panel = panelOn ? ensureSecret(secretFile(dir, "panel", names.panelGuardToken), mintGuardToken, 0o600) : undefined;
  return { agent, admin, ...(panel ? { panel } : {}) };
}

const sha = (value: string) => sha256Hex(value);
const agentsOf = (shop: string, kind: GuardPlan["kind"], c: Credentials) => [
  { id: names.agentId(shop), sha: sha(c.agent[kind as "razorpay"]) },
  ...(kind === "whatsapp" ? [{ id: names.relayAgentId(shop), sha: sha(c.agent.relay), operations: ["send"] }] : []),
  // the panel's own agent: allowed the read operations of its connection checks at this Guard and nothing else
  ...(c.panel && kind !== "model" ? [{ id: names.panelAgentId(shop), sha: sha(c.panel), operations: PANEL_READS[kind as Three] }] : []),
];

// ---- preparing a shop -----------------------------------------------------------------------------------------------------------------------

export interface PreparedGuard {
  plan: GuardPlan; version: number; contentHash: string; compiled?: CompileResult; toml?: string; tripwires?: TripwireResult;
  /** The `[licence]` its guard.toml was given (B13), and the key ids the running Guard must have built in. */
  licence?: GuardLicence & { kids: string[] };
}
interface Prepared { folder: ShopFolder; plan: ShopPlan; guards: PreparedGuard[]; webhooks: ShopWebhooks; pathwayDir: string; index: number; desiredHash: string; /** follow-up 2 */ gupshupRenewed: boolean }

// Hash of one spec with its version zeroed, so a version bump alone does not look like a changed spec.
export const contentHash = (spec: Record<string, unknown>) => sha256Hex(stableJson({ ...spec, version: 0 }));
/** What a shop is asked to be: its three files. A shop is up to date when this equals what was applied. */
// Fleet's button mode and the month's AI cap are part of what a shop is asked to be, so a flip redeploys it. Each is only added to the hash when it is on, so a shop that never had it
// keeps the hash it has.
// The monthly report's two live facts (who set the shop up, the Innovator badge) are part of it too, so a change of either redeploys the shop and rewrites its runtime config. They are
// always in the hash, so every shop deployed before the report existed is redeployed once, which is what writes its `report` block.
export const desiredOf = (f: Pick<ShopFolder, "settingsText" | "runtime" | "lockText" | "pinsText" | "preparedBy" | "innovator"> & { fleetAi?: "buttons"; fleetModel?: "off" }) => ({
  settings: f.settingsText, runtime: f.runtime, lock: f.lockText, pins: f.pinsText, ...(f.fleetAi ? { fleetAi: f.fleetAi } : {}), ...(f.fleetModel ? { fleetModel: f.fleetModel } : {}), report: { preparedBy: f.preparedBy, innovator: f.innovator },
});
// What the deployer stores as 'applied': equal hashes mean the shop is up to date and is left running untouched.
export const desiredHashOf = (f: Parameters<typeof desiredOf>[0]): string => sha256Hex(stableJson(desiredOf(f)));

/**
 * Everything about one shop that can be decided and refused without starting anything. Takes the shop's handed-in secrets as a side effect. `o.placeReportKey` (a deploy,
 * not `check`, which starts nothing): first put the server's paper key where the shop's runtime reads it, through a short-lived container (lib/report-key.ts), so the plan
 * names the key only when the copy is there and the runtime's own; a copy that failed is said in a note and the report goes out unsigned.
 */
export async function prepareShop(ctx: Context, server: ServerConfig, state: State, name: string, o: { placeReportKey?: boolean } = {}): Promise<{ prepared?: Prepared; problems: Problem[]; notes: string[] }> {
  const folder = readShop(ctx.dir, name);
  const taken = takeSecrets(ctx.dir, name);
  const problems: Problem[] = [...taken.problems];
  const notes = taken.unknown.map((u) => `${name}: secrets-inbox/${name}/${u} is not a name the bundle knows, so it was left where it is.`);
  const calendar = guardsOf(kindFor(folder.lock?.pathway) ?? KINDS.bookings, folder.settings).includes("calendar"); // B72: a shop on its own booking list has none
  const razorpay = guardsOf(kindFor(folder.lock?.pathway) ?? KINDS.bookings, folder.settings).includes("razorpay"); // a UPI shop (B33) has no Razorpay
  const webhooks = webhooksFor(ctx.dir, name, calendar);
  const pathwayDir = folder.lock ? pathwayDirFor(ctx.appDir, ctx.dir, folder.lock) : undefined;
  // The settings the bundle adds to the generated config (`ai`, `report`) are judged by the check of the version the shop is PINNED to, not by this checkout's: a client held back
  // on an older version has a runtime that refuses a key it does not know.
  const check = pathwayDir ? await pinnedRuntimeCheck(pathwayDir) : undefined;
  // follow-up 2: whether the refresher renews this Gupshup shop's app token (the secrets on disk say; taken out of the inbox above)
  const gupshup = (folder.runtime as { services?: { messaging?: { provider?: unknown } } } | undefined)?.services?.messaging?.provider === "gupshup";
  const gupshupRenewed = gupshupRenewedFor(ctx.dir, name, gupshup);
  // item 11c: a shop on its own Gupshup account hands in its API key under gupshup_apikey; nothing is renewed for it
  const selfServe = (folder.runtime as { services?: { messaging?: { provider?: unknown } } } | undefined)?.services?.messaging?.provider === "gupshup-selfserve";
  const placed = o.placeReportKey ? await placeRuntimeReportKey({ runner: ctx.runner, docker: ctx.docker, image: server.appImage, dir: ctx.dir, runtimeFolder: names.runtime(name), panelOn: server.panel.enabled }) : undefined;
  const reportKey = placed === undefined ? {} : placed.readable ? { reportKeyReadable: true } : { reportKeyReadable: false, reportKeyWhy: placed.why };
  const planOptions = { ...reportKey, ...(gupshupRenewed ? { gupshupRenewed: true } : {}), ...(speechKeyHandedIn(ctx.dir) ? { speechKeyHandedIn: true } : {}) };
  const first = planShop(server, folder, {}, check, planOptions);
  problems.push(...first.problems);
  notes.push(...first.notes);
  if (folder.lock && !pathwayDir) problems.push({ rule: "pathway-pin", message: `${name} is pinned to ${folder.lock.pathway}@${folder.lock.version}, but this server does not have that version. Put a checkout of it in ${keptDirFor(ctx.appDir, ctx.dir, folder.lock.pathway, folder.lock.version)}, or change the pin once that version has passed the crash test with this shop's settings.` });
  problems.push(...missingSecrets(ctx.dir, name, webhooks, calendar, razorpay, gupshup, gupshupRenewed, selfServe));
  // The key handed in must be the account the connection check confirmed: a different account is an error, never a silent switch. The gateway, its credential file and
  // its key's shape are its folder's (B71); a pin for another gateway than the one the shop chose is not this shop's.
  const gateway = gatewayOf((folder.settings as { payment?: PaymentSettings } | undefined)?.payment);
  const pinned = gateway && folder.pins.gateway?.provider === gateway.id ? folder.pins.gateway : undefined;
  const authorization = pinned ? readSecretFile(secretFile(ctx.dir, `g-${name}-${gateway!.id}`, gateway!.gateway!.guard.secretFile)) : undefined;
  if (pinned && authorization) {
    const keyId = Buffer.from(authorization.replace(/^Basic /u, ""), "base64").toString("utf8").split(":")[0];
    if (keyId !== pinned.keyId) problems.push({ rule: "gateway-key-matches-pin", message: `${name}: the ${gateway!.displayName} key handed in (id ${keyId}) is not the account the connection check confirmed (id ${pinned.keyId}). Check the account again before going on.` });
    else if (gateway!.gateway!.setup.modeOf(keyId) !== pinned.mode) problems.push({ rule: "gateway-key-matches-pin", message: `${name}: the ${gateway!.displayName} key ${keyId} is not a ${pinned.mode}-mode key, which is what the connection check confirmed.` });
  }
  if (first.problems.length > 0 || !pathwayDir) return { problems, notes };

  // Guard loads a bundle only if its version is HIGHER than the one it already has: the same content keeps its version, changed content gets the next.
  const prev = state.shops[name]?.guards ?? {};
  const versions: Record<string, number> = {};
  for (const g of first.guards) versions[g.kind] = prev[g.kind]?.contentHash === contentHash(g.spec) ? prev[g.kind].version : (prev[g.kind]?.version ?? 0) + 1;
  const plan = planShop(server, folder, versions, check, planOptions);
  // reserve the network index now, so two shops added together never share one (it is saved only when the deploy goes through)
  const index = (state.shops[name] ??= { index: shopIndex(state, name), guards: {}, lockHistory: [] }).index;
  return {
    prepared: { folder, plan, webhooks, pathwayDir, index, guards: plan.guards.map((g) => ({ plan: g, version: versions[g.kind], contentHash: contentHash(g.spec) })), desiredHash: desiredHashOf(folder), gupshupRenewed },
    problems, notes,
  };
}

export type Sha = { admin: string; agents: { id: string; sha: string; operations?: string[] }[] };

/** Who approves at a shop's Razorpay Guard: the owner alone (as it always was), or, B37, the owner and the shop's other people with the two-person amount in paise. */
export function approverOf(shop: string, approvers: ApproversSettings | undefined): NonNullable<Parameters<typeof guardToml>[0]["approver"]> {
  if (!approvers) return { id: names.approverId(shop), secretFile: "/run/secrets/owner_notify_secret" };
  return {
    id: names.ownerApproverId(shop, true), secretFile: "/run/secrets/owner_notify_secret",
    group: { people: approvers.people.map((p) => ({ id: p.id, secretFile: `/run/secrets/${names.approverSecretFile(p.id)}` })), ...(approvers.twoAboveInr !== undefined ? { twoAbovePaise: approvers.twoAboveInr * 100 } : {}) },
  };
}

/** B37: the ids of a shop's other approvers, from its Razorpay Guard's plan. */
const peopleOf = (guards: { plan: GuardPlan }[]): string[] => guards.find((g) => g.plan.kind === "razorpay")?.plan.approvers?.people.map((p) => p.id) ?? [];

/** The words a refused deploy says when the server has no licence key (plan decision 39). `init` says the same, so the two never differ. */
export const NO_LICENCE_KEY = "This server has no licence key from Geometer (geometer.json \"licence\"). Guard runs a builder's shop only under Geometer's licence (decision 39, monorepo ADR-0070): without it, no shop here would take new work. Pair the server with Geometer: the install command does it, and writes the key and the server's first lease. By hand: `geometer init <folder> --licence-key <the 64 hex characters Geometer gave you>`.";

/**
 * Plan B13 and decision 39 (monorepo ADR-0062, ADR-0070): every per-shop Guard is given `[licence]`, always. So the deploy is refused, in plain words, when
 * geometer.json pins no key (`licence.keys`, which `init` now requires) or when the image does not read the block (asked of the image itself, once: an older one
 * ignores the table, so a block it ignores would read as if it did something). A shop is never run without the licence.
 */
export async function guardLicenceOn(ctx: Context, server: ServerConfig): Promise<{ on: true } | { on: false; problem: Problem }> {
  if (!server.licence?.keys.length) return { on: false, problem: { rule: "licence-key", message: NO_LICENCE_KEY } };
  if (!ctx.tool.readsLicence || !(await ctx.tool.readsLicence())) return { on: false, problem: { rule: "guard-image-licence", message: `The Guard image ${server.guardImage} does not check Geometer's licence lease (it is older than monorepo ADR-0062), and a shop is never run without it. Use the Guard image this release of the bundle names (geometer.json \"guardImage\").` } };
  return { on: true };
}

/** The `[licence]` a per-shop Guard is given (never the model Guard's): the server's id, the shop's (or agent's) id, and its own people's numbers (`ownNumbersOf`). */
export function licenceFor(server: ServerConfig, on: boolean, kind: GuardPlan["kind"], shop: string | undefined, numbers: readonly (string | undefined)[]): (GuardLicence & { kids: string[] }) | undefined {
  if (!on || kind === "model" || !shop || !server.licence) return undefined;
  return { deployment: fleetIdOf(server), shop, ownerNumbers: [...new Set(ownerNumbers(numbers))], kids: server.licence.keys.map((k) => kidOf(Buffer.from(k, "hex"))).sort() };
}

/**
 * Compile one Guard's spec, render its guard.toml, run the tool-name rule and verify-bundle. Nothing running is touched. `approvalOperations` (B71 part 2): an
 * agent's own API whose reviewed spec holds these operations for a person; its Guard gets the owner as approver for them (a gateway's Guard always has the owner
 * for its refunds).
 */
export async function compileAndVerify(ctx: Context, server: ServerConfig, shop: string | undefined, g: PreparedGuard, who: Sha, licence?: GuardLicence & { kids: string[] }, approvalOperations?: string[]): Promise<Problem[]> {
  const compiled = await ctx.tool.compile(g.plan.specText);
  if (!compiled.ok) return compiled.problems.map((p) => ({ ...p, message: `${g.plan.service}: ${p.message}` }));
  g.compiled = compiled.result;
  if (licence) g.licence = licence; else delete g.licence;
  const block = licence ? { deployment: licence.deployment, shop: licence.shop, ownerNumbers: licence.ownerNumbers, ...(g.plan.def.recipientField ? { recipientField: g.plan.def.recipientField } : {}) } : undefined;
  const approver = !shop ? undefined : isGatewayKind(g.plan.kind) ? approverOf(shop, g.plan.approvers) : approvalOperations && approvalOperations.length > 0 ? { ...approverOf(shop, undefined), operations: approvalOperations } : undefined;
  g.toml = guardToml({ def: g.plan.def, tenant: g.plan.tenant, deployment: g.plan.deployment, bundleDigest: compiled.result.digest, upstream: g.plan.upstream, adminSha: who.admin, agents: who.agents, ...(approver ? { approver } : {}), ...(block ? { licence: block } : {}) });
  g.tripwires = await ctx.tool.verify(compiled.result.text, g.toml);
  return [...toolNamesMatch(g.plan, g.toml, compiled.result), ...tripwiresHold(g.plan, g.tripwires)];
}

/** Server-level things every deploy needs: the Guard image on this machine, the model's key, the deployment key. */
export async function serverProblems(ctx: Context, server: ServerConfig): Promise<Problem[]> {
  const problems: Problem[] = [];
  const image = await ctx.runner.run(ctx.docker, ["image", "inspect", "--format", "{{.Id}}", server.guardImage], { timeoutMs: 30_000 });
  if (image.code !== 0) problems.push({ rule: "guard-image", message: `The Guard image ${server.guardImage} is not on this machine. It is not published to a registry yet, so it cannot be pulled: load it with \`docker load < geo-guard.tar\` (the tarball Geometer gives you), or set "guardImage" in geometer.json to the name it was loaded under.` });
  const keyFile = server.model.wire === "anthropic" ? "model_api_key" : "model_authorization";
  if (!modelChosen(server)) problems.push({ rule: "model-not-chosen", message: NO_MODEL });
  else if (!have(ctx.dir, "g-model", keyFile)) problems.push({ rule: "secret-missing:model_key", message: `The model's API key is not in place. Run \`geometer model-key <file>\` (a file with the key on one line); it goes to the model Guard only.` });
  if (server.backup && !have(ctx.dir, "backup", "snapshots") && server.backup.snapshots.url.startsWith("s3://")) problems.push({ rule: "secret-missing:backup-key", message: "The snapshot bucket's key is not in place. Run `geometer backup-key snapshots <file>` (the file has `access-key-id:secret` on one line)." });
  if (server.fleet && !readSecretFile(resolve(ctx.dir, server.fleet.keyFile))) problems.push({ rule: "fleet-key", message: `The deployment key file ${server.fleet.keyFile} is missing, so no heartbeat could be sent and Geometer's alerts from outside would never fire.` });
  return problems;
}

/** `check`: everything a deploy would check, offline. It starts nothing and touches nothing that is running (it does take the secrets handed in out of the inbox, and make any token that is missing). */
export async function checkShop(ctx: Context, name: string): Promise<{ ok: boolean; problems: Problem[]; notes: string[]; lines: string[] }> {
  const server = loadServer(ctx.dir);
  const state = loadState(ctx.dir);
  const { prepared, problems, notes } = await prepareShop(ctx, server, state, name);
  problems.push(...await serverProblems(ctx, server));
  const lines: string[] = [];
  if (prepared) {
    const creds = ensureCredentials(ctx.dir, name, server.panel.enabled, hasCalendar(prepared.guards.map((g) => g.plan)), hasRazorpay(prepared.guards.map((g) => g.plan)), peopleOf(prepared.guards), prepared.gupshupRenewed);
    const licence = await guardLicenceOn(ctx, server);
    if (!licence.on) problems.push(licence.problem);
    for (const g of prepared.guards) {
      problems.push(...await compileAndVerify(ctx, server, name, g, { admin: sha(creds.admin[g.plan.kind as "razorpay"]), agents: agentsOf(name, g.plan.kind, creds) }, licenceFor(server, licence.on, g.plan.kind, name, ownNumbersOf(prepared.folder))));
      if (g.tripwires) lines.push(`${g.plan.service}: ${provenLine(g.tripwires)}`);
    }
  }
  return { ok: problems.length === 0, problems, notes, lines };
}

// ---- writing the server and bringing it up ------------------------------------------------------------------------------------------------

function deployOf(ctx: Context, name: string, shop: { index: number; applied?: Snapshot }): ShopDeploy {
  const s = shop.applied!;
  return { name, index: shop.index, pathwayDir: appliedPathwayDir(ctx.appDir, ctx.dir, s) ?? s.pathwayDir, guards: Object.values(s.guards).map((g) => ({ kind: g.kind as GuardPlan["kind"], service: g.service, tenant: name })) };
}

/** Write every generated file for the whole server from what has been applied, and return the compose text. */
export function writeServer(ctx: Context, server: ServerConfig, state: State): Composed {
  const p = serverPaths(ctx.dir);
  const applied = Object.entries(state.shops).filter(([, s]) => s.applied).sort(([a], [b]) => (a < b ? -1 : 1));
  const shops = applied.map(([name, s]) => {
    const snap = s.applied!;
    const settings = JSON.parse(snap.settingsText) as { owner: { whatsapp: string }; approvers?: ApproversSettings };
    const runtime = snap.runtime as { services: { messaging: { phoneNumberId: string; provider?: string; appId?: string; appName?: string; sourceNumber?: string } } };
    const m = runtime.services.messaging;
    // item 11b: a Gupshup shop's inbox checks the app id on each callback, and its relay asks the owner through Gupshup's paths
    const whatsappRoute = m.provider === "gupshup" && m.appId ? { whatsappRoute: { provider: "gupshup" as const, appId: m.appId } }
      : m.provider === "gupshup-selfserve" && m.appName && m.sourceNumber ? { whatsappRoute: { provider: "gupshup-selfserve" as const, appName: m.appName, sourceNumber: m.sourceNumber, ...(m.appId ? { appId: m.appId } : {}) } } : {};
    // follow-up 2: from the snapshot, so the compose file mounts the renewed token exactly when the applied Guard was compiled to read it
    return { ...deployOf(ctx, name, s), webhooks: webhooksFor(ctx.dir, name, hasCalendar(Object.values(snap.guards))), ownerWhatsapp: settings.owner.whatsapp, phoneNumberId: m.phoneNumberId, ...whatsappRoute, ...(snap.whatsappTokens === "renewed" ? { gupshupRenewed: true } : {}), pathway: snap.pathway.split("@")[0], pathwayVersion: snap.pathway.split("@")[1], ...(settings.approvers ? { approvers: settings.approvers.people } : {}) };
  });
  for (const [name, s] of applied) {
    const client = join(p.generated, "shops", name, "client");
    writeAtomic(join(client, "settings.json"), s.applied!.settingsText);
    writeAtomic(join(client, "runtime.json"), stableJson(s.applied!.runtime));
    writeAtomic(join(client, "pathway.lock"), s.applied!.lockText);
    for (const g of Object.values(s.applied!.guards)) writeGuardFiles(ctx.dir, g.service, g);
  }
  if (state.modelApplied) writeGuardFiles(ctx.dir, names.modelGuard, state.modelApplied);
  // the licence lease (B13): each runtime is handed its shop's entry before it starts (client/licence.json; no lease kept, or no key pinned, means none is restricted)
  syncLicence(ctx.dir, server, applied.map(([name]) => name), ctx.now()).forEach((l) => ctx.log(l));
  // B72: the shop terms the owner can agree to on WhatsApp. Handed to a runtime (client/terms.json) only when the server setting is on AND the partner filled the shop's terms in;
  // otherwise any copy is taken away, so turning the setting off switches the feature off at the next deploy.
  for (const [name] of applied) syncTerms(ctx.dir, server.panel.termsOnWhatsapp, name);
  // agents someone else wrote stay in the compose file whenever a shop is deployed (without this, `up --remove-orphans` would take their Guards away)
  const agents = agentFacts(ctx.dir, state);
  for (const a of Object.values(state.agents ?? {})) if (a.applied) for (const g of Object.values(a.applied.guards)) writeGuardFiles(ctx.dir, g.service, g);
  writeAtomic(join(p.generated, "inbox", "inbox.json"), inboxConfig(server, shops, agents));
  writeAtomic(join(p.generated, "relay", "relay.json"), relayConfig(server, shops, agents));
  writeAtomic(join(p.generated, "refresher", "refresher.json"), refresherConfig(server, shops, {}, agents));
  writeAtomic(join(p.generated, "ops", "ops.json"), opsConfig(server, shops, agents));
  // item 11f: the pages domain's front door, on a server that answers for it (no secret in it: fleet's lookups are public)
  const door = doorConfig(server);
  if (door) writeAtomic(join(p.generated, "door", "door.json"), door);
  // the deployment key goes to the one container that sends heartbeats
  if (server.fleet) writeSecretFile(secretFile(ctx.dir, "ops", "fleet_key"), readSecretFile(resolve(ctx.dir, server.fleet.keyFile)) ?? "");
  // the continuous copy (Litestream) is gone since 9 Nov 2026: its config held a bucket key, and its own key is no longer read by anything, so neither is kept
  for (const old of [secretFile(ctx.dir, "litestream"), secretFile(ctx.dir, "backup", "stream")]) if (existsSync(old)) { rmSync(old, { recursive: true, force: true }); ctx.log(`Removed ${old}: the continuous copy is no longer made, so its key is not kept.`); }
  // the licence folder each per-shop Guard mounts read-only (B13): made here, 0755, before compose up, or Docker would make it as root and the deployer could not write the lease
  ensureDir(licencePaths(ctx.dir).root); ensureDir(licencePaths(ctx.dir).extensions);
  // the folder ops writes fleet's answers into: made for the user ops runs as (the one who runs the deployer, like the panel), so both can read and write it
  ensureDir(p.fleet);
  const opsUser = panelUser();
  if (process.getuid?.() === 0) chownSync(p.fleet, opsUser.uid, opsUser.gid);
  const composed = composeServer(server, dirsOf(ctx), shops, { opsUser: `${opsUser.uid}:${opsUser.gid}`, ...(server.panel.enabled ? { panel: preparePanel(ctx) } : {}), ...(agents.length > 0 ? { agents } : {}) });
  writeAtomic(composeFile(ctx.dir), composed.compose);
  writeAtomic(join(p.generated, "Caddyfile"), composed.caddyfile);
  return composed;
}

/**
 * What the panel container needs from the host: two keys (0600, in secrets/panel/, which the panel refuses to use if anyone else could read them), folders it can write
 * (the shops, the secrets inbox, stop requests, its own data) and the user to run as. It is given NO other folder of the server.
 */
function preparePanel(ctx: Context): PanelOptions {
  const p = serverPaths(ctx.dir);
  // data_key: 32 bytes as hex (vault.ts). signing_key: an Ed25519 private key in PEM, as the pathway's report key is (modules/report/sign.ts loadPrivateKey); it signs go-live certificates.
  ensureSecret(secretFile(ctx.dir, "panel", "data_key"), mintSecret, 0o600);
  ensurePanelSigningKey(ctx.dir);
  const { uid, gid } = panelUser();
  for (const d of [p.shops, p.secretsInbox, p.requests, p.exports, p.panel, p.status]) {
    ensureDir(d);
    if (process.getuid?.() === 0 && d !== p.exports && d !== p.status) chownSync(d, uid, gid); // a deployer running as root hands the panel's folders to the user the panel runs as
  }
  const server = secretFile(ctx.dir, "refresher", "_server", "google_service_account.json");
  let shareAddress: string | undefined;
  try { shareAddress = (JSON.parse(readFileSync(server, "utf8")) as { client_email?: string }).client_email; } catch { /* no server-wide key */ }
  const run = existsSync(join(ctx.appDir, "bundle", "panel", "main.ts"));
  if (!run) ctx.log("note: the panel is switched on in geometer.json, but this checkout has no bundle/panel/main.ts, so no panel container is started (its network, keys and Guard agents are still made).");
  return { user: `${uid}:${gid}`, run, ...(shareAddress ? { shareAddress } : {}) };
}

function writeGuardFiles(dir: string, service: string, g: { specText: string; bundleText: string; tomlText: string }): void {
  const folder = join(serverPaths(dir).generated, "guards", service);
  writeAtomic(join(folder, "spec.json"), g.specText);
  writeAtomic(join(folder, "bundle.json"), g.bundleText);
  writeAtomic(join(folder, "guard.toml"), g.tomlText);
}

/** The compose entry of a service, and what is in the files it mounts, as two hashes: a changed entry is recreated by compose, changed files need a restart. */
function serviceHashes(composed: Composed, name: string): { block: string; files: string } {
  const s = composed.services[name];
  return { block: sha256Hex(stableJson(s.block)), files: sha256Hex(stableJson(s.files.map((f) => (existsSync(f) ? sha256Hex(readFileSync(f, "utf8")) : "")))) };
}

export interface ShopResult { shop: string; proven: { passed: number; of: number; line: string }; guards: Record<string, GuardProof> }

/**
 * Deploy one shop, or all shops. Returns what was proven on the running Guards. Throws Refused, naming every broken rule, before anything is changed.
 */
export async function deploy(ctx: Context, only?: string): Promise<ShopResult[]> {
  const targets = only ? [only] : listShops(ctx.dir);
  const known = targets.filter((t) => existsSync(serverPaths(ctx.dir).shop(t)));
  const before = new Map(known.map((shop) => [shop, readStatus(ctx.dir, shop)?.deploy]));
  for (const shop of known) updateStatus(ctx.dir, shop, ctx.now(), (s) => { s.deploy = { state: "in-progress", at: ctx.now().toISOString() }; });
  try {
    return await deployChecked(ctx, only);
  } catch (e) {
    if (e instanceof Refused) {
      // A refusal names its shop in its message. One that names none (the Guard image, the model's key) is every target's; one that names another shop is not mine.
      const names = (p: Problem) => known.filter((k) => new RegExp(`(^|[^a-z0-9-])${k}([^a-z0-9-]|$)`, "u").test(p.message));
      for (const shop of known) {
        const why = e.problems.filter((p) => { const n = names(p); return n.length === 0 || n.includes(shop); });
        updateStatus(ctx.dir, shop, ctx.now(), (s) => { s.deploy = why.length > 0 ? { state: "failed", at: ctx.now().toISOString(), message: refusalMessage(why), refusal: why } : before.get(shop) ?? { state: "never" }; }, why.length > 0);
      }
    }
    throw e;
  }
}

async function deployChecked(ctx: Context, only?: string): Promise<ShopResult[]> {
  const server = loadServer(ctx.dir);
  prepareSecretsRoot(ctx.dir);
  const state = loadState(ctx.dir);
  const targets = only ? [only] : listShops(ctx.dir);
  if (targets.length === 0) throw new Refused([{ rule: "no-shops", message: "There are no shops yet. Add one with `geometer shop add <name> --from <client folder>`." }]);

  // 1. plan every target and refuse on anything that can be seen without compiling
  const prepared: Prepared[] = [];
  const problems: Problem[] = await serverProblems(ctx, server);
  for (const name of targets) {
    const r = await prepareShop(ctx, server, state, name, { placeReportKey: true });
    problems.push(...r.problems);
    r.notes.forEach((n) => ctx.log(`note: ${n}`));
    if (r.prepared) prepared.push(r.prepared);
  }
  if (problems.length > 0) throw new Refused(problems);

  // 2. credentials, then compile and verify every Guard (the model Guard knows every shop's runtime, so it is verified again whenever a shop is added)
  const creds = new Map(prepared.map((p) => [p.folder.name, ensureCredentials(ctx.dir, p.folder.name, server.panel.enabled, hasCalendar(p.guards.map((g) => g.plan)), hasRazorpay(p.guards.map((g) => g.plan)), peopleOf(p.guards), p.gupshupRenewed)]));
  const licence = await guardLicenceOn(ctx, server);
  if (!licence.on) problems.push(licence.problem);
  for (const p of prepared) for (const g of p.guards) problems.push(...await compileAndVerify(ctx, server, p.folder.name, g, { admin: sha(creds.get(p.folder.name)!.admin[g.plan.kind as "razorpay"]), agents: agentsOf(p.folder.name, g.plan.kind, creds.get(p.folder.name)!) }, licenceFor(server, licence.on, g.plan.kind, p.folder.name, ownNumbersOf(p.folder))));
  const everyShop = [...new Set([...Object.entries(state.shops).filter(([, s]) => s.applied).map(([n]) => n), ...prepared.map((p) => p.folder.name)])].sort();
  const modelAdmin = ensureSecret(secretFile(ctx.dir, "ops", "_model", "admin_token"), mintGuardToken);
  const modelPlan = planModelGuard(server, 1);
  const prevModel = state.model;
  const modelVersion = prevModel?.contentHash === contentHash(modelPlan.spec) ? prevModel.version : (prevModel?.version ?? 0) + 1;
  const model: PreparedGuard = { plan: planModelGuard(server, modelVersion), version: modelVersion, contentHash: contentHash(modelPlan.spec) };
  const modelAgents = everyShop.map((s) => ({ id: names.agentId(s), sha: sha(creds.get(s)?.agent.model ?? readSecretFile(secretFile(ctx.dir, names.runtime(s), "agent_model")) ?? "") }));
  problems.push(...await compileAndVerify(ctx, server, undefined, model, { admin: sha(modelAdmin), agents: modelAgents }));
  if (problems.length > 0) throw new Refused(problems);

  // 3. nothing broken: no secret in any file we are about to write, then write
  const configs: Record<string, string> = {};
  for (const p of prepared) {
    configs[`${p.folder.name}/runtime.json`] = stableJson(p.plan.runtime);
    for (const g of p.guards) { configs[`${g.plan.service}/spec.json`] = g.plan.specText; configs[`${g.plan.service}/guard.toml`] = g.toml!; }
  }
  configs["g-model/guard.toml"] = model.toml!;
  const secretValues = prepared.flatMap((p) => { const c = creds.get(p.folder.name)!; return [...Object.values(c.agent), ...Object.values(c.admin), ...Object.values(c.panel ?? {}), ...["razorpay_authorization", "whatsapp_authorization"].map((f) => readSecretFile(secretFile(ctx.dir, `g-${p.folder.name}-${f.split("_")[0]}`, f)) ?? ""), readSecretFile(secretFile(ctx.dir, names.runtime(p.folder.name), "internal_token")) ?? "", readSecretFile(personKeyFile(ctx.dir, p.folder.name)) ?? "", readSecretFile(secretFile(ctx.dir, names.runtime(p.folder.name), RECORD_KEY_FILE)) ?? ""]; });
  const leaks = noSecretsIn(configs, secretValues.filter(Boolean));
  if (leaks.length > 0) throw new Refused(leaks);

  const at = ctx.now().toISOString();
  for (const p of prepared) {
    const s = state.shops[p.folder.name];
    const previousLock = s.applied?.lockText;
    if (previousLock !== undefined && previousLock !== p.folder.lockText) s.lockHistory.push(previousLock);
    for (const g of p.guards) s.guards[g.plan.kind] = { version: g.version, contentHash: g.contentHash, digest: g.compiled!.digest, tripwires: { passed: g.tripwires!.passed, of: g.tripwires!.of, notSelfTestable: g.tripwires!.notSelfTestable } };
    s.applied = {
      appliedAt: at, pathway: `${p.folder.lock!.pathway}@${p.folder.lock!.version}`, lockText: p.folder.lockText, settingsText: p.folder.settingsText, runtime: p.plan.runtime, pathwayDir: p.pathwayDir, desiredHash: p.desiredHash,
      ...(p.gupshupRenewed ? { whatsappTokens: "renewed" as const } : {}),
      guards: Object.fromEntries(p.guards.map((g) => [g.plan.kind, { kind: g.plan.kind, service: g.plan.service, specText: g.plan.specText, bundleText: g.compiled!.text, tomlText: g.toml! }])),
    };
    s.lastDeployAt = at;
  }
  state.model = { version: model.version, contentHash: model.contentHash, digest: model.compiled!.digest, tripwires: { passed: model.tripwires!.passed, of: model.tripwires!.of, notSelfTestable: model.tripwires!.notSelfTestable } };
  state.modelApplied = { kind: "model", service: names.modelGuard, specText: model.plan.specText, bundleText: model.compiled!.text, tomlText: model.toml! };
  const composed = writeServer(ctx, server, state);

  // 4. only what changed: compose recreates a service whose entry changed; a service whose FILES changed (compose cannot see that) is restarted
  const changed = await bringUp(ctx, state, composed, prepared.map((p) => p.folder.name));

  // 5. the RUNNING Guards say what they enforce, the model Guard's among them
  const results: ShopResult[] = [];
  const modelProof = await proveRunning(ctx, [model]);
  if (modelProof.problems.length > 0) throw new Refused(modelProof.problems);
  for (const p of prepared) {
    const proof = await proveRunning(ctx, p.guards);
    if (proof.problems.length === 0 && hasRazorpay(p.guards.map((g) => g.plan))) await renewRelayCredential(ctx, p.folder.name); // no relay for a UPI shop
    const failedBy = [...proof.problems, ...proof.licence];
    const stop = state.shops[p.folder.name].stopped;
    if (stop) await ops(ctx, ["stop", p.folder.name, "on", "-", stop.reason]); // a recreated Guard keeps its kill switch in its store; this makes sure
    const total = Object.values(proof.guards).reduce((t, g) => ({ passed: t.passed + g.passed, of: t.of + g.of }), { passed: 0, of: 0 });
    const line = provenLine({ ...total, notSelfTestable: Object.values(proof.guards).flatMap((g) => g.notSelfTestable) });
    updateStatus(ctx.dir, p.folder.name, ctx.now(), (s) => {
      s.deploy = failedBy.length === 0 ? { state: "applied", at } : { state: "failed", at, message: refusalMessage(failedBy), refusal: failedBy };
      s.limits = { proven: total.passed, of: total.of, unprovable: [...new Set(Object.values(proof.guards).flatMap((g) => g.notSelfTestable))], line, perGuard: proof.guards, model: modelProof.guards.model };
      s.versions = { pathway: state.shops[p.folder.name].applied!.pathway, bundle: opsBundleVersion(), guard: server.guardImage, guards: Object.fromEntries(Object.entries(state.shops[p.folder.name].guards).map(([k, v]) => [k, v.version])) };
      if (stop) s.stopped = { at: stop.at, by: stop.by, reason: stop.reason, ...(stop.requestId ? { requestId: stop.requestId } : {}) }; else delete s.stopped;
      s.webhooks = { razorpay: `https://${server.domain}/c/${p.folder.name}/webhooks/razorpay`, whatsapp: `https://${server.domain}/c/${p.folder.name}/webhooks/whatsapp` };
    });
    if (proof.problems.length > 0) {
      await ops(ctx, ["stop", p.folder.name, "on", "the deployer", "a running Guard did not match what was checked"]);
      throw new Refused(proof.problems);
    }
    // a Guard that cannot check the lease restricts nothing by it: the deploy is refused, but the kill switch is NOT pulled (it would stop refunds owed too)
    if (proof.licence.length > 0) throw new Refused(proof.licence);
    results.push({ shop: p.folder.name, proven: { ...total, line }, guards: proof.guards });
  }
  ctx.log(`Changed services: ${changed.length === 0 ? "none" : changed.join(", ")}`);
  return results;
}

/**
 * Bring up what changed in the compose file just written, and nothing else: compose recreates a service whose entry changed, and a service whose FILES changed (compose cannot see
 * that) is restarted. Shared by the deploy of a shop and of an agent someone else wrote, so the two cannot drift apart. Returns the services that changed.
 *
 * `reload` (an own agent's credential rotation only, agent/rotate.ts): Guards whose files changed but whose policy did not are asked to read their guard.toml again
 * (POST /admin/reload) instead of being restarted, so a call in flight is not cut off. A Guard that refuses, or answers that a change needs a restart, is restarted as before.
 */
export async function bringUp(ctx: Context, state: State, composed: Composed, forWhom: string[], o: { reload?: readonly string[] } = {}): Promise<string[]> {
  const hashes = Object.fromEntries(Object.keys(composed.services).map((n) => [n, serviceHashes(composed, n)]));
  const before = state.serviceHashes ?? {};
  ctx.log(`Bringing up ${forWhom.join(", ")}...`);
  // A new shop's Calendar Guard mounts its own sub-folder of the token volume, and Docker cannot even create that container before the folder exists. The refresher
  // makes every shop's folder when it starts, so a refresher that is already running with the old list is restarted FIRST, and waited for.
  if (before.refresher && before.refresher.block === hashes.refresher.block && before.refresher.files !== hashes.refresher.files) {
    await compose(ctx, ["restart", "refresher"]);
    for (let i = 0; i < 40; i++) { const ps = await compose(ctx, ["ps", "refresher"], { timeoutMs: 30_000 }); if (/\(healthy\)/u.test(ps.stdout)) break; await ctx.sleep(3_000); }
  }
  const up = await compose(ctx, ["up", "-d", "--remove-orphans"]);
  if (up.code !== 0) throw new Refused([{ rule: "compose-up", message: `docker compose up failed: ${up.stderr.trim().split("\n").slice(-3).join(" | ")}. ${await whatIsNotUp(ctx)}` }]);
  // A Guard shares its forwarder's network namespace. If the forwarder was recreated (a shop added changes the model forwarder's networks), the Guard must
  // be recreated too, or it is left in a namespace that no longer exists. Compose does this for a dependent; this makes sure, and costs one restart at most.
  const stranded = Object.keys(hashes).filter((n) => n.startsWith("fwd-") && before[n] && before[n].block !== hashes[n].block && before[`g-${n.slice(4)}`]).map((n) => `g-${n.slice(4)}`);
  if (stranded.length > 0) {
    ctx.log(`Recreating ${stranded.join(", ")} (their forwarder's networks changed).`);
    const r = await compose(ctx, ["up", "-d", "--force-recreate", "--no-deps", ...stranded]);
    if (r.code !== 0) throw new Refused([{ rule: "compose-recreate", message: `docker compose could not recreate ${stranded.join(", ")}: ${r.stderr.trim().split("\n").slice(-4).join(" | ")}` }]);
  }
  const restart = Object.keys(hashes).filter((n) => before[n] && before[n].block === hashes[n].block && before[n].files !== hashes[n].files && !stranded.includes(n) && n !== "refresher");
  const changed = Object.keys(hashes).filter((n) => !before[n] || before[n].block !== hashes[n].block || before[n].files !== hashes[n].files);
  const reloaded: string[] = [];
  for (const n of restart.filter((x) => o.reload?.includes(x))) {
    const r = await adminCall(ctx, n, "POST", "/admin/reload", {});
    const needsRestart = Array.isArray(r.body?.needs_restart) && r.body.needs_restart.length > 0;
    if (r.status === 200 && !needsRestart) reloaded.push(n);
  }
  if (reloaded.length > 0) ctx.log(`Reloaded ${reloaded.join(", ")} (only who may call them changed; not restarted).`);
  const toRestart = restart.filter((n) => !reloaded.includes(n));
  if (toRestart.length > 0) {
    ctx.log(`Restarting ${toRestart.join(", ")} (their files changed).`);
    const r = await compose(ctx, ["restart", ...toRestart]);
    if (r.code !== 0) throw new Refused([{ rule: "compose-restart", message: `docker compose restart failed: ${r.stderr.trim().split("\n").slice(-4).join(" | ")}` }]);
  }
  state.serviceHashes = hashes;
  saveState(ctx.dir, state);
  return changed;
}

/**
 * `geometer up`: bring up the server's own services (HTTPS, the panel, the heartbeat, the inbox, the relay, the token refresher) on a server where nothing has been
 * deployed yet, so the builder can sign in to the panel and make the first shop there. The one-step install (install.sh, plan item 14b) ends with it.
 *
 * Nothing is compiled or proven, because no Guard runs yet (composeServer leaves out the model Guard while there is no shop); the model, its key, the Guard image and
 * the backup key are needed only by the first shop's deploy, which checks them. Once a shop or an agent someone else wrote is deployed, `deploy` is the one way to
 * change what runs, so `up` refuses rather than rewrite the compose file without the tripwire proof. Running it again changes nothing that is already up.
 */
export async function upServer(ctx: Context): Promise<{ services: string[]; changed: string[] }> {
  const server = loadServer(ctx.dir);
  const state = loadState(ctx.dir);
  const deployed = [...Object.entries(state.shops).filter(([, s]) => s.applied).map(([n]) => n), ...Object.entries(state.agents ?? {}).filter(([, a]) => a.applied).map(([n]) => n)];
  if (deployed.length > 0) throw new Refused([{ rule: "up-with-shops", message: `This server already runs ${deployed.join(", ")}. \`geometer deploy\` is what brings it up from here, because it checks each shop's limits on its running Guards; \`up\` is only for a server with no shop yet.` }]);
  // the same check a deploy makes: a fleet section with no key file would start a heartbeat that can never be heard
  if (server.fleet && !readSecretFile(resolve(ctx.dir, server.fleet.keyFile))) throw new Refused([{ rule: "fleet-key", message: `The deployment key file ${server.fleet.keyFile} is missing, so no heartbeat could be sent and Geometer's alerts from outside would never fire.` }]);
  prepareSecretsRoot(ctx.dir);
  const composed = writeServer(ctx, server, state);
  const changed = await bringUp(ctx, state, composed, ["the server's own services"]);
  return { services: Object.keys(composed.services).sort(), changed };
}

/** After a failed `up`: which services are not running well, and the last lines each one said (they hold no secret: our programs never log one). */
async function whatIsNotUp(ctx: Context): Promise<string> {
  const ps = await compose(ctx, ["ps", "-a", "--format", "{{.Service}}\t{{.Status}}"], { timeoutMs: 60_000 });
  const bad = ps.stdout.trim().split("\n").map((l) => l.split("\t")).filter(([service, status]) => status !== undefined && !/\((healthy)\)|^Up (?!.*\((unhealthy|health: starting)\))/u.test(status) && !(service.startsWith("rd-") && /^Exited \(0\)/u.test(status))).map(([service, status]) => `${service}: ${status}`);
  if (bad.length === 0) return "";
  const logs = await compose(ctx, ["logs", "--no-color", "--tail", "6", ...bad.slice(0, 4).map((b) => b.split(":")[0])], { timeoutMs: 60_000 });
  return `Not running well: ${bad.slice(0, 6).join("; ")}. Their last lines: ${logs.stdout.trim().split("\n").slice(-12).join(" | ").slice(0, 900)}`;
}

const opsBundleVersion = (): string => (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;

/** A fresh reading credential for the shop's relay (an approver credential that expires: the production profile requires it), written where only the relay reads it. */
export async function renewRelayCredential(ctx: Context, shop: string, ttlSeconds = 7 * 86_400): Promise<boolean> {
  const r = await ops(ctx, ["issue-approver", shop, String(ttlSeconds)]);
  const token = r.stdout.trim().split("\n").at(-1) ?? "";
  if (r.code !== 0 || !/^gg_[0-9a-f]{32}$/u.test(token)) { ctx.log(`${shop}: the relay's reading credential could not be renewed (${r.stderr.trim().slice(0, 150) || `exit ${r.code}`}).`); return false; }
  writeSecretFile(secretFile(ctx.dir, "relay", shop, "read_token"), token);
  return true;
}

/** Wait for the shop's Guards, then read their policy and tripwires from the running processes. */
export async function proveRunning(ctx: Context, guards: PreparedGuard[]): Promise<{ guards: Record<string, GuardProof>; problems: Problem[]; /** a Guard given `[licence]` that does not check the lease with the pinned keys */ licence: Problem[] }> {
  const out: Record<string, GuardProof> = {};
  const problems: Problem[] = [];
  const licence: Problem[] = [];
  const tries = Math.max(1, Math.ceil((ctx.waitSeconds ?? 120) / 3));
  for (const g of guards) {
    let status: { status: number; body: any } = { status: 0, body: null };
    for (let attempt = 0; attempt < tries; attempt++) {
      status = await adminCall(ctx, g.plan.service, "GET", "/admin/status");
      if (status.status === 200 && status.body?.tripwires?.ran === true) break;
      if (attempt < tries - 1) await ctx.sleep(3_000);
    }
    const b = status.body;
    const digest: string | undefined = b?.policy?.digest;
    const t = b?.tripwires;
    if (status.status !== 200 || !t?.ran) { problems.push({ rule: `running-guard:${g.plan.service}`, message: `${g.plan.service} did not report its tripwires within ${ctx.waitSeconds ?? 120} s, so nothing is claimed about it.` }); continue; }
    out[g.plan.kind] = { passed: Number(t.passed), of: Number(t.of), notSelfTestable: (t.not_self_testable_items ?? []).map((i: { item: string }) => i.item), policyDigest: digest ?? "", version: g.version, ready: t.ok === true };
    if (digest !== g.compiled!.digest) problems.push({ rule: `running-guard:${g.plan.service}`, message: `${g.plan.service} is running the policy ${String(digest)}, not the one that was checked (${g.compiled!.digest}). The shop has been stopped.` });
    if (t.ok !== true) problems.push({ rule: `tripwire:${(t.failed ?? []).join(",") || g.plan.service}`, message: `${g.plan.service}'s tripwires failed on the running Guard (${t.passed} of ${t.of}). The shop has been stopped.` });
    if (g.licence) licence.push(...licenceHeld(g.plan.service, g.licence, b?.licence));
  }
  return { guards: out, problems, licence };
}

/**
 * The running Guard's own account of the lease (`licence` in /admin/status, ADR-0062 decision 10): it read the block, for this server and shop, and the keys built into
 * its binary are exactly the keys geometer.json pins. Otherwise it would take no lease fleet signs, and restrict nothing, while the panel shows the shop wound down.
 */
export function licenceHeld(service: string, want: GuardLicence & { kids: string[] }, seen: any): Problem[] {
  const rule = `licence:${service}`;
  if (!seen || seen.configured !== true) return [{ rule, message: `${service} does not report a licence block, so it does not check the lease (is its image older than monorepo ADR-0062?). Nothing was stopped; the runtime still refuses new work in the wind-down.` }];
  if (seen.deployment !== want.deployment || seen.shop !== want.shop) return [{ rule, message: `${service} checks the lease for ${String(seen.deployment)}/${String(seen.shop)}, not ${want.deployment}/${want.shop}. Nothing was stopped.` }];
  const kids = (Array.isArray(seen.keys) ? seen.keys : []).map((k: { kid?: unknown }) => String(k?.kid)).sort();
  if (kids.join(",") !== want.kids.join(",")) return [{ rule, message: `${service}'s image has the licence key${kids.length === 1 ? "" : "s"} ${kids.join(", ") || "(none)"} built in, but geometer.json pins ${want.kids.join(", ")}: it would take no lease fleet signs, so it would restrict nothing. licence.keys must be the keys built into the Guard image. Nothing was stopped.` }];
  return [];
}

export { Refused };
