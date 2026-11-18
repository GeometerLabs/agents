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
* `cross-restart.test.ts` runs the TypeScript runtime and the Go runtime **in turn on one folder** (both ways), so the store files are proved interchangeable.

* `differential.test.ts` gives both runtimes the SAME requests and compares the answers: the owner's form (whitespace, rounding, UTF-16 lengths), the place, the feed, and which of 19 model drafts the
  grounding checks let through.
* `measure.ts` is not a test: it prints cold start, resident memory and request latency for the runtime named by `LISTINGS_IMPL`.

The one TypeScript-only test is `GET /internal/channel/owner` (the owner's talk-and-cards page: the whole assistant's view), which a Go runtime does not serve.
