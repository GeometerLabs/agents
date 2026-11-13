// The shop character's renderer and its place on the server (item 11i, decision 47): DiceBear's own drawings from the vendored files only (each checked against
// vendor.json), the same look always the same bytes, every mood of every style different and in all three formats at the right size and within WhatsApp's limits,
// nothing fetched while drawing, and a set drawn once: kept while the look is the same, drawn again when it changes or a file is damaged, copied to the front's
// folder, taken away when the shop has no assistant, and brought back after a restore with the same bytes. A handover writes only assignment.json, so it keeps them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RENDERER, STICKER_MAX_BYTES, drawSvg, fingerprintOf, renderSet, setIsCurrent, writeCharacterSet } from "../character/render.ts";
import type { Look } from "../character/render.ts";
import { CHARACTER_STYLES, EYES_AND_MOUTH, FACES, STYLE_INFO } from "../../modules/assistant/character.ts";
import { CHARACTER_MANIFEST, characterReader, pictureFiles, readCharacterManifest } from "../../modules/channels/character-files.ts";
import { characterDirOf, lookOf, syncCharacters } from "../lib/character.ts";
import { frontCharacterDirOf, frontCharacterVersion, pagesFileFor } from "../lib/pages.ts";

const VENDOR = new URL("../vendor/", import.meta.url);
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const scratch = () => mkdtempSync(join(tmpdir(), "geo-character-"));

/** A PNG's width and height (its IHDR), and a WebP's (its VP8L header: 14 bits each, then the alpha bit). */
const pngSize = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
function webpInfo(b: Buffer): { w: number; h: number; lossless: boolean; alpha: boolean } {
  assert.equal(b.toString("ascii", 0, 4), "RIFF");
  assert.equal(b.toString("ascii", 8, 12), "WEBP");
  const chunk = b.toString("ascii", 12, 16);
  assert.equal(chunk, "VP8L", "lossless WebP");
  assert.equal(b[20], 0x2f);
  const bits = b.readUInt32LE(21);
  return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1, alpha: ((bits >> 28) & 1) === 1, lossless: true };
}

test("every vendored file is the one fetched and recorded: its sha256 in vendor.json, and its licence beside it", () => {
  const v = JSON.parse(readFileSync(new URL("vendor.json", VENDOR), "utf8")) as { packages: Record<string, { version: string; licence: string; integrity: string; files: Record<string, string> }> };
  assert.deepEqual(Object.keys(v.packages).sort(), ["dicebear-core", "dicebear-styles", "resvg-wasm", "webp-encoder"]);
  for (const [dir, p] of Object.entries(v.packages)) {
    assert.match(p.integrity, /^sha512-/u, dir);
    assert.ok(p.licence.length > 0, dir);
    const onDisk: string[] = [];
    const walk = (d: string, rel = "") => { for (const n of readdirSync(d)) { const full = join(d, n); if (statSync(full).isDirectory()) walk(full, `${rel}${n}/`); else onDisk.push(`${rel}${n}`); } };
    walk(new URL(`${dir}/`, VENDOR).pathname);
    assert.deepEqual(onDisk.sort(), Object.keys(p.files).sort(), `${dir}: no file added or missing`);
    for (const [f, want] of Object.entries(p.files)) assert.equal(sha(readFileSync(new URL(`${dir}/${f}`, VENDOR))), want, `${dir}/${f}`);
    assert.ok(Object.keys(p.files).some((f) => /^(LICEN[CS]E|COPYING)/u.test(f)), `${dir}: a licence file`);
  }
  assert.equal(RENDERER["@dicebear/core"], "10.7.0");
  assert.equal(RENDERER["@dicebear/styles"], "10.6.0");
});

test("the five styles are CC0 in their own definitions, and the palettes the panel offers are each style's own first eight", () => {
  for (const s of CHARACTER_STYLES) {
    const def = JSON.parse(readFileSync(new URL(`dicebear-styles/${s}.min.json`, VENDOR), "utf8")) as { meta: { license: { name: string } }; colors: Record<string, { values: string[] }> };
    assert.equal(def.meta.license.name, "CC0 1.0", s);
    assert.deepEqual(def.colors[STYLE_INFO[s].colourOption].values.slice(0, 8).map((c) => c.replace("#", "").toLowerCase()), [...STYLE_INFO[s].palette], s);
    for (const f of FACES) {
      const [eyes, mouth] = EYES_AND_MOUTH[s][f];
      const comps = (def as unknown as { components: Record<string, { variants: Record<string, unknown> }> }).components;
      assert.ok(eyes in comps.eyes.variants && mouth in comps.mouth.variants, `${s} ${f}: ${eyes} + ${mouth} are DiceBear's own`);
    }
  }
});

