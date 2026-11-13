// Submitting a template's WhatsApp messages to Gupshup by script (pre-release batch 7, item 1), instead of a person typing about 400 entries into Gupshup's dashboard.
// A template's whatsapp-templates.json (written from the messages themselves by its scripts/whatsapp-templates.ts) lists each message in Meta's own shape; this file maps each
// entry to the fields of Gupshup's self-serve "create template" call, reads the app's templates back, and decides what still has to be sent. The command line
// (whatsapp-templates-cli.ts) only parses arguments and prints; everything it decides is here, so a test can read it.
//
// Which Gupshup API, read 14 Nov 2026 on docs.gupshup.io:
//  - create: POST https://api.gupshup.io/wa/app/{appId}/template, header `apikey`, Content-Type application/x-www-form-urlencoded, fields languageCode, content (the body),
//            footer, category, example, vertical, elementName (the name), templateType, buttons. The reply holds `status`, `template` on success and `message` on failure.
//            https://docs.gupshup.io/docs/template-button-list  (a guide page with a curl example: Gupshup's API reference lists NO create call, only the two reads below;
//            https://docs.gupshup.io/llms.txt shows the same). The guide does not say how `example` writes the sample values, what `vertical` may hold or which language
//            codes are accepted: see EXAMPLE_FORM and the notes in bundle/Deferred.md. Name rules (lowercase, digits, underscores), body 1024, header and footer 60 characters,
//            samples mandatory: https://docs.gupshup.io/docs/create-template
//  - read:   GET https://api.gupshup.io/wa/app/{app_id}/template (query pageNo, pageSize, templateStatus, ...) answers { status: "success", templates: [{ id, elementName,
//            languageCode, status, category, ... }] }: https://docs.gupshup.io/reference/get-all-templates-for-an-app.md . Without an app id the older list by app name
//            (GET /sm/api/v1/template/list/{appName}) is read, the same one modules/messaging/gupshup-selfserve.ts uses.
//  - statuses Gupshup names: Submitted, Approved, Rejected, Paused, Failed, Deactivated (https://docs.gupshup.io/docs/message-template-approvals-statuses.md).
//
// The key: this file never receives it as an argument and never prints it. The command line hands it in from the environment (GUPSHUP_APIKEY) or from the shop's own secret
// file (secrets/g-<shop>-whatsapp/whatsapp_authorization, where `gupshup_apikey` was put), the same file the shop's Guard reads. Template creation is not one of the routes a shop's
// Guard allows (it is the owner's one-off set-up, not something the running shop does), so this talks to api.gupshup.io itself, from the machine that runs the command.
// Not touched against the real service: every test uses a local stand-in.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkoutDirOf } from "./pathways.ts";
import { readSecretFile, secretFile } from "./secrets.ts";
import { serverPaths } from "./server.ts";

/** Gupshup's host. A test (or a person with a proxy) can point GUPSHUP_API_BASE somewhere else; see baseUrlProblem. */
export const GUPSHUP_API_BASE = "https://api.gupshup.io";
/** The template name Gupshup accepts (lowercase letters, digits, underscores), and its length limits. */
export const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/u;
export const BODY_LIMIT = 1024;
export const HEADER_LIMIT = 60;
export const FOOTER_LIMIT = 60;

/** One entry of whatsapp-templates.json, in Meta's shape. Only what the mapping reads. */
export interface Entry { name: string; language: string; category: string; parameter_format?: string; components: Component[] }
export interface Component { type: string; format?: string; text?: string; example?: { body_text?: string[][]; header_text?: string[]; header_handle?: string[] }; buttons?: { type: string; text: string; url?: string; phone_number?: string }[] }

/** The form fields of Gupshup's create call for one entry. */
export type CreateForm = Record<string, string>;
/** An entry that cannot be sent as it is, and why, in plain words. */
export interface Unsendable { name: string; language: string; reason: string }

/**
 * How sample values are written in `example`. Gupshup's guide says only "template body example"; its dashboard shows the body with each {{n}} replaced by a value in square
 * brackets, which is what is sent here. THIS IS THE ONE THING TO CONFIRM on the first real submission (use --only on a single template first, then read the state with --status).
 */
export const EXAMPLE_FORM = (value: string): string => `[${value}]`;

