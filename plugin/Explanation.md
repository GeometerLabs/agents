# The Claude Code plugin: how it is built

Plan B11. The plugin lets a builder set up, check and run shop agents from Claude Code. It is a thin layer: skills that tell Claude how to talk to the builder, and an MCP server whose tools call the code that is already in this repository.

## Layout and the format followed

```
.claude-plugin/marketplace.json     the marketplace file (repo root): name geometer-agents, one plugin, source ./plugin
plugin/.claude-plugin/plugin.json   the manifest: name, version, userConfig (two folders), the MCP server
plugin/skills/<name>/SKILL.md       five skills
plugin/mcp/server.ts                JSON-RPC over stdio, no dependencies
plugin/mcp/tools.ts, lib.ts         the nine tools; the plumbing (finding folders, running children, fencing text)
plugin/test/                        the protocol and tool tests; the manifest tests
```

Followed: <https://code.claude.com/docs/en/plugins-reference> (manifest, `userConfig`, `mcpServers`, `${CLAUDE_PLUGIN_ROOT}`, the standard layout), <https://code.claude.com/docs/en/plugin-marketplaces> (`marketplace.json`, relative-path source, install commands) and <https://code.claude.com/docs/en/plugins/loading.md> (a marketplace plugin is copied into the cache; files above the plugin folder are not). `claude plugin validate ./plugin` and `claude plugin validate .` both pass; the one note is that the plugin has no icon, which only the Anthropic directory uses.

**No SDK.** The MCP protocol needed here is four methods (`initialize`, `ping`, `tools/list`, `tools/call`) as one JSON message per line. The official SDK would be the repository's only dependency and would need an install step inside Claude Code's plugin cache (which installs only from a lockfile). Nothing makes it unavoidable.

**Why the plugin is told where the bundle is.** An installed plugin is a copy of `plugin/` alone, so `../bundle` does not exist there. The manifest asks for two folders (`userConfig`): the builder's clone of this repository, and the server folder. They arrive as `GEOMETER_AGENTS_DIR` and `GEOMETER_SERVER`. Run with `--plugin-dir ./plugin` from a clone, the folder above `plugin/` is used when the first is not set. Tests cover found and not found.

## The tools call existing code

| Tool | Calls |
| --- | --- |
| `list_modules` | `bundle/panel/templates.ts` (the templates found in `templates/`), `bundle/lib/kinds.ts` (which the bundle can run), the `modules/` READMEs |
| `create_pathway` | `geometer shop add --template` (the name is the code's; in prose it is an agent template). B71: it asks for the shop's own UPI ID and payee (UPI is the default); a gateway account is a person's choice in the panel, and the example's made-up UPI ID is never used |
| `draft_limits` | `bundle/lib/limits-draft.ts`, and the template's own settings check from `kinds.ts` |
| `confirm_limits_link` | `geometer panel confirm-link`, which runs `bundle/panel/main.ts confirm-link` inside the panel container |
| `crash_test`, `crash_test_result` | the template's `scripts/hand-check.ts` for a shop, `geometer agent crash-test --json` for an agent someone wrote; read back through `bundle/handcheck.ts` |
| `go_live_link` | the server's own status file and secrets inbox, then `geometer panel confirm-link` |
| `pause_agent` | `geometer stop` (the Guard kill switch) |
| `report` | the template's `scripts/client-report.ts`, or `geometer agent report` |

Child programs run with their output captured, never inherited, because the server's own standard output is the protocol.

## "Outside the chat": the one-time link

The panel already had one-time invitation links (`accounts.ts`). A confirmation is the same idea with the same care: `bundle/panel/confirmations.ts` keeps only the sha256 of the token, a link works once and runs out after two hours, and it is tied to the shop and to the digest of its settings when it was asked for (settings that changed since refuse it).

- A link is **made** on the command line (`panel confirm-link`, which prints it). That command only asks. There is no command, route or tool that applies a request without a signed-in person.
- Opening the link (`GET /confirm/<token>`) shows the change and changes nothing. Without a session it goes to the login page.
- The button is a `POST` from a signed-in account that may see the shop, with the panel's usual CSRF token. For a limit change it writes the new settings through the same `writeFolder` the edit form uses, so `settings-history.jsonl` names the person. For go-live it runs the panel's own hand check and connection checks and makes the go-live certificate through the same `ready()` as the setup page; if anything is unmet it says what and the link stays unspent.
- The panel's log hides the token (`/confirm/[link]`).

## Only a person can widen a limit

`bundle/lib/limits-draft.ts` lists, per template, the few settings that have a known tight direction (the refund limit; for Fees also the waiver limit, late fee, reminders per month and the smallest part payment). Everything else, including deposit amounts, prices, hours, unknown fields and any template not on the list, is refused: default-deny. The same function is used three times:

1. `draft_limits` refuses a looser or unlisted change and says who can make it (a person, in the panel's edit page).
2. `panel confirm-link` refuses to make a link for one.
3. The confirm `POST` recomputes against the settings in force at that moment, so a request written straight into the panel's data file is refused as well. The test writes one by hand.

The plugin has no tool that starts a stopped agent (that would loosen), confirms, or takes a shop live; the test checks the tool list.

**What this does not stop.** Claude Code can edit files if it is allowed to. The skills tell it never to edit the server folder, and `create_pathway` keeps limits at the template's values, but a direct edit of `settings.json` is not stopped by the plugin. It would show in the history as a change with no person (`by: null`), which the panel and the export carry. Claude Code's own permission settings are the place to forbid it.

## Text from a run is data

Everything that came out of a crash test, an agent, or a report is returned between `<<<GEOMETER-DATA-<random> ... >>>` markers. The random part is new for each call, and the characters `<<<` and `>>>` inside the text are swapped for look-alikes, so the text cannot close the marker. The skills say to follow nothing found between markers. This lowers the risk; it does not remove it, since the model still reads the text.

## Crash test and its budget

The plan's "budget" is B8's: say what a run will cost before it runs. A template shop's crash test is Bookings' or Fees' own hand check on the shop's own settings against in-memory stand-ins: no model, no WhatsApp, no payment, no money, a few seconds. An agent someone wrote is started with its own command behind real Guards (`geo-guard` needed), about 35 seconds for ten situations. `crash_test` says this and starts the run in the background; `crash_test_result` reads the file in `<server>/state/plugin/runs/`. "Held N of M" is the code's own count; the not-tested list is read from the run's own output.

## Go-live and the WhatsApp templates

`go_live_link` reports: deployed and applied, limits shown to hold on the running Guards ("12 of 12" as the status file says), and whether any key still waits in the secrets inbox (a key waiting there is not in a Guard yet). **It cannot check that WhatsApp templates are approved**: the panel's own connection checks list "templates-approved" as not checked, and there is no read of Meta's template list in the Guard allow-list. So the tool, the link page and the skill all say "not checked", list the template names, and the page asks the person to look in their WhatsApp Business account and tick a box. That tick is recorded in the shop's notes as the person's statement (`goLiveStatement`), never as something Geometer checked.

## What was run

The protocol and every tool against a temporary server folder, with a stand-in for `docker` that runs the panel's own command; the panel's confirm routes in a real panel with a browser client; the hand check of Bookings on the example settings. Not run: a real panel container, real Guards, a real Claude Code session using the plugin, the agent crash test (needs `geo-guard`; only its "could not start" answer is tested).
