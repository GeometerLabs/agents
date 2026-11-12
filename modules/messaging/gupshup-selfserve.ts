// Messaging through Gupshup's SELF-SERVE API (item 11c, decision 42): the route for pilot shops, each of which is Gupshup's own customer with its own app and its
// own API key. Used by providers.ts when a shop's runtime.json says "provider": "gupshup-selfserve"; the Guard generator (bundle/generate/guards.ts) reads the host
// and the route shapes from here, so Guard and adapter cannot disagree. Item 11b's partner file (gupshup.ts) stays for a Gupshup partner's apps.
//
// Which Gupshup API, and why (read 12 Nov 2026 on docs.gupshup.io; the docs' own llms.txt index lists no Meta-format "v3" endpoint for self-serve apps, only
// "Send MM Lite Messages (v3)", so every message type is MAPPED to the self-serve API below):
//  - send:     POST https://api.gupshup.io/wa/api/v1/msg, form-urlencoded, header `apikey` (https://docs.gupshup.io/reference/session-text-message.md; the session
//              page https://docs.gupshup.io/docs/session-messages writes the header `api_key` once and `apikey` everywhere else: the reference pages' `apikey` is used).
//              Fields: channel=whatsapp, source (the app's number), destination (digits, no plus), src.name (the app name), message (a JSON string by type).
//              text {type:"text",text}; image {type:"image",originalUrl,previewUrl,caption} (.../post_wa-api-v1-msg-3.md); document {type:"file",url,filename,caption}
//              (.../post_wa-api-v1-msg-5.md); buttons {type:"quick_reply",content:{type:"text",text},options:[{title,postbackText}]} up to 3 (.../quick-replies.md);
//              list {type:"list",title,body,msgid,globalButtons:[{type:"text",title}],items:[{options:[{type:"text",title,description,postbackText}]}]} (.../post_wa-api-v1-msg-1.md).
//              Our button and row ids travel as `postbackText`, which Gupshup hands back on the tap.
//  - template: POST https://api.gupshup.io/wa/api/v1/template/msg, same header, fields source, destination, src.name, template={"id":<Gupshup template id>,"params":[...]}
//              (https://docs.gupshup.io/docs/template-messages.md). It names Gupshup's OWN template id, not Meta's name: see templateIds below.
//  - reply:    { status: "submitted", messageId } (2xx). The call "is processed asynchronously": it means GUPSHUP took the message. Meta's refusals (the closed
//              window, 131047) arrive later as a "failed" message-event (webhooks.ts), so "accepted" stays apart from "delivered".
//  - errors:   { status: "error", message }: 400 "Invalid Destination" / "Invalid App Details", 401 authentication failed, 429 too many requests.
//  - read:     GET https://api.gupshup.io/sm/api/v1/template/list/{appname}, header `apikey` (https://docs.gupshup.io/reference/getalltemplatesforanapp), or, when
//              runtime.json also gives the app's `appId`, the newer GET /wa/app/{app_id}/template (https://docs.gupshup.io/reference/get-all-templates-for-an-app.md; query
//              pageSize, templateStatus ...). The newer page shows { status: "success", templates: [{ id, elementName, languageCode, status, templateType, data, category }] };
//              the older page shows no response body at all, so the same shape is read from both and a real app must confirm the older one (Deferred.md).
//              The same read is the cheap Messaging.ping and the panel's connection check: it proves the key and the app name, never the number.
//
// The key: this file holds none and sends none. The base URL is a Guard in front of api.gupshup.io; Guard adds the `apikey` header from its own file
// ([upstream_headers]); `agentToken` is Guard's credential for this agent. Not touched against the real service.
import type { Clock } from "../core/clock.ts";
import { ApiError, WindowClosedError } from "../core/faults.ts";
import { HOUR } from "../core/time.ts";
import { asArray, createHttp, isObject, str } from "../core/http.ts";
import type { Http, HttpReply } from "../core/http.ts";
import { interactiveProblem, interactiveText } from "../language/interactive.ts";
import type { InteractiveMessage } from "../language/interactive.ts";
import { META_LANGUAGE } from "../language/meta-templates.ts";
import { documentProblem, imageProblem } from "./messaging.ts";
import type { DocumentMessage, ImageMessage, Messaging, OutboundMessage, TemplateMessage } from "./messaging.ts";
import { cleanParameter } from "./whatsapp.ts";
import type { WindowStore } from "./whatsapp.ts";

