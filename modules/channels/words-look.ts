// The few words the design pass (plan item 11i, 14 Nov 2026) adds to a shop's pages: the short stamp over each state on a customer's booking, order or fee page,
// the tag over each thing waiting on the owner's app, and the owner's dark/light switch. English is the source. Hindi, Malayalam and Kannada are machine-written
// and wait for a native reader (plan item 12), like the rest of the pages' words (words.ts); every page in those languages already says so at its top.
//
// A stamp names a state in one or two words; the sentence under it (words.ts, words-orders-fees.ts, words-confirm.ts) still says what it means and what to do.
// Its colour carries the meaning (look.ts): amber waits, green is done, red did not happen, grey is closed.
import type { Language } from "../language/languages.ts";

/** Every state a customer's page can be in, by the stamp it wears. */
export type StampKey =
  | "holding" | "held" | "checking" | "booked" | "confirmed" | "expired" | "cancelled" | "done" | "notHeld" | "notDone" | "refused" | "unknown"
  | "toPay" | "waiting" | "part" | "paid" | "closed" | "refund" | "paused";

/** The colour a stamp wears (look.ts .s-*). */
export type Tone = "wait" | "ok" | "bad" | "info" | "plain";
export const STAMP_TONE: Record<StampKey, Tone> = {
  holding: "info", held: "wait", checking: "wait", booked: "ok", confirmed: "ok", expired: "bad", cancelled: "plain", done: "plain", notHeld: "bad", notDone: "bad",
  refused: "bad", unknown: "bad", toPay: "wait", waiting: "wait", part: "wait", paid: "ok", closed: "plain", refund: "wait", paused: "plain",
};

export const STAMP: Record<Language, Record<StampKey, string>> = {
  en: {
    holding: "One moment", held: "Held", checking: "Checking", booked: "Booked", confirmed: "Confirmed", expired: "Time's up", cancelled: "Cancelled", done: "Done",
    notHeld: "Not held", notDone: "Not done", refused: "Not booked", unknown: "Not found", toPay: "To pay", waiting: "Waiting", part: "Part paid", paid: "Paid",
    closed: "Closed", refund: "Refund", paused: "Paused",
  },
  hi: {
    holding: "एक पल", held: "रोका गया", checking: "जाँच जारी", booked: "बुक हो गया", confirmed: "पक्का", expired: "समय ख़त्म", cancelled: "रद्द", done: "पूरा",
    notHeld: "नहीं रुका", notDone: "नहीं हुआ", refused: "बुक नहीं हुआ", unknown: "नहीं मिला", toPay: "देना है", waiting: "इंतज़ार", part: "कुछ दिया", paid: "दे दिया",
    closed: "बंद", refund: "रिफ़ंड", paused: "रुका हुआ",
  },
  ml: {
    holding: "ഒരു നിമിഷം", held: "മാറ്റിവച്ചു", checking: "പരിശോധിക്കുന്നു", booked: "ബുക്ക് ചെയ്തു", confirmed: "ഉറപ്പായി", expired: "സമയം കഴിഞ്ഞു", cancelled: "റദ്ദാക്കി",
    done: "കഴിഞ്ഞു", notHeld: "മാറ്റിവച്ചില്ല", notDone: "നടന്നില്ല", refused: "ബുക്ക് ആയില്ല", unknown: "കണ്ടില്ല", toPay: "അടയ്ക്കാനുണ്ട്", waiting: "കാത്തിരിക്കുന്നു",
    part: "ഭാഗികമായി അടച്ചു", paid: "അടച്ചു", closed: "അടച്ചു", refund: "റീഫണ്ട്", paused: "നിർത്തിവച്ചു",
  },
  kn: {
    holding: "ಒಂದು ಕ್ಷಣ", held: "ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ", checking: "ಪರಿಶೀಲನೆ", booked: "ಬುಕ್ ಆಗಿದೆ", confirmed: "ಖಚಿತ", expired: "ಸಮಯ ಮುಗಿದಿದೆ", cancelled: "ರದ್ದಾಗಿದೆ", done: "ಮುಗಿದಿದೆ",
    notHeld: "ಕಾಯ್ದಿರಿಸಿಲ್ಲ", notDone: "ಆಗಲಿಲ್ಲ", refused: "ಬುಕ್ ಆಗಲಿಲ್ಲ", unknown: "ಸಿಗಲಿಲ್ಲ", toPay: "ಪಾವತಿಸಬೇಕು", waiting: "ಕಾಯುತ್ತಿದೆ", part: "ಭಾಗಶಃ ಪಾವತಿ", paid: "ಪಾವತಿಸಲಾಗಿದೆ",
    closed: "ಮುಚ್ಚಲಾಗಿದೆ", refund: "ಮರುಪಾವತಿ", paused: "ನಿಲ್ಲಿಸಲಾಗಿದೆ",
  },
};

