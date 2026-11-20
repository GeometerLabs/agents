# internal/bookings: what is not ported yet, and why

Wave 2 (decision 61) ports the Bookings shop's runtime to Go in slices (go/TRIAL.md, "Wave 2: the Bookings runtime"). This file lists what the Go Bookings runtime does NOT do
yet. A kind of event it cannot take ends its task **failed at once with a sentence** (`runtime.Unported`), never a silent "done", so nothing is lost: the TypeScript runtime
still has every part, and a shop can be moved back to it.

| Part | TypeScript | Why not yet | What it needs |
|------|-----------|-------------|---------------|
| A UPI shop's QR picture before the words (agent.ts `qrOf`, `deps.qrImage`) | `modules/payments/owner-marked/qr-image.ts`, start.ts | the money itself is ported (agent_marks.go); the picture needs the report block's pages folder handed to the Kit (`ownermarked.FolderImages` is there) | the words carry the link, the UPI ID and the amount, the TypeScript's own answer when it has no picture maker |
| The amounts a UPI message shows for a mark typed with paise ("received K7M2QX 150.50") | agent.ts `markedInr: amountPaise / 100` | the message facts hold whole rupees | the words say ₹150 where the TypeScript says ₹150.50; the record keeps the paise exactly |
| The shop's assistant (item 11e): the owner's own words, cards, the morning line's Bookings part, the customer talk of block M | `assistant.ts`, `modules/assistant/wire.ts` | slice 5; the chat stream owns the customer talk | a shop WITH an `assistant` block answers the owner's free words with Unported; the fixed phrases (today, tomorrow, approve/deny/retry b-N) are ported |
| Voice notes heard through a speech service (B29) | `modules/voice` | not ported | voice is "off": the sender is asked to type (`voice_note`), as the TypeScript does without a `speech` block |
| The shop terms (B72), the handover code, approvers other than the owner (B37: `Geo-Requested-By`), the button-mode announcement, yesterday's settlement rows | `agent.ts` | not ported in this slice | the owner's words reach the commands as before |
| A chat guest's label ("Chat guest 3") on the owner's page items | channel.ts `guestLabel` | the chat's guest list is not read by the items yet | the item shows the guest's conversation as its phone |
| A page message's web push to the customer | `server/runtime.ts` | not ported | the message is on the page; nothing is pushed |
| The tick's memory of one-time calls (guard-wait.ts `sendMemory`) | `modules/runtime/guard-wait.ts` | a tick thrown away mid-way (a Guard down inside it) is rare | the next beat may repeat a reminder sent by the thrown-away one |
| The shop's assistant for Bookings (its skill, cards, the morning line; the limits Bookings declares ARE ported: the page, the deployer's word, the owner's change) | `src/assistant.ts`, `src/chat-limits.ts` | slice 5 | the shared assistant package grown for a second template |
| The monthly report's WIRING and the licence notices | `report/`, `server/licence.ts` | the adapters, the validated settings tree and the job (`Books`, `NewMonthlyReport`, `CheckSettingsFile`: books.go, settings_check.go) are built; the runtime does not call them yet (the TypeScript runs the report after the step with its own mid-step saves: `StepContext` has no `Save` yet) | the agent core / runtime to call `MonthlyReport.Run` after a tick's step with a real save |
| The owner page's Money section (`money` in the owner's read: ownerMoney over the record) | channel.ts ownerView | no contract test reads it yet; `accounting.OwnerMoney` is ported | the owner's read leaves `money` out |
| An image header on a WhatsApp template | `meta-templates.ts` `header: "image"` | no Bookings template has one; the generator refuses to run if one gets one, so it cannot be missed | Meta's example picture handle in the submission |
| The words for a language the shop does not speak | `templates.ts` | none: all four are generated | nothing |
| The day's compact of finished conversations' words (`core.ts compact`, `compactStore`, `store.compactTurns`) | `modules/runtime/core.ts` | the words it removes (channel outbox, a page's typed name) are in blocks not modelled yet | the channel state in Go |

## Reads that answer 200 with LESS than the TypeScript (said here so nobody reads them as equal)

| Route | Go answers now | TypeScript also gives |
|-------|----------------|-----------------------|
| `GET /internal/channel/owner` | the shop, the services, every item (deposit, late deposit, refund owed, late refund, calendar), the coming week | the Money section (`money`), the assistant's `app` view |
