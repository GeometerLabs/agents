# internal/chatid (wave 2; 19 Nov 2026)

Who a chat guest is: the Go twin of `modules/channels/chat-identity.ts`, function for function. The same file (`chat-identity.sqlite`) made by the same text, so a shop moves between the two runtimes: a
passkey bound to a thread (`Keep`, `Signin`: go-webauthn's checks, as in the owner's sign-in), the number a guest gave for a new phone and its one-use links (`SetNumber`, `IssueLink`, `UseLink`,
`IssueConfirm`, `ConfirmNumber`), the counts that keep it from being flooded (`take`, `CountRecoveryAsk`, `CountLinksAsk`, `CountConfirmAsk`, `NoteWrongLink`), "delete my chat" (`Forget`) and retention
(`DropGone`, `Purge`). The route that uses it is `internal/runtime/chatidroute.go`. The stored form of a key is `access.StoredKey` / `CoseOfStored` (one writing, shared with the owner's passkeys).

`chatid_test.go` drives it with a software passkey (ES256, attestation "none"): key and sign-in, another shop's key, the user not verified, the counter rule, five keys, the links, the limits, forgetting.
