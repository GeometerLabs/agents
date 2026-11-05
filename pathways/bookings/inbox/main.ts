// The inbox as its own process: node pathways/bookings/inbox/main.ts. It is the same program for every template (modules/inbox/main.ts, which lists the environment it
// reads and how WhatsApp webhooks are verified).
import "../../../modules/inbox/main.ts";
