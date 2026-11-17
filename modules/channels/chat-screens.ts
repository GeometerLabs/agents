// Every state of the chat page, by address, for the design review (W1, 17 Nov 2026). It draws the real page (chat-page.ts) with each state seeded from plain data: no runtime,
// no model, no WhatsApp, no network. The states that only the page's script makes (a send in flight, a send that failed, a slow reply, being offline) are put on the page by a
// second, tiny script under the same nonce, so the review sees the very markup and styles the script draws.
//
//   node modules/channels/chat-screens.ts [port]        then open  http://127.0.0.1:<port>/            for the list
//   /<state>?lang=en|hi|ml|kn&kind=bookings|orders|fees&theme=dark&streetlist=1&paint=ff7a59
//
// States: empty, answered (the shop's buttons), long (a long Malayalam-sized line and a link), sending, failed, slow, offline, capped, closed, paused, alerts.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { chatPage } from "./chat-page.ts";
import { chatPolicy } from "./chat-front.ts";
import { LANGUAGES } from "../language/languages.ts";
import type { Language } from "../language/languages.ts";
import type { ChatKind } from "./words-chat.ts";
import type { ChatThread } from "./chat.ts";

const STATES = ["empty", "answered", "long", "sending", "failed", "slow", "offline", "capped", "closed", "paused", "alerts"] as const;
const BASE = "http://127.0.0.1/s/glow/chat";
const font = readFileSync(new URL("./fonts/baloo-2-latin-wght-normal.woff2", import.meta.url));
/** A DiceBear-like tile stands in for the character's picture: a flat square, so the review sees the head's layout (the real picture is the shop's own drawing). */
const FACE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 84"><rect width="84" height="84" fill="#ffd9a0"/><circle cx="30" cy="38" r="5"/><circle cx="54" cy="38" r="5"/><path d="M28 56q14 12 28 0" fill="none" stroke="#000" stroke-width="4"/></svg>')}`;

function threadFor(state: string, now: number): ChatThread {
  const t = (n: number, who: "you" | "shop", text: string, choices?: { id: string; title: string; hint?: string }[]) => ({ n, who, text, atMs: now - (10 - n) * 60_000, ...(choices ? { choices } : {}) });
  const base = { answered: true, capped: state === "capped", retentionDays: 30 };
  if (state === "empty" || state === "closed" || state === "paused") return { lines: [], answered: false, capped: false, retentionDays: 30 };
  if (state === "answered" || state === "alerts" || state === "capped") return { ...base, lines: [t(1, "you", "Book a time"), t(2, "shop", "Which service would you like?", [{ id: "svc:haircut", title: "Haircut", hint: "₹450 · 30 minutes" }, { id: "svc:colour", title: "Colour", hint: "₹1,800 · 90 minutes" }])] };
  if (state === "long") return { ...base, lines: [t(1, "you", "പ്രീമിയം ഹെയർകട്ട് നാളെ വൈകുന്നേരം അഞ്ചുമണിക്ക് ബുക്ക് ചെയ്യാമോ എന്ന് ചോദിക്കാനാണ് ഞാൻ എഴുതുന്നത്"), t(2, "shop", "Held until 10:30. Pay ₹200 with UPI: https://example.com/pay/with/a/very/long/path/that/must/not/break/the/layout/at/three-twenty-pixels\nThen tap I have paid.")] };
  return { ...base, lines: [t(1, "you", "What is the price of a haircut?"), t(2, "shop", "A haircut is ₹450 and takes 30 minutes.")] };
}

