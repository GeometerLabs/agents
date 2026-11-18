// Every line people read about listings, in English, Hindi, Malayalam and Kannada (block S, phase A): the storefront ("What we have"), the owner's app page, the card the owner taps
// ("Show this on your page?"), the morning question ("Still have it?"), the refusals and the chat's greeting. One file, so the storefront, the owner's app, the assistant and the
// review sheets read the same words. The Hindi, Malayalam and Kannada are machine-written and are on the review sheets (bundle/panel/review.ts, "listings.*"); the English is the
// reference. The words never say a shop's goods are "safe", "guaranteed" or "verified": a pet shop's registration and any health claim is "the owner says".
import type { Language } from "../language/languages.ts";
import type { Category } from "./listings.ts";

export interface ListingWords {
  /** The fixed categories. */
  categories: Record<Category, string>;
  // ---- the storefront and the chat ----
  heading: string;
  pageTitle: (shop: string) => string;
  askAbout: string;
  askShop: string;
  confirmedToday: string;
  confirmedAgo: (days: number) => string;
  callToCheck: string;
  empty: string;
  /** The page note when a listing's words are not in the owner's own language. */
  machine: string;
  registration: (text: string) => string;
  ownerSays: (text: string) => string;
  quantity: (n: number) => string;
  photoOf: (title: string) => string;
  seeAll: string;
  /** What the chat says first when a guest came from a listing. */
  chatGreeting: (title: string) => string;
  /** What the owner's page shows beside a chat guest who asked about a listing. */
  guestAsked: (title: string) => string;
  // ---- the card, the question and the owner's page ----
  card: (a: { title: string; price: string; category: string }) => string;
  show: string;
  change: string;
  no: string;
  still: (title: string) => string;
  yes: string;
  sold: string;
  published: (title: string) => string;
  dropped: string;
  confirmed: (title: string) => string;
  markedSold: (title: string) => string;
  needModel: string;
  needPhoto: string;
  owner: {
    title: string; intro: string; switchLabel: string; switchNote: string; switchOn: string; switchOff: string; save: string; saved: string;
    placeHeading: string; town: string; pincode: string; lat: string; lon: string; registration: string; registrationNote: string;
    formHeading: string; formNote: string; formPhoto: string; formTitle: string; formPrice: string; formPriceNote: string; formCategory: string; formSubmit: string;
    uploadHeading: string; uploadButton: string; uploaded: (n: number) => string;
    listHeading: string; none: string; live: string; draft: string; hidden: string; remove: string; confirmAgain: string; markSold: string; edit: string;
    link: string; back: string;
  };
  // ---- refusals, each a plain line ----
  refusal: {
    protected: (animal: string) => string; health: string; priceNotInWords: string; full: (max: number) => string; tooManyDrafts: string; tooLong: string; badPrice: string; badQty: string;
    badCategory: string; empty: string; badPlace: string; tooManyPhotos: string; unknown: string; gone: string; claims: string; modelFailed: string;
    photo: { empty: string; too_big: string; not_a_photo: string; unreadable: string; too_large_sides: string; animated: string; day: string };
  };
}

const EN: ListingWords = {
  categories: { pets: "Pets", food: "Food", clothes: "Clothes", home: "Home", electronics: "Electronics", vehicles: "Vehicles and cycles", services: "Services", other: "Other" },
  heading: "What we have", pageTitle: (s) => `${s}: what we have`, askAbout: "Ask about this", askShop: "Ask the shop", confirmedToday: "Confirmed today", confirmedAgo: (d) => (d === 1 ? "Confirmed yesterday" : `Confirmed ${d} days ago`),
  callToCheck: "Call to check", empty: "Nothing is listed right now. Ask the shop what is in.", machine: "Some words here were written by a machine from the owner's own words.",
  registration: (t) => `Registration (the owner says): ${t}`, ownerSays: (t) => `The owner says: ${t}`, quantity: (n) => `${n} available`, photoOf: (t) => `Photo: ${t}`, seeAll: "See what we have",
  chatGreeting: (t) => `You asked about: ${t}. What would you like to know?`, guestAsked: (t) => `Asked about: ${t}`,
  card: (a) => `Show this on your page? ${a.title}. Price: ${a.price}. Category: ${a.category}.`,
  show: "Show it", change: "Change", no: "No", still: (t) => `Still have ${t}?`, yes: "Yes", sold: "Sold",
  published: (t) => `Done: ${t} is on your page now. Confirm it every few days with one tap, so people know it is still there.`, dropped: "Alright, I will not show it.",
  confirmed: (t) => `Thanks, ${t} stays on your page.`, markedSold: (t) => `${t} is marked sold and is off your page.`,
  needModel: "I can only write a listing from your words when my assistant is on. Use the Add to my page form in your app: a photo, a title and a price.", needPhoto: "Add a photo first in your app, then tell me what it is and the price.",
  owner: {
    title: "Your page: what you have", intro: "Add what you have and the assistant writes it in four languages. It shows only after you tap Show it.",
    switchLabel: "Show my shop on Streetlist and in search", switchNote: "Off by default. When on, your what-we-have page can be found by search engines and Streetlist, and its open file is served. Turn it off at any time.",
    switchOn: "On", switchOff: "Off", save: "Save", saved: "Saved.", placeHeading: "Where you are", town: "Town", pincode: "Pincode", lat: "Map point: latitude", lon: "Map point: longitude",
    registration: "Pet shop registration (your own words)", registrationNote: "Shown as: Registration (the owner says). It is not checked by us.",
    formHeading: "Add to my page", formNote: "A photo, a title, a price. The words are saved in your language only.", formPhoto: "Photo", formTitle: "What is it", formPrice: "Price in rupees (leave empty for Ask the shop)", formPriceNote: "per piece, per kg...", formCategory: "Category", formSubmit: "Show it on my page",
    uploadHeading: "Photos", uploadButton: "Add a photo", uploaded: (n) => `${n} photo${n === 1 ? "" : "s"} ready. Now tell the assistant what it is.`,
    listHeading: "On your page", none: "Nothing yet.", live: "Showing", draft: "Waiting for your tap", hidden: "Hidden: not confirmed for 30 days", remove: "Take it off", confirmAgain: "Confirm to show again", markSold: "Sold", edit: "Change",
    link: "What you have on your page", back: "Back to your shop",
  },
  refusal: {
    protected: (a) => `I cannot list that: ${a} are protected animals and may not be sold. Please do not put them on your page.`,
    health: "I cannot write that an animal is healthy, vaccinated or of a pure breed unless you said so yourself. Tell me in your own words if it is true.",
    priceNotInWords: "The price I would write is not the one you said, so I did not make the listing. Tell me the price again.", full: (n) => `You already show ${n} things. Take one off first.`,
    tooManyDrafts: "There are already listings waiting for your tap. Answer those first.", tooLong: "That is too long. Please say it shorter.", badPrice: "That price is not valid. Use a whole number of rupees.", badQty: "That number is not valid.",
    claims: "I cannot write promises, discounts or guarantees you did not say. Say them yourself if you mean them.", modelFailed: "I could not write that just now. Use the Add to my page form in your app.",
    badCategory: "That category is not one I know.", empty: "Tell me what it is first.", badPlace: "That place is not valid.", tooManyPhotos: "A listing has up to 3 photos.", unknown: "I do not have that listing.", gone: "That listing is not on your page now.",
    photo: { empty: "That file is empty.", too_big: "That photo is too big. Try a smaller one.", not_a_photo: "That is not a JPEG or WebP photo.", unreadable: "I could not read that photo.", too_large_sides: "That photo is too large in size.", animated: "Use a still photo, not an animation.", day: "That is enough photos for today. Try tomorrow." },
  },
};

