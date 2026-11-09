// What a payment provider's module declares (B71). A provider is one folder, modules/payments/providers/<name>/, whose index.ts exports one of these; the registry
// (providers/index.ts) lists them. Everything outside that folder asks the declaration (its capabilities, its Guard, its webhook, its words) and never the
// provider's name, so adding a gateway is a folder and a line in the registry, and no template, panel page or deploy step changes.
//
// Two kinds of provider, by what they can do:
//  - a gateway (Razorpay): an API Guard sits in front of. It declares `gateway`: the API mapping, the Guard routes and limits it needs, the webhook, the keys a
//    shop hands in, the panel's connection check, and a stand-in for crash tests;
//  - an owner-marked provider (UPI): nothing the agent can reach sees the money, so a person marks it (modules/payments/owner-marked). It declares `ownerMarked`:
//    how a request is written for the customer to pay.
import type { Language } from "../../language/languages.ts";
import type { FakePayments, PaymentCapabilities, PaymentEvent, Payments } from "../payments.ts";
import type { Handler } from "../../standins/http.ts";

/** One route of the provider's API as Guard names it: the method, the path with its {params}, and the operation name every rule refers to. */
export interface GuardRoute { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; operation: string }

/**
 * What the neutral Guard rules (modules/payments/guard-limits.ts) need of a gateway's API, and what the rest of the bundle needs to run a Guard in front of it.
 * The operation names, the amount field and its units are the provider's; the rules (a bound on a request's amount, a bound and an owner's approval on a refund,
 * one refund per payment, the day's caps) are the same for every gateway.
 */
export interface GatewayGuard {
  /** Guard's tool name. Also the Guard's kind in the bundle, its service name (g-<shop>-<tool>) and its state volume: never change it for a deployed provider. */
  tool: string;
  /** host:port of the provider's API. */
  upstream: string;
  /** The file, under /run/secrets in the Guard's container, that holds the Authorization header Guard adds. The agent never holds it. */
  secretFile: string;
  /** Every route Guard lets through, in the order the spec lists them (the order is part of the bytes Guard is given). */
  routes: GuardRoute[];
  /** The operations the neutral rules are about. */
  ops: { createRequest: string; listRequests: string; readRequest: string; cancelRequest: string; readPayment: string; refund: string; listRefunds: string };
  /** Calls no agent may ever make (payouts), each with the id of the rule that forbids it. */
  forbidden: { ruleId: string; operation: string }[];
  /** The field that carries an amount, in both a new request and a refund, and its unit. */
  amountField: string;
  units: "paise";
  /** Refund once per payment: the call fields that name the payment, and the provider's idempotency header (Guard derives the key). */
  refundOnce: { keyFields: string[]; idempotencyHeader: string };
  /** Call fields Guard's decisions carry, for whoever reads them back (the record of an own agent, the crash test): the payment, the request's reference. */
  fields: { paymentId: string; reference: string };
  /** What a reading credential may call (look, change nothing): the own agent's record job and relay, and the panel's connection check. */
  reads: { record: string[]; panel: string[] };
}

/** A gateway's signed webhook, read into the neutral events. */
export interface GatewayWebhook {
  /** The header that carries the signature, and the one with the provider's event id (the same event can arrive more than once). */
  signatureHeader: string;
  eventIdHeader?: string;
  sign(rawBody: Buffer, secret: string): string;
  verify(rawBody: Buffer, header: string | undefined, secret: string): boolean;
  /** The provider's body as a neutral event, or null for one the agent does not use. */
  read(body: unknown, eventId?: string): PaymentEvent | null;
  /** The largest body the inbox takes, and how soon the provider wants an answer. */
  maxBodyBytes: number;
  answerWithinMs: number;
}

/** Words a person reads about this provider, in each language. The display name is the provider's own and is never translated. */
export interface GatewayWords {
  /** The choice in the panel's payment step. */
  option: string;
  /** The accounts step: how to get the key and the webhook secret. */
  accounts: { title: string; intro: string; steps: string[]; mode: string; modeLive: string; modeTest: string; keyId: string; keySecret: string; webhookSecret: string; webhookUrl(url: string): string };
  /** The connection check's result. */
  checks: { title: string; confirmed(mode: string): string; differs: string; wrongMode: string };
  /** What the check cannot say about whose account a key is. */
  whose: string;
}

