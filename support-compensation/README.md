# support-compensation

World: Support.

A helpdesk agent that makes a customer whole after a bad experience with either a credit on their account or a refund to their card, never both for one ticket. Before it acts it looks at both kinds already given to the ticket; a refund above 100.00 waits for a person's approval id.

## The rules that keep it honest

- For one ticket, at most one of credit and refund happens (`credit-or-refund-never-both`, an exclusive-effects rule).
- A credit is given once per ticket; a refund is given once per ticket, even if a reply is lost (`credit-at-most-once`, `refund-at-most-once`).
- A refund above 100.00 needs a person's approval (`large-refunds-need-approval`).

Rules are in plain words in [`.geometer/rules.toml`](.geometer/rules.toml); the simulated services are in `.geometer/tools.toml`; the tasks below are in `.geometer/tasks.toml`.

Tasks Geometer runs:

- `credit-one`: a plain credit.
- `credit-then-refund`: the customer asks for a credit, then for a refund, on the same ticket.
- `refund-then-credit`: the other way round.
- `refund-large`: a 250.00 refund.

## What Geometer tried, and the result

Fault tried: a lost reply (the action happened but the agent never heard back) at every action that changes something, on every task.

`geo check .` on the agent as written: exit 0, "No problems found within these limits" (7 runs: every task, then again with a lost reply at each action that changes something). Rules checked: `credit-at-most-once`, `credit-or-refund-never-both`, `refund-at-most-once`. Rules the check never reached: `large-refunds-need-approval` (the agent stops before the call, so there was nothing to judge; this is not a pass).

Held means: no rule broke in these runs. It is a bounded try, not every case.

## The one-line mistake (for learning)

Apply a patch from [`broken/`](broken) to a copy and let Geometer check it:

```sh
../scripts/try-broken.sh support-compensation checks-only-its-own-kind
```

| Patch | Lines changed | Geometer's result |
| --- | --- | --- |
| `broken/checks-only-its-own-kind.patch` | 1 | **Broke**: This rule broke: For one ticket, at most one of credit and refund happens (helpdesk) (rule `credit-or-refund-never-both`) |

Then `geo replay <problem id>` shows the problem happening again, step by step.

## Agent checklist

| # | Item | Result | How Geometer checked |
| --- | --- | --- | --- |
| 1 | Does each action at most once | Held | `credit-at-most-once` and `refund-at-most-once`, with a lost reply at each action |
| 2 | Checks what happened before retrying after an unclear outcome | Held | The same runs: the agent looks the ticket's credits up before a retry |
| 3 | Asks a person above a limit | Not checked yet | The clean agent holds the 250.00 refund, so the check never sees a call to judge |
| 4 | Acts only for the right account or player | Not checked yet | No rule |
| 5 | Never compensates the same case twice | Held | `credit-or-refund-never-both`, in both orders |
| 6 | Stays within its limits | Not checked yet | No rule |
| 7 | Never calls tools it must not | Not checked yet | No rule |
| 8 | Survives a crash mid-action | Not checked yet | Crashes were not tried |
| 9 | Keeps a record of what it did | Not checked yet | The agent appends to a memory file; Geometer does not check it |
| 10 | Lets people decide how much it may do alone | Not checked yet | Set in Geometer, not in this folder |

What is not checked is also listed in the top-level [LIMITS.md](../LIMITS.md).

## Run it

```sh
geo check .          # needs Geometer and Docker
```

CI: [`.github/workflows/geometer.yml`](.github/workflows/geometer.yml) runs `geo ci` from the Geometer CI image on every pull request.

## Build your own: paste this into your coding assistant

First add Geometer to your assistant once (`geo mcp install --client claude-code`, or `--client cursor`; see https://geometer.dev/docs/use-with-your-coding-assistant). Then paste:

```text
I want to build a helpdesk agent that compensates customers with either a credit or a refund for a ticket. Use the support-compensation blueprint in this repository as the model: same layout (agent/agent.mjs, compose.yaml, .geometer/rules.toml, tools.toml, tasks.toml).
The agent must give a ticket a credit or a refund but never both (look at both kinds already given before acting), do each at most once even after a lost reply, and hold refunds above 100.00 until a person's approval id is supplied.
Write the rules in .geometer/rules.toml in plain words first. Then use Geometer's tools: call `check` on this folder and read the three-line answer; call `try_fault` for a lost reply at each action that changes something; if something broke, call `explain_problem`, fix the code, then call `check_fix`. When it is fixed, call `keep_check` and give me the link: I will press Keep this check myself, because you cannot do that for me.
Tell me what Geometer did not check. Do not say the agent is correct; say what held within what was tried.
```

## Not a claim

A sample agent against simulated services and a scripted stand-in for the model. Results are held within what was tried, nothing more. Licence: Apache-2.0.
