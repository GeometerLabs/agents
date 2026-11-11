// The one-page shop terms, in English, Hindi, Malayalam and Kannada, and what it takes to agree to them on WhatsApp (B72, 12 Nov 2026).
//
// Used by: the three agents' owner handling (owner.ts here), the panel's terms page (bundle/panel/terms.ts, to show and download the copy) and the deployer (it hands each
// runtime its terms.json). It is OFF unless a shop's runtime is handed a terms file, and the file is only handed over when the server setting `panel.termsOnWhatsapp` is on.
//
// LEGAL STATUS, said plainly: this is a mechanism and a draft text. It has NOT had the owner's legal check. Signed paper is still what Geometer's sell guides tell a partner to
// use; nothing here may be described as legally sufficient until that check is done (Deferred.md, "Shop terms agreed on WhatsApp").
//
// What binds an agreement: the digest of the EXACT text sent (it contains the shop's name, the partner's name and number, and the two prices), the version, the language, the
// owner's number and the WhatsApp message id of the reply. Changed terms (a new price, a new version) are a different digest and need a new agreement. Hindi, Malayalam and
// Kannada are machine-written and wait for a native reader, like the rest of those packs.
import { createHash } from "node:crypto";
import { formatInr } from "../language/format.ts";
import type { Language } from "../language/languages.ts";

/** Bumped whenever a clause changes. It is in the text, so it is in the digest. */
export const TERMS_VERSION = "2026-11-12";
/** The record's words for what happened. Their own actions, so a report never counts them as approvals or messages to customers. */
export const TERMS_SENT_ACTION = "terms_sent";
export const TERMS_AGREED_ACTION = "terms_agreed";
/** The button ids: the agree button carries the first 12 characters of the digest it was offered for. */
export const AGREE_PREFIX = "terms-agree:";
export const LATER_ID = "terms-later";
/** Review state of the Hindi, Malayalam and Kannada text (same word as bundle/panel/languages.ts). */
export const TERMS_REVIEW_STATE = "machine-written" as const;

/** What the partner enters for a shop (the panel's terms page writes it; the deployer copies it to the runtime as terms.json). Prices are the partner's own, whole rupees. */
export interface TermsFile { schema: 1; partnerName: string; partnerPhone: string; monthlyInr: number; setupInr: number }

const whole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000_000;
const line = (v: unknown, max: number): v is string => typeof v === "string" && v.trim() !== "" && v.length <= max && !/[\p{Cc}]/u.test(v);

/** Check a terms file field by field; anything else is no terms file (so the feature stays off), never a half-filled one. */
export function readTermsFile(raw: unknown): TermsFile | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.schema !== 1 || !line(r.partnerName, 60) || !line(r.partnerPhone, 30) || !whole(r.monthlyInr) || !whole(r.setupInr)) return undefined;
  return { schema: 1, partnerName: r.partnerName.trim(), partnerPhone: r.partnerPhone.trim(), monthlyInr: r.monthlyInr, setupInr: r.setupInr };
}

interface Fill { shop: string; partner: string; phone: string; monthly: string; setup: string; v: string }

