# Go books (`internal/accounting`)

The shop's books in Go: `modules/accounting/*` and `templates/commerce/bookings/src/accounting.ts`, ported to give the same bytes (decision 61, wave 2). The Bookings runtime, written by
someone else later, calls this package. What is here are exact, tested blocks, not a runtime.

## What each file is

| file | the TypeScript it ports |
| --- | --- |
| `jsnum.go` | the JavaScript number and date behaviours the books copy: `Number(text)` (StringToNumber), `String(n)`, `Math.round`, `Date.parse` of the record's times |
| `accounts.go` | `accounts.ts` and `tally.ts` `groupOf` |
| `numbers.go`, `periods.go` | `numbers.ts`, `periods.ts` (document numbers, the Indian financial year, day and month ranges in the shop's zone) |
| `journal.go` | `journal.ts`: the fold of the record into double-entry lines; every Problem sentence is the TypeScript's |
| `post.go` | `post.ts`: `CreateAccounting`, `Post` with the write callback, repeat detection, document numbers, the read-back checks |
| `documents.go` | `documents.ts` and `case-documents.ts` (a Document as data; the page is in `render`) |
| `figures.go`, `summary.go`, `invariants.go` | `figures.ts`, `summary.ts`, `invariants.ts` (`BooksFaults`, `FiguresFaults`) |
| `export.go`, `tally.go` | `export.ts` (journal, documents, settlements CSVs, README, `AccountantFiles`), `tally.ts` (TallyPrime XML) |
| `ownermoney.go`, `obligations.go` | `owner-money.ts`; `markObligations` of `modules/payments/owner-marked/obligations.ts` (only what the view needs; the payments stream may take it over) |
| `settlements.go` | `settlements.ts` over two small interfaces (see below) |
| `words.go`, `words/words.json.gz` | `words-owner.ts`, `words-documents.ts`, the "Money this month" words, each language's machine-written note and the two style sheets, made by `scripts/gen_books_words.ts` |
| `bookings.go` | `templates/commerce/bookings/src/accounting.ts` (`BookingsLegacy`, `BookingsJournal`, `BookingsAccounting`) |
| `render/` | `owner-money-render.ts`, `report-block.ts`, `document-page.ts`: the HTML |

`check.ts` (the open check, a command line) and `test/` were not ported: the check is a CLI over a report's evidence pack, and the TypeScript tests are held by the vectors here.

## Why `render` is a package of its own

`report-block.ts` and `html.ts` use `esc` and `fig` of `modules/report/page.ts`. The Go `report` package imports `accounting` (for the record's entry type), so `accounting` cannot import `report`
without a cycle. The three HTML renderers (the owner's Money section, the report block and the document page) sit together in `accounting/render`, which imports both, so `report.Esc` and
`report.Fig` are reused and nothing is copied. The words they need are loaded by `accounting` (the export's README also needs one of them), and `render` reads them through its exported accessors.

## How the vectors are made

`scripts/gen_books_vectors.ts` builds seven shop records by RUNNING the TypeScript: Bookings (deposits, a second payment on a link, refunds owed then made, cancelled or kept, UPI, cash and bank
marks, a person's word, corrections and the read-back errors), a composition shop (bills of supply, a restore, a refund note with no receipt), the gateway settlements (the real
`readSettlementsOnce` over a scripted provider, with every kind of row, a failed day and a catch-up), Fees (bills, late fees, waivers, write-offs, old dues, the older words), older lines through
the Bookings map, malformed lines (every refusal of the fold) and a financial-year end (lines at 18:29:59.999 and 18:30 UTC on 31 March, a restore, gaps). Each world is a list of steps the Go test
REPLAYS (each `post` result and thrown sentence, each line written, each document number), then everything is read from the record that came out: journal, next numbers, summaries, figures in
every option combination, faults of the record and of damaged copies of it, the obligations, the owner's money at several moments, the accountant's files for every month and year (with and
without Tally, with its own company and ledger names, with old-due marks, in other zones, for periods that are not periods), the HTML of the Money section (four languages, with and without
links), the report block and the document pages. The Go tests compare byte for byte and compare the thrown messages. The vectors name the Node that made them (`node` in each file) and the
freshness check ignores that member.

`scripts/gen_books_words.ts` writes `words/words.json.gz`. A word that is a function is rendered with slot sentinels and checked on other values (`lib_words.ts`): all of the books' word
functions are plain text around their arguments, so none had to be described by hand.

Both generators have a `--check` mode, and `templates/commerce/listings/contract/words-fresh.test.ts` fails when either was not run after a change to `modules/accounting`.

## Where Go differs from JavaScript (and what the code does)

* **Numbers in refs.** A ref is text. The TypeScript reads it three ways: strictly (`Number.isSafeInteger(n) && String(n) === text`: amounts, settled figures), with a bare `Number()` (the
  `reverses` of a correction, obligations, the held rows of the owner's view) and with `Number()` kept only if it is a safe integer (the settlements sheet). `JSNumber` is StringToNumber for
  what a ref can hold (`""` is 0, `" 5 "` is 5, `"1e3"`, `"0x10"`, `"Infinity"` are numbers, `"+0x10"` and `"1_0"` are NaN); `JSNumberString` is Number::toString. Tests hold both to Node's output.
* **Order.** A JavaScript Map keeps insertion order and `Map.set` on a key already there keeps its first place. Go maps do not, so the journal's `owed` and `identities`, the tally's ledgers and
  vouchers, the settlements sheet's rows and the invariants' runs keep order slices. The one place the order cannot be kept is an entry's own `refs` in `BooksFaults` (see Deferred).
* **null in keys.** A null case is the text `null` in template strings (`fee:null`, `null|cash`), copied as the TypeScript does; the owner's view keeps a nil case and a case named "null" apart.
* **Truthiness and presence.** `refs.doc ?`, `refundId ?`, `settledAt ?` are truthiness (an empty text is false); `refs.x === undefined` and `??` are presence: both are kept where the TypeScript
  uses each, and a missing ref prints as `undefined` in the read-back sentence and the settlements sheet.
* **Sorting and comparing.** Every sort is stable (`sort.SliceStable`). `localeCompare` (settlements sheet, obligations) is `golang.org/x/text/collate` with the English tailoring, as
  `internal/listings/stock.go` does; the generator's ids mix case, `_`, `-` and digits to hold the two together. ISO times compare as text where the TypeScript compares strings and are parsed where it
  calls `Date.parse`.
* **Rounding.** `Math.round(inr * 100)` is `RoundHalfUp` of the double, taken in a variable first so no fused multiply-add changes it; the vectors sweep every k/100 up to 60 rupees and 3,000 more.
* **Escaping.** The XML escaper writes `&apos;`, the report's `esc` writes `&#39;`: they are two functions in the TypeScript and two here. `encodeURIComponent` is written by hand (neither
  `url.QueryEscape` nor `PathEscape` is the same).
* **Money.** int64 paise everywhere, never a float. JavaScript numbers beyond 2^53 are out of scope.

## Settlements: what the Bookings wave writes

`settlements.go` needs two things the Go runtime does not have yet: a payments adapter and a record. It defines them as small interfaces:

* `Payments` has `ReadsSettlements() bool` (the provider's capabilities say `readsSettlements`) and `ReadSettlements(day zone.Date) ([]SettlementRow, error)`. `SettlementRow` has the fields of
  `modules/payments/payments.ts` `SettlementRow`. The Bookings wave writes the adapter that calls the provider's settlement report (the Razorpay recon read) and returns its rows.
* `Record` (record.go) has `Entries()` and `Append(NewEntry)`; the Bookings wave writes the adapter over the shop's store. The `Accounting` is `CreateAccounting` over the same record.

`ReadSettlementsOnce` is synchronous (the TypeScript is async); a failed read is an error value in the result, not a thrown one.
