// What Fees hands the shared papers (modules/papers): its money actions, the words for its own actions, a fee as a case, and its limits as facts a change can
// be read against (B28 statement, B35 record of one case, B36 identity paper). Hindi, Malayalam and Kannada words here are machine-written and wait for
// native review, like modules/papers/words.ts. A fee's label never names the student: the record's export hashes the name, and a paper must not carry it.
import { MONTH_NAMES, formatInr } from "../../../../modules/language/format.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { PaperCase, TemplatePapers } from "../../../../modules/papers/common.ts";
import type { LimitFact } from "../../../../modules/papers/identity.ts";
import { owedPaise, paidPaise } from "../src/due.ts";
import type { Due } from "../src/due.ts";
import { batchName } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { limitLines } from "./certificate.ts";
import type { GoLiveCertificate } from "./certificate.ts";
import { PATHWAY } from "./data.ts";
import { STRINGS } from "./strings.ts";

export const FEES_PAPERS: TemplatePapers = {
  pathway: PATHWAY,
  paidActions: ["record_payment"],
  refundActions: ["refund"],
  actionWords: {
    en: { open_fee: "fee opened for the month", create_fee_link: "payment link made", record_payment: "payment recorded", cancel_fee_link: "old payment link closed", add_late_fee: "late fee added",
      waive_fee: "fee waived", settle_fee: "fee settled", waiver_request: "waiver asked for", upi_owner_reply: "owner's reply about UPI" },
    hi: { open_fee: "महीने की फ़ीस खोली", create_fee_link: "भुगतान का लिंक बनाया", record_payment: "भुगतान दर्ज किया", cancel_fee_link: "पुराना भुगतान लिंक बंद किया", add_late_fee: "देरी का शुल्क जोड़ा",
      waive_fee: "फ़ीस माफ़ की", settle_fee: "फ़ीस पूरी हुई", waiver_request: "माफ़ी माँगी गई", upi_owner_reply: "UPI पर मालिक का जवाब" },
    ml: { open_fee: "മാസത്തെ ഫീസ് തുറന്നു", create_fee_link: "പണമടവ് ലിങ്ക് ഉണ്ടാക്കി", record_payment: "പണമടവ് രേഖപ്പെടുത്തി", cancel_fee_link: "പഴയ പണമടവ് ലിങ്ക് അടച്ചു", add_late_fee: "വൈകിയതിന്റെ ഫീസ് ചേർത്തു",
      waive_fee: "ഫീസ് ഒഴിവാക്കി", settle_fee: "ഫീസ് തീർന്നു", waiver_request: "ഇളവ് ചോദിച്ചു", upi_owner_reply: "UPI-യെക്കുറിച്ച് ഉടമയുടെ മറുപടി" },
    kn: { open_fee: "ತಿಂಗಳ ಶುಲ್ಕ ತೆರೆಯಿತು", create_fee_link: "ಪಾವತಿ ಲಿಂಕ್ ಮಾಡಿತು", record_payment: "ಪಾವತಿ ದಾಖಲಿಸಿತು", cancel_fee_link: "ಹಳೆಯ ಪಾವತಿ ಲಿಂಕ್ ಮುಚ್ಚಿತು", add_late_fee: "ತಡ ಶುಲ್ಕ ಸೇರಿಸಿತು",
      waive_fee: "ಶುಲ್ಕ ಮನ್ನಾ ಮಾಡಿತು", settle_fee: "ಶುಲ್ಕ ಪೂರ್ತಿಯಾಯಿತು", waiver_request: "ಮನ್ನಾ ಕೇಳಿದರು", upi_owner_reply: "UPI ಬಗ್ಗೆ ಮಾಲೀಕರ ಉತ್ತರ" },
  },
};

/** A fee as the papers need it: the month and the batch in a language, and what is still owed by the record now. */
export function feeCase(due: Due, settings: Settings): PaperCase {
  const [year, month] = due.month.split("-").map(Number);
  return {
    id: due.id, customer: due.customer, language: due.language, state: due.state,
    owedPaise: due.state === "open" ? Math.max(0, owedPaise(due) - paidPaise(due)) : 0,
    label: (language) => {
      const batch = settings.batches.find((b) => b.id === due.batchId);
      return `${MONTH_NAMES[language][month - 1] ?? due.month} ${year}${batch ? `, ${batchName(batch, language)}` : ""}`;
    },
  };
}

const LIMIT_LABELS: Record<Language, { waiver: string; refund: string; part: string }> = {
  en: { waiver: "the waiver the agent may give alone", refund: "the refund the agent may give alone", part: "the smallest part payment taken" },
  hi: { waiver: "एजेंट अकेले जितनी माफ़ी दे सकता है", refund: "एजेंट अकेले जितना रिफ़ंड दे सकता है", part: "सबसे छोटा आंशिक भुगतान जो लिया जाता है" },
  ml: { waiver: "ഏജന്റിന് തനിയെ നൽകാവുന്ന ഇളവ്", refund: "ഏജന്റിന് തനിയെ നൽകാവുന്ന റീഫണ്ട്", part: "സ്വീകരിക്കുന്ന ഏറ്റവും ചെറിയ ഭാഗിക പണമടവ്" },
  kn: { waiver: "ಏಜೆಂಟ್ ತಾನೇ ಕೊಡಬಹುದಾದ ಮನ್ನಾ", refund: "ಏಜೆಂಟ್ ತಾನೇ ಕೊಡಬಹುದಾದ ವಾಪಸ್ ಹಣ", part: "ತೆಗೆದುಕೊಳ್ಳುವ ಅತಿ ಚಿಕ್ಕ ಭಾಗ ಪಾವತಿ" },
};

/** The limits a change is read against: a higher waiver or refund limit is wider; a smaller least part payment is wider. */
export function limitFacts(settings: unknown, language: Language): LimitFact[] {
  const s = settings as Partial<Settings> | null;
  const l = LIMIT_LABELS[language];
  const facts: LimitFact[] = [];
  const add = (key: string, label: string, value: unknown, wider: "higher" | "lower") => { if (typeof value === "number" && Number.isFinite(value)) facts.push({ key, label, value, wider, show: formatInr(value) }); };
  add("waiver-limit", l.waiver, s?.waiver?.limitInr, "higher");
  add("refund-limit", l.refund, s?.refund?.limitInr, "higher");
  if (s?.partPayments?.allowed) add("part-payment-min", l.part, s.partPayments.minInr, "lower");
  return facts;
}

/** The identity paper's limits and checks from the centre's go-live certificate: the same phrases and counts the certificate itself prints. */
export function fromGoLive(cert: GoLiveCertificate, language: Language): { limits: string[]; checks: { held: number; total: number; on: GoLiveCertificate["issuedOn"]; notTested: string[] } } {
  return { limits: limitLines(cert, language), checks: { held: cert.checks.held, total: cert.checks.total, on: cert.issuedOn, notTested: cert.notTested.map((k) => STRINGS[language].notTested[k] ?? k) } };
}