const BODIES: Record<Language, (f: Fill) => string> = {
  en: (f) => [
    `Shop terms, version ${f.v}`,
    `Between ${f.shop} (the shop) and ${f.partner}, ${f.phone} (your local partner).`,
    `1. What the helper does. It answers your customers on WhatsApp inside the limits you set (prices, hours, deposit, refund limit). Above a limit it asks you first. It keeps a record of what it did. It does not do what the limits do not allow.`,
    `2. Price. As agreed with ${f.partner}: ${f.monthly} a month, and ${f.setup} once for setting up. No other charge from ${f.partner} or Geometer. A payment gateway the shop chooses, and WhatsApp, have their own fees at their own rates.`,
    `3. Your money. Deposits go straight to your own UPI ID or payment account, never to ${f.partner} or Geometer.`,
    `4. Stopping. You can stop with one message to ${f.partner}. Nothing is charged automatically unless you clearly agreed.`,
    `5. Your data. Customer messages stay with you and ${f.partner}. Geometer receives counts and health signals only, never the words of a message.`,
    `6. Questions. Write to ${f.partner} on ${f.phone}, or to hello@geometer.dev.`,
    `To agree, reply "I agree" or tap the "I agree" button. To read this again, send "terms" at any time.`,
  ].join("\n\n"),
  hi: (f) => [
    `दुकान की शर्तें, संस्करण ${f.v}`,
    `${f.shop} (दुकान) और ${f.partner}, ${f.phone} (आपका स्थानीय पार्टनर) के बीच।`,
    `1. सहायक क्या करता है। यह WhatsApp पर आपके ग्राहकों को आपकी तय सीमाओं (कीमतें, समय, जमा राशि, रिफंड सीमा) के भीतर जवाब देता है। सीमा से ऊपर की बात पर पहले आपसे पूछता है। जो किया उसका रिकॉर्ड रखता है। सीमाएँ जो इजाज़त नहीं देतीं, वह नहीं करता।`,
    `2. कीमत। ${f.partner} से तय हुई कीमत: ${f.monthly} हर महीने और सेटअप के लिए ${f.setup} एक बार। ${f.partner} या Geometer की ओर से इसके अलावा कोई शुल्क नहीं। दुकान जो पेमेंट गेटवे चुने और WhatsApp, उनके अपने शुल्क अपनी दरों पर लेते हैं।`,
    `3. आपका पैसा। जमा राशि सीधे आपके अपने UPI ID या पेमेंट खाते में जाती है, ${f.partner} या Geometer के पास कभी नहीं।`,
    `4. रोकना। आप ${f.partner} को एक संदेश भेजकर रोक सकते हैं। आपकी साफ़ सहमति के बिना कुछ भी अपने-आप नहीं कटता।`,
    `5. आपका डेटा। ग्राहकों के संदेश आपके और ${f.partner} के पास रहते हैं। Geometer को सिर्फ़ गिनती और सेहत के संकेत मिलते हैं, किसी संदेश के शब्द कभी नहीं।`,
    `6. सवाल। ${f.partner} को ${f.phone} पर लिखिए, या hello@geometer.dev पर।`,
    `सहमत होने के लिए "मैं सहमत हूँ" लिखिए या "मैं सहमत हूँ" बटन दबाइए। इसे दोबारा पढ़ने के लिए कभी भी "शर्तें" भेजिए।`,
  ].join("\n\n"),
  ml: (f) => [
    `കടയുടെ നിബന്ധനകൾ, പതിപ്പ് ${f.v}`,
    `${f.shop} (കട), ${f.partner}, ${f.phone} (നിങ്ങളുടെ പ്രാദേശിക പാർട്ണർ) എന്നിവർ തമ്മിൽ.`,
    `1. സഹായി ചെയ്യുന്നത്. നിങ്ങൾ നിശ്ചയിച്ച പരിധികൾക്കുള്ളിൽ (വിലകൾ, സമയം, അഡ്വാൻസ്, റീഫണ്ട് പരിധി) WhatsApp-ൽ ഉപഭോക്താക്കൾക്ക് മറുപടി നൽകുന്നു. പരിധിക്ക് മുകളിലുള്ള കാര്യത്തിൽ ആദ്യം നിങ്ങളോട് ചോദിക്കുന്നു. ചെയ്തതിന്റെ രേഖ സൂക്ഷിക്കുന്നു. പരിധികൾ അനുവദിക്കാത്തത് ചെയ്യില്ല.`,
    `2. വില. ${f.partner}-യുമായി സമ്മതിച്ച വില: മാസം ${f.monthly}, സെറ്റപ്പിന് ഒരിക്കൽ ${f.setup}. ${f.partner}-യോ Geometer-ഓ ഇതല്ലാതെ മറ്റൊന്നും ഈടാക്കുന്നില്ല. കട തിരഞ്ഞെടുക്കുന്ന പേയ്മെന്റ് ഗേറ്റ്‌വേയ്ക്കും WhatsApp-നും അവരുടേതായ നിരക്കിൽ സ്വന്തം ഫീസ് ഉണ്ടാകും.`,
    `3. നിങ്ങളുടെ പണം. അഡ്വാൻസ് നേരിട്ട് നിങ്ങളുടെ സ്വന്തം UPI ID-യിലോ പേയ്മെന്റ് അക്കൗണ്ടിലോ എത്തുന്നു; ${f.partner}-ന്റെയോ Geometer-ന്റെയോ അടുത്തേക്ക് ഒരിക്കലും പോകില്ല.`,
    `4. നിർത്തൽ. ${f.partner}-ന് ഒരു സന്ദേശം അയച്ച് നിങ്ങൾക്ക് നിർത്താം. നിങ്ങൾ വ്യക്തമായി സമ്മതിക്കാതെ ഒന്നും തനിയെ ഈടാക്കില്ല.`,
    `5. നിങ്ങളുടെ ഡേറ്റ. ഉപഭോക്താക്കളുടെ സന്ദേശങ്ങൾ നിങ്ങളുടെയും ${f.partner}-ന്റെയും കൈവശം തന്നെ. Geometer-ന് എണ്ണങ്ങളും ആരോഗ്യ സൂചനകളും മാത്രം ലഭിക്കുന്നു; സന്ദേശത്തിലെ വാക്കുകൾ ഒരിക്കലും ലഭിക്കില്ല.`,
    `6. സംശയങ്ങൾ. ${f.partner}-നെ ${f.phone}-ൽ എഴുതൂ, അല്ലെങ്കിൽ hello@geometer.dev-ൽ.`,
    `സമ്മതിക്കാൻ "ഞാൻ സമ്മതിക്കുന്നു" എന്ന് മറുപടി അയയ്ക്കൂ, അല്ലെങ്കിൽ ആ ബട്ടൺ അമർത്തൂ. വീണ്ടും വായിക്കാൻ എപ്പോഴും "നിബന്ധനകൾ" എന്ന് അയയ്ക്കൂ.`,
  ].join("\n\n"),
  kn: (f) => [
    `ಅಂಗಡಿಯ ನಿಯಮಗಳು, ಆವೃತ್ತಿ ${f.v}`,
    `${f.shop} (ಅಂಗಡಿ) ಮತ್ತು ${f.partner}, ${f.phone} (ನಿಮ್ಮ ಸ್ಥಳೀಯ ಪಾರ್ಟ್ನರ್) ನಡುವೆ.`,
    `1. ಸಹಾಯಕ ಏನು ಮಾಡುತ್ತದೆ. ನೀವು ನಿಗದಿಪಡಿಸಿದ ಮಿತಿಗಳ (ಬೆಲೆಗಳು, ಸಮಯ, ಮುಂಗಡ, ಮರುಪಾವತಿ ಮಿತಿ) ಒಳಗೆ WhatsApp ನಲ್ಲಿ ನಿಮ್ಮ ಗ್ರಾಹಕರಿಗೆ ಉತ್ತರಿಸುತ್ತದೆ. ಮಿತಿಯ ಮೇಲಿನ ವಿಷಯದಲ್ಲಿ ಮೊದಲು ನಿಮ್ಮನ್ನು ಕೇಳುತ್ತದೆ. ಮಾಡಿದ್ದರ ದಾಖಲೆ ಇಡುತ್ತದೆ. ಮಿತಿಗಳು ಅನುಮತಿಸದ್ದನ್ನು ಮಾಡುವುದಿಲ್ಲ.`,
    `2. ಬೆಲೆ. ${f.partner} ಅವರೊಂದಿಗೆ ಒಪ್ಪಿದ ಬೆಲೆ: ತಿಂಗಳಿಗೆ ${f.monthly}, ಸೆಟಪ್‌ಗೆ ಒಮ್ಮೆ ${f.setup}. ${f.partner} ಅಥವಾ Geometer ಇದಲ್ಲದೆ ಬೇರೆ ಶುಲ್ಕ ತೆಗೆದುಕೊಳ್ಳುವುದಿಲ್ಲ. ಅಂಗಡಿ ಆರಿಸುವ ಪೇಮೆಂಟ್ ಗೇಟ್‌ವೇ ಮತ್ತು WhatsApp ತಮ್ಮದೇ ದರದಲ್ಲಿ ತಮ್ಮದೇ ಶುಲ್ಕ ಹಾಕುತ್ತವೆ.`,
    `3. ನಿಮ್ಮ ಹಣ. ಮುಂಗಡ ನೇರವಾಗಿ ನಿಮ್ಮ ಸ್ವಂತ UPI ID ಅಥವಾ ಪೇಮೆಂಟ್ ಖಾತೆಗೆ ಹೋಗುತ್ತದೆ; ${f.partner} ಅಥವಾ Geometer ಬಳಿಗೆ ಎಂದಿಗೂ ಹೋಗುವುದಿಲ್ಲ.`,
    `4. ನಿಲ್ಲಿಸುವುದು. ${f.partner} ಅವರಿಗೆ ಒಂದು ಸಂದೇಶ ಕಳುಹಿಸಿ ನಿಲ್ಲಿಸಬಹುದು. ನೀವು ಸ್ಪಷ್ಟವಾಗಿ ಒಪ್ಪದೆ ತಾನಾಗಿ ಏನನ್ನೂ ಕಡಿತಗೊಳಿಸುವುದಿಲ್ಲ.`,
    `5. ನಿಮ್ಮ ಡೇಟಾ. ಗ್ರಾಹಕರ ಸಂದೇಶಗಳು ನಿಮ್ಮ ಮತ್ತು ${f.partner} ಬಳಿಯೇ ಇರುತ್ತವೆ. Geometer ಗೆ ಲೆಕ್ಕಗಳು ಮತ್ತು ಆರೋಗ್ಯ ಸೂಚನೆಗಳು ಮಾತ್ರ ಸಿಗುತ್ತವೆ; ಸಂದೇಶದ ಮಾತುಗಳು ಎಂದಿಗೂ ಸಿಗುವುದಿಲ್ಲ.`,
    `6. ಪ್ರಶ್ನೆಗಳು. ${f.partner} ಅವರಿಗೆ ${f.phone} ನಲ್ಲಿ ಬರೆಯಿರಿ, ಅಥವಾ hello@geometer.dev ಗೆ.`,
    `ಒಪ್ಪಲು "ನಾನು ಒಪ್ಪುತ್ತೇನೆ" ಎಂದು ಉತ್ತರಿಸಿ ಅಥವಾ ಆ ಬಟನ್ ಒತ್ತಿ. ಮತ್ತೆ ಓದಲು ಯಾವಾಗ ಬೇಕಾದರೂ "ನಿಯಮಗಳು" ಎಂದು ಕಳುಹಿಸಿ.`,
  ].join("\n\n"),
};

