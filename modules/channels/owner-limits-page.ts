// The owner's limits page in their own app (17 Nov 2026, "Limits, tightened by a tap"): the limits the shop's assistant works within, the value in force now, and the
// changes so far with where each stands. TIGHTENING is quick from the assistant (a card and a tap); LOOSENING, including undoing a tightening, is only here, and only
// for an owner who signed in with their PASSKEY (decision 27: outside the chat). Without it the page says so and offers the way to sign in again. A change made here goes
// through the same path as the assistant's: Pending until the running Guard has the new value, then Active; the Operator is told, never asked.
// Used by front.ts (GET <base>/limits, POST <base>/limits/set). Hindi, Malayalam and Kannada are machine-written and are on the review sheets (bundle/panel/review.ts).
import { html, raw } from "../core/html.ts";
import { formatInr } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import type { LimitsView } from "../limits/runtime-limits.ts";
import { OWNER_CSS } from "./look.ts";

/** What the front hands the page: the runtime's view, and whether this session was made with a passkey. */
export interface OwnerLimitsView extends LimitsView { passkey: boolean }

interface Words {
  title: string; intro: string; inForce: string; range: (min: string, max: string) => string; change: string; changeTo: string; needPasskey: string; changes: string; none: string;
  pending: string; active: string; failed: string; tightened: string; loosened: string; asked: string; refused: string; back: string; never: string; yourShop: string;
}
/** Exported so the review sheets list these lines too (review.ts, ids "limits.owner.*"). */
export const WORDS: Record<Language, Words> = {
  en: { title: "Your limits", intro: "These are the limits your assistant works within. Tightening one is quick: tell your assistant and tap yes. Loosening one is only done here, after you sign in with your passkey.",
    inForce: "In force now", range: (a, b) => `You can set it from ${a} to ${b}`, change: "Change", changeTo: "New value", needPasskey: "To change a limit here, sign out and sign in again with your passkey.",
    changes: "Recent changes", none: "No changes yet.", pending: "Pending: the shop already follows the tighter value, and the change is not final until Guard has it",
    active: "Active", failed: "Failed: the previous limit is still in force", tightened: "tightened", loosened: "loosened",
    asked: "Done. It shows as Pending until the shop's Guard has it, then as Active. Your Operator is told, and nothing waits for them.", refused: "That value is not allowed. It must be a whole number inside the range, and different from now.", back: "Back to your shop", never: "never", yourShop: "Your shop" },
  hi: { title: "आपकी सीमाएँ", intro: "ये वे सीमाएँ हैं जिनके भीतर आपका असिस्टेंट काम करता है। सीमा कसना आसान है: असिस्टेंट को बताइए और हाँ पर टैप कीजिए। ढीला करना सिर्फ़ यहीं होता है, अपनी पासकी से साइन इन करने के बाद।",
    inForce: "अभी लागू", range: (a, b) => `आप इसे ${a} से ${b} तक रख सकते हैं`, change: "बदलें", changeTo: "नया मान", needPasskey: "यहाँ सीमा बदलने के लिए साइन आउट करें और अपनी पासकी से फिर साइन इन करें।",
    changes: "हाल के बदलाव", none: "अभी कोई बदलाव नहीं।", pending: "प्रतीक्षा में: दुकान कसे हुए मान को अभी से मान रही है, और बदलाव तब पक्का होगा जब Guard के पास पहुँच जाए",
    active: "चालू", failed: "नहीं हो पाया: पहले वाली सीमा ही लागू है", tightened: "कसी गई", loosened: "ढीली की गई",
    asked: "हो गया। जब तक दुकान के Guard के पास नहीं पहुँचता, यह प्रतीक्षा में दिखेगा, फिर चालू। आपके ऑपरेटर को बता दिया गया है, उनके लिए कुछ रुका नहीं है।", refused: "यह मान मंज़ूर नहीं है। यह सीमा के भीतर की पूरी संख्या होनी चाहिए, और अभी वाले से अलग।", back: "अपनी दुकान पर वापस", never: "कभी नहीं", yourShop: "आपकी दुकान" },
  ml: { title: "നിങ്ങളുടെ പരിധികൾ", intro: "നിങ്ങളുടെ അസിസ്റ്റന്റ് പ്രവർത്തിക്കുന്ന പരിധികളാണിത്. പരിധി കർശനമാക്കുന്നത് എളുപ്പമാണ്: അസിസ്റ്റന്റിനോട് പറഞ്ഞ് yes ടാപ്പ് ചെയ്യുക. അയവ് വരുത്തുന്നത് ഇവിടെ മാത്രം, പാസ്‌കീ ഉപയോഗിച്ച് സൈൻ ഇൻ ചെയ്ത ശേഷം.",
    inForce: "ഇപ്പോൾ പ്രാബല്യത്തിൽ", range: (a, b) => `നിങ്ങൾക്ക് ഇത് ${a} മുതൽ ${b} വരെ വെക്കാം`, change: "മാറ്റുക", changeTo: "പുതിയ മൂല്യം", needPasskey: "ഇവിടെ പരിധി മാറ്റാൻ സൈൻ ഔട്ട് ചെയ്ത് പാസ്‌കീ ഉപയോഗിച്ച് വീണ്ടും സൈൻ ഇൻ ചെയ്യുക.",
    changes: "സമീപകാല മാറ്റങ്ങൾ", none: "ഇതുവരെ മാറ്റങ്ങളൊന്നുമില്ല.", pending: "കാത്തിരിക്കുന്നു: കടയിൽ കർശനമായ മൂല്യം ഇപ്പോഴേ പാലിക്കുന്നു, Guard-ന് കിട്ടുന്നതുവരെ മാറ്റം അന്തിമമല്ല",
    active: "പ്രാബല്യത്തിൽ", failed: "നടന്നില്ല: മുമ്പത്തെ പരിധി തന്നെ പ്രാബല്യത്തിൽ", tightened: "കർശനമാക്കി", loosened: "അയവുള്ളതാക്കി",
    asked: "ചെയ്തു. കടയുടെ Guard-ന് കിട്ടുന്നതുവരെ ഇത് കാത്തിരിക്കുന്നു എന്നും പിന്നീട് പ്രാബല്യത്തിൽ എന്നും കാണിക്കും. നിങ്ങളുടെ ഓപ്പറേറ്ററെ അറിയിച്ചിട്ടുണ്ട്, അവർക്കായി ഒന്നും കാത്തിരിക്കുന്നില്ല.", refused: "ഈ മൂല്യം അനുവദനീയമല്ല. അത് പരിധിക്കുള്ളിലെ ഒരു പൂർണ്ണസംഖ്യയും ഇപ്പോഴത്തേതിൽ നിന്ന് വ്യത്യസ്തവും ആയിരിക്കണം.", back: "നിങ്ങളുടെ കടയിലേക്ക് മടങ്ങുക", never: "ഒരിക്കലും ഇല്ല", yourShop: "നിങ്ങളുടെ കട" },
  kn: { title: "ನಿಮ್ಮ ಮಿತಿಗಳು", intro: "ನಿಮ್ಮ ಅಸಿಸ್ಟೆಂಟ್ ಕೆಲಸ ಮಾಡುವ ಮಿತಿಗಳಿವು. ಮಿತಿಯನ್ನು ಬಿಗಿಗೊಳಿಸುವುದು ಸುಲಭ: ಅಸಿಸ್ಟೆಂಟ್‌ಗೆ ಹೇಳಿ ಹೌದು ಎಂದು ಟ್ಯಾಪ್ ಮಾಡಿ. ಸಡಿಲಗೊಳಿಸುವುದು ಇಲ್ಲಿ ಮಾತ್ರ, ಪಾಸ್‌ಕೀಯಿಂದ ಸೈನ್ ಇನ್ ಆದ ಮೇಲೆ.",
    inForce: "ಈಗ ಜಾರಿಯಲ್ಲಿದೆ", range: (a, b) => `ನೀವು ಇದನ್ನು ${a} ರಿಂದ ${b} ವರೆಗೆ ಇಡಬಹುದು`, change: "ಬದಲಿಸಿ", changeTo: "ಹೊಸ ಮೌಲ್ಯ", needPasskey: "ಇಲ್ಲಿ ಮಿತಿ ಬದಲಿಸಲು ಸೈನ್ ಔಟ್ ಆಗಿ, ಪಾಸ್‌ಕೀಯಿಂದ ಮತ್ತೆ ಸೈನ್ ಇನ್ ಮಾಡಿ.",
    changes: "ಇತ್ತೀಚಿನ ಬದಲಾವಣೆಗಳು", none: "ಇನ್ನೂ ಯಾವ ಬದಲಾವಣೆಯೂ ಇಲ್ಲ.", pending: "ಬಾಕಿ ಇದೆ: ಅಂಗಡಿ ಬಿಗಿಯಾದ ಮೌಲ್ಯವನ್ನು ಈಗಲೇ ಪಾಲಿಸುತ್ತಿದೆ, Guard ಗೆ ಸಿಗುವವರೆಗೆ ಬದಲಾವಣೆ ಅಂತಿಮವಲ್ಲ",
    active: "ಜಾರಿಯಲ್ಲಿದೆ", failed: "ಆಗಲಿಲ್ಲ: ಹಿಂದಿನ ಮಿತಿಯೇ ಜಾರಿಯಲ್ಲಿದೆ", tightened: "ಬಿಗಿಗೊಳಿಸಲಾಗಿದೆ", loosened: "ಸಡಿಲಗೊಳಿಸಲಾಗಿದೆ",
    asked: "ಆಯಿತು. ಅಂಗಡಿಯ Guard ಗೆ ಸಿಗುವವರೆಗೆ ಇದು ಬಾಕಿ ಎಂದೂ, ನಂತರ ಜಾರಿಯಲ್ಲಿದೆ ಎಂದೂ ತೋರಿಸುತ್ತದೆ. ನಿಮ್ಮ ಆಪರೇಟರ್‌ಗೆ ತಿಳಿಸಲಾಗಿದೆ, ಅವರಿಗಾಗಿ ಏನೂ ಕಾಯುತ್ತಿಲ್ಲ.", refused: "ಈ ಮೌಲ್ಯ ಅನುಮತಿಸಲಾಗಿಲ್ಲ. ಅದು ಮಿತಿಯೊಳಗಿನ ಪೂರ್ಣ ಸಂಖ್ಯೆಯಾಗಿರಬೇಕು ಮತ್ತು ಈಗಿನದಕ್ಕಿಂತ ಬೇರೆಯಾಗಿರಬೇಕು.", back: "ನಿಮ್ಮ ಅಂಗಡಿಗೆ ಹಿಂತಿರುಗಿ", never: "ಎಂದಿಗೂ ಇಲ್ಲ", yourShop: "ನಿಮ್ಮ ಅಂಗಡಿ" },
};

