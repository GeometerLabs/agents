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
  (modules/runtime/test-clock.ts, go/internal/testclock: honoured only for a "fakes" shop; a live shop refuses to start with it). Its push test is TypeScript only.
* `cross-restart.test.ts` runs the TypeScript runtime and the Go runtime **in turn on one folder** (both ways), so the store files are proved interchangeable, the owner-control
  state included (the lock, a request, own codes, a removed phone, the cool-down after a cancel).

* `differential.test.ts` gives both runtimes the SAME requests and compares the answers: the owner's form (whitespace, rounding, UTF-16 lengths), the place, the feed, and which of 21 model drafts the
  grounding checks let through.
* `measure.ts` is not a test: it prints cold start, resident memory and request latency for the runtime named by `LISTINGS_IMPL`.

Six tests are **TypeScript only** and are skipped, with the reason, for a runtime that does not serve them: the owner's talk-and-cards page (`GET /internal/channel/owner`; its cards, and the owner's taps on them, are how a draft is shown), web push, the owner's limits page, the owner's Stock page, "Get my shop's file" (`owner-file`) and the deployer's `/internal/limit-changes`. They are what a
runtime must still add to be a drop-in replacement.
