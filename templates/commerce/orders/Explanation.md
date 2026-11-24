# Orders: why it is built this way

**24 November 2026: the runtime is the Go program.** From 0.2.0 this template's shops run on `go/cmd/orders`, and its TypeScript server runtime (`server/` main, start,
runtime and services, the live adapters' glue, the local stack and the runtime kit of the tests) is deleted (decision 61; go/TRIAL.md, "The switch"). Where the dated
sections below describe those files they are this template's history; `src/` (the demo's engine), `server/config.ts`, `store.ts` and `snapshot.ts` stay.

Plan item B55: pre-orders with an advance payment, a pickup or delivery slot, "paid" judged from the payment record, stock and per-day limits, and refunds that ask the owner. This note is the reasoning; the facts are in [README.md](README.md).

## Which template it copies

Orders is **Bookings with the calendar taken out**. A customer starts the conversation, the agent holds something for a short time, asks for money, and confirms when the money is on record, as Bookings does. What Bookings keeps in a calendar (is this time free) Orders keeps in the orders themselves (is there stock left, is the day full). So the agent's flow follows Bookings; the packaging (the server with two Guards, the report, the certificate, the papers) follows Fees, which is the template that has no calendar. Nothing was moved into `modules/` for it, apart from three small edits listed below; it imports the modules and no template, and `test/runtime-imports.test.ts` plus `modules/test/boundary.test.ts` keep it so.

## Stock and the day's count are derived, not counted

The first design question was where "12 thalis left" lives. A counter goes wrong the first time a hold expires without the agent running, a cancellation is replayed, or the store is restored from a snapshot. So there is no counter. `takenOf` and `ordersOn` (src/order.ts) add up the orders that hold stock *right now*: confirmed ones, and ones waiting for their advance whose hold has not run out. An expiry is therefore not an event that has to be run correctly; it is a clock passing. The runtime test restores a snapshot and checks the stock again.

Two rules follow from that, and both are tried by the hand check:

