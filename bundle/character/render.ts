// The shop character's renderer (plan item 11i, decision 47): DiceBear's own drawings of a shop's character in each of its five moods, made on the shop's own server
// and saved with the shop as SVG (for pages), PNG (WhatsApp's profile photo and the morning template's image header) and WebP (WhatsApp stickers).
// Used by the panel (its Character step's previews, and the set it saves with the shop) and by the deployer (lib/character.ts draws a set again when the settings
// changed by hand, or the set went missing after a restore).
//
// Everything runs here, from files in bundle/vendor (vendor.json lists each with its sha256 and licence): nothing is fetched from DiceBear's service or anywhere else.
//  - DiceBear core 10.7.0 (MIT) with the five approved style definitions from @dicebear/styles 10.6.0 (CC0 1.0). The look is DiceBear's own: shape, top, details,
//    palette and tile come from the seed, eyes and mouth from the approved mood table (modules/assistant/character.ts), and a swatch changes one colour. Owner,
//    14 Nov: no filters and no hand-drawn additions. The SVG is DiceBear's output with its <metadata> block taken out (its licence notice, which CC0 does not ask
//    for, and a style name the product's words never use); the drawing is untouched.
//  - resvg (MPL-2.0) compiled to WebAssembly turns the SVG into pixels and PNG; libwebp (BSD) compiled to WebAssembly by jSquash (Apache-2.0) encodes the WebP.
//    Why these (bundle/Explanation.md, "The character's renderer"): no native parts, so the same files run in every container and on the host's Node with no
//    build step; together about 2.8 MB of WebAssembly, loaded only when a set is drawn; resvg draws DiceBear's paths, clips and opacities exactly; the WebP is
//    lossless, so a sticker is crisp and a few KB.
// The same look always gives the same bytes: DiceBear's ids are fixed (idRandomization off), resvg is deterministic, and libwebp's lossless encoder runs in one
// thread. A set's fingerprint is the look and the renderer's versions, so it is drawn once, and again only when either changes.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Avatar, Style } from "../vendor/dicebear-core/lib/index.js";
import { CHARACTER_STYLES, EYES_AND_MOUTH, FACES, PICTURE_FORMATS, STYLE_INFO } from "../../modules/assistant/character.ts";
import type { CharacterStyle, Face, PictureFormat } from "../../modules/assistant/character.ts";
import { CHARACTER_MANIFEST, pictureFiles, readCharacterManifest } from "../../modules/channels/character-files.ts";
import type { CharacterManifest } from "../../modules/channels/character-files.ts";

const VENDOR = new URL("../vendor/", import.meta.url);
const vendorFile = (path: string): Buffer => readFileSync(new URL(path, VENDOR));

/** What drew a set: the vendored packages' versions, and this file's layout (sizes, margins). A change to either draws every set again. */
export const RENDERER: Record<string, string> = (() => {
  const v = JSON.parse(vendorFile("vendor.json").toString("utf8")) as { packages: Record<string, { package: string; version: string }> };
  return { ...Object.fromEntries(Object.values(v.packages).map((p) => [p.package, p.version])), layout: "1" };
})();

/** The sizes each format is drawn at. PNG: 640 px, the profile photo size WhatsApp shows best. WebP: WhatsApp's sticker size, 512 px with a 16 px clear margin. */
export const SIZES = { png: 640, sticker: 512, stickerMargin: 16 } as const;
/** WhatsApp's limit for a static sticker (Meta's sticker-messages page); a set over it is refused rather than sent. */
export const STICKER_MAX_BYTES = 100 * 1024;

/** A look: what a picture depends on. The name and the personality are not here: changing them draws nothing again. */
export interface Look { style: CharacterStyle; seed: string; colour?: string }

const styles = new Map<CharacterStyle, Style>();
/** One DiceBear Style per definition, made on first use (building it checks the whole definition, the slow part). */
function styleOf(id: CharacterStyle): Style {
  let s = styles.get(id);
  if (!s) {
    s = new Style(JSON.parse(vendorFile(`dicebear-styles/${id}.min.json`).toString("utf8")));
    styles.set(id, s);
  }
  return s;
}

/** A background colour no style uses: drawn, then taken out again, for the sticker's clear background (DiceBear has no "none" for it). */
const CLEAR = "010203";

