// Vector cases for go/internal/messaging: the TypeScript messaging module (modules/messaging) run on scripted inputs, and what it did written down for the Go twin to match.
//  - live-vectors.json: the REAL live clients (Meta, Gupshup partner, Gupshup self-serve) against a recording HTTP server (go/scripts/lib/record.ts): every request's method, target,
//    headers and body bytes, and the outcome of each step of a short script (a send, a read-back, a clock move).
//  - webhook-vectors.json: the webhook readers (messages, statuses, self-serve, toE164, mediaOf) and Meta's signature, on the four fixtures and on made-up bodies.
//  - misc-vectors.json: the pure checks (document, image, sticker, buttons and lists), the provider config check, template parameters, and the sent-copy's 1000-message bound.
//  - fake-vectors.json: the in-memory fake and the "fakes" stand-in, scripted step by step.
//  - sendonce-vectors.json: send-once's state functions and runSendOnce's calls, in order.
//  - say-vectors.json: say() for scripted deps and a scripted messaging, with every record line, every messaging call and the result.
//  - status-vectors.json: recordMessageStatus on scripted records.
// Nothing here reads a clock or a port: every time is a number written in the case.
import { createFakeMessaging, documentProblem, imageProblem, stickerProblem } from "../../../modules/messaging/messaging.ts";
import { createCloudApiMessaging, cleanParameter, describeMetaError } from "../../../modules/messaging/whatsapp.ts";
import { createLiveMessaging, messagingConfigProblem } from "../../../modules/messaging/providers.ts";
import { createSay } from "../../../modules/messaging/say.ts";
import { MAX_TRIES, RETRY_AFTER_MS, nextIntentId, nextTryMs, nothingWasSent, openRefusals, openUnknowns, queueSend, resolveUnknown, retryNow, runSendOnce } from "../../../modules/messaging/send-once.ts";
import { recordMessageStatus } from "../../../modules/messaging/statuses.ts";
import { isGupshupSelfServe, mediaOf, parseWhatsAppStatuses, parseWhatsAppWebhook, selfServeAppName, signMeta, toE164, verifyMetaSignature } from "../../../modules/messaging/webhooks.ts";
import { standInMessaging } from "../../../modules/runtime/services.ts";
import { interactiveProblem, interactiveText } from "../../../modules/language/interactive.ts";
import { ApiError, ConflictError, NotSentError, TimeoutError, WindowClosedError } from "../../../modules/core/faults.ts";
import { classify } from "../../../modules/core/http.ts";
import { createRecord } from "../../../modules/record/record.ts";
import { messageFingerprint } from "../../../modules/record/fingerprint.ts";
import { recordCase, describeError } from "../lib/record.ts";
import type { Case, Scripted } from "../lib/record.ts";
import { fixture, guardNames as allGuardNames, guardReply, ok, status } from "./fixtures.ts";

/** Only the fixtures that ARE Guard's answers (a `guard` object): the file also holds plain provider replies, which are not errors. */
const guardNames = allGuardNames.filter((n) => typeof (guardReply(n).body as any)?.guard === "object");

const plain = <T>(v: T): any => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const HOUR = 3_600_000;
const T0 = 1_793_700_000_000; // a fixed "now": 2026-11-03T..Z, so nothing here reads a clock
const PHONE = "+919811111111";
const OWNER = "+919822222222";

// ====================================================================================================================================
// 1. the live clients, over HTTP
// ====================================================================================================================================

interface Step { op: string; args?: any[]; advanceMs?: number }
interface Setup {
  provider: "meta" | "gupshup" | "selfserve";
  nowMs?: number;
  windows?: Record<string, number>;
  steps: Step[];
  agentToken?: string; phoneNumberId?: string; appId?: string; appName?: string; sourceNumber?: string;
  baseSuffix?: string; closed?: boolean; timeoutMs?: number;
}

/** Run a script of steps on one client; each step's value or error is one element of the outcome. A missing method (Gupshup partner has no sticker) is {missing: true}. */
async function live(name: string, replies: Scripted[], setup: Setup): Promise<Case> {
  const config = { provider: setup.provider, nowMs: setup.nowMs ?? T0, windows: setup.windows ?? {}, steps: setup.steps, agentToken: setup.agentToken ?? "", phoneNumberId: setup.phoneNumberId ?? "106540352242922", appId: setup.appId ?? "", appName: setup.appName ?? "", sourceNumber: setup.sourceNumber ?? "", baseSuffix: setup.baseSuffix ?? "", closed: setup.closed ?? false, timeoutMs: setup.timeoutMs ?? 0 };
  return recordCase(name, replies, async (baseUrl) => {
    let now = config.nowMs;
    const deps = { clock: { now: () => now }, window: { lastInboundAt: (p: string) => config.windows[p] } };
    let client: any;
    try {
      client = createLiveMessaging({
        baseUrl, phoneNumberId: config.phoneNumberId, provider: setup.provider === "meta" ? undefined : setup.provider === "gupshup" ? "gupshup" : "gupshup-selfserve",
        ...(setup.appId !== undefined ? { appId: setup.appId } : {}), ...(setup.appName !== undefined ? { appName: setup.appName } : {}), ...(setup.sourceNumber !== undefined ? { sourceNumber: setup.sourceNumber } : {}),
        ...(setup.agentToken ? { agentToken: setup.agentToken } : {}), ...(setup.timeoutMs ? { timeoutMs: setup.timeoutMs } : {}),
      }, deps);
    } catch (e) { return [{ error: describeError(e) }]; }
    const out: unknown[] = [];
    for (const s of setup.steps) {
      now += s.advanceMs ?? 0;
      if (typeof client[s.op] !== "function") { out.push({ missing: true }); continue; }
      try { const r = await client[s.op](...(s.args ?? [])); out.push({ ok: r === undefined ? null : r }); } catch (e) { out.push({ error: describeError(e) }); }
    }
    return out;
  }, { baseSuffix: setup.baseSuffix, closed: setup.closed, config });
}

const IN = { [PHONE]: T0 - HOUR }; // this customer wrote an hour ago: the window is open
const metaReply = (id = "wamid.HBgLMTY0NjcwNDM1OTUVAgARGBI4MjZGRDA0OUE2OTQ3RkEyMzcA") => ok({ ...fixture("whatsapp-send-reply.json"), messages: [{ id }] });
const sendReply = () => ok(fixture("whatsapp-send-reply.json"));
const buttons = (n = 3, extra: any = {}) => ({ body: "Shall I book Haircut on Sat 21 Nov at 11:00?", buttons: Array.from({ length: n }, (_, i) => ({ id: `b${i + 1}`, title: ["Yes", "No", "Talk to the owner"][i] ?? `Option ${i}` })), ...extra });
const list = (n = 3, extra: any = {}) => ({ body: "Pick a time", list: { button: "Times", rows: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, title: `${9 + i}:00 am`, ...(i % 2 === 0 ? { description: `Slot ${i + 1}` } : {}) })) }, ...extra });
const tplEn = (extra: any = {}) => ({ name: "booking_confirmed", language: "en", text: "Your Haircut is booked for Sat 21 Nov at 11:00.", ...extra });

