# terms: what was left, and why

- The panel's terms page and the deployer's hand-over of `terms.json` stay in TypeScript (they are not shop-side runtime code).
- The agent's own `log` and record belong to each runtime; this package asks only for `Entries()` and a log function.
- LEGAL STATUS is unchanged: a mechanism and a draft text, with no legal check yet (modules/terms/terms.ts says so; so does the package comment).
- Hindi, Malayalam and Kannada are machine-written and wait for a native reader, like the rest of those packs. The generator carries `TERMS_REVIEW_STATE` through.