/** The entries of a template's whatsapp-templates.json, from the current checkout (templates/<domain>/<template>). */
export function readEntries(appDir: string, template: string): Entry[] {
  const dir = checkoutDirOf(appDir, template);
  const file = dir ? join(dir, "whatsapp-templates.json") : undefined;
  if (!file || !existsSync(file)) throw new Error(`There is no list of WhatsApp templates for "${template}" in this checkout (templates/<domain>/${template}/whatsapp-templates.json).`);
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${file} is not a list of templates.`);
  return parsed as Entry[];
}

/** The body with each {{n}} replaced by its sample value, as Gupshup's `example` wants it. */
function exampleOf(text: string, samples: string[]): string {
  return text.replace(/\{\{(\d+)\}\}/gu, (_m, n: string) => EXAMPLE_FORM(samples[Number(n) - 1] ?? ""));
}

/**
 * One entry as Gupshup's create fields, or why it cannot be sent. A body-only message (all of today's) maps without a doubt. A header, footer or buttons are mapped as the guide
 * names them; an image or media header needs a sample file uploaded first, which this does not do, so such an entry is refused here rather than sent half-made.
 */
export function toForm(e: Entry): CreateForm | Unsendable {
  const no = (reason: string): Unsendable => ({ name: e.name, language: e.language, reason });
  if (!TEMPLATE_NAME.test(e.name ?? "")) return no("the name must be lowercase letters, digits and underscores");
  if (!/^[a-z]{2}(?:_[A-Z]{2})?$/u.test(e.language ?? "")) return no("the language code is not one Gupshup writes (hi, en, ml, kn, en_US ...)");
  if (!["UTILITY", "MARKETING", "AUTHENTICATION"].includes(e.category)) return no(`the category ${e.category} is not UTILITY, MARKETING or AUTHENTICATION`);
  const body = e.components.find((c) => c.type === "BODY");
  if (!body?.text) return no("it has no body");
  if (body.text.length > BODY_LIMIT) return no(`the body is longer than ${BODY_LIMIT} characters`);
  const form: CreateForm = { elementName: e.name, languageCode: e.language, category: e.category, templateType: "TEXT", vertical: e.name, content: body.text };
  const slots = body.text.match(/\{\{\d+\}\}/gu) ?? [];
  if (slots.length > 0) {
    const samples = body.example?.body_text?.[0];
    if (!samples || samples.length < slots.length || samples.some((s) => s.trim() === "")) return no("it takes values but has no sample for each one (Gupshup and Meta refuse a template without samples)");
    form.example = exampleOf(body.text, samples);
  } else form.example = body.text;
  for (const c of e.components) {
    if (c.type === "BODY") continue;
    if (c.type === "FOOTER") { if (!c.text || c.text.length > FOOTER_LIMIT) return no("the footer is empty or longer than 60 characters"); form.footer = c.text; continue; }
    if (c.type === "HEADER" && (c.format ?? "TEXT") === "TEXT") {
      if (!c.text || c.text.length > HEADER_LIMIT) return no("the header is empty or longer than 60 characters");
      form.header = c.text; form.templateType = "TEXT"; continue;
    }
    if (c.type === "BUTTONS" && c.buttons?.length) { form.buttons = JSON.stringify(c.buttons); continue; }
    return no(`its ${c.type}${c.format ? ` (${c.format})` : ""} cannot be sent by this command: add that one in Gupshup's dashboard`);
  }
  return form;
}

/** A Gupshup state, the way the template list writes it, in capitals. */
export type State = string;
/** What the app already holds, keyed "<name>:<language>". */
export type Listed = Map<string, State>;

const key = (name: string, language: string) => `${name}:${language}`;

/** The states in which a template is already with Gupshup or Meta, so sending it again would be wrong or refused. Every state counts: a rejected one needs a person's look, not a blind resend. */
export function plan(entries: readonly Entry[], listed: Listed): { send: { entry: Entry; form: CreateForm }[]; have: { entry: Entry; state: State }[]; unsendable: Unsendable[] } {
  const send: { entry: Entry; form: CreateForm }[] = []; const have: { entry: Entry; state: State }[] = []; const unsendable: Unsendable[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const k = key(entry.name, entry.language);
    if (seen.has(k)) continue; // the same name and language twice in the file is one template
    seen.add(k);
    const state = listed.get(k);
    if (state !== undefined) { have.push({ entry, state }); continue; }
    const form = toForm(entry);
    if ("reason" in form) unsendable.push(form); else send.push({ entry, form });
  }
  return { send, have, unsendable };
}

