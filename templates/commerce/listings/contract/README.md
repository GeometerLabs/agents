# The listings-only runtime contract

A suite that describes what a listings-only shop's runtime does **as the outside sees it**. Every test makes a shop's folder in a temp directory exactly as the deployer does, starts
the shop as a **separate process** on a free port and talks to it **only over HTTP**. The shop is the Go runtime (go/cmd/listings, go/cmd/listings-shared). Until 19 Nov 2026 the
suite also ran the TypeScript runtime (`LISTINGS_IMPL=ts`) and compared the two side by side; that runtime was deleted (decision 61, wave 1b) after its answers were recorded as
GOLDEN answers (below), so the Go shop is still held to what the TypeScript said.

```
cd go && go build -o bin/listings ./cmd/listings && go build -o bin/listings-shared ./cmd/listings-shared && cd ..
node --test --test-concurrency=1 templates/commerce/listings/contract/      # 190 tests (LISTINGS_GO_BIN, LISTINGS_SHARED_GO_BIN name other binaries)
```

Without a binary every test is skipped and says why (harness.ts `SKIP`); words-fresh.test.ts needs none.

* `harness.ts` writes the folder (settings.json, runtime.json, pathway.lock, owner-link.json, pages.json, owner-grants.json; secrets internal_token, channel_token, record_key), starts
  the Go binary (`--client <folder>`, the token files named in its environment), and has a fake OpenAI-compatible model server.
* `listings.contract.test.ts` covers: `/healthz` `/readyz` `/status`; the token refusals (401) on every kind of route; the public read and the offer; the owner's listing page data and
  every listing op (create, edit, confirm, sold, remove, the switch and place) with the rules' refusals as 422 and a `why`; photos (cleaned of EXIF, named by their bytes);
  the signed feed, the signed check answer, the signed Agent Card and the "feed changed" notice, **verified with the TypeScript signing module** so an implementation must write
  byte-identical canonical JSON (RFC 8785) signed with Ed25519; the owner's passkey set-up and sign-in with the soft authenticator (ES256 and EdDSA), sessions and sign-out; a listing
  drafted through the fake model under the budget (the day's cap and the month's cap each stop it; what the model makes up is refused); and the store surviving a restart, with the
  SQLite file's format.
* `owner-control.contract.test.ts` covers who controls the owner's sign-in (bundle/Explanation.md "Who controls the owner's sign-in"), rule by rule and each attack the security
  review proved, through HTTP and the files the deployer writes (owner-grants.json, owner-reset.json, owner-sessions.json, settings.json, runtime.json). Its 48-hour, one-day and
  15-minute rules run on the TEST clock: `makeShop({clock: true})` starts the shop with `GEOMETER_TEST=1 GEOMETER_TEST_CLOCK_FILE=<file>` and `shop.advance(ms)` moves it
  (modules/runtime/test-clock.ts, go/internal/testclock: honoured only for a "fakes" shop; a live shop refuses to start with it). Its push cases (the lock ends the link's
  subscription, only a phone subscribes after it, removing a phone ends its alerts; and every alert, opened by a soft browser from what a fake push Guard was sent, is
  the words of the TypeScript functions in modules/channels (owner-phones.ts, owner-signin.ts, which the Bookings runtime still uses) in the owner's language).
* `cross-restart.test.ts` stops and starts the shop **on one folder** (the store, the shop's key, passkeys and sessions, the owner-control state: the lock, a request, own codes, a
  removed phone, the cool-down after a cancel), and holds the schema of agent.db, owner-access.sqlite and push.sqlite to the TypeScript's (a golden answer). Until 19 Nov 2026 it
  ran the TypeScript and Go runtimes in turn on the folder, both ways; the last such run passed before the TypeScript was deleted. No TypeScript-written folder is kept as a fixture,
  because the store holds the shop's private signing key.

* `routes.contract.test.ts` (the owner's limits page and the deployer's limit-changes, "Get my shop's file", web push through a fake push Guard, `push-harness.ts`, both across
  restarts), `stock.contract.test.ts` (with the saved stock state after three starts as a golden answer), `assistant.contract.test.ts` (the owner's talk-and-cards page; fixed
  scripts in four languages compared line for line with the golden answers; cards and notes across restarts), `unicode.contract.test.ts`, `rates.contract.test.ts`,
  `restored.contract.test.ts` and `shared.contract.test.ts` (the shared process, `shared-harness.ts`) cover the rest of a listings shop; `words-fresh.test.ts` fails when the Go
  runtime's packed words (go/scripts/gen_words.ts) are stale.
* `models.contract.test.ts` covers the owner's words no rule reads: the router's decision model (a fake System One server, `startFakeDecision`) and language model, then the
  owner's talk with its checks, with every kind of untrusted answer the fakes can give (`rawReply`, `statusReply`, `slowReply`: malformed JSON, an HTTP error, a model too slow
  for its timeout; wrong types, extra members) and the day's and month's caps; `morning.contract.test.ts` covers the owner's morning line (push on, on the TEST clock: a failed
  send tried again after an hour, the next day's line, the four-hour cut-off, silent with nothing to say, never in the licence's final stop) and voice as a listings shop has
  it (off). Both compare what the shop did with the golden answers, line for line.
