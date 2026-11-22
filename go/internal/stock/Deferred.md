# internal/stock: left out, and why

- The owner's acts (`startCounting` with aliases, `stopCounting`, `correct`, `ownerSold`, `setLow`, `restoreAfterYes`, `ownerRows`, `soldOutListings`) are `internal/listings`'
  (`stock.go`); this package is only the shop's record. `startCounting` with `aliases` is not in listings' `StockOp` (the page never sends aliases); a state that has aliases is read,
  written and used here (a scenario covers it), but nothing in Go creates one.
- Words people read that the Orders agent says about stock (the low-stock card, the reorder card) belong to the Orders and Stock-orders agents; only `STOCK_LINE_WORDS` is here.
- An empty-string unit on a delivery is "no unit" (the TypeScript tells `""` from `undefined`); no agent passes `""`, so no vector covers it.
- A fractional or non-finite count cannot reach this API (it takes `int64`): the caller converts and refuses first, as the page's shape check does.
