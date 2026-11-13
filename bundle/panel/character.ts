// The Character step of a shop's setup (plan item 11i, decision 47), as plain functions: what the step keeps in the draft, what each press does, what it refuses
// in the person's language, and what it writes into the shop's settings. The page is views-character.ts; the drawings are bundle/character/render.ts.
//
// The partner (or builder) makes the shop's assistant with the owner beside them: a style (DiceBear's Clay, Critters, Sprouts, Moods, Pixel Bot), a face from a row of
// eight rolled for this shop, a colour from the style's own DiceBear palette (or Auto), a name if they want one (owner, 14 Nov: optional; with none it is "<the
// shop>'s assistant"), and a personality that changes only small talk. The panel runs no script, so every
// press is a form post that comes back to the same step (style, face, colour, Roll), and only "Next" checks the whole and moves on. What was typed in the name box
// is kept on every press.
//
// Roll: eight new seeds, each "<shop id>-<six random hex digits>-<0 to 7>", so a face is never another shop's start and Roll always gives faces not seen before.
// Saving the shop (server.ts) writes the choice into `assistant.character` and draws every mood once into the shop's own data.
import { randomBytes } from "node:crypto";
import { CHARACTER_STYLES, STYLE_INFO, readCharacter } from "../../modules/assistant/character.ts";
import type { Character, CharacterStyle } from "../../modules/assistant/character.ts";
import { PERSONALITIES } from "../../modules/assistant/personality.ts";
import type { Personality } from "../../modules/assistant/personality.ts";
import type { Body } from "./setup.ts";
import type { Words } from "./words.ts";

/** How many faces a roll shows: one row, like DiceBear's own preview. */
export const STRIP = 8;

/** What the step keeps in the draft. `roll` is the current roll's six hex digits; `seed` the face picked from it (or from an earlier roll, for a saved shop). */
export interface CharacterDraft {
  style: CharacterStyle;
  roll: string;
  seed?: string;
  colour?: string;
  /** The character's name as typed; empty for none (it is then "<the shop>'s assistant"). */
  name: string;
  personality: Personality;
  /** True once the step was finished (Next, with nothing refused): only then does saving the shop write a character, and so turn its assistant on. */
  chosen: boolean;
}

const newRoll = (): string => randomBytes(3).toString("hex");

/** The eight seeds of a roll for a shop. Every seed starts with the shop's id. */
export const stripSeeds = (shopId: string, roll: string): string[] => Array.from({ length: STRIP }, (_, i) => `${shopId}-${roll}-${i}`);

/** The step's starting point for a new shop: Clay, a fresh roll with its first face picked, Auto colour, no name, the warm personality. */
export const newCharacterDraft = (shopId: string): CharacterDraft => {
  const roll = newRoll();
  return { style: "clay", roll, seed: stripSeeds(shopId, roll)[0], name: "", personality: "warm", chosen: false };
};

/** The step's draft for a shop that exists: its saved character (chosen), or a new one when its settings have none. */
export function characterDraftFromSettings(settings: unknown, shopId: string): CharacterDraft {
  const raw = (settings as { assistant?: { character?: unknown } } | undefined)?.assistant?.character;
  const c = raw === undefined ? undefined : readCharacter(raw, []);
  if (!c) return newCharacterDraft(shopId);
  return { style: c.style, roll: newRoll(), seed: c.seed ?? shopId, ...(c.colour ? { colour: c.colour } : {}), name: c.name ?? "", personality: c.personality, chosen: true };
}

/** What a press asks for: a style, a face, a colour, a new roll, or Next. */
export type CharacterPress = { kind: "style"; style: CharacterStyle } | { kind: "face"; seed: string } | { kind: "colour"; colour: string | undefined } | { kind: "roll" } | { kind: "next" };

