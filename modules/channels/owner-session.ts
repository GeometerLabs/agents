// The owner's view of the shop's page, signed in from WhatsApp (plan item 11f, decision 44): the public front's routes under <base>/owner, where <base> is the
// shop's address for this request (https://<pages domain>/<slug> through the door, or https://<server>/s/<shop>). Used by front.ts, which hands every /owner
// request here with its own helpers; the owner's page itself is item 11d's (front.ts ownerRoute, owner-page.ts), opened with a session instead of the panel's link.
//
//   GET  <base>/owner              signed in: the owner's page. Not signed in: "Send me a sign-in link" (and how to ask on WhatsApp instead)
//   POST <base>/owner/signin       ask for a link. The form has no number field and nothing posted with it is read: the runtime sends the link to the owner's number
//                                  in the shop's settings, within its own limits, and the answer is the same whatever happened
//   GET  <base>/owner/in/<link>    the link from WhatsApp: a page with one button. A GET never uses a link up (scanners and previews fetch links)
//   POST <base>/owner/in/<link>    use it up (at the runtime, once) and sign THIS browser in: the session cookie, then the owner's page
//   POST <base>/owner/answer       an answer from the owner's page (with the session's form token)
//   GET  <base>/owner/api/v1/state, POST <base>/owner/api/v1/answer   item 11d's JSON pair, with the session (the answer with the form token in x-owner-csrf)
//   POST <base>/owner/out          sign out on this browser
//   Item 11h (decisions 45 and 46): <base>/owner/setup/<token>, /recover and /passkey/... are the passkey pages (owner-passkey-page.ts): the partner's setup QR or
//   a recovery code registers a passkey, and the passkey signs the owner in with no WhatsApp at all. The sign-in page leads with it when the shop has one, and
//   offers the WhatsApp link only when the shop has a WhatsApp number on its page.
//
// The cookie: OWNER_COOKIE, HttpOnly, Secure, SameSite=Lax, Path=<base path>/owner, no Domain (the __Host- prefix forbids a path, so __Secure- it is). Every shop on the
// pages domain shares one origin, so the path is hygiene, not a wall: what keeps one shop's page from acting for another's owner is that no page there runs script
// (the content policy), that every owner POST carries the form token (`csrfFor`, derived from the session the browser holds, compared in constant time), and that the
// session is checked at the shop's own runtime. bundle/Explanation.md, "One origin for every shop", says it in full.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { html, raw } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { LANGUAGES } from "../language/languages.ts";
import type { Language } from "../language/languages.ts";
import { ACCESS_TOKEN, SESSION_MS } from "./owner-access.ts";
import type { LinkState } from "./owner-access.ts";
import type { ChannelBackend, OwnerCred } from "./backend.ts";
import type { Limiter } from "./limits.ts";
import type { PagesFile } from "./pages-file.ts";
import { PAGE } from "./words.ts";
import { PASSKEY_SCRIPT, PASSKEY_WORDS, isPasskeyRoute, passkeyButton, passkeyPolicy, passkeyRoute } from "./owner-passkey-page.ts";

export const OWNER_COOKIE = "__Secure-geo-owner";
/** The header a JSON answer carries the form token in. */
export const CSRF_HEADER = "x-owner-csrf";

/** The session's form token: derived from the session, so only a page that was given it (the owner's own page) can post. 32 characters of base64url. */
export const csrfFor = (session: string): string => createHash("sha256").update(`geo-owner-csrf/1\n${session}`).digest("base64url").slice(0, 32);
/** Does the token posted match this session's? Constant time; anything missing or of another length is no. */
export function csrfMatches(session: string, given: unknown): boolean {
  if (typeof given !== "string" || given.length !== 32) return false;
  return timingSafeEqual(Buffer.from(csrfFor(session)), Buffer.from(given));
}

