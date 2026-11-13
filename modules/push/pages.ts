// Web push on the shop's pages (plan item 11h, decision 45): the owner's "Alerts on this phone" box and a customer's "Tell me on this phone" button, their small
// scripts, and the service workers that show the alerts. Used by the public front (modules/channels/front.ts), which serves the owner's at <owner base>/ and a
// customer's on one booking's or order's own page.
//
// Every shop on the pages domain shares one origin, so where a worker sits is what keeps it in its place: the owner's is <owner base>/sw.js with scope <owner base>/
// (that shop's owner view only), and a customer's is <page>/sw.js with scope <page>/ (that one booking's page only, e.g. <base>/b/<handle>/). Neither is ever served
// for a builder's pages on the shared origin: the door serves those without script and refuses a worker's address (bundle/services/door.ts). A worker shows the
// words it is pushed and, when tapped, opens its own scope: no address or code travels in a push.
import type { Language } from "../language/languages.ts";

const esc = (s: string) => s.replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The words. Hindi, Malayalam and Kannada are machine-written and wait for native review (plan item 12), like the rest of the pages. */
export interface AlertWords {
  title: string; intro: string; turnOn: string; turnOff: string; on: (phones: number) => string; off: string; blocked: string; failed: string; iphone: string;
  choice: string; whatsapp: string; push: string; both: string; save: string; saved: string;
  customer: string; customerOn: string; customerNote: string;
}
export const ALERT_WORDS: Record<Language, AlertWords> = {
  en: {
    title: "Alerts on this phone", intro: "Get a buzz when something needs you: a payment to check, a refund to approve, your morning summary.",
    turnOn: "Turn on alerts", turnOff: "Turn off alerts on this phone", on: (n) => (n === 1 ? "Alerts are on for 1 phone." : `Alerts are on for ${n} phones.`), off: "Alerts are off on this phone.",
    blocked: "Alerts are blocked for this page. Allow notifications in your browser's settings, then try again.", failed: "That didn't work. Try again.",
    iphone: "On an iPhone, first add this page to your Home Screen (Share, then Add to Home Screen), and open it from there.",
    choice: "Where should alerts go?", whatsapp: "WhatsApp", push: "This app", both: "Both", save: "Save", saved: "Saved.",
    customer: "Tell me on this phone", customerOn: "You'll get a buzz here if anything changes.", customerNote: "Only news about this page, nothing else. You can turn it off in your phone's settings.",
  },
  hi: {
    title: "इस फ़ोन पर अलर्ट", intro: "जब किसी चीज़ को आपकी ज़रूरत हो, फ़ोन बजेगा: जाँचने को भुगतान, मंज़ूर करने को रिफ़ंड, आपकी सुबह की झलक।",
    turnOn: "अलर्ट चालू करें", turnOff: "इस फ़ोन पर अलर्ट बंद करें", on: (n) => `${n} फ़ोन पर अलर्ट चालू हैं।`, off: "इस फ़ोन पर अलर्ट बंद हैं।",
    blocked: "इस पेज के अलर्ट रोके गए हैं। ब्राउज़र की सेटिंग में नोटिफ़िकेशन की इजाज़त दें, फिर कोशिश करें।", failed: "यह नहीं हुआ। फिर कोशिश करें।",
    iphone: "iPhone पर पहले इस पेज को होम स्क्रीन पर जोड़ें (Share, फिर Add to Home Screen), और वहीं से खोलें।",
    choice: "अलर्ट कहाँ आएँ?", whatsapp: "WhatsApp", push: "यह ऐप", both: "दोनों", save: "सहेजें", saved: "सहेज लिया।",
    customer: "मुझे इस फ़ोन पर बताएँ", customerOn: "कुछ भी बदला तो यहाँ फ़ोन बजेगा।", customerNote: "सिर्फ़ इसी पेज की ख़बर, और कुछ नहीं। फ़ोन की सेटिंग से बंद कर सकते हैं।",
  },
  ml: {
    title: "ഈ ഫോണിൽ അലേർട്ടുകൾ", intro: "നിങ്ങളെ ആവശ്യമുള്ളപ്പോൾ ഫോൺ അറിയിക്കും: പരിശോധിക്കാൻ ഒരു പേയ്‌മെന്റ്, അംഗീകരിക്കാൻ ഒരു റീഫണ്ട്, നിങ്ങളുടെ രാവിലത്തെ ചുരുക്കം.",
    turnOn: "അലേർട്ടുകൾ ഓണാക്കൂ", turnOff: "ഈ ഫോണിൽ അലേർട്ടുകൾ ഓഫാക്കൂ", on: (n) => `${n} ഫോണിൽ അലേർട്ടുകൾ ഓണാണ്.`, off: "ഈ ഫോണിൽ അലേർട്ടുകൾ ഓഫാണ്.",
    blocked: "ഈ പേജിന്റെ അലേർട്ടുകൾ തടഞ്ഞിരിക്കുന്നു. ബ്രൗസർ സെറ്റിംഗ്‌സിൽ നോട്ടിഫിക്കേഷൻ അനുവദിച്ച് വീണ്ടും ശ്രമിക്കൂ.", failed: "അത് നടന്നില്ല. വീണ്ടും ശ്രമിക്കൂ.",
    iphone: "iPhone-ൽ ആദ്യം ഈ പേജ് ഹോം സ്ക്രീനിൽ ചേർക്കൂ (Share, പിന്നെ Add to Home Screen), അവിടെ നിന്ന് തുറക്കൂ.",
    choice: "അലേർട്ടുകൾ എവിടെ വരണം?", whatsapp: "WhatsApp", push: "ഈ ആപ്പ്", both: "രണ്ടും", save: "സേവ് ചെയ്യൂ", saved: "സേവ് ചെയ്തു.",
    customer: "ഈ ഫോണിൽ എന്നെ അറിയിക്കൂ", customerOn: "എന്തെങ്കിലും മാറിയാൽ ഇവിടെ ഫോൺ അറിയിക്കും.", customerNote: "ഈ പേജിനെക്കുറിച്ചുള്ള വിവരം മാത്രം, മറ്റൊന്നുമില്ല. ഫോൺ സെറ്റിംഗ്‌സിൽ നിന്ന് ഓഫാക്കാം.",
  },
  kn: {
    title: "ಈ ಫೋನ್‌ನಲ್ಲಿ ಎಚ್ಚರಿಕೆಗಳು", intro: "ನಿಮ್ಮ ಅಗತ್ಯವಿದ್ದಾಗ ಫೋನ್ ತಿಳಿಸುತ್ತದೆ: ಪರಿಶೀಲಿಸಬೇಕಾದ ಪಾವತಿ, ಒಪ್ಪಬೇಕಾದ ಮರುಪಾವತಿ, ನಿಮ್ಮ ಬೆಳಗಿನ ಸಾರಾಂಶ.",
    turnOn: "ಎಚ್ಚರಿಕೆಗಳನ್ನು ಆನ್ ಮಾಡಿ", turnOff: "ಈ ಫೋನ್‌ನಲ್ಲಿ ಎಚ್ಚರಿಕೆಗಳನ್ನು ಆಫ್ ಮಾಡಿ", on: (n) => `${n} ಫೋನ್‌ಗಳಲ್ಲಿ ಎಚ್ಚರಿಕೆಗಳು ಆನ್ ಆಗಿವೆ.`, off: "ಈ ಫೋನ್‌ನಲ್ಲಿ ಎಚ್ಚರಿಕೆಗಳು ಆಫ್ ಆಗಿವೆ.",
    blocked: "ಈ ಪುಟದ ಎಚ್ಚರಿಕೆಗಳನ್ನು ತಡೆಯಲಾಗಿದೆ. ಬ್ರೌಸರ್ ಸೆಟ್ಟಿಂಗ್‌ಗಳಲ್ಲಿ ನೋಟಿಫಿಕೇಶನ್ ಅನುಮತಿಸಿ, ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.", failed: "ಅದು ಆಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    iphone: "iPhone ನಲ್ಲಿ ಮೊದಲು ಈ ಪುಟವನ್ನು ಹೋಮ್ ಸ್ಕ್ರೀನ್‌ಗೆ ಸೇರಿಸಿ (Share, ನಂತರ Add to Home Screen), ಅಲ್ಲಿಂದ ತೆರೆಯಿರಿ.",
    choice: "ಎಚ್ಚರಿಕೆಗಳು ಎಲ್ಲಿ ಬರಬೇಕು?", whatsapp: "WhatsApp", push: "ಈ ಆಪ್", both: "ಎರಡೂ", save: "ಉಳಿಸಿ", saved: "ಉಳಿಸಲಾಗಿದೆ.",
    customer: "ಈ ಫೋನ್‌ನಲ್ಲಿ ನನಗೆ ತಿಳಿಸಿ", customerOn: "ಏನಾದರೂ ಬದಲಾದರೆ ಇಲ್ಲಿ ಫೋನ್ ತಿಳಿಸುತ್ತದೆ.", customerNote: "ಈ ಪುಟದ ಸುದ್ದಿ ಮಾತ್ರ, ಬೇರೇನೂ ಇಲ್ಲ. ಫೋನ್ ಸೆಟ್ಟಿಂಗ್‌ಗಳಿಂದ ಆಫ್ ಮಾಡಬಹುದು.",
  },
};