const HI: ListingWords = {
  categories: { pets: "पालतू जानवर", food: "खाना", clothes: "कपड़े", home: "घर का सामान", electronics: "इलेक्ट्रॉनिक्स", vehicles: "गाड़ियाँ और साइकिलें", services: "सेवाएँ", other: "अन्य" },
  heading: "हमारे पास क्या है", pageTitle: (s) => `${s}: हमारे पास क्या है`, askAbout: "इसके बारे में पूछें", askShop: "दुकान से पूछें", confirmedToday: "आज पक्का किया गया", confirmedAgo: (d) => `${d} दिन पहले पक्का किया गया`,
  callToCheck: "पूछने के लिए फ़ोन करें", empty: "अभी कुछ सूची में नहीं है। दुकान से पूछें कि क्या है।", machine: "यहाँ कुछ शब्द मालिक के अपने शब्दों से मशीन ने लिखे हैं।",
  registration: (t) => `पंजीकरण (मालिक के अनुसार): ${t}`, ownerSays: (t) => `मालिक कहते हैं: ${t}`, quantity: (n) => `${n} उपलब्ध`, photoOf: (t) => `फ़ोटो: ${t}`, seeAll: "देखें हमारे पास क्या है",
  chatGreeting: (t) => `आपने इसके बारे में पूछा: ${t}। आप क्या जानना चाहते हैं?`, guestAsked: (t) => `इसके बारे में पूछा: ${t}`,
  card: (a) => `क्या इसे अपने पेज पर दिखाऊँ? ${a.title}। दाम: ${a.price}। श्रेणी: ${a.category}।`,
  show: "दिखाएँ", change: "बदलें", no: "नहीं", still: (t) => `क्या ${t} अभी भी है?`, yes: "हाँ", sold: "बिक गया",
  published: (t) => `हो गया: ${t} अब आपके पेज पर है। हर कुछ दिन में एक टैप से इसे पक्का करते रहें, ताकि लोग जानें कि यह अभी भी है।`, dropped: "ठीक है, मैं इसे नहीं दिखाऊँगा।",
  confirmed: (t) => `धन्यवाद, ${t} आपके पेज पर बना रहेगा।`, markedSold: (t) => `${t} बिक गया है और आपके पेज से हट गया है।`,
  needModel: "मेरा असिस्टेंट चालू होने पर ही मैं आपके शब्दों से लिस्टिंग लिख सकता हूँ। अपने ऐप में मेरे पेज पर जोड़ें फ़ॉर्म इस्तेमाल करें: फ़ोटो, नाम और दाम।", needPhoto: "पहले अपने ऐप में फ़ोटो जोड़ें, फिर मुझे बताएँ कि यह क्या है और दाम क्या है।",
  owner: {
    title: "आपका पेज: आपके पास क्या है", intro: "जो आपके पास है वह जोड़ें, असिस्टेंट उसे चार भाषाओं में लिखेगा। यह तभी दिखेगा जब आप दिखाएँ पर टैप करेंगे।",
    switchLabel: "मेरी दुकान को Streetlist और सर्च में दिखाएँ", switchNote: "शुरू में बंद है। चालू होने पर आपका हमारे पास क्या है पेज सर्च इंजन और Streetlist को मिल सकता है, और उसकी खुली फ़ाइल उपलब्ध होती है। कभी भी बंद करें।",
    switchOn: "चालू", switchOff: "बंद", save: "सहेजें", saved: "सहेज लिया।", placeHeading: "आप कहाँ हैं", town: "शहर या कस्बा", pincode: "पिनकोड", lat: "नक्शे का बिंदु: अक्षांश", lon: "नक्शे का बिंदु: देशांतर",
    registration: "पेट शॉप पंजीकरण (आपके अपने शब्द)", registrationNote: "ऐसे दिखेगा: पंजीकरण (मालिक के अनुसार)। हम इसे जाँचते नहीं।",
    formHeading: "मेरे पेज पर जोड़ें", formNote: "फ़ोटो, नाम, दाम। शब्द सिर्फ़ आपकी भाषा में सहेजे जाएँगे।", formPhoto: "फ़ोटो", formTitle: "यह क्या है", formPrice: "रुपये में दाम (दुकान से पूछें के लिए खाली छोड़ें)", formPriceNote: "प्रति नग, प्रति किलो...", formCategory: "श्रेणी", formSubmit: "मेरे पेज पर दिखाएँ",
    uploadHeading: "फ़ोटो", uploadButton: "फ़ोटो जोड़ें", uploaded: (n) => `${n} फ़ोटो तैयार। अब असिस्टेंट को बताएँ कि यह क्या है।`,
    listHeading: "आपके पेज पर", none: "अभी कुछ नहीं।", live: "दिख रहा है", draft: "आपके टैप का इंतज़ार", hidden: "छिपा है: 30 दिन से पक्का नहीं किया", remove: "हटाएँ", confirmAgain: "फिर दिखाने के लिए पक्का करें", markSold: "बिक गया", edit: "बदलें",
    link: "आपके पेज पर क्या है", back: "अपनी दुकान पर वापस",
  },
  refusal: {
    protected: (a) => `मैं इसे सूची में नहीं डाल सकता: ${a} संरक्षित जानवर हैं और इन्हें बेचा नहीं जा सकता। कृपया इन्हें अपने पेज पर न रखें।`,
    health: "जब तक आपने खुद न कहा हो, मैं नहीं लिख सकता कि जानवर स्वस्थ है, टीका लगा है या शुद्ध नस्ल का है। अगर सच है तो अपने शब्दों में बताइए।",
    priceNotInWords: "मैं जो दाम लिखता वह वह नहीं था जो आपने कहा, इसलिए लिस्टिंग नहीं बनाई। कृपया दाम फिर बताइए।", full: (n) => `आप पहले से ${n} चीज़ें दिखा रहे हैं। पहले कोई एक हटाइए।`,
    tooManyDrafts: "आपके टैप के इंतज़ार में पहले से लिस्टिंग हैं। पहले उनका जवाब दीजिए।", tooLong: "यह बहुत लंबा है। कृपया छोटा करके कहें।", badPrice: "यह दाम सही नहीं है। रुपये की पूरी संख्या लिखें।", badQty: "यह संख्या सही नहीं है।",
    claims: "जो वादे, छूट या गारंटी आपने नहीं कहीं, वे मैं नहीं लिख सकता। मतलब हो तो खुद कहिए।", modelFailed: "मैं अभी यह नहीं लिख सका। अपने ऐप में मेरे पेज पर जोड़ें फ़ॉर्म इस्तेमाल करें।",
    badCategory: "यह श्रेणी मुझे नहीं पता।", empty: "पहले बताइए कि यह क्या है।", badPlace: "यह जगह सही नहीं है।", tooManyPhotos: "एक लिस्टिंग में 3 फ़ोटो तक हो सकते हैं।", unknown: "मेरे पास वह लिस्टिंग नहीं है।", gone: "वह लिस्टिंग अब आपके पेज पर नहीं है।",
    photo: { empty: "वह फ़ाइल खाली है।", too_big: "वह फ़ोटो बहुत बड़ी है। छोटी आज़माइए।", not_a_photo: "वह JPEG या WebP फ़ोटो नहीं है।", unreadable: "मैं वह फ़ोटो पढ़ नहीं सका।", too_large_sides: "वह फ़ोटो आकार में बहुत बड़ी है।", animated: "स्थिर फ़ोटो इस्तेमाल करें, एनिमेशन नहीं।", day: "आज के लिए इतनी फ़ोटो काफ़ी हैं। कल फिर आज़माइए।" },
  },
};