/** The session in the request's cookies, if one of the right shape is there (a browser sends only the cookie whose path covers this request). */
export function sessionFromCookie(header: string | undefined): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at < 0 || part.slice(0, at).trim() !== OWNER_COOKIE) continue;
    const value = part.slice(at + 1).trim();
    if (ACCESS_TOKEN.test(value)) return value;
  }
  return undefined;
}

/** The Set-Cookie for a new session (or, with no session, the one that removes it), scoped to this shop's owner path. */
export function ownerCookie(path: string, session?: string, maxAgeS = Math.floor(SESSION_MS / 1000)): string {
  return `${OWNER_COOKIE}=${session ?? ""}; Path=${path}; Max-Age=${session ? maxAgeS : 0}; HttpOnly; Secure; SameSite=Lax`;
}

interface Words {
  title: string; intro: string; send: string; sent: string; nothingCame: string; askOnWhatsapp: string; noWhatsapp: string;
  linkTitle: string; linkValid: string; signIn: string; state: Record<Exclude<LinkState, "valid">, string>; askAgain: string;
  signOut: string; signedOut: string; tooMany: string; notOn: string; partner: string; account: string; panel: string;
}
/** The words of the sign-in pages. Hindi, Malayalam and Kannada are machine-written and wait for native review (plan item 12); the page says so. */
export const SIGNIN_WORDS: Record<Language, Words> = {
  en: {
    title: "Sign in to your shop", intro: "This page is for the shop's owner. A sign-in link goes to the owner's WhatsApp number, the one set up with the shop. No password.",
    send: "Send me a sign-in link", sent: "If you are this shop's owner, a sign-in link is on its way to your WhatsApp. It works once, for 10 minutes.",
    nothingCame: "Nothing came? Send \"open my app\" to the shop's WhatsApp number, and the link comes back as a reply.", askOnWhatsapp: "Send \"open my app\" on WhatsApp",
    noWhatsapp: "The shop's WhatsApp number is not on this page yet: ask your partner for it.",
    linkTitle: "Sign in", linkValid: "Tap the button to sign in on this phone or computer.", signIn: "Sign in",
    state: { used: "This link was used already.", expired: "This link has run out: a link works for 10 minutes.", replaced: "A newer link was sent. Use the newest one.", unknown: "This link does not work." },
    askAgain: "Ask for a new link", signOut: "Sign out", signedOut: "You are signed out on this device.", tooMany: "Too many tries from here. Wait a few minutes.",
    notOn: "Sign-in is not on for this shop yet.", partner: "Set up this shop?", account: "Your Geometer account", panel: "The panel",
  },
  hi: {
    title: "अपनी दुकान में साइन इन करें", intro: "यह पेज दुकान के मालिक के लिए है। साइन-इन का लिंक मालिक के WhatsApp नंबर पर जाता है, वही जो दुकान के साथ जोड़ा गया है। कोई पासवर्ड नहीं।",
    send: "मुझे साइन-इन लिंक भेजें", sent: "अगर आप इस दुकान के मालिक हैं, तो साइन-इन लिंक आपके WhatsApp पर आ रहा है। यह एक बार, 10 मिनट तक चलेगा।",
    nothingCame: "कुछ नहीं आया? दुकान के WhatsApp नंबर पर \"open my app\" भेजिए, लिंक जवाब में आ जाएगा।", askOnWhatsapp: "WhatsApp पर \"open my app\" भेजें",
    noWhatsapp: "दुकान का WhatsApp नंबर अभी इस पेज पर नहीं है: अपने पार्टनर से पूछिए।",
    linkTitle: "साइन इन", linkValid: "इस फ़ोन या कंप्यूटर पर साइन इन करने के लिए बटन दबाइए।", signIn: "साइन इन",
    state: { used: "यह लिंक पहले ही इस्तेमाल हो चुका है।", expired: "इस लिंक का समय ख़त्म हो गया: लिंक 10 मिनट चलता है।", replaced: "एक नया लिंक भेजा गया है। सबसे नया इस्तेमाल करें।", unknown: "यह लिंक काम नहीं करता।" },
    askAgain: "नया लिंक माँगें", signOut: "साइन आउट", signedOut: "इस डिवाइस पर आप साइन आउट हो गए हैं।", tooMany: "यहाँ से बहुत बार कोशिश हुई। कुछ मिनट रुकिए।",
    notOn: "इस दुकान के लिए साइन-इन अभी चालू नहीं है।", partner: "यह दुकान आपने सेट की है?", account: "आपका Geometer खाता", panel: "पैनल",
  },
  ml: {
    title: "നിങ്ങളുടെ കടയിൽ സൈൻ ഇൻ ചെയ്യൂ", intro: "ഈ പേജ് കടയുടമയ്ക്കുള്ളതാണ്. സൈൻ ഇൻ ലിങ്ക് കടയോടൊപ്പം ചേർത്ത ഉടമയുടെ WhatsApp നമ്പറിലേക്ക് പോകും. പാസ്‌വേഡ് ഇല്ല.",
    send: "എനിക്ക് സൈൻ ഇൻ ലിങ്ക് അയയ്ക്കൂ", sent: "നിങ്ങൾ ഈ കടയുടെ ഉടമയാണെങ്കിൽ, സൈൻ ഇൻ ലിങ്ക് നിങ്ങളുടെ WhatsApp-ലേക്ക് വരുന്നു. ഇത് ഒരിക്കൽ മാത്രം, 10 മിനിറ്റ് പ്രവർത്തിക്കും.",
    nothingCame: "ഒന്നും വന്നില്ലേ? കടയുടെ WhatsApp നമ്പറിലേക്ക് \"open my app\" അയയ്ക്കൂ, ലിങ്ക് മറുപടിയായി വരും.", askOnWhatsapp: "WhatsApp-ൽ \"open my app\" അയയ്ക്കൂ",
    noWhatsapp: "കടയുടെ WhatsApp നമ്പർ ഇതുവരെ ഈ പേജിൽ ഇല്ല: നിങ്ങളുടെ പങ്കാളിയോട് ചോദിക്കൂ.",
    linkTitle: "സൈൻ ഇൻ", linkValid: "ഈ ഫോണിലോ കമ്പ്യൂട്ടറിലോ സൈൻ ഇൻ ചെയ്യാൻ ബട്ടൺ അമർത്തൂ.", signIn: "സൈൻ ഇൻ",
    state: { used: "ഈ ലിങ്ക് ഇതിനകം ഉപയോഗിച്ചു.", expired: "ഈ ലിങ്കിന്റെ സമയം കഴിഞ്ഞു: ലിങ്ക് 10 മിനിറ്റ് പ്രവർത്തിക്കും.", replaced: "പുതിയ ഒരു ലിങ്ക് അയച്ചിട്ടുണ്ട്. ഏറ്റവും പുതിയത് ഉപയോഗിക്കൂ.", unknown: "ഈ ലിങ്ക് പ്രവർത്തിക്കുന്നില്ല." },
    askAgain: "പുതിയ ലിങ്ക് ചോദിക്കൂ", signOut: "സൈൻ ഔട്ട്", signedOut: "ഈ ഉപകരണത്തിൽ നിങ്ങൾ സൈൻ ഔട്ട് ചെയ്തു.", tooMany: "ഇവിടെ നിന്ന് വളരെയധികം ശ്രമങ്ങൾ. കുറച്ച് മിനിറ്റ് കാത്തിരിക്കൂ.",
    notOn: "ഈ കടയ്ക്ക് സൈൻ ഇൻ ഇതുവരെ ഓണല്ല.", partner: "ഈ കട നിങ്ങളാണോ സജ്ജമാക്കിയത്?", account: "നിങ്ങളുടെ Geometer അക്കൗണ്ട്", panel: "പാനൽ",
  },
  kn: {
    title: "ನಿಮ್ಮ ಅಂಗಡಿಗೆ ಸೈನ್ ಇನ್ ಮಾಡಿ", intro: "ಈ ಪುಟ ಅಂಗಡಿಯ ಮಾಲೀಕರಿಗಾಗಿ. ಸೈನ್ ಇನ್ ಲಿಂಕ್ ಅಂಗಡಿಯೊಂದಿಗೆ ಸೇರಿಸಿದ ಮಾಲೀಕರ WhatsApp ನಂಬರ್‌ಗೆ ಹೋಗುತ್ತದೆ. ಪಾಸ್‌ವರ್ಡ್ ಇಲ್ಲ.",
    send: "ನನಗೆ ಸೈನ್ ಇನ್ ಲಿಂಕ್ ಕಳುಹಿಸಿ", sent: "ನೀವು ಈ ಅಂಗಡಿಯ ಮಾಲೀಕರಾಗಿದ್ದರೆ, ಸೈನ್ ಇನ್ ಲಿಂಕ್ ನಿಮ್ಮ WhatsApp ಗೆ ಬರುತ್ತಿದೆ. ಇದು ಒಮ್ಮೆ ಮಾತ್ರ, 10 ನಿಮಿಷ ಕೆಲಸ ಮಾಡುತ್ತದೆ.",
    nothingCame: "ಏನೂ ಬರಲಿಲ್ಲವೇ? ಅಂಗಡಿಯ WhatsApp ನಂಬರ್‌ಗೆ \"open my app\" ಕಳುಹಿಸಿ, ಲಿಂಕ್ ಉತ್ತರವಾಗಿ ಬರುತ್ತದೆ.", askOnWhatsapp: "WhatsApp ನಲ್ಲಿ \"open my app\" ಕಳುಹಿಸಿ",
    noWhatsapp: "ಅಂಗಡಿಯ WhatsApp ನಂಬರ್ ಇನ್ನೂ ಈ ಪುಟದಲ್ಲಿ ಇಲ್ಲ: ನಿಮ್ಮ ಪಾಲುದಾರರನ್ನು ಕೇಳಿ.",
    linkTitle: "ಸೈನ್ ಇನ್", linkValid: "ಈ ಫೋನ್ ಅಥವಾ ಕಂಪ್ಯೂಟರ್‌ನಲ್ಲಿ ಸೈನ್ ಇನ್ ಮಾಡಲು ಬಟನ್ ಒತ್ತಿ.", signIn: "ಸೈನ್ ಇನ್",
    state: { used: "ಈ ಲಿಂಕ್ ಈಗಾಗಲೇ ಬಳಸಲಾಗಿದೆ.", expired: "ಈ ಲಿಂಕ್‌ನ ಸಮಯ ಮುಗಿದಿದೆ: ಲಿಂಕ್ 10 ನಿಮಿಷ ಕೆಲಸ ಮಾಡುತ್ತದೆ.", replaced: "ಹೊಸ ಲಿಂಕ್ ಕಳುಹಿಸಲಾಗಿದೆ. ಅತ್ಯಂತ ಹೊಸದನ್ನು ಬಳಸಿ.", unknown: "ಈ ಲಿಂಕ್ ಕೆಲಸ ಮಾಡುವುದಿಲ್ಲ." },
    askAgain: "ಹೊಸ ಲಿಂಕ್ ಕೇಳಿ", signOut: "ಸೈನ್ ಔಟ್", signedOut: "ಈ ಸಾಧನದಲ್ಲಿ ನೀವು ಸೈನ್ ಔಟ್ ಆಗಿದ್ದೀರಿ.", tooMany: "ಇಲ್ಲಿಂದ ತುಂಬಾ ಪ್ರಯತ್ನಗಳು. ಕೆಲವು ನಿಮಿಷ ಕಾಯಿರಿ.",
    notOn: "ಈ ಅಂಗಡಿಗೆ ಸೈನ್ ಇನ್ ಇನ್ನೂ ಚಾಲೂ ಇಲ್ಲ.", partner: "ಈ ಅಂಗಡಿಯನ್ನು ನೀವು ಹೊಂದಿಸಿದ್ದೀರಾ?", account: "ನಿಮ್ಮ Geometer ಖಾತೆ", panel: "ಪ್ಯಾನೆಲ್",
  },
};

