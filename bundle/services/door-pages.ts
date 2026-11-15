// The door's own error pages, in the shop's languages (release-flow batch 3, 14 Nov 2026). Before this the door answered "This shop's page is not answering" and the
// rest in English only, with no way to reach anyone. Now each page is in English, Hindi, Malayalam or Kannada (the visitor's `?lang=`, else the browser's first of the
// four, else English), links to the other three, and, when the door has seen the shop's Operator contact, says who to call.
//
// What the door can know: it holds no shop data and asks no front when a shop is down (that is exactly when a page is wanted). So the shop's front names its partner
// in a response header on every page it serves (`CONTACT_HEADER`, modules/channels/contact-bar.ts), and the door keeps the last one it saw per slug (door.ts `contacts`), a
// small memory that a door restart forgets; a page with no known contact simply has no "call" line. No fleet answer is used. The text is the old English text unchanged;
// Hindi, Malayalam and Kannada are machine-written and say so (the shops' pages' own line, channels/words.ts PAGE[language].machine).
// No script and nothing loaded, like every page of the door; a tel: or wa.me link is a plain navigation.
import type { ServerResponse } from "node:http";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";
import { PAGE } from "../../modules/channels/words.ts";

export { CONTACT_HEADER } from "../../modules/channels/contact-bar.ts";

export interface DoorContact { name: string; phone: string; languages: Language[] }

/** Read a header's value; anything that does not read back as a contact is ignored. */
export function parseContact(value: unknown): DoorContact | undefined {
  if (typeof value !== "string" || value.length > 600) return undefined;
  try {
    const j = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { n?: unknown; p?: unknown; l?: unknown };
    if (typeof j.n !== "string" || j.n.length === 0 || j.n.length > 60 || typeof j.p !== "string" || !/^\+\d{10,15}$/u.test(j.p)) return undefined;
    const languages = Array.isArray(j.l) ? j.l.filter((x): x is Language => LANGUAGES.includes(x as Language)) : [];
    return { name: j.n, phone: j.p, languages };
  } catch { return undefined; }
}

export type DoorKey = "nothing" | "gone" | "suspended" | "unreachable" | "notAnswering" | "notAnsweringLater" | "notHere" | "home" | "waitMinute" | "waitWhile" | "waitFew" | "nothingHere" | "tooBig" | "wrong";
interface Say { title: string; text: string }
interface Words { say: Record<DoorKey, Say>; help: (name: string) => string; call: string; whatsapp: string }

const CSS = "body{margin:0;font:17px/1.5 system-ui,sans-serif;color:#10231a}main{max-width:32rem;margin:0 auto;padding:32px 16px}.langs a,.langs b{display:inline-block;margin:0 10px 0 0}.help{margin-top:24px;padding:12px 14px;border:1px solid #c9d8cf;border-radius:14px}.help a{display:inline-block;margin:6px 14px 0 0;padding:10px 0;font-weight:650}.machine{color:#5a6b61;font-size:.9rem}";