/**
 * DiceBear's drawing of a look: in a mood (its approved eyes and mouth), or with no mood for the panel's strip (the seed's own face). `tile: false` leaves out the
 * background tile (stickers). Throws on a look outside the approved styles and palettes.
 */
export function drawSvg(look: Look, face?: Face, o: { tile?: boolean } = {}): string {
  if (!(CHARACTER_STYLES as readonly string[]).includes(look.style)) throw new Error(`There is no character style "${look.style}".`);
  const info = STYLE_INFO[look.style];
  if (look.colour !== undefined && !info.palette.includes(look.colour)) throw new Error(`"${look.colour}" is not one of the ${info.name} colours.`);
  const options: Record<string, unknown> = { seed: look.seed, idRandomization: false };
  if (face) { const [eyes, mouth] = EYES_AND_MOUTH[look.style][face]; options.eyesVariant = [eyes]; options.mouthVariant = [mouth]; }
  if (look.colour) options[`${info.colourOption}Color`] = [look.colour];
  if (o.tile === false) options.backgroundColor = [CLEAR];
  let svg = new Avatar(styleOf(look.style), options as never).toString().replace(/<metadata[\s>][\s\S]*?<\/metadata>/u, "");
  if (o.tile === false) {
    const before = svg;
    svg = svg.replace(new RegExp(`<rect [^>]*fill="#${CLEAR}"[^>]*/>`, "u"), "");
    if (svg === before) throw new Error("The sticker's background could not be taken out.");
  }
  return svg;
}

// ---- the WebAssembly parts, loaded once and only when pixels are needed ----------------------------------------------------------------------------------------

interface Raster { svgToPixels(svg: string, width: number): { png: Buffer; pixels: Uint8Array; width: number; height: number }; webp(pixels: Uint8Array, width: number, height: number): Buffer }
let raster: Promise<Raster> | undefined;

/** resvg and libwebp, from the vendored files. Their JavaScript glue is plain ES modules; the WebAssembly is handed over as bytes, so nothing is fetched. */
function loadRaster(): Promise<Raster> {
  raster ??= (async () => {
    const resvg = await import(new URL("resvg-wasm/index.mjs", VENDOR).href) as { initWasm(m: BufferSource): Promise<void>; Resvg: new (svg: string, o: unknown) => { render(): { asPng(): Uint8Array; pixels: Uint8Array; width: number; height: number; free?(): void }; free?(): void } };
    await resvg.initWasm(vendorFile("resvg-wasm/index_bg.wasm"));
    const factory = (await import(new URL("webp-encoder/webp_enc.js", VENDOR).href) as { default: (o: unknown) => Promise<{ encode(data: Uint8Array, w: number, h: number, o: Record<string, number>): Uint8Array | null }> }).default;
    const webp = await factory({ wasmBinary: vendorFile("webp-encoder/webp_enc.wasm"), noInitialRun: true });
    return {
      svgToPixels(svg, width) {
        const r = new resvg.Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } });
        const img = r.render();
        const out = { png: Buffer.from(img.asPng()), pixels: new Uint8Array(img.pixels), width: img.width, height: img.height };
        img.free?.(); r.free?.();
        return out;
      },
      webp(pixels, width, height) {
        // libwebp's own defaults (jSquash's meta.ts), lossless; `exact` keeps the colour under clear pixels, so the edges stay as resvg drew them
        const out = webp.encode(pixels, width, height, { ...WEBP_DEFAULTS, lossless: 1, quality: 75, method: 4, exact: 1 });
        if (!out) throw new Error("The WebP encoder gave nothing back.");
        return Buffer.from(out);
      },
    };
  })();
  return raster;
}

/** libwebp's WebPConfig fields with their defaults, as jSquash's encoder takes them (its meta.ts). */
const WEBP_DEFAULTS: Record<string, number> = {
  quality: 75, target_size: 0, target_PSNR: 0, method: 4, sns_strength: 50, filter_strength: 60, filter_sharpness: 0, filter_type: 1, partitions: 0, segments: 4, pass: 1,
  show_compressed: 0, preprocessing: 0, autofilter: 0, partition_limit: 0, alpha_compression: 1, alpha_filtering: 1, alpha_quality: 100, lossless: 0, exact: 0, image_hint: 0,
  emulate_jpeg_size: 0, thread_level: 0, low_memory: 0, near_lossless: 100, use_delta_palette: 0, use_sharp_yuv: 0,
};