/** Geometer's account page, where a partner or builder signs in (on geometer.dev, a different domain from the shop pages: no sign-in crosses between them). */
export const ACCOUNT_URL = "https://geometer.dev/account";

const CSS = `body{margin:0;color:#10231a;font:17px/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans","Noto Sans Devanagari","Noto Sans Malayalam","Noto Sans Kannada",sans-serif}
main{max-width:30rem;margin:0 auto;padding:24px 16px 40px}h1{font-size:1.3rem}.note{color:#4b5d52;font-size:.92rem}.notice{background:#fffbeb;color:#92400e;padding:8px 10px;border-radius:8px}
button,.btn{display:inline-block;margin-top:12px;font-size:1.05rem;padding:12px 18px;border-radius:10px;border:0;background:#15803d;color:#fff;text-decoration:none;cursor:pointer}
footer{margin-top:28px;border-top:1px solid #cfe3d6;padding-top:10px;font-size:.88rem;color:#4b5d52}a{color:#15803d}`;

/** The partner's small line: their account on geometer.dev and the server's panel. Links only; no sign-in crosses to the pages domain (Explanation.md says why). */
export function partnerLine(language: Language, panelUrl?: string): Raw {
  const w = SIGNIN_WORDS[language];
  return html`<footer><span>${w.partner}</span> <a href="${ACCOUNT_URL}" rel="noopener">${w.account}</a>${panelUrl ? html` · <a href="${panelUrl}" rel="noopener">${w.panel}</a>` : ""}</footer>`;
}

