// What Orders hands the shared papers (modules/papers): its money actions, the words for its own actions, an order as a case, and its limits as facts a change can
// be read against (B28 statement, B35 record of one case, B36 identity paper). Hindi, Malayalam and Kannada words here are machine-written and wait for
// native review, like modules/papers/words.ts. An order's label never names the customer: the record's export hashes the number, and a paper must not carry it.
import { formatDate, formatInr, formatTime } from "../../../../modules/language/format.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { localParts } from "../../../../modules/core/time.ts";
import type { PaperCase, TemplatePapers } from "../../../../modules/papers/common.ts";
import type { LimitFact } from "../../../../modules/papers/identity.ts";
import type { Order } from "../src/order.ts";
import { itemsText } from "../src/order.ts";
import type { Settings } from "../src/settings.ts";
import { limitLines } from "./certificate.ts";
import type { GoLiveCertificate } from "./certificate.ts";
import { PATHWAY } from "./data.ts";
import { STRINGS } from "./strings.ts";

export const ORDERS_PAPERS: TemplatePapers = {
  pathway: PATHWAY,
  paidActions: ["record_payment"],
  refundActions: ["refund"],
  actionWords: {
    en: { check_order: "stock, day and cut-off checked", check_address: "delivery address checked", hold_stock: "stock held for the order", release_stock: "held stock let go", create_advance_link: "advance link made", cancel_advance_link: "advance link closed",
      confirm_order: "order confirmed", cancel_order: "order cancelled", complete_order: "order completed", upi_advance_part: "part of the advance marked", upi_owner_reply: "owner's reply about UPI" },
    hi: { check_order: "स्टॉक, दिन और कट-ऑफ़ जाँचा", check_address: "डिलीवरी का पता जाँचा", hold_stock: "ऑर्डर के लिए स्टॉक रोका", release_stock: "रोका हुआ स्टॉक छोड़ा", create_advance_link: "एडवांस का लिंक बनाया", cancel_advance_link: "एडवांस का लिंक बंद किया",
      confirm_order: "ऑर्डर पक्का किया", cancel_order: "ऑर्डर रद्द किया", complete_order: "ऑर्डर पूरा हुआ", upi_advance_part: "एडवांस का कुछ हिस्सा लिखा", upi_owner_reply: "UPI पर मालिक का जवाब" },
    ml: { check_order: "സ്റ്റോക്കും ദിവസവും കട്ട്-ഓഫും പരിശോധിച്ചു", check_address: "ഡെലിവറി വിലാസം പരിശോധിച്ചു", hold_stock: "ഓർഡറിന് സ്റ്റോക്ക് പിടിച്ചുവെച്ചു", release_stock: "പിടിച്ചുവെച്ച സ്റ്റോക്ക് വിട്ടു", create_advance_link: "അഡ്വാൻസ് ലിങ്ക് ഉണ്ടാക്കി", cancel_advance_link: "അഡ്വാൻസ് ലിങ്ക് അടച്ചു",
      confirm_order: "ഓർഡർ ഉറപ്പിച്ചു", cancel_order: "ഓർഡർ റദ്ദാക്കി", complete_order: "ഓർഡർ പൂർത്തിയായി", upi_advance_part: "അഡ്വാൻസിന്റെ ഒരു ഭാഗം രേഖപ്പെടുത്തി", upi_owner_reply: "UPI-യെക്കുറിച്ച് ഉടമയുടെ മറുപടി" },
    kn: { check_order: "ಸ್ಟಾಕ್, ದಿನ ಮತ್ತು ಕಟ್-ಆಫ್ ಪರಿಶೀಲಿಸಿತು", check_address: "ಡೆಲಿವರಿ ವಿಳಾಸ ಪರಿಶೀಲಿಸಿತು", hold_stock: "ಆರ್ಡರ್‌ಗೆ ಸ್ಟಾಕ್ ಹಿಡಿದಿಟ್ಟಿತು", release_stock: "ಹಿಡಿದ ಸ್ಟಾಕ್ ಬಿಟ್ಟಿತು", create_advance_link: "ಮುಂಗಡದ ಲಿಂಕ್ ಮಾಡಿತು", cancel_advance_link: "ಮುಂಗಡದ ಲಿಂಕ್ ಮುಚ್ಚಿತು",
      confirm_order: "ಆರ್ಡರ್ ಖಚಿತಪಡಿಸಿತು", cancel_order: "ಆರ್ಡರ್ ರದ್ದು ಮಾಡಿತು", complete_order: "ಆರ್ಡರ್ ಮುಗಿಯಿತು", upi_advance_part: "ಮುಂಗಡದ ಒಂದು ಭಾಗ ಗುರುತಿಸಿತು", upi_owner_reply: "UPI ಬಗ್ಗೆ ಮಾಲೀಕರ ಉತ್ತರ" },
  },
};

