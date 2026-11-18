// The one look of every page a shop's customers and its owner see (plan item 11i, the design pass of 14 Nov 2026): the booking, order and fee pages (page.ts,
// order-page.ts, fee-page.ts), the owner's app (owner-page.ts, with assistant/app/talk.ts and push/pages.ts inside it) and the owner's sign-in pages
// (owner-session.ts, owner-passkey-page.ts). Before this pass each of those had its own small style sheet; they now share this one, so every screen of a shop looks
// and behaves the same and a fix lands everywhere at once.
//
// The look is Streetlist's (streetlist.in, its docs/Explanation.md sections 7 to 9): limewash paper and ink, flat colours (no gradients, glows or textures), one
// bold element (the shop's character on its own DiceBear tile), plain warm words, a calm layout. Colour carries meaning, as the owner asked on 14 Nov ("clear
// differentiation between states"): a state is a stamp in its meaning's colour (amber: waiting, green: done, red: did not happen, grey: closed), the five moods
// keep Streetlist's mood colours, and a chat bubble is coloured with white text so it reads at arm's length.
//
// Budget Android phones first: the phone's own font (no download: the pages' policy loads nothing, and Indic scripts are already on every Android phone), 360 px
// first, every tap target at least 44 px tall, no fixed heights or nowrap on anything with words (Hindi, Malayalam and Kannada run longer and taller), and nothing
// that moves after the first paint (what a script reveals sits in space kept for it, or beside something that does not move).
//
// Light by default for everyone. Dark only when the owner picks it, with the switch in the owner's app (`THEME_SWITCH`, `themeScript`): that page already runs
// Geometer's own nonce'd script, so the pick is remembered in the browser and set before the first paint. The customer's pages run no script and keep no cookie,
// so they have no way to remember a pick and stay light (left for later, docs/plans/release-verification.md, item 11i's design pass). Every colour that changes
// is a token, redefined once under :root[data-theme="dark"]; nothing reads the phone's own setting.
//
// Written readable and shrunk once at start (`min`): comments and spaces go, which halves what each page carries.

/** Comments out, runs of white space to one, none around the punctuation that needs none. Only for the sheets below (no strings or `calc()` sums in them). */
const min = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\s+/gu, " ").replace(/\s*([{};,>])\s*/gu, "$1").replace(/:\s+/gu, ":").replace(/;\}/gu, "}").trim();