/** A sign-in page. `nonce`: the page carries the passkey script (item 11h), run by that nonce in the response's own policy. */
function page(language: Language, title: string, body: Raw, nonce?: string): string {
  const machine = PAGE[language].machine;
  return `<!doctype html>${html`<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${title}</title><style>${raw(CSS)}</style></head><body><main>
${machine ? html`<p class="notice">${machine}</p>` : ""}${body}</main>${nonce ? html`<script nonce="${nonce}">${raw(PASSKEY_SCRIPT)}</script>` : ""}</body></html>`.markup}`;
}

/** "Open my app" on WhatsApp, as a wa.me link with the words filled in: the way to sign in that always works (the owner's message opens the window). */
const waOpenMyApp = (number: string) => `https://wa.me/${number.replace(/\D/gu, "")}?text=${encodeURIComponent("open my app")}`;

/**
 * The sign-in page: no number field. `sent` after a press: the same words whatever happened. Item 11h: `passkeys` when the shop has them on (`count` of the owner's
 * passkeys here; `nonce` for the script), which then leads; the WhatsApp link and "open my app" only when the shop has a WhatsApp number on its page.
 */
export function signinPage(o: { base: string; language: Language; pages: PagesFile | undefined; sent?: boolean; notice?: string; passkeys?: { count: number; nonce: string } }): string {
  const w = SIGNIN_WORDS[o.language];
  const p = PASSKEY_WORDS[o.language];
  const wa = o.pages?.whatsapp;
  const owner = `${o.base}/owner`;
  const passkey = o.passkeys
    ? html`${o.passkeys.count > 0 ? passkeyButton({ mode: "signin", options: `${owner}/passkey/options`, finish: `${owner}/passkey/finish`, label: p.signIn, language: o.language }) : html`<p class="notice">${p.none}</p>`}
<p class="note">${p.note}</p><p class="note"><a href="${owner}/recover?lang=${o.language}">${p.recoverLink}</a></p>`
    : "";
  const whatsapp = wa
    ? html`<form method="post" action="${owner}/signin"><input type="hidden" name="lang" value="${o.language}"><button type="submit"${o.passkeys ? raw(' class="btn" style="background:#4b5d52"') : ""}>${w.send}</button></form>
<p class="note">${w.nothingCame}</p><p><a class="btn" href="${waOpenMyApp(wa)}" rel="noopener">${w.askOnWhatsapp}</a></p>`
    : o.passkeys ? "" : html`<p class="note">${w.noWhatsapp}</p>`;
  const intro = o.sent ? html`<p class="notice" role="status">${w.sent}</p>` : html`<p>${wa || !o.passkeys ? w.intro : p.introNoWhatsapp}</p>`;
  return page(o.language, w.title, html`<h1>${w.title}</h1>
${o.notice ? html`<p class="notice" role="status">${o.notice}</p>` : ""}
${intro}${passkey}${whatsapp}
${partnerLine(o.language, o.pages?.panelUrl)}`, o.passkeys && o.passkeys.count > 0 ? o.passkeys.nonce : undefined);
}