export async function liveCases(): Promise<Case[]> {
  const out: Case[] = [];
  const add = async (name: string, replies: Scripted[], setup: Setup) => { out.push(await live(name, replies, setup)); };
  const m = (steps: Step[], more: Partial<Setup> = {}): Setup => ({ provider: "meta", windows: IN, steps, ...more });
  const txt = (text = "Hello") => ({ op: "sendText", args: [PHONE, text] });

  // ---- Meta: text, the window and the bytes
  await add("meta text: in the window, with the agent token", [metaReply()], m([txt("Your booking is confirmed.")], { agentToken: "agent-token-1" }));
  await add("meta text: no token sends no Authorization", [metaReply()], m([txt()]));
  await add("meta text: bytes that JSON.stringify writes its own way", [metaReply()], m([txt("Cut & colour <deposit> é 日本     \"q\" \\ \t \u0007 😀 </script>")]));
  await add("meta text: outside the window nothing is sent", [], m([txt()], { windows: {} }));
  await add("meta text: a window that closed a millisecond ago (exactly 24 hours)", [], m([txt()], { windows: { [PHONE]: T0 - 24 * HOUR } }));
  await add("meta text: a window with a millisecond left", [metaReply()], m([txt()], { windows: { [PHONE]: T0 - 24 * HOUR + 1 } }));
  await add("meta text: the window closes between two sends", [metaReply("wamid.A"), ], m([txt("one"), { ...txt("two"), advanceMs: 24 * HOUR }], { windows: { [PHONE]: T0 - 1 } }));
  await add("meta text: the phone number id is escaped in the path", [metaReply()], m([txt()], { phoneNumberId: "12/3 4é" }));
  await add("meta text: a path prefix on the base URL", [metaReply()], m([txt()], { baseSuffix: "/whatsapp" }));
  await add("meta text: accepted with a message_status", [ok({ messages: [{ id: "wamid.Q", message_status: "held_for_quality_assessment" }] })], m([txt(), { op: "getMessage", args: ["wamid.Q"] }]));
  await add("meta text: message_status paused is refused", [ok({ messages: [{ id: "wamid.Q", message_status: "paused" }] })], m([txt()]));
  await add("meta text: an empty message_status is kept", [ok({ messages: [{ id: "wamid.Q", message_status: "" }] })], m([txt(), { op: "getMessage", args: ["wamid.Q"] }]));
  await add("meta text: no messages in the reply", [ok({ messaging_product: "whatsapp" })], m([txt()]));
  await add("meta text: an empty id", [ok({ messages: [{ id: "" }] })], m([txt()]));
  await add("meta text: the first object in messages is read", [ok({ messages: ["junk", 5, null, { id: "wamid.2" }, { id: "wamid.3" }] })], m([txt()]));
  await add("meta text: a reply that is not an object", [{ status: 200, text: "[1]" }], m([txt()]));
  await add("meta text: a 200 that is not JSON is a lost reply", [{ status: 200, text: "<html>" }], m([txt()]));
  await add("meta text: the reply has no body", [{ status: 200 }], m([txt()]));
  await add("meta text: 131047 is the closed window", [status(400, { error: { message: "Re-engagement message", type: "OAuthException", code: 131047, error_data: { messaging_product: "whatsapp", details: "Message failed to send because more than 24 hours have passed since the customer last replied to this number." }, fbtrace_id: "A1" } })], m([txt()]));
  await add("meta text: error_data.details wins over message", [status(400, { error: { message: "Bad", code: 100, error_data: { details: "The details." } } })], m([txt()]));
  await add("meta text: an empty details is kept (??)", [status(400, { error: { message: "Bad", code: 100, error_data: { details: "" } } })], m([txt()]));
  await add("meta text: an empty message is kept (??)", [status(400, { error: { message: "", code: 100 } })], m([txt()]));
  await add("meta text: a code that is not a whole number", [status(400, { error: { message: "Odd", code: 131047.5 } })], m([txt()]));
  await add("meta text: a code as a string is not a code", [status(400, { error: { message: "Strcode", code: "131047" } })], m([txt()]));
  await add("meta text: an error body that is not Meta's", [status(500, { oops: true })], m([txt()]));
  await add("meta text: a non-JSON error body", [{ status: 502, text: "Bad gateway" }], m([txt()]));
  await add("meta text: 429", [status(429, { error: { message: "Too many requests", code: 130429 } })], m([txt()]));
  await add("meta text: 132001 no such template", [status(404, { error: { message: "Template name does not exist in the translation", code: 132001 } })], m([txt()]));
  await add("meta text: 401", [status(401, { error: { message: "Invalid OAuth access token", code: 190 } })], m([txt()]));
  for (const n of guardNames) await add(`meta text: Guard answer ${n}`, [guardReply(n)], m([txt()]));
  await add("meta text: a reply that never comes", [{ hang: true }], m([txt()], { timeoutMs: 150 }));
  await add("meta text: a connection cut", [{ cut: true }], m([txt()]));
  await add("meta text: nothing listens", [], m([txt()], { closed: true }));
  await add("meta: a send is read back, and an unknown id is null", [metaReply("wamid.R")], m([txt(), { op: "getMessage", args: ["wamid.R"] }, { op: "getMessage", args: ["wamid.none"] }]));
  await add("meta: the same id twice keeps one copy (the later one)", [metaReply("wamid.S"), metaReply("wamid.S")], m([txt("first"), txt("second"), { op: "getMessage", args: ["wamid.S"] }]));
  await add("meta: isWindowOpen", [], m([{ op: "isWindowOpen", args: [PHONE] }, { op: "isWindowOpen", args: ["+910000000000"] }, { op: "isWindowOpen", args: [PHONE], advanceMs: 2 * 24 * HOUR }]));
  await add("meta: ping reads the number", [ok({ id: "106540352242922", verified_name: "Shop" })], m([{ op: "ping" }]));
  await add("meta: ping through a Guard that is busy", [guardReply("busy")], m([{ op: "ping" }]));
  await add("meta: ping, the number does not exist", [status(400, { error: { message: "Unsupported get request", code: 100 } })], m([{ op: "ping" }]));
  await add("meta: ping, with the token and a prefix", [ok({ id: "1" })], m([{ op: "ping" }], { agentToken: "tok", baseSuffix: "/w" }));

  // ---- Meta: templates (they may go outside the window)
  await add("meta template: no parameters, outside the window", [metaReply()], m([{ op: "sendTemplate", args: [PHONE, tplEn()] }], { windows: {} }));
  await add("meta template: body parameters, cleaned", [metaReply()], m([{ op: "sendTemplate", args: [PHONE, tplEn({ parameters: ["Sat 21 Nov", " 11:00\n am ", "Haircut\t\t& colour", "a b c", "", "x​y"] })] }]));
  await add("meta template: an image header and parameters", [metaReply()], m([{ op: "sendTemplate", args: [PHONE, tplEn({ parameters: ["A", "B"], headerImage: "https://example.com/a b.png" })] }]));
  await add("meta template: an image header and no parameters", [metaReply()], m([{ op: "sendTemplate", args: [PHONE, tplEn({ headerImage: "https://example.com/hero.png" })] }]));
  await add("meta template: the header is not https", [], m([{ op: "sendTemplate", args: [PHONE, tplEn({ headerImage: "http://example.com/hero.png" })] }]));
  await add("meta template: an empty header picture is refused", [], m([{ op: "sendTemplate", args: [PHONE, tplEn({ headerImage: "" })] }]));
  await add("meta template: Hindi, Malayalam and Kannada codes", [metaReply("a"), metaReply("b"), metaReply("c")], m([{ op: "sendTemplate", args: [PHONE, tplEn({ language: "hi", text: "नमस्ते" })] }, { op: "sendTemplate", args: [PHONE, tplEn({ language: "ml", text: "നമസ്കാരം" })] }, { op: "sendTemplate", args: [PHONE, tplEn({ language: "kn", text: "ನಮಸ್ಕಾರ" })] }]));
  await add("meta template: a language we do not have leaves the code out", [metaReply()], m([{ op: "sendTemplate", args: [PHONE, tplEn({ language: "xx" })] }]));
  await add("meta template: Meta says the template is not there", [status(404, { error: { message: "Template name does not exist in the translation", code: 132001 } })], m([{ op: "sendTemplate", args: [PHONE, tplEn()] }]));
  await add("meta template: read back with its header and name", [metaReply("wamid.T")], m([{ op: "sendTemplate", args: [PHONE, tplEn({ headerImage: "https://example.com/h.png", parameters: ["x"] })] }, { op: "getMessage", args: ["wamid.T"] }]));
  await add("meta template: outside the window Meta still refuses with 131047", [status(400, { error: { message: "Re-engagement", code: 131047 } })], m([{ op: "sendTemplate", args: [PHONE, tplEn()] }], { windows: {} }));

  // ---- Meta: buttons and lists
  await add("meta buttons: three", [metaReply()], m([{ op: "sendInteractive", args: [PHONE, buttons(3)] }]));
  await add("meta buttons: one", [metaReply()], m([{ op: "sendInteractive", args: [PHONE, buttons(1)] }]));
  await add("meta buttons: four are refused, nothing is sent", [], m([{ op: "sendInteractive", args: [PHONE, buttons(4)] }]));
  await add("meta buttons: none are refused", [], m([{ op: "sendInteractive", args: [PHONE, buttons(0)] }]));
  await add("meta buttons: outside the window", [], m([{ op: "sendInteractive", args: [PHONE, buttons(2)] }], { windows: {} }));
  await add("meta buttons: a title of 20 characters passes, 21 does not", [metaReply(), ], m([{ op: "sendInteractive", args: [PHONE, { body: "b", buttons: [{ id: "a", title: "12345678901234567890" }] }] }, { op: "sendInteractive", args: [PHONE, { body: "b", buttons: [{ id: "a", title: "123456789012345678901" }] }] }]));
  await add("meta buttons: titles count characters, not UTF-16 units", [metaReply()], m([{ op: "sendInteractive", args: [PHONE, { body: "b", buttons: [{ id: "a", title: "😀".repeat(20) }, { id: "b", title: "ക".repeat(20) }] }] }, { op: "sendInteractive", args: [PHONE, { body: "b", buttons: [{ id: "a", title: "😀".repeat(21) }] }] }]));
  await add("meta buttons: an empty or blank body, a body of 1024 and 1025", [metaReply()], m([{ op: "sendInteractive", args: [PHONE, { body: "", buttons: [{ id: "a", title: "A" }] }] }, { op: "sendInteractive", args: [PHONE, { body: "  \n", buttons: [{ id: "a", title: "A" }] }] }, { op: "sendInteractive", args: [PHONE, { body: "x".repeat(1024), buttons: [{ id: "a", title: "A" }] }] }, { op: "sendInteractive", args: [PHONE, { body: "x".repeat(1025), buttons: [{ id: "a", title: "A" }] }] }]));
  await add("meta buttons: neither buttons nor a list, and both", [], m([{ op: "sendInteractive", args: [PHONE, { body: "b" }] }, { op: "sendInteractive", args: [PHONE, { body: "b", buttons: [{ id: "a", title: "A" }], list: { button: "L", rows: [{ id: "r", title: "R" }] } }] }]));
  await add("meta buttons: a duplicate id, an empty id, a long id, a blank title, a description", [], m([
    { op: "sendInteractive", args: [PHONE, { body: "b", buttons: [{ id: "a", title: "A" }, { id: "a", title: "B" }] }] },
    { op: "sendInteractive", args: [PHONE, { body: "b", buttons: [{ id: "", title: "A" }] }] },
    { op: "sendInteractive", args: [PHONE, { body: "b", buttons: [{ id: "x".repeat(201), title: "A" }] }] },
    { op: "sendInteractive", args: [PHONE, { body: "b", buttons: [{ id: "a", title: "  " }] }] },
    { op: "sendInteractive", args: [PHONE, { body: "b", buttons: [{ id: "a", title: "A", description: "d" }] }] },
  ]));
  await add("meta list: three rows, some with descriptions", [metaReply()], m([{ op: "sendInteractive", args: [PHONE, list(3)] }]));
  await add("meta list: ten rows pass, eleven do not", [metaReply()], m([{ op: "sendInteractive", args: [PHONE, list(10)] }, { op: "sendInteractive", args: [PHONE, list(11)] }, { op: "sendInteractive", args: [PHONE, list(0)] }]));
  await add("meta list: row title 24, description 72, button 20 and over", [metaReply(), metaReply("x2")], m([
    { op: "sendInteractive", args: [PHONE, { body: "b", list: { button: "B".repeat(20), rows: [{ id: "r", title: "T".repeat(24), description: "D".repeat(72) }] } }] },
    { op: "sendInteractive", args: [PHONE, { body: "b", list: { button: "B".repeat(21), rows: [{ id: "r", title: "T" }] } }] },
    { op: "sendInteractive", args: [PHONE, { body: "b", list: { button: "B", rows: [{ id: "r", title: "T".repeat(25) }] } }] },
    { op: "sendInteractive", args: [PHONE, { body: "b", list: { button: "B", rows: [{ id: "r", title: "T", description: "D".repeat(73) }] } }] },
    { op: "sendInteractive", args: [PHONE, { body: "b", list: { button: "B", rows: [{ id: "r", title: "T", description: "" }] } }] },
    { op: "sendInteractive", args: [PHONE, { body: "b", list: { button: " ", rows: [{ id: "r", title: "T" }] } }] },
  ]));
  await add("meta interactive: read back with its text", [metaReply("wamid.I")], m([{ op: "sendInteractive", args: [PHONE, list(3)] }, { op: "getMessage", args: ["wamid.I"] }]));
  await add("meta interactive: Meta refuses", [status(400, { error: { message: "Interactive not allowed", code: 131009 } })], m([{ op: "sendInteractive", args: [PHONE, buttons(2)] }]));

  // ---- Meta: documents, pictures, stickers
  const doc = (extra: any = {}) => ({ link: "https://example.com/invoice.pdf", filename: "Invoice 12.pdf", ...extra });
  await add("meta document: with a caption, and without", [metaReply("d1"), metaReply("d2")], m([{ op: "sendDocument", args: [PHONE, doc({ caption: "Your invoice" })] }, { op: "sendDocument", args: [PHONE, doc()] }]));
  await add("meta document: refused links, names and captions", [], m([
    { op: "sendDocument", args: [PHONE, doc({ link: "http://example.com/a.pdf" })] },
    { op: "sendDocument", args: [PHONE, doc({ link: "https://example.com/a b.pdf" })] },
    { op: "sendDocument", args: [PHONE, doc({ link: "https://" })] },
    { op: "sendDocument", args: [PHONE, doc({ filename: "  " })] },
    { op: "sendDocument", args: [PHONE, doc({ filename: "a/b.pdf" })] },
    { op: "sendDocument", args: [PHONE, doc({ filename: "a\\b.pdf" })] },
    { op: "sendDocument", args: [PHONE, doc({ filename: "a\nb.pdf" })] },
    { op: "sendDocument", args: [PHONE, doc({ filename: "x".repeat(241) })] },
    { op: "sendDocument", args: [PHONE, doc({ filename: "😀".repeat(121) })] },
    { op: "sendDocument", args: [PHONE, doc({ caption: "" })] },
    { op: "sendDocument", args: [PHONE, doc({ caption: " \t" })] },
    { op: "sendDocument", args: [PHONE, doc({ caption: "c".repeat(1025) })] },
    { op: "sendDocument", args: [PHONE, doc({ caption: "😀".repeat(513) })] },
  ]));
  await add("meta document: limits that pass", [metaReply("d1"), metaReply("d2"), metaReply("d3")], m([
    { op: "sendDocument", args: [PHONE, doc({ filename: "x".repeat(240) })] },
    { op: "sendDocument", args: [PHONE, doc({ filename: "😀".repeat(120) })] },
    { op: "sendDocument", args: [PHONE, doc({ caption: "c".repeat(1024) })] },
  ]));
  await add("meta document: outside the window", [], m([{ op: "sendDocument", args: [PHONE, doc()] }], { windows: {} }));
  await add("meta image: with a caption, and without", [metaReply("i1"), metaReply("i2")], m([{ op: "sendImage", args: [PHONE, { link: "https://example.com/qr.png", caption: "Scan to pay Rs 600" }] }, { op: "sendImage", args: [PHONE, { link: "https://example.com/qr.png" }] }, { op: "getMessage", args: ["i1"] }]));
  await add("meta image: refused", [], m([{ op: "sendImage", args: [PHONE, { link: "ftp://example.com/qr.png" }] }, { op: "sendImage", args: [PHONE, { link: "https://example.com/qr.png", caption: "" }] }, { op: "sendImage", args: [PHONE, { link: "https://example.com/q r.png" }] }]));
  await add("meta image: outside the window", [], m([{ op: "sendImage", args: [PHONE, { link: "https://example.com/qr.png" }] }], { windows: {} }));
  await add("meta sticker: a webp link", [metaReply("s1"), metaReply("s2")], m([{ op: "sendSticker", args: [PHONE, { link: "https://example.com/happy.webp" }] }, { op: "sendSticker", args: [PHONE, { link: "https://example.com/happy.webp?v=2" }] }]));
  await add("meta sticker: refused links", [], m([{ op: "sendSticker", args: [PHONE, { link: "https://example.com/happy.png" }] }, { op: "sendSticker", args: [PHONE, { link: "https://example.com/happy.webp#x" }] }, { op: "sendSticker", args: [PHONE, { link: "https://example.com/hap py.webp" }] }, { op: "sendSticker", args: [PHONE, { link: "http://example.com/happy.webp" }] }, { op: "sendSticker", args: [PHONE, { link: "https://example.com/happy.webp?a b" }] }, { op: "sendSticker", args: [PHONE, { link: "https://?.webp" }] }]));
  await add("meta sticker: outside the window", [], m([{ op: "sendSticker", args: [PHONE, { link: "https://example.com/happy.webp" }] }], { windows: {} }));

  // ---- Gupshup partner pass-through
  const g = (steps: Step[], more: Partial<Setup> = {}): Setup => ({ provider: "gupshup", appId: "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8", windows: IN, steps, ...more });
  await add("gupshup: text goes to the v3 message path with Meta's body", [metaReply("gs-1")], g([txt("Hi")], { agentToken: "tok" }));
  await add("gupshup: template, buttons, list, document and image use Meta's bodies", [metaReply("g1"), metaReply("g2"), metaReply("g3"), metaReply("g4"), metaReply("g5")], g([{ op: "sendTemplate", args: [PHONE, tplEn({ parameters: ["a"], headerImage: "https://example.com/h.png" })] }, { op: "sendInteractive", args: [PHONE, buttons(2)] }, { op: "sendInteractive", args: [PHONE, list(2)] }, { op: "sendDocument", args: [PHONE, doc({ caption: "c" })] }, { op: "sendImage", args: [PHONE, { link: "https://example.com/qr.png", caption: "q" }] }]));
  await add("gupshup: it has no sticker", [], g([{ op: "sendSticker", args: [PHONE, { link: "https://example.com/happy.webp" }] }]));
  await add("gupshup: a window closed", [], g([txt()], { windows: {} }));
  await add("gupshup: ping reads the app health", [ok({ status: "success", healthy: "true" })], g([{ op: "ping" }]));
  await add("gupshup: the app id is escaped in the path", [metaReply("x")], g([txt()], { appId: "app-id-with-hyphens-1234" }));
  await add("gupshup: the app id is checked", [], g([txt()], { appId: "short" }));
  await add("gupshup: an app id with a slash is refused", [], g([txt()], { appId: "abcdefgh/../x" }));
  await add("gupshup: its own error shape", [status(401, { status: "error", message: "Authentication Failed" })], g([txt()]));
  await add("gupshup: a 400 with a message", [status(400, { status: "error", message: "Callback Billing must be enabled for this API" })], g([txt()]));
  await add("gupshup: an error with no message", [status(500, { status: "error" })], g([txt()]));
  await add("gupshup: an empty message reads as none", [status(500, { status: "error", message: "" })], g([txt()]));
  await add("gupshup: a message that is not a string", [status(500, { status: "error", message: 5 })], g([txt()]));
  await add("gupshup: a code of 131047 in its own shape is the closed window", [status(400, { status: "error", message: "Window", code: 131047 })], g([txt()]));
  await add("gupshup: Meta's error shape passed on keeps Meta's words and code", [status(400, { error: { message: "Re-engagement", code: 131047 } })], g([txt()]));
  await add("gupshup: Meta's shape with details", [status(400, { error: { message: "m", code: 1, error_data: { details: "Details here" } } })], g([txt()]));
  await add("gupshup: a body that is not an object", [status(500, [1, 2])], g([txt()]));
  await add("gupshup: Guard is busy, and the licence is suspended", [guardReply("busy"), guardReply("suspended")], g([txt(), txt()]));
  await add("gupshup: read back by the Gupshup id", [metaReply("GUPSHUP-ID-1")], g([txt(), { op: "getMessage", args: ["GUPSHUP-ID-1"] }]));

  // ---- Gupshup self-serve
  const SS = { provider: "selfserve" as const, appName: "GeometerShop", sourceNumber: "919876543210" };
  const s = (steps: Step[], more: Partial<Setup> = {}): Setup => ({ ...SS, windows: IN, steps, ...more });
  const submitted = (id = "ee4ac4a4-0001") => ok({ status: "submitted", messageId: id });
  const templates = (items: any[] = []) => ok({ status: "success", templates: items });
  const tpl = (over: any = {}) => ({ id: "tpl-id-1", elementName: "booking_confirmed", languageCode: "en", status: "APPROVED", templateType: "TEXT", data: "x", category: "UTILITY", ...over });
  await add("selfserve text: a form with the app and the number", [submitted()], s([txt("Hello")], { agentToken: "tok" }));
  await add("selfserve text: the destination loses its plus, spaces and dashes, the source its plus", [submitted()], s([{ op: "sendText", args: ["+91 98111-11111", "Hi"] }], { sourceNumber: "+919876543210", windows: { "+91 98111-11111": T0 - 1 } }));
  await add("selfserve text: awkward bytes in the message", [submitted()], s([txt("Cut & colour <deposit> é 日本   \"q\" \\ + % = ; 😀")]));
  await add("selfserve text: outside the window", [], s([txt()], { windows: {} }));
  await add("selfserve text: read back", [submitted("m-9")], s([txt(), { op: "getMessage", args: ["m-9"] }, { op: "getMessage", args: ["nope"] }]));
  await add("selfserve text: 200 with status error", [ok({ status: "error", message: "Invalid Destination" })], s([txt()]));
  await add("selfserve text: 200 with status error and no words", [ok({ status: "error" })], s([txt()]));
  await add("selfserve text: 400 invalid app details", [status(400, { status: "error", message: "Invalid App Details" })], s([txt()]));
  await add("selfserve text: 401", [status(401, { status: "error", message: "Authentication Failed" })], s([txt()]));
  await add("selfserve text: 429", [status(429, { status: "error", message: "Too many requests" })], s([txt()]));
  await add("selfserve text: 500 with no body", [{ status: 500 }], s([txt()]));
  await add("selfserve text: no messageId", [ok({ status: "submitted" })], s([txt()]));
  await add("selfserve text: a body that is not an object", [{ status: 200, text: "[1]" }], s([txt()]));
  await add("selfserve text: no body at all", [{ status: 200 }], s([txt()]));
  await add("selfserve text: a messageId that is a number", [ok({ status: "submitted", messageId: 123 })], s([txt()]));
  for (const n of guardNames) await add(`selfserve text: Guard answer ${n}`, [guardReply(n)], s([txt()]));
  await add("selfserve text: no reply", [{ hang: true }], s([txt()], { timeoutMs: 150 }));
  await add("selfserve text: nothing listens", [], s([txt()], { closed: true }));
  await add("selfserve buttons: quick_reply, ids as postbackText, msgid counts up", [submitted("q1"), submitted("q2")], s([{ op: "sendInteractive", args: [PHONE, buttons(3)] }, { op: "sendInteractive", args: [PHONE, buttons(1)], advanceMs: 1234567 }]));
  await add("selfserve list: the button label is the header, a row without a description repeats its title", [submitted("l1")], s([{ op: "sendInteractive", args: [PHONE, list(3)] }]));
  await add("selfserve interactive: a refused message does not use up a msgid", [submitted("a"), submitted("b")], s([{ op: "sendInteractive", args: [PHONE, buttons(1)] }, { op: "sendInteractive", args: [PHONE, buttons(4)] }, { op: "sendInteractive", args: [PHONE, buttons(1)] }]));
  await add("selfserve interactive: a window that is closed does not use one up either", [submitted("a")], s([{ op: "sendInteractive", args: ["+910000000000", buttons(1)] }, { op: "sendInteractive", args: [PHONE, buttons(1)] }]));
  await add("selfserve interactive: a failed post still used its msgid", [status(500, { status: "error", message: "x" }), submitted("b")], s([{ op: "sendInteractive", args: [PHONE, buttons(1)] }, { op: "sendInteractive", args: [PHONE, buttons(1)] }]));
  await add("selfserve document: file with and without a caption", [submitted("f1"), submitted("f2")], s([{ op: "sendDocument", args: [PHONE, doc({ caption: "Your invoice" })] }, { op: "sendDocument", args: [PHONE, doc()] }]));
  await add("selfserve document: a refused link", [], s([{ op: "sendDocument", args: [PHONE, doc({ link: "http://x.com/a.pdf" })] }]));
  await add("selfserve image: originalUrl and previewUrl", [submitted("i1"), submitted("i2")], s([{ op: "sendImage", args: [PHONE, { link: "https://example.com/qr.png", caption: "Pay" }] }, { op: "sendImage", args: [PHONE, { link: "https://example.com/qr.png" }] }]));
  await add("selfserve sticker: by url", [submitted("st")], s([{ op: "sendSticker", args: [PHONE, { link: "https://example.com/happy.webp" }] }]));
  await add("selfserve sticker: refused", [], s([{ op: "sendSticker", args: [PHONE, { link: "https://example.com/happy.gif" }] }]));
  // templates: Gupshup's own id, from the app's list
  await add("selfserve template: the list is read by name, then the send names Gupshup's id", [templates([tpl()]), submitted("t1")], s([{ op: "sendTemplate", args: [PHONE, tplEn({ parameters: ["Sat", " 11:00 "] })] }], { windows: {} }));
  await add("selfserve template: the list is read by id with pageSize 100", [templates([tpl()]), submitted("t1")], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }], { appId: "0123abcd-1111-2222-3333-444455556666" }));
  await add("selfserve template: the list is cached, so the second send does not read it", [templates([tpl()]), submitted("t1"), submitted("t2")], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }, { op: "sendTemplate", args: [PHONE, tplEn()], advanceMs: 5 * 60_000 }]));
  await add("selfserve template: an image header adds a message field", [templates([tpl()]), submitted("t1")], s([{ op: "sendTemplate", args: [PHONE, tplEn({ headerImage: "https://example.com/h.png", parameters: ["a"] })] }]));
  await add("selfserve template: the header must be https, and nothing is read", [], s([{ op: "sendTemplate", args: [PHONE, tplEn({ headerImage: "http://example.com/h.png" })] }]));
  await add("selfserve template: not in the app", [templates([tpl({ elementName: "other" })])], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }]));
  await add("selfserve template: not approved yet", [templates([tpl({ status: "PENDING" })])], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }]));
  await add("selfserve template: a status in lower case is read as upper case", [templates([tpl({ status: "approved" })]), submitted("t1")], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }]));
  await add("selfserve template: a status that upper-cases to more letters (full case mapping)", [templates([tpl({ status: "straße" })])], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }]));
  await add("selfserve template: a status that is missing is UNKNOWN", [templates([tpl({ status: undefined })])], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }]));
  await add("selfserve template: a status of the wrong type is UNKNOWN", [templates([tpl({ status: 5 })])], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }]));
  await add("selfserve template: a refresh is not repeated inside 30 seconds, and is after", [templates([]), templates([tpl()]), submitted("t1")], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }, { op: "sendTemplate", args: [PHONE, tplEn()], advanceMs: 29_999 }, { op: "sendTemplate", args: [PHONE, tplEn()], advanceMs: 1 }]));
  await add("selfserve template: a pending one is looked at again after 30 seconds and goes", [templates([tpl({ status: "PENDING" })]), templates([tpl()]), submitted("t1")], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }, { op: "sendTemplate", args: [PHONE, tplEn()], advanceMs: 30_000 }]));
  await add("selfserve template: en_US is found for en by its first part", [templates([tpl({ languageCode: "en_US", id: "us-id" }), tpl({ languageCode: "en_GB", id: "gb-id" })]), submitted("t1")], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }]));
  await add("selfserve template: the exact code wins over a longer one, whatever the order", [templates([tpl({ languageCode: "en_US", id: "us-id" }), tpl({ languageCode: "en", id: "plain-id" })]), submitted("t1")], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }]));
  await add("selfserve template: the same key twice keeps its first place, with the later value", [templates([tpl({ languageCode: "en_US", id: "first-us" }), tpl({ languageCode: "en_GB", id: "gb" }), tpl({ languageCode: "en_US", id: "second-us" })]), submitted("t1")], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }]));
  await add("selfserve template: entries missing an id, a name or a code are skipped", [templates([tpl({ id: "" }), tpl({ elementName: undefined }), tpl({ languageCode: "" }), "junk", null, tpl({ id: "good" })]), submitted("t1")], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }]));
  await add("selfserve template: a list that is not an object", [{ status: 200, text: "[1]" }], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }]));
  await add("selfserve template: the list read is refused (401)", [status(401, { status: "error", message: "Authentication Failed" })], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }]));
  await add("selfserve template: the list read through a Guard that is busy", [guardReply("busy")], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }]));
  await add("selfserve template: a language we do not have reads as undefined", [templates([])], s([{ op: "sendTemplate", args: [PHONE, tplEn({ language: "xx" })] }]));
  await add("selfserve template: the app name is escaped in the list path", [templates([tpl()]), submitted("t1")], s([{ op: "sendTemplate", args: [PHONE, tplEn()] }], { appName: "Shop_Name_2" }));
  await add("selfserve template: Gupshup refuses the send", [templates([tpl()]), status(400, { status: "error", message: "Template Params doesn't match" })], s([{ op: "sendTemplate", args: [PHONE, tplEn({ parameters: ["a"] })] }]));
  await add("selfserve template: read back with its name and language", [templates([tpl()]), submitted("t9")], s([{ op: "sendTemplate", args: [PHONE, tplEn({ parameters: ["a"] })] }, { op: "getMessage", args: ["t9"] }]));
  await add("selfserve: ping by name", [templates([])], s([{ op: "ping" }]));
  await add("selfserve: ping by id asks for one", [templates([])], s([{ op: "ping" }], { appId: "0123abcd-1111-2222-3333-444455556666", agentToken: "t" }));
  await add("selfserve: ping through a Guard that is busy", [guardReply("busy")], s([{ op: "ping" }]));
  await add("selfserve: isWindowOpen", [], s([{ op: "isWindowOpen", args: [PHONE] }, { op: "isWindowOpen", args: [PHONE], advanceMs: 24 * HOUR }]));
  await add("selfserve: a bad app name is refused", [], s([txt()], { appName: "a" }));
  await add("selfserve: an app name with a slash is refused", [], s([txt()], { appName: "a/b" }));
  await add("selfserve: a bad source number is refused", [], s([txt()], { sourceNumber: "12ab" }));
  await add("selfserve: a short source number is refused", [], s([txt()], { sourceNumber: "12345" }));
  await add("selfserve: a bad app id is refused", [], s([txt()], { appId: "x" }));
  // provider config problems that stop construction
  await add("provider: gupshup with no app id", [], { provider: "gupshup", windows: IN, steps: [txt()], appId: undefined as any });
  await add("provider: self-serve with no app name", [], { provider: "selfserve", windows: IN, steps: [txt()], sourceNumber: "919876543210" });
  return out;
}