/** Every page's part: the light tokens, the base, the head with the character, buttons, a state's stamp, cards, form fields, the foot. */
const CORE = `
/* ---- tokens: Streetlist's palette; meaning colours for states; the five mood colours ---- */
:root {
  --paper: #f7f8f4; --card: #ffffff; --ink: #1d2427; --soft: #4c585b; --line: #dde3dc; --line2: #b9c3bb;
  --green: #136650; --pill: #1d2427; --pill-ink: #ffffff; --focus: #1f5fd1; --head: #e2f2e9; --mari: #f6a609;
  --yes: #1f7a45; --yes-ink: #ffffff; --wa: #1f7a4d;
  --ok: #1f7a45; --ok-bg: #e3f4ea; --wait: #7a4f00; --wait-bg: #fff2d1; --bad: #b3261e; --bad-bg: #fdecea; --info: #285ea8; --info-bg: #e7f0fb; --plain: #4c585b; --plain-bg: #eceee9;
  --bubble: #136650; --bubble-ink: #ffffff;
  --m-well: #2e9e5b; --m-needs: #f6a609; --m-wrong: #d4402a; --m-closed: #5763a8; --m-busy: #c4386f;
  --tile: 0 1px 2px rgb(29 36 39 / .08), 0 10px 22px -12px rgb(29 36 39 / .38);
  --text: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari", "Noto Sans Malayalam", "Noto Sans Kannada", sans-serif;
  color-scheme: light;
}
/* ---- base ---- */
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 1.0625rem/1.55 var(--text); overflow-wrap: break-word; }
/* Devanagari, Malayalam and Kannada carry marks above and below the line: more room between lines */
:lang(hi) body, :lang(ml) body, :lang(kn) body { line-height: 1.7; }
h1, h2, h3 { line-height: 1.25; margin: 0 0 .45em; font-weight: 750; letter-spacing: -.005em; }
h1 { font-size: 1.55rem; }
h2 { font-size: 1.2rem; margin-top: 30px; }
h3 { font-size: 1.05rem; margin-top: 4px; }
p { margin: 0 0 .8em; }
a { color: var(--green); text-underline-offset: .18em; }
img { max-width: 100%; }
ul { margin: 0; padding: 0; list-style: none; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; border-radius: 6px; }
[hidden] { display: none !important; }
.wrap { max-width: 36rem; margin: 0 auto; padding: 0 16px; }
main.wrap { padding-bottom: 40px; }
.note { color: var(--soft); font-size: .92rem; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.machine { background: var(--wait-bg); color: var(--wait); padding: 8px 12px; border-radius: 10px; font-size: .88rem; }
.notice { background: var(--info-bg); color: var(--info); padding: 10px 14px; border-radius: 12px; font-weight: 600; }
.warn { color: var(--bad); }

/* ---- the head: a flat tint, the character's tile (the one bold element), the name, the mood as a chip with its colour ---- */
.head { position: relative; background: var(--head); padding: 18px 0 16px; margin-bottom: 18px; }
.head-in { display: flex; gap: 14px; align-items: center; }
.head h1 { margin: 0; font-size: 1.6rem; }
.where { margin: 3px 0 0; color: var(--soft); font-size: .95rem; }
.face-c, .who-am-i img { flex: none; width: 84px; height: 84px; border-radius: 22px; background: var(--card); box-shadow: var(--tile); }
.mood { display: inline-block; margin: 8px 0 0; padding: .3em .75em; border-radius: 12px; background: var(--card); font-size: .9rem; line-height: 1.4; }
.mood::before { content: ""; display: inline-block; width: .7em; height: .7em; margin-right: .45em; border-radius: 50%; background: var(--m, var(--m-well)); }
.m-well { --m: var(--m-well); } .m-needs { --m: var(--m-needs); } .m-wrong { --m: var(--m-wrong); } .m-closed { --m: var(--m-closed); } .m-busy { --m: var(--m-busy); }
.langs { display: flex; flex-wrap: wrap; gap: 6px; margin: 14px 0 0; }
.langs a, .langs b { display: inline-flex; align-items: center; min-height: 44px; padding: 0 13px; border-radius: 999px; font-size: .95rem; text-decoration: none; }
.langs a { color: var(--ink); background: var(--card); border: 1px solid var(--line2); }
.langs b { background: var(--pill); color: var(--pill-ink); }

/* ---- buttons: the ink pill leads; a quiet outline for the other choice. 24 px corners: a pill on one line, a rounded card when Malayalam wraps it to three ---- */
button, .btn { display: inline-flex; align-items: center; justify-content: center; gap: .45em; min-height: 48px; margin-top: 12px; padding: .55em 1.3em; border: 0; border-radius: 24px; background: var(--pill); color: var(--pill-ink); font: 650 1.02rem/1.3 var(--text); text-align: center; text-decoration: none; cursor: pointer; }
button.quiet, .btn.quiet, button.no { background: transparent; color: var(--ink); border: 1.5px solid var(--line2); }
button.yes { background: var(--yes); color: var(--yes-ink); }
.btn.wa { background: var(--wa); color: #ffffff; }
button:disabled { opacity: .6; cursor: default; }
.full { display: flex; width: 100%; }

/* ---- a state: a stamp in its meaning's colour and the sentence that says it. Mixed case, as Streetlist's tag: all-caps labels read as template chrome ---- */
.state { margin: 4px 0 16px; padding: 12px 14px; border-radius: 14px; border-left: 6px solid var(--s); background: var(--s-bg); }
.state .status { margin: 6px 0 0; font-size: 1.08rem; font-weight: 650; }
.stamp { display: inline-block; padding: .2em .6em; border-radius: 7px; background: var(--s); color: var(--card); font-size: .85rem; font-weight: 750; line-height: 1.4; }
.s-wait { --s: var(--mari); --s-bg: var(--wait-bg); } .s-wait .stamp { color: #2a1a00; }
.s-ok { --s: var(--ok); --s-bg: var(--ok-bg); }
.s-bad { --s: var(--bad); --s-bg: var(--bad-bg); }
.s-info { --s: var(--info); --s-bg: var(--info-bg); }
.s-plain { --s: var(--plain); --s-bg: var(--plain-bg); }

/* ---- cards and form fields ---- */
.box, .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 14px; margin: 14px 0; }
.card > h2:first-child, .card > .btn:first-child { margin-top: 0; }
.list > .card { margin: 0; }
/* a note right under a field, a wide button or the messages belongs to it: a little air, not a gap */
input + .note, .full + .note, .msgs + .note { margin-top: 8px; }
/* a link alone in its line is a tap target: 44 px tall */
p > a:only-child:not(.btn) { display: inline-block; padding: 11px 0; }
input:disabled { opacity: .45; background: var(--plain-bg); }
#alerts-on, #alerts-off { width: 100%; }
.sum p { margin: 0; }
.sum b { font-size: 1.1rem; }
label.f { display: block; margin: 16px 0 6px; font-weight: 650; }
input[type=text], input[type=tel], input[type=number], input:not([type]), textarea { width: 100%; min-height: 48px; padding: 10px 12px; border: 1.5px solid var(--line2); border-radius: 12px; background: var(--card); color: var(--ink); font: inherit; }
textarea { min-height: 88px; resize: vertical; }

/* ---- the foot: what an AI assistant can do (folded), the Operator's line ---- */
footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--soft); font-size: .92rem; }
footer + footer { margin-top: 0; border-top: 0; }
/* a folded part keeps the browser's own triangle (list-item), and is still 44 px tall */
footer summary { display: list-item; padding: 12px 0; cursor: pointer; font-weight: 650; color: var(--ink); }
footer a { display: inline-block; padding: 11px 0; }

/* money clarity: the UPI box's folded "payment did not go through?", and the row of its small buttons (copy the UPI ID, open in Chrome) */
.fold { margin-top: 12px; border-top: 1px solid var(--line); }
.fold summary { display: list-item; padding: 12px 0; cursor: pointer; font-weight: 650; }
.fold ul { margin: 0 0 12px; padding-left: 20px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }

/* a card with a stamp (a fee, a thing waiting on the owner), its edge in the stamp's colour; the padlock line for a private page */
.private { display: flex; gap: 8px; align-items: flex-start; }
.private svg { flex: none; width: 18px; height: 18px; margin-top: 3px; }
.item { background: var(--card); border: 1px solid var(--line); border-left: 6px solid var(--s, var(--mari)); border-radius: 16px; padding: 12px 14px 14px; margin: 0 0 12px; }
.item .top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 10px; margin-bottom: 8px; }
.item .amt { font-size: 1.3rem; font-weight: 800; }
.item p { margin: 0 0 .5em; }
.item h3 { margin: 8px 0 2px; }
/* who to call (contact-bar.ts): the Operator's name with Call and WhatsApp, and the shop's own call and map links; 44 px tall taps */
.who { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 0 0 14px; padding: 10px 12px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; font-size: .95rem; }
.who b { flex: 1 1 100%; }
.who .btn { flex: 1 1 auto; margin: 0; min-height: 44px; }
/* the owner's sign-in pages: the passkey button's place is kept while its script decides to show it, so nothing below moves */
.signin { padding-top: 28px; }
.pk-slot { min-height: 60px; margin: 0; }
input.code { font-size: 1.25rem; letter-spacing: .12em; text-transform: uppercase; }
`;