/** The terms for one shop, as the owner reads them, in the owner's language. */
export function termsText(language: Language, shopName: string, file: TermsFile): string {
  return BODIES[language]({ shop: shopName, partner: file.partnerName, phone: file.partnerPhone, monthly: formatInr(file.monthlyInr), setup: formatInr(file.setupInr), v: TERMS_VERSION });
}

/** The digest an agreement is bound to: sha256 of the exact text (so of the names, prices, version and language in it). */
export const termsDigest = (text: string): string => createHash("sha256").update("shop-terms:").update(text).digest("hex");

/** The owner's request to read the terms: one word, in the four languages. */
const REQUEST = /^\s*(?:terms|शर्तें|शर्ते|നിബന്ധനകൾ|ನಿಯಮಗಳು)\s*[.!?]*\s*$/iu;
export const isTermsRequest = (text: string): boolean => REQUEST.test(text);

/** "I agree", typed, in the four languages. A bare "ok", "yes" or a thumbs-up is not an agreement. */
const AGREE = /^\s*(?:i agree|agree|मैं सहमत हूँ|मैं सहमत हूं|सहमत|ഞാൻ സമ്മതിക്കുന്നു|സമ്മതിക്കുന്നു|ನಾನು ಒಪ್ಪುತ್ತೇನೆ|ಒಪ್ಪುತ್ತೇನೆ)\s*[.!]*\s*$/iu;
export const isAgreeWords = (text: string): boolean => AGREE.test(text);

