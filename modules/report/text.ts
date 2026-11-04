// The small helpers every report's text uses: which languages a choice means, amounts in rupees, and one-line text.
import { formatInr } from "../language/format.ts";
import type { Language } from "../language/languages.ts";

/** "both" is Hindi and English, one message after the other. */
export type ReportLanguage = Language | "both";
export const BOTH: readonly Language[] = ["hi", "en"];
export const languagesOf = (language: ReportLanguage): readonly Language[] => (language === "both" ? BOTH : [language]);

export const rupees = (paise: number): string => formatInr(paise / 100);

/** Text typed into the settings (a shop's name, who set it up) on one line, so a line break in it cannot make a sixth line. */
export const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
