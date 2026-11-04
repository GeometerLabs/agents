// The languages every template speaks: Hindi, English, Malayalam and Kannada. One list, so a language added here is added for all of them.
export type Language = "hi" | "en" | "ml" | "kn";
export const LANGUAGES: readonly Language[] = ["hi", "en", "ml", "kn"];
/** What each language is called in plain words (for the messages that tell a builder what to fix). Every language must have one. */
export const LANGUAGE_NAMES: Record<Language, string> = { hi: "Hindi", en: "English", ml: "Malayalam", kn: "Kannada" };
