// The inbox: the only thing the providers' webhooks reach. It holds the webhook secrets, so the agent runtime never does. It is the same for every template, so the code is
// shared (modules/inbox/server.ts, which explains each check); this file keeps the names Bookings' tests and the bundle have always imported.
export { batches, inboxHandler, startInbox } from "../../../../modules/inbox/server.ts";
export type { InboxConfig, RunningInbox } from "../../../../modules/inbox/server.ts";
