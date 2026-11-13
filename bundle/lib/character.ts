// The shop's character on the server (plan item 11i, decision 47): the deployer's side. Used by the deployer's loop (apply.ts runCharacters, just before the pages
// pass) and by the panel when the partner saves the Character step (panel/server.ts).
//
//   shops/<shop>/settings.json         `assistant.character`: the look (style, seed, colour), the name and the personality (the panel's Character step writes it)
//   shops/<shop>/character/            the shop's own pictures: every mood as SVG, PNG and WebP, and character.json (render.ts), drawn when the look changes
//   secrets/inbox/<shop>/character/    the copy the inbox's front serves from (modules/channels/character-files.ts), beside the shop's pages.json
//   pages.json (two copies)            `character.version`: the drawn set's version, so the runtime can link to the pictures (lib/pages.ts writes it)
//
// The set lives with the shop's own data, so a handover (which writes only assignment.json) keeps it. A restore that brings back the shop's settings but not the
// folder gets the same pictures back on the next pass, because a look always draws the same bytes. A shop whose settings have no `assistant` block has no
// character: its pictures are not drawn, and the front's copy is taken away, so its page shows no face.
import { cpSync, existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { readAssistantSettings } from "../../modules/assistant/settings.ts";
import { seedOf } from "../../modules/assistant/character.ts";
import { CHARACTER_DIR, CHARACTER_MANIFEST, readCharacterManifest } from "../../modules/channels/character-files.ts";
import type { CharacterManifest } from "../../modules/channels/character-files.ts";
import { writeCharacterSet } from "../character/render.ts";
import type { Look } from "../character/render.ts";
import { frontCharacterDirOf } from "./pages.ts";
import { serverPaths } from "./server.ts";

/** The shop's own pictures, and the front's copy of them. */
export const characterDirOf = (dir: string, shop: string): string => join(serverPaths(dir).shop(shop), CHARACTER_DIR);

/** The look a shop's settings give, or undefined when they turn no assistant on (or cannot be read). The seed is the shop's id when the settings name none. */
export function lookOf(settings: unknown, shop: string): Look | undefined {
  const assistant = typeof settings === "object" && settings !== null ? (settings as { assistant?: unknown }).assistant : undefined;
  const a = readAssistantSettings(assistant, []);
  if (!a) return undefined;
  const c = a.character;
  return { style: c.style, seed: seedOf(c, shop), ...(c.colour ? { colour: c.colour } : {}) };
}

/** Draw the shop's set if its look changed (or the set is missing or damaged). Nothing is drawn for a shop with no assistant. */
export async function ensureShopCharacter(dir: string, shop: string, settings: unknown): Promise<{ drawn: boolean; version: string } | undefined> {
  const look = lookOf(settings, shop);
  return look ? writeCharacterSet(characterDirOf(dir, shop), look) : undefined;
}

const manifestIn = (folder: string): CharacterManifest | undefined => { try { return readCharacterManifest(readFileSync(join(folder, CHARACTER_MANIFEST), "utf8")); } catch { return undefined; } };

/**
 * One pass, for each deployed shop: draw its set when its look changed, and give the front a copy of it when the copy differs (or take the copy away when the shop has
 * no character any more). Only into a front folder that exists (a shop not deployed yet has none). A problem is a line for the log, and the next pass tries again.
 */
export async function syncCharacters(o: { dir: string; shops: readonly string[] }): Promise<string[]> {
  const lines: string[] = [];
  for (const shop of o.shops) {
    let settings: unknown;
    try { settings = JSON.parse(readFileSync(join(serverPaths(o.dir).shop(shop), "settings.json"), "utf8")); } catch { continue; }
    const front = frontCharacterDirOf(o.dir, shop);
    try {
      const drawn = await ensureShopCharacter(o.dir, shop, settings);
      if (!drawn) {
        if (existsSync(front)) { rmSync(front, { recursive: true, force: true }); lines.push(`${shop}: it has no assistant now, so its page shows no character.`); }
        continue;
      }
      if (drawn.drawn) lines.push(`${shop}: its character's pictures were drawn (version ${drawn.version}).`);
      if (!existsSync(dirname(front)) || manifestIn(front)?.fingerprint === manifestIn(characterDirOf(o.dir, shop))?.fingerprint) continue;
      // the copy is made beside the old one and moved into place whole, so the front serves the old set or the new one, never half of each
      const fresh = join(dirname(front), `.${CHARACTER_DIR}-${randomBytes(6).toString("hex")}`);
      cpSync(characterDirOf(o.dir, shop), fresh, { recursive: true });
      const old = existsSync(front) ? `${fresh}-old` : undefined;
      if (old) renameSync(front, old);
      renameSync(fresh, front);
      if (old) rmSync(old, { recursive: true, force: true });
      lines.push(`${shop}: its character's pictures are handed to the front.`);
    } catch (e) {
      lines.push(`${shop}: its character's pictures could not be drawn or handed over (${(e as Error).message}); tried again next pass.`);
    }
  }
  return lines;
}
