# internal/orders: the Orders shop on Go (the skeleton, wave W4 part G1)

The Go twin of `templates/commerce/orders`, modelled module for module on `internal/bookings`. This part is the skeleton the agent (G2) and the plans, assistant and report
wiring (G3) build on: the settings, the store, the reads worked out from the orders, the books, the channel's reads, the Kit and the command. The agent is a stand-in
(`agent.go`): every event and beat ends with `runtime.Unported` and its sentence, so the shop starts, answers `/healthz`, `/status` and its channel reads, and its queue says
honestly that nothing was handled.

## The map, file by file

| Go file | TypeScript | What |
| --- | --- | --- |
| `settings.go` | `src/settings.ts`, `src/plans/settings.ts` | `ReadSettings`, `Settings` and its parts; the helpers below |
| `settings_check.go` | providers `readPaymentSettings`, `approvals/people.ts`, `assistant/settings.ts`, `character.ts` | the shared readers; `Tree`, `CheckSettingsFile`; `ChatGuestWords` |
| `settings_check.json` | GENERATED | the character's lists, the approvers' limits, `DEFAULT_CAPS.refundPaisePerDay`, `LOWEST_LINK_INR`, each payment module's capabilities, `CHAT_GUEST` |
| `state.go` | `src/order.ts` types, `server/snapshot.ts` | `Store`, `Order`, `Customer`, the codec, the agent's own pending kinds, the optional blocks |
| `order.go` | `src/order.ts` reads, `plans/ledger.ts planMealsInSlot` | stock and the day's count, a slot's count, `FixSlot`, `FactsFor` ... |
| `books.go` | `src/accounting.ts` | `OrdersJournal`, `OrdersAccounting`, `Record` over ORDERS_LEGACY (`ordersreport.Legacy`, generated) |
| `channel.go` | `src/channel.ts` | `OrderOffer`, `OrderView`, `OwnerItems`, `OwnerView`, `DocumentsOf`, `ExportFilesOf`, `ChatWork` |
| `orders.go` | `server/runtime.ts` | the `Kit` (runtime.Kit, ChannelKit, AccountantFiler, ChannelStater), `Limits`, `RefundContext`, `CompactStore` |
| `ports.go` | `server/services.ts` | `Ports`, `BuildPorts`, `TemplateNames` |
| `agent.go` | `src/agent.ts` | the stand-in agent (G2 replaces it) |
| `../../cmd/orders/main.go` | `server/main.ts`, `start.ts` | one shop, copied from cmd/bookings less the calendar |

## What G2 and G3 call

