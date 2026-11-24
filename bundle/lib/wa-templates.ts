// A shop's WhatsApp message templates, submitted to the shop's OWN WhatsApp account and read back, by one piece of code that the panel and the command line both call
// (25 Nov 2026; it replaces gupshup-templates.ts, which did this for Gupshup alone and only from the command line). Meta approves a template per WhatsApp Business
// Account, so every shop needs its own copy approved before it can message a customer outside the 24-hour window.
//
// What is here, top to bottom:
//  1. The template set of a shop: the union of the `whatsapp-templates.json` of every template part the shop has (today one: its template), in the shop's languages,
//     with the same name and language merged when the wording is the same and refused when it is not (decision 65 gives a shop several parts; that stream changes
//     only `shopParts`).
//  2. The shop's account (runtime.json services.messaging): Meta direct with its WhatsApp Business Account id, or its own Gupshup app (self-serve) with the app's id.
//  3. The two providers' calls, over one small `Call` that is either the shop's WhatsApp Guard (the panel: it holds no key, the Guard adds it) or the provider itself
//     with the shop's key (the command line, on the server).
//  4. `run`: read what the account holds, send only what it does not hold (by name and language), stop at once on a refused key or a rate limit, go on past one
//     refused template. And `statusRows`: the state of each template in plain buckets.
//
// Which API, and what is confirmed:
//  - Meta, read 25 Nov 2026 on developers.facebook.com: create is POST /{version}/{waba-id}/message_templates with a JSON body { name, language, category,
//    components, parameter_format } and a Bearer token; the reply is { id, status, category } (business-management-api/message-templates; graph-api/reference/
//    whats-app-business-account/message_templates). The list is GET of the same path; we ask fields=name,language,status,rejected_reason and page with
//    paging.cursors.after. Statuses: APPROVED, IN_APPEAL, PENDING, REJECTED, PENDING_DELETION, DELETED, DISABLED, PAUSED, LIMIT_EXCEEDED, ARCHIVED. The template
//    object has `rejected_reason` (an enum whose values the pages do not list: it is shown as Meta wrote it). Errors: 190 a token Meta does not accept, 200
//    permissions, 80008 too many calls; an account "can create a maximum of 100 templates per hour".
//    How the account id is found: Meta documents no read from a phone number id to its account (cloud-api/reference/phone-numbers lists none), and the API Setup
//    page shows the id beside the phone number id, so the panel ASKS for it in the same step (bundle/panel/wa-templates.ts).
//  - Gupshup, read 14 Nov 2026 on docs.gupshup.io (the notes are kept from gupshup-templates.ts): create is POST https://api.gupshup.io/wa/app/{appId}/template,
//    header `apikey`, a form with languageCode, content, footer, category, example, vertical, elementName, templateType, buttons; the reply holds `status`. The list is
//    GET /wa/app/{app_id}/template ({ status, templates: [{ elementName, languageCode, status, ... }] }), or without an app id GET /sm/api/v1/template/list/{appName}.
//    Statuses: Submitted, Approved, Rejected, Paused, Failed, Deactivated. The list documents NO reason field: a `reason` is read when present (Gupshup's template
//    events carry one) and otherwise the page says to look in Gupshup's dashboard (bundle/Deferred.md). EXAMPLE_FORM is the one thing to confirm on a first real try.
// Neither service has been met for real: every test uses a stand-in (modules/standins/meta-templates.ts, gupshup-templates.ts).
//
// What goes to the provider: the template file's words and its own made-up sample values, nothing else. No customer's number or name is in a template set, and
// nothing here reads a shop's record.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHttp } from "../../modules/core/http.ts";
import { GuardRefusedError, GuardUnauthenticatedError, GuardUnavailableError, GuardError, NotSentError, TimeoutError } from "../../modules/core/faults.ts";
import { GRAPH_VERSION } from "../../modules/messaging/whatsapp.ts";
import { GUPSHUP_SELFSERVE_ROUTES, templateListPath } from "../../modules/messaging/gupshup-selfserve.ts";

/** The template name Meta and Gupshup accept (lowercase letters, digits, underscores), and the length limits. */
export const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/u;
export const BODY_LIMIT = 1024;
export const HEADER_LIMIT = 60;
export const FOOTER_LIMIT = 60;

