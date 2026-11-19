# qr: what was left, and why

- `modules/payments/owner-marked/qr-image.ts` (writing the PNG under a random folder name served read-only, and the in-memory variant) is the runtime's part, not the encoder's. It is eleven lines over `qr.TextPng`: 16 random bytes in hex, `os.MkdirAll`, `os.WriteFile`. It belongs with the owner-marked payments code in the Bookings runtime wave.
- No other mask or level than M, no numeric or alphanumeric mode: the TypeScript has none either.
- PNG compressed bytes are not equal to Node's (see Explanation.md).