/** Gupshup's self-serve API host, as a Guard's upstream (host:port). */
export const GUPSHUP_SELFSERVE_UPSTREAM = "api.gupshup.io:443";

/** The header Gupshup reads the key from; Guard sends it, never the runtime. */
export const GUPSHUP_API_KEY_HEADER = "apikey";

/** The routes the shop's Guard lists. `{app_name}` / `{app_id}` are filled in by this adapter; the Guard's rules pin them to the shop's own app. */
export const GUPSHUP_SELFSERVE_ROUTES = {
  send: "/wa/api/v1/msg",
  template: "/wa/api/v1/template/msg",
  listByName: "/sm/api/v1/template/list/{app_name}",
  listById: "/wa/app/{app_id}/template",
} as const;

/** An app name as Gupshup allows one (letters, digits, underscore); anything that could change a path or a form is refused. */
export const GUPSHUP_APP_NAME = /^[A-Za-z0-9_]{2,64}$/u;
/** A Gupshup app id: a UUID as Gupshup shows it. */
export const GUPSHUP_SELFSERVE_APP_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/u;
/** The app's number, digits only with the country code (919876543210); a leading plus is allowed in runtime.json and dropped. */
export const GUPSHUP_SOURCE_NUMBER = /^\+?\d{6,15}$/u;

export interface GupshupSelfServeConfig {
  baseUrl: string;
  appName: string;
  sourceNumber: string;
  /** Optional: the app's id, for the newer template list. */
  appId?: string;
  timeoutMs?: number;
  /** Guard's credential for this agent (never a Gupshup key). */
  agentToken?: string;
}

/** The path of the template list for this app: by id when runtime.json gives one, else by name. */
export function templateListPath(appName: string, appId?: string): string {
  return appId ? GUPSHUP_SELFSERVE_ROUTES.listById.replace("{app_id}", encodeURIComponent(appId)) : GUPSHUP_SELFSERVE_ROUTES.listByName.replace("{app_name}", encodeURIComponent(appName));
}

/** Gupshup's refusal in plain words: its errors are { status: "error", message }. */
export function describeSelfServeError(reply: HttpReply): { message: string } {
  const message = isObject(reply.body) ? str(reply.body.message) : undefined;
  return { message: message ? `Gupshup: ${message}` : `Gupshup answered ${reply.status}.` };
}

// ---- the bodies (exported so the tests and the stand-in read the same thing) ---------------------------------------------------

/** The digits Gupshup wants for a number: no plus. */
const digits = (n: string): string => n.replace(/\D/gu, "");

/** The common form of every send; `message` is the JSON string for the type. */
function form(config: { appName: string; sourceNumber: string }, to: string, extra: Record<string, string>): Record<string, string> {
  return { channel: "whatsapp", source: digits(config.sourceNumber), destination: digits(to), "src.name": config.appName, ...extra };
}

export const textForm = (c: { appName: string; sourceNumber: string }, to: string, text: string) => form(c, to, { message: JSON.stringify({ type: "text", text }) });

export function documentForm(c: { appName: string; sourceNumber: string }, to: string, doc: DocumentMessage) {
  return form(c, to, { message: JSON.stringify({ type: "file", url: doc.link, filename: doc.filename, ...(doc.caption ? { caption: doc.caption } : {}) }) });
}

export function imageForm(c: { appName: string; sourceNumber: string }, to: string, image: ImageMessage) {
  return form(c, to, { message: JSON.stringify({ type: "image", originalUrl: image.link, previewUrl: image.link, ...(image.caption ? { caption: image.caption } : {}) }) });
}

/**
 * Buttons become a quick_reply, a list becomes a list message. The id we gave each option travels as `postbackText`, which Gupshup returns when it is tapped
 * (webhooks.ts reads it back). The list's required header (`title`) is the list's button label: our messages have no separate header, and Gupshup insists on one; every
 * row also needs a description, so a row without one repeats its title.
 */
