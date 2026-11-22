# internal/stock: the shop's record of the one stock count

What it is: the Go twin of the half of `modules/stock/stock.ts` that `internal/listings/stock.go` leaves out on purpose, what an Orders order and a Stock-orders delivery do to the
count. It works over `listings.Stock` (the one typed state, which keeps the key-ordered `applied`, movements, `short` and an alert's `asked`), so a state the TypeScript runtime wrote is
read and written back whole. There is no second state type.

| Go (`stock.go`)                                   | TypeScript (`modules/stock/stock.ts`)                      |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `ShopRecord`, `Record` (zero value refused)       | `shopRecord`, `ShopRecord`, `requireSource`                |
| `Sale`, `Received`                                | `sale`, `received`                                         |
| `ReconcileSales`, `OrderFact`, `UnbookedHolds`    | `reconcileSales`, `OrderFact`, `unbookedHolds`, `isHistory`|
| `ReconcileDeliveries`, `DeliveryFact`             | `reconcileDeliveries`, `DeliveryFact`                      |
| `CountOf`, `IsCounted`, `LeftFor`, `LowLines`     | `countOf`, `isCounted`, `leftFor`, `lowLines`              |
| `PendingAlerts`, `AckAlert`, `NoteAsked`, `LowRequestID` | the same names in camel case                        |
| `MenuStockID`, `SupplyStockID`, `ListingStockID`, `IsStockID`, `KindOf`, `StockRefs`, `Action`, `FactHorizonMs`, the `Change*` words | the same names |
| `Words(lang)` (`words.go`, `words.json`)          | `STOCK_LINE_WORDS` (`modules/stock/words.ts`)              |

The owner's own acts (start, correct, sold, low, stop, restore after yes) and the tidy are already in `listings`; this package does not repeat them. The line/alert/key rules (low mark,
movements, prune) stay in `listings` and are reached through the exported doors in `listings/stock_access.go`.

Differences from JavaScript, each commented where it happens: counts are `int64`; `undefined` for an optional unit, end time, delivery time or `held` is `""`, `nil` or `0`
(an empty unit means "no unit"); the TypeScript's WeakSet of shop records is a struct with an unexported field, and the zero `Record` panics as `requireSource` throws; the
`Authority` branch of `Source` is not here (the owner's acts are `listings`').

Generated data: `words.json` by `go/scripts/gen_stock_words.ts` (function words rendered with probe values and turned into `{slot}`s, round-tripped), and
`testdata/stock-vectors.json.gz` by `go/scripts/gen_stock_vectors.ts`, which RUNS the TypeScript on 37 scenarios (313 steps) (every case of both stock test files, the Orders ones over real
orders and the real `orderFacts`, plus standing, completed, cancelled, held, expired, two lines of one item, 700 orders, counting started after a pickup, the 30-day horizon, low-mark
crossings, deliveries in part and in full, units, aliases, caps, and the prune past 5000 keys, kept as a digest). `stock_test.go` replays every step and compares the answer and the
whole state member for member, and the order of the `applied` keys. Both scripts have `--check`.
