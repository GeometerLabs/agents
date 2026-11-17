# lottie-web, light SVG build (vendored)

- What: `lottie_light.min.js`, the light SVG build of lottie-web (no expressions, so no `eval` or `new Function`), version **5.12.2**.
- Where from: `npm pack lottie-web@5.12.2`, file `package/build/player/lottie_light.min.js`, copied byte for byte. Licence: MIT (`LICENSE`, Copyright (c) 2015 Bodymovin).
- Why here: the chat on the shop's page plays three small animations (confirmed, payment received, the awning). The shop's own front serves this file at `<page>/chat/m/lottie.js` with a year's cache, and the page loads it only when a moment happens and the phone has not asked for less motion. Nothing is fetched from another site.
- Checked on 17 Nov 2026: the file has no `eval(` and no `new Function`; the one `Function(` in it is the name `createRenderFunction(`. The page's script policy therefore needs no `unsafe-eval`.
- To update: pack the new version into an empty folder, copy only that file and the licence, change the version here and in `chat-motion.ts`, and look at every moment again (`node modules/channels/chat-screens.ts`).