* `differential.test.ts` gives the shop fixed requests and compares the answers whole with the golden ones: the owner's form (whitespace, rounding, UTF-16 lengths), the place, the
  feed, and which of 22 model drafts the grounding checks let through.
* `measure.ts` and `measure-shared.ts` are not tests: they print cold start, resident memory and request latency of the Go shop and the Go shared process.

A test is skipped only when what it needs is not there, and says so: the Go binaries, and the morning-question cases of assistant.contract.test.ts in the first 20 minutes after
midnight in India (the shop's morning hour would fall on yesterday).

## The golden answers

`golden.ts` and `golden/<test file>.json` (one file per test file, gzipped when over 200 KB; keys are the names the tests give). A test wraps what it observes in
`golden(name, run)`: it runs `run` with every shop it makes on the TEST clock at the instant the answer was recorded (harness.ts `setGoldenClock`; the owner's link and the setup
grant are dated in that time too), normalizes what `run` returned and compares it whole with the recording. A name that is not recorded fails; it is never skipped. Masked as
differing from run to run: signatures, ISO instants and epoch-millisecond numbers; the tests keep their own masks for random ids (an ask's id, a message id). Days, weekdays and
dates are NOT masked: the clock makes them the recorded ones, so "next Tuesday", the month's "back on" date and the morning line's day are checked as the TypeScript said them.

They were recorded on 19 Nov 2026 from the TypeScript runtime at agents b253982e (`impl: "ts"` in each file; 49 answers in models, morning, assistant, differential, stock and
cross-restart), recorded a second time and compared (identical after normalization), and recorded once more with the shop 37 days and 7 hours earlier (`LISTINGS_GOLDEN_SHIFT`:
another month, weekday and time of day); the Go shop matched all three.

To record again after an intended change to what a shop says or saves, with the Go runtime, and read the difference before committing it:

```
LISTINGS_GOLDEN=write node --test --test-concurrency=1 templates/commerce/listings/contract/<file>     # starts the file's golden JSON empty
LISTINGS_GOLDEN=write LISTINGS_GOLDEN_DIR=/some/scratch node --test ...                                 # a second recording elsewhere, to diff with the first
```

A recording is refused within 40 minutes of midnight in India (the run must not cross into another day), and a name used twice in one file is refused.

## Where the TypeScript-against-Go checks went (19 Nov 2026)

| was | now |
|---|---|
| models: `both()` ran each script on a TypeScript and a Go shop | one shop per script, its talk, record lines, AI counts and model calls against golden/models.contract.json (26 answers) |
| morning: the line in four languages, the test-clock day, silent and stopped, voice off, on both | golden/morning.contract.json (7 answers) |
| assistant: commands and drafts in four languages, refusals and caps, budget notices, memory, the money questions, on both | golden/assistant.contract.json (12 answers); the card digests are in those answers |
| assistant: a card or a note made by one runtime and answered by the other (4 + 1 tests) | the card, the voided card and the notes across restarts (2 + 1 tests) |
| stock: TypeScript drafted the listing; the two runtimes in turn (2 tests) | the shop drafts it; three starts on one folder (1 test), the saved stock state against a golden answer |
| routes: the owner's file and push across a change of runtime (2 + 2 tests) | across restarts (1 + 1 tests) |
| differential: both runtimes given the same requests | golden/differential.json (2 answers) |
| cross-restart: TypeScript and Go in turn, both ways (2 + 2 tests); the same schema from both | restarts (1 + 1 tests); the schema of agent.db, owner-access.sqlite and push.sqlite against golden/cross-restart.json |
| shared: every scenario on the TypeScript and the Go process | the Go process (each scenario asserts on its own process; nothing was compared) |

The count went from 203 (TypeScript, with the Go binaries) to 190: the seven turn-taking pairs above became one restart test each (196), and the six shared-process scenarios
no longer run a second time on the TypeScript process (190).

**No runtime process outlives a run.** Every process the harnesses start goes through `children.ts`: its own process group, stopped at the end of every test, killed on exit and on
SIGINT, SIGTERM or SIGHUP, and a process still alive when the run ends fails the run and is named. Only a SIGKILL of the test process itself is beyond it.