**Settings** (`*Settings`, `SettingsOf(shared)` inside a step). Fields mirror settings.ts (`Menu`, `Orders`, `Cutoff`, `Pickup`, `Delivery` nil when the shop does not deliver,
`Advance`, `Reminder` nil for none, `Cancellation`, `Refund`, `Payment`, `Owner`, `Approvers`/`Assistant` as checked JSON, `Plans` nil for none). Helpers: `ItemName(item, lang)`,
`ItemOf(id)`, `AllSlots()`, `SlotOf(id)`, `SlotsOf(mode)`, `CutoffOf(slot)`, `HighestOrderInr()`, `HighestPlanInr()`, `AdvanceFor(total)`, `LowestLinkInr()`, `PlanTypeOf(id)`,
`PlanName(type, lang)`, `Capabilities()` (decide every payment branch by these, never the module's name), `OwnerMarked()`, `UpiPayLink()`, `WordsShop()` (for `words.ItemList`,
`words.ExampleFacts`), `Tree()` (the validated tree the report's policy digest is of: hand THIS to `ordersreport`, never the raw file).

**The store** (`*Store`, `c.State.(*Store)` in a step). `Orders` (oldest first), `Order(id)`, `Customer(phone)` (made on first use), `FindCustomer`, `DeleteCustomer`,
`Register(NewDraft(customer, lang))` ("o-N"), `LatestOrder(customer, states)` (never a plan's payment), `Order.MoveTo(state)` (the TypeScript's sentence on a move the flow
refuses), `LiveStates`, `CanMove`. An order's optional numbers are pointers, optional texts "" (not there); `Reminders` and `Balance` are raw JSON until their code is typed;
`ExtraOf`/`SetExtra` for any other member. `Pending` is `[]payments.Pending`: the refunds code's `*payments.GuardHold`/`*payments.RefundRetry`, and the agent's own kinds through
`NewBigOrder`/`BigOrderOf` and `NewOwnerRefund`/`OwnerRefundOf`. `Ledger(create)` is the owner-marked ledger (`store.upi ??= emptyMarkState()` with create);
`ChannelState()` the channel block (made on use), `Requests()` its requests (`Get`, `Keys`, `Set`), `OrderOfHandle(hash)` the page's one lookup. `Plans` stays raw JSON: G3 types it
(and should then keep `PlanMealsInSlot` reading the typed state). The members are written back in the order they were read, so a store read and written back is the same bytes.

**Reads** (`order.go`). `HoldsStock(o, now)`, `st.TakenOf(date, item, now, except)`, `st.OrdersOn`, `st.OrdersInSlot` (with the plans' meals), `st.PlanMealsInSlot`,
`st.OrderFacts(now)` (for `stock.ReconcileSales`), `st.CountedLeft(snap.Stock, item, now, except)`, `s.FixSlot(o)`, `s.SlotMoments(mode, date)`, `s.ItemsText`, `s.TotalOf`,
`CountOf`, `AddLine(&lines, item, qty)`, `st.CompactFinishedOrders(before)`, `KeyOf(date)`, and `s.FactsFor(o, lang, FactsExtra{...})`, which fills `words.MessageFacts` exactly
as factsFor does (a nil pointer in FactsExtra is a fact not given).

**Channel** (`channel.go`). `s.OwnerItems(st, now)` returns the items WITH their codes (the agent checks a press against them: kind, case, digest, action) and the coming week;
`OwnerItem.JSON()` leaves the code out. `s.OrderWhat(o, lang)` is the owner's words for an order. The Kit's two hooks for G3: `Kit.OfferCharacter` (the page head's character)
and `Kit.OwnerApp` (the owner page's assistant view).

**Books.** `OrdersAccounting(c.Rec, tz, now)` is the accounting every money line goes through; `OrdersJournal(entries)` the journal of the record.

**The Kit's fields** set by cmd/orders: `Settings`, `Now`, `Licence`, `Ports` (`Payments` nil on a UPI shop, `Capabilities`, `WhatsApp` nil without one, `PushOwner`,
`OwnerRoute`, `FakePayments`), `PageBase`, `SavedStock`. G2 adds what the agent needs (the router over `internal/orders/reading`, the terms, voice) beside them, as
`internal/bookings` has them.

## How it is proved

Nothing is retyped. `go/scripts/gen_orders_settings.ts` (`--check`) writes `settings_check.json` and two vector files:

* `testdata/settings-vectors.json.gz`: the four example shops and 150 mutations of the first through `validateSettings`. For a refused file the sentences in order (null against
  a missing key, every reader's mistakes, typed text with quotes, `&`, `<` and a joiner, a number as large as 1e21, a broken shop cut-off with plans); for an accepted one the
  checked tree, its policy digest and the helpers' answers. `settings_test.go`: Go equal on every case.
* `testdata/store-vectors.json.gz`: stores the TypeScript AGENT wrote, by driving `src/harness.ts` worlds the way the template's tests do (a UPI shop with a held, a marked, a
  delivered, a big and two page orders, a refused page request, a cancellation in time, a hold that ran out, a claim; a Razorpay shop with a Guard hold and a late
  cancellation; a plans shop; Sweet Crumbs), each read at one or two moments. `order_test.go`: the snapshot written back is the same bytes; every derived read, every view (as
  text, so the members' order too), every owner item's digest and code, the owner view with its Money section and the page's receipts equal the TypeScript's.

The owner's codes are random in the TypeScript; the generator counts them instead while it runs (`syncBuiltinESMExports`), so --check is stable.

## Where Go and JavaScript differ (each also commented where it happens)

A missing key and a null are told apart by `has` (`??` versus `=== undefined`); keys are listed in the file's order (`keyOrder`); typed text goes into a sentence as it is
(`jsQuote` is JSON.stringify of a string, never `%q`); JSON is written without HTML escaping (`jsonOf`); `Math.round` of the minutes left is floor(x + 0.5); `Number.isInteger`
is any finite whole double (1e21 is said "1e+21"); a time zone "" or "Local" is refused (Go would read both as zones).
