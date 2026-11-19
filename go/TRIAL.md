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

`templates/commerce/listings/contract/`: starts the shop as a **separate process** in a temp folder written as the deployer writes it, and talks to it only over HTTP. `LISTINGS_IMPL=ts|go`
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

**TypeScript findings (reported, not fixed):** `notes.ts` GOAL_WORDS ends `\b` after Devanagari/Malayalam/Kannada words ("लक्ष्य", "ലക്ഷ്യം", "ಗುರಿ"), and JavaScript's `\b` only
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
