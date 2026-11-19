# internal/bookings: what is not ported yet, and why

Wave 2 (decision 61) ports the Bookings shop's runtime to Go in slices (go/TRIAL.md, "Wave 2: the Bookings runtime"). This file lists what the Go Bookings runtime does NOT do
yet. A kind of event it cannot take ends its task **failed at once with a sentence** (`runtime.Unported`), never a silent "done", so nothing is lost: the TypeScript runtime
still has every part, and a shop can be moved back to it.

| Part | TypeScript | Why not yet | What it needs |
|------|-----------|-------------|---------------|
| A customer's WhatsApp message, a payment event, an approval decision, a channel request (book, cancel, paid), an owner's action and message, a chat send, the owner's sign-in link | `src/agent.ts` | every one calls a service: the calendar, payments or messaging | the ports wired to go/internal/calendar, go/internal/payments, go/internal/messaging (branch go-guards-19nov) and their in-memory stand-ins (go/internal/standins) |
| The recovery steps that read a service (`recheck_payment`, `retry_booking`, `ask_owner_again`, `recheck_refund`) | `onRecovery` | the same; the refusals (no such booking, nothing to look at, an action the agent does not have) are ported | the ports |
| The beat's work (holds expiring, reminders, completion, the refunds' sweep, the calendar backfill, the licence's final stop) | `onTick` | holds and reminders release the calendar and send messages | the ports; the pure rules they use are ported (`rules.go`) |
| The free starts of one service in the offer | `freeStarts` | they read the calendar; until it is wired the offer answers `calendarUnread: true`, the TypeScript's answer when its calendar cannot be read | the calendar port; `FreeOnDay` is ported |
| A UPI shop's pay block on the page, "I have paid", and the owner's UPI items | `channel.ts`, `modules/payments/owner-marked` | the owner-marked ledger (`upi`) is carried raw, not modelled | the ledger in Go |
| The owner page's Money section, the page's documents, the accountant's files | `modules/accounting` | the books are another stream's (go/internal/accounting, branch go-books-19nov); the documents route answers 404 and the accounting route 404 after the session check | the books package |
| The `payment` block's own checks of a UPI ID and payee (`vpaProblem`, `payeeProblem`, `normaliseVpa`), the `approvers` block (`readApprovers`) and the `assistant` block (`readAssistantSettings`) | `modules/payments/providers/upi`, `modules/approvals/people.ts`, `modules/assistant/settings.ts` | those modules are not ported; their shapes are checked here and their blocks kept raw. The deployer checks a folder with the TypeScript readers before it writes it | ports of those readers |
| The shop's assistant for Bookings (its skill, cards, the morning line), the limits Bookings declares (`CHAT_LIMITS`) | `src/assistant.ts`, `src/chat-limits.ts` | slice 5 | the shared assistant package grown for a second template |
| The customer's chat on the page (`/internal/channel/chat`, `chat-id`, `chat-voice`) | `modules/channels/chat*.ts` | slice 4 | the chat's state and the customer's talk with the model |
| The monthly report and the licence notices | `report/`, `server/licence.ts` | the report is another stream's (go/internal/report) | the report package |