/** Read the press from the form: the button pressed carries its own name and value. Anything unknown is Next (Enter in the name box submits the form). */
export function pressOf(body: Body): CharacterPress {
  if (body.act === "roll") return { kind: "roll" };
  if (typeof body.pickStyle === "string" && (CHARACTER_STYLES as readonly string[]).includes(body.pickStyle)) return { kind: "style", style: body.pickStyle as CharacterStyle };
  if (typeof body.pickFace === "string") return { kind: "face", seed: body.pickFace };
  if (typeof body.pickColour === "string") return { kind: "colour", colour: body.pickColour === "auto" ? undefined : body.pickColour };
  return { kind: "next" };
}

/**
 * One press of the step. Every press keeps what was typed (the name, the personality). A style, a face, a colour or a roll changes the draft and stays on the step
 * (`stay`); Next checks the whole and, with nothing refused, marks the character chosen. A face from outside this shop's rolls, or a colour from outside the
 * style's palette, is refused in words and changes nothing.
 */
export function applyCharacter(draft: { shopId?: string; character?: CharacterDraft }, body: Body, w: Words): { stay: boolean; problems: string[] } {
  const shopId = draft.shopId ?? "shop";
  const c = draft.character ?? newCharacterDraft(shopId);
  const p = w.setup.character.problems;
  const problems: string[] = [];
  c.name = (body.characterName ?? c.name).trim().slice(0, 40);
  if (typeof body.personality === "string") {
    if ((PERSONALITIES as readonly string[]).includes(body.personality)) c.personality = body.personality as Personality;
    else problems.push(p.personality);
  }
  const press = pressOf(body);
  if (press.kind === "roll") { c.roll = newRoll(); c.seed = stripSeeds(shopId, c.roll)[0]; }
  else if (press.kind === "style") { c.style = press.style; c.colour = undefined; } // a colour is the style's own: a new style starts on Auto
  else if (press.kind === "face") {
    if (press.seed.startsWith(`${shopId}-`) && /^[a-z0-9-]{1,80}$/u.test(press.seed)) c.seed = press.seed;
    else problems.push(p.face);
  } else if (press.kind === "colour") {
    if (press.colour === undefined || STYLE_INFO[c.style].palette.includes(press.colour)) c.colour = press.colour;
    else problems.push(p.colour);
  }
  draft.character = c;
  if (press.kind !== "next") return { stay: true, problems };
  const errors: string[] = [];
  readCharacter(characterSetting(c, shopId), errors);
  if (errors.length > 0) {
    if (c.name !== "" && !/^[\p{L}\p{M}][\p{L}\p{M} '’-]{0,23}$/u.test(c.name)) problems.push(p.name);
    if (!c.seed) problems.push(p.face);
    if (problems.length === 0) problems.push(...errors);
  }
  c.chosen = problems.length === 0;
  return { stay: false, problems };
}

/** The `assistant.character` setting the draft writes (modules/assistant/character.ts reads it back). A name only when the partner gave one. */
export function characterSetting(c: CharacterDraft, shopId: string): Character & { seed: string } {
  return { ...(c.name.trim() ? { name: c.name.trim() } : {}), style: c.style, seed: c.seed ?? `${shopId}-${c.roll}-0`, ...(c.colour ? { colour: c.colour } : {}), personality: c.personality };
}

/**
 * The settings the shop is saved with: the template's own, with the `assistant` block it had before kept as it was (its morning hour, say), and the character from
 * this step when the step was finished. A shop whose Character step was never finished gets nothing new: no assistant is turned on by an edit elsewhere.
 */
export function withCharacter(settings: unknown, c: CharacterDraft | undefined, before: unknown, shopId: string): unknown {
  if (typeof settings !== "object" || settings === null) return settings;
  const prior = (before as { assistant?: unknown } | undefined)?.assistant;
  const priorObj = typeof prior === "object" && prior !== null && !Array.isArray(prior) ? prior as Record<string, unknown> : undefined;
  if (!c?.chosen) return priorObj ? { ...settings, assistant: priorObj } : settings;
  return { ...settings, assistant: { ...(priorObj ?? {}), character: characterSetting(c, shopId) } };
}