- **A hold never outlives the cut-off.** The hold is the lesser of the shop's hold time and the time left to the cut-off. After the cut-off the stock is back, whatever the customer was told.
- **A late payment is taken again only if the world still allows it.** On Razorpay, when the advance arrives after the hold ended, the agent runs the same checks as for a new order (cut-off, stock, the day's limit) and confirms if they pass; otherwise the advance is refunded and the customer and the owner are told. On UPI the owner's mark after the hold never confirms an order by itself: the owner owes the money back, or keeps it for an order they take by hand (the same rule as Bookings).

## What the AI does not decide

The reading steps (rules, then the decision model, then the small language model, plus buttons) only turn a message into an intent: items, a day, a slot, pickup or delivery, a price named. They never decide. The menu price is a floor (`price-at-or-above-menu`), the quote is always the menu price, stock and cut-off are pure functions of the settings and the orders, and a delivery address is accepted only if it names a place on the shop's list. The model's answer is reduced to a kind, a language and a price, so a fooled model changes nothing. Items, the day and the slot come from the rules alone; a message that needs the model to find them is asked again with the menu list.

## The money rules

- **Confirmed only when recorded.** The advance is counted from the payments service's own list (Razorpay) or from the owner's UPI marks, and the "Confirmed" message passes a gate that reads the record (`confirm-only-when-recorded`). A part payment (the owner marks less) keeps the order held and asks the owner for the rest.
- **Part or full advance.** `advance.mode` full asks for the whole total; part asks `percent` of it, rounded up to a whole rupee. The balance is paid at pickup or delivery and is not tracked (listed under not tested).
- **Refunds.** Never more than was paid. Inside the cancellation window the advance goes back, above `refund.limitInr` through Guard's hold and the approvals relay. Outside it the owner decides, once, in the ordinary conversation ("approve o-3"). Guard's threshold and the agent's limit are one number.
- **An order above the owner's line** (`owner.approveOverInr`) waits for the owner before any payment is asked: nothing is held and no link is made until they say yes, and the checks run again when they do, because the world may have moved.
- **A dearest-order bound.** Guard bounds a link to a range, not a list, so the settings carry `orders.maxItemsPerOrder` and the link's upper bound is that many of the dearest item. The settings refuse an order bigger than the day's refund cap, in plain words, so the failure is at setup and not at the till.

## The address

A delivery address is the customer's, written for the owner. It is kept in the order, is in the one message to the owner when the order is confirmed (a template of its own), and goes to the customer's chat never (they are told the *place*). The export (for the panel, and the builder's or Operator's copy) removes it. The record does not keep it either: it notes the place that matched.

## Choices worth knowing

- **Two confirmations, two owner messages.** A UPI shop's "the owner has confirmed" and a Razorpay shop's "we have received" are two messages, and a delivery order's owner notice (with the address) is its own message. A WhatsApp template is the wording of exactly one message, so a message whose wording changes with the order would not fill back into its template. Each variant that reaches the owner is its own template; customer confirmations in other variants go as plain text inside the 24-hour window (they are replies), listed in Deferred.
- **Panel and report.** The panel's setup, the go-live certificate, the monthly report, the unfinished-work list and the papers are one more row in tables the panel already had for Bookings and Fees (`bundle/lib/kinds.ts`, `bundle/panel/setups.ts`).
- **No stand-in server, no local stack.** Bookings and Fees carry HTTP stand-ins and an end-to-end stack. Orders does not (Deferred): the runtime, the inbox and the relay are the shared ones, and the runtime test and the panel's flow tests cover its own parts.

## Edits outside the template

1. `modules/unfinished/builtin.ts`: `payment_unrecorded` also applies to Orders (an order waiting for its advance), and a `big_order` waiting for the owner counts as an answer the owner owes.
2. `bundle/lib/kinds.ts`, `bundle/backup/export.ts`, `bundle/export/build.ts`, `bundle/services/{relay,heartbeat}.ts`: Orders is one more kind; the export writes `orders.json` with the customer as a keyed fingerprint and the address removed; the place on the delivery list (`area`) stays as the shop named it. A live runtime writes the record with `RECORD_KEY_FILE` and refuses to start without it (B69, `bundle/Explanation.md`).
3. `bundle/panel/`: see `bundle/panel/Explanation.md`.

## Size

Measured 9 November 2026. `templates/commerce/orders` code (src, server, inbox, approvals, report, crash-test, scripts): 6,591 lines; tests: 1,820 lines (plus the panel's 13 and the bundle's); the four-language messages and report words (`src/language/templates.ts`, `report/strings.ts`) are 954 long lines and over half the bytes. Panel and bundle: a per-template table (`bundle/panel/setups.ts`) replaced the two-way Fees branches rather than adding a third, and Fees' pages are byte-identical. Nothing was copied from another template's source file that a module already holds: the agent, limits, words, report counting and settings are Orders' own; the server, inbox, relay, payments, refunds, UPI, the record, the reports' signing, the papers and the reading steps are the shared modules.

## UPI by default, and the payment module's capabilities (B71, 10 November 2026)

- **No `payment` block is refused**, and asks for the shop's UPI ID (modules/payments/providers, the one reader). Before B71 it meant Razorpay. The template's
  `settingsExample` is the UPI example; the gateway examples say `"module": "razorpay"`, and the tests about Guard's refund limits run on them.
- **The agent asks what the module can do, never its name** (`capabilitiesOf`): a module that cannot confirm a payment by itself is marked paid by the owner
  (modules/payments/owner-marked); one that cannot refund by itself has the owner pay refunds back; one that cannot cancel a request has nothing to close at the
  final stop. The owner's mark and a gateway's
  webhook both go through `reconcilePayments`. The store's `upi` key, the record's `upi_*` names and the `upi_*` message ids keep their values (records, reports and Meta's
  templates use them). The live adapters take the gateway from the shop's settings (modules/payments/providers/runtime.ts).
- **The neutral interface** renamed what the agent reads: `pay_url` (was `short_url`), `request_id` (was `link_id`), the events `request.paid`, `payment.received`,
  `refund.done`. The Guard spec is written for the gateway the shop chose (`gatewayLimitsSpec`), byte for byte what it was for Razorpay.


## Two customers for the last item (checkpoint item 8, 11 November 2026)

Orders already held stock in its own saved state, so nothing was changed here. What is left of an item for a day is worked out each time from the orders that hold it (`src/order.ts`, `takenOf` and `holdsStock`): a confirmed order always, one waiting for its advance until its hold ends or the cut-off, whichever is first. The check and the hold happen in one step (`proceedToHold`: `availability`, then the hold and the record's `hold_stock` line), and the runtime handles one message at a time (`modules/runtime/tasks.ts`), so no other customer's step can come between them. A hold nobody pays ends by itself (`expireHold`, which reads the payments record first and writes `release_stock`). `test/last-item.test.ts` pins it: with one veg thali left, two customers ordering it at the same moment get one hold and one link, and the other is told it is sold out; a step held half-way keeps the other customer's step from starting; and once the unpaid hold ends, the next customer gets the thali.

## Settled by <who>, by their word, on the report and the message (B75, 12 Nov 2026)

A refund a person at the server settled as made (Guard's `already_done`) was already left out of "given back" in the report data. The report page now lists it
one row per person after "given back" ("Settled by ravi, by their word"). The owner's WhatsApp message says it after the given-back amount, inside that value, so
no approved template body changed. The longest form that fits WhatsApp's 1,024 characters is chosen, from the names down to none: in the long-name Malayalam
month with the badge there is no room, and the message is as before. How and why: modules/Explanation.md, "Settled by <who>, by their word on the documents".
Machine-written hi/ml/kn, on the REVIEW sheets (section 6).

## Money the owner and customer can read (batch 4, 14 Nov 2026)

The Orders page takes the same money parts as Bookings' (templates/commerce/bookings/Explanation.md, "Money the owner and customer can read"): the UPI box with "copy UPI ID", "open in Chrome", the UPI reference and the "payment did not go through?" fold; a held UPI order's page runs the one small script (by a nonce) instead of reloading under the customer; "I already paid" says how long a check takes. An order remembers when the customer said they paid (`claimAtMs`) and the reference (`claimRef`), and the owner's page lists "Customers say they have paid" apart from "Waiting for payment", with the order's reference (`o-3`, the UPI note). A gateway (Razorpay) shop's page has the payment link and none of this: the gateway confirms by itself, so there is nothing for the owner to mark and "I have paid" is not offered (tested). The late-payment card is Bookings' only (see Deferred.md).

## The books (the accounting module, 15 Nov 2026)

Orders keeps no money sums of its own any more. Every money line it writes goes through `modules/accounting/post.ts`: `record_payment` (an advance or an extra payment), the owner's marks, the advance applied to an order, and every refund owed, made or cancelled (through `modules/payments/refunds.ts`). `src/accounting.ts` holds the frozen map (`ORDERS_LEGACY`) that reads records written before the books, and the constructor the agent uses. The monthly report's money figures come from the journal (`modules/accounting/figures.ts`); the old sums are kept only in `test/accounting-figures.test.ts`, which holds the two equal on every crash-test world and checks the books after each one (`modules/accounting/invariants.ts`). The report also carries the signed books summary and a "Money this month" block, a customer's own page lists its receipts, and the owner's app has the Money section and the accountant's downloads. How it all works: `modules/Explanation.md`, "The accounting module"; what is left: `modules/Deferred.md`.

## Finishing Orders (17 Nov 2026)

What was added, and why. Every change is written to leave a shop that sets nothing new exactly as it was (its records, its report bytes, its messages).

- **The stand-in server and the local stack** (`standins/`, `scripts/local-stack.ts`, `npm run stack`), as Bookings and Fees have them: the Razorpay and WhatsApp wire formats
  in front of the fakes, signed webhooks to the inbox, a stub Guard and the approvals relay beside the runtime. The stack always pays through Razorpay (the example shop takes
  UPI, which has no gateway to try). `test/full-chain.test.ts` runs it; `test/approvals-guard-binary.test.ts` runs the **real** `geo-guard` binary on a temp folder
  (needs no Docker; skipped, and says so, when the binary is not built). `test/runtime-kit.ts` is the runtime on fakes that second test uses. All three were written on 17 Nov
  and not run in that session (the owner asked for one test pass at the end).
- **A slot's own limit** (`maxOrders` on a pickup or delivery slot). Counted from the orders the way the day's count is (`ordersInSlot`, never a counter), checked in
  `availability()` in the same step as the order, so a WhatsApp order, a page order, the owner's late yes and a late payment all meet it. A full slot is not offered in the
  list of slots, the page's offer shows it as not open, and when every open slot of a day is full the customer is told so (`slot_full`), not that orders have closed. It is the rule
  `within-day-cap` again (a new rule id would add a key to every report's "stopped" table and change every report's bytes), with the slot's own words in the reason.
- **A reminder before the slot** (`reminder: { "hoursBefore": 2 }`). Made when an order is confirmed, by modules/reminders (a moment already past is not scheduled; if several
  fell due, one goes), sent from the tick, only while the order still stands, cleared when it is cancelled or done. Left out: no reminder, as before. It goes out unasked, so it has
  a Meta template (`order_reminder`, the pickup wording; a delivery reminder names the place and goes as the generic name, like a delivery's confirmation).
- **The balance paid at pickup or delivery.** The advance and the balance are two records. The advance is the payment record's and confirms the order. The balance is the total less
  the advance and is written on its own line (`record_balance`, with `balancePaise`), never added to "advance collected" and never posted as an advance in the books (the books
  have no "balance" kind; the accounting module is shared, so a new kind there is a decision of its own, see Deferred). The owner says `balance o-3 cash`, `balance o-3 upi` or,
  on a gateway shop, `balance o-3 link` (the agent makes a link for exactly the balance, the customer gets it, and the payments service's own list is what shows it paid,
  `by: "provider"`). A customer's words never mark it. It can be marked on a confirmed order or a finished one. The report keeps two figures: "advance collected" and, only when
  there is one, "balance collected at pickup" (`money.balanceCollected`, left out when none, so older reports keep their bytes); what is "still to collect" no longer counts an
  order whose balance was marked. The monthly WhatsApp message is an approved template with a fixed body and does not carry it (Deferred).
- **The "time ran out" card for the owner.** An expired UPI hold whose one-use code is still live is listed on the owner's page as `late_deposit` for 48 hours (14 days after the
  customer said they paid), as Bookings does. "Received" on it is the same mark as WhatsApp's; after the close it is the late mark (`lateMark`): never confirmed again by itself,
  owed back, or kept for an order the owner takes by hand. The assistant words it as an advance (`deposit`), because the module's words know that kind.
- **Cancel and refund from the owner's chat.** `ordersSkill` now takes `acts` (the agent's own cancel and refund paths), as Bookings' skill does. A card shows the exact change; the
  tap refunds exactly what it showed through the same limit and Guard as "approve o-3" (above the limit Guard holds it for the owner's second yes); on a UPI shop the owner owes
  the refund. An order still waiting for its advance, or for the owner's yes to a big one, is cancelled with no money moving. The owner's cancel does not ask the owner again
  (the customer's `onCancel` does, on a late cancellation): the owner is the one asking.

New Hindi, Malayalam and Kannada lines (the templates `slot_full`, `order_reminder`, `balance_paid`, `balance_link`, `owner_balance_marked`, `owner_balance_none`, and the report
label "balance collected at pickup") are machine-written and are on the three REVIEW sheets.


## Monthly plans (17 Nov 2026)

A home tiffin service sells a month of meals for one price, paid in advance. This is a variant of Orders, switched on by a `plans` block in the settings (`settings/annapurna-tiffins-plans.example.json`); a shop without the block behaves exactly as Orders did (nothing is read, nothing is stored, the hand check and the report are the same bytes). The code is in `src/plans/`, with small hooks in `agent.ts`.

**What a customer can do, on WhatsApp.** "I want the monthly lunch plan" (the plans are read from plain words in four languages, with no model, so a plan costs no AI allowance; the order page does not take plans yet, see Deferred). The agent holds the first month and makes the payment link the shop's usual way: the shop's UPI ID, marked received by the owner, or a gateway link. Once the payment record shows it, the plan is on. The customer can then **skip** a day, **pause** from a day, **resume** from a day, ask about **my plan**, or **cancel the plan**. A delivery plan asks for the address once and checks it against the delivery list like an order.

**The one source: the entitlement ledger** (`ledger.ts`). A plan has periods (a month counted from the start day, so a plan that began on the 31st never drifts; `periods.ts`), and each period has one state for every meal day: due, delivered, skipped, paused or cancelled. The kitchen's count, the slot's capacity, the credits and the report are all read from it, never kept as numbers beside it. It is pure (no disk, no database) and every refusal or allowance comes back as a Decision written in the record.

**The rules, in plain words, held in code and written in the record.**
- `plan-cutoff`: a skip, a pause or a resume for a day whose cut-off has passed is refused, and the customer is told the cut-off time. The cut-off is the shop's own (`plans.cutoff`, the same shape as the order cut-off). The moment itself is too late.
- `plan-no-charge-after-cancel`: after a cancel, every day whose cut-off is still ahead is cancelled, nothing more is asked for and no skip or pause is taken. Days already closed stay due: the kitchen has made them.
- `plan-one-renewal-per-period`: one payment request for each period, however often the clock ticks.
- `plan-one-credit-per-period`: the days not taken in a period are settled once, as carried or refunded, never both; a day skipped and then paused is one day.
- `plan-credit-within-paid`: a day is worth `price / meals` rounded down, and a credit is never more than what was paid for the period (a credit carried in lowers what was paid).
- A renewal payment is matched to its period because each period's payment is its own record with its own link: a second payment on it is the agent's existing "paid the advance twice" path (refunded), and one that comes after the plan lapsed is refunded or owed back.

**How money moves: nothing new.** A period's payment is an `Order` record with `plan` set (no day, no items, never counted as an order in a slot, never "confirmed"). The payment link, the owner's UPI mark, a duplicate payment, a late one, Guard's hold above the owner's limit and a UPI refund the owner owes are the agent's own paths and none is written again. There is no automatic debit: a renewal is a payment link the customer pays; one not paid before the first meal's cut-off lapses, charges nothing and gives the credit it was to take back.

**Credits (the shop's rule, `plans.credits`).** "carry": the days not taken come off the next month's payment. "refund": they are refunded at month end through the refund path (Guard holds a refund above the owner's limit and the owner approves it; on a UPI shop the owner owes it). The credit of a period is final once its last meal day's cut-off has passed, which is also when the next month is asked for (so a renewal's window is between two meal days' cut-offs; the one reminder is half way through it). A cancelled or lapsed plan refunds what is unused (days not taken, and credit carried and not yet used) through the same path, because there is no later payment to take it off.

**Capacity.** A plan's meals count in `ordersInSlot` (the one place the agent, the shop's page and the open-slot list read), so a slot's own `maxOrders` is shared with one-off orders: a subscription is refused ("the slot is full for the days you asked") if any day of its first month has no place, and a one-off order is refused for a day the plans fill. A skipped or paused day gives its place back. A renewal is not refused for capacity (a subscriber keeps their place) and holds its places from the moment it is asked for. Plan meals do **not** count in `maxPerDay` or in menu stock: a plan's meal is not a menu item.

**Pause across a renewal.** A pause is the plan's (from a day, open-ended until the customer resumes), not one period's. The next month is made with those days already paused, so each day is credited once, in its own month, and the first month's settlement is not touched. A month that is wholly paused is still asked for and its days come back as credit (see Deferred).

**Books and report.** A period's payment is applied (held advance becomes the shop's money) when the period is settled, less what is refunded; credit carried is applied when a later payment uses it. The monthly report page shows, for a shop with plans only, plans running at the month's end, started, renewals paid, meals delivered, days credited and what they came to (carried or refunded), cancelled and lapsed, all counted from the record (`src/plans/report.ts`). The owner's morning line lists tomorrow's meals for each slot (the kitchen's number), read from the ledger (`mealsTomorrow`, `src/assistant.ts` `open()`).

**Words.** Eighteen messages (`src/plans/templates.ts`), checked against the record before they are sent like every other. Nine can go out in a closed window and are WhatsApp templates too: `plan_renewal`, `plan_pause_done`, `plan_skip_done`, `plan_active`, `owner_plan_cancelled`, and (25 Nov) `plan_lapsed`, `plan_hold_expired`, `plan_credit_refund`, `plan_credit_refund_pending` (list to submit in `whatsapp-templates.json`). The Hindi, Malayalam and Kannada lines, the customer's plan words and the report's plan lines are machine-written and are on the three REVIEW sheets.

**Tests.** `test/plans.test.ts` (the settings, the period dates, the ledger's rules, and the agent end to end on the fakes) and five crash-test situations that run only on a shop with plans (`crash-test/plans.ts`: a skip just after the cut-off, a pause spanning a renewal date, a renewal paid twice, a cancel while a reminder is queued, a credit and a refund for the same day). Not tested on a real WhatsApp, payment provider or UPI account.

## "menu" shows the menu (18 Nov 2026)

A chat guest's first quick tap sends the word "menu", and the rule reader took it for an unknown sentence ("Sorry, I didn't understand"). `MENU_RE` in `src/adapters/rule-parser.ts` reads "menu" and its Hindi, Malayalam and Kannada spellings as the greeting, which shows the menu with its prices; a WhatsApp customer who types "menu" gets the same.


## The shop's stock count (18 Nov 2026, stream `stock-18nov`)

A menu item the owner counts (modules/stock, id `menu:<item>`) now has a shelf count beside the day's stock. Orders still works out what an order HOLDS from the orders (`holdsStock`, `takenOf`), unchanged. The count falls when an order stands (confirmed or completed), is given back when it is cancelled, each booked once under `sale:<order>:<item>` by `reconcileStock` (the start of every step and tick, and before each availability check). The check `countedLeft` takes what other orders hold that is not yet in the count off what is left, as a second limit with the same rule id (`within-stock`), so no report table changes. The shop's page and the ONDC catalogue show the smaller of the day's stock and the shelf. An item nobody counts has no stock line: no decision, no record line, no state is made, and the hand check and the crash-test situations are as they were (they count nothing). A low mark gives the owner one line in their app per crossing and "running low" in the morning line.

## Asked from another number, and the UPI refund's account (25 Nov 2026, refund-paths)

**Why.** A shop knows a customer by their conversation, and every payment hangs on the case and the provider's payment id. Two things went wrong in practice: a customer who writes from a new phone (or a family member who paid) and names their case was not recognised and nothing led them to the owner; and the owner's UPI refund message said "by UPI to <phone>", although the money may have come from someone else's account.

**What a stranger's ask does.** Only a conversation that holds no case is read this way (the brief's rule, kept literally: a customer with a case of their own who names another's is answered as before). The shared reader (`modules/record/case-asked.ts`, Go twin `go/internal/runtime/caseasked.go`, held equal by `go/internal/runtime/testdata/caseasked-vectors.json`) cuts the words into tokens and, first match wins: a receipt's number (`RCT/26-27/0007`, from the record's `refs.doc`), the short reference (`o-3`, `O3`, `o#3`, with a `.2` or `.b` part read through the record's link references), a token that is one of the record's keys (a gateway payment id, a link's reference) or a UPI reference a customer typed, and only when the template's reading found nothing to do, the word form ("order 3", "order no 3", in four languages). The word form waits because "order 3 pm" or "order 2 dosa" is a new customer's request. Only a case the shop holds is ever matched, so a guessed reference gets the usual answer and the owner hears nothing. The reply names nothing of the case; the owner's notice is a WhatsApp template so it reaches them outside their window; the hourly limit is read from the record (`case_asked_elsewhere`, outcome `confirmed`, the same asking conversation and `refs.case`), so a restart keeps it. The record line leaves `booking` null and carries the case in `refs.case`: the unfinished-work list and anything that reads a case's lines as its customer's never see the stranger. No number but the asker's own conversation is in it (the export fingerprints that field like every other).

**The refund's account.** `ledger.ts refundSource` (Go `ownermarked.RefundSource`) finds the owner's mark that a refund gives back: its request's reference is the note the `upi://pay` link carried, and the mark's amount and day are what the owner sees in their UPI app. The day is the day the owner marked it, which is the day the money showed or later. A refund is never more than the mark it gives back (an extra payment's refund is the part of the last mark beyond what was asked), so "₹200 back to the account that paid you ₹300" reads true. Changed bodies need Meta's approval again, so the templates have new names and the old ones stay registered, unused.

Orders reads a plan's own reference too ("p-5", "plan 5"); a pickup hold and a plan's period are orders, so they are found as orders.