export function interactiveForm(c: { appName: string; sourceNumber: string }, to: string, message: InteractiveMessage, msgid: string) {
  const payload = message.buttons
    ? { type: "quick_reply", msgid, content: { type: "text", text: message.body }, options: message.buttons.map((b) => ({ title: b.title, postbackText: b.id })) }
    : {
        type: "list", title: message.list!.button, body: message.body, msgid,
        globalButtons: [{ type: "text", title: message.list!.button }],
        items: [{ options: message.list!.rows.map((r) => ({ type: "text", title: r.title, description: r.description ?? r.title, postbackText: r.id })) }],
      };
  return form(c, to, { message: JSON.stringify(payload) });
}

export function templateForm(c: { appName: string; sourceNumber: string }, to: string, id: string, parameters: readonly string[]) {
  return form(c, to, { template: JSON.stringify({ id, params: parameters.map(cleanParameter) }) });
}

// ---- Gupshup's own template ids ------------------------------------------------------------------------------------------------

/** What the app's template list says about one template. */
interface ListedTemplate { id: string; status: string }

/** The templates in a list reply, keyed "<name>:<language code>". Language codes like "en_US" are kept as written; lookups match the code or its first part. */
export function readTemplateList(body: unknown): Map<string, ListedTemplate> {
  const out = new Map<string, ListedTemplate>();
  if (!isObject(body)) return out;
  for (const t of asArray(body.templates).filter(isObject)) {
    const id = str(t.id), name = str(t.elementName), language = str(t.languageCode), status = str(t.status);
    if (id && name && language) out.set(`${name}:${language}`, { id, status: (status ?? "UNKNOWN").toUpperCase() });
  }
  return out;
}

/** How long a refresh waits after the last one, so a name that is simply not there does not hit Gupshup (10 s) on every send. */
const REFRESH_GAP_MS = 30_000;
const KEPT_MESSAGES = 1000;

