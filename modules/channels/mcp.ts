// A shop's booking API as an MCP endpoint (streamable HTTP, JSON responses), so an AI assistant (Claude, ChatGPT, Gemini where it supports MCP) can book within the
// shop's limits. Served by the public front at https://<server>/s/<shop>/mcp (front.ts). The tools are a thin map over ops.ts, the same functions the JSON API calls,
// so an assistant gets exactly what the page and the API offer and nothing more: it cannot mark a payment received, approve a refund or touch another booking.
//
// The conventions are the engine's (monorepo apps/cli/src/mcp.rs, ADR-0053): the four protocol versions, the newest when the client asks for one we do not know, tools
// with JSON Schema and readOnlyHint, errors as JSON-RPC errors. A POST carries one message or a batch; the answer is JSON (no event stream is offered, so GET is 405);
// a notification is 202 with no body. No session is kept: every call stands alone, which is what the operations need.
//
// "Behind Guard" means what it means for a WhatsApp booking: every call that changes something becomes one step of the shop's runtime, and each outside effect of
// that step (the calendar, a payment link, a WhatsApp message) goes through the shop's Guard for it. The endpoint itself is not a Guard; a UPI shop on its own booking
// list may make a booking that touches no Guard at all, and the hold, the limits and the owner's confirmation are then the runtime's.
import type { Ops, OperationName } from "./ops.ts";
import { OPERATIONS, OpError } from "./ops.ts";

/** The engine's list (monorepo apps/cli/src/mcp.rs MCP_VERSIONS), newest first. */
export const MCP_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

interface Tool { name: OperationName; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, boolean> }

const HANDLE = { type: "string", description: "The booking's handle, as start_booking returned it. It is the only way to reach the booking: keep it private." };
const LANGUAGE = { type: "string", enum: ["en", "hi", "ml", "kn"], description: "The customer's language for names and messages (one of the shop's)." };

/** The tools, one per operation, in the operations' order. */
export const TOOLS: Tool[] = [
  { name: "list_services", description: "The shop's services with their prices (in rupees) and durations, the deposit, how long a time is held for payment, the cancellation window, and how the deposit is paid.", inputSchema: { type: "object", properties: { language: LANGUAGE }, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "free_slots", description: "Free start times for one service, day by day, in the shop's time zone. A time shown here is checked again when it is booked.", inputSchema: { type: "object", properties: { service_id: { type: "string" }, date: { type: "string", description: "First day, YYYY-MM-DD in the shop's zone (default today)." }, days: { type: "integer", minimum: 1, maximum: 14 } }, required: ["service_id"], additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "start_booking", description: "Hold a free time for the customer and get the deposit's payment details. The time is held only until the hold ends; it is booked only when the deposit is confirmed (on a UPI shop, by the owner). Needs the customer's own name and phone number, with their consent.", inputSchema: { type: "object", properties: { service_id: { type: "string" }, start: { type: "string", description: "A start from free_slots (ISO 8601 with its zone)." }, name: { type: "string" }, phone: { type: "string", description: "The customer's phone number (an Indian mobile, or another country's with +)." }, language: LANGUAGE }, required: ["service_id", "start", "name", "phone"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "payment_instructions", description: "How to pay the deposit of a held booking: the shop's UPI ID, the amount and a UPI link, or the shop's payment link.", inputSchema: { type: "object", properties: { handle: HANDLE }, required: ["handle"], additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "booking_status", description: "A booking's state (held, booked, cancelled, ...), its time, and the shop's messages about it.", inputSchema: { type: "object", properties: { handle: HANDLE, language: LANGUAGE }, required: ["handle"], additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "cancel_booking", description: "Cancel a booking. Inside the shop's cancellation window the deposit comes back; later, the owner decides.", inputSchema: { type: "object", properties: { handle: HANDLE, language: LANGUAGE }, required: ["handle"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
];

type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
const error = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const result = (id: unknown, value: unknown) => ({ jsonrpc: "2.0", id, result: value });

/** One JSON-RPC message; null for a notification (no answer). */
export async function mcpMessage(ops: Ops, shopName: string, msg: Rpc): Promise<unknown | null> {
  if (typeof msg !== "object" || msg === null || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return error(msg?.id, -32600, "Not a JSON-RPC 2.0 request.");
  if (msg.id === undefined || msg.id === null) return null; // a notification (notifications/initialized and the like): nothing to answer
  const params = (typeof msg.params === "object" && msg.params !== null ? msg.params : {}) as Record<string, unknown>;
  switch (msg.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const version = (MCP_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_VERSIONS[0];
      return result(msg.id, {
        protocolVersion: version, capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "geometer-shop-bookings", version: "1", title: `${shopName}: bookings` },
        instructions: `Book at ${shopName} for the person you are helping, with their consent. The shop's own limits apply to every booking. You cannot mark a payment received or approve a refund: the owner does.`,
      });
    }
    case "ping": return result(msg.id, {});
    case "tools/list": return result(msg.id, { tools: TOOLS });
    case "tools/call": {
      const name = params.name as OperationName;
      if (!OPERATIONS.includes(name)) return error(msg.id, -32602, `There is no tool called ${String(params.name)}.`);
      const args = (typeof params.arguments === "object" && params.arguments !== null ? params.arguments : {}) as Record<string, unknown>;
      try {
        const value = await (ops[name] as (a: Record<string, unknown>) => Promise<unknown>)(args);
        return result(msg.id, { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, isError: false });
      } catch (e) {
        // a refusal the assistant should read and act on is a tool result with isError (the protocol's way), not a protocol error
        if (e instanceof OpError) return result(msg.id, { content: [{ type: "text", text: `${e.code}: ${e.message}` }], structuredContent: { error: { code: e.code, message: e.message } }, isError: true });
        return result(msg.id, { content: [{ type: "text", text: "unavailable: the shop's system did not answer. Try again in a minute." }], structuredContent: { error: { code: "unavailable", message: "The shop's system did not answer." } }, isError: true });
      }
    }
    default: return error(msg.id, -32601, `There is no method ${msg.method} here.`);
  }
}

/** A POST body: one message or a batch. Returns the HTTP status and the body to send (202 and nothing for notifications only). */
export async function mcpPost(ops: Ops, shopName: string, body: unknown): Promise<{ status: number; body?: unknown }> {
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 20) return { status: 400, body: error(null, -32600, "A batch holds 1 to 20 messages.") };
    const answers = (await Promise.all(body.map((m) => mcpMessage(ops, shopName, m as Rpc)))).filter((a) => a !== null);
    return answers.length === 0 ? { status: 202 } : { status: 200, body: answers };
  }
  const answer = await mcpMessage(ops, shopName, body as Rpc);
  return answer === null ? { status: 202 } : { status: 200, body: answer };
}
