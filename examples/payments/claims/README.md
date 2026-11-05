# claims

Market: Money movement (claims). Framework: Strands Agents (Python), `strands-agents[openai]` 1.62.0.

Pays out an insurance claim that an adjuster has approved. A claim is paid at most once, to the policyholder's account on file; a payment above 1000.00 waits for an adjuster's approval id. The model is any OpenAI-compatible endpoint by default (Strands' OpenAI provider); Amazon Bedrock is an option.

One Strands `Agent` with two tools (`app/agent.py`); the logic is in `app/tools.py`. Set `MODEL_PROVIDER=bedrock` for Bedrock.

## Rules

- `claim-paid-at-most-once`: A claim is paid at most once, even if the payment reply is lost and the agent tries again.
- `big-payments-need-an-adjuster`: A payment above 1000.00 needs an adjuster's approval id.

Each rule is in plain words in [`.geometer/rules.toml`](.geometer/rules.toml); the simulated service is in `.geometer/tools.toml`, the tasks in `.geometer/tasks.toml`.

## Run it for real

You need your own model key and a service that answers the calls below. The agent's own code calls only the model and your service.

```sh
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then fill in the model key and your service's address
set -a; . ./.env; set +a
python -m app "Please pay claim id cl-1."
```

Settings (see [`.env.example`](.env.example)):

- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `MODEL`: the model, any OpenAI-compatible endpoint.
- `CLAIMS_URL`: your insurer's claims service
- `PAYMENT_LIMIT`: amount above which an adjuster must approve (default 1000.00)
- `MODEL_PROVIDER`: `openai` (default) or `bedrock`

Your service must answer these calls (JSON bodies):

| Call | What it returns or does |
| --- | --- |
| `GET /v1/claims/{id}` | the claim: `status` (`approved` or not), `amount`, `policyholder_account` |
| `GET /v1/claims/{id}/payments` | a list of the payments already made for the claim |
| `POST /v1/claims/{id}/payments` | makes one: `account`, `amount`, `approval` |

If your service has other paths or field names, change the one file that makes the calls (`app/tools.py`); the agent and the rules stay as they are. What this agent does not do is in [LIMITS.md](../LIMITS.md).

## Check it with Geometer

```sh
geo check .          # needs Geometer and Docker; the model is a stand-in and the service is simulated
```

Geometer reads the folder, builds the agent in a container, runs the tasks in `.geometer/tasks.toml` against the simulated service, runs them again with something going wrong on purpose (a reply that never arrives, for example), and checks the rules. CI: [`.github/workflows/geometer.yml`](.github/workflows/geometer.yml) runs `geo ci` on every pull request.

## Mistakes to try

Apply a patch from [`broken/`](broken) to a copy and let Geometer check it:

```sh
../scripts/try-broken.sh claims retries-blind
```

| Patch | One line that changes | The rule it should break |
| --- | --- | --- |
| `broken/retries-blind.patch` | retries a call that got no answer without looking whether it landed | `claim-paid-at-most-once` |
| `broken/skips-the-adjuster.patch` | raises the limit to 1000000.00 | `big-payments-need-an-adjuster` |

## Agent checklist

| # | Item | Where it is covered |
| --- | --- | --- |
| 1 | Does each action at most once | claim-paid-at-most-once |
| 2 | Checks what happened before retrying after an unclear outcome | Built into the tool (it reads the service's list first and after a call with no answer); no separate rule |
| 3 | Asks a person above a limit | big-payments-need-an-adjuster |
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

They run the real tools through Strands against a small local copy of the service (the records in `tests/fixtures.json`), as a direct tool call; the model is not involved. No model is called.

## Build your own: paste this into your coding assistant

First add Geometer to your assistant once (`geo mcp install --client claude-code`, or `--client cursor`; see https://geometer.dev/docs/use-with-your-coding-assistant). Then paste:

```text
I want to build a claims agent that pays out approved insurance claims. Use the claims agent in this repository as the model: same layout (app/, requirements.txt, .geometer/rules.toml, tools.toml, tasks.toml).
The agent must pay a claim at most once (read the claim's payments first), pay only the policyholder's account on the claim, and hold payments above 1000.00 until an adjuster's approval id is supplied.
Write the rules in .geometer/rules.toml in plain words first. Then use Geometer's tools: call `check` on this folder and read the three-line answer; call `try_fault` for a lost reply at each action that changes something; if something broke, call `explain_problem`, fix the code, then call `check_fix`. When it is fixed, call `keep_check` and give me the link: I will press Keep this check myself, because you cannot do that for me.
Tell me what Geometer did not check. Do not say the agent is correct; say what held within what was tried.
```

## Not a claim

A real agent in its framework, run here against simulated services and a scripted stand-in for the model. Geometer's results are held within what was tried, nothing more. Licence: Apache-2.0.
