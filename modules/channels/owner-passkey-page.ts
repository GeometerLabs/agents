// The owner's passkey pages on the shop's page (plan item 11h, decisions 45 and 46), the front's side: what the owner sees and the one small script that talks to
// the phone's passkey (navigator.credentials). Used by owner-session.ts, which hands these routes over under <base>/owner:
//
//   GET  <base>/owner/setup/<token>            the partner's setup QR opens this: "Set up sign-in on this phone" (the token's state from the runtime; nothing used)
//   POST <base>/owner/setup/<token>/options    JSON: the runtime's options for navigator.credentials.create (a fresh challenge for this QR)
//   POST <base>/owner/setup/<token>/finish     JSON: the phone's answer, to the runtime, which keeps the passkey, uses the QR up and makes a session: the cookie
//   GET  <base>/owner/recover, POST            the recovery card: type a code; a good one gives the same setup page, with the code instead of the QR's token
//   POST <base>/owner/recover/options, /finish JSON, as for the QR, with {"code"}
//   POST <base>/owner/passkey/options          JSON: a challenge and this shop's passkeys, for navigator.credentials.get
//   POST <base>/owner/passkey/finish           JSON: the phone's answer; a good one makes a session: the cookie
//
// Nothing is decided here: the runtime checks the grant, the challenge, the origin, the signature and the counter (owner-access.ts, webauthn.ts). This file only
// draws the pages, counts wrong tokens and codes per address, and carries JSON. The pages origin runs no script but Geometer's own, so each page with the
// script gets a policy naming its nonce and exactly the two addresses the script posts to (`passkeyPolicy`), never 'self'.
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { html } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import type { Language } from "../language/languages.ts";
import type { ChannelBackend } from "./backend.ts";
import type { Limiter } from "./limits.ts";
import { RECOVERY_CODE, SETUP_TOKEN, normalCode } from "./owner-grants.ts";

