// What the assistant says when the owner asks to leave with their shop (block S, 18 Nov 2026), in English, Hindi, Malayalam and Kannada: "Get my shop's file" and "Change my
// Operator". Kept apart from words.ts like words-memory.ts; words.ts's `write` reads this table for these ids. Plain words for an owner who has never heard of an export or a
// handover: the file, the Operator, the code. The Hindi, Malayalam and Kannada are machine-written and are on the review sheets (bundle/panel/review.ts, "leave with your shop").
// The times named here are the real ones (bundle/Explanation.md, "Leave with your shop"): the server looks at the shop's record every quarter of an hour and then makes the file.
import type { Language } from "../language/languages.ts";
import type { Writer } from "./words.ts";

export interface LeaveMessageData {
  /** The file was asked for: where it will be, and for how long it can be taken. */
  leave_file_asked: Record<string, never>;
  /** The same ask came a moment ago: it is on its way. */
  leave_file_again: Record<string, never>;
  /** "Change my Operator" was asked for: who has been told, and what the owner does next. */
  leave_operator_asked: Record<string, never>;
  leave_operator_again: Record<string, never>;
}
export type LeaveMessageId = keyof LeaveMessageData;
type Words = { [K in LeaveMessageId]: (d: LeaveMessageData[K], w: Writer) => string };