/** Exported so the native reviewer's sheet lists these lines too (bundle/panel/review.ts, ids "door.*"). */
export const WORDS: Record<Language, Words> = {
  en: {
    say: {
      nothing: { title: "There is no shop page here", text: "Check the address, or ask the shop for its link." },
      gone: { title: "This shop page is closed", text: "The shop no longer has a page at this address." },
      suspended: { title: "This shop page is not available", text: "It has been taken down while a report about it is looked at." },
      unreachable: { title: "Shop pages are not reachable just now", text: "Please try again in a few minutes." },
      notAnswering: { title: "This shop's page is not answering", text: "Please try again in a few minutes." },
      notAnsweringLater: { title: "This shop's page is not answering", text: "Please try again later." },
      notHere: { title: "Not here", text: "Use the page's links and buttons." },
      home: { title: "Shop pages", text: "Each shop's page is at its own short name, like /veena-salon. Shops set theirs up with their local Operator." },
      waitMinute: { title: "Too many requests", text: "Please wait a minute." }, waitWhile: { title: "Too many requests", text: "Please wait a while." }, waitFew: { title: "Too many requests", text: "Please wait a few minutes." },
      nothingHere: { title: "There is nothing here", text: "This page has no such address." },
      tooBig: { title: "Too big", text: "That is more than a shop's page takes." },
      wrong: { title: "Something went wrong", text: "Please try again." },
    },
    help: (name) => `Need help? ${name} looks after this shop's page.`, call: "Call", whatsapp: "WhatsApp",
  },
  hi: {
    say: {
      nothing: { title: "यहाँ कोई दुकान का पेज नहीं है", text: "पता जाँचिए, या दुकान से उसका लिंक माँगिए।" },
      gone: { title: "यह दुकान का पेज बंद हो गया है", text: "इस पते पर अब दुकान का पेज नहीं है।" },
      suspended: { title: "यह दुकान का पेज अभी उपलब्ध नहीं है", text: "इसके बारे में एक शिकायत देखी जा रही है, तब तक इसे हटाया गया है।" },
      unreachable: { title: "दुकानों के पेज अभी नहीं खुल रहे", text: "कुछ मिनट बाद फिर कोशिश कीजिए।" },
      notAnswering: { title: "इस दुकान का पेज जवाब नहीं दे रहा", text: "कुछ मिनट बाद फिर कोशिश कीजिए।" },
      notAnsweringLater: { title: "इस दुकान का पेज जवाब नहीं दे रहा", text: "थोड़ी देर बाद फिर कोशिश कीजिए।" },
      notHere: { title: "यहाँ नहीं", text: "पेज के लिंक और बटन इस्तेमाल कीजिए।" },
      home: { title: "दुकानों के पेज", text: "हर दुकान का पेज उसके अपने छोटे नाम पर है, जैसे /veena-salon। दुकानें इसे अपने स्थानीय ऑपरेटर के साथ बनवाती हैं।" },
      waitMinute: { title: "बहुत ज़्यादा अनुरोध", text: "एक मिनट रुकिए।" }, waitWhile: { title: "बहुत ज़्यादा अनुरोध", text: "थोड़ी देर रुकिए।" }, waitFew: { title: "बहुत ज़्यादा अनुरोध", text: "कुछ मिनट रुकिए।" },
      nothingHere: { title: "यहाँ कुछ नहीं है", text: "इस पते पर कोई पेज नहीं है।" },
      tooBig: { title: "बहुत बड़ा", text: "यह दुकान के पेज की सीमा से ज़्यादा है।" },
      wrong: { title: "कुछ गड़बड़ हो गई", text: "फिर कोशिश कीजिए।" },
    },
    help: (name) => `मदद चाहिए? ${name} इस दुकान के पेज का ध्यान रखते हैं।`, call: "कॉल करें", whatsapp: "WhatsApp",
  },
  ml: {
    say: {
      nothing: { title: "ഇവിടെ കടയുടെ പേജ് ഇല്ല", text: "വിലാസം പരിശോധിക്കൂ, അല്ലെങ്കിൽ കടയോട് അവരുടെ ലിങ്ക് ചോദിക്കൂ." },
      gone: { title: "ഈ കടയുടെ പേജ് അടച്ചു", text: "ഈ വിലാസത്തിൽ ഇപ്പോൾ കടയ്ക്ക് പേജ് ഇല്ല." },
      suspended: { title: "ഈ കടയുടെ പേജ് ഇപ്പോൾ ലഭ്യമല്ല", text: "ഇതിനെക്കുറിച്ചുള്ള ഒരു റിപ്പോർട്ട് പരിശോധിക്കുന്നതുവരെ ഇത് നീക്കിയിരിക്കുന്നു." },
      unreachable: { title: "കടകളുടെ പേജുകൾ ഇപ്പോൾ തുറക്കുന്നില്ല", text: "കുറച്ച് മിനിറ്റ് കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കൂ." },
      notAnswering: { title: "ഈ കടയുടെ പേജ് പ്രതികരിക്കുന്നില്ല", text: "കുറച്ച് മിനിറ്റ് കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കൂ." },
      notAnsweringLater: { title: "ഈ കടയുടെ പേജ് പ്രതികരിക്കുന്നില്ല", text: "കുറച്ച് കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കൂ." },
      notHere: { title: "ഇവിടെ അല്ല", text: "പേജിലെ ലിങ്കുകളും ബട്ടണുകളും ഉപയോഗിക്കൂ." },
      home: { title: "കടകളുടെ പേജുകൾ", text: "ഓരോ കടയുടെയും പേജ് അതിന്റെ ചെറിയ പേരിലാണ്, ഉദാ. /veena-salon. കടകൾ ഇത് അവരുടെ പ്രാദേശിക ഓപ്പറേറ്റർയോടൊപ്പം സജ്ജമാക്കുന്നു." },
      waitMinute: { title: "വളരെയധികം അഭ്യർത്ഥനകൾ", text: "ഒരു മിനിറ്റ് കാത്തിരിക്കൂ." }, waitWhile: { title: "വളരെയധികം അഭ്യർത്ഥനകൾ", text: "കുറച്ച് നേരം കാത്തിരിക്കൂ." }, waitFew: { title: "വളരെയധികം അഭ്യർത്ഥനകൾ", text: "കുറച്ച് മിനിറ്റ് കാത്തിരിക്കൂ." },
      nothingHere: { title: "ഇവിടെ ഒന്നുമില്ല", text: "ഈ വിലാസത്തിൽ പേജ് ഇല്ല." },
      tooBig: { title: "വളരെ വലുത്", text: "ഇത് ഒരു കടയുടെ പേജ് സ്വീകരിക്കുന്നതിലും കൂടുതലാണ്." },
      wrong: { title: "എന്തോ കുഴപ്പം പറ്റി", text: "വീണ്ടും ശ്രമിക്കൂ." },
    },
    help: (name) => `സഹായം വേണോ? ${name} ഈ കടയുടെ പേജ് നോക്കുന്നു.`, call: "വിളിക്കൂ", whatsapp: "WhatsApp",
  },
  kn: {
    say: {
      nothing: { title: "ಇಲ್ಲಿ ಅಂಗಡಿಯ ಪುಟ ಇಲ್ಲ", text: "ವಿಳಾಸ ಪರಿಶೀಲಿಸಿ, ಅಥವಾ ಅಂಗಡಿಯಿಂದ ಅವರ ಲಿಂಕ್ ಕೇಳಿ." },
      gone: { title: "ಈ ಅಂಗಡಿಯ ಪುಟ ಮುಚ್ಚಲಾಗಿದೆ", text: "ಈ ವಿಳಾಸದಲ್ಲಿ ಅಂಗಡಿಗೆ ಈಗ ಪುಟ ಇಲ್ಲ." },
      suspended: { title: "ಈ ಅಂಗಡಿಯ ಪುಟ ಈಗ ಲಭ್ಯವಿಲ್ಲ", text: "ಇದರ ಬಗ್ಗೆ ಒಂದು ವರದಿಯನ್ನು ಪರಿಶೀಲಿಸುವವರೆಗೆ ಇದನ್ನು ತೆಗೆದಿದೆ." },
      unreachable: { title: "ಅಂಗಡಿಗಳ ಪುಟಗಳು ಈಗ ತೆರೆಯುತ್ತಿಲ್ಲ", text: "ಕೆಲವು ನಿಮಿಷ ಬಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ." },
      notAnswering: { title: "ಈ ಅಂಗಡಿಯ ಪುಟ ಉತ್ತರಿಸುತ್ತಿಲ್ಲ", text: "ಕೆಲವು ನಿಮಿಷ ಬಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ." },
      notAnsweringLater: { title: "ಈ ಅಂಗಡಿಯ ಪುಟ ಉತ್ತರಿಸುತ್ತಿಲ್ಲ", text: "ಸ್ವಲ್ಪ ಹೊತ್ತು ಬಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ." },
      notHere: { title: "ಇಲ್ಲಿ ಅಲ್ಲ", text: "ಪುಟದ ಲಿಂಕ್ ಮತ್ತು ಬಟನ್‌ಗಳನ್ನು ಬಳಸಿ." },
      home: { title: "ಅಂಗಡಿಗಳ ಪುಟಗಳು", text: "ಪ್ರತಿ ಅಂಗಡಿಯ ಪುಟ ಅದರ ಚಿಕ್ಕ ಹೆಸರಿನಲ್ಲಿದೆ, ಉದಾ. /veena-salon. ಅಂಗಡಿಗಳು ಇದನ್ನು ತಮ್ಮ ಸ್ಥಳೀಯ ಆಪರೇಟರ್ ಅವರೊಂದಿಗೆ ಹೊಂದಿಸುತ್ತವೆ." },
      waitMinute: { title: "ತುಂಬಾ ವಿನಂತಿಗಳು", text: "ಒಂದು ನಿಮಿಷ ಕಾಯಿರಿ." }, waitWhile: { title: "ತುಂಬಾ ವಿನಂತಿಗಳು", text: "ಸ್ವಲ್ಪ ಹೊತ್ತು ಕಾಯಿರಿ." }, waitFew: { title: "ತುಂಬಾ ವಿನಂತಿಗಳು", text: "ಕೆಲವು ನಿಮಿಷ ಕಾಯಿರಿ." },
      nothingHere: { title: "ಇಲ್ಲಿ ಏನೂ ಇಲ್ಲ", text: "ಈ ವಿಳಾಸದಲ್ಲಿ ಪುಟ ಇಲ್ಲ." },
      tooBig: { title: "ತುಂಬಾ ದೊಡ್ಡದು", text: "ಇದು ಅಂಗಡಿಯ ಪುಟ ಸ್ವೀಕರಿಸುವುದಕ್ಕಿಂತ ಹೆಚ್ಚು." },
      wrong: { title: "ಏನೋ ತಪ್ಪಾಯಿತು", text: "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ." },
    },
    help: (name) => `ಸಹಾಯ ಬೇಕೇ? ${name} ಈ ಅಂಗಡಿಯ ಪುಟವನ್ನು ನೋಡಿಕೊಳ್ಳುತ್ತಾರೆ.`, call: "ಕರೆ ಮಾಡಿ", whatsapp: "WhatsApp",
  },
};