/**
 * The shared script: register this page's worker at its own scope, and subscribe on a press with the shop's public key, posting the subscription to `data-save`.
 * `data-off` (owner only) unsubscribes this phone. Hidden until the browser can do push. Nothing is kept in the browser beyond the browser's own subscription.
 */
export const ALERTS_SCRIPT = `(() => {
  const box = document.getElementById("alerts");
  if (!box || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
  const d = box.dataset, on = document.getElementById("alerts-on"), off = document.getElementById("alerts-off"), msg = document.getElementById("alerts-msg");
  const key = Uint8Array.from(atob(d.key.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((d.key.length + 3) % 4)), (c) => c.charCodeAt(0));
  const post = (url, body) => fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", ...(d.csrf ? { "x-owner-csrf": d.csrf } : {}) }, body: JSON.stringify(body) }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
  const reg = navigator.serviceWorker.register(d.sw, { scope: d.scope });
  box.hidden = false;
  const show = async () => { const s = await (await reg).pushManager.getSubscription(); on.hidden = !!s; if (off) off.hidden = !s; if (s && d.saved) msg.textContent = d.saved; };
  show().catch(() => {});
  on.addEventListener("click", async () => {
    on.disabled = true;
    try {
      if ((await Notification.requestPermission()) !== "granted") { msg.textContent = d.blocked; return; }
      const r = await reg;
      const s = (await r.pushManager.getSubscription()) || (await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
      await post(d.save, { subscription: s.toJSON() });
      msg.textContent = d.done;
      if (d.reload) location.reload(); else await show();
    } catch { msg.textContent = d.failed; } finally { on.disabled = false; }
  });
  if (off) off.addEventListener("click", async () => {
    try { const s = await (await reg).pushManager.getSubscription(); if (s) { await post(d.stop, { endpoint: s.endpoint }); await s.unsubscribe(); } location.reload(); } catch { msg.textContent = d.failed; }
  });
})();`;

