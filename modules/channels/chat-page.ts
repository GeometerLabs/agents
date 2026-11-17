// The chat page of a shop (W1, 17 Nov 2026): https://<shop's page>/chat. One screen, one thing to do: the shop's signboard on top, the conversation, three big taps when it is
// empty, a text box and Send at the bottom. Phone first (360 px, one thumb: the actions are in the lower half), plain words in four languages, no sign-up, no menu.
//
// Why a script: a chat has to show the shop's answer when it arrives and keep a send that failed. It is ONE script by this response's nonce (front.ts chatPolicy names every
// address it may call, and nothing else), under the same rule as the owner's app: one origin for every shop, nothing runs script but Geometer's own. Without script the page
// still works: the thread is drawn here, the box is a form, and the answer is there on the next load.
//
// The look is look.ts (CHAT_CSS): the shop's signboard in its own paint colour (else the head's green tint), the character on its own tile with the public mood as a word
// chip, the shop's bubble in shutter green with white text and the guest's on card white, flat colours, Baloo 2 for the name, headings and buttons only (the phone's own
// font for the words and for Hindi, Malayalam and Kannada). Motion marks a change and never decorates: a new bubble arrives (opacity and 8 px), a failed one shakes once,
// the Send press sinks; every one is off under prefers-reduced-motion. Light by default; the sun/moon switch is the owner's app's (look.ts themeScript), never the phone's own setting.
//
// What the guest can rely on is said once, quietly, under the thread: the replies come from the shop's assistant, and a booking or a payment counts only when the shop's own
// record says so. The thread's own words are set with textContent in the script and escaped here; only the shop's lines become links, and only https and upi ones.
import { esc } from "../core/html.ts";
import { greeting } from "../assistant/personality.ts";
import type { Personality } from "../assistant/personality.ts";
import { ASSISTANT_OF, FACE_WORDS, pictureWords } from "../assistant/character.ts";
import type { Language } from "../language/languages.ts";
import { ALERT_WORDS, ALERTS_SCRIPT } from "../push/pages.ts";
import { CHATS_LIST_WORDS, INSTALL_SCRIPT, JOIN_SCRIPT, SHARE_ICON } from "./chats-list.ts";
import type { ChatThread } from "./chat.ts";
import { CHAT_CSS, THEME_KEY, themeSwitch } from "./look.ts";
import { CHAT, QUICK } from "./words-chat.ts";
import type { ChatKind } from "./words-chat.ts";
import { telLink } from "./contact-bar.ts";
import { FIRST_WORDS } from "./words-owner-first.ts";
import { OWNER_LOOK } from "./words-look.ts";
import { PAGE } from "./words.ts";
import { STAMP } from "./words-look.ts";
import { hoursLines } from "./shop-face.ts";
import type { ShopInfo } from "./backend.ts";

const LANGUAGE_LABEL: Record<Language, string> = { en: "English", hi: "हिन्दी", ml: "മലയാളം", kn: "ಕನ್ನಡ" };

/** The Streetlist tile (brand/streetlist-icon.svg, the owner's mark, unchanged): a limewash tile reads on both the light and the dark ground, so no recolouring is needed. */
const STREETLIST_TILE = `<svg viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="8" fill="#f7f8f4"/><g transform="translate(0 4)"><path d="M3 3h7v9a3.5 3.5 0 0 1-7 0zM17 3h7v9a3.5 3.5 0 0 1-7 0z" fill="#136650"/><path d="M10 3h7v9.2h-7zM24 3h7v9.2h-7z" fill="#f7f8f4"/><path d="M10 12a3.5 3.5 0 0 0 7 0zM24 12a3.5 3.5 0 0 0 7 0z" fill="#136650"/><rect x="2" y="1" width="30" height="3" rx="1.5" fill="#f6a609"/><path d="M7 19h20v6H7z" fill="#f6a609"/></g></svg>`;

/** The motion: a change is marked, never decorated (transform and opacity only, 150 to 300 ms, ease-out), and all of it is off for a phone that asks for less motion. */
const MOTION = `@media (prefers-reduced-motion: no-preference) {
.arrive { animation: arrive .22s ease-out; } @keyframes arrive { from { opacity: 0; transform: translateY(8px); } }
.shake { animation: shake .25s ease-out; } @keyframes shake { 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
.comp button:active, .tap:active { transform: scale(.97); transition: transform .12s ease-out; }
.hop { animation: hop .35s ease-out; } @keyframes hop { 40% { transform: translateY(-6px); } }
}`;

