// The owner's page words for a Stock orders shop (templates/commerce/stock-orders): what waits for the owner's yes, the orders no supplier has answered, the deliveries to
// mark, and the list of orders now with suppliers. English, Hindi, Malayalam and Kannada; English is the source and the rest are machine-written and wait for a native
// reader (they are on the review sheets: bundle/panel/review.ts lists STOCK_WORDS). The shop's own item, unit and supplier names arrive already written; nothing here
// writes a number or an amount, and none says the supplier is paid: the agent pays nobody. Used by owner-page.ts only.
import type { Language } from "../language/languages.ts";

export interface StockWords {
  tagApprove: string; tagSilent: string; tagReceive: string;
  approve: (supplier: string, what: string, amount: string) => string;
  silent: (supplier: string, what: string) => string;
  receive: (supplier: string, what: string) => string;
  yes: string; no: string; askAgain: string; received: string;
  coming: string; noneComing: string;
}

export const STOCK_WORDS: Record<Language, StockWords> = {
  en: {
    tagApprove: "Order to approve", tagSilent: "No answer from supplier", tagReceive: "Delivery to mark",
    approve: (s, w, a) => `Order ${w} from ${s}, ${a} in all. It goes to the supplier only when you approve, and the month's budget is kept for it then.`,
    silent: (s, w) => `${s} has not answered the order ${w}. You can ask them again about the same order.`,
    receive: (s, w) => `${s} accepted the order ${w}. Mark it when the goods arrive.`,
    yes: "Approve", no: "Decline", askAgain: "Ask again", received: "All received",
    coming: "Orders with suppliers", noneComing: "No orders are waiting on a supplier.",
  },
  hi: {
    tagApprove: "मंज़ूर करने को ऑर्डर", tagSilent: "सप्लायर का जवाब नहीं", tagReceive: "माल आने का निशान",
    approve: (s, w, a) => `${s} से ${w} का ऑर्डर, कुल ${a}। यह सप्लायर को तभी जाएगा जब आप मंज़ूर करेंगे, और तब महीने का बजट इसके लिए रखा जाएगा।`,
    silent: (s, w) => `${s} ने ऑर्डर ${w} का जवाब नहीं दिया। आप उसी ऑर्डर के बारे में उनसे फिर पूछ सकते हैं।`,
    receive: (s, w) => `${s} ने ऑर्डर ${w} मान लिया। माल आ जाए तो निशान लगाएँ।`,
    yes: "मंज़ूर करें", no: "मना करें", askAgain: "फिर पूछें", received: "सब मिल गया",
    coming: "सप्लायर के पास ऑर्डर", noneComing: "किसी सप्लायर पर कोई ऑर्डर बाकी नहीं।",
  },
  ml: {
    tagApprove: "അനുവദിക്കാൻ ഓർഡർ", tagSilent: "സപ്ലയർ മറുപടി നൽകിയില്ല", tagReceive: "സാധനം എത്തിയത് രേഖപ്പെടുത്തുക",
    approve: (s, w, a) => `${s}-ൽ നിന്ന് ${w} ഓർഡർ, ആകെ ${a}. നിങ്ങൾ അനുവദിച്ചാൽ മാത്രമേ ഇത് സപ്ലയർക്ക് പോകൂ, അപ്പോൾ മാസത്തെ ബജറ്റ് ഇതിനായി മാറ്റിവയ്ക്കും.`,
    silent: (s, w) => `${s} ഓർഡർ ${w}-ന് മറുപടി നൽകിയില്ല. അതേ ഓർഡറിനെക്കുറിച്ച് വീണ്ടും ചോദിക്കാം.`,
    receive: (s, w) => `${s} ഓർഡർ ${w} സ്വീകരിച്ചു. സാധനം എത്തുമ്പോൾ രേഖപ്പെടുത്തുക.`,
    yes: "അനുവദിക്കൂ", no: "വേണ്ട", askAgain: "വീണ്ടും ചോദിക്കൂ", received: "എല്ലാം കിട്ടി",
    coming: "സപ്ലയർമാരുടെ പക്കലുള്ള ഓർഡറുകൾ", noneComing: "ഒരു സപ്ലയറുടെയും പക്കൽ ഓർഡറുകൾ ബാക്കിയില്ല.",
  },
  kn: {
    tagApprove: "ಒಪ್ಪಬೇಕಾದ ಆರ್ಡರ್", tagSilent: "ಸರಬರಾಜುದಾರರ ಉತ್ತರವಿಲ್ಲ", tagReceive: "ಸರಕು ಬಂದದ್ದನ್ನು ಗುರುತಿಸಿ",
    approve: (s, w, a) => `${s} ಅವರಿಂದ ${w} ಆರ್ಡರ್, ಒಟ್ಟು ${a}. ನೀವು ಒಪ್ಪಿದರೆ ಮಾತ್ರ ಇದು ಸರಬರಾಜುದಾರರಿಗೆ ಹೋಗುತ್ತದೆ, ಆಗ ತಿಂಗಳ ಬಜೆಟ್ ಇದಕ್ಕಾಗಿ ಮೀಸಲಿಡಲಾಗುತ್ತದೆ.`,
    silent: (s, w) => `${s} ಆರ್ಡರ್ ${w} ಗೆ ಉತ್ತರಿಸಿಲ್ಲ. ಅದೇ ಆರ್ಡರ್ ಬಗ್ಗೆ ಮತ್ತೆ ಕೇಳಬಹುದು.`,
    receive: (s, w) => `${s} ಆರ್ಡರ್ ${w} ಒಪ್ಪಿದ್ದಾರೆ. ಸರಕು ಬಂದಾಗ ಗುರುತಿಸಿ.`,
    yes: "ಒಪ್ಪಿ", no: "ಬೇಡ", askAgain: "ಮತ್ತೆ ಕೇಳಿ", received: "ಎಲ್ಲಾ ಬಂತು",
    coming: "ಸರಬರಾಜುದಾರರ ಬಳಿ ಇರುವ ಆರ್ಡರ್‌ಗಳು", noneComing: "ಯಾವ ಸರಬರಾಜುದಾರರ ಬಳಿಯೂ ಆರ್ಡರ್ ಬಾಕಿ ಇಲ್ಲ.",
  },
};
