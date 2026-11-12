// The words of a shop's booking page and of the owner's private approvals page, in English, Hindi, Malayalam and Kannada. Used by modules/channels/page.ts and
// owner-page.ts, and nowhere else. English is the source; Hindi, Malayalam and Kannada are machine-written and wait for a native reader, like the rest of those
// languages (bundle/panel/languages.ts REVIEW_STATE), and each page says so in that language.
//
// Money and times are never written into these words by hand: each function takes the figure already formatted from the shop's settings and the saved booking
// (modules/language/format.ts), so the page states exactly what the record holds. No sentence here promises more than the code does: the page says the owner confirms
// a UPI payment, because the owner does; it never says a payment is checked by anyone else.
import type { Language } from "../language/languages.ts";

type W<T> = Record<Language, T>;

export interface PageWords {
  machine: string;
  title: (shop: string) => string;
  intro: (deposit: string, upi: boolean) => string;
  pickService: string; pickTime: string; yourDetails: string;
  name: string; phone: string; phoneNote: string;
  hold: string; change: string; minutes: (n: number) => string;
  noTimes: string; noDays: string; calendarUnread: string; paused: string;
  pending: string; notDone: string; unknown: string; keepLink: string;
  held: (until: string) => string;
  upiPay: (amount: string, payee: string, id: string) => string;
  openUpi: string; scan: string; note: (ref: string) => string; afterPay: string; paid: string;
  linkPay: (amount: string) => string;
  booked: (when: string) => string; checking: string; expired: string; cancelled: string; done: string; notHeld: string; again: string;
  refused: Record<string, string>;
  cancel: string; cancelRule: (hours: number) => string; messages: string;
  assistantsTitle: string; assistants: (mcp: string, api: string) => string;
  sent: string; tooMany: string; badForm: string; language: string;
}