/** WhatsApp through Gupshup's self-serve API. */
export function createGupshupSelfServeMessaging(config: GupshupSelfServeConfig, deps: { clock: Clock; window: WindowStore }): Messaging {
  if (!GUPSHUP_APP_NAME.test(config.appName)) throw new Error("The Gupshup app name must be the app's name as Gupshup shows it (letters, digits and underscores).");
  if (!GUPSHUP_SOURCE_NUMBER.test(config.sourceNumber)) throw new Error("The Gupshup source number must be the app's WhatsApp number with its country code (digits only).");
  if (config.appId !== undefined && !GUPSHUP_SELFSERVE_APP_ID.test(config.appId)) throw new Error("The Gupshup app id must be the app's id as Gupshup shows it (letters, digits and hyphens).");
  const http: Http = createHttp(config.baseUrl, "Gupshup", config.timeoutMs, config.agentToken);
  const sent = new Map<string, OutboundMessage>();
  const listPath = templateListPath(config.appName, config.appId);
  let templates = new Map<string, ListedTemplate>();
  let refreshedAt: number | undefined;

  const windowOpen = (to: string) => {
    const last = deps.window.lastInboundAt(to);
    return last !== undefined && deps.clock.now() - last < 24 * HOUR;
  };

  /** The call and the reply's id. Gupshup answers 2xx "submitted" with messageId; anything else is a refusal. */
  async function post(path: string, fields: Record<string, string>, copy: Omit<OutboundMessage, "id" | "sentAt" | "afterOptOut" | "acceptedAs">): Promise<OutboundMessage> {
    const reply = await http.request("POST", path, { form: fields });
    if (reply.status < 200 || reply.status >= 300) throw new ApiError(reply.status, describeSelfServeError(reply).message);
    const b = isObject(reply.body) ? reply.body : {};
    if (b.status === "error") throw new ApiError(400, describeSelfServeError(reply).message);
    const id = str(b.messageId);
    if (!id) throw new ApiError(502, "Gupshup accepted the call but gave no message id.");
    // "submitted" is Gupshup having taken it; delivery arrives later as a message-event (webhooks.ts)
    const message: OutboundMessage = { ...copy, id, sentAt: deps.clock.now(), afterOptOut: false, acceptedAs: "accepted" };
    sent.set(id, message);
    if (sent.size > KEPT_MESSAGES) sent.delete(sent.keys().next().value as string);
    return { ...message };
  }

  /** Fetch the app's template list through the Guard and keep it. A refusal here is the shop's key or app being wrong, said in plain words. */
  async function refresh(): Promise<void> {
    const reply = await http.request("GET", listPath, config.appId ? { query: { pageSize: 100 } } : {});
    if (reply.status < 200 || reply.status >= 300) throw new ApiError(reply.status, `Could not read the templates of the Gupshup app ${config.appName}. ${describeSelfServeError(reply).message}`);
    templates = readTemplateList(reply.body);
    refreshedAt = deps.clock.now();
  }

  const find = (name: string, language: string): ListedTemplate | undefined =>
    templates.get(`${name}:${language}`) ?? [...templates].find(([k]) => k.startsWith(`${name}:${language}_`))?.[1];

  /** Gupshup's template id for one of our templates, from the cached list, refreshed when the name is unknown or not approved yet (at most every 30 seconds). */
  async function templateId(template: TemplateMessage): Promise<string> {
    const language = META_LANGUAGE[template.language];
    let found = find(template.name, language);
    if ((!found || found.status !== "APPROVED") && (refreshedAt === undefined || deps.clock.now() - refreshedAt >= REFRESH_GAP_MS)) {
      await refresh();
      found = find(template.name, language);
    }
    if (!found) throw new ApiError(400, `The template ${template.name} (${template.language}) is not in the Gupshup app ${config.appName}: it has to be added to the app and approved there before it can be sent.`);
    if (found.status !== "APPROVED") throw new ApiError(400, `The template ${template.name} (${template.language}) is not approved yet in the Gupshup app ${config.appName} (its status there is ${found.status.toLowerCase()}).`);
    return found.id;
  }

  let sequence = 0;
  /** A message id for list and button messages (Gupshup asks for one): unique within this process, plain characters only. */
  const msgid = () => `geo-${deps.clock.now().toString(36)}-${(sequence++).toString(36)}`;

  return {
    async sendText(to, text) {
      if (!windowOpen(to)) throw new WindowClosedError(); // Gupshup would take it and fail it later (131047); no need to ask
      return post(GUPSHUP_SELFSERVE_ROUTES.send, textForm(config, to, text), { to, kind: "text", text });
    },

    async sendInteractive(to, message) {
      if (!windowOpen(to)) throw new WindowClosedError();
      const problem = interactiveProblem(message);
      if (problem) throw new ApiError(400, `The message cannot be sent as buttons or a list: ${problem}.`);
      return post(GUPSHUP_SELFSERVE_ROUTES.send, interactiveForm(config, to, message, msgid()), { to, kind: "interactive", text: interactiveText(message), interactive: structuredClone(message) });
    },

    async sendDocument(to, doc) {
      if (!windowOpen(to)) throw new WindowClosedError();
      const problem = documentProblem(doc);
      if (problem) throw new ApiError(400, `The document cannot be sent: ${problem}.`);
      return post(GUPSHUP_SELFSERVE_ROUTES.send, documentForm(config, to, doc), { to, kind: "document", text: doc.caption ?? doc.filename, document: { ...doc } });
    },

    async sendImage(to, image) {
      if (!windowOpen(to)) throw new WindowClosedError();
      const problem = imageProblem(image);
      if (problem) throw new ApiError(400, `The image cannot be sent: ${problem}.`);
      return post(GUPSHUP_SELFSERVE_ROUTES.send, imageForm(config, to, image), { to, kind: "image", text: image.caption ?? "", image: { ...image } });
    },

    async sendTemplate(to, template) {
      const id = await templateId(template); // refused here, in plain words, when the app has not approved it: nothing is sent
      return post(GUPSHUP_SELFSERVE_ROUTES.template, templateForm(config, to, id, template.parameters ?? []), { to, kind: "template", text: template.text, templateName: template.name, language: template.language });
    },

    async isWindowOpen(to) { return windowOpen(to); },

    /** The template list is the cheap read: it proves the key and the app name. */
    async ping() { return http.request("GET", listPath, config.appId ? { query: { pageSize: 1 } } : {}); },

    async getMessage(id) {
      const m = sent.get(id);
      return m ? { ...m } : null;
    },
  };
}
