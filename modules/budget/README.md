# budget: a model budget for every shop, and a daily cap on every feature

Geometer's assistants use a hosted language model for a few jobs: the owner's talk, a customer's open question, a listing drafted in four languages, and the router's language step. A model costs money for every call. This module makes sure **no shop can spend more than its plan allows, no one feature can use up the whole month, and a cap never means silence**.

It is for an outside developer who has not seen this repository. Plain Node, no dependencies, TypeScript run by type stripping.

## The idea in four sentences

1. Each shop has **one monthly budget in rupees** for every model call it makes.
2. Inside it, each feature has a **daily cap** on calls, so a runaway feature stops on its own.
3. Over a cap, the feature uses **what works without a model** (buttons, fixed answers, the plain form), and tells the owner once, in the owner's language.
4. The owner and the Operator are told **at about 80%** and **when the budget is used up**.

The numbers are not in code. They are in the price list (`prices/<date>.json`, ids `ai.budget.*` and `ai.daily.*`), and the bundle writes them into each shop's `runtime.json`.

## Every place a model is called today, and how it is metered and capped

| Call | Where in the code | Counted in the one meter | Stopped by |
|---|---|---|---|
| **The router's language step** (reads a customer's, or the owner's, free-form words) | `understanding/router.ts`, run by `understanding/reader.ts` | `reader.countUnderstood` adds the call's price to `ai.costMicroInr` | fleet's cap (`model: "off"`); the shop's month budget; the `router` daily cap |
| The router's decision model (step 1) | `understanding/system-one.ts` (Laya, on the shop's own server) | not model spend: it costs no rupees; it counts toward the plan's message allowance only | button mode (the allowance); a pause when it keeps failing |
| **The owner's talk** | `assistant/talk-owner.ts`, then `talk-run.ts` | `talk-run.ts askMetered` | button mode; fleet's cap; the month budget; the `owner_talk` daily cap |
| **A customer's open question** | `assistant/talk-customer.ts`, then `talk-run.ts` | `askMetered` | the same, with the `customer_talk` daily cap for the whole shop; and one guest's own 20 a day (`channels/chat.ts`, `CHAT_LIMITS.modelTurnsPerDay`), which stays |
| **A listing draft** | `assistant/listing-draft.ts`, then `askMetered` | `askMetered` | the same, with the `listing_draft` daily cap |
| A voice note | `voice/`, counted by `reader.countSpeech` (`addSpeech`) | into the same `ai.costMicroInr` | button mode; fleet's cap; the month budget (voice stops with the model); the speech provider's own daily limit |
| The directory's buyer assistant | `discovery/assistant.ts` (built 18 Nov; off until the directory's config has an `assistant` block, which needs the approved price list) | `gate` and `record` with the feature `buyer`, on an in-memory store of its own | its own budget, `ai.budget.discovery` and `ai.daily.discovery*`; the plain search when over (`discovery/README.md`) |
| **The model Guard** (`g-model`) | `bundle/generate/guards.ts` `modelSpec` | it sees every call of every shop | `model-calls-per-day` (default 2,000 for the whole server) and the model pin. The outer wall. |
| **Fleet** (a separate service) | its cap `ai.cap` and its 50%-of-plan-price alert | the heartbeat's `model_micro_inr`, counted from the record by `bundle/lib/usage.ts` | writes `model: "off"` into the shop's config when the month's spend reaches `ai.cap`; tells the Operator |

There is **one meter**: the month's spend, `ai.costMicroInr` in the shop's own store (`understanding/ai-state.ts`). Every row above adds to it with the **token counts the model returns** and the **dated rate table** (`understanding/rates/<date>.json`, dollars per million tokens, with the rupee rate). Money is counted in micro-rupees (1,000,000 = one rupee) as whole numbers, rounded up, so paise are always integers. A call whose model has no price is **never free**: it counts as `unpricedCallMicroInr` (default 10 paise) against the budget.

This module adds no second meter. It reads that one against a budget, counts calls per feature per day, and remembers which notices were sent.

Until 18 Nov 2026 fleet's cap and its 50% alert did not see a listing draft (its record line `listing_draft` was not counted in `bundle/lib/usage.ts`). They do now.

## How the pieces fit

