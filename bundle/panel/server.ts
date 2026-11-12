// The panel's web server: plain node:http, pages rendered on the server, no JavaScript, no dependencies. One panel, two ways to run it: on a builder's
// own server, and on Geometer's server for the partners' shops. It never has the Docker socket: it writes files (desired state, a stop request, secrets
// into the inbox) and reads files (the deployer's status) and each runtime's /status.
//
// What every request goes through, in this order: the account is read from a signed cookie; the route says who may use it; a POST must carry the form's
// CSRF token (and, when the browser sends one, an Origin that is this panel); a shop that is not yours is a 404 on every route; and the log line is
// "METHOD path status ms" with no query, no cookie and no body, and an invitation's token blanked out.
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Settings } from "../../templates/commerce/bookings/src/settings.ts";
import type { Language } from "../../modules/language/languages.ts";
import { serviceName } from "../../templates/commerce/bookings/src/settings.ts";
import { formatInr } from "../../modules/language/format.ts";
import { pathwayVersion } from "../../templates/commerce/bookings/server/config.ts";
import { loadPrivateKey } from "../../modules/report/sign.ts";
import { kindFor } from "../lib/kinds.ts";
import { monthRange } from "../../modules/report/months.ts";
import { createAccounts } from "./accounts.ts";
import type { Account, Role } from "./accounts.ts";
import { casesOf, monthOf, monthlyFromExport, readExport } from "./activity.ts";
import { ConfigError, isSecure, readServerModel, webhookUrlFor } from "./config.ts";
import type { PanelConfig } from "./config.ts";
import { SECRET_NAMES, liveView, preparedByOf, serverPaths, shopIdFromName } from "./contract.ts";
import type { SecretName } from "./contract.ts";
import type { LiveView } from "./contract.ts";
import { chargeOf, formatRupees, latestPriceList, monthlyCost, paiseOf } from "./cost.ts";
import { createAgents } from "./agents.ts";
import { agentPage, agentsSection } from "./views-agents.ts";
import type { PriceList } from "./cost.ts";
import { planView } from "./plan.ts";
import { licenceView } from "./licence.ts";
import { createEntries, entriesFromForm, sumMargins } from "./health.ts";
import { createHealthData } from "./health-data.ts";
import { createVotes } from "./votes.ts";
import { healthPage, shopHealthPage, votePage } from "./views-health.ts";
import { createGoLive } from "./golive.ts";
import type { Unmet } from "./golive.ts";
import { inboxAll, inboxFor, optionsFor } from "./inbox.ts";
import { createHandover } from "./handover.ts";
import { createTerms } from "./terms.ts";
import { termsLinkWord, termsPage } from "./views-terms.ts";
import { applyVoice, keepSpeech, voiceFormOf, voiceOf } from "./voice.ts";
import { voiceLinkWord, voicePage } from "./views-voice.ts";
import { exportShop } from "./export.ts";
import { PaperError, createPapers } from "./papers.ts";
import type { MadePaper } from "./papers.ts";
import { papersPage } from "./views-papers.ts";
import { ExportError } from "../export/build.ts";
import { createLimiter } from "./ratelimit.ts";
import { InboxTaken, createInbox } from "./secrets.ts";
import { createSessions } from "./session.ts";
import type { Session } from "./session.ts";
import { applyAccounts, applyBusiness, applyDeposit, applyLanguages, buildSettings, draftFromShop, keepWhatsAppProvider, newDraft, paymentModuleOf, runtimeFor } from "./setup.ts";
import { gatewayOf, providerById } from "../../modules/payments/providers/index.ts";
import { reportOf, setupOf } from "./setups.ts";
import type { Body, Draft } from "./setup.ts";
import { createShops } from "./shops.ts";
import { CONFIRM_TOKEN, createConfirmations, planLimits, rawSettings } from "./confirmations.ts";
import { settingsDigest } from "../lib/limits-draft.ts";
import type { Change } from "../lib/limits-draft.ts";
import { confirmGoLivePage, confirmGonePage, confirmLimitsPage } from "./views-confirm.ts";
import { createStore } from "./store.ts";
import { CONFIRM_CHARS, createServerSetup } from "./server-setup.ts";
import { backupKeyFile, backupKeyPage, serverPage } from "./views-server.ts";
import { discoverTemplates } from "./templates.ts";
import type { Template } from "./templates.ts";
import { createVault, loadKeyFile, plainVault } from "./vault.ts";
import { errorPage, handoverPage, inboxPage, invitePage, joinPage, languageName, limitList, loginPage, setupChecksPage, setupStartPage, setupStepPage, shopPage, shopsPage, stopPage, when } from "./views.ts";
import type { ChecksView, Ctx, HandoverView, ShopCardView, ShopView } from "./views.ts";
import { WORDS, isDraftLanguage } from "./languages.ts";

export const MAX_BODY_BYTES = 64 * 1024;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/u;
const DOC_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(html|json|txt)$/u;
const NOTICES = new Set(["report"]);

export interface RunningPanel { host: string; port: number; url: string; close(): Promise<void> }
/** `prices`: the price list in force, which prices both a shop's plan and its running-cost line. Left out: the newest in prices/ (the repo's root) that is not a proposal. */
export interface PanelDeps { log?: (line: string) => void; prices?: PriceList }

interface Req {
  req: IncomingMessage;
  res: ServerResponse;
  path: string;
  params: string[];
  form: Body;
  account?: Account;
  session?: Session;
  ctx(): Ctx;
  lang: Language;
  extraHeaders: Record<string, string | string[]>;
}
type Handler = (r: Req) => void | Promise<void>;
interface Route { method: "GET" | "POST"; pattern: RegExp; access: "public" | "user" | "builder"; handler: Handler }

// Opens the panel's data folder (private, mode 0700) with the vault, store and the session secret, which is created once and then kept; split out so tests can open the same stores.
export function openStores(config: PanelConfig) {
  const paths = serverPaths(config.serverDir);
  mkdirSync(paths.panel, { recursive: true, mode: 0o700 });
  let vault = plainVault;
  if (config.dataKeyFile) vault = createVault(loadKeyFile(config.dataKeyFile, paths.panel));
  else if (config.mode === "hosted") throw new ConfigError("Hosted mode keeps accounts, invitations and drafts for other people, so it needs a data key: set PANEL_DATA_KEY_FILE to a file (outside the panel's folder) that holds 32 random bytes as hex.");
  const store = createStore(join(paths.panel, "data"), vault);
  const secretFile = join(paths.panel, "session-secret");
  // With a data key the cookie secret is derived from it (one secret to look after); without one it is a random file only the panel can read.
  let secret = vault.derive("session");
  if (!secret) {
    if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32).toString("hex"), { mode: 0o600 });
    secret = Buffer.from(readFileSync(secretFile, "utf8").trim(), "hex");
  }
  return { paths, vault, store, secret };
}

