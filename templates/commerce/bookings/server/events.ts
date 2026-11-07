// The events the inbox sends us, checked for shape before anything is saved, and the key that makes a redelivery a no-op. The same for every template, so the code is
// shared (modules/runtime/events.ts); this file keeps the names Bookings' tests and the bundle have always imported.
export { MAX_EVENTS_PER_REQUEST, checkEvents, eventKey } from "../../../../modules/runtime/events.ts";
export type { CheckedEvents, IncomingEvent } from "../../../../modules/runtime/events.ts";
