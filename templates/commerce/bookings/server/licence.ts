// The owner's licence notice for a Bookings shop (plan B13): what modules/licence/notice.ts sends, once for each `paid_through`, in the owner's language. The wind-down's
// says online booking is paused and who to contact; the final stop's says nothing is deleted, how many bookings are still to come and how much other work is open (the
// unfinished-work list, modules/unfinished, read from this shop's own record and bookings), and until when the partner can hand over the free copy of the records.
import { createLicenceNotice } from "../../../../modules/licence/notice.ts";
import type { LicenceNow } from "../../../../modules/licence/rules.ts";
import { DEFAULT_OPTIONS, obligations } from "../../../../modules/unfinished/index.ts";
import type { CaseLike } from "../../../../modules/unfinished/index.ts";
import { DAY } from "../../../../modules/core/time.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { factsFor } from "../src/booking.ts";
import type { Store } from "../src/booking.ts";
import { templateMessage } from "../src/language/meta-templates.ts";
import { TEMPLATE_NAMES, render } from "../src/language/templates.ts";
import type { Settings } from "../src/settings.ts";

/** Who to contact when the bundle could not say (it always names the partner who set the shop up; this is only for a runtime started by hand). */
export const WHO_SET_IT_UP: Record<Language, string> = { en: "the person who set it up", hi: "इसे सेट करने वाले व्यक्ति", ml: "ഇത് ക്രമീകരിച്ച വ്യക്തിയെ", kn: "ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರನ್ನು" };
/** The free export lasts 90 days after the final stop (fleet's EXPORT_DAYS); a lease always says until when, and this is only if it did not. */
const EXPORT_DAYS = 90;

export function createBookingsLicenceNotice(settings: Settings, licence: () => LicenceNow) {
  return createLicenceNotice<Store>({
    licence,
    message(kind, a) {
      const language = settings.owner.language;
      const id = kind === "stop" ? "owner_licence_stopped" : "owner_licence_paused";
      const upcoming = [...a.store.bookings.values()].filter((b) => b.state === "confirmed" && b.startMs !== undefined && b.startMs > a.now).length;
      const open = obligations.detect({ template: "bookings", entries: a.record.entries(), cases: [...a.store.bookings.values()] as unknown as CaseLike[], nowMs: a.now, options: DEFAULT_OPTIONS }).found.length;
      const facts = { ...factsFor(settings, null, language), partner: a.licence.partner || WHO_SET_IT_UP[language], upcomingCount: upcoming, openCount: open, licenceDateMs: (a.licence.exportUntil ?? Math.floor(a.now / 1000) + EXPORT_DAYS * DAY / 1000) * 1000 };
      const text = render(id, facts);
      return { text, template: templateMessage({ ids: [id], language, facts, text, generic: TEMPLATE_NAMES.owner }) };
    },
  });
}
