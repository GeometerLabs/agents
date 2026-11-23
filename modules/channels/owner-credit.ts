// The credit book on the owner's page (templates/education/fees, the `creditBook` block; go/internal/fees credit.go): who owes what, the owner's alone; a box for the owner's own
// words ("Ramesh owes 2400", "Ramesh paid 1000", posted to /credit and read by the runtime's rules exactly as on WhatsApp); and for each account its first question's state with
// the "Ask" button that sends that first question. Drawn into owner-page.ts from what the runtime answers (backend.ts OwnerView.credit); a press is bound to the digest of the
// account as shown, so an account already asked does nothing. No script. The list names accounts by name and ref only, never by number.
//
// Decision 65 (one shop, several template parts behind one number): this is one section of its own, after the shop's other sections, so it sits beside another part's cards.
// Hindi, Malayalam and Kannada are machine-written and wait for a native reader (the Fees review sheets list them).
import { html } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { formatInr } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import type { OwnerCreditRow } from "./backend.ts";

interface Words { title: string; note: string; boxLabel: string; boxExample: string; write: string; none: string; ask: string; state: Record<"none" | "asked" | "yes" | "stopped", string> }

const W: Record<Language, Words> = {
  en: { title: "Credit book", note: "Who owes what. Only you see this list. Nothing goes to a customer until you tap Ask, and reminders start only after they say yes.", boxLabel: "Write in the book", boxExample: "Ramesh owes 2400, or Ramesh paid 1000", write: "Write", none: "Nobody is in the book yet.", ask: "Ask about reminders", state: { none: "Not asked yet", asked: "Asked: waiting for their yes", yes: "Reminders on", stopped: "Sent STOP: no messages" } },
  hi: { title: "उधार खाता", note: "किस पर कितना बाकी है। यह सूची सिर्फ़ आप देखते हैं। जब तक आप पूछें न दबाएँ, ग्राहक को कुछ नहीं जाता, और याद उनके हाँ कहने के बाद ही शुरू होती है।", boxLabel: "खाते में लिखें", boxExample: "Ramesh owes 2400, या Ramesh paid 1000", write: "लिखें", none: "खाते में अभी कोई नहीं है।", ask: "याद के बारे में पूछें", state: { none: "अभी पूछा नहीं", asked: "पूछा गया: उनके हाँ का इंतज़ार", yes: "याद चालू", stopped: "STOP भेजा: कोई संदेश नहीं" } },
  ml: { title: "കടം കണക്ക്", note: "ആര് എത്ര തരാനുണ്ട്. ഈ പട്ടിക നിങ്ങൾ മാത്രം കാണുന്നു. നിങ്ങൾ ചോദിക്കൂ അമർത്തുന്നതുവരെ ഉപഭോക്താവിന് ഒന്നും പോകില്ല, അവർ സമ്മതിച്ചതിനു ശേഷം മാത്രമേ ഓർമ്മപ്പെടുത്തലുകൾ തുടങ്ങൂ.", boxLabel: "കണക്കിൽ എഴുതുക", boxExample: "Ramesh owes 2400, അല്ലെങ്കിൽ Ramesh paid 1000", write: "എഴുതുക", none: "കണക്കിൽ ഇതുവരെ ആരുമില്ല.", ask: "ഓർമ്മപ്പെടുത്തലിനെക്കുറിച്ച് ചോദിക്കൂ", state: { none: "ഇതുവരെ ചോദിച്ചിട്ടില്ല", asked: "ചോദിച്ചു: സമ്മതത്തിനായി കാത്തിരിക്കുന്നു", yes: "ഓർമ്മപ്പെടുത്തലുകൾ ഓണാണ്", stopped: "STOP അയച്ചു: സന്ദേശങ്ങളില്ല" } },
  kn: { title: "ಸಾಲದ ಲೆಕ್ಕ", note: "ಯಾರು ಎಷ್ಟು ಕೊಡಬೇಕು. ಈ ಪಟ್ಟಿಯನ್ನು ನೀವು ಮಾತ್ರ ನೋಡುತ್ತೀರಿ. ನೀವು ಕೇಳಿ ಒತ್ತುವವರೆಗೆ ಗ್ರಾಹಕರಿಗೆ ಏನೂ ಹೋಗುವುದಿಲ್ಲ, ಅವರು ಒಪ್ಪಿದ ನಂತರವೇ ನೆನಪುಗಳು ಶುರುವಾಗುತ್ತವೆ.", boxLabel: "ಲೆಕ್ಕದಲ್ಲಿ ಬರೆಯಿರಿ", boxExample: "Ramesh owes 2400, ಅಥವಾ Ramesh paid 1000", write: "ಬರೆಯಿರಿ", none: "ಲೆಕ್ಕದಲ್ಲಿ ಇನ್ನೂ ಯಾರೂ ಇಲ್ಲ.", ask: "ನೆನಪುಗಳ ಬಗ್ಗೆ ಕೇಳಿ", state: { none: "ಇನ್ನೂ ಕೇಳಿಲ್ಲ", asked: "ಕೇಳಲಾಗಿದೆ: ಅವರ ಒಪ್ಪಿಗೆಗಾಗಿ ಕಾಯುತ್ತಿದೆ", yes: "ನೆನಪುಗಳು ಚಾಲೂ", stopped: "STOP ಕಳುಹಿಸಿದ್ದಾರೆ: ಸಂದೇಶಗಳಿಲ್ಲ" } },
};
export const OWNER_CREDIT_WORDS = W;

/** The longest words the box takes (the runtime reads one entry at a time). */
export const CREDIT_TEXT_MAX = 200;

/** `button(action, case, digest, label, quiet)` is owner-page.ts's own answer button (the form with its CSRF field); `base` and `csrf` make the box's form. */
export function creditSection(rows: OwnerCreditRow[], language: Language, base: string, csrf: string | undefined, button: (action: string, c: string, digest: string, label: string, quiet?: boolean) => Raw): Raw {
  const w = W[language];
  const box = html`<form method="post" action="${base}/credit" class="part">${csrf ? html`<input type="hidden" name="csrf" value="${csrf}">` : ""}<label>${w.boxLabel} <input name="text" type="text" maxlength="${CREDIT_TEXT_MAX}" placeholder="${w.boxExample}" required autocomplete="off"></label> <button class="yes" type="submit">${w.write}</button></form>`;
  const list = rows.length > 0
    ? rows.map((r) => html`<div class="item s-${r.stopped ? "plain" : r.consent === "yes" ? "ok" : "wait"}"><div class="top"><span class="stamp">${w.state[r.stopped ? "stopped" : r.consent]}</span>${r.amountPaise > 0 ? html`<span class="amt">${formatInr(r.amountPaise / 100)}</span>` : ""}</div><p>${r.name}</p>${r.askable ? html`<div class="acts">${button("credit_ask", r.ref, r.digest, w.ask)}</div>` : ""}</div>`)
    : html`<p class="calm">${w.none}</p>`;
  return html`<h2 id="credit-h">${w.title}</h2><p class="note">${w.note}</p>${box}${list}`;
}