// ---- 1. the template set of a shop -----------------------------------------------------------------------------------------------------------------------

/** One entry of whatsapp-templates.json, in Meta's own shape. Only what the mapping reads is typed; Meta's body is sent from the fields named in metaBody. */
export interface Entry { name: string; language: string; category: string; parameter_format?: string; components: Component[] }
export interface Component { type: string; format?: string; text?: string; example?: { body_text?: string[][]; header_text?: string[]; header_handle?: string[] }; buttons?: { type: string; text: string; url?: string; phone_number?: string }[] }
/** One part of a shop that brings WhatsApp templates: a template's folder, named by its id. */
export interface TemplatePart { id: string; folder: string }

/** Two parts give the same name and language different wording: the provider holds one template per name and language, so one part must rename its own. */
export class TemplateSetConflict extends Error { override name = "TemplateSetConflict"; }

export const keyOf = (name: string, language: string): string => `${name}:${language}`;

/** A part's whatsapp-templates.json, or none: a part that sends no WhatsApp message (a listings-only shop) has no file and adds nothing. */
export function readEntries(folder: string): Entry[] {
  const file = join(folder, "whatsapp-templates.json");
  if (!existsSync(file)) return [];
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${file} is not a list of templates.`);
  return parsed as Entry[];
}

/**
 * The union of the parts' templates in these languages (all of them when none are named), one per name and language. The same name and language from two parts is
 * merged when the two entries are the same, field for field (two parts built on the same module say the same thing), and refused when they differ, because the
 * account would hold only the first and the other part's messages would go out with words its outgoing check never read.
 */
export function templateSet(parts: readonly TemplatePart[], languages: readonly string[] = []): Entry[] {
  const out = new Map<string, { entry: Entry; part: string; text: string }>();
  for (const part of parts) {
    for (const entry of readEntries(part.folder)) {
      if (languages.length > 0 && !languages.includes(entry.language)) continue;
      const k = keyOf(entry.name, entry.language);
      const text = JSON.stringify(entry);
      const had = out.get(k);
      if (!had) { out.set(k, { entry, part: part.id, text }); continue; }
      if (had.text === text) continue; // the same template from two parts (or twice in one file) is one template
      throw new TemplateSetConflict(`The template parts ${had.part} and ${part.id} both have a WhatsApp template ${entry.name} (${entry.language}) with different words. One of them must use another name.`);
    }
  }
  return [...out.values()].map((v) => v.entry);
}

/**
 * Every language a shop's messages go out in: its customers' languages, the owner's, and those of the people who approve refunds or take orders (approvers,
 * suppliers), when its settings have them. The owner's notices are templates too, and an owner may read a language no customer is written in.
 */
export function shopLanguages(settings: unknown): string[] {
  const s = (settings ?? {}) as { languages?: unknown; owner?: { language?: unknown }; approvers?: unknown; suppliers?: unknown };
  const found = new Set<string>();
  const add = (v: unknown) => { if (typeof v === "string" && v !== "") found.add(v); };
  if (Array.isArray(s.languages)) s.languages.forEach(add);
  add(s.owner?.language);
  for (const list of [s.approvers, s.suppliers]) if (Array.isArray(list)) for (const p of list) add((p as { language?: unknown } | null)?.language);
  return [...found];
}

/** What a shop is, for its template set: the template it is set up from, its settings (decision 65 will read its parts there), and where a template's folder is. */
export interface ShopTemplates { templateId: string; settings: unknown; folderOf: (id: string) => string | undefined }

/**
 * The template parts a shop has: the template it is set up from (its pathway.lock, or the panel's record of its kind), or, for a shop of several parts (decision 65,
 * pathway `parts`), each part its settings name in `parts`, in the shop's order. Every caller (the panel, the command line) then submits the union (templateSet).
 */
export function shopParts(o: ShopTemplates): TemplatePart[] {
  const ids = o.templateId === "parts" ? Object.keys(((o.settings as { parts?: object } | undefined)?.parts) ?? {}) : [o.templateId];
  return ids.flatMap((id) => { const folder = o.folderOf(id); return folder ? [{ id, folder }] : []; });
}

/** A shop's template set: its parts' templates, in its languages. The one function the panel and the command line ask. */
export function shopTemplateSet(o: ShopTemplates): Entry[] {
  return templateSet(shopParts(o), shopLanguages(o.settings));
}

// ---- 2. the shop's account -----------------------------------------------------------------------------------------------------------------------------

/**
 * The account a shop's templates go to, from runtime.json services.messaging (none of it secret). `undefined`: the shop has no WhatsApp. "other": a Gupshup partner
 * app (item 11b), whose templates Gupshup's partner adds; nothing here submits for it.
 */
export type Account =
  | { provider: "meta"; phoneNumberId: string; wabaId?: string }
  | { provider: "gupshup-selfserve"; appName: string; appId?: string }
  | { provider: "other" };

export function accountOf(runtime: unknown): Account | undefined {
  const m = (runtime as { services?: { messaging?: Record<string, unknown> } } | undefined)?.services?.messaging;
  if (!m || typeof m !== "object") return undefined;
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
  if (m.provider === "gupshup-selfserve") return { provider: "gupshup-selfserve", appName: String(m.appName ?? ""), ...(str(m.appId) ? { appId: str(m.appId)! } : {}) };
  if (m.provider !== undefined && m.provider !== "meta") return { provider: "other" };
  return { provider: "meta", phoneNumberId: String(m.phoneNumberId ?? ""), ...(str(m.wabaId) ? { wabaId: str(m.wabaId)! } : {}) };
}

/** Why the templates of this account cannot be read or sent from here, or undefined. The panel words each code (bundle/panel/wa-templates.ts). */
export type Missing = "account-id" | "app-id" | "provider";
export function missingFor(account: Account, mode: "read" | "submit"): Missing | undefined {
  if (account.provider === "other") return "provider";
  if (account.provider === "meta" && !account.wabaId) return "account-id";
  if (account.provider === "gupshup-selfserve" && mode === "submit" && !account.appId) return "app-id";
  return undefined;
}

// ---- 3. the calls --------------------------------------------------------------------------------------------------------------------------------------

export interface Reply { status: number; body: unknown }
/** One HTTP call to the provider, or to the shop's Guard in front of it. Paths are the provider's own. */
export type Call = (method: "GET" | "POST", path: string, o?: { query?: Record<string, string>; json?: unknown; form?: Record<string, string> }) => Promise<Reply>;

/**
 * The panel's way: through the shop's WhatsApp Guard (bundle/generate/guards.ts: the template routes, pinned to the shop's own account, for the panel's agent only).
 * The panel sends only its own Guard credential; the Guard adds the shop's key. Guard's own answers come back as the errors of modules/core/http.ts.
 */
export function guardCall(baseUrl: string, agentToken?: string, timeoutMs = 20_000): Call {
  const http = createHttp(baseUrl, "WhatsApp Guard", timeoutMs, agentToken);
  return async (method, path, o = {}) => http.request(method, path, { ...(o.query ? { query: o.query } : {}), ...(o.json !== undefined ? { body: o.json } : {}), ...(o.form ? { form: o.form } : {}) });
}

/** A plain-http base is only for a stand-in on this machine: a key is never sent over the network in the clear. */
export function baseUrlProblem(base: string, name: string): string | undefined {
  let u: URL;
  try { u = new URL(base); } catch { return `${name} is not an address.`; }
  if (u.protocol === "https:") return undefined;
  return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost") ? undefined : `${name} must be https (plain http only for this machine).`;
}

/** The command line's way: straight to the provider, from the server, with the shop's key in one header. The key is in no message this returns. `fetchImpl` is for tests. */
export function directCall(base: string, baseName: string, header: { name: string; value: string }, fetchImpl: typeof fetch = fetch): Call {
  const problem = baseUrlProblem(base, baseName);
  if (problem) throw new Error(problem);
  const root = base.replace(/\/+$/u, "");
  return async (method, path, o = {}) => {
    const qs = o.query ? `?${new URLSearchParams(o.query).toString()}` : "";
    const headers: Record<string, string> = { [header.name]: header.value, accept: "application/json" };
    let body: string | undefined;
    if (o.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(o.json); }
    else if (o.form) { headers["content-type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(o.form).toString(); }
    let r: Response;
    try { r = await fetchImpl(`${root}${path}${qs}`, { method, headers, ...(body !== undefined ? { body } : {}) }); } catch { throw new NotSentError(`${baseName}: could not connect.`, "ECONNREFUSED"); }
    const text = await r.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = { raw: text.slice(0, 200) }; }
    return { status: r.status, body: parsed };
  };
}

/** Why a run stopped before the end: the key, a rate limit, the Guard or the provider out of reach, or the Guard's own refusal. Every later call would fail the same way. */
export interface Stop { kind: "key" | "rate" | "unreachable" | "guard" | "other"; message: string }

/** A template the provider refused, or an entry that cannot be sent as it is, and why, in plain words. */
export interface Refusal { name: string; language: string; reason: string }

/** What the account holds: the state as the provider writes it (in capitals) and, for a rejected one, the provider's reason when it gave one. */
export interface Held { state: string; reason?: string }

export interface Provider {
  /** "Meta" or "Gupshup", for the words. */
  label: string;
  /** What the account holds, by keyOf(name, language). Throws a StopError when the provider or the Guard refuses. */
  list(): Promise<Map<string, Held>>;
  /** The request one entry becomes, or why it cannot be sent as it is. */
  prepare(e: Entry): { body: Record<string, unknown> } | Refusal;
  /** Send one. A refusal that would refuse every later call too is a StopError; one template's refusal is `ok: false`. */
  create(prepared: Record<string, unknown>): Promise<{ ok: true } | { ok: false; reason: string }>;
}

export class StopError extends Error { stop: Stop; constructor(stop: Stop) { super(stop.message); this.name = "StopError"; this.stop = stop; } }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A failed call, read in ONE place. Guard's own answers first (modules/core/http.ts turns them into errors): the panel's Guard credential refused, a rule or the hourly
 * limit, the Guard not up yet. Then the provider's: 401 or 403, or Meta's code 190 (a token it does not accept) and 200 (a token without the permission to manage
 * templates), mean the key, so the run stops; 429 or Meta's 80008 mean too many calls, so the run stops and the rest go later.
 */
export function stopOf(e: unknown, label: string): Stop {
  if (e instanceof StopError) return e.stop;
  if (e instanceof GuardRefusedError) return e.kind === "limit" ? { kind: "rate", message: `The shop's WhatsApp Guard lets the panel send ${label} 100 new templates an hour; the rest go later.` } : { kind: "guard", message: `The shop's WhatsApp Guard refused the call (${e.guard.reason ?? e.message}).` };
  if (e instanceof GuardUnauthenticatedError) return { kind: "guard", message: "The shop's WhatsApp Guard did not accept the panel's own credential." };
  if (e instanceof GuardUnavailableError || e instanceof NotSentError || e instanceof TimeoutError) return { kind: "unreachable", message: "The shop's WhatsApp connection did not answer (it may not be running yet)." };
  if (e instanceof GuardError) return { kind: "guard", message: `The shop's WhatsApp Guard answered: ${e.message}` };
  return { kind: "other", message: (e as Error)?.message ?? String(e) };
}

