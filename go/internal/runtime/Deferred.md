# internal/runtime: what the chat and a customer's talk leave for later

* **The step that runs a guest's send.** `ChatTurn` is ready; the Bookings agent core calls it from `Handle` for a `chat_message` (`TRIAL.md` has the exact call). Until it does, a guest's send is saved and its
  task ends failed as not ported, and the chat contract's tests that need an answer wait (listed in `TRIAL.md`).
* **Compacting the channel state** (`ChannelState.Compact`) is written and tested, but the runtime's daily `compact` step is not ported for a template yet (retention, `core.ts` line 397), so nothing calls it. The
  identity file's `DropGone` and `Purge` wait for the same step.
* **Hold-to-talk** (`chat-voice`, `PageAudio`, `OnHeard`): the route and the turn are written; a template without a speech service (every Go template today) gets the 404 "Voice is not on for this shop" and
  no `listen` in the thread read. A template that adds a speech service offers `ChatVoiceKit`.
* **A parent's chat** (Fees): `openEvent` and `openRead` refuse a `parent` (no Fees centre in this runtime). Orders and Fees add `ParentKit` when they come.
* **A guest's alerts** (web push for a chat guest: the push route's `customer_*` ops on a chat conversation) are not on for a template; `forget` therefore does not end alert subscriptions.
* **`chat_link`** (the WhatsApp message with a guest's one-use link, `chat-link-send.ts`): the route makes the same answers and saves the event; its step ends failed as not ported. See `internal/chatid/Deferred.md`.
* **The free times and the customer's own case in a customer's prompt** are the template's `publicContext` (`CustomerTalkInput.Sources`); Bookings' is the agent core's.
* `(?i)` in the shared claim and banned word lists is Go's, which also folds U+017F and U+212A (the report package's `Deferred.md` says the same).

## The owner's assistant for a template's shop (20 Nov 2026)

| Part | TypeScript | Why not yet | What it does instead |
|------|-----------|-------------|----------------------|
| The outgoing check over the assistant's own lines | conversation.ts sayVoice.matches over words.ts Writer facts | the lines are the packed words filled with the record's own values, so it has nothing to catch | recorded as allowed; the talk's reply is checked |
| "open my app" from the owner on WhatsApp for a template's shop | owner-signin.ts `takes` for a message | the sign-in event (`owner_signin`) is ported for a template's shop, the WhatsApp phrase not yet | the owner asks from their page |
| A limit change made by a card, applied to the rest of the SAME step | limits-card.ts applyInForce | the agent reads the limit in force when the step starts (StepContext.InForce) | the next step uses it |
| The owner's talk with the model on a template's shop | talk-owner.ts ownerTalk (the skills' `facts`, the declared limits in the prompt, a proposed note's Remember / No buttons on WhatsApp) | no contract test asks a Bookings owner a question the rules cannot place; talk.go builds its sources from the notes and the listings, its fallback counts the open cards, and its schema is the one with no limits | a Bookings owner's open question is answered from the notes and listings only, or with the fixed line |
| The assistant's templates outside the window, run end to end | templates.ts templateMessageFor | every contract path had the window open | built the same way (the template's name, the language code, the values in Meta's order, generated): for one closed day and one morning line in en and hi the TypeScript gives name, language and parameters that this code makes from the same words |
