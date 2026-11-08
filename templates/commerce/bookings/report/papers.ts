// What Bookings hands the shared papers (modules/papers): its money actions, the words for its own actions, a booking as a case, and its limits as facts a
// change can be read against (B28 statement, B35 record of one case, B36 identity paper). Hindi, Malayalam and Kannada words here are machine-written and
// wait for native review, like modules/papers/words.ts.
import { formatDate, formatInr, formatTime } from "../../../../modules/language/format.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { localParts } from "../../../../modules/core/time.ts";
import type { PaperCase, TemplatePapers } from "../../../../modules/papers/common.ts";
import type { LimitFact } from "../../../../modules/papers/identity.ts";
import type { Booking } from "../src/booking.ts";
import { serviceName } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { limitLines } from "./certificate.ts";
import type { GoLiveCertificate } from "./certificate.ts";
import { PATHWAY } from "./data.ts";
import { STRINGS } from "./strings.ts";

export const BOOKINGS_PAPERS: TemplatePapers = {
  pathway: PATHWAY,
  paidActions: ["record_deposit"],
  refundActions: ["refund"],
  actionWords: {
    en: { hold_slot: "time held on the calendar", create_deposit_link: "deposit link made", record_deposit: "deposit recorded", confirm_booking: "booking put on the calendar", cancel_booking: "booking cancelled",
      reschedule_booking: "booking moved", release_slot: "held time let go", cancel_deposit_link: "deposit link closed", complete_booking: "booking done", upi_deposit_part: "part of the deposit marked", upi_owner_reply: "owner's reply about UPI" },
    hi: { hold_slot: "कैलेंडर पर समय रोका", create_deposit_link: "जमा राशि का लिंक बनाया", record_deposit: "जमा राशि दर्ज की", confirm_booking: "बुकिंग कैलेंडर पर डाली", cancel_booking: "बुकिंग रद्द की",
      reschedule_booking: "बुकिंग का समय बदला", release_slot: "रोका हुआ समय छोड़ा", cancel_deposit_link: "जमा राशि का लिंक बंद किया", complete_booking: "बुकिंग पूरी हुई", upi_deposit_part: "जमा राशि का कुछ हिस्सा लिखा", upi_owner_reply: "UPI पर मालिक का जवाब" },
    ml: { hold_slot: "കലണ്ടറിൽ സമയം പിടിച്ചുവെച്ചു", create_deposit_link: "അഡ്വാൻസ് ലിങ്ക് ഉണ്ടാക്കി", record_deposit: "അഡ്വാൻസ് രേഖപ്പെടുത്തി", confirm_booking: "ബുക്കിംഗ് കലണ്ടറിൽ ഇട്ടു", cancel_booking: "ബുക്കിംഗ് റദ്ദാക്കി",
      reschedule_booking: "ബുക്കിംഗ് സമയം മാറ്റി", release_slot: "പിടിച്ചുവെച്ച സമയം വിട്ടു", cancel_deposit_link: "അഡ്വാൻസ് ലിങ്ക് അടച്ചു", complete_booking: "ബുക്കിംഗ് കഴിഞ്ഞു", upi_deposit_part: "അഡ്വാൻസിന്റെ ഒരു ഭാഗം രേഖപ്പെടുത്തി", upi_owner_reply: "UPI-യെക്കുറിച്ച് ഉടമയുടെ മറുപടി" },
    kn: { hold_slot: "ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಸಮಯ ಹಿಡಿದಿಟ್ಟಿತು", create_deposit_link: "ಮುಂಗಡ ಹಣದ ಲಿಂಕ್ ಮಾಡಿತು", record_deposit: "ಮುಂಗಡ ಹಣ ದಾಖಲಿಸಿತು", confirm_booking: "ಬುಕಿಂಗ್ ಕ್ಯಾಲೆಂಡರ್‌ಗೆ ಹಾಕಿತು", cancel_booking: "ಬುಕಿಂಗ್ ರದ್ದು ಮಾಡಿತು",
      reschedule_booking: "ಬುಕಿಂಗ್ ಸಮಯ ಬದಲಿಸಿತು", release_slot: "ಹಿಡಿದ ಸಮಯ ಬಿಟ್ಟಿತು", cancel_deposit_link: "ಮುಂಗಡ ಹಣದ ಲಿಂಕ್ ಮುಚ್ಚಿತು", complete_booking: "ಬುಕಿಂಗ್ ಮುಗಿಯಿತು", upi_deposit_part: "ಮುಂಗಡ ಹಣದ ಒಂದು ಭಾಗ ಗುರುತಿಸಿತು", upi_owner_reply: "UPI ಬಗ್ಗೆ ಮಾಲೀಕರ ಉತ್ತರ" },
  },
};

