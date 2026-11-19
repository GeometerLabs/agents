# internal/payments: left out, and why

- **owner-marked/**: ported in `ownermarked/` (the ledger, the owner's replies, the neutral view, the QR picture; see its Explanation.md). Left out there: `desk.ts` and `desk-guard.ts` (a separate deployed service, not in the shop runtime's import graph).
- **guard-limits.ts** beyond `RupeesToPaise`: it builds Guard's limits spec (the deployer's and the Guard stand-in's business) and reads one back; no shop runtime process calls it.
  **guard-model.ts** is the TypeScript fake's test model of a Guard; the Go fake has none, and the HTTP stand-in servers in `modules/standins` stay TypeScript test infrastructure.
- **providers/index.ts, types.ts, razorpay/guard.ts, words.ts, runtime.ts**: the panel's and the deployer's declarations (settings reading, Guard routes, panel words). Not used by a shop's
  runtime process. `razorpay.Capabilities` is the one declaration a runtime needs.
- **razorpay/standin.ts**: an HTTP handler for the test servers; stays TypeScript.
- The refund `Decision` list is `[]any` until the limits package is ported.