/** The script that puts a script-made state on the page, by the same nonce. */
const seed = (state: string, nonce: string, language: Language): string => {
  const body: Record<string, string> = {
    sending: `const r = add("you", "Is 5 pm free tomorrow?"); r.querySelector(".b").classList.add("pending"); r.querySelector(".t").append(" · ...");`,
    failed: `const r = add("you", "Is 5 pm free tomorrow?"); const b = document.createElement("button"); b.type = "button"; b.className = "retry shake"; b.innerHTML = '<span class="stamp">!</span><span></span>'; b.lastChild.textContent = document.documentElement.dataset.failed; r.append(b);`,
    slow: `const r = document.createElement("div"); r.className = "run arrive"; r.innerHTML = '<div class="row-b shop"><p class="b shop dots"><i></i><i></i><i></i></p></div>'; L.append(r);`,
    offline: `document.getElementById("offline").hidden = false;`,
  };
  if (!body[state]) return "";
  return `<script nonce="${nonce}">document.documentElement.dataset.failed = ${JSON.stringify({ en: "Not sent. Tap to send again.", hi: "गया नहीं। फिर से भेजने के लिए दबाएँ।", ml: "പോയില്ല. വീണ്ടും അയയ്ക്കാൻ തൊടൂ.", kn: "ಹೋಗಲಿಲ್ಲ. ಮತ್ತೆ ಕಳುಹಿಸಲು ಒತ್ತಿ." }[language])};
(() => { const L = document.getElementById("lines"); const add = (who, text) => { const r = document.createElement("div"); r.className = "run arrive"; r.innerHTML = '<div class="row-b ' + who + '"><p class="b ' + who + '"></p></div><p class="t ' + who + '"></p>'; r.querySelector(".b").textContent = text; L.insertBefore(r, document.getElementById("alerts-slot")); return r; }; ${body[state]} })();</script>`;
};

export function screen(state: string, q: URLSearchParams, base = BASE): { html: string; csp: string } {
  const language = (LANGUAGES as readonly string[]).includes(q.get("lang") ?? "") ? q.get("lang") as Language : "en";
  const kind = (["bookings", "orders", "fees"].includes(q.get("kind") ?? "") ? q.get("kind") : "bookings") as ChatKind;
  const nonce = "screens-nonce";
  const now = Date.now();
  const closed = state === "closed";
  const page = chatPage({
    shop: {
      name: "Glow Salon", address: "MG Road, Kochi", languages: [...LANGUAGES], paused: state === "paused",
      character: { name: "Glow", face: closed ? "closed" : "well", picture: FACE },
      contact: { phone: "+919811111111" },
      hours: { sun: null, mon: { open: "10:00", close: "20:00" }, tue: { open: "10:00", close: "20:00" }, wed: { open: "10:00", close: "20:00" }, thu: { open: "10:00", close: "20:00" }, fri: { open: "10:00", close: "20:00" }, sat: { open: "10:00", close: "18:00" } },
    },
    kind, language, base, home: "http://127.0.0.1/s/glow", nonce, thread: threadFor(state, now), personality: "cheerful",
    ...(q.get("paint") && /^[0-9a-f]{6}$/iu.test(q.get("paint")!) ? { paint: q.get("paint")! } : {}),
    ...(state === "alerts" ? { pushKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBxWqwxeKV8hxiSaI4Rc" } : {}),
    onStreetlist: q.get("streetlist") === "1", fontUrl: `${base}/font.woff2`,
  });
  const dark = q.get("theme") === "dark" ? `<script nonce="${nonce}">document.documentElement.dataset.theme = "dark";</script>` : "";
  return { html: page.replace("</body>", `${dark}${seed(state, nonce, language)}</body>`), csp: chatPolicy(base, nonce) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? 8799);
  createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const state = url.pathname.slice(1);
    if (url.pathname.endsWith("/font.woff2")) { res.writeHead(200, { "content-type": "font/woff2" }); res.end(font); return; }
    if (!(STATES as readonly string[]).includes(state)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><meta charset="utf-8"><title>Chat screens</title><ul>${STATES.map((s) => `<li><a href="/${s}">${s}</a>`).join("")}</ul>`); return; }
    const { html, csp } = screen(state, url.searchParams, `http://127.0.0.1:${port}`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": csp });
    res.end(html);
  }).listen(port, "127.0.0.1", () => console.log(`Chat screens on http://127.0.0.1:${port}/`));
}
