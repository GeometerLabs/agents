// The kinds of limit templates share, as factories over chat-limits.ts's ChatLimit: a refund limit, a waiver limit, a big-order amount and orders a day. A template's
// own declaration (templates/*/src/chat-limits.ts) says only where each sits in ITS settings and what its hard bounds are; the words in four languages are written once,
// here, so Bookings, Fees and Orders say "refund limit" the same way and the review sheets list each line once. Hindi, Malayalam and Kannada are machine-written and
// are on the review sheets (bundle/panel/review.ts reads LIMIT_WORDS).
import type { ChatLimit } from "./chat-limits.ts";

type Bounds = ChatLimit["bounds"];

/** Every line of the shared limits' words, by limit kind: what the review sheets list. `{v}` is where the value goes. */
export const LIMIT_WORDS = {
  refund: {
    name: { en: "refund limit", hi: "रिफंड की सीमा", ml: "റീഫണ്ട് പരിധി", kn: "ರೀಫಂಡ್ ಮಿತಿ" },
    rule: {
      en: "Refunds above {v} need your approval",
      hi: "{v} से ऊपर के रिफंड के लिए आपकी मंज़ूरी चाहिए",
      ml: "{v}-ന് മുകളിലുള്ള റീഫണ്ടുകൾക്ക് നിങ്ങളുടെ അനുമതി വേണം",
      kn: "{v} ಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ರೀಫಂಡ್‌ಗಳಿಗೆ ನಿಮ್ಮ ಅನುಮೋದನೆ ಬೇಕು",
    },
    words: ["refund", "refunds", "रिफंड", "रिफंड्स", "റീഫണ്ട്", "റീഫണ്ടുകൾ", "ರೀಫಂಡ್"],
  },
  waiver: {
    name: { en: "waiver limit", hi: "छूट की सीमा", ml: "ഇളവ് പരിധി", kn: "ರಿಯಾಯಿತಿ ಮಿತಿ" },
    rule: {
      en: "Waivers above {v} need your approval",
      hi: "{v} से ऊपर की छूट के लिए आपकी मंज़ूरी चाहिए",
      ml: "{v}-ന് മുകളിലുള്ള ഇളവുകൾക്ക് നിങ്ങളുടെ അനുമതി വേണം",
      kn: "{v} ಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ರಿಯಾಯಿತಿಗಳಿಗೆ ನಿಮ್ಮ ಅನುಮೋದನೆ ಬೇಕು",
    },
    words: ["waive", "waiver", "waivers", "waiving", "छूट", "माफ़", "माफ", "ഇളവ്", "ഇളവുകൾ", "ರಿಯಾಯಿತಿ"],
  },
  bigOrder: {
    name: { en: "big-order amount", hi: "बड़े ऑर्डर की राशि", ml: "വലിയ ഓർഡർ തുക", kn: "ದೊಡ್ಡ ಆರ್ಡರ್ ಮೊತ್ತ" },
    rule: {
      en: "Orders above {v} need your approval before any payment is asked",
      hi: "{v} से ऊपर के ऑर्डर पर पैसे माँगने से पहले आपकी मंज़ूरी चाहिए",
      ml: "{v}-ന് മുകളിലുള്ള ഓർഡറുകൾക്ക് പണം ചോദിക്കുന്നതിന് മുമ്പ് നിങ്ങളുടെ അനുമതി വേണം",
      kn: "{v} ಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ಆರ್ಡರ್‌ಗಳಿಗೆ ಪಾವತಿ ಕೇಳುವ ಮೊದಲು ನಿಮ್ಮ ಅನುಮೋದನೆ ಬೇಕು",
    },
    words: ["big order", "big orders", "large order", "large orders", "orders above", "order above", "बड़े ऑर्डर", "बड़ा ऑर्डर", "വലിയ ഓർഡർ", "ದೊಡ್ಡ ಆರ್ಡರ್"],
  },
  perDay: {
    name: { en: "orders a day", hi: "एक दिन के ऑर्डर", ml: "ദിവസത്തെ ഓർഡറുകൾ", kn: "ದಿನದ ಆರ್ಡರ್‌ಗಳು" },
    rule: {
      en: "At most {v} orders a day",
      hi: "एक दिन में ज़्यादा से ज़्यादा {v} ऑर्डर",
      ml: "ഒരു ദിവസം പരമാവധി {v} ഓർഡറുകൾ",
      kn: "ದಿನಕ್ಕೆ ಗರಿಷ್ಠ {v} ಆರ್ಡರ್‌ಗಳು",
    },
    // always with the noun: a bare "a day" or "per day" is in "close for a day" and means nothing about a limit
    words: ["orders a day", "orders per day", "orders each day", "orders in a day", "order a day", "ऑर्डर रोज़", "रोज़ के ऑर्डर", "एक दिन के ऑर्डर", "ദിവസത്തെ ഓർഡർ", "ഒരു ദിവസം ഓർഡർ", "ദിവസേന ഓർഡർ", "ದಿನಕ್ಕೆ ಆರ್ಡರ್", "ದಿನದ ಆರ್ಡರ್"],
  },
  // Stock orders (17 Nov 2026): the most one purchase order may be worth, and the most a month's approved orders may add up to
  orderCap: {
    name: { en: "order cap", hi: "एक ऑर्डर की सीमा", ml: "ഒരു ഓർഡറിന്റെ പരിധി", kn: "ಒಂದು ಆರ್ಡರ್‌ನ ಮಿತಿ" },
    rule: {
      en: "No single supplier order may be worth more than {v}",
      hi: "सप्लायर को जाने वाला कोई भी एक ऑर्डर {v} से ज़्यादा का नहीं हो सकता",
      ml: "സപ്ലയർക്കുള്ള ഒരു ഓർഡറും {v}-ൽ കൂടുതൽ മൂല്യമുള്ളതാകരുത്",
      kn: "ಸರಬರಾಜುದಾರರಿಗೆ ಹೋಗುವ ಯಾವುದೇ ಒಂದು ಆರ್ಡರ್ {v} ಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ಮೌಲ್ಯದ್ದಾಗಿರಬಾರದು",
    },
    words: ["order cap", "cap per order", "per order cap", "max per order", "most per order", "एक ऑर्डर की सीमा", "ഒരു ഓർഡറിന്റെ പരിധി", "ಒಂದು ಆರ್ಡರ್‌ನ ಮಿತಿ"],
  },
  monthlyBudget: {
    name: { en: "monthly budget", hi: "महीने का बजट", ml: "മാസ ബജറ്റ്", kn: "ತಿಂಗಳ ಬಜೆಟ್" },
    rule: {
      en: "The month's supplier orders may add up to at most {v}",
      hi: "महीने के सप्लायर ऑर्डर कुल मिलाकर ज़्यादा से ज़्यादा {v} तक हो सकते हैं",
      ml: "മാസത്തെ സപ്ലയർ ഓർഡറുകൾ ആകെ പരമാവധി {v} വരെ ആകാം",
      kn: "ತಿಂಗಳ ಸರಬರಾಜು ಆರ್ಡರ್‌ಗಳು ಒಟ್ಟು ಗರಿಷ್ಠ {v} ವರೆಗೆ ಇರಬಹುದು",
    },
    words: ["monthly budget", "month budget", "budget for the month", "stock budget", "महीने का बजट", "मासिक बजट", "മാസ ബജറ്റ്", "ತಿಂಗಳ ಬಜೆಟ್"],
  },
  // E1, the discount authority (24 Nov 2026; modules/limits/discounts.ts): the cap the agent may take off a price alone, as a percentage and in rupees (the lower wins)
  discountPercent: {
    name: { en: "discount cap (percent)", hi: "छूट की सीमा (प्रतिशत)", ml: "ഇളവ് പരിധി (ശതമാനം)", kn: "ರಿಯಾಯಿತಿ ಮಿತಿ (ಶೇಕಡಾ)" },
    rule: {
      en: "The agent may take at most {v}% off a price without asking you",
      hi: "एजेंट आपसे पूछे बिना किसी कीमत में से ज़्यादा से ज़्यादा {v}% कम कर सकता है",
      ml: "നിങ്ങളോട് ചോദിക്കാതെ ഏജന്റിന് ഒരു വിലയിൽ നിന്ന് പരമാവധി {v}% കുറയ്ക്കാം",
      kn: "ನಿಮ್ಮನ್ನು ಕೇಳದೆ ಏಜೆಂಟ್ ಒಂದು ಬೆಲೆಯಿಂದ ಗರಿಷ್ಠ {v}% ಕಡಿಮೆ ಮಾಡಬಹುದು",
    },
    words: ["discount percent", "discount cap percent", "cap percent", "discount %", "छूट प्रतिशत", "ഇളവ് ശതമാനം", "ರಿಯಾಯಿತಿ ಶೇಕಡಾ"],
  },
  discountInr: {
    name: { en: "discount cap (rupees)", hi: "छूट की सीमा (रुपये)", ml: "ഇളവ് പരിധി (രൂപ)", kn: "ರಿಯಾಯಿತಿ ಮಿತಿ (ರೂಪಾಯಿ)" },
    rule: {
      en: "The agent may take at most {v} off a price without asking you",
      hi: "एजेंट आपसे पूछे बिना किसी कीमत में से ज़्यादा से ज़्यादा {v} कम कर सकता है",
      ml: "നിങ്ങളോട് ചോദിക്കാതെ ഏജന്റിന് ഒരു വിലയിൽ നിന്ന് പരമാവധി {v} കുറയ്ക്കാം",
      kn: "ನಿಮ್ಮನ್ನು ಕೇಳದೆ ಏಜೆಂಟ್ ಒಂದು ಬೆಲೆಯಿಂದ ಗರಿಷ್ಠ {v} ಕಡಿಮೆ ಮಾಡಬಹುದು",
    },
    words: ["discount cap", "discount limit", "discount rupees", "छूट की सीमा", "ഇളവ് പരിധി", "ರಿಯಾಯಿತಿ ಮಿತಿ"],
  },
} as const;

