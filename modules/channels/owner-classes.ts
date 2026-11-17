// Classes on the owner's page: the classes waiting for attendance, each student with a "Missed" button and one "Everyone else came" button (the teacher's one tap), and the
// doubts waiting, each with "Answered". Drawn into owner-page.ts from what the runtime answers (backend.ts OwnerView.classes); every press is bound to the digest of what is
// shown (templates/education/fees/src/classes/view.ts), so a class already confirmed or a doubt already answered does nothing. No script.
// Hindi, Malayalam and Kannada are machine-written and wait for a native reader (the Fees review sheets list them).
import { html } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { formatSlot } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import type { OwnerClassesView } from "./backend.ts";

const W: Record<Language, { title: string; note: string; classLine: (batch: string, when: string) => string; missed: string; undo: string; came: string; doubts: string; answered: string; none: string }> = {
  en: { title: "Classes", note: "Mark who missed, then tap Everyone else came. Parents of those who missed get a short note only after you tap.", classLine: (b, w) => `${b}, ${w}`, missed: "Missed", undo: "Marked missed: tap to undo", came: "Everyone else came", doubts: "Doubts from students", answered: "Answered", none: "No class is waiting for attendance." },
  hi: { title: "क्लास", note: "जो नहीं आए उन्हें चुनें, फिर बाकी सब आए दबाएँ। नहीं आने वालों के अभिभावकों को छोटा नोट आपके दबाने के बाद ही जाता है।", classLine: (b, w) => `${b}, ${w}`, missed: "नहीं आया", undo: "नहीं आया चुना: हटाने के लिए दबाएँ", came: "बाकी सब आए", doubts: "विद्यार्थियों के डाउट", answered: "जवाब दे दिया", none: "किसी क्लास की उपस्थिति बाकी नहीं है।" },
  ml: { title: "ക്ലാസുകൾ", note: "വരാത്തവരെ അടയാളപ്പെടുത്തി, പിന്നെ ബാക്കി എല്ലാവരും വന്നു എന്നത് അമർത്തുക. വരാത്തവരുടെ രക്ഷിതാക്കൾക്ക് നിങ്ങൾ അമർത്തിയ ശേഷം മാത്രം ചെറിയ കുറിപ്പ് പോകും.", classLine: (b, w) => `${b}, ${w}`, missed: "വന്നില്ല", undo: "വന്നില്ല എന്ന് അടയാളപ്പെടുത്തി: മാറ്റാൻ അമർത്തുക", came: "ബാക്കി എല്ലാവരും വന്നു", doubts: "വിദ്യാർത്ഥികളുടെ സംശയങ്ങൾ", answered: "മറുപടി നൽകി", none: "ഒരു ക്ലാസിനും ഹാജർ ബാക്കിയില്ല." },
  kn: { title: "ತರಗತಿಗಳು", note: "ಬರದವರನ್ನು ಗುರುತಿಸಿ, ನಂತರ ಉಳಿದವರೆಲ್ಲ ಬಂದರು ಒತ್ತಿ. ಬರದವರ ಪೋಷಕರಿಗೆ ನೀವು ಒತ್ತಿದ ನಂತರ ಮಾತ್ರ ಸಣ್ಣ ಟಿಪ್ಪಣಿ ಹೋಗುತ್ತದೆ.", classLine: (b, w) => `${b}, ${w}`, missed: "ಬರಲಿಲ್ಲ", undo: "ಬರಲಿಲ್ಲ ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ: ಬದಲಿಸಲು ಒತ್ತಿ", came: "ಉಳಿದವರೆಲ್ಲ ಬಂದರು", doubts: "ವಿದ್ಯಾರ್ಥಿಗಳ ಸಂದೇಹಗಳು", answered: "ಉತ್ತರಿಸಲಾಗಿದೆ", none: "ಯಾವ ತರಗತಿಗೂ ಹಾಜರಾತಿ ಬಾಕಿ ಇಲ್ಲ." },
};
export const OWNER_CLASSES_WORDS = W;

/** `button(action, case, digest, label, quiet)` is owner-page.ts's own answer button (the form with its CSRF field). */
export function classesSection(v: OwnerClassesView, language: Language, timeZone: string, button: (action: string, c: string, digest: string, label: string, quiet?: boolean) => Raw): Raw {
  const w = W[language];
  const classes = v.pending.length > 0
    ? v.pending.map((c) => html`<div class="item s-wait"><p>${w.classLine(c.batch[language], formatSlot(c.startMs, timeZone, language))}</p><div class="acts">${c.students.map((s) => button("absent", `${c.case}.${s.n}`, c.digest, `${s.n}. ${s.name}: ${s.missed ? w.undo : w.missed}`, !s.missed))}</div><div class="acts">${button("present", c.case, c.digest, w.came)}</div></div>`)
    : html`<p class="calm">${w.none}</p>`;
  const doubts = v.doubts.length > 0 ? html`<h3>${w.doubts}</h3>${v.doubts.map((d) => html`<div class="item s-info"><p>${d.student} (${d.batch[language]}): ${d.text}</p><div class="acts">${button("answered", d.case, d.digest, w.answered, true)}</div></div>`)}` : "";
  return html`<h2>${w.title}</h2><p class="note">${w.note}</p>${classes}${doubts}`;
}
