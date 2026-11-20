# internal/bookings: what is not ported yet, and why

Wave 2 (decision 61) ports the Bookings shop's runtime to Go in slices (go/TRIAL.md, "Wave 2: the Bookings runtime"). This file lists what the Go Bookings runtime does NOT do
yet. A kind of event it cannot take ends its task **failed at once with a sentence** (`runtime.Unported`), never a silent "done", so nothing is lost: the TypeScript runtime
still has every part, and a shop can be moved back to it.

| Part | TypeScript | Why not yet | What it needs |
|------|-----------|-------------|---------------|
| A UPI shop's QR picture before the words (agent.ts `qrOf`, `deps.qrImage`) | `modules/payments/owner-marked/qr-image.ts`, start.ts | the money itself is ported (agent_marks.go); the picture needs the report block's pages folder handed to the Kit (`ownermarked.FolderImages` is there) | the words carry the link, the UPI ID and the amount, the TypeScript's own answer when it has no picture maker |
| The amounts a UPI message shows for a mark typed with paise ("received K7M2QX 150.50") | agent.ts `markedInr: amountPaise / 100` | the message facts hold whole rupees | the words say ₹150 where the TypeScript says ₹150.50; the record keeps the paise exactly |
| The handover code, approvers other than the owner (B37: `Geo-Requested-By`), yesterday's settlement rows | `agent.ts` | not ported in this slice | the owner's words reach the commands as before |
| A chat guest's label ("Chat guest 3") on the owner's page items | channel.ts `guestLabel` | the chat's guest list is not read by the items yet | the item shows the guest's conversation as its phone |
| A page message's web push to the customer | `server/runtime.ts` | not ported | the message is on the page; nothing is pushed |
| The tick's memory of one-time calls (guard-wait.ts `sendMemory`) | `modules/runtime/guard-wait.ts` | a tick thrown away mid-way (a Guard down inside it) is rare | the next beat may repeat a reminder sent by the thrown-away one |
| The owner page's Money section (`money` in the owner's read: ownerMoney over the record) | channel.ts ownerView | no contract test reads it yet; `accounting.OwnerMoney` is ported | the owner's read leaves `money` out |
| The member order of a refund issue in the snapshot (`late_upi`, and the shared refunds' issues) | agent.ts pushes `{paymentId, kind, atMs, note}` | `payments.RefundIssue` writes its members in its struct's order (`note` before `atMs`) | the same members and values; a byte-for-byte diff of the two runtimes' snapshots shows the order |
| An image header on a WhatsApp template | `meta-templates.ts` `header: "image"` | no Bookings template has one; the generator refuses to run if one gets one, so it cannot be missed | Meta's example picture handle in the submission |
| The words for a language the shop does not speak | `templates.ts` | none: all four are generated | nothing |
| The day's compact of finished conversations' words (`core.ts compact`, `compactStore`, `store.compactTurns`) | `modules/runtime/core.ts` | the words it removes (channel outbox, a page's typed name) are in blocks not modelled yet | the channel state in Go |

## Reads that answer 200 with LESS than the TypeScript (said here so nobody reads them as equal)

| Route | Go answers now | TypeScript also gives |
|-------|----------------|-----------------------|
| `GET /internal/channel/owner` | the shop, the services, every item (deposit, late deposit, refund owed, late refund, calendar), the coming week, the assistant's `app` view | the Money section (`money`) |

## The shop's assistant and voice (wave 2, step 5, 20 Nov 2026): what is not done yet

| Part | TypeScript | Why not yet | What it does instead |
|------|-----------|-------------|----------------------|
| The outgoing check over the assistant's own lines (message-matches-record over the Writer's facts) | words.ts `Writer`, conversation.ts `sayVoice.matches` | every value in those lines is put in from the record by this code (the packed words are filled with saved values), so the check has nothing to catch; the decision is recorded as allowed | the talk's reply, the one line a model writes, is checked (runtime/talk.go) |
| A message to a chat guest ("tell chat guest 3 ...", wire.ts prepareGuestMessage) and a guest's label in the owner's cards | wire.ts, chat-guest.ts guestLabel | the chat's guest list is not read by the assistant yet | "That can't be done from the chat" (not_here); a guest is named by their conversation |
| The morning line's mood picture (a sticker before the words, the template's image header) | morning.ts, character.ts pictureUrl | the deployer's pages.json pictures are not read for it yet | the line goes as words alone (text in the window, the template outside it) |
| Sarvam as the speech provider | modules/voice/sarvam.ts | only Geometer's own speech service is ported | a `speech` block naming "sarvam" is refused with a sentence; leave the provider out for Geometer's own |
| A chat guest's hold-to-talk (W1) | runtime.ts chatAudio | the Bookings kit does not hold chat recordings yet | the chat's voice route says voice is off |

