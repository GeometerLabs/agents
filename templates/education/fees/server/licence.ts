// The owner's licence notice for a Fees centre (plan B13): what modules/licence/notice.ts sends, once for each `paid_through`, in the owner's language. The wind-down's
// says online fee payment is paused and who to contact; the final stop's says nothing is deleted, how many fees are still open and how much other work is open (the
// unfinished-work list, modules/unfinished, read from this centre's own record and fees), and until when the partner can hand over the free copy of the records.
import { createLicenceNotice } from "../../../../modules/licence/notice.ts";
import type { LicenceNow } from "../../../../modules/licence/rules.ts";
import { DEFAULT_OPTIONS, obligations } from "../../../../modules/unfinished/index.ts";
import type { CaseLike } from "../../../../modules/unfinished/index.ts";
import { DAY } from "../../../../modules/core/time.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { factsFor } from "../src/due.ts";
import type { Store } from "../src/due.ts";
import { templateMessage } from "../src/language/meta-templates.ts";
import { TEMPLATE_NAMES, render } from "../src/language/templates.ts";
import type { Settings } from "../src/settings.ts";

/** Who to contact when the bundle could not say (it always names the partner who set the centre up; this is only for a runtime started by hand). */
export const WHO_SET_IT_UP: Record<Language, string> = { en: "the person who set it up", hi: "इसे सेट करने वाले व्यक्ति", ml: "ഇത് ക്രമീകരിച്ച വ്യക്തിയെ", kn: "ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರನ್ನು" };
const EXPORT_DAYS = 90;

export function createFeesLicenceNotice(settings: Settings, licence: () => LicenceNow) {
  return createLicenceNotice<Store>({
    licence,
    message(kind, a) {
      const language = settings.owner.language;
      const id = kind === "stop" ? "owner_licence_stopped" : "owner_licence_paused";
      const openFees = [...a.store.dues.values()].filter((d) => d.state === "open").length;
      const open = obligations.detect({ template: "fees", entries: a.record.entries(), cases: [...a.store.dues.values()] as unknown as CaseLike[], nowMs: a.now, options: DEFAULT_OPTIONS }).found.length;
      const facts = { ...factsFor(settings, null, language), partner: a.licence.partner || WHO_SET_IT_UP[language], openFeesCount: openFees, openCount: open, licenceDateMs: (a.licence.exportUntil ?? Math.floor(a.now / 1000) + EXPORT_DAYS * DAY / 1000) * 1000 };
      const text = render(id, facts);
      return { text, template: templateMessage({ ids: [id], language, facts, text, generic: TEMPLATE_NAMES.owner }) };
    },
  });
}
