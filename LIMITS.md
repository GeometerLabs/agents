# What the blueprints do not check yet

Each line is something a blueprint's agent may do in its code, or that you might expect from the
name, but that Geometer could not check with the current engine. None of these is claimed anywhere in
this repository. If one of them matters to you, treat the blueprint as unchecked for it.

## Rules the engine cannot check in this setup

| Blueprint | Not checked yet | Why |
| --- | --- | --- |
| creator-payouts | A payout is never above the amount owed | The rule families for amounts (`numeric_bound`, `conservation`) read stored columns of a database Geometer can observe. These agents talk to a simulated HTTP service, which has no such columns. The agent cuts the amount down in code; nothing checks that it does. A variant with a database is not built. |
| game-master | A daily cap on rewards | There is no time-window rule yet (for example "at most 5 legendary items an hour across all agents"). |
| game-master | A reward comes from the quest table, not from the player's chat | Following where a value came from (taint tracking) is not built. |
| item-shop, creator-payouts, game-master | Items or money go to the ticket's, creator's or quest's own player | `argument_allowlist` checks a suffix such as `@players.example`. It shows "a player account", not "this particular player". |
| all | An approval rule being held by the clean agent | The agents stop before a call that needs approval, so the check never sees a call to judge: the rule is reported as never reached. Geometer's check does not issue approvals. The broken variants that skip the stop are caught (Broke), which shows the rule works; the clean agent's side of it is not shown. |
| refund-desk | A lost request (the call never arrives) | Tried alone with `geo check --fault lost_request --at payments.refund`: the result was "couldn't tell" (one rule check lacked the evidence it needed). |
| all | A crash in the middle of an action | The default check tries lost replies only. Crashes, partial effects and lost acknowledgements were not tried. |
| all | Kept checks | None are stored here. A kept check is made from a problem found in your own copy; CI reports "0 kept checks". |

## Checklist items not covered

Each README lists the ten items of Geometer's agent checklist. These are not covered by any blueprint
yet: stays within its limits (item 6, except where a README says otherwise), never calls tools it
must not (7, no forbidden-call rule is declared), survives a crash mid-action (8), keeps a record of
what it did (9, the agents append to a memory file but nothing checks it), and lets people decide how
much it may do alone (10, set in Geometer, not in these folders).

## About the setup

- The services are simulated by Geometer from `.geometer/tools.toml`, and the model is a scripted
  stand-in that follows the stored command in its prompt. A result says how the agent's own code behaves;
  it says nothing about how a real model would choose, or about a real payment, booking or game service.
- Results hold within what was tried: the tasks in `.geometer/tasks.toml` and a lost reply at each action
  that changes something.
- No engine change is needed for what is claimed. If you want a limit above checked, it needs an engine
  change; none was made.
