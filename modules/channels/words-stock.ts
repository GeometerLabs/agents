// The owner's page words for a Stock orders shop (templates/commerce/stock-orders): what waits for the owner's yes, the orders no supplier has answered, the deliveries to
// mark, and the list of orders now with suppliers. English, Hindi, Malayalam and Kannada; English is the source and the rest are machine-written and wait for a native
// reader (they are on the review sheets: bundle/panel/review.ts lists STOCK_WORDS). The shop's own item, unit and supplier names arrive already written; nothing here
// writes a number or an amount, and none says the supplier is paid: the agent pays nobody. Used by owner-page.ts only.
// "Unsure" (17 Nov 2026, send once): an order message that may or may not have reached the supplier. It says so plainly, asks the owner to check with the supplier, and offers
// two answers: "They got it" (nothing is sent) and "Send it again" (a new message, the owner's own choice, which the supplier may see twice).
import type { Language } from "../language/languages.ts";

export interface StockWords {
  tagApprove: string; tagSilent: string; tagReceive: string; tagUnsure: string; tagRefused: string;
  approve: (supplier: string, what: string, amount: string) => string;
  silent: (supplier: string, what: string) => string;
  receive: (supplier: string, what: string) => string;
  /** An order message that may or may not have gone out: the supplier's name and the order's number ("po-3"). */
  unsure: (supplier: string, ref: string) => string;
  gotIt: string; sendAgain: string;
  /** WhatsApp did not take the order message and nothing went out: the supplier, the order's number and the time of the next try. */
  refused: (supplier: string, ref: string, time: string) => string;
  tryNow: string; cancelOrder: string;
  yes: string; no: string; askAgain: string; received: string;
  coming: string; noneComing: string;
}

