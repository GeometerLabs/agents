# Geometer agents

Geometer's own open agents: fourteen small agents that take consequential actions (refund, restore, credit,
charge, pay, reward, order, disburse, grant) and are built to act correctly. They are the live demo of how
[Geometer](https://geometer.dev) checks an agent, and you can take one and use it as it is, with your own model
key and your own services. Each one has its rules in plain words, a one-line mistake you can apply to watch
Geometer catch it, a CI workflow and a prompt for your coding assistant.

## What is where

| Folder | What it holds |
| --- | --- |
| [templates/](templates/README.md) | Agent templates people deploy, one folder per domain: `commerce/` (bookings, orders), `education/` (fees) and `community/` (specs for village and group templates, not runnable yet). Also the [sell guide spec](templates/SELL-GUIDE.md) every template follows |
| [examples/](examples/README.md) | The fourteen example agents Geometer checks, one folder per domain: `payments/`, `commerce/`, `support/`, `games/` and `science/` |
| [modules/](modules/README.md) | The features the templates share: language, understanding, payments, messaging, the record, reports, approvals, limits, reminders and the stand-ins |
| [bundle/](bundle/README.md) | The deploy bundle: a folder per shop becomes one Docker Compose file; also the panel |
| [companies/](companies/README.md) | The kit for a company that runs its own agents against its own APIs: from an OpenAPI file to a Guard in front of the agent |
| [scripts/](scripts/try-broken.sh) | `try-broken.sh`: apply an example agent's one-line mistake to a copy and let Geometer check it |

## Templates: free agents for real jobs (new)

A **template** is a ready, tested agent for one job a local business already pays for, built from modules and tailored by settings. Each comes with its limits, a crash test, a record, a monthly report for the shop, and a guide to pitching and selling it locally in every language it speaks. They're free and open, like everything here, and you can [contribute](CONTRIBUTING.md): a language pack, a crash-test situation, a native speaker's review, or a new template.

| Template | For | State |
| --- | --- | --- |
| [bookings](templates/commerce/bookings) | Salons and studios taking bookings with a deposit on WhatsApp, in Hindi, English, Malayalam and Kannada. Also village equipment hiring (see Community templates) | Built and checked against stand-in services; not yet live with a real business |

## Deploy bundle: run it on a small server (new)

[bundle/](bundle/README.md) turns a folder per shop into one Docker Compose file: the shop's runtime, one Guard per upstream per shop, the server's model Guard, the webhook inbox, owner approvals on WhatsApp, HTTPS, a heartbeat to Geometer and a continuous copy of every record. A deploy is refused, naming the rule, unless every limit is proven to bite on the Guard. A builder runs it on their own VPS; the guide goes from an empty Ubuntu server to the first shop. The Guard image is not in a registry yet, so it is loaded from a file.

## Community templates: money and records that many people share

Villages and community groups often lack one thing: trust in **who handles the money and the records**. These templates answer it with limits that sit outside the AI, and with a signed statement on every member's phone, so a quiet change would not match the other copies. The agent only records and reminds; it never holds, pools, lends or moves money. They're free and open, and the specs are open for comment.

| Template | For | State |
| --- | --- | --- |
| [Equipment rental](templates/commerce/bookings/settings/equipment-rental.example.json) (a Bookings variant) | Custom hiring centres and village equipment owners who rent a tractor and its attachments by the half day or the day, with a deposit, in Kannada and Hindi | **Built as settings** on [templates/commerce/bookings](templates/commerce/bookings), with a [sell guide variant](templates/commerce/bookings/sell/variants/) in four languages. Checked on stand-in services (33 of 33 situations); no hiring centre is live. What it can't do yet (several machines at once, per-acre prices, voice notes) is listed in [Deferred.md](templates/commerce/bookings/Deferred.md) |
| [Self-help group savings and repayments](templates/community/self-help-group/README.md) | Women's self-help groups and their book-keepers: monthly savings, the group's own loan repayments, meeting reminders, and a statement every member can read | **Planned** (a spec; comment in GitHub Discussions). Would be built on fee and dues collection |
| [Community and committee funds](templates/community/community-fund/README.md) | Festival and temple committees, borewell and water groups, housing societies: what came in, what went out with whose approval, and the balance, sent to every contributor | **Planned** (a spec). Would be built on fee and dues collection |
| [Meeting follow-through](templates/community/meeting-follow-through/README.md) | Self-help groups, committees and cooperatives: decisions drafted from a voice note, confirmed by a named person, then reminders and evidence that each task got done | **Planned** (a spec). Phase 3, after fee collection and the voice module |

What "planned" means is in [templates/community/](templates/community/README.md): a spec that anyone can comment on, not something you can run. The signed statements and the public fingerprints are planned too; none of it is claimed until it is built.

## The example agents

They are in [examples/](examples/README.md), one folder per domain.

| Agent | Market | Framework | What it does, in one line |
| --- | --- | --- | --- |
| [refund-desk](examples/payments/refund-desk) | Commerce and support (payments) | Node.js, no framework | Refunds orders once, with an idempotency key and a look-up before any retry; large refunds wait for a person. |
| [lending](examples/payments/lending) | Money movement (lending) | OpenAI Agents SDK (Python) | Disburses an approved loan once per application, to the verified account only. |
| [claims](examples/payments/claims) | Money movement (claims) | Strands Agents (Python) | Pays out an insurance claim at most once; an adjuster approves big ones. |
| [creator-payouts](examples/payments/creator-payouts) | Money movement (payouts) | Node.js, no framework | Pays creators what they are owed, once per period, to their registered account only. |
| [purchasing](examples/payments/purchasing) | Money movement (purchasing) | CrewAI (Python) | Buys supplies within a buyer's mandate, one order per request. |
| [item-shop](examples/games/item-shop) | Games and live worlds | Node.js, no framework | Restores lost items once per ticket and sells items for gems; the ticket decides who gets the item. |
| [booking-change](examples/commerce/booking-change) | Commerce and support (bookings) | Node.js, no framework | Moves a traveller to another seat and charges the fee, once, even when a reply is lost. |
| [support-compensation](examples/support/support-compensation) | Commerce and support (support) | Node.js, no framework | Makes a customer whole with a credit or a refund for a ticket, never both. |
| [access-grants](examples/support/access-grants) | Operations (access) | Google ADK (Python) | Grants a role on request, once; admin roles need approval. |
| [game-director](examples/games/game-director) | Games and live worlds | Pydantic AI (Python) | An AI director that spawns resources and adjusts shop prices in a small world economy, each event once, prices within bounds. |
| [game-master](examples/games/game-master) | Games and live worlds | Node.js, no framework | An AI game master that rewards quest completions in a small economy, once per completion. |
| [liveops-compensation](examples/games/liveops-compensation) | Games and live worlds | LangGraph (Python) | After a server crash eats a raid loadout, restores the items or currency per ticket; big ones wait for a game master. |
| [streamer-giveaways](examples/games/streamer-giveaways) | Games and live worlds | Vercel AI SDK (TypeScript) | An AI streamer that gives viewers promo codes from approved campaigns, one per viewer, never an operator tool. |
| [lab-protocol](examples/science/lab-protocol) | Operations (lab) | Mastra (TypeScript) | Runs a protocol step on a sample once; a scientist approves discards. |

## Try one in 5 minutes

You need [Geometer](https://geometer.dev/docs/install) `0.1.0-alpha.2` or later and Docker running. The first six agents also check with `0.1.0-alpha.1`; the eight framework agents need `0.1.0-alpha.2`, which added their framework support.

```sh
git clone <this repository> agents && cd agents/examples/payments/refund-desk
geo check .                              # the agent as written: "No problems found within these limits"
../../../scripts/try-broken.sh refund-desk skips-approval   # the one-line mistake: Geometer finds a problem
```

`geo check` builds the agent in a container, runs its tasks against simulated services, then runs them
again with something going wrong on purpose (a reply that never arrives, for example), and checks the
rules in `.geometer/rules.toml` against what happened. The first run builds the container and takes a
few minutes; later runs take about half a minute. Every folder also holds a GitHub Actions workflow
(`.github/workflows/geometer.yml`) that runs the same check on each pull request.

## What the folders contain

```
<agent>/
  agent/agent.mjs          the Node.js samples: the agent (no dependencies, under 100 lines) and compose.yaml
  app/ or src/             the framework agents: the agent and its tools (Python app/, TypeScript src/)
  requirements.txt         the framework agents: the pinned framework version (package.json for TypeScript)
  .env.example             the framework agents: the model and your services' addresses
  .geometer/rules.toml     the rules, each with a plain-words comment
  .geometer/tools.toml     the simulated services the agent talks to
  .geometer/tasks.toml     what the agent is asked to do
  broken/*.patch           one-line mistakes to apply, and watch Geometer catch
  .github/workflows/       the CI check
  README.md                rules, how to run it for real, how to check it, a prompt for your assistant
```

The eight framework agents have no Dockerfile: Geometer builds the image for the framework itself.

## Read this first: what these are not

The six Node.js agents are small samples. The eight framework agents are real agents you can run with your own
model key against your own services (each README says how). In every folder, `geo check` runs the agent against
**simulated services** and a **scripted stand-in for the model**: it shows how the agent's own code behaves, not
how a real model would choose or how your real payment, booking, loan or game service behaves. A result is
**held within what was tried**: it covers the faults and tasks listed in each README, not every situation. What
each agent does not check is listed in [LIMITS.md](LIMITS.md) and again in its README. Geometer itself is for
development and staging.

Licence: Apache-2.0 (see [LICENSE](LICENSE)). Copyright 2026 Naval Tharun.
