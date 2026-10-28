# lab-protocol

World: Lab. Framework: Mastra (TypeScript), `@mastra/core` 1.79.0.

Runs a protocol step (for example incubate or centrifuge) on a lab sample. A step runs once per sample; discarding a sample waits for a scientist's approval id.

One Mastra `Agent` with three tools, registered on a `Mastra` instance (`src/mastra/index.ts`); the logic is in `src/lab.ts`.

## Rules

- `one-run-per-sample-and-step`: Each protocol step runs once per sample, even if the instrument's reply is lost.
- `discards-need-a-scientist`: Discarding a sample needs a scientist's approval id. The rule is written as an amount rule on the discarded volume with a limit of zero, so any discard needs it.

Each rule is in plain words in [`.geometer/rules.toml`](.geometer/rules.toml); the simulated service is in `.geometer/tools.toml`, the tasks in `.geometer/tasks.toml`.

## Run it for real

You need your own model key and a service that answers the calls below. The agent's own code calls only the model and your service.

```sh
npm install
cp .env.example .env            # then fill in the model key and your service's address
node --env-file=.env --import tsx src/main.ts "Run the incubate step on sample id s-1."     # or: set the variables and run npm start
```

Settings (see [`.env.example`](.env.example)):

- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `MODEL`: the model, any OpenAI-compatible endpoint.
- `LIMS_URL`: your lab-information service

Your service must answer these calls (JSON bodies):

| Call | What it returns or does |
| --- | --- |
| `GET /v1/samples/{id}` | the sample: `label`, `volume_ml`, `status` |
| `GET /v1/samples/{id}/steps` | a list of the steps already run on the sample: each has a `step` |
| `POST /v1/samples/{id}/steps` | runs one: `step`, `volume_ml` |
| `POST /v1/samples/{id}/discard` | discards the sample: `volume_ml`, `approval` |

If your service has other paths or field names, change the one file that makes the calls (`src/lab.ts`); the agent and the rules stay as they are. What this agent does not do is in [LIMITS.md](../LIMITS.md).

## Check it with Geometer

```sh
geo check .          # needs Geometer and Docker; the model is a stand-in and the service is simulated
```

Geometer reads the folder, builds the agent in a container, runs the tasks in `.geometer/tasks.toml` against the simulated service, runs them again with something going wrong on purpose (a reply that never arrives, for example), and checks the rules. CI: [`.github/workflows/geometer.yml`](.github/workflows/geometer.yml) runs `geo ci` on every pull request.

## Mistakes to try

Apply a patch from [`broken/`](broken) to a copy and let Geometer check it:

```sh
../scripts/try-broken.sh lab-protocol retries-blind
```

| Patch | One line that changes | The rule it should break |
| --- | --- | --- |
| `broken/retries-blind.patch` | retries a call that got no answer without looking whether it landed | `one-run-per-sample-and-step` |
| `broken/discards-without-approval.patch` | drops the check for an approval id | `discards-need-a-scientist` |

## Agent checklist

| # | Item | Where it is covered |
| --- | --- | --- |
| 1 | Does each action at most once | one-run-per-sample-and-step |
| 2 | Checks what happened before retrying after an unclear outcome | Built into the tool (it reads the service's list first and after a call with no answer); no separate rule |
| 3 | Asks a person above a limit | discards-need-a-scientist |
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
npm test
```

They run the real tools through Mastra's tool objects against a small local copy of the service (the records in `test/fixtures.json`) and check the Mastra instance holds the agent with its tools; the agent itself is not run. No model is called.

## Build your own: paste this into your coding assistant

First add Geometer to your assistant once (`geo mcp install --client claude-code`, or `--client cursor`; see https://geometer.dev/docs/use-with-your-coding-assistant). Then paste:

```text
I want to build a lab-automation agent that runs protocol steps on samples. Use the lab-protocol agent in this repository as the model: same layout (src/, package.json, .geometer/rules.toml, tools.toml, tasks.toml).
The agent must run a protocol step at most once per sample (read the sample's steps first), and never discard a sample without a scientist's approval id.
Write the rules in .geometer/rules.toml in plain words first. Then use Geometer's tools: call `check` on this folder and read the three-line answer; call `try_fault` for a lost reply at each action that changes something; if something broke, call `explain_problem`, fix the code, then call `check_fix`. When it is fixed, call `keep_check` and give me the link: I will press Keep this check myself, because you cannot do that for me.
Tell me what Geometer did not check. Do not say the agent is correct; say what held within what was tried.
```

## Not a claim

A real agent in its framework, run here against simulated services and a scripted stand-in for the model. Geometer's results are held within what was tried, nothing more. Licence: Apache-2.0.
