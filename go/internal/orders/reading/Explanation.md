# internal/orders/reading: how an Orders shop reads a customer's message

The Go twin of the Orders template's reading (`templates/commerce/orders/src`): `adapters/model.ts`, `adapters/rule-parser.ts`, `adapters/reading.ts`, `plans/words.ts` and
`language/interactive.ts` `intentFromReply`. Modelled on `internal/bookings` (parser.go, reading.go, intent.go, reading.json).

## What is here

| File | TypeScript | What |
| --- | --- | --- |
| `pack.go` | | loads `reading.json` once, compiles its patterns with `internal/language`'s JavaScript-regex matcher |
| `intent.go` | `model.ts`, `interactive.ts` | `Intent`, `ParseContext`, `CoerceIntent` (a model's answer, untrusted, decoded to `any` and checked by hand), `IntentFromReply` |
| `parser.go` | `rule-parser.ts` | `ParseIntent`, `IsPaidClaim`; the shop's item and slot names are the only patterns built at run time (`language.WordRe`) |
| `plan.go` | `plans/words.ts` | `ReadPlanIntent`, `MentionsPlan` |
| `router.go` | `reading.ts` | `Reading` (the `understanding.Reading` and `Shaper` the shared router takes), `RulesAreSure` |
| `reading.json` | | GENERATED: every pattern's source and flags, `NUMBER_WORDS`, the kinds, the decision question, the prompt, the schema |
| `testdata/*.json` | | GENERATED vectors: what the TypeScript answers; `reading_test.go` proves Go equal on each |

Both are written by `node go/scripts/gen_orders_reading.ts` (`--check` exits 1 and names the stale files). Nothing is retyped: the TypeScript's private constants are exported
(`CANCEL_RE`, `REFUND_RE`, `OWNER_RE`, `ORDER_RE`, `MENU_RE`, `PICKUP_RE`, `DELIVERY_RE`, `PAID_RE`, `NEGATION_RE`, `BEFORE_RE`, `AFTER_RE` in rule-parser.ts; `PLAN_RES` in
words.ts), with no change of behaviour.

## Where Go and JavaScript differ, and what is copied

- offsets and lengths are UTF-16 units (the 24 and 12 characters read around an item name; the order item names are tried in, longest first, a stable sort);
- `\s`, `split(/\s+/)` of an empty message (one piece), the look-behind and look-ahead of the word patterns (internal/language's matcher);
- a date's and a time's numbers are `float64`, as decoded JSON (the Bookings lesson); a quantity is `int` and a price named `*int64`, written to JSON exactly as the TypeScript's;
- `Intent.Items` and `SlotIDs`: nil is "not said", an empty slice is "said, none" (`items: []` stays `items: []`).

## A date and a time from a model (23 Nov 2026)

`coerceIntent` copied a `date` or `time` of any shape until 23 Nov 2026. Both runtimes now refuse one that is not of the shapes dates.ts makes: the TypeScript asks
`isDatePhrase`/`isTimePhrase` (modules/language/dates.ts), Go asks their twins `language.IsDatePhrase`/`IsTimePhrase` (internal/language/phrase_shape.go), the checks that were
Bookings' own. The coerce vectors carry hostile dates and times with the TypeScript's answers; `TestCoerceDateShape` adds a few by hand.

## The reading the router is given

`Reading{C: ctx}` is the `understanding.Reading[Intent]`: `Rules` = ParseIntent, `Sure` = rulesAreSure (a trick or any kind but "unknown"), `Coerce` = CoerceIntent, `Shape` =
toIntentShape (kind, language, price, trick; nothing else a model says passes), `Prompt` and `Schema` as generated (they name nothing of the shop), `Decision` = one question
(what the customer wants, "other" is "unknown"; below the threshold nothing is read; the rules' language, price, items, day, time and way win), `Merge` = the model's reading as
it is (the TypeScript has no merge). `createOrdersRouter` and `createOrdersModelParser` are wiring over `internal/understanding`, done by the Orders runtime.