/** A booking as the papers need it: the service and the time in a language, never the customer's name (the record has none). */
export function bookingCase(b: Booking, settings: Settings): PaperCase {
  return {
    id: b.id, customer: b.customer, language: b.language, state: b.state,
    label: (language) => {
      const service = settings.services.find((s) => s.id === b.serviceId);
      const parts = [service ? serviceName(service, language) : b.id];
      if (b.startMs !== undefined) {
        const p = localParts(b.startMs, settings.timezone);
        parts.push(`${formatDate({ year: p.year, month: p.month, day: p.day }, language)} ${p.year}, ${formatTime({ hour: p.hour, minute: p.minute }, language)}`);
      }
      return parts.join(", ");
    },
  };
}

const LIMIT_LABELS: Record<Language, { refund: string; window: string; hours: (n: number) => string }> = {
  en: { refund: "the refund the agent may give alone", window: "the hours before a booking a cancellation is refunded", hours: (n) => `${n} hours` },
  hi: { refund: "एजेंट अकेले जितना रिफ़ंड दे सकता है", window: "बुकिंग से कितने घंटे पहले रद्द करने पर रिफ़ंड", hours: (n) => `${n} घंटे` },
  ml: { refund: "ഏജന്റിന് തനിയെ നൽകാവുന്ന റീഫണ്ട്", window: "ബുക്കിംഗിന് എത്ര മണിക്കൂർ മുമ്പ് റദ്ദാക്കിയാൽ റീഫണ്ട്", hours: (n) => `${n} മണിക്കൂർ` },
  kn: { refund: "ಏಜೆಂಟ್ ತಾನೇ ಕೊಡಬಹುದಾದ ವಾಪಸ್ ಹಣ", window: "ಬುಕಿಂಗ್‌ಗೆ ಎಷ್ಟು ಗಂಟೆ ಮೊದಲು ರದ್ದು ಮಾಡಿದರೆ ವಾಪಸ್", hours: (n) => `${n} ಗಂಟೆ` },
};

/** The limits a change is read against: a higher refund limit is wider; a shorter cancellation window is wider (more cancellations are refunded). Old or partial settings give fewer facts, never wrong ones. */
export function limitFacts(settings: unknown, language: Language): LimitFact[] {
  const c = (settings as Partial<Settings> | null)?.cancellation;
  const l = LIMIT_LABELS[language];
  const facts: LimitFact[] = [];
  if (Number.isFinite(c?.refundLimitInr)) facts.push({ key: "refund-limit", label: l.refund, value: c!.refundLimitInr, wider: "higher", show: formatInr(c!.refundLimitInr) });
  if (Number.isFinite(c?.windowHours)) facts.push({ key: "cancel-window", label: l.window, value: c!.windowHours, wider: "lower", show: l.hours(c!.windowHours) });
  return facts;
}

/** The identity paper's limits and checks from the shop's go-live certificate: the same phrases and counts the certificate itself prints. */
export function fromGoLive(cert: GoLiveCertificate, language: Language): { limits: string[]; checks: { held: number; total: number; on: GoLiveCertificate["issuedOn"]; notTested: string[] } } {
  return { limits: limitLines(cert, language), checks: { held: cert.checks.held, total: cert.checks.total, on: cert.issuedOn, notTested: cert.notTested.map((k) => STRINGS[language].notTested[k] ?? k) } };
}