/** The words of the passkey pages. Hindi, Malayalam and Kannada are machine-written and wait for native review (plan item 12); the page says so. */
export interface PasskeyWords {
  signIn: string; note: string; none: string; failed: string; wait: string; recoverLink: string; introNoWhatsapp: string;
  setupTitle: string; setupIntro: (shop: string) => string; setupButton: string; done: string;
  state: { used: string; expired: string; unknown: string; locked: string };
  recoverTitle: string; recoverIntro: string; recoverField: string; recoverButton: string; noScript: string;
}
export const PASSKEY_WORDS: Record<Language, PasskeyWords> = {
  en: {
    signIn: "Sign in with your fingerprint", note: "Uses your phone's fingerprint or screen lock. No password.", none: "First time on this phone? Ask your partner for the setup QR code.",
    failed: "That didn't work. Try again, or use another way below.", wait: "Waiting for your phone…", recoverLink: "Lost your phone? Use your recovery card",
    introNoWhatsapp: "This page is for the shop's owner. You sign in with your phone's fingerprint or screen lock.",
    setupTitle: "Set up sign-in on this phone", setupIntro: (shop) => `From now on you sign in to ${shop} with your fingerprint or screen lock. No password, no WhatsApp needed.`,
    setupButton: "Set up with my fingerprint", done: "All set! Opening your shop…",
    state: { used: "This code was used already. Ask your partner for a new one.", expired: "This code has run out. Ask your partner to show a new one.", unknown: "This code doesn't work. Ask your partner for a new one.", locked: "Too many tries today. Ask your partner for a new setup code." },
    recoverTitle: "Use your recovery card", recoverIntro: "Type one of the codes on the card your partner gave you. Each code works once.", recoverField: "Code", recoverButton: "Next",
    noScript: "This needs a phone browser with JavaScript on. Chrome works.",
  },
  hi: {
    signIn: "फ़िंगरप्रिंट से साइन इन करें", note: "आपके फ़ोन का फ़िंगरप्रिंट या स्क्रीन लॉक काम आता है। कोई पासवर्ड नहीं।", none: "इस फ़ोन पर पहली बार? अपने पार्टनर से सेटअप QR कोड माँगिए।",
    failed: "यह नहीं हुआ। फिर कोशिश करें, या नीचे दूसरा तरीका अपनाएँ।", wait: "आपके फ़ोन का इंतज़ार…", recoverLink: "फ़ोन खो गया? अपना रिकवरी कार्ड इस्तेमाल करें",
    introNoWhatsapp: "यह पेज दुकान के मालिक के लिए है। आप अपने फ़ोन के फ़िंगरप्रिंट या स्क्रीन लॉक से साइन इन करते हैं।",
    setupTitle: "इस फ़ोन पर साइन-इन सेट करें", setupIntro: (shop) => `अब से आप ${shop} में अपने फ़िंगरप्रिंट या स्क्रीन लॉक से साइन इन करेंगे। न पासवर्ड, न WhatsApp की ज़रूरत।`,
    setupButton: "मेरे फ़िंगरप्रिंट से सेट करें", done: "हो गया! आपकी दुकान खुल रही है…",
    state: { used: "यह कोड पहले ही इस्तेमाल हो चुका है। अपने पार्टनर से नया माँगिए।", expired: "इस कोड का समय ख़त्म हो गया। अपने पार्टनर से नया दिखाने को कहिए।", unknown: "यह कोड काम नहीं करता। अपने पार्टनर से नया माँगिए।", locked: "आज बहुत बार कोशिश हुई। अपने पार्टनर से नया सेटअप कोड माँगिए।" },
    recoverTitle: "अपना रिकवरी कार्ड इस्तेमाल करें", recoverIntro: "पार्टनर के दिए कार्ड का कोई एक कोड लिखिए। हर कोड एक बार चलता है।", recoverField: "कोड", recoverButton: "आगे",
    noScript: "इसके लिए JavaScript वाला फ़ोन ब्राउज़र चाहिए। Chrome चलता है।",
  },
  ml: {
    signIn: "വിരലടയാളം കൊണ്ട് സൈൻ ഇൻ ചെയ്യൂ", note: "നിങ്ങളുടെ ഫോണിലെ വിരലടയാളമോ സ്ക്രീൻ ലോക്കോ ഉപയോഗിക്കുന്നു. പാസ്‌വേഡ് ഇല്ല.", none: "ഈ ഫോണിൽ ആദ്യമായാണോ? നിങ്ങളുടെ പങ്കാളിയോട് സെറ്റപ്പ് QR കോഡ് ചോദിക്കൂ.",
    failed: "അത് നടന്നില്ല. വീണ്ടും ശ്രമിക്കൂ, അല്ലെങ്കിൽ താഴെയുള്ള മറ്റൊരു വഴി ഉപയോഗിക്കൂ.", wait: "നിങ്ങളുടെ ഫോണിനായി കാത്തിരിക്കുന്നു…", recoverLink: "ഫോൺ നഷ്ടപ്പെട്ടോ? റിക്കവറി കാർഡ് ഉപയോഗിക്കൂ",
    introNoWhatsapp: "ഈ പേജ് കടയുടമയ്ക്കുള്ളതാണ്. ഫോണിലെ വിരലടയാളമോ സ്ക്രീൻ ലോക്കോ കൊണ്ട് സൈൻ ഇൻ ചെയ്യാം.",
    setupTitle: "ഈ ഫോണിൽ സൈൻ ഇൻ സജ്ജമാക്കൂ", setupIntro: (shop) => `ഇനി മുതൽ ${shop}-ൽ നിങ്ങളുടെ വിരലടയാളമോ സ്ക്രീൻ ലോക്കോ കൊണ്ട് സൈൻ ഇൻ ചെയ്യാം. പാസ്‌വേഡും WhatsApp-ഉം വേണ്ട.`,
    setupButton: "എന്റെ വിരലടയാളം കൊണ്ട് സജ്ജമാക്കൂ", done: "എല്ലാം ശരിയായി! നിങ്ങളുടെ കട തുറക്കുന്നു…",
    state: { used: "ഈ കോഡ് ഇതിനകം ഉപയോഗിച്ചു. പങ്കാളിയോട് പുതിയത് ചോദിക്കൂ.", expired: "ഈ കോഡിന്റെ സമയം കഴിഞ്ഞു. പുതിയത് കാണിക്കാൻ പങ്കാളിയോട് പറയൂ.", unknown: "ഈ കോഡ് പ്രവർത്തിക്കുന്നില്ല. പങ്കാളിയോട് പുതിയത് ചോദിക്കൂ.", locked: "ഇന്ന് വളരെയധികം ശ്രമങ്ങൾ. പങ്കാളിയോട് പുതിയ സെറ്റപ്പ് കോഡ് ചോദിക്കൂ." },
    recoverTitle: "റിക്കവറി കാർഡ് ഉപയോഗിക്കൂ", recoverIntro: "പങ്കാളി തന്ന കാർഡിലെ ഒരു കോഡ് ടൈപ്പ് ചെയ്യൂ. ഓരോ കോഡും ഒരിക്കൽ മാത്രം.", recoverField: "കോഡ്", recoverButton: "അടുത്തത്",
    noScript: "ഇതിന് JavaScript ഉള്ള ഫോൺ ബ്രൗസർ വേണം. Chrome മതി.",
  },
  kn: {
    signIn: "ಬೆರಳಚ್ಚಿನಿಂದ ಸೈನ್ ಇನ್ ಮಾಡಿ", note: "ನಿಮ್ಮ ಫೋನ್‌ನ ಬೆರಳಚ್ಚು ಅಥವಾ ಸ್ಕ್ರೀನ್ ಲಾಕ್ ಬಳಸುತ್ತದೆ. ಪಾಸ್‌ವರ್ಡ್ ಇಲ್ಲ.", none: "ಈ ಫೋನ್‌ನಲ್ಲಿ ಮೊದಲ ಬಾರಿಯೇ? ನಿಮ್ಮ ಪಾಲುದಾರರಿಂದ ಸೆಟಪ್ QR ಕೋಡ್ ಕೇಳಿ.",
    failed: "ಅದು ಆಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ, ಅಥವಾ ಕೆಳಗಿನ ಇನ್ನೊಂದು ದಾರಿ ಬಳಸಿ.", wait: "ನಿಮ್ಮ ಫೋನ್‌ಗಾಗಿ ಕಾಯುತ್ತಿದೆ…", recoverLink: "ಫೋನ್ ಕಳೆದುಹೋಯಿತೇ? ರಿಕವರಿ ಕಾರ್ಡ್ ಬಳಸಿ",
    introNoWhatsapp: "ಈ ಪುಟ ಅಂಗಡಿಯ ಮಾಲೀಕರಿಗಾಗಿ. ನಿಮ್ಮ ಫೋನ್‌ನ ಬೆರಳಚ್ಚು ಅಥವಾ ಸ್ಕ್ರೀನ್ ಲಾಕ್‌ನಿಂದ ಸೈನ್ ಇನ್ ಮಾಡುತ್ತೀರಿ.",
    setupTitle: "ಈ ಫೋನ್‌ನಲ್ಲಿ ಸೈನ್ ಇನ್ ಹೊಂದಿಸಿ", setupIntro: (shop) => `ಇನ್ನು ಮುಂದೆ ${shop}ಗೆ ನಿಮ್ಮ ಬೆರಳಚ್ಚು ಅಥವಾ ಸ್ಕ್ರೀನ್ ಲಾಕ್‌ನಿಂದ ಸೈನ್ ಇನ್ ಮಾಡುತ್ತೀರಿ. ಪಾಸ್‌ವರ್ಡ್ ಬೇಡ, WhatsApp ಬೇಡ.`,
    setupButton: "ನನ್ನ ಬೆರಳಚ್ಚಿನಿಂದ ಹೊಂದಿಸಿ", done: "ಎಲ್ಲಾ ಸಿದ್ಧ! ನಿಮ್ಮ ಅಂಗಡಿ ತೆರೆಯುತ್ತಿದೆ…",
    state: { used: "ಈ ಕೋಡ್ ಈಗಾಗಲೇ ಬಳಸಲಾಗಿದೆ. ಪಾಲುದಾರರಿಂದ ಹೊಸದನ್ನು ಕೇಳಿ.", expired: "ಈ ಕೋಡ್‌ನ ಸಮಯ ಮುಗಿದಿದೆ. ಹೊಸದನ್ನು ತೋರಿಸಲು ಪಾಲುದಾರರಿಗೆ ಹೇಳಿ.", unknown: "ಈ ಕೋಡ್ ಕೆಲಸ ಮಾಡುವುದಿಲ್ಲ. ಪಾಲುದಾರರಿಂದ ಹೊಸದನ್ನು ಕೇಳಿ.", locked: "ಇಂದು ತುಂಬಾ ಪ್ರಯತ್ನಗಳು. ಪಾಲುದಾರರಿಂದ ಹೊಸ ಸೆಟಪ್ ಕೋಡ್ ಕೇಳಿ." },
    recoverTitle: "ರಿಕವರಿ ಕಾರ್ಡ್ ಬಳಸಿ", recoverIntro: "ಪಾಲುದಾರರು ಕೊಟ್ಟ ಕಾರ್ಡ್‌ನ ಒಂದು ಕೋಡ್ ಟೈಪ್ ಮಾಡಿ. ಪ್ರತಿ ಕೋಡ್ ಒಮ್ಮೆ ಮಾತ್ರ.", recoverField: "ಕೋಡ್", recoverButton: "ಮುಂದೆ",
    noScript: "ಇದಕ್ಕೆ JavaScript ಇರುವ ಫೋನ್ ಬ್ರೌಸರ್ ಬೇಕು. Chrome ಆಗುತ್ತದೆ.",
  },
};