const LABEL: Record<Language, string> = { en: "English", hi: "हिन्दी", ml: "മലയാളം", kn: "ಕನ್ನಡ" };
const esc = (s: string) => s.replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The visitor's language: `?lang=`, else the browser's first of the four, else English. `offered`: a shop's own languages, when the door knows them (the choice stays among those). */
export function languageOf(req: { url?: string; headers: Record<string, string | string[] | undefined> } | undefined, offered?: readonly Language[]): Language {
  const ok = (l: string): l is Language => LANGUAGES.includes(l as Language) && (!offered || offered.length === 0 || offered.includes(l as Language));
  const asked = new URL(req?.url ?? "/", "http://door").searchParams.get("lang");
  if (asked && ok(asked)) return asked;
  for (const part of String(req?.headers["accept-language"] ?? "").split(",")) { const l = part.trim().slice(0, 2).toLowerCase(); if (ok(l)) return l; }
  return "en";
}

/** One of the door's own pages for the request on `res`, in the visitor's language, with who to call when the shop's Operator is known. */
export function doorPage(key: DoorKey, res: ServerResponse, contact?: DoorContact): string {
  const language = languageOf(res.req, contact?.languages);
  const w = WORDS[language];
  const s = w.say[key];
  const machine = PAGE[language].machine;
  const langs = (contact?.languages.length ? contact.languages : (["en", "hi", "ml", "kn"] as readonly Language[])).filter((l, i, all) => all.indexOf(l) === i);
  const links = langs.length > 1 ? `<p class="langs">${langs.map((l) => (l === language ? `<b>${LABEL[l]}</b>` : `<a href="?lang=${l}" hreflang="${l}">${LABEL[l]}</a>`)).join("")}</p>` : "";
  const help = contact ? `<div class="help"><p>${esc(w.help(contact.name))}</p><a href="tel:${esc(contact.phone)}">${esc(w.call)}</a><a href="https://wa.me/${contact.phone.replace(/\D/gu, "")}" rel="noopener">${esc(w.whatsapp)}</a></div>` : "";
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${s.title}</title><style>${CSS}</style></head><body><main><h1>${s.title}</h1><p>${s.text}</p>${help}${links}${machine ? `<p class="machine">${machine}</p>` : ""}</main></body></html>`;
}
