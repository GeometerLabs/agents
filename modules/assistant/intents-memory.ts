// Reading the owner's words about the shop's memory (block M): "remember …", "what do you remember?" and "forget 3", in English, Hindi (also typed in Latin letters),
// Malayalam and Kannada. These are read by RULE only, before any other kind and before any model: "remember we close on Sunday" must save a note, never close Sunday, and
// a model is never asked to decide that the owner wants something written to the shop's memory. The text of a note is the owner's own words after the command word (or before
// it, which is how Malayalam and Kannada say it), as typed. Used by intents.ts (readOwnerRules); kept in its own file so that file stays small.
const NOT_LETTER = "(?![\\p{L}\\p{M}])";
const REMEMBER = [
  "remember", "keep in mind", "please note", "yaad rakh(?:na|o|iye|ein|en|lo)?", "yaad rakho", "याद\\s*रख(?:ना|ो|िए|ें|ो|ो)?", "याद\\s*रखें",
  "ഓർത്തു\\s?വെക്കൂ", "ഓർത്തു\\s?വെക്കുക", "ഓർത്തു\\s?വയ്ക്കൂ", "ഓർത്തുവച്ചോളൂ", "ഓർമ്മിക്കൂ", "ഓർക്കുക", "ನೆನಪಿಟ್ಟುಕೊ(?:ಳ್ಳಿ|ಳ್ಳು|)", "ನೆನಪಿಡಿ", "ನೆನಪಿನಲ್ಲಿಡಿ",
].join("|");
const LEAD = new RegExp(`^\\s*(?:please\\s+|pls\\s+)?(?:${REMEMBER})${NOT_LETTER}\\s*(?:that\\s+|ki\\s+|कि\\s+)?[:,\\-–]?\\s*(.+)$`, "isu");
const TRAIL = new RegExp(`^(.+?)\\s*(?:എന്ന്|ಎಂದು|ki|कि|that)?\\s+(?:${REMEMBER})\\s*[.!]*\\s*$`, "isu");

const LIST = new RegExp([
  "what\\s+do\\s+you\\s+remember", "what\\s+have\\s+you\\s+noted", "what\\s+do\\s+you\\s+know\\s+about\\s+my\\s+shop", "(?:show|list|see)\\s+(?:my\\s+|the\\s+)?notes", "^\\s*(?:my\\s+)?notes\\s*[?.!]*\\s*$",
  "kya\\s+yaad\\s+hai", "तुम्हें\\s+क्या\\s+याद", "क्या\\s+याद\\s+है", "नोट्स\\s+दिखाओ", "എന്താണ്\\s+ഓർമ്മ", "എന്തൊക്കെ\\s+ഓർമ്മ", "ഓർമ്മയിൽ\\s+എന്ത്", "ಏನು\\s+ನೆನಪಿದೆ", "ಏನೇನು\\s+ನೆನಪಿದೆ", "ನೆನಪಿನಲ್ಲಿ\\s+ಏನಿದೆ",
].join("|"), "iu");

const FORGET = new RegExp(`(?:forget|delete\\s+note|remove\\s+note|bhool\\s+jao|bhul\\s+jao|भूल\\s*जाओ|भूल\\s*जा|नोट\\s+हटाओ|മറക്കൂ|മറക്കുക|ಮರೆತುಬಿಡಿ|ಮರೆಯಿರಿ)${NOT_LETTER}\\s*(?:note\\s*)?(?:n-?)?(\\d{1,4})(?![\\p{N}])`, "iu");
const FORGET_AFTER = new RegExp(`(?:n-?)?(\\d{1,4})\\s*(?:ko\\s+|को\\s+)?(?:forget|bhool\\s+jao|भूल\\s*जाओ|മറക്കൂ|ಮರೆತುಬಿಡಿ)${NOT_LETTER}`, "iu");

export type MemoryWords = { kind: "remember"; words?: string } | { kind: "notes" } | { kind: "forget"; note: string };

/** What the words say about memory, or undefined when they say nothing about it. */
export function readMemoryWords(text: string): MemoryWords | undefined {
  const t = text.normalize("NFC");
  const forget = FORGET.exec(t) ?? (t.length <= 40 ? FORGET_AFTER.exec(t) : null);
  if (forget) return { kind: "forget", note: `n-${Number(forget[1])}` };
  if (t.length <= 80 && LIST.test(t)) return { kind: "notes" };
  const lead = LEAD.exec(t);
  const words = (lead ? lead[1] : TRAIL.exec(t)?.[1])?.trim().replace(/^["'“‘](.*)["'”’]$/su, "$1").trim();
  if (lead || words) return words ? { kind: "remember", words } : { kind: "remember" };
  if (new RegExp(`^\\s*(?:${REMEMBER})${NOT_LETTER}\\s*[.!?]*\\s*$`, "iu").test(t)) return { kind: "remember" };
  return undefined;
}
