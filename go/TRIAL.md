# The trial: a listings-only shop's runtime in Go

Question: can the runtime of the smallest shop kind (a listings-only shop) be written in Go, and what does it cost and save? Decision 61 (`docs` repo `plans/next-phase.md` 1c) makes Go the
language for code that runs inside a shop **if this trial passes**. This file is the evidence. Date of the trial: 18 Nov 2026, one sitting, one AI helper, on one laptop.

## The pass rules, and how it came out

| rule | result | the honest reading |
| --- | --- | --- |
| The Go shop passes the contract, and the contract passes against TypeScript | **Yes, with six tests skipped for Go.** TypeScript: 41 of 41. Go: 35 pass, 0 fail, **6 skipped with their reason** | the 35 are everything a Go shop is built to do. The 6 are routes a TypeScript listings shop also answers and the Go runtime does not: the owner's talk-and-cards page (and with it the cards by which an owner shows a draft), web push, the owner's limits page, the owner's Stock page, **"Get my shop's file"** (`owner-file`, the "leave with your shop" route) and the deployer's `/internal/limit-changes`. So this is a pass of the contract for the part that was ported, **not a drop-in replacement of the TypeScript runtime**: see "Left out" |
| 30 MB or less idle | **Yes.** 18.5 MB after start, 20.3 MB after 50 warm-up requests | with 200 listings in the store it is 28.2 MB, and 29.2 MB after 1,200 more requests: it is under the rule but with no room. TypeScript's same single shop is 130 MB (see the table) |
| Built within the time box, no more fix rounds than the TypeScript streams needed | **2 fix rounds** against the contract, plus 1 run of the differential test that failed and was resolved without a Go change (the lead compares with the TypeScript streams' count) | listed below; neither Go change was a design problem. Roughly an hour and ten minutes by the clock (it was first read about ten minutes in; the start is an estimate) |
| The demo has a working path | **Yes**: keep the demo in TypeScript, held to the contract; a Go demo needs TinyGo and a reflection-free state codec (below) | no TinyGo was downloaded |

## The contract

`templates/commerce/listings/contract/`: starts the shop as a **separate process** in a temp folder written as the deployer writes it, and talks to it only over HTTP. `LISTINGS_IMPL=ts|go` (until 19 Nov 2026; the contract runs Go only since the TypeScript runtime was deleted)
picks the runtime. It covers `/healthz` `/readyz` `/status`, the token refusals (401), the public read and the offer, the owner's listing ops with the rules' refusals (422 and a `why`),
photos, the signed feed, the signed check answer, the Agent Card and the feed notice (all verified with the **TypeScript** signing module, so Go must write byte-identical RFC 8785 JSON
signed with Ed25519), the owner's passkey set-up and sign-in with the soft authenticator (ES256 and EdDSA), sessions, a listing drafted through a fake OpenAI-compatible model server
with the day's cap and the month's cap each stopping it, and the store surviving a restart. Three more files go beyond the brief:

* `cross-restart.test.ts`: TypeScript and Go **take turns on one folder**, both orders. What one wrote (listings, a photo, the shop's key, a passkey, a session) the other reads and uses.
  And the two runtimes make the same files: `agent.db` and `owner-access.sqlite` have identical `sqlite_master` text and `PRAGMA user_version` (5).
* `differential.test.ts`: the same 14 owner ops and 21 model drafts given to both, answers compared. No difference in the ops or in the 21 grounding cases. One phrase ("something
  nice") is left out of the comparison and is a real difference, "Left out" 3.
* `measure.ts`: the numbers below.

While making the contract pass against TypeScript (it must pass there first) I corrected the contract, not the runtime, nine times: my expectations were wrong (an id with an underscore, a
health word the owner typed themselves is allowed, the feed's place comes from the owner's switch not settings.json, an answer is signed without its key, a draft's text is kept on edit,
the budget summary's shape, the record's digest is keyed `k-...`, the snapshot keeps `assistant.listings` inside its shape and splits only the lists directly under `assistant`, and a restart
check that read the record after a later sign-in). **No TypeScript bug was found.**

### Fix rounds (a round is a run of the contract that failed and led to a change)

| # | the run | what failed | the change |
| --- | --- | --- | --- |
| 1 | first run against Go | all 30: the process died at start with `regexp: invalid repeat count {16,1400}` (RE2 allows at most 1000) | the 16 to 1400 length of a credential id is checked in code, the pattern says only which characters |
| 2 | second run | 1 of 30: the feed notice answered 204 where it must send one | `now - math.MinInt64` overflows in 64 bits (TypeScript starts "no notice delivered" at minus infinity); a zero "delivered at" means none |
| | third run | 30 of 30. The cross-restart tests (2) and the schema comparison passed first time | |
| (d) | the differential test, first run | its grounding test showed 3 phrases where the two runtimes differed | **no Go change.** I first took them for a scope difference and wrote that down; a reviewer asked me to check, and in fresh shops two of the three agree. They differed only because the phrase before them had put the TypeScript shop's model on a 5-minute pause (a failed talk call, `ai-state.ts`). The test now keeps the two phrases in the comparison and leaves out the one that caused the pause |

So: **2 fixes to Go**, and 1 failing run of an extra test that ended in a change to the test. If the lead counts a failing run of an extra test as a round, it is 3.

One more kind of round, not counted: the first `go build` failed to compile (a name used twice); fixed at once.

## Measurements

Same laptop (macOS, Apple silicon), the same kind of shop folder, one runtime at a time, `ps -o rss=` for memory, Node's `fetch` over one connection for the requests (the client costs the
same on both sides). TypeScript is Node 26.10 running `templates/commerce/listings/server/main.ts` (**one shop, one process**, as `main.ts` runs it alone). Go is `go/bin/listings`.
One run each (the cold starts are five runs). `scripts` are in `contract/measure.ts`.

| | TypeScript (Node 26) | Go 1.27 |
| --- | --- | --- |
| idle RSS after start | 130.4 MB | **18.5 MB** |
| RSS after 50 warm-up requests (feed, check, owner list) | 131.6 MB | **20.3 MB** |
| RSS with 200 listings in the store (50 live, 150 sold) | 142.8 MB | **28.2 MB** |
| RSS after 1,200 more requests (500 feed, 500 check, 200 owner list) | 145.4 MB | 29.2 MB |
| cold start, fresh folder (spawn to `/healthz`), median of 5 | 267 ms (266 to 276) | **54 ms** (54 to 64) |
| feed request (50 items, 16,002 bytes), p50 / p95 of 500 | **0.77 / 1.19 ms** | 1.27 / 1.69 ms |
| check request (3 ids), p50 / p95 of 500 | 0.41 / 0.54 ms | **0.30 / 0.52 ms** |
| owner list, p50 / p95 of 200 | 0.39 / 0.47 ms | **0.25 / 0.39 ms** |
| what is shipped | the `node` executable, 147 MB, and the TypeScript source: 355 non-test files, 3.9 MB, in `modules/` and the template | one binary, 20.6 MB (14.1 MB with `-ldflags "-s -w"`) |
| build | none (types are stripped as the file loads) | after `go clean -cache`: **7.7 s** wall (34 s of CPU), timed inside the heat lock; a one-file change: 0.5 s |
| lines of code | the TypeScript files the port was read from: 6.4k lines (comments included), of which only parts apply to a listings shop | 7.4k lines, comments included (466 are whole-line comments, and there are more at the ends of lines) |

Notes on the numbers:

* **The comparison that matters in production is not this one.** The TypeScript runtime does not run one shop in a process there: `shared-main.ts` runs hundreds in four worker threads (the
  template README: about 33 MB a worker, so a few MB a shop). The Go runtime in this trial runs **one shop per process** at 18.5 MB idle. A hundred shops would be about 1.8 GB as Go
  processes and about 130 MB as the TypeScript pool. The saving is real for a shop alone and for a single-shop container; for the free shared server it is the other way round, until
  the Go runtime holds many shops in one process (goroutines, one SQLite file each). I did not build or measure that.
* The 200 listings cost Go 8 MB (SQLite's page cache and the garbage of 200 steps); setting `GOGC` to 50 or 25 changed nothing. TypeScript's cost was 11 MB.
* Go's feed is slower than TypeScript's at p50 (it builds, canonicalises and signs on every request, as TypeScript does; V8 is quicker at the string work). Both are about a millisecond.
* The clean build starts from an empty build cache (`go clean -cache`), not an empty module cache: the three modules were downloaded once before.

## What was built (the Go code map is in README.md)

The runtime of a listings-only shop **as the shop's front, the directory and the inbox see it**: the same folder and token files; the same SQLite file (the migrations copied word for word,
the snapshot in pieces, the record with its keyed digests, the photos, the shop's own key) and the same `owner-access.sqlite`; the owner's listing ops with the same rules (protected
animals, health words, limits, prices in paise, drafts, freshness); photos cleaned of EXIF and XMP and named by their own bytes; the signed feed, check answer, notice and Agent Card;
the owner's passkeys (go-webauthn), sessions and sign-out; the draft through a model under the budget; the status.

The words shown to people: this runtime returns none. The rules answer with machine words (`why: "protected_animal"`), and the owner's page, the refusals in four languages and the
messages are the front's and the panel's, which stay TypeScript. The one table of words the runtime does hold, the four-language claim words that check what a model wrote, is **generated**
from the TypeScript lists (`scripts/gen_claimwords.py` reads `talk-check.ts`); nothing was retyped. The protected-animal, health and number words (`listings.ts`, `listing-draft.ts`) are
copied by hand into Go, in the same four languages, and the differential test compares their behaviour.

## Left out of the Go runtime, and why

1. **(Ported 18 Nov, wave 1a: GET owner, owner_action, a draft makes a card, the beat's expiry and morning question, the budget notices; the owner's memory, the router's models and the owner-talk model are NOT: see `internal/assistant` and the report of the port. The text below is what the gap was.)** **The owner's talk-and-cards page** (`GET /internal/channel/owner`, `owner_action`). It is the whole assistant's view: cards, the talk list, notes and memory, the morning "Still have it?"
   question, the budget notices, undo. It is about 4.7k lines of TypeScript plus its words, and it is not "the runtime of a listings-only shop" so much as the shop's assistant. **Without
   it a draft the Go runtime makes cannot be published by the owner** (the "Show it" tap is a card). The Go runtime does draft, check and save it as state `draft`; the owner can edit or
   remove it, and a shop that goes back to the TypeScript runtime has the draft in its list. This is the largest gap and the first thing the lead should weigh.
2. **Routes a TypeScript listings shop answers and Go does not** (found by asking a TypeScript shop; the six TypeScript-only tests in the contract): web push (`push`: the key, the owner's
   phones), the owner's limits page (`owner-limits`) and the deployer's `/internal/limit-changes`, the owner's Stock page (`owner-stock`), and **"Get my shop's file" (`owner-file`)**:
   without it the owner cannot take their shop's file out of the Go runtime, which is the heart of "leave with your shop" (the deployer's own backup and export read the SQLite file and
   still work). `/status` reports `alertPhones: 0`, which is right only while the shop has no push service (TypeScript counts the owner's phones when it has one). Go answers 404 to
   these, 400 to `owner_action` and to every event kind but the two it takes, and 400 to the inbox's `POST /internal/events`. The customer-side routes (chat, voice, documents, parent,
   material, offer-with-days) are not what a listings front calls: the front hides the chat for this kind, and the TypeScript shop answers 404 to voice and documents too.
3. **(Ported 18 Nov for the rule reader; the owner-talk model and the router's models are not.)** **The assistant's reading of the owner's words.** The TypeScript runtime answers words that are no listing at all ("something nice") with the owner-talk model; Go asks nothing. The
   differential found this on one phrase. What I did **not** port and did **not** test is the other half of that reading, `readOwnerRules`, which keeps the owner's commands (undo, help,
   cancel, a refund, closing a day) from being taken as a listing when they also say "on my page". Go takes any words with a listing cue (or a photo waiting) as a listing, so an owner
   command containing "for sale" would be drafted. I have no case that shows it, one way or the other.
4. **Stock counting** (`modules/stock`): Go reads a counted listing's count (so the public read leaves out a counted listing at 0, and shows the count) and never changes it.
5. **A price list**: every model call is counted "unpriced" (10 paise against the budget, `DEFAULT_UNPRICED_CALL_MICRO_INR`). The TypeScript runtime prices a call from the dated rate
   tables (`modules/understanding/rates/*.json`) and a builder's own rate. For a shop on a real provider the Go budget would run out sooner than the TypeScript budget would.
6. **The "anthropic" model wire**, the decision model, voice. Only the OpenAI-compatible wire is spoken (it is what the model Guard in front of a shop speaks).
7. **Restoring from a nightly snapshot** (`restored.ts`: the id counters move on and the record says so), the licence's final stop, the monthly report and the morning line. A shop restored
   from a backup and started on Go would not skip its listing ids.
8. **The shared process** (`shared.ts`): the router, the worker pool, the watchdog, quarantine, "back soon", `/shared/shops`. One shop per process only.
9. **Unicode normalisation.** TypeScript puts words in NFC (and the claim lists in NFD) before it compares them. Go's standard library cannot; it lives in `golang.org/x/text/unicode/norm`,
   which this trial was **not approved to add**. Text is taken as typed (composed, in practice), and the eight precomposed Devanagari nukta letters (U+0958 to U+095F) are folded by hand. A phone that sends
   Malayalam or Kannada in decomposed form could be judged differently by the two runtimes. **Needs approval if the trial goes on: `golang.org/x/text`.**
10. **Unknown members of the typed parts are dropped.** The state is carried through raw only for the rest of `assistant` (cards, talk, notes, memory, stock). The parts Go models (each
    listing, the listings' shop block, `ai` and its budget) are read into typed structs; a member the TypeScript runtime adds to one of those later is lost when Go saves.
11. Small: the digest of an owner op in the record is made over Go's key order, so it differs from TypeScript's for the same op (the record's content, not any behaviour).

## What the port cost, as lessons

* **Regular expressions** were the main cost. TypeScript's word lists lean on look-behind and look-ahead to find a whole word in Indian scripts (`(?<![\p{L}\p{M}])...(?![\p{L}\p{M}])`);
  Go's `regexp` (RE2) has neither, no repeat counts over 1000, `\s` and `\b` that are ASCII only. Each list needed `findWord` (edge check by hand) and the claim lists were generated.
* **JavaScript's idea of text**: `.length` counts UTF-16 units (an 80-letter Malayalam title is checked in units), `\s` is Unicode-wide plus U+FEFF, `Math.round` rounds halves up.
* **64-bit overflow** (round 2) is a trap TypeScript does not have.
* **Passkeys**: go-webauthn replaced about 200 lines of our own CBOR, COSE and signature code (`webauthn.ts`), but wants a whole `PublicKeyCredential` (the front sends two members) and a
  COSE key (the store keeps a JWK, for compatibility), so the glue is 360 lines. The result is the same behaviour (ES256, EdDSA, counters, challenge, origin, user verification) on
  every contract test, first time.
* **SQLite** (`modernc.org/sqlite`) matched the file format without a conversion; the only care was the transaction mode (`_txlock=immediate`) and one connection.
* **Maps**: Go writes object keys sorted, TypeScript in insertion order. Both read either. Nothing in the contract depends on it.
* **Signing from the same value**: the signed body and the served body are made by one encoder (`signing.Marshal`), with HTML escaping off.

## The browser demo path (no TinyGo yet)

How the demo is built today: `scripts/build-demo.ts` (the streetlist.in/demo build) and `templates/commerce/bookings/scripts/build-web-demo.ts` take **the real agent's TypeScript** (`src/`, the
demo's own `demo/` and the shared `modules/` it imports), strip the types with Node's own `module.stripTypeScriptTypes`, change only the import file names, and replace the two Node
modules it uses (`node:fs`, `node:crypto`) with small stand-ins (`demo/web/shims/`). The result is plain ES modules that run **the agent on in-memory stand-ins in the visitor's page**: no
server, no store, no HTTP, no network (`bundle/test/hosted-demo.test.ts` checks that nothing shipped reads as a network call). There is no listings demo today; the three are Bookings,
Orders and Fees.

So the demo does not run the shop's HTTP runtime, its SQLite file or its passkeys at all. Two honest options:

1. **Keep the demo in TypeScript, against the contract (works today, recommended).** The demo runs the agent and `modules/listings` as it does now. The Go runtime changes nothing about it.
   What keeps the two from drifting is the contract and the differential tests: the rules exist twice (TypeScript for the front's pages and the demo, Go for the shop's runtime), so a rule
   change is made in both and the differential test is the guard. This costs a second copy of the listings rules; the contract was written to make that affordable.
2. **Compile the Go rules to the browser.** Only `internal/listings` (the rules, the feed, the draft checks) would go; the store, access, runtime and signing stay out. That needs **TinyGo**
   (or Go's own `GOOS=js GOARCH=wasm`, which is about 2.5 MB before the code) and a **reflection-free JSON** for the state: `internal/listings` reads and writes its state with
   `encoding/json` and struct tags, which TinyGo supports only in part. The state would need a hand-written encoder, or a code generator. The package already has no disk, network or
   clock (`Apply` takes the time), so the cut is clean. Not tried: TinyGo was not downloaded.

## What to look at next, if Go goes on

0. Be sure what "leave with your shop" needs: the `owner-file` route, and the file the deployer copies, both belong to the runtime's side.
1. Decide what the owner's talk-and-cards page is: ported, or kept in TypeScript with the Go runtime behind it (the front already talks to the runtime only over HTTP, so a TypeScript
   assistant service could sit beside the Go store; that is a design, not something I tried).
2. A multi-shop Go process (the TypeScript pool's job) before the free shared server is compared on memory.
3. Approval for `golang.org/x/text` (normalisation), and the price list.
4. Run the three-line check in CI: contract against both, cross-restart, differential.

## Wave 1a (19 Nov 2026): the Go listings runtime made complete

Wave 1a finishes the Go side of the listings-only shop so that wave 1b can delete the TypeScript it replaces. Built in four branches (stock; limits, file and push; the multi-shop host; the owner's talk-and-cards page) and merged here. The old "Left out" list above is the trial's; this section says what changed.

**Contract.** The six TypeScript-only stubs are gone, replaced by real cases that pass on both runtimes: `routes.contract.test.ts` (owner-limits, limit-changes, owner-file, push, with a fake push Guard), `stock.contract.test.ts`, `assistant.contract.test.ts` (cards, publish by tap, talk lines, rules, the same scripts run on both runtimes and compared line for line), `unicode.contract.test.ts`, `rates.contract.test.ts`, `restored.contract.test.ts`, `words-fresh.test.ts`, `shared.contract.test.ts` (the TypeScript shared process and the Go multi-shop process on the same scenarios). The whole directory passes on Go except one test that fails on both runtimes and is not ours: the `owner-access.sqlite` schema comparison in `cross-restart.test.ts` (main's owner-control tables; the owner-control port is another agent's branch).

**Ported:** owner talk-and-cards page (GET owner, `owner_action` card yes/no with the digest rule, a draft makes a card, publish by tap, "Still have it?", expiry and compaction on the beat, budget notices), `readOwnerRules` (so owner commands are never drafted as listings), leave-with-your-shop asks, owner-limits and `/internal/limit-changes` (a listings shop declares no limits), owner-stock with its writes and the Confirm restore, owner-file (byte-for-byte, used-file shared with TypeScript), web push (store in TypeScript's `push.sqlite`, VAPID, sender through the push Guard), the price list (embedded copy of the dated rate tables, kept equal by a test; builder rate), the restore note, Unicode normalisation (`golang.org/x/text/unicode/norm`: NFC in `plain`, NFD fold; the hand-folding is gone), words packed per language and unpacked on first use.

**Multi-shop process** (`go/internal/shared`, `go/cmd/listings-shared`): one process holds every shop of a server, same folder layout, routing, `/healthz` `/readyz` `/shared/shops` JSON (including `paused`/`pausedDetail`), back-soon with `x-back-soon: 1`. A panic in a shop's request, runner or sender is recovered at that goroutine and charged to the shop; strikes, quarantine and pause use `shared-pool.ts`'s numbers. A goroutine cannot be killed, so a stuck shop is contained by a 10 s request deadline (503 and a strike), a watchdog on the runner (60 s, longer than the TypeScript 10 s because the model call runs inside the step), and, for a repeat offender, a child process of the same binary started only after the in-process copy is proven to have released the store (otherwise the shop is "stranded", answers back-soon, and moves when the abandoned work ends). Not recoverable in Go, and so not contained: stack overflow, running out of memory, a concurrent map write, `os.Exit` in shop code; the supervisor restarts the process and nobody is charged. Set `STATE_DIR` or strike memory is kept in memory only.

**Measurements** (same laptop, one process at a time, TypeScript shared process with 4 worker threads, three requests per shop):

| shops | TS RSS after start / after requests | Go RSS after start / after requests | TS cold to all held | Go cold to all held |
| --- | --- | --- | --- | --- |
| 1 | 155 / 156 MB | 21 / 22 MB | 326 ms | 55 ms |
| 10 | 261 / 265 MB | 29 / 31 MB | 887 ms | 105 ms |
| 100 | 358 / 391 MB | 102 / 104 MB | 1,599 ms | 610 ms |

One Go shop alone (`measure.ts`): idle 20.1 MB (was 19.5), 22.9 MB after 50 requests, 29.6 MB with 200 listings; binary 23.0 MB (16.2 MB with `-ldflags "-s -w"`). The first owner message in a process costs about 4.7 MB once (compiling the rule regexes), not per shop. The packed words are 17 KB in total. The trial's "Go is slower at p50 on the feed" finding was not re-measured. The 30 MB rule for one shop now has almost no room (29.6 MB with 200 listings), and `collate` (x/text, used for TypeScript's `localeCompare` in the Stock page) adds about 1.7 MB to the binary.

**Not ported, so wave 1b cannot delete these TypeScript files yet:**
- the owner-talk model answer for words no rule reads (`talk-owner.ts`, `talk-prompt.ts`, `talk-run.ts`, `talk-check.ts`, `talk-types.ts`, `listingSources`, `language/check.ts`): unknown words get the "not understood" line;
- the router's decision and language models (`reading.ts`, `understanding.ts`, the model parts of `intents.ts`);
- memory writes (`notes.ts`, `words-memory.ts`, `modules/memory`): the page shows notes, but remember/notes/forget answer "doesn't handle that"; date phrases in a money question; voice; the morning line (`morning.ts`) and with it the licence's final stop, which in a listings shop only gates the morning line; first-step seeding of the Operator's town;
- the back-soon page uses a small inline stand-in for the front's stylesheet (the front reads the header and JSON);
- `limitChanges` compaction.
The TypeScript shared pool (`shared-pool.ts`, `shared-worker.ts`, `shared.ts`) is replaced by the Go host only once the deployer runs `listings-shared`.

**TypeScript findings (reported, not fixed):** `http.ts` passes the session's secret token (not its short id) to `recordAccess("file_taken")`, so the `owner_file_taken` record line holds a live session token (Go writes the short id; the contract has a `todo` for TypeScript); the Stock page's pre-check and the step disagree on a listing title over 60 units (200, then a blocked line); `start` accepts a stock id of a listing that does not exist; with no declared limits "limit" answers "I can tighten: ." with an empty list; `get my shop's file for sale` is drafted as a listing; the restore entry says ids moved on by 100,000 though a listings store has no counter; `status.ownerAccess.locked` makes one existing contract test fail on TypeScript at the base. Seams left for the owner-control agent: `PasskeySessions` (`routes.go`), `Runtime.PushOwner`, `Runtime.Push().DropUnbound` on the first passkey. *(Superseded by "Wave 1 merged" below: the file-taken token is fixed in TypeScript on main and the contract's `todo` is a real test; `locked` and the schema comparison pass; the three seams are connected, `PasskeySessions` by removing it.)*

## Wave 1 merged (19 Nov 2026): owner control and the complete listings shop, in one branch

The Go owner control (the gate, the Operator's 48-hour requests, Geometer's reset, the owner's phones and own codes, the number lock, the test clock) and wave 1a above were built on two
branches and are merged here, with main's fix to the `owner_file_taken` record line. Where the two met, part A's owner-control code was kept and part B's routes were adapted to it.

**Now complete on both runtimes, the same contract:**
- **Push honours owner control** (`owner.go`, under the owner lock): after the lock only a passkey session may subscribe, tied to its phone; the panel's owner link gets 403 for
  subscribe, unsubscribe and choice; the first passkey ends the subscriptions no phone holds; removing a phone ends its subscriptions; the phones page lists alerts and stops one
  (`stop_alert`, a passkey session only). The check and the subscription are one sequence under the lock, so a link's subscription cannot land after the first passkey's DropUnbound.
- **The alerts to the owner's phones** (a new phone, codes made, a phone removed, the Operator's request on the tick, an owner-number change on the tick) are TypeScript's words in
  the owner's language: `scripts/gen_words.ts` renders them from `owner-phones.ts` and `owner-signin.ts`, and the moment they carry (`dayAndTime`) is data taken from Intl's parts,
  checked on every month and hour; the contract opens each push with a soft browser and compares it with the TypeScript function in Malayalam, Kannada and Hindi. A push that
  cannot be queued fails the route, or the beat's step (its notice is then said again), as TypeScript's throw does. The packs hold Intl's output for the Node that ran the
  generator: a Node with another ICU may write the moment differently, and `words-fresh` then reports the packs stale (generate with the Node the shops run on).
- **The limits page's passkey check** asks the access package (the read-only reader of `owner-access.sqlite`, which skipped the store's reconcile, is gone); a store that cannot be
  read refuses. `/status` reports `locked` and the pending request from the owner control.
- **"Get my shop's file"** names the session by the short id of the same check that let it in, on both runtimes (the contract's `todo` is a real test now).
- **The contract harness** leaves no runtime process behind (`contract/children.ts`; a run fails if one is still alive at its end).

**Results** (19 Nov, one run each, through the heat lock): the whole contract folder, **172 of 172 on TypeScript (179 s) and 172 of 172 on Go (97 s), none skipped**;
the cross-runtime cases (cross-restart, differential, the owner's file and push across a change of runtime, the shared process) run inside both. No runtime process was left
running after either run. `go vet ./...` and `go test ./...` pass, and `go test -race` on `internal/access`, `internal/runtime` and `internal/shared` (unit tests only:
the runtime package has few), so the whole contract was also run against a `-race` build of `listings` with `GORACE=halt_on_error=1`: 172 of 172, no race. The two failures wave 1a
reported against TypeScript at its base (the `owner-access.sqlite` schema in `cross-restart.test.ts`, `/status ownerAccess.locked`) pass now: they were the owner control's.
Binaries: `listings` 23.3 MB (16.4 MB with `-ldflags "-s -w"`), `listings-shared` 23.8 MB (16.8 MB).

**Not ported (wave 1b cannot delete these TypeScript parts yet):** *(all ported since: see "The AI core ported" below)* the owner-talk model's answer for words no rule reads; the
router's decision and language models; memory writes (remember, notes, forget); the morning line and with it the licence's final stop; voice; date phrases in money questions
(flagged, not answered); first-step seeding of the Operator's town; `limitChanges` compaction.

## The AI core ported (19 Nov 2026): the owner's words read by models, the talk, memory, the morning line

Everything wave 1 listed as not ported is now Go, held to the same contract on both runtimes:

- **The `language` package** (`internal/language`): JavaScript's regular expressions matched as JavaScript matches them. RE2 has no look-behind or look-ahead, and the old way
  (consume the edge character) is wrong for `matchAll` and `replace` ("ten twenty" is two matches in JavaScript, one that way). `regex.go` splits a source at its top-level `|`, tries
  each alternative in JavaScript's order at each place, checks a leading `(?<!X)` by hand and puts a trailing `(?!X)` into the RE2 pattern as "not X, or the end" (so RE2 backtracks
  as JavaScript does), and refuses what it cannot copy. The patterns are not retyped: `scripts/gen_patterns.ts` takes each TypeScript RegExp's own `.source` and `.flags` (a few
  consts were exported for it, no behaviour change) and writes vectors by running them; `words-fresh` checks both. `rules.go`'s `plain`, `canon` and `wordRe` are gone: one
  implementation each, in `language` (wordRe's output comes generated).
- **Date phrases in money questions** (`language/dates.go`): findDatePhrase and resolveDate (next/this/plain weekday, a written date, the day after tomorrow), proved on 150 phrases at
  four instants against TypeScript (`testdata/rules-vectors.json`).
- **Memory writes** (`internal/memory`, `runtime/notes.go`): remember (undoable for a day), the list, forget, undo of a remember, the beat's end of notes and loss of closed notes'
  text; `assistant.memory` field for field, so notes move between the runtimes.
- **`limitChanges` on the beat**: the newest 30 settled kept (compactChanges), and a settled change marked told (limits-card.ts `unannounced`: a listings shop declares no limit,
  so nothing is said).
- **The Operator's place seeded** on the first step that reaches the agent (the beat, the owner's words, a card's tap), once, never over the owner's own.
- **The router** (`internal/understanding`): rules, then the System One decision model, then the language model, each only when the month's AI state allows (button mode, the
  decision model's breaker, fleet's cap, the shop's budget, the router's daily cap); every answer decoded to `any` and checked by hand (`ReadDecision`, `readOpenAI`, `Coerce`).
- **The owner's talk** (`assistant/talk.go`, `runtime/talk.go`): the owner's notes and public listings as sources, the TypeScript's prompt (rendered by gen_words.ts), the four checks
  an owner's turn has and the outgoing check (`language/check.go`), the fixed line when a check fails or the model does not answer, the fault pause, the day's notice once.
- **The morning line and the licence's final stop** (`runtime/morning.go`): with push on, once a day from the owner's morning hour for four hours, claimed in the record before the
  push and ended after, silent with nothing waiting, never in the final stop (client/licence.json, rules.ts `licenceNow`); on the contract's test clock a failed send is tried
  again an hour later, the next day has its own line, and nothing goes after the four hours. (The "unconfirmed" ending, for a process that died mid-send, is ported but not run
  by the contract: it needs a process killed between the claim and the push.)
- **Voice**: a listings shop has none; the two voice routes answer as TypeScript's do (method, the owner's credential, then "voice is not on").

**Results** (19 Nov, through the heat lock, one run each): the whole contract folder, **201 of 201 on TypeScript (241 s) and 201 of 201 on Go (159 s), none skipped** (172 before
this stream; the new cases compare a TypeScript shop and a Go shop line for line, so both runs start both). `go build`, `go vet` and `go test ./...` pass; the language package's
vectors (every generated pattern on a corpus, the dates at four instants, Redact) equal JavaScript's. The touched TypeScript modules' own unit tests pass (dates, check-links,
intents, intents-memory, talk-check, talk-flow, morning, understanding/talk). Binaries: `listings` 23.7 MB, `listings-shared` 24.2 MB.

**Not ported, and why (none of it is reachable in a listings-only shop):** a customer's talk and the claims checks only a customer's turn has (no customers); a note the talk
proposes (Remember / No buttons, which the owner's page does not have, so TypeScript never makes one there either); the outgoing check's moments (a booking's time, free times: no
source of a listings shop carries one); the "anthropic" model wire (the model Guard speaks "openai" for every provider the deployer uses, as before); the morning line's template
header and sticker (the push-only messaging sends words). `runtime.json`'s `decision` is checked for its provider, address and model; its other fields' ranges are TypeScript's to
refuse (the deployer writes them).

*(Fixed or answered in "go-w2-tsfix-22nov" below.)* **TypeScript findings (reported, not fixed):** `notes.ts` GOAL_WORDS ends `\b` after Devanagari/Malayalam/Kannada words ("लक्ष्य", "ലക്ഷ്യം", "ಗುರಿ"), and JavaScript's `\b` only
sees ASCII letters, so a goal written in those scripts is filed as a fact unless an ASCII letter follows; `historyText` cuts at 300 UTF-16 units and can leave a lone surrogate
(Go drops the half character); `COMPLETION` holds `बुक ചെയ്തു` (Devanagari and Malayalam mixed), carried as it is.

## Wave 1c (19 Nov 2026): the directory of local shops in Go

`cmd/directory` + `internal/directory` (6.0k lines of Go with the tests, 5.7k without; `internal/signing` gained the reading side, 146 lines) do what `bundle/services/directory.ts` does: read and
check the shops' signed feeds, keep the index (the TypeScript's own `directory.sqlite`, FTS5 with the same tokenizer through `modernc.org/sqlite`), ask the shops about the ten results,
the fair order, search, the pages in four languages, the MCP endpoint, the signed Agent Card, the buyer's assistant. Words, style sheet, tool definitions, card text, the assistant's prompt
and the Latin-fold tables are GENERATED from the TypeScript (`scripts/gen_directory.ts`); read `internal/directory/Explanation.md` and `Deferred.md`.

**The contract** (`modules/discovery/contract/`, README there): 34 tests, 34 pass on TypeScript and 34 pass on Go (`DIRECTORY_IMPL=ts|go`, one at a time under the heat lock). They include the
two that need both runtimes: `differential.test.ts` (the same requests over the same shops: every page state in four languages, the JSON, the MCP answers, the assistant's answers,
compared whole) and `cross-restart.test.ts` (TypeScript then Go then TypeScript on one folder: the index, the pins, a held key change, the key and so the card's key id). Unit tests with
vectors made from the TypeScript (`internal/directory/vectors_test.go`, 356 lines): the Latin fold, text helpers, the order and its hash, the address reader, dates, numbers, the buyer's
request, cleaning and the patterns, a model's typed answer. `go build ./... && go vet ./... && go test ./...` pass.

| 40 shops of 20 listings (800 items), measured with `contract/measure.ts` | TypeScript (Node 26) | Go 1.27 |
| --- | --- | --- |
| idle RSS, feeds read | 133.3 MB | **29.5 MB** |
| RSS after 200 searches / after 500 | 171.3 / 168.6 MB | **30.9 / 31.7 MB** |
| cold start, fresh folder (spawn to `/healthz`), median of 5 | 161 ms | **55 ms** |
| search (10 shops asked), p50 / p95 of 300 | **6.2 / 7.4 ms** | 14.0 / 15.1 ms |
| binary | `node` + 4.3k lines of TypeScript | 18.5 MB (one file) |

The Go search is slower because each search opens a connection to every shop it asks (the checker's client does not keep connections); not tuned.

**What the deployer switch will change** (not done: how the Go binaries reach a server is the owner's decision). In `bundle/generate/compose.ts` the `directory` block (`add("directory", node([...]))`):
the service becomes `goProgram(["/directory"], ...)` in the programs' image (the wave 1b `features.goImage`, which then also needs `directory` built into it: `go build -o bin/directory ./cmd/directory`); the
health check `healthWget(DIRECTORY_PORT, "/healthz")` becomes `healthGo("directory", DIRECTORY_PORT, "/healthz")` with the `health` subcommand (`internal/health` of the deploy-switch branch: `cmd/directory/main.go` takes it at the merge); the user stays `nodeUser`
but the image has no `/home/node`: the volume `directory-data` mounted at `/home/node` needs that folder, owned by that user, in the image (or the data folder moves); no `appVolume` mount (the program has its code inside); the environment
(`CONFIG`, `PORT`, `HOST`), the config file (`directoryConfig`, unchanged: the Go service reads the same JSON) and the networks (`pages`, `egress`, `assistant`) stay. The model's wire must be "openai"
(a server whose model speaks "anthropic" runs the directory with the assistant off and a line saying so). `docker exec <directory> node /app/bundle/services/directory.ts changes|accept` becomes `docker exec <directory> /directory changes|accept <page>`
(docs and `bundle/Explanation.md`).
**What the switch deletes**, in the same change: `bundle/services/directory.ts`; `modules/discovery/` except `words.ts` (the review sheet `bundle/panel/review.ts` still reads `DIRECTORY_WORDS` and
`DIRECTORY_SAMPLES`; and `gen_directory.ts` reads `words.ts`, `page.ts`, `mcp.ts`, `card.ts`, `assistant.ts`, `romanise.ts` to make the packed files: after the switch the generated files in
`go/internal/directory` become the source, the generator and `words-fresh.test.ts` go, and the review sheet reads the packed words, or `words.ts` stays as the words' source and is the one file kept);
`modules/discovery/test/` (10 files, 1,676 lines: each is a contract test or a Go unit test above); `bundle/test/directory-service.test.ts` and `directory-assistant.test.ts` (their compose and config
parts move to `go-runtime.test.ts`; their directory-behaviour parts are the contract); the `DIRECTORY_TICK_MS` line in nothing (it goes with the file). The contract keeps `modules/signing` (it signs the fake shops) and
`templates/commerce/listings/contract/children.ts`. What stays TypeScript and is not touched: the shops' own MCP endpoint (`modules/channels/mcp.ts`, `shop-card.ts`) and `modules/channels/look.ts` (the shops' pages).

**TypeScript findings** (nothing changed): a feed's `updated` is never judged for age; `lang=` on `/search` falls back silently, so the `lang must be en, hi, ml or kn` refusal exists only over MCP;
`rebuildIndex` has no caller; `Date.parse` of a date-time with no zone is local time (the container runs in UTC, so equal in production).
**Found while porting** (Go, fixed): a response with a second, differently spelled `Content-Length` is refused by Node's client (curl accepts it).

## Wave 1b, the deployer half (19 Nov 2026, `go-deploy-switch-19nov`)

The deployer now runs listings shops on the Go programs: the listings template is **0.2.0** and its `template.json` says `"runtime": "go"`. The server compiles the programs from its own checkout in the Go image
pinned by digest in `bundle/release.json` and runs them from a tiny `FROM scratch` image (`geo-go:<commit>`), so a shop container no longer carries Node. `listings` and `listings-shared` gained a `health <url>`
and a `get <url>` subcommand (`internal/health`) because that image has no shell, wget or `test`. The whole account, and the real build numbers, are in `bundle/Explanation.md` ("How the Go runtimes reach a
server") and `go/README.md`. **Not done in this stream:** the TypeScript listings runtime is still in the repository (kept versions run on it; the differential test needs it); the deletion follows the port
of the last AI parts. TypeScript finding: `bundle/deploy.ts` used `HOME_DIR` in the check "is a new listings shop's name already in the shared volume" without importing it, so the first deploy of a new
listings-only shop would have stopped on a ReferenceError; the check now asks the data volume itself (`sharedHasFolder`, `bundle/lib/listings-move.ts`) and the name is gone.

## Waves 1b and 1c finished (19 Nov 2026, `go-wave1b-finish-19nov`)

### The directory (wave 1c): switched, joined, deleted

**Deployer.** The `directory` service runs `/directory` from the programs' image (`GO_PROGRAMS` gained `directory`), with `/directory health` as its check, user 1000:1000, the same config,
networks and credential folder, no `/app`; its volume stays at `/home/node` (the image carries that folder owned by 1000:1000), so an existing server's index and key are read as they are. Its
environment is exactly `CONFIG`, `PORT`, `HOST` (pinned by a bundle test). A server with a pages domain and fleet always has the directory, so `deploy` makes (and `bringUp` checks) the image
there even with no Go shop. **Found while switching:** the scratch image had no certificate authorities, and the directory reads builders' feeds over https (Node carries its own list; Go reads
the system's), so every configured remote feed would have failed; the build now copies the pinned builder image's `/etc/ssl/certs/ca-certificates.crt` into the image. The person's commands are
`docker exec <directory> /directory changes|accept <shop page>` (`bundle/Explanation.md`, `bundle/Deferred.md`). **One real build** (19 Nov, this Mac, the pinned golang image and module cache already here, `GOPROXY=off`, the full-server settings): the three programs built, the certificate file copied
(182 KB), the image **45.9 MB** (was 32.7 MB with two programs; `directory` is 12.5 MB stripped); the directory started read-only, all capabilities dropped, as 1000:1000 on a fresh volume:
`/directory health` exit 0, `/directory changes` answered, and the volume's `directory/` folder, index and key (0600) belong to 1000:1000.

**Joined.** The directory's `AskJSON` is gone: `understanding.Model` is the one call (`Open` for a caller that read its own credential, `AskContext` for the caller's context; the defaults of each
use are options), now writing the body in model-llm.ts's member order without HTML escaping, the schema as given (the directory's raw JSON keeps its order) and reading cached input tokens
(model-llm.ts does). The directory's `redact` is `understanding.Redact` (vector-proven); its `CleanQuestion` stays the directory's (`clean.go`: the address patterns are only its). UTF-16
slicing with U+FFFD at a cut pair (three copies: directory, access, listings), `LowerJS`, `NFC`, TextDecoder's reading and `Date.parse` (access's and the directory's) are one each in
`internal/language/js.go`. Behaviour: the vectors and the contract pass unchanged; the directory now also reads the date forms V8 reads that its own copy refused (a lower-case t, a space
for the T, an offset without a colon), and a model reply with a member of the wrong type is read by hand as model-llm.ts reads it instead of failing struct decoding.

**Search speed.** The brief's guess (a new connection to every shop per search) was half of it: the fetcher now keeps connections (32 idle a host, 4 s, under the door's 5), but the
measurement did not move (13.9 ms). A probe showed a search with no match takes 0.4 ms and one of 800 candidates 13.8 ms with every check answered from memory: the time went into reading each
candidate with its own query, which database/sql over modernc compiles every time. The candidates are now read 500 to a query and the shop read is a prepared statement.

| 40 shops of 20 listings, `contract/measure.ts`, HEAVY_FAST, same machine and hour | Go before | Go after | TypeScript (last run) |
| --- | --- | --- | --- |
| search p50 / p95 of 300 | 13.9 / 14.7 ms | **6.3 / 6.7 ms** | 6.2 / 7.4 ms (wave 1c's figure; under background priority today TS 46.3 ms against Go 100.4 ms before) |
| idle RSS / after 500 searches | 29.5 / 32.0 MB | 28.9 / 32.8 MB | 133.3 / 168.6 MB |
| cold start, median of 5 | 54.9 ms | 54.9 ms | 161 ms |

**Deleted:** `bundle/services/directory.ts` and `modules/discovery/` but `words.ts` (the words' source for the generator and the review sheet) and `types.ts` (cut to the languages and kinds),
its ten unit-test files, `bundle/test/directory-service.test.ts` and `directory-assistant.test.ts`, `go/scripts/gen_directory_vectors.ts`: **4,327 lines of TypeScript** (plus 241 of the
module's README and 52 of `types.ts`). Before deleting, every check was given a place (the table in `modules/discovery/contract/README.md`): the TypeScript's answers to 456 requests were
recorded (`contract/golden/differential.json.gz`, recorded twice and identical, both runtimes matched it; replayed at the recorded instant on the directory's test clock, which refuses to start
unless it listens on 127.0.0.1), the TypeScript reader's answers to a good feed and 46 changes (`testdata/feeds.json.gz`) and its pages in every state and language (`testdata/pages.json.gz`)
became Go tests, the cross-runtime restart test became a Go restart test, `modules/listings/test/protocol.test.ts`'s four checks with the directory's reader became
`contract/shop-protocol.contract.test.ts` (the shops' own protocol code against the directory), the deployer's checks moved to `bundle/test/go-runtime.test.ts`, and the TypeScript tests' rules
that need a clock or a network became `fetcher_test.go`, `check_test.go`, `limits_test.go`, `refresh_test.go`, `notices_test.go` and `cmd/directory/main_test.go`. The generator keeps only
what still has a TypeScript source (the words, the shops' style sheet and paints, the MCP versions, the font); the page's own style, its script, the MCP tools, the card bodies, the
assistant's prompt and the fold tables are Go source now (`internal/directory/words/`, `romanise_tables.go`), cut byte for byte from what it made.

**Found (Go, left, Deferred.md):** a lone surrogate written as `\ud800` in a feed is read by Go's JSON decoder as U+FFFD, so the Go reader keeps a name the TypeScript refused; the shops' Go
`Model.Cost` prices cached input tokens at the full rate where the TypeScript prices them at the cached rate (one line, left to the shop runtime's owner: it changes what a shop is charged).

### The listings shop (wave 1b): the TypeScript runtime deleted

**Deleted:** `templates/commerce/listings/server/` main.ts, runtime.ts, shared-main.ts, shared-start.ts, start.ts, store.ts, back-soon.ts; `src/` agent.ts, assistant.ts, channel.ts (only
the runtime used them); the TypeScript shared process and its pool (`modules/runtime/shared.ts`, `shared-pool.ts`, `shared-worker.ts`) and their tests (`modules/runtime/test/shared.test.ts`,
`shared-pool.test.ts`, `pool-fake-shop.ts`, `templates/commerce/listings/test/shared-pool.test.ts`, `shared-shops.test.ts`): **1,630 lines**; and the compose code of the Node shared block
with `SHARED_POOL` (`bundle/generate/compose.ts`, `shop.ts`). Kept, because what stays TypeScript reads them: `server/config.ts` (bundle/lib/kinds.ts), `server/snapshot.ts` and `src/state.ts`
(bundle/lib/listings-carry.ts), `src/settings.ts` and `src/chat-limits.ts` (kinds, the panel), `package.json`. Listings-only shops always run on the checkout's template, so the shared process
is always Go; a checkout whose template names no shared program is refused when the compose file is written. Older kept versions of a single shop still run through the generic Node block.

**The contract re-anchored before the deletion** (`templates/commerce/listings/contract/`, its README has the table): every test that compared the TypeScript shop with the Go shop now compares
the Go shop with golden answers recorded from the TypeScript (`contract/golden/`, 49 answers from models, assistant, morning, differential, stock and cross-restart; recorded twice with no
difference, and once more 37 days earlier to prove the replay at the recorded instant on the test clock really moves the dates); the turn-taking tests (TypeScript then Go on one folder) are
Go restart tests, and the "same files" check is a golden of the three SQLite schemas. Before the change the whole folder passed 203 of 203 on TypeScript in a clean checkout (every turn-taking
test passing both ways: the proof that Go reads TypeScript's files, since a TypeScript-written fixture would hold the shop's private key and is not committed); with the goldens in place
196 of 196 on TypeScript and on Go; after `LISTINGS_IMPL=ts` went, **190 of 190 on Go** (7 turn-taking pairs became one restart test each, and the shared process's 6 scenarios no longer run
a second time on TypeScript). No Go-versus-TypeScript difference was found. The listings unit tests that went: `shared-pool.test.ts` and `shared-shops.test.ts` (routing, another shop's
token refused, a shop let go, the back-soon page: `contract/shared.contract.test.ts` and `go/internal/shared/host_test.go`; a listing and a photo staying in their own shop's feed and file: a new
scenario in `shared.contract.test.ts`; the back-soon language order: `go/internal/shared/backsoon_lang_test.go`; the back-off's doubling has no Go test yet, bundle/Deferred.md); `modules/runtime/test/shared*.test.ts` (the TypeScript pool:
`host_test.go` holds the Go host's strikes, quarantine, pause and restarts). `first-signin.test.ts` and `settings.test.ts` stay (they test `src/settings.ts`, which stays).

**TypeScript behaviour the goldens pin** (reported, not changed): asked on Thu 19 Nov, "money on 16 nov" is answered for 16 Nov of next year, not three days ago; Go does the same.

**Size of the two phases** (this branch's own commits, the main merge left out): Go +1,651 / -596 lines (+546 / -569 outside tests: the joins removed more than the switch added; +1,105 of
tests); TypeScript -4,556 / +596 for the directory and -2,253 / +656 for the listings shop (the contract re-anchoring is most of the TypeScript added): **about 5,560 lines of TypeScript
fewer**.

## Wave 2 preparation (19 Nov 2026): the Bookings contract, before any Go

The HTTP contract suite for the Bookings shop runtime is written in TypeScript and passes on the TypeScript runtime; no Go for Bookings exists yet. It is
`templates/commerce/bookings/contract/` (its README is the inventory a port starts from: every route, file, Guard call and timed job, and every one of the 85 unit test files mapped to
"contract", "unit", "demo" or "other component"). `BOOKINGS_IMPL=go` with no binary skips every test with "no Go Bookings runtime yet (wave 2)". The generic harness pieces (process
tracker, fake model, fake push Guard, test-clock file, process starter, HTTP caller, owner-control helpers) moved to `modules/test/contract/` and the listings contract uses them.
One runtime file changed: `templates/commerce/bookings/server/main.ts` takes the test clock the way the listings shop's main does (nothing changes without the two variables, and a
live shop refuses them). The Go Bookings binary must honour the same two variables for a "fakes" shop (`go/internal/testclock`).

## Wave 2: the Bookings runtime (19 Nov 2026, `go-bookings-19nov`, in progress)

**What is built.** One shop runtime for every template: `internal/runtime/template.go` is the seam (`Kit`, the Go twin of `modules/runtime/core.ts` `RuntimeKit` and `ChannelKit`),
and `internal/bookings` is the first template plugged into it; `cmd/bookings` runs one Bookings shop with the same command line, token files, environment and test clock as
`cmd/listings` (a live shop refuses the test clock). Nothing of the listings runtime was copied: the owner's sign-in, passkeys, phones, push, the limits page, the owner's file,
the record and the queue are the same code for both shops. A runtime with no Kit is the listings shop exactly as before (the listings contract on Go: 201 of 201 before the seam
and after it). The parts only a template uses: the inbox's events, the panel's recovery and the front's channel events checked whole with the TypeScript's sentences and task
keys (`events.go`), WhatsApp's delivery reports in the record (`statuses.go`), a task parked while its Guard is down and run once more when the wait is over, a task ended failed
with its to-do line keeping the thrown-away step's id counters (`kit.go`), the template's routes in http.ts's order of checks (`kitserver.go`), and in the store the columns
that were always there (`waiting_on`, `retry_at`, the window, a task's state by key). The Bookings store is read and written field for field, every member it does not model kept
raw in its place (`internal/bookings/state.go`); `nextBooking` moves on by 100000 after a restore.

**What is left, and why.** Every step that calls a service: a customer's message, a booking from the page, a payment, an approval, cancel and change, the beat's holds, reminders
and completion, the free starts in the offer. The services are the other streams' (go-guards-19nov: payments, messaging, calendar, stand-ins; go-books-19nov: the books, the
report), so the domain code waits on them; `internal/bookings/ports.go` holds the interfaces, mirroring theirs. Such a step ends its task FAILED at once with a sentence
(`runtime.Unported`), never a silent "done". The pure rules it will use are ported and proved on the TypeScript's vectors (hours, double booking with units and resources, the
refund limit, the price floor, STOP, every move between states, reminders; the settings' refusals word for word; the task runner's cases). Slices 4 and 5 (the customer's chat
and talk, the owner's side for Bookings, the assistant's Bookings skill, the limits Bookings declares) are not started. `internal/bookings/Deferred.md` is the list.

**The customer-facing words (slice 4, part; branch `go-bookings-words-19nov`).** Every message the Bookings agent sends (96 per language, four languages), the WhatsApp templates'
bodies and how each slot is filled, the labels and Meta's limits, and the owner's day list are DATA made from the TypeScript by `go/scripts/gen_bookings_words.ts` (each template is
rendered with probe facts and each probe turned back into a `{slot}`; which facts a message needs is found by taking each away from the real function, so Go refuses the same
messages with the same sentence; `--check` and `words-fresh.test.ts` fail when a file is stale). The formats are shared (`internal/language/format.go` + `formats.json`, made by the
same script from format.ts's own tables: format.ts writes dates and times from tables, not Intl; the zone is Go's database and the rupee grouping `language.FormatInr`, both proved
equal; the data was made with Node v26.10.0). `internal/language` check.go now carries the moments (the booking's slot and a list's free times) and its problem sentences, so
the outgoing check of a Bookings message equals the TypeScript's. `internal/bookings/templates.go`, `meta.go`, `interactive.go` render a message, the WhatsApp parameters, the
templates submitted to Meta, the lists and buttons. Proved on every case of `templates-vectors.json` (384 renders and their checks, 136 WhatsApp templates, the 13 replies, labels,
lists, buttons and the 136 submissions) plus the language package's equal-to-Node cases for rupees, dates and times (`go test ./internal/bookings/... ./internal/language/...`).
Not done: the UPI owner's buttons (`ownerMarkButtons`), see Deferred.md. TypeScript findings: none changed.

**What passes (19 Nov, through the heat lock).**

* The Bookings contract on Go, whole folder (`BOOKINGS_IMPL=go BOOKINGS_GO_BIN=go/bin/bookings node --test --test-concurrency=1 templates/commerce/bookings/contract/`): **128 tests, 23
  pass, 105 fail**. The 23: all 12 of `smoke` (health, readyz, status, every token refusal, 405s, 404s for the listings and Fees routes, the recovery and events checks, the status
  reports, the data across a restart, the folder refusals, a live shop refusing the test clock, a Guards shop that calls no Guard at start), the shared owner control on a Bookings
  shop (the lock with the first passkey, the Operator's QR and card refused after it, the 48-hour number change and a sale, the limits page), a newer schema refused, the shop's key
  kept across restarts, a torn licence file, a malformed chat or approval event refused, a stranger's "approve". Three of them pass because nothing happens on Go (STOP with a
  voice note, a stranger's "approve", the torn licence file: the step ends failed as not ported, and the test only checks that nothing went out), so they are not evidence yet;
  and the limits page's test passes with Go's `limits: []` because it only tightens a limit `if` one is listed (a weak test: reported to the contract stream below). The 105
  failures, read by their first error: no payment link or booking was made (the booking flow), the free starts (`calendarUnread`), the chat's thread and rates, the customer's
  words and the model, the owner's assistant, the licence notices and the report: every one a step or a read that is not ported (Deferred.md), none a wrong answer of a ported part.
  On TypeScript `smoke` is 12 of 12 (unchanged: no TypeScript was touched).
* The listings contract on Go after the seam: **202 of 202** (the same command as before; one test more than the baseline of 201, from main).
* "Loses nothing", by a scratch check (not a contract file): a TypeScript Guards shop books and pays and stops; the Go runtime starts on the folder, reads the booking as
  `booked`, counts it, takes one `message_status` (which rewrites the whole state in the Go codec's text) and stops; the TypeScript runtime starts again and the page's read, the
  record line for line and the queue are what they were, and a cancellation goes on to one refund. `cross-restart.test.ts` itself needs the Go booking flow and fails until it lands.
* The record lines are the TypeScript's, by a scratch check on one folder (the same record key): a recovery for a booking that is not there and a status report for a message
  no line sent, written by TypeScript and then by Go, are equal member for member (the recovery's `inputsDigest` too), in a fakes shop and a Guards shop.
* Go unit tests (`go test ./internal/bookings`): the limits vectors (1,718 cases: hours, double booking, refund limit, STOP, moves, reminders, price), the settings vectors (22,
  word for word), the task runner vectors (6). The other vector files on main (templates, coerce, ondc, scenarios, report, parser, guard-spec) have no Go test yet: their
  functions are not ported (the customer's words, the rule parser, the agent, the report), on the TypeScript's own inputs.

**Memory, one idle Bookings shop** (a fakes shop from the contract's harness, `ps -o rss=`, as the listings trial measured, one run each):

| | TypeScript (Node 26) | Go |
| --- | --- | --- |
| idle RSS 3 s after start | 139.5 MB | **23.2 MB** |
| after 150 requests (offer, status, owner page) | 149.8 MB | **26.8 MB** |
| spawn to `/healthz` | 327 ms | **55 ms** |

The Go shop does less than the TypeScript one yet (no in-memory stand-ins, no booking flow), so its number will grow as the services land; the listings shop's 18.5 MB is the floor
the shared runtime itself costs.

**Contract findings (for the contract stream; nothing changed there).** `owner.contract.test.ts` "a passkey session reads the limits ..." checks the tightening only `if` the view
lists a limit, so a runtime that declares none passes it; Bookings declares CHAT_LIMITS, so the test could assert the list is not empty.

**TypeScript findings.** None that change behaviour. Noted for the port: the contract's `smoke` passes a `message` step on Go by ending the task failed (not ported); the test does
not look at the outcome, so it cannot tell a handled message from an unhandled one.

**Slice 5, first part: the limits Bookings declares (19 Nov).** `internal/runtime/limitsdecl.go` is the declared half of `modules/limits` (inForce, judgeChange, the view's rows, the
owner's own change from the page), and a template declares its limits through `Kit.Limits` (Bookings: the refund limit, 0 to min(₹5,000, the deposit)). The words are generated
from `modules/limits/chat-limit-kinds.ts` by `go/scripts/gen_limit_words.ts`. The limits page and `/internal/limit-changes` now answer what TypeScript answers: the three limits tests
pass on Go and on TypeScript, the Bookings contract on Go is 25 of 128, the listings contract on Go 202 of 202. What the agent reads in force (the refund limit before a refund) is
wired with the refunds, which wait for the payments package.

**Slice 4, first part: a customer's intent (19 Nov).** `internal/bookings/intent.go`: a model's answer checked by hand (`coerceIntent`: 34 cases of `coerce-vectors.json`, equal) and a
tapped button or row read with no model (`intentFromReply`: the 13 `reply` cases of `templates-vectors.json`, equal). Not ported yet, with no Go test: the rule parser
(`parser-vectors.json`, the coerce file's `sure`, `prompt`, `schema`), the customer's words (`templates-vectors.json` render, meta, labels, lists, buttons: they need a generator over
`src/language/templates.ts` and the four languages' date, time, rupee and phone formats), the agent's scenarios, ONDC, the report.


**Slice 1 (second part): reading a customer's message (19 Nov).** The rule parser (`internal/bookings/parser.go`, rule-parser.ts `parseIntent`) and Bookings' reading for the
shared router (`reading.go`: rulesAreSure, toIntentShape, the prompt, the schema, the decision model's questions and how its answers are read, merge). The shared readers are in the
shared packages: `language.FindTimePhrase`, `BlankWrittenDate`, `WordRe` (dates.ts), `understanding.DetectLanguage`, `FindOffer`, `IsStop`, `IsOverrideAttempt` (rules.ts). Every
fixed pattern is generated: the shared ones into `language/patterns.json` (gen_patterns.ts, 35 more), Bookings' own and the prompt, schema and questions into
`internal/bookings/reading.json` (new `go/scripts/gen_bookings_reading.ts`, its freshness test `templates/commerce/bookings/test/go-reading-fresh.test.ts`). To hand them over,
TypeScript constants that were private became exported (rules.ts, dates.ts, rule-parser.ts, reading.ts) and findOffer's and findTimePhrase's inline patterns became named
constants (`OFFER_TESTS`, `CLOCK_TIME_RE` ...): the same patterns in the same order, no change of behaviour. The JavaScript-regex matcher (`language/regex.go`) gained the three
shapes these patterns need (an edge on a word of a final word list, a look-ahead in the middle or longer than a character, a `\b` inside an alternative); Explanation.md says how.
The router takes a reading's own `Shape` (`understanding.Shaper`). Proved: parser-vectors.json (114 phrases, equal), coerce-vectors.json's sure (8), prompt (1, byte for byte) and
schema (1), the corpus's readers (offer, time, date, blanked date, language, STOP, trick, wordRe sources) for every phrase of gen_patterns' corpus, and toIntentShape on
model-llm.test.ts's cases (no vectors exist for it: a gap reported to the contract stream). Not wired yet: the router into the customer's message step (that step needs the services).

## Wave 2: Guard clients (19 Nov 2026): the shared building blocks of the Bookings, Orders, Fees and Stock-orders runtimes

Ported to Go as shared packages, each proved against vectors made by RUNNING the TypeScript client against a recording HTTP server (`go/scripts/gen_guard_vectors.ts`, cases in
`go/scripts/vectors/`; `--check` and the `words-fresh` test keep them fresh). The Go tests read only the vector files and replay each script from a Go server; the requests (method, target,
the headers that matter, body bytes) and the outcomes (result, or error name, words and carried fields) must be equal.

| package | what | TypeScript it replaces once the Go runtime uses it |
| --- | --- | --- |
| `internal/guard` | the errors, the one HTTP client, Guard's answers told apart, the JavaScript byte helpers | `modules/core/{faults,http,json}.ts` (shared: stay until the last wave) |
| `internal/payments` (+ `razorpay`, `upi`) | the neutral payments, careful links, the refund logic, the stand-in gateway, the Razorpay client and webhook reader, the `upi://pay` link | `modules/payments/{payments,links,refunds}.ts`, `providers/razorpay/{api,webhook}.ts`, `providers/upi/link.ts` |
| `internal/messaging` | Meta and Gupshup clients, stand-in, send-once, say, statuses, webhook readers | `modules/messaging/*`, `standInMessaging` in `modules/runtime/services.ts` |
| `internal/calendar` | Google Calendar v3 through the calendar Guard, the fake, the shop's own list | `templates/commerce/bookings/src/adapters/{calendar,own-calendar}.ts`, `live/google-calendar.ts` |
| `internal/qr`, `internal/terms` | the UPI QR; the shop's terms | `modules/qr/*`, `modules/terms/*` |

What the Bookings wave may delete: the Bookings-only files (the three calendar adapters, the calendar part of `live/index.ts`). What must STAY until the Orders, Fees and Stock-orders waves:
every `modules/*` file above (their runtimes import them), the deployer's and panel's reads of `providers/*` and `gupshup-selfserve.ts`, and `modules/standins/*` (the HTTP stand-in
servers the contract tests start; test infrastructure). `go/scripts/vectors/fixtures.ts` reads `templates/commerce/bookings/test/fixtures/*`: if the Bookings TypeScript goes, those
fixtures need a new home.

**Results** (19 Nov, through the heat lock): `go build ./...`, `go vet` and `go test -count=1 ./internal/{guard,payments,messaging,calendar,qr,terms}/...` pass (guard, payments, razorpay, upi,
messaging, calendar, qr, terms: 8 packages ok); `node go/scripts/gen_guard_vectors.ts --check`: 23 vector files fresh; `words-fresh`: 4 of 4. Refund logic: 78 scenarios covering every
`sortRefundError` arm in `requestRefund` and `releaseHeld`, both retry exhaustions, both `expireGuardHold` arms, the `recheck` arms, the four `tellConfirmed` outcomes and a sweep proving an
unanswered hold sends nothing.

**Not ported, and why** (each package's `Deferred.md` has the detail): the owner-marked UPI ledger, obligations and desk (state the Bookings runtime owns, uses the approvals codes; goes with
that runtime); the deployer's limits spec (`guard-limits.ts` beyond `rupeesToPaise`), `guard-model.ts`, the provider declarations and panel words; the HTTP stand-in servers; the inbox's HTTP
side (only the webhook readers and signature checks are ported); `internal/standins` was not made as a package: the stand-ins live beside what they stand in for (`payments.Fake`,
`calendar` fake, `messaging.NewFake/NewStandIn`), one source of truth.

**Merge notes:** `go/internal/qr` exists on `go-books-19nov` too (a different API): keep one. `internal/payments` declares a narrow `Accounting` poster and `LogMore` of its own; the books
stream's `internal/accounting` needs an adapter of a few lines. `go/internal/zone` of the books branch could replace the calendar's `zonedMidnight`.

**Differences from TypeScript, recorded:** money and times read from a reply are whole numbers only (a fractional amount reads as absent, where `num` passes it); `UntoldRefund.amountInr`
is kept in paise and written as the exact decimal; the Go fake gateway has no fault plans; keep-alive is off in the Guard client (net/http would send a GET again on a cut connection).

*(Fixed or answered in "go-w2-tsfix-22nov" below.)* **TypeScript findings (reported, not fixed):** `refunds.ts` line 429 `amountInr: r.amount / 100` can be fractional (a refund of 12.5 rupees), while every other amount in the file is whole rupees;
the 24 hour hold and the limit are whole-rupee settings, so it cannot happen with these settings, but nothing enforces it. `recordMessageStatus` throws `RangeError` for a failed status with a
timestamp past 8.64e15 ms, which a forged webhook could cause; `say.ts` falls back from buttons to text after any ApiError under 500, a Guard hold or refusal included; `interactiveProblem`
counts code points while the document checks count UTF-16 units; STOP uses `toUpperCase`, so `"ﬆop"` opts a customer out; `own-calendar.ts` creates `store.ownCalendar` on a read; and the
messaging and calendar reports in their `Explanation.md` list more.

## Wave 2: books and report (19 Nov)

Ported as SHARED packages, each proved byte for byte against vectors made by running the TypeScript (Node v26.10.0; every generator has `--check` and a test in `words-fresh.test.ts`):
`internal/zone`, `internal/locale`, `internal/slots`, `internal/accounting` (+ `render`), `internal/report`, `internal/bookingsreport`, and the QR encoder (main's `internal/qr` kept; the
SVG and PNG helpers are its `image.go`). `internal/payments/books.go` adapts the books to refunds' narrow `Accounting` poster (a failed post panics with `BooksError`, as post.ts throws).
The calendar's `zonedMidnight` was NOT swapped for `internal/zone`: it copies extra oddities (years 0 to 99, UTC fallback for a zone Intl rejects) that `zone` does not have.

| Go | TypeScript it replaces |
| --- | --- |
| `internal/accounting` | `modules/accounting/{accounts,journal,post,numbers,periods,documents,case-documents,document-page,figures,invariants,settlements,summary,tally,export,owner-money,owner-money-render,report-block,words-documents,words-owner}.ts`, `templates/commerce/bookings/src/accounting.ts` (+ `obligations.ts` as far as owner-money reads it) |
| `internal/report` | `modules/report/{summary,summary-sign,sign,digest,months,page,text,claims,settled-by-word,verify-link,monthly-job,what-this-checks,go-live}.ts`, `modules/qr/svg.ts` |
| `internal/bookingsreport` | `templates/commerce/bookings/report/{data,run,html,text,whatsapp,certificate (monthly part),summary,strings,monthly-job,go-live}.ts` |

The Bookings wave deletes, once its Go runtime uses them: `templates/commerce/bookings/src/accounting.ts` and `templates/commerce/bookings/report/*` that it ported. `modules/accounting/*` and
`modules/report/*` STAY until Orders, Fees and Stock orders move (their runtimes import them); `check.ts`, `cli.ts`, `keys.ts` and the TypeScript `test/` stay (CLIs and tests).

Left, with the reason (each package's `Deferred.md` has the detail): go-live certificate builders and pages (CLI and deployer); Go PNG bytes differ from zlib's (same pixels); refs visited in
key order where the TypeScript uses insertion order (`BooksFaults` privacy sentences); amounts beyond 2^53.

**Slice 6, the books side for Bookings (19 Nov, `go-bk-books-19nov`).** Built: `internal/bookings/books.go` (`NewBooks`: the four adapters, `accounting.Record`, `accounting.Payments`, `report.Messaging` /
`DocumentSender`, the Booking conversion, plus the monthly job `NewMonthlyReport` / `Run`), `settings_check.go` (the rest of `validateSettings`: `readApprovers`, `readAssistantSettings`, `readCharacter`, and
`(*Settings).Tree`, the checked tree; the policy digest equals the TypeScript's on the vector shops), `ownermark.go` (the ledger in the store, the pay link, `OwnerMarkButtons`) and the new package
`internal/payments/ownermarked` (the UPI ledger, the owner's replies, the neutral view, the QR picture), with vectors made by running the TypeScript (`go/scripts/gen_bookings_settings.ts`,
`gen_ownermarked_vectors.ts`; `templates/commerce/bookings/test/go-books-fresh.test.ts` fails when they are stale). Not wired: the agent core must call them (`bookings/Explanation.md`, "The books side").
Finding: the monthly job runs after the step in `core.ts` with its own `save` (claim saved before the send, ending after); `StepContext` has no `Save` yet, so a Go step that runs it saves the claim only
with the step (a crash between the send and the save could send a month twice): the runtime needs a mid-step save for it.

*(Fixed or answered in "go-w2-tsfix-22nov" below.)* TypeScript findings (reported, not fixed): a `kept` event naming an `owed` refund carries no amount, so `readNew` throws after the line is written; a settled `post()` that throws after its write leaves the row and
is then also listed as a problem; `figures.ts` reads a refund amount with a bare `Number()` (a fraction is added); `owner-money` `tally()` counts a NaN time; `settlements.ts` `daysToRead` sorts a read line with no `refs.day`
last; `invariants.ts` privacy faults depend on refs insertion order; `fitText` folds whitespace before stripping zero-width characters (so a name can turn a signed summary into the older link); `settledWho` slices at
UTF-16 and can leave half an emoji; `workOf` leaves a refund settled by a person's word "waiting for owner" in every later month unless an `owner_decision` follows; a rule id like `constructor` would throw in `STOP_SITES`.

**The formatting join (19 Nov, after merging main and go-bookings-words-19nov).** Three copies wrote the same dates, times and rupees: `internal/locale` (books stream), `language/format.go`
with `formats.json` (words branch) and the assistant's packed date and time tables with its own `INR`. Their tables were identical (checked month for month, weekday for weekday, hour for
hour), so there is now ONE: `language.Formats(lang).Date / TimeOfDay`, `language.FormatInr` and its exact integer twin `FormatInrWhole`, with one en-IN grouping. `internal/locale` is
deleted (its callers in accounting, render, report and bookingsreport use language; owner-money-render's own `inr` moved to `accounting/render`, its only user; its vectors are
`language/testdata/locale-vectors.json`, still written by gen_locale.ts), the assistant's packs no longer carry date and time tables (gen_words.ts), `assistant.INR` is one line over
`language.FormatInr`, and `internal/bookings` has no time helpers of its own: `LocalDate` and `LocalParts` are `zone`'s, and a booking's minute is `zone.ZonedToMs` (time.ts's two
passes; before, `time.Date`, which could differ in a summer-time gap). Kept apart, with the reason: `calendar`'s `zonedMidnight` (Date.UTC's years 0 to 99 and its fall back to UTC
for a zone Intl refuses, where `zone` panics on a zone the settings check already refused: different inputs, different answers), and `slots.Fill` (the positional `{0}` filler of the
books' and the report's words: not a format, and no other copy of it exists; the Meta `{{1}}` filler and the assistant's `{name}` filler are other syntaxes). The directory's page
(`directory/page.go rupees`, toLocaleString with two decimals) keeps its own decimals and uses the one grouping, `language.GroupIN`.
**Slice 6, the services wired and agent.ts (19 Nov, `go-bk-agent-19nov`).** Done: `internal/bookings/ports.go` (one field per service with the shared packages' own interfaces;
`cmd/bookings` builds the stand-ins in fakes mode once per process and the live Razorpay, Google Calendar and WhatsApp clients in live mode with each `agentTokenFile`; the
owner's route by WhatsApp, push or both), the watch (`agent_watch.go`: guard-wait.ts `watchStep` and core.ts's decision: WaitingForGuard, EndTask, the last try's to-do line), and
agent.ts ported section by section over them: saying things (the shared say with Bookings' facts, offers, generated words and gates, the chat's ping gate), free times and the
calendar (look first, write, read back; the offer's free starts), payments and refunds (the shared refunds code over the booking's own typed lists), deposits, the flow (book,
yes, no, the hold and its link), cancel and reschedule, the owner's commands and day list, STOP, a voice note (voice off), the licence's wind-down and final stop, the beat
(backfill, the refunds' sweep, expiry, reminders, completion with the books' `applied`), recovery (all four), the booking page's book and cancel, a chat send through
`runtime.ChatTurn`, and the customer's talk (block M) where the rules know no answer. Every money line goes through the books (`NewBooks`, `Accounting`).
Measured (19 Nov, through the heat lock, `BOOKINGS_IMPL=go BOOKINGS_GO_BIN=go/bin/bookings node --test --test-concurrency=1 templates/commerce/bookings/contract/`): the Bookings
contract on Go **101 of 143** (was 25; 42 fail, 0 skipped). `go build ./...`, `go vet` and `go test` of internal/bookings, runtime and store pass. The listings contract was NOT
run again after this slice (the owner asked to pause before a new run); its last count on main is 202 of 202. The work stopped here at the owner's pause, after the books merge.

**Where it stopped: the 42 Bookings contract tests that fail on Go, by what they need** (each is in the list below): a UPI shop's money (8: the buffer, the hold's expiry,
completion and a reminder, cancelling on the page, the UPI quote's page link, the UPI marks, "I have paid", a shop with no WhatsApp); the owner's page actions and words by digest
(5: approvals on the page, a late cancellation asked on the page, the owner's refusal, the owner's page words, the first passkey's session path); the shop's assistant for Bookings
(10: cancel card, day list and money, close a day, move, message a customer, the limit card and its failure, the morning line, the owner's voice note, the WebM recording); the
shop terms (2); voice notes (1); the monthly report (2) and the licence notices (1); the approval event's checks (2: approved resend, a malformed approval event); the decision
model's pause and step-breaker (3); the button flow's payloads and the cancel buttons (2); two chairs (1); the owner told by template outside the window (1); the WhatsApp sign-in
link (1); the documents of a booking's page (1); and three guard-outage tests (the payments, calendar and WhatsApp Guard down) to look at first, as they test the watch itself.

**What is left of wave 2 for Bookings (the next agent starts here), in the order it unblocks contract tests:**
1. **A UPI shop's money** (most fakes-mode contract tests use a UPI shop, because only fakes mode moves the test clock): agent.ts's owner-marked section (`requestOf`,
   `sendMarkedRequest`, `reconcileMarks`, `lateMark`, `oweBack`, `onPaidClaim`, `onLateClaim`, `onPicture`, `onOwnerMark`, `markAskAgain`, `remindOwedRefunds`) over
   `internal/payments/ownermarked` (on main: OpenRequest, MarkReceived, OweRefund, MarkRefund, View as payments.Payments over the ledger, `Store.UpiState`, `OwnerMarkButtons`).
   Every such path answers `runtime.Unported` today (`a.pay == nil`), so nothing falls through silently.
2. **The owner's page** (`owner_action` by digest: received, refunded, kept, approve, deny, retry, card_yes/no; `owner_message`, the talk box) and the WhatsApp booking's own page
   link (batch 5: `pageLinkFor`, `keepPageLink`, needs pages.json's base handed to the Kit).
3. **The monthly report** (the coordinator's note, money/messages): core.ts runs it AFTER the step with its own mid-step save (the claim saved BEFORE the send, the ending after).
   The Go StepContext has no Save, so `report.Run` must NOT be called inside `Agent.Tick`: give the runtime a post-step hook that can save (or a mid-step Save on StepContext),
   call `report.Run(ReportTick{...})` from it, and test that a restart after the claim never sends the month twice. Not started.
4. The shop's assistant for Bookings (item 11e: the owner's own words, cards, the skill), the shop terms, the handover code, approvers other than the owner (B37), voice notes
   heard through a speech service, the button-mode announcement, the owner's once-a-day notice when customers' talk stopped (`NoticeDay`), a page message's web push.
Deferred.md lists each with the reason.

## Wave 2: the chat and the customer's talk (19 Nov 2026, `go-bk-chat-19nov`)

Slices 2 and 3 of the "What is left of wave 2 for Bookings" list, built beside the agent core (another stream) and not edited into `internal/bookings`.

**The chat (slice 2).** The channel state a template keeps under `channel` (`seq`, `outbox`, `requests`, `chat`, `guests`) is typed once for every template (`runtime/chatstate.go`, in the TypeScript's own member
order, unknown keys carried through raw, no HTML escaping); `runtime/chat.go` is `chat.ts` (a send run as the template's message step, the retry answered once, a tap checked against what the shop
offered, the day's turns from `budget.guestTurnsPerDay` with the old 20 only when it is missing (decision 62), the 150 sends a day, the owner-ping cap, the thread read, the in-memory rates);
`chatroutes.go` and `kitserver.go` make `GET /internal/channel/chat`, the door's 429 and `chat-voice` (a 404 while no template has a speech service); `chatidroute.go` over the new `internal/chatid` is
`POST /internal/channel/chat-id` (keep this chat, open it on a new phone, the number and its links, delete my chat), same file and rules as `chat-identity.ts`. The words are generated
(`scripts/gen_chat_words.ts`). Read `runtime/Explanation.md` and `Deferred.md`.

**The customer's talk (slice 3).** `StepContext.CustomerTalk` (`runtime/talkcustomer.go`) is `talkToCustomer`'s first half: the gates, the metered model call, the answer read by hand, the five checks and the
`talk` record line. The checks are `assistant.CheckTalk` in the customer's role (the owner's `CheckOwnerTalk` is now the same function with the owner's role: one checker, as `talk-check.ts` has one); the claim
words and the never-used words are the listings package's (`ClaimKindsOf`, the new `BannedWords`), handed in, not copied; the prompt is the TypeScript's (`scripts/gen_customer_talk.ts`). Proved on 97 checks,
20 model answers and 25 prompts the TypeScript made (`scripts/gen_customer_talk_vectors.ts`). It sits in `internal/assistant` (pure) and `internal/runtime` (the run), not `internal/understanding` as the brief
said: the sources and the checks are the assistant's, and `understanding` is below it.

**What the agent core must give, and call.**
1. `func (a *Agent) OnMessage(m messaging.InboundMessage) error` (the template's message step: the flow, the customer's talk, the menu), which a chat send runs.
2. In `Handle`, for `ev["kind"] == "chat_message"`: `runtime.ChatTurn(runtime.ChatTurnDeps{State: cs, ModelCalls: ..., Now: ..., Day: clock.Day, Kind: "bookings", Run: func(in runtime.ChatInbound) error { return a.OnMessage(in.InboundMessage) }, SetLanguage: ..., Budget: policy.Budget}, runtime.ChatMessageOf(ev))`.
   `cs` is `runtime.ParseChannel(store.Channel)` held for the WHOLE step, and the store's `Channel` is `cs.Marshal()` when the step ends; the agent's say keeps every message to a chat conversation (`runtime.IsChannelConversation`) with
   `cs.Keep(to, text, choices, now)` (and `cs.MarkMoment(id, "confirmed"|"paid")` after the record gate), and its owner-notice gate asks `runtime.ChatPingBlock`.
3. In the message step, where the rules and the router know no answer: `c.CustomerTalk(runtime.CustomerTalkInput{...})` (`c` is the step's `*runtime.StepContext`), then, on `Sent`, the reply through its say with `Facts`, and on `NoticeDay` the owner's one-a-day notice.
4. An optional `ChannelRaw(s KitState) json.RawMessage` on the Kit (makes the thread read cheap; without it the runtime reads the saved state's members).

**Tests.** `runtime/chat_test.go` (`channels/test/chat.test.ts`'s cases over a fake step), `assistant/talkcustomer_test.go` (the vectors), `chatid/chatid_test.go` (a software passkey). The tests of the Bookings chat contract that
wait for the agent core are listed in the final report of this branch; `scenarios-vectors.json` has none that does not run the agent's booking flow (all 14 do), so none is used here.

**Measured (19 Nov, after this branch):** `go build ./...`, `go vet ./...` and `go test ./...` pass (27 packages, `internal/chatid` is new). The Bookings chat contract on Go (`chat.contract.test.ts`) is **4 of 17**: the empty and unknown thread
and the 400s, a tap nothing offered, the 12-new-guests-an-hour 429 pass; the 13 that wait for the agent core are every one that needs the shop to answer (the send answered, the same send again, delete my chat after a
booking, the three languages and Hinglish, the 8 a minute test (its 429 comes at the right send, but its last line counts the saved guest lines), and the five model tests). The listings contract on Go: 202 tests, 202 pass.

## Wave 2: the Bookings agent finished (20 Nov 2026, `go-bk-agent-20nov`, in progress)

Started from agents main f1e56749 (Bookings contract on Go 101 of 143). The steps of the brief, most useful first; the count after each (narrow contract files only; the whole
contract runs once at the end):

1. **The three Guard-outage tests: done.** The cause was not the watch but the queue: in `runtime.drain` the step's error was assigned to a `:=`-shadowed `err` inside the
   `json.Unmarshal` if, so EVERY failed step looked like one that went through without being saved; the task ran again until "too many interrupted tries" and was never parked
   for its Guard (and an `Unported` step was tried four times, not failed at once). Fixed in `internal/runtime/runtime.go`. `recovery.contract.test.ts` on Go: 11 of 11
   (the three outage tests were failing). Count: **104 of 143** (101 + 3; the other files not run again).
2. **A UPI shop's money: done.** `internal/bookings/agent_marks.go` is agent.ts's owner-marked section (requestOf, sendMarkedRequest, tellAlreadyWaiting,
   reconcileMarks, lateMark, oweBack, onPaidClaim, noteClaim, onLateClaim, onPicture, onOwnerMark, markAskAgain, remindOwedRefunds) over `internal/payments/ownermarked`; the
   agent asks the module's capabilities (`ownerConfirms`, `ownerRefunds`) as agent.ts does, a UPI shop's `a.pay` is the ledger's `ownermarked.View` (made in the agent, never
   watched), and the ledger is typed once on the store and written back field for field. Also, because the UPI tests need them: the "booked" gate's owner-marked branch,
   the WhatsApp booking's own page link (`Kit.PageBase` from pages.json, `pageLinkFor`, `keepPageLink`, the booked message's link inside the window), the page's UPI pay block,
   `canSayPaid`, the refund on the page, and the owner's page items with their digests (deposit, late_deposit, refund_owed) and `owner_action` by digest. Not done: the QR
   picture (Deferred.md). `flow`, `money` and `owner` contract files on Go: 31 of 34 (the 3 left are steps 3, 5 and 6: the accountant's files after a passkey session, the
   owner's talk box, a page's documents). Count: **about 113 of 143** (104 + the 8 UPI tests + the owner told by template outside the window; the other files not run again).
3. **The owner's page: done.** `owner_action` by digest for every item (received, refunded, kept on the UPI items; approve, deny, retry on the late refund and the calendar items)
   goes through the owner's own reply path, as agent.ts onOwnerAction does; `owner_message` and a card's answer on a shop without the assistant are refused in the record
   (with one: step 5). The page's documents (`Documents`: accounting.CaseDocuments over the record, by the page's own lookup) and the accountant's files
   (`/internal/channel/accounting`, a new optional `runtime.AccountantFiler`, accounting.AccountantFiles with the Tally files) are wired. Found and fixed on the way: an
   approval decision nobody waits for PANICKED the Go process (refunds.go logs it with a nil case; `bookingOfCase` asserted the type), which killed two limits tests.
   `money`, `owner` and `limits-approvals` on Go: 34 of 35 (the one left is the owner's talk box, step 5). Count: **about 119 of 143** (the documents, the passkey session's
   files, the approved resend and the malformed approval event join; the other files not run again).
4. **The monthly report and the licence notice: done.** The runtime has a post-step hook for the beat, `runtime.AfterTicker` (`AfterTick(save)`), run by `kitStep` after the
   agent's Tick and the owner's beat; its `save` is `saveMid` (the state and the record lines so far are committed, and the step's recorder goes on from them), core.ts's
   `save: () => save(store, record)`. The Bookings agent's AfterTick runs the licence notice (modules/licence/notice.ts ported as the shared `runtime.RunLicenceNotice`, with
   Bookings' words from server/licence.ts and the lease's Operator now read from licence.json) and then `MonthlyReport.Run` with that save; the `report` block of runtime.json
   is read and checked as config.ts readReport and start.ts monthlyReportSetup do (`ReportSetupOf`: signing key, go-live file, the name re-read when the file changes). Go
   test `TestMonthlyReportARestartAfterTheClaimNeverSendsTheMonthTwice`: a real runtime and store; the store's files are copied at the instant the report is handed to
   WhatsApp (what a crash then leaves), and a runtime started on the copy sends nothing and closes the claim as unconfirmed. `record-licence.contract.test.ts` on Go: 12 of
   12. Count, every file run narrowly after this step (recovery 11/11, flow 14/14, money + owner + limits-approvals 34/35, record-licence 12/12, open-cases + open2 + open3
   + chat + smoke + cross-restart 52/71): **123 of 143**.
5. **The shop's assistant for Bookings: NOT started** (where the stream stopped). Sized on the Go side first: the Go assistant (`runtime/assistant.go`) is the listings shop's,
   page-only (no WhatsApp), with one skill hard-wired; the reading (`assistant/rules.go`) already knows the kinds (day, close_day, reopen_day, move, message, cancel, limit), but the
   WORDS are missing: none of the sentences these tests expect ("Closed ... Reply undo to open it again", "Moved b-1 to ...", "I couldn't move ...", "Send this to ...", "would
   loosen it") is in `assistant/words/*.json.gz`. The plan, one commit each: (0) generate modules/assistant/templates.ts and words.ts's Bookings and limit lines into the packs
   (gen_words.ts); (a) grow runtime/assistant.go behind a skill seam (conversation.ts `createAssistant` over `OwnerSkill`, no second copy), with a WhatsApp way out through the
   shared say and the assistant's approved template outside the window, and the page talk box and app view; (b) the Bookings skill (src/assistant.ts: day, waiting, prepare,
   execute over the agent's own paths) with the cancel and message cards; (c) close a day and move, with undo; (d) the limit card (limits-card.ts); (e) the morning line in
   AfterTick; (f) voice (modules/voice: the speech Guard client, the listener) for the owner's voice note and the WebM recording, which also unblocks step 6's voice note.
   Tests waiting on it (11): open3's day list and money, close a day, move, message a customer, the two limit cards, the morning line, the owner's voice note, the WebM
   recording; open2's cancel card; owner's talk box on the page.
6. **The rest: not started** (9 left; two chairs, the documents, the template outside the window, the approval event's checks and both cross-restart tests already pass): the
   shop terms (2: modules/terms), a customer's voice note (1: voice), the decision model's step-breaker and pause (3), the button flow's payloads (1), the cancel buttons and
   talk to the owner (1), the WhatsApp sign-in link (1).

**Measured at the end of this stream (20 Nov, through the heat lock, once):** `BOOKINGS_IMPL=go BOOKINGS_GO_BIN=go/bin/bookings node --test --test-concurrency=1
templates/commerce/bookings/contract/`: **123 of 143** (was 101; 20 fail, 0 skipped, no Go panic). The 20 are steps 5 (11) and 6 (9) above. `go build ./...`, `go vet ./...` and
`go test ./...` pass (29 packages). The listings and directory contracts were not run (the lead runs them before merging); the queue fix in runtime.go changes a listings
shop's failing step too (it is now retried with the delays instead of spinning to "too many interrupted tries").

## Wave 2: the shop's assistant for Bookings and the rest (20 Nov 2026, `go-bk-assistant-20nov`, in progress)

Started from agents main a5a80095 (Bookings contract on Go 123 of 143; on TypeScript 143 of 143). Steps 5 and 6 of the section above, most useful first; the count after each
(narrow contract files only; the whole contract runs once at the end):

- **(0) The words: done.** `go/scripts/gen_words.ts` now also renders the Bookings assistant's words with the real `write()`, `cardQuestion()`, `limitLine()` and
  `limitCardLine()` (keys `day_list.*`, `closed.*`, `moved`, `move_failed.*`, `card.*`, `card.foot.*`, `label.*`, `done.*`, `limit.*`, the refusals, the two customer templates
  `tmpl.day_closed` / `tmpl.day_open` with their Meta names and value order, the morning line's Bookings part, and the help and "didn't get that" lines for a Bookings shop's
  kinds, `@bookings`), and `rules.json` carries the router's reading for those kinds and the limit-rule phrasing (limits-card.ts PHRASING, read from the source). Three
  regular expressions that are not exported (intents.ts AMOUNT_RE, the two of readLimitRequest) are built by JavaScript from their source in `gen_patterns.ts`; the limit kinds'
  own words are in `limitwords/words.json` (`gen_limit_words.ts`). `words-fresh.test.ts` checks the packs as before, plus one Bookings line. Count: **123 of 143** (no Go yet).
- **(a) to (d) The assistant behind a skill seam, the Bookings skill, a closed day and a move with undo, the limit card: done.** The one conversation (`runtime/assistant.go`) now
  serves every shop over `OwnerSkill`s (`runtime/assistantkit.go`, skill.ts): the listings-only shop keeps its one built-in skill (`listingskill.go`) and its page-only talk; a
  template's agent turns it on with `StepContext.Assistant(AssistantHooks{...})` and gets [its skill, the declared limits, the listings] (wire.ts), answers on WhatsApp through the
  shared `messaging.Say` (the card with its buttons and code, the approved template for a customer's closed or reopened day) or on the page while the owner acts from there.
  Closing and opening a day, a move and undo, and the limit card are `runtime/assistantacts.go`; the reading takes the shop's kinds, the time of day, a refund's amount and the
  limit rule (`assistant.Context`, `OwnerReading{Bookings, LimitRule}`); a card returns its code (`MakeCard`); the owner page's `app` view is shared (`OwnerAppView`, with the
  mood of mood.ts); the owner's tightened refund limit is in force for the agent's own checks (`StepContext.InForce`). Bookings' skill is `bookings/agent_assistant.go`
  (assistant.ts, its acts the agent's own paths). Count (open3, open2, owner on Go): **131 of 143** (the day's list, close a day, move, message, the two limit cards, the cancel
  card, the owner's talk box). The listings contract on Go after (a): **197 of 197**.
- **(e) The morning line: done.** `runtime/morning.go` is now morning.ts once for every shop (`runMorning`: when, once even if the process dies, silent on a closed or quiet day, the
  claim, the send and the ending; `morningWords`: today's parts, yesterday's money, what waits, the mood); the listings shop sends it as a push as before, a template's shop through
  `StepContext.Morning` as text in the owner's open window, else the approved template (its values in Meta's order, generated). Bookings runs it in AfterTick after the monthly
  report. Not done: the mood picture as a sticker and as the template's header (Deferred.md). Count: **132 of 143**.
- **(f) Voice: done.** `internal/voice` (new) is modules/voice: the `speech` block of runtime.json checked in the TypeScript's sentences, Geometer's own speech service (POST /stt,
  multipart) and the WhatsApp media fetch through their Guards, the length of Ogg Opus and WebM Opus read from the bytes, the cost, low confidence, the day's limit and the
  half-hour memo (proved on the TypeScript's own answers: `scripts/gen_voice_vectors.ts`). `runtime/voice.go` is the listener (turn.ts: not in button mode or over the AI cap,
  the day's count and the cost in the saved AI state) and the owner's recordings held in memory with `POST /internal/channel/owner-voice`. The assistant hears the owner
  (`HearOwner`, `OnPageVoice`: an owner_assistant line with the voice marks, never the words); Bookings listens to a customer's note and reads it like typed text (step 6's
  voice test too). Count: **135 of 143** (the owner's voice note, the WebM recording, a customer's voice note).
- **Step 6, the rest: done.** The shop terms (`internal/terms` was ported already; the agent now reads "terms" and "I agree" with it, the file read again when it changes); the
  decision model's step-breaker lines and button mode (`bookings/agent_mode.go`: reader.ts announceButtonMode, announceSteps, announceModelOff, after a customer's answer and on
  the beat; `budget.TakeAnnouncements`); the button payloads and the cancel buttons (a Go bug: a tapped time's intent carried `int` numbers where every reader takes decoded
  JSON's `float64`, so the tap was "not understood"; `IntentFromReply` now writes `float64`); the WhatsApp sign-in link for a template's shop (`runtime.sendLink` with the
  kit's WhatsApp, `access.Issue` and `Unsent`, the message generated from owner-signin.ts SIGNIN_MESSAGE); a customer's voice note (step 5 (f)). open3, open2 and open-cases
  on Go: 40 of 40.

**Measured at the end of this stream (20 Nov, through the heat lock, once):** `BOOKINGS_IMPL=go BOOKINGS_GO_BIN=go/bin/bookings node --test --test-concurrency=1
templates/commerce/bookings/contract/`: **143 of 143** (0 fail, 0 skipped). `node --test --test-concurrency=1 templates/commerce/listings/contract/` on Go: **197 of 197** (the
words-fresh test included). `go build ./...`, `go vet ./...` and `go test ./...` pass (`internal/voice` is new). TypeScript was not changed (only go/scripts generators and one
assertion in words-fresh.test.ts); no TypeScript bug was found. Not done (Deferred.md of bookings and runtime): the outgoing check over the assistant's own lines (recorded as
allowed), a message to a chat guest and a guest's label, the morning line's picture, Sarvam, a chat guest's hold-to-talk, "open my app" on WhatsApp for a template's shop.

## go-w2-tsfix-22nov (22 Nov 2026): wave 2's TypeScript findings fixed on both sides

Each real bug found by the Go port in the TypeScript is fixed in the TypeScript AND its Go twin, the same way, with a test on each side (a TypeScript unit test, and the
Go vectors made by running the TypeScript, or a Go unit test; a contract case where HTTP can see it). Fixes that change how old records are read (the books, the report's jobs)
can change a past month's figures where its record had such a line.

**Fixed (money and opt-out first):**
- `journal.ts readNew`: a `kept` event naming an `owed` refund carries no amount, and the reader demanded one (post threw unless the template added `amountPaise`). (journal.go)
- `bookings/report/data.ts workOf`: a refund held for the owner is also ended by a later `refund` line of the same payment that is confirmed (a person's word, the provider's
  list), blocked or failed; before, only an `owner_decision` ended it, so a settled hold was "waiting for owner" in every later month. (bookingsreport/data.go)
- `figures.ts`: the borrowed refund amount is whole paise as the journal writes it (a bare `Number()` took "1e3", "12.5"). (figures.go)
- `owner-money.ts tally()`: a NaN time is in no range (Go already left it out).
- `settlements.ts`: a settled `post()` that throws after its write is not listed as a problem as well; a read line with no `day` does not hide the last day read. (settlements.go)
- `messaging.ts` (the fake's STOP): ASCII letters only, so "ﬆop" is not STOP, as the agent's own reading (`isStop`) never took it. (messaging/fake.go)
- `STOP_SITES` (Bookings, and Orders' copy of the same line): a rule id such as `constructor` is an unknown rule (`Object.hasOwn`); it threw and no report was made.
- `statuses.ts recordMessageStatus`: a time no Date holds (a forged webhook, past 8.64e15 ms) is left out of the line instead of throwing; the runtime's Go copy (which wrote
  a wrong year) uses `messaging.ISOString`. Contract: `smoke.contract.test.ts` "a status report whose time no date can hold", on both runtimes.
- `say.ts`: buttons answered by the shop's Guard (held, refused, conflict, unauthenticated) are not sent again as text; only the provider's own 4xx falls back. (messaging/say.go)
- `own-calendar.ts`: a read, update or delete never makes `store.ownCalendar`; only an insert does. (bookings/agent_offer.go `ownRead`)
- `summary.ts fitText`: the characters that go are removed before the spaces are folded (a zero-width space between spaces left two, and the paper got the older link). (report/summary.go)
- `text.ts settledWho` and `talk-prompt.ts historyText`: cut with the new `sliceUnits` (modules/language/format.ts), never through a surrogate pair (Go's UTF16Slice already).
- `notes.ts GOAL_WORDS`: the word ends at `(?![\p{L}\p{M}\p{N}_])`, not `\b`, so a goal written in Devanagari, Malayalam or Kannada is a goal (Go reads the generated pattern).
- `invariants.ts`: the privacy faults visit refs in key order (Go always did).

**Not changed, one line each:**
- `refunds.ts amountInr: r.amount / 100`: the amount is the payments service's own figure for that refund; rounding would tell the customer a wrong amount, and JSON keeps a
  fraction exact (Go writes the same decimal). Not reachable with whole-rupee settings.
- `interactiveProblem` counting code points: deliberate (the comment: a label is counted as the reader sees it); Meta does not document its counting; it differs only for
  characters outside the Basic Multilingual Plane.
- "The UPI go-live certificate is read as the example": not found. A certificate made on the UPI example's settings is `own` for that shop and Glow Salon's is `example`
  (new case in report-go-live.test.ts); hand check, CLI and runtime digest the same validated settings.
- Listings and directory: the `file_taken` session token is fixed on main (http.ts records the short id). The Stock page's 60-unit pre-check and `start` with a missing stock
  id are `modules/stock` behaviour, which streams W4 and W5 are porting now: changing it here would collide (left to them). "I can tighten: ." with no declared limits needs a
  new sentence in four languages (a review of the Malayalam and Kannada), so it is not small. The restore entry's "moved on by 100,000" is one sentence for every template;
  for a listings shop it is only beside the point.

**Measured once at the end (22/23 Nov, through the heat lock):** every generator's `--check` passes after regenerating the five whose output the fixes change (books,
Bookings report, Guard clients, patterns, report). `go build ./...`, `go vet ./...`, `go test ./...` pass (30 packages). Bookings contract on TypeScript 144 of 144 (143 in the
whole run, plus the new forged-time case after its lookup was fixed, rerun on its own file: 13 of 13) and on Go 144 of 144; listings contract 198 of 198; the unit tests of
modules/accounting, messaging, assistant, language, the report tests in modules/test and Orders' report tests 296 of 296; Bookings' unit tests 947 of 949, with one skipped and
one failing: `sample-report.test.ts`, whose committed sample report predates main's 21 Nov price list (`priceList` "2026-11-19" against "2026-11-21"); regenerating it needs
`scripts/sample-report.ts` and public-web's `sample:pull`, outside this stream.

## Wave 2's Go gaps closed (22 Nov 2026, `go-w2-gaps-22nov`)

Started from agents main ead21fd8 (Bookings on Go 143 of 143). Stream A of five. Code first for every item, `go build` the only check while writing (owner, 22 Nov); the tests ran once at
the end (counts below).

1. **The outgoing check on the assistant's own lines: done.** Every line goes through `language.CheckText` with the facts its writer noted, as conversation.ts runs check.ts over
   the Writer's facts: the page's talk (`tellText`), WhatsApp through the shared say (`assistantVoice.Matches`, no longer "allowed" by fiat), the customer's closed-day template,
   a message card's words, the talk's reply and the morning line. The facts are `assistant.Writer` (writer.go) over each packed key's own facts, generated by `gen_words.ts
   factsOf` (the literals and fixed counts the words always carry, proved there with the real checkText), plus the values put in. A held-back line is recorded as blocked and
   nothing goes in its place, as in TypeScript (say.ts's `heldBack` is a no-op for the assistant; the brief's "sends the fixed line" is the talk's `talk_fallback`, after the
   talk's own five checks, which was already so). Vectors: `runtime/testdata/assistant-lines.json` (gen_assistant_vectors.ts, 23 lines x 4 languages, the words and the problems of
   four tampered forms each, word for word); `assistant/writer_test.go` checks every packed key in every language with its own facts.
2. **The owner's open question on a Bookings shop: done.** The talk's sources are the notes, then each skill's `Facts` (Bookings: agent_talkfacts.go, talkReads.facts), then each
   skill's `PublicContext("")` (Bookings' publicContext, the listings), in talk-owner.ts's order; the prompt and the schema carry the declared limits (generated
   `talk.system.*.limits`, `talkSchemaLimits`, `TalkSchemaFor`); the fixed line counts every skill's waiting items and the open cards, with today's count for a skill with a day
   (`talk_fallback.today`); a proposed note goes to WhatsApp with Remember / No (`proposeNote`, memory `Propose`/`AcceptProposal`/`DeclineProposal`, the `note-yes:p-3` tap), and a
   note written from WhatsApp is now by "whatsapp", not "app" (notes.ts `ownerAuthority(via())`; the Go code wrote "app" for every note before). Vectors:
   `bookings/testdata/talk-facts-vectors.json` (gen_talk_facts_vectors.ts: facts, public sources, prompt and schema, en and hi). Contract: `talk.contract.test.ts`.
3. **Tests for what was checked by hand: done.** `talk.contract.test.ts`: a WhatsApp customer whose window has closed (a 25-hour-old message) gets, when their day is closed, the day-closed template with TypeScript's
   templateMessageFor name and values; the morning line to an owner who never wrote goes as its template, once. The combined lines in hi, ml and kn are in the vectors of item 1.
4. **The smaller gaps: done.** A chat guest is "Chat guest 3" to the owner (`runtime.GuestLabel`; owner items, upcoming, whoOf, shownPhone), and "tell chat guest 3 ..." makes the
   message card (`prepareGuestMessage`); "open my app" from the owner on WhatsApp sends the sign-in link before the agent sees it (`runtime/openmyapp.go`, OPEN_MY_APP generated);
   a limit tightened by a card's tap is in force for the rest of the same step (`AssistantHooks.InForce`); a UPI shop with a `report` block sends the QR picture before the words
   (`Kit.QRImage` = `ownermarked.FolderImages`). Contract cases for "open my app", the chat guest's message card (label, words in the guest's thread, "not here" for anything else) and
   the QR picture are in `talk.contract.test.ts`. Not done, as the brief says: Sarvam and the morning line's mood picture (Deferred.md; see the morning finding below). Not covered
   by a test of their own: the same-step limit (no contract path taps a card and refunds in the one step) and the guest's label on the owner page's items (a chat guest's
   booking must be confirmed first, which no contract path does).

**Findings (22 Nov, stream A).** TypeScript, not changed: (a) the morning templates were made with an image header (templates.ts, item 11i), but morning.ts sends the template
without one when the shop's pages.json has no mood pictures, which Meta refuses; observed on both runtimes in talk.contract.test.ts (the stand-in answers 400, #132012 "Variable parameter
values formatted incorrectly", and the line ends "failed", tried again in an hour). Every Go shop has the gap (no morning picture yet), so outside the owner's window a Go shop's
morning line cannot reach the owner until pictures are given or the template loses its header (the test does not assert the send). (b) limits-card.ts:
an "off when 0" limit made Active at 0 reads "Active: Orders above never need your approval before any payment is asked." (c) The Hindi Active line ends with "." where the other
Hindi lines end with "।". (d) money_in shows a paise amount as "₹1,500.5" (formatInr of a fraction). Test infrastructure: the Bookings WhatsApp stand-in did not approve the
assistant's own templates, so a closed-day template could not be sent there on either runtime; templates/commerce/bookings/standins/server.ts now approves
`assistantCatalogue.templates` too. Go bugs found and fixed: a note saved from WhatsApp was written as from "app"; the Bookings message routes (the owner's route, the channel
route) dropped `SendImage`, so no picture could have gone even with a maker.

**Measured at the end of this stream (22 Nov, through the heat lock, once after the code; one fix round after the narrow files):** `go vet ./...` clean; `go test ./...` 30 packages
ok. `BOOKINGS_IMPL=go BOOKINGS_GO_BIN=go/bin/bookings node --test --test-concurrency=1 templates/commerce/bookings/contract/`: **148 of 148** (143 + the five of
talk.contract.test.ts). The same on TypeScript: **148 of 148**. `node --test --test-concurrency=1 templates/commerce/listings/contract/` on Go: **192 of 192** without go/bin/listings-shared,
whose absence registers none of shared.contract.test.ts's 8 (shared-harness.ts haveGo); with it built, shared.contract.test.ts on its own: 8 of 8. 192 + 8 = 200 = ead21fd8's
198 + words-fresh's two new checks. The TypeScript unit tests that import the Bookings stand-in (approvals-guard-binary, understanding, ai-mode, buttons, model-eval, e2e,
report-whatsapp, standins): 110 of 110 after it approves the assistant's templates. After the whole run, the chat guest's case was added to talk.contract.test.ts and the file run again on both runtimes:
6 of 6 on TypeScript and 6 of 6 on Go, so the Bookings contract is 149 on each (148 measured whole, plus this one run on its own file).

**go-w2-tsfix-22nov, final run after merging main 6c16bbf5 (stream A), 23 Nov, once through the heat lock:** every generator `--check` fresh (none needed writing
after the merge); `go build`, `go vet ./...`, `go test ./...` pass (30 packages); Bookings contract 151 of 151 on TypeScript and 151 of 151 on Go (the forged status time and the
held buttons cases included); listings contract 200 of 200; the changed modules' unit tests 296 of 296; Orders' and Fees' accounting-figures, Fees' classes and the channels tests
68 of 68; Bookings' unit tests 947 of 949 (one skipped; `sample-report.test.ts` fails the same way at the base ead21fd8, the same code 192V-X9KH: the committed sample predates
main's 21 Nov price list, so it is not this stream's).
## Wave 2: Stock orders on Go (22 Nov 2026, `go-w5-stock-22nov`, stream W5)

**The contract first.** `templates/commerce/stock-orders/contract/` (README there): 59 tests in 8 files, black-box over HTTP and agent.db, in front of a recording WhatsApp
Guard over the shared stand-in (guards mode, the real clock) or on the runtime's own stand-in with the test clock (fakes mode). Green on TypeScript: **57 pass, 2 skipped**
(the cross-restart pair, which needs the Go binary). `server/main.ts` took the same test-clock seam Bookings' has (nothing changes without the two variables).

**The shared stock count** is its own package, `internal/stock` (modules/stock/stock.ts whole), moved out of `internal/listings` (which keeps aliases, so the runtime's call sites
did not change) and proved on vectors made by running the TypeScript (`scripts/gen_stock_vectors.ts`, in words-fresh). Orders (W4) uses `Sale`, `ReconcileSales`,
`UnbookedHolds` and `LeftFor` from it.

**The template**: `internal/stockorders` and `cmd/stock-orders` (Explanation.md there). Shared changes, all additions (`internal/runtime/kitstock.go`): a Kit's agent that is
an `AfterSaver` is called after the step's save on every step and beat (core.ts `agent.sendOnce.run`), unless the licence is in its final stop; a Kit that is a `StockKit` gets
the owner's Stock page (its items after the shop's listings) and its `owner_stock` events run in the step (Bookings is not one: 404 and dropped, as before);
`Snap.EnsureAssistant`, `Snap.EnsureStock`, `StepContext.LooksLikeLimitRule`.

**End of the stream (main with streams A and B merged in, one pass through the heat lock):** the contract is now 62 tests (the assistant's three added): TypeScript **62 of 62**, Go **61 of 62** (only the monthly report, not ported); listings contract on Go 203 of 203 (words-fresh with the three Stock orders checks); `go vet ./...` clean, `go test ./...` 31 packages ok, none failing; Bookings on Go 149 of 149 after stream A's merge (not run again after stream B's).

**Earlier, on Go: 58 of 59** (`STOCK_ORDERS_IMPL=go STOCK_ORDERS_GO_BIN=go/bin/stock-orders node --test --test-concurrency=1 templates/commerce/stock-orders/contract/`, through the
heat lock), the cross-restart pair included (a shop moved TypeScript to Go and Go to TypeScript keeps its orders field for field, its open card, its record and its counter).
The one that fails is the monthly report: `report/` is not ported (Deferred.md of internal/stockorders), so a Go shop with a `report` block makes none.

Not done, with the reason in `internal/stockorders/Deferred.md`: the monthly report and the go-live certificate; the `assistant` block's own sentences; settings vectors (the
sentences are copied from settings.ts); the assistant's talk reads, open list and routing words, and the morning line over Stock orders; the owner's push; waiting for a Guard
that is down inside a step. TypeScript was not changed in behaviour: `server/main.ts` gained the test-clock seam, `src/reading.ts` exports its two word lists for the generator.

TypeScript findings (nothing was changed):
- A message to the owner OUTSIDE their 24-hour window that has no WhatsApp template of its own (the supplier asked for no more messages, a card ran out, a delivery marked, ...)
  goes as the generic `stock_owner_notice` with no parameters; a provider that knows only the real templates refuses it, so the owner is not told. Only the card, the supplier's
  OK, no and silence have templates (meta-templates.ts).
- `lowStockTick` says "X is low (n left). Order from Y?" only because `pendingAlerts` returns the queue's own alert objects, so `noteAsked` has already counted the question
  when `a.asked === 1` is read. A copy there would silently drop the line; Go reads the count `noteAsked` returns.
- A Stock orders monthly report writes the report, its page and the owner's lines, and no monthly certificate (the go-live certificate is separate): different from Bookings.
## Wave 3: Fees and Classes (22 Nov 2026, `go-w3-fees-22nov`, in progress)

Started from agents main ead21fd8. The method is Bookings': the black-box contract first, on TypeScript, then the Go runtime held to it.

1. **The contract suite: done** (commit 09f47bd0). `templates/education/fees/contract/` (README, harness, two fake Guards over Fees' stand-ins reusing the Bookings contract's
   recording proxy): 67 tests in 11 files (smoke, the month on the test clock, UPI marks, Razorpay links and refunds held by Guard, a parent's private page, the owner's side,
   Classes and the reading material, the public chat, the store and privacy, the two-runtime restart). On TypeScript (`node --test --test-concurrency=1
   templates/education/fees/contract/`): **65 pass, 2 skipped** (cross-restart needs the Go binary). One runtime file changed: `server/main.ts` takes the test clock as
   Bookings' main does. A guards centre runs on the real clock, so its fees are earlier unpaid months (`backDues`), which the first beat opens whatever the day.
2. **The words: done** (commit 84e666b4). `go/scripts/gen_fees_words.ts` writes `internal/fees/words/*.json.gz` (103 messages per language, where to pay, a family's line, the
   next classes, the WhatsApp templates and their slots, the labels) and `internal/fees/reading.json` (the rule parser's and Classes' word lists); `words-fresh` checks them.
3. **The Go runtime** (commits 98709f7f and after): `internal/fees` and `cmd/fees` (see internal/fees/Explanation.md for the file map). Shared code was opened, not rewritten:
   `bookings/reader_shared.go` (the settings readers), `bookings/agent_shared.go` (one step's watch and the owner's route), `runtime/chanmessaging.go` (the chat outbox over any
   store), `runtime/kitparent.go` with a hook in `kitserver.go` (the parent and material reads as optional ChannelKit interfaces: Bookings and the listings shop still answer
   404), `accounting/fees.go` (the Fees books map). Not ported (internal/fees/Deferred.md): the monthly report, the shop's assistant and its talk, the model steps of reading,
   voice, the shop terms and the handover code, a parent's own chat.
4. **The contract on Go** (`FEES_IMPL=go FEES_GO_BIN=go/bin/fees node --test --test-concurrency=1 templates/education/fees/contract/`, through the heat lock): **63 of 67**,
   0 skipped, on the first run that compiled (the cross-restart test both ways included). The 4 that fail are the parts not ported, by design: the shop's assistant (2: "who
   owes fees" and the cancel card), the monthly report (1) and the shop's talk to a parent (1). Classes (5 tests and the reading material) pass on Go. The shop's talk to a
   parent was then ported (agent_customertalk.go, over runtime.CustomerTalk).

**TypeScript findings (nothing changed).** (a) A parent who has never written is answered in the centre's FIRST language, not the student's (agent.ts `languageOf(phone)` with no fee:
the customer's language is unset until they write in one, and a student's `language` is only the fee's), so Rohan's English-speaking parent asking to pay after his only fee is
paid reads "अभी आपकी ओर से कुछ बाकी नहीं है।" (pinned in `razorpay.contract.test.ts`); a reply about no fee could use the language of the parent's students. (b) The
contract's guards centres depend on the hour (the back dues' reminder goes at 06:00 in India or at once if later), so a test that counts every Guard call must name the fee's own
reference: the "ONE link" test was made so after the first TypeScript run, which happened before 06:00.

**Contract changes after the first commit (hour and load independence).** The guards "ONE link" test counts only the fee's own reference; the fakes tests wait for the first beat to save
the day the agent first ran (`started()`, read from agent.db) instead of a fixed 1.5 s; `waitFor` waits up to 20 s (a TypeScript run under the shared lock once took more than 12 s
to open a month). Checked on TypeScript: razorpay, month, owner, classes 29 of 29 and record 5 of 5 (run alone); Bookings' smoke on Go 12 of 12 after the kitserver.go hook;
words-fresh 14 of 14; `go test` of runtime, bookings and accounting pass.

**Measured at the end of this stream (23 Nov, after merging main 5c7df088, through the heat lock):** the Fees contract on Go **64 of 67** (fail: the assistant's "who owes
fees" and cancel card, and the monthly report: not ported, Deferred.md), on TypeScript **67 of 67**; `go build ./...` and `go vet` of fees, runtime, bookings and accounting pass;
`go test` of runtime, bookings and accounting pass (internal/fees has no Go unit tests and no Go vectors: it is proved by the contract only); words-fresh 16 of 16; Bookings'
smoke on Go 14 of 14 after the kitserver.go hook; every go/scripts generator's `--check` passes. One more hour-dependent contract test was found and fixed (the to-do list's
ask-again: on a UPI centre an open request is asked about first, and the first beat makes one only after 06:00 in India; the test now uses a Razorpay centre).

## Wave W4: Orders on Go (22-23 Nov 2026, `go-w4-orders-22nov`)

Started from agents main ead21fd8, with the method of the Bookings waves: the contract first, then the Go runtime, judged by the contract.

**The contract (first commit, 72cd36f7, merged into main as 5f24daa0).** `templates/commerce/orders/contract/` is 73 black-box HTTP tests plus `cross-restart.test.ts`, which
needs both runtimes. They run on the TypeScript runtime and, with `ORDERS_IMPL=go ORDERS_GO_BIN=go/bin/orders`, on Go. Its README maps all 36 unit-test files of
`templates/commerce/orders/test/`.

The files cover:
- smoke;
- the order's flow on the page and on WhatsApp, with every limit;
- money through the payments Guard;
- recovery;
- the record, the monthly report and the licence;
- the owner's side, the assistant's Orders skill and the shop's one stock count;
- the chat and a model's untrusted answer;
- monthly plans.

The harness is Bookings', with Orders' own parts: the four example shops, the instant Mon 9 Nov 2026 10:00 IST, an order from the page, and two Guards. It reuses Bookings'
Guard recorder (one `export` added in `bookings/contract/guards.ts`). `orders/server/main.ts` takes the test clock as Bookings' main does. Nothing changes without the two
variables, and a live shop refuses them.

**The Go runtime.** Each package is listed in go/README.md's map; Explanation.md and Deferred.md in each say what was built and what was left.

| package | what | proved by |
| --- | --- | --- |
| `internal/orders` | settings and their refusals word for word, the store field for field (unknown members raw; an unreadable `upi` or `plans` block is never overwritten), the derived reads, the books, the channel's reads, the Kit (also a StockKit and an OwnerVoiceKit), and the agent over one step (`agent_*.go`: say and its gates, the order flow and limits, money and refunds, the owner-marked UPI money, cancelling, the owner's commands and the balance, the tick, recovery, the page), monthly plans (`plans*.go`) and the Orders skill of the shop's assistant (`agent_assistant.go`); `stock_calls.go` holds every call of the stock count | settings and store vectors (`gen_orders_settings.ts`: 154 settings cases, 7 stores the TypeScript agent wrote, every read of each), the contract |
| `internal/orders/words` | every message in four languages, the WhatsApp templates and their parameters, labels, lists, buttons, the outgoing check | 7,328 render vectors (`gen_orders_words.ts`) |
| `internal/orders/reading` | the rule parser, the check on a model's answer, the router's reading, a tapped reply, the plan reading | about 21k phrases and answers (`gen_orders_reading.ts`) |
| `internal/ordersreport` | the monthly report (data, page, owner's text, WhatsApp message, signed summary, go-live reading, job) | report vectors (`gen_orders_report_words.ts`, `gen_orders_report_vectors.ts`) |
| `internal/stock/words.go` | modules/stock/words.ts STOCK_LINE_WORDS (stream W5's stock package has none) | `gen_stock_words.ts` |
| `cmd/orders` | one Orders shop, the same command line, files and environment as the TypeScript | the contract |

**Shared changes.**
- `internal/runtime/assistantopen.go` (new): a skill's "open orders" answer, the `key@<skill>` words, and the public face.
- `AssistantHooks.Orders`, `assistant.OwnerReading.Orders` and the rules' `RouterOrders`/`KindsOrders`. `idOf` cuts an `@` suffix. `cardQuestion` and `refusal` take the skill's
  wording. The morning line has the open-orders part.
- `gen_words.ts` has an Orders block. The packs only add keys; every existing key is byte-identical.
- The Bookings contract on Go after these changes: 151 of 151.
- My own copy of the stock count's shop-record half was replaced at the merge by stream W5's `internal/stock`. `stock_calls.go` moved to its methods.
- TypeScript: private constants exported for the generators (rule-parser.ts regexps, `PLAN_RES`, templates.ts `rest`, report/data.ts `UPI_NOT_COUNTED`), with no change of
  behaviour.

**What passes (23 Nov, the end run, once, through the heat lock, on the branch merged with main: streams A, B, W5 and W3).**
- The Orders contract on Go (`ORDERS_IMPL=go ORDERS_GO_BIN=go/bin/orders node --test --test-concurrency=1 templates/commerce/orders/contract/`): **75 of 75**, with
  cross-restart both ways.
- The Orders contract on TypeScript (`ORDERS_IMPL=ts ...`): **75 of 75**.
- `go build ./...`, `go vet ./...` and `go test -count=1 ./...`: clean (35 packages with tests ok).
- `words-fresh.test.ts`: 21 of 21.
- The Bookings contract on Go: 151 of 151.
- The listings contract on Go: 198 of 198.
- Every Orders generator, and `gen_stock_words.ts`, `gen_stock_vectors.ts`, `gen_words.ts` and `gen_bookings_words.ts`: `--check` fresh.

On the way, before the merge, the contract on Go was 64 of 69 after the agent. The five left were the assistant's three and the Stock page's two; the plans and the assistant
then brought it to 73 of 73.

**Not done, and why** (the detail is in internal/orders/Deferred.md):
- A chat guest's hold-to-talk: the Orders Kit is not a ChatVoiceKit; Bookings is not one either.
- The owner's once-a-day notice that customers' talk stopped, and the tick's memory of one-time calls: not ported, as in Bookings.
- The monthly report goes through the shop's WhatsApp, not the owner's push route, as Bookings does.
- In fakes mode the settlement read finds no rows.
- Plan paths that no test reaches yet: renewal, a lapse with the credit refunded, cancel with the unused days refunded, pause and resume.
- Copies of Bookings code that belong in one shared place: the settings readers, the owner's route, the page outbox, the watched services, the AI-mode lines, the terms adapters
  and the report setup. Stream W3 has since opened some of them in `bookings/reader_shared.go`, `agent_shared.go` and `runtime/chanmessaging.go`. Folding Orders onto them is
  the next clean-up, not done here.

**TypeScript findings (reported, not fixed).**
- `policyOf` (orders report) throws on settings with no payment block.
- `coerceIntent` copies a model's date and time without checking their shape. The router drops them, so a customer never meets it.
- `planMealsInSlot` takes off the excepted plan's meal without checking that the plan is lapsed.
- `itemsText`, `orderWhat` and `factsFor` throw on an item or plan type no longer in the settings.
- An Orders shop's help lines use Bookings' examples ("cancel b-14").
- The late-refund card says "deposit".
- A plan's waiting period payment cancelled by the owner through the assistant leaves the plan `awaiting_payment` for ever.

**Two checks the lead asked for.**
- dae22236 changed no shared code. It made `orders/channel.go` read `payments.UntoldRefund`'s existing `AmountPaise / 100`; `payments` is untouched, so Bookings' owner view
  reads the same numbers. The Bookings contract on Go confirms it (above).
- A possible Bookings bug, int date values from `bookings/parser.go` where the readers take float64, is not a bug. Both ways in (`readIntent` with and without the router)
  end in `coerce`, which writes the intent to JSON and reads it back, so every number is float64 before `fill` reads it.

## Branch go-fees-report-23nov: the Fees monthly report (Stream FR, 23 Nov 2026)

The Fees monthly report ("the monthly report" contract test, the last Fees test that failed on Go besides the assistant's two) is `internal/feesreport`, the Go twin of
`templates/education/fees/report/`. Read `internal/feesreport/Explanation.md` and `Deferred.md`.

**Built.**
- `internal/feesreport`: data (money from the books with old dues apart, waivers by who gave them, fees as they stand, reminders and receipts by template, stops at their sites, Classes
  counts), the sealed tree, the page, the owner's text (six lines with Classes), the WhatsApp message and its four templates, the signed summary (layout 4, 7 with old dues), the go-live
  reading, the files `writeFeesReport` writes, and the monthly job.
- `internal/report/reportkit.go`: the parts every template's report shares (tree helpers, the month's slice, the period, the by-action table, the message mechanics, the random token).
  `ordersreport` and `bookingsreport` keep their private copies for now (Deferred).
- `internal/reportwire`: the runtime.json `report` block, the messaging adapter, the job on a beat, the failure told once an hour (new; Bookings and Orders carry copies).
- `internal/fees/report.go` (new file), and three small edits to shared Fees files: a `Report` field on `Kit` (fees.go), the report after the licence notice in `AfterTick`
  (agent_after.go, in Orders' order: notice, return when stopped, report), and `cmd/fees/main.go` (reads the block, lists the report templates for the stand-in).
- Students' names: the report is given fees as `Due{Month, State, Payments, BalancePaise}` and settings with each student reduced to `{}`; the record is digested without notes or numbers.
  `names_test.go` scans everything Go makes for each name and number of 34 cases; the contract test reads every file of the report folder on both runtimes.
- TypeScript: `UPI_NOT_COUNTED` and `STOP_SITES` in `report/data.ts` are exported (nothing else changed there) for the words generator.

**Not done, and why:** see `internal/feesreport/Deferred.md` (the CLI's pieces, the sample message and the Meta list, the fold of Bookings and Orders onto the shared pieces).

## go-so-report-23nov (23 Nov 2026): the Stock orders monthly report on Go (stream SR)

**Built.** `internal/stockordersreport` (Explanation.md, Deferred.md there): the Go twin of `templates/commerce/stock-orders/report/` over the shared `internal/report`, proved on vectors
made by running the TypeScript (`scripts/gen_stockorders_report_words.ts`, `gen_stockorders_report_vectors.ts`, both with `--check`, both in words-fresh). Wired into `internal/stockorders` by
`report.go` (`NewMonthlyReport`, `Agent.AfterTick`, `OrdersOf`) and `settingstree.go` (`Settings.Tree`: the validated settings as the JSON tree the policy digest is of, proved against
`validateSettings` in `settingstree_test.go`); `cmd/stock-orders` reads runtime.json's `report` block. The owner's morning line over Stock orders now runs after the report
(`Agent.AfterTick`, the skill's `Waiting` and `Problems`).

**Shared changes (additions only).** `internal/runtime/reportwiring.go`: `ReadReportConfig` (config.ts `readReport`, `reportOptionsReader`, start.ts `monthlyReportSetup`),
`ReportMessagingOf` (the shop's messaging as the report package takes it, with its faults) and `ReportRecordOf`. Written once so Stock orders is not a third copy; Orders and Bookings
keep their own (fold them: Deferred.md of `stockordersreport`).

**Not ported:** the go-live certificate's builder (`report/certificate.ts`), which the CLI and the deployer run over the hand check; the runtime only reads a certificate, as Orders'
does. The deletion step must keep it or port it (Deferred.md). The assistant's talk reads and open list over Stock orders (stockorders/Deferred.md).

## go-orders-gaps-23nov: Orders gaps before the deletion (23 Nov 2026, stream OG)

Started from agents main 077371a6. The job was to give every Orders money path a test that will survive when the TypeScript runtime (and its unit tests) is deleted, to
fix W4's TypeScript findings on both sides, and to drop Orders' copies of Bookings code.

**1. Every money, limit, approval, licence or recovery behaviour that only a unit test in `templates/commerce/orders/test/` checked, and what holds it now.**

The new contract cases run on both runtimes. P is `contract/plans.contract.test.ts` and G is the new `contract/gaps.contract.test.ts`.

| unit test | behaviour | held by |
| --- | --- | --- |
| plans | the renewal: asked once, the carried credit taken off, paid by a mark | P (renewal) |
| plans | a renewal not paid in time lapses, charges nothing, the carried credit goes back; its one reminder | P (lapse) |
| plans | a cancel while the renewal's reminder is queued: no reminder, nothing charged | P (cancel while the renewal waits) |
| plans | a cancelled plan: open days cancelled, closed days kept, the unused part refunded (never carried as well) | P (cancel mid-month) |
| plans | a pause and a resume; the paused days credited once at the renewal | P (pause and resume) |
| plans | capacity: a second plan is not started on a full slot; a skipped day gives its place back | P (new case) and the existing slot case |
| plans | a renewal paid twice on a gateway shop: the second payment refunded | the same second-payment path as M's "a second payment on a paid link is refunded" (a renewal needs the test clock, a gateway payment the guards mode, and a shop has only one of the two) |
| plans | the ledger's pure rules (a pause spanning the renewal date credited in its own period, one credit per period) | only partly, through P. Left: a plans store-vector world in gen_orders_settings.ts |
| agent | the same order again keeps its one link; a changed order closes the old link and frees its stock | G |
| agent | a UPI mark of less than the advance does not confirm | G |
| agent | the month's AI cap: the model is left out | not covered for Orders. The cap is internal/budget's (shared). Left: a contract case with a spent allowance |
| assistant-acts | the owner's cancel above the refund limit is held by Guard; a waiting order's cancel closes its link; a big order's cancel; a kept advance refunded by a card, once; a UPI shop's cancel owes the refund | G (the paid cancel within the limit was already in O) |
| assistant-acts | the skill without acts only reads | not a runtime behaviour (a TypeScript object without its acts); Go always wires them |
| late-advance-card | the late advance is listed for 48 hours, or 14 days after "I have paid" | G (the late mark itself was in F) |
| late-advance-card | the assistant's card for a late advance; its yes is the same late mark | the mark is F's; the card's words are in the words vectors. Left: the card over HTTP |
| licence | Guard's own licence refusal (402) of the advance link | G (the wind-down and the final stop were in D) |
| reminder-balance | the balance marked once in cash; a customer's word and a UPI shop's "link" mark nothing; a full-advance order has no balance | G (the balance by link was in M) |
| slot-capacity | a slot's place given back by a cancel and by a hold that ran out | G |
| guard-outage | a Guard down past the 15-minute bound: the customer told once, the owner's to-do item | NOT covered on Go. HTTP cannot reach it: the bound runs on the real clock in guards mode and runtime.json cannot shorten it. Left: a runtime.json member for the bound (a shared change), or a Go agent test |
| money-clarity, full-chain, runtime | a Guard-held refund answered by the digest shown, the stale answer, the refund context | M and F, as before |
| channels | an MCP client cannot mark, approve or refund | modules/channels' front (a different component; its tests stay) |
| approvals-guard-binary, settings | Guard's threshold is the refund limit; the spec's bounds | the real Guard binary and the deployer's spec generator (they stay); M sees the threshold |
| limits, stock, report*, accounting-figures, ondc | pure functions | Go vectors made by the TypeScript (orders, stock, ordersreport), as the contract README maps them |

Go passed every new contract case as it stood. The W4 port of the plans and the agent's money paths was right.

**2. W4's TypeScript findings.** Each was fixed in the TypeScript and in Go the same way, with a test on both sides:
- **A plan's waiting payment cancelled by the owner left the plan stuck** (`awaiting_payment` for ever). flow.ts and plans.go `watch` now give up a period whose order was
  cancelled outside the plan, at the next beat: the period lapses, a first period's plan is cancelled, and a renewal's plan lapses with its carried credit owed back. Nothing
  more is said to the customer, because the owner's cancel told them. Test: G "the owner's cancel of a plan's waiting payment ...", which failed on the TypeScript before
  the fix.
- **`itemsText`, `orderWhat` and `factsFor` threw on an item or plan type no longer in the settings.** The TypeScript now names them by their id, as Go did (factsFor leaves
  a missing plan type's items unsaid, as Go's FactsFor does). Test: G "an item taken off the menu ...", which failed on the TypeScript before the fix.
- **`coerceIntent` did not check the shape of a date and a time.** The shape checks are now `isDatePhrase`/`isTimePhrase` in modules/language/dates.ts, and Bookings'
  model.ts uses them too: it had the same checks inline. The Go twins are `language.IsDatePhrase`/`IsTimePhrase` (new phrase_shape.go), used by both `bookings.CoerceIntent`
  and `reading.CoerceIntent`. Test: 24 hostile dates and times in gen_orders_reading.ts's coerce vectors, plus TestCoerceDateShape.
- **`policyOf` threw with no payment block.** It now writes the module as null, as Go did. Test: the no-payment tree's digest in gen_orders_report_vectors.ts, checked by
  TestPolicyDigestsAndNotTestedMatchTypeScript.
- **`planMealsInSlot` ignored a lapsed plan.** Not a bug: no caller ever passed its `except`. The dead parameter is removed on both sides. The inSlot vectors still prove the
  function.
- **Not changed (ownership): Orders' help lines with Bookings' examples ("cancel b-14"), and the late-refund card's "deposit".** Both live in modules/assistant/words.ts and
  gen_words.ts, which only stream FA may change.
  - The fix for the examples: Orders' own `key@orders` examples ("cancel o-14", "message o-14 Running 15 minutes late") for `cancel` and `message` in the help table and
    the "which one?" table.
  - The fix for the card: a `late_refund` entry in the card wording keyed by skill ("cancelled o-5 late. Refund the ₹120 advance?"), in four languages.

New findings (not fixed):
- A customer with no running plan who writes "cancel my plan" or "my plan" is read as subscribing. The shop quotes a new plan, or asks which one, instead of saying they
  have none (`readPlanIntent`). The same on Go.
- Bookings' Go settings reader says "Add how customers pay" for `"payment": null`, where the TypeScript's `readPaymentSettings` says "must look like". Fees uses the same
  reader.

**3. No duplicates.**
- Orders' `agent_watch.go` (213 lines) is deleted, along with `agent_say.go`'s owner route and page outbox (about 255 lines). Orders now uses `bookings.Watch`,
  `bookings.OwnerMessaging` and `runtime.ChannelMessaging`, wrapped in the same order as before. `bookings.Watch` gained `Do`, which Orders' settlement read needs.
- Not folded: the settings readers. The two Go copies differ in small ways (internal/orders/Deferred.md), so folding them needs a settings vector of each case first.

**4. The Deferred items a shop would meet** (the owner's daily notice that customer talk stopped, the tick's memory of one-time calls) are not done. Neither is small:
Bookings has neither, and both need a shared runtime hook.

**What passes.** These ran once at the end, through the heat lock, on the branch at e27c3051.
- The Orders contract on TypeScript (`ORDERS_IMPL=ts node --test --test-concurrency=1 templates/commerce/orders/contract/`): **94 of 94**, up from 75.
- The Orders contract on Go (`ORDERS_IMPL=go ORDERS_GO_BIN=go/bin/orders ...`): **94 of 94**.
- `go vet ./...` is clean, and `go test -count=1 ./...` passes (35 packages ok).
- `words-fresh.test.ts`: 21 of 21.
- The Orders and Bookings unit tests these changes touch (plans, agent, channels, papers, report-go-live, assistant-acts, late-advance-card, bookings parser): 77 of 77.
- The Bookings contract on Go: 151 of 151.
- Before the fixes, both findings cases failed on the TypeScript; after them they pass on both runtimes.

## go-fees-assistant-23nov (23 Nov 2026, stream FA): the shop's assistant on a Fees centre

Started from agents main 077371a6. The two Fees contract tests that failed on Go ("the shop's assistant on a Fees centre": "who owes fees" with a waiver card, and "cancel f-2")
needed the shop's assistant over a Fees skill. Built on W4's Orders pattern, through the one shared assistant (no third way of doing a skill):

- **internal/fees/agent_assistant.go**: assistant.ts feesSkill and agent.ts feesActs: who owes (the open fees past their due date), what waits (from the owner page's own
  list: a waiver or a refund a parent asked for, a UPI deposit to mark, a refund the owner owes), answered by the owner's own reply ("approve q-1", "deny q-1", the mark's button);
  cancel (the owner's waiver of the whole balance, after the record is read again) and refund (checked and sent as "approve q-4": Guard holds it above the limit, a UPI owner owes
  it) by card, bound to the fee's state, balance, payments, waiver and late fee; a message to a parent or a chat guest; the owner's talk's numbers (facts) and a parent's public
  context; the morning line (AfterTick), the owner page's `app` view and the page head's `character` (read-only skill over the last saved state). `sendOwnerRefund` now returns
  its result. The owner's talk box and a card's answer on the page go to the assistant (agent_page.go), and the owner's free words too (agent_talk.go, after Classes' words).
- **Shared changes** (Stream FA owns them; every other template is answered as before): `runtime.AssistantHooks.Fees` and `assistant.OwnerReading.Fees` (a Fees centre's kinds
  and router, generated); the "owes" kind and list and `OweSkill` (runtime/assistantowes.go), the morning line's Fees part (morning.go: only for a skill that is an OweSkill);
  the "@fees" profile for the help and "didn't get that" lines; `runtime.PrepareGuestMessage` (wire.ts prepareGuestMessage once, for any skill; Bookings' and Orders' own copies
  are left for the fold, internal/fees/Deferred.md). `go/scripts/gen_words.ts feesWords` renders the Fees words (help and not_understood @fees, owes_list.*, the waiver and
  refund-request cards, card.cancel.*@fees, card.refund@fees, refusal.already_back@fees and cancel_first@fees, morning.owes, kindsFees, routerFees);
  `gen_assistant_vectors.ts` adds Fees lines to the assistant line vectors (who owes in three shapes, the waiver, refund-request, cancel and refund cards, the help line).
- **New contract cases, both runtimes** (`templates/education/fees/contract/assistant.contract.test.ts`, 6): the money paths TypeScript proved only in test/assistant.test.ts
  and test/assistant-money.test.ts (a waiver card's Refuse; a cancel card void after a payment and the "cancel first" refusal; a refund card on a Razorpay centre held by Guard
  and released once, then "already going back"; a refund card on a UPI centre owed by the owner, and "more than was paid"; a message card; the morning line's fees not paid).
  6 of 6 on TypeScript before any Go (commit 69338221).

**TypeScript findings (nothing changed; pinned as they are on both runtimes).** (a) A Fees cancel card reads "Cancel fee f-2 (Rohan Mehta, Sep 2026)? Nothing is owed." while it
waives the whole balance: assistant.ts prepareMoney shows amount 0 ("a cancel refunds nothing"), so SKILL_ASK.fees takes its no-balance sentence; the card should show the balance
it waives ("... and waive the ₹1,800 balance? No money moves.", which words.ts already has). (b) After that cancel's yes the owner reads "Done: ₹1,800 is on its way back to Rohan
Mehta (f-2)." although no money moves: conversation.ts words a cancel with `fields.amountPaise > 0` as "refund_sent", and the Fees cancel binds the balance in that field; a Fees
cancel should say "Cancelled f-2.". (c) "refund f-2 ₹2,000" above the payment answers "That is more than was paid on f-2 (₹0)." (the Fees skill's too_much refusal carries no
`paidPaise`). (d) Help and "which one?" lines on a Fees centre gave Bookings' examples ("cancel b-14"), as OG found for Orders: fixed with OG's two below.

**OG's two Orders findings, fixed on both sides (the lead's note; words.ts and gen_words.ts are this stream's).** (1) An Orders shop's help, "didn't get that" and "which
one?" lines named a Bookings case ("cancel b-14"): words.ts now takes the shop's own skill (`skill` on help, not_understood and need_ref; conversation.ts passes the
template's skill, first in wire.ts's order) and EXAMPLE_REF names its kind of case ("o-14" for Orders, and "f-14" for Fees, the same fault); only the reference changes, so
the translated words stay. Go: the @orders/@fees help lines and new `need_ref.<kind>@orders|@fees` keys, read through `conv.ownKey`. (2) An Orders shop's late-refund card
said "deposit": SKILL_ASK.orders words it "Ravi cancelled order o-5 late. Refund the ₹120 advance?" in four languages; Go reads `card.answer.late_refund@orders` (cardQuestion
looks for the skill's own answer key first). Tests: modules/assistant/test/words.test.ts (two new tests, every language) and the assistant line vectors (help@orders, three
"which one?" lines, the Orders late-refund card, in four languages; run by internal/runtime TestAssistantLinesAreTheTypeScriptsAndTheirCheckToo).

**Measured at the end (on the branch merged with main 4421c2f5: OG, FR and SR in; through the heat lock).** Fees contract **73 of 73 on Go and 73 of 73 on TypeScript**
(assistant.contract.test.ts 6 of 6 on both); Orders contract 94 of 94 on Go and on TypeScript; Bookings contract on Go 151 of 151; listings 208 of 208 (words-fresh included);
modules/assistant/test 110 of 110; `go vet ./...` and `go test ./...` clean; `gen_words.ts --check` and `gen_assistant_vectors.ts --check` fresh. The Fees morning line runs
after FR's monthly report in AfterTick. internal/fees/Deferred.md still lists the monthly report as not ported: that row is Stream FR's to remove.

## go-cleanup-23nov (Stream CL: one copy of each shared piece, and the record digests)

**1. One report wiring.** `internal/reportwire` is the one copy (Fees' Stream FR piece), chosen over `internal/runtime/reportwiring.go` because it also holds the beat's `Runner`
and the hourly `FailureLog`; the runtime's file is deleted. Bookings (`books.go`, `agent_after.go`), Orders (`agent_after.go`, `books.go`) and Stock orders (`report.go`) now keep only
what is theirs (the settings tree, the bookings/orders the report reads, a `ReportTick` and a `Run` that binds them); their copies of the `report` block reader, options reader,
messaging adapter, record adapter, failure log and fault mapping are deleted. `reportwire.Setup` gained `Token` (the test seam for a report folder's name). `Books.ReportMessaging`
is gone (the messaging adapter always uses a background context now; `BooksPorts.Context` still serves the settlement read). The adapter tests moved to `reportwire/reportwire_test.go`.
In the report packages: the go-live sentences, block and file reader (`report.GoLiveLines`, `GoLiveBlock`, `ReadGoLiveFile`, `WhenText`), the by-action table, tree and count,
`PeriodOfRange`, `SplitMonth` (Orders, Stock orders; Bookings keeps its own because its TypeScript builds a `Map` where a repeated seq keeps the last time), `ISOOf`, `Decision`/`DecisionsOf`,
`NonEmpty`, `RandomToken`, the tree helpers and `BuildMessage` (the WhatsApp message mechanics) are `internal/report`'s; the packages' copies are deleted. Every report vector `--check`
passes unchanged except the three whose digest changed on purpose (item 3).
**2. One `PrepareGuestMessage`:** Bookings and Orders call `runtime.PrepareGuestMessage` (as Fees does); their copies are deleted.
**3. Record digests.** Decision: Fees was right. A note is free text that can name a person, and the record's own chain already leaves `notes` out (modules/record/ledger.ts), so the
digest now leaves out `conversation` and `notes` in all FOUR templates (Stock orders' TypeScript also kept notes), in TypeScript (`entryDigest` in the three data.ts files) and in Go
(one `report.EntryDigest`; `bookingsreport.EntryDigest` and Fees' copy deleted). Tests: a new test in each template's report test (TypeScript) and `report/entrydigest_test.go`; vectors
regenerated for Bookings, Orders and Stock orders (Fees' unchanged). **Effect on old months:** a past month's sealed report file is never rewritten and no verifier recomputes a record
digest from the record, so sealed files stay valid. A report rebuilt for an old month from a record that has notes would carry a different `record.digest` than the sealed one.
`refs.page` stays in the digest (a 128-bit random folder name cannot be guessed from a digest).
**4. The Bookings sample report** was regenerated with `templates/commerce/bookings/scripts/sample-report.ts`; `sample-report.test.ts` passes. **The website's copy** (public-web
`npm run sample:pull`) needs the owner to pull the new `report-2026-11*.{json,html}` and `manifest.json` and deploy; I did not touch public-web.
**TypeScript findings.** (a) Bookings' `record.digest` is over the month's rows; Orders, Fees and Stock orders digest the whole record: left alone, worth a decision. (b) Bookings'
OwnerText keeps a local `nonEmpty` closure, and Bookings counts by action inside its rows loop: not folded (no behaviour reason, small).
**Owner routes folded (after merging main with SG's e4093b05):** `cmd/bookings`, `cmd/orders` and `cmd/fees` use `rt.OwnerPush` and `rt.OwnerRoute` (`runtime/ownerroute.go`); their 25-line copies are deleted. **Deferred.** Not folded, still copies of one thing: `sealWords`, `e`, `fign`, `amountCells`, `pair`, `NotCheckedList`
and each package's `Fill`/`StringsOf` (they read each package's own generated strings type).


## go-stockorders-gaps-23nov: Stock orders gaps before the deletion (23 Nov 2026, stream SG)

Started from agents main 3d1cd970. The job: give every money, limit, approval, licence, recovery and stock-count behaviour of Stock orders that only a TypeScript unit test checked a
check that survives the deletion of the TypeScript runtime and its unit tests; fix the TypeScript findings on both sides; port the parity items a shop would meet.

**1. What held each unit-only behaviour** (`templates/commerce/stock-orders/test/`, `modules/stock/test/`). G is the new `contract/gaps.contract.test.ts` (both runtimes). V is a Go
vector made by running the TypeScript (`go/scripts/gen_stockorders_*.ts`, words-fresh keeps them fresh).

| unit test | behaviour | held by |
| --- | --- | --- |
| agent, channel | request, card, one approval, the supplier's OK is not receipt, button taps, a card that ran out, the page's items and digests, a stale press, a delivery to mark | F, O, T (as before) |
| agent | words it cannot read get examples, never a guess | F; V (30 phrases read) |
| limits, runtime | approved supplier, quantity, cap, budget in paise with the limit itself allowed, one order per request, approval matches, reply from the supplier's own number, send only when approved | L, F (as before); V (money written plainly or with two decimals) |
| chat-limits | the budget cannot be set below the cap or loosened; a value inside the bounds makes a card, and its yes puts it in force | G (budget bounds) |
| chat-limits | the cap cannot be set below the dearest line | NOT covered by the contract: every English word that names the cap contains "order", so the shop's own reader takes the sentence for an order request (both runtimes alike); the cap is reached only through the owner's limits page behind a passkey. The bound itself is `Kit.Limits` in Go and `src/chat-limits.ts` in TypeScript (the unit test stays with the TypeScript until the page is on the contract) |
| chat-limits, settings | the limits are whole rupees; every settings sentence; a null or wrong `assistant` block | V (settings-vectors: 84 files through `validateSettings`, sentences in order, the checked tree) |
| assistant | the skill's reads (`facts`, `publicContext` for a supplier, a stranger, nobody), open, waiting, problems | V (skill-vectors, an order in every state, en/hi/ml) |
| assistant | prepare: a cancel only for an order that has not gone out, no money moving; an answer bound to the agent's own card's action; a limit is the limits skill's | V (skill-vectors: five proposals on every order and on a missing one) |
| assistant | one card per order, a tap approves once, never stranded, a limit card reaches the assistant | A, T (as before) |
| stock | goods received raise a counted item once per order; twice adds once; another unit not added and said once; an item nobody counts untouched | O (as before) |
| stock | a low mark starts one reorder, one per crossing even if cancelled | O (as before) |
| stock | an item with two suppliers asks which, once; the answer makes one card for the line's reorder quantity | G |
| stock | a low question waits while the owner is in the middle of another, and is asked after | G |
| stock | an owner who never answers is asked three times and left alone | G (fakes, the test clock) |
| stock, kit (modules/stock) | the count's rules: a sale once, a cancel gives back, never below 0, a delivery as a cumulative total, a unit never converted, history before counting began, holds, the tidy, the low alerts and their ids | internal/stock vectors (as before); `pendingAlerts` copies: a unit test on both sides |
| send-once | the happy path once; the intent holds the id, supplier, template and order; refused once then Try now; three refusals; Cancel order; a lost reply and its three endings; the supplier's OK settles it; killed on the wire | R, G (the intent's fields) |
| send-once | a refusal tried again "an hour later"; a reminder left claimed is never sent | NOT covered by the contract: a fakes shop has no Guard to refuse on the test clock. Shared code, `internal/messaging/sendonce_test.go` |
| runtime | the store round trip, the po-N counter across a restart, a step that fails before the send runs again, runtime.json must name WhatsApp | D, R, S (as before) |
| language | every template renders and passes the outgoing check in four languages; WhatsApp template bodies start and end with fixed words and fill back | V (messages, and now every message's template name and parameters) |
| language | no banned word | the words are generated from the TypeScript source, whose test stays with it |
| guard-limits, hand-check, review-sheet, runtime-imports, sell-guide, report* | the deployer's Guard spec, the hand check and its certificate builder, the review sheets, the sell guide, the monthly report | they stay (the deployer and the TypeScript tools); the report has its own vectors |
| modules/stock stock.test | only the owner starts, corrects or stops a count; customer-facing code never imports the module | structural tests of the TypeScript module, which stays; Go has no such path (the types make it) |
| modules/stock kit.test | the page's op shapes and sentences | the Stock page cases in O (an op that starts, corrects, sells, stops) |

**2. TypeScript findings, fixed on both sides.**
- **Owner notices outside the 24-hour window that have no template went as the generic `stock_owner_notice` with no parameters, which a real provider refuses.** Added a template
  each (with its values) for the supplier's STOP, a card that ran out, the four endings of the order's send (went, may not have reached, refused, held back) and a receipt (all, part):
  eight in `src/language/meta-templates.ts` (`stock_owner_supplier_stopped`, `..._card_expired`, `..._order_sent`, `..._order_unconfirmed`, `..._order_refused`, `..._order_held`,
  `..._received_all`, `..._received_part`), in four languages, in `whatsapp-templates.json` and the review sheets. Not given one on purpose: the replies to something the owner just wrote or
  pressed (approved, declined, cancelled, paid-outside noted, "not open", "too many", the status), where the owner is in the window and the page shows the same. Go reads the templates
  from words.json (generated); G holds a reorder card, its approval, a receipt and a STOP as templates, and a lost reply as its own, and V holds every message's template and
  parameters.
- **`lowStockTick` read the question count from the queue's own alert.** `pendingAlerts` now hands back copies (as the Go twin always did) and the tick uses what `noteAsked` returns.
  Test: a unit test in `modules/stock/test/stock.test.ts` and `TestPendingAlertsAreCopiesAndNoteAskedCounts` in `internal/stock`.
- **The order card quoted its code ("yes CODE") and the assistant's limit card did not.** The order card (four languages) now says `reply yes CODE` as the limit card does (the shared
  line in modules/assistant/words.ts is every other template's; Orders, Bookings and Fees never quoted it). The quotes had been the only thing keeping the body from ending in a value,
  which Meta refuses, so it now ends "... or use the other button" (four languages). The harness and three unit tests read the code without quotes.
- **New finding, fixed on both sides: Go skipped an `assistant` block that is `null`;** the TypeScript refuses it ('"assistant" must be an object ...'). Found by the settings vectors;
  the Go reader now uses the shared assistant-block reader (bookings.SettingsReader.Assistant, the one Fees uses), which also deleted its own 50-line unchecked copy.

**3. Parity items ported** (internal/stockorders/Deferred.md has what is left).
- The assistant block's own error sentences and the settings: V (84 variations of the example through `validateSettings`).
- The assistant's talk reads (`facts`, `publicContext`) and the open list: skill.go, held by V. The routing words are not ported (Deferred.md says why).
- The owner's push: an owner message goes by the owner's choice of WhatsApp, push or both (`runtime.OwnerPush`, `runtime.OwnerRoute`, new in `internal/runtime/ownerroute.go`; the
  three other commands each still hold the same 25 lines: Shared changes). No contract case: the contract has no push Guard stand-in.
- Waiting for a Guard that is down inside a step: the step's watch (`bookings.Watch`, shared) wraps the owner's route; a task's step waits and a tick only observes; G holds the
  owner's message kept while the WhatsApp Guard is down, nothing answered meanwhile, one answer when it is back (it was a refusal of that one message before).

**Shared changes (additions only).** `internal/runtime/ownerroute.go` (new): `Runtime.OwnerPush`, `Runtime.OwnerRoute`. `modules/stock/stock.ts` `pendingAlerts` copies (the
Orders agent also reads it: it never relied on the queue's objects). `templates/commerce/listings/contract/words-fresh.test.ts`: one test for the two new vector files.

**Measured at the end (through the heat lock, on this branch).**
- Stock orders contract (`STOCK_ORDERS_IMPL=ts|go node --test --test-concurrency=1 templates/commerce/stock-orders/contract/`): **71 of 71 on TypeScript and 71 of 71 on Go** (63 before, plus the 8 cases of gaps.contract.test.ts).
- `go vet ./...` clean; `go test ./...` clean (internal/stockorders: vectors, skill vectors, settings vectors; internal/stock).
- TypeScript unit tests (templates/commerce/stock-orders/test, modules/stock/test) and words-fresh (listings contract): all pass; one assertion of language.test.ts (a template with no value in it) was relaxed for the card that ran out and re-run alone.
- Not run: the Bookings Go contract (nothing of Bookings was changed; only its exported settings reader is now called from Stock orders).

## go-fees-gaps-23nov: Fees gaps before the deletion (23 Nov 2026, stream FG)

Started from agents main 3d1cd970. The job: before the TypeScript Fees runtime and its unit tests are deleted, give every money, limit, approval, licence, recovery and privacy
behaviour that only a unit test checked a check that runs on both runtimes; fix FA's and wave 3's TypeScript findings on both sides; close the Deferred items a centre would meet.

**1. The owner is told what really moved (FA's findings, fixed in TypeScript and Go, a test on each side).**
- A cancel card read "Nothing is owed." while it waived the whole balance: it now shows the balance ("Cancel fee f-2 (Rohan Mehta, Sep 2026) and waive the ₹1,800 balance? No
  money moves."). The cancel's action carries the balance only as `balancePaise`, so the done line is "Cancelled f-2." instead of "₹1,800 is on its way back" (conversation.ts
  words a cancel with an `amountPaise` as a refund). A card still open from before the change is void on its tap and made again (its action no longer matches).
- "refund f-2 ₹2,000" answered "more than was paid on f-2 (₹0)": a refusal may now carry `paidPaise` (skill.ts; Go `Prepared.RefusedPaidPaise`, `conv.refusalPaid`), and Fees
  passes the payment it would come from ("(₹1,800)").
- Tests: owner.contract (the card's words, "Cancelled f-2.", no refund call), assistant.contract ("(₹1,800)"), test/assistant-money, the assistant line vectors (the cancel card
  with its balance, four languages).
- Left as it is: "Cancel fee f-2 (...)? Nothing is owed." (SKILL_ASK.fees with no balance) can no longer be shown on a Fees centre (a cancel with no balance is refused as
  not_live); it stays in words.ts with its vectors. A cancel of a balance that is not whole rupees is refused as "too_much", whose sentence ("more than was paid") does not fit
  it; rare (a gateway part payment in paise), noted, not changed.

**2. Every unit-only behaviour, and what holds it now.** G is the new `contract/gaps.contract.test.ts` (17 cases, both runtimes); V is the new Go vectors
(`go/scripts/gen_fees_vectors.ts` -> `internal/fees/testdata/rules-vectors.json.gz`, run by `internal/fees/rules_test.go`); other names are the contract's files.

| unit test | behaviour | held by |
| --- | --- | --- |
| agent | fees open at the first reminder moment at the batch's fee; twice opens nothing; the reminder days, words and cap; a month first seen late is not chased | month; V (schedule, reminder-cap) |
| agent | a payment event for a link the centre never made is ignored | G |
| agent | a refund event is checked against the payments service's own list | razorpay (the webhook only makes the agent look) |
| agent | Guard's 409 already_done: done by a person's word, recorded with who, the owner told, never sent again | G |
| agent | a paid fee never opens again (no reminder after a payment, even after a refund) | partly: G (a refund refused at Guard leaves the fee paid), razorpay. Left: a beat after a refund on a fakes centre (fakes cannot be paid over HTTP) |
| agent | a payment at the exact moment of a reminder is read first | NOT covered: needs a fakes payment at the reminder moment; the fakes take no payment over HTTP |
| agent | button mode, the month's AI cap | not on Go: Go reads by the rules only (the model steps are Deferred), so there is nothing to switch or cap |
| assistant, assistant-money | who owes; a waiver's Approve and Refuse; cancel by card, its second tap, void after a payment; not open; nothing paid; busy; never cash; refund held above the limit, once | owner, assistant, G |
| cash-part | a part in cash, the rest later, a stale digest | upi ("paid another way?") |
| cash-part | not whole rupees, nothing, more than owed: nothing marked | G |
| channels, page-link, parent-push | a parent's link opens only their students; only its hash is kept | parent, month, record. Parent push: not ported (Deferred) |
| chat, chat-parent, talk | the public chat; the talk is given "your child" | chat, record |
| chat-parent | a parent's own chat (W2): only their open fees, nothing to WhatsApp, no payment request; a public guest reads no fee | G (ported to Go in this stream, agent_parentchat.go) |
| classes | class-access (paid or within the grace days), consent, attendance and the note, doubts, the material | classes; V (checkClassAccess, isPastGrace) |
| classes | a back due with and without oldDuesStopLink | V; G (the material closed with the stricter rule, open once paid) |
| classes | STOP: no class link and no question | G |
| family-and-joining | the part-month sum under every rule; a student not joined yet | V (feeForMonth, parseJoined) |
| family-and-joining | joiningMidMonth prorata end to end (once, due on the joining day, no late fee yet) | G |
| family-and-joining | back dues: a fee of their own, opened once, one message for a family, each paid on its own link | every guards centre (two back dues), month (one reminder a family), razorpay (f-2.1 settles f-2 only); V (the back due's reminder moment, the settings' back-due sentences) |
| full-chain | the month, a payment, restarts, a waiver above the limit, a refund held and released | month, razorpay, upi, cross-restart |
| full-chain | a refund the owner refuses at Guard is never sent; the parent is told | G |
| full-chain | a forged webhook | the inbox's signature check (modules/inbox; its tests stay) |
| guard-outage | the payments Guard down: the step waits | razorpay |
| guard-outage | the WhatsApp Guard down past the 15-minute bound | NOT covered, as for Orders (OG): the bound runs on the real clock in guards mode and runtime.json cannot shorten it |
| licence | the wind-down: nothing new, a parent told; the final stop closes links once; the owner's notice once | owner |
| licence | a payment on a link sent before the wind-down is counted and receipted | G |
| licence | Guard's own 402 for the licence: each link asked once, nothing reminded, the parent told | G |
| limits | the link is for what is owed; one refund a payment; the waiver limit and never more than owed; the reminder cap; 'received' only when recorded | razorpay, upi, month; V (every check's verdict and words) |
| limits | no reminder when the payment record cannot be read | NOT covered over HTTP (a record read that fails cannot be made from outside); Go's checkNoReminderOncePaid reads the step's record |
| limits, approvals-guard-binary | the Guard spec, its threshold, the in-process Guard model, guard-spec.ts | the deployer's spec generator and the real Guard (they stay); the threshold is seen in razorpay |
| money-clarity | a bank transfer; a cash mark from the page | upi |
| money-clarity | a gateway centre's cash mark closes the open payment link | G |
| money-clarity | a refund Guard holds on the owner's page, answered by digest | modules/channels' relay page (not the runtime; its tests stay) |
| recovery | recheck_payment counts a payment the webhook never brought | G |
| recovery | ask_owner_again | owner |
| recovery | a recovery that does not fit (nothing waits, no refund problem, a Bookings action) | G (and smoke: a fee that is not there) |
| recovery | "move CODE" from the owner: one line with the code's hash, no reply; a parent's same words are nothing | G (ported to Go in this stream) |
| runtime | restarts; every field saved; a task saved and not run is run; status counts only | month, cross-restart, record, smoke |
| runtime | a step cut off mid-way finds its own payment link | NOT covered: needs a crash inside a step |
| settings | the examples valid; every mistake in plain words; the payment block | V (26 files: every sentence in order, the checked values); smoke (one refusal stops the start) |
| upi | a restart keeps the UPI ledger | cross-restart, record |
| papers, accounting-*, report*, old-dues-report | the statement, the receipts, the books, the report | parent (documents); the accounting and feesreport vectors (stream FR) |
| situations, sell-guide, walkthrough, review-sheet, runtime-imports, language | the hand check, the guides, the words in four languages | not runtime behaviour, or the words vectors (gen_fees_words, words-fresh) |
| voice-notes | a voice note | not on Go (voice is Deferred): the one line asking to type |

**3. The Deferred items a centre would meet.**
- Done: other approvers (B37: Geo-Requested-By on the owner's refunds, an approver's relay reply left alone; G), the daily settlement read (each day once; G), the handover code and
  the shop terms (G; internal/runtime ownerwords.go, onto which Bookings' and Orders' copies of the terms adapters and Orders' handover code were moved and deleted), the settings'
  sentences proved on vectors (V), a parent's own chat (W2, agent_parentchat.go; G), and the public chat's talk (Go never let the shop's talk answer the public chat; it now does
  as agent.ts onChatTurn does, when the assistant is on).
- Not done, with the reason in internal/fees/Deferred.md: the model steps of reading (no contract case gives Fees a model; the router, the budget and its record lines are a step of
  their own), the button-mode notices (they wait for the model steps), the retention of confirmation pages and chat (the shared runtime has no daily compaction hook yet), and
  voice (internal/voice fits, but hearing a note needs the listener wired into the step and a speech service case).

**4. TypeScript findings fixed on both sides.**
- A parent who had never written got replies in the centre's first language: languageOf now falls back to the language the settings give that parent's students before the
  centre's first (agent.ts and agent.go). razorpay.contract now expects "Nothing is due from you right now. Thank you!" for Rohan's English-speaking parent; voice-notes.test.ts
  reads the same chain.
- Bookings' Go settings reader said "Add how customers pay" for `"payment": null`: `payment` takes `given`, so null gets the TypeScript's shape sentence (a vector each for null
  and left out in gen_bookings_settings.ts; Fees' file gets the same through `SettingsReader.Payment(v, given, path)`).

**New findings (not fixed).** Bookings' and Orders' skills also refuse "too_much" with no `paidPaise`, so their owners read "(₹0)" too; the field is now there for them to pass.
Bookings on Go still has no handover code (agent_flow.go TODO); ownerwords.go is ready for it.

**What passes.** These ran once at the end, through the heat lock, on the branch merged with main e4093b05 (stream SG in).
- The Fees contract on Go (`FEES_IMPL=go FEES_GO_BIN=go/bin/fees node --test --test-concurrency=1 templates/education/fees/contract/`): **93 of 93**, up from 73 (gaps.contract.test.ts
  holds 20 cases). On TypeScript (`FEES_IMPL=ts`): **93 of 93**. gaps.contract.test.ts was green on TypeScript before any of its Go was written.
- The Bookings contract on Go: 151 of 151 (its settings reader and terms adapters changed). The Orders contract on Go: 94 of 94 (its handover code and terms adapters moved).
- `go vet ./...` clean; `go test -count=1 ./...` passes (internal/fees now has rules_test.go: five tests over the TypeScript-made vectors).
- Every go/scripts generator with `--check` is fresh; words-fresh 25 of 25.
- The TypeScript unit tests these changes touch (fees assistant-money, voice-notes, family-and-joining, agent, recovery, classes; modules/assistant/test): 174 of 174.

## The switch: Bookings, Orders, Fees and Stock orders on Go (24 Nov 2026, `go-switch-24nov`)

**The switch.** The four templates are 0.2.0 and their `template.json` says `"runtime": "go"` with its program (`bookings`, `orders`, `fees`, `stock-orders`); the Go `Version`
constants say 0.2.0, and `GO_PROGRAMS` (bundle/lib/go-build.ts) builds all seven programs into the one image (`bundle/test/go-runtime.test.ts` names the seven and checks the
compile command and the image's context, with no image built). A shop moves to Go only when it takes 0.2.0 (`geometer update`); a shop pinned to an older version runs on
Node from a kept checkout beside the server, exactly as before. **The last commit that carries the Node runtimes is 6a51bf7a**: a kept 0.1.0 checkout comes from there. The
version is in the papers, so the report words and vectors of the four templates and the Bookings vectors were generated again, and the Bookings sample report was made
again (new digests and code: public-web's copy, `npm run sample:pull`, is behind until it pulls). Bundle and panel tests that pinned the checkout at 0.1.0 pin 0.2.0; the
update, rollback and kept-version tests move to 0.3.0; the update-to-Go tests start a shop on a kept Node 0.1.0 and move it to today's 0.2.0.

**The demos held to the Go shops** (`contract/differential.test.ts` in each template, one comparer in `modules/test/contract/demo-differential.ts`): the public demo's own
world (src/harness.ts createWorld, what demo/ and modules/demo/quick.ts run) and a Go shop as a separate process walk the demo's own paths step by step, and every WhatsApp
message to the customer and the owner is compared whole (kind, template, words, the ids and titles of buttons and list rows) after each step; a step that sends nobody
anything fails, and a changed word is shown to be a difference. Normalised are only things random per run (a payment link's id, a page link's handle, the owner's UPI code,
an approval card's code). Results, all passing on Go: **Bookings 4** (the four languages: the chips, the deposit paid once and twice, a pick from the list, cancelling, Talk
to the owner, yes), **Orders 4** (the menu, a menu tap, the order chip re-dated to the day after tomorrow on both sides, I have paid, the owner's received, Talk to the
owner, a cancel), **Fees 8** (the first morning on the demo's own clock and centre: a fakes Go centre's printed reminders against the demo's world; and the visitor's
steps on a guards centre: a reminder's link paid, I already paid, STOP; the second walk uses an earlier unpaid month for the demo parent's child and is skipped, saying
so, before 06:00 in India), **Stock orders 4** (no demo page: the hand check's paths, a reorder, its approval, the supplier's OK, two refusals, a unit picked). No
difference between a demo and its Go shop was found, so no template's deletion was stopped.

**Not compared with the demos (listed here as the differential headers promise):** the WORDS sent when time passes (Bookings: the hold that lapses, reminders, done, held by
go/internal/bookings/testdata/scenarios-vectors.json and flow.contract; Orders: the lapsed hold, the reminder before the slot, done; Fees: the later reminders and the late
fee; Stock orders: the supplier asked again, the month turning over). A guards shop cannot take the test clock and a fakes shop keeps no outbox to read, so each contract
walks those on the Go shop through the record and the pages, not the words. Also not walked: Bookings' owner approve/deny (the demo's shop never holds a refund above the
limit; money.contract walks it).

**Deleted (TypeScript: -14,181 / +1,162 lines since 6a51bf7a, net -13,019; 87 files, 11,879 lines, of which 42 code files 5,104 and 45 test files 6,775; the rest trimmed from kept tests and files; added: the four differentials, their comparer and agent-runtime.ts, 501 lines; Go: the four Version constants):**
- each template's `server/` main, start, runtime, services (and Bookings' events, tasks, ticker, server re-exports; licence for Bookings, Orders, Fees; Fees' materials),
  `src/adapters/live/index.ts` of Orders, Fees and Stock orders, `scripts/local-stack.ts` of Bookings, Orders and Fees with `test/full-chain.test.ts`, `test/runtime-kit.ts`;
- modules: `runtime/` core, http, start, main, ticker, owner-file; `assistant/` morning, understanding (and the functions of `app/view.ts`, whose OwnerAppView shape the
  front reads stays); `channels/` chat-identity-http, chat-link-send; `licence/notice.ts`; `terms/reader.ts`; `runtime/test-clock.ts` keeps only its two names;
- the unit tests of exactly those files. Bookings (the class-a rows of contract/README.md, each with the contract file that holds it): accounting-pages, approvals-runtime,
  channels, chat, guard-outage, last-slot, limits-runtime, money-clarity, owner-signin, restored, runtime, server, start, ticker, unknown-outcome, without-whatsapp;
  Orders: accounting-pages, channels, chat, guard-outage, last-item, money-clarity, runtime-imports; Fees: accounting-pages, channels, chat, chat-parent, guard-outage,
  money-clarity, parent-push, runtime-imports; Stock orders: runtime, runtime-imports (runtime-imports checked the Node container's two mounts, which a Go shop has not);
  modules: morning, owner-file, owner-signin-told, limits-http, shop-protocol-http, chat-identity-front; bundle: terms. From files that also test kept code only the tests
  that needed the runtime went (Bookings ai-mode, capacity, config, licence, recovery, report-monthly, report-monthly-config, store, voice-note, assistant; Orders runtime;
  Fees classes, licence, runtime; Stock orders send-once; modules app, intents, chat-identity, owner-signin, statuses, guard-wait, runtime, terms; bundle fees-shop,
  owner-file, self-hosted-model).

**Kept, and why:** `server/config.ts` (the deployer's runtime-config check, `pinnedRuntimeCheck`; `PATHWAY` moved here, the panel reads it), `server/snapshot.ts` (the panel
and the bundle read stores), `server/store.ts` (`geometer update` reads `SCHEMA_VERSION` from it by path, `savedDataLayout`: without it a move would lose its saved-data
layout check), all of `src/` (the demos' engine, and what the panel, the hand checks and the generators read), report code, crash-test, scripts the tests name, every
generator, the inbox and relay (they run as the bundle's services), and in modules what the deployer, the bundle's services, the generators and the harnesses read
(runtime config, store, snapshot, events, tasks, guard-wait, services, restored, shop-key, shop-protocol). Stock orders keeps `report/certificate.ts` and the hand check.

**Tests that kept running on another fixture:** the approvals relay's tests (Bookings approvals-relay, -card, -group, and approvals-guard-binary of Bookings, Orders and Fees
against the real geo-guard, and bundle approvals-group) needed "a runtime" for the relay to call. Their runtime is now the template's own agent driven in process
(`modules/test/agent-runtime.ts`: each event once by the runtime's event key, a beat on demand, the refund counts /status gave, and the relay's two calls answered from the
agent's store). The relay's REAL client to a shop (`createRuntimeClient`, what bundle/services/relay.ts runs) is held against the Go shops by the contracts: Bookings
limits-approvals (the context, a missing one, and every decision through it), Orders money and Fees razorpay (the context and the approval through it). All 42 relay
tests and every real-Guard test pass. The
live adapters' glue (Bookings `src/adapters/live/index.ts`) moved to `test/helpers/live-adapters.ts`: only the stand-in, dev-forwarder, inbox end-to-end and Guard-answer
tests use it now. The Orders reading vectors harvest strings from the tests; the 693 phrases of the deleted tests are kept in
`go/scripts/vectors/orders-reading-kept-phrases.json`, so the vectors are unchanged.

**The contracts:** each harness drops `<TEMPLATE>_IMPL=ts` and the TypeScript start (the variable may still say go; without the binary every test is skipped and says so);
each cross-restart test (TypeScript then Go, and back) is a Go-to-Go restart.

**Found:** the Orders contract's "a bakery that takes the whole order up front" failed when run after 18:00 in India (its guards shop ordered two days ahead, past the
bakery's cut-off of 18:00 two days before: a time-of-day dependence of the test, not of the shop); it orders three days ahead now; the three approvals-guard-binary tests name the monorepo's geo-guard by a home-folder path when GEO_GUARD_BIN is not set (as before).

**Not done:** the inbox end-to-end through a whole local stack (the deleted local-stack/full-chain ran stand-ins, inbox, runtime, stub Guard and relay in one process; their
refund and restart cases are in the contracts' L and R, and e2e.test.ts still runs the inbox against the stand-ins), the chat identity front against the runtime's routes
(chat-identity-front.test.ts; the runtime side is the contracts' C), and a customer's web push (the Go programs do not push a page's message to a customer or a reminder
to a parent: go/internal/bookings and fees Deferred.md, before this stream; the deleted Fees parent-push and Bookings without-whatsapp tests held it on the TypeScript).
Four tests that the cut took by pattern are back on another fixture: bundle fees-shop's export of a Fees centre (now of the file a Go centre wrote: names and numbers
hashed, the ledger the centre's own), bundle owner-file's deployer pass, bundle terms (the handed file read as JSON), and the Fees materials' confinement (a hidden
file and a link out of the batch's folder are never handed out: classes.contract.test.ts). bundle/Deferred.md has each with what would close it. The two tests of bundle self-hosted-model that
priced a self-hosted model's call on the TypeScript runtime are a Bookings contract case now (chat.contract.test.ts: priced at the builder's rate, 0 kept as 0, no rate
no price), passing on Go.

**The run of record (24 Nov 2026, through the heat lock, the Go programs built from this branch):** `go build/vet ./...` clean, `go test ./...` 39 packages ok; the contracts on Go
(`node --test --test-concurrency=1 <folder>/`): Bookings 155/155 (151 + the four differentials + the self-hosted model's price, - the second cross-restart), Orders 97
(96 on the whole run after 18:00, the bakery case's cut-off; with its day moved it passes, rerun with the relay-client cases: 40/40 of the four changed files), Fees 100/100,
Stock orders 74/74, listings 210/210 (with words-fresh), directory 36/36; every generator fresh (`--check`); the units of every template and module
(`node --test templates/*/*/test/ modules/*/test/ modules/test/`) 2,285: 2,284 pass, 1 skipped; the bundle (`cd bundle && node --test test/`, with GEOMETER_MONOREPO set, so
the 13 tests that need the monorepo run) 725: 716 pass, 9 skipped (REAL_CADDY), 0 fail (two tests that ran past the pass's 180 s test timeout pass without it); the
panel 253: 252 pass, 1 skipped.


## e1-discounts-24nov: E1, the discount authority (24 Nov 2026, decision 64)

The first enhancement after the switch to Go, built once in `internal/discounts` and used by Bookings and Orders. The design is in `internal/discounts/Explanation.md`, and what is left is in its `Deferred.md`.

- **Off by default.** A shop with no `discounts` block refuses every price below the list exactly as before. Its checked settings tree, policy digest, limits view, record and monthly report bytes are all unchanged. The only text that changed for every shop is the unknown-key sentence, which now lists `discounts` among the allowed keys, in TypeScript and Go alike.
- **Settings.** The TypeScript check is `modules/limits/discounts.ts` (the panel and the deployer use it); Go is `discounts.Read`. Vectors are made by running the TypeScript: 9 new Bookings mutations and 5 new Orders mutations. A Bookings floor is never below the deposit, because Guard holds the deposit link to exactly the deposit.
- **Bookings.** The agreed price is the booking's own (`discount` member), and the quote says it. The deposit link is unchanged.
- **Orders.** The order's total, advance, balance and payment link follow the agreed total. A changed order is decided again, with a new card if it is still beyond the cap.
- **The owner's card.** It is bound to the case and a code over every field: `approve b-3 K7M2QX`. A WhatsApp template in four languages carries it outside the owner's window. A yes to an old card is refused, and the same ask again makes no second card.
- **Words.** The customer's four lines and the owner's three, in en, hi, ml and kn, are written in the templates' `language/templates.ts` and generated to Go. The review sheets are regenerated.
- **Record and report.** Each decision is a `discount` line, with its amounts in refs. The report's `discounts` block (given count and paise, asked, refused) is present only when the month has such a line. The page has three rows and the owner's text one line, and the report vectors have a `discounts` case each.
- **Limits and the assistant.** The two caps are declared limits only for a shop with the block. The owner's talk has a "Discounts this month" source read from the record.
- **Not done** (Deferred.md): the panel's boxes, the owner's page card, a rule phrase for "discounts this month" without the model, and "offer the cap".
- **Fixes after the run of record.** A price agreed in an earlier message is said again before the quote, so the list price is never quoted after an agreement; this has a contract case. The report's owner block no longer counts an answer to a price card (`refs.kind: discount`), which the `discounts` block counts instead. `whatsapp-templates.json` gains `owner_discount_ask`, the one new template in every shop's list.
- **Run of record (24 Nov, merged with main 43852e30).**
  - `go build/vet/test ./...`: all ok.
  - Contracts: listings 210/210, directory 36/36, Bookings 173/173 (after the fix), Orders 105/105, Fees 100/100, Stock orders 74/74.
  - Bundle: 722 pass, 9 skipped (REAL_CADDY). Panel: 259/259.
  - TypeScript: Bookings 829 pass, 7 skipped; Orders 210 pass, 5 skipped; modules/limits 16/16.
  - `--check` of every generator touched: fresh.

## webpush-24nov: web push to customers and parents on Go (24 Nov 2026, owner: "web push after E1")

The TypeScript runtimes pushed a page's message to a customer who allowed alerts (Bookings, Orders, item 11h), a chat guest's answers (W1) and a centre's messages to a parent
(Fees, batch 3, `alsoPushTo`); the Go programs did not until this branch. Built on the pieces the owner's alerts already use (internal/push and the shop's push Guard, which stay
the only way out); the server's push sender and each shop's push Guard spec are unchanged.

- **Subscriptions** (`runtime/push.go`): the push route's `customer_state`, `customer_subscribe` and `customer_unsubscribe`, in http.ts's order and answers: a chat thread the
  runtime knows (403 "Alerts are offered after the first answer." before the shop's first answer; W2's identity resolves a tied phone first), a Fees parent's private page (kept
  under `parent:<ref>`, the parent's stable ref, never the link), a booking's or order's page made on the page or through MCP (`web:`/`mcp:` and 16 hex digits). The same
  push.sqlite rows as the TypeScript (who, signer, ref NULL), two phones a page. "Delete my chat" ends the thread's subscriptions ("forgotten"). A listings shop answers as before.
- **Pushes:** `ChannelMessaging` gains outbox.ts's `onKeep` (Orders, Fees; Bookings' own `chanMsg.keep` calls the same `PushCustomer` port), wired in each command to
  `Runtime.CustomerPush` (`push.Customer`: tag "update", the shop's name as the title, `fitNotification`; the sender's customer TTL 12 h, normal urgency, one topic per phone;
  404/410 drops the phone, 429/5xx retries, a Guard refusal with its reason is not tried again). Fees: `internal/fees/agent_push.go` is `alsoPushTo` (every message to a number
  also to that parent's page, the words with every address taken out, queued before the send, never failing it), on the step's messaging and the beat's.
- **Tests:** Go units (`push.TestCustomerPush`; `runtime` the ops, the 403, the view and parent reads, `onKeep`; `fees` withoutAddresses and alsoPushTo). Contracts, new
  `push.contract.test.ts` per template: Bookings 4 (one push through the Guard in the page's words, VAPID on the shop's clock, 410, the fake Guard's daily-count refusal, the
  REAL geo-guard with `pushSpec` and a customer count of one: the second push refused as `limit_exceeded`, not retried, the phone kept; a chat guest after the first answer and
  "delete my chat"), Orders 2 (a shop with no WhatsApp, the Guard's count, an MCP order, unsubscribe, 410), Fees 2 (parent-push.test.ts's case: one push for a family of two
  without links while WhatsApp keeps them, the row under `parent:<ref>`; STOP ends a parent's pushes while another parent's goes, 410).
- **Kept as the TypeScript did, and said here:** the push is queued inside the step, so a step thrown away and run again (a Guard down mid-step) queues its words again (the
  push service keeps the newest per topic while the phone is away). Fees' wrapper also covers messages to the owner's number (pushed to that number's parent ref, which no page
  subscribes to). STOP needs no code: the say gate keeps nothing after it.
- **TypeScript finding (both senders, sender.ts and sender.go, not changed):** a push Guard 403 is read as the Guard's refusal only when its body has `reason_code`; Guard gives one
  for a limit (`limit_exceeded`, proved with the real geo-guard here) but not for a rule refusal (`refused_by_policy` alone, as the captured fixture of 3 Nov shows), which the
  sender reads as the push service's own 403 and drops the phone as "key". The subscription check refuses hosts outside the Guard's list first, so no rule refusal is expected today.
- **Not done:** the Guard's count and forget per template beyond Bookings (the sender and the route are one shared code path; Orders has the count, Fees and Orders no forget
  case); Stock orders has no customer pages (nothing to push).
- **Run of record (24 Nov 2026, through the heat lock, the Go programs built in this worktree's go/bin, GEO_GUARD_BIN and GEOMETER_MONOREPO set):** `go build/vet ./...`
  clean, `go test ./...` 40 packages ok; contracts (`node --test --test-concurrency=1 <folder>/`): Bookings 169/169 (the real-Guard case ran), Orders 107/107, Fees 102/102,
  Stock orders 74/74, listings 210/210 (with words-fresh); bundle (`cd bundle && node --test test/`) 731: 722 pass, 9 skipped (REAL_CADDY), 0 fail; panel
  (`node --test panel/test/`) 259/259. No generator reads the contract folders, so no vectors changed.

## e1-finish-24nov: E1, the four items before the pilot (24 Nov 2026)

What was built is in `internal/discounts/Explanation.md` § Before the pilot, and what is left is in its `Deferred.md`.

- **The panel's boxes** (`bundle/panel/discounts.ts`). They sit in the Bookings deposit step and the Orders rules step: a switch (off by default), the two caps and a floor per item. They are checked by `readDiscounts`, so the Operator reads its sentences, and the panel now owns the `discounts` key.
- **The card on the owner's page and in "what needs me".** A press becomes the owner's own `approve b-3 <code>`, so there is one decider. A stale press or a second answer does nothing.
- **"Any discount?" without a number.** The intent's `askDiscount` is read by the rules in four languages, and the model may read it too. With the block, the agent offers `discounts.CapPrice` through `decideOffer`, recorded as agreed. With no item in the conversation, it asks which one. Off: today's answer.
- **The order's page.** A deal's line is shown at the agreed price, with the menu price beside it, so the lines add up to the total.
- **`gen_orders_reading.ts`.** The sample is now stable: a phrase is in a share by its own hash, so a new phrase only adds itself. The move to it was one regeneration in its own commit.
- **TypeScript findings: none changed.** One note: the owner page's words have no review sheet, so the card's hi, ml and kn words wait there (Deferred.md).
- **Run of record (24 Nov, merged with main 60144bf0, which has web push).** One pass over the merged tree. Two things were then fixed and their suites run again: the Bookings model schema's required fields in two tests, and the Orders reading vectors (one parser and two plan phrases were added, none left).
  - `go build/vet/test ./...`: all ok.
  - Contracts: Bookings 178/178, Orders 117/117, Fees 102/102, Stock orders 74/74, listings 210/210 (words-fresh included), directory 36/36.
  - Panel: 269/269. Bundle: 722 pass, 9 skipped (REAL_CADDY).
  - TypeScript: Bookings 838/838, Orders 215/215, modules (channels, limits, assistant, understanding) 334/334.
  - `--check` of every generator: fresh. The three generators without a `--check` (digest, format, rules vectors) were run and changed no file.
- **Every shop sees one change: the model's prompt and schema.** They gain `askDiscount`, so a model reading sees it. A message the rules read is answered exactly as before.

## credit-book-24nov: the credit book, a Fees adult variant (24 Nov 2026, decision 63)

The shop starter's first job (the *khata* of a hardware, electrical or spares shop), built in Go inside Fees as the settings' `creditBook` block, off by default. What was built
is in `internal/fees/Explanation.md` § The credit book and `templates/education/fees/README.md` § The credit book; what is left, with the reason, in the Fees Deferred.md.

- **Off by default.** A centre without the block: its settings tree, policy digest, limits, record and report bytes are as they were (the report vectors of every other case are
  unchanged). Three things every Fees centre sees: the unknown-key sentence lists `creditBook`; the owner page's action list (and its refusal sentence) has `credit_ask`; the
  WhatsApp template list has the credit book's 17 templates.
- **Settings** (`src/credit/settings.ts`, Go `credit_settings.go`): `maxPerPersonInr` (the link bound, not E4), `remindEveryDays`, `people` (who owes what at setup); with the
  block no batches, students, late fee, joining rule, Classes, and a waiver limit of 0. Nine new settings vectors.
- **The agent** (`credit.go`, `credit_read.go`, `credit_state.go`): one open fee per person (no second ledger); the owner's words by rules in four languages; the first message
  only after the owner's tap, reminders only after the customer's yes, held for every message by a gate in the say path; cash as the owner's mark (`recordCash`, shared with
  the page's cash press); reminders every `remindEveryDays`, capped per calendar month; the credit twins of every Fees message an account reaches.
- **The owner's reader takes only what is its own** (decision 65): a name, "owes" and an amount; "paid", "ask" and the words that also mean "remaining" (बाकी, baki) only
  for a name already in the book; "who owes"; and a number completing an entry that waits for it. Anything else is left to the assistant (or, one day, another part), except a
  message with a phone number in it, which gets the book's help line so a customer's number never reaches a model.
- **After a gap** (the server down, or a reminder held), the next reminder is a full interval from now: never a run of reminders on consecutive beats.
- **The owner's page** (`modules/channels/owner-credit.ts`): who owes what (names, never numbers), the Ask button bound to the row's digest, a box posted to `/credit`.
- **The report**: a `credit` block (owed at the month's start, paid after a reminder, credit reminders, reminders after a recorded payment), TypeScript and Go, three vectors;
  on a credit shop "still to collect" is every open account, whatever month it opened in (a Fees centre's is the month's own fees, as before). The go-live limit lines of a
  credit shop state its own limits (no due day, late fee or reminder days).
- **The export** (`bundle/backup/export.ts`) carries the fees (`dues`), never the store's `credit` member: an account's name is scrubbed and its number fingerprinted as a
  student's and a parent's are, so nothing changed there.
- **The panel**: the preset "Hardware or electrical shop: credit book" and its two-step form in four languages; the review sheets.
- **Found:** a gateway (Razorpay) credit shop whose `maxPerPersonInr` is above ₹5,000 is refused by the Guard spec generator (`paymentNumbers`: the default daily refund cap is
  smaller than the dearest link), so its deployer must raise the cap; a UPI shop (the example, the default) has no payments Guard. The contract's guards harness raises the cap
  to the dearest amount (every other centre's spec is unchanged). Not a TypeScript bug: the check is right; it is a setting the panel does not offer yet (Deferred.md).
- **Decision 65, several parts behind one number: what the bundle and panel would need** (not built here): (1) one inbound router per number that hands the owner's message to
  each part in turn and stops at the first that takes it (the credit reader already answers "not taken" for words that are not its own, and takes "paid" only for a name in the
  book); (2) one owner page that draws each part's section (the credit section is one self-contained section and route); (3) a customer's number known to two parts: one STOP
  for the shop, shared (today each part keeps its own customers); (4) one record and one monthly report with each part's block (the credit block is already conditional);
  (5) the panel's set-up of a shop with two parts (a preset per part today), and one WhatsApp template list for the number (the union of the parts' lists).
- **Run of record (24 Nov 2026, through the heat lock, the Go programs built in this worktree's go/bin, GEO_GUARD_BIN and GEOMETER_MONOREPO set; on the branch, before the
  move onto the new main):** `go build/vet ./...` clean, `go test ./...` 40 packages ok; contracts (`node --test --test-concurrency=1 <folder>/`): Fees 111/111 (102 + the
  credit book's 9), Bookings 178/178, Orders 117/117, Stock orders 74/74, listings 208 pass, 2 skipped, directory 36/36; Fees units 245/245, channels units 218/218, panel
  268 pass, 1 skipped (the monorepo's price list, not set for that run); bundle 731: 722 pass, 9 skipped (REAL_CADDY); every Fees generator `--check` fresh.
- **Merged with main 9ccb690d (the pickup hold and the push-refusal fix), merge 9142cebd; run of record on the merged tree (24 Nov 2026, 00:00-01:00 in India):**
  `go build/vet ./...` clean, `go test ./...` 40 packages ok; contracts: Fees 111: 107 pass, 4 skipped (the differential's visitor walks, which skip before 06:00 in India,
  saying so), Orders 136/136, Bookings 178/178, Stock orders 74/74, listings 210/210 (words-fresh included); panel 269/269; bundle 731: 722 pass, 9 skipped (REAL_CADDY);
  every generator's `--check` fresh. One test fixed after the merge: the presets test compared the preset files (by name, "hardware-credit.json" first) with the ids (by id,
  "hardware" first); both are now sorted the same way.

## pickup-hold-24nov: "keep one for me", the no-advance pickup hold (24 Nov 2026, stream PH; decision 63, catalogue job 3)

What was built is in `internal/orders/Explanation.md` § "Keep one for me", and what is left is in its `Deferred.md`. It is a settings choice of Orders, `"advance": {"mode": "none"}`, off by default. Every existing contract case passes unchanged.

- **Settings** (TypeScript for the panel and the deployer, Go for the shop). The `percent` is 0, and delivery and monthly plans are refused with it. The example shop is `ganesh-electricals-hold.example.json`, and the settings vectors were regenerated.
- **The Go agent** (`agent_hold.go`):
  - No link and no money.
  - The hold lasts until the end of the agreed pickup slot. A slot that is already over is neither offered nor held.
  - A photo (`photoStartsHold`), or words with a model number (`wordsStartHold`), goes to the owner. The owner answers `pick o-3 <item>` (its listed price) or `deny o-3`.
  - Every other hold waits for the shop's `approve o-3`. "Held for you" is said only after the yes and the reservation, in the same step.
  - The last unit is counted across days and against the shared count. A retry keeps the hold.
  - `collected o-3` (WhatsApp, or the page's button) books it off the shared count once. Expiry and every cancel release it once and tell the owner.
- **The words.** There are 18 messages in four languages: "we usually carry it", "in stock" and "held for you" kept apart. Seven are WhatsApp templates. They are generated to Go, and the review sheets and `whatsapp-templates.json` are regenerated.
- **The monthly report.** The `holds` block counts collected, ended uncollected, enquiries, and collections per ten enquiries. It appears only when the month has a hold line. It is in TypeScript and Go, with vectors.
- **The owner's page.** The kinds are `hold_ask`, `hold_pick` (one card, a button per listed item) and `hold`. The action `collected` is added to `OWNER_ACTIONS` / `ownerActions`.
- **The shop's order page, API and MCP** refuse with `whatsapp_only`.
- **The panel.** The rules step has a third advance choice. There is a variant `hold` and the "Hardware and electricals, keep one for me" preset. The certificate's limit line covers no advance.
- **The demo engine's hand check** runs no situation on a hold shop, and says why.
- **Not done** (Deferred.md):
  - The panel's go-live gate refuses a hand check of 0 situations, so a hold shop cannot be certified by the panel until the owner decides how.
  - The photo itself is not forwarded. That needs a WhatsApp Guard route.
  - Staff on their own numbers.
  - The assistant's "what needs me".
  - An enquiry timeout.
- **TypeScript findings: none.**
- **Run of record** (24 Nov, on the branch, based on 361aa459). The branch had one pass. The three panel failures it showed were fixed and the panel suite was run again.
  - `go build/vet/test ./...`: all ok.
  - Contracts: Orders 136/136 (19 of them the hold's), Bookings 178/178, Fees 102/102, Stock orders 74/74, and listings 210/210 (words-fresh included).
  - Every generator's `--check` (40): fresh.
  - Panel: 266/269 in the pass. The 3 failures were the Bookings review sheets' section 7 (the panel's new words), which was regenerated. On the rerun it was 268 pass and 0 fail; the one test that did not run is the one that needs the monorepo path, which that command did not set.
  - Bundle: 722 pass, 9 skipped (REAL_CADDY).
  - TypeScript: Orders 215/215; modules/channels 219/219.

## handcheck-go-24nov: the go-live hand check runs on the shop's Go program (24 Nov 2026, owner: "Run the hand check on Go")

The certificate a shop gets for go-live now rests on a run of that shop's own settings on the Go program it will run. Before, the situations drove the TypeScript demo
engine (src/harness.ts), which the shops no longer run and which has no pickup hold, no credit book and no E1 (a hold shop had 0 situations, so the gate refused it).

- **The runner, shared by every template** (`modules/crash-test/`): `programs.ts` (where the programs are: `GEOMETER_GO_PROGRAMS`, else `go/bin`; Node modules only, so the
  panel and the deployer read it without loading the runner), `go-shop.ts` (one shop: its folder written as the deployer writes it from its own settings, the program started
  through the contract's shared process pieces, events, settle, a beat, the record and the saved state read from agent.db), `go-world.ts` (the stand-ins and the stub Guard
  on the shop's clock, the steps the situations use, `live()` for a value read afresh, `samePicture` for a QR). Each template's `crash-test/go-world.ts` adds only its own.
  The situations keep their words and judge from the same stand-in records; `runOnProgram` runs them on the named program and lists every situation as not run, with the
  reason, when the program is not there. A send the provider refused fails the situation unless the situation planned one.
- **Go**: runtime.json `"standins": "http"` (config.go `standInsProblems`, with a test): a "fakes" shop (so it may run on the test clock) whose services are stand-ins on
  127.0.0.1 or [::1] with a port (part B: not localhost), reached through the live clients (each template's BuildPorts: `UsesClients`); refused for a live shop or a service elsewhere. Such a shop may beat
  every 0.1 s or more (the hand check uses 0.2 s). The kit's /status counts the beats that ended (`ticks`). Nothing changes for a real shop.
- **New situations**: the pickup hold (`orders/crash-test/hold.ts`: "held for you" only after the owner's yes and no money, one hold for the last unit, collected once,
  let go once), the credit book (`fees/crash-test/credit.ts`: nothing before the owner's tap, the first question only, a reminder only after the yes at the reminder hour,
  none after a marked payment), E1 where a shop turns discounts on (`bookings|orders/crash-test/discounts.ts`: within the cap the agent agrees, beyond it only the
  owner's card with its code, below the floor the rule refuses).
- **The panel** (bundle/panel/Explanation.md, "The hand check runs on the shop's Go program"): a child process with a ten-minute limit, within the request (a run takes
  seconds to about a minute); the summary keeps its shape and names `program` (name, version, SHA-256 of the file); the gate refuses a stored check with no program or
  from another program file; the confirm page keeps a check that still stands. On a server the deployer copies the hand check's programs out of the image the shops run into
  `<server>/programs`, mounted read-only at `/programs` (the panel has no Docker); the stripped app keeps `modules/test` for the runner. The certificate and the script
  name the program ("Go bookings 0.2.0 · sha256:…"). `geometer update` builds and copies the programs before a Go version's hand check.
- **Deleted**: the demo world's `worldHook` (the accounting-figures tests read each Go world's record as it closes, `goWorldHook`), the hand check's in-process model
  stand-ins (`aiStandins` over `systemOneFetch`, now stand-ins over HTTP), the monthly report situation's in-process job, and the hand check's imports of the demo engine.
  The demo engine itself stays for the public demos (decision 61).
- **Findings** (none is a change of TypeScript behaviour):
  - **Orders on Razorpay**: the owner's message about a late payment that was refunded (`owner_payment_unused`) has no approved WhatsApp template, so outside the owner's
    24 hours it goes under the generic name, which the provider refuses: the owner is not told. The demo engine approved every name, so it never showed. On Go the Razorpay
    examples hold 17 of 18 (Annapurna Razorpay, Sweet Crumbs 15 of 16); the gate refuses such a shop until the template is registered. Pinned in
    `orders/test/situations.test.ts`; the sell guide's Razorpay count is a todo.
  - **Fees on Razorpay**: when a fee is paid twice, the parent's messages about the extra payment go under the generic name outside the parent's 24 hours, which the
    provider refuses. Bright Tuition holds 24 of 25 on Go; pinned in `fees/test/situations.test.ts` (`KNOWN_ON_GO`). Both findings came from a check added here: a send the
    provider refused fails the situation unless it planned one (before, "nothing was sent" could pass because a send failed).
  - **Bookings, every shop with the assistant** (an `assistant` block: every shop set up through the panel's Character step): in the button-mode situations a message to
    the owner goes as a WhatsApp template whose image header does not match how the template was made (Meta's 132012, "Variable parameter values formatted incorrectly";
    modules/standins/whatsapp.ts), so the provider refuses it and 1 to 3 AI situations fail on Go. Shown by toggling the block: Glow Salon with an `assistant` fails
    "a button reply books without any model call"; the panel's test shop without it holds. So the gate refuses every Bookings shop made through the panel until that is fixed.
    The panel's flow tests use a stand-in hand check (golive-go.test.ts and orders-resolves run the real one).
  - **Fees on Go reads with its rules alone** (go/internal/fees/Deferred.md: the model steps of reading), so "the model is down" is listed as not run there.
  - `geometer update` compares the hand checks of two versions: a situation that held before and is not run now holds the shop back, so a Fees centre's next update is
    held back by "the model is down" until that is decided (bundle/panel/Deferred.md).
- **Not done** (bundle/panel/Deferred.md): a polled job (not needed at these times); `update`'s "before" check of a Go version runs on the current programs; the contract
  harnesses still write their own shop folders; a "broken setting" test for each template (there is one for Fees: a fee above the day's refund cap; situations follow the
  settings by design, so a valid setting fails only where the program is wrong, as the Razorpay finding shows).
- **Run of record** (24 Nov, on the branch from dd8a3f88; two passes, the second at the head for what changed after the first): `go build/vet/test ./...` ok (40
  packages); contracts Bookings 178/178, Orders 136/136, Fees 107 + 4 skipped (the guards-mode visitor steps before 06:00 in India, as before), Stock orders 74/74, listings
  210/210 (words-fresh included, after regenerating the Orders reading vectors with the new situations' phrases); every generator's `--check` (41) fresh; template units
  Bookings 838/838, Orders 209 + 5 skipped + 1 todo, Fees 243 + 1 todo, Stock orders 124/124; bundle 723 + 9 skipped (REAL_CADDY) + 1 todo; panel 273/273. The panel's
  child also ran from a stripped app (`hand-check-go.js`, the hold example, 4/4). Hand checks on Go: Bookings Glow Salon 40/40 (UPI 9/9, with discounts 43/43; with an
  `assistant` block one fails, above), Orders Annapurna 17/17, Razorpay 17/18, Sweet Crumbs 15/16, plans 22/22, the hold 4/4 (three times), with discounts 20/20, Fees Bright
  Tuition 24/25 (1 not run), credit book 4/4, UPI 7/7, Classes 30/30, Stock orders 17/17 (three times). Seen once and not diagnosed: under two test files at once, the Fees
  trick situation failed in one run and held three times alone (a failure can only refuse a shop, never pass one).

## handcheck-go-24nov, part B: the three refusals fixed at their cause, the gaps closed (24 Nov 2026)

- **The three refusals were product bugs, not stand-in artefacts.** For each, what the program sent was compared with the template set the shop submits (whatsapp-templates.json,
  made from meta-templates.ts) and with what the stand-in approves (the same catalogue):
  - **Bookings with the assistant**: the Go morning line sent `owner_morning` (submitted with an IMAGE header, modules/assistant/templates.ts) with no header, which Meta refuses
    (132012). The port had dropped morning.ts's `headerImage`. Fixed in Go: the picture `<base>/character/<face>.png?v=<version>` from pages.json `character.version`
    (access.ReadPages now reads it). The hand-check shop with the assistant names its drawn pictures in pages.json, as the deployer's loop does.
  - **Orders on Razorpay**: `owner_payment_unused` was in no submitted template, so it went under the generic `order_owner_notice`, which is not submitted either: refused
    outside the owner's window on live WhatsApp. Fixed in the template set: `owner_order_payment_unused`.
  - **Fees on Razorpay**: a refund's word to the parent (`fee_refund_done`, `_pending`, `_approved`, `_denied`, `_expired`) was in no submitted template: five templates;
    `fee_refund_done` began with its value, which Meta refuses, so it now begins with words in all four languages (hi/ml/kn reworded by moving the existing words; on the
    review sheets). whatsapp-templates.json, the review sheets and the Go words regenerated.
  - Fees' "the model is down" runs on Go again (the program asks no model and still answers with buttons; the record shows the rules read the message). Every example holds
    every situation; the pinned failures and the todo sell-guide tests are plain passes (Orders 18 of 18, Fees 26 of 26, as the guides say).
- **Gaps**: broken-setting tests for Bookings, Orders and Stock orders (golive-go.test.ts); the Fees trick situation held 20 of 20 under load (ten beside the Orders units,
  ten beside the Fees units), so the one failure seen before was not reproduced; the beat: a hand-check shop may beat down to 0.1 s and the runner uses 0.2 s (a Go test holds
  both floors); `standins: "http"` takes only 127.0.0.1 or [::1] with a port for every address it names (services, push, models) and holds the process to this machine while it
  runs (guard/loopback.go: the far end of every connection is checked, no redirect off the loopback), with Go tests for localhost, 0.0.0.0, other IPv6, a mapped address, a
  look-alike host, user info, https, no port, a redirect and a non-loopback dial.
- **The update**: a situation the new version lists as not run on these settings, with its reason, is no longer counted as a loss (bundle/handcheck.ts `notRunNow`, said in
  the log); the "before" side runs on the programs the shop runs now (copied out of the image the deployed compose file names into <server>/programs-running). The update
  test that put a fault into a version's TypeScript agent now puts it into the new version's program (a build that misreads windows over 24 hours): the 48-hour client is
  held back, the other moves.
- **Three more on the plans example shop**, found once the run of record passed each settings file as its own argument: on a UPI shop the plan's renewal writes the UPI ID
  after its link and so filled no template (the link slot now holds the link as every payment request writes it, `payTo`, and the Go words read it so), and "your plan is on"
  and the owner's "plan cancelled" had no template (both added, with the plan's meals and days as slots). All three went under the generic name, refused outside the window.
  The Orders tests now run the plans shop's situations on Go (22 of 22); the other unasked plan messages are a row in templates/commerce/orders/Deferred.md. The agent update
  (bundle/agent/update.ts) excuses none of an agent's not-run situations: its list mixes what the settings rule out with what the agent failed to do (NotDrivable), and
  the result does not say which, so one the new version no longer runs still holds it back (readOfCrash; a test holds it).
- **Run of record** at 04c689b8, clean tree: go build, vet, test (40 packages ok); contracts Bookings 178/178, Orders 136/136, Fees 111/111, Stock orders 74/74, listings
  210/210; 41 generators `--check` none stale; units Bookings 838, Orders 216, Fees 245, Stock orders 124, all pass; bundle 724 pass, 9 skipped (Caddy, needs
  REAL_CADDY=1 and Docker); panel 276/276; every hand check on Go holds: Bookings 40/40, UPI 9/9, rental 35/35, discounts 43/43, assistant 40/40; Orders 17/17,
  Razorpay 18/18, Sweet Crumbs 16/16, plans 22/22, hold 4/4, discounts 20/20; Fees 26/26, Maths Circle 23/23, UPI 7/7, Classes 31/31, credit 4/4; Stock orders 17/17.
  No shop program left running.

## wa-templates-25nov: the panel submits each shop's WhatsApp templates (25 Nov 2026)

No Go changed. The panel (TypeScript, not a shop's runtime) sends a shop's template set through the shop's WhatsApp Guard (`bundle/lib/wa-templates.ts`,
`bundle/panel/wa-templates.ts`). One runtime-facing fact for the Go port: `runtime.json` (the panel's file) may now carry `services.messaging.wabaId` (Meta direct only),
checked by the TypeScript `messagingConfigProblem` and `modules/runtime/config.ts`. The deploy bundle uses it only for the WhatsApp Guard's template routes and builds the
runtime's generated config without it, so neither the Go nor the kept TypeScript runtimes ever see it; `go/internal/messaging/providers.go` (the port of
`messagingConfigProblem`) has no `wabaId` rule, and needs none while that holds. The messaging vectors (`go/scripts/vectors/messaging.ts`) carry no config with the field,
so they are unchanged. TypeScript findings: none.

## fees-flake-25nov: the Fees hand check's rare failure, found and fixed at its cause (25 Nov 2026)

The full bundle suite once held a Fees centre back at `claim-paid` (25 of 26): "a message to the owner was refused by the provider: Template name does not exist". Not load
(`claim-paid` held 15 of 15 under ten busy loops) and not the clock: the outgoing check (`go/internal/language/check.go`, word for word `modules/language/check.ts`) masked the
record's names and references BEFORE it read the links, and a page link's random handle (`newHandle`, 32 characters of base64url) holds the fee's reference (`f-5`, any case)
about one time in 4,000, so the record's own link was cut in two and read as a link not in the record. The reminder was held back, and the owner's word about it
(`owner_message_held`, unasked, outside the owner's window) had no WhatsApp template and went under the generic name. Fixed in both runtimes at once (the check is shared, so
the TypeScript change is the same fix, with a test): the record's own links are read whole first. `owner_message_held` is now the template `owner_fee_message_held`, its
hi/ml/kn words starting with fixed words; whatsapp-templates.json, the review sheets and the Go words regenerated. TypeScript finding: the same bug, fixed (above).
## d65-parts-25nov: several template parts in one shop (25 Nov 2026, decision 65)

Owner, 24 Nov: "one shop can run several template parts, thats what the higher tier price slab is for". The design note (one Go program hosting the parts, not one
process per part behind a router, and why) is bundle/Explanation.md "Several template parts in one shop"; what is left, with the owner's questions, is bundle/Deferred.md.

- **The program.** `cmd/parts` with `internal/parts`: a `runtime.Kit` made of the parts' own Kits (Fees for the credit book, Orders for the pickup hold, Stock orders),
  unchanged. The settings keep the shop's keys at the top and each part's own in `parts.<template>`, each checked by its own template; the saved state keeps each part's
  members under `parts`, the router's under `router`, and the shared assistant and AI counts as every shop does; `carried` names the template the shop was before it took a
  second part (its flat state and its record lines from then are that part's).
- **The seam in the runtime** (`runtime/parts.go`, `record.go`, `serve.go`; nothing changes for a single-part shop): a part's view of the one record (its lines carry
  `refs.part`, it reads only its own; document numbers over the whole record through accounting `ShopReader`); a beat per part, each its own step (a panic in one part's
  beat does not skip the others' with OnPanic set); the owner's ONE assistant hosting every part's skill (StepContext.SetCoParts; its record lines written by the part that
  owns the case); the licence notice and the morning line said once per shop, by the first part (the morning line over every part's skill and the whole record); each part's
  limits under its own id (`LimitID`: `orders_refund_limit`); one stock count for an item two parts know (StockAliaser: the line under `supply:<id>` with `menu:<id>` as its
  alias, so the hold's collection lowers it and Stock orders' low mark reorders it once); `CardCode`; `Serve`, the one start of Orders', Fees', Stock orders' and the parts
  programs (each package's `wire.go` is its main's wiring, moved unchanged).
- **Each part's `part.go`** says by its rules alone, with no effect, how sure it is a message is its own (runtime.Claim: its command with its own case, its words or an open
  conversation, a customer's words about what is open, a new customer), which cases and page requests are its own, and hands its skill to the one assistant.
- **The router** (`internal/parts` router.go, agent.go): the highest claim takes a message; a tie asks one short question with a button per part (words generated from
  templates/commerce/parts/src/words.ts by scripts/gen_parts_words.ts, `--check`), keeps the message per number for 30 minutes and hands it to the part the answer names; a
  message no part claims goes to the first part; a STOP goes to every part that knows the number; a redelivery goes where the message went; an owner's press goes to the
  part that owns the case, a card's answer to the part whose skill made it; a payment event, an approval or a recovery whose case no single part owns is recorded and not done.
- **One owner's page**: every part's items, coming list, credit rows, parents and cash in the shop's order, the one assistant's view (Stock orders' order cards left out as its
  own page leaves them), the Money section summed over the parts.

- **Memory** (25 Nov 2026, this Mac, RSS after five beats): the starter shop on `parts` **48.5 MB**; its parts each on its own program 40.7 (Fees) + 39.3 (Stock orders)
  + 33.2 (Orders) = 113.2 MB.
- **Each part's own contract suite through the parts program** (`CONTRACT_PARTS=first|last`, templates/commerce/parts/contract/via-parts.ts): the harness wraps the test's
  settings as one part beside two quiet companions; cases that test what a parts shop is not by design are SKIPPED with the reason (via-parts.ts BY_DESIGN: the status's
  name, a settings file the test writes itself, the differential against the demo's single shop, refs compared whole, one report per part, the shop's one page and chat).

Findings in the templates' own situations (both fixed at their cause in part B, below):
- **Stock orders read the digit in an item's name as a quantity.** On the starter shop, "LED bulb 9W is low" was read as an order of 9 (reading.ts `quantityIn`
  took the first run of digits not after a word character; its Go twin did the same), so the low-stock situation (#15) ordered 9 where the usual quantity is 10.
- **Stock orders' "the catalogue's price moves" situation (#5) could not run on a shop with the assistant:** it read the settings back with `parseSettings` after its
  change, and the checked assistant block (`morningAt`) is not a settings key, so it threw before it ran.

TypeScript findings: none in the templates' code. One thing worth knowing: the Orders skill owns `g-` references (`^[og]-`) and so does the Fees skill (`^[fqg]-`); in a
parts shop a press on a `g-` case is owned by two parts and is recorded and not done (the router never guesses).
- **Run of record** (25 Nov 2026, through the heat lock, GEO_GUARD_BIN and GEOMETER_MONOREPO set; scratchpad d65-final.sh, the 24 Nov run's script with the parts lines
  added): `go build/vet ./...` clean, `go test ./...` 41 packages ok; contracts: Bookings 178/178, Orders 136/136, Fees 111/111, Stock orders 74/74, listings 210/210
  (words-fresh included), directory 36/36, parts 14/14; every generator's `--check` (42) fresh; template units: Bookings 838/838, Orders 216/216, Stock orders 124/124,
  Fees 244 of 245 (the sell guide's hand-check count, 25 of 26 under load: the Fees flake stream fees-flake-25nov's); bundle 745: 733 pass, 9 skipped (REAL_CADDY), 3
  failed, each since fixed and passed alone (the kinds list and the ask card now count parts; update.test's copy of the running programs lacked the parts program);
  panel 288: 286 pass, the two new golive-parts cases since corrected; every hand check on Go as on 24 Nov holds all, and the parts shop's holds 26 of 28 (the shop's own
  6 of 6, fees 4 of 4, orders 4 of 4, stock-orders 12 of 14: its two findings above, which Stock orders' own program also fails on the starter's stock settings).
  Through the parts program (`CONTRACT_PARTS=first`): Stock orders 66 pass, 8 skipped by design, 0 fail; Orders 87 pass, 48 skipped (39 gateway cases a parts shop does not
  take, the rest by design), 1 fail (a Razorpay restart case that starts with test() outside the harness's skip, by design). After the last fixes (targeted rerun, same
  day): parts 14/14, Orders 136/136 on its own program, bundle update.test 14/14; Fees through the parts program 48 pass, 55 skipped (gateway or by design), 8 fail: 5 by
  design but outside the skip (the four gateway differential cases and the restart case use test() directly), and 3 open: a picture from a parent the hold could also
  take is asked about instead of read as "I paid", the owner page's Received press on a parent's claim, and the reminders' words with no page link (bundle Deferred.md).

### Part B (25 Nov 2026): the starter shop passes its own gate

- **A number written against a letter or in a fraction is part of a name, never a quantity** (reading.ts `quantityIn` and reading.go, the same rule): "9W", "5L", "2kg",
  "16A", "1/2 inch" are names; "2x" keeps its 2; "order 10 LED bulb 9W" is 10. Vectors in en/hi/ml/kn (gen_stockorders_vectors.ts), a Go test
  (reading_names_test.go) and a contract case (an item named "shampoo 5L": its low mark orders the line's usual 12).
- **The price situation reads the edited settings back in their file's shape** (`settingsJson`, as the go world writes them), and Stock orders' stand-in knows the
  assistant's templates when the shop has the assistant. Tests: Stock orders' hand check on a single shop with the assistant, and on items named with a number, holds all.
- **A Fees part behaves as a Fees shop through the router.** Cause of all three open cases: the shop's customer side was the hold's when the shop had one, so the
  credit book's parents got no page link and the owner page's items were read as the hold's. The customer side is now the FIRST Orders or Fees part in the shop's order
  (`customerPart`, Go and TypeScript `customerPartOf`); a customer-facing part that is not it gets no page address. A picture from someone the hold has nothing open with
  is the hold's only as a new customer (ClaimNew), so a parent's picture is the centre's ("I paid", which the owner still confirms; nothing is settled on a picture).
- **The by-design cases a suite starts with `test()` itself** (a gateway shop's restart, the gateway differential) are skipped through the parts program with the
  reason (via-parts.ts `gatewayCaseThroughParts`); the page and link cases are by design only for a part that is not the shop's page (`CONTRACT_PARTS=last`).

- **Owner's words no part claims are the first part's** (a card code no part made, words no part reads): by design, so three cases are skipped with that reason only when
  the part under test runs last (`CONTRACT_PARTS=last`); they run and pass when it is first.
- **Run of record** (part B's, through the heat lock, scratchpad d65-final.sh): `go build/vet ./...` clean, `go test ./...` 41 ok; contracts Bookings 178/178,
  Orders 136/136, Fees 111/111, Stock orders 75/75, listings 210/210, parts 14/14, directory 36/36; generators 42 fresh; units Bookings 838/838, Orders 216/216, Fees
  245/245, Stock orders 126/126; bundle 745: 736 pass, 9 skipped (REAL_CADDY), 0 fail; panel 288/288. Through the parts program (`first`): Orders 87 pass, 49 skipped,
  Fees 64 pass, 47 skipped, Stock orders 67 pass, 8 skipped, 0 fail each, every skip named (a payment gateway, which a parts shop does not take, or by design);
  `last` (six files) 3 failed in that run, then 59 pass, 11 skipped, 0 fail rerun after the entry above. Hand checks on Go: every one holds all, the starter shop 28 of 28 (its own 6, fees 4, stock-orders
  14, orders 4) and Stock orders on the starter's stock settings 15 of 15, but Bookings with the assistant 39 of 40 ("the model is down mid-conversation": the owner is not
  told a second time), which main fails the same way (not this stream's). 0 shop programs left.


### Part C (25 Nov 2026): main merged again; a case asked about from another number, through the router

- **Merge** of main at ef302cca (morning-clock-25nov, refund-paths-25nov) with `-X no-renames`: two conflicts, both kept whole. `modules/crash-test/go-shop.ts`: main's
  first-beat wait (a start returns after the program's first beat) around this branch's start, which keeps its own `program` and `pathway` (the parts program, and a part's
  hand check run on it); go/TRIAL.md: both sections. Every generator's `--check` fresh after the merge (43), so nothing generated was edited by hand.
- **The router asks every part** (`internal/parts` agent.go `caseAskedPart`, runtime `CaseHolder`): before the claims, a customer's message from a number that holds no
  case in any part (an order or plan, a fee or credit account or a person in the credit book, a supplier) and names a case a part's own reading finds (`NamesCase`: its
  `onCaseAsked` rule with no effect) goes to that part, which writes `case_asked_elsewhere`, sends its one line and its owner notice (once an hour by the record). Each
  part's own `onCaseAsked` also asks `CaseHeldElsewhere`, so a number with another part's case is answered as before whichever part takes it. Stock orders names no case
  (its cases are the owner's and the suppliers') and counts its suppliers as holding one. A single-part shop is unchanged (`CaseHeldElsewhere` is false there).
- Contract cases (templates/commerce/parts/contract/case-asked.contract.test.ts): a stranger naming the credit book's entry gets the credit book's line and notice though
  the hold takes new customers (before this, the hold took it as new business); the hold's order; someone with a case in one part naming another's: no ask, no notice.

## morning-clock-25nov: the assistant hand check's evening failure, found at its cause (25 Nov 2026)

Bookings with the assistant held 40 of 40 in the morning runs of 24 Nov and 39 of 40 in the evening ones ("The model is down mid-conversation": the owner got the morning line
after the heads-up). Not the time of day: the same situation held alone at 19:25 and failed in the full run at 19:28. The shop's beat runs on a real-time timer from the process's
start (0.2 s in the hand check), the world opens at 10:00 on the shop's clock, inside the owner's morning window, and the situation books and pays in some 0.15 s. In the failing
run the booking was confirmed at .226 and the first beat claimed the morning line at .230, counting it; when the beat came first, the day was quiet and the process did not look
again (`runtime/morning.go`, as `morning.ts` did). A margin of milliseconds, so any change in start-up or step speed flipped it. Fixed in the hand check, not the program: a
hand-check shop's start (`modules/crash-test/go-shop.ts`, also after a restart) now returns once its first beat has ended, as a running shop has beaten before its customer
writes; every template's world shares it. The owner link file is now made at the shop's start instant too (it was the machine's time; the program only checks it is there).
Test: `templates/commerce/bookings/test/first-beat.test.ts` (a 2 s beat; before the fix the morning line always went, after it never). A live shop saw nothing wrong: its line
goes once, inside the window. The quiet day kept per process only is noted in `internal/runtime/Deferred.md`. The cost: about 0.25 s a world (one beat), so the Bookings hand
check takes some 27 s instead of 17 s, Orders' 9 s instead of 5 s.

## refund-paths-25nov: a case asked from another number, and the UPI refund's account (25 Nov 2026)

Owner, 25 Nov: "yes, plan and fix both". Built in TypeScript (each template's `src/`, the public demo) and Go (the shops), with the words generated as always.

- **A case named from a number that holds none.** `modules/record/case-asked.ts` and its twin `internal/runtime/caseasked.go` (vectors: `testdata/caseasked-vectors.json`,
  `scripts/gen_caseasked_vectors.ts --check`) read a reference ("b-3", "B3", "f-3.2", "o-5.b", a receipt's number, a payment id the record holds, a UPI reference a customer
  typed; the word form "booking 3" only when nothing else was read). Each template's `onCaseAsked` (Bookings `agent_flow.go`, Orders `agent_owner.go` with holds and plans,
  Fees `agent_talk.go` with the credit book) answers with one line that shows nothing, tells the owner by a WhatsApp template at most once an hour per asker and case (from the
  record), and writes `case_asked_elsewhere` with `refs.case` and `booking` null. New templates: `owner_booking_asked_elsewhere`, `owner_order_asked_elsewhere`,
  `owner_fee_asked_elsewhere`, `owner_credit_asked_elsewhere`.
- **The UPI refund's account.** `ownermarked.RefundSource` (ledger.ts `refundSource`) names the mark a refund gives back; the owner's message says the note, the amount and the
  day, and keeps the customer's number as the person to tell. Renamed templates (changed bodies need Meta again; the old names stay registered, unused):
  `owner_upi_refund_to_account` / `owner_upi_refund_account_reminder` (Bookings and the owner-marked desk), `owner_order_upi_refund_to_account` /
  `owner_order_upi_refund_account_reminder`, `owner_fee_upi_refund_to_account` / `owner_fee_upi_refund_account_reminder`, `owner_credit_refund_to_account` /
  `owner_credit_refund_account_due`.
- **Tests.** Contract cases `contract/other-number.contract.test.ts` in Bookings, Orders and Fees; a stranger step in each `differential.test.ts`; the hand check's shared
  situation `modules/crash-test/case-asked.ts` in every Bookings, Orders (holds too) and Fees (the credit book too) run.
- **Not done.** The parts router of decision 65 was not on main: modules/Deferred.md says what it needs. Stock orders has no customer cases (its Deferred.md). A customer
  with a case of their own who names another's is answered as before (the brief's rule kept literally; each template's Deferred.md).

