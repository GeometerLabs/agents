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
/** Each kind of shop has its own sample name and face tile colour (the face seed), so the review never mistakes an Orders page for the salon's. */
const SHOPS: Record<ChatKind, { name: string; helper: string; tile: string; ground: string }> = {
  bookings: { name: "Glow Salon", helper: "Glow", tile: "#ffd9a0", ground: "MG Road, Kochi" },
  orders: { name: "Annapurna Tiffins", helper: "Anna", tile: "#ffc6b8", ground: "Temple Road, Thrissur" },
  fees: { name: "Bright Tuition Centre", helper: "Bright", tile: "#bcd8ff", ground: "Church Road, Kozhikode" },
};
const faceFor = (kind: ChatKind): string => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 84"><rect width="84" height="84" fill="${SHOPS[kind].tile}"/><circle cx="30" cy="38" r="5"/><circle cx="54" cy="38" r="5"/><path d="M28 56q14 12 28 0" fill="none" stroke="#000" stroke-width="4"/></svg>`)}`;

/**
 * What each kind of shop says in the sample threads (18 Nov 2026): the Bookings salon, the Orders kitchen (a menu with prices as taps, an order held, then confirmed and paid, with
 * a pickup slot) and the Fees centre (its public questions, and with ?parent=1 a parent's own fee with its pay line). The review so sees each template's real content, not the salon's.
 */
interface Sample { ask: string; menu: string; choices: { id: string; title: string; hint?: string }[]; yes: string; held: (paid: boolean) => string; done: (paid: boolean) => string; work: boolean }
function sample(kind: ChatKind, parent: boolean): Sample {
  if (kind === "orders") {
    return {
      ask: "Today's menu", menu: "Today's menu. Tap what you would like.",
      choices: [{ id: "item:dosa", title: "Masala dosa", hint: "₹60" }, { id: "item:idli", title: "Idli, 3 pieces", hint: "₹40" }, { id: "item:coffee", title: "Filter coffee", hint: "₹25" }],
      yes: "1 masala dosa, please",
      held: (paid) => paid ? "Held: 1 masala dosa, ₹60, pickup at 1:30 pm. Pay ₹60 with UPI, then tap I have paid." : "Held: 1 masala dosa, ₹60, pickup at 1:30 pm. Tap Confirm to place it.",
      done: (paid) => paid ? "Payment of ₹60 received. Your order is placed, pickup at 1:30 pm." : "Order placed: 1 masala dosa, pickup at 1:30 pm.", work: true,
    };
  }
  if (kind === "fees" && parent) {
    return {
      ask: "My fee", menu: "Your child's June fee is ₹1,200, due on 10 June. Pay with UPI: upi://pay?pa=centre@upi&pn=Bright%20Centre&am=1200\nThen tap I have paid.",
      choices: [{ id: "fee:paid", title: "I have paid", hint: "₹1,200" }, { id: "fee:due", title: "When is it due?" }],
      yes: "I have paid", held: () => "Noted. The centre checks its record and tells you here.", done: () => "Payment of ₹1,200 received. June fee is paid.", work: true,
    };
  }
  if (kind === "fees") {
    return {
      ask: "Fee questions", menu: "What would you like to know?",
      choices: [{ id: "q:fee", title: "Fees for each class", hint: "Class 5 · ₹1,200 a month" }, { id: "q:due", title: "Due dates", hint: "The 10th of each month" }, { id: "q:pay", title: "How to pay", hint: "UPI or at the desk" }, { id: "q:time", title: "Class timings" }],
      yes: "How to pay", held: () => "You can pay by UPI or at the desk. Parents get their own fee link from the centre.", done: () => "You can pay by UPI or at the desk. Parents get their own fee link from the centre.", work: false,
    };
  }
  return {
    ask: "Book a time", menu: "Which service would you like?",
    choices: [{ id: "svc:haircut", title: "Haircut", hint: "₹450 · 30 minutes" }, { id: "svc:colour", title: "Colour", hint: "₹1,800 · 90 minutes" }],
    yes: "Yes, book it",
    held: (paid) => paid ? "Held until 10:30. Pay ₹200 with UPI, then tap I have paid." : "Held. Tap Confirm to book it.",
    done: (paid) => paid ? "Payment of ₹200 received. Your haircut is booked for 5:00 pm tomorrow." : "Booked: haircut tomorrow at 5:00 pm.", work: true,
  };
}

/** Whether the thread of this state holds a booking, an order or a fee (what the real /id/state reports as `work`: the number box is offered only then). */
const hasWork = (state: string, kind: ChatKind, parent: boolean): boolean => {
  const sm = sample(kind, parent);
  if (!sm.work) return false;
  return ["confirmed", "confirmed-live", "paid", "paid-live", "long", "keep"].includes(state) || (kind === "fees" && parent && !["empty", "closed", "paused"].includes(state));
};