/** The sign-in page's policy: the plain one, or (with the passkey button) its nonce and the two addresses the script posts to. */
const signinPolicy = (policy: string, base: string, passkeys?: { count: number; nonce: string }): Record<string, string> =>
  passkeys && passkeys.count > 0 ? { "content-security-policy": passkeyPolicy(policy, passkeys.nonce, [`${base}/owner/passkey/options`, `${base}/owner/passkey/finish`]) } : {};

/** The page a link from WhatsApp opens: a button to sign in (valid), or why not and a way to ask again. */
export function linkPage(o: { base: string; link: string; language: Language; state: LinkState }): string {
  const w = SIGNIN_WORDS[o.language];
  if (o.state === "valid") {
    return page(o.language, w.linkTitle, html`<h1>${w.linkTitle}</h1><p>${w.linkValid}</p>
<form method="post" action="${o.base}/owner/in/${o.link}"><input type="hidden" name="lang" value="${o.language}"><button type="submit">${w.signIn}</button></form>`);
  }
  return page(o.language, w.linkTitle, html`<h1>${w.linkTitle}</h1><p class="notice">${w.state[o.state]}</p><p><a class="btn" href="${o.base}/owner?lang=${o.language}">${w.askAgain}</a></p>`);
}

/** What the session routes need from the front: its helpers, so the limits, the body caps and the Origin check are the front's own. */
export interface OwnerSessionDeps {
  limiter: Limiter;
  /** The pages' content policy (front.ts PAGE_POLICY), which a page with the passkey script extends by its nonce. */
  policy: string;
  sendHtml(res: ServerResponse, status: number, body: string, extra?: Record<string, string>): void;
  sendJson(res: ServerResponse, status: number, value: unknown, extra?: Record<string, string>): void;
  readBody(req: IncomingMessage, max: number): Promise<string | undefined>;
  /** item 11d's owner page and its JSON pair, for a credential at a base, with the form token to check and to put in the page. */
  ownerRoute(sub: string, o: { cred: OwnerCred; base: string; csrf: string; signOut: { action: string; label: string }; onGone: () => void }): Promise<void>;
}

