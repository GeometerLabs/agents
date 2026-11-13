// A shop's page addresses (plan item 11f): the small file `pages.json` the deployer writes for each shop (bundle/lib/pages.ts) into the two places that read it on
// every request, so a new slug or page id takes effect without a restart: the runtime's client folder (it writes the owner's sign-in links to `ownerBase`) and the
// inbox's folder for the shop (the public front accepts the door's slug only when it is this file's, and makes the QR code from `pageUrl`).
//
// Nothing in it is secret. The pages domain is never written in code: these addresses come from fleet's answer to the deployer's claim.
import { readFileSync } from "node:fs";
import type { CharacterPictures } from "../assistant/character.ts";

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
  /** The panel's page for this shop, for the partner's line on the page (a link only: the panel signs its own people in). */
  panelUrl?: string;
  /**
   * Item 11i: the version of the shop's drawn character pictures (character-files.ts), when they are drawn and handed to the front. The runtime links to them as
   * <url or base>/character/<face>.<format>?v=<version> (the morning line's picture and sticker); left out, it sends no picture.
   */
  character?: { version: string };
}

const HTTPS = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~%/-]*)?$/u;
const isUrl = (v: unknown): v is string => typeof v === "string" && v.length <= 300 && HTTPS.test(v) && !v.endsWith("/");

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
    ...(typeof f.character === "object" && f.character !== null && typeof (f.character as { version?: unknown }).version === "string" && /^[0-9a-f]{16}$/u.test((f.character as { version: string }).version) ? { character: { version: (f.character as { version: string }).version } } : {}),
  };
}

/**
 * Item 11i: where the shop's character pictures are, for links that leave the server (WhatsApp fetches them itself): through the pages domain's front door when the
 * shop has a page there, else on its own server. Undefined when the pictures are not drawn and handed over yet.
 */
export const picturesOf = (pages: PagesFile | undefined): CharacterPictures | undefined => (pages?.character ? { base: pages.url ?? pages.base, version: pages.character.version } : undefined);

/** A reader that looks at the file on every call (a few hundred bytes), so the deployer's next pass is seen at once. */
export const pagesReader = (file: string): (() => PagesFile | undefined) => () => {
  let text: string | undefined;
  try { text = readFileSync(file, "utf8"); } catch { text = undefined; }
  return readPagesFile(text);
};
