# Geometer blueprints

Six small reference agents that take consequential actions (refund, restore, credit, charge, pay,
reward) and are built to act correctly, so you can see what such an agent looks like and how
[Geometer](https://geometer.dev) checks it. Each one has its rules in plain words, a one-line mistake
you can apply to watch Geometer catch it, a CI workflow and a prompt for your coding assistant.

| Blueprint | World | What it does, in one line |
| --- | --- | --- |
| [refund-desk](refund-desk) | Payments | Refunds orders once, with an idempotency key and a look-up before any retry; large refunds wait for a person. |
| [item-shop](item-shop) | Geometer Worlds | Restores lost items once per ticket and sells items for gems; the ticket decides who gets the item. |
| [support-compensation](support-compensation) | Support | Makes a customer whole with a credit or a refund for a ticket, never both. |
| [booking-change](booking-change) | Bookings | Moves a traveller to another seat and charges the fee, once, even when a reply is lost. |
| [creator-payouts](creator-payouts) | Payments | Pays creators what they are owed, once per period, to their registered account only. |
| [game-master](game-master) | Geometer Worlds (creative) | An AI game master that rewards quest completions in a small economy, once per completion. |

## Try one in 5 minutes

You need [Geometer](https://geometer.dev/docs/install) and Docker running.

```sh
git clone <this repository> blueprints && cd blueprints/refund-desk
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
<blueprint>/
  agent/agent.mjs          the agent (Node.js, no dependencies, under 100 lines)
  compose.yaml             how it starts
  .geometer/rules.toml     the rules, each with a plain-words comment
  .geometer/tools.toml     the simulated services the agent talks to
  .geometer/tasks.toml     what the agent is asked to do
  broken/*.patch           one-line mistakes to apply, and watch Geometer catch
  .github/workflows/       the CI check
  README.md                rules, what was tried and the result, a prompt for your assistant
```

## Read this first: what these are not

These are sample agents running against **simulated services** and a **scripted stand-in for the
model**. They show the shape of an agent that acts carefully and how Geometer checks that shape. They are
not production code, they are not a statement about any real payment, booking or game service, and a
result is **held within what was tried**: it covers the faults and tasks listed in each README, not
every situation. What each blueprint does not check is listed in [LIMITS.md](LIMITS.md) and again in
its README. Geometer itself is for development and staging.

Licence: Apache-2.0 (see [LICENSE](LICENSE)). Copyright 2026 Naval Tharun.