/** The owner's box. `state`: what the runtime says (choice, phones, whether the shop has WhatsApp); `key`: the shop's VAPID public key. */
export function ownerAlertsBox(o: { base: string; language: Language; key: string; state: { choice: string; phones: number; whatsapp: boolean }; csrf?: string; nonce?: string; notice?: string }): string {
  const w = ALERT_WORDS[o.language];
  const radio = (v: string, label: string) => `<label style="display:block;margin:4px 0"><input type="radio" name="choice" value="${v}"${o.state.choice === v ? " checked" : ""}> ${esc(label)}</label>`;
  const choice = o.state.whatsapp && o.state.phones > 0
    ? `<form method="post" action="${esc(o.base)}/push/choice">${o.csrf ? `<input type="hidden" name="csrf" value="${esc(o.csrf)}">` : ""}<fieldset style="border:0;padding:0;margin:8px 0"><legend>${esc(w.choice)}</legend>${radio("whatsapp", w.whatsapp)}${radio("push", w.push)}${radio("both", w.both)}</fieldset><button type="submit">${esc(w.save)}</button></form>`
    : "";
  return `<section class="alerts" aria-labelledby="alerts-h"><h2 id="alerts-h">${esc(w.title)}</h2><p class="note">${esc(w.intro)}</p>
${o.notice ? `<p class="notice" role="status">${esc(o.notice)}</p>` : ""}<p class="note">${esc(o.state.phones > 0 ? w.on(o.state.phones) : w.off)}</p>
<div id="alerts" hidden data-key="${esc(o.key)}" data-sw="${esc(o.base)}/sw.js" data-scope="${esc(o.base)}/" data-save="${esc(o.base)}/push/subscribe" data-stop="${esc(o.base)}/push/unsubscribe" data-reload="1"
 data-done="${esc(w.on(1))}" data-saved="" data-blocked="${esc(w.blocked)}" data-failed="${esc(w.failed)}"${o.csrf ? ` data-csrf="${esc(o.csrf)}"` : ""}>
<button type="button" id="alerts-on">${esc(w.turnOn)}</button> <button type="button" id="alerts-off" class="no" hidden>${esc(w.turnOff)}</button><p id="alerts-msg" class="note" role="status" aria-live="polite"></p></div>
<p class="note">${esc(w.iphone)}</p>${choice}</section>
<script${o.nonce ? ` nonce="${esc(o.nonce)}"` : ""}>${ALERTS_SCRIPT}</script>`;
}

