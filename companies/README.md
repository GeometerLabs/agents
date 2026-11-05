# Guard for companies: the kit

For an engineer at a company (or an agency) that runs its own AI agents against its own APIs, customer-facing or internal. This is the first slice of plan item B58. It takes you from **your API's OpenAPI file** to **a Guard in front of your agent**, with the limits written down, reviewed by a person, and checked by Guard's own compiler.

It does not host anything for you. Guard is Geometer's closed program, licensed separately; this kit is open and only helps you write its limits and run it next to your agent. Read ["What it does not do"](#what-it-does-not-do) before you rely on any of it.

## What Guard does

Guard sits between your agent and your API. The agent calls Guard instead of the API; Guard checks each call against limits a person wrote, and only then sends it on.

| What the home page offers | What it means here | State in this kit |
|---|---|---|
| Limits outside the AI | Amount bounds, daily spend and call counts, calls you forbid, and a refusal for any call you did not list. The agent cannot talk its way past them: they are not in its prompt. | Built and tested against the real Guard |
| Approvals bound to the exact action | A call above a threshold is held. A named person approves **that** call; the agent sends it again and it goes, once. Change one number and it is a new call that needs its own approval. | Built and tested |
| Money moved at most once, even when a reply is lost | The same action is sent once. If the API's reply is lost, Guard does not send it again by itself: it holds the repeat for a person to settle. | Built and tested |
| A record your reviewers can check | Every decision is written down; Guard writes a tamper-evident evidence pack that the open `geo-verify` checks against an anchor you keep. | Built; the export is tested. See [The record](#the-record-for-your-reviewers) |
| Crash tests on your own setup | Faults (lost replies, duplicates) tried against **your** agent through Guard, before go-live and before every update. | **Not built.** The self-serve crash test is B52. This kit has the pattern in `test/end-to-end.test.ts` and a made-up API you can copy |
| Certificates for your customers' security reviews | A signed report of what was checked. | **Not built for this flow.** See [Certificates](#certificates) |

**Guard is an alpha.** Its own guide says it "has not been qualified for production traffic". Use it on staging, with real traffic shapes, before you put it in front of live money.

## Before you start

- Node 24.2 or newer (the kit is plain Node with no dependencies; it runs `.ts` files directly). Tested only on Node 26.10.
- Your API's **OpenAPI 3.x file as JSON.** YAML is not read (a YAML parser is more code than a limits tool should carry). Convert it first with a tool you trust.
- Guard. Licensed separately, not downloadable from this repository, and the container image is not in a public registry yet. You get the `geo-guard` program or image from Geometer with your licence. Without it, `draft` and `build --no-compile` still work; compiling, the end-to-end tests and the sidecar do not.
- Know which of your API's calls the agent really needs. Guard refuses everything you do not list, so a short list is the place to start.

## From OpenAPI to a compiled bundle

Four steps, with a person in the middle of them. The example is a made-up refunds API for a made-up shop, in `examples/refunds-api/`.

### 1. Draft

```
node companies/openapi-to-spec.ts draft companies/examples/refunds-api/refunds-api.openapi.json --out work/draft.json --tool refunds
```

```
Read Brightside Refunds API (OpenAPI 3.0.3): 9 calls, 4 look consequential, 16 suggestions, 0 skipped.
Wrote the draft:  work/draft.json
Wrote the accept template:  work/accept.template.json
This is a DRAFT. Read every "review" note. Then copy the template to accept.json, switch on what you keep, fill the blanks, and run build.
```

`draft.json` is **not a Guard spec** and Guard cannot load it. It lists:

- every call in the file (`routes`), what each carries, and whether it looks consequential and why;
- suggested rules and limits for the consequential ones, each with a `review` note in plain words and the blanks only you can fill;
- `skipped`: calls Guard cannot match (a parameter in the middle of a path segment, `HEAD`, `OPTIONS`), with the reason.

A call looks **consequential** when it is a `DELETE`, or a `POST`, `PUT` or `PATCH` that carries a number named like money (`amount`, `price`, `fee`, `cents`...) or has refund, charge, transfer, delete, cancel, payout, payment, withdraw, void, capture, debit, credit, remove, terminate or close in its name or path. These are guesses by name. A call that moves money under a name nobody expected will not be flagged: read the whole `routes` list, not only the flagged ones.

The suggestions are:

| Suggestion | What it does | You fill in |
|---|---|---|
| `argument_bound` | Refuses a call whose amount is outside `min`..`max` | `min`, `max` |
| `call_bound_approval` | Holds a call whose amount is above a threshold until a person approves it | `threshold` |
| `at_most_once_effect` | The same action is sent at most once | `key_fields` (guessed from ids and idempotency headers; check the guess) |
| `forbidden_call` | Always refused, by name | nothing |
| `spend` and `count` limits | Cap the total or the number of calls in a window (a day by default) | `cap` |

### 2. Review and accept

Copy `accept.template.json` to `accept.json`. In it:

- put your name in `reviewed_by` (the tool will not choose one) and your environment's name in `tenant`;
- set the **routes** the agent may call to `true`; everything else stays refused as unlisted;
- on each suggestion you want, set `"keep": true` and fill every `null`. The review note is copied beside it as `_review`.

Anything left false is dropped. `build` refuses, naming every problem at once, when:

- there is no `--accept` file at all;
- the accept file was made for another draft (the draft's hash is pinned inside it, so a changed API file cannot reuse an old review);
- a blank is left in something you kept, an amount is not a string of digits (`"50000"`, never `50000.0` or `"5e4"`), or a cap is not a whole number;
- a rule is kept for a route you did not keep, or a key field or scope names something the call does not carry;
- a threshold is not below the bound's max (no call could ever be held);
- `reviewed_by` or `tenant` is empty, or nothing is kept.

The example's `accept.json` is the template filled in the way a reviewer would: a refund is bounded to 1..50000 cents, held above 10000, made once per charge and capped at 200000 cents and 100 refunds a day; a transfer is forbidden by name; the customer calls are left out (so refused as unlisted).

### 3. Build and compile

```
node companies/openapi-to-spec.ts build --draft work/draft.json --accept work/accept.json --out work/spec.json \
  --bundle work/guard/bundle.json --guard-toml work/guard/guard.toml --upstream refunds.brightside.example:443
```

This writes `spec.json` (a Guard limits spec, schema 1, see Guard's limits-spec document), then runs the real `geo-guard compile` and `geo-guard verify-bundle` and prints what they say:

```
Kept 6 routes, 4 rules, 3 limits.
Guard compiled it: 4 rules, 3 limits, 6 routes, digest sha256:de7ec839...
Tripwires: passed 4 of 4.
Guard cannot test these without writing (read them; they are part of what you are told was not covered):
  - rule create_refund-once: whether a repeat is stopped depends on the intent ledger in the store; a probe would have to write to it
  - limit create_refund-spend-per-day: a cap is counted by reserving capacity in the store; a probe would have to write to it
  ...
Only the API itself can settle these:
  - create_refund-once: when a reply is lost the first attempt's outcome is unknown; only the provider's receipt lookup or idempotency key can show whether it happened ...
verify-bundle: sha256:de7ec839... ok (ceiling production) (checked against guard.toml)
```

**Read those two lists.** They are what Guard cannot check by itself. The "tripwires" are calls Guard derives from your bounds (one unit over the max, one under the min, one over the threshold) and runs through its own decision path without sending anything; limits and "at most once" cannot be tried that way.

If `geo-guard` is not found the spec is still written, nothing is compiled, and the exit code is 3. It looks in `GEO_GUARD_BIN`, your `PATH`, then a Geometer monorepo build above this folder. `--no-compile` says you meant it.

The compiler's word `reviewed_by` is only your declaration. It cannot know a person looked at the numbers. Whoever builds the spec owns that claim.

### 4. Credentials, then the digest

The starter `guard.toml` has all-zero credential hashes, which match no token, so a Guard started from it lets nobody in. Make two tokens and put their hashes in:

```
geo-guard credential   # prints  token: gg_...   and   token_sha256 = "..."
```

- the agent's token: its hash goes under `[[agents]]`, the token itself in `secrets/guard_agent_token`;
- the operator's token (for approvals and the export): its hash under `[[admins]]`, the token in `secrets/guard_admin_token`;
- the API's own key, the whole header value on one line (`Bearer sk_live_...`), in `secrets/api_authorization`. Guard reads it from that file and adds it to every call it sends.

`bundle_digest` in `guard.toml` is the digest the build printed; Guard refuses a bundle file that does not hash to it. Run `geo-guard verify-bundle guard/bundle.json --config guard/guard.toml` again after you edit. Raise `version` in the accept file with every change: Guard loads a bundle only if its version is higher than the one it has.

## Run Guard next to your agent

Two recipes in `deploy/`, text only. Neither has been started with the real Guard image, because it is licensed separately; they are checked by `docker compose config` and by reading the YAML (see [Tests](#tests)).

- `deploy/compose.yaml`: Guard and your agent in Docker Compose. The agent is on an `internal` network with Guard and nothing else; only Guard is also on a network that can reach the API. The API's key is a secret given to Guard's container alone.
- `deploy/kubernetes-sidecar.yaml`: Guard as a second container in your agent's pod. **This separates the key, not the network.** Containers in a pod share one network, so a NetworkPolicy cannot stop the agent container from calling the API directly. A call that skips Guard has no key to use, but nothing blocks it. If the network must block it, run Guard as its own pod and apply `deploy/kubernetes-network-policy.yaml` (agent pods may reach Guard's Service and DNS, nothing else).

### How the agent's base URL changes

Two settings, nothing else in your agent:

```
before:  API_BASE_URL=https://refunds.brightside.example     API_KEY=sk_live_...   (the API's own key)
after:   API_BASE_URL=http://guard:8080                      API_KEY=<Guard's token for this agent>
```

Guard takes the agent's `Authorization: Bearer <token>` (or `X-Geo-Agent-Key`), removes it, adds the API's own header from `guard.toml`, and sends the rest unchanged. Paths stay the same: if your OpenAPI `servers` has a base path (`/v2`), your routes already include it. The agent talks plain HTTP to Guard on the internal network; if your rules want TLS between containers, put a TLS front in front of Guard.

The agent must be able to read the answers Guard gives when it does **not** send a call:

| Guard says | HTTP | The agent must |
|---|---|---|
| Held for a person | **202** with a `guard` object and `guard.decision == "hold"` | Treat it as **not done.** A held call is a 2xx: check for the `guard` object before believing any 2xx |
| Refused | 403, `guard.code == "refused_by_policy"`, the rule named in `guard.reason` | Not retry; tell a person in words |
| Same action, other numbers | 409 | Not retry |
| Reply lost | 504, `guard-outcome: unknown` | **Not repeat it.** Ask a person |
| Guard cannot decide | 503 | Not done; retry later |
| Anything else | The API's own answer | Use it |

A reply with no `guard` object is the API's own. Guard's full table is in its "Guard for pathways" document.

## Approvals

Guard's admin credential alone never approves. An approver needs a role that covers the call (`guard.toml` has an `approver` role for each operation you put a threshold on).

```
# the operator issues an approver a credential that expires
curl -s -X POST $ADMIN/admin/approvers -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"id":"alex.reviewer","roles":["approver"],"ttl_seconds":3600}'      # -> "token": "gg_..." (shown once)

# the approver reads what is waiting, then decides about that exact call
curl -s $ADMIN/admin/reviews -H "Authorization: Bearer $APPROVER_TOKEN"
curl -s -X POST $ADMIN/admin/approvals/$ID/approve -H "Authorization: Bearer $APPROVER_TOKEN" -d '{}'
```

The agent then sends the **identical** call again and it goes. An approval works once; the same call again is held again under a new id, and a call with any number changed needs its own. `$ADMIN` is Guard's admin port (loopback only); reach it from a container that shares Guard's network, or with `kubectl port-forward`. `test/end-to-end.test.ts` walks all of this against the real Guard.

Guard can also take signed answers from a chat tool (`POST /admin/notify`). A Slack or Teams front for approvals is not in this kit.

## When a reply is lost

The API makes the refund and the answer never arrives. Guard answers the agent **504, outcome unknown**, and the identical repeat is **held with nothing to approve** (`detail.approval` is `null`): Guard does not send it again by itself, because it cannot know whether the first one happened. A person settles it:

```
curl -s $ADMIN/admin/intents -H "Authorization: Bearer $ADMIN_TOKEN"          # the uncertain calls, with their full ids
# check at the API whether the refund exists, then say so:
curl -s -X POST $ADMIN/admin/intents/resolve -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"intent":"intent:...","resolution":"happened"}'        # or "did_not_happen": only after looking
```

Say `did_not_happen` only after looking: a refund that did happen would then be sent a second time.

Guard repeats an uncertain call on its own only when the spec says your API keeps its idempotency keys (`retry_safe` and `key_lifetime_seconds`, in Guard's limits spec). **This kit never writes that**; add it by hand if your API's documentation promises it.

## The record for your reviewers

```
node companies/export-record.ts --admin http://127.0.0.1:8082 --token-file secrets/guard_admin_token \
  --out review/2026-11 --evidence-dir /var/lib/geo-guard/export
```

writes, to `review/2026-11/`:

- `record.jsonl`: one line per decision, oldest first: time, agent, operation, `sent` / `refused` / `held` / `replayed` / `unknown`, the API's status, the rule that said no, the call's digest and its arguments;
- `decisions.json`, `approvals.json`, `intents.json`: exactly what Guard said;
- `summary.txt`: counts, and what the export cannot show;
- `manifest.json`: the sha256 of each of the files above.

With `--evidence-dir` Guard also writes its **evidence pack** and a signed **anchor** into that folder (a folder Guard can write to: a volume you can also read). The pack is the part that is tamper-evident. A reviewer checks it with the open verifier, [`geo-verify`](https://github.com/GeometerLabs/geometer-verify) (Apache-2.0), using an anchor kept **where your engineers cannot change it**:

```
geo-verify evidence-pack.json --anchor anchor.json     # VERIFIED, exit 0
geo-verify evidence-pack.json                          # UNVERIFIABLE, exit 3: no anchor, nothing is claimed
```

A changed entry makes it INVALID (exit 1); the tests do this. What a pass means, in the verifier's own words: it "shows the record was not changed since the anchor, not that it is true or complete."

Three limits to know:

- Guard lists only its **500 most recent decisions** at a time. A full list means older ones are not in `record.jsonl`; the evidence pack has them. Export often enough that a busy day does not fall out of the list.
- `record.jsonl` is Guard's word and the API's status. It does not read the API back, so `sent` means the API answered, not that the money moved.
- The exports hold the calls' arguments (ids, amounts). Treat them like your logs.

This is not the Bookings pathway's record (`bundle/agent/record.ts`); that one judges "done" from what three known services hold. Here, nothing reads your API back (see [Deferred.md](Deferred.md)).

### Certificates

Geometer's `geo` tool can run a check on an agent project and issue a signed report from it ("Issue and share a certificate" in Geometer's user docs). That flow is about a finished check of an agent, not about Guard's decisions on your API, and this kit does not connect them. What you can hand a customer's security reviewer today is this record (the evidence pack, the anchor and the open verifier), plus the spec and the compiled bundle's digest, which say what Guard was told to enforce. A **certificate per agent version**, built from Guard's evidence, is not built.

## Changing the limits later

Change the OpenAPI file or your choices, run `draft` again if the API changed, make a new accept file with a **higher `version`**, and `build`. Guard loads a bundle at start only if its version is higher than the one in its store; to roll one out without a restart, `POST /admin/policy` with `{"bundle": <bundle.json>}` and the admin credential. Guard's guide says a rollout voids approvals granted under the old policy (not tested here).

## What it does not do

- **No hosting by Geometer.** Guard runs in your cloud, on your machines. A private deployment that Geometer runs is a contract (plan item B58; price in the economics document), not part of this kit.
- **Guard is a closed program, licensed separately.** It is not in this repository and its image is not in a public registry. This kit only writes inputs for it and runs next to it. Guard is an alpha, not qualified for production traffic.
- **It sees only calls that go through it.** An agent that still holds your API's key, or can reach the API another way, is not stopped. The Compose recipe takes the network away; the Kubernetes sidecar only takes the key away.
- **It does not make the agent's choices good.** It bounds calls: how much, how often, how many times, who approves. It says nothing about whether a refund was the right thing to do.
- **It does not read your API back.** It cannot tell whether a refund really reached the customer. Guard asks the API about an uncertain call only if the spec gives it a receipt lookup; this kit does not write one.
- **The draft is a draft.** Money fields are found by name, key fields are guessed, and a call that moves money under an unexpected name is not flagged. JSON only; OpenAPI 3.x only; local `$ref`s only; JSON bodies only (a form body is noted, not read); arrays inside a body cannot be read by a rule.
- **The compiler cannot check your reading of the API.** Whether `amount` is in cents, whether a route exists, whether the API honours `Idempotency-Key`: none of it is checked. Test on staging.
- **Static credentials only.** The API's key is one header read from a file. OAuth that must refresh, mutual TLS and signed requests are not handled.
- **Not covered at all:** gRPC, streaming, WebSockets, GraphQL (one route hides every operation). AP2 and ACP payment rails (B41). Several tenants behind one Guard. A self-serve crash test (B52). Details and triggers in [Deferred.md](Deferred.md).

## Tests

```
cd companies && npm test          # node --test, one file at a time
```

48 tests: 28 on the draft, the accept step and the command line, 7 end to end through the real `geo-guard`, 3 on the export and the evidence pack, 2 on the made-up API, 8 on the deploy recipes. The ones that run the real Guard (12) and the one that runs `geo-verify` are skipped, saying why, when the program is not found. Four of the deploy tests need Docker (they run `docker compose config`; nothing is started) and two need Ruby for its built-in YAML parser; each is skipped, saying so, without it. They were run against a debug build of `geo-guard` on macOS, a made-up API, and no real company.

## Where things are

| File | What it is |
|---|---|
| `openapi-to-spec.ts` | the command line: `draft` and `build` |
| `openapi-read.ts` | reads the OpenAPI JSON: calls, what each carries, local `$ref`s |
| `guard-binary.ts` | finds and runs `geo-guard compile`, `verify-bundle`, `credential`; finds `geo-verify` |
| `guard-config.ts` | writes `guard.toml` (production profile, no secret in it) |
| `export-record.ts` | the reviewers' export |
| `deploy/` | `compose.yaml`, `.env.example`, `kubernetes-sidecar.yaml`, `kubernetes-network-policy.yaml` |
| `examples/refunds-api/` | the made-up API: its OpenAPI file, `draft.json`, `accept.template.json`, `accept.json`, `spec.json`, `bundle.json`, and `fake-api.ts` |
| `test/` | the tests |
| `Explanation.md`, `Deferred.md` | how it works and why; what is not built, with triggers |

### Regenerating the example

The example's files are checked in, and a test fails if the tool writes something else today. After a change to the tool or the example API:

```
cd companies
node openapi-to-spec.ts draft examples/refunds-api/refunds-api.openapi.json --out examples/refunds-api/draft.json --tool refunds
# make accept.json again from the new accept.template.json (it pins the new draft's hash): the same choices as before
node openapi-to-spec.ts build --draft examples/refunds-api/draft.json --accept examples/refunds-api/accept.json --out examples/refunds-api/spec.json
```

`fake-api.ts` runs on its own too: `node examples/refunds-api/fake-api.ts --port 4010`. It keeps everything in memory and, on purpose, does not honour `Idempotency-Key`.
