// A rough Latin spelling of Hindi, Malayalam and Kannada words, so a search typed in Latin letters ("billi", "poocha", "bekku") finds the listing whose words are
// written in the native script. A phone keyboard in these languages is slower than a Latin one for many buyers, and the listing carries its words only in the
// scripts (specs/directory.md, "The index"). It is a FOLD, not a transliteration scheme: both sides (the words of a listing in native script, and what the buyer
// typed in Latin letters) are brought to the same plain, lower-case Latin skeleton, and the skeleton is what is compared.
//
// How: each Indic letter becomes its usual Latin letters; a consonant followed by a vowel sign takes that vowel, else the inherent "a"; a virama (the joiner that
// removes the vowel) drops it. Then the skeleton is flattened the same way for everything: long vowels become short (aa to a, ee to i, oo to u), "w" and "v" are
// one, doubled letters become one ("billi" and "bili"), "h" after a consonant is dropped ("kh" to "k", "ch" to "c"),
// "z" is "j", and word-final "a" is dropped (Hindi drops it, Malayalam keeps it, and a Latin typist may or may not write it). The result is deliberately loose: it
// finds a word a buyer half-remembers, and the shop's own words and the owner's confirmation do the exact work. Pure: no import.

const VOWELS: Record<string, string> = {
  // Devanagari (U+0900 block)
  "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
  // Malayalam
  "അ": "a", "ആ": "aa", "ഇ": "i", "ഈ": "ee", "ഉ": "u", "ഊ": "oo", "ഋ": "ri", "എ": "e", "ഏ": "ee", "ഐ": "ai", "ഒ": "o", "ഓ": "oo", "ഔ": "au",
  // Kannada
  "ಅ": "a", "ಆ": "aa", "ಇ": "i", "ಈ": "ee", "ಉ": "u", "ಊ": "oo", "ಋ": "ri", "ಎ": "e", "ಏ": "ee", "ಐ": "ai", "ಒ": "o", "ಓ": "oo", "ಔ": "au",
};
const SIGNS: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॅ": "e", "ॉ": "o",
  "ാ": "aa", "ി": "i", "ീ": "ee", "ു": "u", "ൂ": "oo", "ൃ": "ri", "െ": "e", "േ": "ee", "ൈ": "ai", "ൊ": "o", "ോ": "oo", "ൗ": "au",
  "ಾ": "aa", "ಿ": "i", "ೀ": "ee", "ು": "u", "ೂ": "oo", "ೃ": "ri", "ೆ": "e", "ೇ": "ee", "ೈ": "ai", "ೊ": "o", "ೋ": "oo", "ೌ": "au",
};
const CONSONANTS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n", "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n", "प": "p", "फ": "f", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh", "ष": "sh", "स": "s", "ह": "h", "ळ": "l",
  "क़": "k", "ख़": "kh", "ग़": "g", "ज़": "j", "ड़": "d", "ढ़": "dh", "फ़": "f",
  "ക": "k", "ഖ": "kh", "ഗ": "g", "ഘ": "gh", "ങ": "n", "ച": "ch", "ഛ": "chh", "ജ": "j", "ഝ": "jh", "ഞ": "n", "ട": "t", "ഠ": "th", "ഡ": "d", "ഢ": "dh", "ണ": "n",
  "ത": "t", "ഥ": "th", "ദ": "d", "ധ": "dh", "ന": "n", "പ": "p", "ഫ": "f", "ബ": "b", "ഭ": "bh", "മ": "m", "യ": "y", "ര": "r", "ല": "l", "വ": "v", "ശ": "sh", "ഷ": "sh", "സ": "s", "ഹ": "h", "ള": "l", "ഴ": "zh", "റ": "r",
  "ಕ": "k", "ಖ": "kh", "ಗ": "g", "ಘ": "gh", "ಙ": "n", "ಚ": "ch", "ಛ": "chh", "ಜ": "j", "ಝ": "jh", "ಞ": "n", "ಟ": "t", "ಠ": "th", "ಡ": "d", "ಢ": "dh", "ಣ": "n",
  "ತ": "t", "ಥ": "th", "ದ": "d", "ಧ": "dh", "ನ": "n", "ಪ": "p", "ಫ": "f", "ಬ": "b", "ಭ": "bh", "ಮ": "m", "ಯ": "y", "ರ": "r", "ಲ": "l", "ವ": "v", "ಶ": "sh", "ಷ": "sh", "ಸ": "s", "ಹ": "h", "ಳ": "l",
  // Malayalam chillu letters: a consonant with no vowel
  "ൺ": "n", "ൻ": "n", "ർ": "r", "ൽ": "l", "ൾ": "l", "ൿ": "k",
};
const NASAL: Record<string, string> = { "ं": "n", "ँ": "n", "ം": "m", "ಂ": "m" };
const VIRAMA = new Set(["्", "്", "್"]);
const NO_VOWEL = new Set(["ൺ", "ൻ", "ർ", "ൽ", "ൾ", "ൿ"]);

/** The plain Latin letters of a word in Devanagari, Malayalam or Kannada (other characters are kept as they are, lower-cased). */
function spell(text: string): string {
  let out = "";
  const chars = [...text.normalize("NFC")];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const consonant = CONSONANTS[c];
    if (consonant !== undefined) {
      out += consonant;
      const next = chars[i + 1];
      if (NO_VOWEL.has(c)) continue;
      if (next !== undefined && VIRAMA.has(next)) { i++; continue; }          // no vowel: the next consonant joins
      if (next !== undefined && SIGNS[next] !== undefined) { out += SIGNS[next]; i++; continue; }
      out += "a";                                                              // the inherent vowel
      continue;
    }
    if (VOWELS[c] !== undefined) out += VOWELS[c];
    else if (NASAL[c] !== undefined) out += NASAL[c];
    else if (SIGNS[c] !== undefined || VIRAMA.has(c) || /\p{M}/u.test(c)) continue; // a stray sign: nothing to say
    else out += c.toLowerCase();
  }
  return out;
}

/** Flatten a Latin spelling (typed by a buyer, or made by `spell`) to the skeleton both sides are compared by. */
function flatten(latin: string): string {
  return latin.toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ").trim()
    .split(" ").map((w) => w
      .replace(/w/gu, "v").replace(/z/gu, "j").replace(/q/gu, "k").replace(/x/gu, "ks")
      .replace(/([bcdfgjklmnprstvy])h/gu, "$1") // kh, gh, ch, th, dh, bh, sh... lose their h
      .replace(/ee/gu, "i").replace(/oo/gu, "u") // long vowels become short (aa becomes a in the next step)
      .replace(/(.)\1+/gu, "$1")                // doubled letters: billi = bili, kk = k, aa = a
      .replace(/(.{2,})a$/u, "$1"))              // a word-final a (Hindi writes none, Malayalam says it)
    .join(" ");
}

/** The skeleton of a word or phrase in any of our scripts or in Latin letters: what the index stores and what a Latin search is turned into. */
export const skeleton = (text: string): string => flatten(spell(text));