/** The pages' content policy plus this response's nonce and exactly the addresses its script posts to. The pages origin is shared: never 'self'. */
export const passkeyPolicy = (policy: string, nonce: string, connect: readonly string[]): string => `${policy}; script-src 'nonce-${nonce}'; connect-src ${connect.join(" ")}`;

/**
 * The script, the same for the three pages: the button `#pk` is hidden until the phone can do passkeys; a press asks the front for the options, hands them to
 * the phone, posts the phone's answer back and goes where the answer says. `data-mode` is "register" or "signin". Nothing is kept in the browser.
 */
export const PASSKEY_SCRIPT = `(() => {
  const btn = document.getElementById("pk"), msg = document.getElementById("pk-msg");
  if (!btn || !window.PublicKeyCredential || !navigator.credentials) return;
  const d = btn.dataset;
  const bin = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  const txt = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  const post = async (url, body) => {
    const r = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error("refused"), { j });
    return j;
  };
  const ids = (list) => (list || []).map((x) => ({ type: x.type, id: bin(x.id) }));
  btn.hidden = false;
  btn.addEventListener("click", async () => {
    btn.disabled = true; msg.textContent = d.wait;
    try {
      const grant = d.code ? { code: d.code } : {};
      const o = (await post(d.options, grant)).options;
      let answer;
      if (d.mode === "register") {
        const c = await navigator.credentials.create({ publicKey: { ...o, challenge: bin(o.challenge), user: { ...o.user, id: bin(o.user.id) }, excludeCredentials: ids(o.excludeCredentials) } });
        answer = { clientDataJSON: txt(c.response.clientDataJSON), attestationObject: txt(c.response.attestationObject) };
      } else {
        const g = await navigator.credentials.get({ publicKey: { ...o, challenge: bin(o.challenge), allowCredentials: ids(o.allowCredentials) } });
        answer = { id: g.id, clientDataJSON: txt(g.response.clientDataJSON), authenticatorData: txt(g.response.authenticatorData), signature: txt(g.response.signature), ...(g.response.userHandle ? { userHandle: txt(g.response.userHandle) } : {}) };
      }
      const done = await post(d.finish, { ...grant, response: answer });
      msg.textContent = d.done;
      location.href = done.next;
    } catch (e) {
      msg.textContent = (e && e.j && e.j.message) || d.failed;
      btn.disabled = false;
    }
  });
})();`;

