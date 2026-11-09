// The stand-ins: the Razorpay, Google Calendar and WhatsApp wire formats over HTTP, in front of the existing in-memory fakes.
// One process, one port, three sets of paths that do not collide: /v1/... (Razorpay), /calendar/v3/... (Google), /v26.0/{id}/messages
// (WhatsApp), and /_standin/... (control). There is no new state: createFakePayments, createFakeCalendar and createFakeMessaging are the
// only source of it, so the tests of the fakes keep their meaning.
//
// A fault the fake plans as "lost reply" makes the server cut the connection AFTER the fake stored the change, so the client sees no answer
// (and the live adapter raises TimeoutError), exactly the case the agent must look before it retries.
import type { Server } from "node:http";
import { systemClock } from "../../../../modules/core/clock.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { createFakeCalendar } from "../src/adapters/calendar.ts";
import { createFakeMessaging } from "../../../../modules/messaging/messaging.ts";
import { createFakePayments } from "../../../../modules/payments/payments.ts";
import { controlStandin } from "./control.ts";
import type { Fakes } from "./control.ts";
import { calendarStandin } from "./google-calendar.ts";
import { serveHandlers } from "../../../../modules/standins/http.ts";
import type { Handler } from "../../../../modules/standins/http.ts";
import { razorpayStandin } from "../../../../modules/payments/providers/razorpay/standin.ts";
import { ruleDecider } from "./rule-decider.ts";
import { systemOneStandin } from "../../../../modules/standins/system-one.ts";
import type { SystemOneStandin, SystemOneStandinOptions } from "../../../../modules/standins/system-one.ts";
import { approveTemplates, whatsappStandin } from "../../../../modules/standins/whatsapp.ts";
import { META_TEMPLATES } from "../src/language/meta-templates.ts";
import { REPORT_TEMPLATES } from "../report/whatsapp.ts";

export interface StandinsConfig {
  clock?: Clock;
  /** Where signed webhooks are delivered (the inbox), for example http://127.0.0.1:8788. */
  inboxUrl?: string;
  razorpayWebhookSecret: string;
  whatsappAppSecret: string;
  phoneNumberId?: string;
  /** What reading the WhatsApp number's own details shows (a connection check compares them with what the shop gave). */
  displayPhoneNumber?: string;
  verifiedName?: string;
  /** The one calendar the calendar-metadata read answers for, and the role the account has on it (see google-calendar.ts). */
  calendarId?: string;
  calendarAccessRole?: string;
  /** Use these fakes instead of new ones, so a test can read and change them directly. */
  fakes?: Partial<Fakes>;
  /** Events per page of a calendar list (default 250, Google's own default). */
  calendarPageSize?: number;
  /** Also answer the System One decisions API (`POST /v1/systemone`), the way Laya and Jev do. `true` answers from the rule parser. */
  systemOne?: SystemOneStandinOptions | true;
}

export interface RunningStandins { server: Server; port: number; url: string; fakes: Fakes; /** The System One stand-in, when one was asked for: its `requests` are what the agent asked. */ systemOne?: SystemOneStandin; close(): Promise<void> }

/** The templates the provider has approved: the booking messages and the owner's monthly report. */
const STANDIN_TEMPLATES = { templates: [...META_TEMPLATES, ...REPORT_TEMPLATES] };

export async function startStandins(config: StandinsConfig, listen: { port: number; host?: string }): Promise<RunningStandins> {
  const clock = config.clock ?? systemClock;
  const fakes: Fakes = {
    payments: config.fakes?.payments ?? createFakePayments(clock),
    calendar: config.fakes?.calendar ?? createFakeCalendar(),
    messaging: config.fakes?.messaging ?? createFakeMessaging(clock),
  };
  approveTemplates(fakes.messaging, STANDIN_TEMPLATES);
  let authorizationSeen = 0;
  const systemOne = config.systemOne ? systemOneStandin(config.systemOne === true ? { decider: ruleDecider } : config.systemOne) : undefined;
  const handlers: Handler[] = [
    ...(systemOne ? [systemOne.handler] : []),
    razorpayStandin(fakes.payments),
    calendarStandin(fakes.calendar, { pageSize: config.calendarPageSize, calendarId: config.calendarId, accessRole: config.calendarAccessRole }),
    whatsappStandin(fakes.messaging, STANDIN_TEMPLATES, { phoneNumberId: config.phoneNumberId, displayPhoneNumber: config.displayPhoneNumber, verifiedName: config.verifiedName }),
    controlStandin({ fakes, inboxUrl: config.inboxUrl, razorpayWebhookSecret: config.razorpayWebhookSecret, whatsappAppSecret: config.whatsappAppSecret, phoneNumberId: config.phoneNumberId, authorizationSeen: () => authorizationSeen }),
  ];

  const served = await serveHandlers(handlers, listen, (req) => { if (req.headers.authorization !== undefined) authorizationSeen++; });
  const { server, port } = served;
  return { server, port, url: served.url, fakes, ...(systemOne ? { systemOne } : {}), close: served.close };
}