// ====================================================================================================================================
// 2. pure checks: documents, pictures, buttons, the provider config, the bound on the sent copy
// ====================================================================================================================================

function misc(): unknown {
  const links = ["https://example.com/a.pdf", "http://example.com", "https://", "https://x y", "https://x\ny", "https://x y", "https://x y", "https://x﻿y", "", "https://é.example/ü", "HTTPS://example.com/a", " https://example.com/a", "https://example.com/a "];
  const docs = [...links.map((link) => ({ link, filename: "a.pdf" })), ...["", "  ", " ", "a.pdf", "a/b", "a\\b", "a\nb", "a\rb", "a\tb", "x".repeat(240), "x".repeat(241), "😀".repeat(120), "😀".repeat(121), "日".repeat(240)].map((filename) => ({ link: "https://example.com/a.pdf", filename })),
    ...[undefined, "", " ", "x", "x".repeat(1024), "x".repeat(1025), "😀".repeat(512), "😀".repeat(513), " "].map((caption) => ({ link: "https://example.com/a.pdf", filename: "a.pdf", ...(caption !== undefined ? { caption } : {}) }))];
  const images = [...links.map((link) => ({ link })), ...[undefined, "", " ", "x", "x".repeat(1025)].map((caption) => ({ link: "https://example.com/a.png", ...(caption !== undefined ? { caption } : {}) }))];
  const stickers = ["https://example.com/a.webp", "https://example.com/a.webp?x=1", "https://example.com/a.WEBP", "https://example.com/a.webp#f", "https://example.com/a.webp?x#f", "https://example.com/.webp", "https://.webp", "https://example.com/a.webp?", "https://example.com/a.webp?a b", "https://exa mple.com/a.webp", "http://example.com/a.webp", "https://example.com/a.webpx", "https://example.com/a?b.webp", "https://example.com/a.png"].map((link) => ({ link }));
  const inter: any[] = [buttons(1), buttons(3), buttons(4), buttons(0), list(1), list(10), list(11), list(0), { body: "b" }, { body: "" }, { body: "b", buttons: [] }, { body: "b", list: { button: "L", rows: [] } },
    { body: "b", buttons: [{ id: "a", title: "A" }, { id: "a", title: "B" }] }, { body: "b", buttons: [{ id: "a", title: "A" }], list: { button: "L", rows: [{ id: "r", title: "R" }] } },
    { body: "b", list: { button: "L", rows: [{ id: "a", title: "A" }, { id: "a", title: "B" }] } },
    { body: "b", list: { button: "L", rows: [{ id: "r", title: "T", description: "" }] } },
    { body: "b", list: { button: "L", rows: [{ id: "r", title: "T", description: "D" }, { id: "s", title: "U" }] } },
    { body: "😀".repeat(1024), buttons: [{ id: "a", title: "A" }] }, { body: "😀".repeat(1025), buttons: [{ id: "a", title: "A" }] },
    { body: "b", buttons: [{ id: "😀".repeat(200), title: "A" }] }, { body: "b", buttons: [{ id: "😀".repeat(201), title: "A" }] },
    { body: "b", buttons: [{ id: "a", title: "ക്ക".repeat(10) }] }, { body: "b", buttons: [{ id: "a", title: "é".repeat(10) }, { id: "b", title: "é".repeat(11) }] },
    { body: "b", buttons: [{ id: "a", title: "A", description: "" }] }];
  const configs: any[] = [{}, { provider: "meta" }, { provider: "gupshup" }, { provider: "gupshup", appId: "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8" }, { provider: "gupshup", appId: "short" }, { provider: "gupshup", appId: 5 },
    { provider: "gupshup", appId: "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8", appName: "x" }, { provider: "gupshup", appId: "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8", sourceNumber: "919876543210" },
    { provider: "gupshup-selfserve" }, { provider: "gupshup-selfserve", appName: "Shop_1" }, { provider: "gupshup-selfserve", appName: "Shop_1", sourceNumber: "+919876543210" }, { provider: "gupshup-selfserve", appName: "Shop 1", sourceNumber: "919876543210" },
    { provider: "gupshup-selfserve", appName: "Shop_1", sourceNumber: "919876543210", appId: "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8" }, { provider: "gupshup-selfserve", appName: "Shop_1", sourceNumber: "919876543210", appId: "x" },
    { provider: "gupshup-selfserve", appName: "Shop_1", sourceNumber: "919876543210", appId: null }, { provider: "gupshup-selfserve", appName: 5, sourceNumber: "919876543210" }, { provider: "gupshup-selfserve", appName: "Shop_1", sourceNumber: 919876543210 },
    { provider: "gupshup-selfserve", appName: "Shop_1", sourceNumber: "1234567890123456" }, { provider: "gupshup-selfserve", appName: "a".repeat(65), sourceNumber: "919876543210" }, { provider: "gupshup-selfserve", appName: "ab", sourceNumber: "123456" },
    { provider: "meta", appId: "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8" }, { provider: "meta", appName: "x" }, { appId: "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8" }, { sourceNumber: "919876543210" }, { provider: "other" }, { provider: null }, { provider: 5 }, { provider: "Meta" },
    { appId: null }, { appName: null }];
  const params = ["", " ", "a  b", "a\nb\tc", "  lead and trail  ", "a b", "a b", "a﻿b", "a​b", "a b", "\u0085x", "x᠎", "a　b", "日本  語"];
  const meta = [{ status: 400, body: { error: { message: "m", code: 1, error_data: { details: "d" } } } }, { status: 400, body: { error: { code: 1 } } }, { status: 500, body: {} }, { status: 500, body: null }, { status: 500, body: "text" }, { status: 400, body: { error: "string" } }, { status: 400, body: { error: { message: 5, error_data: { details: 6 } } } }, { status: 400, body: { error: { error_data: "x", message: "m" } } }];
  return {
    documents: docs.map((d) => ({ in: d, out: documentProblem(d) })), images: images.map((d) => ({ in: d, out: imageProblem(d) })), stickers: stickers.map((d) => ({ in: d, out: stickerProblem(d) })),
    interactive: inter.map((d) => ({ in: d, text: interactiveText(d), problem: interactiveProblem(d) })),
    configs: configs.map((c) => ({ in: c, out: messagingConfigProblem(c) })),
    parameters: params.map((p) => ({ in: p, out: cleanParameter(p) })),
    metaErrors: meta.map((r) => ({ in: r, out: plain(describeMetaError(r)) })),
  };
}

