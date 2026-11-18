// The words of the search page and the page that states the order, in English, Hindi, Malayalam and Kannada (modules/discovery/page.ts draws them). English is written by
// hand; Hindi, Malayalam and Kannada are MACHINE-WRITTEN on 18 Nov 2026 and wait for a native reader on the review sheets (bundle/panel/review.ts lists every line, ids
// "directory.*"). Plain words for a shop visitor on a cheap phone: short, everyday, no jargon. Never "safe", "guaranteed", "proves", "certified", "100%", "earn", "income".
// Pure: no import except the type of a language.
import type { Lang } from "./types.ts";

export interface DirectoryWords {
  /** The tab and page title, and the head. */
  title: string; sub: string;
  searchLabel: string; placeholder: string; kindLabel: string; anyKind: string; kinds: Record<string, string>;
  townLabel: string; townHint: string; nearMe: string; nearMeSet: string; radiusLabel: string; anyDistance: string; km: (n: number) => string; search: string; language: string;
  /** The results. */
  resultsFor: (n: number, q: string) => string; resultsNoWords: (n: number) => string;
  ask: string; confirmedToday: string; confirmedYesterday: string; confirmedDays: (n: number) => string; callToCheck: string; callToCheckWhy: string;
  away: (km: string) => string; inTown: (town: string) => string; chat: string; chatLabel: (shop: string, item: string) => string; machine: string;
  noPhoto: string; photoOf: (item: string) => string;
  unanswered: (n: number) => string; more: string; clear: string;
  /** The states. */
  startTitle: string; startBody: string; tryThese: string; examples: string[];
  noneTitle: string; noneBody: string; badTitle: string; busyTitle: string; busyBody: string; downTitle: string; downBody: string;
  /** The order page. */
  orderLink: string; orderTitle: string; orderIntro: string; orderSteps: string[]; orderNever: string; orderNeverBody: string; orderAsk: string; orderAskBody: string; orderWords: string; orderWordsBody: string; orderPrivate: string; orderPrivateBody: string; back: string;
  /** The foot. */
  foot: string; assistants: string;
}

const EN: DirectoryWords = {
  title: "Find it near you", sub: "See what local shops have right now.",
  searchLabel: "What do you want?", placeholder: "Persian kitten", kindLabel: "Kind", anyKind: "Anything",
  kinds: { pets: "Pets", food: "Food", clothes: "Clothes", home: "For the home", electronics: "Electronics", vehicles_and_cycles: "Vehicles and cycles", services: "Services", other: "Other" },
  townLabel: "Your town", townHint: "Leave empty to see all", nearMe: "Use my location", nearMeSet: "Your location is set", radiusLabel: "How far", anyDistance: "Any distance", km: (n) => `${n} km`, search: "Search", language: "Language",
  resultsFor: (n, q) => (n === 1 ? `1 result for “${q}”` : `${n} results for “${q}”`), resultsNoWords: (n) => (n === 1 ? "1 thing found" : `${n} things found`),
  ask: "Ask the shop", confirmedToday: "Confirmed today", confirmedYesterday: "Confirmed yesterday", confirmedDays: (n) => `Confirmed ${n} days ago`, callToCheck: "Call to check", callToCheckWhy: "The shop did not say just now. Call to check before you go.",
  away: (km) => `${km} km away`, inTown: (town) => `In ${town}`, chat: "Chat with the shop", chatLabel: (shop, item) => `Chat with the shop: ${shop}, about ${item}`, machine: "Words by an assistant",
  noPhoto: "No photo", photoOf: (item) => `Photo of ${item}`,
  unanswered: (n) => (n === 1 ? "1 shop did not answer just now. Its line says “Call to check”." : `${n} shops did not answer just now. Their lines say “Call to check”.`), more: "Show more", clear: "Clear the search",
  startTitle: "Search what local shops have", startBody: "Type what you want, or pick a kind. Each shop shows only what it has now, and we ask the shop to confirm before you see it.", tryThese: "Try", examples: ["Persian kitten", "bicycle", "birthday cake"],
  noneTitle: "Nothing found", noneBody: "No shop has this right now. Try fewer words, another kind, or a bigger distance.", badTitle: "That search did not work", busyTitle: "Please wait a minute", busyBody: "There have been many searches from this phone just now. Try again in a minute.",
  downTitle: "The search is not working right now", downBody: "Please try again in a few minutes.",
  orderLink: "How results are ordered", orderTitle: "How results are ordered", orderIntro: "Every search is put in the same order for everyone. Here it is, in the order we use it.",
  orderSteps: ["How well it fits. Shops that have everything you typed come before shops that have some of it.", "How near it is. Closer shops come first, in steps: up to 2 km, 5 km, 10 km, 25 km, 50 km, then farther.", "How fresh it is. In the same step, what the shop confirmed comes before “Call to check”.", "Turns. Shops in the same step take turns, and the turns change every day and with every search, so no shop is always first."],
  orderNever: "Never by money", orderNeverBody: "No payment, plan or Operator changes the order. A shop cannot pay to be first, and neither can we. The same rule is in the open code.",
  orderAsk: "Asking the shop", orderAskBody: "Before you see a result, we ask the shop “do you still have this?”. The question holds only the item, never your words, your place or who you are. If the shop does not answer, you still see the item, with “Call to check”.",
  orderWords: "Words by an assistant", orderWordsBody: "A shop's words may be written in other languages by an assistant from the owner's own words. Those are marked.", orderPrivate: "What we keep", orderPrivateBody: "No account and no cookie. We count how many searches there were in a day, nothing about who searched or for what.",
  back: "Back to search", foot: "A directory of local shops.", assistants: "For AI assistants",
};