/** The sticker's page: DiceBear's drawing without its tile, inside a 512 px square with a clear margin (WhatsApp's sticker shape). */
const stickerSvg = (look: Look, face: Face): string => {
  const inner = drawSvg(look, face, { tile: false }).replace(/^<svg /u, `<svg x="${SIZES.stickerMargin}" y="${SIZES.stickerMargin}" width="${SIZES.sticker - 2 * SIZES.stickerMargin}" height="${SIZES.sticker - 2 * SIZES.stickerMargin}" `);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZES.sticker} ${SIZES.sticker}" width="${SIZES.sticker}" height="${SIZES.sticker}">${inner}</svg>`;
};

/** Every mood of a look, in the three formats: file name to bytes (character-files.ts pictureFiles names them). */
export async function renderSet(look: Look): Promise<Map<string, Buffer>> {
  const r = await loadRaster();
  const out = new Map<string, Buffer>();
  for (const face of FACES) {
    const svg = drawSvg(look, face);
    out.set(`${face}.svg`, Buffer.from(svg, "utf8"));
    out.set(`${face}.png`, r.svgToPixels(svg, SIZES.png).png);
    const s = r.svgToPixels(stickerSvg(look, face), SIZES.sticker);
    const webp = r.webp(s.pixels, s.width, s.height);
    if (webp.length > STICKER_MAX_BYTES) throw new Error(`The ${face} sticker came out at ${webp.length} bytes, over WhatsApp's ${STICKER_MAX_BYTES} for a sticker.`);
    out.set(`${face}.webp`, webp);
  }
  return out;
}

/** The fingerprint of a set: the look and what draws it. */
export function fingerprintOf(look: Look): string {
  return createHash("sha256").update(JSON.stringify({ look: { style: look.style, seed: look.seed, ...(look.colour ? { colour: look.colour } : {}) }, renderer: RENDERER })).digest("hex");
}

/** Is the set in `dir` this look's, whole and unchanged? (Its manifest's fingerprint, and every file's sha256.) */
export function setIsCurrent(dir: string, look: Look): boolean {
  let m: CharacterManifest | undefined;
  try { m = readCharacterManifest(readFileSync(join(dir, CHARACTER_MANIFEST), "utf8")); } catch { return false; }
  if (!m || m.fingerprint !== fingerprintOf(look)) return false;
  return pictureFiles().every((name) => {
    try { return createHash("sha256").update(readFileSync(join(dir, name))).digest("hex") === m!.files[name].sha256; } catch { return false; }
  });
}

/**
 * Draw a look's set into `dir` (shops/<shop>/character), unless the set there is already this look's: then nothing is drawn or written ("kept"). A new set is drawn
 * into a folder beside it and moved into place whole, with the manifest written last inside it, so a reader sees the old set or the new one, never half of each.
 */
export async function writeCharacterSet(dir: string, look: Look): Promise<{ drawn: boolean; version: string }> {
  const fingerprint = fingerprintOf(look);
  const version = fingerprint.slice(0, 16);
  if (setIsCurrent(dir, look)) return { drawn: false, version };
  const files = await renderSet(look);
  const parent = dirname(dir);
  mkdirSync(parent, { recursive: true });
  const fresh = join(parent, `.character-${randomBytes(6).toString("hex")}`);
  mkdirSync(fresh, { mode: 0o755 });
  try {
    const manifest: CharacterManifest = { schema: 1, version, fingerprint, look: { style: look.style, seed: look.seed, ...(look.colour ? { colour: look.colour } : {}) }, renderer: RENDERER, files: {} };
    for (const [name, bytes] of files) {
      writeFileSync(join(fresh, name), bytes, { mode: 0o644 });
      manifest.files[name] = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    }
    writeFileSync(join(fresh, CHARACTER_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
    const old = existsSync(dir) ? join(parent, `.character-old-${randomBytes(6).toString("hex")}`) : undefined;
    if (old) renameSync(dir, old);
    renameSync(fresh, dir);
    if (old) rmSync(old, { recursive: true, force: true });
  } catch (e) {
    rmSync(fresh, { recursive: true, force: true });
    throw e;
  }
  return { drawn: true, version };
}

export { FACES, PICTURE_FORMATS };
export type { Face, PictureFormat };