export const LEAVE_WORDS: Record<Language, Words> = {
  en: {
    leave_file_asked: (_d, w) => `Done. Your shop's file will be on your app page in about half an hour, with a button to take it. The button works once and for ${w.n(3)} days. You do not need your Operator for this, and they are not asked.`,
    leave_file_again: () => "You asked for your shop's file a short while ago. It is on its way; look on your app page in a little while.",
    leave_operator_asked: (_d, w) => `Done. I have told your Operator that you want another one. Nothing changes until you agree: your Operator names the new person, you get a code, and you send it here as "move" and the code. If nothing happens in ${w.n(14)} days, Geometer will help you.`,
    leave_operator_again: () => "You asked to change your Operator a short while ago, and they have been told. Nothing changes until you send the code.",
  },
  hi: {
    leave_file_asked: (_d, w) => `हो गया। आपकी दुकान की फ़ाइल करीब आधे घंटे में आपके ऐप पेज पर होगी, उसे लेने का बटन भी। बटन एक बार और ${w.n(3)} दिन तक चलता है। इसके लिए आपके Operator की ज़रूरत नहीं है, और उनसे पूछा भी नहीं जाता।`,
    leave_file_again: () => "आपने थोड़ी देर पहले दुकान की फ़ाइल माँगी थी। वह आ रही है; थोड़ी देर में अपना ऐप पेज देखिए।",
    leave_operator_asked: (_d, w) => `हो गया। मैंने आपके Operator को बता दिया है कि आप दूसरा Operator चाहते हैं। आपकी हाँ के बिना कुछ नहीं बदलता: आपका Operator नए व्यक्ति का नाम देता है, आपको एक कोड मिलता है, और आप उसे यहाँ "move" और कोड लिखकर भेजते हैं। ${w.n(14)} दिन में कुछ न हुआ तो Geometer आपकी मदद करेगा।`,
    leave_operator_again: () => "आपने थोड़ी देर पहले Operator बदलने को कहा था, और उन्हें बता दिया गया है। कोड भेजने तक कुछ नहीं बदलता।",
  },
  ml: {
    leave_file_asked: (_d, w) => `ശരി. നിങ്ങളുടെ കടയുടെ ഫയൽ ഏകദേശം അര മണിക്കൂറിൽ നിങ്ങളുടെ ആപ്പ് പേജിൽ ഉണ്ടാകും, എടുക്കാനുള്ള ബട്ടണും. ബട്ടൺ ഒരു തവണ മാത്രം, ${w.n(3)} ദിവസം വരെ പ്രവർത്തിക്കും. ഇതിന് നിങ്ങളുടെ Operator വേണ്ട, അവരോട് ചോദിക്കുന്നുമില്ല.`,
    leave_file_again: () => "കുറച്ചുമുമ്പ് നിങ്ങൾ കടയുടെ ഫയൽ ചോദിച്ചിരുന്നു. അത് വരുന്നുണ്ട്; കുറച്ച് കഴിഞ്ഞ് ആപ്പ് പേജ് നോക്കൂ.",
    leave_operator_asked: (_d, w) => `ശരി. മറ്റൊരു Operator വേണമെന്ന് ഞാൻ നിങ്ങളുടെ Operator-നെ അറിയിച്ചു. നിങ്ങൾ സമ്മതിക്കാതെ ഒന്നും മാറില്ല: Operator പുതിയ ആളുടെ പേര് നൽകും, നിങ്ങൾക്ക് ഒരു കോഡ് കിട്ടും, അത് "move" എന്നും കോഡും ചേർത്ത് ഇവിടെ അയയ്ക്കണം. ${w.n(14)} ദിവസത്തിൽ ഒന്നും നടന്നില്ലെങ്കിൽ Geometer സഹായിക്കും.`,
    leave_operator_again: () => "കുറച്ചുമുമ്പ് നിങ്ങൾ Operator-നെ മാറ്റാൻ പറഞ്ഞിരുന്നു, അവരെ അറിയിച്ചിട്ടുണ്ട്. കോഡ് അയയ്ക്കുന്നതുവരെ ഒന്നും മാറില്ല.",
  },
  kn: {
    leave_file_asked: (_d, w) => `ಆಯಿತು. ನಿಮ್ಮ ಅಂಗಡಿಯ ಫೈಲ್ ಸುಮಾರು ಅರ್ಧ ಗಂಟೆಯಲ್ಲಿ ನಿಮ್ಮ ಆ್ಯಪ್ ಪುಟದಲ್ಲಿ ಇರುತ್ತದೆ, ತೆಗೆದುಕೊಳ್ಳಲು ಬಟನ್ ಕೂಡ. ಬಟನ್ ಒಂದೇ ಬಾರಿ, ${w.n(3)} ದಿನ ಕೆಲಸ ಮಾಡುತ್ತದೆ. ಇದಕ್ಕೆ ನಿಮ್ಮ Operator ಬೇಕಿಲ್ಲ, ಅವರನ್ನು ಕೇಳುವುದೂ ಇಲ್ಲ.`,
    leave_file_again: () => "ಸ್ವಲ್ಪ ಮೊದಲು ನೀವು ಅಂಗಡಿಯ ಫೈಲ್ ಕೇಳಿದ್ದೀರಿ. ಅದು ಬರುತ್ತಿದೆ; ಸ್ವಲ್ಪ ಹೊತ್ತಿನ ನಂತರ ಆ್ಯಪ್ ಪುಟ ನೋಡಿ.",
    leave_operator_asked: (_d, w) => `ಆಯಿತು. ನೀವು ಬೇರೆ Operator ಬಯಸುತ್ತೀರಿ ಎಂದು ನಿಮ್ಮ Operator ಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ನೀವು ಒಪ್ಪುವವರೆಗೆ ಏನೂ ಬದಲಾಗುವುದಿಲ್ಲ: Operator ಹೊಸ ವ್ಯಕ್ತಿಯ ಹೆಸರು ನೀಡುತ್ತಾರೆ, ನಿಮಗೆ ಒಂದು ಕೋಡ್ ಸಿಗುತ್ತದೆ, ಅದನ್ನು ಇಲ್ಲಿ "move" ಮತ್ತು ಕೋಡ್ ಎಂದು ಕಳುಹಿಸಿ. ${w.n(14)} ದಿನದಲ್ಲಿ ಏನೂ ಆಗದಿದ್ದರೆ Geometer ನಿಮಗೆ ಸಹಾಯ ಮಾಡುತ್ತದೆ.`,
    leave_operator_again: () => "ಸ್ವಲ್ಪ ಮೊದಲು ನೀವು Operator ಬದಲಾಯಿಸಲು ಕೇಳಿದ್ದೀರಿ, ಅವರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ. ಕೋಡ್ ಕಳುಹಿಸುವವರೆಗೆ ಏನೂ ಬದಲಾಗುವುದಿಲ್ಲ.",
  },
};