/** The button and its message line, with the words the script shows. */
export function passkeyButton(o: { mode: "register" | "signin"; options: string; finish: string; label: string; language: Language; code?: string }): Raw {
  const w = PASSKEY_WORDS[o.language];
  return html`<p><button type="button" id="pk" hidden data-mode="${o.mode}" data-options="${o.options}" data-finish="${o.finish}" data-wait="${w.wait}" data-failed="${w.failed}" data-done="${w.done}"${o.code ? html` data-code="${o.code}"` : ""}>${o.label}</button></p>
<p id="pk-msg" class="note" role="status" aria-live="polite"></p><noscript><p class="note">${w.noScript}</p></noscript>`;
}

/** What owner-session.ts lends these routes: its helpers, and how it draws a page and sets the session cookie. */
export interface PasskeyDeps {
  limiter: Limiter;
  sendHtml(res: ServerResponse, status: number, body: string, extra?: Record<string, string>): void;
  sendJson(res: ServerResponse, status: number, value: unknown, extra?: Record<string, string>): void;
  readBody(req: IncomingMessage, max: number): Promise<string | undefined>;
  /** A whole page in the sign-in pages' frame (owner-session.ts `page`). */
  page(language: Language, title: string, body: Raw, nonce?: string): string;
  /** The Set-Cookie header for a new session at this shop's owner path. */
  cookie(session: string): string;
  /** The pages' policy (front.ts PAGE_POLICY). */
  policy: string;
}

