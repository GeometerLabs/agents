# internal/bookings: what is not ported yet, and why

Wave 2 (decision 61) ports the Bookings shop's runtime to Go in slices (go/TRIAL.md, "Wave 2: the Bookings runtime"). This file lists what the Go Bookings runtime does NOT do
yet. A kind of event it cannot take ends its task **failed at once with a sentence** (`runtime.Unported`), never a silent "done", so nothing is lost: the TypeScript runtime
still has every part, and a shop can be moved back to it.

| Part | TypeScript | Why not yet | What it needs |
|------|-----------|-------------|---------------|
| A UPI shop's money: the owner-marked ledger (the customer's "I paid", a screenshot, the owner's marks, the refund the owner owes, a UPI hold's expiry and quote) | `agent.ts` owner-marked section, `modules/payments/owner-marked/*` | stream go-bk-books-19nov ports the ledger as an `ownermarked` package | every such path answers `runtime.Unported` with its sentence (agent_money.go, agent_flow.go), never a nil port falling through |
| The books' money fields on a record line (`books.post`) | `accounting.ts bookingsAccounting` | stream go-bk-books-19nov provides `bookings.Books` (ports.go) | until it is handed in, the line is written with no money fields |
| The shop's assistant (item 11e): the owner's own words, cards, the morning line's Bookings part, the customer talk of block M | `assistant.ts`, `modules/assistant/wire.ts` | slice 5; the chat stream owns the customer talk | a shop WITH an `assistant` block answers the owner's free words with Unported; the fixed phrases (today, tomorrow, approve/deny/retry b-N) are ported |
| Voice notes heard through a speech service (B29) | `modules/voice` | not ported | voice is "off": the sender is asked to type (`voice_note`), as the TypeScript does without a `speech` block |
| The shop terms (B72), the handover code, approvers other than the owner (B37: `Geo-Requested-By`), the button-mode announcement, yesterday's settlement rows, the owner's page actions (`owner_action`) and talk box (`owner_message`) | `agent.ts` | not ported in this slice | an owner_action or owner_message event answers Unported |
| The WhatsApp booking's own page link (batch 5: `pageLinkFor`, `keepPageLink`) and a page message's web push to the customer | `agent.ts`, `server/runtime.ts` | needs the page base (pages.json) handed to the Kit | not sent; the quote's link is the payment link |
| The tick's memory of one-time calls (guard-wait.ts `sendMemory`) | `modules/runtime/guard-wait.ts` | a tick thrown away mid-way (a Guard down inside it) is rare | the next beat may repeat a reminder sent by the thrown-away one |
| A UPI shop's pay block on the page, "I have paid", and the owner's UPI items | `channel.ts`, `modules/payments/owner-marked` | the owner-marked ledger (`upi`) is carried raw, not modelled | the ledger in Go |
| The owner page's Money section, the page's documents, the accountant's files | `modules/accounting` | the books are on this branch (go/internal/accounting, render) but not wired; the documents route answers 404 and the accounting route 404 after the session check | the adapters (accounting.Record, accounting.Payments) |
| The `approvers` block's checks (`readApprovers`) and the `assistant` block's (`readAssistantSettings`); the `payment` block's are ported (`vpaProblem`, `payeeProblem`, word for word) | `modules/approvals/people.ts`, `modules/assistant/settings.ts` | those modules are not ported; the blocks' shapes are checked here and the blocks kept raw. The deployer checks a folder with the TypeScript readers before it writes it | ports of those readers |
| The shop's assistant for Bookings (its skill, cards, the morning line; the limits Bookings declares ARE ported: the page, the deployer's word, the owner's change) | `src/assistant.ts`, `src/chat-limits.ts` | slice 5 | the shared assistant package grown for a second template |
| The customer's chat on the page (`/internal/channel/chat`, `chat-id`, `chat-voice`) | `modules/channels/chat*.ts` | slice 4 | the chat's state and the customer's talk with the model |
| The monthly report and the licence notices | `report/`, `server/licence.ts` | the report is on this branch (go/internal/report, bookingsreport) but not wired | report.Messaging and DocumentSender adapters, the Booking conversion, validateSettings's tree for the policy digest |
| The UPI owner's buttons (`ownerMarkButtons`: "Received", "Refund sent", "Kept for booking") | `modules/payments/owner-marked/buttons.ts` | they belong to the owner-marked ledger, which is not modelled; the labels they use ARE generated (`Label`) | the ledger in Go |
| An image header on a WhatsApp template | `meta-templates.ts` `header: "image"` | no Bookings template has one; the generator refuses to run if one gets one, so it cannot be missed | Meta's example picture handle in the submission |
| The words for a language the shop does not speak | `templates.ts` | none: all four are generated | nothing |
| The day's compact of finished conversations' words (`core.ts compact`, `compactStore`, `store.compactTurns`) | `modules/runtime/core.ts` | the words it removes (channel outbox, a page's typed name) are in blocks not modelled yet | the channel state in Go |

## Reads that answer 200 with LESS than the TypeScript (said here so nobody reads them as equal)

| Route | Go answers now | TypeScript also gives |
|-------|----------------|-----------------------|
| `GET /internal/channel/owner` | the shop, the services, the late-cancellation and calendar items, the coming week | the UPI items (deposit, late deposit, refund owed), the Money section (`money`), the assistant's `app` view |
| `GET /internal/channel/request` | status, ref, service, times, deposit, a gateway's link, the flags, the page's messages, an asked refund | a UPI shop's `pay` block (and so `canSayPaid` true), a refund owed or sent on a UPI shop |
| `GET /internal/channel/offer?service=` | the shop and its services, `days: []`, `calendarUnread: true` | the free starts per day |