/** Item 11h: whether the shop has passkeys on and how many the owner has here (the sign-in page's button), with a fresh nonce; undefined when they are off. */
async function passkeyStatus(backend: ChannelBackend): Promise<{ count: number; nonce: string } | undefined> {
  if (!backend.passkey) return undefined;
  const r = await backend.passkey({ op: "status" });
  return r.status === 200 && typeof r.body.count === "number" ? { count: r.body.count, nonce: randomBytes(16).toString("base64") } : undefined;
}

/** The visitor's language for the sign-in pages: ?lang= (or the form's), else the browser's first of the four, else English (the owner's own is known only once signed in). */
function signinLanguage(req: IncomingMessage, url: URL, form?: URLSearchParams): Language {
  const asked = form?.get("lang") ?? url.searchParams.get("lang");
  if (asked && LANGUAGES.includes(asked as Language)) return asked as Language;
  for (const part of String(req.headers["accept-language"] ?? "").split(",")) {
    const l = part.trim().slice(0, 2).toLowerCase() as Language;
    if (LANGUAGES.includes(l)) return l;
  }
  return "en";
}

/**
 * One request under <base>/owner. `base` is the shop's address for this request; `sameOrigin` is the front's Origin check for it. The owner's view lives at ONE
 * address (the pages file's `ownerBase`, where the runtime's links point); a request at another address of the shop is sent there, so the cookie has one home.
 */