/** A provider's refusal: a Stop when it is about the key or the rate, else undefined (one template's problem). */
function stopFromReply(r: Reply, label: string, said: string): Stop | undefined {
  const code = isObj(r.body) && isObj(r.body.error) ? Number(r.body.error.code) : undefined;
  if (r.status === 401 || r.status === 403 || code === 190 || code === 200) return { kind: "key", message: `${label} did not accept the shop's key (${said}). Hand in the key again in the shop's WhatsApp step.` };
  if (r.status === 429 || code === 80008 || code === 4) return { kind: "rate", message: `${label} says too many calls just now (${said}); the rest go later.` };
  return undefined;
}

// Meta ---------------------------------------------------------------------------------------------------------------------------------------------------

/** What Meta said, in its own words: `error_user_msg` (written for a person) when there is one, else `message`, with the code. */
function metaSaid(r: Reply): string {
  const e = isObj(r.body) && isObj(r.body.error) ? r.body.error : undefined;
  if (!e) return `Meta answered ${r.status}`;
  const words = typeof e.error_user_msg === "string" && e.error_user_msg ? e.error_user_msg : typeof e.message === "string" ? e.message : `answered ${r.status}`;
  return `Meta: ${words}${e.code !== undefined ? ` (code ${String(e.code)})` : ""}`;
}

