// The notes list of the owner's app (block M): what the assistant remembers, each with a delete button, in plain HTML that works without JavaScript. Pure: the page that
// shows it (modules/channels/owner-page.ts) hands in how a button posts (`button`, the same helper its cards use), so a delete is an owner_action the runtime checks against the
// owner's link or session before it reaches `assistant.onPageForget`. The owner's export is the JSON `exportNotes` (modules/memory). The wiring into the owner's page, and the
// `forget_note` owner action, are not built yet (Deferred): this is the part that is ready for them.
import type { Language } from "../../language/languages.ts";
import type { OwnerAppView } from "./view.ts";

const WORDS: Record<Language, { title: string; none: string; owner: string; everyone: string; forget: string; note: string }> = {
  en: { title: "What I remember", none: "Nothing yet. Say, for example: remember we close at 6 on Saturdays.", owner: "only you", everyone: "customers too", forget: "Forget", note: "Forgetting removes the words at once; backups age out on their own schedule." },
  hi: { title: "मुझे क्या याद है", none: "अभी कुछ नहीं। जैसे कहें: याद रखना शनिवार को 6 बजे बंद होता है।", owner: "सिर्फ़ आप", everyone: "ग्राहक भी", forget: "भूल जाओ", note: "भूलने पर शब्द तुरंत हट जाते हैं; बैकअप अपने समय पर पुराने होकर हटते हैं।" },
  ml: { title: "എനിക്ക് ഓർമ്മയുള്ളത്", none: "ഇതുവരെ ഒന്നുമില്ല. ഉദാഹരണം: remember ശനിയാഴ്ച 6-ന് അടയ്ക്കും.", owner: "നിങ്ങൾ മാത്രം", everyone: "ഉപഭോക്താക്കളും", forget: "മറക്കുക", note: "മറക്കുമ്പോൾ വാക്കുകൾ ഉടൻ നീങ്ങും; ബാക്കപ്പുകൾ അവയുടെ സമയത്ത് ഇല്ലാതാകും." },
  kn: { title: "ನನಗೆ ನೆನಪಿರುವುದು", none: "ಇನ್ನೂ ಏನೂ ಇಲ್ಲ. ಉದಾಹರಣೆಗೆ: remember ಶನಿವಾರ 6ಕ್ಕೆ ಮುಚ್ಚುತ್ತೇವೆ.", owner: "ನೀವು ಮಾತ್ರ", everyone: "ಗ್ರಾಹಕರೂ", forget: "ಮರೆತುಬಿಡಿ", note: "ಮರೆತಾಗ ಪದಗಳು ತಕ್ಷಣ ಹೋಗುತ್ತವೆ; ಬ್ಯಾಕಪ್‌ಗಳು ತಮ್ಮ ಸಮಯದಲ್ಲಿ ಇಲ್ಲವಾಗುತ್ತವೆ." },
};
const esc = (s: string) => s.replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The list section. `button(id, label)` returns the HTML of a button that posts a `forget_note` action for that note. */
export function notesSection(a: { language: Language; notes: OwnerAppView["notes"]; button: (noteId: string, label: string) => string }): string {
  const w = WORDS[a.language];
  const items = a.notes.map((n) => `<li><span class="tag">${esc(n.audience === "everyone" ? w.everyone : w.owner)}</span> ${esc(n.text)} ${a.button(n.id, w.forget)}</li>`).join("");
  return `<section class="notes" aria-labelledby="notes-h"><h2 id="notes-h">${esc(w.title)}</h2>${a.notes.length === 0 ? `<p>${esc(w.none)}</p>` : `<ul>${items}</ul>`}<p class="note">${esc(w.note)}</p></section>`;
}
