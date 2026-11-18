// Reading the owner's words about leaving with their shop (block S, 18 Nov 2026): "get my shop's file" (also just "export") and "change my Operator", in English, Hindi
// (also typed in Latin letters), Malayalam and Kannada. Read by RULE only, before every other kind and before any model, for the same reason as the shop's memory
// (intents-memory.ts): the words "badal do" and "മാറ്റുക" are also the booking-move words, so "Operator badal do" must never become a booking move, and a model is
// never asked whether the owner wants their shop's data or another Operator. Short messages only, so a sentence that merely mentions an operator is not taken.
// Used by intents.ts (readOwnerRules).
const FILE = new RegExp([
  "^\\s*(?:please\\s+)?export\\s*[.!?]*\\s*$", "(?:get|give|send|download|take|want|need)\\s+(?:me\\s+)?(?:my\\s+)?(?:own\\s+)?shop'?s?\\s+(?:file|data|records?|package)", "(?:my\\s+)?shop'?s?\\s+(?:file|package)\\s*[.!?]*\\s*$",
  "export\\s+(?:my\\s+)?(?:shop|data|records?)", "download\\s+(?:my\\s+)?(?:shop|data|records?)",
  "meri\\s+dukan\\s+ki\\s+file", "dukan\\s+ki\\s+file", "मेरी\\s+दुकान\\s+की\\s+फ़?ाइल", "दुकान\\s+की\\s+फ़?ाइल",
  "എന്റെ\\s+കടയുടെ\\s+ഫയൽ", "കടയുടെ\\s+ഫയൽ", "ನನ್ನ\\s+ಅಂಗಡಿಯ\\s+ಫೈಲ್", "ಅಂಗಡಿಯ\\s+ಫೈಲ್", "എക്സ്പോർട്ട്", "एक्सपोर्ट", "ಎಕ್ಸ್‌?ಪೋರ್ಟ್",
].join("|"), "iu");
const OPERATOR = new RegExp([
  "(?:change|switch|replace|new|another|different)\\s+(?:my\\s+)?operator", "operator\\s+(?:change|badlo|badal|badlna|badalna|badal\\s+do|badlo)", "(?:want|need)\\s+(?:a\\s+|an\\s+)?(?:new|another|different)\\s+operator",
  "dusra\\s+operator", "naya\\s+operator", "ऑपरेटर\\s+बदल", "दूसरा\\s+ऑपरेटर", "नया\\s+ऑपरेटर",
  "ഓപ്പറേറ്റർ\\s+മാറ്റ", "മറ്റൊരു\\s+ഓപ്പറേറ്റർ", "പുതിയ\\s+ഓപ്പറേറ്റർ", "ಆಪರೇಟರ್\\s+ಬದಲ", "ಬೇರೆ\\s+ಆಪರೇಟರ್", "ಹೊಸ\\s+ಆಪರೇಟರ್",
].join("|"), "iu");

export type LeaveWords = "file" | "operator";

/** What the words say about leaving, or undefined when they say nothing about it. The Operator change is tried first: it is the more specific of the two. */
export function readLeaveWords(text: string): LeaveWords | undefined {
  const t = text.normalize("NFC");
  if (t.length > 90) return undefined;
  // no "not followed by a letter" check: the Hindi, Malayalam and Kannada stems ("बदल", "മാറ്റ", "ಬದಲ") take endings, and the phrase as a whole is specific enough
  if (OPERATOR.test(t)) return "operator";
  if (FILE.test(t)) return "file";
  return undefined;
}
