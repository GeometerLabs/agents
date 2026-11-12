// Item 11h: the words of an Orders shop's page and a Fees centre's pages (the centre's page, a parent's private page, a payment's confirmation page), and the owner's
// page's words for what Orders and Fees put in front of the owner. English, Hindi, Malayalam and Kannada; English is the source, and Hindi, Malayalam and Kannada are
// machine-written and wait for a native reader like the rest of channels/words.ts (each page says so in that language: PAGE[language].machine). Used by
// order-page.ts, fee-page.ts and owner-page.ts, and nowhere else.
//
// As in words.ts, money, days and times are never written here by hand: each function takes the figure already formatted from the shop's record and settings
// (modules/language/format.ts). No sentence promises more than the code does: a UPI payment is confirmed by the owner, and the page says so.
import type { Language } from "../language/languages.ts";

type W<T> = Record<Language, T>;

export interface OrderPageWords {
  title: (shop: string) => string;
  intro: (advance: string, upi: boolean) => string;
  advanceFull: string; advancePart: (percent: number) => string;
  pickDay: string; pickItems: string; pickSlot: string; yourDetails: string;
  pickup: string; delivery: string; address: string; addressNote: (areas: string) => string;
  left: (n: number) => string; soldOut: string; dayFull: string; slotClosed: string; maxItems: (n: number) => string;
  noDays: string; paused: string; place: string; phoneNote: string;
  pending: string; unknown: string; keepLink: string;
  held: (until: string) => string; checking: string; confirmed: (when: string) => string;
  expired: string; cancelled: string; done: string; notHeld: string; again: string;
  total: (amount: string) => string; advance: (amount: string) => string; note: (ref: string) => string; afterPay: string;
  when: (way: "pickup" | "delivery", slot: string, area?: string) => string;
  refused: Record<string, string>;
  cancel: string; cancelRule: (hours: number) => string;
  assistants: (mcp: string, api: string) => string; badForm: string;
}