/** The customer's pages: the front page's extras, services and items as choices, days and times as tiles, paying, the shop's messages. */
const CUSTOMER = `
/* the front page's extras: WhatsApp and the week's hours */
.face-x { display: grid; gap: 10px; margin: 0 0 16px; }
.face-x .btn { margin: 0; }
.hours { background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
.hours summary { display: list-item; padding: 12px 14px; cursor: pointer; font-weight: 650; }
.hours ul { padding: 0 14px 12px; columns: 2; column-gap: 16px; font-size: .95rem; }
.hours li { break-inside: avoid; padding: 2px 0; }

.list { display: grid; gap: 8px; }
.choice { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 12px; min-height: 56px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); color: var(--ink); text-decoration: none; }
.choice > b { font-weight: 650; }
.choice > span { font-weight: 750; }
.choice > small { flex-basis: 100%; }
a.choice:hover { border-color: var(--line2); }
.choice.on { border: 2px solid var(--green); background: var(--ok-bg); padding: 11px 13px; }
.choice input[type=number] { width: 6.5em; margin-top: 6px; }
.days { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 14px; }
.days a, .days b { display: inline-flex; align-items: center; min-height: 44px; padding: 0 14px; border-radius: 999px; font-size: .95rem; text-decoration: none; }
.days a { color: var(--ink); background: var(--card); border: 1px solid var(--line2); }
.days b { background: var(--pill); color: var(--pill-ink); }
/* a time or a slot is a tile: the radio stays in the page (keyboard, screen reader, no script) and its tile shows the pick */
.slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(6.4em, 1fr)); gap: 8px; }
.slots.wide { grid-template-columns: 1fr; }
.slots label { position: relative; display: flex; }
.slots input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.slots span { display: flex; flex: 1; align-items: center; justify-content: center; gap: .3em; flex-wrap: wrap; min-height: 48px; padding: 6px 10px; border: 1px solid var(--line2); border-radius: 12px; background: var(--card); text-align: center; cursor: pointer; }
.slots input:checked + span { background: var(--pill); color: var(--pill-ink); border-color: var(--pill); font-weight: 650; }
.slots input:focus-visible + span { outline: 3px solid var(--focus); outline-offset: 2px; }
.slots input:disabled + span { opacity: .55; cursor: default; }
/* ---- paying: the amount, the UPI app's button, the code on a white ground (a phone's camera reads it in dark too) ---- */
.pay .amount { font-size: 1.15rem; }
.qr { display: grid; justify-items: center; }
.qr svg { width: 220px; height: 220px; display: block; margin: 6px 0 10px; padding: 10px; background: #ffffff; border-radius: 12px; }

/* ---- messages: coloured bubbles with white text, newest first, the time under each ---- */
.msgs { display: grid; gap: 10px; }
.msgs li { justify-self: start; max-width: 90%; padding: 10px 14px; border-radius: 18px 18px 18px 6px; background: var(--bubble); color: var(--bubble-ink); white-space: pre-line; }
.msgs .note { display: block; margin-top: 4px; color: inherit; opacity: .85; font-size: .8rem; white-space: normal; }

`;

