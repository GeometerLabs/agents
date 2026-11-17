// "Limit changes" on the panel's shop page (17 Nov 2026, "Limits, tightened by a tap"): every change the owner made to a limit, from their assistant or their own app, and
// where it stands (Pending, Active, Failed), read from status/<shop>.json (bundle/lib/limit-changes.ts). A loosening is shown as news, never as a task: the owner did it
// themselves behind their passkey and nothing waits for the Operator. Used by views.ts (shopPage). Hindi, Malayalam and Kannada are machine-written and are on the
// review sheets (review.ts, ids "limits.panel.*").
import type { Language } from "../../modules/language/languages.ts";
import { LIMIT_WORDS } from "../../modules/limits/chat-limit-kinds.ts";
import { html } from "./html.ts";
import type { Ctx } from "./views.ts";

export interface LimitChangeRow { id: string; limit: string; from: number; to: number; direction: "tighten" | "loosen"; by: "owner_chat" | "owner_app"; state: "pending" | "active" | "failed"; at: string; why?: string }

interface Words { heading: string; note: string; none: string; tighten: string; loosen: string; chat: string; app: string; pending: string; active: string; failed: string; loosenNews: string; row: string }
/** Exported so the native reviewer's sheet lists these lines too (review.ts). Plain strings with {name}, {from}, {to}, {how}, {by}, {state}: no sample values are needed. */
export const WORDS: Record<Language, Words> = {
  en: { heading: "Limit changes", note: "Every change the owner made to a limit, and where it stands. Pending means the runtime already obeys the tighter value and Guard does not have it yet.", none: "No limit has been changed yet.",
    tighten: "tightened", loosen: "loosened", chat: "by a tap in the assistant", app: "in their app", pending: "Pending", active: "Active", failed: "Failed: the previous limit is still in force",
    loosenNews: "For your information: the owner loosened this themselves, behind their passkey. Nothing waits for you.", row: "{name}: {from} to {to}, {how}, {by}" },
  hi: { heading: "सीमाओं में बदलाव", note: "मालिक ने किसी सीमा में जो भी बदलाव किया और वह अभी कहाँ है। प्रतीक्षा में का मतलब: रनटाइम कसा हुआ मान अभी से मान रहा है, पर Guard के पास वह अभी नहीं है।", none: "अभी तक कोई सीमा नहीं बदली गई।",
    tighten: "कसी गई", loosen: "ढीली की गई", chat: "असिस्टेंट में टैप से", app: "अपने ऐप में", pending: "प्रतीक्षा में", active: "चालू", failed: "नहीं हो पाया: पहले वाली सीमा ही लागू है",
    loosenNews: "आपकी जानकारी के लिए: मालिक ने इसे खुद, अपनी पासकी से, ढीला किया। आपके लिए कुछ रुका नहीं है।", row: "{name}: {from} से {to}, {how}, {by}" },
  ml: { heading: "പരിധി മാറ്റങ്ങൾ", note: "ഉടമ ഒരു പരിധിയിൽ വരുത്തിയ ഓരോ മാറ്റവും അത് ഇപ്പോൾ എവിടെ എത്തി എന്നതും. കാത്തിരിക്കുന്നു എന്നാൽ റൺടൈം കർശനമായ മൂല്യം ഇപ്പോഴേ അനുസരിക്കുന്നു, Guard-ന് അത് ഇതുവരെ ലഭിച്ചിട്ടില്ല.", none: "ഇതുവരെ ഒരു പരിധിയും മാറ്റിയിട്ടില്ല.",
    tighten: "കർശനമാക്കി", loosen: "അയവുള്ളതാക്കി", chat: "അസിസ്റ്റന്റിലെ ടാപ്പ് വഴി", app: "അവരുടെ ആപ്പിൽ", pending: "കാത്തിരിക്കുന്നു", active: "പ്രാബല്യത്തിൽ", failed: "നടന്നില്ല: മുമ്പത്തെ പരിധി തന്നെ പ്രാബല്യത്തിൽ",
    loosenNews: "അറിയിപ്പിനായി: ഉടമ ഇത് സ്വയം, അവരുടെ പാസ്‌കീ ഉപയോഗിച്ച്, അയവുള്ളതാക്കി. നിങ്ങൾക്കായി ഒന്നും കാത്തിരിക്കുന്നില്ല.", row: "{name}: {from} മുതൽ {to} വരെ, {how}, {by}" },
  kn: { heading: "ಮಿತಿ ಬದಲಾವಣೆಗಳು", note: "ಮಾಲೀಕರು ಮಿತಿಯಲ್ಲಿ ಮಾಡಿದ ಪ್ರತಿಯೊಂದು ಬದಲಾವಣೆ ಮತ್ತು ಅದು ಈಗ ಎಲ್ಲಿದೆ. ಬಾಕಿ ಎಂದರೆ ರನ್‌ಟೈಮ್ ಬಿಗಿಯಾದ ಮೌಲ್ಯವನ್ನು ಈಗಲೇ ಪಾಲಿಸುತ್ತಿದೆ, Guard ಗೆ ಅದು ಇನ್ನೂ ಸಿಕ್ಕಿಲ್ಲ.", none: "ಇನ್ನೂ ಯಾವ ಮಿತಿಯನ್ನೂ ಬದಲಾಯಿಸಿಲ್ಲ.",
    tighten: "ಬಿಗಿಗೊಳಿಸಲಾಗಿದೆ", loosen: "ಸಡಿಲಗೊಳಿಸಲಾಗಿದೆ", chat: "ಅಸಿಸ್ಟೆಂಟ್‌ನಲ್ಲಿ ಟ್ಯಾಪ್ ಮೂಲಕ", app: "ಅವರ ಆ್ಯಪ್‌ನಲ್ಲಿ", pending: "ಬಾಕಿ ಇದೆ", active: "ಜಾರಿಯಲ್ಲಿದೆ", failed: "ಆಗಲಿಲ್ಲ: ಹಿಂದಿನ ಮಿತಿಯೇ ಜಾರಿಯಲ್ಲಿದೆ",
    loosenNews: "ನಿಮ್ಮ ಮಾಹಿತಿಗಾಗಿ: ಮಾಲೀಕರು ಇದನ್ನು ತಾವೇ, ತಮ್ಮ ಪಾಸ್‌ಕೀಯೊಂದಿಗೆ ಸಡಿಲಗೊಳಿಸಿದ್ದಾರೆ. ನಿಮಗಾಗಿ ಏನೂ ಕಾಯುತ್ತಿಲ್ಲ.", row: "{name}: {from} ರಿಂದ {to}, {how}, {by}" },
};

