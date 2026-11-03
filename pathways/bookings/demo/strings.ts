// The words on the demo screens, per language. Customer messages are NOT here: those are the agent's own templates in
// src/language/. This is only the demo's chrome and the owner's plain-language summary (the "mom test" lines).
//
// Languages are looked up by code in a plain object, so a language pack added to LANGUAGES works at once with the
// English words here until someone adds a reviewed set. Nothing below touches src/.
import { formatInr } from "../src/language/format.ts";

export interface Ui {
  // labels
  banner: string;
  tabCustomer: string; tabOwner: string; tabRecord: string;
  showRecord: string; hideRecord: string;
  typeHere: string; send: string; payTwice: string; time1h: string; time1d: string; cancel: string; reset: string; setup: string;
  clock: string; trySaying: string; chatEmpty: string; testCustomer: string;
  ownerHeading: string; ownerEmpty: string; waitingHeading: string; nothingWaiting: string;
  approve: string; deny: string; retry: string; cancelAndRefund: string; plainHeading: string;
  formTitle: string; formName: string; formLanguage: string; formServices: string; formServiceName: string; formAlso: string;
  formPrice: string; formMinutes: string; formDeposit: string; formOpens: string; formCloses: string; formDays: string;
  formSubmit: string; formCancel: string; formHint: string;
  dayNames: string[]; // Sunday first
  working: string; // shown while a tap is being handled
  nothingToPay: string; demoFull: string; rebuilt: string;
  // phrases
  payButton(amount: string): string;
  askRefund(amount: string): string;
  askCalendar: string;
  reasonLate(hours: number): string;
  // the owner's summary
  bookingsNone: string;
  bookingsOk(n: number): string;
  bookingsMissing(found: number, total: number): string;
  bookingsCancelled(n: number): string;
  bookingsCancelledStill(n: number): string;
  depositsNone: string;
  deposits(kept: string): string;
  depositsReturned(collected: string, returned: string, kept: string): string;
  discountNone: string;
  discountRefused(amounts: number[]): string;
  outsideHours(n: number): string;
  refundRule(limit: string): string;
  refundAsked(n: number): string;
  refundAuto(amount: string, limit: string): string;
  paidTwice(amount: string): string;
  notChecked: string;
  demoNote: string;
}

const lowest = (amounts: number[]) => Math.min(...amounts);

const en: Ui = {
  banner: "Demo · test money · nothing real is sent",
  tabCustomer: "Customer", tabOwner: "Owner", tabRecord: "What we did",
  showRecord: "Show what we did ▸", hideRecord: "Hide ▾",
  typeHere: "Type as the customer…", send: "Send", payTwice: "Pay it twice", time1h: "1 hour passes", time1d: "1 day passes",
  cancel: "Cancel the booking", reset: "Start again", setup: "Set up for this shop",
  clock: "Demo clock", trySaying: "Try saying", chatEmpty: "No messages yet. Tap a suggestion or type as the customer.", testCustomer: "Test customer",
  ownerHeading: "What the owner sees on WhatsApp", ownerEmpty: "Nothing for the owner yet.", waitingHeading: "Waiting for your answer", nothingWaiting: "Nothing is waiting for you.",
  approve: "Approve", deny: "Deny", retry: "Check the calendar again", cancelAndRefund: "Cancel and give the money back", plainHeading: "In plain words",
  formTitle: "Set up for this shop", formName: "Shop name", formLanguage: "Language", formServices: "Services (at least one, up to four)",
  formServiceName: "Name", formAlso: "Also called (commas)", formPrice: "Price ₹", formMinutes: "Minutes", formDeposit: "Deposit ₹", formOpens: "Opens", formCloses: "Closes", formDays: "Open on",
  formSubmit: "Rebuild the demo for this shop", formCancel: "Close", formHint: "This starts the demo again with the shop's own prices.",
  dayNames: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  working: "Working…",
  nothingToPay: "There is no deposit to pay right now. Ask for a booking first.", demoFull: "This demo has had a lot of messages. Press Start again.", rebuilt: "Rebuilt for this shop.",
  payButton: (a) => `Pay the ${a} deposit (test money)`,
  askRefund: (a) => `Give back ${a}?`,
  askCalendar: "The calendar did not show this booking.",
  reasonLate: (h) => `Cancelled less than ${h} hours before the start.`,
  bookingsNone: "No bookings yet. Make one on the Customer tab.",
  bookingsOk: (n) => (n === 1 ? "The booking it made is in your calendar. We checked." : `All ${n} bookings it made are in your calendar. We checked.`),
  bookingsMissing: (f, t) => `Only ${f} of ${t} bookings are in your calendar. Look at the rest.`,
  bookingsCancelled: (n) => (n === 1 ? "1 booking was made and then cancelled. It is off your calendar." : `${n} bookings were made and then cancelled. They are off your calendar.`),
  bookingsCancelledStill: (n) => `${n} cancelled ${n === 1 ? "booking is" : "bookings are"} still on your calendar. Look at ${n === 1 ? "it" : "them"}.`,
  depositsNone: "No deposit has been paid yet.",
  deposits: (k) => `${k} in deposits, as the payment record shows.`,
  depositsReturned: (c, r, k) => `${c} in deposits came in and ${r} went back. You keep ${k}, as the payment record shows.`,
  discountNone: "Nobody has asked for a discount yet. It never goes below your price.",
  discountRefused: (a) => (a.length === 1 ? `It said no to ${formatInr(a[0])}. It never goes below your price.` : `It said no to a lower price ${a.length} times (lowest ${formatInr(lowest(a))}). It never goes below your price.`),
  outsideHours: (n) => `It said no to ${n} ${n === 1 ? "request" : "requests"} outside your opening hours.`,
  refundRule: (l) => `It asks you first before giving back more than ${l}, or for a late cancellation.`,
  refundAsked: (n) => `It asked you before giving money back (${n} ${n === 1 ? "time" : "times"}).`,
  refundAuto: (a, l) => `It gave back ${a} by itself, as your rules allow (up to ${l}).`,
  paidTwice: (a) => `Someone paid twice. The extra ${a} went back to them.`,
  notChecked: "We didn't check: phone calls · walk-ins.",
  demoNote: "This demo uses practice stand-ins for WhatsApp, payments and the calendar.",
};

