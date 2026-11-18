# The shop's chat page

This is the chat that opens from a shop's own page, at `https://<shop's page>/chat`. A guest (a customer, or a parent of a student) types or taps and the shop's assistant answers. It is the same assistant that answers on WhatsApp, so a chat send is turned into the message a WhatsApp customer would have sent and handed to the shop's own template. The page itself holds no shop logic.

It is written for people who are not technical: big worded buttons before typing, "Call the shop" always on the page, text that scales to 200%, four languages (English, Hindi, Malayalam, Kannada), and no jargon.

## The parts

```
 browser                         the shop's server
 +-------------------+           +---------------------------------+
 | chat-page.ts      |  GET /chat| chat-front.ts   (routes, policy)|
 |  markup + ONE     |<----------| chat.ts         (the thread,    |
 |  inline script    |  /send    |                  a send as a    |
 |  look.ts  (CSS)   |---------->|                  step, the caps)|
 |  words-chat.ts    |  /thread  | outbox.ts       (what is kept)  |
 |  chat-motion.ts   |<----------| chat-identity-* (keep my chat)  |
 +-------------------+           +---------------------------------+
```

- `chat-page.ts`: draws the page. Head (the shop's signboard: face, name, mood, light/dark switch, "Call the shop", language), the thread, then the bottom bar. One script, run by the response's nonce.
- `look.ts` (`CHAT_CSS`): the one look. Flat colours, Baloo 2 for the name, headings and buttons, the shop's paint colour on the head, marigold for the one inviting action. Dark set shared with the owner's app.
- `words-chat.ts`, `words-chat-more.ts`, `words-chat-identity.ts`: the words in four languages. Hindi, Malayalam and Kannada are machine-written and appear on the review sheets (`bundle/panel/review.ts`) for a native reader.
- `chat-motion.ts`, `motion/`, `vendor/lottie/`: the few moments that are animated (the booking confirmed, payment received, the greeting). Off for visitors who ask for less motion.
- `chat-identity-page.ts`, `chat-identity-front.ts`, `chat-identity.ts`: "keep this chat on this phone", "been here before?", "delete my chat". Offered only when a booking, order or fee exists.
- `chat-front.ts`: the routes and the Content-Security-Policy (the page may call only its own `/chat/...` addresses).
- `chat.ts`: the guest's thread and a send as a step. Pure code, no disk.

## The layout rules (18 Nov 2026 design review)

- The whole page scrolls as one. The bottom bar (notices and the composer) is `position: sticky; bottom: 0`, so the last part of the conversation is always reachable above it and never hidden under it. Its bottom offset is `--kb`, the keyboard's height read from the visual viewport by the script.
- The head wraps; nothing in it is positioned absolutely. Row one: face, name and mood (may wrap), light/dark switch. Row two: "Call the shop" and the language button.
- The composer wraps. The message box keeps at least 12em; at large text it takes a whole row and the microphone and Send sit below it. Every tap target is at least 44 x 44 px.
- The page opens at the latest line and stays there while things above it settle, until the guest scrolls.
- Words the guest reads never include "AI", "bot", "session", "error", "retry" or "passkey".

## Shop or centre

A tuition centre is not a shop. On a Fees chat every line that says "shop" says "centre" instead ("Call the centre", "The centre's assistant replies here...", "The centre keeps this chat for 30 days"), in all four languages. It is done with one small per-kind noun table in `words-chat.ts` (`NOUN`, with the case endings Malayalam and Kannada need) and `forKind(kind, language, words)`, which the page applies to the chat, moments, call button and identity-box words; the sentences are not copied per kind. Bookings and Orders keep "shop" (a listings-only or stock shop has no chat and no customer page with these words).

The lines were also written for a salon, so the same table rewrites the words about what the guest holds (19 Nov 2026): Bookings says "booking link" and "a booking or a payment"; Orders says "order link" and "an order or a payment"; Fees says "fee page link" and "a payment" (a parent pays a fee, never books). The words are in `NOUN` for `orders` and `fees`, in all four languages, with the Hindi gender changes (मेरी बुकिंग / मेरे ऑर्डर). The call button on every customer page (`shopContact`, `contact-bar.ts`) reads the same table: the front adds the shop's kind to the contact it gives each page (`front.ts withContact`), so a centre's pages say "Call the centre" and a caller that does not know the kind says "Call the shop". The one WhatsApp template for "send me my link" (`chat_my_link`) says only "your link", so it serves every kind. The changed lines are on the review sheets as `chat.centre.*` and `chat.orders.*`. The changed lines are on the review sheets as `chat.centre.*` (`node bundle/panel/review-sheet.ts hi|ml|kn`). A test (`test/chat.test.ts`) checks that a Fees chat never says shop.

## The states

`empty`, `answered`, `long`, `sending`, `failed`, `slow`, `offline`, `capped`, `closed`, `paused`, `alerts`, `confirmed`, `paid`, `confirmed-live`, `paid-live`, `voice`, `recording`, `busy`, `keep`, `newphone`, and `paints` (the five signboard paints and their contrast). Three kinds of shop: `bookings`, `orders`, `fees` (and `fees` with `?parent=1`, a parent's own fee).

## The screens server

`chat-screens.ts` draws the real page for every state from plain data: no runtime, model, WhatsApp or network.

```
node modules/channels/chat-screens.ts 8799
http://127.0.0.1:8799/<state>?lang=en|hi|ml|kn&kind=bookings|orders|fees&parent=1&theme=dark&paint=pink
```

It answers the addresses the page's script asks for, as a shop would: `/thread`, `/id/state` (its `work` field is 1 only where the sample thread has a booking, order or fee, so the number box shows only there), `/sw.js` (a small stand-in worker for the alerts state), the font, the Lottie player and the character pictures. Orders has a menu with prices, an order held, confirmed and paid, and a pickup time. Fees has the centre's public questions, and with `?parent=1` one parent's own fee with its UPI line.

## The review capture

`scripts/review-capture.mjs` starts the screens server, opens every state at 360, 390 and 414 px wide, light and dark, in four languages, and at 200% text, and writes screenshots plus `summary.md` and `contact-sheet.html` with the automatic checks (console errors, axe-core, overflow, tap targets under 44 px, clipped text, forbidden words).

```
node modules/channels/scripts/review-capture.mjs --out /some/folder --playwright-from ../public-web/package.json
```

`--playwright-from` is a `package.json` beside a `node_modules` that has `playwright-core` (with Chromium) and `axe-core`; this repository adds no browser dependency. A person must still open the pictures: the checks do not see a face that is cut off or a colour that feels wrong.

## Tests

`test/chat.test.ts`, `chat-more.test.ts`, `chat-talk.test.ts`, `chat-identity*.test.ts`, `chats-list.test.ts`, `look.test.ts`. Run one with `node --test modules/channels/test/chat.test.ts`.

## Not built

A shop's own sign-in for guests (the guest is identified by a cookie, or optionally a passkey they choose to add). Payments inside the chat: the shop sends a UPI line and the shop's record says when it arrived. Native Hindi, Malayalam and Kannada review of the words is still to come.
