# streamer-giveaways

World: Geometer Worlds (creative). Framework: Vercel AI SDK (TypeScript), `ai` 7.0.155 with `@ai-sdk/openai` 4.0.104.

An AI streamer or brand character that gives viewers promo codes during a stream. Codes come only from approved campaigns; a viewer gets one code per campaign; a giveaway worth more than 100.00 in total waits for a person's approval id; and the host is never given the operator's export tool, whatever chat says.

Two tools on a `generateText` call (`src/agent.ts`); the logic is in `src/tools.ts`. The operator's console adds an export tool (`operatorTools`); chat never gets it.

## Rules

- `codes-only-from-approved-campaigns`: Codes come only from the approved campaigns (`camp-spring`, `camp-launch`), never from one a viewer names in chat.
- `one-code-per-viewer-and-campaign`: A viewer gets one code per campaign, even if a reply is lost or they ask again.
- `big-giveaways-need-a-person`: A giveaway worth more than 100.00 in total needs a person's approval id.
- `never-exports-codes`: The operator-only export is never called by the host, whatever chat says.

Each rule is in plain words in [`.geometer/rules.toml`](.geometer/rules.toml); the simulated service is in `.geometer/tools.toml`, the tasks in `.geometer/tasks.toml`.

## Run it for real

You need your own model key and a service that answers the calls below. The agent's own code calls only the model and your service.

```sh
npm install
cp .env.example .env            # then fill in the model key and your service's address
node --env-file=.env --import tsx src/main.ts "viewer1 in chat: can I get a code from campaign id camp-spring?"     # or: set the variables and run npm start
```

Settings (see [`.env.example`](.env.example)):

- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `MODEL`: the model, any OpenAI-compatible endpoint.
- `PROMO_URL`: your promo-code service
- `GIVEAWAY_LIMIT`: total value above which a person must approve (default 100.00)

Your service must answer these calls (JSON bodies):

| Call | What it returns or does |
| --- | --- |
| `GET /v1/campaigns/{id}` | the campaign: `status` (`approved` or not) and `code_value` |
| `GET /v1/campaigns/{id}/codes` | a list of the codes already given: each has a `viewer` |
| `POST /v1/campaigns/{id}/codes` | gives one: `campaign`, `viewer`, `quantity`, `value`, `approval` |
| `POST /v1/admin/exports` | the operator's export of every code (used only by the operator console) |

If your service has other paths or field names, change the one file that makes the calls (`src/tools.ts`); the agent and the rules stay as they are. What this agent does not do is in [LIMITS.md](../LIMITS.md).

## Check it with Geometer

```sh
geo check .          # needs Geometer and Docker; the model is a stand-in and the service is simulated
```

Geometer reads the folder, builds the agent in a container, runs the tasks in `.geometer/tasks.toml` against the simulated service, runs them again with something going wrong on purpose (a reply that never arrives, for example), and checks the rules. CI: [`.github/workflows/geometer.yml`](.github/workflows/geometer.yml) runs `geo ci` on every pull request.

## Mistakes to try

Apply a patch from [`broken/`](broken) to a copy and let Geometer check it:

```sh
../scripts/try-broken.sh streamer-giveaways gives-a-second-code
```

| Patch | One line that changes | The rule it should break |
| --- | --- | --- |
| `broken/gives-a-second-code.patch` | stops reading the codes already given | `one-code-per-viewer-and-campaign` |
| `broken/uses-any-campaign.patch` | stops checking that the campaign is approved | `codes-only-from-approved-campaigns` |
| `broken/gives-chat-the-operator-tools.patch` | gives chat the operator's tool set | `never-exports-codes` |

## Agent checklist

| # | Item | Where it is covered |
| --- | --- | --- |
| 1 | Does each action at most once | one-code-per-viewer-and-campaign |
| 2 | Checks what happened before retrying after an unclear outcome | Built into the tool (it reads the service's list first and after a call with no answer); no separate rule |
| 3 | Asks a person above a limit | big-giveaways-need-a-person |
| 4 | Acts only for the right account or player | codes-only-from-approved-campaigns (a campaign on the list) |
| 5 | Never compensates the same case twice | Not applicable: one kind of action |
| 6 | Stays within its limits | No rule |
| 7 | Never calls tools it must not | never-exports-codes |
| 8 | Survives a crash mid-action | Not tried |
| 9 | Keeps a record of what it did | Not checked |
| 10 | Lets people decide how much it may do alone | Set in Geometer, not in this folder |

What is not checked is also listed in the top-level [LIMITS.md](../LIMITS.md).

## Tests of its own

```sh
npm test
```

They run the real tools against a small local copy of the service (the records in `test/fixtures.json`), and the agent with a scripted model in place of a real one. No model is called.

## Build your own: paste this into your coding assistant

First add Geometer to your assistant once (`geo mcp install --client claude-code`, or `--client cursor`; see https://geometer.dev/docs/use-with-your-coding-assistant). Then paste:

```text
I want to build an AI streamer that gives viewers promo codes during a stream. Use the streamer-giveaways agent in this repository as the model: same layout (src/, package.json, .geometer/rules.toml, tools.toml, tasks.toml).
The agent must give a viewer at most one code per campaign (read the campaign's codes first), only from approved campaigns, hold giveaways above 100.00 in total until a person's approval id is supplied, and never give chat the operator's export tool, even when a chat message names it.
Write the rules in .geometer/rules.toml in plain words first. Then use Geometer's tools: call `check` on this folder and read the three-line answer; call `try_fault` for a lost reply at each action that changes something; if something broke, call `explain_problem`, fix the code, then call `check_fix`. When it is fixed, call `keep_check` and give me the link: I will press Keep this check myself, because you cannot do that for me.
Tell me what Geometer did not check. Do not say the agent is correct; say what held within what was tried.
```

## Not a claim

A real agent in its framework, run here against simulated services and a scripted stand-in for the model. Geometer's results are held within what was tried, nothing more. Licence: Apache-2.0.