export const ORDER_PAGE: W<OrderPageWords> = {
  en: {
    title: (shop) => `Order from ${shop}`,
    intro: (advance, upi) => `Choose a day, your items and a time. You pay ${advance} ${upi ? "by UPI, straight to the shop," : "by the shop's payment link"} to confirm the order. The prices are the shop's own.`,
    advanceFull: "the full amount", advancePart: (p) => `${p}% of the total`,
    pickDay: "1. Choose a day", pickItems: "2. Choose your items", pickSlot: "3. Pickup or delivery, and when", yourDetails: "4. Your name and phone number",
    pickup: "Pickup", delivery: "Delivery", address: "Delivery address",
    addressNote: (areas) => `We deliver to: ${areas}. Name your area in the address.`,
    left: (n) => `${n} left`, soldOut: "sold out", dayFull: "This day is full. Please choose another day.", slotClosed: "orders closed",
    maxItems: (n) => `Up to ${n} items in one order.`,
    noDays: "No day is open for orders just now. Please contact the shop.",
    paused: "Online ordering is paused just now. Please contact the shop.",
    place: "Hold this order",
    phoneNote: "The shop uses this number only to reach you about this order. Nothing is sent to it from this page.",
    pending: "Holding your order. This page updates by itself.",
    unknown: "No order has this address.",
    keepLink: "Keep this page's address: it is the only way to see or cancel this order.",
    held: (until) => `Your order is held until ${until}. Pay the advance before then to keep it.`,
    checking: "The shop is looking at your order first. This page will say when you can pay.",
    confirmed: (when) => `Confirmed: ${when}. Thank you.`,
    expired: "The hold ended before the advance was confirmed, so the order was not kept.",
    cancelled: "This order is cancelled.", done: "This order is done. Thank you.",
    notHeld: "This order could not be held. Messages from the shop are below.", again: "Order again",
    total: (a) => `Total: ${a}`, advance: (a) => `Advance to pay now: ${a}`, note: (ref) => `Order reference: ${ref}`,
    afterPay: "After you pay, the owner checks their UPI app and confirms the payment. This page then says Confirmed.",
    when: (way, slot, area) => (way === "pickup" ? `pickup, ${slot}` : `delivery to ${area ?? "your address"}, ${slot}`),
    refused: {
      paused: "Online ordering is paused just now. Please contact the shop.",
      unknown_item: "The shop's menu does not have one of those items.",
      too_many_items: "That is more items than the shop takes in one order.",
      bad_date: "The shop does not take orders for that day here.",
      no_delivery: "The shop does not deliver. Please choose pickup.",
      bad_slot: "That is not one of the shop's times for that way.",
      outside_area: "The shop does not deliver to that address. Name a place on its delivery list, or choose pickup.",
      phone_busy: "This phone number already has two unpaid orders. Pay or cancel one first.",
      phone_day: "This phone number has started enough orders for today.",
      shop_busy: "The shop has many unpaid orders just now. Please try again later.",
      unknown: "This order could not be held.",
    },
    cancel: "Cancel order", cancelRule: (h) => `Cancel at least ${h} hours before your time to get the advance back. Later than that, the shop decides.`,
    assistants: (mcp, api) => `An AI assistant that supports MCP (such as Claude or ChatGPT) can order here for you, at ${mcp}. It can list the menu and the times, hold an exact order at the shop's own prices, give you the payment details, show the order and cancel it. It cannot mark a payment received or approve a refund: only the owner can, and the shop's own limits apply to every order, however it is made. The ordering API is at ${api}.`,
    badForm: "Please check the form: at least one item, a time, a name of letters and a phone number (and an address for a delivery).",
  },
  hi: {
    title: (shop) => `${shop} से ऑर्डर करें`,
    intro: (advance, upi) => `दिन, अपना सामान और समय चुनिए। ऑर्डर पक्का करने के लिए ${advance} ${upi ? "UPI से, सीधे दुकान को," : "दुकान के पेमेंट लिंक से"} दीजिए। दाम दुकान के अपने हैं।`,
    advanceFull: "पूरी राशि", advancePart: (p) => `कुल का ${p}%`,
    pickDay: "1. दिन चुनिए", pickItems: "2. अपना सामान चुनिए", pickSlot: "3. पिकअप या डिलीवरी, और कब", yourDetails: "4. आपका नाम और फ़ोन नंबर",
    pickup: "पिकअप", delivery: "डिलीवरी", address: "डिलीवरी का पता",
    addressNote: (areas) => `हम यहाँ डिलीवरी करते हैं: ${areas}। पते में अपना इलाक़ा लिखिए।`,
    left: (n) => `${n} बाकी`, soldOut: "ख़त्म", dayFull: "यह दिन भर गया है। कृपया दूसरा दिन चुनिए।", slotClosed: "ऑर्डर बंद",
    maxItems: (n) => `एक ऑर्डर में ${n} तक चीज़ें।`,
    noDays: "अभी कोई दिन ऑर्डर के लिए खुला नहीं है। कृपया दुकान से संपर्क कीजिए।",
    paused: "ऑनलाइन ऑर्डर अभी रुके हुए हैं। कृपया दुकान से संपर्क कीजिए।",
    place: "यह ऑर्डर रोकिए",
    phoneNote: "दुकान यह नंबर सिर्फ़ इस ऑर्डर के बारे में आपसे बात करने के लिए रखती है। इस पेज से इस पर कुछ नहीं भेजा जाता।",
    pending: "आपका ऑर्डर रोका जा रहा है। यह पेज अपने आप बदलेगा।",
    unknown: "इस पते का कोई ऑर्डर नहीं है।",
    keepLink: "इस पेज का पता संभालकर रखिए: इस ऑर्डर को देखने या रद्द करने का यही एक तरीक़ा है।",
    held: (until) => `आपका ऑर्डर ${until} तक रुका है। उससे पहले अग्रिम राशि दीजिए।`,
    checking: "दुकान पहले आपका ऑर्डर देख रही है। पेमेंट कब करना है, यह पेज बताएगा।",
    confirmed: (when) => `पक्का हो गया: ${when}। धन्यवाद।`,
    expired: "अग्रिम राशि की पुष्टि से पहले रोक ख़त्म हो गई, इसलिए ऑर्डर नहीं रखा गया।",
    cancelled: "यह ऑर्डर रद्द है।", done: "यह ऑर्डर पूरा हो गया। धन्यवाद।",
    notHeld: "यह ऑर्डर रोका नहीं जा सका। दुकान के संदेश नीचे हैं।", again: "फिर से ऑर्डर कीजिए",
    total: (a) => `कुल: ${a}`, advance: (a) => `अभी देनी अग्रिम राशि: ${a}`, note: (ref) => `ऑर्डर नंबर: ${ref}`,
    afterPay: "पेमेंट के बाद मालिक अपने UPI ऐप में देखकर पेमेंट की पुष्टि करते हैं। फिर यह पेज पक्का दिखाएगा।",
    when: (way, slot, area) => (way === "pickup" ? `पिकअप, ${slot}` : `${area ?? "आपके पते"} पर डिलीवरी, ${slot}`),
    refused: {
      paused: "ऑनलाइन ऑर्डर अभी रुके हुए हैं। कृपया दुकान से संपर्क कीजिए।",
      unknown_item: "दुकान के मेन्यू में इनमें से एक चीज़ नहीं है।",
      too_many_items: "दुकान एक ऑर्डर में इतनी चीज़ें नहीं लेती।",
      bad_date: "दुकान उस दिन के ऑर्डर यहाँ नहीं लेती।",
      no_delivery: "दुकान डिलीवरी नहीं करती। कृपया पिकअप चुनिए।",
      bad_slot: "यह उस तरीक़े के लिए दुकान का समय नहीं है।",
      outside_area: "दुकान उस पते पर डिलीवरी नहीं करती। उसकी डिलीवरी सूची की कोई जगह लिखिए, या पिकअप चुनिए।",
      phone_busy: "इस फ़ोन नंबर पर पहले से दो बिना पेमेंट के ऑर्डर हैं। पहले एक का पेमेंट कीजिए या उसे रद्द कीजिए।",
      phone_day: "इस फ़ोन नंबर से आज के लिए काफ़ी ऑर्डर शुरू हो चुके हैं।",
      shop_busy: "दुकान पर अभी बहुत-से बिना पेमेंट के ऑर्डर हैं। कृपया बाद में कोशिश कीजिए।",
      unknown: "यह ऑर्डर रोका नहीं जा सका।",
    },
    cancel: "ऑर्डर रद्द कीजिए", cancelRule: (h) => `अग्रिम राशि वापस पाने के लिए अपने समय से कम से कम ${h} घंटे पहले रद्द कीजिए। उसके बाद दुकान तय करती है।`,
    assistants: (mcp, api) => `MCP वाला कोई AI सहायक (जैसे Claude या ChatGPT) यहाँ आपके लिए ऑर्डर कर सकता है: ${mcp}। वह मेन्यू और समय देख सकता है, दुकान के अपने दामों पर ठीक वही ऑर्डर रोक सकता है, पेमेंट की जानकारी दे सकता है, ऑर्डर दिखा सकता है और रद्द कर सकता है। वह पेमेंट मिला हुआ नहीं मान सकता और रिफ़ंड मंज़ूर नहीं कर सकता: यह सिर्फ़ मालिक कर सकते हैं, और हर ऑर्डर पर दुकान की अपनी सीमाएँ लागू होती हैं। ऑर्डर API: ${api}।`,
    badForm: "फ़ॉर्म जाँचिए: कम से कम एक चीज़, एक समय, अक्षरों में नाम और फ़ोन नंबर (और डिलीवरी के लिए पता)।",
  },
  ml: {
    title: (shop) => `${shop}-ൽ നിന്ന് ഓർഡർ ചെയ്യൂ`,
    intro: (advance, upi) => `ഒരു ദിവസം, നിങ്ങളുടെ സാധനങ്ങൾ, ഒരു സമയം എന്നിവ തിരഞ്ഞെടുക്കൂ. ഓർഡർ ഉറപ്പാക്കാൻ ${advance} ${upi ? "UPI വഴി, നേരിട്ട് കടയിലേക്ക്," : "കടയുടെ പേയ്‌മെന്റ് ലിങ്ക് വഴി"} അടയ്ക്കണം. വിലകൾ കടയുടെ സ്വന്തമാണ്.`,
    advanceFull: "മുഴുവൻ തുക", advancePart: (p) => `ആകെ തുകയുടെ ${p}%`,
    pickDay: "1. ദിവസം തിരഞ്ഞെടുക്കൂ", pickItems: "2. സാധനങ്ങൾ തിരഞ്ഞെടുക്കൂ", pickSlot: "3. പിക്കപ്പ് അല്ലെങ്കിൽ ഡെലിവറി, എപ്പോൾ", yourDetails: "4. നിങ്ങളുടെ പേരും ഫോൺ നമ്പറും",
    pickup: "പിക്കപ്പ്", delivery: "ഡെലിവറി", address: "ഡെലിവറി വിലാസം",
    addressNote: (areas) => `ഞങ്ങൾ ഇവിടേക്ക് ഡെലിവറി ചെയ്യും: ${areas}. വിലാസത്തിൽ നിങ്ങളുടെ സ്ഥലം എഴുതൂ.`,
    left: (n) => `${n} ബാക്കി`, soldOut: "തീർന്നു", dayFull: "ഈ ദിവസം നിറഞ്ഞു. മറ്റൊരു ദിവസം തിരഞ്ഞെടുക്കൂ.", slotClosed: "ഓർഡർ അടച്ചു",
    maxItems: (n) => `ഒരു ഓർഡറിൽ ${n} സാധനങ്ങൾ വരെ.`,
    noDays: "ഇപ്പോൾ ഓർഡറിനായി ഒരു ദിവസവും തുറന്നിട്ടില്ല. ദയവായി കടയുമായി ബന്ധപ്പെടൂ.",
    paused: "ഓൺലൈൻ ഓർഡർ ഇപ്പോൾ നിർത്തിവച്ചിരിക്കുന്നു. ദയവായി കടയുമായി ബന്ധപ്പെടൂ.",
    place: "ഈ ഓർഡർ പിടിച്ചുവയ്ക്കൂ",
    phoneNote: "ഈ ഓർഡറിനെക്കുറിച്ച് നിങ്ങളെ ബന്ധപ്പെടാൻ മാത്രമാണ് കട ഈ നമ്പർ ഉപയോഗിക്കുന്നത്. ഈ പേജിൽ നിന്ന് ഇതിലേക്ക് ഒന്നും അയയ്ക്കില്ല.",
    pending: "നിങ്ങളുടെ ഓർഡർ പിടിച്ചുവയ്ക്കുന്നു. ഈ പേജ് തനിയെ മാറും.",
    unknown: "ഈ വിലാസത്തിൽ ഒരു ഓർഡറും ഇല്ല.",
    keepLink: "ഈ പേജിന്റെ വിലാസം സൂക്ഷിക്കൂ: ഈ ഓർഡർ കാണാനോ റദ്ദാക്കാനോ ഉള്ള ഒരേയൊരു വഴി ഇതാണ്.",
    held: (until) => `നിങ്ങളുടെ ഓർഡർ ${until} വരെ പിടിച്ചുവച്ചിരിക്കുന്നു. അതിനുമുമ്പ് അഡ്വാൻസ് അടയ്ക്കൂ.`,
    checking: "കട ആദ്യം നിങ്ങളുടെ ഓർഡർ നോക്കുന്നു. എപ്പോൾ പണമടയ്ക്കാമെന്ന് ഈ പേജ് പറയും.",
    confirmed: (when) => `ഉറപ്പായി: ${when}. നന്ദി.`,
    expired: "അഡ്വാൻസ് ഉറപ്പാകുന്നതിനുമുമ്പ് പിടിച്ചുവയ്ക്കൽ അവസാനിച്ചു, അതിനാൽ ഓർഡർ നിലനിർത്തിയില്ല.",
    cancelled: "ഈ ഓർഡർ റദ്ദാക്കി.", done: "ഈ ഓർഡർ പൂർത്തിയായി. നന്ദി.",
    notHeld: "ഈ ഓർഡർ പിടിച്ചുവയ്ക്കാനായില്ല. കടയുടെ സന്ദേശങ്ങൾ താഴെയുണ്ട്.", again: "വീണ്ടും ഓർഡർ ചെയ്യൂ",
    total: (a) => `ആകെ: ${a}`, advance: (a) => `ഇപ്പോൾ അടയ്ക്കേണ്ട അഡ്വാൻസ്: ${a}`, note: (ref) => `ഓർഡർ നമ്പർ: ${ref}`,
    afterPay: "പണമടച്ചശേഷം ഉടമ തന്റെ UPI ആപ്പിൽ നോക്കി പേയ്‌മെന്റ് ഉറപ്പാക്കും. അപ്പോൾ ഈ പേജ് ഉറപ്പായി എന്ന് കാണിക്കും.",
    when: (way, slot, area) => (way === "pickup" ? `പിക്കപ്പ്, ${slot}` : `${area ?? "നിങ്ങളുടെ വിലാസത്തിലേക്ക്"} ഡെലിവറി, ${slot}`),
    refused: {
      paused: "ഓൺലൈൻ ഓർഡർ ഇപ്പോൾ നിർത്തിവച്ചിരിക്കുന്നു. ദയവായി കടയുമായി ബന്ധപ്പെടൂ.",
      unknown_item: "കടയുടെ മെനുവിൽ അവയിൽ ഒരു സാധനം ഇല്ല.",
      too_many_items: "ഒരു ഓർഡറിൽ കട എടുക്കുന്നതിലും കൂടുതൽ സാധനങ്ങളാണ് ഇത്.",
      bad_date: "ആ ദിവസത്തേക്കുള്ള ഓർഡർ കട ഇവിടെ എടുക്കില്ല.",
      no_delivery: "കട ഡെലിവറി ചെയ്യുന്നില്ല. ദയവായി പിക്കപ്പ് തിരഞ്ഞെടുക്കൂ.",
      bad_slot: "ആ രീതിക്കുള്ള കടയുടെ സമയങ്ങളിൽ ഒന്നല്ല ഇത്.",
      outside_area: "ആ വിലാസത്തിലേക്ക് കട ഡെലിവറി ചെയ്യുന്നില്ല. ഡെലിവറി പട്ടികയിലെ ഒരു സ്ഥലം എഴുതൂ, അല്ലെങ്കിൽ പിക്കപ്പ് തിരഞ്ഞെടുക്കൂ.",
      phone_busy: "ഈ ഫോൺ നമ്പറിൽ ഇതിനകം പണമടയ്ക്കാത്ത രണ്ട് ഓർഡറുകൾ ഉണ്ട്. ആദ്യം ഒന്ന് അടയ്ക്കുകയോ റദ്ദാക്കുകയോ ചെയ്യൂ.",
      phone_day: "ഈ ഫോൺ നമ്പറിൽ നിന്ന് ഇന്നത്തേക്ക് ആവശ്യത്തിന് ഓർഡറുകൾ തുടങ്ങിക്കഴിഞ്ഞു.",
      shop_busy: "കടയിൽ ഇപ്പോൾ പണമടയ്ക്കാത്ത ധാരാളം ഓർഡറുകൾ ഉണ്ട്. പിന്നീട് ശ്രമിക്കൂ.",
      unknown: "ഈ ഓർഡർ പിടിച്ചുവയ്ക്കാനായില്ല.",
    },
    cancel: "ഓർഡർ റദ്ദാക്കൂ", cancelRule: (h) => `അഡ്വാൻസ് തിരികെ കിട്ടാൻ നിങ്ങളുടെ സമയത്തിന് കുറഞ്ഞത് ${h} മണിക്കൂർ മുമ്പ് റദ്ദാക്കൂ. അതിനുശേഷം കട തീരുമാനിക്കും.`,
    assistants: (mcp, api) => `MCP പിന്തുണയ്ക്കുന്ന ഒരു AI സഹായിക്ക് (Claude അല്ലെങ്കിൽ ChatGPT പോലുള്ളവ) നിങ്ങൾക്കായി ഇവിടെ ഓർഡർ ചെയ്യാം: ${mcp}. അതിന് മെനുവും സമയങ്ങളും കാണാം, കടയുടെ സ്വന്തം വിലയിൽ കൃത്യമായ ഓർഡർ പിടിച്ചുവയ്ക്കാം, പേയ്‌മെന്റ് വിവരങ്ങൾ നൽകാം, ഓർഡർ കാണിക്കാം, റദ്ദാക്കാം. പണം കിട്ടി എന്ന് അടയാളപ്പെടുത്താനോ റീഫണ്ട് അംഗീകരിക്കാനോ അതിന് കഴിയില്ല: അത് ഉടമയ്ക്ക് മാത്രമേ കഴിയൂ, ഓരോ ഓർഡറിനും കടയുടെ സ്വന്തം പരിധികൾ ബാധകമാണ്. ഓർഡർ API: ${api}.`,
    badForm: "ഫോം പരിശോധിക്കൂ: കുറഞ്ഞത് ഒരു സാധനം, ഒരു സമയം, അക്ഷരങ്ങളിൽ പേര്, ഫോൺ നമ്പർ (ഡെലിവറിക്ക് വിലാസവും).",
  },
  kn: {
    title: (shop) => `${shop} ನಿಂದ ಆರ್ಡರ್ ಮಾಡಿ`,
    intro: (advance, upi) => `ಒಂದು ದಿನ, ನಿಮ್ಮ ವಸ್ತುಗಳು ಮತ್ತು ಸಮಯವನ್ನು ಆರಿಸಿ. ಆರ್ಡರ್ ಖಚಿತಪಡಿಸಲು ${advance} ${upi ? "UPI ಮೂಲಕ, ನೇರವಾಗಿ ಅಂಗಡಿಗೆ," : "ಅಂಗಡಿಯ ಪಾವತಿ ಲಿಂಕ್ ಮೂಲಕ"} ಪಾವತಿಸಿ. ಬೆಲೆಗಳು ಅಂಗಡಿಯದೇ.`,
    advanceFull: "ಪೂರ್ತಿ ಮೊತ್ತ", advancePart: (p) => `ಒಟ್ಟು ಮೊತ್ತದ ${p}%`,
    pickDay: "1. ದಿನ ಆರಿಸಿ", pickItems: "2. ನಿಮ್ಮ ವಸ್ತುಗಳನ್ನು ಆರಿಸಿ", pickSlot: "3. ಪಿಕಪ್ ಅಥವಾ ಡೆಲಿವರಿ, ಮತ್ತು ಯಾವಾಗ", yourDetails: "4. ನಿಮ್ಮ ಹೆಸರು ಮತ್ತು ಫೋನ್ ನಂಬರ್",
    pickup: "ಪಿಕಪ್", delivery: "ಡೆಲಿವರಿ", address: "ಡೆಲಿವರಿ ವಿಳಾಸ",
    addressNote: (areas) => `ನಾವು ಇಲ್ಲಿಗೆ ಡೆಲಿವರಿ ಮಾಡುತ್ತೇವೆ: ${areas}. ವಿಳಾಸದಲ್ಲಿ ನಿಮ್ಮ ಪ್ರದೇಶ ಬರೆಯಿರಿ.`,
    left: (n) => `${n} ಉಳಿದಿವೆ`, soldOut: "ಮುಗಿದಿದೆ", dayFull: "ಈ ದಿನ ತುಂಬಿದೆ. ಬೇರೆ ದಿನ ಆರಿಸಿ.", slotClosed: "ಆರ್ಡರ್ ಮುಚ್ಚಿದೆ",
    maxItems: (n) => `ಒಂದು ಆರ್ಡರ್‌ನಲ್ಲಿ ${n} ವಸ್ತುಗಳವರೆಗೆ.`,
    noDays: "ಈಗ ಆರ್ಡರ್‌ಗೆ ಯಾವ ದಿನವೂ ತೆರೆದಿಲ್ಲ. ದಯವಿಟ್ಟು ಅಂಗಡಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    paused: "ಆನ್‌ಲೈನ್ ಆರ್ಡರ್ ಈಗ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ಅಂಗಡಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    place: "ಈ ಆರ್ಡರ್ ಹಿಡಿದಿಡಿ",
    phoneNote: "ಈ ಆರ್ಡರ್ ಬಗ್ಗೆ ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸಲು ಮಾತ್ರ ಅಂಗಡಿ ಈ ನಂಬರ್ ಬಳಸುತ್ತದೆ. ಈ ಪುಟದಿಂದ ಇದಕ್ಕೆ ಏನನ್ನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ.",
    pending: "ನಿಮ್ಮ ಆರ್ಡರ್ ಹಿಡಿದಿಡಲಾಗುತ್ತಿದೆ. ಈ ಪುಟ ತಾನಾಗಿ ಬದಲಾಗುತ್ತದೆ.",
    unknown: "ಈ ವಿಳಾಸದಲ್ಲಿ ಯಾವ ಆರ್ಡರ್ ಇಲ್ಲ.",
    keepLink: "ಈ ಪುಟದ ವಿಳಾಸವನ್ನು ಇಟ್ಟುಕೊಳ್ಳಿ: ಈ ಆರ್ಡರ್ ನೋಡಲು ಅಥವಾ ರದ್ದು ಮಾಡಲು ಇದೊಂದೇ ದಾರಿ.",
    held: (until) => `ನಿಮ್ಮ ಆರ್ಡರ್ ${until} ವರೆಗೆ ಹಿಡಿದಿಡಲಾಗಿದೆ. ಅದಕ್ಕೂ ಮೊದಲು ಮುಂಗಡ ಪಾವತಿಸಿ.`,
    checking: "ಅಂಗಡಿ ಮೊದಲು ನಿಮ್ಮ ಆರ್ಡರ್ ನೋಡುತ್ತಿದೆ. ಯಾವಾಗ ಪಾವತಿಸಬಹುದು ಎಂದು ಈ ಪುಟ ಹೇಳುತ್ತದೆ.",
    confirmed: (when) => `ಖಚಿತವಾಗಿದೆ: ${when}. ಧನ್ಯವಾದಗಳು.`,
    expired: "ಮುಂಗಡ ಖಚಿತವಾಗುವ ಮೊದಲೇ ಹಿಡಿತ ಮುಗಿಯಿತು, ಹಾಗಾಗಿ ಆರ್ಡರ್ ಉಳಿಸಲಿಲ್ಲ.",
    cancelled: "ಈ ಆರ್ಡರ್ ರದ್ದಾಗಿದೆ.", done: "ಈ ಆರ್ಡರ್ ಮುಗಿದಿದೆ. ಧನ್ಯವಾದಗಳು.",
    notHeld: "ಈ ಆರ್ಡರ್ ಹಿಡಿದಿಡಲು ಆಗಲಿಲ್ಲ. ಅಂಗಡಿಯ ಸಂದೇಶಗಳು ಕೆಳಗಿವೆ.", again: "ಮತ್ತೆ ಆರ್ಡರ್ ಮಾಡಿ",
    total: (a) => `ಒಟ್ಟು: ${a}`, advance: (a) => `ಈಗ ಪಾವತಿಸಬೇಕಾದ ಮುಂಗಡ: ${a}`, note: (ref) => `ಆರ್ಡರ್ ಸಂಖ್ಯೆ: ${ref}`,
    afterPay: "ನೀವು ಪಾವತಿಸಿದ ನಂತರ ಮಾಲೀಕರು ತಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ನೋಡಿ ಪಾವತಿ ಖಚಿತಪಡಿಸುತ್ತಾರೆ. ಆಗ ಈ ಪುಟ ಖಚಿತವಾಗಿದೆ ಎಂದು ತೋರಿಸುತ್ತದೆ.",
    when: (way, slot, area) => (way === "pickup" ? `ಪಿಕಪ್, ${slot}` : `${area ?? "ನಿಮ್ಮ ವಿಳಾಸಕ್ಕೆ"} ಡೆಲಿವರಿ, ${slot}`),
    refused: {
      paused: "ಆನ್‌ಲೈನ್ ಆರ್ಡರ್ ಈಗ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ಅಂಗಡಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ.",
      unknown_item: "ಅಂಗಡಿಯ ಮೆನುವಿನಲ್ಲಿ ಅವುಗಳಲ್ಲಿ ಒಂದು ವಸ್ತು ಇಲ್ಲ.",
      too_many_items: "ಒಂದು ಆರ್ಡರ್‌ನಲ್ಲಿ ಅಂಗಡಿ ತೆಗೆದುಕೊಳ್ಳುವುದಕ್ಕಿಂತ ಹೆಚ್ಚು ವಸ್ತುಗಳು ಇವು.",
      bad_date: "ಆ ದಿನದ ಆರ್ಡರ್ ಅನ್ನು ಅಂಗಡಿ ಇಲ್ಲಿ ತೆಗೆದುಕೊಳ್ಳುವುದಿಲ್ಲ.",
      no_delivery: "ಅಂಗಡಿ ಡೆಲಿವರಿ ಮಾಡುವುದಿಲ್ಲ. ದಯವಿಟ್ಟು ಪಿಕಪ್ ಆರಿಸಿ.",
      bad_slot: "ಆ ವಿಧಾನಕ್ಕೆ ಇದು ಅಂಗಡಿಯ ಸಮಯಗಳಲ್ಲಿ ಒಂದಲ್ಲ.",
      outside_area: "ಆ ವಿಳಾಸಕ್ಕೆ ಅಂಗಡಿ ಡೆಲಿವರಿ ಮಾಡುವುದಿಲ್ಲ. ಡೆಲಿವರಿ ಪಟ್ಟಿಯ ಒಂದು ಸ್ಥಳ ಬರೆಯಿರಿ, ಅಥವಾ ಪಿಕಪ್ ಆರಿಸಿ.",
      phone_busy: "ಈ ಫೋನ್ ನಂಬರ್‌ನಲ್ಲಿ ಈಗಾಗಲೇ ಪಾವತಿಸದ ಎರಡು ಆರ್ಡರ್‌ಗಳಿವೆ. ಮೊದಲು ಒಂದನ್ನು ಪಾವತಿಸಿ ಅಥವಾ ರದ್ದು ಮಾಡಿ.",
      phone_day: "ಈ ಫೋನ್ ನಂಬರ್‌ನಿಂದ ಇಂದಿಗೆ ಸಾಕಷ್ಟು ಆರ್ಡರ್‌ಗಳು ಶುರುವಾಗಿವೆ.",
      shop_busy: "ಅಂಗಡಿಯಲ್ಲಿ ಈಗ ಪಾವತಿಸದ ಅನೇಕ ಆರ್ಡರ್‌ಗಳಿವೆ. ನಂತರ ಪ್ರಯತ್ನಿಸಿ.",
      unknown: "ಈ ಆರ್ಡರ್ ಹಿಡಿದಿಡಲು ಆಗಲಿಲ್ಲ.",
    },
    cancel: "ಆರ್ಡರ್ ರದ್ದು ಮಾಡಿ", cancelRule: (h) => `ಮುಂಗಡ ಮರಳಿ ಪಡೆಯಲು ನಿಮ್ಮ ಸಮಯಕ್ಕಿಂತ ಕನಿಷ್ಠ ${h} ಗಂಟೆ ಮೊದಲು ರದ್ದು ಮಾಡಿ. ಅದರ ನಂತರ ಅಂಗಡಿ ನಿರ್ಧರಿಸುತ್ತದೆ.`,
    assistants: (mcp, api) => `MCP ಬೆಂಬಲಿಸುವ AI ಸಹಾಯಕ (Claude ಅಥವಾ ChatGPT ಮುಂತಾದವು) ನಿಮಗಾಗಿ ಇಲ್ಲಿ ಆರ್ಡರ್ ಮಾಡಬಹುದು: ${mcp}. ಅದು ಮೆನು ಮತ್ತು ಸಮಯಗಳನ್ನು ನೋಡಬಹುದು, ಅಂಗಡಿಯ ಸ್ವಂತ ಬೆಲೆಯಲ್ಲಿ ನಿಖರವಾದ ಆರ್ಡರ್ ಹಿಡಿದಿಡಬಹುದು, ಪಾವತಿ ವಿವರ ನೀಡಬಹುದು, ಆರ್ಡರ್ ತೋರಿಸಬಹುದು ಮತ್ತು ರದ್ದುಗೊಳಿಸಬಹುದು. ಪಾವತಿ ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಲು ಅಥವಾ ರೀಫಂಡ್ ಅನುಮೋದಿಸಲು ಅದಕ್ಕೆ ಆಗುವುದಿಲ್ಲ: ಅದನ್ನು ಮಾಲೀಕರು ಮಾತ್ರ ಮಾಡಬಹುದು, ಮತ್ತು ಪ್ರತಿ ಆರ್ಡರ್‌ಗೆ ಅಂಗಡಿಯ ಸ್ವಂತ ಮಿತಿಗಳು ಅನ್ವಯಿಸುತ್ತವೆ. ಆರ್ಡರ್ API: ${api}.`,
    badForm: "ಫಾರ್ಮ್ ಪರಿಶೀಲಿಸಿ: ಕನಿಷ್ಠ ಒಂದು ವಸ್ತು, ಒಂದು ಸಮಯ, ಅಕ್ಷರಗಳಲ್ಲಿ ಹೆಸರು ಮತ್ತು ಫೋನ್ ನಂಬರ್ (ಡೆಲಿವರಿಗೆ ವಿಳಾಸವೂ).",
  },
};

