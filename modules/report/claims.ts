// The claim rules, kept in code, for every template: a document counts and states facts; it never grades. BANNED lists, per language, the words no document may
// contain (safe, guaranteed, certified, earnings and their translations). A test runs every document in every language through it, and every sell guide.
import type { Language } from "../language/languages.ts";

/**
 * Claim rules 3 and 7: never "safe", "guaranteed", "certified", and no earnings claims. English words are checked in
 * every language (an English word can sit in any text); each language adds its own. "certificate" is fine; "certified"
 * is not, so these name the exact words and do not cut them short. The confirm verbs of the packs are not here.
 */
export const BANNED: Record<Language | "any", RegExp[]> = {
  any: [/\bsafe/i, /\bsafety\b/i, /guarant/i, /\bcertified\b/i, /\bcertify\b/i, /\bcertifies\b/i, /\bcertification\b/i, /\b100 ?%/, /risk[- ]?free/i, /fool[- ]?proof/i, /\bsecure(d|ly)?\b/i, /\bproven\b/i,
    /\bearn/i, /\bincome\b/i, /\bprofit/i, /\brevenue\b/i],
  en: [],
  hi: [/सुरक्षित/u, /सुरक्षा/u, /गारंटी/u, /गारण्टी/u, /प्रमाणित/u, /कमाई/u, /आमदनी/u, /मुनाफ़ा/u, /मुनाफा/u],
  ml: [/സുരക്ഷിത/u, /ഗ്യാരണ്ടി/u, /ഗ്യാരന്റി/u, /സർട്ടിഫൈഡ്/u, /വരുമാനം/u, /ലാഭം/u, /സമ്പാദി/u, /ഉറപ്പ് ?നൽകു/u, /ഉറപ്പുനൽകു/u],
  kn: [/ಸುರಕ್ಷಿತ/u, /ಗ್ಯಾರಂಟಿ/u, /ಖಾತರಿ/u, /ಖಾತ್ರಿ/u, /ಪ್ರಮಾಣೀಕೃತ/u, /ಪ್ರಮಾಣೀಕರಿಸ/u, /ಆದಾಯ/u, /ಲಾಭ/u, /ಗಳಿಕೆ/u, /ಸಂಪಾದ/u],
};

/** The banned words found in a text written in a language (and "both" languages: pass each). Empty means none. */
export function bannedIn(text: string, language: Language): string[] {
  return [...BANNED.any, ...BANNED[language]].filter((re) => re.test(text)).map((re) => re.source);
}
