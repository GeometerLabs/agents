// The agent's store as one piece of JSON, and back. Maps and Sets are written as lists in their own order, because the
// agent depends on that order: latestBooking looks from the newest booking back, and a tick walks them oldest first.
// nextBooking is saved too, so a step that runs again after a restart registers the same "b-3" and finds its own
// calendar event and payment link.
import type { Store } from "../src/booking.ts";

const FORMAT = 1;

export function serializeStore(store: Store): string {
  return JSON.stringify({
    format: FORMAT,
    bookings: [...store.bookings],
    customers: [...store.customers],
    seenMessages: [...store.seenMessages],
    seenEvents: [...store.seenEvents],
    nextBooking: store.nextBooking,
  });
}

/** A fresh Store from saved JSON. Never shares anything with the store it was saved from. */
export function parseStore(json: string): Store {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const lists = ["bookings", "customers", "seenMessages", "seenEvents"];
  if (raw.format !== FORMAT || !lists.every((k) => Array.isArray(raw[k])) || !Number.isInteger(raw.nextBooking)) {
    throw new Error("The saved state is not in a format this version can read. It was probably written by another version of the pathway.");
  }
  return {
    bookings: new Map(raw.bookings as []),
    customers: new Map(raw.customers as []),
    seenMessages: new Set(raw.seenMessages as []),
    seenEvents: new Set(raw.seenEvents as []),
    nextBooking: raw.nextBooking as number,
  };
}
