# internal/payments: payments for every provider

The Go twin of `modules/payments`. What a Bookings, Orders, Fees or Stock-orders runtime calls.

- **payments.go**: the neutral types and the `Payments` interface (a payment request, payments, refunds, three events, settlement rows). Amounts are `int64` paise. The structs marshal to the
  TypeScript objects' JSON field for field.
- **razorpay/** (api.go, webhook.go): the live client over `guard.Http` and the webhook reader. The request bytes (path, query, headers, body in the TypeScript literal's key order, no
  `receipt` when none was given, `Geo-Requested-By` when the owner asked) and every answer the TypeScript reads are proved by `testdata/razorpay-vectors.json` (about 130 recorded exchanges
  against the TypeScript client) and `webhook-vectors.json`.
- **links.go**: `EnsureLink`, look first, write, read back, once more.
- **refunds.go**: `createRefunds` in full: look first, send once, never send again what may have gone out; a held refund keeps its approval id and the exact bytes and is sent again only
  after the owner approved (never on a timer); the sweep; the owner's no; `already_done`; recheck and the provider's refund.done event; telling the customer once. The case is an interface
  (`RefundCase`) whose lists are changed in place; pending entries are pointers (removed by identity); a pending kind the refund code does not own is carried raw (`OtherPending`).
  The books are a narrow `Accounting` interface (the books stream's package is not imported: when both are merged, an adapter is a few lines). 78 scenario vectors
  (`testdata/refunds-vectors.json`) run the TypeScript and compare every payments call, record line (words included), telling and books event, and the final case.
- **fake.go**: the in-memory stand-in gateway a "fakes" shop uses (`NewFake`), with `fake-vectors.json` for its ids, answers and events.
- **rupees.go**: `RupeesToPaise` (the refund limit and Guard's threshold are one number).
- **upi/**: the `upi://pay` link (link.go) with its exact problem words.
- **ownermarked/**: the UPI shop's ledger (requests, the owner's one-use marks, refunds the owner owes), the owner's replies, the neutral `Payments` view over them and the QR picture; see its Explanation.md.

Differences from TypeScript, all recorded: a fractional amount in a reply is "no amount" (money is integers); `UntoldRefund.amountInr` is kept in paise and written as the exact decimal
(`rupeesText`), not a float; the Go fake has no fault plans and no Guard model.
