// The "back soon" sentence of a shop the shared process has paused (go/internal/shared), in the four languages (hi, ml and kn machine-written, as everywhere). One place for
// two readers: the listings template's page for a browser that reaches the shared router directly (go/internal/shared, whose test holds its words to these) and the front's error page when the
// shop's backend answers "paused" (front.ts), so the visitor reads the same sentence either way.
import type { Language } from "../language/languages.ts";

export const BACK_SOON: Record<Language, string> = {
  en: "This shop's page is taking a short rest and will be back soon. Please try again a little later.",
  hi: "इस दुकान का पेज थोड़ी देर आराम कर रहा है और जल्द ही वापस आएगा। कृपया कुछ देर बाद फिर कोशिश कीजिए।",
  ml: "ഈ കടയുടെ പേജ് അൽപ്പനേരം വിശ്രമത്തിലാണ്, ഉടൻ തിരിച്ചെത്തും. കുറച്ചു കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കൂ.",
  kn: "ಈ ಅಂಗಡಿಯ ಪುಟ ಸ್ವಲ್ಪ ವಿಶ್ರಾಂತಿಯಲ್ಲಿದೆ, ಶೀಘ್ರದಲ್ಲೇ ಮರಳುತ್ತದೆ. ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಹೊತ್ತಿನ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
};
