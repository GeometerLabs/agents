// The shop's side of the "Streetlist chats" list on the customer's phone, and the chat page's install prompt (W3, 17 Nov 2026; plan next-phase.md section 1a).
//
// What the list is: a short list the customer's PHONE keeps (localStorage on streetlist.in) of the shops it has chatted with: their name, face and last line. The
// Streetlist site's /chats page (streetlist repository, src/client/chats.ts) draws it and asks each shop for its own thread (`<page>/chat/thread`, with that shop's own
// path-scoped cookie). Nobody holds the list: not Streetlist's servers, not the shops. A shop's chat page only adds itself to it, with the small write below, from the
// page's own script on the same origin.
//
// The shape and key are the streetlist repository's (src/client/chats-store.ts is the reader and the one place that defines them); JOIN_SCRIPT is a plain-JavaScript copy
// of the write rules for the page's script. Its test (channels/test/chats-list.test.ts) runs the script against a fake storage, and the streetlist repository's
// tests/chats.test.ts runs it against the reader when the two checkouts sit side by side, so they cannot drift. When a rule changes, change both.
//
// The list is written only by a page served THROUGH the Streetlist door (`onStreetlist`): a shop on its own domain has no streetlist.in storage to write to.
//
// The words below (the install prompt on the chat page) are English, Hindi, Malayalam and Kannada; the last three are machine-written and listed on the review sheets
// (bundle/panel/review.ts, ids "chat.list.*"). They are the same lines the Streetlist site's /chats page shows (streetlist src/chats-words.ts), so the two never disagree.
import type { Language } from "../language/languages.ts";

/** The one localStorage key and shape version (streetlist repository src/client/chats-store.ts CHATS_KEY, CHATS_VERSION). */
export const CHATS_KEY = "streetlist-chats";
export const CHATS_VERSION = 1;
/** At most this many shops are kept, newest activity first; the longest line kept for a row. */
export const CHATS_MAX_SHOPS = 30;
/** How long "Not now" holds the install prompt back (14 days). */
export const INSTALL_SNOOZE_MS = 14 * 24 * 3600 * 1000;

/**
 * Plain JavaScript for the chat page's script (it sits inside the page's one closure, so these are names in that closure): `joinChat(entry)` adds or updates this shop in
 * the list; `chatsSnoozed()` says whether "Not now" is still holding the install prompt back; `snoozeChats()` records "Not now". Every storage call is wrapped, and a
 * blocked store changes nothing. The writer is as strict as the reader: a bad slug, a missing name or a face that is not this shop's own picture on this site is dropped,
 * so a script on the shared origin can only write what the reader would have accepted anyway.
 */
export const JOIN_SCRIPT = `const joinChat = (e) => {
  try {
    const KEY = ${JSON.stringify(CHATS_KEY)}, SLUG = /^(?!.*--)(?![0-9]+$)[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
    if (!e || typeof e.slug !== "string" || !SLUG.test(e.slug) || typeof e.name !== "string" || !e.name.trim()) return;
    const cut = (s, n) => Array.from(String(s).replace(/\\s+/g, " ").trim()).slice(0, n).join("");
    let doc = null;
    try { doc = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (x) { doc = null; }
    if (!doc || doc.v !== ${CHATS_VERSION} || !Array.isArray(doc.shops)) doc = { v: ${CHATS_VERSION}, visits: 0, shops: [] };
    const old = doc.shops.find((s) => s && s.slug === e.slug) || {};
    const face = typeof e.face === "string" && e.face.length <= 200 && new RegExp("^/" + e.slug + "/character/[a-z]{3,10}\\\\.svg(\\\\?v=[A-Za-z0-9._-]{1,64})?$").test(e.face) ? e.face : old.face;
    const paint = typeof e.paint === "string" && /^[0-9a-fA-F]{6}$/.test(e.paint) ? e.paint.toLowerCase() : old.paint;
    const last = e.last ? cut(e.last, 120) : old.last;
    const lastBy = e.last ? (e.lastBy === "you" ? "you" : "shop") : old.lastBy;
    const at = typeof e.at === "number" && e.at >= 0 ? Math.floor(e.at) : old.at;
    const next = { slug: e.slug, name: cut(e.name, 60), seen: Math.max(old.seen || 0, Math.floor(e.seen) || 0), joined: old.joined || Date.now(), answered: old.answered === true || e.answered === true };
    if (face) next.face = face;
    if (paint) next.paint = paint;
    if (last) { next.last = last; next.lastBy = lastBy; }
    if (at !== undefined) next.at = at;
    const others = doc.shops.filter((s) => s && s.slug !== e.slug);
    doc.shops = [next].concat(others).sort((a, b) => ((b.at || b.joined || 0) - (a.at || a.joined || 0))).slice(0, ${CHATS_MAX_SHOPS});
    doc.visits = Math.floor(doc.visits) || 0;
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch (x) { /* storage blocked: the list is simply not kept */ }
};
const chatsSnoozed = () => {
  try { const d = JSON.parse(localStorage.getItem(${JSON.stringify(CHATS_KEY)}) || "null"); return !!(d && typeof d.dismissedAt === "number" && Date.now() - d.dismissedAt < ${INSTALL_SNOOZE_MS}); } catch (x) { return false; }
};
const snoozeChats = () => {
  try {
    const KEY = ${JSON.stringify(CHATS_KEY)};
    let doc = null;
    try { doc = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (x) { doc = null; }
    if (!doc || doc.v !== ${CHATS_VERSION} || !Array.isArray(doc.shops)) doc = { v: ${CHATS_VERSION}, visits: 0, shops: [] };
    doc.dismissedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch (x) { /* not remembered; shown again next time */ }
};
`;