/** Pick the entries to work on: the template's languages (all when none are named) and, for a first careful try, only some names. */
export function select(entries: readonly Entry[], o: { languages?: readonly string[]; only?: readonly string[] }): Entry[] {
  return entries.filter((e) => (!o.languages?.length || o.languages.includes(e.language)) && (!o.only?.length || o.only.includes(e.name)));
}

// ---- the shop's own details ----------------------------------------------------------------------------------------------------------------------------

export interface App { appName: string; appId?: string }

/** The shop's Gupshup app from its runtime.json (none of it is secret). */
export function appOf(serverDir: string, shop: string): App {
  const file = join(serverPaths(serverDir).shop(shop), "runtime.json");
  if (!existsSync(file)) throw new Error(`${shop} has no runtime.json yet, so it has no Gupshup app set up. Set up its WhatsApp number in the panel first.`);
  const m = (JSON.parse(readFileSync(file, "utf8")) as { services?: { messaging?: Record<string, unknown> } }).services?.messaging;
  if (m?.provider !== "gupshup-selfserve" || typeof m.appName !== "string") throw new Error(`${shop} does not use its own Gupshup account (provider "gupshup-selfserve" with an app name in runtime.json), so there is nothing to submit to.`);
  return { appName: m.appName, ...(typeof m.appId === "string" ? { appId: m.appId } : {}) };
}

/** The template a shop is pinned to ("bookings@0.1.0" in pathway.lock gives "bookings"). */
export function templateOf(serverDir: string, shop: string): string {
  const file = join(serverPaths(serverDir).shop(shop), "pathway.lock");
  if (!existsSync(file)) throw new Error(`${shop} has no pathway.lock; say the template with --template bookings|orders|fees.`);
  return readFileSync(file, "utf8").trim().split("@")[0];
}

/** The shop's API key: the environment first, then the shop's own secret file. Never an argument. */
export function apiKeyOf(serverDir: string, shop: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.GUPSHUP_APIKEY?.trim();
  const key = fromEnv || readSecretFile(secretFile(serverDir, `g-${shop}-whatsapp`, "whatsapp_authorization"));
  if (!key) throw new Error(`No Gupshup API key found for ${shop}. Either set GUPSHUP_APIKEY in the environment for this one command, or hand the key in the usual way (the panel, or secrets-inbox/${shop}/gupshup_apikey) so it is in the shop's secret file.`);
  if (/\s/u.test(key)) throw new Error("The Gupshup API key must be on one line with no spaces.");
  return key;
}

/** A plain-http base is only for a stand-in on this machine: a key is never sent over the network in the clear. */
export function baseUrlProblem(base: string): string | undefined {
  let u: URL;
  try { u = new URL(base); } catch { return "GUPSHUP_API_BASE is not an address."; }
  if (u.protocol === "https:") return undefined;
  return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost") ? undefined : "GUPSHUP_API_BASE must be https (plain http only for this machine).";
}

// ---- the calls -----------------------------------------------------------------------------------------------------------------------------------------

export interface Gupshup { listStates(app: App): Promise<Listed>; create(app: App & { appId: string }, form: CreateForm): Promise<{ ok: true } | { ok: false; status: number; message: string }> }

const PAGE = 100;
const MAX_PAGES = 50;

