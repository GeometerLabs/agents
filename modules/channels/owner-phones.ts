// The owner's phones, the small pure parts (owner's item 2, "no Operator holds a shop hostage"): the coarse label a phone gets when its passkey is made, and how a
// passkey's origin is worded. Used by the runtime's HTTP layer (modules/runtime/http.ts, which reads the browser's User-Agent at registration) and by the owner's
// phones page (owner-phones-page.ts). Nothing here touches a file or the network.
import type { Language } from "../language/languages.ts";

/**
 * A coarse label from a browser's User-Agent, like "Android, Chrome": the platform and the browser, nothing finer (no model, no version, no address), because the
 * label only has to help an owner tell their own phones apart and spot one that is not theirs. Unknown parts are left out; with neither, the label is "" and the
 * page says "a phone". The User-Agent itself is never kept.
 */
export function phoneLabel(userAgent: unknown): string {
  const ua = typeof userAgent === "string" ? userAgent.slice(0, 400) : "";
  // order matters: an iPad or iPhone UA also says "Mac OS X"; an Android UA also says "Linux"
  const platform = /iPhone/u.test(ua) ? "iPhone" : /iPad/u.test(ua) ? "iPad" : /Android/u.test(ua) ? "Android" : /CrOS/u.test(ua) ? "Chromebook"
    : /Windows/u.test(ua) ? "Windows" : /Macintosh|Mac OS X/u.test(ua) ? "Mac" : /Linux|X11/u.test(ua) ? "Linux" : "";
  // order matters again: Edge, Opera and Samsung's browser all say "Chrome"; Chrome says "Safari"; iOS Chrome and Firefox say CriOS and FxiOS
  const browser = /EdgA?\/|Edg\//u.test(ua) ? "Edge" : /OPR\/|Opera/u.test(ua) ? "Opera" : /SamsungBrowser/u.test(ua) ? "Samsung Internet" : /FxiOS|Firefox\//u.test(ua) ? "Firefox"
    : /CriOS|Chrome\//u.test(ua) ? "Chrome" : /Safari\//u.test(ua) ? "Safari" : "";
  return [platform, browser].filter(Boolean).join(", ");
}

/** How a passkey came to be, as the access store keeps it ("setup" and "recovery" are the Operator's QR and card, or the owner's own codes; "reset" is Geometer's). */
export type PhoneVia = "setup" | "recovery" | "own_phone" | "own_code" | "reset";
export const isPhoneVia = (v: string): v is PhoneVia => v === "setup" || v === "recovery" || v === "own_phone" || v === "own_code" || v === "reset";


const LOCALE: Record<Language, string> = { en: "en-IN", hi: "hi-IN", ml: "ml-IN", kn: "kn-IN" };
/**
 * A moment as the owner reads it: "19 Nov, 3:42 pm". India's time zone, because the shops are in India and the runtime has no per-shop zone setting; a shop elsewhere
 * would read these moments in India's time (a known limit, Deferred).
 */