/**
 * The install prompt's behaviour for the chat page (inside the page's closure, after JOIN_SCRIPT). `installMaybe()` is called once the shop has answered (never on
 * the first load of an unanswered chat): it shows the slot when the browser has offered its own install (Android's beforeinstallprompt, caught here because the event
 * fires on whichever page is open, and this is where a customer is when a shop replies) or, on an iPhone, the one-line Add to Home Screen hint, because iPhone shows
 * alerts only for apps on the home screen and has no prompt to call. Never when already installed, never while "Not now" holds it back.
 */
export const INSTALL_SCRIPT = `let installOffer = null, installReady = false;
const installSlot = document.getElementById("install-slot");
const installIsApp = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const installOnIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !installIsApp();
const installShow = () => {
  if (!installSlot || !installReady || installIsApp() || chatsSnoozed()) return;
  const go = document.getElementById("install-go"), tip = document.getElementById("install-ios");
  if (!installOffer && !installOnIphone()) return;
  installSlot.hidden = false; go.hidden = !installOffer; tip.hidden = !!installOffer;
};
const installMaybe = () => { installReady = true; installShow(); };
addEventListener("beforeinstallprompt", (ev) => { ev.preventDefault(); installOffer = ev; installShow(); });
addEventListener("appinstalled", () => { installOffer = null; if (installSlot) installSlot.hidden = true; });
if (installSlot) {
  document.getElementById("install-go").addEventListener("click", async () => {
    const ev = installOffer; if (!ev) return; installOffer = null;
    try { await ev.prompt(); await ev.userChoice; } catch (x) { /* the browser said no */ }
    installShow();
  });
  document.getElementById("install-later").addEventListener("click", () => { snoozeChats(); installSlot.hidden = true; });
}
`;

/** What the chat page says about the list and the install prompt. The same lines as the Streetlist site's /chats page (its src/chats-words.ts). */
export interface ChatsListWords { yourChats: string; installHead: string; installBody: string; installButton: string; notNow: string; iphone: string }
export const CHATS_LIST_WORDS: Record<Language, ChatsListWords> = {
  en: { yourChats: "Your chats", installHead: "Keep Streetlist on your phone", installBody: "Open your chats in one tap, and hear when a shop replies.", installButton: "Add to your phone", notNow: "Not now", iphone: "Tap the Share button, then Add to Home Screen." },
  hi: { yourChats: "आपकी चैट", installHead: "Streetlist को अपने फ़ोन पर रखें", installBody: "एक टैप में अपनी चैट खोलें, और दुकान का जवाब आते ही जानें।", installButton: "फ़ोन में जोड़ें", notNow: "अभी नहीं", iphone: "Share बटन दबाएँ, फिर Add to Home Screen।" },
  ml: { yourChats: "നിങ്ങളുടെ ചാറ്റുകൾ", installHead: "Streetlist ഫോണിൽ സൂക്ഷിക്കൂ", installBody: "ഒറ്റ തൊടലിൽ ചാറ്റുകൾ തുറക്കാം, കട മറുപടി തന്നാൽ അറിയാം.", installButton: "ഫോണിൽ ചേർക്കൂ", notNow: "ഇപ്പോൾ വേണ്ട", iphone: "Share ബട്ടൺ അമർത്തൂ, പിന്നെ Add to Home Screen." },
  kn: { yourChats: "ನಿಮ್ಮ ಚಾಟ್‌ಗಳು", installHead: "Streetlist ಅನ್ನು ನಿಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ ಇಟ್ಟುಕೊಳ್ಳಿ", installBody: "ಒಂದೇ ಒತ್ತಿನಲ್ಲಿ ಚಾಟ್‌ಗಳನ್ನು ತೆರೆಯಿರಿ, ಅಂಗಡಿ ಉತ್ತರಿಸಿದಾಗ ತಿಳಿಯಿರಿ.", installButton: "ಫೋನ್‌ಗೆ ಸೇರಿಸಿ", notNow: "ಈಗ ಬೇಡ", iphone: "Share ಬಟನ್ ಒತ್ತಿ, ನಂತರ Add to Home Screen." },
};

/** The Share icon (a box with an arrow up) the iPhone hint shows beside its words. Decorative: the words say it. */
export const SHARE_ICON = `<svg class="share-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>`;