const HI: DirectoryWords = {
  title: "अपने पास खोजें", sub: "देखें कि आपके आस-पास की दुकानों में अभी क्या है।",
  searchLabel: "आपको क्या चाहिए?", placeholder: "फ़ारसी बिल्ली का बच्चा", kindLabel: "किस तरह का", anyKind: "कुछ भी",
  kinds: { pets: "पालतू जानवर", food: "खाने की चीज़ें", clothes: "कपड़े", home: "घर के लिए", electronics: "इलेक्ट्रॉनिक्स", vehicles_and_cycles: "गाड़ियाँ और साइकिल", services: "सेवाएँ", other: "दूसरा" },
  townLabel: "आपका शहर", townHint: "सब देखने के लिए खाली छोड़ें", nearMe: "मेरी जगह इस्तेमाल करें", nearMeSet: "आपकी जगह मिल गई", radiusLabel: "कितनी दूर तक", anyDistance: "कितनी भी दूरी", km: (n) => `${n} किमी`, search: "खोजें", language: "भाषा",
  resultsFor: (n, q) => `“${q}” के लिए ${n} नतीजे`, resultsNoWords: (n) => `${n} चीज़ें मिलीं`,
  ask: "दुकान से पूछें", confirmedToday: "आज पक्का किया गया", confirmedYesterday: "कल पक्का किया गया", confirmedDays: (n) => `${n} दिन पहले पक्का किया गया`, callToCheck: "फ़ोन करके पूछें", callToCheckWhy: "दुकान ने अभी नहीं बताया। जाने से पहले फ़ोन करके पूछ लें।",
  away: (km) => `${km} किमी दूर`, inTown: (town) => `${town} में`, chat: "दुकान से बात करें", chatLabel: (shop, item) => `दुकान से बात करें: ${shop}, ${item} के बारे में`, machine: "सहायक के लिखे शब्द",
  noPhoto: "फ़ोटो नहीं है", photoOf: (item) => `${item} की फ़ोटो`,
  unanswered: (n) => `${n} दुकान ने अभी जवाब नहीं दिया। उसकी पंक्ति में “फ़ोन करके पूछें” लिखा है।`, more: "और दिखाएँ", clear: "खोज हटाएँ",
  startTitle: "देखें स्थानीय दुकानों में क्या है", startBody: "जो चाहिए वह लिखें, या कोई तरह चुनें। हर दुकान वही दिखाती है जो उसके पास अभी है, और आपके देखने से पहले हम दुकान से पक्का करवाते हैं।", tryThese: "आज़माएँ", examples: ["फ़ारसी बिल्ली का बच्चा", "साइकिल", "जन्मदिन का केक"],
  noneTitle: "कुछ नहीं मिला", noneBody: "अभी किसी दुकान के पास यह नहीं है। कम शब्द लिखें, दूसरी तरह चुनें, या दूरी बढ़ाएँ।", badTitle: "यह खोज नहीं हो पाई", busyTitle: "कृपया एक मिनट रुकें", busyBody: "इस फ़ोन से अभी बहुत खोजें हुई हैं। एक मिनट बाद फिर कोशिश करें।",
  downTitle: "खोज अभी काम नहीं कर रही", downBody: "कृपया कुछ मिनट बाद फिर कोशिश करें।",
  orderLink: "नतीजों का क्रम कैसे बनता है", orderTitle: "नतीजों का क्रम कैसे बनता है", orderIntro: "हर खोज सबके लिए एक ही क्रम में लगती है। वह क्रम यहाँ है, जिस तरह हम उसे लगाते हैं।",
  orderSteps: ["कितना मेल खाता है। जिन दुकानों में आपके लिखे सारे शब्द मिलते हैं, वे कुछ शब्द मिलने वाली दुकानों से पहले आती हैं।", "कितना पास है। पास की दुकानें पहले आती हैं, सीढ़ियों में: 2 किमी, 5 किमी, 10 किमी, 25 किमी, 50 किमी तक, फिर उससे दूर।", "कितना ताज़ा है। एक ही सीढ़ी में, जो दुकान ने पक्का किया है वह “फ़ोन करके पूछें” से पहले आता है।", "बारी। एक ही सीढ़ी की दुकानें बारी-बारी से आती हैं, और बारी हर दिन और हर खोज के साथ बदलती है, इसलिए कोई दुकान हमेशा पहले नहीं रहती।"],
  orderNever: "पैसे से कभी नहीं", orderNeverBody: "कोई भुगतान, प्लान या ऑपरेटर क्रम नहीं बदलता। कोई दुकान पैसे देकर पहले नहीं आ सकती, और हम भी नहीं ला सकते। यही नियम खुले कोड में भी है।",
  orderAsk: "दुकान से पूछना", orderAskBody: "नतीजा दिखाने से पहले हम दुकान से पूछते हैं “क्या यह अभी आपके पास है?”। सवाल में सिर्फ़ चीज़ होती है, आपके शब्द, आपकी जगह या आप कौन हैं, यह कभी नहीं। दुकान जवाब न दे तो भी चीज़ दिखती है, “फ़ोन करके पूछें” के साथ।",
  orderWords: "सहायक के लिखे शब्द", orderWordsBody: "दुकान के शब्द दूसरी भाषाओं में एक सहायक मालिक के अपने शब्दों से लिख सकता है। ऐसे शब्दों पर निशान लगा होता है।", orderPrivate: "हम क्या रखते हैं", orderPrivateBody: "कोई खाता नहीं और कोई कुकी नहीं। हम सिर्फ़ गिनते हैं कि एक दिन में कितनी खोजें हुईं, किसने या क्या खोजा यह नहीं।",
  back: "खोज पर वापस", foot: "स्थानीय दुकानों की एक सूची।", assistants: "एआई सहायकों के लिए",
};