```
price list  prices/<date>.json        ai.budget.<plan>  ai.daily.*          (the only place the numbers are written)
fleet's answer  fleet/<shop>.json     plan, allowance, bought (extra messages bought this month)
shops/<shop>/budget-override.json     one shop's own numbers, set by the server admin only
     |  bundle/lib/budget.ts budgetFor(plan, list in force, { bought, override })
     |  = the plan's numbers, scaled by the messages bought, then the override on top
     v
runtime.json  "budget": { monthlyMicroInr, daily: { owner_talk, listing_draft, customer_talk, router } }
     |  modules/runtime/config.ts reads it, start.ts puts it in AiPolicy.budget
     v
 AiPolicy.budget ---> budget.ts  gate()   before a call: month? day? already paid for?
                                 record()  after a call: count it for today and the month
                                 takeNotices() / takeDayNotice()   what the owner is told, once
     ^                                 |
     |  the one meter                  v
 ai.costMicroInr (ai-state.ts)    assistant/conversation.ts  budgetBeat (the 80% and used-up notices), capNotice (a day's)
                                  runtime/core.ts  /status  ai.budget  ---> the Operator's panel (bundle/panel/plan.ts)
```

- **`budget.ts`** is pure: no disk, no network, no database, so an agent may import it (the browser demo is built from the agent).
- **The one predicate** `modelOff(store, policy)` answers "is the language model left out?": fleet says `model: "off"`, or the shop's own month budget is used up. The talk, the router's language step, voice and the notices all ask it, so they cannot disagree.
- **`gate(store, cfg, feature, now, tz, key?)`** is asked **before** a call and answers `ok`, or why not: `month`, `day`, or `again` (this message was already paid for).
- **`record(...)`** is called **after** every call, whatever came of it, because a call whose answer was unusable still cost tokens. It counts the call for today and for the month's breakdown. It never adds money: the money is already in the one meter.

## The data it keeps

Kept in the shop's own store as `ai.budget` (`BudgetState`), next to the month's spend. It starts again in a new month. Counts, rupee amounts and moments only. Never a word of a message, a name or a phone number.

```json
{
  "day": "2026-11-18",
  "today": { "owner_talk": 7, "listing_draft": 2 },
  "by": { "owner_talk": { "calls": 120, "micro": 7200000 }, "router": { "calls": 300, "micro": 1800000 } },
  "told": { "warn": "2026-11", "full": "2026-11", "days": { "owner_talk": "2026-11-18" } },
  "keys": ["o:wamid.HBgM..."]
}
```

- `today` counts calls asked today, by feature, in the **shop's own day** (its time zone), not UTC's.
- `by` is the month's breakdown, for the owner's and the Operator's view. The budget itself is judged on the one meter, not on this.
- `told` makes each notice go **once**: the month for the 80% and the used-up notices, the day for each feature's daily one.
- `keys` are the last 60 message ids already paid for (a retry protection; see below). An owner message id is not private data, but the list is capped.

The config (`runtime.json`, `"budget"`), checked by `isBudgetConfig`: whole numbers only, known features only, a daily cap of at least 1, nothing else.

```json
{ "monthlyMicroInr": 20000000, "daily": { "owner_talk": 30, "listing_draft": 10, "customer_talk": 60, "router": 100 } }
```

Optional: `unpricedCallMicroInr` (default 100000) and `warnBasisPoints` (default 8000, which is 80%).

The runtime's `/status` carries `ai.budget` (the month's rupees, how much is used, the level `ok`, `warn` or `full`, and each feature's calls and daily cap). It is left out when the shop has no budget, so a shop without one reports what it always did.

## What happens over a cap: never silence

| Feature | Over the month's budget | Over its daily cap |
|---|---|---|
| **Owner's talk** | The owner gets the fixed answer ("Sorry, I didn't get that" with the things they can say) and the buttons. | The same, and the owner is told once that day. |
| **Customer's open question** | The customer gets the rule-based reading and the template's menu (its buttons or list). **A customer is never told about a cap.** | Same; only the owner is told, once that day. |
| **Listing draft** | The owner is told, with the date it is back, to use the plain **Add to my page** form in the owner's app (a photo, a title and a price). | The same, saying tomorrow. |
| **Router's language step** | Left out. The rules and the decision model read the message; what neither can read gets the menu. | Left out for the rest of the day. |
| **Voice notes** | Stop with the model: the customer gets the line asking them to type. | The speech provider's own daily limit stays. |

The owner's words, in English, Hindi, Malayalam and Kannada, are in `assistant/words-budget.ts` (id `budget_line`). The Hindi, Malayalam and Kannada are machine-written and are on the review sheets (`bundle/panel/review.ts`, ids `budget.assistant.*` and `plan.budget.*`; regenerate them with `node bundle/panel/review-sheet.ts hi|ml|kn`). The line when the budget is used up reads: *Your assistant's thinking budget for this month is used up. Buttons still work; it is back on Tue 1 Dec.*

## Notices