export async function ownerSessionRoute(deps: OwnerSessionDeps, a: {
  req: IncomingMessage; res: ServerResponse; url: URL; base: string; sub: string; address: string; backend: ChannelBackend; pages: PagesFile | undefined; sameOrigin: boolean;
  /** Item 11h: the shop's name, for the passkey setup page. */
  shopName?: string;
}): Promise<void> {
  const { req, res, url, base, sub, address, backend, pages } = a;
  const method = req.method ?? "GET";
  const cookiePath = `${new URL(base).pathname}/owner`;
  const htmlHeaders = { "x-robots-tag": "noindex" };
  const slow = (language: Language) => deps.sendHtml(res, 429, page(language, SIGNIN_WORDS[language].title, html`<p class="notice">${SIGNIN_WORDS[language].tooMany}</p>`), { "retry-after": "600" });
  const back = (to: string, extra: Record<string, string> = {}) => { res.writeHead(303, { location: to, "cache-control": "no-store", ...extra }); res.end(); };

  // no pages file, or a runtime without sign-in: the owner's view is not on for this shop (item 11d's panel-made link still works)
  if (!pages || !backend.linkState || !backend.signin || !backend.signout) return deps.sendHtml(res, 404, page("en", SIGNIN_WORDS.en.title, html`<p>${SIGNIN_WORDS.en.notOn}</p>`), htmlHeaders);
  if (base !== pages.ownerBase.replace(/\/owner$/u, "")) return back(`${pages.ownerBase}${sub}${url.search}`);
  if (method === "POST" && !a.sameOrigin) return deps.sendHtml(res, 403, "<!doctype html><p>Forms from another site are refused.</p>");

  // ---- asking for a link ----
  if (sub === "/signin") {
    if (method !== "POST") return deps.sendHtml(res, 405, "<!doctype html><p>Use the page's button.</p>", { allow: "POST" });
    const form = new URLSearchParams((await deps.readBody(req, 4096)) ?? "");
    const language = signinLanguage(req, url, form);
    if (!deps.limiter.take("signin", address) || !deps.limiter.take("shopSignins", `shop:${new URL(base).pathname}`)) return slow(language);
    // only the kind and a fresh id go to the runtime: whatever else the form carried (a number, an address) is never read
    await backend.submit([{ kind: "owner_signin", id: randomUUID() }]);
    return back(`${base}/owner?sent=1&lang=${language}`);
  }

  // ---- item 11h: passkeys (the partner's setup QR, the recovery card, signing in) ----
  if (isPasskeyRoute(sub)) {
    if (method === "POST" && !a.sameOrigin) return deps.sendJson(res, 403, { message: "Calls from another site's page are refused." });
    return passkeyRoute({
      limiter: deps.limiter, sendHtml: deps.sendHtml, sendJson: deps.sendJson, readBody: deps.readBody, policy: deps.policy,
      page: (language, title, body, nonce) => page(language, title, body, nonce), cookie: (session) => ownerCookie(cookiePath, session),
    }, { req, res, base, sub, address, backend, language: signinLanguage(req, url) });
  }

  // ---- the link from WhatsApp ----
  const link = /^\/in\/([^/]+)$/u.exec(sub);
  if (link) {
    const language = signinLanguage(req, url);
    if (deps.limiter.over("wrong", address)) return slow(language);
    const token = link[1];
    if (method === "GET") {
      const state = ACCESS_TOKEN.test(token) ? await backend.linkState(token) : "unknown";
      if (state === "unknown") deps.limiter.take("wrong", address);
      return deps.sendHtml(res, state === "valid" ? 200 : 410, linkPage({ base, link: token, language, state }), htmlHeaders);
    }
    if (method !== "POST") return deps.sendHtml(res, 405, "<!doctype html><p>Use the page's button.</p>", { allow: "GET, POST" });
    const form = new URLSearchParams((await deps.readBody(req, 4096)) ?? "");
    const lang = signinLanguage(req, url, form);
    const done = ACCESS_TOKEN.test(token) ? await backend.signin(token) : { state: "unknown" as const };
    if ("state" in done) {
      if (done.state === "unknown") deps.limiter.take("wrong", address);
      return deps.sendHtml(res, 410, linkPage({ base, link: token, language: lang, state: done.state }), htmlHeaders);
    }
    // the browser that OPENED the link is the one signed in, never the one that asked for it
    return back(`${base}/owner?lang=${lang}`, { "set-cookie": ownerCookie(cookiePath, done.session) });
  }

  // ---- everything below needs a session ----
  const session = sessionFromCookie(req.headers.cookie);
  const json = sub.startsWith("/api/");
  if (!session) {
    if (sub === "" && method === "GET") {
      const passkeys = await passkeyStatus(backend);
      return deps.sendHtml(res, 200, signinPage({ base, language: signinLanguage(req, url), pages, sent: url.searchParams.get("sent") === "1", ...(passkeys ? { passkeys } : {}) }), { ...htmlHeaders, ...signinPolicy(deps.policy, base, passkeys) });
    }
    return json ? deps.sendJson(res, 401, { error: { code: "signed_out", message: "Sign in first: the page sends a link to the owner's WhatsApp." } }) : back(`${base}/owner`);
  }
  if (sub === "/out") {
    if (method !== "POST") return deps.sendHtml(res, 405, "<!doctype html><p>Use the page's button.</p>", { allow: "POST" });
    const form = new URLSearchParams((await deps.readBody(req, 4096)) ?? "");
    if (!csrfMatches(session, form.get("csrf"))) return deps.sendHtml(res, 403, "<!doctype html><p>Forms from another page are refused.</p>");
    await backend.signout(session);
    const language = signinLanguage(req, url, form);
    const passkeys = await passkeyStatus(backend);
    return deps.sendHtml(res, 200, signinPage({ base, language, pages, notice: SIGNIN_WORDS[language].signedOut, ...(passkeys ? { passkeys } : {}) }), { ...htmlHeaders, ...signinPolicy(deps.policy, base, passkeys), "set-cookie": ownerCookie(cookiePath) });
  }
  // the owner's page, its answers and the JSON pair: item 11d's, with the session as the credential and the form token checked on every POST
  return deps.ownerRoute(sub, {
    cred: { session }, base: `${base}/owner`, csrf: csrfFor(session),
    signOut: { action: `${base}/owner/out`, label: SIGNIN_WORDS[signinLanguage(req, url)].signOut },
    // a session that ended (signed out elsewhere, the panel's "sign out every device", a new owner number): the cookie goes and the sign-in page comes back
    onGone: () => (json ? deps.sendJson(res, 401, { error: { code: "signed_out", message: "This session has ended. Sign in again." } }, { "set-cookie": ownerCookie(cookiePath) }) : back(`${base}/owner`, { "set-cookie": ownerCookie(cookiePath) })),
  });
}
