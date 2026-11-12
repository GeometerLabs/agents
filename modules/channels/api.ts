// A shop's booking API, version 1: small JSON over HTTPS at https://<server>/s/<shop>/api/v1. The booking page uses the same operations (ops.ts), and the MCP endpoint
// (mcp.ts) offers exactly the same ones as tools; a test checks the three lists match. Served by the public front (front.ts), which applies the per-address limits first.
//
//   GET  /api/v1                                  this list, the MCP address and the version
//   GET  /api/v1/services[?language=hi]           list_services
//   GET  /api/v1/slots?service=ID[&date=YYYY-MM-DD][&days=N]   free_slots
//   POST /api/v1/bookings  {service_id, start, name, phone, language?}   start_booking (202 while the shop's system is still holding it)
//   GET  /api/v1/bookings/{handle}                booking_status
//   GET  /api/v1/bookings/{handle}/payment        payment_instructions
//   POST /api/v1/bookings/{handle}/cancel         cancel_booking
//
// A refusal is {"error": {"code", "message"}}: bad_request 400, not_found 404, paused 409, too_many 429, unavailable 503. Changes take JSON only (a browser cannot send it
// from another site without asking first, and the API answers no such ask), so another site's page cannot book or cancel for someone.
import type { Ops, OperationName } from "./ops.ts";
import { OpError } from "./ops.ts";

/** Which operation each API path is, for the test that keeps the API, the MCP tools and the operations the same. */
export const API_ROUTES: Record<OperationName, { method: "GET" | "POST"; path: string }> = {
  list_services: { method: "GET", path: "/api/v1/services" },
  free_slots: { method: "GET", path: "/api/v1/slots" },
  start_booking: { method: "POST", path: "/api/v1/bookings" },
  payment_instructions: { method: "GET", path: "/api/v1/bookings/{handle}/payment" },
  booking_status: { method: "GET", path: "/api/v1/bookings/{handle}" },
  cancel_booking: { method: "POST", path: "/api/v1/bookings/{handle}/cancel" },
};

const STATUS: Record<OpError["code"], number> = { bad_request: 400, not_found: 404, paused: 409, too_many: 429, unavailable: 503 };

export type ApiAnswer = { status: number; body: unknown };

/** Which operation a request is (for the front's limits), or undefined for the index and anything unknown. */
export function apiOperation(method: string, path: string): OperationName | undefined {
  if (method === "GET" && path === "/api/v1/services") return "list_services";
  if (method === "GET" && path === "/api/v1/slots") return "free_slots";
  if (method === "POST" && path === "/api/v1/bookings") return "start_booking";
  const m = /^\/api\/v1\/bookings\/([^/]+)(\/payment|\/cancel)?$/u.exec(path);
  if (!m) return undefined;
  if (method === "GET" && m[2] === undefined) return "booking_status";
  if (method === "GET" && m[2] === "/payment") return "payment_instructions";
  if (method === "POST" && m[2] === "/cancel") return "cancel_booking";
  return undefined;
}

/** One API request. `body` is the parsed JSON of a POST (the front refuses anything that is not JSON before this). */
export async function apiRequest(ops: Ops, o: { method: string; path: string; query: URLSearchParams; body?: unknown; publicUrl: string }): Promise<ApiAnswer> {
  if (o.path === "/api/v1" || o.path === "/api/v1/") {
    return { status: 200, body: { version: 1, operations: Object.entries(API_ROUTES).map(([name, r]) => ({ name, method: r.method, path: r.path })), mcp: `${o.publicUrl}/mcp`, page: `${o.publicUrl}/` } };
  }
  const op = apiOperation(o.method, o.path);
  if (!op) return { status: 404, body: { error: { code: "not_found", message: "There is no such operation. GET /api/v1 lists them." } } };
  const handle = /^\/api\/v1\/bookings\/([^/]+)/u.exec(o.path)?.[1];
  const body = (typeof o.body === "object" && o.body !== null ? o.body : {}) as Record<string, unknown>;
  try {
    let value: unknown;
    switch (op) {
      case "list_services": value = await ops.list_services({ ...(o.query.get("language") ? { language: o.query.get("language")! } : {}) }); break;
      case "free_slots": value = await ops.free_slots({ service_id: o.query.get("service") ?? undefined, date: o.query.get("date") ?? undefined, days: o.query.get("days") ?? undefined }); break;
      case "start_booking": {
        const v = await ops.start_booking(body) as { status: string };
        return { status: v.status === "pending" ? 202 : v.status === "refused" ? 409 : 201, body: v };
      }
      case "booking_status": value = await ops.booking_status({ handle, language: o.query.get("language") ?? undefined }); break;
      case "payment_instructions": value = await ops.payment_instructions({ handle }); break;
      case "cancel_booking": value = await ops.cancel_booking({ handle, language: body.language }); break;
    }
    return { status: 200, body: value };
  } catch (e) {
    if (e instanceof OpError) return { status: STATUS[e.code], body: { error: { code: e.code, message: e.message } } };
    return { status: 503, body: { error: { code: "unavailable", message: "The shop's system did not answer. Try again in a minute." } } };
  }
}