/** The sent copy keeps 1000 messages: 1001 sends (against a stand-in Http with no network) leave the first one gone and the second there. */
async function eviction(): Promise<unknown> {
  let n = 0; let now = T0;
  const http = { request: async () => ({ status: 200, body: { messages: [{ id: `wamid.${++n}` }] } }) };
  const client: any = createCloudApiMessaging(http as any, { name: "WhatsApp", sendPath: "/x", pingPath: "/x", describeError: describeMetaError }, { clock: { now: () => now }, window: { lastInboundAt: () => T0 } });
  for (let i = 0; i < 1001; i++) await client.sendText(PHONE, `m${i}`);
  const got = async (id: string) => plain(await client.getMessage(id));
  return { sends: 1001, first: await got("wamid.1"), second: await got("wamid.2") && "present", last: await got("wamid.1001") && "present" };
}

// ====================================================================================================================================
// 3. the fake and the stand-in
// ====================================================================================================================================

function errSpec(e: any): unknown { return describeError(e); }

async function fakeScenario(name: string, steps: any[], opts: { standIn?: string[] } = {}): Promise<unknown> {
  let now = T0;
  const clock = { now: () => now };
  const said: string[] = [];
  const fake: any = opts.standIn ? standInMessaging(clock, opts.standIn, (l) => said.push(l)) : createFakeMessaging(clock);
  const results: unknown[] = [];
  for (const s of steps) {
    if (s.advanceMs) now += s.advanceMs;
    const before = said.length;
    try {
      let r: unknown;
      switch (s.op) {
        case "advance": r = null; break;
        case "receive": r = fake.receive(s.from, s.text, s.options); break;
        case "approve": fake.approve(s.name, s.language); r = null; break;
        case "inject": fake.inject(s.opName, s.mode, s.options); r = null; break;
        case "outbox": r = fake.outbox(); break;
        case "sentTo": r = fake.sentTo(s.number); break;
        case "isOptedOut": r = fake.isOptedOut(s.number); break;
        case "has": r = typeof fake[s.method] === "function"; break;
        default: r = await fake[s.op](...(s.args ?? []));
      }
      results.push({ ok: plain(r), said: said.slice(before) });
    } catch (e) { results.push({ error: plain(describeError(e)), said: said.slice(before) }); }
  }
  return { name, standIn: opts.standIn ?? null, nowMs: T0, steps, results };
}

async function fakes(): Promise<unknown[]> {
  const out: unknown[] = [];
  const tpl = { name: "booking_confirmed", language: "en", text: "Booked." };
  const send = (op: string, ...args: any[]) => ({ op, args });
  out.push(await fakeScenario("a message before the person wrote is a closed window", [send("sendText", PHONE, "hi"), send("isWindowOpen", PHONE)]));
  out.push(await fakeScenario("the window opens when they write and is strict at 24 hours", [
    { op: "receive", from: PHONE, text: "hello" }, send("sendText", PHONE, "one"), send("isWindowOpen", PHONE), { op: "advance", advanceMs: 24 * HOUR - 1 }, send("isWindowOpen", PHONE), { op: "advance", advanceMs: 1 }, send("isWindowOpen", PHONE), send("sendText", PHONE, "late"),
  ]));
  out.push(await fakeScenario("ids count up and a copy is read back", [
    { op: "receive", from: PHONE, text: "a" }, { op: "receive", from: PHONE, text: "b" }, { op: "receive", from: PHONE, text: "c", options: { id: "wamid.mine" } }, { op: "receive", from: PHONE, text: "d" },
    send("sendText", PHONE, "x"), send("sendText", PHONE, "y"), send("getMessage", "wamid.out_1"), send("getMessage", "wamid.out_2"), send("getMessage", "wamid.out_3"), { op: "outbox" }, { op: "sentTo", number: PHONE }, { op: "sentTo", number: "+910" },
  ]));
  out.push(await fakeScenario("STOP, in any case, with spaces, and by its ligature", [
    { op: "receive", from: PHONE, text: "stop" }, { op: "isOptedOut", number: PHONE }, send("sendText", PHONE, "after"), { op: "receive", from: OWNER, text: " Stop\n" }, { op: "isOptedOut", number: OWNER },
    { op: "receive", from: "+911", text: "ﬆop" }, { op: "isOptedOut", number: "+911" }, { op: "receive", from: "+912", text: "ſtop" }, { op: "isOptedOut", number: "+912" }, { op: "receive", from: "+913", text: "STOP please" }, { op: "isOptedOut", number: "+913" }, { op: "receive", from: "+914", text: "\u00a0sToP\n" }, { op: "isOptedOut", number: "+914" }, { op: "receive", from: "+915", text: "ＳＴＯＰ" }, { op: "isOptedOut", number: "+915" },
    { op: "receive", from: "+914", text: " STOP " }, { op: "isOptedOut", number: "+914" }, { op: "receive", from: "+915", text: "stoP​" }, { op: "isOptedOut", number: "+915" },
    send("sendTemplate", PHONE, tpl), { op: "approve", name: "booking_confirmed", language: "en" }, send("sendTemplate", PHONE, tpl), { op: "outbox" },
  ]));
  out.push(await fakeScenario("receive options: a button reply, a picture, a voice note with media", [
    { op: "receive", from: PHONE, text: "Yes", options: { reply: { id: "yes", kind: "button" } } }, { op: "receive", from: PHONE, text: "", options: { image: true } }, { op: "receive", from: PHONE, text: "", options: { voiceNote: true, media: { id: "m1", mime: "audio/ogg" } } },
    { op: "receive", from: PHONE, text: "x", options: { image: false, voiceNote: false } },
  ]));
  out.push(await fakeScenario("templates: only approved ones, in their language, with a header picture check", [
    send("sendTemplate", PHONE, tpl), { op: "approve", name: "booking_confirmed", language: "en" }, send("sendTemplate", PHONE, tpl), send("sendTemplate", PHONE, { ...tpl, language: "hi" }),
    send("sendTemplate", PHONE, { ...tpl, headerImage: "https://example.com/h.png" }), send("sendTemplate", PHONE, { ...tpl, headerImage: "http://example.com/h.png" }), send("sendTemplate", PHONE, { ...tpl, headerImage: "" }), { op: "outbox" },
  ]));
  out.push(await fakeScenario("every kind goes through its own check and keeps a copy", [
    { op: "receive", from: PHONE, text: "hi" },
    send("sendInteractive", PHONE, buttons(2)), send("sendInteractive", PHONE, list(2)), send("sendInteractive", PHONE, buttons(9)),
    send("sendDocument", PHONE, { link: "https://example.com/a.pdf", filename: "a.pdf", caption: "c" }), send("sendDocument", PHONE, { link: "https://example.com/a.pdf", filename: "a.pdf" }), send("sendDocument", PHONE, { link: "http://example.com/a.pdf", filename: "a.pdf" }),
    send("sendImage", PHONE, { link: "https://example.com/a.png", caption: "q" }), send("sendImage", PHONE, { link: "https://example.com/a.png" }), send("sendImage", PHONE, { link: "x" }),
    send("sendSticker", PHONE, { link: "https://example.com/a.webp" }), send("sendSticker", PHONE, { link: "https://example.com/a.png" }), { op: "outbox" },
  ]));
  out.push(await fakeScenario("every kind refuses outside the window", [send("sendInteractive", PHONE, buttons(2)), send("sendDocument", PHONE, { link: "https://example.com/a.pdf", filename: "a.pdf" }), send("sendImage", PHONE, { link: "https://example.com/a.png" }), send("sendSticker", PHONE, { link: "https://example.com/a.webp" })]));
  out.push(await fakeScenario("faults: error and lostReply, once, twice, after one, per operation", [
    { op: "receive", from: PHONE, text: "hi" }, { op: "inject", opName: "sendText", mode: "error" }, send("sendText", PHONE, "1"), send("sendText", PHONE, "2"),
    { op: "inject", opName: "sendText", mode: "lostReply" }, send("sendText", PHONE, "3"), send("sendText", PHONE, "4"), { op: "outbox" },
    { op: "inject", opName: "sendText", mode: "error", options: { times: 2 } }, send("sendText", PHONE, "5"), send("sendText", PHONE, "6"), send("sendText", PHONE, "7"),
    { op: "inject", opName: "sendText", mode: "error", options: { after: 1 } }, send("sendText", PHONE, "8"), send("sendText", PHONE, "9"), send("sendText", PHONE, "10"),
    { op: "inject", opName: "sendText", mode: "error", options: { after: 1, times: 2 } }, { op: "inject", opName: "sendText", mode: "lostReply" }, send("sendText", PHONE, "11"), send("sendText", PHONE, "12"), send("sendText", PHONE, "13"), send("sendText", PHONE, "14"), send("sendText", PHONE, "15"),
    { op: "inject", opName: "sendText", mode: "error", options: { times: 0 } }, send("sendText", PHONE, "16"), send("sendText", PHONE, "17"),
    { op: "inject", opName: "sendTemplate", mode: "lostReply" }, { op: "approve", name: "booking_confirmed", language: "en" }, send("sendTemplate", PHONE, tpl), send("sendTemplate", PHONE, tpl),
    { op: "inject", opName: "sendInteractive", mode: "lostReply" }, send("sendInteractive", PHONE, buttons(1)), { op: "inject", opName: "sendDocument", mode: "lostReply" }, send("sendDocument", PHONE, { link: "https://example.com/a.pdf", filename: "a.pdf" }),
    { op: "inject", opName: "sendImage", mode: "lostReply" }, send("sendImage", PHONE, { link: "https://example.com/a.png" }), { op: "inject", opName: "sendSticker", mode: "lostReply" }, send("sendSticker", PHONE, { link: "https://example.com/a.webp" }), { op: "outbox" },
  ]));
  out.push(await fakeScenario("a fault on a closed window: the error is first, a lost reply is not reached", [{ op: "inject", opName: "sendText", mode: "error" }, send("sendText", PHONE, "x"), { op: "inject", opName: "sendText", mode: "lostReply" }, send("sendText", PHONE, "y"), send("sendText", PHONE, "z")]));
  out.push(await fakeScenario("the stand-in: a text is a closed window, a template is spoken", [send("sendText", PHONE, "hello"), send("sendTemplate", PHONE, { ...tpl, text: "Your booking is confirmed." }), send("sendTemplate", PHONE, { name: "other", language: "en", text: "x" }), send("isWindowOpen", PHONE), send("getMessage", "wamid.out_1"), send("getMessage", "wamid.out_2")], { standIn: ["booking_confirmed"] }));
  out.push(await fakeScenario("the stand-in approves every template in every language", [send("sendTemplate", PHONE, { ...tpl, language: "hi", text: "नमस्ते" }), send("sendTemplate", PHONE, { ...tpl, language: "ml", text: "ശരി" }), send("sendTemplate", PHONE, { ...tpl, language: "kn", text: "ಸರಿ" }), send("sendTemplate", PHONE, { ...tpl, language: "fr", text: "oui" }), send("sendTemplate", PHONE, { ...tpl, headerImage: "https://example.com/h.png" }), send("sendTemplate", PHONE, { ...tpl, headerImage: "ftp://x" })], { standIn: ["booking_confirmed", "x_other"] }));
  out.push(await fakeScenario("the stand-in has only the four core methods", ["sendText", "sendTemplate", "isWindowOpen", "getMessage", "sendInteractive", "sendDocument", "sendImage", "sendSticker", "ping", "receive", "outbox"].map((method) => ({ op: "has", method })), { standIn: [] }));
  out.push(await fakeScenario("the stand-in's copy and its own clock", [send("sendTemplate", PHONE, tpl), { op: "advance", advanceMs: 5000 }, send("sendTemplate", OWNER, { ...tpl, text: "Owner copy" }), send("getMessage", "wamid.out_2"), send("getMessage", "nope")], { standIn: ["booking_confirmed"] }));
  return out;
}

// ====================================================================================================================================
// 4. the webhook readers
// ====================================================================================================================================

