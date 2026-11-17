// Every state of the chat page, by address, for the design review (W1, 17 Nov 2026). It draws the real page (chat-page.ts) with each state seeded from plain data: no runtime,
// no model, no WhatsApp, no network. The states that only the page's script makes (a send in flight, a send that failed, a slow reply, being offline) are put on the page by a
// second, tiny script under the same nonce, so the review sees the very markup and styles the script draws.
//
//   node modules/channels/chat-screens.ts [port]        then open  http://127.0.0.1:<port>/            for the list
//   /<state>?lang=en|hi|ml|kn&kind=bookings|orders|fees&theme=dark&streetlist=1&paint=pink|blue|green|marigold|brick
//
// States: empty (the awning unrolls when the phone welcomes motion), answered (the shop's buttons), long (a long Malayalam-sized line and a link), sending, failed, slow, offline,
// capped, closed, paused, alerts, and (17 Nov 2026):
//   confirmed, paid          a thread whose line the record marks, drawn as after a reload: the still picture and the sentence, no motion
//   confirmed-live, paid-live  the same line ARRIVES while the page is open: the Lottie plays once, the head shows the well face with one hop (turn the browser's reduced-motion
//                            emulation on to see the still picture and no hop instead)
//   voice, recording         the shop has a voice service: the microphone button (a browser that cannot record shows none), and the moment of holding it
//   busy                     the head in the "busy" mood with DiceBear's animation (the picture is a stand-in drawing that moves, so the review sees the swap and the policy)
//   ?paint=<id>              any state on a signboard paint; paints lists all five at once with their text colours and contrast
// It serves the real player and the real animation files at the addresses the page asks for, under the real policy, so a policy mistake shows up here.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { identityBlock } from "./chat-identity-page.ts";
import { chatPage } from "./chat-page.ts";
import { chatPolicy } from "./chat-front.ts";
import { PAINT_IDS, PAINTS, contrastRatio, isPaint } from "./chat-paint.ts";
import { MOMENTS } from "./chat-motion.ts";
import { LANGUAGES } from "../language/languages.ts";
import type { Language } from "../language/languages.ts";
import type { ChatKind } from "./words-chat.ts";
import type { ChatThread } from "./chat.ts";

