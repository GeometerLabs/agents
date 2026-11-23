// The agent's store as one piece of JSON, and back (the way of writing it is shared: modules/runtime/snapshot.ts). This file says which fields Stock orders' store has, and
// EVERY one is here on purpose. The runtime builds a fresh store from the last saved snapshot for each step, so a field that is left out is lost at once:
//  - `orders` holds every purchase order; the month's reserved budget is worked out from them, never kept as a counter, so nothing else needs saving for it;
//  - `seq` makes the next "po-3" (a `count`: po-N is quoted to suppliers, so a step that runs again after a restart must never give a new order a number already taken);
//  - `handled` (the owner's message ids already acted on) and `requests` (one request, one order) are what stop a message delivered twice making a second order;
//  - `optedOut` (suppliers who sent STOP), `asking` (a question the agent put to the owner), `assistant` (the assistant's part: its cards, memory, limit changes, talk)
//    and `ai` (the month's AI counts) are saved so a restart in the middle of an approval or a question loses nothing;
//  - `sendOnce` (modules/messaging/send-once.ts) holds each order message and reminder the agent asked for with its claim and ending: it is what makes a message go out once even if
//    the process dies mid-send, so it must be saved with the orders.
import type { Store } from "../src/order.ts";
import { snapshotCodec } from "../../../../modules/runtime/snapshot.ts";

const codec = snapshotCodec<Store>(1, [
  { name: "orders", kind: "map" },
  { name: "handled", kind: "set" },
  { name: "requests", kind: "map" },
  { name: "optedOut", kind: "set" },
  { name: "seq", kind: "count" },
  { name: "asking", kind: "optional-object" },
  { name: "assistant", kind: "optional-object" },
  { name: "ai", kind: "optional-ai" },
  { name: "sendOnce", kind: "optional-object" },
]);

export const serializeStore: (store: Store) => string = codec.serialize;
/** A fresh Store from saved JSON. Never shares anything with the store it was saved from. */
export const parseStore: (json: string) => Store = codec.parse;
/** After a restore from a snapshot: every id counter of the saved store moved on (modules/runtime/restored.ts). */
export const skipStoreCounters: (json: string, gap: number) => string = codec.skipCounters;
/** When a task ends without running again: every id counter at least where the thrown-away step left it, so its ids are never given out twice (go/internal/runtime, endTask). */
export const keepStoreCounters: (json: string, taken: string) => string = codec.keepCounters;
