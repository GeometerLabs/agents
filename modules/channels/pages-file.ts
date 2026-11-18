// A shop's page addresses (plan item 11f): the small file `pages.json` the deployer writes for each shop (bundle/lib/pages.ts) into the two places that read it on
// every request, so a new slug or page id takes effect without a restart: the runtime's client folder (it writes the owner's sign-in links to `ownerBase`) and the
// inbox's folder for the shop (the public front accepts the door's slug only when it is this file's, and makes the QR code from `pageUrl`).
//
// Nothing in it is secret. The pages domain is never written in code: these addresses come from fleet's answer to the deployer's claim.
import { readFileSync } from "node:fs";
import type { CharacterPictures } from "../assistant/character.ts";
import { isPaint } from "./chat-paint.ts";
import type { PaintId } from "./chat-paint.ts";

export const PAGES_FILE = "pages.json";

export interface PagesFile {
  schema: 1;
  /** The shop's address on its own server: https://<server>/s/<shop> (item 11d). Always there. */
  base: string;
  /** Where the owner's view is, with no trailing slash: <the pages address>/owner for a shop the door serves from this server, else <base>/owner. */
  ownerBase: string;
  /** The shop's claimed slug and its page on the pages domain (https://<pages domain>/<slug>), when it has one. */
  slug?: string;
  url?: string;
  /** The stable page address (https://<pages domain>/p/<id>): what QR codes and printed links carry, because it survives renames and domain changes. */
  pageUrl?: string;
  /** The shop's WhatsApp number to show ("message us on WhatsApp"): +91 and ten digits, as the panel took it. */
  whatsapp?: string;
  /** Batch 5: the shop's own phone ("Call the shop") and map link, on every customer page. The phone may be a landline, so it is any +country number, not only a mobile. */
  phone?: string;
  map?: string;
  /** Batch 3: the Operator who looks after the shop (name and the number they call or WhatsApp on), at the top of the owner's app and on every error page. */
  partner?: { name: string; phone: string };
  /** The panel's page for this shop, for the Operator's line on the page (a link only: the panel signs its own people in). */
  panelUrl?: string;
  /**
   * Item 11i: the version of the shop's drawn character pictures (character-files.ts), when they are drawn and handed to the front. The runtime links to them as
   * <url or base>/character/<face>.<format>?v=<version> (the morning line's picture and sticker); left out, it sends no picture.
   */
  character?: { version: string };
  /**
   * The shop's signboard paint, by its id (chat-paint.ts: pink, blue, green, marigold, brick): the colour of the strip at the top of its chat, chosen in the panel's Character step
   * and handed here with the pages file so the front needs nothing from the runtime to paint it. Left out: the head's own green tint.
   */
  paint?: PaintId;
  /**
   * True on Geometer's own Operator server (the panel's mode "hosted"), where Geometer can step in for an owner who lost every phone and their codes: the owner's sign-in
   * page then says to write to hello@geometer.dev. On a builder's own server it is left out and the page shows nothing about it (the builder is the admin there).
   */
  hosted?: true;
}

const HTTPS = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~%/-]*)?$/u;
const isUrl = (v: unknown): v is string => typeof v === "string" && v.length <= 300 && HTTPS.test(v) && !v.endsWith("/");

/** An international number as the panel takes it: "+" and 10 to 15 digits. */
export const PHONE_SHAPE = /^\+\d{10,15}$/u;
/**
 * A map link an Operator pastes: https only, on a maps host, no spaces or markup, at most 300 characters. A map link carries a query ("?q=..."), which `isUrl` refuses,
 * so it has its own check. Used by the panel's form and by the file's reader, so both say the same.
 */