/**
 * The dark set and the switch's button, shared by the owner's app and the chat page (the only two pages that run Geometer's own script, so the only two that can remember a
 * pick). Dark only when picked, never from the phone's own setting; every colour that changes is a token.
 */
const DARK = `
/* dark, only when picked (the owner's app); a thin light ring keeps a near-black tile (Pixel Bot's) apart from the dark paper */
:root[data-theme="dark"] {
  color-scheme: dark;
  --paper: #151d1b; --card: #1e2926; --ink: #eef3ee; --soft: #b3c0ba; --line: #2b3935; --line2: #4a5b55;
  --green: #74d6b1; --pill: #f2f5f0; --pill-ink: #151d1b; --focus: #ffc94d; --head: #1a2e27;
  --yes: #74dfa0; --yes-ink: #10231a;
  --ok: #74dfa0; --ok-bg: #16301f; --wait: #ffd27a; --wait-bg: #33290f; --bad: #ff9d8f; --bad-bg: #3a1a17; --info: #a9cbff; --info-bg: #1b2a3d; --plain: #c4cec9; --plain-bg: #26302d;
  --bubble: #1f6f57;
  --tile: 0 0 0 2px rgb(255 255 255 / .16), 0 10px 22px -12px rgb(0 0 0 / .7);
}
.head .wrap { position: relative; }
.theme { position: absolute; top: -4px; right: 16px; width: 44px; min-height: 44px; margin: 0; padding: 0; border-radius: 50%; background: var(--card); color: var(--ink); border: 1px solid var(--line2); }
.theme svg { width: 22px; height: 22px; }
.theme .sun, :root[data-theme="dark"] .theme .moon { display: none; }
:root[data-theme="dark"] .theme .sun { display: block; }
`;

