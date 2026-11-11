// "What this checks" (plan B67): the same three lines on every report, certificate and paper, in the shop's language. Who uses it: page() in page.ts, the one
// place every printed paper goes through (the templates' monthly reports and certificates, the go-live certificate, modules/papers, the own-agent crash-test
// certificate), so no paper can leave it out.
//
// The words come from geometer-verify's own account of what a pass shows and does not show (geometer-verify README, "What a pass does not show"): the calls Guard
// saw and the services' confirmations, the limits and approvals Guard enforced, and what no check can know. The English is the website's WhatThisChecks component's
// text exactly (public-web src/components/WhatThisChecks.tsx); the Hindi, Malayalam and Kannada are the website's too (src/shopPaper/summaryWords.demo-font.ts),
// and public-web's tests/what-this-checks.test.ts reads this file and fails if the two differ.
//
// MACHINE-WRITTEN, WAITING FOR NATIVE REVIEW: the Hindi, Malayalam and Kannada were written by a model (12 November 2026, from the English); no native speaker has read
// them yet. REVIEW says so in code, the papers' tests check it, and modules/papers/Deferred.md lists the words to look at.
import type { Language } from "../language/languages.ts";

export const WHAT_THIS_CHECKS_REVIEW: Record<Language, "source" | "machine-written, waiting for native review"> = {
  en: "source", hi: "machine-written, waiting for native review", ml: "machine-written, waiting for native review", kn: "machine-written, waiting for native review",
};

export interface WhatThisChecksWords { heading: string; lines: readonly [label: string, text: string][] }

export const WHAT_THIS_CHECKS: Record<Language, WhatThisChecksWords> = {
  en: {
    heading: "What this checks",
    lines: [
      ["What Geometer saw", "The calls that went through Guard, and the confirmations the payment and other services sent back."],
      ["What it controlled", "The limits Guard enforced, and the approvals it waited for."],
      ["What it can’t know", "Anything that never went through Guard. Whether what was recorded is true. Why a person decided as they did. A pass only says the records still match the anchor or key you chose to trust: hand it someone else’s anchor or key and it will say their records match."],
    ],
  },
  hi: {
    heading: "यह जाँच क्या दिखाती है",
    lines: [
      ["Geometer ने क्या देखा", "जो काम Guard से होकर गए, और पेमेंट व दूसरी सेवाओं की भेजी पुष्टियाँ।"],
      ["उसने क्या संभाला", "Guard ने जो सीमाएँ लागू कीं, और जिन मंज़ूरियों का उसने इंतज़ार किया।"],
      ["वह क्या नहीं जान सकता", "जो कुछ Guard से होकर नहीं गया। जो दर्ज हुआ वह सच है या नहीं। किसी व्यक्ति ने कोई फ़ैसला क्यों लिया। जाँच सिर्फ़ इतना बताती है कि रिकॉर्ड उस कुंजी से मेल खाते हैं जिस पर भरोसा किया गया: किसी और की कुंजी दें तो वह उनके रिकॉर्ड को मेल खाता बताएगी।"],
    ],
  },
  ml: {
    heading: "ഈ പരിശോധന എന്ത് കാണിക്കുന്നു",
    lines: [
      ["Geometer കണ്ടത്", "Guard വഴി കടന്നുപോയ നടപടികളും, പേയ്മെന്റും മറ്റ് സേവനങ്ങളും തിരികെ അയച്ച സ്ഥിരീകരണങ്ങളും."],
      ["അത് നിയന്ത്രിച്ചത്", "Guard നടപ്പാക്കിയ പരിധികളും, അത് കാത്തിരുന്ന അംഗീകാരങ്ങളും."],
      ["അതിന് അറിയാൻ കഴിയാത്തത്", "Guard വഴി കടന്നുപോകാത്ത ഒന്നും. രേഖപ്പെടുത്തിയത് സത്യമാണോ എന്ന്. ഒരാൾ എന്തുകൊണ്ട് അങ്ങനെ തീരുമാനിച്ചു എന്ന്. വിശ്വസിക്കാൻ തിരഞ്ഞെടുത്ത കീയുമായി രേഖകൾ ഇപ്പോഴും ഒത്തുപോകുന്നു എന്ന് മാത്രമേ പരിശോധന പറയൂ: മറ്റൊരാളുടെ കീ നൽകിയാൽ അവരുടെ രേഖകൾ ഒത്തുപോകുന്നു എന്ന് അത് പറയും."],
    ],
  },
  kn: {
    heading: "ಈ ಪರಿಶೀಲನೆ ಏನು ತೋರಿಸುತ್ತದೆ",
    lines: [
      ["Geometer ನೋಡಿದ್ದು", "Guard ಮೂಲಕ ಹೋದ ಕ್ರಿಯೆಗಳು, ಮತ್ತು ಪಾವತಿ ಹಾಗೂ ಇತರ ಸೇವೆಗಳು ಕಳುಹಿಸಿದ ದೃಢೀಕರಣಗಳು."],
      ["ಅದು ನಿಯಂತ್ರಿಸಿದ್ದು", "Guard ಜಾರಿಗೊಳಿಸಿದ ಮಿತಿಗಳು, ಮತ್ತು ಅದು ಕಾಯ್ದ ಅನುಮೋದನೆಗಳು."],
      ["ಅದಕ್ಕೆ ತಿಳಿಯಲಾಗದ್ದು", "Guard ಮೂಲಕ ಹೋಗದ ಯಾವುದೂ. ದಾಖಲಾದದ್ದು ನಿಜವೇ ಎಂಬುದು. ಒಬ್ಬ ವ್ಯಕ್ತಿ ಏಕೆ ಹಾಗೆ ನಿರ್ಧರಿಸಿದರು ಎಂಬುದು. ನಂಬಲು ಆರಿಸಿದ ಕೀಯೊಂದಿಗೆ ದಾಖಲೆಗಳು ಈಗಲೂ ಹೊಂದುತ್ತವೆ ಎಂದು ಮಾತ್ರ ಪರಿಶೀಲನೆ ಹೇಳುತ್ತದೆ: ಬೇರೆಯವರ ಕೀ ಕೊಟ್ಟರೆ ಅವರ ದಾಖಲೆಗಳು ಹೊಂದುತ್ತವೆ ಎಂದು ಹೇಳುತ್ತದೆ."],
    ],
  },
};

const esc = (v: string): string => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The block as page HTML: a heading and three term/description pairs (the page's own style sheet draws it; no script, no link). */
export function whatThisChecksBlock(language: Language): string {
  const w = WHAT_THIS_CHECKS[language];
  return `<aside class="what"><h2>${esc(w.heading)}</h2><dl>${w.lines.map(([label, text]) => `<dt>${esc(label)}</dt><dd>${esc(text)}</dd>`).join("")}</dl></aside>`;
}