test("a look is DiceBear's drawing: the same seed gives the same SVG, another seed another, each mood its own face, a colour changes it, and no metadata or filter is added", () => {
  for (const style of CHARACTER_STYLES) {
    const look: Look = { style, seed: `veena-salon-3f2a1c-0` };
    assert.equal(drawSvg(look, "well"), drawSvg(look, "well"), style);
    assert.notEqual(drawSvg(look, "well"), drawSvg({ ...look, seed: "veena-salon-3f2a1c-1" }, "well"), style);
    const moods = FACES.map((f) => drawSvg(look, f));
    assert.equal(new Set(moods).size, 5, `${style}: five different faces`);
    const other = STYLE_INFO[style].palette.find((c) => !drawSvg(look, "well").includes(`#${c}`))!;
    assert.notEqual(drawSvg({ ...look, colour: other }, "well"), drawSvg(look, "well"), `${style}: a swatch changes the drawing`);
    assert.ok(drawSvg({ ...look, colour: other }, "well").includes(`#${other}`));
    for (const svg of moods) {
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u);
      assert.ok(!/<metadata|<filter|<script|zzz/iu.test(svg), `${style}: DiceBear's drawing only`);
      assert.ok(!/bot\b/iu.test(svg.replace(/class="[^"]*"/gu, "").replace(/id="[^"]*"/gu, "").replace(/#[^"]*"/gu, "")), `${style}: no style name left in the file`);
    }
    assert.ok(!/<rect width="100" height="100" fill="#010203"/u.test(drawSvg(look, "well", { tile: false })), "the sticker's clear background is taken out");
  }
  assert.throws(() => drawSvg({ style: "clay", seed: "x", colour: "fda4af" }, "well"), /not one of the Clay colours/u);
  assert.throws(() => drawSvg({ style: "avataaars" as never, seed: "x" }), /no character style/u);
});

test("a set: every mood as SVG, PNG (640 px) and WebP (a 512 px lossless sticker with a clear background, within WhatsApp's 100 KB), the same bytes every time, and nothing fetched", async () => {
  const before = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("the renderer must not fetch anything"); }) as typeof fetch;
  try {
    for (const style of CHARACTER_STYLES) {
      const look: Look = { style, seed: "veena-salon-3f2a1c-0", colour: STYLE_INFO[style].palette[1] };
      const set = await renderSet(look);
      assert.deepEqual([...set.keys()].sort(), pictureFiles().sort(), style);
      for (const f of FACES) {
        const svg = set.get(`${f}.svg`)!, png = set.get(`${f}.png`)!, webp = set.get(`${f}.webp`)!;
        assert.ok(svg.length < 32 * 1024, `${style} ${f}: SVG ${svg.length} bytes`);
        assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        assert.deepEqual(pngSize(png), { w: 640, h: 640 });
        assert.ok(png.length < 100 * 1024, `${style} ${f}: PNG ${png.length} bytes`);
        const info = webpInfo(webp);
        assert.deepEqual([info.w, info.h, info.alpha], [512, 512, true], `${style} ${f}`);
        assert.ok(webp.length <= STICKER_MAX_BYTES && webp.length < 20 * 1024, `${style} ${f}: WebP ${webp.length} bytes`);
      }
      const again = await renderSet(look);
      for (const [name, bytes] of set) assert.ok(bytes.equals(again.get(name)!), `${style} ${name}: the same bytes`);
    }
  } finally { globalThis.fetch = before; }
});

