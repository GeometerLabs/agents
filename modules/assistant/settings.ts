// The `assistant` block of a shop's settings (item 11e): whether the shop's assistant is on, when the morning line goes, and the character. Each template's settings
// check (templates/<...>/src/settings.ts) hands the block here, so the three templates read it the same way. Left out of a shop's settings: no assistant, and the
// owner's fixed phrases work exactly as before (the agent answers anything else with its usual "I didn't understand").
//
//   "assistant": { "morning": { "at": "08:00" } | false, "character": { "name": "Mithra", "look": { ... }, "voice": "warm" } }
import { readCharacter, defaultCharacter } from "./character.ts";
import type { Character } from "./character.ts";

export interface AssistantSettings {
  /** The morning line: from this local time ("08:00"), once a day; null for none. */
  morningAt: { hour: number; minute: number } | null;
  character: Character;
}

/** When the morning line goes when the settings say nothing: 08:00, before most shops open and after the night's webhooks are in. */
export const DEFAULT_MORNING = { hour: 8, minute: 0 };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The block, checked. Undefined when it is left out (the assistant is off). Problems are plain sentences, added to `errors`. */
export function readAssistantSettings(raw: unknown, errors: string[]): AssistantSettings | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) { errors.push('"assistant" must be an object (it may be empty: {} turns the shop\'s assistant on with its defaults).'); return undefined; }
  for (const k of Object.keys(raw)) if (!["morning", "character"].includes(k)) errors.push(`"assistant" has "${k}", which is not a setting (morning, character).`);
  let morningAt: AssistantSettings["morningAt"] = DEFAULT_MORNING;
  if (raw.morning === false) morningAt = null;
  else if (raw.morning !== undefined) {
    const at = isObj(raw.morning) ? raw.morning.at : undefined;
    const m = typeof at === "string" ? /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(at) : null;
    if (!m) errors.push('"assistant.morning" must be {"at": "HH:MM"} (24-hour, the shop\'s time) or false for no morning line.');
    else morningAt = { hour: Number(m[1]), minute: Number(m[2]) };
  }
  const character = readCharacter(raw.character, errors) ?? defaultCharacter();
  return { morningAt, character };
}
