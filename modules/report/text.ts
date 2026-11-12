// The small helpers every report's text uses: which languages a choice means, amounts in rupees, and one-line text.
import type { LocalDate } from "../core/time.ts";
import { MONTH_NAMES, formatDate, formatInr } from "../language/format.ts";
import type { Language } from "../language/languages.ts";

/** "both" is Hindi and English, one message after the other. */
export type ReportLanguage = Language | "both";
export const BOTH: readonly Language[] = ["hi", "en"];
// 'both' expands to Hindi then English so the same message code serves one language or two.
export const languagesOf = (language: ReportLanguage): readonly Language[] => (language === "both" ? BOTH : [language]);

// Amounts are kept in paise everywhere; this is the one place that turns them into rupee text.
export const rupees = (paise: number): string => formatInr(paise / 100);

/** Text typed into the settings (a shop's name, who set it up) on one line, so a line break in it cannot make a sixth line. */
export const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The word on the Innovator badge (plan B56), in each language. */
export const INNOVATOR: Record<Language, string> = { en: "Innovator", hi: "इनोवेटर", ml: "ഇന്നൊവേറ്റർ", kn: "ಇನ್ನೋವೇಟರ್" };
/** The mark that goes before the word on the Innovator badge. A plain symbol, not an emoji, so every phone draws it the same way. */
export const BADGE_SYMBOL = "\u2605";
/** "★ Innovator" in a language. */
export const badgeText = (language: Language): string => `${BADGE_SYMBOL} ${INNOVATOR[language]}`;

/** "Nov 2026" for a whole month, otherwise "Tue 3 Nov – Mon 9 Nov 2026". */
export function periodLabel(period: { month: { year: number; month: number } | null; firstDay: LocalDate; lastDay: LocalDate }, language: Language): string {
  if (period.month) return `${MONTH_NAMES[language][period.month.month - 1]} ${period.month.year}`;
  return `${formatDate(period.firstDay, language)} \u2013 ${formatDate(period.lastDay, language)} ${period.lastDay.year}`;
}

/** What a report's numbers were counted from. Always written on the report and in the message, never assumed: a report made from stand-ins must say so. */
export type Source = "stand-in" | "test-mode" | "live";
export const SOURCES: readonly Source[] = ["stand-in", "test-mode", "live"];

// ---- refunds a person settled by their word (B75, 12 Nov 2026) -------------------------------------------------------------------------------------------------
// A refund a person at the server settled as made (Guard's `already_done`; settled-by-word.ts) is never counted as given back. Every document that shows the month's
// money shows these apart, one per person: "Settled by <who>, by their word". Shared by the three templates and taken into each template's own strings, so the
// native review sheets list them with the rest. The Hindi, Malayalam and Kannada are machine-written (12 Nov 2026) and must be read by a native speaker before a
// real shop sees them.

/** "Settled by asha, by their word": one person's settlements. `who` is as `settledWho` shows it. */
export const SETTLED_BY_WORD: Record<Language, (who: string) => string> = {
  en: (who) => `Settled by ${who}, by their word`,
  hi: (who) => `${who} ने अपनी बात पर निपटाया`,
  ml: (who) => `${who} സ്വന്തം വാക്കിൽ തീർപ്പാക്കിയത്`,
  kn: (who) => `${who} ಅವರ ಮಾತಿನ ಮೇಲೆ ಇತ್ಯರ್ಥಪಡಿಸಿದ್ದು`,
};

/** The same without a name: the owner's WhatsApp message uses it when the names would not fit (the full report names them). */
export const SETTLED_BY_SOMEONE: Record<Language, string> = {
  en: "Settled by a person, by their word",
  hi: "किसी व्यक्ति ने अपनी बात पर निपटाया",
  ml: "ഒരാൾ സ്വന്തം വാക്കിൽ തീർപ്പാക്കിയത്",
  kn: "ಒಬ್ಬ ವ್ಯಕ್ತಿ ತಮ್ಮ ಮಾತಿನ ಮೇಲೆ ಇತ್ಯರ್ಥಪಡಿಸಿದ್ದು",
};

/**
 * Who settled it, as a document shows them. Guard names a person at the server `operator:<admin id>`; the documents show the id alone, on one line, and at most 40
 * characters (the signed data keeps the whole name).
 */
export function settledWho(by: string): string {
  const who = oneLine(by.replace(/^operator:/u, "")) || oneLine(by);
  return who.length > 40 ? `${who.slice(0, 39)}\u2026` : who;
}