function webhooks(): unknown {
  const meta = (...messages: any[]) => ({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "106540352242922" }, messages } }] }] });
  const metaStatuses = (...statuses: any[]) => ({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", statuses } }] }] });
  const msg = (extra: any = {}) => ({ from: "919811111111", id: "wamid.1", timestamp: "1750025136", type: "text", text: { body: "hello" }, ...extra });
  const tsCases = ["1750025136", "", " 12 ", "0x10", "0b11", "0o7", "1e3", "12.5", "abc", "  ", "1_0", "Infinity", "-5", "-Infinity", "+7", ".5", "5.", "0x", "1e", "1750025136000", "1e400", "٣", "12 34", 1750025136, 0, -1, 1e10, true, false, null, [], [7], ["8"], [1, 2], {}, " 7 "];
  const messageBodies: [string, any, any?][] = [
    ["not an object", [1]], ["null", null], ["a string", "x"], ["no entry", { object: "x" }], ["entry not a list", { entry: "x" }], ["empty", {}],
    ["fixture: text", fixture("whatsapp-webhook-text.json")], ["fixture: button reply", fixture("whatsapp-webhook-button-reply.json")], ["fixture: list reply", fixture("whatsapp-webhook-list-reply.json")], ["fixture: template button", fixture("whatsapp-webhook-template-button.json")],
    ["fixture: a status body has no messages", fixture("whatsapp-webhook-status-delivered.json")],
    ["a text with a plus sender", meta(msg({ from: "+919811111111" }))], ["a sender with two plus signs", meta(msg({ from: "++919811111111" }))], ["a sender too short", meta(msg({ from: "12345" }))], ["a sender with letters", meta(msg({ from: "9198x1111111" }))],
    ["a sender of 15 digits and 16 digits", meta(msg({ from: "123456789012345" }), msg({ id: "wamid.2", from: "1234567890123456" }))], ["a sender that is a number", meta(msg({ from: 919811111111 }))], ["no sender", meta(msg({ from: undefined }))],
    ["no id", meta(msg({ id: undefined }))], ["an empty id", meta(msg({ id: "" }))], ["an id that is a number", meta(msg({ id: 5 }))],
    ["an empty text is left out", meta(msg({ text: { body: "" } }))], ["a text with no body", meta(msg({ text: {} }))], ["a text that is not an object", meta(msg({ text: "hi" }))], ["a body that is a number", meta(msg({ text: { body: 5 } }))],
    ["words with spaces and unicode kept as they are", meta(msg({ text: { body: "  नमस्ते  \n 😀 " } }))],
    ["a location is not understood", meta(msg({ type: "location", location: { latitude: 1 } }))], ["a sticker is not understood", meta(msg({ type: "sticker", sticker: { id: "s" } }))], ["an unknown type", meta(msg({ type: "reaction", reaction: { emoji: "x" } }))], ["no type", meta(msg({ type: undefined }))],
    ["a voice note, no media asked", meta(msg({ type: "audio", text: undefined, audio: { id: "A1", mime_type: "audio/ogg; codecs=opus", voice: true } }))],
    ["a picture with a caption", meta(msg({ type: "image", text: undefined, image: { id: "I1", caption: "paid", mime_type: "image/jpeg" } }))],
    ["a button reply with an id", meta(msg({ type: "interactive", text: undefined, interactive: { type: "button_reply", button_reply: { id: "yes", title: "Yes" } } }))],
    ["a list reply with an id", meta(msg({ type: "interactive", text: undefined, interactive: { type: "list_reply", list_reply: { id: "t:1.a-b_c", title: "9:00 am", description: "d" } } }))],
    ["an id with a space is not kept as a reply, the title still is", meta(msg({ type: "interactive", text: undefined, interactive: { type: "button_reply", button_reply: { id: "a b", title: "Yes" } } }))],
    ["a reply id of 200 and 201 characters", meta(msg({ type: "interactive", text: undefined, interactive: { type: "button_reply", button_reply: { id: "a".repeat(200), title: "Y" } } }), msg({ id: "wamid.2", type: "interactive", text: undefined, interactive: { type: "button_reply", button_reply: { id: "a".repeat(201), title: "Y" } } }))],
    ["an id that is not a string is not a reply", meta(msg({ type: "interactive", text: undefined, interactive: { type: "button_reply", button_reply: { id: 5, title: "Yes" } } }))],
    ["a reply with no title is left out", meta(msg({ type: "interactive", text: undefined, interactive: { type: "button_reply", button_reply: { id: "yes" } } }))],
    ["both reply kinds: the button wins", meta(msg({ type: "interactive", text: undefined, interactive: { button_reply: { id: "b", title: "B" }, list_reply: { id: "l", title: "L" } } }))],
    ["interactive with neither", meta(msg({ type: "interactive", text: undefined, interactive: { type: "nfm_reply" } }))], ["interactive that is not an object", meta(msg({ type: "interactive", text: undefined, interactive: "x" }))],
    ["a template button: text first, then payload", meta(msg({ type: "button", text: undefined, button: { payload: "P", text: "T" } }), msg({ id: "wamid.2", type: "button", text: undefined, button: { payload: "P" } }), msg({ id: "wamid.3", type: "button", text: undefined, button: { payload: "P", text: "" } }), msg({ id: "wamid.4", type: "button", text: undefined, button: 5 }))],
    ["a change that is not messages", { entry: [{ changes: [{ field: "statuses", value: { messages: [msg()] } }] }] }], ["a change with no value", { entry: [{ changes: [{ field: "messages" }] }] }], ["junk in the lists", { entry: ["x", null, { changes: ["y", { field: "messages", value: { messages: ["z", null, msg()] } }] }] }],
    ["two entries, two changes, two messages", { entry: [{ changes: [{ field: "messages", value: { messages: [msg(), msg({ id: "wamid.2" })] } }, { field: "messages", value: { messages: [msg({ id: "wamid.3" })] } }] }, { changes: [{ field: "messages", value: { messages: [msg({ id: "wamid.4" })] } }] }] }],
    ["the same message twice is two events", meta(msg(), msg())],
    ...tsCases.map((t, i): [string, any] => [`timestamp case ${i}: ${JSON.stringify(t)}`, meta(msg({ timestamp: t }))]),
    ["no timestamp", meta(msg({ timestamp: undefined }))],
    ["voice with media: id and mime kept", meta(msg({ type: "audio", text: undefined, audio: { id: "A1", mime_type: "audio/ogg; codecs=opus", voice: true } })), { voiceMedia: true }],
    ["voice with media: an id with a slash, a mime with junk", meta(msg({ type: "audio", text: undefined, audio: { id: "a/b", mime_type: "text plain" } })), { voiceMedia: true }],
    ["voice with media: a url and nothing else", meta(msg({ type: "audio", text: undefined, audio: { url: "https://example.com/a.ogg" } })), { voiceMedia: true }],
    ["voice with media: a url over 2048", meta(msg({ type: "audio", text: undefined, audio: { url: "https://" + "a".repeat(2041) } }), msg({ id: "wamid.2", type: "audio", text: undefined, audio: { url: "https://" + "a".repeat(2040) } })), { voiceMedia: true }],
    ["voice with media: a url with astral characters at the limit", meta(msg({ type: "audio", text: undefined, audio: { url: "https://" + "😀".repeat(1020) } }), msg({ id: "wamid.2", type: "audio", text: undefined, audio: { url: "https://" + "😀".repeat(1021) } })), { voiceMedia: true }],
    ["voice with media: an http url is not kept", meta(msg({ type: "audio", text: undefined, audio: { id: "A1", url: "http://example.com/a.ogg" } })), { voiceMedia: true }],
    ["voice with media: no audio object", meta(msg({ type: "audio", text: undefined })), { voiceMedia: true }], ["voice with media: an empty audio object", meta(msg({ type: "audio", text: undefined, audio: {} })), { voiceMedia: true }],
    ["voice with media: a long mime is dropped", meta(msg({ type: "audio", text: undefined, audio: { id: "A1", mime_type: "audio/" + "x".repeat(80) } })), { voiceMedia: true }],
    ["voice with media: a mime at 80", meta(msg({ type: "audio", text: undefined, audio: { id: "A1", mime_type: "audio/" + "x".repeat(74) } })), { voiceMedia: true }],
    ["voice with media: a mime with parameters and spaces", meta(msg({ type: "audio", text: undefined, audio: { id: "A1", mime_type: "audio/ogg; \t codecs=opus" } })), { voiceMedia: true }],
    ["voice with media: a mime in capitals and with the Kelvin sign", meta(msg({ type: "audio", text: undefined, audio: { id: "A1", mime_type: "AUDIO/OGG" } }), msg({ id: "wamid.2", type: "audio", text: undefined, audio: { id: "A1", mime_type: "audio/Kogg" } }), msg({ id: "wamid.3", type: "audio", text: undefined, audio: { id: "A1", mime_type: "audio/ſogg" } })), { voiceMedia: true }],
    ["voice with media: a mime that is not a string", meta(msg({ type: "audio", text: undefined, audio: { id: "A1", mime_type: 5 } })), { voiceMedia: true }],
    ["voice with media off: the same note carries none", meta(msg({ type: "audio", text: undefined, audio: { id: "A1", mime_type: "audio/ogg" } })), { voiceMedia: false }],
    // Gupshup v3: Meta's body with gs_app_id
    ["gupshup v3: a text", { gs_app_id: "app", object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages: [msg()] } }] }] }],
  ];
  const selfBody = (type: string, payload: any, extra: any = {}) => ({ app: "GeometerShop", timestamp: 1750025136123, version: 2, type, payload, ...extra });
  const smsg = (type: string, inner: any, extra: any = {}) => selfBody("message", { id: "ABEGkYaYVSEEAhAL3SLAWwHKeKrt6s3FKB0c", source: "919811111111", type, payload: inner, sender: { phone: "919811111111", name: "A" }, ...extra });
  const self: [string, any, any?][] = [
    ["self-serve: text", smsg("text", { text: "Hi there" })], ["self-serve: the source wins over the sender", smsg("text", { text: "x" }, { source: "919800000000" })], ["self-serve: no source, the sender's phone", smsg("text", { text: "x" }, { source: undefined })],
    ["self-serve: a null source falls to the sender", smsg("text", { text: "x" }, { source: null })], ["self-serve: an empty source does not fall through", smsg("text", { text: "x" }, { source: "" })], ["self-serve: no number at all", smsg("text", { text: "x" }, { source: undefined, sender: undefined })],
    ["self-serve: no id", smsg("text", { text: "x" }, { id: undefined })], ["self-serve: an empty text", smsg("text", { text: "" })], ["self-serve: no payload.payload", smsg("text", undefined)], ["self-serve: a text that is a number", smsg("text", { text: 5 })],
    ["self-serve: a voice note, no media asked", smsg("audio", { url: "https://example.com/a.ogg", contentType: "audio/ogg" })],
    ["self-serve: a voice note with media", smsg("audio", { url: "https://example.com/a.ogg", contentType: "audio/ogg" }), { voiceMedia: true }], ["self-serve: a voice note with no url", smsg("audio", {}), { voiceMedia: true }], ["self-serve: a voice note with no inner payload", smsg("audio", undefined), { voiceMedia: true }],
    ["self-serve: a voice note, an unusable url", smsg("audio", { url: "ftp://x", contentType: "audio/ogg" }), { voiceMedia: true }],
    ["self-serve: a picture", smsg("image", { url: "https://example.com/p.jpg", caption: "paid" })],
    ["self-serve: a quick reply with a postback id", smsg("quick_reply", { title: "Yes", postbackText: "yes" })], ["self-serve: a button reply, the text field", smsg("button_reply", { text: "Yes", postbackText: "yes" })], ["self-serve: a list reply", smsg("list_reply", { title: "9:00 am", postbackText: "t:1" })],
    ["self-serve: a list reply read by `reply`", smsg("list_reply", { reply: "9:00 am", postbackText: "t:1" })], ["self-serve: no postback is words", smsg("quick_reply", { title: "Yes" })], ["self-serve: an unfit postback", smsg("quick_reply", { title: "Yes", postbackText: "a b" })],
    ["self-serve: an empty postback", smsg("quick_reply", { title: "Yes", postbackText: "" })], ["self-serve: an empty title wins over text and is then left out", smsg("quick_reply", { title: "", text: "Yes" })], ["self-serve: no words at all", smsg("quick_reply", { postbackText: "yes" })],
    ["self-serve: a location is left out", smsg("location", { latitude: 1 })], ["self-serve: no type", smsg(undefined as any, {})],
    ...[1750025136123, "1750025136123", 0, -5, 1.5, "abc", null, undefined, "0x10", true].map((t, i): [string, any] => [`self-serve timestamp case ${i}: ${JSON.stringify(t)}`, smsg("text", { text: "x" }, { timestamp: t })]),
    ["self-serve: a message-event is not a message", selfBody("message-event", { id: "x", type: "delivered", destination: "919811111111", payload: { ts: 1750263773 } })],
    ["self-serve: a null version is still a version", { ...smsg("text", { text: "x" }), version: null }], ["self-serve: no version is Meta's shape (and has no entry)", { ...smsg("text", { text: "x" }), version: undefined }],
    ["self-serve: an entry makes it Meta's", { ...smsg("text", { text: "x" }), entry: [] }], ["self-serve: a null entry makes it Meta's", { ...smsg("text", { text: "x" }), entry: null }], ["self-serve: the app is not a string", { ...smsg("text", { text: "x" }), app: 5 }],
    ["self-serve: another type", { ...smsg("text", { text: "x" }), type: "billing-event" }], ["self-serve: the payload is not an object", { ...smsg("text", { text: "x" }), payload: [1] }],
  ];
  const parse = [...messageBodies, ...self].map(([label, body, options]) => ({ label, body: body === undefined ? null : body, options: options ?? null, out: parseWhatsAppWebhook(body, options ?? undefined) }));

  const ST = (extra: any = {}) => ({ id: "wamid.HBgLMTY1MDM4Nzk0MzkVAgARGBI3MTE5MjVBOTE3MDk5QUVFM0YA", status: "delivered", timestamp: "1750263773", recipient_id: "16505551234", ...extra });
  const longTitle = "x".repeat(199) + "é" + "tail";
  const statusBodies: [string, any][] = [
    ["not an object", [1]], ["fixture: delivered", fixture("whatsapp-webhook-status-delivered.json")], ["fixture: a text body has no statuses", fixture("whatsapp-webhook-text.json")],
    ["delivered, read, failed in order", metaStatuses(ST(), ST({ id: "wamid.2", status: "read" }), ST({ id: "wamid.3", status: "failed", errors: [{ code: 131047, title: "Re-engagement message", message: "m", error_data: { details: "d" } }] }))],
    ["sent and enqueued and an unknown status are left out", metaStatuses(ST({ status: "sent" }), ST({ status: "enqueued" }), ST({ status: "weird" }), ST({ status: undefined }), ST({ status: 5 }), ST({ status: "DELIVERED" }))],
    ["a failed with no errors still has an error object", metaStatuses(ST({ status: "failed" }))], ["a failed with an empty errors list", metaStatuses(ST({ status: "failed", errors: [] }))], ["failed errors that are not objects, then one", metaStatuses(ST({ status: "failed", errors: ["x", null, { code: 5, title: "T" }] }))],
    ["a failed with a code only", metaStatuses(ST({ status: "failed", errors: [{ code: 130429 }] }))], ["a failed with a title only", metaStatuses(ST({ status: "failed", errors: [{ title: "Only" }] }))], ["a failed with an empty title", metaStatuses(ST({ status: "failed", errors: [{ code: 1, title: "" }] }))],
    ["a code that is a string or a fraction is not a code", metaStatuses(ST({ status: "failed", errors: [{ code: "131047", title: "x" }] }))],
    ["a failed title is squeezed and cut at 200 units", metaStatuses(ST({ status: "failed", errors: [{ code: 1, title: "  a \n\t b  c  " }] }), ST({ id: "wamid.2", status: "failed", errors: [{ code: 1, title: longTitle }] }), ST({ id: "wamid.3", status: "failed", errors: [{ code: 1, title: "x".repeat(300) }] }))],
    ["a failed title cut after an astral pair at the limit", metaStatuses(ST({ status: "failed", errors: [{ code: 1, title: "x".repeat(198) + "😀😀" }] }), ST({ id: "wamid.2", status: "failed", errors: [{ code: 1, title: "x".repeat(200) + "😀" }] }))],
    ["errors on a delivered status are ignored", metaStatuses(ST({ errors: [{ code: 1, title: "x" }] }))],
    ["Gupshup: gs_id first, then id", metaStatuses(ST({ gs_id: "gs-1234-5678", id: "wamid.9" }))], ["Gupshup: gs_id only (its own failure before Meta)", metaStatuses({ gs_id: "gs-1234", status: "failed", timestamp: "1750263773", errors: [{ code: 500, title: "Failed (internal)" }] })],
    ["Gupshup: the same id twice is one", metaStatuses(ST({ gs_id: "same-id", id: "same-id" }))], ["an id with a space is not usable, the other is", metaStatuses(ST({ gs_id: "a b", id: "wamid.ok" }))],
    ["an id of 256 and 257 characters", metaStatuses(ST({ id: "a".repeat(256) }), ST({ id: "a".repeat(257) }))], ["no usable id at all", metaStatuses(ST({ id: undefined }), ST({ id: "" }), ST({ id: 5 }), ST({ id: "bad id" }))],
    ["ids with every allowed punctuation", metaStatuses(ST({ id: "wamid.A_b:c=d+e/f-g" }))], ["an id with a non-ASCII letter", metaStatuses(ST({ id: "wamidé" }))],
    ["a recipient that is not a number is left out", metaStatuses(ST({ recipient_id: "abc" }), ST({ id: "wamid.2", recipient_id: undefined }), ST({ id: "wamid.3", recipient_id: "+16505551234" }))],
    ...tsCases.map((t, i): [string, any] => [`status timestamp case ${i}: ${JSON.stringify(t)}`, metaStatuses(ST({ timestamp: t }))]),
    ["no timestamp", metaStatuses(ST({ timestamp: undefined }))], ["a timestamp in milliseconds as a number", metaStatuses(ST({ timestamp: 1750263773123 }), ST({ id: "w2", timestamp: "1750263773123" }), ST({ id: "w3", timestamp: 9999999999 }), ST({ id: "w4", timestamp: 10000000000 }))],
    ["junk in the lists", { entry: ["x", { changes: ["y", { field: "messages", value: { statuses: ["z", null, ST()] } }] }] }], ["a change that is not messages", { entry: [{ changes: [{ field: "x", value: { statuses: [ST()] } }] }] }],
    ...[
      ["self-serve: delivered with Meta's time in `ts`", selfBody("message-event", { id: "wamid.X", gsId: "gs-1", type: "delivered", destination: "919811111111", payload: { ts: 1750263773 } })],
      ["self-serve: read", selfBody("message-event", { id: "wamid.X", gsId: "gs-1", type: "read", destination: "919811111111", payload: { ts: "1750263780" } })],
      ["self-serve: failed with code and reason, its own millisecond time", selfBody("message-event", { id: "gs-2", type: "failed", destination: "919811111111", payload: { code: 1005, reason: "Message Failed  as the user's window  expired" } })],
      ["self-serve: failed with a reason cut at 200", selfBody("message-event", { id: "gs-2", type: "failed", destination: "919811111111", payload: { code: 1005, reason: "r".repeat(250) } })],
      ["self-serve: failed with nothing", selfBody("message-event", { id: "gs-2", type: "failed", destination: "919811111111" })],
      ["self-serve: enqueued and sent are left out", selfBody("message-event", { id: "gs-3", type: "enqueued", destination: "919811111111", payload: {} })],
      ["self-serve: sent", selfBody("message-event", { id: "gs-3", type: "sent", destination: "919811111111", payload: { ts: 1 } })],
      ["self-serve: no ids", selfBody("message-event", { type: "delivered", destination: "919811111111", payload: { ts: 1750263773 } })],
      ["self-serve: ts null falls to the body's time", selfBody("message-event", { id: "x1", type: "delivered", destination: "919811111111", payload: { ts: null } })],
      ["self-serve: ts 0 is not nullish and reads as no time", selfBody("message-event", { id: "x1", type: "delivered", destination: "919811111111", payload: { ts: 0 } })],
      ["self-serve: a message is not a status", smsg("text", { text: "x" })], ["self-serve: the type is not a string", selfBody("message-event", { id: "x", type: 5, payload: {} })],
    ] as [string, any][],
  ];
  const statuses = statusBodies.map(([label, body]) => ({ label, body, out: parseWhatsAppStatuses(body) }));

  const e164 = ["919811111111", "+919811111111", "++919811111111", "12345", "123456", "123456789012345", "1234567890123456", "", "+", "abc", "91 98111", "٣٣٣٣٣٣", "９１９８１１１１１１１１", "91981111111\n", 919811111111, null, undefined, {}, ["919811111111"]].map((from) => ({ from: from === undefined ? null : from, undef: from === undefined, out: toE164(from) ?? null }));
  const mediaCases = [{ id: "A1" }, { id: "a/b" }, { id: "A".repeat(128) }, { id: "A".repeat(129) }, { id: "" }, { url: "https://x.com/a" }, { url: "https://x.com/a b" }, { url: "HTTPS://x.com" }, { url: 5 }, { mime_type: "audio/ogg" }, { id: "A", mime_type: "audio/ogg" }, { id: "A", mime_type: "audio/ogg; codecs=opus" }, { id: "A", mime_type: "audio/ogg;codecs=opus" }, { id: "A", mime_type: "audio/ogg ; codecs=opus" }, { id: "A", mime_type: "audio" }, { id: "A", mime_type: "audio/ogg;" }, { id: "A", mime_type: "AUDIO/OGG" }, { id: "A", mime_type: "audio/ogg\n" }, { id: "A", mime_type: "application/vnd.x+json" }, {}, null, "x", [1], { id: "A", extra: 1, sha256: "abc", voice: true }, { id: "é" }, { url: "https://é.example/ü" }];
  const media = mediaCases.map((a) => ({ audio: a, out: mediaOf(a) ?? null }));
  const raw = '{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[{"text":{"body":"नमस्ते 😀 <&>"}}]}}]}]}';
  const secret = "app-secret-1";
  const good = signMeta(Buffer.from(raw), secret);
  const verify = [[good, secret], [good.toUpperCase(), secret], [good.replace("sha256=", "SHA256="), secret], [good, ""], [undefined, secret], ["", secret], ["sha256=", secret], ["sha256=zz", secret], [good.slice(0, 20), secret], [good + "00", secret], [good, "other"], [good.slice(7), secret], ["sha256=" + good.slice(7).toUpperCase(), secret], [" " + good, secret], ["sha256=" + "é".repeat(64), secret]]
    .map(([header, sec]) => ({ header: header ?? null, secret: sec, out: verifyMetaSignature(Buffer.from(raw), header as any, sec as string) }));
  const names = [...[...self, ...messageBodies].map(([l, b]) => ({ label: l, body: b === undefined ? null : b }))].map((c: any) => ({ ...c, isSelfServe: c.body && typeof c.body === "object" && !Array.isArray(c.body) ? isGupshupSelfServe(c.body) : null, appName: selfServeAppName(c.body) ?? null })).filter((c) => c.body !== null && typeof c.body === "object" && !Array.isArray(c.body));
  return { parse, statuses, toE164: e164, mediaOf: media, raw, secret, signed: good, verify, selfServe: names };
}

