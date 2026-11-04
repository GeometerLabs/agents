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
import type { Settings } from "../../pathways/bookings/src/settings.ts";
import type { Language } from "../../modules/language/languages.ts";
import { serviceName } from "../../pathways/bookings/src/settings.ts";
import { formatInr } from "../../modules/language/format.ts";
import { pathwayVersion } from "../../pathways/bookings/server/config.ts";
import { readGoLiveCertificate } from "../../pathways/bookings/report/go-live.ts";
import { writeClientReport } from "../../pathways/bookings/report/run.ts";
import { loadPrivateKey } from "../../modules/report/sign.ts";
import { validateSettings } from "../../pathways/bookings/src/settings.ts";
import { monthRange } from "../../pathways/bookings/report/data.ts";
import { createAccounts } from "./accounts.ts";
import type { Account, Role } from "./accounts.ts";
import { monthOf, monthlyFromExport, readExport } from "./activity.ts";
import { ConfigError, isSecure, webhookUrlFor } from "./config.ts";
import type { PanelConfig } from "./config.ts";
import { SECRET_NAMES, liveView, serverPaths, shopIdFromName } from "./contract.ts";
import type { SecretName } from "./contract.ts";
import type { LiveView } from "./contract.ts";
import { latestPriceList, latestProposedPriceList, monthlyCost } from "./cost.ts";
import type { PriceList } from "./cost.ts";
import { planView } from "./plan.ts";
import { createGoLive } from "./golive.ts";
import { createLimiter } from "./ratelimit.ts";
import { InboxTaken, createInbox } from "./secrets.ts";
import { createSessions } from "./session.ts";
import type { Session } from "./session.ts";
import { applyAccounts, applyBusiness, applyDeposit, applyLanguages, buildSettings, draftFromShop, newDraft, runtimeFor } from "./setup.ts";
import type { Body, Draft } from "./setup.ts";
import { createShops } from "./shops.ts";
import { createStore } from "./store.ts";
import { discoverTemplates } from "./templates.ts";
import type { Template } from "./templates.ts";
import { createVault, loadKeyFile, plainVault } from "./vault.ts";
import { errorPage, invitePage, joinPage, languageName, limitList, loginPage, setupChecksPage, setupStartPage, setupStepPage, shopPage, shopsPage, stopPage, when } from "./views.ts";
import type { ChecksView, Ctx, ShopCardView, ShopView } from "./views.ts";
import { WORDS, isDraftLanguage } from "./languages.ts";

export const MAX_BODY_BYTES = 64 * 1024;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/u;
const DOC_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(html|json|txt)$/u;
const NOTICES = new Set(["report"]);

export interface RunningPanel { host: string; port: number; url: string; close(): Promise<void> }
/** `proposed`: the newest proposed price list, from which a shop's plan price is shown (labelled proposed). Left out: read from bundle/prices; null: none. */
export interface PanelDeps { log?: (line: string) => void; prices?: PriceList; proposed?: PriceList | null }

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

