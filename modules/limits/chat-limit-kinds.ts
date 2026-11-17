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