export const STOCK_WORDS: Record<Language, StockWords> = {
  en: {
    tagApprove: "Order to approve", tagSilent: "No answer from supplier", tagReceive: "Delivery to mark", tagUnsure: "Could not confirm", tagRefused: "Not sent",
    approve: (s, w, a) => `Order ${w} from ${s}, ${a} in all. It goes to the supplier only when you approve, and the month's budget is kept for it then.`,
    silent: (s, w) => `${s} has not answered the order ${w}. You can ask them again about the same order.`,
    receive: (s, w) => `${s} accepted the order ${w}. Mark it when the goods arrive.`,
    unsure: (s, r) => `We could not confirm that ${s} got order ${r}. Please check with them.`,
    gotIt: "They got it", sendAgain: "Send it again",
    refused: (s, r, t) => `WhatsApp did not take your order to ${s} (${r}). Nothing was sent. I will try again at ${t}. You can also call them.`,
    tryNow: "Try now", cancelOrder: "Cancel order",
    yes: "Approve", no: "Decline", askAgain: "Ask again", received: "All received",
    coming: "Orders with suppliers", noneComing: "No orders are waiting on a supplier.",
  },
  hi: {
    tagApprove: "मंज़ूर करने को ऑर्डर", tagSilent: "सप्लायर का जवाब नहीं", tagReceive: "माल आने का निशान", tagUnsure: "पक्का नहीं हुआ", tagRefused: "भेजा नहीं गया",
    approve: (s, w, a) => `${s} से ${w} का ऑर्डर, कुल ${a}। यह सप्लायर को तभी जाएगा जब आप मंज़ूर करेंगे, और तब महीने का बजट इसके लिए रखा जाएगा।`,
    silent: (s, w) => `${s} ने ऑर्डर ${w} का जवाब नहीं दिया। आप उसी ऑर्डर के बारे में उनसे फिर पूछ सकते हैं।`,
    receive: (s, w) => `${s} ने ऑर्डर ${w} मान लिया। माल आ जाए तो निशान लगाएँ।`,
    unsure: (s, r) => `हम पक्का नहीं कर पाए कि ${s} को ऑर्डर ${r} मिला। कृपया उनसे पूछ लें।`,
    gotIt: "उन्हें मिल गया", sendAgain: "फिर भेजें",
    refused: (s, r, t) => `WhatsApp ने ${s} को आपका ऑर्डर (${r}) नहीं लिया। कुछ भेजा नहीं गया। मैं ${t} पर फिर कोशिश करूँगा। आप उन्हें फ़ोन भी कर सकते हैं।`,
    tryNow: "अभी कोशिश करें", cancelOrder: "ऑर्डर रद्द करें",
    yes: "मंज़ूर करें", no: "मना करें", askAgain: "फिर पूछें", received: "सब मिल गया",
    coming: "सप्लायर के पास ऑर्डर", noneComing: "किसी सप्लायर पर कोई ऑर्डर बाकी नहीं।",
  },
  ml: {
    tagApprove: "അനുവദിക്കാൻ ഓർഡർ", tagSilent: "സപ്ലയർ മറുപടി നൽകിയില്ല", tagReceive: "സാധനം എത്തിയത് രേഖപ്പെടുത്തുക", tagUnsure: "ഉറപ്പിക്കാനായില്ല", tagRefused: "അയച്ചില്ല",
    approve: (s, w, a) => `${s}-ൽ നിന്ന് ${w} ഓർഡർ, ആകെ ${a}. നിങ്ങൾ അനുവദിച്ചാൽ മാത്രമേ ഇത് സപ്ലയർക്ക് പോകൂ, അപ്പോൾ മാസത്തെ ബജറ്റ് ഇതിനായി മാറ്റിവയ്ക്കും.`,
    silent: (s, w) => `${s} ഓർഡർ ${w}-ന് മറുപടി നൽകിയില്ല. അതേ ഓർഡറിനെക്കുറിച്ച് വീണ്ടും ചോദിക്കാം.`,
    receive: (s, w) => `${s} ഓർഡർ ${w} സ്വീകരിച്ചു. സാധനം എത്തുമ്പോൾ രേഖപ്പെടുത്തുക.`,
    unsure: (s, r) => `${s}-ന് ഓർഡർ ${r} കിട്ടിയെന്ന് ഉറപ്പിക്കാൻ ഞങ്ങൾക്കായില്ല. ദയവായി അവരോട് ചോദിച്ചു നോക്കൂ.`,
    gotIt: "അവർക്ക് കിട്ടി", sendAgain: "വീണ്ടും അയയ്ക്കൂ",
    refused: (s, r, t) => `${s}-ലേക്കുള്ള നിങ്ങളുടെ ഓർഡർ (${r}) WhatsApp സ്വീകരിച്ചില്ല. ഒന്നും അയച്ചിട്ടില്ല. ${t}-ന് ഞാൻ വീണ്ടും ശ്രമിക്കും. നിങ്ങൾക്ക് അവരെ വിളിക്കുകയും ചെയ്യാം.`,
    tryNow: "ഇപ്പോൾ ശ്രമിക്കൂ", cancelOrder: "ഓർഡർ റദ്ദാക്കൂ",
    yes: "അനുവദിക്കൂ", no: "വേണ്ട", askAgain: "വീണ്ടും ചോദിക്കൂ", received: "എല്ലാം കിട്ടി",
    coming: "സപ്ലയർമാരുടെ പക്കലുള്ള ഓർഡറുകൾ", noneComing: "ഒരു സപ്ലയറുടെയും പക്കൽ ഓർഡറുകൾ ബാക്കിയില്ല.",
  },
  kn: {
    tagApprove: "ಒಪ್ಪಬೇಕಾದ ಆರ್ಡರ್", tagSilent: "ಸರಬರಾಜುದಾರರ ಉತ್ತರವಿಲ್ಲ", tagReceive: "ಸರಕು ಬಂದದ್ದನ್ನು ಗುರುತಿಸಿ", tagUnsure: "ಖಚಿತವಾಗಿಲ್ಲ", tagRefused: "ಕಳುಹಿಸಿಲ್ಲ",
    approve: (s, w, a) => `${s} ಅವರಿಂದ ${w} ಆರ್ಡರ್, ಒಟ್ಟು ${a}. ನೀವು ಒಪ್ಪಿದರೆ ಮಾತ್ರ ಇದು ಸರಬರಾಜುದಾರರಿಗೆ ಹೋಗುತ್ತದೆ, ಆಗ ತಿಂಗಳ ಬಜೆಟ್ ಇದಕ್ಕಾಗಿ ಮೀಸಲಿಡಲಾಗುತ್ತದೆ.`,
    silent: (s, w) => `${s} ಆರ್ಡರ್ ${w} ಗೆ ಉತ್ತರಿಸಿಲ್ಲ. ಅದೇ ಆರ್ಡರ್ ಬಗ್ಗೆ ಮತ್ತೆ ಕೇಳಬಹುದು.`,
    receive: (s, w) => `${s} ಆರ್ಡರ್ ${w} ಒಪ್ಪಿದ್ದಾರೆ. ಸರಕು ಬಂದಾಗ ಗುರುತಿಸಿ.`,
    unsure: (s, r) => `${s} ಅವರಿಗೆ ಆರ್ಡರ್ ${r} ತಲುಪಿತೇ ಎಂದು ನಮಗೆ ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಅವರನ್ನು ಕೇಳಿ.`,
    gotIt: "ಅವರಿಗೆ ಸಿಕ್ಕಿತು", sendAgain: "ಮತ್ತೆ ಕಳುಹಿಸಿ",
    refused: (s, r, t) => `${s} ಅವರಿಗೆ ನಿಮ್ಮ ಆರ್ಡರ್ (${r}) ಅನ್ನು WhatsApp ಸ್ವೀಕರಿಸಲಿಲ್ಲ. ಏನನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ. ${t} ಕ್ಕೆ ನಾನು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸುತ್ತೇನೆ. ನೀವು ಅವರಿಗೆ ಕರೆಯನ್ನೂ ಮಾಡಬಹುದು.`,
    tryNow: "ಈಗ ಪ್ರಯತ್ನಿಸಿ", cancelOrder: "ಆರ್ಡರ್ ರದ್ದು ಮಾಡಿ",
    yes: "ಒಪ್ಪಿ", no: "ಬೇಡ", askAgain: "ಮತ್ತೆ ಕೇಳಿ", received: "ಎಲ್ಲಾ ಬಂತು",
    coming: "ಸರಬರಾಜುದಾರರ ಬಳಿ ಇರುವ ಆರ್ಡರ್‌ಗಳು", noneComing: "ಯಾವ ಸರಬರಾಜುದಾರರ ಬಳಿಯೂ ಆರ್ಡರ್ ಬಾಕಿ ಇಲ್ಲ.",
  },
};
