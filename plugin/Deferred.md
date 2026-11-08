# The Claude Code plugin: not built

- **WhatsApp template approval is not checked.** Needs a read of Meta's template list through the WhatsApp Guard (allow-list entry, stand-in route, check). Until then go-live asks the person and records their statement.
- **The confirm pages are in English only.** The panel's four languages need the page's words added to each `words.*.ts`. The people who open these links are builders working in Claude Code.
- **Loosening a limit has no link.** By design a person does it in the panel's edit page. A reviewed "loosen" flow (two people? a delay?) is a product decision, not a gap in the tools.
- **Only a few limits can be tightened by the plugin** (the list in `bundle/lib/limits-draft.ts`). Opening hours, deposits, prices and the Guard caps are changed by a person. Adding a template means adding its list there; a template not on the list has none.
- **`create_pathway` cannot set the deposit, refund limit or other money rules.** A new shop starts on the template's values; the builder changes them in the panel's form.
- **The report is not signed and has no go-live certificate attached.** The panel holds the signing key and the sealed certificate; there is no command-line way to ask it for a monthly report. The report button in the panel makes the signed one.
- **No tool starts an agent again.** `geometer start` on the server; a person's decision.
- **The agent crash test returns what it can read from `--json`** (held, total, failed titles, not run, not tested). The failing checks' detail is passed on as the code gives it, truncated.
- **A crash test started by `crash_test` is lost if Claude Code is closed before it ends.** Results are files, so a finished run survives; one still running does not.
- **The plugin cannot stop Claude from editing the server folder.** See "What this does not stop" in [Explanation.md](Explanation.md).
- **No plugin icon**, which only Anthropic's directory uses. Not submitted to the directory.
- **Not run:** a real Claude Code session using the installed plugin; the panel inside its container; the agent crash test with real Guards.
