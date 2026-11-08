// The papers page of one shop (B28, B35, B36): the record of one case, a person's statement, the agent's identity paper (full and public) and the record as an
// evidence pack. Plain forms and links, no script. The paper titles are the papers' own words (modules/papers/words.ts); the few panel words here are in four
// languages, Hindi, Malayalam and Kannada machine-written and waiting for native review like the rest of the panel's.
import type { Language } from "../../modules/language/languages.ts";
import { WORDS } from "../../modules/papers/words.ts";
import { html } from "./html.ts";
import { layout } from "./views.ts";
import type { Ctx } from "./views.ts";

const PANEL_WORDS: Record<Language, { title: (shop: string) => string; intro: string; case: string; number: string; numberNote: string; open: string; signed: string; ledger: string; ledgerNote: string; publicNote: string; noCases: string }> = {
  en: { title: (s) => `Papers for ${s}`, intro: "Each paper is signed, carries a check code, and lists what it did not check. None of them says who is right.", case: "Case", number: "WhatsApp number",
    numberNote: "The number is used to find this person's own payments and is not kept.", open: "Open the page", signed: "Signed file (.json)", ledger: "The record as an evidence pack",
    ledgerNote: "For geo-verify, the open checker: geo-verify pack.json --anchor anchor.json", publicNote: "The public paper shows only the fields you chose.", noCases: "No cases in the record yet." },
  hi: { title: (s) => `${s} के काग़ज़`, intro: "हर काग़ज़ पर हस्ताक्षर और जाँच कोड है, और वह बताता है कि उसने क्या नहीं जाँचा। कोई भी यह नहीं बताता कि कौन सही है।", case: "मामला", number: "WhatsApp नंबर",
    numberNote: "नंबर से सिर्फ़ इस व्यक्ति के अपने भुगतान ढूँढे जाते हैं; उसे रखा नहीं जाता।", open: "पेज खोलें", signed: "हस्ताक्षर वाली फ़ाइल (.json)", ledger: "रिकॉर्ड, सबूत पैक के रूप में",
    ledgerNote: "खुले जाँचने वाले geo-verify के लिए: geo-verify pack.json --anchor anchor.json", publicNote: "सार्वजनिक काग़ज़ में सिर्फ़ वही है जो आपने चुना।", noCases: "रिकॉर्ड में अभी कोई मामला नहीं है।" },
  ml: { title: (s) => `${s} ന്റെ രേഖകൾ`, intro: "ഓരോ രേഖയിലും ഒപ്പും പരിശോധനാ കോഡും ഉണ്ട്, അത് എന്ത് പരിശോധിച്ചില്ലെന്നും പറയുന്നു. ആരാണ് ശരിയെന്ന് ഒന്നും പറയുന്നില്ല.", case: "കേസ്", number: "WhatsApp നമ്പർ",
    numberNote: "ഈ ആളുടെ സ്വന്തം പണമടവുകൾ കണ്ടെത്താൻ മാത്രം നമ്പർ ഉപയോഗിക്കുന്നു; അത് സൂക്ഷിക്കുന്നില്ല.", open: "പേജ് തുറക്കുക", signed: "ഒപ്പിട്ട ഫയൽ (.json)", ledger: "തെളിവ് പായ്ക്കായി രേഖ",
    ledgerNote: "തുറന്ന പരിശോധകൻ geo-verify-ക്ക്: geo-verify pack.json --anchor anchor.json", publicNote: "പൊതു രേഖയിൽ നിങ്ങൾ തിരഞ്ഞെടുത്തവ മാത്രം.", noCases: "രേഖയിൽ ഇതുവരെ കേസുകളില്ല." },
  kn: { title: (s) => `${s} ನ ಕಾಗದಗಳು`, intro: "ಪ್ರತಿ ಕಾಗದಕ್ಕೂ ಸಹಿ ಮತ್ತು ಪರಿಶೀಲನಾ ಕೋಡ್ ಇದೆ, ಅದು ಏನನ್ನು ಪರಿಶೀಲಿಸಲಿಲ್ಲ ಎಂದೂ ಹೇಳುತ್ತದೆ. ಯಾರು ಸರಿ ಎಂದು ಯಾವುದೂ ಹೇಳುವುದಿಲ್ಲ.", case: "ಪ್ರಕರಣ", number: "WhatsApp ಸಂಖ್ಯೆ",
    numberNote: "ಈ ವ್ಯಕ್ತಿಯ ಸ್ವಂತ ಪಾವತಿಗಳನ್ನು ಹುಡುಕಲು ಮಾತ್ರ ಸಂಖ್ಯೆ ಬಳಸಲಾಗುತ್ತದೆ; ಅದನ್ನು ಇಡುವುದಿಲ್ಲ.", open: "ಪುಟ ತೆರೆಯಿರಿ", signed: "ಸಹಿ ಇರುವ ಫೈಲ್ (.json)", ledger: "ಸಾಕ್ಷ್ಯ ಪ್ಯಾಕ್ ಆಗಿ ದಾಖಲೆ",
    ledgerNote: "ತೆರೆದ ಪರಿಶೀಲಕ geo-verify ಗೆ: geo-verify pack.json --anchor anchor.json", publicNote: "ಸಾರ್ವಜನಿಕ ಕಾಗದದಲ್ಲಿ ನೀವು ಆರಿಸಿದ್ದು ಮಾತ್ರ.", noCases: "ದಾಖಲೆಯಲ್ಲಿ ಇನ್ನೂ ಪ್ರಕರಣಗಳಿಲ್ಲ." },
};

export function papersPage(c: Ctx, o: { id: string; name: string; cases: string[]; problem?: string }): string {
  const p = PANEL_WORDS[c.lang];
  const w = WORDS[c.lang];
  const base = `/shops/${o.id}/papers`;
  return layout(c, p.title(o.name), html`<h1>${p.title(o.name)}</h1>
<p class="big">${p.intro}</p>
${o.problem ? html`<div class="notice">${o.problem}</div>` : ""}
<h2>${w.dispute.title}</h2>
${o.cases.length === 0 ? html`<p class="note">${p.noCases}</p>` : html`<form method="get" action="${base}/case"><label class="field">${p.case} <select name="case">${o.cases.map((id) => html`<option value="${id}">${id}</option>`)}</select></label>
<button class="btn primary" type="submit" name="as" value="html">${p.open}</button> <button class="btn" type="submit" name="as" value="json">${p.signed}</button></form>`}
<h2>${w.statement.title}</h2>
<form method="post" action="${base}/statement"><input type="hidden" name="_csrf" value="${c.csrf}"><label class="field">${p.number} <input name="number" inputmode="tel" autocomplete="off" required></label>
<p class="note">${p.numberNote}</p><button class="btn primary" type="submit" name="as" value="html">${p.open}</button> <button class="btn" type="submit" name="as" value="json">${p.signed}</button></form>
<h2>${w.identity.title}</h2>
<p><a class="btn primary" href="${base}/identity.html">${p.open}</a> <a class="btn" href="${base}/identity.json">${p.signed}</a></p>
<p class="note">${p.publicNote}</p><p><a class="btn" href="${base}/identity-public.html">${p.open}</a> <a class="btn" href="${base}/identity-public.json">${p.signed}</a></p>
<h2>${p.ledger}</h2>
<p><a class="btn" href="${base}/ledger/pack.json">pack.json</a> <a class="btn" href="${base}/ledger/anchor.json">anchor.json</a></p><p class="note">${p.ledgerNote}</p>
<p><a href="/shops/${o.id}">${c.w.common.back}</a></p>`);
}
