# internal/payments/ownermarked: left out, and why

- **desk.ts and desk-guard.ts** (the owner-marked desk, B71 part 2): the desk is a separate server an agent someone else wrote calls through its own Guard (`bundle/services/desk.ts`, hosted by
  the approvals relay's container). The Bookings shop runtime does not import it (its ledger is in its own store). It belongs with that deployed service, not with the shop's process.
- **The desk's own members** (`customer`, `service`, `slotMs` on a request) are carried through raw / typed so a ledger the desk wrote reads back whole, but nothing here sets them.
