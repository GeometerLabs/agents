# internal/runtime: what the chat and a customer's talk leave for later

* **The step that runs a guest's send.** `ChatTurn` is ready; the Bookings agent core calls it from `Handle` for a `chat_message` (`TRIAL.md` has the exact call). Until it does, a guest's send is saved and its
  task ends failed as not ported, and the chat contract's tests that need an answer wait (listed in `TRIAL.md`).
* **Compacting the channel state** (`ChannelState.Compact`) is written and tested, but the runtime's daily `compact` step is not ported for a template yet (retention, `core.ts` line 397), so nothing calls it. The
  identity file's `DropGone` and `Purge` wait for the same step.
* **Hold-to-talk** (`chat-voice`, `PageAudio`, `OnHeard`): the route and the turn are written; a template without a speech service (every Go template today) gets the 404 "Voice is not on for this shop" and
  no `listen` in the thread read. A template that adds a speech service offers `ChatVoiceKit`.
* **A parent's chat** (Fees): `openEvent` and `openRead` refuse a `parent` (no Fees centre in this runtime). Orders and Fees add `ParentKit` when they come.
* **`chat_link`** (the WhatsApp message with a guest's one-use link, `chat-link-send.ts`): the route makes the same answers and saves the event; its step ends failed as not ported. See `internal/chatid/Deferred.md`.
* **The free times and the customer's own case in a customer's prompt** are the template's `publicContext` (`CustomerTalkInput.Sources`); Bookings' is the agent core's.
* `(?i)` in the shared claim and banned word lists is Go's, which also folds U+017F and U+212A (the report package's `Deferred.md` says the same).

## The owner's assistant for a template's shop (20 Nov 2026)

| Part | TypeScript | Why not yet | What it does instead |
|------|-----------|-------------|----------------------|
| The outgoing check's facts of a packed line, key by key | words.ts Writer (each call notes its own value) | the Go side fills packed words, so a key's fixed facts are generated from every value the TypeScript noted in that language (gen_words.ts factsOf, kept where their text is in the key's words) and a slot is typed by its name | a fixed number equal to one noted elsewhere in the same language would pass in Go and be held back in TypeScript; none does today (the generator proves each key passes with exactly its facts) |

