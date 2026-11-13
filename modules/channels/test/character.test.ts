// The shop's character as its own server serves it (item 11i): every mood's picture at a stable address with an ETag and a cache life, `now` as the mood the
// PUBLIC sees (never "needs you" or "something wrong"), a picture changed behind the manifest's back refused, the shop's page head showing the public face with its
// mood in words, and the owner's app showing the real mood. The set here is made by hand (any bytes do: the front serves files, it draws nothing); the renderer's
// own tests are in the bundle (bundle/test/character-render.test.ts).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frontHandler } from "../front.ts";
import type { ChannelBackend, Offer, OwnerView } from "../backend.ts";
import { CHARACTER_MANIFEST, characterReader, pictureFiles, readCharacterManifest, svgDataUri } from "../character-files.ts";
import type { Face } from "../../assistant/character.ts";
import { readPagesFile, picturesOf } from "../pages-file.ts";

const dir = mkdtempSync(join(tmpdir(), "character-front-"));
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); rmSync(dir, { recursive: true, force: true }); });

const SERVER = "https://partners.example/s/veena";
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const svgOf = (face: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>${face}</title><circle cx="50" cy="50" r="40" fill="#fda4af"/></svg>`;

/** A complete set by hand, as render.ts writes one: the files, then the manifest. */
function writeSet(folder: string): string {
  mkdirSync(folder, { recursive: true });
  const files: Record<string, { bytes: number; sha256: string }> = {};
  for (const name of pictureFiles()) {
    const [face, ext] = name.split(".");
    const bytes = Buffer.from(ext === "svg" ? svgOf(face) : `${ext}:${face}`);
    writeFileSync(join(folder, name), bytes);
    files[name] = { bytes: bytes.length, sha256: sha(bytes) };
  }
  const fingerprint = sha("veena-look");
  writeFileSync(join(folder, CHARACTER_MANIFEST), JSON.stringify({ schema: 1, version: fingerprint.slice(0, 16), fingerprint, look: { style: "critters", seed: "veena-3f2a1c-0" }, renderer: { "@dicebear/core": "10.7.0" }, files }));
  return fingerprint.slice(0, 16);
}

const OFFER = (face: Face): Offer => ({
  shop: { name: "Veena Salon", timezone: "Asia/Kolkata", languages: ["en", "hi"], deposit: { amountInr: 100, holdMinutes: 60 }, cancellation: { windowHours: 24 }, payment: { kind: "upi", payee: "Veena" }, paused: false, character: { face } },
  services: [{ id: "haircut", names: { en: "Haircut", hi: "हेयरकट", ml: "ഹെയർകട്ട്", kn: "ಹೇರ್‌ಕಟ್" }, priceInr: 300, durationMinutes: 30 }],
});

async function shop(o: { face?: Face; set?: boolean } = {}) {
  const folder = join(dir, `set-${Math.random().toString(36).slice(2)}`);
  const version = o.set === false ? undefined : writeSet(folder);
  let asked = 0;
  const owner: OwnerView = {
    shop: { name: "Veena Salon", timezone: "Asia/Kolkata", ownerLanguage: "en" }, services: [], items: [], upcoming: [],
    app: { character: { name: "Asha", style: "critters", personality: "warm" }, mood: "something_wrong", face: "wrong", closedToday: false, today: [], waiting: [], cards: [], talk: [] },
  };
  const backend: ChannelBackend = { offer: async () => { asked++; return OFFER(o.face ?? "busy"); }, submit: async () => "saved", view: async () => null, owner: async () => owner };
  const server = createServer(frontHandler({ shops: { veena: { publicUrl: SERVER, backend, character: characterReader(folder) } }, waitMs: 10 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { folder, version, asked: () => asked, get: (path: string, headers: Record<string, string> = {}) => fetch(`${url}${path}`, { headers, redirect: "manual" }), head: (path: string) => fetch(`${url}${path}`, { method: "HEAD" }) };
}

test("each mood's picture in each format at a stable address: its type, a day's cache, its sha256 as the ETag, a strict policy, readable from any site; 304 when unchanged", async () => {
  const s = await shop();
  for (const [ext, type] of [["svg", "image/svg+xml"], ["png", "image/png"], ["webp", "image/webp"]] as const) {
    const r = await s.get(`/s/veena/character/needs.${ext}?v=${s.version}`);
    assert.equal(r.status, 200, ext);
    assert.equal(r.headers.get("content-type"), type);
    assert.equal(r.headers.get("cache-control"), "public, max-age=86400");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.match(r.headers.get("content-security-policy") ?? "", /^default-src 'none'/u);
    const body = Buffer.from(await r.arrayBuffer());
    assert.equal(r.headers.get("etag"), `"${sha(body).slice(0, 32)}"`);
    const again = await s.get(`/s/veena/character/needs.${ext}`, { "if-none-match": r.headers.get("etag")! });
    assert.equal(again.status, 304);
    assert.equal((await again.arrayBuffer()).byteLength, 0);
  }
  const head = await s.head("/s/veena/character/well.png");
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal((await s.get("/s/veena/character/happy.svg")).status, 404, "only the five moods");
  assert.equal((await s.get("/s/veena/character/well.gif")).status, 404, "only the three formats");
  assert.equal(s.asked(), 0, "a fixed mood never asks the runtime");
});

test("now.<format> is the mood the public sees, asked of the runtime, cached a minute", async () => {
  const s = await shop({ face: "closed" });
  const r = await s.get("/s/veena/character/now.svg");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "public, max-age=60");
  assert.match(await r.text(), /<title>closed<\/title>/u);
  assert.equal(s.asked(), 1);
});

test("a picture changed behind the manifest's back is not served, and a shop with no set has none", async () => {
  const s = await shop();
  writeFileSync(join(s.folder, "well.svg"), "<svg>something else</svg>");
  assert.equal((await s.get("/s/veena/character/well.svg")).status, 404);
  assert.equal((await s.get("/s/veena/character/busy.svg")).status, 200, "the others still are");
  const none = await shop({ set: false });
  assert.equal((await none.get("/s/veena/character/well.svg")).status, 404);
  assert.equal((await none.get("/s/veena/character/now.svg")).status, 404);
});

test("the shop's page head shows the public face as a data: picture, with the shop and the mood in words (alt and beside it), no character name unless one was given, and still no script", async () => {
  const s = await shop({ face: "busy" });
  const en = await (await s.get("/s/veena/", { "accept-language": "en" })).text();
  assert.ok(en.includes(`src="${svgDataUri(svgOf("busy")).replace(/&/gu, "&amp;")}"`), "the busy picture, inline");
  assert.match(en, /alt="Veena Salon(&#39;|')s assistant, busy"/u);
  assert.match(en, /Veena Salon(&#39;|')s assistant · Busy/u, "the mood in words beside it");
  assert.ok(!/<script/iu.test(en));
  const hi = await (await s.get("/s/veena/?lang=hi")).text();
  assert.match(hi, /व्यस्त/u, "in the visitor's language");
});

test("the owner's app shows the owner's real mood (something wrong) with its words, and the character's name when the partner gave one; the public page never shows that mood", async () => {
  const s = await shop({ face: "well" });
  const page = await (await s.get("/s/veena/o/abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456")).text();
  assert.ok(page.includes(svgDataUri(svgOf("wrong")).replace(/&/gu, "&amp;").slice(0, 60)), "the wrong picture");
  assert.match(page, /alt="Asha, Veena Salon(&#39;|')s assistant, something wrong"/u);
  assert.match(page, /<b>Asha, Veena Salon(&#39;|')s assistant<\/b> · Something wrong/u);
  const pub = await (await s.get("/s/veena/")).text();
  assert.ok(!/Something wrong|Needs you/u.test(pub));
});

test("pages.json hands the runtime the set's version; WhatsApp's links are the shop's own server's, never the door's", () => {
  const p = readPagesFile(JSON.stringify({ schema: 1, base: SERVER, ownerBase: `${SERVER}/owner`, slug: "veena-salon", url: "https://pages.example/veena-salon", character: { version: "0123456789abcdef" } }));
  assert.deepEqual(picturesOf(p), { base: SERVER, version: "0123456789abcdef" }, "even with a page on the pages domain");
  assert.deepEqual(picturesOf(readPagesFile(JSON.stringify({ schema: 1, base: SERVER, ownerBase: `${SERVER}/owner`, character: { version: "0123456789abcdef" } }))), { base: SERVER, version: "0123456789abcdef" });
  assert.equal(picturesOf(readPagesFile(JSON.stringify({ schema: 1, base: SERVER, ownerBase: `${SERVER}/owner`, character: { version: "../x" } }))), undefined, "a version that is not 16 hex digits is not read");
  assert.equal(readCharacterManifest("{}"), undefined);
});

test("an Orders shop and a Fees centre show the same public face in their page heads, and now.<format> works for them", async () => {
  const base = { name: "Annapurna Tiffins", timezone: "Asia/Kolkata", languages: ["en"] as ("en")[], payment: { kind: "upi" as const, payee: "Annapurna" }, paused: false, character: { face: "closed" as Face } };
  const orders = { kind: "orders" as const, shop: { ...base, advance: { mode: "full" as const, percent: 100, holdMinutes: 30 }, cancellation: { windowHours: 12 } }, items: [], days: [], maxItemsPerOrder: 10 };
  const fees = { kind: "fees" as const, shop: { ...base, name: "Bright Tuition" } };
  for (const [kind, offer] of [["orders", orders], ["fees", fees]] as const) {
    const folder = join(dir, `set-${kind}`);
    writeSet(folder);
    const backend: ChannelBackend = { offer: async () => offer as never, orderOffer: async () => orders, feesOffer: async () => fees, submit: async () => "saved", view: async () => null, owner: async () => null, parentView: async () => null, feeConfirmView: async () => null } as ChannelBackend;
    const server = createServer(frontHandler({ shops: { x: { publicUrl: "https://partners.example/s/x", backend, kind, character: characterReader(folder) } }, waitMs: 10 }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    servers.push(server);
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const page = await (await fetch(`${url}/s/x/`)).text();
    assert.ok(page.includes(svgDataUri(svgOf("closed")).replace(/&/gu, "&amp;").slice(0, 60)), `${kind}: the closed picture in the head`);
    assert.match(page, new RegExp(`alt="${offer.shop.name}(&#39;|')s assistant, closed"`, "u"), kind);
    const now = await fetch(`${url}/s/x/character/now.svg`);
    assert.equal(now.status, 200, kind);
    assert.match(await now.text(), /<title>closed<\/title>/u, kind);
  }
});