/** What each thing waiting on the owner's app is, in two or three words, over its card. */
export type TagKey = "payment" | "refundToSend" | "lateCancel" | "calendar" | "bigOrder" | "waiver" | "refundAsked" | "refundToApprove" | "message" | "assistant" | "parent";
export interface OwnerLookWords { tag: Record<TagKey, string>; theme: string }
export const OWNER_LOOK: Record<Language, OwnerLookWords> = {
  en: {
    tag: { payment: "Payment to check", refundToSend: "Refund to send", lateCancel: "Late cancellation", calendar: "Calendar problem", bigOrder: "Big order", waiver: "Fee waiver asked", refundAsked: "Refund asked", refundToApprove: "Refund to approve", message: "Message to send", assistant: "Your assistant asks", parent: "Parent's link" },
    theme: "Dark theme",
  },
  hi: {
    tag: { payment: "जाँचने को भुगतान", refundToSend: "भेजने को रिफ़ंड", lateCancel: "देर से रद्द", calendar: "कैलेंडर में दिक़्क़त", bigOrder: "बड़ा ऑर्डर", waiver: "फ़ीस माफ़ी की माँग", refundAsked: "रिफ़ंड की माँग", refundToApprove: "मंज़ूर करने को रिफ़ंड", message: "भेजने को संदेश", assistant: "आपका असिस्टेंट पूछ रहा है", parent: "अभिभावक का लिंक" },
    theme: "डार्क थीम",
  },
  ml: {
    tag: { payment: "പരിശോധിക്കാൻ പേയ്‌മെന്റ്", refundToSend: "അയയ്ക്കാൻ റീഫണ്ട്", lateCancel: "വൈകിയുള്ള റദ്ദാക്കൽ", calendar: "കലണ്ടറിൽ പ്രശ്നം", bigOrder: "വലിയ ഓർഡർ", waiver: "ഫീസ് ഇളവ് ചോദിച്ചു", refundAsked: "റീഫണ്ട് ചോദിച്ചു", refundToApprove: "അംഗീകരിക്കാൻ റീഫണ്ട്", message: "അയയ്ക്കാൻ സന്ദേശം", assistant: "നിങ്ങളുടെ അസിസ്റ്റന്റ് ചോദിക്കുന്നു", parent: "രക്ഷിതാവിന്റെ ലിങ്ക്" },
    theme: "ഡാർക്ക് തീം",
  },
  kn: {
    tag: { payment: "ಪರಿಶೀಲಿಸಬೇಕಾದ ಪಾವತಿ", refundToSend: "ಕಳುಹಿಸಬೇಕಾದ ಮರುಪಾವತಿ", lateCancel: "ತಡವಾದ ರದ್ದತಿ", calendar: "ಕ್ಯಾಲೆಂಡರ್ ಸಮಸ್ಯೆ", bigOrder: "ದೊಡ್ಡ ಆರ್ಡರ್", waiver: "ಶುಲ್ಕ ವಿನಾಯಿತಿ ಕೇಳಿದ್ದಾರೆ", refundAsked: "ಮರುಪಾವತಿ ಕೇಳಿದ್ದಾರೆ", refundToApprove: "ಒಪ್ಪಬೇಕಾದ ಮರುಪಾವತಿ", message: "ಕಳುಹಿಸಬೇಕಾದ ಸಂದೇಶ", assistant: "ನಿಮ್ಮ ಸಹಾಯಕರು ಕೇಳುತ್ತಿದ್ದಾರೆ", parent: "ಪೋಷಕರ ಲಿಂಕ್" },
    theme: "ಡಾರ್ಕ್ ಥೀಮ್",
  },
};
