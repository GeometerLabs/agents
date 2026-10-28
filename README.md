# Geometer agents

Geometer's own open agents: fourteen small agents that take consequential actions (refund, restore, credit,
charge, pay, reward, order, disburse, grant) and are built to act correctly. They are the live demo of how
[Geometer](https://geometer.dev) checks an agent, and you can take one and use it as it is, with your own model
key and your own services. Each one has its rules in plain words, a one-line mistake you can apply to watch
Geometer catch it, a CI workflow and a prompt for your coding assistant.

| Agent | World | Framework | What it does, in one line |
| --- | --- | --- | --- |
| [refund-desk](refund-desk) | Payments | Node.js, no framework | Refunds orders once, with an idempotency key and a look-up before any retry; large refunds wait for a person. |
| [item-shop](item-shop) | Geometer Worlds | Node.js, no framework | Restores lost items once per ticket and sells items for gems; the ticket decides who gets the item. |
| [support-compensation](support-compensation) | Support | Node.js, no framework | Makes a customer whole with a credit or a refund for a ticket, never both. |
| [booking-change](booking-change) | Bookings | Node.js, no framework | Moves a traveller to another seat and charges the fee, once, even when a reply is lost. |
| [creator-payouts](creator-payouts) | Payments | Node.js, no framework | Pays creators what they are owed, once per period, to their registered account only. |
| [game-master](game-master) | Geometer Worlds (creative) | Node.js, no framework | An AI game master that rewards quest completions in a small economy, once per completion. |
| [liveops-compensation](liveops-compensation) | Geometer Worlds | LangGraph (Python) | After a server crash eats a raid loadout, restores the items or currency per ticket; big ones wait for a game master. |
| [game-director](game-director) | Geometer Worlds | Pydantic AI (Python) | An AI director that spawns resources and adjusts shop prices in a small world economy, each event once, prices within bounds. |
| [streamer-giveaways](streamer-giveaways) | Geometer Worlds (creative) | Vercel AI SDK (TypeScript) | An AI streamer that gives viewers promo codes from approved campaigns, one per viewer, never an operator tool. |
| [purchasing](purchasing) | Purchasing | CrewAI (Python) | Buys supplies within a buyer's mandate, one order per request. |
| [lending](lending) | Lending | OpenAI Agents SDK (Python) | Disburses an approved loan once per application, to the verified account only. |
| [claims](claims) | Claims | Strands Agents (Python) | Pays out an insurance claim at most once; an adjuster approves big ones. |
| [lab-protocol](lab-protocol) | Lab | Mastra (TypeScript) | Runs a protocol step on a sample once; a scientist approves discards. |
| [access-grants](access-grants) | Access | Google ADK (Python) | Grants a role on request, once; admin roles need approval. |

## Try one in 5 minutes

You need [Geometer](https://geometer.dev/docs/install) and Docker running.

```sh
git clone <this repository> agents && cd agents/refund-desk
geo check .                              # the agent as written: "No problems found within these limits"
../scripts/try-broken.sh refund-desk skips-approval   # the one-line mistake: Geometer finds a problem
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
