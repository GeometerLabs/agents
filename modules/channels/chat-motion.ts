// The chat's three small animations (17 Nov 2026; owner: "you can make dicebear animations and other UI animations and lotties"), and everything the page needs to play them
// without anything loading until a moment happens. Pure: names, the still pictures, and the one fragment of page script that plays them.
//
//   confirmed   the shop's own record has a booking or an order: a green disc pops, a marigold ring pulses, a tick draws itself (1.2 s)
//   paid        the record has the payment: a marigold coin drops, squashes and settles, a green tick badge pops on it (1 s)
//   hello       the first greeting on an empty chat: the shop's awning unrolls, one stripe after another (1.2 s)
//
// What they are. Our own Lottie files in motion/*.json, made from the brand's flat shapes only (marigold #f6a609, shutter green #136650, limewash #f7f8f4; streetlist-logo), each
// under 8 KB, no expressions, no images, no text. They are played ONCE by the vendored lottie-web light SVG build (vendor/lottie, 5.12.2, MIT), which the shop's front serves with a
// year's cache and the page asks for only when a moment arrives. The player has no `eval` (checked: vendor/lottie/README.md), so the page's policy needs no `unsafe-eval`.
//
// What stays. Every moment ends on a still frame that means the same in words: the still picture below is the animation's last frame, drawn in the page, with the sentence beside it
// (words-chat-more.ts). A phone that asks for less motion (prefers-reduced-motion) never loads the player: it shows the still and the words. A reload shows the still too, so a
// moment only plays for a line that ARRIVES while the page is open.
export const MOMENTS = ["confirmed", "paid", "hello"] as const;
export type MomentName = (typeof MOMENTS)[number];

/** The lottie-web build the front serves, and the address suffix that changes with it (so a year's cache is safe). */
export const LOTTIE_VERSION = "5.12.2";

/** The last frame of each animation as a still picture (a 120 by 120 box, the same shapes and colours as motion/*.json at their last frame). The greeting has none: it plays only when motion is welcome. */
export const STILLS: Record<"confirmed" | "paid", string> = {
  confirmed: `<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false"><circle cx="60" cy="60" r="42" fill="#136650"/><path d="M43 63l12 12 23-27" fill="none" stroke="#f7f8f4" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  paid: `<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false"><circle cx="58" cy="60" r="38" fill="#f6a609"/><circle cx="58" cy="60" r="27" fill="none" stroke="#f7f8f4" stroke-width="4"/><rect x="50" y="57" width="16" height="4" rx="2" fill="#136650"/><rect x="50" y="66" width="16" height="4" rx="2" fill="#136650"/><circle cx="86" cy="34" r="17" fill="#136650"/><path d="M79 34l5 6 10-12" fill="none" stroke="#f7f8f4" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

/** The page script's part that plays a moment: `playMoment(box, name)` swaps nothing until the player and the file have both arrived, plays once, then puts the still back. */
export const MOMENT_SCRIPT = `
  const calm = window.matchMedia ? matchMedia("(prefers-reduced-motion: no-preference)") : { matches: false };
  let player = null;
  const loadPlayer = () => (player = player || new Promise((ok, no) => { const s = document.createElement("script"); s.src = M.player; s.onload = () => (window.lottie ? ok(window.lottie) : no()); s.onerror = no; document.head.append(s); }));
  const files = {};
  const playMoment = async (box, name) => {
    if (!calm.matches || !box) return;
    try {
      const [lib, data] = await Promise.all([loadPlayer(), files[name] = files[name] || fetch(M.dir + name + ".json", { credentials: "omit" }).then((r) => { if (!r.ok) throw new Error(); return r.json(); })]);
      const holder = document.createElement("span"); holder.className = "anim"; box.append(holder); box.classList.add("playing");
      const a = lib.loadAnimation({ container: holder, renderer: "svg", loop: false, autoplay: true, animationData: JSON.parse(JSON.stringify(data)), rendererSettings: { preserveAspectRatio: "xMidYMid meet" } });
      a.addEventListener("complete", () => { if (name === "hello") return; /* the awning stays as its last frame */ box.classList.remove("playing"); a.destroy(); holder.remove(); });
    } catch { /* the still and the words are already there */ }
  };`;