/** Is this request one of the passkey routes (so owner-session.ts hands it here)? */
export const isPasskeyRoute = (sub: string): boolean => /^\/(setup\/[^/]+(\/options|\/finish)?|recover(\/options|\/finish)?|passkey\/(options|finish))$/u.test(sub);

/** One passkey request under <base>/owner. `language` is the visitor's (owner-session.ts reads it); `address` the visitor's, for the front's counts. */
export async function passkeyRoute(deps: PasskeyDeps, a: { req: IncomingMessage; res: ServerResponse; base: string; sub: string; address: string; backend: ChannelBackend; language: Language }): Promise<void> {
  const { req, res, base, sub, address, backend, language } = a;
  const w = PASSKEY_WORDS[language];
  const method = req.method ?? "GET";
  const owner = `${base}/owner`;
  const noindex = { "x-robots-tag": "noindex" };
  if (!backend.passkey) return deps.sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
  const call = backend.passkey.bind(backend);
  const json = async (max = 16 * 1024): Promise<Record<string, unknown>> => { try { return JSON.parse((await deps.readBody(req, max)) ?? "{}") as Record<string, unknown>; } catch { return {}; } };
  const tooMany = () => (method === "GET" || sub === "/recover" ? deps.sendHtml(res, 429, deps.page(language, w.recoverTitle, html`<p class="notice">${w.state.locked}</p>`), { "retry-after": "600" }) : deps.sendJson(res, 429, { message: w.state.locked }, { "retry-after": "600" }));
  if (deps.limiter.over("wrong", address)) return tooMany();
  // every POST (a challenge asked for, an answer posted) counts as an act of this address, as a page's buttons do: a flood is slowed before the runtime is asked
  if (method === "POST" && !deps.limiter.take("act", address)) return tooMany();
  /** The shop's name, for the setup page's words (the runtime says it with the grant's state). */
  let shop = "";
  /** A grant the runtime does not know is a guess: counted per address, as a wrong sign-in link is. */
  const stateOf = async (grant: Record<string, unknown>): Promise<string> => {
    const r = await call({ op: "grant_state", grant });
    const state = typeof r.body.state === "string" ? r.body.state : "unknown";
    if (typeof r.body.shop === "string") shop = r.body.shop;
    if (state === "unknown") deps.limiter.take("wrong", address);
    return state;
  };
  /** The setup page, for the QR's token or a recovery code: the button, or why not. */
  const setupPage = (state: string, endpoints: { options: string; finish: string }, code?: string): void => {
    if (state !== "valid") {
      const why = w.state[(state in w.state ? state : "unknown") as keyof PasskeyWords["state"]];
      return deps.sendHtml(res, 410, deps.page(language, w.setupTitle, html`<h1>${w.setupTitle}</h1><p class="notice">${why}</p><p><a href="${owner}?lang=${language}">${w.signIn}</a></p>`), noindex);
    }
    const nonce = randomBytes(16).toString("base64");
    const body = html`<h1>${w.setupTitle}</h1><p>${w.setupIntro(shop)}</p>${passkeyButton({ mode: "register", ...endpoints, label: w.setupButton, language, ...(code ? { code } : {}) })}`;
    deps.sendHtml(res, 200, deps.page(language, w.setupTitle, body, nonce), { ...noindex, "content-security-policy": passkeyPolicy(deps.policy, nonce, [endpoints.options, endpoints.finish]) });
  };
  /** The runtime's answer to a finished ceremony: the cookie and where to go, or why not. */
  const finished = (r: { status: number; body: Record<string, unknown> }): void => {
    if (r.status === 200 && typeof r.body.session === "string") return deps.sendJson(res, 200, { next: `${owner}/?lang=${language}` }, { "set-cookie": deps.cookie(r.body.session) });
    const state = typeof r.body.state === "string" && r.body.state in w.state ? w.state[r.body.state as keyof PasskeyWords["state"]] : undefined;
    return deps.sendJson(res, 403, { message: state ?? w.failed });
  };

  // ---- the partner's setup QR ----
  const setup = /^\/setup\/([^/]+)(\/options|\/finish)?$/u.exec(sub);
  if (setup) {
    const token = setup[1];
    if (!SETUP_TOKEN.test(token)) { deps.limiter.take("wrong", address); return method === "GET" ? setupPage("unknown", { options: "", finish: "" }) : deps.sendJson(res, 403, { message: w.state.unknown }); }
    const grant = { kind: "setup", token };
    const endpoints = { options: `${owner}/setup/${token}/options`, finish: `${owner}/setup/${token}/finish` };
    if (!setup[2]) {
      if (method !== "GET") return deps.sendHtml(res, 405, "<!doctype html><p>Use the page's button.</p>", { allow: "GET" });
      // a GET never uses the QR up (a scanner app may open it first): it only shows the button
      return setupPage(await stateOf(grant), endpoints);
    }
    if (method !== "POST") return deps.sendJson(res, 405, { message: "POST" }, { allow: "POST" });
    if (setup[2] === "/options") {
      const r = await call({ op: "register_options", grant });
      if (r.status !== 200) { if (r.body.state === "unknown") deps.limiter.take("wrong", address); return deps.sendJson(res, 403, { message: w.state[(r.body.state as keyof PasskeyWords["state"]) ?? "unknown"] ?? w.failed }); }
      return deps.sendJson(res, 200, { options: r.body.options });
    }
    const body = await json();
    return finished(await call({ op: "register", grant, response: body.response }));
  }

  // ---- the recovery card ----
  if (sub === "/recover" && method === "GET") {
    return deps.sendHtml(res, 200, deps.page(language, w.recoverTitle, html`<h1>${w.recoverTitle}</h1><p>${w.recoverIntro}</p>
<form method="post" action="${owner}/recover"><input type="hidden" name="lang" value="${language}"><label for="rc">${w.recoverField}</label><br><input id="rc" name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="20" required style="font-size:1.2rem;letter-spacing:.1em;padding:8px;margin-top:6px"><br><button type="submit">${w.recoverButton}</button></form>
<p><a href="${owner}?lang=${language}">${w.signIn}</a></p>`), noindex);
  }
  const recover = /^\/recover(\/options|\/finish)?$/u.exec(sub);
  if (recover) {
    if (method !== "POST") return deps.sendHtml(res, 405, "<!doctype html><p>Use the page's button.</p>", { allow: "GET, POST" });
    if (!recover[1]) {
      const form = new URLSearchParams((await deps.readBody(req, 4096)) ?? "");
      const code = normalCode(form.get("code") ?? "");
      if (!RECOVERY_CODE.test(code)) { deps.limiter.take("wrong", address); return setupPage("unknown", { options: "", finish: "" }); }
      return setupPage(await stateOf({ kind: "recovery", code }), { options: `${owner}/recover/options`, finish: `${owner}/recover/finish` }, code);
    }
    const body = await json();
    const code = normalCode(typeof body.code === "string" ? body.code : "");
    if (!RECOVERY_CODE.test(code)) { deps.limiter.take("wrong", address); return deps.sendJson(res, 403, { message: w.state.unknown }); }
    const grant = { kind: "recovery", code };
    if (recover[1] === "/options") {
      const r = await call({ op: "register_options", grant });
      if (r.status !== 200) { if (r.body.state === "unknown") deps.limiter.take("wrong", address); return deps.sendJson(res, 403, { message: w.state[(r.body.state as keyof PasskeyWords["state"]) ?? "unknown"] ?? w.failed }); }
      return deps.sendJson(res, 200, { options: r.body.options });
    }
    return finished(await call({ op: "register", grant, response: body.response }));
  }

  // ---- signing in with the passkey ----
  if (method !== "POST") return deps.sendJson(res, 405, { message: "POST" }, { allow: "POST" });
  if (sub === "/passkey/options") {
    const r = await call({ op: "signin_options" });
    if (r.status !== 200 || !r.body.options) return deps.sendJson(res, 403, { message: w.none });
    return deps.sendJson(res, 200, { options: r.body.options });
  }
  const body = await json();
  const r = await call({ op: "signin", response: body.response });
  if (r.status !== 200) deps.limiter.take("wrong", address);
  return finished(r);
}
