# Geometer for Claude Code

Set up, check and run shop agents without leaving Claude Code. The plugin has five skills and nine tools. It calls the deploy bundle in this repository; it does not copy it.

| Skill | What it does |
| --- | --- |
| `set-up-template` | Asks about the business, makes the shop's folder from an agent template (Bookings, Fees), explains each limit in plain words |
| `set-limits` | Turns your words into **tighter** limits. Claude drafts, you confirm in the panel through a one-time link. Only a person can loosen a limit |
| `crash-test` | Shows the budget, runs the crash test, reports "Held N of M", names what failed and what was not tested |
| `go-live` | Checks what the server knows, then gives you a one-time link. You confirm in the panel. It does not check that WhatsApp templates are approved; it says so |
| `client-report` | Makes the monthly report; can pause an agent at once |

## Install

You need this repository cloned (the deploy bundle runs from it) and a server folder made by `geometer init` ([bundle/README.md](../bundle/README.md)). Node 26.

```
/plugin marketplace add GeometerLabs/agents
/plugin install geometer@geometer-agents
```

On Claude Code 2.1.275 or later this also works in one step: `/plugin install geometer --marketplace GeometerLabs/agents`.

Claude Code asks for two folders when you enable it:

- **Agents checkout**: your clone of this repository (the folder with `bundle/geometer.ts`). An installed plugin is a copy of `plugin/` only, so it has to be told where the bundle is.
- **Server folder**: the folder `geometer init` made, with `geometer.json` in it.

To try it from a clone without installing: `claude --plugin-dir ./plugin`. The folder above `plugin/` is then used as the agents checkout, and you only set the server folder (`GEOMETER_SERVER=~/geometer-server claude --plugin-dir ./plugin`).

The server needs the panel turned on (`"panel": { "enabled": true }` in `geometer.json`) and running, because limits and go-live are confirmed there.

## Two minutes

1. "Set up a booking agent for Glow Salon in Kochi." Claude asks a few questions and makes the shop. Limits start at the template's strict values.
2. "The refund limit should be 100 rupees." Claude drafts it and hands you a link. Open it, sign in to the panel, read the table, press the button. Nothing changes before that. "Make it 500" is refused: only you can loosen a limit, in the panel's edit page.
3. Hand in the shop's keys through the panel (not in the chat).
4. "Crash test it." Claude shows the budget (nothing real is touched), runs it and tells you what happened to customers, "Held N of M", and everything that was not tested.
5. "Go live." Claude checks the server, gives you a link. In the panel you read the WhatsApp templates, look in your WhatsApp Business account to see that Meta approved them, tick the boxes if it is true, and the panel runs its own checks and makes the go-live certificate.
6. A month later: "Make Glow Salon's report for November."

## What it will not do

- Confirm a limit, loosen a limit, or take a shop live. There is no tool for any of these; they end in a link that a signed-in person uses in the panel.
- Start an agent again after `pause_agent`. A person does that on the server.
- Take a key in the chat. Tell Claude to stop if you are about to paste one, and rotate it if you did.

Claude can still edit files on your machine if you let it. The skills tell it not to touch the server folder; if a file is edited by hand anyway, the shop's settings history records the change without a person's name. More in [Explanation.md](Explanation.md); what is not built is in [Deferred.md](Deferred.md).

Tests: `cd plugin && npm test`.
