// The shop's parts page (decision 65): which template parts the shop runs behind its one number, a form to add one (its own settings, started from its template's example),
// and a button to take one out. Plain forms, no script. The rules are bundle/panel/parts.ts; what it says when it refuses comes from there. The few words here are in four
// languages, Hindi, Malayalam and Kannada machine-written and waiting for a native reader like the rest of the panel's.
import type { Language } from "../../modules/language/languages.ts";
import { html } from "./html.ts";
import { layout } from "./views.ts";
import type { Ctx } from "./views.ts";

interface Words { title: string; link: string; intro: string; runs: string; add: string; addButton: string; settings: string; settingsNote: string; remove: string; carried: string; limit: (n: number) => string; none: string; saved: string; problems: string; names: Record<string, string> }

const NAMES_EN = { fees: "Fees or the credit book", orders: "Orders or the pickup hold", "stock-orders": "Stock orders (supplier reorders)" };
const WORDS: Record<Language, Words> = {
  en: { title: "The shop's parts", link: "Parts of this shop", intro: "One shop can run several parts behind its one WhatsApp number and its one assistant. The owner never chooses a part: the shop reads each message and hands it to the part it belongs to, and asks when it cannot tell.", runs: "This shop runs", add: "Add a part", addButton: "Add the part", settings: "The part's own settings (JSON)", settingsNote: "Only the part's own keys: the shop's name, time zone, languages, owner and assistant are the shop's, set once.", remove: "Take this part out", carried: "the part the shop was before it had parts", limit: (n) => `The shop's plan allows ${n} parts.`, none: "Every part a shop can run is here already.", saved: "Saved. The next deploy runs the shop with its new parts.", problems: "Not saved:", names: NAMES_EN },
  hi: { title: "दुकान के हिस्से", link: "इस दुकान के हिस्से", intro: "एक दुकान अपने एक WhatsApp नंबर और एक सहायक के पीछे कई हिस्से चला सकती है। मालिक कभी हिस्सा नहीं चुनते: दुकान हर संदेश पढ़कर उसे उसके हिस्से को देती है, और जब तय न कर पाए तो पूछती है।", runs: "यह दुकान चलाती है", add: "हिस्सा जोड़ें", addButton: "हिस्सा जोड़ें", settings: "हिस्से की अपनी सेटिंग्स (JSON)", settingsNote: "सिर्फ़ हिस्से की अपनी चीज़ें: दुकान का नाम, समय क्षेत्र, भाषाएँ, मालिक और सहायक दुकान के हैं, एक बार तय।", remove: "यह हिस्सा हटाएँ", carried: "वह हिस्सा जो दुकान हिस्सों से पहले थी", limit: (n) => `दुकान का प्लान ${n} हिस्सों की अनुमति देता है।`, none: "दुकान जो भी हिस्सा चला सकती है, सब यहाँ पहले से हैं।", saved: "सेव हो गया। अगली डिप्लॉय दुकान को नए हिस्सों के साथ चलाएगी।", problems: "सेव नहीं हुआ:", names: { fees: "फ़ीस या उधार खाता", orders: "ऑर्डर या सामान रखवाना", "stock-orders": "स्टॉक ऑर्डर (सप्लायर से दोबारा मँगाना)" } },
  ml: { title: "കടയുടെ ഭാഗങ്ങൾ", link: "ഈ കടയുടെ ഭാഗങ്ങൾ", intro: "ഒരു കടയ്ക്ക് അതിന്റെ ഒരേ WhatsApp നമ്പറിനും ഒരേ സഹായിക്കും പിന്നിൽ പല ഭാഗങ്ങൾ നടത്താം. ഉടമ ഒരിക്കലും ഭാഗം തിരഞ്ഞെടുക്കുന്നില്ല: കട ഓരോ സന്ദേശവും വായിച്ച് അതിന്റെ ഭാഗത്തിന് നൽകുന്നു, തീരുമാനിക്കാനാകാത്തപ്പോൾ ചോദിക്കുന്നു.", runs: "ഈ കട നടത്തുന്നത്", add: "ഭാഗം ചേർക്കുക", addButton: "ഭാഗം ചേർക്കുക", settings: "ഭാഗത്തിന്റെ സ്വന്തം ക്രമീകരണങ്ങൾ (JSON)", settingsNote: "ഭാഗത്തിന്റെ സ്വന്തം കാര്യങ്ങൾ മാത്രം: കടയുടെ പേര്, സമയമേഖല, ഭാഷകൾ, ഉടമ, സഹായി എന്നിവ കടയുടേതാണ്, ഒരിക്കൽ മാത്രം.", remove: "ഈ ഭാഗം നീക്കുക", carried: "ഭാഗങ്ങൾ വരുന്നതിനു മുമ്പ് കട ആയിരുന്ന ഭാഗം", limit: (n) => `കടയുടെ പ്ലാൻ ${n} ഭാഗങ്ങൾ അനുവദിക്കുന്നു.`, none: "ഒരു കടയ്ക്ക് നടത്താവുന്ന എല്ലാ ഭാഗങ്ങളും ഇവിടെ ഇതിനകം ഉണ്ട്.", saved: "സേവ് ചെയ്തു. അടുത്ത ഡിപ്ലോയ് കടയെ പുതിയ ഭാഗങ്ങളോടെ നടത്തും.", problems: "സേവ് ചെയ്തില്ല:", names: { fees: "ഫീസ് അല്ലെങ്കിൽ കടം കണക്ക്", orders: "ഓർഡറുകൾ അല്ലെങ്കിൽ സാധനം മാറ്റിവയ്ക്കൽ", "stock-orders": "സ്റ്റോക്ക് ഓർഡറുകൾ (വിതരണക്കാരിൽ നിന്ന് വീണ്ടും)" } },
  kn: { title: "ಅಂಗಡಿಯ ಭಾಗಗಳು", link: "ಈ ಅಂಗಡಿಯ ಭಾಗಗಳು", intro: "ಒಂದು ಅಂಗಡಿ ತನ್ನ ಒಂದೇ WhatsApp ಸಂಖ್ಯೆ ಮತ್ತು ಒಂದೇ ಸಹಾಯಕನ ಹಿಂದೆ ಹಲವು ಭಾಗಗಳನ್ನು ನಡೆಸಬಹುದು. ಮಾಲೀಕರು ಎಂದೂ ಭಾಗ ಆರಿಸುವುದಿಲ್ಲ: ಅಂಗಡಿ ಪ್ರತಿ ಸಂದೇಶ ಓದಿ ಅದರ ಭಾಗಕ್ಕೆ ಕೊಡುತ್ತದೆ, ತಿಳಿಯದಿದ್ದಾಗ ಕೇಳುತ್ತದೆ.", runs: "ಈ ಅಂಗಡಿ ನಡೆಸುವುದು", add: "ಭಾಗ ಸೇರಿಸಿ", addButton: "ಭಾಗ ಸೇರಿಸಿ", settings: "ಭಾಗದ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳು (JSON)", settingsNote: "ಭಾಗದ ಸ್ವಂತ ವಿಷಯಗಳು ಮಾತ್ರ: ಅಂಗಡಿಯ ಹೆಸರು, ಸಮಯ ವಲಯ, ಭಾಷೆಗಳು, ಮಾಲೀಕರು ಮತ್ತು ಸಹಾಯಕ ಅಂಗಡಿಯವು, ಒಮ್ಮೆ ಮಾತ್ರ.", remove: "ಈ ಭಾಗ ತೆಗೆಯಿರಿ", carried: "ಭಾಗಗಳು ಬರುವ ಮೊದಲು ಅಂಗಡಿ ಆಗಿದ್ದ ಭಾಗ", limit: (n) => `ಅಂಗಡಿಯ ಯೋಜನೆ ${n} ಭಾಗಗಳನ್ನು ಅನುಮತಿಸುತ್ತದೆ.`, none: "ಅಂಗಡಿ ನಡೆಸಬಹುದಾದ ಎಲ್ಲ ಭಾಗಗಳು ಇಲ್ಲಿ ಈಗಾಗಲೇ ಇವೆ.", saved: "ಸೇವ್ ಆಯಿತು. ಮುಂದಿನ ಡಿಪ್ಲಾಯ್ ಅಂಗಡಿಯನ್ನು ಹೊಸ ಭಾಗಗಳೊಂದಿಗೆ ನಡೆಸುತ್ತದೆ.", problems: "ಸೇವ್ ಆಗಲಿಲ್ಲ:", names: { fees: "ಶುಲ್ಕ ಅಥವಾ ಸಾಲದ ಲೆಕ್ಕ", orders: "ಆರ್ಡರ್ ಅಥವಾ ವಸ್ತು ಕಾಯ್ದಿರಿಸುವಿಕೆ", "stock-orders": "ಸ್ಟಾಕ್ ಆರ್ಡರ್ (ಪೂರೈಕೆದಾರರಿಂದ ಮರು ಆರ್ಡರ್)" } },
};

