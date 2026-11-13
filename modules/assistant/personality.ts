// The character's personality (decision 47): a few ways the shop's assistant makes small talk, picked by the partner in the panel's Character step. A personality
// changes ONLY the assistant's own small talk: the greeting (the first sentence of its "help" answer, words.ts) and the morning summary's opening and sign-off
// (templates.ts builds one morning template per personality from these parts). It never changes money cards, amounts, approvals, limits or any other fixed wording.
//
// Why the morning line needs a template per personality: outside the owner's 24-hour window the morning line can only go as a WhatsApp template Meta approved word
// for word, and a template body may not start or end with a value, so the opening and the sign-off cannot be values. Each personality's morning template is therefore
// its own submission (item 12), in four languages.
//
// "warm" is today's wording exactly, so a shop that never picked one reads what it read before. Hindi, Malayalam and Kannada are machine-written and need a native
// speaker's reading before any shop sees them (the review sheets, plan item 12), like every other line the assistant says.
import type { Language } from "../language/languages.ts";

export const PERSONALITIES = ["warm", "cheerful", "brief"] as const;
export type Personality = (typeof PERSONALITIES)[number];

/**
 * The small talk, per personality and language. `{name}` and `{shop}` are the character's name and the shop's name; nothing else may appear (no number, no amount),
 * so the outgoing check has nothing new to read. The morning opening must not start with a value (Meta's review), and every sign-off ends with fixed words.
 */
export const SMALL_TALK: Record<Personality, Record<Language, { greeting: string; morningOpening: string; morningSignOff: string }>> = {
  warm: {
    en: { greeting: "I'm {name}, {shop}'s assistant.", morningOpening: "Good morning from {name}, the assistant of {shop}.", morningSignOff: "Reply here to see more." },
    hi: { greeting: "मैं {name} हूँ, {shop} का असिस्टेंट।", morningOpening: "सुप्रभात, मैं {name}, {shop} का असिस्टेंट।", morningSignOff: "और देखने के लिए यहाँ जवाब दें।" },
    ml: { greeting: "ഞാൻ {name}, {shop}-ന്റെ അസിസ്റ്റന്റ്.", morningOpening: "സുപ്രഭാതം, ഞാൻ {name}, {shop}-ന്റെ അസിസ്റ്റന്റ്.", morningSignOff: "കൂടുതൽ കാണാൻ ഇവിടെ മറുപടി നൽകുക." },
    kn: { greeting: "ನಾನು {name}, {shop} ನ ಸಹಾಯಕ.", morningOpening: "ಶುಭೋದಯ, ನಾನು {name}, {shop} ನ ಸಹಾಯಕ.", morningSignOff: "ಹೆಚ್ಚು ನೋಡಲು ಇಲ್ಲಿ ಉತ್ತರಿಸಿ." },
  },
  cheerful: {
    en: { greeting: "Hello! I'm {name}, {shop}'s assistant, happy to help.", morningOpening: "Good morning! {name} here, the assistant of {shop}.", morningSignOff: "Reply here to see more. Have a lovely day!" },
    hi: { greeting: "नमस्ते! मैं {name} हूँ, {shop} का असिस्टेंट, मदद के लिए हाज़िर।", morningOpening: "सुप्रभात! मैं {name}, {shop} का असिस्टेंट।", morningSignOff: "और देखने के लिए यहाँ जवाब दें। आपका दिन शुभ हो!" },
    ml: { greeting: "നമസ്കാരം! ഞാൻ {name}, {shop}-ന്റെ അസിസ്റ്റന്റ്, സഹായിക്കാൻ സന്തോഷം.", morningOpening: "സുപ്രഭാതം! ഞാൻ {name}, {shop}-ന്റെ അസിസ്റ്റന്റ്.", morningSignOff: "കൂടുതൽ കാണാൻ ഇവിടെ മറുപടി നൽകുക. നല്ലൊരു ദിവസം ആശംസിക്കുന്നു!" },
    kn: { greeting: "ನಮಸ್ಕಾರ! ನಾನು {name}, {shop} ನ ಸಹಾಯಕ, ಸಹಾಯ ಮಾಡಲು ಸಂತೋಷ.", morningOpening: "ಶುಭೋದಯ! ನಾನು {name}, {shop} ನ ಸಹಾಯಕ.", morningSignOff: "ಹೆಚ್ಚು ನೋಡಲು ಇಲ್ಲಿ ಉತ್ತರಿಸಿ. ನಿಮ್ಮ ದಿನ ಶುಭವಾಗಲಿ!" },
  },
  brief: {
    en: { greeting: "This is {name}, {shop}'s assistant.", morningOpening: "Morning summary from {name}, the assistant of {shop}.", morningSignOff: "Reply for more." },
    hi: { greeting: "यह {name} है, {shop} का असिस्टेंट।", morningOpening: "सुबह की जानकारी: {name}, {shop} का असिस्टेंट।", morningSignOff: "और जानने के लिए जवाब दें।" },
    ml: { greeting: "ഇത് {name}, {shop}-ന്റെ അസിസ്റ്റന്റ്.", morningOpening: "രാവിലത്തെ വിവരം: {name}, {shop}-ന്റെ അസിസ്റ്റന്റ്.", morningSignOff: "കൂടുതലിന് മറുപടി നൽകുക." },
    kn: { greeting: "ಇದು {name}, {shop} ನ ಸಹಾಯಕ.", morningOpening: "ಬೆಳಗಿನ ಮಾಹಿತಿ: {name}, {shop} ನ ಸಹಾಯಕ.", morningSignOff: "ಹೆಚ್ಚಿನದಕ್ಕೆ ಉತ್ತರಿಸಿ." },
  },
};

/** The greeting with the name and the shop filled in (both already noted for the outgoing check by the caller's Writer). */
export const greeting = (p: Personality, language: Language, name: string, shop: string): string =>
  SMALL_TALK[p][language].greeting.replace("{name}", () => name).replace("{shop}", () => shop);
