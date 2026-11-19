# internal/payments: left out, and why

- **owner-marked/** (ledger.ts, obligations.ts, owner.ts, buttons.ts, qr-image.ts): the UPI shop's ledger of requests, the owner's one-use codes and the refunds the owner owes. It is state
  the Bookings runtime keeps in its own store, uses `modules/approvals/code.ts` (codes) and the record, and its words in four languages must be generated. It belongs with the Bookings
  runtime wave, which owns the store; porting it here would mean guessing that store's shape. `desk.ts` and `desk-guard.ts` are not in the shop runtime's import graph.
- **guard-limits.ts** beyond `RupeesToPaise`: it builds Guard's limits spec (the deployer's and the Guard stand-in's business) and reads one back; no shop runtime process calls it.
  **guard-model.ts** is the TypeScript fake's test model of a Guard; the Go fake has none, and the HTTP stand-in servers in `modules/standins` stay TypeScript test infrastructure.
- **providers/index.ts, types.ts, razorpay/guard.ts, words.ts, runtime.ts**: the panel's and the deployer's declarations (settings reading, Guard routes, panel words). Not used by a shop's
  runtime process. `razorpay.Capabilities` is the one declaration a runtime needs.
- **razorpay/standin.ts**: an HTTP handler for the test servers; stays TypeScript.
- The refund `Decision` list is `[]any` until the limits package is ported.