/** Everything a shop hands in for a gateway, and the panel's check that it works. */
export interface GatewaySetup {
  /** The secret files a shop hands in: the API key ("<key id>:<key secret>") and the webhook secret. Their names are the provider's. */
  secrets: { key: string; webhook: string };
  /** A key id's shape, and the mode it is for. `keyExample` is how a key file looks, for the deployer's plain message (never a real key). */
  keyId: RegExp;
  keyExample: string;
  modeOf(keyId: string): "live" | "test" | undefined;
  /** Shape only, never the value in an error: a key and secret on one line, and a webhook secret. */
  checkKey(text: string): boolean;
  checkWebhookSecret(text: string): boolean;
  /** The handed-in key file as the Authorization header Guard adds. */
  authorization(keyFileText: string): string;
  /**
   * The panel's read-only check (bundle/panel/checks.ts): one GET that only a working key answers, through Guard with the panel's own reading credential, and what
   * a good answer looks like. It cannot say whose account the key is; the panel says so.
   */
  probe: { path: string; query: Record<string, string>; looksRight(body: unknown): boolean };
  words: Record<Language, GatewayWords>;
}

/** A provider with an API (B71: Razorpay first; Cashfree is the likely next). */
export interface GatewayDeclaration {
  guard: GatewayGuard;
  /** The live adapter: the provider's wire format mapped onto Payments. `baseUrl` is the shop's Guard, never the provider. */
  adapter(config: { baseUrl: string; timeoutMs?: number; agentToken?: string }): Payments;
  webhook: GatewayWebhook;
  setup: GatewaySetup;
  /** The stand-in for crash tests: the provider's wire format in front of the in-memory fake (payments.ts), and the webhook body it sends for each event. */
  standin: {
    handler(fake: FakePayments): Handler;
    webhookBody(event: PaymentEvent, fake: FakePayments): string;
  };
  /** Ids in the price list for the provider's fee on each payment (the cost line), e.g. its platform fee and the GST on it. */
  feeRates: string[];
  /** Read a payment's own record through Guard, for the approvals relay of an agent we did not write: who paid and when. */
  paymentContext(baseUrl: string, token: string, paymentId: string, fetchFn: typeof fetch, timeoutMs: number): Promise<{ kind: "found"; customer?: string; atMs: number } | { kind: "missing" } | { kind: "error"; error: string }>;
}

/** A provider whose payments a person confirms (UPI): how a request is written for the customer. */
export interface OwnerMarkedDeclaration {
  /** Who is paid, as the customer's message names them: the shop's UPI ID and the name its app shows. */
  payTo(payment: ProviderSettings): { id: string; name: string };
  /** The link for one request (the exact amount and the reference in it). Throws, in plain words, on a field the customer's app would not take. */
  payLink(payment: ProviderSettings, request: { amountPaise: number; note: string }): string;
}

/** A provider's own block in the settings: {"module": "<id>", ...its own keys}. */
export interface ProviderSettings { module: string; [key: string]: unknown }

export interface PaymentProvider {
  /** The settings' "module" value. For a gateway it is also its Guard's tool name. */
  id: string;
  /** The provider's own name, shown to people as it is in every language (a brand). */
  displayName: string;
  capabilities: PaymentCapabilities;
  /** Read this provider's block (its module already matched). Pushes plain-words problems; undefined when it is wrong. */
  readSettings(block: Record<string, unknown>, errors: string[]): ProviderSettings | undefined;
  /** One line for the settings' error message: how a block for this provider looks. */
  example: string;
  gateway?: GatewayDeclaration;
  ownerMarked?: OwnerMarkedDeclaration;
  /** The provider's sign-up notes, relative to the repository (what a shop must open, and what it costs). */
  signup: string;
}
