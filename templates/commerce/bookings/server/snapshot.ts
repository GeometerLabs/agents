// The agent's store as one piece of JSON, and back. Maps and Sets are written as lists in their own order, because the agent depends on that order: latestBooking looks
// from the newest booking back, and a tick walks them oldest first. nextBooking is saved too, so a step that runs again after a restart registers the same "b-3" and
// finds its own calendar event and payment link. The way of writing it is shared (modules/runtime/snapshot.ts); this file says which fields Bookings' store has.
import type { Store } from "../src/booking.ts";
import { snapshotCodec } from "../../../../modules/runtime/snapshot.ts";

const codec = snapshotCodec<Store>(1, [
  { name: "bookings", kind: "map" },
  { name: "customers", kind: "map" },
  { name: "seenMessages", kind: "set" },
  { name: "seenEvents", kind: "set" },
  { name: "nextBooking", kind: "count" },
  // Optional: a snapshot written before the AI counts existed has no "ai", and still loads (same format).
  { name: "ai", kind: "optional-ai" },
  // Optional: a UPI shop's requests, the owner's marks and the refunds the owner owes (B33). A Razorpay shop never has it, so its snapshot is as it was.
  { name: "upi", kind: "optional-object" },
]);

export const serializeStore: (store: Store) => string = codec.serialize;
/** A fresh Store from saved JSON. Never shares anything with the store it was saved from. */
export const parseStore: (json: string) => Store = codec.parse;