export const PAGE: W<PageWords> = {
  en: {
    machine: "",
    title: (shop) => `Book at ${shop}`,
    intro: (deposit, upi) => `Choose a service, then a time. You pay a deposit of ${deposit} ${upi ? "by UPI, straight to the shop," : "by the shop's payment link"} to keep the time.`,
    pickService: "1. Choose a service", pickTime: "2. Choose a time", yourDetails: "3. Your name and phone number",
    name: "Your name", phone: "Phone number",
    phoneNote: "The shop uses this number only to reach you about this booking. Nothing is sent to it from this page.",
    hold: "Hold this time", change: "Change", minutes: (n) => `${n} min`,
    noTimes: "No free times on this day.", noDays: "No free times in the coming days. Please contact the shop.",
    calendarUnread: "The shop's free times could not be read just now. Please try again in a minute.",
    paused: "Online booking is paused just now. Please contact the shop.",
    pending: "Holding your time. This page updates by itself.",
    notDone: "The shop's system could not finish this request, so nothing is held. Please try again, or contact the shop.",
    unknown: "No booking has this address.",
    keepLink: "Keep this page's address: it is the only way to see or cancel this booking.",
    held: (until) => `Your time is held until ${until}. Pay the deposit before then to keep it.`,
    upiPay: (amount, payee, id) => `Pay ${amount} to ${payee} (${id}).`,
    openUpi: "Pay in your UPI app", scan: "Or scan this code with any UPI app.",
    note: (ref) => `Booking reference: ${ref}`,
    afterPay: "After you pay, the owner checks their UPI app and confirms the payment. This page then says Booked.",
    paid: "I have paid",
    linkPay: (amount) => `Pay ${amount}`,
    booked: (when) => `Booked: ${when}. See you then.`,
    checking: "Your deposit is in. The shop is confirming the time; this page will say when it is done.",
    expired: "The hold ended before the deposit was confirmed, so the time is free again.",
    cancelled: "This booking is cancelled.", done: "This booking is over. Thank you.",
    notHeld: "This time could not be held. Messages from the shop are below.", again: "Choose another time",
    refused: {
      paused: "Online booking is paused just now. Please contact the shop.",
      unknown_service: "The shop does not offer that service.",
      off_grid: "That is not one of the shop's start times.", too_soon: "That time is too soon to pay the deposit before it starts.",
      too_far: "That time is too far ahead to book here.", outside_hours: "The shop is closed at that time.",
      phone_busy: "This phone number already has two unpaid holds. Pay or cancel one first.",
      phone_day: "This phone number has started enough bookings for today.",
      shop_busy: "The shop has many unpaid holds just now. Please try again later.",
      unknown: "This request could not be booked.",
    },
    cancel: "Cancel booking", cancelRule: (h) => `Cancel at least ${h} hours before the start to get the deposit back. Later than that, the shop decides.`,
    messages: "Messages from the shop",
    assistantsTitle: "For AI assistants",
    assistants: (mcp, api) => `An AI assistant that supports MCP (such as Claude or ChatGPT) can book here for you, at ${mcp}. It can list the services and free times, hold a time, give you the payment details, show the booking and cancel it. It cannot mark a payment received or approve a refund: only the owner can, and the shop's own limits apply to every booking, however it is made. The booking API is at ${api}.`,
    sent: "Done.", tooMany: "Too many requests from here. Please wait a few minutes.", badForm: "Please check the form: a name of letters, and a phone number.",
    language: "Language",
  },
  hi: {
    machine: "यह हिंदी मशीन से लिखी गई है; किसी हिंदी भाषी ने अभी इसे जाँचा नहीं है।",
    title: (shop) => `${shop} में बुक करें`,
    intro: (deposit, upi) => `सेवा चुनिए, फिर समय। समय रखने के लिए ${deposit} की अग्रिम राशि ${upi ? "UPI से, सीधे दुकान को," : "दुकान के पेमेंट लिंक से"} दीजिए।`,
    pickService: "1. सेवा चुनिए", pickTime: "2. समय चुनिए", yourDetails: "3. आपका नाम और फ़ोन नंबर",
    name: "आपका नाम", phone: "फ़ोन नंबर",
    phoneNote: "दुकान यह नंबर सिर्फ़ इस बुकिंग के बारे में आपसे बात करने के लिए रखती है। इस पेज से इस पर कुछ नहीं भेजा जाता।",
    hold: "यह समय रोकिए", change: "बदलिए", minutes: (n) => `${n} मिनट`,
    noTimes: "इस दिन कोई खाली समय नहीं है।", noDays: "आने वाले दिनों में कोई खाली समय नहीं है। कृपया दुकान से संपर्क कीजिए।",
    calendarUnread: "दुकान के खाली समय अभी पढ़े नहीं जा सके। एक मिनट बाद फिर कोशिश कीजिए।",
    paused: "ऑनलाइन बुकिंग अभी रुकी हुई है। कृपया दुकान से संपर्क कीजिए।",
    pending: "आपका समय रोका जा रहा है। यह पेज अपने आप बदलेगा।",
    notDone: "दुकान का सिस्टम यह अनुरोध पूरा नहीं कर सका, इसलिए कुछ नहीं रोका गया। फिर कोशिश कीजिए, या दुकान से संपर्क कीजिए।",
    unknown: "इस पते की कोई बुकिंग नहीं है।",
    keepLink: "इस पेज का पता संभालकर रखिए: इस बुकिंग को देखने या रद्द करने का यही एक तरीक़ा है।",
    held: (until) => `आपका समय ${until} तक रुका है। उससे पहले अग्रिम राशि दीजिए।`,
    upiPay: (amount, payee, id) => `${payee} (${id}) को ${amount} दीजिए।`,
    openUpi: "अपने UPI ऐप में पेमेंट कीजिए", scan: "या किसी भी UPI ऐप से यह कोड स्कैन कीजिए।",
    note: (ref) => `बुकिंग नंबर: ${ref}`,
    afterPay: "पेमेंट के बाद मालिक अपने UPI ऐप में देखकर पेमेंट की पुष्टि करते हैं। फिर यह पेज बुक्ड दिखाएगा।",
    paid: "मैंने पेमेंट कर दिया",
    linkPay: (amount) => `${amount} दीजिए`,
    booked: (when) => `बुक हो गया: ${when}। तब मिलते हैं।`,
    checking: "आपकी अग्रिम राशि आ गई है। दुकान समय की पुष्टि कर रही है; हो जाने पर यह पेज बताएगा।",
    expired: "अग्रिम राशि की पुष्टि से पहले रोक ख़त्म हो गई, इसलिए समय फिर खाली है।",
    cancelled: "यह बुकिंग रद्द है।", done: "यह बुकिंग पूरी हो गई। धन्यवाद।",
    notHeld: "यह समय रोका नहीं जा सका। दुकान के संदेश नीचे हैं।", again: "दूसरा समय चुनिए",
    refused: {
      paused: "ऑनलाइन बुकिंग अभी रुकी हुई है। कृपया दुकान से संपर्क कीजिए।",
      unknown_service: "दुकान यह सेवा नहीं देती।",
      off_grid: "यह दुकान के शुरू होने के समयों में से नहीं है।", too_soon: "यह समय इतना जल्दी है कि उससे पहले अग्रिम राशि नहीं दी जा सकती।",
      too_far: "यह समय यहाँ बुक करने के लिए बहुत आगे का है।", outside_hours: "उस समय दुकान बंद रहती है।",
      phone_busy: "इस फ़ोन नंबर पर पहले से दो बिना पेमेंट की रोक हैं। पहले एक का पेमेंट कीजिए या उसे रद्द कीजिए।",
      phone_day: "इस फ़ोन नंबर से आज के लिए काफ़ी बुकिंग शुरू हो चुकी हैं।",
      shop_busy: "दुकान पर अभी बहुत-सी बिना पेमेंट की रोक हैं। कृपया बाद में कोशिश कीजिए।",
      unknown: "यह अनुरोध बुक नहीं हो सका।",
    },
    cancel: "बुकिंग रद्द कीजिए", cancelRule: (h) => `अग्रिम राशि वापस पाने के लिए शुरू होने से कम से कम ${h} घंटे पहले रद्द कीजिए। उसके बाद दुकान तय करती है।`,
    messages: "दुकान के संदेश",
    assistantsTitle: "AI सहायकों के लिए",
    assistants: (mcp, api) => `MCP वाला कोई AI सहायक (जैसे Claude या ChatGPT) यहाँ आपके लिए बुक कर सकता है: ${mcp}। वह सेवाएँ और खाली समय देख सकता है, समय रोक सकता है, पेमेंट की जानकारी दे सकता है, बुकिंग दिखा सकता है और रद्द कर सकता है। वह पेमेंट मिला हुआ नहीं मान सकता और रिफ़ंड मंज़ूर नहीं कर सकता: यह सिर्फ़ मालिक कर सकते हैं, और हर बुकिंग पर दुकान की अपनी सीमाएँ लागू होती हैं। बुकिंग API: ${api}।`,
    sent: "हो गया।", tooMany: "यहाँ से बहुत अनुरोध आए हैं। कुछ मिनट रुकिए।", badForm: "फ़ॉर्म जाँचिए: अक्षरों में नाम, और फ़ोन नंबर।",
    language: "भाषा",
  },
  ml: {
    machine: "ഈ മലയാളം യന്ത്രം എഴുതിയതാണ്; മലയാളം അറിയുന്ന ഒരാൾ ഇതുവരെ പരിശോധിച്ചിട്ടില്ല.",
    title: (shop) => `${shop}-ൽ ബുക്ക് ചെയ്യൂ`,
    intro: (deposit, upi) => `ഒരു സേവനം തിരഞ്ഞെടുക്കൂ, പിന്നെ സമയം. സമയം നിലനിർത്താൻ ${deposit} അഡ്വാൻസ് ${upi ? "UPI വഴി നേരെ കടയ്ക്ക്" : "കടയുടെ പേയ്‌മെന്റ് ലിങ്ക് വഴി"} അടയ്ക്കണം.`,
    pickService: "1. സേവനം തിരഞ്ഞെടുക്കൂ", pickTime: "2. സമയം തിരഞ്ഞെടുക്കൂ", yourDetails: "3. നിങ്ങളുടെ പേരും ഫോൺ നമ്പറും",
    name: "നിങ്ങളുടെ പേര്", phone: "ഫോൺ നമ്പർ",
    phoneNote: "ഈ ബുക്കിംഗിനെക്കുറിച്ച് നിങ്ങളെ ബന്ധപ്പെടാൻ മാത്രമാണ് കട ഈ നമ്പർ ഉപയോഗിക്കുന്നത്. ഈ പേജിൽ നിന്ന് ഇതിലേക്ക് ഒന്നും അയയ്ക്കില്ല.",
    hold: "ഈ സമയം പിടിക്കൂ", change: "മാറ്റുക", minutes: (n) => `${n} മിനിറ്റ്`,
    noTimes: "ഈ ദിവസം ഒഴിവുള്ള സമയമില്ല.", noDays: "വരുന്ന ദിവസങ്ങളിൽ ഒഴിവുള്ള സമയമില്ല. ദയവായി കടയുമായി ബന്ധപ്പെടൂ.",
    calendarUnread: "കടയുടെ ഒഴിവുസമയങ്ങൾ ഇപ്പോൾ വായിക്കാനായില്ല. ഒരു മിനിറ്റ് കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കൂ.",
    paused: "ഓൺലൈൻ ബുക്കിംഗ് ഇപ്പോൾ നിർത്തിവച്ചിരിക്കുന്നു. ദയവായി കടയുമായി ബന്ധപ്പെടൂ.",
    pending: "നിങ്ങളുടെ സമയം പിടിക്കുന്നു. ഈ പേജ് തനിയെ പുതുക്കും.",
    notDone: "കടയുടെ സിസ്റ്റത്തിന് ഈ അഭ്യർത്ഥന പൂർത്തിയാക്കാനായില്ല, അതിനാൽ ഒന്നും പിടിച്ചിട്ടില്ല. വീണ്ടും ശ്രമിക്കൂ, അല്ലെങ്കിൽ കടയുമായി ബന്ധപ്പെടൂ.",
    unknown: "ഈ വിലാസത്തിൽ ബുക്കിംഗ് ഇല്ല.",
    keepLink: "ഈ പേജിന്റെ വിലാസം സൂക്ഷിക്കൂ: ഈ ബുക്കിംഗ് കാണാനോ റദ്ദാക്കാനോ ഉള്ള ഒരേയൊരു വഴി ഇതാണ്.",
    held: (until) => `നിങ്ങളുടെ സമയം ${until} വരെ പിടിച്ചിരിക്കുന്നു. അതിനുമുമ്പ് അഡ്വാൻസ് അടയ്ക്കൂ.`,
    upiPay: (amount, payee, id) => `${payee} (${id})-ന് ${amount} അടയ്ക്കൂ.`,
    openUpi: "നിങ്ങളുടെ UPI ആപ്പിൽ അടയ്ക്കൂ", scan: "അല്ലെങ്കിൽ ഏതെങ്കിലും UPI ആപ്പ് ഉപയോഗിച്ച് ഈ കോഡ് സ്കാൻ ചെയ്യൂ.",
    note: (ref) => `ബുക്കിംഗ് നമ്പർ: ${ref}`,
    afterPay: "അടച്ചതിനുശേഷം ഉടമ തന്റെ UPI ആപ്പിൽ നോക്കി പേയ്‌മെന്റ് സ്ഥിരീകരിക്കും. അപ്പോൾ ഈ പേജ് ബുക്ക് ചെയ്തു എന്ന് കാണിക്കും.",
    paid: "ഞാൻ അടച്ചു",
    linkPay: (amount) => `${amount} അടയ്ക്കൂ`,
    booked: (when) => `ബുക്ക് ചെയ്തു: ${when}. അപ്പോൾ കാണാം.`,
    checking: "നിങ്ങളുടെ അഡ്വാൻസ് കിട്ടി. കട സമയം സ്ഥിരീകരിക്കുന്നു; കഴിഞ്ഞാൽ ഈ പേജ് പറയും.",
    expired: "അഡ്വാൻസ് സ്ഥിരീകരിക്കുന്നതിനുമുമ്പ് പിടി അവസാനിച്ചു, അതിനാൽ സമയം വീണ്ടും ഒഴിവാണ്.",
    cancelled: "ഈ ബുക്കിംഗ് റദ്ദാക്കി.", done: "ഈ ബുക്കിംഗ് കഴിഞ്ഞു. നന്ദി.",
    notHeld: "ഈ സമയം പിടിക്കാനായില്ല. കടയുടെ സന്ദേശങ്ങൾ താഴെയുണ്ട്.", again: "മറ്റൊരു സമയം തിരഞ്ഞെടുക്കൂ",
    refused: {
      paused: "ഓൺലൈൻ ബുക്കിംഗ് ഇപ്പോൾ നിർത്തിവച്ചിരിക്കുന്നു. ദയവായി കടയുമായി ബന്ധപ്പെടൂ.",
      unknown_service: "കട ആ സേവനം നൽകുന്നില്ല.",
      off_grid: "അത് കടയുടെ തുടങ്ങുന്ന സമയങ്ങളിൽ ഒന്നല്ല.", too_soon: "ആ സമയം വളരെ അടുത്താണ്; അതിനുമുമ്പ് അഡ്വാൻസ് അടയ്ക്കാനാവില്ല.",
      too_far: "ആ സമയം ഇവിടെ ബുക്ക് ചെയ്യാൻ വളരെ ദൂരെയാണ്.", outside_hours: "ആ സമയത്ത് കട അടച്ചിരിക്കും.",
      phone_busy: "ഈ ഫോൺ നമ്പറിന് ഇതിനകം അടയ്ക്കാത്ത രണ്ട് പിടികളുണ്ട്. ആദ്യം ഒന്ന് അടയ്ക്കുകയോ റദ്ദാക്കുകയോ ചെയ്യൂ.",
      phone_day: "ഈ ഫോൺ നമ്പറിൽ നിന്ന് ഇന്നത്തേക്ക് ആവശ്യത്തിന് ബുക്കിംഗുകൾ തുടങ്ങി.",
      shop_busy: "കടയിൽ ഇപ്പോൾ അടയ്ക്കാത്ത ധാരാളം പിടികളുണ്ട്. പിന്നീട് ശ്രമിക്കൂ.",
      unknown: "ഈ അഭ്യർത്ഥന ബുക്ക് ചെയ്യാനായില്ല.",
    },
    cancel: "ബുക്കിംഗ് റദ്ദാക്കൂ", cancelRule: (h) => `അഡ്വാൻസ് തിരികെ കിട്ടാൻ തുടങ്ങുന്നതിന് കുറഞ്ഞത് ${h} മണിക്കൂർ മുമ്പ് റദ്ദാക്കൂ. അതിനുശേഷം കട തീരുമാനിക്കും.`,
    messages: "കടയുടെ സന്ദേശങ്ങൾ",
    assistantsTitle: "AI സഹായികൾക്ക്",
    assistants: (mcp, api) => `MCP പിന്തുണയ്ക്കുന്ന ഒരു AI സഹായിക്ക് (Claude, ChatGPT പോലെ) നിങ്ങൾക്കായി ഇവിടെ ബുക്ക് ചെയ്യാം: ${mcp}. സേവനങ്ങളും ഒഴിവുസമയങ്ങളും കാണാനും, സമയം പിടിക്കാനും, പേയ്‌മെന്റ് വിവരങ്ങൾ നൽകാനും, ബുക്കിംഗ് കാണിക്കാനും റദ്ദാക്കാനും അതിന് കഴിയും. പേയ്‌മെന്റ് കിട്ടിയെന്ന് രേഖപ്പെടുത്താനോ റീഫണ്ട് അംഗീകരിക്കാനോ അതിന് കഴിയില്ല: അത് ഉടമയ്ക്ക് മാത്രമേ കഴിയൂ, ഓരോ ബുക്കിംഗിനും കടയുടെ സ്വന്തം പരിധികൾ ബാധകമാണ്. ബുക്കിംഗ് API: ${api}.`,
    sent: "ചെയ്തു.", tooMany: "ഇവിടെ നിന്ന് വളരെയധികം അഭ്യർത്ഥനകൾ. കുറച്ച് മിനിറ്റ് കാത്തിരിക്കൂ.", badForm: "ഫോം പരിശോധിക്കൂ: അക്ഷരങ്ങളിൽ പേര്, ഒരു ഫോൺ നമ്പർ.",
    language: "ഭാഷ",
  },
  kn: {
    machine: "ಈ ಕನ್ನಡವನ್ನು ಯಂತ್ರ ಬರೆದಿದೆ; ಕನ್ನಡ ಬಲ್ಲವರು ಇನ್ನೂ ಪರಿಶೀಲಿಸಿಲ್ಲ.",
    title: (shop) => `${shop} ನಲ್ಲಿ ಬುಕ್ ಮಾಡಿ`,
    intro: (deposit, upi) => `ಸೇವೆಯನ್ನು ಆರಿಸಿ, ನಂತರ ಸಮಯ. ಸಮಯವನ್ನು ಉಳಿಸಿಕೊಳ್ಳಲು ${deposit} ಮುಂಗಡವನ್ನು ${upi ? "UPI ಮೂಲಕ ನೇರವಾಗಿ ಅಂಗಡಿಗೆ" : "ಅಂಗಡಿಯ ಪಾವತಿ ಲಿಂಕ್ ಮೂಲಕ"} ಪಾವತಿಸಿ.`,
    pickService: "1. ಸೇವೆಯನ್ನು ಆರಿಸಿ", pickTime: "2. ಸಮಯವನ್ನು ಆರಿಸಿ", yourDetails: "3. ನಿಮ್ಮ ಹೆಸರು ಮತ್ತು ಫೋನ್ ನಂಬರ್",
    name: "ನಿಮ್ಮ ಹೆಸರು", phone: "ಫೋನ್ ನಂಬರ್",
    phoneNote: "ಈ ಬುಕಿಂಗ್ ಬಗ್ಗೆ ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸಲು ಮಾತ್ರ ಅಂಗಡಿ ಈ ನಂಬರ್ ಬಳಸುತ್ತದೆ. ಈ ಪುಟದಿಂದ ಇದಕ್ಕೆ ಏನನ್ನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ.",
    hold: "ಈ ಸಮಯವನ್ನು ಹಿಡಿದಿಡಿ", change: "ಬದಲಿಸಿ", minutes: (n) => `${n} ನಿಮಿಷ`,
    noTimes: "ಈ ದಿನ ಖಾಲಿ ಸಮಯವಿಲ್ಲ.", noDays: "ಮುಂದಿನ ದಿನಗಳಲ್ಲಿ ಖಾಲಿ ಸಮಯವಿಲ್ಲ. ದಯವಿಟ್ಟು ಅಂಗಡಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    calendarUnread: "ಅಂಗಡಿಯ ಖಾಲಿ ಸಮಯಗಳನ್ನು ಈಗ ಓದಲಾಗಲಿಲ್ಲ. ಒಂದು ನಿಮಿಷದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    paused: "ಆನ್‌ಲೈನ್ ಬುಕಿಂಗ್ ಈಗ ನಿಂತಿದೆ. ದಯವಿಟ್ಟು ಅಂಗಡಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    pending: "ನಿಮ್ಮ ಸಮಯವನ್ನು ಹಿಡಿದಿಡಲಾಗುತ್ತಿದೆ. ಈ ಪುಟ ತಾನಾಗಿ ಬದಲಾಗುತ್ತದೆ.",
    notDone: "ಅಂಗಡಿಯ ವ್ಯವಸ್ಥೆ ಈ ವಿನಂತಿಯನ್ನು ಮುಗಿಸಲಾಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಏನನ್ನೂ ಹಿಡಿದಿಟ್ಟಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ, ಅಥವಾ ಅಂಗಡಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    unknown: "ಈ ವಿಳಾಸದಲ್ಲಿ ಯಾವುದೇ ಬುಕಿಂಗ್ ಇಲ್ಲ.",
    keepLink: "ಈ ಪುಟದ ವಿಳಾಸವನ್ನು ಉಳಿಸಿಕೊಳ್ಳಿ: ಈ ಬುಕಿಂಗ್ ನೋಡಲು ಅಥವಾ ರದ್ದುಗೊಳಿಸಲು ಇದೊಂದೇ ದಾರಿ.",
    held: (until) => `ನಿಮ್ಮ ಸಮಯವನ್ನು ${until} ವರೆಗೆ ಹಿಡಿದಿಡಲಾಗಿದೆ. ಅದಕ್ಕೂ ಮೊದಲು ಮುಂಗಡ ಪಾವತಿಸಿ.`,
    upiPay: (amount, payee, id) => `${payee} (${id}) ಗೆ ${amount} ಪಾವತಿಸಿ.`,
    openUpi: "ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ಪಾವತಿಸಿ", scan: "ಅಥವಾ ಯಾವುದೇ UPI ಆ್ಯಪ್‌ನಿಂದ ಈ ಕೋಡ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ.",
    note: (ref) => `ಬುಕಿಂಗ್ ಸಂಖ್ಯೆ: ${ref}`,
    afterPay: "ಪಾವತಿಸಿದ ನಂತರ ಮಾಲೀಕರು ತಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ ಪಾವತಿಯನ್ನು ದೃಢೀಕರಿಸುತ್ತಾರೆ. ಆಗ ಈ ಪುಟ ಬುಕ್ ಆಗಿದೆ ಎಂದು ತೋರಿಸುತ್ತದೆ.",
    paid: "ನಾನು ಪಾವತಿಸಿದ್ದೇನೆ",
    linkPay: (amount) => `${amount} ಪಾವತಿಸಿ`,
    booked: (when) => `ಬುಕ್ ಆಗಿದೆ: ${when}. ಆಗ ಭೇಟಿಯಾಗೋಣ.`,
    checking: "ನಿಮ್ಮ ಮುಂಗಡ ಬಂದಿದೆ. ಅಂಗಡಿ ಸಮಯವನ್ನು ದೃಢೀಕರಿಸುತ್ತಿದೆ; ಆದಾಗ ಈ ಪುಟ ತಿಳಿಸುತ್ತದೆ.",
    expired: "ಮುಂಗಡ ದೃಢೀಕರಣಕ್ಕೂ ಮೊದಲು ಹಿಡಿತ ಮುಗಿಯಿತು, ಆದ್ದರಿಂದ ಸಮಯ ಮತ್ತೆ ಖಾಲಿಯಾಗಿದೆ.",
    cancelled: "ಈ ಬುಕಿಂಗ್ ರದ್ದಾಗಿದೆ.", done: "ಈ ಬುಕಿಂಗ್ ಮುಗಿದಿದೆ. ಧನ್ಯವಾದ.",
    notHeld: "ಈ ಸಮಯವನ್ನು ಹಿಡಿದಿಡಲಾಗಲಿಲ್ಲ. ಅಂಗಡಿಯ ಸಂದೇಶಗಳು ಕೆಳಗಿವೆ.", again: "ಬೇರೆ ಸಮಯ ಆರಿಸಿ",
    refused: {
      paused: "ಆನ್‌ಲೈನ್ ಬುಕಿಂಗ್ ಈಗ ನಿಂತಿದೆ. ದಯವಿಟ್ಟು ಅಂಗಡಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ.",
      unknown_service: "ಅಂಗಡಿ ಆ ಸೇವೆಯನ್ನು ನೀಡುವುದಿಲ್ಲ.",
      off_grid: "ಅದು ಅಂಗಡಿಯ ಆರಂಭದ ಸಮಯಗಳಲ್ಲಿ ಒಂದಲ್ಲ.", too_soon: "ಆ ಸಮಯ ತುಂಬಾ ಹತ್ತಿರವಿದೆ; ಅದಕ್ಕೂ ಮೊದಲು ಮುಂಗಡ ಪಾವತಿಸಲಾಗದು.",
      too_far: "ಆ ಸಮಯ ಇಲ್ಲಿ ಬುಕ್ ಮಾಡಲು ತುಂಬಾ ದೂರವಿದೆ.", outside_hours: "ಆ ಸಮಯದಲ್ಲಿ ಅಂಗಡಿ ಮುಚ್ಚಿರುತ್ತದೆ.",
      phone_busy: "ಈ ಫೋನ್ ನಂಬರ್‌ಗೆ ಈಗಾಗಲೇ ಪಾವತಿಸದ ಎರಡು ಹಿಡಿತಗಳಿವೆ. ಮೊದಲು ಒಂದನ್ನು ಪಾವತಿಸಿ ಅಥವಾ ರದ್ದುಗೊಳಿಸಿ.",
      phone_day: "ಈ ಫೋನ್ ನಂಬರ್‌ನಿಂದ ಇಂದಿಗೆ ಸಾಕಷ್ಟು ಬುಕಿಂಗ್‌ಗಳು ಆರಂಭವಾಗಿವೆ.",
      shop_busy: "ಅಂಗಡಿಯಲ್ಲಿ ಈಗ ಪಾವತಿಸದ ಹಲವು ಹಿಡಿತಗಳಿವೆ. ನಂತರ ಪ್ರಯತ್ನಿಸಿ.",
      unknown: "ಈ ವಿನಂತಿಯನ್ನು ಬುಕ್ ಮಾಡಲಾಗಲಿಲ್ಲ.",
    },
    cancel: "ಬುಕಿಂಗ್ ರದ್ದುಗೊಳಿಸಿ", cancelRule: (h) => `ಮುಂಗಡ ಮರಳಿ ಪಡೆಯಲು ಆರಂಭಕ್ಕೆ ಕನಿಷ್ಠ ${h} ಗಂಟೆ ಮೊದಲು ರದ್ದುಗೊಳಿಸಿ. ಅದರ ನಂತರ ಅಂಗಡಿ ನಿರ್ಧರಿಸುತ್ತದೆ.`,
    messages: "ಅಂಗಡಿಯ ಸಂದೇಶಗಳು",
    assistantsTitle: "AI ಸಹಾಯಕರಿಗೆ",
    assistants: (mcp, api) => `MCP ಬೆಂಬಲಿಸುವ AI ಸಹಾಯಕ (Claude ಅಥವಾ ChatGPT ಮುಂತಾದವು) ನಿಮಗಾಗಿ ಇಲ್ಲಿ ಬುಕ್ ಮಾಡಬಹುದು: ${mcp}. ಅದು ಸೇವೆಗಳು ಮತ್ತು ಖಾಲಿ ಸಮಯಗಳನ್ನು ನೋಡಬಹುದು, ಸಮಯ ಹಿಡಿದಿಡಬಹುದು, ಪಾವತಿ ವಿವರ ನೀಡಬಹುದು, ಬುಕಿಂಗ್ ತೋರಿಸಬಹುದು ಮತ್ತು ರದ್ದುಗೊಳಿಸಬಹುದು. ಪಾವತಿ ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಲು ಅಥವಾ ರೀಫಂಡ್ ಅನುಮೋದಿಸಲು ಅದಕ್ಕೆ ಆಗುವುದಿಲ್ಲ: ಅದನ್ನು ಮಾಲೀಕರು ಮಾತ್ರ ಮಾಡಬಹುದು, ಮತ್ತು ಪ್ರತಿ ಬುಕಿಂಗ್‌ಗೆ ಅಂಗಡಿಯ ಸ್ವಂತ ಮಿತಿಗಳು ಅನ್ವಯಿಸುತ್ತವೆ. ಬುಕಿಂಗ್ API: ${api}.`,
    sent: "ಆಯಿತು.", tooMany: "ಇಲ್ಲಿಂದ ತುಂಬಾ ವಿನಂತಿಗಳು ಬಂದಿವೆ. ಕೆಲವು ನಿಮಿಷ ಕಾಯಿರಿ.", badForm: "ಫಾರ್ಮ್ ಪರಿಶೀಲಿಸಿ: ಅಕ್ಷರಗಳಲ್ಲಿ ಹೆಸರು, ಮತ್ತು ಫೋನ್ ನಂಬರ್.",
    language: "ಭಾಷೆ",
  },
};

