// The character's hooks (item 11e, decision 43): one character per shop, carried in the shop's settings (`assistant.character`) and set up with the owner at the partner's
// visit. A separate design exploration draws the characters; nothing is drawn here. This file holds only what the code needs: the setting's shape and its check, a
// default, and the sticker a mood shows (mood.ts computes the mood). Used by settings.ts (the check), conversation.ts and morning.ts (the name), and the owner's app.
//
// The look is a small JSON of options from fixed lists, so a drawing set can be made for exactly these and nothing else can be asked of it. The voice is a choice the
// voice notes job maps to its provider's speakers (modules/voice); here it is only a name from a list. The character always says it is the shop's assistant (words.ts).
import type { Mood } from "./mood.ts";

/** The look's options. Each list is small on purpose: a drawing exists for every combination the settings can name. */
export const LOOK_OPTIONS = {
  base: ["round", "tall", "small"],
  colour: ["teal", "pink", "saffron", "indigo", "leaf", "clay"],
  /** Something for the shop's trade, or none. */
  accessory: ["none", "scissors", "book", "bag", "apron", "pen", "flower", "spanner"],
} as const;

/** The voice choices for spoken replies. The voice notes job maps each to a speaker its provider has; a shop with voice off simply never uses it. */
export const VOICES = ["warm", "bright", "calm", "deep"] as const;

export interface Look { base: (typeof LOOK_OPTIONS.base)[number]; colour: (typeof LOOK_OPTIONS.colour)[number]; accessory: (typeof LOOK_OPTIONS.accessory)[number] }
export interface Character { name: string; look: Look; voice: (typeof VOICES)[number] }

/** A name: 1 to 24 letters (any script), spaces, hyphens or apostrophes. No digits, so it can never be read as an amount or a code. */
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} '’-]{0,23}$/u;

export const DEFAULT_LOOK: Look = { base: "round", colour: "teal", accessory: "none" };
export const DEFAULT_VOICE: Character["voice"] = "warm";

/** The character a shop has when its settings name none: a plain name, the default look and voice. The partner sets the real one with the owner at the visit. */
export const defaultCharacter = (name = "Mithra"): Character => ({ name, look: { ...DEFAULT_LOOK }, voice: DEFAULT_VOICE });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === "string" && (list as readonly string[]).includes(v);

/** Check a character setting. Every problem is a plain sentence the panel can show; a missing part takes its default. */
export function readCharacter(raw: unknown, errors: string[]): Character | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) { errors.push('"assistant.character" must be an object with a name, a look and a voice.'); return undefined; }
  for (const k of Object.keys(raw)) if (!["name", "look", "voice"].includes(k)) errors.push(`"assistant.character" has "${k}", which is not a setting (name, look, voice).`);
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!NAME_RE.test(name)) errors.push('The character\'s "name" must be 1 to 24 letters (spaces, hyphens and apostrophes are fine; no digits).');
  const look: Look = { ...DEFAULT_LOOK };
  if (raw.look !== undefined) {
    if (!isObj(raw.look)) errors.push('"assistant.character.look" must be an object: base, colour and accessory.');
    else for (const [k, v] of Object.entries(raw.look)) {
      if (!(k in LOOK_OPTIONS)) { errors.push(`The look has "${k}", which is not an option (base, colour, accessory).`); continue; }
      const options = LOOK_OPTIONS[k as keyof Look];
      if (!oneOf(options, v)) errors.push(`The look's "${k}" must be one of: ${options.join(", ")}.`);
      else (look as unknown as Record<string, string>)[k] = v;
    }
  }
  const voice = raw.voice === undefined ? DEFAULT_VOICE : raw.voice;
  if (!oneOf(VOICES, voice)) errors.push(`The character's "voice" must be one of: ${VOICES.join(", ")}.`);
  return { name, look, voice: voice as Character["voice"] };
}

/**
 * The sticker for a mood: a stable name a drawing set provides, "<base>-<colour>-<mood>" (the accessory is on every sticker of a look, so it is not in the name).
 * The morning line and the app name it; whether a picture is sent is the drawings' job, which does not exist yet (Deferred).
 */
export const stickerFor = (character: Character, mood: Mood): string => `${character.look.base}-${character.look.colour}-${mood}`;
