// The owner's licence notice for an Orders shop (plan B13): what modules/licence/notice.ts sends, once for each `paid_through`, in the owner's language. The wind-down's
// says online ordering is paused and who to contact; the final stop's says the partner's service has ended, how many orders are still to come, and that
// hello@geometer.dev will connect the owner with another local partner. It never mentions a copy or export of the records (that goes only to the builder or partner).
import { createLicenceNotice } from "../../../../modules/licence/notice.ts";
import type { LicenceNow } from "../../../../modules/licence/rules.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { factsFor } from "../src/order.ts";
import type { Store } from "../src/order.ts";
import { templateMessage } from "../src/language/meta-templates.ts";
import { TEMPLATE_NAMES, render } from "../src/language/templates.ts";
import type { Settings } from "../src/settings.ts";

/** Who to contact when the bundle could not say (it always names the partner who set the shop up; this is only for a runtime started by hand). */
export const WHO_SET_IT_UP: Record<Language, string> = { en: "the person who set it up", hi: "इसे सेट करने वाले व्यक्ति", ml: "ഇത് ക്രമീകരിച്ച വ്യക്തിയെ", kn: "ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರನ್ನು" };

export function createOrdersLicenceNotice(settings: Settings, licence: () => LicenceNow) {
  return createLicenceNotice<Store>({
    licence,
    message(kind, a) {
      const language = settings.owner.language;
      const id = kind === "stop" ? "owner_licence_stopped" : "owner_licence_paused";
      const upcoming = [...a.store.orders.values()].filter((o) => o.state === "confirmed").length;
      const facts = { ...factsFor(settings, null, language), partner: a.licence.partner || WHO_SET_IT_UP[language], upcomingCount: upcoming };
      const text = render(id, facts);
      return { text, template: templateMessage({ ids: [id], language, facts, text, generic: TEMPLATE_NAMES.owner }) };
    },
  });
}
