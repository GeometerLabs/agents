// The stand-ins for Fees: the Razorpay and WhatsApp wire formats over HTTP, in front of the in-memory fakes. The server itself is shared (modules/standins/payments-server.ts);
// this file only says which messages the provider has approved here: the fee messages and the owner's monthly report. Fees has no calendar.
import { paymentsStandins } from "../../../../modules/standins/payments-server.ts";
import { META_TEMPLATES } from "../src/language/meta-templates.ts";
import { REPORT_TEMPLATES } from "../report/whatsapp.ts";

export type { StandinsConfig, RunningStandins } from "../../../../modules/standins/payments-server.ts";

export const startStandins = paymentsStandins({ name: "Fees", templates: { templates: [...META_TEMPLATES, ...REPORT_TEMPLATES] } });
