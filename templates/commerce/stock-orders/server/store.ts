// The runtime's one SQLite file per client agent. The same for every template, so the code is shared (modules/runtime/store.ts, which says what it holds and how a step is
// saved in one transaction). `SCHEMA_VERSION` is what the bundle asks of a pathway version before it moves a shop to it (bundle/handcheck.ts, savedDataLayout).
export { SCHEMA_VERSION, openStore } from "../../../../modules/runtime/store.ts";
export type { DurableStore, Task, TaskCounts, TaskState, WindowStore } from "../../../../modules/runtime/store.ts";