// Starts the panel's HTTP server. `deps` lets tests replace the clock, network and runtimes; it returns a handle to stop it.
export async function startPanel(config: PanelConfig, deps: PanelDeps = {}): Promise<RunningPanel> {
  const log = deps.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = () => (config.now ?? Date.now)();
  const { paths, store, secret } = openStores(config);
  const prices = deps.prices ?? latestPriceList();
  const accounts = createAccounts(store, now);
  const shops = createShops(config, store);
  const inbox = createInbox(shops, now);
  const goLive = createGoLive(config, shops, store);
  const confirmations = createConfirmations(store, now);
  const handover = createHandover(shops, accounts, store, now);
  const terms = createTerms(shops, config.serverDir); // B72: shop terms agreed on WhatsApp; off unless geometer.json says so
  const secure = isSecure(config);
  const sessions = createSessions(secret, { secure, now });
  const loginByAddress = createLimiter(20, 15 * 60_000, now);
  const loginByName = createLimiter(5, 15 * 60_000, now);
  const templates = () => discoverTemplates(config.templatesDir);
  const signingKey = config.signingKeyFile ? loadPrivateKey(config.signingKeyFile) : undefined;
  const staleMs = config.staleMinutes * 60_000;
  const canInvite = config.mode === "own";
  // the server's own settings (the panel's first run, plan item 14b): only a builder, only on their own server
  const serverSetup = createServerSetup(config, store, now);

  // ---- small helpers ------------------------------------------------------------------------------------------------------------------------

  const addressOf = (req: IncomingMessage): string => {
    if (config.trustProxy) {
      const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
      if (forwarded) return forwarded;
    }
    return req.socket.remoteAddress ?? "unknown";
  };
  const origin = (req: IncomingMessage): string => config.publicUrl ?? `http://${req.headers.host ?? "localhost"}`;
  const safeNext = (next: string | null): string => (next && /^\/[A-Za-z0-9/_?=&.%-]*$/u.test(next) && !next.startsWith("//") ? next : "/");

  function pickLanguage(req: IncomingMessage, account?: Account): Language {
    const known = (l: string | undefined): l is Language => (LANGUAGES as readonly string[]).includes(l ?? "");
    if (account) return account.language;
    const cookie = sessions.readLang(req.headers.cookie);
    if (known(cookie)) return cookie;
    for (const part of String(req.headers["accept-language"] ?? "").split(",")) {
      const code = part.split(";")[0].trim().slice(0, 2).toLowerCase();
      if (known(code)) return code;
    }
    return "en";
  }

  const redactPath = (path: string) => path.replace(/^\/join\/.+$/u, "/join/[invite]").replace(/^\/confirm\/.+$/u, "/confirm/[link]");

  function body(res: ServerResponse, status: number, type: string, content: string | Buffer, headers: Record<string, string | string[]> = {}) {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY", ...(secure ? { "strict-transport-security": "max-age=31536000" } : {}), ...headers });
    res.end(content);
  }

  const cspFor = (nonce: string) => `default-src 'none'; style-src 'nonce-${nonce}'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;

  const readForm = (req: IncomingMessage): Promise<Body | "too-big" | "bad"> => new Promise((resolve) => {
    if (!/^application\/x-www-form-urlencoded/iu.test(String(req.headers["content-type"] ?? ""))) { resolve("bad"); return; }
    if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) { resolve("too-big"); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BODY_BYTES) { resolve("too-big"); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { const out: Body = {}; for (const [k, v] of new URLSearchParams(Buffer.concat(chunks).toString("utf8"))) out[k] = v; resolve(out); });
    req.on("error", () => resolve("bad"));
  });

  // ---- what the pages need to know ----------------------------------------------------------------------------------------------------------

  function liveOf(id: string, probe?: Parameters<typeof liveView>[2]): LiveView {
    return liveView(shops.status(id), shops.stopRequest(id), probe, now(), staleMs);
  }

  function costFor(id: string, settings: Settings): ReturnType<typeof monthlyCost> {
    const meta = shops.meta(id);
    const data = readExport(shops.paths.exports(id));
    const observed = data ? monthlyFromExport(settings, data, monthOf(now(), settings.timezone), "live", now()).bookings.made : undefined;
    return monthlyCost({
      settings, ...(shops.fleet(id)?.plan ? { plan: shops.fleet(id)!.plan! } : {}), builder: config.mode === "own", ...(observed !== undefined && observed > 0 ? { observedBookings: observed } : {}), assumptions: meta.expectedBookings !== undefined ? { bookingsPerMonth: meta.expectedBookings } : {},
      ...(config.whatsappProvider ? { whatsappProvider: config.whatsappProvider } : {}), ...(config.hostingSharePaise !== undefined ? { hostingSharePaise: config.hostingSharePaise } : {}),
    }, prices);
  }

  function summaryOf(c: Ctx, s: Settings): NonNullable<ShopView["summary"]> {
    const w = c.w.shop;
    const dayNames = c.w.setup.business.dayNames;
    const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
    return {
      services: s.services.map((x) => `${serviceName(x, c.lang)} · ${formatInr(x.priceInr)}`),
      hours: keys.map((k, i) => `${dayNames[i]}: ${s.openingHours[k] ? w.hoursRange(s.openingHours[k]!.open, s.openingHours[k]!.close) : w.summaryClosed}`),
      deposit: w.summaryDeposit(formatInr(s.deposit.amountInr), s.deposit.holdMinutes),
      cancel: w.summaryCancel(s.cancellation.windowHours, formatInr(s.cancellation.refundLimitInr)),
      languages: s.languages.map(languageName).join(", "),
      owner: s.owner.whatsapp,
    };
  }

  // ---- the routes ---------------------------------------------------------------------------------------------------------------------------------

  const routes: Route[] = [];
  const on = (method: Route["method"], pattern: RegExp, access: Route["access"], handler: Handler) => routes.push({ method, pattern, access, handler });
  const page = (r: Req, status: number, html: string) => body(r.res, status, "text/html; charset=utf-8", html, { ...r.extraHeaders, "content-security-policy": cspFor(nonceOf.get(r.req) as string) });
  const redirect = (r: Req, to: string, cookies: string[] = []) => {
    const set = [...cookies, ...(Array.isArray(r.extraHeaders["set-cookie"]) ? r.extraHeaders["set-cookie"] : r.extraHeaders["set-cookie"] ? [r.extraHeaders["set-cookie"]] : [])];
    body(r.res, 303, "text/plain; charset=utf-8", "", { location: to, ...(set.length > 0 ? { "set-cookie": set } : {}) });
  };
  const nonceOf = new WeakMap<IncomingMessage, string>();
  const notFound = (r: Req) => page(r, 404, errorPage(r.ctx(), 404, r.ctx().w.errors.notFound));

  on("GET", /^\/healthz$/u, "public", (r) => body(r.res, 200, "text/plain; charset=utf-8", "ok\n"));
  on("GET", /^\/$/u, "public", (r) => redirect(r, r.account ? "/shops" : "/login"));

  on("GET", /^\/lang\/([a-z]{2})$/u, "public", (r) => {
    const code = r.params[0];
    if (!(LANGUAGES as readonly string[]).includes(code)) return notFound(r);
    if (r.account) accounts.setLanguage(r.account.id, code as Language);
    redirect(r, safeNext(new URL(r.req.url ?? "/", "http://x").searchParams.get("next")), [sessions.langCookie(code)]);
  });

  // sign in
  on("GET", /^\/login$/u, "public", (r) => r.account ? redirect(r, "/shops") : page(r, 200, loginPage(r.ctx(), { hostedNote: config.mode === "hosted" })));
  on("POST", /^\/login$/u, "public", async (r) => {
    const handle = (r.form.handle ?? "").slice(0, 80);
    const ip = addressOf(r.req);
    const keys = [`ip:${ip}`, `user:${handle.toLowerCase()}|${ip}`];
    const wait = Math.max(loginByAddress.blocked(keys[0]), loginByName.blocked(keys[1]));
    if (wait > 0) { r.extraHeaders["retry-after"] = String(wait); return page(r, 429, loginPage(r.ctx(), { error: r.ctx().w.login.wait(wait), handle, hostedNote: false })); }
    const account = await accounts.authenticate(handle, r.form.passphrase ?? "");
    if (!account) {
      loginByAddress.fail(keys[0]); loginByName.fail(keys[1]);
      return page(r, 401, loginPage(r.ctx(), { error: r.ctx().w.login.wrong, handle, hostedNote: false }));
    }
    loginByName.clear(keys[1]);
    redirect(r, "/shops", [sessions.issue(account.id, account.sessionVersion).setCookie]);
  });
  on("POST", /^\/logout$/u, "public", (r) => redirect(r, "/login", [sessions.clear()]));

  // invitations
  on("GET", /^\/join\/([A-Za-z0-9_-]{16,80})$/u, "public", (r) => {
    const token = r.params[0];
    const status = accounts.inviteStatus(token);
    const role = accounts.inviteRole(token);
    if (status !== "ok" || !role) return page(r, status === "unknown" ? 404 : 410, errorPage(r.ctx(), 410, r.ctx().w.join.problems[`invite-${status === "ok" ? "unknown" : status}`]));
    page(r, 200, joinPage(r.ctx(), { token, role, values: { name: "", company: "", handle: "", language: r.lang } }));
  });
  on("POST", /^\/join$/u, "public", async (r) => {
    const f = r.form;
    const w = r.ctx().w;
    const token = f.token ?? "";
    const result = await accounts.redeem(token, { handle: f.handle ?? "", name: f.name ?? "", company: f.company ?? "", passphrase: f.passphrase ?? "", language: f.language ?? "en" });
    if (!result.ok) {
      const gone = result.reason.startsWith("invite-");
      const role = accounts.inviteRole(token);
      if (gone || !role) return page(r, 410, errorPage(r.ctx(), 410, w.join.problems[result.reason as keyof typeof w.join.problems]));
      return page(r, 400, joinPage(r.ctx(), { token, role, error: w.join.problems[result.reason as keyof typeof w.join.problems], values: { name: (f.name ?? "").slice(0, 80), company: (f.company ?? "").slice(0, 60), handle: (f.handle ?? "").slice(0, 40), language: f.language ?? "en" } }));
    }
    redirect(r, "/shops", [sessions.issue(result.account.id, result.account.sessionVersion).setCookie]);
  });
  on("GET", /^\/invite$/u, "user", (r) => r.account!.role !== "builder" ? notFound(r) : page(r, 200, invitePage(r.ctx(), { hostedOnly: !canInvite })));
  on("POST", /^\/invite$/u, "user", (r) => {
    if (r.account!.role !== "builder" || !canInvite) return notFound(r);
    const role: Role = r.form.role === "builder" ? "builder" : "partner";
    const { token } = accounts.createInvite({ role, note: r.form.note ?? "", createdBy: r.account!.id });
    page(r, 200, invitePage(r.ctx(), { link: `${origin(r.req)}/join/${token}`, hostedOnly: false }));
  });

  // ---- this server: its model and key, its backups, Google (the panel's first run, plan item 14b). A builder's own server only: Geometer runs its hosted one by hand.
  const SAVED: Record<string, string> = {
    model: "Saved. The server applies it within a few seconds.",
    backup: "Saved. The server writes a test object to the bucket, reads it back and deletes it; the result shows here.",
    google: "Saved. The server puts the key in place within a few seconds.",
    speech: "Saved. The server puts the key in place within a few seconds.",
    key: "Confirmed. This server deleted its copy of the backup key's secret half. Keep the copy you saved: it is the only key that opens a backup.",
  };
  const serverNotice = (r: Req) => { const k = new URL(r.req.url ?? "/", "http://x").searchParams.get("saved"); return k && Object.hasOwn(SAVED, k) ? { notice: SAVED[k] } : {}; };
  const ownServer = (r: Req): boolean => { if (config.mode === "own") return true; notFound(r); return false; };
  on("GET", /^\/server$/u, "builder", (r) => { if (ownServer(r)) page(r, 200, serverPage(r.ctx(), serverSetup.view(), serverNotice(r))); });
  on("POST", /^\/server\/model$/u, "builder", (r) => {
    if (!ownServer(r)) return;
    const done = serverSetup.requestModel(r.form, r.account!);
    if (!done.ok) return page(r, 400, serverPage(r.ctx(), serverSetup.view(), { problems: done.problems }));
    redirect(r, "/server?saved=model");
  });
  on("POST", /^\/server\/backup$/u, "builder", (r) => {
    if (!ownServer(r)) return;
    const done = serverSetup.requestBackup(r.form, r.account!);
    if (!done.ok) return page(r, 400, serverPage(r.ctx(), serverSetup.view(), { problems: done.problems }));
    // a key pair made just now: its secret half is shown next, before anything else
    redirect(r, done.madeKey ? "/server/backup-key" : "/server?saved=backup");
  });
  on("POST", /^\/server\/backup\/test$/u, "builder", (r) => { if (ownServer(r)) redirect(r, serverSetup.retestBackup(r.account!) ? "/server?saved=backup" : "/server"); });
  on("POST", /^\/server\/google$/u, "builder", (r) => {
    if (!ownServer(r)) return;
    if (!serverSetup.putGoogle(r.form.google ?? "").ok) return page(r, 400, serverPage(r.ctx(), serverSetup.view(), { problems: [{ field: "google", message: "That is not a Google service account's key file: paste the whole JSON file, from { to }." }] }));
    redirect(r, "/server?saved=google");
  });
  on("POST", /^\/server\/speech$/u, "builder", (r) => {
    if (!ownServer(r)) return;
    if (!serverSetup.putSpeechKey(r.form.speech ?? "").ok) return page(r, 400, serverPage(r.ctx(), serverSetup.view(), { problems: [{ field: "speech", message: "That is not a key's shape: one line with no spaces, as the provider shows it." }] }));
    redirect(r, "/server?saved=speech");
  });
  on("GET", /^\/server\/backup-key$/u, "builder", (r) => {
    if (!ownServer(r)) return;
    const v = serverSetup.view();
    page(r, 200, backupKeyPage(r.ctx(), { ...(serverSetup.backupSecret() ? { identity: serverSetup.backupSecret() } : {}), ...(v.backupKey ? { recipient: v.backupKey.recipient } : {}), ...(v.backupKey?.confirmedAt ? { confirmedAt: v.backupKey.confirmedAt } : {}) }));
  });
  on("GET", /^\/server\/backup-key\.txt$/u, "builder", (r) => {
    if (!ownServer(r)) return;
    const identity = serverSetup.backupSecret();
    const v = serverSetup.view();
    if (!identity || !v.backupKey) return notFound(r);
    body(r.res, 200, "text/plain; charset=utf-8", backupKeyFile(identity, v.backupKey.recipient, v.serverId, v.backupKey.madeAt), { "content-disposition": `attachment; filename="geometer-backup-key${v.serverId ? `-${v.serverId}` : ""}.txt"` });
  });
  on("POST", /^\/server\/backup-key\/confirm$/u, "builder", (r) => {
    if (!ownServer(r)) return;
    const v = serverSetup.view();
    const again = (error: string) => page(r, 400, backupKeyPage(r.ctx(), { ...(serverSetup.backupSecret() ? { identity: serverSetup.backupSecret() } : {}), ...(v.backupKey ? { recipient: v.backupKey.recipient } : {}), error }));
    if (r.form.off !== "yes") return again("Tick the box to say it is somewhere that is not this server.");
    if (!serverSetup.confirmBackupKey(r.form.last ?? "")) return again(`Those are not the last ${CONFIRM_CHARS} characters of the key. Look at the copy you saved: if it does not end the same, save it again.`);
    redirect(r, "/server?saved=key");
  });

  // shops
  on("GET", /^\/shops$/u, "user", (r) => {
    handover.sweep();
    const c = r.ctx();
    const cards: ShopCardView[] = shops.visibleTo(r.account!).map(({ id }) => {
      const owner = shops.owner(id); // who set it up: it never changes, even when the shop moves to someone else
      const read = shops.status(id);
      const settings = shops.settings(id);
      return {
        id, name: settings?.name ?? id, live: liveOf(id),
        ...(read.ok && read.status.limits ? { limits: { proven: read.status.limits.proven, of: read.status.limits.of } } : {}),
        ...(read.ok && read.status.versions?.pathway ? { version: read.status.versions.pathway } : {}), ...(owner ? { setUpBy: owner.accountName } : {}),
        // decision 39: a shop the lease does not list has no licence, and its Guards take no new work, so the card says so
        ...(read.ok && read.status.licence ? { licence: read.status.licence.listed ? read.status.licence.state : "none" as const } : {}),
      };
    });
    const firstRun = config.mode === "own" && r.account!.role === "builder" && !serverSetup.view().done;
    // a builder's own agents, beside the shops (none for a partner: agents.ids answers nothing)
    const own = agents.ids(r.account!).map((id) => agents.view(id, staleMs, unfinished));
    page(r, 200, shopsPage(c, { all: r.account!.role === "builder", cards, ...(firstRun ? { serverToDo: true } : {}), serverLink: config.mode === "own" && r.account!.role === "builder", agents: agentsSection(c, own) }));
  });

  // ---- own agents (B51's rest, 12 Nov 2026): what a builder sees of each agent they wrote, and three requests the deployer carries out. Builders only (a 404 for anyone
  // else, as for a shop that is not theirs); each POST writes a request file with a name and an id (agents.ts), never anything that reaches a command.
  const agents = createAgents(config);
  const agentOf = (r: Req): string | undefined => { const id = agents.find(r.account!, r.params[0]); if (!id) notFound(r); return id; };
  on("GET", /^\/agents\/([a-z0-9-]{1,40})$/u, "builder", (r) => {
    const id = agentOf(r);
    if (!id) return;
    const v = agents.view(id, staleMs, unfinished);
    const licence = licenceView(v.status?.licence, shops.fleet(id)?.licence, now());
    // the builder licence's price, from the price list in force (never written here)
    const charge = prices ? chargeOf(prices, null, true) : null;
    page(r, 200, agentPage(r.ctx(), v, { ...(licence ? { licence } : {}), ...(charge?.fee ? { price: formatRupees(paiseOf(charge.fee.value)) } : {}) }));
  });
  on("POST", /^\/agents\/([a-z0-9-]{1,40})\/stop$/u, "builder", (r) => {
    const id = agentOf(r);
    if (!id) return;
    const request = shops.requestStop(id, r.account!); // the same stop request as a shop's: the deployer pulls the kill switch on the agent's Guards
    log(`stop requested for own agent ${id} by ${r.account!.id} (${request.requestId})`);
    redirect(r, `/agents/${id}`);
  });
  on("POST", /^\/agents\/([a-z0-9-]{1,40})\/crash-test$/u, "builder", (r) => {
    const id = agentOf(r);
    if (!id) return;
    agents.requestCrashTest(id, r.account!);
    log(`crash test requested for own agent ${id} by ${r.account!.id}`);
    redirect(r, `/agents/${id}`);
  });
  on("POST", /^\/agents\/([a-z0-9-]{1,40})\/rotate$/u, "builder", (r) => {
    const id = agentOf(r);
    if (!id) return;
    const guard = (r.form.guard ?? "") === "" ? undefined : r.form.guard;
    if (!agents.requestRotate(id, r.account!, guard)) return notFound(r);
    log(`new credentials requested for own agent ${id}${guard ? ` (${guard})` : ""} by ${r.account!.id}`); // the log never holds a credential: the panel never has one
    redirect(r, `/agents/${id}`);
  });

  // the unfinished-work inbox (B31): every shop this person may see, read from each shop's exported record
  const unfinished = optionsFor(config.approvalWaitHours);
  on("GET", /^\/inbox$/u, "user", (r) => {
    handover.sweep();
    const c = r.ctx();
    const notice = new URL(r.req.url ?? "/", "http://x").searchParams.get("notice");
    page(r, 200, inboxPage(c, { shops: inboxAll(shops, r.account!, now(), unfinished), ...(notice && Object.hasOwn(c.w.inbox.recover, notice) ? { notice: c.w.inbox.recover[notice as keyof typeof c.w.inbox.recover] } : {}) }));
  });

  // client health and margin (B32): what needs a look, the running cost, what the person charges and keeps. The person's own entries stay in the panel's store.
  const healthEntries = createEntries(store);
  const healthData = createHealthData({ config, shops, entries: healthEntries, prices, now, unfinished });
  const votes = createVotes(store, shops, now);
  on("GET", /^\/health$/u, "user", (r) => {
    handover.sweep();
    const list = healthData.all(r.account!);
    page(r, 200, healthPage(r.ctx(), { shops: list, sum: sumMargins(list.map((s) => s.margin)), month: healthData.month(), innovator: votes.isInnovator(r.account!) }));
  });
  on("GET", /^\/health\/([a-z0-9-]{1,40})$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref) return notFound(r);
    const saved = new URL(r.req.url ?? "/", "http://x").searchParams.get("notice") === "saved";
    const shop = healthData.shop(r.account!, ref.id);
    page(r, 200, shopHealthPage(r.ctx(), { shop, month: healthData.month(shops.settings(ref.id)?.timezone), ...(saved ? { saved } : {}) }));
  });
  on("POST", /^\/health\/([a-z0-9-]{1,40})$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref) return notFound(r);
    const month = healthData.month(shops.settings(ref.id)?.timezone);
    const made = entriesFromForm(r.form, month);
    if (!made.ok) return page(r, 400, shopHealthPage(r.ctx(), { shop: healthData.shop(r.account!, ref.id), month, problem: made.problem, values: { price: r.form.price ?? "", setup: r.form.setup ?? "", minutes: r.form.minutes ?? "", rate: r.form.rate ?? "" } }));
    healthEntries.write(r.account!.id, ref.id, made.entries);
    log(`health entries of ${ref.id} saved by ${r.account!.id}`); // the log never holds an amount
    redirect(r, `/health/${ref.id}?notice=saved`);
  });

  // the template vote for the first 100 innovators (B56): a 404 for anyone fleet has not flagged as an innovator; results (counts only) only after voting
  on("GET", /^\/vote$/u, "user", (r) => {
    if (!votes.isInnovator(r.account!)) return notFound(r);
    const mine = votes.mine(r.account!);
    const saved = new URL(r.req.url ?? "/", "http://x").searchParams.get("notice") === "saved";
    page(r, 200, votePage(r.ctx(), { round: votes.round, mine, counts: mine ? votes.counts() : undefined, ...(saved ? { saved } : {}) }));
  });
  on("POST", /^\/vote$/u, "user", (r) => {
    if (!votes.isInnovator(r.account!)) return notFound(r);
    if (!votes.cast(r.account!, r.form.option ?? "")) {
      const mine = votes.mine(r.account!);
      return page(r, 400, votePage(r.ctx(), { round: votes.round, mine, counts: mine ? votes.counts() : undefined, refused: true }));
    }
    log(`template vote changed by ${r.account!.id}`);
    redirect(r, "/vote?notice=saved");
  });

  on("GET", /^\/shops\/([a-z0-9-]{1,40})$/u, "user", async (r) => {
    handover.sweep();
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref) return notFound(r);
    const c = r.ctx();
    const id = ref.id;
    const settings = shops.settings(id);
    const read = shops.status(id);
    const { probe, counts } = await shops.probeRuntime(id);
    const live = liveOf(id, probe);
    const stop = shops.stopRequest(id);
    const data = readExport(shops.paths.exports(id));
    const month = settings ? monthOf(now(), settings.timezone) : "";
    const kindId = shops.kind(id);
    const own = setupOf(kindId);
    const report = settings && data && !own ? monthlyFromExport(settings, data, month, "live", now()) : undefined;
    const notice = new URL(r.req.url ?? "/", "http://x").searchParams.get("notice");
    const plan = planView(shops.fleet(id), prices, config.mode === "own"); // a panel on a builder's own server: the builder licence
    const licence = licenceView(read.ok ? read.status.licence : undefined, shops.fleet(id)?.licence, now());
    const view: ShopView = {
      id, name: settings?.name ?? id, live, status: read.ok ? read.status : undefined, ...(stop ? { stopRequestedAt: stop.requestedAt } : {}),
      summary: settings && !own ? summaryOf(c, settings) : undefined,
      // a Fees or Orders shop: its own pieces, with the plan's allowance from the price list in force; Bookings: the cost table
      ...(own ? (settings ? { own: own.pieces(c, settings, data, month, prices.rates["plan.business.allowance"]?.count ?? null, now()) } : {}) : { cost: costFor(id, settings ?? ({ reminders: { hoursBefore: [24, 2] }, deposit: { amountInr: 0 } } as unknown as Settings)) }),
      ...(plan ? { plan } : {}),
      ...(licence ? { licence } : {}),
      ...(report ? { activity: { made: report.bookings.made, cancelled: report.bookings.cancelled, moved: report.bookings.moved, deposits: report.money.deposits.count, refunds: report.money.refunds.count, saidNo: report.stopped.total, owner: report.owner } } : {}),
      inbox: inboxFor(shops, id, now(), unfinished),
      ...(counts ? { liveCounts: { bookings: counts[kindFor(kindId)!.casesName] ?? {}, waitingForOwner: Number(counts.refunds?.waitingForOwner ?? 0), needBuilder: Number(counts.refunds?.needBuilder?.total ?? 0) } } : {}),
      termsLink: terms.on() ? termsLinkWord(c.lang) : undefined,
      voiceLink: voiceLinkWord(c.lang),
      papers: { goLive: goLive.documents(id, "go-live"), monthly: goLive.documents(id, "monthly"), canMakeReport: Boolean(data && settings), month },
      isBuilder: r.account!.role === "builder",
      ...(r.account!.role === "builder" ? { details: { statusJson: read.ok ? JSON.stringify(read.status, null, 2) : "—", pins: JSON.stringify(shops.pins(id) ?? {}, null, 2), runtimeJson: JSON.stringify(counts ?? {}, null, 2) } } : {}),
      limitsText: !settings ? [] : own ? own.limitLines({} as unknown as Draft, settings, c.lang, settings) : Object.values(limitList(c, { form: { deposit: String(settings.deposit.amountInr) }, windowHours: String(settings.cancellation.windowHours) } as unknown as Draft, settings.deposit.holdMinutes)),
      ...(notice && NOTICES.has(notice) ? { notice: c.w.shop.reportMade } : {}),
    };
    page(r, 200, shopPage(c, view));
  });

  // a recovery step from the to-do list: only an action the list itself offers for that case right now, and only as a request to the shop's own agent
  on("POST", /^\/shops\/([a-z0-9-]{1,40})\/recover$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref) return notFound(r);
    const offered = inboxFor(shops, ref.id, now(), unfinished).items.some((o) => o.caseId === (r.form.case ?? "") && o.actions.includes(r.form.action ?? ""));
    if (offered) shops.requestRecovery(ref.id, r.form.case, r.form.action, r.account!);
    log(`recovery ${r.form.action ?? "?"} on ${ref.id} by ${r.account!.id}: ${offered ? "asked" : "refused"}`);
    redirect(r, `/inbox?notice=${offered ? "sent" : "refused"}`);
  });

  // taking a shop's files out (B38): the same package as `geometer export`, built from files only, so it works for a stopped shop and a lapsed plan
  on("GET", /^\/shops\/([a-z0-9-]{1,40})\/export$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref) return notFound(r);
    try {
      const { built, tgz } = exportShop(config, shops, goLive.docs, ref.id, now(), { name: r.account!.name, role: r.account!.role });
      log(`export of ${ref.id} downloaded by ${r.account!.id}`);
      body(r.res, 200, "application/gzip", tgz, { "content-disposition": `attachment; filename="${built.name}.tar.gz"` });
    } catch (e) {
      if (!(e instanceof ExportError)) throw e;
      page(r, 409, errorPage(r.ctx(), 409, e.message));
    }
  });

  // the papers (B28, B35, B36): the record of one case, a person's statement, the agent's identity paper (full and public), the record as an evidence pack. Each goes
  // through shops.find, so a partner gets a 404 for a shop that is not theirs; a person's number is only ever in a POST body, never in the address or the log
  const papers = createPapers(config, shops, goLive.docs, now);
  const PAPER_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
  const sendPaper = (r: Req, made: MadePaper | undefined) => (made ? body(r.res, 200, made.type, made.text, { "content-security-policy": PAPER_CSP, ...(made.file.endsWith(".json") || made.file.endsWith(".txt") ? { "content-disposition": `attachment; filename=\"${made.file}\"` } : {}) }) : notFound(r));
  const paperRoute = (pattern: RegExp, method: "GET" | "POST", make: (r: Req, id: string) => MadePaper | undefined, what: string) => on(method, pattern, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref) return notFound(r);
    try { const made = make(r, ref.id); log(`${what} of ${ref.id} downloaded by ${r.account!.id}`); sendPaper(r, made); }
    catch (e) { if (!(e instanceof PaperError)) throw e; page(r, 409, papersPage(r.ctx(), { id: ref.id, name: shops.settings(ref.id)?.name ?? ref.id, cases: caseIds(ref.id), problem: e.message })); }
  });
  const query = (r: Req) => new URL(r.req.url ?? "/", "http://x").searchParams;
  const caseIds = (id: string): string[] => { const d = readExport(shops.paths.exports(id)); return d ? casesOf(d, shops.kind(id)).map((x) => x.id).reverse() : []; };
  on("GET", /^\/shops\/([a-z0-9-]{1,40})\/papers$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref) return notFound(r);
    page(r, 200, papersPage(r.ctx(), { id: ref.id, name: shops.settings(ref.id)?.name ?? ref.id, cases: caseIds(ref.id), public: papers.publicOf(ref.id), saved: query(r).get("notice") === "public" }));
  });
  // the operator's choice of what the public identity paper shows (B36): any of the choosable fields, never customer data (there is none in it to choose)
  on("POST", /^\/shops\/([a-z0-9-]{1,40})\/papers\/public$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref) return notFound(r);
    const chosen = papers.setPublic(ref.id, Object.keys(r.form).filter((k) => k.startsWith("show_") && r.form[k] === "1").map((k) => k.slice(5)));
    log(`public fields of ${ref.id} set by ${r.account!.id}: ${chosen.join(",") || "none"}`);
    redirect(r, `/shops/${ref.id}/papers?notice=public`);
  });
  paperRoute(/^\/shops\/([a-z0-9-]{1,40})\/papers\/case$/u, "GET", (r, id) => {
    const caseId = query(r).get("case") ?? "";
    if (!/^[a-z]-[0-9]{1,8}$/u.test(caseId)) throw new PaperError("Choose a case from the list.");
    return papers.dispute(id, caseId, query(r).get("lang") ?? undefined).find((m) => m.file.endsWith(query(r).get("as") === "json" ? ".json" : ".html"));
  }, "record of one case");
  paperRoute(/^\/shops\/([a-z0-9-]{1,40})\/papers\/statement$/u, "POST", (r, id) => papers.statement(id, r.form.number ?? "", r.form.lang).find((m) => m.file.endsWith(r.form.as === "json" ? ".json" : ".html")), "a statement");
  paperRoute(/^\/shops\/([a-z0-9-]{1,40})\/papers\/(identity|identity-public)\.(json|html)$/u, "GET", (r, id) => {
    const made = papers.identity(id, query(r).get("lang") ?? undefined);
    return (r.params[1] === "identity" ? made.full : made.public).find((m) => m.file.endsWith(`.${r.params[2]}`));
  }, "identity paper");
  paperRoute(/^\/shops\/([a-z0-9-]{1,40})\/papers\/ledger\/(pack|anchor)\.json$/u, "GET", (r, id) => papers.ledger(id).find((m) => m.file.endsWith(`-${r.params[1]}.json`)), "evidence pack");

  // B72: the shop terms the owner agrees to on WhatsApp. Every route answers "not found" while the server setting is off, so the page does not exist for anyone by default.
  const termsPageFor = (r: Req, id: string, problem = false): void => {
    const c = r.ctx();
    page(r, problem ? 400 : 200, termsPage(c, { id, name: shops.settings(id)?.name ?? id, state: terms.status(id), ...(terms.file(id) ? { file: terms.file(id) } : {}), problem }));
  };
  on("GET", /^\/shops\/([a-z0-9-]{1,40})\/terms$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref || !terms.on()) return notFound(r);
    termsPageFor(r, ref.id);
  });
  on("POST", /^\/shops\/([a-z0-9-]{1,40})\/terms$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref || !terms.on()) return notFound(r);
    const saved = terms.save(ref.id, r.form);
    if (saved.ok) log(`shop terms details of ${ref.id} saved by ${r.account!.id}`);
    termsPageFor(r, ref.id, !saved.ok);
  });
  on("GET", /^\/shops\/([a-z0-9-]{1,40})\/terms\/copy\.txt$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref || !terms.on()) return notFound(r);
    const made = terms.copy(ref.id);
    if (made) log(`shop terms copy of ${ref.id} downloaded by ${r.account!.id}`);
    sendPaper(r, made);
  });
  // B29: the shop's voice-notes switch. A block in the shop's runtime.json; no block means off. The deployer refuses it unless the server holds the speech key and places the Guards.
  const voicePageFor = (r: Req, id: string, problem = false): void => {
    const c = r.ctx();
    let keyInPlace = false;
    try { keyInPlace = Boolean(serverSetup.view().status?.keys.speech); } catch { keyInPlace = false; }
    page(r, problem ? 400 : 200, voicePage(c, { id, name: shops.settings(id)?.name ?? id, state: voiceOf(shops.runtime(id)), keyInPlace, problem }));
  };
  on("GET", /^\/shops\/([a-z0-9-]{1,40})\/voice$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref) return notFound(r);
    voicePageFor(r, ref.id);
  });
  on("POST", /^\/shops\/([a-z0-9-]{1,40})\/voice$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    const runtime = ref ? shops.runtime(ref.id) : undefined;
    if (!ref || !runtime) return notFound(r);
    const applied = applyVoice(runtime, voiceFormOf(r.form));
    if (!applied.ok) return voicePageFor(r, ref.id, true);
    shops.writeRuntime(ref.id, applied.runtime);
    log(`voice notes of ${ref.id} turned ${applied.runtime.speech ? "on" : "off"} by ${r.account!.id}`);
    voicePageFor(r, ref.id);
  });
  // moving a shop to another partner or builder (B38), with the owner's agreement from their own number
  const handoverPageFor = (r: Req, id: string, extra: Partial<HandoverView> = {}): void => {
    const state = handover.check(id);
    const c = r.ctx();
    const base = { id, name: shops.settings(id)?.name ?? id, history: shops.assignment(id)?.history ?? [], values: { to: "", reason: "" } };
    const view: HandoverView =
      state.state === "done" ? { ...base, stage: "done", to: state.assignment.current.accountName }
      : state.state === "waiting" ? { ...base, stage: extra.code ? "asked" : "waiting", to: state.move.to.accountName }
      : state.state === "expired" ? { ...base, stage: "expired" } : { ...base, stage: "form" };
    page(r, extra.problem ? 400 : 200, handoverPage(c, { ...view, ...extra, history: shops.assignment(id)?.history ?? [] }));
  };
  on("GET", /^\/shops\/([a-z0-9-]{1,40})\/handover$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref) return notFound(r);
    handoverPageFor(r, ref.id);
  });
  on("POST", /^\/shops\/([a-z0-9-]{1,40})\/handover$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref) return notFound(r);
    const w = r.ctx().w.handover;
    const values = { to: (r.form.to ?? "").slice(0, 40), reason: r.form.reason ?? "" };
    const result = handover.start(ref.id, r.account!, values);
    if (!result.ok) return handoverPageFor(r, ref.id, { problem: w.problems[result.problem], values });
    log(`move of ${ref.id} to ${result.move.to.accountId} asked by ${r.account!.id} (${result.move.reason})`);
    handoverPageFor(r, ref.id, { code: result.code, to: result.move.to.accountName });
  });
  on("POST", /^\/shops\/([a-z0-9-]{1,40})\/handover\/cancel$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref) return notFound(r);
    handover.cancel(ref.id);
    redirect(r, `/shops/${ref.id}/handover`);
  });

  on("GET", /^\/shops\/([a-z0-9-]{1,40})\/stop$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref) return notFound(r);
    const stop = shops.stopRequest(ref.id);
    page(r, 200, stopPage(r.ctx(), { id: ref.id, name: shops.settings(ref.id)?.name ?? ref.id, already: Boolean(stop), at: stop?.requestedAt }));
  });
  on("POST", /^\/shops\/([a-z0-9-]{1,40})\/stop$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    if (!ref) return notFound(r);
    const request = shops.requestStop(ref.id, r.account!);
    log(`stop requested for ${ref.id} by ${r.account!.id} (${request.requestId})`);
    redirect(r, `/shops/${ref.id}/stop`);
  });

  on("POST", /^\/shops\/([a-z0-9-]{1,40})\/edit$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    const settings = ref && shops.settings(ref.id);
    if (!ref || !settings) return notFound(r);
    const template = templates().find((t) => t.id === shops.kind(ref.id)) ?? templates()[0];
    if (!template) return notFound(r);
    const id = randomBytes(12).toString("hex");
    const stamp = new Date(now()).toISOString();
    store.write(`drafts/${id}.json`, setupOf(template.setup)
      ? setupOf(template.setup)!.draftFromShop(id, r.account!.id, template.id, ref.id, settings, shops.runtime(ref.id), shops.meta(ref.id), stamp)
      : draftFromShop(id, r.account!.id, template.id, ref.id, settings, shops.runtime(ref.id), shops.meta(ref.id), stamp));
    redirect(r, `/setup/${id}/1`);
  });

  on("POST", /^\/shops\/([a-z0-9-]{1,40})\/report$/u, "user", (r) => {
    const ref = shops.find(r.account!, r.params[0]);
    const settings = ref && shops.settings(ref.id);
    if (!ref || !settings) return notFound(r);
    const month = r.form.month ?? "";
    const data = readExport(shops.paths.exports(ref.id));
    if (!MONTH.test(month) || !data) return notFound(r);
    monthRange(month, settings.timezone);
    const certificate = goLive.docs.get(ref.id, "go-live/go-live-certificate.json");
    const reports = reportOf(shops.kind(ref.id));
    const reading = certificate !== undefined ? reports.readGoLive(certificate, settings) : undefined;
    const pins = shops.pins(ref.id); // a shop with no gateway has no test mode and no gateway pin: its report reads "live"
    goLive.docs.make(ref.id, `monthly/${month}`, (scratch) => reports.write({
      settings, data, month, language: settings.owner.language, out: scratch,
      source: pins?.gateway?.mode === "live" || !gatewayOf(settings.payment) ? "live" : "test-mode",...(signingKey ? { key: signingKey } : {}), preparedBy: shops.preparedBy(ref.id),
      // the Innovator badge is fleet's answer for the shop (fleet/<shop>.json, written by ops): the same file the owner's monthly message reads, so the builder's copy and the owner's agree
      innovator: shops.fleet(ref.id)?.innovator === true,
      ...(reading ? { goLive: reading.finding } : {}), now: now(),
      tenant: ref.id, // B28: the report is anchored to the head of the shop's record, under the shop's id (the tenant its daily fingerprint uses)
    }));
    redirect(r, `/shops/${ref.id}?notice=report`);
  });

  // generated papers, as they are: the report's own pages, which have their own small style
  const serveDoc = (r: Req, id: string, sub: string, file: string) => {
    const ref = shops.find(r.account!, id);
    if (!ref || !DOC_FILE.test(file) || !/^[A-Za-z0-9-]{1,20}(\/[A-Za-z0-9-]{1,20})?$/u.test(sub)) return notFound(r);
    const content = goLive.docs.get(ref.id, `${sub}/${file}`);
    if (content === undefined) return notFound(r);
    const type = file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".json") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8";
    body(r.res, 200, type, content, { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
  };
  on("GET", /^\/shops\/([a-z0-9-]{1,40})\/docs\/go-live\/([^/]+)$/u, "user", (r) => serveDoc(r, r.params[0], "go-live", r.params[1]));
  on("GET", /^\/shops\/([a-z0-9-]{1,40})\/docs\/monthly\/(\d{4}-\d{2})\/([^/]+)$/u, "user", (r) => serveDoc(r, r.params[0], `monthly/${r.params[1]}`, r.params[2]));

  // setup
  const loadDraft = (r: Req, id: string): Draft | undefined => {
    if (!/^[A-Za-z0-9_-]{12,40}$/u.test(id)) return undefined;
    const d = store.read<Draft>(`drafts/${id}.json`);
    return d && d.accountId === r.account!.id ? d : undefined;
  };
  const exampleOf = (t: Template): any => {
    const checked = (kindFor(t.id) ?? kindFor("bookings")!).validateSettings(JSON.parse(readFileSync(join(t.folder, t.settingsExample), "utf8")));
    if (!checked.ok) throw new Error(`The template ${t.id}'s example settings need fixing: ${checked.errors.join("; ")}`);
    return checked.settings;
  };
  /** Ids that are taken: shop folders, and the ids other unfinished drafts have reserved. */
  const reservedIds = (except?: string): Set<string> => {
    const taken = new Set(shops.ids());
    for (const f of store.list("drafts")) { const d = store.read<Draft>(`drafts/${f}`); if (d?.shopId && d.id !== except) taken.add(d.shopId); }
    return taken;
  };
  /** Keep the draft's id if nothing is there; if a shop folder or a file waiting in the inbox has since taken it, choose another BEFORE anything is written. */
  const unusedId = (d: Draft, names: SecretName[]): string => {
    const avoid = reservedIds(d.id);
    let id = d.shopId as string;
    for (let i = 0; i < 20 && (shops.exists(id) || inbox.taken(id, names)); i++) { avoid.add(id); id = shopIdFromName(d.form.name, avoid); }
    return id;
  };
  /** Steps cannot be skipped: a later step, or the save, goes back to the first one not filled in. */
  const firstOpen = (d: Draft, template: Template, n: number): string | undefined => (n > d.done + 1 ? `/setup/${d.id}/${Math.min(d.done + 1, template.steps.length)}` : undefined);

  on("GET", /^\/setup$/u, "user", (r) => page(r, 200, setupStartPage(r.ctx(), templates())));
  on("POST", /^\/setup$/u, "user", async (r) => {
    const template = templates().find((t) => t.id === r.form.template && (t.setup === "bookings" || setupOf(t.setup)));
    if (!template) return notFound(r);
    const id = randomBytes(12).toString("hex");
    store.write(`drafts/${id}.json`, (setupOf(template.setup)?.newDraft ?? newDraft)(id, r.account!.id, template, exampleOf(template), new Date(now()).toISOString()));
    redirect(r, `/setup/${id}/1`);
  });

  const stepView = (r: Req, d: Draft, template: Template, n: number, problems: string[]) => {
    const c = r.ctx();
    const meta = d.shopId ? shops.meta(d.shopId) : undefined;
    const own = setupOf(template.setup);
    return { draft: d, template, steps: template.steps, now: n - 1, problems, limits: limitList(c, d), ...(own ? { ownLines: own.limitLines(d, exampleOf(template), c.lang) } : {}), receipts: (meta?.receipts ?? {}) as Partial<Record<string, string>>,
      shareAddress: config.calendarShareAddress ?? meta?.calendar?.shareAddress, webhookUrl: d.shopId && providerById(paymentModuleOf(d))?.gateway ? webhookUrlFor(config, d.shopId, paymentModuleOf(d)) : undefined };
  };

  function checksView(r: Req, d: Draft, template: Template, problems: string[]): ChecksView {
    const settings = d.shopId && shops.exists(d.shopId) ? shops.settings(d.shopId) : undefined;
    const read = d.shopId ? shops.status(d.shopId) : ({ ok: false, reason: "missing" } as const);
    const status = read.ok ? read.status : undefined;
    const unmet = d.shopId && settings ? goLive.unmet(d.shopId, settings) : (["hand-check"] as ChecksView["unmet"]);
    const own = setupOf(template.setup);
    const c = r.ctx();
    const ownDraftSettings = own ? (settings ?? (() => { const b = own.build(d, exampleOf(template)); return b.ok ? b.settings : undefined; })()) : undefined;
    const meta = d.shopId ? shops.meta(d.shopId) : undefined;
    const files = d.shopId ? goLive.documents(d.shopId, "go-live").filter((f) => f.endsWith(".html")) : [];
    return {
      draft: d, steps: template.steps, now: template.steps.indexOf("checks"), saved: d.saved && Boolean(settings), problems, checks: d.shopId ? goLive.stored(d.shopId) : undefined,
      settingsOk: Boolean(settings), deployApplied: status?.deploy?.state === "applied" ? { at: status.deploy.at } : undefined, limits: status?.limits,
      guardConfigured: Boolean(config.guardUrl), unmet, ready: Boolean(meta?.readyAt) && unmet.length === 0,
      ...(own
        ? { own: { lines: own.limitLines(d, exampleOf(template), c.lang, settings), messages: own.messages(c, ownDraftSettings ?? exampleOf(template), prices.rates["plan.business.allowance"]?.count ?? null) } }
        : { cost: costFor(d.shopId ?? "", settings ?? exampleOf(template)) }), certificate: d.shopId && files[0] ? `/shops/${d.shopId}/docs/go-live/${files[0]}` : undefined, shopId: d.shopId && shops.exists(d.shopId) ? d.shopId : undefined,
    };
  }

  on("GET", /^\/setup\/([A-Za-z0-9_-]{12,40})\/(\d)$/u, "user", (r) => {
    const d = loadDraft(r, r.params[0]);
    const template = d && templates().find((t) => t.id === d.template);
    const n = Number(r.params[1]);
    if (!d || !template || n < 1 || n > template.steps.length) return notFound(r);
    const back = firstOpen(d, template, n);
    if (back) return redirect(r, back);
    const step = template.steps[n - 1];
    page(r, 200, step === "checks" ? setupChecksPage(r.ctx(), checksView(r, d, template, [])) : setupStepPage(r.ctx(), stepView(r, d, template, n, []), step));
  });

  on("POST", /^\/setup\/([A-Za-z0-9_-]{12,40})\/(\d)$/u, "user", (r) => {
    const d = loadDraft(r, r.params[0]);
    const template = d && templates().find((t) => t.id === d.template);
    const n = Number(r.params[1]);
    if (!d || !template || n < 1 || n >= template.steps.length) return notFound(r);
    const back = firstOpen(d, template, n);
    if (back) return redirect(r, back);
    const step = template.steps[n - 1];
    const w = r.ctx().w;
    let problems: string[];
    const own = setupOf(template.setup);
    if (step === "business") {
      problems = (own?.applyBusiness ?? applyBusiness)(d, r.form, w).problems;
      if (problems.length === 0 && !d.shopId) d.shopId = shopIdFromName(d.form.name, reservedIds(d.id));
    } else if (step === "deposit") problems = (own?.applyRules ?? applyDeposit)(d, r.form, w).problems;
    else if (step === "languages") problems = applyLanguages(d, r.form, w).problems;
    else {
      if (!d.editing) d.shopId = unusedId(d, SECRET_NAMES as unknown as SecretName[]);
      const meta = shops.meta(d.shopId as string);
      const result = applyAccounts(d, r.form, template, meta, Boolean(config.calendarShareAddress), w, r.ctx().lang);
      problems = result.problems;
      if (problems.length === 0) {
        // Everything checked first, then written: a form with one bad box writes nothing to the inbox.
        try { for (const s of result.secrets) inbox.put(d.shopId as string, s.name, s.text); } catch (e) {
          if (!(e instanceof InboxTaken)) throw e;
          problems = [w.setup.fallback("A file for this shop is already waiting in the server's inbox, so nothing was written. Start the setup again.")];
        }
        const after = shops.meta(d.shopId as string);
        // A shop with no gateway has no gateway key to remember (and one it had before is dropped from its notes: the secrets inbox is write-only and is not touched).
        const { gateway: _kept, ...withoutGateway } = after;
        const chosen = providerById(paymentModuleOf(d));
        if (problems.length === 0) shops.saveMeta(d.shopId as string, { ...(!chosen?.gateway || !template.accounts.includes("payment") ? withoutGateway : { ...after, gateway: { provider: chosen.id, mode: d.gateway.mode as "live" | "test", keyId: d.gateway.keyId } }), whatsapp: { businessNumber: d.whatsapp.businessNumber },
          calendar: { shareAddress: result.clientEmail ?? after.calendar?.shareAddress }, ...(d.expectedBookings ? { expectedBookings: Number(d.expectedBookings) } : {}) });
      }
    }
    if (problems.length === 0) { d.saved = false; d.done = Math.max(d.done, n); }
    store.write(`drafts/${d.id}.json`, d);
    if (problems.length > 0) return page(r, 400, setupStepPage(r.ctx(), stepView(r, d, template, n, problems), step as "business"));
    redirect(r, `/setup/${d.id}/${n + 1}`);
  });

  on("POST", /^\/setup\/([A-Za-z0-9_-]{12,40})\/save$/u, "user", (r) => {
    const d = loadDraft(r, r.params[0]);
    const template = d && templates().find((t) => t.id === d.template);
    if (!d || !template) return notFound(r);
    const back = firstOpen(d, template, template.steps.length);
    if (back) return redirect(r, back);
    if (!d.shopId) return notFound(r);
    const example = exampleOf(template);
    const own = setupOf(template.setup);
    const built = own ? own.build(d, example) : buildSettings(d, example);
    // What is written is what a builder would write: Fees' settings are checked into another shape (a student's "batch" becomes "batchId"), so its form keeps the shape it was checked from.
    const written = (b: typeof built): unknown => (b.ok ? ((b as { raw?: unknown }).raw ?? b.settings) : undefined);
    const w = r.ctx().w;
    const gateway = providerById(paymentModuleOf(d))?.gateway !== undefined; // B71: a payments service is named only for a shop that chose a gateway
    // item 11b: the panel has no step for the WhatsApp provider yet, so an edit keeps the one runtime.json names (Gupshup and its app id, written by hand); without this,
    // saving a Gupshup shop would turn it back to Meta's paths with Gupshup's token behind them
    // the model as geometer.json names it now: the panel's first run may have chosen it after the panel started
    const serverModel = readServerModel(config.serverDir) ?? config.serverModel;
    const runtime = keepSpeech(keepWhatsAppProvider(own ? own.runtime(d.whatsapp.numberId, serverModel, gateway) : runtimeFor(d.calendar.use === "google" ? d.calendar.id : "", d.whatsapp.numberId, serverModel, gateway), d.editing ? shops.runtime(d.shopId) : undefined), d.editing ? shops.runtime(d.shopId) : undefined); // B29: an edit keeps the voice switch as it was
    // editing a shop that exists keeps the pin it has: only `geometer update` moves a shop to another version, after the hand check on its own settings
    const kept = d.editing ? shops.lock(d.shopId) : undefined;
    const lock = kept ?? `${template.id}@${own ? template.version : pathwayVersion()}`;
    const problems = built.ok ? shops.checkFolder(written(built), runtime, lock, kept !== undefined, { pathway: template.id, version: template.version }).map(w.setup.fallback) : built.errors.map(w.setup.fallback);
    if (!built.ok || problems.length > 0) return page(r, 400, setupChecksPage(r.ctx(), { ...checksView(r, d, template, problems), saved: false }));
    try { shops.writeFolder(d.shopId, { settings: written(built), runtime, lock }, d.editing ? undefined : { account: r.account!, template: template.id }, r.account!); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      // Another shop took this name after step 1. Nothing of it was touched.
      return page(r, 409, setupChecksPage(r.ctx(), { ...checksView(r, d, template, [w.setup.fallback("A shop with this name already exists on the server, so this one was not saved. Start the setup again with another name.")]), saved: false }));
    }
    shops.saveMeta(d.shopId, { ...shops.meta(d.shopId), ...(d.expectedBookings ? { expectedBookings: Number(d.expectedBookings) } : {}) });
    d.saved = true; d.editing = true;
    store.write(`drafts/${d.id}.json`, d);
    log(`shop ${d.shopId} saved by ${r.account!.id}`);
    redirect(r, `/setup/${d.id}/${template.steps.indexOf("checks") + 1}`);
  });

  on("POST", /^\/setup\/([A-Za-z0-9_-]{12,40})\/(check|ready|expected)$/u, "user", async (r) => {
    const d = loadDraft(r, r.params[0]);
    const template = d && templates().find((t) => t.id === d.template);
    if (!d || !template) return notFound(r);
    const back = firstOpen(d, template, template.steps.length);
    if (back) return redirect(r, back);
    if (!d.shopId) return notFound(r);
    if (!shops.exists(d.shopId)) return redirect(r, `/setup/${d.id}/${template.steps.indexOf("checks") + 1}`);
    const here = `/setup/${d.id}/${template.steps.indexOf("checks") + 1}`;
    if (r.params[1] === "check") await goLive.run(d.shopId);
    else if (r.params[1] === "expected") {
      const v = (r.form.expectedBookings ?? "").trim();
      if (/^\d{1,6}$/u.test(v) || v === "") {
        d.expectedBookings = v; store.write(`drafts/${d.id}.json`, d);
        const meta = shops.meta(d.shopId); const { expectedBookings: _drop, ...rest } = meta;
        shops.saveMeta(d.shopId, v === "" ? { ...rest, schema: 1 } : { ...meta, expectedBookings: Number(v) });
      } else return page(r, 400, setupChecksPage(r.ctx(), checksView(r, d, template, [r.ctx().w.setup.problems.expectedBad])));
    } else {
      const owner = shops.servedBy(d.shopId);
      const result = goLive.ready(d.shopId, owner ? preparedByOf(owner) : r.account!.name);
      if (!result.ok) return page(r, 409, setupChecksPage(r.ctx(), checksView(r, d, template, [])));
    }
    redirect(r, here);
  });

  // ---- one-time confirmations asked for from outside the panel (the Claude Code plugin; confirmations.ts) ------------------------------------
  // A link is made on the command line and does nothing by itself. Opening it shows what is asked; only a POST from a signed-in person who may see the shop does it.
  const waTemplates = (shop: string): string[] => {
    const t = templates().find((x) => x.id === shops.kind(shop));
    try {
      const list = JSON.parse(readFileSync(join((t as { folder: string }).folder, "whatsapp-templates.json"), "utf8")) as { name: string; language: string }[];
      return [...new Set(list.map((x) => `${x.name} (${x.language})`))];
    } catch { return []; }
  };
  const confirmFor = (r: Req) => {
    const token = r.params[0];
    if (!CONFIRM_TOKEN.test(token)) return { gone: "unknown" as const };
    const status = confirmations.status(token);
    if (status !== "ok") return { gone: status };
    const c = confirmations.find(token)!;
    const ref = shops.find(r.account!, c.shop);
    return ref && shops.exists(c.shop) ? { token, c } : { gone: "unknown" as const };
  };
  const goLivePieces = (shop: string) => {
    const checks = goLive.stored(shop);
    return { ...(checks ? { hand: { held: checks.hand.held, total: checks.hand.total, failedTitles: checks.hand.failedTitles, notTested: checks.hand.notTested } } : {}), connections: checks?.connections ?? null, templates: waTemplates(shop) };
  };
  on("GET", /^\/confirm\/([A-Za-z0-9_-]{16,80})$/u, "user", (r) => {
    const f = confirmFor(r);
    if ("gone" in f) return page(r, f.gone === "unknown" ? 404 : 410, confirmGonePage(r.ctx(), f.gone));
    const name = shops.settings(f.c.shop)?.name ?? f.c.shop;
    if (f.c.kind === "limits") {
      const plan = planLimits(shops, f.c.shop, f.c.changes ?? [], f.c.digest);
      return page(r, 200, confirmLimitsPage(r.ctx(), { token: f.token, shopName: name, shopId: f.c.shop, rows: plan.ok ? plan.rows : [], note: f.c.note, problems: plan.ok ? [] : plan.problems, done: false }));
    }
    const settings = shops.settings(f.c.shop);
    page(r, 200, confirmGoLivePage(r.ctx(), { token: f.token, shopName: name, shopId: f.c.shop, unmet: settings ? goLive.unmet(f.c.shop, settings) : ["settings-changed"], ...goLivePieces(f.c.shop), problems: [], done: false }));
  });
  on("POST", /^\/confirm\/([A-Za-z0-9_-]{16,80})$/u, "user", async (r) => {
    const f = confirmFor(r);
    if ("gone" in f) return page(r, f.gone === "unknown" ? 404 : 410, confirmGonePage(r.ctx(), f.gone));
    const { c } = f;
    const name = shops.settings(c.shop)?.name ?? c.shop;
    if (c.kind === "limits") {
      // checked again now, against the settings as they are now: a link cannot be used to write anything the check refuses, and a widening is refused whatever was stored
      const plan = planLimits(shops, c.shop, c.changes ?? [], c.digest);
      if (!plan.ok) return page(r, 409, confirmLimitsPage(r.ctx(), { token: f.token, shopName: name, shopId: c.shop, rows: [], note: c.note, problems: plan.problems, done: false }));
      if (!confirmations.spend(f.token, r.account!.id)) return page(r, 410, confirmGonePage(r.ctx(), "used"));
      shops.writeFolder(c.shop, { settings: plan.proposed, runtime: shops.runtime(c.shop) as Record<string, unknown>, lock: shops.lock(c.shop) as string }, undefined, r.account!);
      log(`limits for ${c.shop} tightened by ${r.account!.id} through ${c.id}: ${plan.rows.map((x) => x.path).join(", ")}`);
      return page(r, 200, confirmLimitsPage(r.ctx(), { token: f.token, shopName: name, shopId: c.shop, rows: plan.rows, note: c.note, problems: [], done: true }));
    }
    const settings = shops.settings(c.shop);
    const again = (problems: string[], unmet: Unmet[] = []) => page(r, 409, confirmGoLivePage(r.ctx(), { token: f.token, shopName: name, shopId: c.shop, unmet, ...goLivePieces(c.shop), problems, done: false }));
    if (!settings) return again(["The settings cannot be read."]);
    if (r.form.templates_seen !== "yes" || r.form.keys_in_guard !== "yes") return again(["Tick both boxes to say what you have seen and done. Nobody else can say it for you."]);
    await goLive.run(c.shop);
    const owner = shops.servedBy(c.shop);
    const result = goLive.ready(c.shop, owner ? preparedByOf(owner) : r.account!.name);
    if (!result.ok) return again([], result.unmet);
    if (!confirmations.spend(f.token, r.account!.id)) return page(r, 410, confirmGonePage(r.ctx(), "used"));
    shops.saveMeta(c.shop, { ...shops.meta(c.shop), goLiveStatement: { at: new Date(now()).toISOString(), by: r.account!.id, whatsappTemplatesSeenApproved: true, keysHandedInThroughGuard: true } });
    log(`go-live confirmed for ${c.shop} by ${r.account!.id} through ${c.id}`);
    page(r, 200, confirmGoLivePage(r.ctx(), { token: f.token, shopName: name, shopId: c.shop, unmet: [], connections: goLive.stored(c.shop)?.connections ?? null, templates: [], problems: [], done: true, certificate: `/shops/${c.shop}/docs/go-live/go-live-certificate.html` }));
  });

  // ---- the server ---------------------------------------------------------------------------------------------------------------------------

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = Date.now();
    const url = new URL(req.url ?? "/", "http://panel");
    const nonce = randomBytes(16).toString("base64url");
    nonceOf.set(req, nonce);
    let account: Account | undefined;
    const session = sessions.read(req.headers.cookie);
    if (session) { const a = accounts.byId(session.accountId); if (a && a.sessionVersion === session.version) account = a; }
    const lang = pickLanguage(req, account);
    const extraHeaders: Record<string, string | string[]> = {};
    let preMemo: ReturnType<typeof sessions.pre> | undefined;
    const r: Req = {
      req, res, path: url.pathname, params: [], form: {}, ...(account ? { account } : {}), ...(session && account ? { session } : {}), lang, extraHeaders,
      ctx() {
        let token = "";
        if (account && session) token = sessions.csrf(session);
        else { preMemo ??= sessions.pre(req.headers.cookie); token = preMemo.token; if (preMemo.setCookie) extraHeaders["set-cookie"] = [preMemo.setCookie]; }
        return { w: WORDS[lang], lang, nonce, csrf: token, draftLanguage: isDraftLanguage(lang), path: url.pathname, canInvite, ...(account ? { who: { name: account.name, role: account.role } } : {}) };
      },
    };
    res.once("finish", () => log(`${req.method} ${redactPath(url.pathname)} ${res.statusCode} ${Date.now() - started}ms${account ? ` ${account.id}` : ""}`));
    try {
      if (req.method !== "GET" && req.method !== "POST") return page(r, 405, errorPage(r.ctx(), 405, r.ctx().w.errors.wrongMethod));
      let route: Route | undefined;
      let pathMatched = false;
      for (const candidate of routes) {
        const m = candidate.pattern.exec(url.pathname);
        if (!m) continue;
        pathMatched = true;
        if (candidate.method !== req.method) continue;
        route = candidate; r.params = m.slice(1); break;
      }
      if (!route) return page(r, pathMatched ? 405 : 404, errorPage(r.ctx(), pathMatched ? 405 : 404, pathMatched ? r.ctx().w.errors.wrongMethod : r.ctx().w.errors.notFound));
      if (route.access !== "public" && !account) return redirect(r, "/login");
      if (route.access === "builder" && account?.role !== "builder") return notFound(r);
      if (req.method === "POST") {
        const given = req.headers.origin;
        if (given !== undefined && given !== origin(req) && given !== `http://${req.headers.host}` && given !== `https://${req.headers.host}`) return page(r, 403, errorPage(r.ctx(), 403, r.ctx().w.errors.csrf));
        const form = await readForm(req);
        if (form === "too-big") return page(r, 413, errorPage(r.ctx(), 413, r.ctx().w.errors.tooBig));
        if (form === "bad") return page(r, 400, errorPage(r.ctx(), 400, r.ctx().w.errors.tryAgain));
        const ok = account && session ? sessions.csrfOk(session, form._csrf) : sessions.preOk(req.headers.cookie, form._csrf);
        if (!ok) return page(r, 403, errorPage(r.ctx(), 403, r.ctx().w.errors.csrf));
        r.form = form;
      }
      await route.handler(r);
    } catch (e) {
      // The name and the first words only: never the request, which may hold a key.
      log(`failed ${req.method} ${redactPath(url.pathname)}: ${(e as Error).name}: ${String((e as Error).message).slice(0, 80).replace(/\s+/gu, " ")}`);
      if (!res.headersSent) page(r, 500, errorPage(r.ctx(), 500, r.ctx().w.errors.tryAgain));
    }
  }

  const server = createServer((req, res) => { void handle(req, res); });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5_000; server.maxHeadersCount = 60;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      const port = (server.address() as { port: number }).port;
      resolve({ host: config.host, port, url: `http://${config.host.includes(":") ? `[${config.host}]` : config.host}:${port}`, close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }) });
    });
  });
}

