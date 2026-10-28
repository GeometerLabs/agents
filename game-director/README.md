# game-director

World: Geometer Worlds. Framework: Pydantic AI (Python), `pydantic-ai-slim[openai]` 2.63.0.

An AI director for a small world economy. For each world event it spawns resources or adjusts a shop price. Each event is applied once; a spawn of more than 100 units waits for a game master's approval id; a shop price is refused outside 1.00 to 1000.00 gems.

Three tools on one Pydantic AI `Agent` (`app/agent.py`); the logic is in `app/tools.py`.

## Rules

- `one-spawn-per-event`: A world event is answered with one spawn at most, even if the world's reply is lost.
- `one-price-change-per-event`: A world event changes a shop price at most once.
- `big-spawns-need-approval`: A spawn of more than 100 units needs a game master's approval id.
- `prices-stay-in-bounds`: A shop price stays between 1.00 and 1000.00 gems (a number-bound rule on the price changes).

Each rule is in plain words in [`.geometer/rules.toml`](.geometer/rules.toml); the simulated service is in `.geometer/tools.toml`, the tasks in `.geometer/tasks.toml`.

## Run it for real

You need your own model key and a service that answers the calls below. The agent's own code calls only the model and your service.

```sh
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then fill in the model key and your service's address
set -a; . ./.env; set +a
python -m app "Handle world event id ev-1."
```

Settings (see [`.env.example`](.env.example)):

- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `MODEL`: the model, any OpenAI-compatible endpoint.
- `WORLD_URL`: your game world's service
- `SPAWN_LIMIT`: units above which a game master must approve (default 100)
- `MIN_PRICE`, `MAX_PRICE`: the allowed shop prices in gems (default 1.00 and 1000.00)

Your service must answer these calls (JSON bodies):

| Call | What it returns or does |
| --- | --- |
| `GET /v1/events/{id}` | the world event: `kind`, `description`, and what the world suggests |
| `GET /v1/events/{id}/spawns` | a list of the spawns already made for the event |
| `POST /v1/events/{id}/spawns` | makes one: `resource`, `count`, `approval` |
| `GET /v1/events/{id}/prices` | a list of the price changes already made for the event |
| `POST /v1/events/{id}/prices` | makes one: `item`, `price` (a decimal string) |

If your service has other paths or field names, change the one file that makes the calls (`app/tools.py`); the agent and the rules stay as they are. What this agent does not do is in [LIMITS.md](../LIMITS.md).

## Check it with Geometer

```sh
geo check .          # needs Geometer and Docker; the model is a stand-in and the service is simulated
```

Geometer reads the folder, builds the agent in a container, runs the tasks in `.geometer/tasks.toml` against the simulated service, runs them again with something going wrong on purpose (a reply that never arrives, for example), and checks the rules. CI: [`.github/workflows/geometer.yml`](.github/workflows/geometer.yml) runs `geo ci` on every pull request.

## Mistakes to try

Apply a patch from [`broken/`](broken) to a copy and let Geometer check it:

```sh
../scripts/try-broken.sh game-director applies-an-event-twice
```

| Patch | One line that changes | The rule it should break |
| --- | --- | --- |
| `broken/applies-an-event-twice.patch` | stops reading the world's list before applying | `one-spawn-per-event, one-price-change-per-event` |
| `broken/spawns-without-approval.patch` | raises the approval limit to 100000 units | `big-spawns-need-approval` |
| `broken/prices-out-of-bounds.patch` | raises the price ceiling to 1000000.00 gems | `prices-stay-in-bounds` |

## Agent checklist

| # | Item | Where it is covered |
| --- | --- | --- |
| 1 | Does each action at most once | one-spawn-per-event, one-price-change-per-event |
| 2 | Checks what happened before retrying after an unclear outcome | Built into the tool (it reads the service's list first and after a call with no answer); no separate rule |
| 3 | Asks a person above a limit | big-spawns-need-approval |
| 4 | Acts only for the right account or player | Built into the tool (the target comes from the record, not from the message); no rule |
| 5 | Never compensates the same case twice | Not applicable: one kind of action |
| 6 | Stays within its limits | prices-stay-in-bounds |
| 7 | Never calls tools it must not | No rule |
| 8 | Survives a crash mid-action | Not tried |
| 9 | Keeps a record of what it did | Not checked |
| 10 | Lets people decide how much it may do alone | Set in Geometer, not in this folder |

What is not checked is also listed in the top-level [LIMITS.md](../LIMITS.md).

## Tests of its own

```sh
pip install pytest && pytest
```

They run the real tools against a small local copy of the service (the records in `tests/fixtures.json`), and the agent with a scripted model in place of a real one. No model is called.

## Build your own: paste this into your coding assistant

First add Geometer to your assistant once (`geo mcp install --client claude-code`, or `--client cursor`; see https://geometer.dev/docs/use-with-your-coding-assistant). Then paste:

```text
I want to build an AI director for a small game-world economy that answers each world event with a resource spawn or a shop price change. Use the game-director agent in this repository as the model: same layout (app/, requirements.txt, .geometer/rules.toml, tools.toml, tasks.toml).
The agent must apply each world event at most once (read the event's spawns and price changes first), hold spawns above 100 units until a game master's approval id is supplied, and refuse shop prices outside 1.00 to 1000.00 gems.
Write the rules in .geometer/rules.toml in plain words first. Then use Geometer's tools: call `check` on this folder and read the three-line answer; call `try_fault` for a lost reply at each action that changes something; if something broke, call `explain_problem`, fix the code, then call `check_fix`. When it is fixed, call `keep_check` and give me the link: I will press Keep this check myself, because you cannot do that for me.
Tell me what Geometer did not check. Do not say the agent is correct; say what held within what was tried.
```

## Not a claim

A real agent in its framework, run here against simulated services and a scripted stand-in for the model. Geometer's results are held within what was tried, nothing more. Licence: Apache-2.0.
