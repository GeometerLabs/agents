// Classes' private reading-material page: the files of one batch, as plain links, for a parent whose private link opens it (front-fees.ts, "<page>/m/<batch>"). Same rules as
// every customer page here: no script, nothing loaded from anywhere, no number or name beyond the students the parent already sees. The files are downloads
// (front-fees.ts sends them as attachments), and the page says how many files were left out for being larger than the centre's limit.
//
// The words are machine-written in Hindi, Malayalam and Kannada, and wait for a native reader (the Fees review sheets list them).
import { html } from "../core/html.ts";
import type { Language } from "../language/languages.ts";
import type { MaterialAnswer } from "./backend.ts";
import { layout } from "./page.ts";
import type { PageShop } from "./page.ts";
import type { FeesOffer } from "./backend.ts";

const W: Record<Language, { title: (batch: string) => string; for: (students: string) => string; none: string; left: (n: number, mb: number) => string; note: string }> = {
  en: { title: (b) => `Reading material: ${b}`, for: (s) => `For ${s}.`, none: "No files have been added yet.", left: (n, mb) => `${n} file(s) are not shown: they are larger than ${mb} MB or are a kind this page does not hand out.`, note: "Please do not share this page. It opens only while the student is in this class and the fee is paid or within its grace days." },
  hi: { title: (b) => `पढ़ने की सामग्री: ${b}`, for: (s) => `${s} के लिए।`, none: "अभी कोई फ़ाइल नहीं जोड़ी गई है।", left: (n, mb) => `${n} फ़ाइल नहीं दिखाई गईं: वे ${mb} MB से बड़ी हैं या ऐसी हैं जो यह पेज नहीं देता।`, note: "कृपया यह पेज साझा न करें। यह तभी खुलता है जब विद्यार्थी इस क्लास में हो और फीस भरी हो या छूट के दिनों के भीतर हो।" },
  ml: { title: (b) => `പഠന സാമഗ്രികൾ: ${b}`, for: (s) => `${s}-ന് വേണ്ടി.`, none: "ഇതുവരെ ഫയലുകൾ ചേർത്തിട്ടില്ല.", left: (n, mb) => `${n} ഫയൽ കാണിച്ചിട്ടില്ല: അവ ${mb} MB-യിൽ വലുതാണ്, അല്ലെങ്കിൽ ഈ പേജ് നൽകാത്ത തരമാണ്.`, note: "ദയവായി ഈ പേജ് പങ്കുവയ്ക്കരുത്. വിദ്യാർത്ഥി ഈ ക്ലാസിലുള്ളപ്പോഴും ഫീസ് അടച്ചിരിക്കുമ്പോഴോ ഇളവ് ദിവസങ്ങൾക്കുള്ളിലോ മാത്രമേ ഇത് തുറക്കൂ." },
  kn: { title: (b) => `ಓದುವ ಸಾಮಗ್ರಿ: ${b}`, for: (s) => `${s} ಅವರಿಗಾಗಿ.`, none: "ಇನ್ನೂ ಯಾವುದೇ ಫೈಲ್ ಸೇರಿಸಿಲ್ಲ.", left: (n, mb) => `${n} ಫೈಲ್ ತೋರಿಸಿಲ್ಲ: ಅವು ${mb} MB ಗಿಂತ ದೊಡ್ಡವು ಅಥವಾ ಈ ಪುಟ ನೀಡದ ಪ್ರಕಾರದವು.`, note: "ದಯವಿಟ್ಟು ಈ ಪುಟವನ್ನು ಹಂಚಿಕೊಳ್ಳಬೇಡಿ. ವಿದ್ಯಾರ್ಥಿ ಈ ತರಗತಿಯಲ್ಲಿದ್ದು ಶುಲ್ಕ ಪಾವತಿಸಿದ್ದರೆ ಅಥವಾ ರಿಯಾಯಿತಿ ದಿನಗಳ ಒಳಗಿದ್ದರೆ ಮಾತ್ರ ಇದು ತೆರೆಯುತ್ತದೆ." },
};
export const MATERIAL_PAGE_WORDS = W;

/** `base` is the page's address up to the batch ("<page>/f/<link>/m/<batch>"): each file is `<base>/<id>`. */
export function materialPage(o: { shop: PageShop; offer: FeesOffer; language: Language; base: string; view: Extract<MaterialAnswer, { kind: "list" }> }): string {
  const w = W[o.language];
  const v = o.view;
  const list = v.files.length > 0
    ? html`<ul class="list">${v.files.map((f) => html`<li class="card"><a href="${o.base}/${f.id}?lang=${o.language}">${f.name}</a> <small class="note">${Math.max(1, Math.round(f.bytes / 1024))} KB</small></li>`)}</ul>`
    : html`<p class="card">${w.none}</p>`;
  return layout({ shop: o.offer.shop, language: o.language, title: w.title(v.batch[o.language]), selfPath: o.base, body: html`<h2>${w.title(v.batch[o.language])}</h2><p>${w.for(v.students.join(", "))}</p>${list}${v.left > 0 ? html`<p class="note">${w.left(v.left, v.maxMb)}</p>` : ""}<p class="note private">${w.note}</p>` });
}