// The ending of a Google address is pinned (".com", ".co.in", ".com.au", ".de"): an open ending let "www.google.com.evil.example/maps" through.
const GOOGLE_END = "(?:com|co\\.[a-z]{2}|com\\.[a-z]{2}|[a-z]{2})";
export const MAP_HOSTS = new RegExp(`^https://(?:www\\.google\\.${GOOGLE_END}/maps|maps\\.google\\.${GOOGLE_END}|maps\\.app\\.goo\\.gl|goo\\.gl/maps|www\\.openstreetmap\\.org|maps\\.apple\\.com)(?:/|\\?|$)`, "iu");
export const isMapLink = (v: unknown): v is string => typeof v === "string" && v.length <= 300 && /^[^\s"'<>\\]+$/u.test(v) && MAP_HOSTS.test(v);

/** The file's content, checked field by field; undefined when it is missing or not one (then the shop simply has no pages address and no owner sign-in). */
export function readPagesFile(text: string | undefined): PagesFile | undefined {
  if (text === undefined) return undefined;
  let f: Record<string, unknown>;
  try { f = JSON.parse(text) as Record<string, unknown>; } catch { return undefined; }
  if (typeof f !== "object" || f === null || f.schema !== 1 || !isUrl(f.base) || !isUrl(f.ownerBase)) return undefined;
  const slug = typeof f.slug === "string" && /^[a-z0-9-]{3,40}$/u.test(f.slug) ? f.slug : undefined;
  return {
    schema: 1, base: f.base, ownerBase: f.ownerBase,
    ...(slug && isUrl(f.url) ? { slug, url: f.url } : {}),
    ...(isUrl(f.pageUrl) ? { pageUrl: f.pageUrl } : {}),
    ...(typeof f.whatsapp === "string" && /^\+\d{10,15}$/u.test(f.whatsapp) ? { whatsapp: f.whatsapp } : {}),
    ...(isUrl(f.panelUrl) ? { panelUrl: f.panelUrl } : {}),
    ...(typeof f.phone === "string" && PHONE_SHAPE.test(f.phone) ? { phone: f.phone } : {}),
    ...(isMapLink(f.map) ? { map: f.map } : {}),
    ...(typeof f.partner === "object" && f.partner !== null && typeof (f.partner as { name?: unknown }).name === "string" && (f.partner as { name: string }).name.length > 0 && (f.partner as { name: string }).name.length <= 60 && typeof (f.partner as { phone?: unknown }).phone === "string" && PHONE_SHAPE.test((f.partner as { phone: string }).phone)
      ? { partner: { name: (f.partner as { name: string }).name, phone: (f.partner as { phone: string }).phone } } : {}),
    ...(isPaint(f.paint) ? { paint: f.paint } : {}),
    ...(f.hosted === true ? { hosted: true as const } : {}),
    ...(typeof f.character === "object" && f.character !== null && typeof (f.character as { version?: unknown }).version === "string" && /^[0-9a-f]{16}$/u.test((f.character as { version: string }).version) ? { character: { version: (f.character as { version: string }).version } } : {}),
  };
}

/**
 * Item 11i: where the shop's character pictures are, for the links WhatsApp fetches itself (the morning template's image header, the sticker): always the shop's own
 * server (`base`), never through the pages domain's front door. At 08:00 WhatsApp's fetchers ask for many shops' pictures from the same few addresses; the door
 * limits each address and asks fleet about each name, so a picture there could be refused, and a template whose header picture cannot be fetched is not delivered.
 * Undefined when the pictures are not drawn and handed over yet. Streetlist and the pages use the door's addresses (front.ts).
 */
export const picturesOf = (pages: PagesFile | undefined): CharacterPictures | undefined => (pages?.character ? { base: pages.base, version: pages.character.version } : undefined);

/** A reader that looks at the file on every call (a few hundred bytes), so the deployer's next pass is seen at once. */
export const pagesReader = (file: string): (() => PagesFile | undefined) => () => {
  let text: string | undefined;
  try { text = readFileSync(file, "utf8"); } catch { text = undefined; }
  return readPagesFile(text);
};