/** An order as the papers need it: what was ordered and when, in a language, never the customer's name or number. What is left to pay is not tracked here (it is paid at pickup). */
export function orderCase(order: Order, settings: Settings): PaperCase {
  return {
    id: order.id, customer: order.customer, language: order.language, state: order.state,
    label: (language) => {
      const parts: string[] = [];
      if (order.lines.length > 0 && order.lines.every((l) => settings.menu.some((i) => i.id === l.itemId))) parts.push(itemsText(settings, order.lines, language));
      if (order.slotStartMs !== undefined) {
        const p = localParts(order.slotStartMs, settings.timezone);
        parts.push(`${formatDate({ year: p.year, month: p.month, day: p.day }, language)} ${p.year}, ${formatTime({ hour: p.hour, minute: p.minute }, language)}`);
      }
      return parts.length > 0 ? parts.join(", ") : order.id;
    },
  };
}

const LIMIT_LABELS: Record<Language, { refund: string; window: string; approve: string; perDay: string; never: string; hours: (n: number) => string }> = {
  en: { refund: "the refund the agent may give alone", window: "the hours before a slot a cancellation is refunded", approve: "the order size that waits for the owner", perDay: "the most orders taken for one day", never: "never asked", hours: (n) => `${n} hours` },
  hi: { refund: "एजेंट अकेले जितना रिफ़ंड दे सकता है", window: "स्लॉट से कितने घंटे पहले रद्द करने पर रिफ़ंड", approve: "कितने बड़े ऑर्डर के लिए मालिक की मंज़ूरी चाहिए", perDay: "एक दिन के लिए ज़्यादा से ज़्यादा ऑर्डर", never: "कभी नहीं पूछा जाता", hours: (n) => `${n} घंटे` },
  ml: { refund: "ഏജന്റിന് തനിയെ നൽകാവുന്ന റീഫണ്ട്", window: "സ്ലോട്ടിന് എത്ര മണിക്കൂർ മുമ്പ് റദ്ദാക്കിയാൽ റീഫണ്ട്", approve: "ഉടമയുടെ അനുമതി വേണ്ട ഓർഡർ വലുപ്പം", perDay: "ഒരു ദിവസത്തേക്ക് എടുക്കുന്ന പരമാവധി ഓർഡറുകൾ", never: "ഒരിക്കലും ചോദിക്കില്ല", hours: (n) => `${n} മണിക്കൂർ` },
  kn: { refund: "ಏಜೆಂಟ್ ತಾನೇ ಕೊಡಬಹುದಾದ ವಾಪಸ್ ಹಣ", window: "ಸ್ಲಾಟ್‌ಗೆ ಎಷ್ಟು ಗಂಟೆ ಮೊದಲು ರದ್ದು ಮಾಡಿದರೆ ವಾಪಸ್", approve: "ಮಾಲೀಕರ ಒಪ್ಪಿಗೆ ಬೇಕಾದ ಆರ್ಡರ್ ಗಾತ್ರ", perDay: "ಒಂದು ದಿನಕ್ಕೆ ತೆಗೆದುಕೊಳ್ಳುವ ಗರಿಷ್ಠ ಆರ್ಡರ್‌ಗಳು", never: "ಎಂದೂ ಕೇಳುವುದಿಲ್ಲ", hours: (n) => `${n} ಗಂಟೆ` },
};

/**
 * The limits a change is read against: a higher refund limit is wider; a shorter cancellation window is wider (more cancellations are refunded); a higher approval line is
 * wider (fewer orders wait for the owner); more orders a day is wider. Old or partial settings give fewer facts, never wrong ones.
 */
export function limitFacts(settings: unknown, language: Language): LimitFact[] {
  const s = settings as Partial<Settings> | null;
  const l = LIMIT_LABELS[language];
  const facts: LimitFact[] = [];
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (num(s?.refund?.limitInr)) facts.push({ key: "refund-limit", label: l.refund, value: s.refund.limitInr, wider: "higher", show: formatInr(s.refund.limitInr) });
  if (num(s?.cancellation?.windowHours)) facts.push({ key: "cancel-window", label: l.window, value: s.cancellation.windowHours, wider: "lower", show: l.hours(s.cancellation.windowHours) });
  // an approval line of 0 means the owner is never asked about size: the widest there is, so it is a very large number that shows as "never asked"
  if (num(s?.owner?.approveOverInr)) facts.push({ key: "approve-over", label: l.approve, value: s.owner.approveOverInr > 0 ? s.owner.approveOverInr : 1e9, wider: "higher", show: s.owner.approveOverInr > 0 ? formatInr(s.owner.approveOverInr) : l.never });
  if (num(s?.orders?.maxPerDay)) facts.push({ key: "max-per-day", label: l.perDay, value: s.orders.maxPerDay, wider: "higher", show: String(s.orders.maxPerDay) });
  return facts;
}

/** The identity paper's limits and checks from the shop's go-live certificate: the same phrases and counts the certificate itself prints. */
export function fromGoLive(cert: GoLiveCertificate, language: Language): { limits: string[]; checks: { held: number; total: number; on: GoLiveCertificate["issuedOn"]; notTested: string[] } } {
  return { limits: limitLines(cert, language), checks: { held: cert.checks.held, total: cert.checks.total, on: cert.issuedOn, notTested: cert.notTested.map((k) => STRINGS[language].notTested[k] ?? k) } };
}