/** What every provider refuses in an entry, before its own mapping: the name, the language code, the category, the body and a sample for each value. */
function entryProblem(e: Entry): string | undefined {
  if (!TEMPLATE_NAME.test(e.name ?? "")) return "the name must be lowercase letters, digits and underscores";
  if (!/^[a-z]{2}(?:_[A-Z]{2})?$/u.test(e.language ?? "")) return "the language code is not one Meta writes (hi, en, ml, kn, en_US ...)";
  if (!["UTILITY", "MARKETING", "AUTHENTICATION"].includes(e.category)) return `the category ${e.category} is not UTILITY, MARKETING or AUTHENTICATION`;
  const body = e.components?.find((c) => c.type === "BODY");
  if (!body?.text) return "it has no body";
  if (body.text.length > BODY_LIMIT) return `the body is longer than ${BODY_LIMIT} characters`;
  const slots = body.text.match(/\{\{\d+\}\}/gu) ?? [];
  const samples = body.example?.body_text?.[0];
  if (slots.length > 0 && (!samples || samples.length < slots.length || samples.some((s) => s.trim() === ""))) return "it takes values but has no sample for each one (Meta refuses a template without samples)";
  return undefined;
}

/**
 * One entry as Meta's create body: the file is already in Meta's shape, so only its five fields are sent (an unknown member is not passed on). A media header needs
 * a sample uploaded first (Meta's Resumable Upload API), which this does not do, so such an entry is refused here rather than sent half-made.
 */