/** The owner's app: the character's line, what waits, the coming list, the talk and the alerts. */
const OWNER = `
/* ---- the owner's app ---- */
.who-am-i { display: flex; gap: 14px; align-items: center; margin: 0; }
.who-am-i img { width: 72px; height: 72px; border-radius: 20px; }
.who-am-i .dot { flex: none; width: 20px; height: 20px; border-radius: 50%; }
.app .head-in { padding-right: 52px; }
.acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.acts form { display: flex; flex: 1 1 9.5rem; }
.acts button { flex: 1; margin: 0; }
.calm { display: flex; gap: 10px; align-items: center; padding: 14px; border-radius: 16px; background: var(--ok-bg); color: var(--ink); }
.calm::before { content: ""; flex: none; width: .8em; height: .8em; border-radius: 50%; background: var(--m-well); }
/* the coming list: the time on its own line over what and who, so every row lines up whatever the language's date runs to */
.rows li { padding: 10px 0; border-bottom: 1px solid var(--line); }
.rows li > b { display: block; font-weight: 650; }
.talk-lines { display: grid; gap: 8px; margin: 0 0 12px; }
.talk-lines p { max-width: 90%; margin: 0; padding: 9px 14px; border-radius: 18px; }
.talk-lines b { display: block; font-size: .78rem; opacity: .85; }
.talk-owner { justify-self: end; background: var(--bubble); color: var(--bubble-ink); border-bottom-right-radius: 6px; }
.talk-assistant { justify-self: start; background: var(--card); border: 1px solid var(--line); border-bottom-left-radius: 6px; }
.talk .mic { display: flex; gap: 8px; align-items: flex-start; margin: 8px 0 0; }
.talk .mic svg { flex: none; width: 18px; height: 18px; margin-top: 2px; }
.talk-row { display: flex; gap: 8px; }
.talk-row button { flex: 1; }
.alerts fieldset { border: 0; padding: 0; margin: 8px 0; }
.alerts legend { font-weight: 650; margin-bottom: 4px; }
.alerts label { display: flex; align-items: center; gap: 10px; min-height: 44px; }
.alerts input[type=radio], .alerts input[type=checkbox] { width: 22px; height: 22px; margin: 0; accent-color: var(--green); }
`;

/**
 * The chat on the shop's page (W1, 17 Nov 2026). The shop's own signboard leads (its paint colour, or the head's green tint; the name in Baloo 2, the one font this page
 * loads, for the name, headings and buttons only: Hindi, Malayalam and Kannada stay on the phone's own font). Flat colours only, as on every page (no gradients, glows,
 * textures, shadows on text, dashed lines or bobbing: the owner rejected those on 14 Nov). The shop's bubble is shutter green with white text and a squared bottom-left
 * corner, the guest's is card white with ink text and a squared bottom-right, as on the Streetlist home page's phone. Marigold is the one inviting action only.
 * The page scrolls as one page and its bottom bar (the notes and the composer) is `position: sticky; bottom: 0` (18 Nov 2026, after the design review): see .bar below.
 */
