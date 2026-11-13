// The WhatsApp templates in the form Meta approves them: fixed wording, with numbered {{1}}, {{2}} ... for values that come from the record.
//
// Why these exist: outside the customer's 24-hour window WhatsApp only carries a pre-approved template. Meta will not approve a template
// that is only a variable, and a parameter cannot hold line breaks, so "the whole rendered text" cannot be one parameter. Each template
// below has the wording of ONE message (the one in language/templates.ts that its `usedFor` names), with the record's values as parameters.
// The wording is the same in both places, so what the customer receives is what the outgoing check read; a test and a runtime guard
// (templateMessage below) both insist on it. A message with no template here (or one made of several templates) still goes out as free text
// inside the window, and outside it is refused by the provider, which fails closed. Which messages still need a template: Deferred.md.
//
// Rules kept (Meta's template overview, https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview):
// lowercase names with underscores, one language per submission, an example value for every parameter. Also kept, from Meta's template
// review: a body neither starts nor ends with a parameter. Every body below starts and ends with fixed words.
//
// Hindi, Malayalam and Kannada wording is machine-written like the rest of those packs. A native speaker must read it before it is submitted.
//
// This file is the mechanism, for every template: the shape of a template, the {slot} to {{n}} conversion, and `createMetaCatalogue`, which a template calls
// with its own list of templates and its own record values. What the templates SAY is each template's (Bookings: templates/commerce/bookings/src/language/meta-templates.ts).
import type { TemplateMessage } from "../messaging/messaging.ts";
import { LANGUAGES } from "./languages.ts";
import type { Language } from "./languages.ts";

/** Our languages as Meta's template language codes. */
export const META_LANGUAGE: Record<Language, string> = { en: "en", hi: "hi", ml: "ml", kn: "kn" };

export interface MetaTemplate<Id extends string = string> {
  /** The name registered with Meta (lowercase, underscores). */
  name: string;
  /** The message in the template's own text whose wording this carries. */
  usedFor: Id;
  audience: "customer" | "owner";
  /** The wording per language, with {slot} where a record value goes. Turned into {{n}} for Meta. */
  bodies: Record<Language, string>;
  /**
   * Item 11i: an image header (Meta's media header, format IMAGE). Sent with the picture's https address as the header's one parameter (TemplateMessage.headerImage);
   * submitted with an example picture uploaded through Meta's Resumable Upload API, whose handle goes in `example.header_handle` (HEADER_HANDLE_TO_UPLOAD below).
   * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-media/ and .../templates/components (read 14 Nov 2026).
   */
  header?: "image";
}

/** Where the submission's example header handle goes: Meta's Resumable Upload API gives it for the example picture at submission time (item 12), never ahead of it. */
export const HEADER_HANDLE_TO_UPLOAD = "<the handle Meta's Resumable Upload API gives for the example picture>";

const SLOT_RE = /\{([A-Za-z]+)\}/gu;

/** The body as Meta wants it: {slot} turned into {{1}}, {{2}} ... in order. */
export function metaBody(body: string): string {
  let n = 0;
  return body.replace(SLOT_RE, () => `{{${++n}}}`);
}

/** Fill a Meta body ({{1}} ...) with parameters: what the customer will read. */
export function fillBody(metaText: string, parameters: string[]): string {
  return metaText.replace(/\{\{(\d+)\}\}/gu, (_m, n: string) => parameters[Number(n) - 1] ?? "");
}

export interface MetaSubmission {
  name: string; language: string; category: "UTILITY"; parameter_format: "positional";
  components: ({ type: "HEADER"; format: "IMAGE"; example: { header_handle: string[] } } | { type: "BODY"; text: string; example: { body_text: string[][] } })[];
}

/** A template's list of templates, with the record values they use. `Facts` is what the template's messages are written from. */
export function createMetaCatalogue<Facts extends { language: Language }, Id extends string, Slot extends string>(a: {
  templates: readonly MetaTemplate<Id>[];
  /** For each {slot} a body may use: where its value comes from in the record. */
  values: Record<Slot, (f: Facts) => string>;
}) {
  const byMessage = new Map<Id, MetaTemplate<Id>>(a.templates.map((t) => [t.usedFor, t]));

  /** The slots of a body in the order they appear. The same value twice is two parameters, because a Meta parameter number is used once. */
  function slotsOf(body: string): Slot[] {
    return [...body.matchAll(SLOT_RE)].map((m) => {
      if (!(m[1] in a.values)) throw new Error(`The template body has an unknown value {${m[1]}}.`);
      return m[1] as Slot;
    });
  }

  /** The parameter values for a template in a language, read from the record's facts. Throws if the record lacks one. */
  function parametersFor(template: MetaTemplate<Id>, language: Language, facts: Facts): string[] {
    return slotsOf(template.bodies[language]).map((s) => a.values[s](facts));
  }

  /**
   * The template message for text that must go out as a template. A message that is exactly one of the templates goes as that template with its
   * parameters, but only if filling it gives back the very text the outgoing check read. Anything else goes as the generic name with no parameters
   * (a provider that knows only the real templates then refuses it).
   */
  function templateMessage(m: { ids: Id[]; language: Language; facts: Facts; text: string; generic: string }): TemplateMessage {
    const found = m.ids.length === 1 ? byMessage.get(m.ids[0]) : undefined;
    if (found) {
      try {
        const parameters = parametersFor(found, m.language, m.facts);
        if (fillBody(metaBody(found.bodies[m.language]), parameters) === m.text) return { name: found.name, language: m.language, text: m.text, parameters };
      } catch { /* the record lacks a value: the message would not have been written either */ }
    }
    return { name: m.generic, language: m.language, text: m.text };
  }

  /** One entry per template and language, in the body Meta's create-template call takes (POST /{waba-id}/message_templates). */
  function submissions(example: (language: Language) => Facts): MetaSubmission[] {
    return a.templates.flatMap((t) => LANGUAGES.map((language) => ({
      name: t.name, language: META_LANGUAGE[language], category: "UTILITY" as const, parameter_format: "positional" as const,
      components: [
        ...(t.header === "image" ? [{ type: "HEADER" as const, format: "IMAGE" as const, example: { header_handle: [HEADER_HANDLE_TO_UPLOAD] } }] : []),
        { type: "BODY" as const, text: metaBody(t.bodies[language]), example: { body_text: [parametersFor(t, language, example(language))] } },
      ],
    })));
  }

  return { templates: a.templates, names: a.templates.map((t) => t.name), slotsOf, parametersFor, templateMessage, submissions };
}