export function metaBody(e: Entry): { body: Record<string, unknown> } | Refusal {
  const no = (reason: string): Refusal => ({ name: e.name, language: e.language, reason });
  const p = entryProblem(e);
  if (p) return no(p);
  for (const c of e.components) {
    if (c.type === "HEADER" && (c.format ?? "TEXT") !== "TEXT") return no(`its HEADER (${c.format}) needs a sample file uploaded first: add that one in WhatsApp Manager`);
    if (!["HEADER", "BODY", "FOOTER", "BUTTONS"].includes(c.type)) return no(`its ${c.type} cannot be sent from here: add that one in WhatsApp Manager`);
  }
  return { body: { name: e.name, language: e.language, category: e.category, ...(e.parameter_format ? { parameter_format: e.parameter_format } : {}), components: e.components } };
}

const MAX_PAGES = 50;

/** Meta's template calls for one WhatsApp Business Account, over `call`. */
export function metaProvider(call: Call, wabaId: string, version = GRAPH_VERSION): Provider {
  const path = `/${version}/${encodeURIComponent(wabaId)}/message_templates`;
  return {
    label: "Meta",
    async list() {
      const out = new Map<string, Held>();
      let after: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const r = await call("GET", path, { query: { fields: "name,language,status,rejected_reason", limit: "100", ...(after ? { after } : {}) } });
        if (r.status < 200 || r.status >= 300) throw new StopError(stopFromReply(r, "Meta", metaSaid(r)) ?? { kind: "other", message: `Could not read the shop's templates. ${metaSaid(r)}.` });
        const data = isObj(r.body) && Array.isArray(r.body.data) ? r.body.data : [];
        for (const t of data) {
          if (!isObj(t) || typeof t.name !== "string" || typeof t.language !== "string") continue;
          const reason = typeof t.rejected_reason === "string" && t.rejected_reason !== "" && t.rejected_reason !== "NONE" ? t.rejected_reason : undefined;
          out.set(keyOf(t.name, t.language), { state: String(t.status ?? "UNKNOWN").toUpperCase(), ...(reason ? { reason } : {}) });
        }
        const paging = isObj(r.body) && isObj(r.body.paging) ? r.body.paging : undefined;
        const next = paging && isObj(paging.cursors) && typeof paging.cursors.after === "string" ? paging.cursors.after : undefined;
        // Meta gives a `next` link only when there is another page; the cursor alone is also there on the last one
        if (!next || typeof paging?.next !== "string" || data.length === 0) break;
        after = next;
      }
      return out;
    },
    prepare: metaBody,
    async create(body) {
      const r = await call("POST", path, { json: body });
      if (r.status >= 200 && r.status < 300) return { ok: true };
      const stop = stopFromReply(r, "Meta", metaSaid(r));
      if (stop) throw new StopError(stop);
      return { ok: false, reason: metaSaid(r) };
    },
  };
}

