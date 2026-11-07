// The agent's store as one piece of JSON, and back (the way of writing it is shared: modules/runtime/snapshot.ts). This file says which fields Fees' store has, and
// EVERY one is here on purpose. The runtime builds a fresh store from the last saved snapshot for each step, so a field that is left out is lost at once:
//  - `startedAtMs` is the day the agent first ran. The agent does `store.startedAtMs ??= clock.now()` and chases no month whose first reminder day was before it, so a
//    snapshot without it would make every tick believe the agent had just started, and no reminder would ever go out;
//  - `nextDue` and `nextRequest` make the next "f-3" and "q-2". Without them a step that runs again after a restart would give a new fee, or a new request, a number that is
//    already taken.
import type { Store } from "../src/due.ts";
import { snapshotCodec } from "../../../../modules/runtime/snapshot.ts";

const codec = snapshotCodec<Store>(1, [
  { name: "dues", kind: "map" },
  { name: "customers", kind: "map" },
  { name: "seenMessages", kind: "set" },
  { name: "seenEvents", kind: "set" },
  { name: "nextDue", kind: "count" },
  { name: "nextRequest", kind: "count" },
  { name: "startedAtMs", kind: "optional-number" },
  { name: "ai", kind: "optional-ai" },
]);

export const serializeStore: (store: Store) => string = codec.serialize;
/** A fresh Store from saved JSON. Never shares anything with the store it was saved from. */
export const parseStore: (json: string) => Store = codec.parse;