const CHAT = `
body.chat { display: flex; flex-direction: column; min-height: 100dvh; font-family: var(--text); }
.display, .sign h1, .tap, .comp button, .sign .mood { font-family: var(--display, var(--text)); }
.sign { flex: none; background: var(--paint, var(--head)); color: var(--paint-ink, var(--ink)); padding: 10px 0 10px; border-bottom: 1px solid var(--line2); }
.sign .wrap { position: static; display: grid; gap: 8px; }
/* The head is laid out by wrapping, never by absolute positions (18 Nov 2026 review: at 200% text the language button sat on the assistant's status line). Row one: the face, the
   name with the status (which may wrap onto more lines) and the light/dark switch. Row two: "Call the shop" and the language button; each wraps to its own line when there is no room. */
.sign-top { display: flex; align-items: center; gap: 12px; }
.sign-in { display: flex; flex: 1 1 0; min-width: 0; gap: 12px; align-items: center; min-height: 60px; }
.sign-in > div { min-width: 0; }
.sign-acts { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
.sign-acts .callbtn { min-height: 44px; margin: 0; padding: .3em 1em; }
.sign .face-c { width: 52px; height: 52px; border-radius: 14px; }
.sign h1 { margin: 0; font-size: 1.3rem; line-height: 1.15; font-weight: 700; overflow-wrap: anywhere; }
.sign .mood { margin: 4px 0 0; padding: .15em .6em; font-size: .82rem; background: var(--card); color: var(--ink); }
.sign .theme { position: static; flex: none; width: 44px; height: 44px; margin: 0; }
.lang { position: relative; margin-left: auto; }
.lang summary { display: flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; padding: 0 12px; border-radius: 999px; background: var(--card); color: var(--ink); border: 1px solid var(--line2); font-size: .9rem; cursor: pointer; list-style: none; }
.lang summary::-webkit-details-marker { display: none; }
.lang div { position: absolute; right: 0; top: 100%; z-index: 3; display: grid; min-width: 9rem; margin-top: 4px; background: var(--card); border: 1px solid var(--line2); border-radius: 14px; overflow: hidden; }
.lang a, .lang b { display: flex; align-items: center; min-height: 44px; padding: 0 14px; color: var(--ink); text-decoration: none; }
.lang b { background: var(--pill); color: var(--pill-ink); }
.banner { flex: none; margin: 0; padding: 8px 16px; background: var(--wait-bg); color: var(--wait); font-size: .92rem; text-align: center; }
.thread { flex: 1 0 auto; padding: 14px 0 8px; }
.thread .wrap { display: grid; gap: 8px; }
.sys.small { font-size: .74rem; margin-top: -4px; }
.sys { margin: 0 0 6px; color: var(--soft); font-size: .82rem; text-align: center; }
.sys a { color: var(--soft); display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0; }
.sys svg { width: 26px; height: 26px; flex: none; }
.run { display: grid; gap: 4px; }
.row-b { display: flex; align-items: flex-end; gap: 8px; }
.row-b.you { justify-content: flex-end; }
.mini { flex: none; width: 30px; height: 30px; border-radius: 9px; background: var(--card); }
.gap-mini { flex: none; width: 30px; }
.b { max-width: min(82%, 26rem); padding: 9px 13px; border-radius: 18px 18px 18px 4px; background: var(--bubble); color: var(--bubble-ink); white-space: pre-line; overflow-wrap: anywhere; font-size: 1rem; }
.b a { color: inherit; font-weight: 650; text-underline-offset: .18em; }
.b.you { background: var(--card); color: var(--ink); border: 1px solid var(--line2); border-radius: 18px 18px 4px 18px; }
.b.pending { opacity: .7; }
.t { margin: 0 4px 0; color: var(--soft); font-size: .76rem; line-height: 1.3; }
.t.you { text-align: right; }
.t svg { width: .95em; height: .95em; vertical-align: -.12em; }
.retry { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; margin: 0; padding: 4px 12px; border: 0; border-radius: 12px; background: var(--bad-bg); color: var(--bad); font-weight: 650; font-size: .95rem; }
.retry .stamp { background: var(--bad); color: var(--card); }
.dots { display: inline-flex; gap: 5px; align-items: center; padding: 14px 16px; }
.dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--bubble-ink); opacity: .85; }
@media (prefers-reduced-motion: no-preference) { .dots { animation: pulse 1.6s ease-in-out infinite; } @keyframes pulse { 50% { opacity: .55; } } }
.taps { display: grid; gap: 8px; margin: 4px 0 0 38px; max-width: 26rem; }
.tap { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 10px; width: 100%; min-height: 44px; margin: 0; padding: 10px 14px; border: 1.5px solid var(--line2); border-radius: 14px; background: var(--card); color: var(--ink); font-size: 1rem; font-weight: 650; text-align: left; overflow-wrap: anywhere; box-shadow: var(--tile); }
.tap small { flex-basis: 100%; color: var(--soft); font-weight: 400; font-size: .85rem; }
.tap.go { background: var(--mari); border-color: var(--mari); color: #2a1a00; }
.tap:disabled { opacity: .55; }
/* The bottom bar (the notes, the hold-to-talk hint and the composer) is part of the page's flow and sticks to the bottom edge (18 Nov 2026 review). Why this and not a fixed bar
   or a scrolling thread box: the whole page scrolls as one, so the last of the thread (the keep box, cards, the capped notice) is always reachable ABOVE the bar, never under it,
   and at 200% text, when the head and the bar together fill a small phone, the head simply scrolls away instead of squeezing the conversation to a sliver (it was 40 px tall
   in the old fixed-height column). The bar is in the flow after the thread, so the bar's own height is never added up by script (no ResizeObserver). The keyboard: a bar stuck
   to the layout viewport would ride under the keyboard on a phone, so the script puts the keyboard's height in --kb (from the visual viewport) and the bar sticks that far up. */
.bar { position: sticky; bottom: var(--kb, 0px); z-index: 2; background: var(--paper); }
.notes { display: grid; gap: 6px; }
.notes .state { margin: 0 0 6px; padding: 8px 12px; }
.notes .state .status { margin: 0; font-size: .95rem; font-weight: 600; }
.comp { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; padding: 8px 16px calc(8px + env(safe-area-inset-bottom)); background: var(--paper); border-top: 1px solid var(--line2); }
/* The message box keeps at least 12em (or the whole row on a phone narrower than that) and takes a whole row when it cannot sit beside the buttons (200% text); the microphone and Send then sit below it. Send grows a little (1 against the box's 100), so alone on a row it fills it. */
.comp textarea { flex: 100 1 12em; min-width: min(12em, 100%); min-height: 48px; max-height: 8.5rem; padding: 11px 14px; border-radius: 24px; font: 400 1rem/1.4 var(--text); resize: none; }
.comp button { flex: 1 0 auto; margin: 0; min-width: 76px; min-height: 48px; }
.comp .rec { flex: none; min-width: 48px; }
.alerts-slot .alerts { margin: 0; }
.alerts-slot .card { margin: 6px 0; }
@media (max-width: 340px) { .b { max-width: 90%; } .taps { margin-left: 0; } }
/* ---- motion's places (17 Nov 2026): the head's picture, a moment the record marks, hold to talk ---- */
.face-p { flex: none; display: block; line-height: 0; border-radius: 14px; }
.moment { display: flex; align-items: center; gap: 10px; max-width: min(82%, 26rem); margin: 2px 0 0 38px; padding: 8px 12px 8px 8px; border-radius: 14px; background: var(--ok-bg); color: var(--ink); font-weight: 650; font-size: .95rem; line-height: 1.35; }
.moment b { font-weight: 650; }
.art { position: relative; flex: none; width: 44px; height: 44px; }
.art > svg, .art .anim, .art .anim > svg { display: block; width: 100%; height: 100%; }
.art .anim { position: absolute; inset: 0; }
.art.playing > svg { visibility: hidden; }
.hello-art { display: none; justify-content: center; height: 72px; margin: 0 0 4px; }
.hello-art.on { display: flex; }
.hello-art .art { width: 72px; height: 72px; }
`;

