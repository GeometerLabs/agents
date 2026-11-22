# internal/stock: the shop's one stock count, in Go

The Go twin of `modules/stock/stock.ts` (read `modules/stock/README.md` first: what the count is for, the id scheme, the keys, the history rules). One package, shared by every
template that touches a count, so the rules live once:

* the owner's Stock page (`internal/listings/stock.go` checks the page's body and calls the owner's acts here; `internal/runtime/stock.go` runs them in the step; a template shop
  serves the page when its Kit is a `runtime.StockKit`, `internal/runtime/kitstock.go`);
* Stock orders (`internal/stockorders`): `ReconcileDeliveries` at every receipt and beat, `PendingAlerts`, `NoteAsked`, `AckAlert` and `LowRequestID` for one reorder per crossing;
* Orders (stream W4): `Sale`, `ReconcileSales`, `UnbookedHolds`, `LeftFor`.

Until 22 Nov 2026 the owner's half lived in `internal/listings/stock.go` (the listings shop was first). It moved here whole, with the shop's own half added, and listings keeps
type aliases (`listings.Stock = stock.Stock`, ...) so the runtime's call sites did not change. Nothing is kept twice: `settleOut`, `watchLow` and `prune` exist once.

## Who may write

TypeScript checks an `Authority` (the owner's, the Operator's, the builder's) or a `ShopRecord` that only `shopRecord()` makes, at run time (a WeakSet). Go keeps the same rule by
type: every write takes a `Source` whose fields are unexported, made only by `Owner(by)` and `ShopRecord()`. A zero `Source` writes nothing (`bad_source`: TypeScript throws there).
Only the owner may start, stop, correct, set the low mark or say "sold"; a sale or a delivery may come from either.

## Same files

The state is `assistant.stock`, read and written member for member. `applied` keeps its keys in the order they were made (a JavaScript object does; a Go map does not), because the
prune's tie-break and the file both depend on it. Where TypeScript adds a member to an existing object (a line's `unit` taken from its first delivery, a `low` set later) JavaScript
writes it last and Go in the struct's place: the same JSON value, a different byte order.

## Proof

`testdata/stock-vectors.json` is made by `go/scripts/gen_stock_vectors.ts` RUNNING `modules/stock/stock.ts` over six scenarios (every rule above), with each step's answer and the
whole state after it; `vectors_test.go` does every step here and compares (`--check` and words-fresh keep the file fresh). `stock_test.go` (moved from listings) covers the
daily tidy, the prune past the cap and the key order through a TypeScript-written state.
