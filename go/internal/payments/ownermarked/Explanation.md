# internal/payments/ownermarked: the UPI shop's ledger

The Go twin of `modules/payments/owner-marked` as the Bookings runtime imports it. For a payment module that cannot confirm a payment by itself (UPI today) the customer pays the shop
directly, and "paid" is the owner's word: a reply from the owner's own number with a fresh one-use code that was sent only to them.

- **state.go**: the ledger's state, field for field as the TypeScript keeps it under the Bookings store's `upi` member (`seq`, `requests`, `refunds`). Every struct carries the members it
  does not model (`Extra`, kept raw and written back after the known ones), so a shop can move between the two runtimes and lose nothing. `Parse` / `JSON` read and write the member.
- **ledger.go**: the rules (`ledger.ts`): `OpenRequest`, `MarkReceived` (the five results: marked, already, already_refund, unknown, bad_amount; a mark that leaves some still to pay uses its
  code up and makes a new one; a request the agent closed keeps its code and a later mark is recorded as after the close), `CloseRequest`, `OweRefund`, `MarkRefund` (done, or kept where
  that is allowed), `RemindersDue`, `Reminded`, `OwedOn`, `RequestOfMark`, `LeftOn`. Codes are drawn through a `Codes` function the caller hands in (the Bookings runtime passes
  `assistant.NewCode`: the approvals' alphabet), so this package imports no other and a test replays the TypeScript's draws.
- **owner.go**: the owner's replies (`owner.ts`): `ParseMarkReply` (a tapped button's id or typed words: "received K7M2QX 150", "refunded ...", "kept ...") and `MarkButtonID`. The ids keep their
  `upi-` names: messages already sent carry them.
- **view.go**: `View`, the ledger as a `payments.Payments` (`markedPayments`), so a template's "look first, write, read back" works unchanged; `Refund` and `ResendRefund` fail with
  `OwnerPaysError` (the owner pays refunds). `NoGateway` is `noGateway`: what a shop with no gateway is handed from outside; any call is a bug and says so.
- **qrimage.go**: the QR picture of a `upi://pay` link, written under a random folder name into the folder the report pages are served from (`FolderImages`), or kept in memory for tests
  (`MemoryImages`).

What is NOT here, and where it is: the open obligations folded from the record (`markObligations`) are in `internal/accounting/obligations.go` (the owner's Money view needed them first); the
owner's buttons are `bookings.OwnerMarkButtons` (they use Bookings' labels and the Bookings button clip).

## Proved

`testdata/vectors.json` is made by running the TypeScript (`go/scripts/gen_ownermarked_vectors.ts`; `templates/commerce/bookings/test/go-books-fresh.test.ts` fails when it is stale):
12 scenarios (a deposit paid in one mark, in two, a bad amount, a request closed and then marked, a refund owed / reminded / done / kept, a code already held, the 51-draw cap, a link that
cannot be made, the neutral view's every call), compared after EVERY step for the result and the whole state; 47 replies the owner might type or tap; the no-gateway words. The ledger draws
its codes with `node:crypto randomInt`, which the generator replaces by a replay of draws the scenario names, so a code is the same text on both sides.

## Differences from the TypeScript, all recorded

- Money is `int64` paise: a mark of a fraction of a paisa (which the TypeScript refuses as `bad_amount`) cannot be built. An owner's typed amount too long for a whole number of paise is read as a
  huge amount (`bad_amount`), never as "no amount" (which would mark what was asked).
- The TypeScript's functions throw (a pay link a UPI app would not take); here `OpenRequest` returns the error, and the counter has moved on, as the TypeScript's has.
- An optional text member (`customer`, `service`, `imageLink`) that is the empty string is read as left out; the TypeScript never writes one.
