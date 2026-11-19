# internal/bookings: what is not ported yet, and why

Wave 2 (decision 61) ports the Bookings shop's runtime to Go in slices (go/TRIAL.md, "Wave 2: the Bookings runtime"). This file lists what the Go Bookings runtime does NOT do
yet. A kind of event it cannot take ends its task **failed at once with a sentence** (`runtime.Unported`), never a silent "done", so nothing is lost: the TypeScript runtime
still has every part, and a shop can be moved back to it.

| Part | TypeScript | Why not yet | What it needs |
|------|-----------|-------------|---------------|
| A customer's WhatsApp message (its reading IS ported: `ParseIntent` and `Reading` for the router; the step that acts on it is not), a payment event, an approval decision, a channel request (book, cancel, paid), an owner's action and message, a chat send, the owner's sign-in link | `src/agent.ts` | every one calls a service: the calendar, payments or messaging | the ports wired to go/internal/calendar, go/internal/payments, go/internal/messaging and their stand-ins (`payments.NewFake`, `messaging.NewStandIn`, the calendar's fake): all on this branch since the merge of main, not wired yet |
| The recovery steps that read a service (`recheck_payment`, `retry_booking`, `ask_owner_again`, `recheck_refund`) | `onRecovery` | the same; the refusals (no such booking, nothing to look at, an action the agent does not have) are ported | the ports |
| The beat's work (holds expiring, reminders, completion, the refunds' sweep, the calendar backfill, the licence's final stop) | `onTick` | holds and reminders release the calendar and send messages | the ports; the pure rules they use are ported (`rules.go`) |
| The free starts of one service in the offer | `freeStarts` | they read the calendar; until it is wired the offer answers `calendarUnread: true`, the TypeScript's answer when its calendar cannot be read | the calendar port; `FreeOnDay` is ported |
| A UPI shop's pay block on the page, "I have paid", and the owner's UPI items | `channel.ts`, `modules/payments/owner-marked` | the ledger is ported (`internal/payments/ownermarked`, `Store.UpiState`, `OwnerMarkButtons`), but the channel's reads and the agent's steps that use it are not wired | the agent core and the channel reading `UpiState` |
| The owner page's Money section, the page's documents, the accountant's files | `modules/accounting` | the books are on this branch (go/internal/accounting, render) but not wired; the documents route answers 404 and the accounting route 404 after the session check | the adapters (accounting.Record, accounting.Payments) |
| The shop's assistant for Bookings (its skill, cards, the morning line; the limits Bookings declares ARE ported: the page, the deployer's word, the owner's change) | `src/assistant.ts`, `src/chat-limits.ts` | slice 5 | the shared assistant package grown for a second template |
| The customer's chat on the page (`/internal/channel/chat`, `chat-id`, `chat-voice`) | `modules/channels/chat*.ts` | slice 4 | the chat's state and the customer's talk with the model |
| The monthly report's WIRING and the licence notices | `report/`, `server/licence.ts` | the adapters, the validated settings tree and the job (`Books`, `NewMonthlyReport`, `CheckSettingsFile`: books.go, settings_check.go) are built; the runtime does not call them yet (the TypeScript runs the report after the step with its own mid-step saves: `StepContext` has no `Save` yet) | the agent core / runtime to call `MonthlyReport.Run` after a tick's step with a real save |
| An image header on a WhatsApp template | `meta-templates.ts` `header: "image"` | no Bookings template has one; the generator refuses to run if one gets one, so it cannot be missed | Meta's example picture handle in the submission |
| The words for a language the shop does not speak | `templates.ts` | none: all four are generated | nothing |
| The day's compact of finished conversations' words (`core.ts compact`, `compactStore`, `store.compactTurns`) | `modules/runtime/core.ts` | the words it removes (channel outbox, a page's typed name) are in blocks not modelled yet | the channel state in Go |

## Reads that answer 200 with LESS than the TypeScript (said here so nobody reads them as equal)

| Route | Go answers now | TypeScript also gives |
|-------|----------------|-----------------------|
| `GET /internal/channel/owner` | the shop, the services, the late-cancellation and calendar items, the coming week | the UPI items (deposit, late deposit, refund owed), the Money section (`money`), the assistant's `app` view |
| `GET /internal/channel/request` | status, ref, service, times, deposit, a gateway's link, the flags, the page's messages, an asked refund | a UPI shop's `pay` block (and so `canSayPaid` true), a refund owed or sent on a UPI shop |
| `GET /internal/channel/offer?service=` | the shop and its services, `days: []`, `calendarUnread: true` | the free starts per day |
