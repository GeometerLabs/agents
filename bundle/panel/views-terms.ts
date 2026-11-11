// The shop terms page (B72, 12 Nov 2026): the partner enters their name, number and the two prices, sees the exact text the owner will get on WhatsApp, sees whether it was
// sent and agreed, and downloads the copy once the owner agreed. Plain forms and links, no script. The few panel words here are in four languages, Hindi, Malayalam and Kannada
// machine-written and waiting for a native reader like the rest of the panel's. The page always says that signed paper is still what Geometer's guides tell a partner to use.
import type { Language } from "../../modules/language/languages.ts";
import type { TermsFile } from "../../modules/terms/terms.ts";
import { html } from "./html.ts";
import { layout } from "./views.ts";
import type { Ctx } from "./views.ts";
import type { TermsState } from "./terms.ts";

interface Words { title: string; link: string; paper: string; intro: string; partner: string; phone: string; monthly: string; setup: string; save: string; bad: string; details: string; ready: string; sent: string; agreed: string; changed: string; copy: string; preview: string; how: string }

const WORDS: Record<Language, Words> = {
  en: { title: "Shop terms on WhatsApp", link: "Shop terms on WhatsApp", paper: "Signed paper is still what Geometer's sell guides tell you to use. Agreeing on WhatsApp has not had its legal check yet.", intro: "The owner reads the terms on WhatsApp in their own language and agrees there. Fill in your details and the price you agreed with the shop.", partner: "Your name", phone: "Your phone number", monthly: "Monthly price (rupees)", setup: "Set-up price, once (rupees)", save: "Save", bad: "Check the details: a name, a phone number, and whole rupees for both prices.", details: "Fill in your details below to prepare the terms.", ready: "Ready. Ask the owner to send the word “terms” to the shop's WhatsApp number from their own phone, and then “I agree”.", sent: "The terms were sent to the owner. Waiting for “I agree”.", agreed: "The owner agreed to exactly this text. It is recorded in the shop's record.", changed: "The owner agreed to an older text. The terms changed since, so they must be sent and agreed again.", copy: "Download the copy", preview: "The text the owner gets", how: "How it works" },
  hi: { title: "WhatsApp पर दुकान की शर्तें", link: "WhatsApp पर दुकान की शर्तें", paper: "Geometer की बिक्री गाइड अब भी हस्ताक्षर वाला काग़ज़ इस्तेमाल करने को कहती है। WhatsApp पर सहमति की क़ानूनी जाँच अभी नहीं हुई है।", intro: "मालिक WhatsApp पर अपनी भाषा में शर्तें पढ़ते हैं और वहीं सहमत होते हैं। अपना विवरण और दुकान से तय हुई कीमत भरिए।", partner: "आपका नाम", phone: "आपका फ़ोन नंबर", monthly: "मासिक कीमत (रुपये)", setup: "सेटअप की कीमत, एक बार (रुपये)", save: "सेव करें", bad: "विवरण जाँचिए: नाम, फ़ोन नंबर और दोनों कीमतें पूरे रुपयों में।", details: "शर्तें तैयार करने के लिए नीचे अपना विवरण भरिए।", ready: "तैयार। मालिक से कहिए कि अपने फ़ोन से दुकान के WhatsApp नंबर पर “शर्तें” भेजें, फिर “मैं सहमत हूँ”।", sent: "शर्तें मालिक को भेज दी गईं। “मैं सहमत हूँ” का इंतज़ार है।", agreed: "मालिक ठीक इसी पाठ से सहमत हुए। यह दुकान के रिकॉर्ड में दर्ज है।", changed: "मालिक पुराने पाठ से सहमत हुए थे। शर्तें बदल गई हैं, इसलिए उन्हें फिर भेजना और सहमति लेना होगा।", copy: "प्रति डाउनलोड करें", preview: "मालिक को जो पाठ मिलता है", how: "यह कैसे चलता है" },
  ml: { title: "WhatsApp-ൽ കടയുടെ നിബന്ധനകൾ", link: "WhatsApp-ൽ കടയുടെ നിബന്ധനകൾ", paper: "ഒപ്പിട്ട കടലാസ് തന്നെയാണ് Geometer-ന്റെ വിൽപ്പന ഗൈഡുകൾ ഇപ്പോഴും പറയുന്നത്. WhatsApp-ൽ സമ്മതിക്കുന്നതിന് നിയമപരിശോധന ഇതുവരെ നടന്നിട്ടില്ല.", intro: "ഉടമ WhatsApp-ൽ സ്വന്തം ഭാഷയിൽ നിബന്ധനകൾ വായിച്ച് അവിടെ സമ്മതിക്കുന്നു. നിങ്ങളുടെ വിവരങ്ങളും കടയുമായി സമ്മതിച്ച വിലയും നൽകൂ.", partner: "നിങ്ങളുടെ പേര്", phone: "നിങ്ങളുടെ ഫോൺ നമ്പർ", monthly: "മാസ വില (രൂപ)", setup: "സെറ്റപ്പ് വില, ഒരിക്കൽ (രൂപ)", save: "സേവ് ചെയ്യുക", bad: "വിവരങ്ങൾ പരിശോധിക്കൂ: പേര്, ഫോൺ നമ്പർ, രണ്ട് വിലയും മുഴുവൻ രൂപയിൽ.", details: "നിബന്ധനകൾ തയ്യാറാക്കാൻ താഴെ നിങ്ങളുടെ വിവരങ്ങൾ നൽകൂ.", ready: "തയ്യാർ. ഉടമയോട് സ്വന്തം ഫോണിൽ നിന്ന് കടയുടെ WhatsApp നമ്പറിലേക്ക് “നിബന്ധനകൾ” എന്നും പിന്നെ “ഞാൻ സമ്മതിക്കുന്നു” എന്നും അയയ്ക്കാൻ പറയൂ.", sent: "നിബന്ധനകൾ ഉടമയ്ക്ക് അയച്ചു. “ഞാൻ സമ്മതിക്കുന്നു” കാത്തിരിക്കുന്നു.", agreed: "ഉടമ ഈ വാചകത്തോട് തന്നെ സമ്മതിച്ചു. ഇത് കടയുടെ രേഖയിൽ ചേർത്തിട്ടുണ്ട്.", changed: "ഉടമ പഴയ വാചകത്തോടാണ് സമ്മതിച്ചത്. നിബന്ധനകൾ മാറിയതിനാൽ വീണ്ടും അയച്ച് സമ്മതം വാങ്ങണം.", copy: "പകർപ്പ് ഡൗൺലോഡ് ചെയ്യുക", preview: "ഉടമയ്ക്ക് ലഭിക്കുന്ന വാചകം", how: "ഇത് എങ്ങനെ പ്രവർത്തിക്കുന്നു" },
  kn: { title: "WhatsApp ನಲ್ಲಿ ಅಂಗಡಿಯ ನಿಯಮಗಳು", link: "WhatsApp ನಲ್ಲಿ ಅಂಗಡಿಯ ನಿಯಮಗಳು", paper: "Geometer ನ ಮಾರಾಟ ಮಾರ್ಗದರ್ಶಿಗಳು ಈಗಲೂ ಸಹಿ ಮಾಡಿದ ಕಾಗದ ಬಳಸಲು ಹೇಳುತ್ತವೆ. WhatsApp ನಲ್ಲಿ ಒಪ್ಪಿಗೆಗೆ ಕಾನೂನು ಪರಿಶೀಲನೆ ಇನ್ನೂ ಆಗಿಲ್ಲ.", intro: "ಮಾಲೀಕರು WhatsApp ನಲ್ಲಿ ತಮ್ಮ ಭಾಷೆಯಲ್ಲಿ ನಿಯಮಗಳನ್ನು ಓದಿ ಅಲ್ಲಿಯೇ ಒಪ್ಪುತ್ತಾರೆ. ನಿಮ್ಮ ವಿವರ ಮತ್ತು ಅಂಗಡಿಯೊಂದಿಗೆ ಒಪ್ಪಿದ ಬೆಲೆಯನ್ನು ಭರ್ತಿ ಮಾಡಿ.", partner: "ನಿಮ್ಮ ಹೆಸರು", phone: "ನಿಮ್ಮ ಫೋನ್ ಸಂಖ್ಯೆ", monthly: "ತಿಂಗಳ ಬೆಲೆ (ರೂಪಾಯಿ)", setup: "ಸೆಟಪ್ ಬೆಲೆ, ಒಮ್ಮೆ (ರೂಪಾಯಿ)", save: "ಸೇವ್ ಮಾಡಿ", bad: "ವಿವರ ಪರಿಶೀಲಿಸಿ: ಹೆಸರು, ಫೋನ್ ಸಂಖ್ಯೆ ಮತ್ತು ಎರಡೂ ಬೆಲೆ ಪೂರ್ಣ ರೂಪಾಯಿಗಳಲ್ಲಿ.", details: "ನಿಯಮಗಳನ್ನು ಸಿದ್ಧಪಡಿಸಲು ಕೆಳಗೆ ನಿಮ್ಮ ವಿವರ ಭರ್ತಿ ಮಾಡಿ.", ready: "ಸಿದ್ಧ. ಮಾಲೀಕರು ತಮ್ಮ ಫೋನ್‌ನಿಂದ ಅಂಗಡಿಯ WhatsApp ಸಂಖ್ಯೆಗೆ “ನಿಯಮಗಳು” ಮತ್ತು ನಂತರ “ನಾನು ಒಪ್ಪುತ್ತೇನೆ” ಎಂದು ಕಳುಹಿಸಲಿ.", sent: "ನಿಯಮಗಳನ್ನು ಮಾಲೀಕರಿಗೆ ಕಳುಹಿಸಲಾಗಿದೆ. “ನಾನು ಒಪ್ಪುತ್ತೇನೆ” ಗಾಗಿ ಕಾಯುತ್ತಿದೆ.", agreed: "ಮಾಲೀಕರು ಇದೇ ಪಠ್ಯಕ್ಕೆ ಒಪ್ಪಿದ್ದಾರೆ. ಇದು ಅಂಗಡಿಯ ದಾಖಲೆಯಲ್ಲಿ ದಾಖಲಾಗಿದೆ.", changed: "ಮಾಲೀಕರು ಹಳೆಯ ಪಠ್ಯಕ್ಕೆ ಒಪ್ಪಿದ್ದರು. ನಿಯಮಗಳು ಬದಲಾಗಿವೆ, ಆದ್ದರಿಂದ ಮತ್ತೆ ಕಳುಹಿಸಿ ಒಪ್ಪಿಗೆ ಪಡೆಯಬೇಕು.", copy: "ಪ್ರತಿ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ", preview: "ಮಾಲೀಕರಿಗೆ ಸಿಗುವ ಪಠ್ಯ", how: "ಇದು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ" },
};