/** A customer's button on one booking's or order's own page (`page`: its address, no trailing slash). */
export function customerAlertsBox(o: { page: string; language: Language; key: string; phones: number; nonce: string }): string {
  const w = ALERT_WORDS[o.language];
  return `<section class="alerts"><div id="alerts" hidden data-key="${esc(o.key)}" data-sw="${esc(o.page)}/sw.js" data-scope="${esc(o.page)}/" data-save="${esc(o.page)}/push"
 data-done="${esc(w.customerOn)}" data-saved="${esc(w.customerOn)}" data-blocked="${esc(w.blocked)}" data-failed="${esc(w.failed)}">
<button type="button" id="alerts-on">${esc(w.customer)}</button><p id="alerts-msg" class="note" role="status" aria-live="polite">${o.phones > 0 ? esc(w.customerOn) : ""}</p><p class="note">${esc(w.customerNote)}</p></div></section>
<script nonce="${esc(o.nonce)}">${ALERTS_SCRIPT}</script>`;
}

/** The pieces of a worker every push worker has: show the pushed words, and on a tap open (or focus) the worker's own scope. */
export const PUSH_HANDLERS = `
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  e.waitUntil(self.registration.showNotification(String(d.title || "Alert").slice(0, 80), { body: String(d.body || "").slice(0, 400), tag: String(d.tag || "update").slice(0, 40), renotify: true }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = self.registration.scope;
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const mine = open.find((c) => c.url.startsWith(url));
    if (mine) { try { await mine.navigate(url); } catch {} return mine.focus(); }
    return self.clients.openWindow(url);
  })());
});
`;

/** A customer page's worker: alerts only. It keeps nothing and fetches nothing. */
export const CUSTOMER_SW = `// One booking's page: alerts the customer allowed, nothing else (no cache, no fetch).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));${PUSH_HANDLERS}`;