const ML: DirectoryWords = {
  title: "അടുത്തുള്ളത് കണ്ടെത്തുക", sub: "നാട്ടിലെ കടകളിൽ ഇപ്പോൾ എന്തുണ്ടെന്ന് നോക്കൂ.",
  searchLabel: "നിങ്ങൾക്ക് എന്താണ് വേണ്ടത്?", placeholder: "പേർഷ്യൻ പൂച്ചക്കുട്ടി", kindLabel: "തരം", anyKind: "എന്തും",
  kinds: { pets: "വളർത്തുമൃഗങ്ങൾ", food: "ഭക്ഷണം", clothes: "വസ്ത്രങ്ങൾ", home: "വീട്ടിലേക്ക്", electronics: "ഇലക്ട്രോണിക്സ്", vehicles_and_cycles: "വാഹനങ്ങളും സൈക്കിളും", services: "സേവനങ്ങൾ", other: "മറ്റുള്ളവ" },
  townLabel: "നിങ്ങളുടെ നഗരം", townHint: "എല്ലാം കാണാൻ ഒഴിച്ചിടുക", nearMe: "എന്റെ സ്ഥലം ഉപയോഗിക്കുക", nearMeSet: "നിങ്ങളുടെ സ്ഥലം കിട്ടി", radiusLabel: "എത്ര ദൂരം", anyDistance: "ഏത് ദൂരവും", km: (n) => `${n} കിലോമീറ്റർ`, search: "തിരയുക", language: "ഭാഷ",
  resultsFor: (n, q) => `“${q}” എന്നതിന് ${n} ഫലങ്ങൾ`, resultsNoWords: (n) => `${n} സാധനങ്ങൾ കണ്ടു`,
  ask: "കടയോട് ചോദിക്കൂ", confirmedToday: "ഇന്ന് ഉറപ്പിച്ചത്", confirmedYesterday: "ഇന്നലെ ഉറപ്പിച്ചത്", confirmedDays: (n) => `${n} ദിവസം മുമ്പ് ഉറപ്പിച്ചത്`, callToCheck: "വിളിച്ച് ചോദിക്കൂ", callToCheckWhy: "കട ഇപ്പോൾ പറഞ്ഞില്ല. പോകുന്നതിന് മുമ്പ് വിളിച്ച് ചോദിക്കൂ.",
  away: (km) => `${km} കിലോമീറ്റർ അകലെ`, inTown: (town) => `${town}-ൽ`, chat: "കടയോട് സംസാരിക്കൂ", chatLabel: (shop, item) => `കടയോട് സംസാരിക്കൂ: ${shop}, ${item} സംബന്ധിച്ച്`, machine: "സഹായി എഴുതിയ വാക്കുകൾ",
  noPhoto: "ഫോട്ടോ ഇല്ല", photoOf: (item) => `${item}-ന്റെ ഫോട്ടോ`,
  unanswered: (n) => `${n} കട ഇപ്പോൾ മറുപടി തന്നില്ല. അതിന്റെ വരിയിൽ “വിളിച്ച് ചോദിക്കൂ” എന്നുണ്ട്.`, more: "കൂടുതൽ കാണിക്കൂ", clear: "തിരയൽ മായ്ക്കുക",
  startTitle: "നാട്ടിലെ കടകളിൽ എന്തുണ്ടെന്ന് തിരയൂ", startBody: "വേണ്ടത് എഴുതൂ, അല്ലെങ്കിൽ ഒരു തരം തിരഞ്ഞെടുക്കൂ. ഓരോ കടയും ഇപ്പോൾ ഉള്ളത് മാത്രം കാണിക്കുന്നു, നിങ്ങൾ കാണുന്നതിന് മുമ്പ് ഞങ്ങൾ കടയോട് ഉറപ്പ് ചോദിക്കുന്നു.", tryThese: "ഇങ്ങനെ നോക്കൂ", examples: ["പേർഷ്യൻ പൂച്ചക്കുട്ടി", "സൈക്കിൾ", "ജന്മദിന കേക്ക്"],
  noneTitle: "ഒന്നും കണ്ടില്ല", noneBody: "ഇപ്പോൾ ഒരു കടയിലും ഇത് ഇല്ല. കുറച്ച് വാക്കുകൾ എഴുതൂ, മറ്റൊരു തരം നോക്കൂ, അല്ലെങ്കിൽ ദൂരം കൂട്ടൂ.", badTitle: "ആ തിരയൽ നടന്നില്ല", busyTitle: "ഒരു മിനിറ്റ് കാത്തിരിക്കൂ", busyBody: "ഈ ഫോണിൽ നിന്ന് ഇപ്പോൾ ഒരുപാട് തിരയലുകൾ ഉണ്ടായി. ഒരു മിനിറ്റ് കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കൂ.",
  downTitle: "തിരയൽ ഇപ്പോൾ പ്രവർത്തിക്കുന്നില്ല", downBody: "കുറച്ച് മിനിറ്റ് കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കൂ.",
  orderLink: "ഫലങ്ങളുടെ ക്രമം എങ്ങനെ", orderTitle: "ഫലങ്ങളുടെ ക്രമം എങ്ങനെ", orderIntro: "ഓരോ തിരയലും എല്ലാവർക്കും ഒരേ ക്രമത്തിലാണ്. ഞങ്ങൾ ഉപയോഗിക്കുന്ന ക്രമത്തിൽ അത് ഇതാ.",
  orderSteps: ["എത്ര യോജിക്കുന്നു. നിങ്ങൾ എഴുതിയതെല്ലാം ഉള്ള കടകൾ, ചിലത് മാത്രം ഉള്ള കടകൾക്ക് മുമ്പ് വരുന്നു.", "എത്ര അടുത്താണ്. അടുത്ത കടകൾ ആദ്യം, പടിപടിയായി: 2, 5, 10, 25, 50 കിലോമീറ്റർ വരെ, പിന്നെ അതിലും അകലെ.", "എത്ര പുതിയതാണ്. ഒരേ പടിയിൽ, കട ഉറപ്പിച്ചത് “വിളിച്ച് ചോദിക്കൂ” എന്നതിന് മുമ്പ് വരുന്നു.", "ഊഴം. ഒരേ പടിയിലെ കടകൾ ഊഴം വച്ച് വരുന്നു, ഊഴം ഓരോ ദിവസവും ഓരോ തിരയലിലും മാറുന്നു, അതിനാൽ ഒരു കടയും എപ്പോഴും ആദ്യം വരില്ല."],
  orderNever: "പണം കൊണ്ട് ഒരിക്കലുമില്ല", orderNeverBody: "ഒരു പണമടയ്ക്കലോ പ്ലാനോ ഓപ്പറേറ്ററോ ക്രമം മാറ്റില്ല. ഒരു കടയ്ക്കും പണം കൊടുത്ത് ആദ്യം വരാനാവില്ല, ഞങ്ങൾക്കും ആവില്ല. ഇതേ നിയമം തുറന്ന കോഡിലുമുണ്ട്.",
  orderAsk: "കടയോട് ചോദിക്കുന്നത്", orderAskBody: "ഫലം കാണിക്കുന്നതിന് മുമ്പ് ഞങ്ങൾ കടയോട് “ഇത് ഇപ്പോഴും ഉണ്ടോ?” എന്ന് ചോദിക്കുന്നു. ചോദ്യത്തിൽ സാധനം മാത്രമേ ഉള്ളൂ, നിങ്ങളുടെ വാക്കുകളോ സ്ഥലമോ നിങ്ങൾ ആരെന്നോ ഒരിക്കലുമില്ല. കട മറുപടി തന്നില്ലെങ്കിലും സാധനം “വിളിച്ച് ചോദിക്കൂ” എന്നതോടെ കാണും.",
  orderWords: "സഹായി എഴുതിയ വാക്കുകൾ", orderWordsBody: "ഒരു കടയുടെ വാക്കുകൾ ഉടമയുടെ സ്വന്തം വാക്കുകളിൽ നിന്ന് ഒരു സഹായി മറ്റ് ഭാഷകളിൽ എഴുതിയതാകാം. അവയ്ക്ക് അടയാളമുണ്ട്.", orderPrivate: "ഞങ്ങൾ സൂക്ഷിക്കുന്നത്", orderPrivateBody: "അക്കൗണ്ടില്ല, കുക്കിയുമില്ല. ഒരു ദിവസം എത്ര തിരയലുകൾ ഉണ്ടായി എന്ന് മാത്രം എണ്ണുന്നു, ആര് എന്ത് തിരഞ്ഞു എന്നില്ല.",
  back: "തിരയലിലേക്ക് മടങ്ങുക", foot: "നാട്ടിലെ കടകളുടെ ഒരു പട്ടിക.", assistants: "AI സഹായികൾക്ക്",
};