export const termsLinkWord = (lang: Language): string => WORDS[lang].link;

export function termsPage(c: Ctx, o: { id: string; name: string; state: TermsState; file?: TermsFile; problem?: boolean }): string {
  const p = WORDS[c.lang];
  const s = o.state;
  const say = s.state === "details" ? p.details : s.state === "ready" ? p.ready : s.state === "sent" ? p.sent : s.state === "agreed" ? p.agreed : p.changed;
  return layout(c, p.title, html`<h1>${p.title}</h1>
<p class="big">${o.name}</p>
<div class="notice" role="note">${p.paper}</div>
${o.problem ? html`<ul class="errors" role="alert"><li>${p.bad}</li></ul>` : ""}
<p>${p.intro}</p>
<form method="post" action="/shops/${o.id}/terms" autocomplete="off">${html`<input type="hidden" name="_csrf" value="${c.csrf}">`}
  <label class="field"><span>${p.partner}</span><input name="partnerName" value="${o.file?.partnerName ?? ""}" maxlength="60" required></label>
  <label class="field"><span>${p.phone}</span><input name="partnerPhone" value="${o.file?.partnerPhone ?? ""}" inputmode="tel" maxlength="30" required></label>
  <label class="field"><span>${p.monthly}</span><input name="monthlyInr" value="${o.file ? String(o.file.monthlyInr) : ""}" inputmode="numeric" maxlength="8" required></label>
  <label class="field"><span>${p.setup}</span><input name="setupInr" value="${o.file ? String(o.file.setupInr) : ""}" inputmode="numeric" maxlength="8" required></label>
  <button class="btn primary" type="submit">${p.save}</button></form>
<div class="notice" role="status">${say}</div>
${s.state === "agreed" ? html`<p><a class="btn primary" href="/shops/${o.id}/terms/copy.txt">${p.copy}</a></p>` : ""}
${s.state !== "details" ? html`<h2>${p.preview}</h2><pre class="addr" style="white-space:pre-wrap">${s.text}</pre>` : ""}
<p><a href="/shops/${o.id}">${c.w.common.back}</a></p>`);
}
