# internal/directory: left out, and why

* **The decision model ("System One") of the buyer's assistant.** `directoryConfig` (`bundle/generate/configs.ts`) never writes a `systemOne` block, so the deployed service cannot reach it. A
  config that carries one is read and the block ignored (the language model is used). Needs `internal/understanding` (another stream) to be built once, not twice.
* **The model-written line over the results** (`writeLine`, `groundedProblem`, which need the talk-check) is a hook the service never wires; the template line is the only line.
* **The "anthropic" model wire.** Only the openai wire is spoken (as in the shops' Go runtime); a directory whose model speaks the other logs why and runs with the assistant off. The model
  Guard in front speaks the openai wire for the providers the deployer uses.
* **Dates JavaScript reads loosely** (below): since the join with `language.ParseJSDate` the Go reader also takes a lower-case t or z, a space for the T and an offset without its colon, as V8
  does; RFC 1123 and the other legacy forms are still not read.
* **`rebuildIndex`** (throwing the derived tables away and making them again from the kept feeds): no service path calls it.
* **Dates JavaScript reads loosely.** `Date.parse` of an RFC 1123 date (or another legacy form) is not read: an answer so dated is "not from just now" and a `confirmed` so dated is ignored.
  Shops write ISO dates (specs), so only a hostile or broken shop sees the difference.
* **Internationalised host names** (a pages domain in Unicode or punycode) are refused by the address reader; the directory's own pages domains are ASCII.
* **A lone surrogate in a feed's text.** A feed whose name (or any text) holds `\ud800` as a JSON escape is refused by the TypeScript reader (`isWellFormed`); Go's JSON decoder reads the
  escape as U+FFFD, so the Go reader keeps the text with a replacement character. Only a hostile shop writes one; seeing it would need a JSON reader of our own
  (`testdata/feeds.json.gz` "lone surrogate name" is skipped for this reason).
* **The shops' Go cost of cached input tokens.** `understanding.Answer` now carries `CachedTokens` (the directory prices them at the cached rate, as rates.ts does), but the shops' `Model.Cost`
  still prices every input token at the full rate, where the TypeScript runtime prices the cached part at the cached rate. A one-line change with its own test; left for the shop runtime's
  owner (it changes what a shop is charged).