// ====================================================================================================================================
// 5. send once
// ====================================================================================================================================

type ErrKind = { kind: "api"; status: number; message: string } | { kind: "timeout" } | { kind: "windowClosed" } | { kind: "notSent"; code?: string; message: string } | { kind: "conflict"; message: string } | { kind: "plain"; message: string } | { kind: "guard"; status: number; headers: Record<string, string>; body: unknown };

/** An error from a spec, as both sides build it. A Guard answer goes through classify (http.ts) / guard.Classify. */
function makeError(spec: ErrKind): Error {
  switch (spec.kind) {
    case "api": return new ApiError(spec.status, spec.message);
    case "timeout": return new TimeoutError("WhatsApp");
    case "windowClosed": return new WindowClosedError();
    case "notSent": return new NotSentError(spec.message, spec.code);
    case "conflict": return new ConflictError(spec.message);
    case "plain": return new Error(spec.message);
    case "guard": return classify(spec.status, new Headers(spec.headers), structuredClone(spec.body), { method: "POST", path: "/x", body: "{}" }) as Error;
  }
}
const guardSpec = (name: string): ErrKind => { const r = guardReply(name); return { kind: "guard", status: r.status!, headers: r.headers ?? {}, body: r.body }; };
const errorSpecs: [string, ErrKind][] = [
  ["api 400", { kind: "api", status: 400, message: "bad" }], ["api 404", { kind: "api", status: 404, message: "nope" }], ["api 499", { kind: "api", status: 499, message: "x" }], ["api 500", { kind: "api", status: 500, message: "boom" }], ["api 502", { kind: "api", status: 502, message: "x" }], ["api 399", { kind: "api", status: 399, message: "x" }],
  ["timeout", { kind: "timeout" }], ["window closed", { kind: "windowClosed" }], ["not sent", { kind: "notSent", code: "ECONNREFUSED", message: "WhatsApp: could not connect (ECONNREFUSED)." }], ["conflict", { kind: "conflict", message: "again" }], ["plain error", { kind: "plain", message: "something" }],
  ...guardNames.map((n): [string, ErrKind] => [`guard ${n}`, guardSpec(n)]),
];

function intent(over: any = {}): any { return { id: "po-1:order:1", kind: "purchase_order", caseId: "po-1", to: "+919800000001", toName: "Ravi Traders", templates: ["po_new"], values: { qty: 12, item: "Rice 5kg", n: 1.5, big: 12345678901 }, createdMs: T0 - 1000, ...over }; }

async function sendOnce(): Promise<unknown> {
  // pure functions on a state
  const pure = (name: string, ops: any[]) => {
    const state: any = { intents: [] };
    const results: unknown[] = [];
    for (const o of ops) {
      let r: unknown;
      switch (o.op) {
        case "queue": r = queueSend(state, structuredClone(o.intent)) ?? null; break;
        case "nextId": r = nextIntentId(state, o.caseId, o.kind); break;
        case "openUnknowns": r = openUnknowns(o.none ? undefined : state, o.kind); break;
        case "openRefusals": r = openRefusals(o.none ? undefined : state, o.kind); break;
        case "resolve": r = resolveUnknown(state, o.id, o.how) ?? null; break;
        case "retryNow": r = retryNow(state, o.id) ?? null; break;
        case "nextTry": r = nextTryMs(state.intents.find((i: any) => i.id === o.id)); break;
        case "set": Object.assign(state.intents.find((i: any) => i.id === o.id), o.fields); r = null; break;
        case "delete": delete state.intents.find((i: any) => i.id === o.id)[o.field]; r = null; break;
      }
      results.push({ op: o, result: plain(r), state: plain(state) });
    }
    return { name, ops, results };
  };
  const pures = [
    pure("queue, ids and duplicates", [{ op: "nextId", caseId: "po-1", kind: "purchase_order" }, { op: "queue", intent: intent() }, { op: "queue", intent: intent() }, { op: "nextId", caseId: "po-1", kind: "purchase_order" }, { op: "queue", intent: intent({ id: "po-1:order:2" }) }, { op: "nextId", caseId: "po-1", kind: "supplier_check" }, { op: "nextId", caseId: "po-2", kind: "purchase_order" }, { op: "queue", intent: intent({ id: "x", unknownMember: { a: [1, 2], b: null }, note: "n" }) }]),
    pure("unknowns and their resolution", [{ op: "queue", intent: intent() }, { op: "set", id: "po-1:order:1", fields: { status: "unconfirmed" } }, { op: "openUnknowns" }, { op: "openUnknowns", kind: "supplier_check" }, { op: "openUnknowns", kind: "purchase_order" }, { op: "openUnknowns", none: true }, { op: "resolve", id: "po-1:order:1", how: "owner_got_it" }, { op: "resolve", id: "po-1:order:1", how: "owner_send_again" }, { op: "openUnknowns" }, { op: "resolve", id: "nope", how: "owner_got_it" }, { op: "queue", intent: intent({ id: "q:1" }) }, { op: "resolve", id: "q:1", how: "owner_got_it" }]),
    pure("refusals, the next try and Try now", [{ op: "queue", intent: intent() }, { op: "nextTry", id: "po-1:order:1" }, { op: "set", id: "po-1:order:1", fields: { status: "failed", tries: 1, lastTryMs: T0 } }, { op: "openRefusals" }, { op: "openRefusals", kind: "x" }, { op: "openRefusals", none: true }, { op: "nextTry", id: "po-1:order:1" }, { op: "retryNow", id: "po-1:order:1" }, { op: "nextTry", id: "po-1:order:1" }, { op: "set", id: "po-1:order:1", fields: { tries: 3 } }, { op: "openRefusals" }, { op: "retryNow", id: "po-1:order:1" }, { op: "retryNow", id: "none" }, { op: "set", id: "po-1:order:1", fields: { lastTryMs: 0 } }, { op: "nextTry", id: "po-1:order:1" }, { op: "delete", id: "po-1:order:1", field: "lastTryMs" }, { op: "nextTry", id: "po-1:order:1" }]),
  ];
  const table = errorSpecs.map(([label, spec]) => ({ label, spec, nothingWasSent: nothingWasSent(makeError(spec)) }));

  // runSendOnce: every call it makes, in order, with the intent as it stood
  interface Run { now: number; deliver?: Record<string, (string | { throw: ErrKind })[]>; notify?: "none" | "ok" | "throws"; settleQueues?: any }
  const scenario = async (name: string, state: any, runs: Run[]) => {
    const st = structuredClone(state);
    const traces: unknown[] = [];
    const tries: Record<string, number> = {}; // how many times each intent has been delivered, over ALL the runs: a plan of several steps goes on from run to run
    for (const run of runs) {
      const trace: unknown[] = [];
      const snap = (i: any) => plain(i);
      let queued = false;
      await runSendOnce({
        state: st, now: () => run.now,
        recordClaim: (i) => { trace.push({ call: "recordClaim", intent: snap(i) }); },
        recordEnding: (i, ending, note) => { trace.push({ call: "recordEnding", intent: snap(i), ending, note }); },
        deliver: async (i) => {
          trace.push({ call: "deliver", intent: snap(i) });
          const plan = run.deliver?.[i.id] ?? ["accepted"]; const n = tries[i.id] = (tries[i.id] ?? 0) + 1;
          const step = plan[Math.min(n, plan.length) - 1];
          if (typeof step !== "string") throw makeError(step.throw);
          return step as any;
        },
        settle: (i, ending) => { trace.push({ call: "settle", intent: snap(i), ending }); if (run.settleQueues && !queued) { queued = true; queueSend(st, structuredClone(run.settleQueues)); } },
        ...(run.notify && run.notify !== "none" ? { notify: async (i: any, ending: any) => { trace.push({ call: "notify", intent: snap(i), ending }); if (run.notify === "throws") throw new Error("the owner's phone is off"); } } : {}),
        save: () => { trace.push({ call: "save", state: snap(st) }); },
        log: (line) => { trace.push({ call: "log", line }); },
      });
      traces.push({ run: { ...run, deliver: run.deliver ?? null, notify: run.notify ?? "none", settleQueues: run.settleQueues ?? null }, trace, state: plain(st) });
    }
    return { name, state, runs: traces };
  };
  const q = (over: any = {}) => ({ ...intent(over), status: "queued", tries: 0 });
  const scenarios = [
    await scenario("an accepted send is confirmed once", { intents: [q()] }, [{ now: T0 }, { now: T0 + 2 * HOUR }]),
    await scenario("each outcome and its ending", { intents: [q({ id: "a" }), q({ id: "b" }), q({ id: "c" }), q({ id: "d" })] }, [{ now: T0, deliver: { a: ["accepted"], b: ["maybe"], c: ["not_sent"], d: ["held_back"] } }]),
    await scenario("a refusal is tried again after an hour, three tries in all, then gave_up", { intents: [q()] }, [{ now: T0, deliver: { "po-1:order:1": ["not_sent"] } }, { now: T0 + HOUR - 1, deliver: { "po-1:order:1": ["not_sent"] } }, { now: T0 + HOUR, deliver: { "po-1:order:1": ["not_sent"] } }, { now: T0 + 2 * HOUR, deliver: { "po-1:order:1": ["not_sent"] } }, { now: T0 + 9 * HOUR, deliver: { "po-1:order:1": ["accepted"] } }]),
    await scenario("a refusal then success", { intents: [q()] }, [{ now: T0, deliver: { "po-1:order:1": ["not_sent", "accepted"] } }, { now: T0 + HOUR, deliver: { "po-1:order:1": ["not_sent", "accepted"] } }]),
    await scenario("a claim left by a dead process is never sent again", { intents: [{ ...q(), status: "claimed", tries: 1, lastTryMs: T0 - 5 }, q({ id: "next" })] }, [{ now: T0 }]),
    await scenario("a send that throws: refused before it went (4xx, not sent, Guard down) is failed", { intents: [q({ id: "a" }), q({ id: "b" }), q({ id: "c" }), q({ id: "d" })] }, [{ now: T0, deliver: { a: [{ throw: { kind: "api", status: 400, message: "bad" } }], b: [{ throw: { kind: "notSent", code: "ECONNREFUSED", message: "down" } }], c: [{ throw: guardSpec("busy") }], d: [{ throw: { kind: "windowClosed" } }] } }]),
    await scenario("a send that throws: 5xx, a lost reply, outcome unknown, a plain error is unconfirmed", { intents: [q({ id: "a" }), q({ id: "b" }), q({ id: "c" }), q({ id: "d" }), q({ id: "e" }), q({ id: "f" })] }, [{ now: T0, deliver: { a: [{ throw: { kind: "api", status: 500, message: "boom" } }], b: [{ throw: { kind: "timeout" } }], c: [{ throw: guardSpec("outcome_unknown") }], d: [{ throw: { kind: "plain", message: "oops" } }], e: [{ throw: guardSpec("held") }], f: [{ throw: { kind: "api", status: 400, message: "" } }] } }]),
    await scenario("a third refusal that throws is gave_up", { intents: [{ ...q(), status: "failed", tries: 2, lastTryMs: T0 - HOUR }] }, [{ now: T0, deliver: { "po-1:order:1": [{ throw: { kind: "api", status: 429, message: "slow down" }}] } }]),
    await scenario("the owner is told, and a failure to tell is only logged", { intents: [q({ id: "a" }), q({ id: "b" })] }, [{ now: T0, notify: "ok" }, { now: T0 + 1, notify: "throws" }]),
    await scenario("an ending told to the owner after a throw while telling", { intents: [q({ id: "a" }), q({ id: "b" })] }, [{ now: T0, notify: "throws" }]),
    await scenario("an intent queued while the pass runs waits for the next pass", { intents: [q({ id: "a" })] }, [{ now: T0, settleQueues: q({ id: "later" }) }, { now: T0 + 1 }]),
    await scenario("an intent that is done is not touched", { intents: [{ ...q({ id: "done" }), status: "confirmed", tries: 1, lastTryMs: T0 - 1, endedMs: T0 - 1 }, { ...q({ id: "u" }), status: "unconfirmed", tries: 1 }, { ...q({ id: "g" }), status: "gave_up", tries: 3 }, { ...q({ id: "b" }), status: "blocked", tries: 1 }] }, [{ now: T0 + 10 * HOUR }]),
    await scenario("Try now: no last try, due at once", { intents: [{ ...q(), status: "failed", tries: 1 }] }, [{ now: 5 }, { now: 5 + HOUR }]),
    await scenario("unknown members and key order are kept", { intents: [q({ extraMember: { deep: [1, { x: null }] }, anotherOne: "z" })] }, [{ now: T0 }]),
    await scenario("two due intents, oldest first, one fails", { intents: [q({ id: "first" }), q({ id: "second" })] }, [{ now: T0, deliver: { first: ["not_sent"], second: ["accepted"] } }]),
    await scenario("a failure with no words logs an empty reason", { intents: [q({ id: "a" })] }, [{ now: T0, deliver: { a: [{ throw: { kind: "api", status: 400, message: "" } }] } }]),
  ];
  return { constants: { retryAfterMs: RETRY_AFTER_MS, maxTries: MAX_TRIES }, pures, table, scenarios };
}