const ML: ListingWords = {
  categories: { pets: "വളർത്തുമൃഗങ്ങൾ", food: "ഭക്ഷണം", clothes: "വസ്ത്രങ്ങൾ", home: "വീട്ടുസാധനങ്ങൾ", electronics: "ഇലക്ട്രോണിക്സ്", vehicles: "വാഹനങ്ങളും സൈക്കിളുകളും", services: "സേവനങ്ങൾ", other: "മറ്റുള്ളവ" },
  heading: "ഞങ്ങളുടെ പക്കലുള്ളത്", pageTitle: (s) => `${s}: ഞങ്ങളുടെ പക്കലുള്ളത്`, askAbout: "ഇതിനെക്കുറിച്ച് ചോദിക്കുക", askShop: "കടയോട് ചോദിക്കുക", confirmedToday: "ഇന്ന് ഉറപ്പാക്കി", confirmedAgo: (d) => `${d} ദിവസം മുമ്പ് ഉറപ്പാക്കി`,
  callToCheck: "ചോദിക്കാൻ വിളിക്കുക", empty: "ഇപ്പോൾ ഒന്നും പട്ടികയിൽ ഇല്ല. എന്തുണ്ടെന്ന് കടയോട് ചോദിക്കുക.", machine: "ഇവിടെ ചില വാക്കുകൾ ഉടമയുടെ സ്വന്തം വാക്കുകളിൽ നിന്ന് യന്ത്രം എഴുതിയതാണ്.",
  registration: (t) => `രജിസ്ട്രേഷൻ (ഉടമ പറയുന്നത്): ${t}`, ownerSays: (t) => `ഉടമ പറയുന്നു: ${t}`, quantity: (n) => `${n} ലഭ്യമാണ്`, photoOf: (t) => `ഫോട്ടോ: ${t}`, seeAll: "ഞങ്ങളുടെ പക്കലുള്ളത് കാണുക",
  chatGreeting: (t) => `നിങ്ങൾ ചോദിച്ചത്: ${t}. എന്താണ് അറിയേണ്ടത്?`, guestAsked: (t) => `ചോദിച്ചത്: ${t}`,
  card: (a) => `ഇത് നിങ്ങളുടെ പേജിൽ കാണിക്കട്ടെ? ${a.title}. വില: ${a.price}. വിഭാഗം: ${a.category}.`,
  show: "കാണിക്കുക", change: "മാറ്റുക", no: "വേണ്ട", still: (t) => `${t} ഇപ്പോഴും ഉണ്ടോ?`, yes: "ഉണ്ട്", sold: "വിറ്റു",
  published: (t) => `ചെയ്തു: ${t} ഇപ്പോൾ നിങ്ങളുടെ പേജിൽ ഉണ്ട്. ഇത് ഇപ്പോഴും ഉണ്ടെന്ന് ആളുകൾ അറിയാൻ ഓരോ ദിവസം കഴിഞ്ഞും ഒരു ടാപ്പിലൂടെ ഉറപ്പാക്കുക.`, dropped: "ശരി, ഞാൻ ഇത് കാണിക്കില്ല.",
  confirmed: (t) => `നന്ദി, ${t} നിങ്ങളുടെ പേജിൽ തുടരും.`, markedSold: (t) => `${t} വിറ്റതായി അടയാളപ്പെടുത്തി, നിങ്ങളുടെ പേജിൽ നിന്ന് മാറ്റി.`,
  needModel: "എന്റെ അസിസ്റ്റന്റ് ഓണായിരിക്കുമ്പോൾ മാത്രമേ നിങ്ങളുടെ വാക്കുകളിൽ നിന്ന് ലിസ്റ്റിംഗ് എഴുതാൻ കഴിയൂ. നിങ്ങളുടെ ആപ്പിലെ എന്റെ പേജിൽ ചേർക്കുക ഫോം ഉപയോഗിക്കുക: ഫോട്ടോ, പേര്, വില.", needPhoto: "ആദ്യം നിങ്ങളുടെ ആപ്പിൽ ഒരു ഫോട്ടോ ചേർക്കുക, എന്നിട്ട് ഇത് എന്താണെന്നും വിലയും പറയുക.",
  owner: {
    title: "നിങ്ങളുടെ പേജ്: നിങ്ങളുടെ പക്കലുള്ളത്", intro: "നിങ്ങളുടെ പക്കലുള്ളത് ചേർക്കുക, അസിസ്റ്റന്റ് അത് നാല് ഭാഷകളിൽ എഴുതും. കാണിക്കുക എന്ന് ടാപ്പ് ചെയ്താൽ മാത്രമേ അത് കാണൂ.",
    switchLabel: "എന്റെ കട Streetlist-ലും സെർച്ചിലും കാണിക്കുക", switchNote: "ആദ്യം ഓഫ് ആണ്. ഓൺ ആക്കിയാൽ നിങ്ങളുടെ ഞങ്ങളുടെ പക്കലുള്ളത് പേജ് സെർച്ച് എൻജിനുകൾക്കും Streetlist-നും കണ്ടെത്താം, അതിന്റെ തുറന്ന ഫയൽ ലഭ്യമാകും. എപ്പോൾ വേണമെങ്കിലും ഓഫ് ആക്കാം.",
    switchOn: "ഓൺ", switchOff: "ഓഫ്", save: "സേവ് ചെയ്യുക", saved: "സേവ് ചെയ്തു.", placeHeading: "നിങ്ങൾ എവിടെയാണ്", town: "പട്ടണം", pincode: "പിൻകോഡ്", lat: "മാപ്പ് പോയിന്റ്: അക്ഷാംശം", lon: "മാപ്പ് പോയിന്റ്: രേഖാംശം",
    registration: "പെറ്റ് ഷോപ്പ് രജിസ്ട്രേഷൻ (നിങ്ങളുടെ സ്വന്തം വാക്കുകൾ)", registrationNote: "ഇങ്ങനെ കാണിക്കും: രജിസ്ട്രേഷൻ (ഉടമ പറയുന്നത്). ഞങ്ങൾ ഇത് പരിശോധിക്കുന്നില്ല.",
    formHeading: "എന്റെ പേജിൽ ചേർക്കുക", formNote: "ഒരു ഫോട്ടോ, ഒരു പേര്, ഒരു വില. വാക്കുകൾ നിങ്ങളുടെ ഭാഷയിൽ മാത്രം സേവ് ചെയ്യും.", formPhoto: "ഫോട്ടോ", formTitle: "ഇത് എന്താണ്", formPrice: "രൂപയിൽ വില (കടയോട് ചോദിക്കുക എന്നതിന് ഒഴിച്ചിടുക)", formPriceNote: "ഒന്നിന്, കിലോയ്ക്ക്...", formCategory: "വിഭാഗം", formSubmit: "എന്റെ പേജിൽ കാണിക്കുക",
    uploadHeading: "ഫോട്ടോകൾ", uploadButton: "ഫോട്ടോ ചേർക്കുക", uploaded: (n) => `${n} ഫോട്ടോ തയ്യാർ. ഇനി ഇത് എന്താണെന്ന് അസിസ്റ്റന്റിനോട് പറയുക.`,
    listHeading: "നിങ്ങളുടെ പേജിൽ", none: "ഇതുവരെ ഒന്നുമില്ല.", live: "കാണിക്കുന്നു", draft: "നിങ്ങളുടെ ടാപ്പിനായി കാത്തിരിക്കുന്നു", hidden: "മറച്ചിരിക്കുന്നു: 30 ദിവസമായി ഉറപ്പാക്കിയിട്ടില്ല", remove: "മാറ്റുക", confirmAgain: "വീണ്ടും കാണിക്കാൻ ഉറപ്പാക്കുക", markSold: "വിറ്റു", edit: "മാറ്റുക",
    link: "നിങ്ങളുടെ പേജിൽ ഉള്ളത്", back: "നിങ്ങളുടെ കടയിലേക്ക് മടങ്ങുക",
  },
  refusal: {
    protected: (a) => `എനിക്ക് ഇത് പട്ടികപ്പെടുത്താൻ കഴിയില്ല: ${a} സംരക്ഷിത ജീവികളാണ്, അവയെ വിൽക്കാൻ പാടില്ല. ദയവായി അവ നിങ്ങളുടെ പേജിൽ ഇടരുത്.`,
    health: "നിങ്ങൾ തന്നെ പറഞ്ഞിട്ടില്ലെങ്കിൽ ഒരു മൃഗം ആരോഗ്യമുള്ളതാണെന്നോ വാക്സിൻ എടുത്തതാണെന്നോ ശുദ്ധ ജാതിയാണെന്നോ എനിക്ക് എഴുതാൻ കഴിയില്ല. സത്യമാണെങ്കിൽ നിങ്ങളുടെ സ്വന്തം വാക്കുകളിൽ പറയുക.",
    priceNotInWords: "ഞാൻ എഴുതുമായിരുന്ന വില നിങ്ങൾ പറഞ്ഞതല്ല, അതിനാൽ ലിസ്റ്റിംഗ് ഉണ്ടാക്കിയില്ല. വില ഒന്നുകൂടി പറയുക.", full: (n) => `നിങ്ങൾ ഇതിനകം ${n} കാര്യങ്ങൾ കാണിക്കുന്നു. ആദ്യം ഒന്ന് മാറ്റുക.`,
    tooManyDrafts: "നിങ്ങളുടെ ടാപ്പിനായി ഇതിനകം ലിസ്റ്റിംഗുകൾ കാത്തിരിക്കുന്നു. ആദ്യം അവയ്ക്ക് മറുപടി നൽകുക.", tooLong: "ഇത് വളരെ നീണ്ടതാണ്. ദയവായി ചുരുക്കി പറയുക.", badPrice: "ആ വില ശരിയല്ല. രൂപയുടെ ഒരു പൂർണ്ണസംഖ്യ ഉപയോഗിക്കുക.", badQty: "ആ സംഖ്യ ശരിയല്ല.",
    claims: "നിങ്ങൾ പറയാത്ത വാഗ്ദാനങ്ങളോ ഇളവുകളോ ഉറപ്പുകളോ എനിക്ക് എഴുതാൻ കഴിയില്ല. ഉദ്ദേശിക്കുന്നെങ്കിൽ നിങ്ങൾ തന്നെ പറയുക.", modelFailed: "ഇപ്പോൾ അത് എഴുതാൻ കഴിഞ്ഞില്ല. നിങ്ങളുടെ ആപ്പിലെ എന്റെ പേജിൽ ചേർക്കുക ഫോം ഉപയോഗിക്കുക.",
    badCategory: "ആ വിഭാഗം എനിക്ക് അറിയില്ല.", empty: "ആദ്യം ഇത് എന്താണെന്ന് പറയുക.", badPlace: "ആ സ്ഥലം ശരിയല്ല.", tooManyPhotos: "ഒരു ലിസ്റ്റിംഗിൽ 3 ഫോട്ടോ വരെ ആകാം.", unknown: "എന്റെ പക്കൽ ആ ലിസ്റ്റിംഗ് ഇല്ല.", gone: "ആ ലിസ്റ്റിംഗ് ഇപ്പോൾ നിങ്ങളുടെ പേജിൽ ഇല്ല.",
    photo: { empty: "ആ ഫയൽ ശൂന്യമാണ്.", too_big: "ആ ഫോട്ടോ വളരെ വലുതാണ്. ചെറുത് ശ്രമിക്കുക.", not_a_photo: "അത് JPEG അല്ലെങ്കിൽ WebP ഫോട്ടോ അല്ല.", unreadable: "എനിക്ക് ആ ഫോട്ടോ വായിക്കാൻ കഴിഞ്ഞില്ല.", too_large_sides: "ആ ഫോട്ടോയുടെ വലിപ്പം വളരെ കൂടുതലാണ്.", animated: "ചലിക്കുന്ന ചിത്രമല്ല, സ്ഥിര ഫോട്ടോ ഉപയോഗിക്കുക.", day: "ഇന്നത്തേക്ക് ഇത്രയും ഫോട്ടോ മതി. നാളെ ശ്രമിക്കുക." },
  },
};