/** A limit made from one kind's words, a settings path and its bounds. */
function make(kind: keyof typeof LIMIT_WORDS, a: { id: string; path: string; unit: ChatLimit["unit"]; tighter: ChatLimit["tighter"]; bounds: Bounds; zeroIsOff?: true }): ChatLimit {
  const w = LIMIT_WORDS[kind];
  return { id: a.id, path: a.path, unit: a.unit, tighter: a.tighter, ...(a.zeroIsOff ? { zeroIsOff: true as const } : {}), bounds: a.bounds, name: w.name, rule: w.rule, words: w.words };
}

/** Refunds above this rupee amount need the owner (lower is tighter). */
export const refundLimit = (path: string, bounds: Bounds): ChatLimit => make("refund", { id: "refund_limit", path, unit: "inr", tighter: "lower", bounds });
/** Waivers above this rupee amount need the owner (lower is tighter; 0 asks about every waiver). */
export const waiverLimit = (path: string, bounds: Bounds): ChatLimit => make("waiver", { id: "waiver_limit", path, unit: "inr", tighter: "lower", bounds });
/** Orders above this rupee amount go to the owner before any payment (lower is tighter; 0 is never, the loosest). */
export const bigOrderLimit = (path: string, bounds: Bounds): ChatLimit => make("bigOrder", { id: "big_order_limit", path, unit: "inr", tighter: "lower", zeroIsOff: true, bounds });
/** The most orders in a day (lower is tighter). */
export const ordersPerDayLimit = (path: string, bounds: Bounds): ChatLimit => make("perDay", { id: "orders_per_day", path, unit: "count", tighter: "lower", bounds });

/** Stock orders: no one purchase order may be worth more than this many rupees (lower is tighter). */
export const orderCapLimit = (path: string, bounds: Bounds): ChatLimit => make("orderCap", { id: "order_cap", path, unit: "inr", tighter: "lower", bounds });
/** Stock orders: the month's approved orders may add up to at most this many rupees (lower is tighter). */
export const monthlyBudgetLimit = (path: string, bounds: Bounds): ChatLimit => make("monthlyBudget", { id: "monthly_budget", path, unit: "inr", tighter: "lower", bounds });

/** E1: the most percent the agent may take off a price alone (lower is tighter; a count, said with a % sign by its words). */
export const discountPercentLimit = (path: string, bounds: Bounds): ChatLimit => make("discountPercent", { id: "discount_cap_percent", path, unit: "count", tighter: "lower", bounds });
/** E1: the most rupees the agent may take off one ask alone (lower is tighter). */
export const discountInrLimit = (path: string, bounds: Bounds): ChatLimit => make("discountInr", { id: "discount_cap_inr", path, unit: "inr", tighter: "lower", bounds });
