// Item 11h: the same block for an Orders shop (its menu page, MCP, the owner's link) and a Fees centre (its page, which says parents pay from their own private link,
// and the owner's link; no MCP), with words of their own (KIND_WORDS).
//
// Item 11d on the panel's shop page: the shop's booking page (its link and the QR code for the counter), the MCP endpoint for AI assistants, and the owner's private
// approvals link (make it, see when it was made, switch it off). And the page that shows a new owner's link once. Plain forms and links, no script. The words are in four
// languages here; Hindi, Malayalam and Kannada are machine-written and wait for a native reader, like the rest of the panel's.
import type { Language } from "../../modules/language/languages.ts";
import { html, raw } from "./html.ts";
import type { Raw } from "./html.ts";
import { layout } from "./views.ts";
import type { Ctx } from "./views.ts";
import type { ChannelsView } from "./channels.ts";

interface Words {
  heading: string; page: string; pageNote: string; qr: string; mcp: string; mcpNote: string; owner: string; ownerNote: string; ownerOn: (at: string) => string; ownerOff: string;
  make: string; remake: string; revoke: string; madeTitle: string; madeNote: string; back: string;
}
const WORDS: Record<Language, Words> = {
  en: {
    heading: "Booking page, AI assistants and the owner's link", page: "Booking page", pageNote: "Customers book and pay the deposit here without WhatsApp, under the same limits, holds and record as a WhatsApp booking. Print the QR code for the counter.",
    qr: "QR code of the booking page", mcp: "For AI assistants (MCP)", mcpNote: "An assistant that supports MCP can list services and free times, hold a time, give the payment details, show and cancel a booking. It cannot mark a payment received or approve a refund.",
    owner: "The owner's approvals link", ownerNote: "A private page where the owner marks UPI payments received, answers refunds and sees the coming bookings, without WhatsApp. Give it to the owner once; anyone with it can answer for them.",
    ownerOn: (at) => `On, made ${at}.`, ownerOff: "Off.", make: "Make the owner's link", remake: "Make a new link (the old one stops)", revoke: "Switch the link off",
    madeTitle: "The owner's approvals link", madeNote: "This link is shown only now: copy it and give it to the owner (in person, or on their own phone). It works within a minute. To stop it, switch it off on the shop's page.", back: "Back to the shop",
  },
  hi: {
    heading: "बुकिंग पेज, AI सहायक और मालिक का लिंक", page: "बुकिंग पेज", pageNote: "ग्राहक यहाँ WhatsApp के बिना बुक करते हैं और अग्रिम राशि देते हैं, उन्हीं सीमाओं, रोक और रिकॉर्ड के साथ जो WhatsApp बुकिंग में हैं। काउंटर के लिए QR कोड छापिए।",
    qr: "बुकिंग पेज का QR कोड", mcp: "AI सहायकों के लिए (MCP)", mcpNote: "MCP वाला सहायक सेवाएँ और खाली समय देख सकता है, समय रोक सकता है, पेमेंट की जानकारी दे सकता है, बुकिंग दिखा और रद्द कर सकता है। वह पेमेंट मिला हुआ नहीं मान सकता और रिफ़ंड मंज़ूर नहीं कर सकता।",
    owner: "मालिक का मंज़ूरी लिंक", ownerNote: "एक निजी पेज जहाँ मालिक WhatsApp के बिना UPI पेमेंट मिला हुआ मानते हैं, रिफ़ंड का जवाब देते हैं और आने वाली बुकिंग देखते हैं। इसे मालिक को एक बार दीजिए; जिसके पास यह है वह उनकी ओर से जवाब दे सकता है।",
    ownerOn: (at) => `चालू, ${at} को बना।`, ownerOff: "बंद।", make: "मालिक का लिंक बनाइए", remake: "नया लिंक बनाइए (पुराना बंद हो जाएगा)", revoke: "लिंक बंद कीजिए",
    madeTitle: "मालिक का मंज़ूरी लिंक", madeNote: "यह लिंक सिर्फ़ अभी दिखेगा: इसे कॉपी करके मालिक को दीजिए (सामने, या उनके अपने फ़ोन पर)। यह एक मिनट में काम करने लगेगा। रोकने के लिए दुकान के पेज पर इसे बंद कीजिए।", back: "दुकान पर वापस",
  },
  ml: {
    heading: "ബുക്കിംഗ് പേജ്, AI സഹായികൾ, ഉടമയുടെ ലിങ്ക്", page: "ബുക്കിംഗ് പേജ്", pageNote: "കസ്റ്റമർമാർ WhatsApp ഇല്ലാതെ ഇവിടെ ബുക്ക് ചെയ്ത് അഡ്വാൻസ് അടയ്ക്കുന്നു, WhatsApp ബുക്കിംഗിന്റെ അതേ പരിധികളും പിടിയും രേഖയുമായി. കൗണ്ടറിനായി QR കോഡ് പ്രിന്റ് ചെയ്യൂ.",
    qr: "ബുക്കിംഗ് പേജിന്റെ QR കോഡ്", mcp: "AI സഹായികൾക്ക് (MCP)", mcpNote: "MCP പിന്തുണയുള്ള സഹായിക്ക് സേവനങ്ങളും ഒഴിവുസമയങ്ങളും കാണാനും, സമയം പിടിക്കാനും, പേയ്‌മെന്റ് വിവരം നൽകാനും, ബുക്കിംഗ് കാണിക്കാനും റദ്ദാക്കാനും കഴിയും. പേയ്‌മെന്റ് കിട്ടിയെന്ന് രേഖപ്പെടുത്താനോ റീഫണ്ട് അംഗീകരിക്കാനോ കഴിയില്ല.",
    owner: "ഉടമയുടെ അംഗീകാര ലിങ്ക്", ownerNote: "WhatsApp ഇല്ലാതെ ഉടമ UPI പേയ്‌മെന്റ് കിട്ടിയെന്ന് രേഖപ്പെടുത്തുകയും, റീഫണ്ടുകൾക്ക് മറുപടി നൽകുകയും, വരുന്ന ബുക്കിംഗുകൾ കാണുകയും ചെയ്യുന്ന ഒരു സ്വകാര്യ പേജ്. ഇത് ഉടമയ്ക്ക് ഒരിക്കൽ നൽകൂ; ഇത് കൈയിലുള്ള ആർക്കും അവർക്കുവേണ്ടി മറുപടി നൽകാം.",
    ownerOn: (at) => `ഓൺ, ${at}-ന് ഉണ്ടാക്കി.`, ownerOff: "ഓഫ്.", make: "ഉടമയുടെ ലിങ്ക് ഉണ്ടാക്കൂ", remake: "പുതിയ ലിങ്ക് ഉണ്ടാക്കൂ (പഴയത് നിൽക്കും)", revoke: "ലിങ്ക് ഓഫാക്കൂ",
    madeTitle: "ഉടമയുടെ അംഗീകാര ലിങ്ക്", madeNote: "ഈ ലിങ്ക് ഇപ്പോൾ മാത്രമേ കാണിക്കൂ: കോപ്പി ചെയ്ത് ഉടമയ്ക്ക് നൽകൂ (നേരിട്ട്, അല്ലെങ്കിൽ അവരുടെ സ്വന്തം ഫോണിൽ). ഒരു മിനിറ്റിനുള്ളിൽ ഇത് പ്രവർത്തിക്കും. നിർത്താൻ കടയുടെ പേജിൽ ഇത് ഓഫാക്കൂ.", back: "കടയിലേക്ക് തിരികെ",
  },
  kn: {
    heading: "ಬುಕಿಂಗ್ ಪುಟ, AI ಸಹಾಯಕರು ಮತ್ತು ಮಾಲೀಕರ ಲಿಂಕ್", page: "ಬುಕಿಂಗ್ ಪುಟ", pageNote: "ಗ್ರಾಹಕರು WhatsApp ಇಲ್ಲದೆ ಇಲ್ಲಿ ಬುಕ್ ಮಾಡಿ ಮುಂಗಡ ಪಾವತಿಸುತ್ತಾರೆ, WhatsApp ಬುಕಿಂಗ್‌ನ ಅದೇ ಮಿತಿಗಳು, ಹಿಡಿತ ಮತ್ತು ದಾಖಲೆಯೊಂದಿಗೆ. ಕೌಂಟರ್‌ಗಾಗಿ QR ಕೋಡ್ ಮುದ್ರಿಸಿ.",
    qr: "ಬುಕಿಂಗ್ ಪುಟದ QR ಕೋಡ್", mcp: "AI ಸಹಾಯಕರಿಗೆ (MCP)", mcpNote: "MCP ಬೆಂಬಲಿಸುವ ಸಹಾಯಕ ಸೇವೆಗಳು ಮತ್ತು ಖಾಲಿ ಸಮಯ ನೋಡಬಹುದು, ಸಮಯ ಹಿಡಿದಿಡಬಹುದು, ಪಾವತಿ ವಿವರ ನೀಡಬಹುದು, ಬುಕಿಂಗ್ ತೋರಿಸಿ ರದ್ದುಗೊಳಿಸಬಹುದು. ಪಾವತಿ ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಲು ಅಥವಾ ರೀಫಂಡ್ ಅನುಮೋದಿಸಲು ಆಗದು.",
    owner: "ಮಾಲೀಕರ ಅನುಮೋದನೆ ಲಿಂಕ್", ownerNote: "WhatsApp ಇಲ್ಲದೆ ಮಾಲೀಕರು UPI ಪಾವತಿ ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸುವ, ರೀಫಂಡ್‌ಗಳಿಗೆ ಉತ್ತರಿಸುವ ಮತ್ತು ಮುಂದಿನ ಬುಕಿಂಗ್‌ಗಳನ್ನು ನೋಡುವ ಖಾಸಗಿ ಪುಟ. ಇದನ್ನು ಮಾಲೀಕರಿಗೆ ಒಮ್ಮೆ ಕೊಡಿ; ಇದು ಇರುವ ಯಾರಾದರೂ ಅವರ ಪರವಾಗಿ ಉತ್ತರಿಸಬಹುದು.",
    ownerOn: (at) => `ಚಾಲೂ, ${at} ರಂದು ಮಾಡಲಾಗಿದೆ.`, ownerOff: "ಬಂದ್.", make: "ಮಾಲೀಕರ ಲಿಂಕ್ ಮಾಡಿ", remake: "ಹೊಸ ಲಿಂಕ್ ಮಾಡಿ (ಹಳೆಯದು ನಿಲ್ಲುತ್ತದೆ)", revoke: "ಲಿಂಕ್ ನಿಲ್ಲಿಸಿ",
    madeTitle: "ಮಾಲೀಕರ ಅನುಮೋದನೆ ಲಿಂಕ್", madeNote: "ಈ ಲಿಂಕ್ ಈಗ ಮಾತ್ರ ಕಾಣುತ್ತದೆ: ಇದನ್ನು ನಕಲಿಸಿ ಮಾಲೀಕರಿಗೆ ಕೊಡಿ (ಎದುರಿಗೆ, ಅಥವಾ ಅವರ ಸ್ವಂತ ಫೋನ್‌ನಲ್ಲಿ). ಒಂದು ನಿಮಿಷದಲ್ಲಿ ಇದು ಕೆಲಸ ಮಾಡುತ್ತದೆ. ನಿಲ್ಲಿಸಲು ಅಂಗಡಿಯ ಪುಟದಲ್ಲಿ ಇದನ್ನು ಬಂದ್ ಮಾಡಿ.", back: "ಅಂಗಡಿಗೆ ಹಿಂದಿರುಗಿ",
  },
};

