// The runtime's one SQLite file per shop. The same for every template, so the code is shared (modules/runtime/store.ts). A listings-only shop's file is exactly the file any other
// shop has (same tables, same `SCHEMA_VERSION`), which is what lets its backup, the owner's file and a later move into another template's runtime work without a conversion of the file.
export { SCHEMA_VERSION, openStore } from "../../../../modules/runtime/store.ts";
export type { DurableStore, Task, TaskCounts, TaskState, WindowStore } from "../../../../modules/runtime/store.ts";
