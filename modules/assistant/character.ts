// The shop's character (item 11e, decision 47; built 14 Nov 2026 as item 11i's character half): one per shop, carried in the shop's settings
// (`assistant.character`), rolled by the partner in the panel's Character step with the owner beside them. This file is what every part of the product shares
// about it, and it draws nothing:
//  - the five DiceBear styles the owner approved (docs/product/characters/README.md), each with the one colour a partner may change and that colour's own DiceBear
//    palette (its first eight values; a bundle test checks them against the vendored definitions);
//  - the five moods a picture shows, by the names the pictures are served under (`well`, `needs`, `wrong`, `closed`, `busy`, as Streetlist names them), and the
//    approved eyes and mouth for each style and mood;
//  - the mood in words in four languages, because a picture never carries a mood alone (accessibility: the words go beside it or in its alt text);
//  - the setting's shape and its check.
// The drawings themselves are DiceBear's own, made on the shop's server by bundle/character/render.ts (the bundle may import this file; modules never import the
// bundle). Owner, 14 Nov: DiceBear's own drawings only, crisp: no filters and no hand-drawn additions, so there is no "accessory" and no dimmed or "zzz" Closed face;
// Clay's Closed is its own happy eyes and flat mouth, and the word "Closed" says the rest.
//
// The character always says it is the shop's assistant (words.ts). There is no voice: the assistant listens to voice notes but answers in text (owner, 12 Nov).
import type { Language } from "../language/languages.ts";
import type { Mood } from "./mood.ts";
import { PERSONALITIES } from "./personality.ts";
import type { Personality } from "./personality.ts";

/** The five styles, in the order the panel offers them (Golu first: the owner's pick on the approved page). All CC0 1.0 in @dicebear/styles 10.6.0. */
export const CHARACTER_STYLES = ["clay", "critters", "sprouts", "moods", "pixelbot"] as const;
export type CharacterStyle = (typeof CHARACTER_STYLES)[number];

/** DiceBear's own colours for the critters, sprouts and moods body (the same list in all three definitions). */
const PASTELS = ["7dd3fc", "a5b4fc", "c4b5fd", "f0abfc", "fda4af", "fca5a5", "fdba74", "fcd34d"] as const;

/**
 * Each style as the panel shows it: its name (Latin letters in every language, like a brand), the DiceBear colour a swatch changes (`<option>Color`), and the
 * first eight values of that colour in the style's own definition. "Pixel" for DiceBear's Pixelbot: the product's words never say "bot".
 */
export const STYLE_INFO: Record<CharacterStyle, { name: string; colourOption: "body" | "pot" | "face" | "glow"; palette: readonly string[] }> = {
  clay: { name: "Golu", colourOption: "body", palette: ["c4795c", "d99277", "e0bd6a", "cf9f52", "a8b37e", "8ba06b", "83b0a4", "86a5c3"] },
  critters: { name: "Critters", colourOption: "body", palette: PASTELS },
  sprouts: { name: "Sprouts", colourOption: "pot", palette: PASTELS },
  moods: { name: "Moods", colourOption: "face", palette: PASTELS },
  pixelbot: { name: "Pixel", colourOption: "glow", palette: ["7dd3fc", "5eead4", "86efac", "bef264", "fde68a", "fdba74", "f9a8d4", "c4b5fd"] },
};

/** The moods a picture shows, by the names the pictures are served under (<base>/character/<face>.svg). */
export const FACES = ["well", "needs", "wrong", "closed", "busy"] as const;
export type Face = (typeof FACES)[number];

/** The one mapping from the shop's mood (mood.ts) to its picture. */
export const FACE_OF_MOOD: Record<Mood, Face> = { quiet: "well", waiting_for_owner: "needs", something_wrong: "wrong", closed: "closed", busy: "busy" };

