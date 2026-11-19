# internal/chatid: what is left

* **Sending the links** (`chat-link-send.ts`, `words-chat-identity.ts`): a WhatsApp template message with the link, in the guest's language, from a step. `internal/runtime` saves the `chat_link` event; its step ends
  failed as not ported. The store side (`IssueLink`, `LinkUnsent`, `IssueConfirm`, `ConfirmUnsent`) is ready for it.
* **Ed25519 and RS256 passkeys** are accepted (the stored form handles all three) but the tests use ES256 only; `soft-authenticator.ts` has an Ed25519 case.
* The file's `sqlite_master` is not compared with the TypeScript's in a test (the schema text is copied character for character; the owner's access file has the same promise and a contract test for it).
