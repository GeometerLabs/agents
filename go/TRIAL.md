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
