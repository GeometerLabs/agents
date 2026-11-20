# internal/voice: what is not ported yet

| Part | TypeScript | Why not yet | What it does instead |
|------|-----------|-------------|----------------------|
| Sarvam as the speech provider | modules/voice/sarvam.ts | only Geometer's own speech service is needed by the contract | a block naming "sarvam" is refused with a sentence |
| Node's exact network error codes on a failed call (ENOTFOUND, EHOSTUNREACH ...) | wire.ts NOT_SENT | a voice call's failure is always "ask the sender to type", whatever its code | a timeout is a lost reply; any other failure "could not connect" |
| The problems of a `speech` block in the file's own key order | config.ts | the runtime reads runtime.json into a map | unknown keys are said in name order |
