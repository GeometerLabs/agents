// The WhatsApp Cloud API's send call in front of createFakeMessaging(). Paths and bodies are the ones the live adapter speaks
// (see src/adapters/live/whatsapp.ts for the docs they come from).
//
// Like the real thing it has NO endpoint to read a sent message back. A template is accepted only if it is one of the approved templates
// (src/language/meta-templates.ts), in the language asked for, with the right number of parameters; its approved wording filled with the
// parameters is what lands in the outbox, which is what a customer would read.
import { ApiError, TimeoutError, WindowClosedError } from "../src/adapters/faults.ts";
import type { FakeMessaging } from "../src/adapters/messaging.ts";
import { interactiveProblem } from "../src/language/interactive.ts";
import type { Choice, InteractiveMessage } from "../src/language/interactive.ts";
import { META_LANGUAGE, META_TEMPLATES, fillBody, metaBody, slotsOf } from "../src/language/meta-templates.ts";
import { LANGUAGES } from "../src/settings.ts";
import type { Language } from "../src/settings.ts";
import { LostReply, ok } from "./http.ts";
import type { Handler, StandinReply } from "./http.ts";

const metaError = (status: number, code: number, message: string): StandinReply => ({
  status, body: { error: { message: `(#${code}) ${message}`, type: "OAuthException", code, error_data: { messaging_product: "whatsapp", details: message }, fbtrace_id: "standin" } },
});

function fromError(e: unknown): StandinReply {
  if (e instanceof TimeoutError) throw new LostReply();
  if (e instanceof WindowClosedError) return metaError(400, 131047, "More than 24 hours have passed since the recipient last replied to the sender number.");
  if (e instanceof ApiError) return metaError(e.status, e.status === 500 ? 131000 : 100, e.message);
  throw e;
}

/** Tell the fake which templates the provider has approved, in every language. */
export function approveTemplates(messaging: FakeMessaging): void {
  for (const t of META_TEMPLATES) for (const language of LANGUAGES) messaging.approve(t.name, language);
}

/**
 * `displayPhoneNumber` and `verifiedName` are what the read of the number's own details shows (GET /{version}/{phone-number-id}), which is how a
 * connection check confirms whose number an id is. Meta writes the number with spaces and dashes, so the default does too.
 */
/** Read Meta's interactive body into our message, or say what is wrong with it in Meta's way (131009: a parameter is not valid). */
function readInteractive(i: any): InteractiveMessage | string {
  if (typeof i !== "object" || i === null || typeof i.body?.text !== "string" || typeof i.action !== "object" || i.action === null) return "interactive needs a body and an action";
  const reply = (r: any): Choice | undefined => (typeof r?.id === "string" && typeof r?.title === "string" ? { id: r.id, title: r.title, ...(typeof r.description === "string" ? { description: r.description } : {}) } : undefined);
  if (i.type === "button") {
    const buttons = (Array.isArray(i.action.buttons) ? i.action.buttons : []).map((b: any) => (b?.type === "reply" ? reply(b.reply) : undefined));
    if (buttons.some((b: Choice | undefined) => b === undefined)) return "every button needs type reply and a reply with an id and a title";
    return { body: i.body.text, buttons };
  }
  if (i.type === "list") {
    const sections: any[] = Array.isArray(i.action.sections) ? i.action.sections : [];
    if (sections.length > 1 && sections.some((x) => typeof x?.title !== "string")) return "a message with more than one section needs a title on every section";
    const rows = sections.flatMap((x) => (Array.isArray(x?.rows) ? x.rows : [])).map(reply);
    if (rows.some((r) => r === undefined) || typeof i.action.button !== "string") return "a list needs a button label and rows with an id and a title";
    return { body: i.body.text, list: { button: i.action.button, rows: rows as Choice[] } };
  }
  return "interactive.type must be button or list";
}

export function whatsappStandin(messaging: FakeMessaging, options: { phoneNumberId?: string; displayPhoneNumber?: string; verifiedName?: string } = {}): Handler {
  const details = (id: string, fields: string | null) => {
    const all: Record<string, string> = {
      display_phone_number: options.displayPhoneNumber ?? "+1 555-000-0000", verified_name: options.verifiedName ?? "Stand-in shop",
      quality_rating: "GREEN", code_verification_status: "VERIFIED",
    };
    const wanted = fields ? fields.split(",").map((f) => f.trim()) : Object.keys(all); // like Meta: the fields asked for, and the id
    return { id, ...Object.fromEntries(Object.entries(all).filter(([k]) => wanted.includes(k))) };
  };
  return async ({ method, path, body, query }) => {
    const own = /^\/v\d+\.\d+\/([^/]+)$/u.exec(path); // read-only: the number's own details
    if (own) {
      const id = decodeURIComponent(own[1]);
      if (method !== "GET") return metaError(405, 100, "Unsupported request.");
      if (id !== (options.phoneNumberId ?? "100000000000001")) return metaError(400, 100, `Unsupported get request. Object with ID '${id}' does not exist, cannot be loaded due to missing permissions, or does not support this operation.`);
      return ok(details(id, query.get("fields")));
    }
    const m = /^\/v\d+\.\d+\/([^/]+)\/messages$/u.exec(path);
    if (!m) return undefined;
    if (method !== "POST") return metaError(405, 100, "Unsupported request.");
    if (options.phoneNumberId !== undefined && decodeURIComponent(m[1]) !== options.phoneNumberId) return metaError(400, 100, "Unsupported post request. Object with ID does not exist.");
    if (body?.messaging_product !== "whatsapp" || typeof body?.to !== "string") return metaError(400, 131008, "Required parameter is missing.");
    try {
      let id: string;
      if (body.type === "text" && typeof body.text?.body === "string") {
        id = (await messaging.sendText(body.to, body.text.body)).id;
      } else if (body.type === "interactive") {
        const message = readInteractive(body.interactive);
        const problem = typeof message === "string" ? message : interactiveProblem(message);
        if (problem !== null) return metaError(400, 131009, `Parameter value is not valid: ${problem}`);
        id = (await messaging.sendInteractive(body.to, message as InteractiveMessage)).id;
      } else if (body.type === "template" && typeof body.template?.name === "string") {
        const language = (Object.keys(META_LANGUAGE) as Language[]).find((l) => META_LANGUAGE[l] === body.template.language?.code);
        const template = META_TEMPLATES.find((t) => t.name === body.template.name);
        if (!template || !language) return metaError(404, 132001, "Template name does not exist in the translation.");
        const parameters: string[] = (body.template.components ?? []).filter((c: any) => c.type === "body").flatMap((c: any) => (c.parameters ?? []).map((p: any) => String(p.text)));
        if (parameters.length !== slotsOf(template.bodies[language]).length) return metaError(400, 132000, "Number of parameters does not match the expected number of params.");
        if (parameters.some((p) => /[\n\t]| {4}/u.test(p))) return metaError(400, 132018, "Template validation error: parameters may not hold new lines, tabs or four spaces in a row.");
        id = (await messaging.sendTemplate(body.to, { name: template.name, language, text: fillBody(metaBody(template.bodies[language]), parameters) })).id;
      } else {
        return metaError(400, 131009, "Parameter value is not valid.");
      }
      return ok({ messaging_product: "whatsapp", contacts: [{ input: body.to, wa_id: body.to.replace(/^\+/u, "") }], messages: [{ id }] });
    } catch (e) {
      return fromError(e);
    }
  };
}