/** The text colour that reads on a paint colour: ink on a light one, white on a dark one (relative luminance, WCAG). */
function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#1d2427" : "#ffffff";
}

export interface ChatPageArgs {
  shop: Pick<ShopInfo, "name" | "address" | "languages" | "character" | "contact" | "hours" | "paused">;
  kind: ChatKind;
  language: Language;
  /** https://<page>/chat, no trailing slash: every address the page calls starts with it. */
  base: string;
  /** The shop's page (where "back" goes). */
  home: string;
  nonce: string;
  thread: ChatThread;
  personality?: Personality;
  /** The character's palette colour (hex, no "#"): the signboard's paint. */
  paint?: string;
  /** The key alerts are subscribed with, when push is on: the shop's own VAPID public key, or Streetlist's (`pushVia`). */
  pushKey?: string;
  /**
   * Set when the page is served through the Streetlist door and the shop sends through Streetlist's one push key (W3): the app's own worker at the site's root and its
   * scope. Left out: the shop's own worker under this page and the shop's own key.
   */
  pushVia?: { sw: string; scope: string };
  /** True only when the page is served on the Streetlist pages domain (the front says so); a builder's shop on its own domain shows no Streetlist mark. */
  onStreetlist: boolean;
  /** The font's address (served by the front), and whether it is on. */
  fontUrl: string;
  /** The guest's last send that has not been answered, when the page is drawn after a form post without script. */
  notice?: "rate";
}

const j = (v: unknown): string => JSON.stringify(v).replace(/</gu, "\\u003c");

/** The lines of the thread as markup (the script draws later ones the same way): runs of one side, the character's small face on the first shop bubble of a run. */
function linesHtml(lines: ChatThread["lines"], a: ChatPageArgs, face: boolean): string {
  const w = CHAT[a.language];
  let side: string | undefined;
  return lines.map((l) => {
    const first = l.who !== side;
    side = l.who;
    const time = new Date(l.atMs).toISOString();
    return `<div class="run${first ? " first" : ""}" data-n="${l.n}"><div class="row-b ${l.who}">${l.who === "shop" ? (first && face ? `<span class="mini-slot"></span>` : `<span class="gap-mini"></span>`) : ""}<p class="b ${l.who}"><span class="sr">${esc(l.who === "you" ? w.you : w.shop)}: </span>${esc(l.text)}</p></div><p class="t ${l.who}"><time datetime="${time}" data-ms="${l.atMs}"></time></p></div>`;
  }).join("");
}

