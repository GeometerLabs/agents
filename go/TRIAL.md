# The trial: a listings-only shop's runtime in Go

Question: can the runtime of the smallest shop kind (a listings-only shop) be written in Go, and what does it cost and save? Decision 61 (`docs` repo `plans/next-phase.md` 1c) makes Go the
language for code that runs inside a shop **if this trial passes**. This file is the evidence. Date of the trial: 18 Nov 2026, one sitting, one AI helper, on one laptop.

## The pass rules, and how it came out

| rule | result | the honest reading |
| --- | --- | --- |
| The Go shop passes the contract, and the contract passes against TypeScript | **Yes.** TypeScript: 36 of 36. Go: 35 of 35, with 1 test skipped on purpose (`GET /internal/channel/owner`, the owner's talk-and-cards page, which Go does not serve) | passes as the contract is written. The contract leaves that one route out for Go, and it is the route the owner's page needs: see "Left out". So this is a pass of the contract, not a drop-in replacement of the TypeScript runtime |
| 30 MB or less idle | **Yes.** 18.5 MB after start, 20.3 MB after 50 warm-up requests | with 200 listings in the store it is 28.2 MB, and 29.2 MB after 1,500 requests: it is under the rule but with no room. TypeScript's same single shop is 130 MB (see the table) |
| Built within the time box, no more fix rounds than the TypeScript streams needed | **2 fix rounds** against the contract (the lead compares with the TypeScript streams' count) | listed below; neither was a design problem |
| The demo has a working path | **Yes**: keep the demo in TypeScript, held to the contract; a Go demo needs TinyGo and a reflection-free state codec (below) | no TinyGo was downloaded |

## The contract

`templates/commerce/listings/contract/`: starts the shop as a **separate process** in a temp folder written as the deployer writes it, and talks to it only over HTTP. `LISTINGS_IMPL=ts|go`
picks the runtime. It covers `/healthz` `/readyz` `/status`, the token refusals (401), the public read and the offer, the owner's listing ops with the rules' refusals (422 and a `why`),
photos, the signed feed, the signed check answer, the Agent Card and the feed notice (all verified with the **TypeScript** signing module, so Go must write byte-identical RFC 8785 JSON
signed with Ed25519), the owner's passkey set-up and sign-in with the soft authenticator (ES256 and EdDSA), sessions, a listing drafted through a fake OpenAI-compatible model server
with the day's cap and the month's cap each stopping it, and the store surviving a restart. Three more files go beyond the brief:

* `cross-restart.test.ts`: TypeScript and Go **take turns on one folder**, both orders. What one wrote (listings, a photo, the shop's key, a passkey, a session) the other reads and uses.
  And the two runtimes make the same files: `agent.db` and `owner-access.sqlite` have identical `sqlite_master` text and `PRAGMA user_version` (5).
* `differential.test.ts`: the same 14 owner ops and 19 model drafts given to both, answers compared. It found no difference in the ops, and none in 19 grounding cases; it found three
  differences that are scope (the assistant's reading rules, "Left out" 3).
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
| | third run | 30 of 30. The cross-restart tests, the schema comparison and the differential ran after, and passed first time | |

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
| RSS after 1,500 more requests | 145.4 MB | 29.2 MB |
| cold start, fresh folder (spawn to `/healthz`), median of 5 | 267 ms (266 to 276) | **54 ms** (54 to 64) |
| feed request (50 items, 16,002 bytes), p50 / p95 of 500 | **0.77 / 1.19 ms** | 1.27 / 1.69 ms |
| check request (3 ids), p50 / p95 of 500 | 0.41 / 0.54 ms | **0.30 / 0.52 ms** |
| owner list, p50 / p95 of 200 | 0.39 / 0.47 ms | **0.25 / 0.39 ms** |
| what is shipped | the `node` executable, 147 MB, and the TypeScript source: 355 non-test files, 3.9 MB, in `modules/` and the template | one binary, 20.6 MB (14.1 MB with `-ldflags "-s -w"`) |
| build | none (types are stripped as the file loads) | clean cache: 17.7 s wall through the heat lock, which adds 10 s of cooldown (so about 8 s of build; 34 s of CPU); a one-file change: the cooldown plus under a second |
| lines of code | the files ported are 6.4k lines of the 10k or so in the pieces they sit in (comments included) | 7.4k lines, comments included (a third of it comments) |

Notes on the numbers:

* **The comparison that matters in production is not this one.** The TypeScript runtime does not run one shop in a process there: `shared-main.ts` runs hundreds in four worker threads (the
  template README: about 33 MB a worker, so a few MB a shop). The Go runtime in this trial runs **one shop per process** at 18.5 MB idle. A hundred shops would be about 1.8 GB as Go
  processes and about 130 MB as the TypeScript pool. The saving is real for a shop alone and for a single-shop container; for the free shared server it is the other way round, until
  the Go runtime holds many shops in one process (goroutines, one SQLite file each). I did not build or measure that.
* The 200 listings cost Go 8 MB (SQLite's page cache and the garbage of 200 steps); setting `GOGC` to 50 or 25 changed nothing. TypeScript's cost was 11 MB.
* Go's feed is slower than TypeScript's at p50 (it builds, canonicalises and signs on every request, as TypeScript does; V8 is quicker at the string work). Both are about a millisecond.
* `go build` is fast because the module cache already had the three modules (downloaded once, about 30 s).

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

1. **The owner's talk-and-cards page** (`GET /internal/channel/owner`, `owner_action`). It is the whole assistant's view: cards, the talk list, notes and memory, the morning "Still have it?"
   question, the budget notices, undo. It is about 4.7k lines of TypeScript plus its words, and it is not "the runtime of a listings-only shop" so much as the shop's assistant. **Without
   it a draft the Go runtime makes cannot be published by the owner** (the "Show it" tap is a card). The Go runtime does draft, check and save it as state `draft`; the owner can edit or
   remove it, and a shop that goes back to the TypeScript runtime has the draft in its list. This is the largest gap and the first thing the lead should weigh.
2. **The rest of the shop's other routes**: chat, push, voice, limits, stock, documents, accounting, parent and material. They are not routes of a listings-only shop's front (it has no
   chat, no WhatsApp and no money); they answer 404. `POST /internal/events` (the inbox's) answers 400; `/internal/recover`, `/internal/refund-context`, `/internal/limit-changes` answer 404.
3. **The assistant's reading of the owner's words** (`readOwnerRules`): the TypeScript runtime reads "put it on my page: 5 kg rice" as another kind of request before it is a listing, and
   answers words that are no listing with the talk model. Go takes any words with a listing cue (or with a photo waiting) as a listing. The differential found exactly this on three phrases.
4. **Stock counting** (`modules/stock`): Go reads a counted listing's count (so the public read leaves out a counted listing at 0, and shows the count) and never changes it.
5. **A price list**: every model call is counted "unpriced" (10 paise against the budget, `DEFAULT_UNPRICED_CALL_MICRO_INR`). The TypeScript runtime prices a call from the dated rate
   tables (`modules/understanding/rates/*.json`) and a builder's own rate. For a shop on a real provider the Go budget would run out sooner than the TypeScript budget would.
6. **The "anthropic" model wire**, the decision model, voice. Only the OpenAI-compatible wire is spoken (it is what the model Guard in front of a shop speaks).
7. **Restoring from a nightly snapshot** (`restored.ts`: the id counters move on and the record says so), the licence's final stop, the monthly report and the morning line. A shop restored
   from a backup and started on Go would not skip its listing ids.
8. **The shared process** (`shared.ts`): the router, the worker pool, the watchdog, quarantine, "back soon", `/shared/shops`. One shop per process only.
9. **Unicode normalisation.** TypeScript puts words in NFC (and the claim lists in NFD) before it compares them. Go's standard library cannot; it lives in `golang.org/x/text/unicode/norm`,
   which this trial was **not approved to add**. Text is taken as typed (composed, in practice), and the five precomposed Devanagari nukta letters are folded by hand. A phone that sends
   Malayalam or Kannada in decomposed form could be judged differently by the two runtimes. **Needs approval if the trial goes on: `golang.org/x/text`.**
10. Small: the digest of an owner op in the record is made over Go's key order, so it differs from TypeScript's for the same op (the record's content, not any behaviour).

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

1. Decide what the owner's talk-and-cards page is: ported, or kept in TypeScript with the Go runtime behind it (the front already talks to the runtime only over HTTP, so a TypeScript
   assistant service could sit beside the Go store; that is a design, not something I tried).
2. A multi-shop Go process (the TypeScript pool's job) before the free shared server is compared on memory.
3. Approval for `golang.org/x/text` (normalisation), and the price list.
4. Run the three-line check in CI: contract against both, cross-restart, differential.