/** The approved eyes and mouth (DiceBear variant names) for each style and mood: docs/product/characters/README.md, "The five moods". */
export const EYES_AND_MOUTH: Record<CharacterStyle, Record<Face, readonly [eyes: string, mouth: string]>> = {
  clay: { well: ["even", "smile"], needs: ["up", "o"], wrong: ["down", "frown"], closed: ["happy", "line"], busy: ["side", "line"] },
  critters: { well: ["round", "smile"], needs: ["wide", "ooh"], wrong: ["bigPupils", "sad"], closed: ["closedLine", "line"], busy: ["sideeye", "wavy"] },
  sprouts: { well: ["round", "smile"], needs: ["wide", "open"], wrong: ["bigPupils", "frown"], closed: ["closedLine", "line"], busy: ["sideeye", "wavy"] },
  moods: { well: ["pupils", "smile"], needs: ["bigPupils", "open"], wrong: ["tallPupils", "frown"], closed: ["closed", "line"], busy: ["lookSide", "wavy"] },
  pixelbot: { well: ["round", "smile"], needs: ["tall", "open"], wrong: ["slim", "tiny"], closed: ["soft", "flat"], busy: ["blocks", "flat"] },
};

/**
 * The mood in words, beside every picture of it (and in its alt text), in the approved page's words. Machine-written in Hindi, Malayalam and Kannada and on the
 * review list (item 12) with the rest of the owner's and the page's words.
 */
export const FACE_WORDS: Record<Language, Record<Face, string>> = {
  en: { well: "All well", needs: "Needs you", wrong: "Something wrong", closed: "Closed", busy: "Busy" },
  hi: { well: "सब ठीक", needs: "आपकी ज़रूरत है", wrong: "कुछ गड़बड़ है", closed: "बंद", busy: "व्यस्त" },
  ml: { well: "എല്ലാം ശരി", needs: "നിങ്ങളെ ആവശ്യമുണ്ട്", wrong: "എന്തോ പ്രശ്നമുണ്ട്", closed: "അടച്ചിരിക്കുന്നു", busy: "തിരക്കിലാണ്" },
  kn: { well: "ಎಲ್ಲವೂ ಸರಿ", needs: "ನಿಮ್ಮ ಅಗತ್ಯವಿದೆ", wrong: "ಏನೋ ತೊಂದರೆ ಇದೆ", closed: "ಮುಚ್ಚಿದೆ", busy: "ಕಾರ್ಯನಿರತ" },
};

/**
 * What a shop's customers and the public see: only "all well", "busy" or "closed". "Needs you" and "something wrong" are the owner's business (decision 43: the
 * character is the owner's, customers meet it only as the shop's face), so on the shop's page, on Streetlist and through `now.svg` the face is the mood the shop
 * would have with nothing waiting and nothing wrong. The owner's app and the owner's WhatsApp show all five.
 */
export const publicFace = (mood: Mood, withoutOwnerMatters: Mood): Face => (mood === "something_wrong" || mood === "waiting_for_owner" ? FACE_OF_MOOD[withoutOwnerMatters] : FACE_OF_MOOD[mood]);

/** The three files each mood is saved as (bundle/character/render.ts): SVG for pages, PNG for WhatsApp's profile photo and template header, WebP for stickers. */
export const PICTURE_FORMATS = ["svg", "png", "webp"] as const;
export type PictureFormat = (typeof PICTURE_FORMATS)[number];

/**
 * Where a shop's pictures are, for whoever links to them (the morning line, the owner's app): the shop's address (pages.json `url` through the pages domain's front
 * door, else its own server's `base`) and the version of the drawn set, so a link changes when the character does and a cache never shows an old face.
 */
export interface CharacterPictures { base: string; version: string }

/** A mood picture's address on the shop's own server (modules/channels/front.ts serves it): <base>/character/<face>.<format>?v=<version>. */
export const pictureUrl = (p: CharacterPictures, face: Face, format: PictureFormat): string => `${p.base}/character/${face}.${format}?v=${p.version}`;

