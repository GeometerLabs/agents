# internal/directory: left out, and why

* **The decision model ("System One") of the buyer's assistant.** `directoryConfig` (`bundle/generate/configs.ts`) never writes a `systemOne` block, so the deployed service cannot reach it. A
  config that carries one is read and the block ignored (the language model is used). Needs `internal/understanding` (another stream) to be built once, not twice.
* **The model-written line over the results** (`writeLine`, `groundedProblem`, which need the talk-check) is a hook the service never wires; the template line is the only line.
* **The "anthropic" model wire.** Only the openai wire is spoken (as in the shops' Go runtime); a directory whose model speaks the other logs why and runs with the assistant off. The model
  Guard in front speaks the openai wire for the providers the deployer uses.
* **`rebuildIndex`** (throwing the derived tables away and making them again from the kept feeds): no service path calls it.
* **Dates JavaScript reads loosely.** `Date.parse` of an RFC 1123 date or a space-separated one is not read: an answer so dated is "not from just now" and a `confirmed` so dated is ignored.
  Shops write ISO dates (specs), so only a hostile or broken shop sees the difference.
* **Internationalised host names** (a pages domain in Unicode or punycode) are refused by the address reader; the directory's own pages domains are ASCII.
* **A `health` subcommand** for the container's own health check (the image will hold nothing but the program): `internal/health` is on the deploy-switch branch; the directory's main takes it
  from there at the merge (go/TRIAL.md "Wave 1c").