// ====================================================================================================================================
// 6. say
// ====================================================================================================================================

async function sayVectors(): Promise<unknown[]> {
  const out: unknown[] = [];
  const base = () => ({
    args: { booking: "b-1", phone: PHONE, to: "customer", templates: ["booked"] } as any,
    env: { owner: { whatsapp: OWNER, language: "en" }, language: "en", optedOut: false, render: { booked: "Booked Haircut for Sat 21 Nov at 11:00.", ask: "Shall I book it?", ask2: "Pick one.", deposit: "Pay Rs 600.", cap: "Rs 600 via UPI." } as Record<string, string>, matches: [] as any[], hasInteractive: false, interactive: null as any, gates: null as any, inputsOf: null as any, moment: null as any, hasMoment: false, factsThrows: false, heldBackThrows: false, templateThrows: false, generic: { customer: "gen_customer", reminder: "gen_reminder", owner: "gen_owner" } },
    messaging: { caps: [] as string[], window: true as boolean | "throws", send: {} as Record<string, ErrKind | null>, seen: true as boolean | "throws" },
  });
  const block = (contains: string, extra: any = {}) => ({ contains, ruleId: "message-matches-record", verdict: "block", reason: `The message does not match the record: ${contains}`, ...extra });
  const scenario = async (name: string, mod: (s: ReturnType<typeof base>) => void) => {
    const spec = base(); mod(spec);
    const res: any = { name, spec };
    for (const fn of ["say", "outcome"] as const) {
      const trace: unknown[] = [];
      let n = 0;
      const e = spec.env, mc = spec.messaging;
      const err = (op: string) => { const s = mc.send[op]; if (s) throw makeError(s); };
      const mk = (to: string, kind: string, text: string) => ({ id: `wamid.out_${++n}`, to, kind, text, sentAt: 0, afterOptOut: false });
      const messaging: any = {
        async sendText(to: string, text: string) { trace.push({ call: "sendText", to, text }); err("sendText"); return mk(to, "text", text); },
        async sendTemplate(to: string, template: any) { trace.push({ call: "sendTemplate", to, template }); err("sendTemplate"); return mk(to, "template", template.text); },
        async isWindowOpen(to: string) { trace.push({ call: "isWindowOpen", to }); if (mc.window === "throws") throw new Error("window store broke"); return mc.window; },
        async getMessage(id: string) { trace.push({ call: "getMessage", id }); if (mc.seen === "throws") throw new Error("read-back broke"); return mc.seen ? { id } : null; },
      };
      if (mc.caps.includes("interactive")) messaging.sendInteractive = async (to: string, m: any) => { trace.push({ call: "sendInteractive", to, message: m }); err("sendInteractive"); return mk(to, "interactive", interactiveText(m)); };
      if (mc.caps.includes("image")) messaging.sendImage = async (to: string, i: any) => { trace.push({ call: "sendImage", to, image: i }); err("sendImage"); return mk(to, "image", i.caption ?? ""); };
      const voice = {
        render(id: string, facts: any) { if (!(id in e.render)) throw new Error(`There is no text for ${id}.`); return e.render[id]; },
        templateMessage(a: any) { if (e.templateThrows) throw new Error("This message has no approved template."); return { name: `t_${a.generic}`, language: a.language, text: a.text, parameters: a.ids }; },
        genericNames: e.generic,
        matches(text: string, facts: any) { const hit = e.matches.find((m: any) => text.includes(m.contains)); return hit ? { ruleId: hit.ruleId, verdict: hit.verdict, reason: hit.reason } : { ruleId: "message-matches-record", verdict: "allow", reason: "Every amount is in the record." }; },
      };
      const say = createSay<any, any>({
        messaging, voice: voice as any, owner: e.owner, languageOf: () => e.language, optedOut: () => e.optedOut,
        factsFor: (a: any, language: any) => { if (e.factsThrows) throw new Error("the facts could not be made"); return { language }; },
        ...(e.hasInteractive ? { interactiveFor: () => { if (e.interactive === "throws") throw new Error("no buttons for this"); return structuredClone(e.interactive); } } : {}),
        ...(e.gates ? { gates: () => structuredClone(e.gates) } : {}),
        ...(e.inputsOf ? { inputsOf: () => structuredClone(e.inputsOf) } : {}),
        log: (booking: any, phone: string, action: string, outcome: string, inputs: unknown, more: any) => { trace.push({ call: "log", booking, phone, action, outcome, inputs: plain(inputs), more: plain(more) }); },
        heldBack: async () => { trace.push({ call: "heldBack" }); if (e.heldBackThrows) throw new Error("the owner could not be told"); },
        ...(e.hasMoment ? { moment: () => e.moment ?? undefined, markMoment: (id: string, m: string) => { trace.push({ call: "markMoment", id, moment: m }); } } : {}),
      });
      let result: unknown;
      try { result = { value: fn === "say" ? await say(structuredClone(spec.args)) : await say.outcome(structuredClone(spec.args)) }; } catch (x) { result = { error: (x as Error).message }; }
      res[fn] = { result, trace: plain(trace) };
    }
    out.push(res);
  };
  const inter = { body: "Shall I book it?", buttons: [{ id: "yes", title: "Yes" }, { id: "no", title: "No" }] };
  const asOffer = (s: any, extra: any = {}) => { s.args.offer = { kind: "confirm", ...extra }; s.env.hasInteractive = true; s.env.interactive = inter; s.messaging.caps = ["interactive"]; s.args.templates = ["ask"]; s.env.render.ask = "Shall I book it?"; };

  await scenario("text inside the window, read back", (s) => { });
  await scenario("the window is closed: the approved template, with the customer's generic name", (s) => { s.messaging.window = false; });
  await scenario("a reminder outside the window uses the reminder generic", (s) => { s.messaging.window = false; s.args.reminder = true; });
  await scenario("a message to the owner outside the window uses the owner generic and the owner's number and language", (s) => { s.messaging.window = false; s.args.to = "owner"; s.env.owner = { whatsapp: OWNER, language: "hi" }; });
  await scenario("a reminder to the owner is the owner's generic", (s) => { s.messaging.window = false; s.args.to = "owner"; s.args.reminder = true; });
  await scenario("several templates are joined with a space", (s) => { s.args.templates = ["booked", "deposit"]; });
  await scenario("the provider gave an id but the outbox does not show it: unconfirmed, not went", (s) => { s.messaging.seen = false; });
  await scenario("the read-back fails: it is classified like a failed send", (s) => { s.messaging.seen = "throws"; });
  await scenario("the window read fails on the plain path", (s) => { s.messaging.window = "throws"; });
  await scenario("an opted-out customer is held back, and the owner is not told", (s) => { s.env.optedOut = true; });
  await scenario("the owner is never held by the customer's STOP", (s) => { s.env.optedOut = true; s.args.to = "owner"; });
  await scenario("a message that does not match the record is held back and the owner told", (s) => { s.env.matches = [block("Haircut")]; });
  await scenario("a mismatch in a message to the owner does not tell the owner", (s) => { s.args.to = "owner"; s.env.matches = [block("Haircut")]; });
  await scenario("a hold for the owner is held back, with its own reason", (s) => { s.env.matches = [{ contains: "Haircut", ruleId: "refund-limit", verdict: "hold_for_owner", reason: "Needs the owner" }]; });
  await scenario("the strictest gate wins, the first of equals", (s) => { s.env.gates = [{ ruleId: "within-hours", verdict: "hold_for_owner", reason: "closed" }, { ruleId: "no-reminder-once-paid", verdict: "block", reason: "paid" }, { ruleId: "other", verdict: "block", reason: "second block" }]; });
  await scenario("a template's own gate that allows is recorded", (s) => { s.env.gates = [{ ruleId: "within-hours", verdict: "allow", reason: "open" }]; s.args.shown = [{ ruleId: "price-floor", verdict: "allow", reason: "held" }]; });
  await scenario("a template that cannot be rendered is blocked and nothing is sent", (s) => { s.args.templates = ["booked", "missing"]; s.args.shown = [{ ruleId: "price-floor", verdict: "allow", reason: "held" }]; });
  await scenario("facts that cannot be made throw out of say", (s) => { s.env.factsThrows = true; });
  await scenario("the owner could not be told of a held-back message: the error comes out", (s) => { s.env.matches = [block("Haircut")]; s.env.heldBackThrows = true; });
  await scenario("inputs of the template, the offer and a custom action", (s) => { s.env.inputsOf = { amount: 600, to: "override" }; s.args.action = "voice_note_reply"; s.args.offer = { kind: "confirm" }; });
  await scenario("buttons inside the window", (s) => { asOffer(s); });
  await scenario("buttons with an offer body: the record keeps the body's templates", (s) => { asOffer(s, { body: ["ask", "ask2"] }); });
  await scenario("a list is recorded as a list", (s) => { asOffer(s); s.env.interactive = { body: "Pick a time", list: { button: "Times", rows: [{ id: "t1", title: "9:00 am", description: "first" }, { id: "t2", title: "10:00 am" }] } }; });
  await scenario("buttons outside the window go as the same words (and the template outside it)", (s) => { asOffer(s); s.messaging.window = false; });
  await scenario("buttons: the window read fails, so plain words", (s) => { asOffer(s); s.messaging.window = "throws"; });
  await scenario("buttons that break Meta's limits go as plain words", (s) => { asOffer(s); s.env.interactive = { body: "b", buttons: [] }; });
  await scenario("buttons that cannot be built go as plain words", (s) => { asOffer(s); s.env.interactive = "throws"; });
  await scenario("a messaging without buttons: plain words", (s) => { asOffer(s); s.messaging.caps = []; });
  await scenario("a template without an interactive builder: plain words", (s) => { asOffer(s); s.env.hasInteractive = false; });
  await scenario("no offer: the interactive builder is not asked", (s) => { asOffer(s); s.args.offer = undefined; });
  await scenario("buttons whose own text does not match the record are blocked", (s) => { asOffer(s); s.env.matches = [block("Yes")]; });
  await scenario("buttons whose plain words do not match are blocked too (the plain words may be sent instead)", (s) => { asOffer(s); s.env.interactive = { body: "Different", buttons: [{ id: "yes", title: "Yes" }] }; s.env.render.ask = "Shall I book it? BAD"; s.env.matches = [block("BAD")]; });
  for (const [label, spec] of [["a 4xx (400)", { kind: "api", status: 400, message: "Interactive refused" }], ["a 404", { kind: "api", status: 404, message: "nope" }], ["a 499", { kind: "api", status: 499, message: "x" }], ["a conflict (409)", { kind: "conflict", message: "again" }]] as [string, ErrKind][])
    await scenario(`buttons refused with ${label}: the same words go as text`, (s) => { asOffer(s); s.messaging.send.sendInteractive = spec; });
  // any answer of the shop's Guard is not tried again as text (say.ts since 22 Nov): a hold may still send the buttons, a refusal is Guard's no to the message
  for (const [label, spec] of [["a Guard refusal (403)", guardSpec("refused_rule")], ["a Guard hold (202)", guardSpec("held")], ["a Guard conflict", guardSpec("conflict")], ["a Guard denial", guardSpec("denied_by_approver")], ["already done by a person", guardSpec("already_done")], ["unauthenticated", guardSpec("unauthenticated")], ["a 500", { kind: "api", status: 500, message: "boom" }], ["a 502", { kind: "api", status: 502, message: "x" }], ["a lost reply", { kind: "timeout" }], ["the window closed", { kind: "windowClosed" }], ["Guard's licence stop", guardSpec("suspended")], ["outcome unknown", guardSpec("outcome_unknown")], ["Guard busy", guardSpec("busy")], ["a plain error", { kind: "plain", message: "oops" }], ["not sent", { kind: "notSent", code: "ECONNREFUSED", message: "down" }]] as [string, ErrKind][])
    await scenario(`buttons failing with ${label} are not sent again as text`, (s) => { asOffer(s); s.messaging.send.sendInteractive = spec; });
  await scenario("buttons refused and then the text is refused too", (s) => { asOffer(s); s.messaging.send.sendInteractive = { kind: "api", status: 400, message: "no buttons" }; s.messaging.send.sendText = { kind: "api", status: 500, message: "text boom" }; });
  for (const [label, spec] of [["a 400", { kind: "api", status: 400, message: "bad" }], ["a 500", { kind: "api", status: 500, message: "boom" }], ["a lost reply", { kind: "timeout" }], ["the window closed", { kind: "windowClosed" }], ["not sent", { kind: "notSent", code: "ECONNREFUSED", message: "down" }], ["a plain error", { kind: "plain", message: "oops" }], ["an empty-worded refusal", { kind: "api", status: 400, message: "" }], ...guardNames.map((n): [string, ErrKind] => [`Guard answer ${n}`, guardSpec(n)])] as [string, ErrKind][])
    await scenario(`text failing with ${label}`, (s) => { s.messaging.send.sendText = spec; });
  await scenario("the template is refused", (s) => { s.messaging.window = false; s.messaging.send.sendTemplate = { kind: "api", status: 400, message: "The template x (en) is not approved." }; });
  await scenario("the template's own words cannot be made", (s) => { s.messaging.window = false; s.env.templateThrows = true; });
  await scenario("Guard's licence stop with a long reason is cut at 300 units and recorded once", (s) => { s.messaging.send.sendText = { kind: "guard", status: 402, headers: {}, body: { error: "stopped", guard: { decision: "deny", code: "subscription_suspended", sent: "no", retry: "no", reason: "r".repeat(298) + "😀😀" + "tail" } } }; });
  await scenario("Guard's licence stop with no reason", (s) => { s.messaging.send.sendText = { kind: "guard", status: 402, headers: {}, body: { guard: { decision: "deny", code: "subscription_suspended", sent: "no", retry: "no" } } }; });
  await scenario("a conversation of a channel is recorded with its channel", (s) => { s.args.phone = "web:0123456789abcdef"; });
  await scenario("a chat line the record stands behind is marked", (s) => { s.args.phone = "chat:0123456789abcdef"; s.env.hasMoment = true; s.env.moment = "confirmed"; });
  await scenario("a chat line with no moment is not marked", (s) => { s.args.phone = "chat:0123456789abcdef"; s.env.hasMoment = true; s.env.moment = null; });
  await scenario("a chat line that was not read back is not marked", (s) => { s.args.phone = "chat:0123456789abcdef"; s.env.hasMoment = true; s.env.moment = "paid"; s.messaging.seen = false; });
  await scenario("a message to the owner is never marked", (s) => { s.args.to = "owner"; s.env.hasMoment = true; s.env.moment = "paid"; s.env.owner.whatsapp = "chat:0123456789abcdef"; });
  await scenario("a channel conversation outside the window", (s) => { s.args.phone = "mcp:0123456789abcdef"; s.messaging.window = false; });
  await scenario("a conversation that only looks like a channel is not one", (s) => { s.args.phone = "web:0123456789abcdeg"; });
  // the picture before the words
  const img = (s: any, extra: any = {}) => { s.args.image = { link: "https://example.com/qr.png", caption: ["cap"], ...extra }; s.messaging.caps = ["image"]; };
  await scenario("a picture goes first, then the words", (s) => { img(s); });
  await scenario("a picture with a Guard answer that is not a refusal still lets the words go", (s) => { img(s); s.messaging.send.sendImage = guardSpec("busy"); });
  await scenario("a picture outside the window is skipped", (s) => { img(s); s.messaging.window = false; });
  await scenario("a picture whose window read fails is skipped", (s) => { img(s); s.messaging.window = "throws"; });
  await scenario("a messaging that cannot send pictures goes with words alone", (s) => { img(s); s.messaging.caps = []; });
  await scenario("a picture whose caption cannot be rendered is blocked, the words go", (s) => { img(s, { caption: ["cap", "nope"] }); });
  await scenario("a picture whose caption does not match is blocked, the words go", (s) => { img(s); s.env.matches = [block("Rs 600 via")]; });
  await scenario("a picture with a bad link is blocked with the link's words", (s) => { img(s, { link: "http://example.com/qr.png" }); });
  await scenario("a picture with a blank caption is blocked", (s) => { img(s, { caption: ["blank"] }); s.env.render.blank = " "; });
  await scenario("a picture that is not read back is unconfirmed", (s) => { img(s); s.messaging.seen = false; });
  await scenario("a picture lost reply is unconfirmed and the words still go", (s) => { img(s); s.messaging.send.sendImage = { kind: "timeout" }; });
  await scenario("a picture refused is failed and the words still go", (s) => { img(s); s.messaging.send.sendImage = { kind: "api", status: 400, message: "image refused" }; });
  await scenario("a picture stopped by the licence is blocked, once, with the licence decision", (s) => { img(s); s.messaging.send.sendImage = guardSpec("suspended"); });
  await scenario("a picture to the owner", (s) => { img(s); s.args.to = "owner"; });
  await scenario("a picture and buttons together", (s) => { img(s); asOffer(s); });
  await scenario("a held-back message sends no picture", (s) => { img(s); s.env.optedOut = true; });
  return out;
}