const KN: ListingWords = {
  categories: { pets: "ಸಾಕುಪ್ರಾಣಿಗಳು", food: "ಆಹಾರ", clothes: "ಬಟ್ಟೆಗಳು", home: "ಮನೆಯ ಸಾಮಾನು", electronics: "ಎಲೆಕ್ಟ್ರಾನಿಕ್ಸ್", vehicles: "ವಾಹನಗಳು ಮತ್ತು ಸೈಕಲ್‌ಗಳು", services: "ಸೇವೆಗಳು", other: "ಇತರೆ" },
  heading: "ನಮ್ಮಲ್ಲಿ ಏನಿದೆ", pageTitle: (s) => `${s}: ನಮ್ಮಲ್ಲಿ ಏನಿದೆ`, askAbout: "ಇದರ ಬಗ್ಗೆ ಕೇಳಿ", askShop: "ಅಂಗಡಿಯನ್ನು ಕೇಳಿ", confirmedToday: "ಇಂದು ಖಚಿತಪಡಿಸಲಾಗಿದೆ", confirmedAgo: (d) => `${d} ದಿನಗಳ ಹಿಂದೆ ಖಚಿತಪಡಿಸಲಾಗಿದೆ`,
  callToCheck: "ಕೇಳಲು ಕರೆ ಮಾಡಿ", empty: "ಈಗ ಏನೂ ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲ. ಏನಿದೆ ಎಂದು ಅಂಗಡಿಯನ್ನು ಕೇಳಿ.", machine: "ಇಲ್ಲಿನ ಕೆಲವು ಪದಗಳನ್ನು ಮಾಲೀಕರ ಸ್ವಂತ ಮಾತುಗಳಿಂದ ಯಂತ್ರ ಬರೆದಿದೆ.",
  registration: (t) => `ನೋಂದಣಿ (ಮಾಲೀಕರು ಹೇಳುವಂತೆ): ${t}`, ownerSays: (t) => `ಮಾಲೀಕರು ಹೇಳುತ್ತಾರೆ: ${t}`, quantity: (n) => `${n} ಲಭ್ಯವಿದೆ`, photoOf: (t) => `ಫೋಟೋ: ${t}`, seeAll: "ನಮ್ಮಲ್ಲಿ ಏನಿದೆ ನೋಡಿ",
  chatGreeting: (t) => `ನೀವು ಕೇಳಿದ್ದು: ${t}. ನೀವು ಏನು ತಿಳಿಯಲು ಬಯಸುತ್ತೀರಿ?`, guestAsked: (t) => `ಕೇಳಿದ್ದು: ${t}`,
  card: (a) => `ಇದನ್ನು ನಿಮ್ಮ ಪುಟದಲ್ಲಿ ತೋರಿಸಲೇ? ${a.title}. ಬೆಲೆ: ${a.price}. ವರ್ಗ: ${a.category}.`,
  show: "ತೋರಿಸಿ", change: "ಬದಲಿಸಿ", no: "ಬೇಡ", still: (t) => `${t} ಇನ್ನೂ ಇದೆಯೇ?`, yes: "ಹೌದು", sold: "ಮಾರಾಟವಾಯಿತು",
  published: (t) => `ಆಯಿತು: ${t} ಈಗ ನಿಮ್ಮ ಪುಟದಲ್ಲಿದೆ. ಇದು ಇನ್ನೂ ಇದೆ ಎಂದು ಜನರಿಗೆ ತಿಳಿಯಲು ಕೆಲವು ದಿನಗಳಿಗೊಮ್ಮೆ ಒಂದು ಟ್ಯಾಪ್‌ನಿಂದ ಖಚಿತಪಡಿಸಿ.`, dropped: "ಸರಿ, ನಾನು ಇದನ್ನು ತೋರಿಸುವುದಿಲ್ಲ.",
  confirmed: (t) => `ಧನ್ಯವಾದ, ${t} ನಿಮ್ಮ ಪುಟದಲ್ಲಿ ಉಳಿಯುತ್ತದೆ.`, markedSold: (t) => `${t} ಮಾರಾಟವಾಯಿತು ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ, ನಿಮ್ಮ ಪುಟದಿಂದ ತೆಗೆಯಲಾಗಿದೆ.`,
  needModel: "ನನ್ನ ಅಸಿಸ್ಟೆಂಟ್ ಆನ್ ಇದ್ದಾಗ ಮಾತ್ರ ನಿಮ್ಮ ಮಾತುಗಳಿಂದ ಲಿಸ್ಟಿಂಗ್ ಬರೆಯಬಲ್ಲೆ. ನಿಮ್ಮ ಆ್ಯಪ್‌ನಲ್ಲಿ ನನ್ನ ಪುಟಕ್ಕೆ ಸೇರಿಸಿ ಫಾರ್ಮ್ ಬಳಸಿ: ಫೋಟೋ, ಹೆಸರು, ಬೆಲೆ.", needPhoto: "ಮೊದಲು ನಿಮ್ಮ ಆ್ಯಪ್‌ನಲ್ಲಿ ಫೋಟೋ ಸೇರಿಸಿ, ನಂತರ ಇದು ಏನು ಮತ್ತು ಬೆಲೆ ಎಷ್ಟು ಎಂದು ಹೇಳಿ.",
  owner: {
    title: "ನಿಮ್ಮ ಪುಟ: ನಿಮ್ಮಲ್ಲಿ ಏನಿದೆ", intro: "ನಿಮ್ಮಲ್ಲಿರುವುದನ್ನು ಸೇರಿಸಿ, ಅಸಿಸ್ಟೆಂಟ್ ಅದನ್ನು ನಾಲ್ಕು ಭಾಷೆಗಳಲ್ಲಿ ಬರೆಯುತ್ತದೆ. ನೀವು ತೋರಿಸಿ ಎಂದು ಟ್ಯಾಪ್ ಮಾಡಿದ ನಂತರವೇ ಅದು ಕಾಣಿಸುತ್ತದೆ.",
    switchLabel: "ನನ್ನ ಅಂಗಡಿಯನ್ನು Streetlist ಮತ್ತು ಹುಡುಕಾಟದಲ್ಲಿ ತೋರಿಸಿ", switchNote: "ಆರಂಭದಲ್ಲಿ ಆಫ್ ಇರುತ್ತದೆ. ಆನ್ ಮಾಡಿದರೆ ನಿಮ್ಮ ನಮ್ಮಲ್ಲಿ ಏನಿದೆ ಪುಟವನ್ನು ಸರ್ಚ್ ಎಂಜಿನ್‌ಗಳು ಮತ್ತು Streetlist ಕಂಡುಕೊಳ್ಳಬಹುದು, ಅದರ ತೆರೆದ ಫೈಲ್ ಲಭ್ಯವಾಗುತ್ತದೆ. ಯಾವಾಗ ಬೇಕಾದರೂ ಆಫ್ ಮಾಡಿ.",
    switchOn: "ಆನ್", switchOff: "ಆಫ್", save: "ಉಳಿಸಿ", saved: "ಉಳಿಸಲಾಗಿದೆ.", placeHeading: "ನೀವು ಎಲ್ಲಿದ್ದೀರಿ", town: "ಊರು", pincode: "ಪಿನ್‌ಕೋಡ್", lat: "ನಕ್ಷೆಯ ಬಿಂದು: ಅಕ್ಷಾಂಶ", lon: "ನಕ್ಷೆಯ ಬಿಂದು: ರೇಖಾಂಶ",
    registration: "ಪೆಟ್ ಶಾಪ್ ನೋಂದಣಿ (ನಿಮ್ಮ ಸ್ವಂತ ಮಾತುಗಳಲ್ಲಿ)", registrationNote: "ಹೀಗೆ ಕಾಣಿಸುತ್ತದೆ: ನೋಂದಣಿ (ಮಾಲೀಕರು ಹೇಳುವಂತೆ). ನಾವು ಇದನ್ನು ಪರಿಶೀಲಿಸುವುದಿಲ್ಲ.",
    formHeading: "ನನ್ನ ಪುಟಕ್ಕೆ ಸೇರಿಸಿ", formNote: "ಒಂದು ಫೋಟೋ, ಒಂದು ಹೆಸರು, ಒಂದು ಬೆಲೆ. ಪದಗಳು ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ ಮಾತ್ರ ಉಳಿಯುತ್ತವೆ.", formPhoto: "ಫೋಟೋ", formTitle: "ಇದು ಏನು", formPrice: "ರೂಪಾಯಿಗಳಲ್ಲಿ ಬೆಲೆ (ಅಂಗಡಿಯನ್ನು ಕೇಳಿ ಎಂದರೆ ಖಾಲಿ ಬಿಡಿ)", formPriceNote: "ಒಂದಕ್ಕೆ, ಕಿಲೋಗೆ...", formCategory: "ವರ್ಗ", formSubmit: "ನನ್ನ ಪುಟದಲ್ಲಿ ತೋರಿಸಿ",
    uploadHeading: "ಫೋಟೋಗಳು", uploadButton: "ಫೋಟೋ ಸೇರಿಸಿ", uploaded: (n) => `${n} ಫೋಟೋ ಸಿದ್ಧ. ಈಗ ಇದು ಏನು ಎಂದು ಅಸಿಸ್ಟೆಂಟ್‌ಗೆ ಹೇಳಿ.`,
    listHeading: "ನಿಮ್ಮ ಪುಟದಲ್ಲಿ", none: "ಇನ್ನೂ ಏನೂ ಇಲ್ಲ.", live: "ತೋರಿಸಲಾಗುತ್ತಿದೆ", draft: "ನಿಮ್ಮ ಟ್ಯಾಪ್‌ಗಾಗಿ ಕಾಯುತ್ತಿದೆ", hidden: "ಮರೆಮಾಡಲಾಗಿದೆ: 30 ದಿನಗಳಿಂದ ಖಚಿತಪಡಿಸಿಲ್ಲ", remove: "ತೆಗೆಯಿರಿ", confirmAgain: "ಮತ್ತೆ ತೋರಿಸಲು ಖಚಿತಪಡಿಸಿ", markSold: "ಮಾರಾಟವಾಯಿತು", edit: "ಬದಲಿಸಿ",
    link: "ನಿಮ್ಮ ಪುಟದಲ್ಲಿ ಏನಿದೆ", back: "ನಿಮ್ಮ ಅಂಗಡಿಗೆ ಹಿಂತಿರುಗಿ",
  },
  refusal: {
    protected: (a) => `ನಾನು ಇದನ್ನು ಪಟ್ಟಿ ಮಾಡಲಾರೆ: ${a} ಸಂರಕ್ಷಿತ ಪ್ರಾಣಿಗಳು, ಅವನ್ನು ಮಾರಲು ಅನುಮತಿ ಇಲ್ಲ. ದಯವಿಟ್ಟು ಅವನ್ನು ನಿಮ್ಮ ಪುಟದಲ್ಲಿ ಹಾಕಬೇಡಿ.`,
    health: "ನೀವೇ ಹೇಳಿಲ್ಲದಿದ್ದರೆ, ಪ್ರಾಣಿ ಆರೋಗ್ಯವಾಗಿದೆ, ಲಸಿಕೆ ಹಾಕಲಾಗಿದೆ ಅಥವಾ ಶುದ್ಧ ತಳಿಯದು ಎಂದು ನಾನು ಬರೆಯಲಾರೆ. ಸತ್ಯವಾಗಿದ್ದರೆ ನಿಮ್ಮ ಸ್ವಂತ ಮಾತುಗಳಲ್ಲಿ ಹೇಳಿ.",
    priceNotInWords: "ನಾನು ಬರೆಯುತ್ತಿದ್ದ ಬೆಲೆ ನೀವು ಹೇಳಿದ್ದಲ್ಲ, ಆದ್ದರಿಂದ ಲಿಸ್ಟಿಂಗ್ ಮಾಡಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಬೆಲೆಯನ್ನು ಮತ್ತೆ ಹೇಳಿ.", full: (n) => `ನೀವು ಈಗಾಗಲೇ ${n} ವಸ್ತುಗಳನ್ನು ತೋರಿಸುತ್ತಿದ್ದೀರಿ. ಮೊದಲು ಒಂದನ್ನು ತೆಗೆಯಿರಿ.`,
    tooManyDrafts: "ನಿಮ್ಮ ಟ್ಯಾಪ್‌ಗಾಗಿ ಈಗಾಗಲೇ ಲಿಸ್ಟಿಂಗ್‌ಗಳು ಕಾಯುತ್ತಿವೆ. ಮೊದಲು ಅವುಗಳಿಗೆ ಉತ್ತರಿಸಿ.", tooLong: "ಇದು ತುಂಬಾ ಉದ್ದವಾಗಿದೆ. ದಯವಿಟ್ಟು ಚಿಕ್ಕದಾಗಿ ಹೇಳಿ.", badPrice: "ಆ ಬೆಲೆ ಸರಿಯಿಲ್ಲ. ರೂಪಾಯಿಗಳ ಪೂರ್ಣ ಸಂಖ್ಯೆ ಬಳಸಿ.", badQty: "ಆ ಸಂಖ್ಯೆ ಸರಿಯಿಲ್ಲ.",
    claims: "ನೀವು ಹೇಳದ ಭರವಸೆ, ರಿಯಾಯಿತಿ ಅಥವಾ ಖಾತರಿಗಳನ್ನು ನಾನು ಬರೆಯಲಾರೆ. ಉದ್ದೇಶವಿದ್ದರೆ ನೀವೇ ಹೇಳಿ.", modelFailed: "ಈಗ ಅದನ್ನು ಬರೆಯಲಾಗಲಿಲ್ಲ. ನಿಮ್ಮ ಆ್ಯಪ್‌ನಲ್ಲಿ ನನ್ನ ಪುಟಕ್ಕೆ ಸೇರಿಸಿ ಫಾರ್ಮ್ ಬಳಸಿ.",
    badCategory: "ಆ ವರ್ಗ ನನಗೆ ಗೊತ್ತಿಲ್ಲ.", empty: "ಮೊದಲು ಇದು ಏನು ಎಂದು ಹೇಳಿ.", badPlace: "ಆ ಸ್ಥಳ ಸರಿಯಿಲ್ಲ.", tooManyPhotos: "ಒಂದು ಲಿಸ್ಟಿಂಗ್‌ನಲ್ಲಿ 3 ಫೋಟೋ ವರೆಗೆ ಇರಬಹುದು.", unknown: "ನನ್ನ ಬಳಿ ಆ ಲಿಸ್ಟಿಂಗ್ ಇಲ್ಲ.", gone: "ಆ ಲಿಸ್ಟಿಂಗ್ ಈಗ ನಿಮ್ಮ ಪುಟದಲ್ಲಿ ಇಲ್ಲ.",
    photo: { empty: "ಆ ಫೈಲ್ ಖಾಲಿಯಾಗಿದೆ.", too_big: "ಆ ಫೋಟೋ ತುಂಬಾ ದೊಡ್ಡದಾಗಿದೆ. ಚಿಕ್ಕದನ್ನು ಪ್ರಯತ್ನಿಸಿ.", not_a_photo: "ಅದು JPEG ಅಥವಾ WebP ಫೋಟೋ ಅಲ್ಲ.", unreadable: "ನನಗೆ ಆ ಫೋಟೋ ಓದಲಾಗಲಿಲ್ಲ.", too_large_sides: "ಆ ಫೋಟೋದ ಗಾತ್ರ ತುಂಬಾ ದೊಡ್ಡದಾಗಿದೆ.", animated: "ಚಲಿಸುವ ಚಿತ್ರವಲ್ಲ, ಸ್ಥಿರ ಫೋಟೋ ಬಳಸಿ.", day: "ಇಂದಿಗೆ ಇಷ್ಟು ಫೋಟೋ ಸಾಕು. ನಾಳೆ ಪ್ರಯತ್ನಿಸಿ." },
  },
};

