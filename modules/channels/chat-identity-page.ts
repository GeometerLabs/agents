// What the chat page adds for a customer's identity (W2, 17 Nov 2026): "keep this chat on this phone", "been here before?" (open it with the fingerprint or screen lock, or "I have a
// new phone"), "send me my booking link" and "delete my chat"; and, on a parent's private fee page, the one quiet note that the chat is theirs. Kept in a file of its own so the
// chat page (chat-page.ts) needs only two places for it: one slot in the markup and one more script by the same nonce.
//
// Why it looks like this. The person is a WhatsApp-only customer, not a technical one. So: nothing is offered until it helps (a booking or an order is made, or the guest has no thread
// yet and may be coming back), every offer is one big button with one sentence, nothing is typed except, once and optionally, the WhatsApp number, and the words never say
// "passkey", "sign in", "login", "session" or "error". The phone's own prompt does the rest (fingerprint, face or screen lock); a phone with no screen lock is told so in one plain
// sentence and the chat keeps working as a guest. Opening the chat on a new phone asks for no restriction on where the key is, so the browser offers its own "use another phone" (a QR
// and the old phone next to this one); the page says that in one line. A passkey made for another shop on the same address shows in the phone's chooser too: one sentence says what to do.
//
// The script is plain and small, called by the page's nonce (front.ts chatPolicy names `<chat>/id/` for it and nothing else). It calls only this chat's own `/id/` addresses, keeps no
// secret, and reads the browser's answers into base64url for the runtime to check.
import { esc } from "../core/html.ts";
import type { Language } from "../language/languages.ts";
import { IDENTITY } from "./words-chat-identity.ts";

export interface IdentityBlockArgs {
  language: Language;
  /** https://<page>/chat, no trailing slash: the addresses the script calls start with it. */
  base: string;
  /** A parent's private fee page: no keys and no number (the link is their identity); only the note and a way back to the fees. */
  parent?: { back: string };
}