export const dayAndTime = (ms: number, language: Language): string =>
  new Intl.DateTimeFormat(LOCALE[language], { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
/** The day alone ("19 Nov 2026"), for a list of phones. */
export const dayOnly = (ms: number, language: Language): string =>
  new Intl.DateTimeFormat(LOCALE[language], { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }).format(new Date(ms));

/**
 * The push alert when a new phone is added to the owner's sign-in (the owner's other phones with alerts on get it). It carries the day, the time and the coarse label,
 * never a link or a code. Hindi, Malayalam and Kannada are machine-written and wait for native review (the review sheets list them).
 */
export const NEW_PHONE_ALERT = (at: number, label: string): Record<Language, string> => ({
  en: `A new phone was added to your shop on ${dayAndTime(at, "en")}${label ? ` (${label})` : ""}. Not you? Open your app and remove it.`,
  hi: `आपकी दुकान में ${dayAndTime(at, "hi")} को एक नया फ़ोन जोड़ा गया${label ? ` (${label})` : ""}। आपने नहीं जोड़ा? अपना ऐप खोलकर इसे हटाइए।`,
  ml: `നിങ്ങളുടെ കടയിൽ ${dayAndTime(at, "ml")}-ന് ഒരു പുതിയ ഫോൺ ചേർത്തു${label ? ` (${label})` : ""}. നിങ്ങളല്ലേ? ആപ്പ് തുറന്ന് ഇത് നീക്കൂ.`,
  kn: `ನಿಮ್ಮ ಅಂಗಡಿಗೆ ${dayAndTime(at, "kn")} ರಂದು ಹೊಸ ಫೋನ್ ಸೇರಿಸಲಾಗಿದೆ${label ? ` (${label})` : ""}. ನೀವಲ್ಲವೇ? ಆಪ್ ತೆರೆದು ಇದನ್ನು ತೆಗೆಯಿರಿ.`,
});

/** The push alert when recovery codes were made on one phone: the owner's other phones are told, since a set of codes is a way back in. */
export const CODES_ALERT = (at: number, label: string): Record<Language, string> => ({
  en: `New recovery codes were made on ${dayAndTime(at, "en")}${label ? ` (${label})` : ""}. Not you? Open your app and remove that phone.`,
  hi: `${dayAndTime(at, "hi")} को नए रिकवरी कोड बनाए गए${label ? ` (${label})` : ""}। आपने नहीं बनाए? अपना ऐप खोलकर वह फ़ोन हटाइए।`,
  ml: `${dayAndTime(at, "ml")}-ന് പുതിയ റിക്കവറി കോഡുകൾ ഉണ്ടാക്കി${label ? ` (${label})` : ""}. നിങ്ങളല്ലേ? ആപ്പ് തുറന്ന് ആ ഫോൺ നീക്കൂ.`,
  kn: `${dayAndTime(at, "kn")} ರಂದು ಹೊಸ ರಿಕವರಿ ಕೋಡ್‌ಗಳನ್ನು ಮಾಡಲಾಗಿದೆ${label ? ` (${label})` : ""}. ನೀವಲ್ಲವೇ? ಆಪ್ ತೆರೆದು ಆ ಫೋನ್ ತೆಗೆಯಿರಿ.`,
});
/** The push alert when one phone was removed from the owner's sign-in. */
export const REMOVED_ALERT = (at: number, label: string): Record<Language, string> => ({
  en: `A phone was removed from your shop's sign-in on ${dayAndTime(at, "en")}${label ? ` (${label})` : ""}. Not you? Open your app.`,
  hi: `${dayAndTime(at, "hi")} को आपकी दुकान के साइन-इन से एक फ़ोन हटाया गया${label ? ` (${label})` : ""}। आपने नहीं हटाया? अपना ऐप खोलिए।`,
  ml: `${dayAndTime(at, "ml")}-ന് നിങ്ങളുടെ കടയുടെ സൈൻ ഇനിൽ നിന്ന് ഒരു ഫോൺ നീക്കി${label ? ` (${label})` : ""}. നിങ്ങളല്ലേ? ആപ്പ് തുറക്കൂ.`,
  kn: `${dayAndTime(at, "kn")} ರಂದು ನಿಮ್ಮ ಅಂಗಡಿಯ ಸೈನ್ ಇನ್‌ನಿಂದ ಒಂದು ಫೋನ್ ತೆಗೆಯಲಾಗಿದೆ${label ? ` (${label})` : ""}. ನೀವಲ್ಲವೇ? ಆಪ್ ತೆರೆಯಿರಿ.`,
});

/**
 * One plain line for an owner whose Operator will not help: written on the owner's sign-in page and phones page, ONLY on Geometer's own Operator server (the pages file
 * says `hosted`), where Geometer can reset the sign-in after checking (`geometer owner reset`). On a builder's server the builder is the admin and nothing is shown.
 */
export const LOST_HELP: Record<Language, string> = {
  en: "Lost every phone and your codes, or your Operator will not help? Write to hello@geometer.dev.",
  hi: "हर फ़ोन और अपने कोड खो दिए, या आपका ऑपरेटर मदद नहीं कर रहा? hello@geometer.dev पर लिखिए।",
  ml: "എല്ലാ ഫോണുകളും കോഡുകളും നഷ്ടപ്പെട്ടോ, അല്ലെങ്കിൽ ഓപ്പറേറ്റർ സഹായിക്കുന്നില്ലേ? hello@geometer.dev-ലേക്ക് എഴുതൂ.",
  kn: "ಎಲ್ಲಾ ಫೋನ್‌ಗಳು ಮತ್ತು ಕೋಡ್‌ಗಳನ್ನು ಕಳೆದುಕೊಂಡಿರಾ, ಅಥವಾ ಆಪರೇಟರ್ ಸಹಾಯ ಮಾಡುತ್ತಿಲ್ಲವೇ? hello@geometer.dev ಗೆ ಬರೆಯಿರಿ.",
};