export function chatPage(a: ChatPageArgs): string {
  const w = CHAT[a.language];
  const c = a.shop.character;
  const mood = c?.face && c.picture ? c.face : undefined;
  const paint = a.paint && /^[0-9a-fA-F]{6}$/u.test(a.paint) ? `#${a.paint}` : undefined;
  const sign = paint ? ` style="--paint:${paint};--paint-ink:${inkOn(paint)}"` : "";
  const first = FIRST_WORDS[a.language];
  const last = a.thread.lines.at(-1);
  const empty = a.thread.lines.length === 0;
  const quick = QUICK[a.kind].label[a.language];
  const hello = `${greeting(a.personality ?? "warm", a.language, a.shop.name, c?.name)} ${w.help}`;
  const closed = mood === "closed";
  const hours = a.shop.hours ? hoursLines(a.shop.hours, a.language).join(" · ") : "";
  const stamp = STAMP[a.language];
  const alerts = ALERT_WORDS[a.language];
  const face = Boolean(c?.picture);
  const langs = a.shop.languages.map((l) => (l === a.language ? `<b lang="${l}">${LANGUAGE_LABEL[l]}</b>` : `<a href="?lang=${l}" hreflang="${l}" lang="${l}">${LANGUAGE_LABEL[l]}</a>`)).join("");
  const choices = last?.who === "shop" ? (last.choices ?? []) : [];
  const words = { you: w.you, shop: w.shop, sending: w.sending, sent: w.sent, failed: w.failed, offline: w.offline, slow: w.slow, rate: w.rate, capped: w.capped, retry: w.retry };

  const css = `@font-face{font-family:"Baloo 2";font-style:normal;font-weight:400 800;font-display:swap;src:url(${a.fontUrl}) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}:root{--display:"Baloo 2",system-ui,sans-serif}${CHAT_CSS}${MOTION}`;
  const thread = linesHtml(a.thread.lines, a, face);
  const tapsHtml = (list: { id?: string; n?: number; title: string; hint?: string; go?: boolean }[]) => list.map((t) => `<button type="button" class="tap${t.go ? " go" : ""}"${t.id !== undefined ? ` data-tap="${esc(t.id)}"` : ` data-quick="${t.n}"`}>${esc(t.title)}${t.hint ? `<small>${esc(t.hint)}</small>` : ""}</button>`).join("");
  const opening = empty
    ? `<div class="run first"><div class="row-b shop">${face ? `<span class="mini-slot"></span>` : ""}<p class="b shop arrive"><span class="sr">${esc(w.shop)}: </span>${esc(hello)}</p></div></div>
<div class="taps" id="taps">${tapsHtml(quick.map((title, i) => ({ n: i + 1, title, go: a.kind !== "fees" && i === 1 })))}</div>`
    : `<div class="taps" id="taps">${tapsHtml(choices.map((x) => ({ id: x.id, title: x.title, ...(x.hint ? { hint: x.hint } : {}) })))}</div>`;

  const body = `<body class="chat" data-lang="${a.language}">
<header class="sign"${sign}><div class="wrap"><div class="sign-in">${c?.picture ? `<img class="face-c" id="face-src" src="${esc(c.picture)}" width="52" height="52" alt="${esc(pictureWords(a.language, a.shop.name, c.face ?? "well", c.name))}">` : ""}<div><h1>${esc(a.shop.name)}</h1>${c ? `<p class="mood${mood ? ` m-${mood}` : ""}">${esc(ASSISTANT_OF[a.language](a.shop.name, c.name))}${mood ? ` · ${esc(FACE_WORDS[a.language][mood])}` : ""}</p>` : ""}</div></div>
${themeSwitch(esc(OWNER_LOOK[a.language].theme))}<details class="lang"><summary aria-label="${esc(PAGE[a.language].language)}">${LANGUAGE_LABEL[a.language]}</summary><div>${langs}</div></details>
${a.shop.contact?.phone ? `<p class="callrow"><a class="btn quiet" href="${esc(telLink(a.shop.contact.phone))}">${esc(first.shopCall)}</a></p>` : ""}</div></header>
<p class="banner" id="offline" role="status" hidden>${esc(w.offline)}</p>
<main class="thread" id="thread" role="log" aria-live="polite" aria-label="${esc(w.thread)}" tabindex="-1"><div class="wrap" id="lines">
<p class="sys">${esc(w.note)} ${esc(w.kept(a.thread.retentionDays))}</p>
${a.onStreetlist ? `<p class="sys"><a href="https://streetlist.in" rel="noopener">${STREETLIST_TILE}${esc(w.onStreetlist)}</a> · <a href="/chats">${esc(CHATS_LIST_WORDS[a.language].yourChats)}</a></p>` : ""}
${thread}${opening}
<div id="alerts-slot" class="alerts-slot"${a.thread.answered && a.pushKey ? "" : " hidden"}>${a.pushKey ? `<p class="sys">${esc(w.alertsHead)}</p><div id="alerts" class="card" hidden data-key="${esc(a.pushKey)}" data-sw="${esc(a.pushVia?.sw ?? `${a.base}/sw.js`)}" data-scope="${esc(a.pushVia?.scope ?? `${a.base}/`)}"${a.pushVia ? ' data-signer="streetlist"' : ""} data-save="${esc(a.base)}/push" data-done="${esc(alerts.customerOn)}" data-saved="${esc(alerts.customerOn)}" data-blocked="${esc(alerts.blocked)}" data-failed="${esc(alerts.failed)}"><button type="button" id="alerts-on">${esc(alerts.customer)}</button><p id="alerts-msg" class="note" role="status" aria-live="polite"></p></div>` : ""}</div>
${a.onStreetlist ? `<div id="install-slot" class="alerts-slot" hidden><p class="sys">${esc(CHATS_LIST_WORDS[a.language].installHead)}</p><div class="card"><p class="note">${esc(CHATS_LIST_WORDS[a.language].installBody)}</p><button type="button" id="install-go" hidden>${esc(CHATS_LIST_WORDS[a.language].installButton)}</button><p id="install-ios" class="note ios" hidden>${SHARE_ICON}<span>${esc(CHATS_LIST_WORDS[a.language].iphone)}</span></p><button type="button" id="install-later" class="quiet">${esc(CHATS_LIST_WORDS[a.language].notNow)}</button></div></div>` : ""}
</div></main>
<div class="notes" id="notes">${a.shop.paused ? `<div class="state s-plain wrap"><span class="stamp">${esc(stamp.paused)}</span><p class="status">${esc(w.paused)}</p></div>` : closed ? `<div class="state s-plain wrap"><span class="stamp">${esc(stamp.closed)}</span><p class="status">${esc(w.closed(hours))}</p></div>` : ""}${a.notice === "rate" ? `<div class="state s-bad wrap" role="alert"><p class="status">${esc(w.rate)}</p></div>` : ""}${a.thread.capped ? `<div class="state s-info wrap"><p class="status">${esc(w.capped)}</p></div>` : ""}</div>
<form class="comp" id="comp" method="post" action="${esc(a.base)}/send" autocomplete="off"><input type="hidden" name="lang" value="${a.language}"><input type="hidden" name="id" id="cid" value=""><label class="sr" for="box">${esc(w.label)}</label><textarea id="box" name="text" rows="1" maxlength="500" required placeholder="${esc(w.placeholder)}" enterkeyhint="send"></textarea><button type="submit" id="go">${esc(w.send)}</button></form>`;

  const script = `(() => {
  const root = document.documentElement;
  try { if (localStorage.getItem(${j(THEME_KEY)}) === "dark") root.dataset.theme = "dark"; } catch {}
  const base = ${j(a.base)}, lang = ${j(a.language)}, W = ${j(words)}, KEY = "chat-draft:" + base, SENT = "chat-unsent:" + base;
  const $ = (id) => document.getElementById(id);
  const lines = $("lines"), thread = $("thread"), box = $("box"), taps = $("taps"), notes = $("notes");
  let last = ${last?.n ?? 0}, answeredSeen = ${a.thread.answered}, lastCid = null, waiting = false, timer = null, slowTimer = null;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} } };
  // the language the guest picked, remembered; a link with no ?lang= goes to it
  try { const p = new URLSearchParams(location.search).get("lang"); if (p) store.set("chat-lang", p); else { const s = store.get("chat-lang"); if (s && s !== lang && ${j(a.shop.languages)}.includes(s)) { location.replace("?lang=" + s); return; } } } catch {}
  const vv = () => { const h = window.visualViewport ? window.visualViewport.height : innerHeight; root.style.setProperty("--vvh", h + "px"); };
  vv(); if (window.visualViewport) { visualViewport.addEventListener("resize", vv); visualViewport.addEventListener("scroll", vv); }
  const near = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
  const down = () => { thread.scrollTop = thread.scrollHeight; };
  const stamp = () => { for (const t of document.querySelectorAll("time[data-ms]")) { const d = new Date(Number(t.dataset.ms)); t.textContent = d.toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit" }); t.removeAttribute("data-ms"); } };
  const face = () => { const src = $("face-src"); if (!src) return; for (const s of document.querySelectorAll(".mini-slot")) { const i = document.createElement("img"); i.className = "mini"; i.alt = ""; i.src = src.src; i.width = 30; i.height = 30; s.replaceWith(i); } };
  const link = (p, text) => { const re = /(https:\\/\\/[^\\s<>"]+|upi:\\/\\/pay\\?[^\\s<>"]+)/gu; let at = 0, m; while ((m = re.exec(text))) { p.append(text.slice(at, m.index)); const a = document.createElement("a"); a.href = m[0]; a.rel = "noopener noreferrer"; a.textContent = m[0].startsWith("upi:") ? "UPI" : m[0].replace(/^https:\\/\\//u, ""); p.append(a); at = m.index + m[0].length; } p.append(text.slice(at)); };
  const mk = (who, text, ms, extra) => {
    const run = document.createElement("div"); run.className = "run arrive" + (extra || "");
    const row = document.createElement("div"); row.className = "row-b " + who;
    const prev = lines.querySelector(".run:last-of-type .row-b"); const newRun = !prev || !prev.classList.contains(who);
    if (who === "shop") { const s = document.createElement("span"); s.className = newRun && $("face-src") ? "mini-slot" : "gap-mini"; row.append(s); }
    const p = document.createElement("p"); p.className = "b " + who;
    const sr = document.createElement("span"); sr.className = "sr"; sr.textContent = (who === "you" ? W.you : W.shop) + ": "; p.append(sr);
    if (who === "shop") link(p, text); else p.append(text);
    row.append(p); run.append(row);
    const t = document.createElement("p"); t.className = "t " + who; const tm = document.createElement("time"); tm.dataset.ms = String(ms || Date.now()); t.append(tm); run.append(t);
    return run;
  };
  const showTaps = (list, quick) => { taps.replaceChildren(); for (const c of list) { const b = document.createElement("button"); b.type = "button"; b.className = "tap"; if (quick) b.dataset.quick = String(c.n); else b.dataset.tap = c.id; b.append(c.title); if (c.hint) { const s = document.createElement("small"); s.textContent = c.hint; b.append(s); } taps.append(b); } };
  const dots = () => { if ($("dots")) return; const r = document.createElement("div"); r.id = "dots"; r.className = "run arrive"; r.innerHTML = '<div class="row-b shop"><p class="b shop dots" role="status" aria-label="' + W.slow + '"><i></i><i></i><i></i></p></div>'; lines.append(r); if (near()) down(); };
  const undots = () => { const d = $("dots"); if (d) d.remove(); };
  const mark = (run, kind) => { const t = run.querySelector(".t"); if (!t) return; for (const o of t.querySelectorAll(".st")) o.remove(); const s = document.createElement("span"); s.className = "st"; s.textContent = " · " + (kind === "sending" ? W.sending : W.sent); t.append(s); };
  const failed = (run, send) => {
    run.querySelector(".b").classList.remove("pending"); const old = run.querySelector(".retry"); if (old) old.remove();
    const r = document.createElement("button"); r.type = "button"; r.className = "retry shake"; r.innerHTML = '<span class="stamp"></span><span></span>'; r.firstChild.textContent = W.retry; r.lastChild.textContent = W.failed;
    r.addEventListener("click", () => { r.remove(); run.querySelector(".b").classList.add("pending"); post(send, run); }); run.append(r);
  };
  const pending = () => { try { return JSON.parse(store.get(SENT) || "[]"); } catch { return []; } };
  const keepUnsent = (send, on) => { const list = pending().filter((s) => s.id !== send.id); if (on) list.push(send); store.set(SENT, list.length ? JSON.stringify(list) : null); };
  async function post(send, run) {
    lastCid = send.id; mark(run, "sending"); keepUnsent(send, true); waiting = true; schedule(900);
    try {
      const r = await fetch(base + "/send", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(send) });
      if (r.status === 429) { waiting = false; note("bad", W.rate); throw new Error("rate"); }
      if (!r.ok) throw new Error(String(r.status));
      keepUnsent(send, false); run.querySelector(".b").classList.remove("pending"); mark(run, "sent");
      clearTimeout(slowTimer); slowTimer = setTimeout(() => { if (waiting) dots(); }, 2500);
    } catch { failed(run, send); waiting = false; }
  }
  const note = (tone, text) => { const d = document.createElement("div"); d.className = "state s-" + tone + " wrap"; d.setAttribute("role", "status"); const p = document.createElement("p"); p.className = "status"; p.textContent = text; d.append(p); notes.replaceChildren(d); };
  function send(fields, shown) {
    const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9-]/g, "").slice(0, 64);
    const run = mk("you", shown, Date.now(), ""); run.querySelector(".b").classList.add("pending");
    taps.replaceChildren(); lines.insertBefore(run, $("alerts-slot")); stamp(); down();
    post({ id, lang, ...fields }, run);
  }
  async function poll() {
    try {
      const r = await fetch(base + "/thread?after=" + last + (lastCid ? "&cid=" + encodeURIComponent(lastCid) : ""), { credentials: "same-origin", headers: { accept: "application/json" } });
      if (!r.ok) return;
      const d = await r.json(); const at = near();
      const mine = [...lines.querySelectorAll(".run[data-n]")].map((x) => x.dataset.n);
      for (const l of d.lines) {
        if (mine.includes(String(l.n))) continue;
        if (l.who === "you") { if (l.cid && l.cid === lastCid) { last = Math.max(last, l.n); } else if (!document.querySelector('[data-cid="' + l.cid + '"]')) { const run = mk("you", l.text, l.atMs, ""); run.dataset.n = String(l.n); run.dataset.cid = l.cid || ""; lines.insertBefore(run, $("alerts-slot")); last = Math.max(last, l.n); } continue; }
        undots(); const run = mk("shop", l.text, l.atMs, ""); run.dataset.n = String(l.n); lines.insertBefore(run, $("alerts-slot")); last = Math.max(last, l.n); waiting = false;
        if (l.choices) showTaps(l.choices, false);
      }
      face(); stamp();
      if (d.answered) { answeredSeen = true; if ($("alerts")) $("alerts-slot").hidden = false; ${a.onStreetlist ? "installMaybe(); " : ""}}
      if (d.capped) note("info", W.capped);
      if (d.send === "failed") { waiting = false; undots(); }
      if (d.send === "done" && !d.lines.some((l) => l.who === "shop")) waiting = waiting && true;
      if (at) down();
    } catch {}
  }
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(async () => { if (!document.hidden) await poll(); schedule(waiting ? 1500 : 9000); }, ms); };
  $("comp").addEventListener("submit", (e) => { e.preventDefault(); const text = box.value.trim(); if (!text) return; box.value = ""; store.set(KEY, null); fit(); send({ text }, text); });
  taps.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; if (b.dataset.quick) send({ quick: Number(b.dataset.quick) }, b.firstChild.textContent); else send({ tap: b.dataset.tap }, b.firstChild.textContent); });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("comp").requestSubmit(); } });
  const fit = () => { box.style.height = "auto"; box.style.height = Math.min(box.scrollHeight, 136) + "px"; };
  box.addEventListener("input", () => { store.set(KEY, box.value || null); fit(); });
  const d0 = store.get(KEY); if (d0) { box.value = d0; fit(); }
  const off = $("offline"); const net = () => { off.hidden = navigator.onLine; }; addEventListener("online", net); addEventListener("offline", net); net();
  for (const s of pending()) { const run = mk("you", s.text || s.label || "", Date.now(), ""); run.dataset.cid = s.id; lines.insertBefore(run, $("alerts-slot")); failed(run, s); }
  face(); stamp(); down(); schedule(waiting ? 1500 : 9000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  const themeBtn = document.getElementById("theme");
  if (themeBtn) { const show = () => themeBtn.setAttribute("aria-pressed", String(root.dataset.theme === "dark")); themeBtn.hidden = false; show(); themeBtn.addEventListener("click", () => { if (root.dataset.theme === "dark") delete root.dataset.theme; else root.dataset.theme = "dark"; store.set(${j(THEME_KEY)}, root.dataset.theme === "dark" ? "dark" : "light"); show(); }); }
${a.pushKey ? ALERTS_SCRIPT : ""}
${a.onStreetlist ? `${JOIN_SCRIPT}${INSTALL_SCRIPT}
// this shop joins the phone's Streetlist chats list once the guest has said something, and keeps its row's last line and seen mark up to date
const slugNow = location.pathname.split("/")[1] || "";
const faceOf = () => { try { const i = $("face-src"); if (!i) return undefined; const u = new URL(i.src, location.href); return u.origin === location.origin ? u.pathname + u.search : undefined; } catch (x) { return undefined; } };
const keepRow = () => {
  if (!(last > 0)) return;
  const runs = lines.querySelectorAll(".run[data-n]");
  const run = runs[runs.length - 1];
  const p = run && run.querySelector("p.b");
  const text = p ? Array.from(p.childNodes).filter((n) => !(n.classList && n.classList.contains("sr"))).map((n) => n.textContent).join("") : "";
  const tm = run && run.querySelector("time");
  const at = tm ? (Number(tm.dataset.ms) || Date.parse(tm.getAttribute("datetime") || "")) : NaN;
  joinChat({ slug: slugNow, name: ${j(a.shop.name)}, face: faceOf(), paint: ${j(a.paint ?? null)}, last: text, lastBy: p && p.classList.contains("you") ? "you" : "shop", at: Number.isFinite(at) ? at : Date.now(), seen: last, answered: answeredSeen });
};
keepRow();
new MutationObserver(keepRow).observe(lines, { childList: true });
document.addEventListener("visibilitychange", () => { if (!document.hidden) keepRow(); });
if (answeredSeen) installMaybe();` : ""}
})();`;

  return `<!doctype html><html lang="${a.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><meta name="theme-color" content="#e2f2e9">${a.onStreetlist ? `<link rel="manifest" href="${esc(new URL(a.base).origin)}/manifest.webmanifest"><link rel="apple-touch-icon" href="${esc(new URL(a.base).origin)}/apple-touch-icon.png">` : ""}<meta name="referrer" content="strict-origin"><title>${esc(a.shop.name)} · ${esc(w.title)}</title><style>${css}</style></head>
${body}
<script nonce="${esc(a.nonce)}">${script}</script></body></html>`;
}