/** Item 11h: the words that differ for an Orders shop and a Fees centre. Hindi, Malayalam and Kannada are machine-written, like the rest of the panel's. */
type KindWords = Pick<Words, "heading" | "page" | "pageNote" | "qr" | "mcpNote" | "ownerNote">;
const KIND_WORDS: Record<Language, Record<"orders" | "fees", KindWords>> = {
  en: {
    orders: {
      heading: "Shop page, AI assistants and the owner's link", page: "Shop page (orders)", qr: "QR code of the shop page",
      pageNote: "Customers order and pay the advance here without WhatsApp, at the shop's own prices, under the same limits, holds and record as a WhatsApp order. Put the QR code on the counter.",
      mcpNote: "An assistant that supports MCP can list the menu and the times, hold an exact order at the shop's prices, give the payment details, show and cancel an order. It cannot mark a payment received or approve a refund.",
      ownerNote: "A private page where the owner marks UPI advances received, accepts big orders, answers refunds and sees the coming orders, without WhatsApp. Give it to the owner once; anyone with it can answer for them.",
    },
    fees: {
      heading: "Centre page and the owner's link", page: "Centre page", qr: "QR code of the centre page", mcpNote: "",
      pageNote: "Parents see and pay their children's fees on their own private link, which comes in each fee reminder; this page only says where it comes from. A typed phone number never opens anyone's fees.",
      ownerNote: "A private page where the owner marks UPI fees received, answers waivers and refunds, and sends a parent a new link or switches one off, without WhatsApp. Give it to the owner once; anyone with it can answer for them.",
    },
  },
  hi: {
    orders: {
      heading: "दुकान का पेज, AI सहायक और मालिक का लिंक", page: "दुकान का पेज (ऑर्डर)", qr: "दुकान के पेज का QR कोड",
      pageNote: "ग्राहक यहाँ WhatsApp के बिना ऑर्डर करते हैं और अग्रिम राशि देते हैं, दुकान के अपने दामों पर, उन्हीं सीमाओं, रोक और रिकॉर्ड के साथ जो WhatsApp ऑर्डर में हैं। QR कोड काउंटर पर लगाइए।",
      mcpNote: "MCP वाला सहायक मेन्यू और समय देख सकता है, दुकान के दामों पर ठीक वही ऑर्डर रोक सकता है, पेमेंट की जानकारी दे सकता है, ऑर्डर दिखा और रद्द कर सकता है। वह पेमेंट मिला हुआ नहीं मान सकता और रिफ़ंड मंज़ूर नहीं कर सकता।",
      ownerNote: "एक निजी पेज जहाँ मालिक WhatsApp के बिना UPI अग्रिम राशि मिली हुई मानते हैं, बड़े ऑर्डर मंज़ूर करते हैं, रिफ़ंड का जवाब देते हैं और आने वाले ऑर्डर देखते हैं। इसे मालिक को एक बार दीजिए; जिसके पास यह है वह उनकी ओर से जवाब दे सकता है।",
    },
    fees: {
      heading: "सेंटर का पेज और मालिक का लिंक", page: "सेंटर का पेज", qr: "सेंटर के पेज का QR कोड", mcpNote: "",
      pageNote: "माता-पिता अपने बच्चों की फीस अपने निजी लिंक पर देखते और भरते हैं, जो हर फीस रिमाइंडर में आता है; यह पेज सिर्फ़ बताता है कि वह कहाँ से आता है। लिखा हुआ फ़ोन नंबर किसी की फीस नहीं खोलता।",
      ownerNote: "एक निजी पेज जहाँ मालिक WhatsApp के बिना UPI फीस मिली हुई मानते हैं, छूट और रिफ़ंड का जवाब देते हैं, और माता-पिता को नया लिंक भेजते या बंद करते हैं। इसे मालिक को एक बार दीजिए; जिसके पास यह है वह उनकी ओर से जवाब दे सकता है।",
    },
  },
  ml: {
    orders: {
      heading: "കടയുടെ പേജ്, AI സഹായികൾ, ഉടമയുടെ ലിങ്ക്", page: "കടയുടെ പേജ് (ഓർഡർ)", qr: "കടയുടെ പേജിന്റെ QR കോഡ്",
      pageNote: "കസ്റ്റമർമാർ WhatsApp ഇല്ലാതെ ഇവിടെ ഓർഡർ ചെയ്ത് അഡ്വാൻസ് അടയ്ക്കുന്നു, കടയുടെ സ്വന്തം വിലയിൽ, WhatsApp ഓർഡറിന്റെ അതേ പരിധികളും പിടിയും രേഖയുമായി. QR കോഡ് കൗണ്ടറിൽ വയ്ക്കൂ.",
      mcpNote: "MCP പിന്തുണയുള്ള സഹായിക്ക് മെനുവും സമയങ്ങളും കാണാനും, കടയുടെ വിലയിൽ കൃത്യമായ ഓർഡർ പിടിക്കാനും, പേയ്‌മെന്റ് വിവരം നൽകാനും, ഓർഡർ കാണിക്കാനും റദ്ദാക്കാനും കഴിയും. പണം കിട്ടിയെന്ന് രേഖപ്പെടുത്താനോ റീഫണ്ട് അംഗീകരിക്കാനോ കഴിയില്ല.",
      ownerNote: "WhatsApp ഇല്ലാതെ ഉടമ UPI അഡ്വാൻസ് കിട്ടിയെന്ന് രേഖപ്പെടുത്തുകയും, വലിയ ഓർഡറുകൾ അംഗീകരിക്കുകയും, റീഫണ്ടുകൾക്ക് മറുപടി നൽകുകയും, വരുന്ന ഓർഡറുകൾ കാണുകയും ചെയ്യുന്ന ഒരു സ്വകാര്യ പേജ്. ഇത് ഉടമയ്ക്ക് ഒരിക്കൽ നൽകൂ; ഇത് ഉള്ള ആർക്കും അവർക്കുവേണ്ടി മറുപടി നൽകാം.",
    },
    fees: {
      heading: "സെന്ററിന്റെ പേജ്, ഉടമയുടെ ലിങ്ക്", page: "സെന്ററിന്റെ പേജ്", qr: "സെന്ററിന്റെ പേജിന്റെ QR കോഡ്", mcpNote: "",
      pageNote: "മാതാപിതാക്കൾ കുട്ടികളുടെ ഫീസ് സ്വന്തം സ്വകാര്യ ലിങ്കിൽ കാണുകയും അടയ്ക്കുകയും ചെയ്യുന്നു, അത് ഓരോ ഫീസ് ഓർമ്മപ്പെടുത്തലിലും വരും; ഈ പേജ് അത് എവിടെനിന്ന് വരുന്നു എന്ന് മാത്രം പറയുന്നു. ടൈപ്പ് ചെയ്ത ഫോൺ നമ്പർ ആരുടെയും ഫീസ് തുറക്കില്ല.",
      ownerNote: "WhatsApp ഇല്ലാതെ ഉടമ UPI ഫീസ് കിട്ടിയെന്ന് രേഖപ്പെടുത്തുകയും, ഇളവുകൾക്കും റീഫണ്ടുകൾക്കും മറുപടി നൽകുകയും, രക്ഷിതാവിന് പുതിയ ലിങ്ക് അയയ്ക്കുകയോ ലിങ്ക് നിർത്തുകയോ ചെയ്യുന്ന ഒരു സ്വകാര്യ പേജ്. ഇത് ഉടമയ്ക്ക് ഒരിക്കൽ നൽകൂ; ഇത് ഉള്ള ആർക്കും അവർക്കുവേണ്ടി മറുപടി നൽകാം.",
    },
  },
  kn: {
    orders: {
      heading: "ಅಂಗಡಿಯ ಪುಟ, AI ಸಹಾಯಕರು ಮತ್ತು ಮಾಲೀಕರ ಲಿಂಕ್", page: "ಅಂಗಡಿಯ ಪುಟ (ಆರ್ಡರ್)", qr: "ಅಂಗಡಿಯ ಪುಟದ QR ಕೋಡ್",
      pageNote: "ಗ್ರಾಹಕರು WhatsApp ಇಲ್ಲದೆ ಇಲ್ಲಿ ಆರ್ಡರ್ ಮಾಡಿ ಮುಂಗಡ ಪಾವತಿಸುತ್ತಾರೆ, ಅಂಗಡಿಯ ಸ್ವಂತ ಬೆಲೆಯಲ್ಲಿ, WhatsApp ಆರ್ಡರ್‌ನ ಅದೇ ಮಿತಿಗಳು, ಹಿಡಿತ ಮತ್ತು ದಾಖಲೆಯೊಂದಿಗೆ. QR ಕೋಡ್ ಅನ್ನು ಕೌಂಟರ್‌ನಲ್ಲಿ ಇಡಿ.",
      mcpNote: "MCP ಬೆಂಬಲಿಸುವ ಸಹಾಯಕ ಮೆನು ಮತ್ತು ಸಮಯಗಳನ್ನು ನೋಡಬಹುದು, ಅಂಗಡಿಯ ಬೆಲೆಯಲ್ಲಿ ನಿಖರವಾದ ಆರ್ಡರ್ ಹಿಡಿದಿಡಬಹುದು, ಪಾವತಿ ವಿವರ ನೀಡಬಹುದು, ಆರ್ಡರ್ ತೋರಿಸಿ ರದ್ದುಗೊಳಿಸಬಹುದು. ಪಾವತಿ ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಲು ಅಥವಾ ರೀಫಂಡ್ ಅನುಮೋದಿಸಲು ಆಗುವುದಿಲ್ಲ.",
      ownerNote: "WhatsApp ಇಲ್ಲದೆ ಮಾಲೀಕರು UPI ಮುಂಗಡ ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸುವ, ದೊಡ್ಡ ಆರ್ಡರ್‌ಗಳನ್ನು ಒಪ್ಪುವ, ರೀಫಂಡ್‌ಗಳಿಗೆ ಉತ್ತರಿಸುವ ಮತ್ತು ಮುಂದಿನ ಆರ್ಡರ್‌ಗಳನ್ನು ನೋಡುವ ಖಾಸಗಿ ಪುಟ. ಇದನ್ನು ಮಾಲೀಕರಿಗೆ ಒಮ್ಮೆ ಕೊಡಿ; ಇದು ಇರುವ ಯಾರಾದರೂ ಅವರ ಪರವಾಗಿ ಉತ್ತರಿಸಬಹುದು.",
    },
    fees: {
      heading: "ಕೇಂದ್ರದ ಪುಟ ಮತ್ತು ಮಾಲೀಕರ ಲಿಂಕ್", page: "ಕೇಂದ್ರದ ಪುಟ", qr: "ಕೇಂದ್ರದ ಪುಟದ QR ಕೋಡ್", mcpNote: "",
      pageNote: "ಪೋಷಕರು ತಮ್ಮ ಮಕ್ಕಳ ಶುಲ್ಕವನ್ನು ತಮ್ಮದೇ ಖಾಸಗಿ ಲಿಂಕ್‌ನಲ್ಲಿ ನೋಡಿ ಪಾವತಿಸುತ್ತಾರೆ, ಅದು ಪ್ರತಿ ಶುಲ್ಕದ ನೆನಪಿನಲ್ಲಿ ಬರುತ್ತದೆ; ಈ ಪುಟ ಅದು ಎಲ್ಲಿಂದ ಬರುತ್ತದೆ ಎಂದು ಮಾತ್ರ ಹೇಳುತ್ತದೆ. ಟೈಪ್ ಮಾಡಿದ ಫೋನ್ ನಂಬರ್ ಯಾರ ಶುಲ್ಕವನ್ನೂ ತೆರೆಯುವುದಿಲ್ಲ.",
      ownerNote: "WhatsApp ಇಲ್ಲದೆ ಮಾಲೀಕರು UPI ಶುಲ್ಕ ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸುವ, ರಿಯಾಯಿತಿ ಮತ್ತು ರೀಫಂಡ್‌ಗಳಿಗೆ ಉತ್ತರಿಸುವ, ಮತ್ತು ಪೋಷಕರಿಗೆ ಹೊಸ ಲಿಂಕ್ ಕಳುಹಿಸುವ ಅಥವಾ ನಿಲ್ಲಿಸುವ ಖಾಸಗಿ ಪುಟ. ಇದನ್ನು ಮಾಲೀಕರಿಗೆ ಒಮ್ಮೆ ಕೊಡಿ; ಇದು ಇರುವ ಯಾರಾದರೂ ಅವರ ಪರವಾಗಿ ಉತ್ತರಿಸಬಹುದು.",
    },
  },
};