const hi: Ui = {
  banner: "डेमो · टेस्ट पैसा · कुछ भी असली नहीं भेजा जाता",
  tabCustomer: "ग्राहक", tabOwner: "मालिक", tabRecord: "हमने क्या किया",
  showRecord: "हमने क्या किया, देखें ▸", hideRecord: "छिपाएँ ▾",
  typeHere: "ग्राहक की तरह लिखें…", send: "भेजें", payTwice: "दो बार जमा करें", time1h: "1 घंटा बीतता है", time1d: "1 दिन बीतता है",
  cancel: "बुकिंग रद्द करें", reset: "फिर से शुरू करें", setup: "इस दुकान के लिए सेट करें",
  clock: "डेमो घड़ी", trySaying: "ये लिखकर देखें", chatEmpty: "अभी कोई संदेश नहीं। कोई सुझाव दबाइए या ग्राहक की तरह लिखिए।", testCustomer: "टेस्ट ग्राहक",
  ownerHeading: "मालिक के WhatsApp पर क्या दिखता है", ownerEmpty: "मालिक के लिए अभी कुछ नहीं।", waitingHeading: "आपके जवाब का इंतज़ार", nothingWaiting: "आपके जवाब के लिए कुछ रुका नहीं है।",
  approve: "मंज़ूर करें", deny: "मना करें", retry: "कैलेंडर फिर जाँचें", cancelAndRefund: "रद्द करें और पैसे लौटाएँ", plainHeading: "आसान शब्दों में",
  formTitle: "इस दुकान के लिए सेट करें", formName: "दुकान का नाम", formLanguage: "भाषा", formServices: "सेवाएँ (कम से कम एक, ज़्यादा से ज़्यादा चार)",
  formServiceName: "नाम", formAlso: "और नाम (कॉमा से)", formPrice: "कीमत ₹", formMinutes: "मिनट", formDeposit: "जमा राशि ₹", formOpens: "खुलता है", formCloses: "बंद होता है", formDays: "खुले दिन",
  formSubmit: "इस दुकान के लिए डेमो फिर बनाएँ", formCancel: "बंद करें", formHint: "इससे डेमो दुकान की अपनी कीमतों के साथ फिर से शुरू होता है।",
  dayNames: ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"],
  working: "हो रहा है…",
  nothingToPay: "अभी जमा करने के लिए कुछ नहीं है। पहले बुकिंग माँगिए।", demoFull: "इस डेमो में बहुत संदेश हो गए। 'फिर से शुरू करें' दबाइए।", rebuilt: "इस दुकान के लिए फिर बना दिया।",
  payButton: (a) => `${a} जमा करें (टेस्ट पैसा)`,
  askRefund: (a) => `${a} वापस करें?`,
  askCalendar: "कैलेंडर में यह बुकिंग नहीं दिखी।",
  reasonLate: (h) => `शुरू होने से ${h} घंटे से कम पहले रद्द हुई।`,
  bookingsNone: "अभी कोई बुकिंग नहीं है। ग्राहक वाले टैब में एक बुकिंग बनाइए।",
  bookingsOk: (n) => (n === 1 ? "इसने जो बुकिंग की, वह आपके कैलेंडर में है। हमने जाँचा है।" : `इसने जितनी भी बुकिंग कीं (${n}), सब आपके कैलेंडर में हैं। हमने जाँचा है।`),
  bookingsMissing: (f, t) => `${t} में से सिर्फ़ ${f} बुकिंग आपके कैलेंडर में हैं। बाकी देख लीजिए।`,
  bookingsCancelled: (n) => (n === 1 ? "1 बुकिंग हुई थी और फिर रद्द हो गई। वह आपके कैलेंडर से हट गई है।" : `${n} बुकिंग हुई थीं और फिर रद्द हो गईं। वे आपके कैलेंडर से हट गई हैं।`),
  bookingsCancelledStill: (n) => `रद्द हुई ${n} बुकिंग अब भी आपके कैलेंडर में है। उसे देख लीजिए।`,
  depositsNone: "अभी किसी ने जमा राशि नहीं दी है।",
  deposits: (k) => `${k} जमा राशि मिली, जैसा पेमेंट रिकॉर्ड दिखाता है।`,
  depositsReturned: (c, r, k) => `${c} जमा राशि आई और ${r} वापस गई। आपके पास ${k} रहे, जैसा पेमेंट रिकॉर्ड दिखाता है।`,
  discountNone: "अभी किसी ने छूट नहीं माँगी। यह आपकी कीमत से नीचे कभी नहीं जाता।",
  discountRefused: (a) => (a.length === 1 ? `${formatInr(a[0])} में करने से इसने मना कर दिया। यह आपकी कीमत से नीचे कभी नहीं जाता।` : `कम कीमत माँगने पर इसने ${a.length} बार मना किया (सबसे कम ${formatInr(lowest(a))})। यह आपकी कीमत से नीचे कभी नहीं जाता।`),
  outsideHours: (n) => `खुलने के समय के बाहर की ${n} माँग को इसने मना किया।`,
  refundRule: (l) => `${l} से ज़्यादा लौटाने से पहले, या देर से रद्द होने पर, यह आपसे पूछता है।`,
  refundAsked: (n) => `पैसे वापस करने से पहले इसने आपसे पूछा (${n} बार)।`,
  refundAuto: (a, l) => `आपके नियम के अनुसार इसने ${a} अपने-आप वापस किए (${l} तक)।`,
  paidTwice: (a) => `किसी ने दो बार पैसे दे दिए। अतिरिक्त ${a} उन्हें लौटा दिए गए।`,
  notChecked: "हमने जाँचा नहीं: फ़ोन कॉल · बिना बुकिंग आने वाले ग्राहक।",
  demoNote: "इस डेमो में WhatsApp, पेमेंट और कैलेंडर की जगह अभ्यास वाले नकली सिस्टम हैं।",
};

const UI: Record<string, Ui> = { en, hi };

/** The words for a language code; English until a reviewed set exists for that language. */
export function uiFor(language: string): Ui {
  return UI[language] ?? en;
}

/** What the page needs: the plain strings and string lists (the phrases are functions the server calls). */
export function labelsOf(ui: Ui): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(ui)) if (typeof value === "string" || Array.isArray(value)) out[key] = value;
  return out;
}

/** What the Cancel button and the suggestion chips say as the customer, for languages that have words for them. */
export const CUSTOMER_WORDS: Record<string, { cancel: string; yes: string }> = {
  en: { cancel: "Please cancel my booking", yes: "yes" },
  hi: { cancel: "बुकिंग रद्द करें", yes: "हाँ" },
};