export const LISTING_WORDS: Record<Language, ListingWords> = { en: EN, hi: HI, ml: ML, kn: KN };

/** The price as people read it: the owner's rupees, with the owner's own note ("each"), or "Ask the shop". */
export function priceLine(paise: number | undefined, note: string | undefined, language: Language): string {
  if (paise === undefined) return LISTING_WORDS[language].askShop;
  const rupees = paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
  const grouped = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(rupees));
  return `₹${grouped}${note ? ` ${note}` : ""}`;
}

/** The freshness in words: "Confirmed today", "Confirmed 2 days ago", or "Call to check". */
export function freshnessLine(freshness: "fresh" | "check", confirmedMs: number, nowMs: number, language: Language): string {
  const w = LISTING_WORDS[language];
  if (freshness === "check") return w.callToCheck;
  const days = Math.floor((nowMs - confirmedMs) / 86_400_000);
  return days <= 0 ? w.confirmedToday : w.confirmedAgo(days);
}

/** Every line in one language by id, with sample values, for the review sheets (bundle/panel/review.ts, ids "listings.*"). */
export function listingReviewLines(language: Language): Record<string, string> {
  const w = LISTING_WORDS[language];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(w.categories)) out[`category.${k}`] = v;
  const flat: [string, string | ((...a: never[]) => string)][] = [];
  for (const [k, v] of Object.entries(w)) if (k !== "categories" && k !== "owner" && k !== "refusal") flat.push([k, v as never]);
  for (const [k, v] of flat) {
    out[k] = typeof v === "string" ? v
      : k === "card" ? (v as ListingWords["card"])({ title: "Persian kitten", price: "₹8,000 each", category: w.categories.pets })
        : k === "confirmedAgo" ? w.confirmedAgo(2) : k === "quantity" ? w.quantity(2) : (v as (t: string) => string)("Persian kitten");
  }
  for (const [k, v] of Object.entries(w.owner)) out[`owner.${k}`] = typeof v === "string" ? v : (v as (n: number) => string)(2);
  for (const [k, v] of Object.entries(w.refusal)) {
    if (k === "photo") for (const [pk, pv] of Object.entries(v as Record<string, string>)) out[`refusal.photo.${pk}`] = pv;
    else out[`refusal.${k}`] = typeof v === "string" ? v : k === "full" ? (v as (n: number) => string)(50) : (v as (a: string) => string)("monkeys");
  }
  out.priceAsk = priceLine(undefined, undefined, language);
  out.priceSet = priceLine(800000, "each", language);
  return out;
}