/** The short words around the terms (the question under them, the buttons, the answers). */
export const TERMS_WORDS: Record<Language, { ask(v: string): string; agree: string; later: string; done(v: string): string; askFirst: string; ok: string; already(v: string): string }> = {
  en: { ask: (v) => `Do you agree to these terms (version ${v})?`, agree: "I agree", later: "Not now", done: (v) => `Thank you. Your agreement to the shop terms (version ${v}) is recorded in the shop's record.`, askFirst: 'To agree, first send "terms" to read them.', ok: 'Okay. Send "terms" when you are ready.', already: (v) => `Your agreement to these terms (version ${v}) is already recorded.` },
  hi: { ask: (v) => `क्या आप इन शर्तों (संस्करण ${v}) से सहमत हैं?`, agree: "मैं सहमत हूँ", later: "अभी नहीं", done: (v) => `धन्यवाद। दुकान की शर्तों (संस्करण ${v}) पर आपकी सहमति दुकान के रिकॉर्ड में दर्ज हो गई है।`, askFirst: 'सहमत होने से पहले "शर्तें" भेजकर उन्हें पढ़िए।', ok: 'ठीक है। तैयार हों तो "शर्तें" भेजिए।', already: (v) => `इन शर्तों (संस्करण ${v}) पर आपकी सहमति पहले ही दर्ज है।` },
  ml: { ask: (v) => `ഈ നിബന്ധനകളോട് (പതിപ്പ് ${v}) നിങ്ങൾ സമ്മതിക്കുന്നുണ്ടോ?`, agree: "ഞാൻ സമ്മതിക്കുന്നു", later: "ഇപ്പോൾ വേണ്ട", done: (v) => `നന്ദി. കടയുടെ നിബന്ധനകളിൽ (പതിപ്പ് ${v}) നിങ്ങളുടെ സമ്മതം കടയുടെ രേഖയിൽ ചേർത്തു.`, askFirst: 'സമ്മതിക്കുന്നതിന് മുമ്പ് "നിബന്ധനകൾ" എന്ന് അയച്ച് വായിക്കൂ.', ok: 'ശരി. തയ്യാറാകുമ്പോൾ "നിബന്ധനകൾ" എന്ന് അയയ്ക്കൂ.', already: (v) => `ഈ നിബന്ധനകളിൽ (പതിപ്പ് ${v}) നിങ്ങളുടെ സമ്മതം നേരത്തേ ചേർത്തിട്ടുണ്ട്.` },
  kn: { ask: (v) => `ಈ ನಿಯಮಗಳಿಗೆ (ಆವೃತ್ತಿ ${v}) ನೀವು ಒಪ್ಪುತ್ತೀರಾ?`, agree: "ನಾನು ಒಪ್ಪುತ್ತೇನೆ", later: "ಈಗ ಬೇಡ", done: (v) => `ಧನ್ಯವಾದ. ಅಂಗಡಿಯ ನಿಯಮಗಳಿಗೆ (ಆವೃತ್ತಿ ${v}) ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಅಂಗಡಿಯ ದಾಖಲೆಯಲ್ಲಿ ಸೇರಿದೆ.`, askFirst: 'ಒಪ್ಪುವ ಮೊದಲು "ನಿಯಮಗಳು" ಎಂದು ಕಳುಹಿಸಿ ಓದಿ.', ok: 'ಸರಿ. ಸಿದ್ಧರಾದಾಗ "ನಿಯಮಗಳು" ಎಂದು ಕಳುಹಿಸಿ.', already: (v) => `ಈ ನಿಯಮಗಳಿಗೆ (ಆವೃತ್ತಿ ${v}) ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಈಗಾಗಲೇ ದಾಖಲಾಗಿದೆ.` },
};