const csrf = (c: Ctx) => html`<input type="hidden" name="_csrf" value="${c.csrf}">`;
const day = (iso: string) => iso.slice(0, 10);

/** The shop page's block, for a shop whose template has a page (Bookings, and item 11h's Orders and Fees) and a panel that knows the server's public address. */
export function channelsBlock(c: Ctx, id: string, v: ChannelsView, kind: "bookings" | "orders" | "fees" = "bookings"): Raw {
  const w = kind === "bookings" ? WORDS[c.lang] : { ...WORDS[c.lang], ...KIND_WORDS[c.lang][kind] };
  return html`<h2>${w.heading}</h2>
<ul class="plain">
  <li class="info"><span class="mark">·</span><span><b>${w.page}</b><br><a href="${v.bookingUrl}">${v.bookingUrl}</a><br><small class="note">${w.pageNote}</small></span></li>
</ul>
<figure class="qr">${raw(v.qrSvg)}<figcaption class="note">${w.qr}</figcaption></figure>
<ul class="plain">
  ${kind === "fees" ? "" : html`<li class="info"><span class="mark">·</span><span><b>${w.mcp}</b><br><code>${v.mcpUrl}</code><br><small class="note">${w.mcpNote}</small></span></li>`}
  <li class="${v.ownerLink ? "info" : "warn"}"><span class="mark">${v.ownerLink ? "✓" : "·"}</span><span><b>${w.owner}</b>: ${v.ownerLink ? w.ownerOn(day(v.ownerLink.createdAt)) : w.ownerOff}<br><small class="note">${w.ownerNote}</small></span></li>
</ul>
<form method="post" action="/shops/${id}/owner-link">${csrf(c)}<button class="btn" type="submit">${v.ownerLink ? w.remake : w.make}</button></form>
${v.ownerLink ? html`<form method="post" action="/shops/${id}/owner-link/revoke">${csrf(c)}<button class="btn danger" type="submit">${w.revoke}</button></form>` : ""}`;
}

/** The page that shows a new owner's link, once. */
export function ownerLinkMadePage(c: Ctx, id: string, link: string): string {
  const w = WORDS[c.lang];
  return layout(c, w.madeTitle, html`<h1>${w.madeTitle}</h1><p><code class="addr">${link}</code></p><div class="notice" role="note">${w.madeNote}</div><p><a href="/shops/${id}">${w.back}</a></p>`);
}
