# words: the Orders customer-facing words in Go

The Go twin of the words of `templates/commerce/orders`, built for wave W4 (decision 61). Nothing the customer or the owner reads is typed here: the words are generated from the
TypeScript by `go/scripts/gen_orders_words.ts` (`--check` and an exported `staleFiles()` like the Bookings generators), and the Go code only fills the holes.

## What is generated, and from what

| File | From |
| --- | --- |
| `en.json.gz`, `hi.json.gz`, `ml.json.gz`, `kn.json.gz` | `src/language/templates.ts` (+ `src/plans/templates.ts`), `meta-templates.ts`, `interactive.ts` |
| `testdata/render-vectors.json.gz` | every message x language x four varied fact sets, and each with its needed facts taken away, with `check.ts` and `limits.ts` verdicts |
| `testdata/words-vectors.json.gz` | WhatsApp parameters, `templateMessage`, `metaSubmissions`, `exampleFacts` of two shops, labels, buttons, lists, owner mark buttons, `clip`, `itemName` |

Each pack holds: `t` (118 messages, `{slot}` where a record value goes), `c` (the composite wording), `meta` and `metaSlots` (the WhatsApp templates and how each slot is filled),
`labels`, `ids`, `markIds`, `rowIds`, `slotTitle`, `limits` (Meta's), `generic` (TEMPLATE_NAMES) and `example` (the constants of `exampleFacts`).

## How a message is found

Like Bookings, each template is rendered with probe facts (`qzitems`, 7770002, an instant) and each probe's text is turned back into `{slot}`. Orders needed more than Bookings:

- **Composite slots.** `{when}` (the day and window), `{cutAt}`, `{how}` ("pickup" / "delivery to X"), `{rest}` (nothing, or what is paid on collection) and `{payTo}` are small rules
  over several facts. The generator asks the real helpers (exported from `templates.ts`: `when`, `day`, `cutAt`, `how`, `payTo`, and now `rest`) for their wording in each case and stores
  it as patterns in `c`; Go fills the named holes.
- **UPI wording.** A message is rendered with and without a UPI ID; the two are folded into one text with `{payTo}` and `{upiNote}` (the sentence a UPI shop's message ends with). The
  generator refuses a message whose UPI wording is not "the usual wording plus an ending".
- **Which facts a message needs** is found by taking each fact away (`need` throws) and the generator checks the slots read exactly those facts. The order in which Go reports the
  FIRST missing fact is the slots' reading order, proved by removal vectors (single facts and every suffix of the reading order, on a pickup and a UPI delivery fact set).
- `dateMs ?? slotFromMs` (`{day}`), `f.upiId ?` (an empty string is "not a UPI shop") and plan facts (`plan`, `plan.meals`) are handled as the TypeScript does.

## API (see the doc comments)

`WordsFor`, `Render`, `MessageFacts` (+ `S`, `N`, `MissingFact`), `MetaTemplates`, `MetaParameters`, `MetaBody`, `FillBody`, `MetaTemplateMessage`, `MetaSubmissions`, `ExampleFacts`,
`Shop`/`MenuItem`/`ItemName`, `Label`, `ButtonID`, `ItemRowID`, `SlotRowID`, `ButtonsFor`, `OwnerMarkButtons`, `ItemList`, `SlotList`, `Clip`, `CheckFactsOf`, `CheckMessage`,
`MatchesRecord`.

`MessageFacts` keeps the TypeScript's member names (capitalised, JSON tags the TypeScript's own). An optional fact is a pointer (`words.S`, `words.N`); nil is "the record does not
have it". `Shop` is the small part of the Orders settings that `ItemList` and `ExampleFacts` read; the lead fills it from `settings.ts` (the doc comment on `Shop` lists each field).

## Where Go and JavaScript differ (copied behaviour)

Counts are `strconv` (String(n)); rupees `language.FormatInr` (toLocaleString "en-IN"); `Clip` counts code points and trims with JavaScript white space; the advance in
`ExampleFacts` is an integer ceiling (`Math.ceil` over whole rupees); an unknown time zone is an error (Intl throws a RangeError).

## Tests

`go test ./internal/orders/words/` proves Go equals TypeScript on every vector. `node go/scripts/gen_orders_words.ts --check` proves the committed data is fresh.