const STATES = ["empty", "answered", "long", "sending", "failed", "slow", "offline", "capped", "closed", "paused", "alerts", "confirmed", "paid", "confirmed-live", "paid-live", "voice", "recording", "busy", "keep", "newphone", "paints"] as const;
const BASE = "http://127.0.0.1/s/glow/chat";
const font = readFileSync(new URL("./fonts/baloo-2-latin-wght-normal.woff2", import.meta.url));
const playerJs = readFileSync(new URL("./vendor/lottie/lottie_light.min.js", import.meta.url));
/** A stand-in for DiceBear's animated drawing of a mood: the same square tile, with a gentle squash, so the review sees the animated source and the swap to the well face. */
const animatedFace = (mood: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 84"><style>@media (prefers-reduced-motion: no-preference){.f{transform-origin:42px 84px;animation:s 2.4s ease-in-out infinite}@keyframes s{50%{transform:scale(1.04,.96)}}}</style><g class="f"><rect width="84" height="84" fill="${mood === "well" ? "#c9efd5" : "#ffd9a0"}"/><circle cx="30" cy="38" r="5"/><circle cx="54" cy="38" r="5"/><path d="M28 56q14 12 28 0" fill="none" stroke="#000" stroke-width="4"/></g></svg>`;
/** A DiceBear-like tile stands in for the character's picture: a flat square, so the review sees the head's layout (the real picture is the shop's own drawing). */
const FACE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 84"><rect width="84" height="84" fill="#ffd9a0"/><circle cx="30" cy="38" r="5"/><circle cx="54" cy="38" r="5"/><path d="M28 56q14 12 28 0" fill="none" stroke="#000" stroke-width="4"/></svg>')}`;

function threadFor(state: string, now: number): ChatThread {
  const t = (n: number, who: "you" | "shop", text: string, choices?: { id: string; title: string; hint?: string }[]) => ({ n, who, text, atMs: now - (10 - n) * 60_000, ...(choices ? { choices } : {}) });
  const base = { answered: true, capped: state === "capped", retentionDays: 30 };
  if (state === "empty" || state === "closed" || state === "paused") return { lines: [], answered: false, capped: false, retentionDays: 30 };
  if (state === "answered" || state === "alerts" || state === "capped") return { ...base, lines: [t(1, "you", "Book a time"), t(2, "shop", "Which service would you like?", [{ id: "svc:haircut", title: "Haircut", hint: "₹450 · 30 minutes" }, { id: "svc:colour", title: "Colour", hint: "₹1,800 · 90 minutes" }])] };
  if (state === "confirmed" || state === "confirmed-live" || state === "paid" || state === "paid-live") {
    const live = state.endsWith("-live");
    const paid = state.startsWith("paid");
    const first = [t(1, "you", "Yes, book it"), t(2, "shop", paid ? "Held until 10:30. Pay ₹200 with UPI, then tap I have paid." : "Held. Tap Confirm to book it.")];
    return { ...base, lines: live ? first : [...first, { ...t(3, "shop", paid ? "Payment of ₹200 received. Your haircut is booked for 5:00 pm tomorrow." : "Booked: haircut tomorrow at 5:00 pm."), moment: paid ? "paid" as const : "confirmed" as const }] };
  }
  if (state === "long") return { ...base, lines: [t(1, "you", "പ്രീമിയം ഹെയർകട്ട് നാളെ വൈകുന്നേരം അഞ്ചുമണിക്ക് ബുക്ക് ചെയ്യാമോ എന്ന് ചോദിക്കാനാണ് ഞാൻ എഴുതുന്നത്"), t(2, "shop", "Held until 10:30. Pay ₹200 with UPI: https://example.com/pay/with/a/very/long/path/that/must/not/break/the/layout/at/three-twenty-pixels\nThen tap I have paid.")] };
  return { ...base, lines: [t(1, "you", "What is the price of a haircut?"), t(2, "shop", "A haircut is ₹450 and takes 30 minutes.")] };
}

/** The arriving line of a "-live" state, answered by the screens' own /thread, so the page's poll finds it exactly as it would from a shop. */
const arriving = (state: string, now: number) => ({
  lines: [{ n: 3, who: "shop", atMs: now, text: state.startsWith("paid") ? "Payment of ₹200 received. Your haircut is booked for 5:00 pm tomorrow." : "Booked: haircut tomorrow at 5:00 pm.", moment: state.startsWith("paid") ? "paid" : "confirmed" }],
  answered: true, capped: false, retentionDays: 30,
});

/** The script that puts a script-made state on the page, by the same nonce. */
const seed = (state: string, nonce: string, language: Language): string => {
  const body: Record<string, string> = {
    sending: `const r = add("you", "Is 5 pm free tomorrow?"); r.querySelector(".b").classList.add("pending"); r.querySelector(".t").append(" · ...");`,
    failed: `const r = add("you", "Is 5 pm free tomorrow?"); const b = document.createElement("button"); b.type = "button"; b.className = "retry shake"; b.innerHTML = '<span class="stamp">!</span><span></span>'; b.lastChild.textContent = document.documentElement.dataset.failed; r.append(b);`,
    slow: `const r = document.createElement("div"); r.className = "run arrive"; r.innerHTML = '<div class="row-b shop"><p class="b shop dots"><i></i><i></i><i></i></p></div>'; L.append(r);`,
    offline: `document.getElementById("offline").hidden = false;`,
    // the arriving line is fetched by the page's own poll, which a visibility change asks for at once
    "confirmed-live": `setTimeout(() => document.dispatchEvent(new Event("visibilitychange")), 900);`,
    "paid-live": `setTimeout(() => document.dispatchEvent(new Event("visibilitychange")), 900);`,
    // the moment of holding the microphone: the button pressed, the red note above the composer
    recording: `const b = document.getElementById("rec"); if (b) { b.hidden = false; b.classList.add("on"); } const n = document.createElement("p"); n.className = "rec-note"; n.setAttribute("role", "status"); n.append(document.createElement("i"), ${JSON.stringify({ en: "Release to send", hi: "भेजने के लिए छोड़ें", ml: "അയയ്ക്കാൻ വിടൂ", kn: "ಕಳುಹಿಸಲು ಬಿಡಿ" }[language])}); document.getElementById("notes").append(n);`,
  };
  if (!body[state]) return "";
  return `<script nonce="${nonce}">document.documentElement.dataset.failed = ${JSON.stringify({ en: "Not sent. Tap to send again.", hi: "गया नहीं। फिर से भेजने के लिए दबाएँ।", ml: "പോയില്ല. വീണ്ടും അയയ്ക്കാൻ തൊടൂ.", kn: "ಹೋಗಲಿಲ್ಲ. ಮತ್ತೆ ಕಳುಹಿಸಲು ಒತ್ತಿ." }[language])};
(() => { const L = document.getElementById("lines"); const add = (who, text) => { const r = document.createElement("div"); r.className = "run arrive"; r.innerHTML = '<div class="row-b ' + who + '"><p class="b ' + who + '"></p></div><p class="t ' + who + '"></p>'; r.querySelector(".b").textContent = text; L.insertBefore(r, document.getElementById("alerts-slot")); return r; }; ${body[state]} })();</script>`;
};

/** The "paints" page: every signboard paint with its text colour and the contrast the review checks (4.5 or more), each next to what it is on. Plain, not the chat itself. */
function paintsPage(): string {
  const rows = PAINT_IDS.map((id) => `<li style="background:${PAINTS[id].hex};color:${PAINTS[id].ink};padding:14px 16px;font:700 1.2rem system-ui;display:flex;justify-content:space-between"><span>${id}</span><span>${PAINTS[id].hex} on ${PAINTS[id].ink}: ${contrastRatio(PAINTS[id].hex, PAINTS[id].ink).toFixed(2)} : 1</span></li>`).join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signboard paints</title><ul style="list-style:none;margin:0;padding:0">${rows}</ul><p style="font:1rem system-ui;padding:12px 16px">Open any state with ?paint=&lt;id&gt; to see the whole head on a paint.</p>`;
}

export function screen(state: string, q: URLSearchParams, base = BASE): { html: string; csp: string } {
  const language = (LANGUAGES as readonly string[]).includes(q.get("lang") ?? "") ? q.get("lang") as Language : "en";
  const kind = (["bookings", "orders", "fees"].includes(q.get("kind") ?? "") ? q.get("kind") : "bookings") as ChatKind;
  const nonce = "screens-nonce";
  const now = Date.now();
  const closed = state === "closed";
  if (state === "paints") return { html: paintsPage(), csp: "default-src 'none'; style-src 'unsafe-inline'" };
  const page = chatPage({
    shop: {
      name: "Glow Salon", address: "MG Road, Kochi", languages: [...LANGUAGES], paused: state === "paused",
      character: { name: "Glow", face: closed ? "closed" : state === "busy" ? "busy" : "well", picture: FACE },
      contact: { phone: "+919811111111" },
      hours: { sun: null, mon: { open: "10:00", close: "20:00" }, tue: { open: "10:00", close: "20:00" }, wed: { open: "10:00", close: "20:00" }, thu: { open: "10:00", close: "20:00" }, fri: { open: "10:00", close: "20:00" }, sat: { open: "10:00", close: "18:00" } },
    },
    kind, language, base, home: "http://127.0.0.1/s/glow", nonce, thread: threadFor(state, now), personality: "cheerful",
    ...(isPaint(q.get("paint")) ? { paint: q.get("paint") as keyof typeof PAINTS } : {}),
    art: { base: `${base.replace(/\/chat$/u, "")}/character`, version: "screens", animated: true },
    ...(state === "voice" || state === "recording" ? { listen: true } : {}),
    ...(state === "alerts" ? { pushKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBxWqwxeKV8hxiSaI4Rc" } : {}),
    onStreetlist: q.get("streetlist") === "1", fontUrl: `${base}/font.woff2`,
    // W2: the identity part; ?parent=1 draws a Fees parent's chat note instead
    identity: identityBlock({ language, base, ...(q.get("parent") === "1" ? { parent: { back: "http://127.0.0.1/s/glow/f/link" } } : {}) }),
  });
  const dark = q.get("theme") === "dark" ? `<script nonce="${nonce}">document.documentElement.dataset.theme = "dark";</script>` : "";
  return { html: page.replace("</body>", `${dark}${seed(state, nonce, language)}</body>`), csp: chatPolicy(base, nonce, base.replace(/\/chat$/u, "")) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? 8799);
  let lastState = "confirmed-live"; // the "-live" states' arriving line is the one the last page asked for
  createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const state = url.pathname.slice(1);
    if (url.pathname.endsWith("/font.woff2")) { res.writeHead(200, { "content-type": "font/woff2" }); res.end(font); return; }
    if (url.pathname === "/m/lottie.js") { res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }); res.end(playerJs); return; }
    const motionFile = /^\/m\/([a-z]+)\.json$/u.exec(url.pathname);
    if (motionFile && (MOMENTS as readonly string[]).includes(motionFile[1])) { res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(readFileSync(new URL(`./motion/${motionFile[1]}.json`, import.meta.url))); return; }
    const face = /^\/character\/([a-z]+)(-anim)?\.svg$/u.exec(url.pathname);
    if (face) { res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store" }); res.end(animatedFace(face[1])); return; }
    // W2: what the identity part's script asks (chat-identity-front.ts): "keep" offers the keep box, "newphone" is a fresh guest, any other state is a guest mid-chat with the delete button
    if (url.pathname === "/id/state") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(lastState === "newphone" ? { keys: 0, here: false, number: false, work: 0, offer: false, restored: false, known: false } : { keys: 0, here: false, number: false, work: 1, offer: lastState === "keep", restored: false, known: true })); return; }
    if (url.pathname === "/thread") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(Number(url.searchParams.get("after") ?? "0") >= 2 ? arriving(lastState, Date.now()) : { lines: [], answered: true, capped: false, retentionDays: 30 })); return; }
    if (!(STATES as readonly string[]).includes(state)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><meta charset="utf-8"><title>Chat screens</title><ul>${STATES.map((s) => `<li><a href="/${s}">${s}</a>`).join("")}</ul>`); return; }
    lastState = state;
    const { html, csp } = screen(state, url.searchParams, `http://127.0.0.1:${port}`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": csp });
    res.end(html);
  }).listen(port, "127.0.0.1", () => console.log(`Chat screens on http://127.0.0.1:${port}/`));
}
