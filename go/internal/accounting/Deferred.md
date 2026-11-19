# Deferred in `internal/accounting`, and why

## Not built (and not asked for)

* **The Bookings runtime's use of this package.** The adapters for `Payments` (the provider's settlement report) and `Record` (the shop's record) and the call of `ReadSettlementsOnce` are written
  (`internal/bookings/books.go`: `Books.SettlementPayments`, `Books.Record`, `Books.ReadSettlements`); the agent core calls them from its tick. The channel routes that serve `render.OwnerMoneySection`, `render.DocumentPage` and the accountant's files, and the monthly report's call of `SummaryOf`, `FiguresOf` and `render.MoneyBlock` are the
  Bookings wave's. Orders and Fees will write their own `LegacyMap` the way `bookings.go` does.
* **`modules/accounting/check.ts`** (the open check of a report's evidence pack, a command line) and the TypeScript `test/` of the module: the check reads a signed pack, not a shop's record, and the
  tests are held by the vectors. The open check stays TypeScript (`geometer-verify` is open and separate).
* **`go/README.md` and `go/TRIAL.md`** were not edited (the brief for this stream says not to). The package map line for them: `internal/accounting/ the shop's books (modules/accounting): the
  journal, post, numbers, documents, figures, summary, invariants, the accountant's files and Tally, the owner's money view, settlements; render/ is its HTML`.
* **Deleting the TypeScript.** Not done (the brief says not to); the module stays until the Bookings wave passes its contract.

## Known differences from the TypeScript (small, on purpose)

* **`BooksFaults` visits an entry's refs in alphabetical key order.** The TypeScript visits them in the order they were written, which a Go `map[string]string` (internal/store's `Entry.Refs`) does not
  keep. The two agree whenever an entry has at most one ref carrying a phone number or a private name, which is every crash-test case; with two, the pair may be listed the other way round. To
  close it the store would have to keep the refs' order (a slice of pairs).
* **Amounts that are not whole paise.** An event amount is an int64, so the TypeScript's `A <kind> of 1.5 paise cannot be posted` for a fractional amount cannot be built (the message for a zero,
  a negative and a too-large whole number is the same). Three places read a bare `Number()` of a ref where the TypeScript would carry a fraction into a figure: the borrowed refund amount in
  `FiguresOf` (`refundAmountFromPayment`: a fractional or huge text is read as "no amount to borrow"), the held and not-through-the-assistant rows of `OwnerMoney` (a text that is not whole reads as 0:
  the settlement job always writes `String(int)`), and `MarkObligations` (the amounts are float64 inside the fold; `OwnerMoney` truncates the result). JavaScript numbers beyond 2^53 are out of scope.
* **Times the record cannot have.** `Date.parse` is `ParseISO`, which reads what `toISOString` writes, the same with an offset or without milliseconds, and a bare date. A time that is not one of
  those is NaN in JavaScript; here a line with one is left out of a period (as NaN comparisons do) except in `tally.go` and the document page, which return the TypeScript's `Invalid time value`.
  The owner's `tally()` in JavaScript counts a line whose time is NaN (both comparisons false); Go leaves it out. The record never writes such a time.
* **A `kept` event that names a refund with an empty text** (`owed: ""`) is a key in both languages; every other empty text means "none" where the TypeScript's check is a truthiness test.
* **An unknown language** is a panic in `accounting.Owner`, `Doc` and `BlockWords` (the TypeScript's lookup gives `undefined` and the next property read throws). The four are the only languages.
* **The settlement job is synchronous** (the TypeScript is async): the adapter blocks.

## Nothing here has met a real account

The settlement fee reading (which way Razorpay's recon row holds its tax), the Tally import and every file's first use by an accountant are as unproven as the TypeScript's (modules/Deferred.md); the
vectors prove the Go equals the TypeScript, not that either equals the world.
