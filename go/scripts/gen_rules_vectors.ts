// Writes internal/assistant/testdata/rules-vectors.json: what the TypeScript rules (modules/assistant/intents.ts readOwnerRules) read from each phrase, for the Go reader
// (internal/assistant/rules.go) to be proved equal on the same phrases. Run with node from the repository root:  node go/scripts/gen_rules_vectors.ts
// The phrases cover each kind in each language, the case reference, a message first, the leave words, the memory words, a listing's words next to a command's, and a few that are nothing.
import { writeFileSync } from "node:fs";
import { readOwnerRules } from "../../modules/assistant/intents.ts";
import { resolveDate } from "../../modules/language/dates.ts";

const KINDS = ["waiting", "money", "cancel", "refund", "message", "undo", "limit", "help", "remember", "notes", "forget", "leave_file", "leave_operator"] as const;
const phrases = [
  "help", "what can you do", "मदद", "madad", "സഹായം", "ಸಹಾಯ", "undo", "revert", "वापस लो", "wapas lo", "പഴയപടി", "ಹಿಂದಿನಂತೆ", "limit", "limits", "लिमिट", "പരിധി", "ಮಿತಿ",
  "what needs me", "anything for me", "approve", "मेरे लिए क्या है", "എനിക്ക് എന്താണ് ബാക്കി", "ನನಗೆ ಏನು ಬಾಕಿ", "money today", "how much came in", "आज कितना आया", "ഇന്ന് എത്ര കിട്ടി", "ಇಂದು ಎಷ್ಟು ಬಂತು",
  "money tomorrow", "money day after tomorrow", "money yesterday", "paisa kal", "money on 16 nov", "money monday", "cancel b-14", "cancel B-14", "b-14 रद्द करो", "refund b-14", "refund ₹500 to b-3", "paise wapas b-1", "रिफंड b-2",
  "message b-14 Running 15 minutes late", "tell b-14 we are closed tomorrow", "b-14 ko bolo ki deri hogi", "message b-14", "message b-3 sorry, cancel it", "tell chat guest 3 we open at ten", "tell me tomorrow's bookings",
  "get my shop's file", "export", "Export.", "give me my shop's file", "मेरी दुकान की फाइल", "എന്റെ കടയുടെ ഫയൽ", "ನನ್ನ ಅಂಗಡಿಯ ಫೈಲ್", "change my operator", "Operator badal do", "ഓപ്പറേറ്റർ മാറ്റണം", "ಬೇರೆ ಆಪರೇಟರ್",
  "a long sentence that merely mentions the word operator and my shop's file somewhere in the middle of a rather long line of words that goes past ninety characters",
  "remember we close at 6 on Saturdays", "remember", "please remember that the shop is closed on sunday", "we close at six, remember", "yaad rakho ki kal chutti hai", "ഓർത്തുവെക്കൂ ഞായർ അവധി", "ನೆನಪಿಡಿ ಭಾನುವಾರ ರಜೆ", "remembered", "remembering",
  "what do you remember?", "notes", "my notes", "क्या याद है", "forget 3", "forget n-3", "forget note 12", "3 forget", "forget 12345", "bhool jao 4", "മറക്കൂ 2", "ಮರೆತುಬಿಡಿ 5",
  "I have two Persian kittens for sale on my page, 8000 rupees", "put this on my page: brass lamp 450 rupees", "for sale: undo", "cancel the order for sale", "limit for sale ₹500", "help me put it on my page", "holiday for sale", "kittens for sale",
  "tomorrow", "kal", "close sunday", "close", "orders", "bookings", "who owes fees", "move b-14 to 5pm", "hello", "what's up", "thanks", "", "   ", "yes ABCDE", "no thanks", "approve K7M2QX", "orders b-5", "reopen sunday", "holiday",
  "refund the order", "message", "tell", "list", "money", "paisa", "फीस", "ഓർഡർ",
];
const out = phrases.map((text) => {
  const r = readOwnerRules(text, { kinds: [...KINDS] });
  let offset: number | null | "other" = null;
  if (r.date) offset = r.date.kind === "relative" ? r.date.offsetDays : "other";
  return { text, kind: r.kind, ref: r.ref ?? "", note: r.note ?? "", words: r.words ?? "", date: offset };
});
void resolveDate;
writeFileSync(new URL("../internal/assistant/testdata/rules-vectors.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