export const partsLinkWord = (lang: Language): string => WORDS[lang].link;

export interface PartsPageView { id: string; name: string; parts: string[]; carried?: string; addable: { part: string; block: string }[]; limit?: number; saved?: boolean; problems?: string[] }

export function partsPage(c: Ctx, v: PartsPageView): string {
  const p = WORDS[c.lang];
  const nameOf = (part: string): string => p.names[part] ?? part;
  const csrf = html`<input type="hidden" name="_csrf" value="${c.csrf}">`;
  return layout(c, p.title, html`<h1>${p.title}</h1>
<p class="big">${v.name}</p>
<p>${p.intro}</p>
${v.saved ? html`<div class="notice" role="status">${p.saved}</div>` : ""}
${v.problems && v.problems.length > 0 ? html`<div class="errors" role="alert"><p>${p.problems}</p><ul>${v.problems.map((x) => html`<li>${x}</li>`)}</ul></div>` : ""}
<h2>${p.runs}</h2>
<ul>${v.parts.map((part) => html`<li>${nameOf(part)}${v.carried === part ? html` (${p.carried})` : ""}${v.parts.length > 1 && v.carried !== part ? html` <form method="post" action="/shops/${v.id}/parts/remove" class="inline">${csrf}<input type="hidden" name="part" value="${part}"><button class="btn" type="submit">${p.remove}</button></form>` : ""}</li>`)}</ul>
${v.limit !== undefined ? html`<p>${p.limit(v.limit)}</p>` : ""}
<h2>${p.add}</h2>
${v.addable.length === 0 ? html`<p>${p.none}</p>` : v.addable.map((a) => html`<form method="post" action="/shops/${v.id}/parts/add" autocomplete="off">${csrf}<input type="hidden" name="part" value="${a.part}">
  <h3>${nameOf(a.part)}</h3>
  <label class="field"><span>${p.settings}</span><textarea name="block" rows="12" spellcheck="false">${a.block}</textarea></label>
  <p class="hint">${p.settingsNote}</p>
  <button class="btn primary" type="submit">${p.addButton}</button></form>`)}
<p><a href="/shops/${v.id}">${c.w.common.back}</a></p>`);
}