- **At 80% of the month's budget**, once, and **when it is used up**, once more (a month that jumps past both says both, in order). The owner gets it on WhatsApp (while a message can be sent) and in their app's talk list. The check runs on the assistant's beat (`onTick`), and a notice is marked told **before** it is sent, so a failed send is not tried again every beat.
- **The Operator** sees a line on the shop's page in the panel for as long as the shop is at 80% or used up (`bundle/panel/plan.ts`, read from the runtime's `/status`). It is not a one-time message, because it describes a state. It is not shown twice when fleet's own `ai_cap` line is already there.
- **The record** gets an `ai_mode` line when the language model is first left out for the month and for each notice.
- **Fleet's own alert** when a shop's variable cost passes 50% of its plan price stays as it was.

The morning line is a WhatsApp template approved by Meta, with fixed words, so a new line cannot be added to it without a new approval. The owner is told in its own message and in the app instead (see Deferred).

## Retries cannot double count

- The inbox keeps an event key, so a redelivered webhook is saved once (`runtime/events.ts`).
- On top of that, an owner message's id is passed as `key`. A message already paid for is not asked again (`gate` says `again`), and the day's count does not move twice.
- A model call is never retried inside the code (`understanding/model-llm.ts askJson` makes one call). A failed call pauses the model for a few minutes (button mode) instead of retrying.
- The count is of calls **asked**, not answers used: a refused draft spends a count, so retrying a refused draft ten times does not get ten tries past the cap.
- **The bound:** a call is allowed while the budget is not yet used up, so a shop can pass the line by the calls that were already running. Talk turns, drafts and reading are one at a time per shop, so the overshoot is about one call (a few paise).

## The model Guard's wall

The model Guard's `model-calls-per-day` (default 2,000 for the whole server) is the **outer wall**. It counts calls, not rupees. Two checks, in `wallProblems` and printed by the deploy as a note (never a refusal):

- the wall's worst monthly cost (calls a day x 31 x the dearest call, `WORST_CALL_MICRO_INR` in `bundle/lib/budget.ts`) should be **above** the shops' budgets added up, or it would stop shops before their own budgets do;
- and, when a server's own monthly total is given (`serverMonthlyMicroInr`; there is no field for it in `geometer.json` yet), the wall should be **below** it.

Fleet's `ai.cap` stays an outer wall too: the proposed list sets it to the same rupee as the shop's own budget for the plan, so the shop's own budget (which acts at once, in the shop) trips first, and fleet's check (which lags by a heartbeat) is the second line.

## Security and privacy

- Customers' phone numbers and students' names are never in the budget's state: it counts features, not people. A customer's own limits stay in `channels/chat.ts`.
- The numbers come only from the price list in force. A list marked `"status": "proposed"` never gives a shop a budget (`bundle/lib/server.ts` reads `latestPriceList`). A number the list lacks is not invented: the shop then has fleet's cap alone.
- A builder's own server (a shop with no plan from fleet) gets no budget: it brings its own AI key and pays for its own model.
- Nothing here calls a model. Tests use a fake model with a fixed price. **Not tested on a real model or provider.**

## Changing a number

Never edit a price list that was committed. Make a new dated one:

```
node prices/new.ts 2026-12-01     # copies the newest list to that date
# edit the new file: ai.budget.<plan>, ai.daily.*; set each entry's read day, source and note
# add the file's sha256 to PINNED in bundle/panel/test/cost.test.ts
```

The 18 Nov list was a **proposal**. The owner approved it as proposed on 18 Nov ("approve the budget numbers as proposed") and the list of **19 Nov** (`prices/2026-11-19.json`) puts it in force: from 19 Nov a shop with a plan gets its budget and daily caps at its next deploy, and fleet's cap is ₹20 per 1,000 messages (fleet needs its own deploy for that). A list marked `proposed` still never gives a shop a budget. The numbers:

| | Month (₹) | Owner talk a day | Drafts a day | Customer questions a day | Router language step a day |
|---|---|---|---|---|---|
| Basic | 20 | 30 | 10 | 60 | 100 |
| Business | 60 | 30 | 10 | 180 | 300 |
| Operations | 200 | 30 | 10 | 600 | 1,000 |
| Listings-only (free) | 6 | 10 | 10 | 30 | none |
| Directory's buyer assistant | 2,500 for all buyers | | | 1,500 calls a day, 12 a buyer | |

The customer and router caps are "per 1,000 messages of the plan's allowance", so they scale with the plan.

**Margins** (`docs/product/economics-and-pricing.md`, section 6): a budget is a ceiling, and a typical shop spends well under it, but a shop that uses all of it costs more than the margin table assumed. Basic is the tight one: at 40 shops a server its margin is ₹41 (28%), and a full ₹20 would take it to about ₹26 (17%); at 25 shops it is already below zero. If Basic's margin must hold, set its budget at ₹12 (about 200 owner-talk turns a month). This is for the owner to decide with the other numbers; the list is only a proposal.