/** The markup and the script for the chat page's identity part. The script is empty when there is nothing to run. */
export function identityBlock(a: IdentityBlockArgs): { html: string; script: string } {
  const w = IDENTITY[a.language];
  if (a.parent) {
    return { html: `<section class="idbox"><p class="sys">${esc(w.parentNote)}</p><p class="sys"><a class="btn quiet" href="${esc(a.parent.back)}">${esc(w.parentBack)}</a></p></section>`, script: "" };
  }
  const html = `<section class="idbox" id="idbox">
<div class="card" id="keep" hidden><h2>${esc(w.keepHead)}</h2><p id="keepBody">${esc(w.keepBody)}</p><button type="button" id="keepGo">${esc(w.keepButton)}</button>
<div id="numAsk" hidden><p>${esc(w.numberAsk)}</p><label class="sr" for="num">${esc(w.numberLabel)}</label><input id="num" type="tel" inputmode="tel" autocomplete="tel" placeholder="+91" maxlength="20"><button type="button" id="numGo" class="quiet">${esc(w.numberSave)}</button></div>
<p class="sys" id="keepMsg" role="status"></p></div>
<p class="sys" id="nolock" hidden>${esc(w.keepNoLock)}</p>
<div class="card" id="before" hidden><button type="button" id="beforeGo" class="quiet" aria-expanded="false" aria-controls="beforeBox">${esc(w.beenBefore)}</button>
<div id="beforeBox" hidden><button type="button" id="openGo" class="quiet">${esc(w.openMine)}</button><p class="sys">${esc(w.otherPhoneLine)}</p>
<button type="button" id="newGo" class="quiet">${esc(w.newPhone)}</button>
<div id="newBox" hidden><p>${esc(w.newPhoneBody)}</p><label class="sr" for="num2">${esc(w.numberLabel)}</label><input id="num2" type="tel" inputmode="tel" autocomplete="tel" placeholder="+91" maxlength="20"><button type="button" id="linkGo">${esc(w.sendLink)}</button></div>
<p class="sys" id="beforeMsg" role="status"></p></div></div>
<div class="idfoot" id="foot" hidden><button type="button" id="linksGo" class="quiet" hidden>${esc(w.sendMyLinks)}</button><button type="button" id="delGo" class="quiet">${esc(w.deleteButton)}</button>
<div class="card" id="delBox" hidden><p>${esc(w.deleteAsk)}</p><button type="button" id="delYes">${esc(w.deleteYes)}</button><button type="button" id="delNo" class="quiet">${esc(w.deleteNo)}</button></div>
<p class="sys" id="footMsg" role="status"></p></div>
<style>.idbox{margin:14px 0}.idbox input{display:block;width:100%;min-height:48px;margin-top:10px;padding:.5em .8em;border:1.5px solid var(--line2);border-radius:14px;font:inherit;background:var(--card);color:var(--ink)}.idbox .idfoot{display:flex;flex-wrap:wrap;gap:8px 12px}.idbox .idfoot .card,.idbox .idfoot .sys{flex:1 1 100%}.idbox [hidden]{display:none}</style>
</section>`;
  const words = { keepDone: w.keepDone, keepFailed: w.keepFailed, openFailed: w.openFailed, otherShop: w.otherShop, openDone: w.openDone, linkSent: w.linkSent, wait: w.wait, badNumber: w.badNumber, numberSaved: w.numberSaved, myLinksSent: w.myLinksSent, myLinksNone: w.myLinksNone, deleteDone: w.deleteDone };
  const j = (v: unknown): string => JSON.stringify(v).replace(/</gu, "\\u003c");
  const script = `(() => {
  const base = ${j(a.base)}, W = ${j(words)};
  const $ = (id) => document.getElementById(id);
  const dec = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; };
  const enc = (buf) => { const u = new Uint8Array(buf); let s = ""; for (const c of u) s += String.fromCharCode(c); return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, ""); };
  const say = (id, text) => { const p = $(id); if (p) p.textContent = text || ""; };
  const post = async (op, body) => { try { const r = await fetch(base + "/id/" + op, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }); let j = {}; try { j = await r.json(); } catch {} return Object.assign({ http: r.status }, j); } catch { return { http: 0 }; } };
  const show = (id, on) => { const e = $(id); if (e) e.hidden = !on; };
  const lock = async () => { try { return !!(window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; } };
  let hasLock = null, last = {};
  async function refresh() {
    let s; try { const r = await fetch(base + "/id/state", { credentials: "same-origin", headers: { accept: "application/json" } }); if (!r.ok) return; s = await r.json(); } catch { return; }
    last = s; if (hasLock === null) hasLock = await lock();
    const kept = s.keys > 0;
    // offered only when it helps: after a booking or an order, and only to a phone that can keep it; a phone with no screen lock is told so, once, plainly
    show("keep", (s.offer && hasLock) || (kept && !s.number)); show("nolock", !!s.offer && !hasLock);
    if (kept) { show("keepGo", false); $("keepBody").textContent = W.keepDone; }
    show("numAsk", kept && !s.number);
    show("before", s.work === 0 && !kept);
    show("foot", !!s.known || kept); show("linksGo", !!s.number);
  }
  async function keep() {
    say("keepMsg", ""); $("keepGo").disabled = true;
    const o = await post("keep-options");
    if (!o.options) { $("keepGo").disabled = false; return say("keepMsg", W.keepFailed); }
    const p = o.options; p.challenge = dec(p.challenge); p.user.id = dec(p.user.id); p.excludeCredentials = (p.excludeCredentials || []).map((c) => Object.assign({}, c, { id: dec(c.id) }));
    let cred; try { cred = await navigator.credentials.create({ publicKey: p }); } catch { $("keepGo").disabled = false; return say("keepMsg", W.keepFailed); }
    const r = cred.response;
    const k = await post("keep", { response: { clientDataJSON: enc(r.clientDataJSON), attestationObject: enc(r.attestationObject) } });
    $("keepGo").disabled = false;
    if (!k.ok) return say("keepMsg", W.keepFailed);
    say("keepMsg", W.keepDone); refresh();
  }
  async function openMine() {
    say("beforeMsg", "");
    const o = await post("signin-options");
    if (!o.options) return say("beforeMsg", W.openFailed);
    const p = o.options; p.challenge = dec(p.challenge); p.allowCredentials = [];
    let a; try { a = await navigator.credentials.get({ publicKey: p }); } catch { return say("beforeMsg", W.openFailed); }
    const r = a.response;
    const s = await post("signin", { response: { id: enc(a.rawId), clientDataJSON: enc(r.clientDataJSON), authenticatorData: enc(r.authenticatorData), signature: enc(r.signature), userHandle: r.userHandle ? enc(r.userHandle) : undefined } });
    if (s.ok) { say("beforeMsg", W.openDone); location.reload(); return; }
    say("beforeMsg", s.reason === "other_shop" ? W.otherShop : W.openFailed);
  }
  const sendNumber = async (op, input, msgId, okText) => {
    say(msgId, ""); const r = await post(op, { number: $(input).value });
    say(msgId, r.ok ? okText : r.reason === "bad_number" ? W.badNumber : r.reason === "wait" || r.http === 429 ? W.wait : r.reason === "no_number" ? W.myLinksNone : W.openFailed);
    return !!r.ok;
  };
  $("keepGo").addEventListener("click", keep);
  // "Been here before?" is one quiet line until it is pressed, so a first-time visitor's chat is not crowded
  $("beforeGo").addEventListener("click", () => { const open = $("beforeBox").hidden; show("beforeBox", open); $("beforeGo").setAttribute("aria-expanded", String(open)); });
  $("openGo").addEventListener("click", openMine);
  $("newGo").addEventListener("click", () => show("newBox", true));
  $("linkGo").addEventListener("click", () => sendNumber("recover", "num2", "beforeMsg", W.linkSent));
  $("numGo").addEventListener("click", async () => { if (await sendNumber("number", "num", "keepMsg", W.numberSaved)) refresh(); });
  $("linksGo").addEventListener("click", async () => { say("footMsg", ""); const r = await post("links"); say("footMsg", r.ok ? W.myLinksSent : r.reason === "no_number" ? W.myLinksNone : W.wait); });
  $("delGo").addEventListener("click", () => show("delBox", true));
  $("delNo").addEventListener("click", () => show("delBox", false));
  $("delYes").addEventListener("click", async () => {
    const r = await post("forget");
    if (!r.ok) return say("footMsg", W.openFailed);
    // the drafts and unsent lines this page kept on the phone go with the chat
    try { for (const k of ["chat-draft:" + base, "chat-unsent:" + base]) localStorage.removeItem(k); } catch {}
    say("footMsg", W.deleteDone); show("delBox", false); setTimeout(() => location.reload(), 900);
  });
  refresh(); setInterval(() => { if (!document.hidden && !(last.keys > 0 && last.number)) refresh(); }, 10000);
})();`;
  return { html, script };
}
