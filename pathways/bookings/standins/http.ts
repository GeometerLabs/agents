// What the stand-ins share: a request as the translators see it, a reply, and "the reply is lost".
// Each translator (razorpay.ts, google-calendar.ts, whatsapp.ts, control.ts) turns an HTTP call into a call on one of the EXISTING in-memory
// fakes and the fake's answer back into the provider's wire format. There is no state in these files: the fakes are the only source of state.
import type { IncomingHttpHeaders } from "node:http";

export interface StandinRequest { method: string; path: string; query: URLSearchParams; body: any; headers: IncomingHttpHeaders }
export interface StandinReply { status: number; body?: unknown }
/** A translator answers requests that are its own, and returns undefined for the rest. */
export type Handler = (request: StandinRequest) => Promise<StandinReply | undefined>;

/** The fake stored the change and "lost" the reply: the server cuts the connection, so the client sees no answer. */
export class LostReply extends Error {}

export const ok = (body?: unknown): StandinReply => ({ status: 200, body });