export async function startPanel(config: PanelConfig, deps: PanelDeps = {}): Promise<RunningPanel> {
  const log = deps.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = () => (config.now ?? Date.now)();
  const { paths, store, secret } = openStores(config);
  const prices = deps.prices ?? latestPriceList();
  const proposed = deps.proposed !== undefined ? deps.proposed : (() => { try { return latestProposedPriceList(); } catch { return null; } })();
  const accounts = createAccounts(store, now);
  const shops = createShops(config, store);
  const inbox = createInbox(shops, now);
  const goLive = createGoLive(config, shops, store);
  const secure = isSecure(config);
  const sessions = createSessions(secret, { secure, now });
  const loginByAddress = createLimiter(20, 15 * 60_000, now);
  const loginByName = createLimiter(5, 15 * 60_000, now);
  const templates = () => discoverTemplates(config.pathwaysDir);
  const signingKey = config.signingKeyFile ? loadPrivateKey(config.signingKeyFile) : undefined;
  const staleMs = config.staleMinutes * 60_000;
  const canInvite = config.mode === "own";

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

  const redactPath = (path: string) => path.replace(/^\/join\/.+$/u, "/join/[invite]");

  function body(res: ServerResponse, status: number, type: string, content: string, headers: Record<string, string | string[]> = {}) {
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
      settings, ...(observed !== undefined && observed > 0 ? { observedBookings: observed } : {}), assumptions: meta.expectedBookings !== undefined ? { bookingsPerMonth: meta.expectedBookings } : {},
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
    page(r, 200, joinPage(r.ctx(), { token, role, values: { name: "", handle: "", language: r.lang } }));
  });
  on("POST", /^\/join$/u, "public", async (r) => {
    const f = r.form;
    const w = r.ctx().w;
    const token = f.token ?? "";
    const result = await accounts.redeem(token, { handle: f.handle ?? "", name: f.name ?? "", passphrase: f.passphrase ?? "", language: f.language ?? "en" });
    if (!result.ok) {
      const gone = result.reason.startsWith("invite-");
      const role = accounts.inviteRole(token);
      if (gone || !role) return page(r, 410, errorPage(r.ctx(), 410, w.join.problems[result.reason as keyof typeof w.join.problems]));
      return page(r, 400, joinPage(r.ctx(), { token, role, error: w.join.problems[result.reason as keyof typeof w.join.problems], values: { name: (f.name ?? "").slice(0, 80), handle: (f.handle ?? "").slice(0, 40), language: f.language ?? "en" } }));
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

  // shops
  on("GET", /^\/shops$/u, "user", (r) => {
    const c = r.ctx();
    const cards: ShopCardView[] = shops.visibleTo(r.account!).map(({ id, owner }) => {
      const read = shops.status(id);
      const settings = shops.settings(id);
      return {
        id, name: settings?.name ?? id, live: liveOf(id),
        ...(read.ok && read.status.limits ? { limits: { proven: read.status.limits.proven, of: read.status.limits.of } } : {}),
        ...(read.ok && read.status.versions?.pathway ? { version: read.status.versions.pathway } : {}), ...(owner ? { setUpBy: owner.accountName } : {}),
      };
    });
    page(r, 200, shopsPage(c, { all: r.account!.role === "builder", cards }));
  });

  on("GET", /^\/shops\/([a-z0-9-]{1,40})$/u, "user", async (r) => {
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
    const report = settings && data ? monthlyFromExport(settings, data, month, "live", now()) : undefined;
    const notice = new URL(r.req.url ?? "/", "http://x").searchParams.get("notice");
    const plan = planView(shops.fleet(id), proposed);
    const view: ShopView = {
      id, name: settings?.name ?? id, live, status: read.ok ? read.status : undefined, ...(stop ? { stopRequestedAt: stop.requestedAt } : {}),
      summary: settings ? summaryOf(c, settings) : undefined,
      cost: costFor(id, settings ?? ({ reminders: { hoursBefore: [24, 2] }, deposit: { amountInr: 0 } } as unknown as Settings)),
      ...(plan ? { plan } : {}),
      ...(report ? { activity: { made: report.bookings.made, cancelled: report.bookings.cancelled, moved: report.bookings.moved, deposits: report.money.deposits.count, refunds: report.money.refunds.count, saidNo: report.stopped.total, owner: report.owner } } : {}),
      ...(counts ? { liveCounts: { bookings: counts.bookings ?? {}, waitingForOwner: Number(counts.refunds?.waitingForOwner ?? 0), needBuilder: Number(counts.refunds?.needBuilder?.total ?? 0) } } : {}),
      papers: { goLive: goLive.documents(id, "go-live"), monthly: goLive.documents(id, "monthly"), canMakeReport: Boolean(data && settings), month },
      isBuilder: r.account!.role === "builder",
      ...(r.account!.role === "builder" ? { details: { statusJson: read.ok ? JSON.stringify(read.status, null, 2) : "—", pins: JSON.stringify(shops.pins(id) ?? {}, null, 2), runtimeJson: JSON.stringify(counts ?? {}, null, 2) } } : {}),
      limitsText: settings ? Object.values(limitList(c, { form: { deposit: String(settings.deposit.amountInr) }, windowHours: String(settings.cancellation.windowHours) } as unknown as Draft, settings.deposit.holdMinutes)) : [],
      ...(notice && NOTICES.has(notice) ? { notice: c.w.shop.reportMade } : {}),
    };
    page(r, 200, shopPage(c, view));
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
    const template = templates().find((t) => t.id === (ref.owner?.template ?? "bookings")) ?? templates()[0];
    if (!template) return notFound(r);
    const id = randomBytes(12).toString("hex");
    store.write(`drafts/${id}.json`, draftFromShop(id, r.account!.id, template.id, ref.id, settings, shops.runtime(ref.id), shops.meta(ref.id), new Date(now()).toISOString()));
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
    const reading = certificate !== undefined ? readGoLiveCertificate(certificate, settings) : undefined;
    const pins = shops.pins(ref.id);
    goLive.docs.make(ref.id, `monthly/${month}`, (scratch) => writeClientReport({
      settings, entries: data.entries, bookings: data.bookings, month, language: settings.owner.language, out: scratch,
      source: pins?.razorpay?.mode === "live" ? "live" : "test-mode", ...(signingKey ? { key: signingKey } : {}), preparedBy: ref.owner ? `${ref.owner.accountName}, ${ref.owner.role === "partner" ? "local partner" : "builder"}` : undefined,
      ...(reading ? { goLive: reading.finding } : {}), now: now(),
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
  const exampleOf = (t: Template): Settings => {
    const checked = validateSettings(JSON.parse(readFileSync(join(t.folder, t.settingsExample), "utf8")));
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
    const template = templates().find((t) => t.id === r.form.template && t.setup === "bookings");
    if (!template) return notFound(r);
    const id = randomBytes(12).toString("hex");
    store.write(`drafts/${id}.json`, newDraft(id, r.account!.id, template, exampleOf(template), new Date(now()).toISOString()));
    redirect(r, `/setup/${id}/1`);
  });

  const stepView = (r: Req, d: Draft, template: Template, n: number, problems: string[]) => {
    const c = r.ctx();
    const meta = d.shopId ? shops.meta(d.shopId) : undefined;
    return { draft: d, template, steps: template.steps, now: n - 1, problems, limits: limitList(c, d), receipts: (meta?.receipts ?? {}) as Partial<Record<string, string>>,
      shareAddress: config.calendarShareAddress ?? meta?.calendar?.shareAddress, webhookUrl: d.shopId ? webhookUrlFor(config, d.shopId, "razorpay") : undefined };
  };

  function checksView(r: Req, d: Draft, template: Template, problems: string[]): ChecksView {
    const settings = d.shopId && shops.exists(d.shopId) ? shops.settings(d.shopId) : undefined;
    const read = d.shopId ? shops.status(d.shopId) : ({ ok: false, reason: "missing" } as const);
    const status = read.ok ? read.status : undefined;
    const unmet = d.shopId && settings ? goLive.unmet(d.shopId, settings) : (["hand-check"] as ChecksView["unmet"]);
    const meta = d.shopId ? shops.meta(d.shopId) : undefined;
    const files = d.shopId ? goLive.documents(d.shopId, "go-live").filter((f) => f.endsWith(".html")) : [];
    return {
      draft: d, steps: template.steps, now: template.steps.indexOf("checks"), saved: d.saved && Boolean(settings), problems, checks: d.shopId ? goLive.stored(d.shopId) : undefined,
      settingsOk: Boolean(settings), deployApplied: status?.deploy?.state === "applied" ? { at: status.deploy.at } : undefined, limits: status?.limits,
      guardConfigured: Boolean(config.guardUrl), unmet, ready: Boolean(meta?.readyAt) && unmet.length === 0,
      cost: costFor(d.shopId ?? "", settings ?? exampleOf(template)), certificate: d.shopId && files[0] ? `/shops/${d.shopId}/docs/go-live/${files[0]}` : undefined, shopId: d.shopId && shops.exists(d.shopId) ? d.shopId : undefined,
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
    if (step === "business") {
      problems = applyBusiness(d, r.form, w).problems;
      if (problems.length === 0 && !d.shopId) d.shopId = shopIdFromName(d.form.name, reservedIds(d.id));
    } else if (step === "deposit") problems = applyDeposit(d, r.form, w).problems;
    else if (step === "languages") problems = applyLanguages(d, r.form, w).problems;
    else {
      if (!d.editing) d.shopId = unusedId(d, SECRET_NAMES as unknown as SecretName[]);
      const meta = shops.meta(d.shopId as string);
      const result = applyAccounts(d, r.form, template, meta, Boolean(config.calendarShareAddress), w);
      problems = result.problems;
      if (problems.length === 0) {
        // Everything checked first, then written: a form with one bad box writes nothing to the inbox.
        try { for (const s of result.secrets) inbox.put(d.shopId as string, s.name, s.text); } catch (e) {
          if (!(e instanceof InboxTaken)) throw e;
          problems = [w.setup.fallback("A file for this shop is already waiting in the server's inbox, so nothing was written. Start the setup again.")];
        }
        const after = shops.meta(d.shopId as string);
        if (problems.length === 0) shops.saveMeta(d.shopId as string, { ...after, whatsapp: { businessNumber: d.whatsapp.businessNumber }, razorpay: { mode: d.razorpay.mode as "live" | "test", keyId: d.razorpay.keyId },
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
    const built = buildSettings(d, example);
    const w = r.ctx().w;
    const runtime = runtimeFor(d.calendar.id, d.whatsapp.numberId, config.serverModel);
    // editing a shop that exists keeps the pin it has: only `geometer update` moves a shop to another version, after the hand check on its own settings
    const kept = d.editing ? shops.lock(d.shopId) : undefined;
    const lock = kept ?? `${template.id}@${pathwayVersion()}`;
    const problems = built.ok ? shops.checkFolder(built.settings, runtime, lock, kept !== undefined).map(w.setup.fallback) : built.errors.map(w.setup.fallback);
    if (!built.ok || problems.length > 0) return page(r, 400, setupChecksPage(r.ctx(), { ...checksView(r, d, template, problems), saved: false }));
    try { shops.writeFolder(d.shopId, { settings: built.settings, runtime, lock }, d.editing ? undefined : { account: r.account!, template: template.id }); } catch (e) {
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
      const owner = shops.owner(d.shopId);
      const result = goLive.ready(d.shopId, owner ? `${owner.accountName}, ${owner.role === "partner" ? "local partner" : "builder"}` : r.account!.name);
      if (!result.ok) return page(r, 409, setupChecksPage(r.ctx(), checksView(r, d, template, [])));
    }
    redirect(r, here);
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
