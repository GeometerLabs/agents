# discovery: a directory of local shops

A buyer wants "a Persian kitten near Thrissur". The shops that have one are many small shops, each with its own server or none at all. **The directory** reads what each shop
publishes, keeps a search index, and answers searches fairly: a web page, a JSON address, an MCP endpoint and a signed Agent Card. It follows four open documents in
[`specs/`](../../specs/README.md) (`shop-feed.md`, `shop-check.md`, `agent-card.md`, `directory.md`), and anyone may run their own directory from them.

**Since 19 Nov 2026 the directory is written in Go** (decision 61, wave 1c): `go/cmd/directory` and `go/internal/directory` (read their `Explanation.md` and `Deferred.md`). The TypeScript
directory that was here (feed, trust, index, check, order, search, page, http, mcp, card, assistant, ...) and the service `bundle/services/directory.ts` are deleted. The deployer runs the Go
program as the `directory` container on a server with a pages domain (`bundle/generate/compose.ts`, `bundle/Explanation.md`).

What is left in this folder:

| file | why it stays |
| --- | --- |
| `words.ts` | the words of the search page and the order page in four languages: the source the Go directory's words are generated from (`go/scripts/gen_directory.ts`), and what the review sheet (`bundle/panel/review.ts`) lists for a native reader |
| `types.ts` | the four languages and the kinds, which `words.ts` and the generator use |
| `contract/` | the directory CONTRACT: black-box tests that start the directory as a separate process and talk to it over HTTP (its README says what each covers), with the golden answers the TypeScript gave before it was deleted |