/** Gupshup's calls over fetch. `fetchImpl` is for tests. The key is in a header and in no message this returns. */
export function gupshupApi(base: string, apikey: string, fetchImpl: typeof fetch = fetch): Gupshup {
  const problem = baseUrlProblem(base);
  if (problem) throw new Error(problem);
  const root = base.replace(/\/+$/u, "");
  const headers = { apikey };
  const say = (body: unknown, status: number): string => (body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string" ? `Gupshup: ${(body as { message: string }).message}` : `Gupshup answered ${status}.`);
  const json = async (r: Response): Promise<unknown> => { try { return JSON.parse(await r.text()); } catch { return undefined; } };
  return {
    async listStates(app) {
      const out: Listed = new Map();
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = app.appId ? `${root}/wa/app/${encodeURIComponent(app.appId)}/template?pageNo=${page}&pageSize=${PAGE}` : `${root}/sm/api/v1/template/list/${encodeURIComponent(app.appName)}`;
        const r = await fetchImpl(url, { headers });
        const body = await json(r);
        if (!r.ok) throw new Error(`Could not read the templates of the Gupshup app ${app.appName}. ${say(body, r.status)}`);
        const list = (body && typeof body === "object" ? (body as { templates?: unknown }).templates : undefined);
        const templates = Array.isArray(list) ? list as Record<string, unknown>[] : [];
        for (const t of templates) if (typeof t.elementName === "string" && typeof t.languageCode === "string") out.set(key(t.elementName, t.languageCode), String(t.status ?? "UNKNOWN").toUpperCase());
        if (!app.appId || templates.length < PAGE) break; // the by-name list has one page
      }
      return out;
    },
    async create(app, form) {
      const r = await fetchImpl(`${root}/wa/app/${encodeURIComponent(app.appId)}/template`, { method: "POST", headers: { ...headers, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
      const body = await json(r);
      const failed = !r.ok || (body && typeof body === "object" && (body as { status?: unknown }).status === "error");
      return failed ? { ok: false, status: r.status, message: say(body, r.status) } : { ok: true };
    },
  };
}

export interface RunResult { lines: string[]; sent: number; refused: number; code: number }

/**
 * The whole run. With `submit` false nothing is sent: the lines say what would be. A 401 or 403 stops the run (the key or app is wrong, so every later call would fail the same way);
 * any other refusal is said and the run goes on, so one bad entry does not hide the rest. `pause` spaces the calls (Gupshup rate-limits with 429).
 */
export async function run(o: {
  entries: readonly Entry[]; app: App; api: Gupshup; mode: "dry-run" | "submit" | "status"; pause?: () => Promise<void>;
}): Promise<RunResult> {
  const lines: string[] = [];
  // before any call: a send needs the app's id, so say so at once rather than after reading the list
  if (o.mode === "submit" && !o.app.appId) throw new Error(`The app ${o.app.appName} has no app id in runtime.json, and Gupshup's create call needs it. Add "appId" under services.messaging (Gupshup shows it on the app's page).`);
  const listed = await o.api.listStates(o.app);
  if (o.mode === "status") {
    const counts = new Map<string, number>(); let missing = 0;
    for (const e of o.entries) { const s = listed.get(key(e.name, e.language)); if (s) counts.set(s, (counts.get(s) ?? 0) + 1); else { missing++; lines.push(`${e.name} (${e.language}): not submitted`); } }
    for (const e of o.entries) { const s = listed.get(key(e.name, e.language)); if (s) lines.push(`${e.name} (${e.language}): ${s.toLowerCase()}`); }
    lines.push(`Summary: ${[...counts].map(([s, n]) => `${n} ${s.toLowerCase()}`).join(", ") || "none submitted"}${missing ? `, ${missing} not submitted` : ""}.`);
    return { lines, sent: 0, refused: 0, code: 0 };
  }
  const p = plan(o.entries, listed);
  for (const u of p.unsendable) lines.push(`cannot send ${u.name} (${u.language}): ${u.reason}`);
  for (const h of p.have) lines.push(`skip ${h.entry.name} (${h.entry.language}): already ${h.state.toLowerCase()}${["REJECTED", "FAILED"].includes(h.state) ? " (needs a look in Gupshup before it is sent again)" : ""}`);
  let sent = 0, refused = 0;
  if (o.mode === "dry-run") {
    for (const s of p.send) lines.push(`would submit ${s.entry.name} (${s.entry.language}): ${JSON.stringify(s.form)}`);
    lines.push(`Dry run: nothing was sent. Would submit ${p.send.length}, skip ${p.have.length} already with Gupshup, ${p.unsendable.length} cannot be sent. Add --submit to send.`);
    return { lines, sent: 0, refused: 0, code: p.unsendable.length ? 1 : 0 };
  }
  const app = { ...o.app, appId: o.app.appId! };
  let stopped = false;
  for (const s of p.send) {
    const r = await o.api.create(app, s.form);
    if (r.ok) { sent++; lines.push(`submitted ${s.entry.name} (${s.entry.language})`); }
    else {
      refused++; lines.push(`refused ${s.entry.name} (${s.entry.language}): ${r.message}`);
      if (r.status === 401 || r.status === 403) { lines.push("Stopped: Gupshup does not accept this key for this app, so the rest would fail the same way."); stopped = true; break; }
    }
    await o.pause?.();
  }
  lines.push(`Submitted ${sent}, refused ${refused}${stopped ? " (stopped early)" : ""}, skipped ${p.have.length} already with Gupshup, ${p.unsendable.length} cannot be sent. Check the states with --status; Meta takes up to a day to approve.`);
  return { lines, sent, refused, code: refused || p.unsendable.length ? 1 : 0 };
}
