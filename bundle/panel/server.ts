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
import { readGoLiveCertificate } from "../../templates/commerce/bookings/report/go-live.ts";
import { writeClientReport } from "../../templates/commerce/bookings/report/run.ts";
import { loadPrivateKey } from "../../modules/report/sign.ts";
import { readGoLiveCertificate as readFeesGoLive } from "../../templates/education/fees/report/go-live.ts";
import { writeFeesReport } from "../../templates/education/fees/report/run.ts";
import { kindFor } from "../lib/kinds.ts";
import { monthRange } from "../../modules/report/months.ts";
import { createAccounts } from "./accounts.ts";
import type { Account, Role } from "./accounts.ts";
import { feesMonthlyFromExport, monthOf, monthlyFromExport, readExport } from "./activity.ts";
import { ConfigError, isSecure, webhookUrlFor } from "./config.ts";
import type { PanelConfig } from "./config.ts";
import { SECRET_NAMES, liveView, preparedByOf, serverPaths, shopIdFromName } from "./contract.ts";
import type { SecretName } from "./contract.ts";
import type { LiveView } from "./contract.ts";
import { latestPriceList, monthlyCost } from "./cost.ts";
import type { PriceList } from "./cost.ts";
import { planView } from "./plan.ts";
import { licenceView } from "./licence.ts";
import { createGoLive } from "./golive.ts";
import { inboxAll, inboxFor, optionsFor } from "./inbox.ts";
import { createHandover } from "./handover.ts";
import { exportShop } from "./export.ts";
import { ExportError } from "../export/build.ts";
import { createLimiter } from "./ratelimit.ts";
import { InboxTaken, createInbox } from "./secrets.ts";
import { createSessions } from "./session.ts";
import type { Session } from "./session.ts";
import { applyAccounts, applyBusiness, applyDeposit, applyLanguages, buildSettings, draftFromShop, newDraft, paymentModuleOf, runtimeFor } from "./setup.ts";
import { moduleOf } from "../../modules/payments/upi/settings.ts";
import { applyFeesBusiness, applyFeesRules, buildFeesSettings, feesDraftFromShop, feesLimitLines, newFeesDraft, runtimeForFees } from "./fees.ts";
import { activityFees, messageCeiling, summaryFees } from "./views-fees.ts";
import type { Body, Draft } from "./setup.ts";
import { createShops } from "./shops.ts";
import { createStore } from "./store.ts";
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
/** `prices`: the price list in force, which prices both a shop's plan and its running-cost line. Left out: the newest in bundle/prices that is not a proposal. */
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
  const accounts = createAccounts(store, now);
  const shops = createShops(config, store);
  const inbox = createInbox(shops, now);
  const goLive = createGoLive(config, shops, store);
  const handover = createHandover(shops, accounts, store, now);
  const secure = isSecure(config);
  const sessions = createSessions(secret, { secure, now });
  const loginByAddress = createLimiter(20, 15 * 60_000, now);
  const loginByName = createLimiter(5, 15 * 60_000, now);
  const templates = () => discoverTemplates(config.templatesDir);
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

  /** A Fees centre's page pieces: its batches, this month's counts from the export, and the most messages its rules allow (with the plan's allowance from the price list in force). */
  function feesPieces(c: Ctx, id: string, settings: any, data: ReturnType<typeof readExport>, month: string): NonNullable<ShopView["fees"]> {
    const report = data ? feesMonthlyFromExport(settings, data, month, "live", now()) : undefined;
    const included = prices.rates["plan.business.allowance"]?.count ?? null;
    return { summary: summaryFees(c, settings), ...(report ? { activity: activityFees(report) } : {}), messages: messageCeiling(settings, included) };
  }

  function costFor(id: string, settings: Settings): ReturnType<typeof monthlyCost> {
    const meta = shops.meta(id);
    const data = readExport(shops.paths.exports(id));
    const observed = data ? monthlyFromExport(settings, data, monthOf(now(), settings.timezone), "live", now()).bookings.made : undefined;
    return monthlyCost({
      settings, ...(shops.fleet(id)?.plan ? { plan: shops.fleet(id)!.plan! } : {}), ...(observed !== undefined && observed > 0 ? { observedBookings: observed } : {}), assumptions: meta.expectedBookings !== undefined ? { bookingsPerMonth: meta.expectedBookings } : {},
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
        ...(read.ok && read.status.licence?.listed ? { licence: read.status.licence.state } : {}),
      };
    });
    page(r, 200, shopsPage(c, { all: r.account!.role === "builder", cards }));
  });

  // the unfinished-work inbox (B31): every shop this person may see, read from each shop's exported record
  const unfinished = optionsFor(config.approvalWaitHours);
  on("GET", /^\/inbox$/u, "user", (r) => {
    handover.sweep();
    const c = r.ctx();
    const notice = new URL(r.req.url ?? "/", "http://x").searchParams.get("notice");
    page(r, 200, inboxPage(c, { shops: inboxAll(shops, r.account!, now(), unfinished), ...(notice && Object.hasOwn(c.w.inbox.recover, notice) ? { notice: c.w.inbox.recover[notice as keyof typeof c.w.inbox.recover] } : {}) }));
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
    const isFees = shops.kind(id) === "fees";
    const report = settings && data && !isFees ? monthlyFromExport(settings, data, month, "live", now()) : undefined;
    const notice = new URL(r.req.url ?? "/", "http://x").searchParams.get("notice");
    const plan = planView(shops.fleet(id), prices);
    const licence = licenceView(read.ok ? read.status.licence : undefined, shops.fleet(id)?.licence, now());
    const view: ShopView = {
      id, name: settings?.name ?? id, live, status: read.ok ? read.status : undefined, ...(stop ? { stopRequestedAt: stop.requestedAt } : {}),
      summary: settings && !isFees ? summaryOf(c, settings) : undefined,
      ...(isFees ? (settings ? { fees: feesPieces(c, id, settings, data, month) } : {}) : { cost: costFor(id, settings ?? ({ reminders: { hoursBefore: [24, 2] }, deposit: { amountInr: 0 } } as unknown as Settings)) }),
      ...(plan ? { plan } : {}),
      ...(licence ? { licence } : {}),
      ...(report ? { activity: { made: report.bookings.made, cancelled: report.bookings.cancelled, moved: report.bookings.moved, deposits: report.money.deposits.count, refunds: report.money.refunds.count, saidNo: report.stopped.total, owner: report.owner } } : {}),
      inbox: inboxFor(shops, id, now(), unfinished),
      ...(counts ? { liveCounts: { bookings: (isFees ? counts.fees : counts.bookings) ?? {}, waitingForOwner: Number(counts.refunds?.waitingForOwner ?? 0), needBuilder: Number(counts.refunds?.needBuilder?.total ?? 0) } } : {}),
      papers: { goLive: goLive.documents(id, "go-live"), monthly: goLive.documents(id, "monthly"), canMakeReport: Boolean(data && settings), month },
      isBuilder: r.account!.role === "builder",
      ...(r.account!.role === "builder" ? { details: { statusJson: read.ok ? JSON.stringify(read.status, null, 2) : "—", pins: JSON.stringify(shops.pins(id) ?? {}, null, 2), runtimeJson: JSON.stringify(counts ?? {}, null, 2) } } : {}),
      limitsText: !settings ? [] : isFees ? feesLimitLines({} as unknown as Draft, settings, c.lang, settings) : Object.values(limitList(c, { form: { deposit: String(settings.deposit.amountInr) }, windowHours: String(settings.cancellation.windowHours) } as unknown as Draft, settings.deposit.holdMinutes)),
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
    store.write(`drafts/${id}.json`, template.setup === "fees"
      ? feesDraftFromShop(id, r.account!.id, template.id, ref.id, settings, shops.runtime(ref.id), shops.meta(ref.id), stamp)
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
    const fees = shops.kind(ref.id) === "fees";
    const reading = certificate !== undefined ? (fees ? readFeesGoLive : readGoLiveCertificate)(certificate, settings) : undefined;
    const pins = shops.pins(ref.id); // a UPI shop has no test mode and no Razorpay pin: its report reads "live"
    goLive.docs.make(ref.id, `monthly/${month}`, (scratch) => (fees ? writeFeesReport : writeClientReport)({
      settings, entries: data.entries, ...(fees ? { dues: data.dues ?? [] } : { bookings: data.bookings }), month, language: settings.owner.language, out: scratch,
      source: pins?.razorpay?.mode === "live" || moduleOf(settings.payment) === "upi" ? "live" : "test-mode",...(signingKey ? { key: signingKey } : {}), preparedBy: shops.preparedBy(ref.id),
      // the Innovator badge is fleet's answer for the shop (fleet/<shop>.json, written by ops): the same file the owner's monthly message reads, so the builder's copy and the owner's agree
      innovator: shops.fleet(ref.id)?.innovator === true,
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
    const template = templates().find((t) => t.id === r.form.template && (t.setup === "bookings" || t.setup === "fees"));
    if (!template) return notFound(r);
    const id = randomBytes(12).toString("hex");
    store.write(`drafts/${id}.json`, (template.setup === "fees" ? newFeesDraft : newDraft)(id, r.account!.id, template, exampleOf(template), new Date(now()).toISOString()));
    redirect(r, `/setup/${id}/1`);
  });

  const stepView = (r: Req, d: Draft, template: Template, n: number, problems: string[]) => {
    const c = r.ctx();
    const meta = d.shopId ? shops.meta(d.shopId) : undefined;
    const fees = template.setup === "fees";
    return { draft: d, template, steps: template.steps, now: n - 1, problems, limits: limitList(c, d), ...(fees ? { feesLines: feesLimitLines(d, exampleOf(template), c.lang) } : {}), receipts: (meta?.receipts ?? {}) as Partial<Record<string, string>>,
      shareAddress: config.calendarShareAddress ?? meta?.calendar?.shareAddress, webhookUrl: d.shopId ? webhookUrlFor(config, d.shopId, "razorpay") : undefined };
  };

  function checksView(r: Req, d: Draft, template: Template, problems: string[]): ChecksView {
    const settings = d.shopId && shops.exists(d.shopId) ? shops.settings(d.shopId) : undefined;
    const read = d.shopId ? shops.status(d.shopId) : ({ ok: false, reason: "missing" } as const);
    const status = read.ok ? read.status : undefined;
    const unmet = d.shopId && settings ? goLive.unmet(d.shopId, settings) : (["hand-check"] as ChecksView["unmet"]);
    const fees = template.setup === "fees";
    const c = r.ctx();
    const feesDraftSettings = fees ? (settings ?? (() => { const b = buildFeesSettings(d, exampleOf(template)); return b.ok ? b.settings : undefined; })()) : undefined;
    const meta = d.shopId ? shops.meta(d.shopId) : undefined;
    const files = d.shopId ? goLive.documents(d.shopId, "go-live").filter((f) => f.endsWith(".html")) : [];
    return {
      draft: d, steps: template.steps, now: template.steps.indexOf("checks"), saved: d.saved && Boolean(settings), problems, checks: d.shopId ? goLive.stored(d.shopId) : undefined,
      settingsOk: Boolean(settings), deployApplied: status?.deploy?.state === "applied" ? { at: status.deploy.at } : undefined, limits: status?.limits,
      guardConfigured: Boolean(config.guardUrl), unmet, ready: Boolean(meta?.readyAt) && unmet.length === 0,
      ...(fees
        ? { fees: { lines: feesLimitLines(d, exampleOf(template), c.lang, settings), messages: messageCeiling((feesDraftSettings ?? exampleOf(template)) as never, prices.rates["plan.business.allowance"]?.count ?? null) } }
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
    const fees = template.setup === "fees";
    if (step === "business") {
      problems = (fees ? applyFeesBusiness : applyBusiness)(d, r.form, w).problems;
      if (problems.length === 0 && !d.shopId) d.shopId = shopIdFromName(d.form.name, reservedIds(d.id));
    } else if (step === "deposit") problems = (fees ? applyFeesRules : applyDeposit)(d, r.form, w).problems;
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
        // A UPI shop has no Razorpay key to remember (and one it had before is dropped from its notes: the secrets inbox is write-only and is not touched).
        const { razorpay: _kept, ...withoutRazorpay } = after;
        if (problems.length === 0) shops.saveMeta(d.shopId as string, { ...(paymentModuleOf(d) === "upi" && template.accounts.includes("razorpay") ? withoutRazorpay : { ...after, razorpay: { mode: d.razorpay.mode as "live" | "test", keyId: d.razorpay.keyId } }), whatsapp: { businessNumber: d.whatsapp.businessNumber },
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
    const fees = template.setup === "fees";
    const built = fees ? buildFeesSettings(d, example) : buildSettings(d, example);
    // What is written is what a builder would write: Fees' settings are checked into another shape (a student's "batch" becomes "batchId"), so its form keeps the shape it was checked from.
    const written = (b: typeof built): unknown => (b.ok ? ((b as { raw?: unknown }).raw ?? b.settings) : undefined);
    const w = r.ctx().w;
    const runtime = fees ? runtimeForFees(d.whatsapp.numberId, config.serverModel) : runtimeFor(d.calendar.id, d.whatsapp.numberId, config.serverModel);
    // editing a shop that exists keeps the pin it has: only `geometer update` moves a shop to another version, after the hand check on its own settings
    const kept = d.editing ? shops.lock(d.shopId) : undefined;
    const lock = kept ?? `${template.id}@${fees ? template.version : pathwayVersion()}`;
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
