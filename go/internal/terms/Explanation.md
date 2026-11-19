# terms (Go twin of modules/terms)

What it is: the shop's one-page terms in four languages and what it takes to agree to them on WhatsApp. `terms.go` (file check, text, digest, the two word patterns), `reader.go` (follows `client/terms.json`), `owner.go` (the owner's side: "terms" sends them with an "I agree" button, "I agree" records the agreement), `words.json` (generated).

## The words are generated, never typed

`go/scripts/vectors/terms.ts` calls the real `termsText()` and `TERMS_WORDS` with sentinel values and turns the sentinels into slots (`{shop}`, `{partner}`, `{phone}`, `{monthly}`, `{setup}`, `{v}`), writing `words.json`, which Go embeds and only fills (in one pass, so a shop called `{partner}` is not expanded twice). It also holds the TypeScript's constants and the two regular expressions that read "terms" and "I agree": `REQUEST` and `AGREE` are private constants of `terms.ts`, so the generator reads their literal from the source text (and fails loudly if the declaration changes shape), and checks the read patterns against the TypeScript functions on a corpus before writing. The Go patterns run through `language.Regex` (JavaScript `\s`, `iu` flags). `node go/scripts/gen_guard_vectors.ts --check` fails when `words.json` is out of date with the TypeScript.

## Proof

Vectors (`testdata/terms-vectors.json`): text and digest for 5 files x 8 shop names x 4 languages (names with braces, `$&`, quotes, newlines, emoji, an empty name), `readTermsFile` on 43 JSON inputs (exponent forms, `1e400`, UTF-16 length limits with emoji, control characters, Unicode spaces, extra and repeated members), the two patterns on 68 phrases (case folding with `ſ` and the Kelvin sign, no-break and ideographic spaces, a BOM, danda), and the owner's side run through 27 scripted conversations in all four languages (what was sent, in order, and what was recorded): typed and button agreements, stale and short digests, no buttons, each send failing, terms changed between asking and agreeing.

## Decisions and differences

- `Messaging` and `Record` are small interfaces here (`SendText`, optional `SendInteractive`, `Entries`) so the three runtimes pass whatever they have; this package imports neither messaging nor record.
- For a language the terms do not exist in, TypeScript throws (no row in its table); `HandleOwner` returns false and sends nothing. The owner's language is always one of the four.
- The reader compares the modified time in nanoseconds (JavaScript: a float of milliseconds). Otherwise it is the same state machine: a file that does not check is remembered as off until its time changes; any failure to stat, read or parse forgets the time.
- A price is an integer in Go. `-0` in a file reads as 0 (JavaScript keeps `-0`).