const INSTALL = `
/* the install prompt on a chat served through Streetlist (W3): one big button, or on an iPhone the one-line Share hint with its icon, and a quiet "Not now" */
#install-go { width: 100%; }
#install-slot .quiet { margin-top: 6px; }
.note.ios { display: flex; align-items: center; gap: 10px; font-weight: 600; }
.share-i { flex: none; width: 26px; height: 26px; fill: none; stroke: var(--green); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
`;

const VOICE = `
.rec { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; margin: 0; padding: 0; border: 1.5px solid var(--line2); border-radius: 50%; background: var(--card); color: var(--ink); touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.rec svg { width: 24px; height: 24px; }
.rec.on { background: var(--bad); border-color: var(--bad); color: #fff; }
.rec-hint { display: flex; align-items: center; gap: 8px; margin: 0; padding: 4px 16px 0; color: var(--soft); font-size: .9rem; }
.rec-hint svg { width: 18px; height: 18px; flex: none; }
.rec-note { display: flex; align-items: center; gap: 8px; margin: 0; padding: 6px 16px; background: var(--bad-bg); color: var(--bad); font-weight: 650; font-size: .95rem; }
.rec-note i { width: 10px; height: 10px; border-radius: 50%; background: var(--bad); flex: none; }
`;

/** The style sheets, shrunk once. Each page puts its own in a <style> (the pages' policy allows inline styles only). */
export const CUSTOMER_CSS = min(CORE + CUSTOMER);
export const OWNER_CSS = min(CORE + DARK + OWNER);
export const CHAT_CSS = min(CORE + DARK + CHAT);
/** Hold to talk's own rules (the button, the hint, the red note): added only to a page whose shop has a voice service, so a shop without one carries nothing of it. */
/** The install prompt's rules (W3): added only to a page served through the Streetlist door, which is the only page that has the slot. */
export const CHAT_INSTALL_CSS = min(INSTALL);
export const CHAT_VOICE_CSS = min(VOICE);
/** The owner's sign-in pages: the common part only. */
export const SIGNIN_CSS = min(CORE);

