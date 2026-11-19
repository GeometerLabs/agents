# internal/report and internal/qr: what was left, and why

* **`report/keys.ts`** (makes a key pair, refuses a folder inside a git work tree): only a command line uses it; the shop's runtime never makes keys. Not ported.
* **`trustedKeyId`** (sign.ts, reads a public-key file for `--trust-key`) and **`cli.ts`**: command-line only. Not ported; `VerifyEnvelopeText` takes the key ids already resolved.
* **`WHAT_THIS_CHECKS_REVIEW`** (what-this-checks.ts, which language still waits for a native reader): data for the papers' tests, not for a page. Not carried.
* **The send-once intent queue** (send-once.ts `queueSend`, `runSendOnce` and the rest): Stock orders' purchase orders. Only `RETRY_AFTER_MS`, `MAX_TRIES` and `nothingWasSent`
  are ported here (sendonce.go). The queue belongs to the Stock orders wave.
* **The Bookings adapter of `Messaging` and `accounting.Record`**: written in `internal/bookings/books.go` (`Books.ReportMessaging`, `Books.Record`, with the messaging errors turned into this package's faults).

## Where Go and Node can still differ

* **Grapheme clusters.** A new Unicode version in Go (the `unicode` tables: Extend, SpacingMark, Control) or in Node's ICU changes the cut for newly assigned code points until
  `scripts/gen_report_words.ts` is run again and Go is upgraded; `words-fresh` names the generated tables, not Go's own. The test compares Go with Node on every code point
  after and before "a" and on pairs, triples and strings, so a difference shows up in the test, not silently. A string with invalid UTF-8 (JavaScript's lone surrogate) cannot be
  compared with Node: Go cuts each bad byte as a cluster of its own, `FitText` drops them, `EncodeSummary` refuses them.
* **`\s`, `trim`.** The JavaScript sets are `language.IsJSSpace` / `TrimJS`. `U+0085` is not whitespace in JavaScript and is removed as a control character by `FitText`.
* **`VerifyEnvelopeText` on text that is not JSON** carries Go's parser message in the first check's detail, V8's in the TypeScript (the verdict and the other checks are the same).
  A JSON string with a lone surrogate escape reads as U+FFFD in Go, so such a file is refused as "not in canonical form" where the TypeScript could accept it.
* **A non-string where a string is expected** in a signature's fields (an array of one string, which JavaScript's regular expression would read as that string): Go refuses it.
* **`CanonicalJSON`** panics on a struct (a programming error): build `map[string]any`. A key whose value is undefined is "null" in TypeScript; Go has no undefined.
* **Integers past 2^53** are rounded to the double the TypeScript would hold before they are written; `SettledByWordOf` counts an amount past 2^53 paise as missing.
* **`BannedIn`**: Go's `(?i)` folds U+017F and U+212A to "s" and "k", which JavaScript's non-unicode `/i` does not.
* **PNG files** from `qr.Png` decode to the same pixels as the TypeScript's but are not the same bytes (Go's deflate against zlib's); nothing compares PNG bytes.
* **`SealWords.ScanSummary`**: an empty string means "left out" (TypeScript's `??` also keeps an empty string).
* **`SettledWho`**: a cut inside a surrogate pair drops the half character (JavaScript leaves a lone surrogate).
* **`notSpacingMark`** (graphemes.go) is typed from the every-code-point test's output (31 spacing marks Node's ICU still treats as letters), not generated. A new Unicode version that changes
  that list makes the test fail; the fix is then to add the range, or to generate it in `gen_report_words.ts` from `\p{Mc}` and the probe.
* **A non-string `keyId`** in a signature (`sign.ts` marks the file signed and fails the key-id check): Go fails the "right fields" check instead. Both refuse the file.

## TypeScript findings (not changed)

* `summary.ts fitText`: the whitespace runs are folded before the zero-width and direction characters are removed, so "a ​ b" becomes "a  b" (two spaces); `encodeSummary` then refuses
  the text, `summaryFor` returns undefined and that paper silently gets the older #digest link. The Go port copies this on purpose (the vectors have the case).
* `text.ts settledWho`: `who.slice(0, 39)` can cut inside a surrogate pair and leave half an emoji in a printed paper.
