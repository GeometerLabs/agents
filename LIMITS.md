# What the agents do not check yet

Each line is something an agent here may do in its code, or that you might expect from the
name, but that Geometer could not check with the current engine. None of these is claimed anywhere in
this repository. If one of them matters to you, treat the agent as unchecked for it.

## Rules the engine cannot check in this setup

| Agent | Not checked yet | Why |
| --- | --- | --- |
| creator-payouts | A payout is never above the amount owed | The rule families for amounts (`numeric_bound`, `conservation`) read stored columns of a database Geometer can observe. These agents talk to a simulated HTTP service, which has no such columns. The agent cuts the amount down in code; nothing checks that it does. A variant with a database is not built. |
| game-master | A daily cap on rewards | There is no time-window rule yet (for example "at most 5 legendary items an hour across all agents"). |
| game-master | A reward comes from the quest table, not from the player's chat | Following where a value came from (taint tracking) is not built. |
| item-shop, creator-payouts, game-master | Items or money go to the ticket's, creator's or quest's own player | `argument_allowlist` checks a suffix such as `@players.example`. It shows "a player account", not "this particular player". |
| liveops-compensation | The restored items match what the crash really took | The agent trusts the ticket's record of what was lost; nothing compares it with the game's own logs. |
| liveops-compensation, lending, claims, access-grants, purchasing | Money, items or roles go to the ticket's, application's, claim's or request's own account | `argument_allowlist` checks a suffix such as `@players.example`. It shows "a player account", not "this particular player". |
| game-director | A cap on the total spawned or on how fast prices move over time | There is no time-window rule yet (for example "at most 500 units an hour across all events"). |
| game-director | That the director's choices make a good economy | Geometer checks rules about what happened (once per event, approvals, price bounds), not whether the economy is balanced. |
| game-director | Prices within bounds | Geometer's number-bound rule (`numeric_bound`) reads a stored column of a database it can observe, and `.geometer/rules.toml` cannot declare it. This agent's shop is a web service, so no price rule is declared: the agent refuses prices outside 1.00 to 1000.00 gems in its code, and only its own tests check that. A variant with the prices in a database is not built. |
| streamer-giveaways | The list of approved campaigns | It is written into the rule as the campaign ids `camp-spring` and `camp-launch`; if your approved campaigns change, change the rule. The rule matches the end of the id. |
| streamer-giveaways | That a chat name is one person | The viewer handle comes from chat; one person with two handles gets two codes. |
| streamer-giveaways | That the host never calls the export tool (`never-exports-codes`) | The clean agent is never given the tool, so a clean result for this rule is because of how the agent is built, not because the agent chose well. The broken variant that hands the tool to chat is the one the rule is meant to catch. |
| purchasing | Each buyer's own limit | The rule holds one amount (500.00, the limit of every buyer in the sample). Real limits per buyer would need a rule per limit. The agent reads the buyer's limit from the request. |
| purchasing | The supplier is on an approved list | No supplier rule is declared. |
| lending | That the loan amount is the amount the credit officer approved | The agent pays the amount on the application; nothing compares it with the approval. |
| claims | Payments go only to the policyholder's account | No account rule is declared; the agent takes the account from the claim. The Bedrock option (`MODEL_PROVIDER=bedrock`) is not run by Geometer. |
| lab-protocol | The order of protocol steps, or that an instrument really ran a step | The agent talks to a lab-information service; nothing is simulated beyond its replies. |
| lab-protocol | A discard needs a scientist (`discards-need-a-scientist`) | Written as an amount rule on the discarded volume with a limit of zero, so every discard needs an approval id. It checks that an id was present, not that a scientist gave it. In Geometer's runs the rule was never reached: the agent holds the discard in code before the call, and a variant that dropped the hold was not caught either (the discard call did not complete in the stand-in's tour), so nothing here shows the rule working. The agent's own tests check the hold. |
| access-grants | Revoking access | The agent only grants. Admin roles are told apart by a privilege level above 2 on the request. |
| all framework agents | That a real model keeps to the rules | Geometer's check uses a stand-in for the model. The tools hold the rules in code, so the model cannot change them, but a result says nothing about how a real model chooses. |
| all | An approval rule being held by the clean agent | The agents stop before a call that needs approval, so the check never sees a call to judge: the rule is reported as never reached. Geometer's check does not issue approvals. The broken variants that skip the stop are caught (Broke), which shows the rule works; the clean agent's side of it is not shown. |
| refund-desk | A lost request (the call never arrives) | Tried alone with `geo check --fault lost_request --at payments.refund`: the result was "couldn't tell" (one rule check lacked the evidence it needed). |
| all | A crash in the middle of an action | The default check tries lost replies only. Crashes, partial effects and lost acknowledgements were not tried. |
| all | Kept checks | None are stored here. A kept check is made from a problem found in your own copy; CI reports "0 kept checks". |

## Checklist items not covered

Each README lists the ten items of Geometer's agent checklist. These are not covered by every agent
yet: stays within its limits (item 6, except where a README says otherwise), never calls tools it
must not (7, except streamer-giveaways), survives a crash mid-action (8), keeps a record of
what it did (9, the Node.js samples append to a memory file but nothing checks it), and lets people decide how
much it may do alone (10, set in Geometer, not in these folders).

## About the setup

- The services are simulated by Geometer from `.geometer/tools.toml`, and the model is a scripted
  stand-in (for the six Node.js samples it follows the stored command in its prompt; for the framework
  agents it calls the tools it is offered). A result says how the agent's own code behaves;
  it says nothing about how a real model would choose, or about a real payment, booking or game service.
- Results hold within what was tried: the tasks in `.geometer/tasks.toml` and a lost reply at each action
  that changes something.
- No engine change is needed for what is claimed. If you want a limit above checked, it needs an engine
  change; none was made.
