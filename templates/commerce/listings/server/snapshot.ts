// The store as one piece of JSON, and back (the way of writing it is shared: modules/runtime/snapshot.ts). Only two fields, and both are here on purpose: `assistant` holds the
// listings, the cards and the owner's talk; `ai` holds the month's AI counts. The runtime builds a fresh store from the last saved snapshot for each step, so a field left out
// is lost at once. There is no counter ("count" field), because the listings keep their own id sequence inside `assistant.listings`.
import type { Store } from "../src/state.ts";
import { snapshotCodec } from "../../../../modules/runtime/snapshot.ts";

export const FORMAT = 1;
const codec = snapshotCodec<Store>(FORMAT, [
  { name: "assistant", kind: "optional-object" },
  { name: "ai", kind: "optional-ai" },
]);

export const serializeStore: (store: Store) => string = codec.serialize;
/** A fresh Store from saved JSON. Never shares anything with the store it was saved from. */
export const parseStore: (json: string) => Store = codec.parse;
export const skipStoreCounters: (json: string, gap: number) => string = codec.skipCounters;
export const keepStoreCounters: (json: string, taken: string) => string = codec.keepCounters;
