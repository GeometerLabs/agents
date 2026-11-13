// The shop's character pictures as its own server keeps them (item 11i, decision 47): one folder, `character/`, with every mood drawn as SVG, PNG and WebP and a
// small manifest, `character.json`, written LAST so a reader never sees half a set. bundle/character/render.ts draws and writes the folder into the shop's own data
// (shops/<shop>/character/, when the partner saves the Character step, or when the deployer finds the settings changed); the deployer hands a copy to the inbox's
// folder for the shop, beside pages.json (bundle/lib/character.ts). This file is the one shape both sides agree on, and the reader the public front uses
// (front.ts serves <base>/character/<face>.<format>), so modules never import the bundle.
//
// Nothing in it is secret: the pictures are public by design (the shop's face). Each file's sha256 is in the manifest; the reader checks it before serving, so a file
// changed or cut short behind the manifest's back is not served, and the same sha256 is the file's ETag.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHARACTER_STYLES, FACES, PICTURE_FORMATS } from "../assistant/character.ts";
import type { CharacterStyle, Face, PictureFormat } from "../assistant/character.ts";

export const CHARACTER_DIR = "character";
export const CHARACTER_MANIFEST = "character.json";

/** The content type each format is served with. */
export const PICTURE_TYPES: Record<PictureFormat, string> = { svg: "image/svg+xml", png: "image/png", webp: "image/webp" };

/** Every file a complete set holds: five moods in three formats. */
export const pictureFiles = (): string[] => FACES.flatMap((f) => PICTURE_FORMATS.map((x) => `${f}.${x}`));

export interface CharacterManifest {
  schema: 1;
  /** The first 16 hex digits of `fingerprint`: the `?v=` of every link, so a new set is a new address and no cache shows an old face. */
  version: string;
  /** sha256 of what the pictures depend on: the look (style, seed, colour) and the renderer's versions. The same fingerprint is never drawn twice. */
  fingerprint: string;
  look: { style: CharacterStyle; seed: string; colour?: string };
  /** What drew them (bundle/vendor/vendor.json): recorded, so a set drawn by another version is drawn again. */
  renderer: Record<string, string>;
  files: Record<string, { bytes: number; sha256: string }>;
}

const HEX = (n: number) => new RegExp(`^[0-9a-f]{${n}}$`, "u");
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The manifest, checked field by field; undefined when it is missing, unreadable or not a complete set. */
export function readCharacterManifest(text: string | undefined): CharacterManifest | undefined {
  if (text === undefined) return undefined;
  let m: unknown;
  try { m = JSON.parse(text); } catch { return undefined; }
  if (!isObj(m) || m.schema !== 1 || typeof m.version !== "string" || !HEX(16).test(m.version) || typeof m.fingerprint !== "string" || !HEX(64).test(m.fingerprint)) return undefined;
  if (!m.fingerprint.startsWith(m.version) || !isObj(m.look) || !(CHARACTER_STYLES as readonly unknown[]).includes(m.look.style) || typeof m.look.seed !== "string") return undefined;
  if (!isObj(m.files) || !isObj(m.renderer)) return undefined;
  const files: CharacterManifest["files"] = {};
  for (const name of pictureFiles()) {
    const f = m.files[name];
    if (!isObj(f) || typeof f.bytes !== "number" || !Number.isSafeInteger(f.bytes) || f.bytes <= 0 || typeof f.sha256 !== "string" || !HEX(64).test(f.sha256)) return undefined;
    files[name] = { bytes: f.bytes, sha256: f.sha256 };
  }
  const look = { style: m.look.style as CharacterStyle, seed: m.look.seed, ...(typeof m.look.colour === "string" ? { colour: m.look.colour } : {}) };
  return { schema: 1, version: m.version, fingerprint: m.fingerprint, look, renderer: Object.fromEntries(Object.entries(m.renderer).filter(([, v]) => typeof v === "string")) as Record<string, string>, files };
}

/** One picture, ready to serve. */
export interface Picture { bytes: Buffer; sha256: string; type: string }
export interface CharacterFiles { version: string; picture(face: Face, format: PictureFormat): Picture | undefined }

/**
 * A reader over a shop's `character/` folder, asked on every request (the manifest is a few hundred bytes, a picture a few KB), so a new set is served as soon as
 * the deployer's copy lands. Undefined when the folder has no complete set.
 */
export const characterReader = (dir: string): (() => CharacterFiles | undefined) => () => {
  let text: string | undefined;
  try { text = readFileSync(join(dir, CHARACTER_MANIFEST), "utf8"); } catch { return undefined; }
  const m = readCharacterManifest(text);
  if (!m) return undefined;
  return {
    version: m.version,
    picture(face, format) {
      const name = `${face}.${format}`;
      const want = m.files[name];
      if (!want) return undefined;
      let bytes: Buffer;
      try { bytes = readFileSync(join(dir, name)); } catch { return undefined; }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      return sha256 === want.sha256 ? { bytes, sha256, type: PICTURE_TYPES[format] } : undefined;
    },
  };
};

/** A picture as a `data:` address, for a page whose content policy loads images only from data (front.ts PAGE_POLICY): the SVG, percent-encoded where it must be. */
export const svgDataUri = (svg: Buffer | string): string =>
  `data:image/svg+xml,${String(svg).replace(/[\r\n%#<>"]/gu, (c) => encodeURIComponent(c))}`;
