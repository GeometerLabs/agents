// Before a customer's message goes to ANY model (the decision model or the language model), phone numbers and names are taken out.
// The model needs neither to work out what the customer wants, and an outside provider should not get them (economics note, section 3.4).
//
// Phone numbers are removed by their shape and that is reliable: any run of 10 or more digits (with spaces, dots, dashes or brackets between
// them, and an optional +), in Latin, Devanagari, Malayalam or Kannada digits. Prices, clock times ("6:30") and dates ("11 Nov", "15-11-2026")
// are shorter and are left alone; an Indian mobile or landline number is not. E-mail addresses and links go too.
//
// Names cannot be found by shape. What is removed: any names the caller knows (for example the customer's WhatsApp profile name), and the
// words after a way of introducing oneself ("my name is Ravi", "मेरा नाम रवि", "എന്റെ പേര് രവി", "ನನ್ನ ಹೆಸರು ರವಿ"): one word, and a second
// only when it is a capitalised Latin word (a surname), because what follows a name in these languages is usually the request itself. A name written some other way gets through; this is a best effort for names and an exact rule for numbers. The caller's own
// number (the `from` of a message) never reaches here at all: only the words do.
const DIGITS = "0-9०-९൦-൯೦-೯";
const PHONE = new RegExp(`\\+?\\(?[${DIGITS}][${DIGITS}\\s().\\-]{8,}[${DIGITS}]`, "gu");
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const LINK = /\b(?:https?:\/\/|www\.)\S+/giu;

// "my name is", "myself", "मेरा नाम" ... then one name-like word, and a second one only if it starts with a capital letter (letters, not digits).
// Plain "I am" and "this is" are left out on purpose: "I am free tomorrow" and "this is urgent" are not names, and taking them out would change what the customer asked.
const WORD = "[\\p{L}\\p{M}][\\p{L}\\p{M}.'-]*";
const INTRO = [
  "(?:my\\s+name\\s+is|name\\s+is|name\\s*[:-]|myself|mera\\s+naam|mera\\s+name|naam)",
  "(?:मेरा\\s+नाम|नाम)",
  "(?:എന്റെ\\s+പേര്|എൻ്റെ\\s+പേര്|പേര്)",
  "(?:ನನ್ನ\\s+ಹೆಸರು|ಹೆಸರು)",
].join("|");
const NAME_AFTER_INTRO = new RegExp(`((?<![\\p{L}\\p{M}])(?:${INTRO}))\\s+${WORD}`, "giu");
// A surname is the next word only when it starts with a capital letter, so this one is case-sensitive: a separate pattern, because an inline switch
// for the "i" flag, (?-i:...), is not in every Node version we run on (Node 22 refuses the whole pattern, and with it the module).
const SURNAME = /\s+[A-Z][a-z.'-]*/y;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export interface Redaction {
  /** The words with numbers, links, addresses and names replaced. */
  text: string;
  /** How many things were taken out (for a test; never what they were). */
  removed: number;
}

/** Take the personal details out of a message before a model sees it. `names`: names the caller knows, removed wherever they appear. */
export function redact(text: string, names: readonly string[] = []): Redaction {
  let removed = 0;
  const swap = (re: RegExp, to: string) => { text = text.replace(re, () => { removed++; return to; }); };
  swap(EMAIL, "[address]");
  swap(LINK, "[link]");
  // Ten digits or more, separators not counted: a date written "15-11-2026" (eight digits) stays, and a mobile or landline number goes.
  text = text.replace(PHONE, (m) => {
    if ([...m.matchAll(/\p{Nd}/gu)].length < 10) return m;
    removed++;
    return "[number]";
  });
  let out = "";
  let last = 0;
  for (const m of text.matchAll(NAME_AFTER_INTRO)) {
    let end = (m.index as number) + m[0].length;
    SURNAME.lastIndex = end;
    const surname = SURNAME.exec(text);
    if (surname) end += surname[0].length;
    out += `${text.slice(last, m.index)}${m[1]} [name]`;
    last = end;
    removed++;
  }
  text = out + text.slice(last);
  for (const name of names) {
    const clean = name.trim();
    if (clean.length >= 2) swap(new RegExp(`(?<![\\p{L}\\p{M}])${escapeRe(clean)}(?![\\p{L}\\p{M}])`, "giu"), "[name]");
  }
  return { text, removed };
}