// Gupshup ------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * How sample values are written in Gupshup's `example`. Its guide says only "template body example"; its dashboard shows the body with each {{n}} replaced by a value
 * in square brackets, which is what is sent here. THIS IS THE ONE THING TO CONFIRM on the first real submission (use --only on a single template first).
 */
export const EXAMPLE_FORM = (value: string): string => `[${value}]`;

/**
 * One entry as Gupshup's create form, or why it cannot be sent. A body-only message (all of today's) maps without a doubt. A header, footer or buttons are mapped as the
 * guide names them; an image or media header needs a sample file uploaded first, which this does not do, so such an entry is refused.
 */
export function gupshupForm(e: Entry): { body: Record<string, string> } | Refusal {
  const no = (reason: string): Refusal => ({ name: e.name, language: e.language, reason });
  const p = entryProblem(e);
  if (p) return no(p.replace("Meta writes", "Gupshup writes").replace("(Meta refuses", "(Gupshup and Meta refuse"));
  const body = e.components.find((c) => c.type === "BODY")!;
  const text = body.text as string;
  const samples = body.example?.body_text?.[0] ?? [];
  const form: Record<string, string> = { elementName: e.name, languageCode: e.language, category: e.category, templateType: "TEXT", vertical: e.name, content: text,
    example: text.replace(/\{\{(\d+)\}\}/gu, (_m, n: string) => EXAMPLE_FORM(samples[Number(n) - 1] ?? "")) };
  for (const c of e.components) {
    if (c.type === "BODY") continue;
    if (c.type === "FOOTER") { if (!c.text || c.text.length > FOOTER_LIMIT) return no("the footer is empty or longer than 60 characters"); form.footer = c.text; continue; }
    if (c.type === "HEADER" && (c.format ?? "TEXT") === "TEXT") { if (!c.text || c.text.length > HEADER_LIMIT) return no("the header is empty or longer than 60 characters"); form.header = c.text; continue; }
    if (c.type === "BUTTONS" && c.buttons?.length) { form.buttons = JSON.stringify(c.buttons); continue; }
    return no(`its ${c.type}${c.format ? ` (${c.format})` : ""} cannot be sent from here: add that one in Gupshup's dashboard`);
  }
  return { body: form };
}

const gupshupSaid = (r: Reply): string => (isObj(r.body) && typeof r.body.message === "string" ? `Gupshup: ${r.body.message}` : `Gupshup answered ${r.status}`);
const PAGE = 100;

/** Gupshup's self-serve template calls for one app, over `call`. Without the app's id the list is read by name, and nothing can be created (missingFor says so first). */
export function gupshupProvider(call: Call, app: { appName: string; appId?: string }): Provider {
  return {
    label: "Gupshup",
    async list() {
      const out = new Map<string, Held>();
      for (let page = 0; page < MAX_PAGES; page++) {
        const r = await call("GET", templateListPath(app.appName, app.appId), app.appId ? { query: { pageNo: String(page), pageSize: String(PAGE) } } : {});
        if (r.status < 200 || r.status >= 300 || (isObj(r.body) && r.body.status === "error")) throw new StopError(stopFromReply(r, "Gupshup", gupshupSaid(r)) ?? { kind: "other", message: `Could not read the templates of the Gupshup app ${app.appName}. ${gupshupSaid(r)}.` });
        const list = isObj(r.body) && Array.isArray(r.body.templates) ? r.body.templates : [];
        for (const t of list) {
          if (!isObj(t) || typeof t.elementName !== "string" || typeof t.languageCode !== "string") continue;
          const reason = typeof t.reason === "string" && t.reason !== "" ? t.reason : undefined;
          out.set(keyOf(t.elementName, t.languageCode), { state: String(t.status ?? "UNKNOWN").toUpperCase(), ...(reason ? { reason } : {}) });
        }
        if (!app.appId || list.length < PAGE) break; // the by-name list has one page
      }
      return out;
    },
    prepare: gupshupForm,
    async create(form) {
      const r = await call("POST", GUPSHUP_SELFSERVE_ROUTES.listById.replace("{app_id}", encodeURIComponent(app.appId ?? "")), { form: form as Record<string, string> });
      const failed = r.status < 200 || r.status >= 300 || (isObj(r.body) && r.body.status === "error");
      if (!failed) return { ok: true };
      const stop = stopFromReply(r, "Gupshup", gupshupSaid(r));
      if (stop) throw new StopError(stop);
      return { ok: false, reason: gupshupSaid(r) };
    },
  };
}