export interface FeePageWords {
  title: (centre: string) => string;
  centreIntro: string; privateNote: string;
  students: string; fees: string; none: string;
  feeHead: (student: string, batch: string, month: string) => string; dueOn: (date: string) => string;
  fee: (a: string) => string; late: (a: string) => string; waived: (a: string) => string; paidSoFar: (a: string) => string; balance: (a: string) => string;
  statePaid: string; stateClosed: string; claimed: string;
  showPay: string; paid: string; afterPay: string; payLink: (a: string) => string;
  gone: string; paused: string;
  confirmTitle: string;
  open: (amount: string, student: string, month: string) => string;
  waiting: (student: string, month: string) => string;
  part: (paid: string, left: string) => string;
  confirmed: (student: string, month: string, paid: string) => string;
  closed: (student: string, month: string) => string;
  keepConfirm: string; back: string; pending: string; notDone: string;
  refused: Record<string, string>;
}

export const FEE_PAGE: W<FeePageWords> = {
  en: {
    title: (centre) => `Fees at ${centre}`,
    centreIntro: "Parents see and pay their children's fees on their own private page. Its link comes in the centre's fee reminder on WhatsApp. If you do not have it, ask the centre. A phone number typed here never opens anyone's fees.",
    privateNote: "This page is private to you: anyone with its address can see your children's fees, so do not share it. The centre can switch it off and send you a new one.",
    students: "Your children", fees: "Fees", none: "Nothing is due for your children just now.",
    feeHead: (student, batch, month) => `${student}, ${batch}, ${month}`, dueOn: (date) => `Due on ${date}`,
    fee: (a) => `Fee: ${a}`, late: (a) => `Late fee: ${a}`, waived: (a) => `Taken off: ${a}`, paidSoFar: (a) => `Paid: ${a}`, balance: (a) => `Still to pay: ${a}`,
    statePaid: "Paid. The centre's record shows it.", stateClosed: "Nothing more to pay.",
    claimed: "You said you have paid. The centre will confirm it.",
    showPay: "Show how to pay", paid: "I have paid",
    afterPay: "After you pay, the owner checks their UPI app and marks it received. Then this page and your confirmation page show it paid.",
    payLink: (a) => `Pay ${a}`,
    gone: "This link does not open anything. It may have been replaced by a newer one: open the latest message from the centre, or ask the centre for a new link.",
    paused: "Online fee payment is paused just now. Please contact the centre.",
    confirmTitle: "Your payment",
    open: (amount, student, month) => `Pay ${amount} for ${student}'s ${month} fee.`,
    waiting: (student, month) => `You said you have paid ${student}'s ${month} fee. The centre has not confirmed it yet; this page will say when it does.`,
    part: (paid, left) => `The centre's record shows ${paid} paid so far. ${left} is still to pay.`,
    confirmed: (student, month, paid) => `Confirmed: the centre's record shows ${student}'s ${month} fee paid (${paid}).`,
    closed: (student, month) => `Nothing more to pay for ${student}'s ${month} fee.`,
    keepConfirm: "Keep this page's address: it shows whether this payment is confirmed.", back: "Back to your fees",
    pending: "Working on it. This page updates by itself.",
    notDone: "The centre's system could not finish this just now. Please try again, or contact the centre.",
    refused: {
      link_gone: "Your link was switched off or replaced before this was done, so nothing was done.",
      not_open: "This fee is not open, so nothing was done.",
      paused: "Online fee payment is paused just now. Please contact the centre.",
      unknown: "This could not be done. Please contact the centre.",
    },
  },
  hi: {
    title: (centre) => `${centre} की फीस`,
    centreIntro: "माता-पिता अपने बच्चों की फीस अपने निजी पेज पर देखते और भरते हैं। इसका लिंक सेंटर के WhatsApp पर आने वाले फीस रिमाइंडर में आता है। अगर आपके पास नहीं है, तो सेंटर से माँगिए। यहाँ लिखा कोई फ़ोन नंबर किसी की फीस नहीं खोलता।",
    privateNote: "यह पेज सिर्फ़ आपका है: इसका पता जिसके पास हो वह आपके बच्चों की फीस देख सकता है, इसलिए इसे किसी से साझा मत कीजिए। सेंटर इसे बंद करके आपको नया भेज सकता है।",
    students: "आपके बच्चे", fees: "फीस", none: "अभी आपके बच्चों की कोई फीस बाकी नहीं है।",
    feeHead: (student, batch, month) => `${student}, ${batch}, ${month}`, dueOn: (date) => `देय तारीख ${date}`,
    fee: (a) => `फीस: ${a}`, late: (a) => `देर की फीस: ${a}`, waived: (a) => `छूट: ${a}`, paidSoFar: (a) => `दिया: ${a}`, balance: (a) => `अभी बाकी: ${a}`,
    statePaid: "भर दी गई। सेंटर के रिकॉर्ड में दर्ज है।", stateClosed: "अब कुछ बाकी नहीं।",
    claimed: "आपने बताया कि आपने पेमेंट कर दिया है। सेंटर इसकी पुष्टि करेगा।",
    showPay: "पेमेंट का तरीक़ा दिखाइए", paid: "मैंने पेमेंट कर दिया",
    afterPay: "पेमेंट के बाद मालिक अपने UPI ऐप में देखकर उसे मिला हुआ दर्ज करते हैं। फिर यह पेज और आपका पुष्टि वाला पेज उसे भरा हुआ दिखाते हैं।",
    payLink: (a) => `${a} दीजिए`,
    gone: "यह लिंक कुछ नहीं खोलता। हो सकता है इसकी जगह नया लिंक आ गया हो: सेंटर का सबसे नया संदेश खोलिए, या सेंटर से नया लिंक माँगिए।",
    paused: "ऑनलाइन फीस पेमेंट अभी रुका हुआ है। कृपया सेंटर से संपर्क कीजिए।",
    confirmTitle: "आपका पेमेंट",
    open: (amount, student, month) => `${student} की ${month} की फीस के लिए ${amount} दीजिए।`,
    waiting: (student, month) => `आपने बताया कि ${student} की ${month} की फीस भर दी है। सेंटर ने अभी पुष्टि नहीं की; पुष्टि होने पर यह पेज बताएगा।`,
    part: (paid, left) => `सेंटर के रिकॉर्ड में अब तक ${paid} दिया दर्ज है। ${left} अभी बाकी है।`,
    confirmed: (student, month, paid) => `पुष्टि हो गई: सेंटर के रिकॉर्ड में ${student} की ${month} की फीस भरी हुई है (${paid})।`,
    closed: (student, month) => `${student} की ${month} की फीस में अब कुछ बाकी नहीं।`,
    keepConfirm: "इस पेज का पता संभालकर रखिए: यह बताता है कि यह पेमेंट पक्का हुआ या नहीं।", back: "अपनी फीस पर वापस",
    pending: "काम हो रहा है। यह पेज अपने आप बदलेगा।",
    notDone: "सेंटर का सिस्टम अभी यह पूरा नहीं कर सका। फिर कोशिश कीजिए, या सेंटर से संपर्क कीजिए।",
    refused: {
      link_gone: "यह होने से पहले आपका लिंक बंद या बदल दिया गया, इसलिए कुछ नहीं हुआ।",
      not_open: "यह फीस खुली नहीं है, इसलिए कुछ नहीं हुआ।",
      paused: "ऑनलाइन फीस पेमेंट अभी रुका हुआ है। कृपया सेंटर से संपर्क कीजिए।",
      unknown: "यह नहीं हो सका। कृपया सेंटर से संपर्क कीजिए।",
    },
  },
  ml: {
    title: (centre) => `${centre}-ലെ ഫീസ്`,
    centreIntro: "മാതാപിതാക്കൾ കുട്ടികളുടെ ഫീസ് സ്വന്തം സ്വകാര്യ പേജിൽ കാണുകയും അടയ്ക്കുകയും ചെയ്യുന്നു. അതിന്റെ ലിങ്ക് സെന്ററിന്റെ WhatsApp ഫീസ് ഓർമ്മപ്പെടുത്തലിൽ വരും. നിങ്ങളുടെ കയ്യിൽ ഇല്ലെങ്കിൽ സെന്ററിനോട് ചോദിക്കൂ. ഇവിടെ ടൈപ്പ് ചെയ്യുന്ന ഫോൺ നമ്പർ ആരുടെയും ഫീസ് തുറക്കില്ല.",
    privateNote: "ഈ പേജ് നിങ്ങൾക്ക് മാത്രമുള്ളതാണ്: ഇതിന്റെ വിലാസം ഉള്ള ആർക്കും നിങ്ങളുടെ കുട്ടികളുടെ ഫീസ് കാണാം, അതിനാൽ പങ്കുവയ്ക്കരുത്. സെന്ററിന് ഇത് നിർത്തി പുതിയത് അയയ്ക്കാം.",
    students: "നിങ്ങളുടെ കുട്ടികൾ", fees: "ഫീസ്", none: "ഇപ്പോൾ നിങ്ങളുടെ കുട്ടികൾക്ക് ഫീസ് ഒന്നും ബാക്കിയില്ല.",
    feeHead: (student, batch, month) => `${student}, ${batch}, ${month}`, dueOn: (date) => `അടയ്ക്കേണ്ട തീയതി ${date}`,
    fee: (a) => `ഫീസ്: ${a}`, late: (a) => `വൈകിയ ഫീസ്: ${a}`, waived: (a) => `ഇളവ്: ${a}`, paidSoFar: (a) => `അടച്ചത്: ${a}`, balance: (a) => `ഇനി അടയ്ക്കാനുള്ളത്: ${a}`,
    statePaid: "അടച്ചു. സെന്ററിന്റെ രേഖയിൽ ഉണ്ട്.", stateClosed: "ഇനി ഒന്നും അടയ്ക്കാനില്ല.",
    claimed: "നിങ്ങൾ പണമടച്ചു എന്ന് പറഞ്ഞു. സെന്റർ അത് ഉറപ്പാക്കും.",
    showPay: "പണമടയ്ക്കേണ്ട വിധം കാണിക്കൂ", paid: "ഞാൻ പണമടച്ചു",
    afterPay: "പണമടച്ചശേഷം ഉടമ തന്റെ UPI ആപ്പിൽ നോക്കി അത് കിട്ടി എന്ന് രേഖപ്പെടുത്തും. അപ്പോൾ ഈ പേജും നിങ്ങളുടെ സ്ഥിരീകരണ പേജും അടച്ചതായി കാണിക്കും.",
    payLink: (a) => `${a} അടയ്ക്കൂ`,
    gone: "ഈ ലിങ്ക് ഒന്നും തുറക്കുന്നില്ല. ഇതിനുപകരം പുതിയ ലിങ്ക് വന്നിട്ടുണ്ടാകാം: സെന്ററിന്റെ ഏറ്റവും പുതിയ സന്ദേശം തുറക്കൂ, അല്ലെങ്കിൽ സെന്ററിനോട് പുതിയ ലിങ്ക് ചോദിക്കൂ.",
    paused: "ഓൺലൈൻ ഫീസ് അടയ്ക്കൽ ഇപ്പോൾ നിർത്തിവച്ചിരിക്കുന്നു. ദയവായി സെന്ററുമായി ബന്ധപ്പെടൂ.",
    confirmTitle: "നിങ്ങളുടെ പേയ്‌മെന്റ്",
    open: (amount, student, month) => `${student}-ന്റെ ${month} ഫീസിനായി ${amount} അടയ്ക്കൂ.`,
    waiting: (student, month) => `${student}-ന്റെ ${month} ഫീസ് അടച്ചു എന്ന് നിങ്ങൾ പറഞ്ഞു. സെന്റർ ഇതുവരെ ഉറപ്പാക്കിയിട്ടില്ല; ഉറപ്പാക്കുമ്പോൾ ഈ പേജ് പറയും.`,
    part: (paid, left) => `സെന്ററിന്റെ രേഖയിൽ ഇതുവരെ ${paid} അടച്ചതായി കാണുന്നു. ${left} ഇനിയും അടയ്ക്കാനുണ്ട്.`,
    confirmed: (student, month, paid) => `ഉറപ്പായി: സെന്ററിന്റെ രേഖയിൽ ${student}-ന്റെ ${month} ഫീസ് അടച്ചതായി കാണുന്നു (${paid}).`,
    closed: (student, month) => `${student}-ന്റെ ${month} ഫീസിൽ ഇനി ഒന്നും അടയ്ക്കാനില്ല.`,
    keepConfirm: "ഈ പേജിന്റെ വിലാസം സൂക്ഷിക്കൂ: ഈ പേയ്‌മെന്റ് ഉറപ്പായോ എന്ന് ഇത് കാണിക്കും.", back: "നിങ്ങളുടെ ഫീസിലേക്ക് തിരികെ",
    pending: "ചെയ്തുകൊണ്ടിരിക്കുന്നു. ഈ പേജ് തനിയെ മാറും.",
    notDone: "സെന്ററിന്റെ സിസ്റ്റത്തിന് ഇപ്പോൾ ഇത് പൂർത്തിയാക്കാനായില്ല. വീണ്ടും ശ്രമിക്കൂ, അല്ലെങ്കിൽ സെന്ററുമായി ബന്ധപ്പെടൂ.",
    refused: {
      link_gone: "ഇത് ചെയ്യുന്നതിനുമുമ്പ് നിങ്ങളുടെ ലിങ്ക് നിർത്തുകയോ മാറ്റുകയോ ചെയ്തു, അതിനാൽ ഒന്നും ചെയ്തില്ല.",
      not_open: "ഈ ഫീസ് തുറന്നിട്ടില്ല, അതിനാൽ ഒന്നും ചെയ്തില്ല.",
      paused: "ഓൺലൈൻ ഫീസ് അടയ്ക്കൽ ഇപ്പോൾ നിർത്തിവച്ചിരിക്കുന്നു. ദയവായി സെന്ററുമായി ബന്ധപ്പെടൂ.",
      unknown: "ഇത് ചെയ്യാനായില്ല. ദയവായി സെന്ററുമായി ബന്ധപ്പെടൂ.",
    },
  },
  kn: {
    title: (centre) => `${centre} ಶುಲ್ಕ`,
    centreIntro: "ಪೋಷಕರು ತಮ್ಮ ಮಕ್ಕಳ ಶುಲ್ಕವನ್ನು ತಮ್ಮದೇ ಖಾಸಗಿ ಪುಟದಲ್ಲಿ ನೋಡಿ ಪಾವತಿಸುತ್ತಾರೆ. ಅದರ ಲಿಂಕ್ ಕೇಂದ್ರದ WhatsApp ಶುಲ್ಕದ ನೆನಪಿನಲ್ಲಿ ಬರುತ್ತದೆ. ನಿಮ್ಮ ಬಳಿ ಇಲ್ಲದಿದ್ದರೆ ಕೇಂದ್ರವನ್ನು ಕೇಳಿ. ಇಲ್ಲಿ ಟೈಪ್ ಮಾಡಿದ ಫೋನ್ ನಂಬರ್ ಯಾರ ಶುಲ್ಕವನ್ನೂ ತೆರೆಯುವುದಿಲ್ಲ.",
    privateNote: "ಈ ಪುಟ ನಿಮಗೆ ಮಾತ್ರ: ಇದರ ವಿಳಾಸ ಇರುವ ಯಾರಾದರೂ ನಿಮ್ಮ ಮಕ್ಕಳ ಶುಲ್ಕ ನೋಡಬಹುದು, ಹಾಗಾಗಿ ಹಂಚಿಕೊಳ್ಳಬೇಡಿ. ಕೇಂದ್ರ ಇದನ್ನು ನಿಲ್ಲಿಸಿ ಹೊಸದನ್ನು ಕಳುಹಿಸಬಹುದು.",
    students: "ನಿಮ್ಮ ಮಕ್ಕಳು", fees: "ಶುಲ್ಕ", none: "ಈಗ ನಿಮ್ಮ ಮಕ್ಕಳ ಯಾವ ಶುಲ್ಕವೂ ಬಾಕಿ ಇಲ್ಲ.",
    feeHead: (student, batch, month) => `${student}, ${batch}, ${month}`, dueOn: (date) => `ಕೊನೆಯ ದಿನಾಂಕ ${date}`,
    fee: (a) => `ಶುಲ್ಕ: ${a}`, late: (a) => `ತಡ ಶುಲ್ಕ: ${a}`, waived: (a) => `ರಿಯಾಯಿತಿ: ${a}`, paidSoFar: (a) => `ಪಾವತಿಸಿದ್ದು: ${a}`, balance: (a) => `ಇನ್ನೂ ಬಾಕಿ: ${a}`,
    statePaid: "ಪಾವತಿಯಾಗಿದೆ. ಕೇಂದ್ರದ ದಾಖಲೆಯಲ್ಲಿ ಇದೆ.", stateClosed: "ಇನ್ನು ಏನೂ ಪಾವತಿಸಬೇಕಿಲ್ಲ.",
    claimed: "ನೀವು ಪಾವತಿಸಿದ್ದೀರಿ ಎಂದು ಹೇಳಿದ್ದೀರಿ. ಕೇಂದ್ರ ಅದನ್ನು ಖಚಿತಪಡಿಸುತ್ತದೆ.",
    showPay: "ಪಾವತಿಸುವ ವಿಧಾನ ತೋರಿಸಿ", paid: "ನಾನು ಪಾವತಿಸಿದ್ದೇನೆ",
    afterPay: "ನೀವು ಪಾವತಿಸಿದ ನಂತರ ಮಾಲೀಕರು ತಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ನೋಡಿ ಅದು ಬಂದಿದೆ ಎಂದು ದಾಖಲಿಸುತ್ತಾರೆ. ಆಗ ಈ ಪುಟ ಮತ್ತು ನಿಮ್ಮ ಖಚಿತ ಪುಟ ಅದನ್ನು ಪಾವತಿಯಾಗಿದೆ ಎಂದು ತೋರಿಸುತ್ತವೆ.",
    payLink: (a) => `${a} ಪಾವತಿಸಿ`,
    gone: "ಈ ಲಿಂಕ್ ಏನನ್ನೂ ತೆರೆಯುವುದಿಲ್ಲ. ಇದರ ಬದಲು ಹೊಸ ಲಿಂಕ್ ಬಂದಿರಬಹುದು: ಕೇಂದ್ರದ ಇತ್ತೀಚಿನ ಸಂದೇಶ ತೆರೆಯಿರಿ, ಅಥವಾ ಕೇಂದ್ರದಿಂದ ಹೊಸ ಲಿಂಕ್ ಕೇಳಿ.",
    paused: "ಆನ್‌ಲೈನ್ ಶುಲ್ಕ ಪಾವತಿ ಈಗ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ಕೇಂದ್ರವನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    confirmTitle: "ನಿಮ್ಮ ಪಾವತಿ",
    open: (amount, student, month) => `${student} ಅವರ ${month} ಶುಲ್ಕಕ್ಕೆ ${amount} ಪಾವತಿಸಿ.`,
    waiting: (student, month) => `${student} ಅವರ ${month} ಶುಲ್ಕ ಪಾವತಿಸಿದ್ದೀರಿ ಎಂದು ಹೇಳಿದ್ದೀರಿ. ಕೇಂದ್ರ ಇನ್ನೂ ಖಚಿತಪಡಿಸಿಲ್ಲ; ಖಚಿತವಾದಾಗ ಈ ಪುಟ ಹೇಳುತ್ತದೆ.`,
    part: (paid, left) => `ಕೇಂದ್ರದ ದಾಖಲೆಯಲ್ಲಿ ಇದುವರೆಗೆ ${paid} ಪಾವತಿಯಾಗಿದೆ. ${left} ಇನ್ನೂ ಬಾಕಿ ಇದೆ.`,
    confirmed: (student, month, paid) => `ಖಚಿತವಾಗಿದೆ: ಕೇಂದ್ರದ ದಾಖಲೆಯಲ್ಲಿ ${student} ಅವರ ${month} ಶುಲ್ಕ ಪಾವತಿಯಾಗಿದೆ (${paid}).`,
    closed: (student, month) => `${student} ಅವರ ${month} ಶುಲ್ಕದಲ್ಲಿ ಇನ್ನು ಏನೂ ಪಾವತಿಸಬೇಕಿಲ್ಲ.`,
    keepConfirm: "ಈ ಪುಟದ ವಿಳಾಸವನ್ನು ಇಟ್ಟುಕೊಳ್ಳಿ: ಈ ಪಾವತಿ ಖಚಿತವಾಯಿತೇ ಎಂದು ಇದು ತೋರಿಸುತ್ತದೆ.", back: "ನಿಮ್ಮ ಶುಲ್ಕಕ್ಕೆ ಹಿಂತಿರುಗಿ",
    pending: "ಕೆಲಸ ನಡೆಯುತ್ತಿದೆ. ಈ ಪುಟ ತಾನಾಗಿ ಬದಲಾಗುತ್ತದೆ.",
    notDone: "ಕೇಂದ್ರದ ವ್ಯವಸ್ಥೆಗೆ ಈಗ ಇದನ್ನು ಮುಗಿಸಲು ಆಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ, ಅಥವಾ ಕೇಂದ್ರವನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    refused: {
      link_gone: "ಇದು ಆಗುವ ಮೊದಲೇ ನಿಮ್ಮ ಲಿಂಕ್ ನಿಲ್ಲಿಸಲಾಗಿತ್ತು ಅಥವಾ ಬದಲಾಗಿತ್ತು, ಹಾಗಾಗಿ ಏನೂ ಮಾಡಲಿಲ್ಲ.",
      not_open: "ಈ ಶುಲ್ಕ ತೆರೆದಿಲ್ಲ, ಹಾಗಾಗಿ ಏನೂ ಮಾಡಲಿಲ್ಲ.",
      paused: "ಆನ್‌ಲೈನ್ ಶುಲ್ಕ ಪಾವತಿ ಈಗ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ಕೇಂದ್ರವನ್ನು ಸಂಪರ್ಕಿಸಿ.",
      unknown: "ಇದನ್ನು ಮಾಡಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೇಂದ್ರವನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    },
  },
};