test("a set is drawn once: kept while the look is the same, drawn again for a new colour or a damaged file, with the manifest naming every file", async () => {
  const dir = join(scratch(), "character");
  try {
    const look: Look = { style: "critters", seed: "veena-salon-3f2a1c-2" };
    const first = await writeCharacterSet(dir, look);
    assert.equal(first.drawn, true);
    assert.equal(first.version, fingerprintOf(look).slice(0, 16));
    const m = readCharacterManifest(readFileSync(join(dir, CHARACTER_MANIFEST), "utf8"))!;
    assert.deepEqual(m.look, look);
    assert.deepEqual(m.renderer, RENDERER);
    for (const name of pictureFiles()) assert.equal(sha(readFileSync(join(dir, name))), m.files[name].sha256, name);
    const stamp = statSync(join(dir, "well.png")).mtimeMs;
    assert.deepEqual(await writeCharacterSet(dir, look), { drawn: false, version: first.version }, "the same look: nothing drawn");
    assert.equal(statSync(join(dir, "well.png")).mtimeMs, stamp, "nothing written");
    writeFileSync(join(dir, "busy.webp"), "damaged");
    assert.equal(setIsCurrent(dir, look), false);
    assert.equal((await writeCharacterSet(dir, look)).drawn, true, "a damaged file: drawn again");
    const recoloured = await writeCharacterSet(dir, { ...look, colour: "fda4af" });
    assert.equal(recoloured.drawn, true);
    assert.notEqual(recoloured.version, first.version);
    assert.equal(characterReader(dir)()?.version, recoloured.version);
    assert.deepEqual(readdirSync(join(dir, "..")).filter((n) => n.startsWith(".character")), [], "no half-made folder left beside it");
  } finally { rmSync(join(dir, ".."), { recursive: true, force: true }); }
});

test("on the server: the deployer draws from the settings, hands the front a copy and pages.json the version, takes it away with the assistant, and a restore gets the same bytes", async () => {
  const server = scratch();
  try {
    const shopDir = join(server, "shops", "veena");
    mkdirSync(shopDir, { recursive: true });
    const settings = (assistant?: unknown) => writeFileSync(join(shopDir, "settings.json"), JSON.stringify({ name: "Veena Salon", ...(assistant ? { assistant } : {}) }));
    settings({ character: { name: "Mithra", style: "moods", seed: "veena-3f2a1c-1", personality: "brief" } });
    assert.deepEqual(lookOf(JSON.parse(readFileSync(join(shopDir, "settings.json"), "utf8")), "veena"), { style: "moods", seed: "veena-3f2a1c-1" });
    assert.deepEqual(lookOf({ assistant: {} }, "veena"), { style: "clay", seed: "veena" }, "an assistant with no character: Clay, seeded with the shop's id");
    assert.equal(lookOf({}, "veena"), undefined);
    // the front's folder exists once the shop is deployed (the deployer made it for its secrets)
    mkdirSync(join(frontCharacterDirOf(server, "veena"), ".."), { recursive: true });
    const lines = await syncCharacters({ dir: server, shops: ["veena"] });
    assert.ok(lines.some((l) => /drawn/u.test(l)) && lines.some((l) => /handed to the front/u.test(l)), lines.join(" | "));
    const version = frontCharacterVersion(server, "veena")!;
    assert.match(version, /^[0-9a-f]{16}$/u);
    const own = readFileSync(join(characterDirOf(server, "veena"), "needs.png"));
    assert.ok(own.equals(readFileSync(join(frontCharacterDirOf(server, "veena"), "needs.png"))), "the front's copy is the shop's set");
    assert.deepEqual(await syncCharacters({ dir: server, shops: ["veena"] }), [], "nothing changed: nothing to say");
    const pages = pagesFileFor({ domain: "partners.example", ports: { https: 443 }, panel: { enabled: false } } as never, "veena", { pages: "own" }, undefined, version);
    assert.deepEqual(pages.character, { version });
    // a restore that brought back the settings but not the pictures: the next pass draws the very same files
    rmSync(characterDirOf(server, "veena"), { recursive: true, force: true });
    await syncCharacters({ dir: server, shops: ["veena"] });
    assert.ok(readFileSync(join(characterDirOf(server, "veena"), "needs.png")).equals(own), "the same bytes back");
    // the assistant turned off: the page shows no face
    settings(undefined);
    assert.ok((await syncCharacters({ dir: server, shops: ["veena"] })).some((l) => /no character/u.test(l)));
    assert.equal(existsSync(frontCharacterDirOf(server, "veena")), false);
    assert.equal(frontCharacterVersion(server, "veena"), undefined);
  } finally { rmSync(server, { recursive: true, force: true }); }
});