// ---- 4. the run, and the state ----------------------------------------------------------------------------------------------------------------------------

/** The plain buckets a shop page shows. "stopped": Meta or Gupshup paused, disabled or removed it (it cannot be sent until a person looks). */
export type Bucket = "approved" | "pending" | "rejected" | "stopped" | "not-submitted";

/** A provider's state in a bucket. Meta: APPROVED; PENDING and IN_APPEAL wait. Gupshup: SUBMITTED waits; FAILED is a refusal. Anything else cannot be sent now. */
export function bucketOf(state: string | undefined): Bucket {
  if (state === undefined) return "not-submitted";
  if (state === "APPROVED" || state === "ENABLED") return "approved";
  if (["PENDING", "IN_APPEAL", "SUBMITTED", "CREATED", "IN_REVIEW"].includes(state)) return "pending";
  if (state === "REJECTED" || state === "FAILED") return "rejected";
  return "stopped";
}

export interface Row { name: string; language: string; bucket: Bucket; state?: string; reason?: string }

/** Each template of the set with what the account holds of it, and the counts per bucket. */
export function statusRows(entries: readonly Entry[], held: ReadonlyMap<string, Held>): { rows: Row[]; counts: Record<Bucket, number> } {
  const counts: Record<Bucket, number> = { approved: 0, pending: 0, rejected: 0, stopped: 0, "not-submitted": 0 };
  const rows = entries.map((e) => {
    const h = held.get(keyOf(e.name, e.language));
    const bucket = bucketOf(h?.state);
    counts[bucket]++;
    return { name: e.name, language: e.language, bucket, ...(h ? { state: h.state } : {}), ...(h?.reason ? { reason: h.reason } : {}) };
  });
  return { rows, counts };
}

/** What to send: every entry the account does not hold by name and language. Whatever its state, one it holds is skipped: a rejected one needs a person's look, not a blind resend. */
export function plan(entries: readonly Entry[], held: ReadonlyMap<string, Held>, provider: Pick<Provider, "prepare">): { send: { entry: Entry; body: Record<string, unknown> }[]; have: { entry: Entry; state: string }[]; unsendable: Refusal[] } {
  const send: { entry: Entry; body: Record<string, unknown> }[] = []; const have: { entry: Entry; state: string }[] = []; const unsendable: Refusal[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const k = keyOf(entry.name, entry.language);
    if (seen.has(k)) continue;
    seen.add(k);
    const h = held.get(k);
    if (h) { have.push({ entry, state: h.state }); continue; }
    const p = provider.prepare(entry);
    if ("reason" in p) unsendable.push(p); else send.push({ entry, body: p.body });
  }
  return { send, have, unsendable };
}

/** Pick the entries to work on, for a first careful try from the command line: some languages, some names (all when none are named). */
export function select(entries: readonly Entry[], o: { languages?: readonly string[]; only?: readonly string[] }): Entry[] {
  return entries.filter((e) => (!o.languages?.length || o.languages.includes(e.language)) && (!o.only?.length || o.only.includes(e.name)));
}

