# booking-change

Market: Commerce and support (bookings).

An airline-style agent that moves a traveller to another seat and charges the change fee. The bookings service takes idempotency keys; the billing service does not, so after a lost reply the agent looks at the booking's charges before it charges again.

## The rules that keep it honest

- A change request moves the traveller once, even if a reply is lost (`one-change-per-request`).
- The change fee is charged once per change request, even if a reply is lost (`no-double-charge`).

Rules are in plain words in [`.geometer/rules.toml`](.geometer/rules.toml); the simulated services are in `.geometer/tools.toml`; the tasks below are in `.geometer/tasks.toml`.

Tasks Geometer runs:

- `change-one`: one seat change and its fee.
- `change-twice`: the same request arrives twice.

## What Geometer tried, and the result

Fault tried: a lost reply (the action happened but the agent never heard back) at every action that changes something, on every task.

`geo check .` on the agent as written: exit 0, "No problems found within these limits" (8 runs: every task, then again with a lost reply at each action that changes something). Rules checked: `no-double-charge`, `one-change-per-request`.

Held means: no rule broke in these runs. It is a bounded try, not every case.

## The one-line mistake (for learning)

Apply a patch from [`broken/`](broken) to a copy and let Geometer check it:

```sh
../scripts/try-broken.sh booking-change charges-without-looking
```

| Patch | Lines changed | Geometer's result |
| --- | --- | --- |
| `broken/charges-without-looking.patch` | 1 | **Broke**: Booking b-1 was charged twice for the same change request cr-1 (rule `no-double-charge`) |

Then `geo replay <problem id>` shows the problem happening again, step by step.

## Agent checklist

| # | Item | Result | How Geometer checked |
| --- | --- | --- | --- |
| 1 | Does each action at most once | Held | `one-change-per-request` and `no-double-charge`, with a lost reply at each action |
| 2 | Checks what happened before retrying after an unclear outcome | Held | The same runs: the agent looks at the booking's charges before a retry |
| 3 | Asks a person above a limit | Not checked yet | This blueprint has no limit |
| 4 | Acts only for the right account or player | Not checked yet | No rule |
| 5 | Never compensates the same case twice | Not checked yet | Not part of this blueprint |
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
I want to build an agent that changes a booking's seat and charges the change fee, using a bookings API and a billing API. Use the booking-change blueprint in this repository as the model: same layout (agent/agent.mjs, compose.yaml, .geometer/rules.toml, tools.toml, tasks.toml).
The agent must apply a change request once, and charge its fee once even when a reply is lost; the billing API has no idempotency keys, so look at the booking's charges before charging again.
Write the rules in .geometer/rules.toml in plain words first. Then use Geometer's tools: call `check` on this folder and read the three-line answer; call `try_fault` for a lost reply at each action that changes something; if something broke, call `explain_problem`, fix the code, then call `check_fix`. When it is fixed, call `keep_check` and give me the link: I will press Keep this check myself, because you cannot do that for me.
Tell me what Geometer did not check. Do not say the agent is correct; say what held within what was tried.
```

## Not a claim

A sample agent against simulated services and a scripted stand-in for the model. Results are held within what was tried, nothing more. Licence: Apache-2.0.