export interface Character {
  /** What the assistant calls itself: 1 to 24 letters in any script. */
  name: string;
  style: CharacterStyle;
  /** DiceBear's seed: decides the shape, top, details, colours and tile. The panel's Roll makes one that begins with the shop's id. Left out: the shop's id. */
  seed?: string;
  /** One of the style's eight palette colours (hex, no "#"), or left out for DiceBear's own pick ("Auto"). */
  colour?: string;
  /** Changes only the assistant's own small talk (personality.ts). */
  personality: Personality;
}

/** A name: 1 to 24 letters (any script), spaces, hyphens or apostrophes. No digits, so it can never be read as an amount or a code. */
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} '’-]{0,23}$/u;
/** A seed: plain characters only, so it can sit in a file name, a form and a URL unchanged. */
export const SEED_RE = /^[a-z0-9][a-z0-9-]{0,79}$/u;

/** The character a shop has when its settings turn the assistant on but name none: Golu with the shop's id as its seed. The partner sets the real one at the visit. */
export const defaultCharacter = (name = "Mithra"): Character => ({ name, style: "clay", personality: "warm" });

/** The seed a picture is drawn with: the character's own, or the shop's id. */
export const seedOf = (c: Pick<Character, "seed">, shopId: string): string => c.seed ?? shopId;

/** The theme colour of the owner's app bar: the character's colour, or a teal that reads in light and dark. */
export const themeColour = (c: Pick<Character, "colour"> | undefined): string => (c?.colour ? `#${c.colour}` : "#0f766e");

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const KEYS = ["name", "style", "seed", "colour", "personality"];

/** Check a character setting. Every problem is a plain sentence the panel can show; a missing part takes its default. */
export function readCharacter(raw: unknown, errors: string[]): Character | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) { errors.push('"assistant.character" must be an object with a name and a style.'); return undefined; }
  for (const k of Object.keys(raw)) {
    if (k === "look") errors.push('"assistant.character.look" is no longer a setting: the character is a DiceBear "style", a "seed" and a "colour" (decision 47). Make it again in the panel\'s Character step.');
    else if (!KEYS.includes(k)) errors.push(`"assistant.character" has "${k}", which is not a setting (${KEYS.join(", ")}). The assistant answers in text, so there is no voice to choose.`);
  }
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!NAME_RE.test(name)) errors.push('The character\'s "name" must be 1 to 24 letters (spaces, hyphens and apostrophes are fine; no digits).');
  const style = raw.style === undefined ? "clay" : raw.style;
  if (!(CHARACTER_STYLES as readonly unknown[]).includes(style)) errors.push(`The character's "style" must be one of: ${CHARACTER_STYLES.join(", ")}.`);
  const out: Character = { name, style: (CHARACTER_STYLES as readonly unknown[]).includes(style) ? style as CharacterStyle : "clay", personality: "warm" };
  if (raw.seed !== undefined) {
    if (typeof raw.seed !== "string" || !SEED_RE.test(raw.seed)) errors.push('The character\'s "seed" must be 1 to 80 small letters, digits and hyphens.');
    else out.seed = raw.seed;
  }
  if (raw.colour !== undefined) {
    const c = typeof raw.colour === "string" ? raw.colour.replace(/^#/u, "").toLowerCase() : "";
    if (!STYLE_INFO[out.style].palette.includes(c)) errors.push(`The character's "colour" must be one of the ${STYLE_INFO[out.style].name} colours (${STYLE_INFO[out.style].palette.join(", ")}), or left out for DiceBear's own.`);
    else out.colour = c;
  }
  if (raw.personality !== undefined) {
    if (!(PERSONALITIES as readonly unknown[]).includes(raw.personality)) errors.push(`The character's "personality" must be one of: ${PERSONALITIES.join(", ")}.`);
    else out.personality = raw.personality as Personality;
  }
  return out;
}