function threadFor(state: string, now: number, kind: ChatKind = "bookings", parent = false): ChatThread {
  const t = (n: number, who: "you" | "shop", text: string, choices?: { id: string; title: string; hint?: string }[]) => ({ n, who, text, atMs: now - (10 - n) * 60_000, ...(choices ? { choices } : {}) });
  const base = { answered: true, capped: state === "capped", retentionDays: 30 };
  const sm = sample(kind, parent);
  if (state === "empty" || state === "closed" || state === "paused") return { lines: [], answered: false, capped: false, retentionDays: 30 };
  if (state === "answered" || state === "alerts" || state === "capped") return { ...base, lines: [t(1, "you", sm.ask), t(2, "shop", sm.menu, sm.choices)] };
  if (state === "confirmed" || state === "confirmed-live" || state === "paid" || state === "paid-live") {
    const live = state.endsWith("-live");
    const paid = state.startsWith("paid");
    const first = [t(1, "you", sm.yes), t(2, "shop", sm.held(paid))];
    return { ...base, lines: live ? first : [...first, { ...t(3, "shop", sm.done(paid)), moment: paid ? "paid" as const : "confirmed" as const }] };
  }
  if (state === "long") return { ...base, lines: [t(1, "you", "പ്രീമിയം ഹെയർകട്ട് നാളെ വൈകുന്നേരം അഞ്ചുമണിക്ക് ബുക്ക് ചെയ്യാമോ എന്ന് ചോദിക്കാനാണ് ഞാൻ എഴുതുന്നത്"), t(2, "shop", "Held until 10:30. Pay ₹200 with UPI: https://example.com/pay/with/a/very/long/path/that/must/not/break/the/layout/at/three-twenty-pixels\nThen tap I have paid.")] };
  return { ...base, lines: [t(1, "you", "What is the price?"), t(2, "shop", kind === "orders" ? "A masala dosa is ₹60." : kind === "fees" ? "Class 5 is ₹1,200 a month." : "A haircut is ₹450 and takes 30 minutes.")] };
}

/** The arriving line of a "-live" state, answered by the screens' own /thread, so the page's poll finds it exactly as it would from a shop. */
const arriving = (state: string, now: number, kind: ChatKind, parent: boolean) => ({
  lines: [{ n: 3, who: "shop", atMs: now, text: sample(kind, parent).done(state.startsWith("paid")), moment: state.startsWith("paid") ? "paid" : "confirmed" }],
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
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signboard paints</title><ul style="list-style:none;margin:0;padding:0">${rows}</ul><p style="font:1rem system-ui;padding:12px 16px">Open any state with ?paint=&lt;id&gt; to see the whole head on a paint.</p></html>`;
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
      name: SHOPS[kind].name, address: SHOPS[kind].ground, languages: [...LANGUAGES], paused: state === "paused",
      character: { name: SHOPS[kind].helper, face: closed ? "closed" : state === "busy" ? "busy" : "well", picture: faceFor(kind) },
      contact: { phone: "+919811111111" },
      hours: { sun: null, mon: { open: "10:00", close: "20:00" }, tue: { open: "10:00", close: "20:00" }, wed: { open: "10:00", close: "20:00" }, thu: { open: "10:00", close: "20:00" }, fri: { open: "10:00", close: "20:00" }, sat: { open: "10:00", close: "18:00" } },
    },
    kind, language, base, home: "http://127.0.0.1/s/glow", nonce, thread: threadFor(state, now, kind, q.get("parent") === "1"), personality: "cheerful",
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
  let lastKind: ChatKind = "bookings", lastParent = false;
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
    // the real page's answer: `work` is 1 only when the thread holds a booking, an order or a fee, so the number box shows only where it would on a real shop
    if (url.pathname === "/id/state") { const work = hasWork(lastState, lastKind, lastParent) ? 1 : 0; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(lastState === "newphone" ? { keys: 0, here: false, number: false, work: 0, offer: false, restored: false, known: false } : { keys: 0, here: false, number: false, work, offer: lastState === "keep", restored: false, known: true })); return; }
    // the alerts state registers the page's worker: a small stand-in served as script (a real shop serves its own), so the review shows no console error
    if (url.pathname === "/sw.js") { res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }); res.end("// screens stand-in worker: takes no events\nself.addEventListener('install', () => self.skipWaiting());\n"); return; }
    if (url.pathname === "/thread") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(Number(url.searchParams.get("after") ?? "0") >= 2 ? arriving(lastState, Date.now(), lastKind, lastParent) : { lines: [], answered: true, capped: false, retentionDays: 30 })); return; }
    if (!(STATES as readonly string[]).includes(state)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><meta charset="utf-8"><title>Chat screens</title><ul>${STATES.map((s) => `<li><a href="/${s}">${s}</a>`).join("")}</ul>`); return; }
    lastState = state;
    lastKind = (["bookings", "orders", "fees"].includes(url.searchParams.get("kind") ?? "") ? url.searchParams.get("kind") : "bookings") as ChatKind;
    lastParent = url.searchParams.get("parent") === "1";
    const { html, csp } = screen(state, url.searchParams, `http://127.0.0.1:${port}`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": csp });
    res.end(html);
  }).listen(port, "127.0.0.1", () => console.log(`Chat screens on http://127.0.0.1:${port}/`));
}