/** The limit's name in this language, from the shared words; an unknown id is shown as it is. */
const KIND_OF: Record<string, keyof typeof LIMIT_WORDS> = { refund_limit: "refund", waiver_limit: "waiver", big_order_limit: "bigOrder", orders_per_day: "perDay" };
const nameOf = (id: string, language: Language): string => { const k = KIND_OF[id]; return k ? LIMIT_WORDS[k].name[language] : id; };

/** The block for the shop page: nothing at all for a shop with no change yet and no limits (the list is only in status when the runtime reported one). */
export function limitChangesBlock(c: Ctx, changes: readonly LimitChangeRow[] | undefined): ReturnType<typeof html> | "" {
  if (changes === undefined) return "";
  const w = WORDS[c.lang];
  const rows = changes.slice().reverse().slice(0, 10).map((x) => {
    const line = w.row.replace("{name}", nameOf(x.limit, c.lang)).replace("{from}", String(x.from)).replace("{to}", String(x.to)).replace("{how}", x.direction === "tighten" ? w.tighten : w.loosen).replace("{by}", x.by === "owner_chat" ? w.chat : w.app);
    return html`<li><span class="mark">${x.state === "active" ? "✓" : x.state === "failed" ? "!" : "·"}</span><span>${line} · <strong>${w[x.state]}</strong>${x.why ? html` (${x.why})` : ""}<br><small class="note">${x.at.slice(0, 16).replace("T", " ")}${x.direction === "loosen" ? html` · ${w.loosenNews}` : ""}</small></span></li>`;
  });
  return html`<h2>${w.heading}</h2><p class="note">${w.note}</p>${rows.length > 0 ? html`<ul class="plain">${rows}</ul>` : html`<p class="note">${w.none}</p>`}`;
}
