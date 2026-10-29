# purchasing

Market: Money movement (purchasing). Framework: CrewAI (Python), `crewai` 1.15.32.

Buys supplies for purchase requests within a buyer's mandate. The request decides the supplier, item and amount; each request is ordered once; an order above the buyer's limit waits for the buyer's own approval id.

One CrewAI `Agent` with two tools, one `Task` and a `Crew` (`app/agent.py`); the logic is in `app/tools.py`.

## Rules

- `one-order-per-request`: A purchase request is ordered once, even if the supplier's reply is lost.
- `never-above-the-buyers-limit`: An order above the buyer's limit (500.00 for the buyers in this setup) needs the buyer's own approval id first.

Each rule is in plain words in [`.geometer/rules.toml`](.geometer/rules.toml); the simulated service is in `.geometer/tools.toml`, the tasks in `.geometer/tasks.toml`.

## Run it for real

You need your own model key and a service that answers the calls below. The agent's own code calls only the model and your service.

```sh
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then fill in the model key and your service's address
set -a; . ./.env; set +a
python -m app "Please order the supplies on purchase request id pr-1."
```

Settings (see [`.env.example`](.env.example)):

- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `MODEL`: the model, any OpenAI-compatible endpoint.
- `PROCUREMENT_URL`: your procurement service

Your service must answer these calls (JSON bodies):

| Call | What it returns or does |
| --- | --- |
| `GET /v1/requests/{id}` | the purchase request: `buyer`, `supplier`, `item`, `quantity`, `amount`, `buyer_limit` |
| `GET /v1/requests/{id}/orders` | a list of the orders already placed for the request |
| `POST /v1/requests/{id}/orders` | places one: `buyer`, `supplier`, `item`, `quantity`, `amount`, `approval` |

If your service has other paths or field names, change the one file that makes the calls (`app/tools.py`); the agent and the rules stay as they are. What this agent does not do is in [LIMITS.md](../LIMITS.md).

## Check it with Geometer

```sh
geo check .          # needs Geometer and Docker; the model is a stand-in and the service is simulated
```

Geometer reads the folder, builds the agent in a container, runs the tasks in `.geometer/tasks.toml` against the simulated service, runs them again with something going wrong on purpose (a reply that never arrives, for example), and checks the rules. CI: [`.github/workflows/geometer.yml`](.github/workflows/geometer.yml) runs `geo ci` on every pull request.

## Mistakes to try

Apply a patch from [`broken/`](broken) to a copy and let Geometer check it:

```sh
../scripts/try-broken.sh purchasing retries-blind
```

| Patch | One line that changes | The rule it should break |
| --- | --- | --- |
| `broken/retries-blind.patch` | retries a call that got no answer without looking whether it landed | `one-order-per-request` |
| `broken/ignores-the-limit.patch` | lets orders up to ten times the limit through | `never-above-the-buyers-limit` |

## Agent checklist

| # | Item | Where it is covered |
| --- | --- | --- |
| 1 | Does each action at most once | one-order-per-request |
| 2 | Checks what happened before retrying after an unclear outcome | Built into the tool (it reads the service's list first and after a call with no answer); no separate rule |
| 3 | Asks a person above a limit | never-above-the-buyers-limit |
| 4 | Acts only for the right account or player | Built into the tool (the target comes from the record, not from the message); no rule |
| 5 | Never compensates the same case twice | Not applicable: one kind of action |
| 6 | Stays within its limits | No rule |
| 7 | Never calls tools it must not | No rule |
| 8 | Survives a crash mid-action | Not tried |
| 9 | Keeps a record of what it did | Not checked |
| 10 | Lets people decide how much it may do alone | Set in Geometer, not in this folder |

What is not checked is also listed in the top-level [LIMITS.md](../LIMITS.md).

## Tests of its own

```sh
pip install pytest && pytest
```

They run the real tools through CrewAI against a small local copy of the service (the records in `tests/fixtures.json`) and check the crew is built with its agent and tools; the crew itself is not run. No model is called.

## Build your own: paste this into your coding assistant

First add Geometer to your assistant once (`geo mcp install --client claude-code`, or `--client cursor`; see https://geometer.dev/docs/use-with-your-coding-assistant). Then paste:

```text
I want to build a purchasing agent that buys supplies for purchase requests within a buyer's mandate. Use the purchasing agent in this repository as the model: same layout (app/, requirements.txt, .geometer/rules.toml, tools.toml, tasks.toml).
The agent must order each purchase request at most once (read the request's orders first), take supplier, item and amount from the request, and hold orders above the buyer's limit until the buyer's own approval id is supplied.
Write the rules in .geometer/rules.toml in plain words first. Then use Geometer's tools: call `check` on this folder and read the three-line answer; call `try_fault` for a lost reply at each action that changes something; if something broke, call `explain_problem`, fix the code, then call `check_fix`. When it is fixed, call `keep_check` and give me the link: I will press Keep this check myself, because you cannot do that for me.
Tell me what Geometer did not check. Do not say the agent is correct; say what held within what was tried.
```

## Not a claim

A real agent in its framework, run here against simulated services and a scripted stand-in for the model. Geometer's results are held within what was tried, nothing more. Licence: Apache-2.0.


Geometer's driver hands each task's text to the crew's `{request}` placeholder, so `.geometer/tasks.toml` asks for pr-1, pr-2 and the over-limit pr-3 (2400.00 against a limit of 500.00).