/** The owner's dark/light switch (moon in light, sun in dark), hidden until the app's script runs, then remembered on this phone. Its own spot in the head: showing it moves nothing. */
export const themeSwitch = (label: string): string =>
  `<button type="button" id="theme" class="theme" hidden aria-pressed="false" aria-label="${label.replace(/"/gu, "&quot;")}">`
  + `<svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.4 14.6A8.5 8.5 0 0 1 9.4 3.6a8.5 8.5 0 1 0 11 11Z"/></svg>`
  + `<svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 1.8v2.4M12 19.8v2.4M1.8 12h2.4M19.8 12h2.4M4.8 4.8l1.7 1.7M17.5 17.5l1.7 1.7M4.8 19.2l1.7-1.7M17.5 6.5l1.7-1.7"/></svg></button>`;

/** Where the pick is kept: one key for every shop's app on this browser (a liking, not a secret). */
export const THEME_KEY = "shop-theme";

/**
 * The owner's app's ONE script, in its head with the response's nonce: the remembered dark pick is set on <html> at once (before anything paints), then, when
 * the page has been read, the switch is wired and the app's other parts run (`parts`: the talk box's and the alerts' code, each a self-running function). One
 * script, as the app's content policy and its test expect; nothing else runs on the page.
 */
export function themeScript(parts: readonly string[]): string {
  return `(() => {
  const root = document.documentElement;
  try { if (localStorage.getItem("${THEME_KEY}") === "dark") root.dataset.theme = "dark"; } catch {}
  document.addEventListener("DOMContentLoaded", () => {
    const t = document.getElementById("theme");
    if (t) {
      const show = () => t.setAttribute("aria-pressed", String(root.dataset.theme === "dark"));
      t.hidden = false; show();
      t.addEventListener("click", () => {
        if (root.dataset.theme === "dark") delete root.dataset.theme; else root.dataset.theme = "dark";
        try { localStorage.setItem("${THEME_KEY}", root.dataset.theme === "dark" ? "dark" : "light"); } catch {}
        show();
      });
    }
${parts.join("\n")}
  });
})();`;
}

/** Small line icons drawn inline (the pages load no pictures but data: ones): a padlock for "this page is private", a microphone for the keyboard-mic hint. */
export const ICON = {
  lock: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
};
