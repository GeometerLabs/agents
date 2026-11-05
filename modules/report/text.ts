// The small helpers every report's text uses: which languages a choice means, amounts in rupees, and one-line text.
import type { LocalDate } from "../core/time.ts";
import { MONTH_NAMES, formatDate, formatInr } from "../language/format.ts";
import type { Language } from "../language/languages.ts";

/** "both" is Hindi and English, one message after the other. */
export type ReportLanguage = Language | "both";
export const BOTH: readonly Language[] = ["hi", "en"];
export const languagesOf = (language: ReportLanguage): readonly Language[] => (language === "both" ? BOTH : [language]);

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
