# internal/voice: voice notes heard as words (B29)

The Go twin of `modules/voice`. A shop with a `speech` block in runtime.json listens to a voice note (a customer's on WhatsApp, the owner's on WhatsApp or from their page)
and reads the words like a typed message; the agent always replies in text. Without the block voice is off and the sender is asked to type, as before.

- `config.go` is config.ts: the block checked in the TypeScript's sentences (none repeats what was written, in case it was a key), and `Build`, which makes the service.
- `speech.go` is media.ts, geometer.ts and wire.ts: the media lookup and download through their Guards (only from the hosts the settings name), Geometer's own speech service
  (POST /stt, multipart), and the HTTP both need with Guard's answers told apart (`guard.Classify`).
- `audio.go` is ogg.ts and webm.ts: the length of a note read from its own bytes (needed for the limit and the cost).
- `voice.go` is voice.ts and turn.ts's marks: the service (the day's limit, too long, low confidence, the half-hour memo that answers a step that runs again without a second
  call or charge) and the record's marks of a heard note and of one that could not be used.

What needs a step's state is in the runtime (`runtime/voice.go`): whether listening is allowed now (not in button mode, not over the AI cap), the day's count and the cost in
the saved AI state, and the owner's page recordings held in memory. Proved on the TypeScript's own answers (`go/scripts/gen_voice_vectors.ts`, checked by words-fresh).
