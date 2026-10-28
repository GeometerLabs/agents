# liveops-compensation

World: Geometer Worlds. Framework: LangGraph (Python), `langgraph` 1.2.18 with `langchain-openai` 1.7.3.

After a server crash eats a raid loadout, this agent restores the lost items or currency for the player's support ticket. The ticket, not the chat message, decides who gets what; a ticket is restored once however often the player asks; a restoration worth more than 50.00 gems waits for a game master's approval id.

The graph is two nodes: the model answers, a tool call goes to the tools, the result goes back to the model (`app/agent.py`).

## Rules

- `one-restoration-per-ticket`: A ticket is restored once, however often the player asks and even if the inventory's reply is lost.
- `restored-items-go-to-players`: Items and currency go only to player accounts (addresses ending `@players.example`), never to one named in chat.
- `big-restorations-need-a-game-master`: A restoration worth more than 50.00 gems needs a game master's approval id.

Each rule is in plain words in [`.geometer/rules.toml`](.geometer/rules.toml); the simulated service is in `.geometer/tools.toml`, the tasks in `.geometer/tasks.toml`.

## Run it for real

You need your own model key and a service that answers the calls below. Nothing is sent anywhere else.

```sh
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then fill in the model key and your service's address
set -a; . ./.env; set +a
python -m app "Please restore the loadout for ticket id t-1."
```

Settings (see [`.env.example`](.env.example)):

- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `MODEL`: the model, any OpenAI-compatible endpoint.
- `INVENTORY_URL`: your game's inventory service
- `GM_LIMIT`: gems above which a game master must approve (default 50.00)

Your service must answer these calls (JSON bodies):

| Call | What it returns or does |
| --- | --- |
| `GET /v1/tickets/{id}` | the ticket: `player`, `kind` (item or currency), `item`, `quantity`, `gems` (what it is worth) |
| `GET /v1/tickets/{id}/restorations` | a list of the restorations already made for the ticket |
| `POST /v1/tickets/{id}/restorations` | makes one: `player`, `kind`, `item`, `quantity`, `gems`, `approval`; the agent sends an `Idempotency-Key` header too |

If your service has other paths or field names, change the one file that makes the calls (`app/tools.py`); the agent and the rules stay as they are. What this agent does not do is in [LIMITS.md](../LIMITS.md).

## Check it with Geometer

```sh
geo check .          # needs Geometer and Docker; the model is a stand-in and the service is simulated
```

Geometer reads the folder, builds the agent in a container, runs the tasks in `.geometer/tasks.toml` against the simulated service, runs them again with something going wrong on purpose (a reply that never arrives, for example), and checks the rules. CI: [`.github/workflows/geometer.yml`](.github/workflows/geometer.yml) runs `geo ci` on every pull request.

## Mistakes to try

Apply a patch from [`broken/`](broken) to a copy and let Geometer check it:

```sh
../scripts/try-broken.sh liveops-compensation skips-approval
```

| Patch | One line that changes | The rule it should break |
| --- | --- | --- |
| `broken/skips-approval.patch` | raises the limit to 5000.00 gems | `big-restorations-need-a-game-master` |
| `broken/obeys-the-chat-address.patch` | sends the items to the address named in chat | `restored-items-go-to-players` |

## Agent checklist

| # | Item | Where it is covered |
| --- | --- | --- |
| 1 | Does each action at most once | one-restoration-per-ticket |
| 2 | Checks what happened before retrying after an unclear outcome | Built into the tool (it reads the service's list first and after a call with no answer); no separate rule |
| 3 | Asks a person above a limit | big-restorations-need-a-game-master |
| 4 | Acts only for the right account or player | restored-items-go-to-players (a player account, not this particular player) |
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

They run the real tools against a small local copy of the service (the same records as `.geometer/fixtures.json`) and the agent with a scripted model. No model is called.

## Build your own: paste this into your coding assistant

First add Geometer to your assistant once (`geo mcp install --client claude-code`, or `--client cursor`; see https://geometer.dev/docs/use-with-your-coding-assistant). Then paste:

```text
I want to build a live-ops agent for a game that restores the items and currency a server crash took from a raid loadout, one support ticket at a time. Use the liveops-compensation agent in this repository as the model: same layout (app/, requirements.txt, .geometer/rules.toml, tools.toml, tasks.toml).
The agent must restore a ticket at most once however often the player asks (read the ticket's restorations first), take the recipient from the ticket and never from chat, only ever send items to player accounts, and hold restorations above 50.00 gems until a game master's approval id is supplied.
Write the rules in .geometer/rules.toml in plain words first. Then use Geometer's tools: call `check` on this folder and read the three-line answer; call `try_fault` for a lost reply at each action that changes something; if something broke, call `explain_problem`, fix the code, then call `check_fix`. When it is fixed, call `keep_check` and give me the link: I will press Keep this check myself, because you cannot do that for me.
Tell me what Geometer did not check. Do not say the agent is correct; say what held within what was tried.
```

## Not a claim

A real agent in its framework, run here against simulated services and a scripted stand-in for the model. Geometer's results are held within what was tried, nothing more. Licence: Apache-2.0.