/**
 * The words the owner's monthly WhatsApp message adds for refunds people settled by their word, or undefined when nobody did. The longest of these that keeps the
 * message within WhatsApp's limit with the shortest check link (`fits` says): each person named, two at most and then `more(n)` ("Settled by asha, by their word:
 * 1 (₹200) · …"); then without the names, with the count and the amount; then with the count alone. When not even that fits (a month whose message was already at
 * the limit: long names in the shop's script, the badge), none: a message that fitted before these words existed still fits, and the full report names them.
 */
export function settledByWordWords(rows: readonly { by: string; count: number; paise: number }[] | undefined, language: Language, more: (n: number) => string, fits: (words: string) => boolean): string | undefined {
  if (!rows || rows.length === 0) return undefined;
  const named = [...rows.slice(0, 2).map((r) => `${SETTLED_BY_WORD[language](settledWho(r.by))}: ${r.count} (${rupees(r.paise)})`), ...(rows.length > 2 ? [more(rows.length - 2)] : [])].join(" \u00b7 ");
  const total = rows.reduce((t, r) => ({ count: t.count + r.count, paise: t.paise + r.paise }), { count: 0, paise: 0 });
  return [named, `${SETTLED_BY_SOMEONE[language]}: ${total.count} (${rupees(total.paise)})`, `${SETTLED_BY_SOMEONE[language]}: ${total.count}`].find(fits);
}

// ---- the signed summary's words (item 17b) -------------------------------------------------------------------------------------------------------------------
// Shared by every template's report and certificates, and taken into each template's own strings (so the native review sheets list them with the rest).
// The Hindi, Malayalam and Kannada are machine-written and must be read by a native speaker before a real shop sees them.

/** The label before the check link in the owner's WhatsApp message: "Check it is genuine: https://geometer.dev/verify/#s1...". */
export const CHECK_GENUINE: Record<Language, string> = {
  en: "Check it is genuine",
  hi: "असली है या नहीं, जाँचें",
  ml: "യഥാർത്ഥമാണോ എന്ന് പരിശോധിക്കുക",
  kn: "ನಿಜವಾದುದೇ ಎಂದು ಪರಿಶೀಲಿಸಿ",
};

/** What a paper with a signed summary in its QR says under it: no file is needed, nothing is sent, and what the check does not show (B67). */
export const SCAN_SUMMARY: Record<Language, string> = {
  en: "Scan this code, or open the link, to check this paper on geometer.dev. It shows whether the paper is genuine, who issued it, and the figures to compare with this page. The check runs on your phone and nothing about the paper is sent. It does not show that the numbers are true.",
  hi: "इस दस्तावेज़ को geometer.dev पर जाँचने के लिए यह कोड स्कैन करें या लिंक खोलें। इससे पता चलता है कि दस्तावेज़ असली है या नहीं, इसे किसने जारी किया, और इस पन्ने से मिलाने के लिए आँकड़े। जाँच आपके फ़ोन पर होती है, दस्तावेज़ के बारे में कुछ भेजा नहीं जाता। यह नहीं बताता कि आँकड़े सच हैं।",
  ml: "ഈ രേഖ geometer.dev-ൽ പരിശോധിക്കാൻ ഈ കോഡ് സ്കാൻ ചെയ്യുക, അല്ലെങ്കിൽ ലിങ്ക് തുറക്കുക. രേഖ യഥാർത്ഥമാണോ, ആരാണ് ഇത് പുറത്തിറക്കിയത്, ഈ പേജുമായി ഒത്തുനോക്കാനുള്ള കണക്കുകൾ എന്നിവ അത് കാണിക്കും. പരിശോധന നിങ്ങളുടെ ഫോണിൽ നടക്കുന്നു, രേഖയെക്കുറിച്ച് ഒന്നും അയയ്ക്കുന്നില്ല. കണക്കുകൾ ശരിയാണെന്ന് അത് കാണിക്കുന്നില്ല.",
  kn: "ಈ ದಾಖಲೆಯನ್ನು geometer.dev ನಲ್ಲಿ ಪರಿಶೀಲಿಸಲು ಈ ಕೋಡ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ ಅಥವಾ ಲಿಂಕ್ ತೆರೆಯಿರಿ. ದಾಖಲೆ ನಿಜವಾದುದೇ, ಅದನ್ನು ಯಾರು ನೀಡಿದರು, ಮತ್ತು ಈ ಪುಟದೊಂದಿಗೆ ಹೋಲಿಸಲು ಲೆಕ್ಕಗಳನ್ನು ಅದು ತೋರಿಸುತ್ತದೆ. ಪರಿಶೀಲನೆ ನಿಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ ನಡೆಯುತ್ತದೆ, ದಾಖಲೆಯ ಬಗ್ಗೆ ಏನೂ ಕಳುಹಿಸಲಾಗುವುದಿಲ್ಲ. ಲೆಕ್ಕಗಳು ಸತ್ಯ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ.",
};
