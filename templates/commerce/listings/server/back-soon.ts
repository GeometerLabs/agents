// The "back soon" page of a listings-only shop that the shared process has PAUSED (modules/runtime/shared.ts: a shop that kept stopping its worker thread). It reuses the front's own error
// page (shopErrorPage: the visitor's language, the Operator's name with Call and WhatsApp when the shop's pages.json names one), with one sentence in the four languages.
// The language: ?lang=, else the browser's Accept-Language, else the shop's own first language. hi, ml and kn are machine-written lines, as everywhere (the page says so).
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { PAGES_FILE, pagesReader } from "../../../../modules/channels/pages-file.ts";
import { shopErrorPage } from "../../../../modules/channels/contact-bar.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { BACK_SOON } from "../../../../modules/channels/words-back-soon.ts";
import type { ShopPaths } from "../../../../modules/runtime/shared.ts";
import { readFileSync } from "node:fs";

export { BACK_SOON };

/** Which language to answer in; a file that cannot be read or has no language falls back to English (this page must never fail). */
function languageOf(p: ShopPaths, req: IncomingMessage): Language {
  const url = new URL(req.url ?? "/", "http://shared");
  const asked = url.searchParams.get("lang");
  if (LANGUAGES.includes(asked as Language)) return asked as Language;
  const header = String(req.headers["accept-language"] ?? "").toLowerCase();
  const fromBrowser = LANGUAGES.find((l) => new RegExp(`(^|[,\\s])${l}(-|;|,|$)`, "u").test(header));
  if (fromBrowser) return fromBrowser;
  try {
    const own = (JSON.parse(readFileSync(join(p.clientFolder, "settings.json"), "utf8")) as { languages?: unknown }).languages;
    const first = Array.isArray(own) ? own.find((l): l is Language => LANGUAGES.includes(l as Language)) : undefined;
    if (first) return first;
  } catch { /* an unreadable settings file: English */ }
  return "en";
}

/** The router's `backSoon`: the page for a browser, and the same sentence in the error shape the front already reads for its own calls. */
export function backSoon(p: ShopPaths, req: IncomingMessage): { html: string; json: unknown } {
  const language = languageOf(p, req);
  const partner = pagesReader(join(p.clientFolder, PAGES_FILE))()?.partner;
  return { html: shopErrorPage(language, BACK_SOON[language], partner), json: { error: { code: "unavailable", message: BACK_SOON[language] }, backSoon: true } };
}