export interface OwnerWords {
  title: (shop: string) => string;
  privateNote: string;
  none: string; waiting: string; upcoming: string; noneComing: string;
  who: (name: string | undefined, phone: string, from: string) => string;
  from: Record<"whatsapp" | "web" | "mcp", string>;
  deposit: (who: string, amount: string, what: string) => string; received: (amount: string) => string;
  refundOwed: (who: string, amount: string, why: string) => string; refundSent: string; kept: string;
  lateRefund: (who: string, what: string, amount: string) => string; refundIt: string; keepIt: string;
  calendar: (who: string, what: string, amount: string) => string; retry: string; cancelRefund: string;
  guardRefund: (who: string, amount: string, what: string, until: string) => string; approve: string; deny: string;
  result: Record<"done" | "changed" | "expired" | "error" | "denied_link", string>;
}

export const OWNER: W<OwnerWords> = {
  en: {
    title: (shop) => `${shop}: what waits for you`,
    privateNote: "This page is private. Anyone with its address can answer for you, so do not share it. The person who set up your shop can switch this link off and give you a new one.",
    none: "Nothing waits for you just now.", waiting: "Waiting for your answer", upcoming: "Coming bookings", noneComing: "No bookings in the coming week.",
    who: (name, phone, from) => `${name ? `${name}, ` : ""}${phone} (${from})`,
    from: { whatsapp: "WhatsApp", web: "booking page", mcp: "AI assistant" },
    deposit: (who, amount, what) => `${who} should pay ${amount} for ${what}. Has it reached your UPI app?`,
    received: (amount) => `Yes, ${amount} received`,
    refundOwed: (who, amount, why) => `You owe ${who} ${amount} back (${why}). Send it from your UPI app, then press:`,
    refundSent: "Refund sent", kept: "Kept for a booking I made by hand",
    lateRefund: (who, what, amount) => `${who} cancelled ${what} late. Their deposit is ${amount}.`,
    refundIt: "Give the deposit back", keepIt: "Keep the deposit",
    calendar: (who, what, amount) => `${who} paid ${amount} for ${what}, but the time could not be confirmed in the calendar. It is not booked yet.`,
    retry: "Check the calendar again", cancelRefund: "Cancel and give the deposit back",
    guardRefund: (who, amount, what, until) => `A refund of ${amount} to ${who} for ${what} waits for your yes, until ${until}.`,
    approve: "Approve the refund", deny: "Do not refund",
    result: {
      done: "Done. The list below shows what waits now.",
      changed: "That had changed before you pressed (it was answered, or the amount changed), so nothing was done. Look at the list again.",
      expired: "That ran out before your answer, so nothing was done.",
      error: "That could not be done just now. Please try again in a minute.",
      denied_link: "This link does not work any more. Ask the person who set up your shop for a new one.",
    },
  },
  hi: {
    title: (shop) => `${shop}: आपके जवाब का इंतज़ार`,
    privateNote: "यह पेज निजी है। जिसके पास इसका पता है, वह आपकी ओर से जवाब दे सकता है, इसलिए इसे किसी से साझा मत कीजिए। आपकी दुकान सेट करने वाले इस लिंक को बंद करके नया दे सकते हैं।",
    none: "अभी आपके लिए कुछ नहीं है।", waiting: "आपके जवाब का इंतज़ार", upcoming: "आने वाली बुकिंग", noneComing: "अगले हफ़्ते कोई बुकिंग नहीं है।",
    who: (name, phone, from) => `${name ? `${name}, ` : ""}${phone} (${from})`,
    from: { whatsapp: "WhatsApp", web: "बुकिंग पेज", mcp: "AI सहायक" },
    deposit: (who, amount, what) => `${who} को ${what} के लिए ${amount} देने हैं। क्या यह आपके UPI ऐप में आ गया?`,
    received: (amount) => `हाँ, ${amount} मिल गए`,
    refundOwed: (who, amount, why) => `आपको ${who} को ${amount} लौटाने हैं (${why})। अपने UPI ऐप से भेजिए, फिर दबाइए:`,
    refundSent: "रिफ़ंड भेज दिया", kept: "हाथ से की गई बुकिंग के लिए रख लिया",
    lateRefund: (who, what, amount) => `${who} ने ${what} देर से रद्द किया। उनकी अग्रिम राशि ${amount} है।`,
    refundIt: "अग्रिम राशि लौटाइए", keepIt: "अग्रिम राशि रखिए",
    calendar: (who, what, amount) => `${who} ने ${what} के लिए ${amount} दिए, पर कैलेंडर में समय की पुष्टि नहीं हो सकी। अभी बुक नहीं है।`,
    retry: "कैलेंडर फिर देखिए", cancelRefund: "रद्द कीजिए और अग्रिम राशि लौटाइए",
    guardRefund: (who, amount, what, until) => `${who} को ${what} के लिए ${amount} का रिफ़ंड ${until} तक आपकी हाँ का इंतज़ार कर रहा है।`,
    approve: "रिफ़ंड मंज़ूर कीजिए", deny: "रिफ़ंड मत दीजिए",
    result: {
      done: "हो गया। नीचे की सूची में अब का बचा काम है।",
      changed: "आपके दबाने से पहले यह बदल गया था (जवाब दिया जा चुका था, या रक़म बदली), इसलिए कुछ नहीं किया गया। सूची फिर देखिए।",
      expired: "आपके जवाब से पहले समय ख़त्म हो गया, इसलिए कुछ नहीं किया गया।",
      error: "अभी यह नहीं हो सका। एक मिनट बाद फिर कोशिश कीजिए।",
      denied_link: "यह लिंक अब काम नहीं करता। अपनी दुकान सेट करने वाले से नया माँगिए।",
    },
  },
  ml: {
    title: (shop) => `${shop}: നിങ്ങളുടെ മറുപടിക്കായി കാത്തിരിക്കുന്നവ`,
    privateNote: "ഈ പേജ് സ്വകാര്യമാണ്. ഇതിന്റെ വിലാസമുള്ള ആർക്കും നിങ്ങൾക്കുവേണ്ടി മറുപടി നൽകാം, അതിനാൽ ഇത് പങ്കിടരുത്. നിങ്ങളുടെ കട സജ്ജമാക്കിയ ആൾക്ക് ഈ ലിങ്ക് ഓഫാക്കി പുതിയത് തരാം.",
    none: "ഇപ്പോൾ നിങ്ങൾക്കായി ഒന്നും കാത്തിരിക്കുന്നില്ല.", waiting: "നിങ്ങളുടെ മറുപടിക്കായി", upcoming: "വരുന്ന ബുക്കിംഗുകൾ", noneComing: "വരുന്ന ആഴ്ച ബുക്കിംഗുകളില്ല.",
    who: (name, phone, from) => `${name ? `${name}, ` : ""}${phone} (${from})`,
    from: { whatsapp: "WhatsApp", web: "ബുക്കിംഗ് പേജ്", mcp: "AI സഹായി" },
    deposit: (who, amount, what) => `${who} ${what}-ന് ${amount} അടയ്ക്കണം. അത് നിങ്ങളുടെ UPI ആപ്പിൽ എത്തിയോ?`,
    received: (amount) => `അതെ, ${amount} കിട്ടി`,
    refundOwed: (who, amount, why) => `നിങ്ങൾ ${who}-ന് ${amount} തിരികെ നൽകണം (${why}). നിങ്ങളുടെ UPI ആപ്പിൽ നിന്ന് അയച്ചിട്ട് അമർത്തൂ:`,
    refundSent: "റീഫണ്ട് അയച്ചു", kept: "കൈകൊണ്ട് ചെയ്ത ബുക്കിംഗിനായി സൂക്ഷിച്ചു",
    lateRefund: (who, what, amount) => `${who} ${what} വൈകി റദ്ദാക്കി. അവരുടെ അഡ്വാൻസ് ${amount} ആണ്.`,
    refundIt: "അഡ്വാൻസ് തിരികെ നൽകൂ", keepIt: "അഡ്വാൻസ് സൂക്ഷിക്കൂ",
    calendar: (who, what, amount) => `${who} ${what}-ന് ${amount} അടച്ചു, പക്ഷേ കലണ്ടറിൽ സമയം സ്ഥിരീകരിക്കാനായില്ല. ഇതുവരെ ബുക്ക് ആയിട്ടില്ല.`,
    retry: "കലണ്ടർ വീണ്ടും നോക്കൂ", cancelRefund: "റദ്ദാക്കി അഡ്വാൻസ് തിരികെ നൽകൂ",
    guardRefund: (who, amount, what, until) => `${who}-ന് ${what}-നുള്ള ${amount} റീഫണ്ട് ${until} വരെ നിങ്ങളുടെ സമ്മതത്തിനായി കാത്തിരിക്കുന്നു.`,
    approve: "റീഫണ്ട് അംഗീകരിക്കൂ", deny: "റീഫണ്ട് നൽകേണ്ട",
    result: {
      done: "ചെയ്തു. ഇപ്പോൾ കാത്തിരിക്കുന്നവ താഴെയുള്ള പട്ടികയിലുണ്ട്.",
      changed: "നിങ്ങൾ അമർത്തുന്നതിനുമുമ്പ് ഇത് മാറിയിരുന്നു (മറുപടി നൽകിയിരുന്നു, അല്ലെങ്കിൽ തുക മാറി), അതിനാൽ ഒന്നും ചെയ്തില്ല. പട്ടിക വീണ്ടും നോക്കൂ.",
      expired: "നിങ്ങളുടെ മറുപടിക്കുമുമ്പ് സമയം കഴിഞ്ഞു, അതിനാൽ ഒന്നും ചെയ്തില്ല.",
      error: "ഇപ്പോൾ ഇത് ചെയ്യാനായില്ല. ഒരു മിനിറ്റ് കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കൂ.",
      denied_link: "ഈ ലിങ്ക് ഇനി പ്രവർത്തിക്കില്ല. നിങ്ങളുടെ കട സജ്ജമാക്കിയ ആളോട് പുതിയത് ചോദിക്കൂ.",
    },
  },
  kn: {
    title: (shop) => `${shop}: ನಿಮ್ಮ ಉತ್ತರಕ್ಕಾಗಿ ಕಾಯುತ್ತಿರುವುದು`,
    privateNote: "ಈ ಪುಟ ಖಾಸಗಿ. ಇದರ ವಿಳಾಸ ಇರುವ ಯಾರಾದರೂ ನಿಮ್ಮ ಪರವಾಗಿ ಉತ್ತರಿಸಬಹುದು, ಆದ್ದರಿಂದ ಇದನ್ನು ಹಂಚಿಕೊಳ್ಳಬೇಡಿ. ನಿಮ್ಮ ಅಂಗಡಿಯನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರು ಈ ಲಿಂಕ್ ನಿಲ್ಲಿಸಿ ಹೊಸದನ್ನು ಕೊಡಬಹುದು.",
    none: "ಈಗ ನಿಮಗಾಗಿ ಏನೂ ಕಾಯುತ್ತಿಲ್ಲ.", waiting: "ನಿಮ್ಮ ಉತ್ತರಕ್ಕಾಗಿ", upcoming: "ಮುಂದಿನ ಬುಕಿಂಗ್‌ಗಳು", noneComing: "ಮುಂದಿನ ವಾರ ಯಾವುದೇ ಬುಕಿಂಗ್ ಇಲ್ಲ.",
    who: (name, phone, from) => `${name ? `${name}, ` : ""}${phone} (${from})`,
    from: { whatsapp: "WhatsApp", web: "ಬುಕಿಂಗ್ ಪುಟ", mcp: "AI ಸಹಾಯಕ" },
    deposit: (who, amount, what) => `${who} ${what} ಗಾಗಿ ${amount} ಪಾವತಿಸಬೇಕು. ಅದು ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ಗೆ ಬಂದಿದೆಯೇ?`,
    received: (amount) => `ಹೌದು, ${amount} ಬಂದಿದೆ`,
    refundOwed: (who, amount, why) => `ನೀವು ${who} ಗೆ ${amount} ಮರಳಿ ನೀಡಬೇಕು (${why}). ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ನಿಂದ ಕಳುಹಿಸಿ, ನಂತರ ಒತ್ತಿ:`,
    refundSent: "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ", kept: "ಕೈಯಾರೆ ಮಾಡಿದ ಬುಕಿಂಗ್‌ಗಾಗಿ ಇಟ್ಟುಕೊಂಡೆ",
    lateRefund: (who, what, amount) => `${who} ${what} ಅನ್ನು ತಡವಾಗಿ ರದ್ದುಗೊಳಿಸಿದರು. ಅವರ ಮುಂಗಡ ${amount}.`,
    refundIt: "ಮುಂಗಡ ಮರಳಿ ನೀಡಿ", keepIt: "ಮುಂಗಡ ಇಟ್ಟುಕೊಳ್ಳಿ",
    calendar: (who, what, amount) => `${who} ${what} ಗಾಗಿ ${amount} ಪಾವತಿಸಿದರು, ಆದರೆ ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಸಮಯ ದೃಢೀಕರಿಸಲಾಗಲಿಲ್ಲ. ಇನ್ನೂ ಬುಕ್ ಆಗಿಲ್ಲ.`,
    retry: "ಕ್ಯಾಲೆಂಡರ್ ಮತ್ತೆ ನೋಡಿ", cancelRefund: "ರದ್ದುಗೊಳಿಸಿ ಮುಂಗಡ ಮರಳಿ ನೀಡಿ",
    guardRefund: (who, amount, what, until) => `${who} ಗೆ ${what} ಗಾಗಿ ${amount} ರೀಫಂಡ್ ${until} ವರೆಗೆ ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗಾಗಿ ಕಾಯುತ್ತಿದೆ.`,
    approve: "ರೀಫಂಡ್ ಅನುಮೋದಿಸಿ", deny: "ರೀಫಂಡ್ ಬೇಡ",
    result: {
      done: "ಆಯಿತು. ಈಗ ಕಾಯುತ್ತಿರುವುದು ಕೆಳಗಿನ ಪಟ್ಟಿಯಲ್ಲಿದೆ.",
      changed: "ನೀವು ಒತ್ತುವ ಮೊದಲೇ ಇದು ಬದಲಾಗಿತ್ತು (ಉತ್ತರಿಸಲಾಗಿತ್ತು, ಅಥವಾ ಮೊತ್ತ ಬದಲಾಯಿತು), ಆದ್ದರಿಂದ ಏನೂ ಮಾಡಲಿಲ್ಲ. ಪಟ್ಟಿಯನ್ನು ಮತ್ತೆ ನೋಡಿ.",
      expired: "ನಿಮ್ಮ ಉತ್ತರಕ್ಕೂ ಮೊದಲು ಸಮಯ ಮುಗಿಯಿತು, ಆದ್ದರಿಂದ ಏನೂ ಮಾಡಲಿಲ್ಲ.",
      error: "ಈಗ ಇದನ್ನು ಮಾಡಲಾಗಲಿಲ್ಲ. ಒಂದು ನಿಮಿಷದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
      denied_link: "ಈ ಲಿಂಕ್ ಇನ್ನು ಕೆಲಸ ಮಾಡುವುದಿಲ್ಲ. ನಿಮ್ಮ ಅಂಗಡಿಯನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರಿಂದ ಹೊಸದನ್ನು ಕೇಳಿ.",
    },
  },
};
