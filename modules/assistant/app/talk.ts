// The owner's app's talk box and its offline note (item 11e): plain HTML that works without JavaScript (a text box and a Send button posting to <link>/talk), and a
// small script that adds a hold-to-record button when the phone can record (MediaRecorder): the voice note is posted to <link>/voice and goes down the same path as a
// WhatsApp voice note (speech to text through the voice notes job's Guard), then is read like the typed words. The answer is shown on the page as text; the assistant
// never speaks (owner, 12 Nov). Used by the owner page's front once item 11d lands (modules/Deferred.md).
import type { Language } from "../../language/languages.ts";
import type { TalkLine } from "../state.ts";

const WORDS: Record<Language, { title: string; placeholder: string; send: string; hold: string; release: string; sending: string; failed: string; offline: string; you: string }> = {
  en: { title: "Talk to your assistant", placeholder: "For example: tomorrow, or close Sunday", send: "Send", hold: "Hold to talk", release: "Release to send", sending: "Sending…", failed: "That did not go. Try again.", offline: "You are offline. This is the last list you saw; answering needs a connection.", you: "You" },
  hi: { title: "अपने असिस्टेंट से बात करें", placeholder: "जैसे: कल, या रविवार बंद", send: "भेजें", hold: "बोलने के लिए दबाकर रखें", release: "भेजने के लिए छोड़ें", sending: "भेज रहे हैं…", failed: "नहीं गया। फिर कोशिश करें।", offline: "आप ऑफ़लाइन हैं। यह आख़िरी देखी गई सूची है; जवाब देने के लिए कनेक्शन चाहिए।", you: "आप" },
  ml: { title: "നിങ്ങളുടെ അസിസ്റ്റന്റിനോട് സംസാരിക്കുക", placeholder: "ഉദാഹരണം: നാളെ, അല്ലെങ്കിൽ ഞായറാഴ്ച അടച്ചിടുക", send: "അയയ്ക്കുക", hold: "സംസാരിക്കാൻ അമർത്തിപ്പിടിക്കുക", release: "അയയ്ക്കാൻ വിടുക", sending: "അയയ്ക്കുന്നു…", failed: "പോയില്ല. വീണ്ടും ശ്രമിക്കുക.", offline: "നിങ്ങൾ ഓഫ്‌ലൈനാണ്. ഇത് അവസാനം കണ്ട പട്ടികയാണ്; മറുപടി നൽകാൻ കണക്ഷൻ വേണം.", you: "നിങ്ങൾ" },
  kn: { title: "ನಿಮ್ಮ ಸಹಾಯಕರೊಂದಿಗೆ ಮಾತನಾಡಿ", placeholder: "ಉದಾಹರಣೆಗೆ: ನಾಳೆ, ಅಥವಾ ಭಾನುವಾರ ಮುಚ್ಚಿ", send: "ಕಳುಹಿಸಿ", hold: "ಮಾತನಾಡಲು ಒತ್ತಿ ಹಿಡಿಯಿರಿ", release: "ಕಳುಹಿಸಲು ಬಿಡಿ", sending: "ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ…", failed: "ಹೋಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.", offline: "ನೀವು ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿದ್ದೀರಿ. ಇದು ಕೊನೆಯದಾಗಿ ನೋಡಿದ ಪಟ್ಟಿ; ಉತ್ತರಿಸಲು ಸಂಪರ್ಕ ಬೇಕು.", you: "ನೀವು" },
};

/** The page's text is escaped here once; everything shown came from the owner or the assistant's checked words, and is never trusted as markup. */
const esc = (s: string) => s.replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The longest voice note the page records: the voice notes job listens to 30 seconds at most. */
export const RECORD_MAX_SECONDS = 30;

/** The talk box: the last lines of talk, a text form, and (with JavaScript and a microphone) the hold-to-record button. `base` is the owner's link. */
export function talkBox(a: { base: string; language: Language; lines: readonly TalkLine[]; assistantName: string }): string {
  const w = WORDS[a.language];
  const lines = a.lines.map((l) => `<p class="talk-${l.from}"><b>${esc(l.from === "owner" ? w.you : a.assistantName)}:</b> ${esc(l.text).replace(/\n/gu, "<br>")}</p>`).join("");
  return `<section class="talk" aria-labelledby="talk-h"><h2 id="talk-h">${esc(w.title)}</h2>${lines}
<form method="post" action="${esc(a.base)}/talk"><label class="sr" for="talk-t">${esc(w.title)}</label><textarea id="talk-t" name="text" rows="2" maxlength="900" required placeholder="${esc(w.placeholder)}"></textarea><button type="submit">${esc(w.send)}</button></form>
<button type="button" id="talk-rec" hidden data-hold="${esc(w.hold)}" data-release="${esc(w.release)}" data-sending="${esc(w.sending)}" data-failed="${esc(w.failed)}">${esc(w.hold)}</button>
<p id="talk-offline" class="notice" hidden>${esc(w.offline)}</p></section>
<script>${talkScript(a.base)}</script>`;
}

/**
 * The progressive part: the hold-to-record button (shown only when the phone can record Ogg Opus, the format WhatsApp voice notes have and the voice service reads),
 * the offline note (from the service worker's mark or navigator.onLine), and the service worker's registration for this link only.
 */
function talkScript(base: string): string {
  const b = JSON.stringify(base);
  return `(() => {
  const base = ${b};
  if ("serviceWorker" in navigator) navigator.serviceWorker.register(base + "/sw.js", { scope: base + "/" }).catch(() => {});
  const off = document.getElementById("talk-offline");
  const show = () => { off.hidden = navigator.onLine; };
  addEventListener("online", show); addEventListener("offline", show); show();
  const rec = document.getElementById("talk-rec");
  const type = "audio/ogg;codecs=opus";
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(type) || !navigator.mediaDevices) return;
  rec.hidden = false;
  let r = null, chunks = [], timer = null;
  const stop = () => { if (r && r.state === "recording") r.stop(); clearTimeout(timer); };
  const start = async (e) => {
    e.preventDefault();
    if (r) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = []; r = new MediaRecorder(stream, { mimeType: type });
      r.ondataavailable = (x) => chunks.push(x.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        rec.textContent = rec.dataset.sending;
        try {
          const res = await fetch(base + "/voice", { method: "POST", headers: { "content-type": type }, body: new Blob(chunks, { type }) });
          if (!res.ok) throw new Error(String(res.status));
          location.reload();
        } catch { rec.textContent = rec.dataset.failed; }
        r = null;
      };
      r.start(); rec.textContent = rec.dataset.release;
      timer = setTimeout(stop, ${RECORD_MAX_SECONDS} * 1000);
    } catch { rec.textContent = rec.dataset.failed; r = null; }
  };
  rec.addEventListener("pointerdown", start);
  rec.addEventListener("pointerup", stop); rec.addEventListener("pointerleave", stop); rec.addEventListener("pointercancel", stop);
})();`;
}
