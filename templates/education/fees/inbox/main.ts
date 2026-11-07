// The inbox as its own process: node templates/education/fees/inbox/main.ts. It is the same program for every template (modules/inbox/main.ts, which lists the environment it
// reads and how WhatsApp webhooks are verified): Razorpay's and WhatsApp's signed webhooks are checked here, the owner's replies also go to the approvals relay, and the
// rest is handed to the runtime, which saves each event before the provider is answered.
import "../../../../modules/inbox/main.ts";
