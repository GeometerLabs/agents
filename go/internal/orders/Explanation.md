# internal/orders: the Orders shop on Go (the skeleton, wave W4 part G1)

The Go twin of `templates/commerce/orders`, modelled module for module on `internal/bookings`. Part G1 is the skeleton (the settings, the store, the reads worked out from the
orders, the books, the channel's reads, the Kit and the command); part G2 is the agent (`agent*.go`, `limits.go`, below); the plans and the assistant (G3) fill the agent's two seams.

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
| `agent*.go`, `limits.go` | `src/agent.ts`, `src/limits.ts` | the agent: see "The agent" below |
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
`ChannelState()` the channel block (made on use), `Requests()` its requests (`Get`, `Keys`, `Set`), `OrderOfHandle(hash)` the page's one lookup. `Plans` is the raw block as read; G3 typed it
(`PlansState(create)`, plans_state.go), and `PlanMealsInSlot` reads the typed state. The members are written back in the order they were read, so a store read and written back is the same bytes.

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

## The agent (wave W4 part G2)

`agent*.go` are the Go twin of `src/agent.ts` and `src/limits.ts`, in agent.ts's order of sections and of checks, modelled on `internal/bookings/agent*.go`:

| Go file | agent.ts | What |
| --- | --- | --- |
| `agent.go` | `createAgent`, `handle`, `giveUp`, `onChatMessage` | the step's agent: the watched services, the ledger, say and refunds made once; the limits in force laid over the settings (the big-order line, the refund limit, the day's count); the events by kind; `wait_over` |
| `agent_say.go` | "saying things", push.ts, outbox.ts | the offers, the facts (`Settings.FactsFor` with agent.ts's extras), the generated words, the gates (confirmed only when recorded, the final stop, the chat's ping cap), the QR picture's send; the owner's route is `bookings.OwnerMessaging`, a page's outbox `runtime.ChannelMessaging` and the watch over every Guard call `bookings.Watch` (`agent.go` newAgent and finish), shared with Bookings and Fees since 23 Nov 2026 |
| `agent_flow.go` | the order, the hold and the advance, STOP, a voice note, `onMessage` | the reader over `internal/orders/reading` (rules, then the router), `fill`, the slot a time means, `availability` (cut-off, the day's stock, the shelf count, the day's cap, a slot's own limit), `proceed`, the big-order line, `proceedToHold` (the chat guests' cap, the hold, the link, the UPI request, its QR and the owner's note), the address, yes and no |
| `agent_money.go` | refunds, "the advance", `onPaymentEvent`, the licence, `reconcileStock`, `onTick`, `onRecovery`, the plans' payment paths | the money lines through `OrdersAccounting`, the reminder (reminders.ts), the settlement read once a day, `askPlanPayment`, `refundPlanCredit`, `planApplied` |
| `agent_marks.go` | the owner-marked money | marks, late marks, refunds owed, claims, the owner's replies, asking again, reminders |
| `agent_owner.go` | cancelling, the owner's answers, the balance | the window, the late cancellation's ask, the handover code, the terms, `balance o-N cash/upi/link`, approve and deny; the balance and reminders blocks written in the TypeScript's spread order |
| `agent_channel.go` | the page's requests, the owner's page | the problems before anything is held, the per-number and per-shop limits, the owner's presses by digest |
| `agent_talk.go` | `assistant?.talkToCustomer`, assistant.ts `publicContext` | the customer's talk where nothing else answers (a shop with an `assistant` block) |
| `agent_after.go` | `server/licence.ts`, `report/monthly-job.ts`, config.ts `readReport` | the licence notice and the monthly report after the beat; the `report` block |
| `agent_mode.go` | reader.ts `announceButtonMode` | the AI mode's lines and the owner's notices |
| `agent_seams.go` | `createPlans`, `assistantForAgent` | the two seams G3 fills (below) |
| `limits.go` | `src/limits.ts` | every Orders limit, word for word |

**The seams for G3** (`agent_seams.go`): `newPlans func(a *Agent) Plans` (the `Plans` interface: `OnMessage`, `AwaitingOrderOf`, `OnPaid`, `OnTick`) and `assistantFor func(a *Agent) *runtime.Assistant`. Both nil
until set; the agent calls them at agent.ts's places. The paths a plan is handed are the agent's own methods (`askPlanPayment`, `refundPlanCredit`, `planApplied`, `qrOf`,
`reconcilePayments`, `cancelWaiting`, `log`, `tellCustomer`, `tellOwner`, `sayOpts.facts` for the plan facts). The morning line goes at the end of `AfterTick`.

`cmd/orders` wires the reader (`runtime.RouterFor` over `ReadingOf`), the terms, voice, the monthly report and a UPI shop's QR pictures (into the report's pages folder, as start.ts).

## The plans, the assistant, the Stock page and the morning line (wave W4 part G3)