/** A value as the owner reads it. */
const show = (row: { unit: "inr" | "count"; zeroIsOff: boolean }, v: number, w: Words): string => (row.zeroIsOff && v === 0 ? w.never : row.unit === "inr" ? formatInr(v) : String(v));

export interface OwnerLimitsInput { base: string; language: Language; view: OwnerLimitsView; csrf?: string; signOut?: { action: string; label: string }; notice?: "asked" | "refused" }

/** The limits page. Plain forms, no script, so it runs with the strictest content policy. */
export function ownerLimitsPage(o: OwnerLimitsInput): string {
  const w = WORDS[o.language];
  const csrf = o.csrf ? html`<input type="hidden" name="csrf" value="${o.csrf}">` : "";
  const rows = o.view.limits.map((l) => html`<section class="card"><h2>${l.name[o.language]}</h2>
<p>${l.rule[o.language].replace("{v}", show(l, l.inForce, w))}</p>
<p class="note">${w.inForce}: <strong>${show(l, l.inForce, w)}</strong> · ${w.range(show(l, l.bounds.min, w), show(l, l.bounds.max, w))}</p>
${o.view.passkey ? html`<form method="post" action="${o.base}/limits/set">${csrf}<input type="hidden" name="limit" value="${l.id}"><label>${w.changeTo} <input name="to" type="number" inputmode="numeric" min="${l.bounds.min}" max="${l.bounds.max}" step="1" required></label> <button class="yes" type="submit">${w.change}</button></form>` : ""}</section>`);
  const changes = o.view.changes.slice(-10).reverse().map((c) => {
    const l = o.view.limits.find((x) => x.id === c.limit);
    const name = l ? l.name[o.language] : c.limit;
    const state = c.state === "pending" ? w.pending : c.state === "active" ? w.active : w.failed;
    return html`<li>${name}: ${l ? show(l, c.from, w) : c.from} → ${l ? show(l, c.to, w) : c.to} (${c.direction === "tighten" ? w.tightened : w.loosened}) · <strong>${state}</strong></li>`;
  });
  return `<!doctype html>${html`<html lang="${o.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="same-origin"><title>${w.title}</title><style>${raw(OWNER_CSS)}</style></head><body class="app">
<main class="wrap"><h1>${w.title}</h1>
${o.notice ? html`<p class="notice" role="status">${o.notice === "asked" ? w.asked : w.refused}</p>` : ""}
<p class="note">${w.intro}</p>
${o.view.passkey ? "" : html`<p class="notice">${w.needPasskey}</p>${o.signOut ? html`<form method="post" action="${o.signOut.action}">${csrf}<button class="no full" type="submit">${o.signOut.label}</button></form>` : ""}`}
${rows}
<h2>${w.changes}</h2>${changes.length > 0 ? html`<ul class="plain">${changes}</ul>` : html`<p class="calm">${w.none}</p>`}
<p><a href="${o.base}/?lang=${o.language}">${w.back}</a></p></main></body></html>`.markup}`;
}
