// The owner's app (item 11e): the pieces that make item 11d's private owner page an installable web app, and that do not depend on that page's code. Served by the
// owner page's front (modules/channels/front.ts, ownerRoute) under the owner's link and the signed-in view (<base>/owner, item 11f), at the routes modules/Explanation.md lists:
//   GET <link>/manifest.webmanifest   ownerAppManifest
//   GET <link>/sw.js                  OWNER_APP_SW (served as text/javascript; it sits at <link>/sw.js, so its scope <link>/ needs no Service-Worker-Allowed header)
//
// Offline means READING only. The service worker keeps the last page the owner saw and shows it when there is no network, marked as such. It never stores, replays or
// queues a POST: a tap or a message needs the live page (its digests are checked at the runtime against what waits now), so offline it simply fails and says so.
// The manifest's start_url and scope are the owner's own link (<link>/), so an installed app opens this shop's page and nothing else.
//
// Item 11h (decision 45): the same worker shows the owner's web push alerts (modules/push/pages.ts PUSH_HANDLERS) and, when one is tapped, opens this page. And the
// manifest and the worker are now every shop's owner page's, not only a shop with the assistant's: an owner without WhatsApp needs the alerts (and an iPhone shows
// push only to an app added to the home screen, which needs the manifest).
import type { Language } from "../../language/languages.ts";
import { PUSH_HANDLERS } from "../../push/pages.ts";

/** The app's name in the owner's language: the shop's name and "assistant". */
const APP_NAME: Record<Language, (shop: string) => string> = {
  en: (shop) => `${shop} assistant`, hi: (shop) => `${shop} असिस्टेंट`, ml: (shop) => `${shop} അസിസ്റ്റന്റ്`, kn: (shop) => `${shop} ಸಹಾಯಕ`,
};

/**
 * The app's icon as an SVG data address (no file to serve, nothing fetched): the character in its "all well" picture when the shop's pictures are drawn (item 11i),
 * else a plain tile in the theme colour with the shop's first letter.
 */
export function ownerAppIcon(shop: string, colour: string, iconSvg?: string): string {
  const letter = [...shop.trim()][0]?.toUpperCase() ?? "S";
  const safe = letter.replace(/[<>&"']/gu, "");
  const svg = iconSvg ?? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="${colour.replace(/[^#0-9a-fA-F]/gu, "")}"/><text x="256" y="330" font-size="260" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif">${safe}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/** The web app manifest for one shop's owner link (`base` is https://<server>/s/<shop>/o/<token>, no trailing slash). `colour`: character.ts themeColour. */
export function ownerAppManifest(a: { base: string; shop: string; language: Language; colour: string; iconSvg?: string }): Record<string, unknown> {
  const name = APP_NAME[a.language](a.shop);
  return {
    name, short_name: [...name].length <= 12 ? name : [...a.shop].slice(0, 12).join(""), lang: a.language,
    // the app opens at <link>/ (the owner page's front serves it there as at <link>), because a service worker controls only pages inside its scope, <link>/
    start_url: `${a.base}/`, scope: `${a.base}/`, id: `${a.base}/`, display: "standalone", orientation: "portrait",
    background_color: "#ffffff", theme_color: a.colour,
    icons: [{ src: ownerAppIcon(a.shop, a.colour, a.iconSvg), sizes: "512x512", type: "image/svg+xml", purpose: "any" }],
  };
}

/**
 * The service worker, as served. Network first for the page itself (a GET of the scope's root); on success the copy is kept, on failure the kept copy is shown with
 * an "offline" mark the page's own script reads (the x-owner-app-offline header). Everything else, and every POST, goes straight to the network and is never kept.
 */
export const OWNER_APP_SW = `// The owner's app: the last page, for reading offline. Nothing is ever sent from here later: a tap needs the live page.
const CACHE = "owner-app-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const scope = new URL(self.registration.scope);
  const url = new URL(req.url);
  const isPage = req.method === "GET" && url.origin === scope.origin && (url.pathname === scope.pathname || url.pathname + "/" === scope.pathname);
  if (!isPage) return; // POSTs, the manifest, anything else: the network, never the cache
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(req, { cache: "no-store" });
      if (fresh.ok) await cache.put(scope.href, fresh.clone());
      return fresh;
    } catch {
      const kept = await cache.match(scope.href);
      if (!kept) return new Response("Offline", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      const body = await kept.text();
      return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-owner-app-offline": "1" } });
    }
  })());
});${PUSH_HANDLERS}`;