/** An invitation made on the command line by whoever runs the server. Returns the link; the token is not kept anywhere else. */
export function makeInviteLink(config: PanelConfig, role: Role, note: string, hours = 72): string {
  const { store } = openStores(config);
  const { token } = createAccounts(store, config.now).createInvite({ role, note, createdBy: "server", ttlHours: hours });
  return `${config.publicUrl ?? `http://${config.host}:${config.port}`}/join/${token}`;
}

/**
 * A one-time link for a person to confirm something Claude Code asked for (plugin/, plan B11), made on the command line like an invitation. It only ASKS: the link does
 * nothing until a signed-in person who may see the shop opens it and presses the button. For `limits` the change is checked here first (tighter only), and again when pressed.
 */
export function makeConfirmLink(config: PanelConfig, o: { kind: "limits" | "go-live"; shop: string; changes?: Change[]; note?: string }): { link: string; expiresAt: string } {
  const { store } = openStores(config);
  const shops = createShops(config, store);
  if (!shops.exists(o.shop)) throw new ConfigError(`There is no shop ${o.shop} on this server.`);
  let digest: string;
  if (o.kind === "limits") {
    const plan = planLimits(shops, o.shop, o.changes ?? []);
    if (!plan.ok) throw new ConfigError(plan.problems.join(" "));
    digest = plan.digest;
  } else {
    const raw = rawSettings(shops, o.shop);
    if (!raw) throw new ConfigError(`There are no readable settings for ${o.shop}.`);
    digest = settingsDigest(raw);
  }
  const { token, confirmation } = createConfirmations(store, config.now).create({ kind: o.kind, shop: o.shop, digest, ...(o.changes ? { changes: o.changes } : {}), ...(o.note ? { note: o.note } : {}) });
  return { link: `${config.publicUrl ?? `http://${config.host}:${config.port}`}/confirm/${token}`, expiresAt: confirmation.expiresAt };
}