// ====================================================================================================================================
// 7. message statuses written into the record
// ====================================================================================================================================

function statusVectors(): unknown[] {
  const out: unknown[] = [];
  const KEY = Buffer.from("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff", "hex");
  const line = (seq: number, over: any = {}) => ({ seq, time: "2026-11-03T10:00:00.000Z", conversation: PHONE, booking: "b-1", action: "send_message", inputsDigest: "k-0123456789abcdef", outcome: "confirmed", decisions: [], language: "hi", notes: "", refs: {}, ...over });
  const sentLine = (seq: number, id: string, over: any = {}, key: Buffer | null = null) => line(seq, { refs: { messageId: key ? messageFingerprint(key, id) : id, to: "customer", ...(over.refs ?? {}) }, ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== "refs")) });
  const st = (over: any = {}) => ({ ids: ["wamid.1"], status: "delivered", timestamp: 1750263773000, ...over });
  const scenario = (name: string, entries: any[], status: any, ctx: any = {}, key: Buffer | null = null) => {
    let clock = T0;
    const rec = createRecord({ now: () => clock } as any, entries, key ? { key } : {});
    let captured: any = null;
    const spy = { ...rec, append(e: any) { captured = structuredClone(e); return rec.append(e); } };
    let result: any;
    try { const r = recordMessageStatus(spy as any, status, { ...ctx, ...(key ? { recordKey: key } : {}) }); result = { wrote: r !== undefined, line: r ? plain(r) : null }; } catch (e) { result = { thrown: { name: (e as Error).name, message: (e as Error).message } }; }
    out.push({ name, key: key ? key.toString("hex") : null, entries, status, ctx, captured: plain(captured), result });
  };
  scenario("delivered, matched to its send line (no key)", [sentLine(1, "wamid.1")], st());
  scenario("delivered, matched under the shop's key", [sentLine(1, "wamid.1", {}, KEY)], st(), {}, KEY);
  scenario("read", [sentLine(1, "wamid.1")], st({ status: "read" }));
  scenario("failed with a code and a title, a booking's message is listed", [sentLine(1, "wamid.1")], st({ status: "failed", error: { code: 131047, title: "Re-engagement message" } }));
  scenario("failed with a title only", [sentLine(1, "wamid.1")], st({ status: "failed", error: { title: "Only a title" } }));
  scenario("failed with a code only", [sentLine(1, "wamid.1")], st({ status: "failed", error: { code: 5 } }));
  scenario("failed with no code and no title", [sentLine(1, "wamid.1")], st({ status: "failed", error: {} }));
  scenario("failed on a message with no case and to the customer: not listed", [sentLine(1, "wamid.1", { booking: null })], st({ status: "failed", error: { code: 1 } }));
  scenario("failed on a message to the owner with no case is listed", [sentLine(1, "wamid.1", { booking: null, refs: { to: "owner" } })], st({ status: "failed", error: { code: 1 } }));
  scenario("a report with no send line: said so, the owner's language", [sentLine(1, "wamid.other")], st({ to: "+919811111111" }), { owner: { whatsapp: OWNER, language: "ml" } });
  scenario("a report with no send line and no owner: English, and the number as the conversation", [], st({ to: "+919811111111" }));
  scenario("a report with no send line and no number: unknown", [], st());
  scenario("a report for the owner's number, found by digits", [], st({ to: "+919822222222", status: "failed", error: { code: 2 } }), { owner: { whatsapp: "+91 98222-22222", language: "en" } });
  scenario("a report for an approver's number", [], st({ to: "+919833333333", status: "failed", error: { code: 2 } }), { owner: { whatsapp: OWNER, language: "en" }, approvers: ["+91 98333 33333"] });
  scenario("a report for a customer's number", [], st({ to: "+919844444444" }), { owner: { whatsapp: OWNER, language: "en" }, approvers: ["+919833333333"] });
  scenario("the number comes from the send line's conversation when the report names none", [sentLine(1, "wamid.1", { refs: { to: "someone" } })], st(), { owner: { whatsapp: PHONE, language: "en" } });
  scenario("the send line has a conversation that is not a number", [sentLine(1, "wamid.1", { conversation: "web:0123456789abcdef", refs: { to: "someone" } })], st());
  scenario("the same report twice writes one line", [sentLine(1, "wamid.1"), line(2, { action: "message_status", conversation: PHONE, refs: { messageId: "wamid.1", status: "delivered", to: "customer" } })], st());
  scenario("the same report twice under the key writes one line", [sentLine(1, "wamid.1", {}, KEY), line(2, { action: "message_status", refs: { messageId: messageFingerprint(KEY, "wamid.1"), status: "delivered", to: "customer" } })], st(), {}, KEY);
  scenario("read after delivered is another line", [sentLine(1, "wamid.1"), line(2, { action: "message_status", refs: { messageId: "wamid.1", status: "delivered", to: "customer" } })], st({ status: "read" }));
  scenario("the newest line that sent the id wins", [sentLine(1, "wamid.1", { booking: "b-old", conversation: "+911" }), sentLine(2, "wamid.1", { booking: "b-new", conversation: "+912" })], st());
  scenario("a received message and an earlier report with the id are not a send", [line(1, { action: "receive_message", refs: { messageId: "wamid.1" } }), line(2, { action: "message_status", refs: { messageId: "wamid.1", status: "read", to: "customer" } })], st());
  scenario("ids in another order: Gupshup's own id, then the wamid; the record has the wamid", [sentLine(1, "wamid.9")], st({ ids: ["gs-1", "wamid.9"] }));
  scenario("ids: the record has Gupshup's id", [sentLine(1, "gs-1")], st({ ids: ["gs-1", "wamid.9"] }));
  scenario("a time of zero leaves reportedAt out", [sentLine(1, "wamid.1")], st({ timestamp: 0 }));
  scenario("a time with milliseconds", [sentLine(1, "wamid.1")], st({ timestamp: 1750263773123 }));
  scenario("a time in the year 10000 is written with a sign", [sentLine(1, "wamid.1")], st({ timestamp: 253402300800000 }));
  scenario("a time past what a Date can hold throws a RangeError (a TypeScript bug, copied)", [sentLine(1, "wamid.1")], st({ status: "failed", timestamp: 1e17, error: { code: 1 } }));
  scenario("a time at the edge of a Date", [sentLine(1, "wamid.1")], st({ timestamp: 8.64e15 }));
  scenario("a time one past the edge of a Date", [sentLine(1, "wamid.1")], st({ timestamp: 8.64e15 + 1 }));
  scenario("a message to an approver that failed is listed", [sentLine(1, "wamid.1", { booking: null, refs: { to: "approver" } })], st({ status: "failed", error: { code: 3 } }));
  scenario("the send line's language is copied", [sentLine(1, "wamid.1", { language: "kn" })], st({ status: "read" }));
  scenario("a send line that has no booking null", [sentLine(1, "wamid.1", { booking: null })], st());
  scenario("a key that does not match the saved ids", [sentLine(1, "wamid.1")], st(), {}, KEY);
  return out;
}

// ====================================================================================================================================

export async function files(): Promise<[string, unknown][]> {
  return [
    ["messaging/testdata/live-vectors.json", { cases: await liveCases() }],
    ["messaging/testdata/misc-vectors.json", { ...(misc() as object), eviction: await eviction() }],
    ["messaging/testdata/fake-vectors.json", { cases: await fakes() }],
    ["messaging/testdata/webhook-vectors.json", webhooks()],
    ["messaging/testdata/sendonce-vectors.json", await sendOnce()],
    ["messaging/testdata/say-vectors.json", { cases: await sayVectors() }],
    ["messaging/testdata/status-vectors.json", { cases: statusVectors() }],
  ];
}