## One shop's own budget

Two things can make one shop's budget different from its plan's. Both are worked out in the one place every shop's budget comes from, `budgetFor` in `bundle/lib/budget.ts`, so an agent shop and a free listings-only shop behave the same way.

**1. Buying more messages grows the budget.** Fleet's own wall grows when a shop buys more messages: it is `ai.cap` for each 1,000 messages of the allowance plus the ones bought. The shop's own budget used to stay at the plan's number, so a busy Basic shop that bought 1,000 more messages had a wall of ₹40 at fleet but was stopped at ₹20 by its own budget. Now fleet's answer to each heartbeat says how many extra messages the shop bought this month (`bought`; left out when none), and the bundle scales the budget the same way:

```
messages = allowance + bought
monthly  = ai.budget.<plan> x messages / allowance          (rounded up)
customer_talk and router a day = (the list's number per 1,000) x messages / 1,000   (rounded up)
```

Basic with nothing bought is ₹20 a month. With 1,000 bought it is ₹40, and customer questions a day go from 60 to 120. The owner's talk and drafts a day do not change. A listings-only shop is free and buys nothing, so it never scales. The answer is read when the deployer works the shop out, and the budget is part of what a shop is asked to be, so on the deployer's next pass (a minute or two while it runs) the shop is redeployed with the new numbers: a top-up bought mid-month needs no manual deploy. An answer written in an earlier month is not trusted for `bought`.

**2. The server admin can give one shop a budget of its own.** For a shop the plan does not fit (the owner's example: a busy Basic shop), on the server:

```
geometer shop budget glow-salon --monthly-inr 40 --reason "busy shop, owner asked" --set-by Naval --daily owner_talk=50
geometer shop budget glow-salon            # the plan's numbers, the shop's own, and the result
geometer shop budget glow-salon --clear    # back to the plan's
```

This writes `shops/<shop>/budget-override.json` (never code):

```json
{ "monthlyInr": 40, "daily": { "owner_talk": 50 }, "reason": "busy shop, owner asked", "setBy": "Naval", "date": "2026-11-19" }
```

Whole numbers only, known features only (`owner_talk`, `customer_talk`, `listing_draft`, `router`), a reason and a name always. A file that cannot be used is said in plain words and the plan's budget stays until it is fixed or cleared. The override **replaces only the numbers it names**: here the month and the owner's talk; customer questions and the rest stay the plan's (with any messages bought). It replaces, so it does not grow with messages bought.

- **Only the admin sets it.** The panel shows it, read-only: "Model budget: ₹40 a month, set for this shop on 2026-11-19: busy shop, owner asked." No panel page changes it. On Geometer's own Operator server Geometer pays for the model, so an Operator must never be able to raise it.
- **Fleet has its own wall.** Fleet switches the model off for a shop at its cap whatever the shop's budget says. So a raise above fleet's cap for that shop needs fleet's cap raised too. When `--monthly-inr` is above it, the command prints one sentence with the fleet command: `node apps/fleet/main.ts shop ai-cap <deployment> <shop> --monthly-inr 40 --reason "..."` (fleet's README, "The AI cap"). Fleet needs its own deploy to know the command.
- It works for both an agent shop (its `runtime.json`) and a listings-only shop (the shared process's config for it).

## Run and test

```
cd modules && node --test budget/test/        # the meter, the caps, the fallbacks, the notices, the retries
cd bundle  && node --test test/model-budget.test.ts test/shop-budget.test.ts   # the price list, the plan to budget, the runtime config, the panel line, the wall; the scaling, the override and its command
```

`budget/test/budget.test.ts` is pure (no assistant). `budget/test/budget-flow.test.ts` runs the real assistant on fakes.

## Extend it

To budget a new feature: add it to `FEATURES` in `budget.ts`; call `gate` before its model call and `record` after it (through `askMetered` in `assistant/talk-run.ts` if it is a talk-model call); decide its fallback and write its owner line in `assistant/words-budget.ts` in four languages; add its daily cap to the price list and to `budgetFor` in `bundle/lib/budget.ts`; add it to `DAY_FEATURES` so it reaches the review sheets.

## Not built, and why

See `modules/Deferred.md` (rows dated 18 Nov): the buyer assistant's wiring (the directory module is not on main); the listings-only shop's plan name and its wiring; the Operator seeing a notice in fleet's alert list; a budget for builders' own servers; the `geometer.json` field for a server's monthly total; the morning line; the owner's view of the month's breakdown in the owner's app.