export interface RunResult {
  /** What happened, one line each, for the command line (no key is ever in one). */
  lines: string[];
  sent: number;
  refused: Refusal[];
  unsendable: Refusal[];
  skipped: number;
  /** Set when the run stopped before the end: nothing after it was tried. */
  stopped?: Stop;
  /** What the account holds after the run (the ones just sent counted as waiting), when its list could be read. */
  held?: Map<string, Held>;
  code: number;
}

/**
 * The whole run. "status" only reads; "dry-run" reads and says what it would send; "submit" sends what the account does not hold. A refused key, a rate limit or an
 * unreachable Guard stops the run (every later call would fail the same way: the rest go on the next run); any other refusal is said and the run goes on, so one bad
 * entry does not hide the rest. `pause` spaces the calls (Gupshup rate-limits with 429; Meta counts 100 an hour).
 */
export async function run(o: { entries: readonly Entry[]; provider: Provider; mode: "dry-run" | "submit" | "status"; pause?: () => Promise<void> }): Promise<RunResult> {
  const lines: string[] = [];
  const label = o.provider.label;
  let held: Map<string, Held>;
  try { held = await o.provider.list(); } catch (e) {
    const stopped = stopOf(e, label);
    return { lines: [`Stopped: ${stopped.message}`], sent: 0, refused: [], unsendable: [], skipped: 0, stopped, code: 1 };
  }
  if (o.mode === "status") {
    const { rows, counts } = statusRows(o.entries, held);
    for (const r of rows) lines.push(`${r.name} (${r.language}): ${r.state ? r.state.toLowerCase() : "not submitted"}${r.reason ? ` (${r.reason})` : ""}`);
    lines.push(`Summary: ${counts.approved} approved, ${counts.pending} waiting, ${counts.rejected} rejected, ${counts.stopped} paused or disabled, ${counts["not-submitted"]} not submitted.`);
    return { lines, sent: 0, refused: [], unsendable: [], skipped: 0, held, code: 0 };
  }
  const p = plan(o.entries, held, o.provider);
  for (const u of p.unsendable) lines.push(`cannot send ${u.name} (${u.language}): ${u.reason}`);
  for (const h of p.have) lines.push(`skip ${h.entry.name} (${h.entry.language}): already ${h.state.toLowerCase()}${bucketOf(h.state) === "rejected" ? ` (needs a look in ${label === "Meta" ? "WhatsApp Manager" : "Gupshup"} before it is sent again)` : ""}`);
  if (o.mode === "dry-run") {
    for (const s of p.send) lines.push(`would submit ${s.entry.name} (${s.entry.language}): ${JSON.stringify(s.body)}`);
    lines.push(`Dry run: nothing was sent. Would submit ${p.send.length}, skip ${p.have.length} already with ${label}, ${p.unsendable.length} cannot be sent. Add --submit to send.`);
    return { lines, sent: 0, refused: [], unsendable: p.unsendable, skipped: p.have.length, held, code: p.unsendable.length ? 1 : 0 };
  }
  let sent = 0; const refused: Refusal[] = []; let stopped: Stop | undefined;
  for (const s of p.send) {
    let r: { ok: true } | { ok: false; reason: string };
    try { r = await o.provider.create(s.body); } catch (e) { stopped = stopOf(e, label); lines.push(`Stopped at ${s.entry.name} (${s.entry.language}): ${stopped.message}`); break; }
    if (r.ok) { sent++; held.set(keyOf(s.entry.name, s.entry.language), { state: "PENDING" }); lines.push(`submitted ${s.entry.name} (${s.entry.language})`); }
    else { refused.push({ name: s.entry.name, language: s.entry.language, reason: r.reason }); lines.push(`refused ${s.entry.name} (${s.entry.language}): ${r.reason}`); }
    await o.pause?.();
  }
  lines.push(`Submitted ${sent}, refused ${refused.length}${stopped ? " (stopped early)" : ""}, skipped ${p.have.length} already with ${label}, ${p.unsendable.length} cannot be sent. ${label} takes up to a day to approve.`);
  return { lines, sent, refused, unsendable: p.unsendable, skipped: p.have.length, held, ...(stopped ? { stopped } : {}), code: refused.length || p.unsendable.length || stopped ? 1 : 0 };
}
