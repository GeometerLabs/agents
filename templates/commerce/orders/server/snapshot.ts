// The agent's store as one piece of JSON, and back (the way of writing it is shared: modules/runtime/snapshot.ts). This file says which fields Orders' store has, and EVERY
// one is here on purpose. The runtime builds a fresh store from the last saved snapshot for each step, so a field that is left out is lost at once:
//  - `orders` holds every order, and stock and the day's order count are worked out from them, never kept as counters, so nothing else needs saving for them;
//  - `nextOrder` makes the next "o-3". Without it a step that runs again after a restart would give a new order a number that is already taken.
import type { Store } from "../src/order.ts";
import { snapshotCodec } from "../../../../modules/runtime/snapshot.ts";

const codec = snapshotCodec<Store>(1, [
  { name: "orders", kind: "map" },
  { name: "customers", kind: "map" },
  { name: "seenMessages", kind: "set" },
  { name: "seenEvents", kind: "set" },
  { name: "nextOrder", kind: "count" },
  { name: "ai", kind: "optional-ai" },
  // a UPI centre's requests, the owner's marks and the refunds the owner owes (B33); a Razorpay centre never has it, so its snapshot is as it was
  { name: "upi", kind: "optional-object" },
]);

export const serializeStore: (store: Store) => string = codec.serialize;
/** A fresh Store from saved JSON. Never shares anything with the store it was saved from. */
export const parseStore: (json: string) => Store = codec.parse;
/** After a restore from a snapshot: every id counter of the saved store moved on (modules/runtime/restored.ts). */
export const skipStoreCounters: (json: string, gap: number) => string = codec.skipCounters;