const KN: DirectoryWords = {
  title: "ನಿಮ್ಮ ಹತ್ತಿರ ಹುಡುಕಿ", sub: "ಸ್ಥಳೀಯ ಅಂಗಡಿಗಳಲ್ಲಿ ಈಗ ಏನಿದೆ ಎಂದು ನೋಡಿ.",
  searchLabel: "ನಿಮಗೆ ಏನು ಬೇಕು?", placeholder: "ಪರ್ಷಿಯನ್ ಬೆಕ್ಕಿನ ಮರಿ", kindLabel: "ಬಗೆ", anyKind: "ಏನಾದರೂ",
  kinds: { pets: "ಸಾಕುಪ್ರಾಣಿಗಳು", food: "ಆಹಾರ", clothes: "ಬಟ್ಟೆಗಳು", home: "ಮನೆಗಾಗಿ", electronics: "ಎಲೆಕ್ಟ್ರಾನಿಕ್ಸ್", vehicles_and_cycles: "ವಾಹನಗಳು ಮತ್ತು ಸೈಕಲ್", services: "ಸೇವೆಗಳು", other: "ಇತರೆ" },
  townLabel: "ನಿಮ್ಮ ಊರು", townHint: "ಎಲ್ಲವನ್ನೂ ನೋಡಲು ಖಾಲಿ ಬಿಡಿ", nearMe: "ನನ್ನ ಸ್ಥಳ ಬಳಸಿ", nearMeSet: "ನಿಮ್ಮ ಸ್ಥಳ ಸಿಕ್ಕಿದೆ", radiusLabel: "ಎಷ್ಟು ದೂರ", anyDistance: "ಯಾವ ದೂರವಾದರೂ", km: (n) => `${n} ಕಿ.ಮೀ`, search: "ಹುಡುಕಿ", language: "ಭಾಷೆ",
  resultsFor: (n, q) => `“${q}” ಗೆ ${n} ಫಲಿತಾಂಶಗಳು`, resultsNoWords: (n) => `${n} ವಸ್ತುಗಳು ಸಿಕ್ಕವು`,
  ask: "ಅಂಗಡಿಯನ್ನು ಕೇಳಿ", confirmedToday: "ಇಂದು ಖಚಿತಪಡಿಸಲಾಗಿದೆ", confirmedYesterday: "ನಿನ್ನೆ ಖಚಿತಪಡಿಸಲಾಗಿದೆ", confirmedDays: (n) => `${n} ದಿನಗಳ ಹಿಂದೆ ಖಚಿತಪಡಿಸಲಾಗಿದೆ`, callToCheck: "ಕರೆ ಮಾಡಿ ಕೇಳಿ", callToCheckWhy: "ಅಂಗಡಿ ಈಗ ಹೇಳಿಲ್ಲ. ಹೋಗುವ ಮೊದಲು ಕರೆ ಮಾಡಿ ಕೇಳಿ.",
  away: (km) => `${km} ಕಿ.ಮೀ ದೂರ`, inTown: (town) => `${town} ನಲ್ಲಿ`, chat: "ಅಂಗಡಿಯೊಂದಿಗೆ ಮಾತನಾಡಿ", chatLabel: (shop, item) => `ಅಂಗಡಿಯೊಂದಿಗೆ ಮಾತನಾಡಿ: ${shop}, ${item} ಬಗ್ಗೆ`, machine: "ಸಹಾಯಕ ಬರೆದ ಪದಗಳು",
  noPhoto: "ಫೋಟೋ ಇಲ್ಲ", photoOf: (item) => `${item} ಫೋಟೋ`,
  unanswered: (n) => `${n} ಅಂಗಡಿ ಈಗ ಉತ್ತರಿಸಲಿಲ್ಲ. ಅದರ ಸಾಲಿನಲ್ಲಿ “ಕರೆ ಮಾಡಿ ಕೇಳಿ” ಎಂದಿದೆ.`, more: "ಇನ್ನಷ್ಟು ತೋರಿಸಿ", clear: "ಹುಡುಕಾಟ ತೆರವುಗೊಳಿಸಿ",
  startTitle: "ಸ್ಥಳೀಯ ಅಂಗಡಿಗಳಲ್ಲಿ ಏನಿದೆ ಎಂದು ಹುಡುಕಿ", startBody: "ನಿಮಗೆ ಬೇಕಾದುದನ್ನು ಬರೆಯಿರಿ, ಅಥವಾ ಒಂದು ಬಗೆಯನ್ನು ಆರಿಸಿ. ಪ್ರತಿ ಅಂಗಡಿಯೂ ಈಗ ಇರುವುದನ್ನು ಮಾತ್ರ ತೋರಿಸುತ್ತದೆ, ನೀವು ನೋಡುವ ಮೊದಲು ನಾವು ಅಂಗಡಿಯನ್ನು ಕೇಳಿ ಖಚಿತಪಡಿಸುತ್ತೇವೆ.", tryThese: "ಹೀಗೆ ಹುಡುಕಿ", examples: ["ಪರ್ಷಿಯನ್ ಬೆಕ್ಕಿನ ಮರಿ", "ಸೈಕಲ್", "ಹುಟ್ಟುಹಬ್ಬದ ಕೇಕ್"],
  noneTitle: "ಏನೂ ಸಿಗಲಿಲ್ಲ", noneBody: "ಈಗ ಯಾವ ಅಂಗಡಿಯಲ್ಲೂ ಇದು ಇಲ್ಲ. ಕಡಿಮೆ ಪದಗಳನ್ನು ಬರೆಯಿರಿ, ಬೇರೆ ಬಗೆ ಆರಿಸಿ, ಅಥವಾ ದೂರ ಹೆಚ್ಚಿಸಿ.", badTitle: "ಆ ಹುಡುಕಾಟ ಆಗಲಿಲ್ಲ", busyTitle: "ದಯವಿಟ್ಟು ಒಂದು ನಿಮಿಷ ಕಾಯಿರಿ", busyBody: "ಈ ಫೋನಿನಿಂದ ಈಗ ತುಂಬಾ ಹುಡುಕಾಟಗಳು ನಡೆದಿವೆ. ಒಂದು ನಿಮಿಷದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  downTitle: "ಹುಡುಕಾಟ ಈಗ ಕೆಲಸ ಮಾಡುತ್ತಿಲ್ಲ", downBody: "ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  orderLink: "ಫಲಿತಾಂಶಗಳ ಕ್ರಮ ಹೇಗೆ", orderTitle: "ಫಲಿತಾಂಶಗಳ ಕ್ರಮ ಹೇಗೆ", orderIntro: "ಪ್ರತಿ ಹುಡುಕಾಟವೂ ಎಲ್ಲರಿಗೂ ಒಂದೇ ಕ್ರಮದಲ್ಲಿರುತ್ತದೆ. ನಾವು ಬಳಸುವ ಕ್ರಮದಲ್ಲಿ ಅದು ಇಲ್ಲಿದೆ.",
  orderSteps: ["ಎಷ್ಟು ಹೊಂದುತ್ತದೆ. ನೀವು ಬರೆದುದೆಲ್ಲ ಇರುವ ಅಂಗಡಿಗಳು, ಕೆಲವು ಮಾತ್ರ ಇರುವ ಅಂಗಡಿಗಳಿಗಿಂತ ಮೊದಲು ಬರುತ್ತವೆ.", "ಎಷ್ಟು ಹತ್ತಿರ. ಹತ್ತಿರದ ಅಂಗಡಿಗಳು ಮೊದಲು, ಹಂತ ಹಂತವಾಗಿ: 2, 5, 10, 25, 50 ಕಿ.ಮೀ ವರೆಗೆ, ನಂತರ ಅದಕ್ಕಿಂತ ದೂರ.", "ಎಷ್ಟು ತಾಜಾ. ಒಂದೇ ಹಂತದಲ್ಲಿ, ಅಂಗಡಿ ಖಚಿತಪಡಿಸಿದ್ದು “ಕರೆ ಮಾಡಿ ಕೇಳಿ” ಎನ್ನುವುದಕ್ಕಿಂತ ಮೊದಲು ಬರುತ್ತದೆ.", "ಸರದಿ. ಒಂದೇ ಹಂತದ ಅಂಗಡಿಗಳು ಸರದಿಯಂತೆ ಬರುತ್ತವೆ, ಸರದಿ ಪ್ರತಿ ದಿನ ಮತ್ತು ಪ್ರತಿ ಹುಡುಕಾಟದೊಂದಿಗೆ ಬದಲಾಗುತ್ತದೆ, ಆದ್ದರಿಂದ ಯಾವ ಅಂಗಡಿಯೂ ಯಾವಾಗಲೂ ಮೊದಲಲ್ಲ."],
  orderNever: "ಹಣದಿಂದ ಎಂದಿಗೂ ಇಲ್ಲ", orderNeverBody: "ಯಾವ ಪಾವತಿ, ಯೋಜನೆ ಅಥವಾ ಆಪರೇಟರ್ ಕೂಡ ಕ್ರಮವನ್ನು ಬದಲಾಯಿಸುವುದಿಲ್ಲ. ಯಾವ ಅಂಗಡಿಯೂ ಹಣ ಕೊಟ್ಟು ಮೊದಲು ಬರಲಾಗದು, ನಾವೂ ತರಲಾಗದು. ಇದೇ ನಿಯಮ ತೆರೆದ ಕೋಡ್‌ನಲ್ಲೂ ಇದೆ.",
  orderAsk: "ಅಂಗಡಿಯನ್ನು ಕೇಳುವುದು", orderAskBody: "ಫಲಿತಾಂಶ ತೋರಿಸುವ ಮೊದಲು ನಾವು ಅಂಗಡಿಯನ್ನು “ಇದು ಇನ್ನೂ ಇದೆಯೇ?” ಎಂದು ಕೇಳುತ್ತೇವೆ. ಪ್ರಶ್ನೆಯಲ್ಲಿ ವಸ್ತು ಮಾತ್ರ ಇರುತ್ತದೆ, ನಿಮ್ಮ ಪದಗಳು, ನಿಮ್ಮ ಸ್ಥಳ ಅಥವಾ ನೀವು ಯಾರು ಎಂಬುದು ಎಂದಿಗೂ ಇಲ್ಲ. ಅಂಗಡಿ ಉತ್ತರಿಸದಿದ್ದರೂ ವಸ್ತು “ಕರೆ ಮಾಡಿ ಕೇಳಿ” ಎಂಬುದರೊಂದಿಗೆ ಕಾಣುತ್ತದೆ.",
  orderWords: "ಸಹಾಯಕ ಬರೆದ ಪದಗಳು", orderWordsBody: "ಅಂಗಡಿಯ ಪದಗಳನ್ನು ಮಾಲೀಕರ ಸ್ವಂತ ಪದಗಳಿಂದ ಒಬ್ಬ ಸಹಾಯಕ ಬೇರೆ ಭಾಷೆಗಳಲ್ಲಿ ಬರೆದಿರಬಹುದು. ಅವುಗಳಿಗೆ ಗುರುತು ಇರುತ್ತದೆ.", orderPrivate: "ನಾವು ಇಟ್ಟುಕೊಳ್ಳುವುದು", orderPrivateBody: "ಖಾತೆ ಇಲ್ಲ, ಕುಕೀ ಇಲ್ಲ. ಒಂದು ದಿನದಲ್ಲಿ ಎಷ್ಟು ಹುಡುಕಾಟಗಳು ನಡೆದವು ಎಂದು ಮಾತ್ರ ಎಣಿಸುತ್ತೇವೆ, ಯಾರು ಏನು ಹುಡುಕಿದರು ಎಂದಲ್ಲ.",
  back: "ಹುಡುಕಾಟಕ್ಕೆ ಹಿಂತಿರುಗಿ", foot: "ಸ್ಥಳೀಯ ಅಂಗಡಿಗಳ ಒಂದು ಪಟ್ಟಿ.", assistants: "AI ಸಹಾಯಕರಿಗೆ",
};

export const DIRECTORY_WORDS: Record<Lang, DirectoryWords> = { en: EN, hi: HI, ml: ML, kn: KN };

/** The names of the four languages, each in its own script (the language switch). */
export const LANGUAGE_LABEL: Record<Lang, string> = { en: "English", hi: "हिन्दी", ml: "മലയാളം", kn: "ಕನ್ನಡ" };

/** The sample values the review sheet shows for the lines that take values. */
export const DIRECTORY_SAMPLES: Record<string, unknown[]> = {
  km: [10], resultsFor: [3, "Persian kitten"], resultsNoWords: [3], confirmedDays: [3], away: ["1.4"], inTown: ["Thrissur"], chatLabel: ["Rani Pets", "Persian kitten"], photoOf: ["Persian kitten"], unanswered: [2],
};
