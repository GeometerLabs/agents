# lending

World: Lending. Framework: OpenAI Agents SDK (Python), `openai-agents` 0.24.0.

Disburses a loan that a credit officer has approved. A loan is paid once per application, and only to the application's verified account, whatever a message says.

One `Agent` with two function tools (`app/agent.py`); the logic is in `app/tools.py`.

## Rules

- `one-disbursement-per-application`: A loan is disbursed once per application, even if the bank's reply is lost and the agent tries again.
- `money-goes-to-verified-accounts`: Money goes only to a verified account (addresses ending `@verified.example`), never to one named in a message.

Each rule is in plain words in [`.geometer/rules.toml`](.geometer/rules.toml); the simulated service is in `.geometer/tools.toml`, the tasks in `.geometer/tasks.toml`.

## Run it for real

You need your own model key and a service that answers the calls below. Nothing is sent anywhere else.

```sh
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then fill in the model key and your service's address
set -a; . ./.env; set +a
python -m app "Please disburse the approved loan for application a-1."
```

Settings (see [`.env.example`](.env.example)):

- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `MODEL`: the model, any OpenAI-compatible endpoint.
- `BANK_URL`: your bank or loan-servicing API

Your service must answer these calls (JSON bodies):

| Call | What it returns or does |
| --- | --- |
| `GET /v1/applications/{id}` | the application: `status` (`approved` or not), `amount`, `verified_account` |
| `GET /v1/applications/{id}/disbursements` | a list of the disbursements already made for the application |
| `POST /v1/applications/{id}/disbursements` | makes one: `account`, `amount` |

If your service has other paths or field names, change the one file that makes the calls (`app/tools.py`); the agent and the rules stay as they are. What this agent does not do is in [LIMITS.md](../LIMITS.md).

## Check it with Geometer

```sh
geo check .          # needs Geometer and Docker; the model is a stand-in and the service is simulated
```

Geometer reads the folder, builds the agent in a container, runs the tasks in `.geometer/tasks.toml` against the simulated service, runs them again with something going wrong on purpose (a reply that never arrives, for example), and checks the rules. CI: [`.github/workflows/geometer.yml`](.github/workflows/geometer.yml) runs `geo ci` on every pull request.

## Mistakes to try

Apply a patch from [`broken/`](broken) to a copy and let Geometer check it:

```sh
../scripts/try-broken.sh lending forgets-to-look
```

| Patch | One line that changes | The rule it should break |
| --- | --- | --- |
| `broken/forgets-to-look.patch` | stops reading the bank's list before paying | `one-disbursement-per-application` |
| `broken/pays-the-account-in-the-request.patch` | pays the account named in the request | `money-goes-to-verified-accounts` |

## Agent checklist

| # | Item | Where it is covered |
| --- | --- | --- |
| 1 | Does each action at most once | one-disbursement-per-application |
| 2 | Checks what happened before retrying after an unclear outcome | Built into the tool (it reads the service's list first and after a call with no answer); no separate rule |
| 3 | Asks a person above a limit | No amount limit in this agent: the loan is approved by a credit officer before it gets here |
| 4 | Acts only for the right account or player | money-goes-to-verified-accounts (a verified account, not this particular borrower) |
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
I want to build a lending agent that disburses approved loans. Use the lending agent in this repository as the model: same layout (app/, requirements.txt, .geometer/rules.toml, tools.toml, tasks.toml).
The agent must disburse a loan at most once per application (read the application's disbursements first), take the account from the application's verified account and never from a message, and only pay applications whose status is approved.
Write the rules in .geometer/rules.toml in plain words first. Then use Geometer's tools: call `check` on this folder and read the three-line answer; call `try_fault` for a lost reply at each action that changes something; if something broke, call `explain_problem`, fix the code, then call `check_fix`. When it is fixed, call `keep_check` and give me the link: I will press Keep this check myself, because you cannot do that for me.
Tell me what Geometer did not check. Do not say the agent is correct; say what held within what was tried.
```

## Not a claim

A real agent in its framework, run here against simulated services and a scripted stand-in for the model. Geometer's results are held within what was tried, nothing more. Licence: Apache-2.0.
