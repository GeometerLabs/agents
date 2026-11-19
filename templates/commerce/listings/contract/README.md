# The listings-only runtime contract

A suite that describes what a listings-only shop's runtime does **as the outside sees it**, so more than one implementation can be held to it. Every test makes a shop's folder in a
temp directory exactly as the deployer does, starts the shop as a **separate process** on a free port and talks to it **only over HTTP**.

```
LISTINGS_IMPL=ts node --test --test-concurrency=1 templates/commerce/listings/contract/      # the TypeScript runtime (the default)
LISTINGS_IMPL=go LISTINGS_GO_BIN=go/bin/listings node --test --test-concurrency=1 templates/commerce/listings/contract/
```

* `harness.ts` writes the folder (settings.json, runtime.json, pathway.lock, owner-link.json, pages.json, owner-grants.json; secrets internal_token, channel_token, record_key), starts
  the process (`node templates/commerce/listings/server/main.ts --client <folder>`, or the Go binary with the same arguments and the same token files), and has a fake
  OpenAI-compatible model server.
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
  TypeScript's words in the owner's language) run on both runtimes.
* `cross-restart.test.ts` runs the TypeScript runtime and the Go runtime **in turn on one folder** (both ways), so the store files are proved interchangeable, the owner-control
  state included (the lock, a request, own codes, a removed phone, the cool-down after a cancel).

* `routes.contract.test.ts` (the owner's limits page and the deployer's limit-changes, "Get my shop's file", web push through a fake push Guard, `push-harness.ts`),
  `stock.contract.test.ts`, `assistant.contract.test.ts` (the owner's talk-and-cards page, the same scripts on both runtimes compared line for line), `unicode.contract.test.ts`,
  `rates.contract.test.ts`, `restored.contract.test.ts` and `shared.contract.test.ts` (the shared process, `shared-harness.ts`) cover the rest of a listings shop; `words-fresh.test.ts`
  fails when the Go runtime's packed words (go/scripts/gen_words.ts) are stale.
* `models.contract.test.ts` covers the owner's words no rule reads: the router's decision model (a fake System One server, `startFakeDecision`) and language model, then the
  owner's talk with its checks, with every kind of untrusted answer the fakes can give (`rawReply`, `statusReply`, `slowReply`: malformed JSON, an HTTP error, a model too slow
  for its timeout; wrong types, extra members) and the day's and month's caps; `morning.contract.test.ts` covers the owner's morning line (push on, on the TEST clock: a failed
  send tried again after an hour, the next day's line, the four-hour cut-off, silent with nothing to say, never in the licence's final stop) and voice as a listings shop has
  it (off). Both run a TypeScript shop and a Go shop at once and compare them line for line.
* `differential.test.ts` gives both runtimes the SAME requests and compares the answers: the owner's form (whitespace, rounding, UTF-16 lengths), the place, the feed, and which of 21 model drafts the
  grounding checks let through.
* `measure.ts` is not a test: it prints cold start, resident memory and request latency for the runtime named by `LISTINGS_IMPL`.

No test is TypeScript only. A test is skipped only when what it needs is not there, and says so: a Go binary (`go/bin/listings`, `go/bin/listings-shared`) for the tests that run the
two runtimes in turn, and the morning-question cases in the first 20 minutes after midnight in India (the shop's morning hour would fall on yesterday).

**No runtime process outlives a run.** Every process the harnesses start goes through `children.ts`: its own process group, stopped at the end of every test, killed on exit and on
SIGINT, SIGTERM or SIGHUP, and a process still alive when the run ends fails the run and is named. Only a SIGKILL of the test process itself is beyond it.