| Go file | TypeScript | What |
| --- | --- | --- |
| `plans_state.go` | `src/plans/ledger.ts`, `periods.ts` | the typed `plans` block (`Store.PlansState(create)`, written back in `Members`), the periods' dates, the day states, skip / pause / resume / cancel, delivery, settlement and credits |
| `plans.go` | `src/plans/flow.ts` | `createPlans` over the agent (`newPlans`): subscribe and its quote, a delivery plan's address, the first period's hold, `OnPaid`, the customer's words (`reading.ReadPlanIntent`), "my plan", cancel with the unused credit refunded, `OnTick` (meals delivered, the renewal asked once with the credit taken, a reminder, a lapse) |
| `agent_assistant.go` | `src/assistant.ts`, agent.ts's `assistantForAgent` call | the Orders skill (`assistantFor`): open orders and tomorrow's plan meals, what waits (from `OwnerItems`), the cards' prepare and execute through the agent's own paths, the owner's talk's sources; the owner page's `app` view and the page head's character (`Kit.AppView`, `Kit.PublicCharacter`, handed in by cmd/orders as `OwnerApp` and `OfferCharacter`); `OwnerVoiceOn` |
| `stockkit.go` | core.ts `createStockKit` with `templateItems` | the Kit is a `runtime.StockKit`: the owner's Stock page offers the menu's items as `menu:<id>` |
| `agent_after.go` | morning.ts via core.ts `daily` | the owner's morning line after the monthly report, over the Orders skill read-only (`runtime.StepContext.Morning`) |

**One plans state.** The block is typed once per store and every reader goes through it: a slot's count (`PlanMealsInSlot`), the plans' own changes, the open rows. A
payment recorded inside a cancel or a hold's end re-enters through `reconcilePayments` -> `completeOrder` -> `OnPaid` on the same objects. The plans are an ordered list (a
JavaScript object's insertion order, the `pending:<phone>` entries among them), and each struct lists its members in the order flow.ts first sets them, so a TypeScript store
read, typed and written back is the same bytes (the plans shop of `testdata/store-vectors.json.gz`, TestStoreRoundTrip; its plans hold first periods, paid and asked, and a
skipped day). A block this version cannot read is never replaced: the plans' steps stop on it (errBadPlans), as the agent stops on a UPI ledger it cannot read. A member flow.ts sets to `undefined` is left out; an empty list stays `[]`.

**How the assistant's lines are written** (the outgoing check, 22 Nov). The Orders skill writes no words: every line is the shared runtime's packed words, filled through one
`assistant.Writer`. The open orders' list is `open_list.none`, `open_list.head` (the count in `{n}`), `open_list.row` (`{who}`, `{what}` and `{case}` as the key's own literals,
the order's total in `{inr}`) and `open_list.more`; the big order's card is `card.answer.big_order` (who and what as literals, the amount in `{inr}`); Orders' cancel and refund
cards are `card.cancel.paid@orders`, `card.cancel.free@orders` and `card.refund@orders` (words.ts SKILL_ASK: an advance, not a deposit), and its two refusals
`refusal.already_back@orders` and `refusal.cancel_first@orders` (SKILL_REFUSAL); the help and "didn't get that" lines for an Orders shop's kinds end in `@orders`, and the
morning line's part is `morning.open` (`{n}`). All are rendered by go/scripts/gen_words.ts (`ordersWords`) from the real `write()`, `cardQuestion()` and `morningFacts()`, and
the generator proves each key's words pass the check with exactly the facts it notes. The plan rows' "Monthly plans" and "N meals tomorrow, lunch" go in as literals, as
assistant.ts writes them through `w.lit`.

**The shared runtime's Orders profile** (internal/runtime `assistantopen.go`, and small additions in assistant.go, assistantkit.go, morning.go; internal/assistant reading.go and
words.go): `AssistantHooks.Orders` and `OwnerReading.Orders` (the kinds and the router's reading of an Orders shop: the listings-only kinds and `open_orders`), the
`OpenSkill` interface ("open orders", the morning line's count), a skill's own wording of a card or a refusal (`skillKey`: the key's `@<skill>` form when the pack has it) and
`PublicFace` (character.ts publicFace). A Bookings or listings-only shop says exactly what it said before: `skillKey` and the reworked `idOf` run for every shop and find no
`@<skill>` key for them, and the other branches are taken only by an Orders shop.

## 23 Nov 2026 (stream OG): the gaps before the deletion

**Contract cases for the money paths only unit tests held.** `contract/plans.contract.test.ts` now runs a plan's renewal (the credit carried, asked once), its reminder
and lapse (the carried credit owed back), a cancel mid-month (the unused days owed back), a cancel while the renewal waits, and a pause with a resume credited at the
renewal. `contract/gaps.contract.test.ts` holds the rest of the money, limit, approval and licence behaviour. Go passed every new case as it was: the W4 port of
flow.ts and the agent's money paths were right.

**Findings fixed on both sides.** In the TypeScript and in Go the same way:
- `plans.go watch`: a period whose payment order was cancelled outside the plan is given up at the next beat;
- `order.go PlanMealsInSlot`: the dead `except` parameter is gone;
- `reading/intent.go CoerceIntent`: dates and times are checked with `language.IsDatePhrase` and `IsTimePhrase`, which are shared with Bookings;
- the TypeScript now names a missing item or plan type the way Go already did;
- the TypeScript's `policyOf` takes a tree with no payment block.

**One copy fewer.** `agent_watch.go`, `agent_say.go`'s owner route (ownerMsg) and page outbox (chanMsg) are deleted. Orders uses `bookings.Watch` (with its new `Do`, for
the settlement read), `bookings.OwnerMessaging` and `runtime.ChannelMessaging`, wrapped in the same order as before: the outbox over the watched owner route.