/** The owner's page's words for Orders' and Fees' items, and for Fees' parents and their links. */
export interface OwnerMoreWords {
  /** Where a customer came from when it was the shop's page (an Orders shop's, a Fees centre's): words.ts OWNER.from says "booking page". */
  webPage: string;
  upcomingOrders: string; noneComingOrders: string;
  bigOrder: (who: string, what: string, amount: string) => string; accept: string; refuse: string;
  lateOrder: (who: string, what: string, amount: string) => string; giveBack: string; keepAdvance: string; keptOrder: string;
  waiver: (who: string, what: string, amount: string) => string; waiveIt: string; dontWaive: string;
  refundRequest: (who: string, what: string, amount: string) => string; refundIt: string; dontRefund: string;
  parents: string; parentsNote: string; parentRow: (students: string, phone: string) => string;
  linkActive: (since: string) => string; linkNone: string; sendLink: string; revokeLink: string;
}

export const OWNER_MORE: W<OwnerMoreWords> = {
  en: {
    webPage: "shop page",
    upcomingOrders: "Coming orders", noneComingOrders: "No confirmed orders in the coming week.",
    bigOrder: (who, what, amount) => `${who} ordered ${what}, ${amount} in all. It is above your line for orders you accept first; nothing is held until you answer.`,
    accept: "Accept the order", refuse: "Refuse the order",
    lateOrder: (who, what, amount) => `${who} cancelled an order late (${what}). Their advance is ${amount}.`,
    giveBack: "Give the advance back", keepAdvance: "Keep the advance", keptOrder: "Kept for an order I took by hand",
    waiver: (who, what, amount) => `${who}'s parent asked to take ${amount} off ${what}.`, waiveIt: "Take it off", dontWaive: "Do not take it off",
    refundRequest: (who, what, amount) => `${who}'s parent asked for ${amount} back (${what}).`, refundIt: "Give it back", dontRefund: "Do not give it back",
    parents: "Parents and their private links",
    parentsNote: "Each parent's link opens only their own children's fees. It also comes in every fee reminder. A new link switches the old one off.",
    parentRow: (students, phone) => `${students} (${phone})`,
    linkActive: (since) => `Link sent ${since}`, linkNone: "No link yet", sendLink: "Send a new link on WhatsApp", revokeLink: "Switch the link off",
  },
  hi: {
    webPage: "दुकान का पेज",
    upcomingOrders: "आने वाले ऑर्डर", noneComingOrders: "आने वाले हफ़्ते में कोई पक्का ऑर्डर नहीं।",
    bigOrder: (who, what, amount) => `${who} ने ${what} का ऑर्डर दिया, कुल ${amount}। यह आपकी उस सीमा से ऊपर है जिसके ऊपर के ऑर्डर आप पहले मंज़ूर करते हैं; आपके जवाब तक कुछ रोका नहीं गया।`,
    accept: "ऑर्डर मंज़ूर कीजिए", refuse: "ऑर्डर मना कीजिए",
    lateOrder: (who, what, amount) => `${who} ने एक ऑर्डर देर से रद्द किया (${what})। उनकी अग्रिम राशि ${amount} है।`,
    giveBack: "अग्रिम राशि लौटाइए", keepAdvance: "अग्रिम राशि रखिए", keptOrder: "हाथ से लिए ऑर्डर के लिए रखा",
    waiver: (who, what, amount) => `${who} के माता-पिता ने ${what} में से ${amount} कम करने को कहा है।`, waiveIt: "कम कीजिए", dontWaive: "कम मत कीजिए",
    refundRequest: (who, what, amount) => `${who} के माता-पिता ने ${amount} वापस माँगे हैं (${what})।`, refundIt: "लौटाइए", dontRefund: "मत लौटाइए",
    parents: "माता-पिता और उनके निजी लिंक",
    parentsNote: "हर माता-पिता का लिंक सिर्फ़ उनके अपने बच्चों की फीस खोलता है। यह हर फीस रिमाइंडर में भी आता है। नया लिंक पुराने को बंद कर देता है।",
    parentRow: (students, phone) => `${students} (${phone})`,
    linkActive: (since) => `लिंक भेजा ${since}`, linkNone: "अभी कोई लिंक नहीं", sendLink: "WhatsApp पर नया लिंक भेजिए", revokeLink: "लिंक बंद कीजिए",
  },
  ml: {
    webPage: "കടയുടെ പേജ്",
    upcomingOrders: "വരാനിരിക്കുന്ന ഓർഡറുകൾ", noneComingOrders: "വരുന്ന ആഴ്ച ഉറപ്പായ ഓർഡറുകളൊന്നുമില്ല.",
    bigOrder: (who, what, amount) => `${who} ${what} ഓർഡർ ചെയ്തു, ആകെ ${amount}. ആദ്യം നിങ്ങൾ അംഗീകരിക്കുന്ന ഓർഡറുകളുടെ പരിധിക്ക് മുകളിലാണിത്; നിങ്ങൾ മറുപടി നൽകുന്നതുവരെ ഒന്നും പിടിച്ചുവയ്ക്കില്ല.`,
    accept: "ഓർഡർ അംഗീകരിക്കൂ", refuse: "ഓർഡർ നിരസിക്കൂ",
    lateOrder: (who, what, amount) => `${who} ഒരു ഓർഡർ വൈകി റദ്ദാക്കി (${what}). അവരുടെ അഡ്വാൻസ് ${amount}.`,
    giveBack: "അഡ്വാൻസ് തിരികെ നൽകൂ", keepAdvance: "അഡ്വാൻസ് വച്ചോളൂ", keptOrder: "കൈകൊണ്ട് എടുത്ത ഓർഡറിനായി വച്ചു",
    waiver: (who, what, amount) => `${who}-ന്റെ രക്ഷിതാവ് ${what}-ൽ നിന്ന് ${amount} കുറയ്ക്കാൻ ചോദിച്ചു.`, waiveIt: "കുറയ്ക്കൂ", dontWaive: "കുറയ്ക്കരുത്",
    refundRequest: (who, what, amount) => `${who}-ന്റെ രക്ഷിതാവ് ${amount} തിരികെ ചോദിച്ചു (${what}).`, refundIt: "തിരികെ നൽകൂ", dontRefund: "തിരികെ നൽകരുത്",
    parents: "രക്ഷിതാക്കളും അവരുടെ സ്വകാര്യ ലിങ്കുകളും",
    parentsNote: "ഓരോ രക്ഷിതാവിന്റെയും ലിങ്ക് അവരുടെ സ്വന്തം കുട്ടികളുടെ ഫീസ് മാത്രം തുറക്കും. ഓരോ ഫീസ് ഓർമ്മപ്പെടുത്തലിലും ഇത് വരും. പുതിയ ലിങ്ക് പഴയതിനെ നിർത്തും.",
    parentRow: (students, phone) => `${students} (${phone})`,
    linkActive: (since) => `ലിങ്ക് അയച്ചത് ${since}`, linkNone: "ഇതുവരെ ലിങ്കില്ല", sendLink: "WhatsApp-ൽ പുതിയ ലിങ്ക് അയയ്ക്കൂ", revokeLink: "ലിങ്ക് നിർത്തൂ",
  },
  kn: {
    webPage: "ಅಂಗಡಿಯ ಪುಟ",
    upcomingOrders: "ಮುಂಬರುವ ಆರ್ಡರ್‌ಗಳು", noneComingOrders: "ಮುಂದಿನ ವಾರ ಖಚಿತ ಆರ್ಡರ್‌ಗಳಿಲ್ಲ.",
    bigOrder: (who, what, amount) => `${who} ${what} ಆರ್ಡರ್ ಮಾಡಿದ್ದಾರೆ, ಒಟ್ಟು ${amount}. ನೀವು ಮೊದಲು ಒಪ್ಪುವ ಆರ್ಡರ್‌ಗಳ ಮಿತಿಗಿಂತ ಇದು ಮೇಲಿದೆ; ನೀವು ಉತ್ತರಿಸುವವರೆಗೆ ಏನನ್ನೂ ಹಿಡಿದಿಟ್ಟಿಲ್ಲ.`,
    accept: "ಆರ್ಡರ್ ಒಪ್ಪಿ", refuse: "ಆರ್ಡರ್ ನಿರಾಕರಿಸಿ",
    lateOrder: (who, what, amount) => `${who} ಒಂದು ಆರ್ಡರ್ ತಡವಾಗಿ ರದ್ದು ಮಾಡಿದ್ದಾರೆ (${what}). ಅವರ ಮುಂಗಡ ${amount}.`,
    giveBack: "ಮುಂಗಡ ಹಿಂತಿರುಗಿಸಿ", keepAdvance: "ಮುಂಗಡ ಇಟ್ಟುಕೊಳ್ಳಿ", keptOrder: "ಕೈಯಾರೆ ತೆಗೆದುಕೊಂಡ ಆರ್ಡರ್‌ಗಾಗಿ ಇಟ್ಟುಕೊಂಡೆ",
    waiver: (who, what, amount) => `${who} ಅವರ ಪೋಷಕರು ${what} ನಿಂದ ${amount} ಕಡಿಮೆ ಮಾಡಲು ಕೇಳಿದ್ದಾರೆ.`, waiveIt: "ಕಡಿಮೆ ಮಾಡಿ", dontWaive: "ಕಡಿಮೆ ಮಾಡಬೇಡಿ",
    refundRequest: (who, what, amount) => `${who} ಅವರ ಪೋಷಕರು ${amount} ಹಿಂತಿರುಗಿಸಲು ಕೇಳಿದ್ದಾರೆ (${what}).`, refundIt: "ಹಿಂತಿರುಗಿಸಿ", dontRefund: "ಹಿಂತಿರುಗಿಸಬೇಡಿ",
    parents: "ಪೋಷಕರು ಮತ್ತು ಅವರ ಖಾಸಗಿ ಲಿಂಕ್‌ಗಳು",
    parentsNote: "ಪ್ರತಿ ಪೋಷಕರ ಲಿಂಕ್ ಅವರದೇ ಮಕ್ಕಳ ಶುಲ್ಕವನ್ನು ಮಾತ್ರ ತೆರೆಯುತ್ತದೆ. ಪ್ರತಿ ಶುಲ್ಕದ ನೆನಪಿನಲ್ಲೂ ಇದು ಬರುತ್ತದೆ. ಹೊಸ ಲಿಂಕ್ ಹಳೆಯದನ್ನು ನಿಲ್ಲಿಸುತ್ತದೆ.",
    parentRow: (students, phone) => `${students} (${phone})`,
    linkActive: (since) => `ಲಿಂಕ್ ಕಳುಹಿಸಿದ್ದು ${since}`, linkNone: "ಇನ್ನೂ ಲಿಂಕ್ ಇಲ್ಲ", sendLink: "WhatsApp ನಲ್ಲಿ ಹೊಸ ಲಿಂಕ್ ಕಳುಹಿಸಿ", revokeLink: "ಲಿಂಕ್ ನಿಲ್ಲಿಸಿ",
  },
};
