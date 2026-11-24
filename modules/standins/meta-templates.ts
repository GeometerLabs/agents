// A stand-in for Meta's TEMPLATE calls on one WhatsApp Business Account (bundle/lib/wa-templates.ts speaks them; read 25 Nov 2026 on developers.facebook.com): create
// is POST /{version}/{waba-id}/message_templates with a JSON body and a Bearer token, answering { id, status: "PENDING", category }; the list is GET of the same path,
// answering { data: [{ id, name, language, status, category, rejected_reason }], paging: { cursors: { before, after }, next? } } in pages of `limit`. Errors are
// Meta's shape, { error: { message, type, code, error_user_msg? } }: 190 for a token it does not accept (HTTP 401), 80008 for too many calls (HTTP 429), 100 for a bad
// body. It keeps its own list, so a second run sees what the first one sent. It never reaches the real service.
//
// `token`: the whole Authorization value it accepts ("Bearer ..."); left out, any caller is accepted (a panel test points the panel straight at it, in the Guard's
// place, and the Guard is what adds the key). `rejectNames` refuses those names with code 100; `rateAfter` answers 80008 after that many creates.
import { createServer } from "node:http";

export interface MetaTemplateStandin {
  url: string;
  /** Every create request, in order, with the Authorization it carried and the body it sent. */
  created: { wabaId: string; authorization: string | undefined; body: Record<string, unknown> }[];
  /** Every request, in order ("GET /v26.0/123/message_templates?..."). */
  paths: string[];
  /** Put a template in the account as if it was submitted earlier; a rejected one may carry Meta's reason. */
  seed(name: string, language: string, status: string, rejectedReason?: string): void;
  /** Change a held template's state, as Meta's review does. */
  setState(name: string, language: string, status: string, rejectedReason?: string): void;
  close(): Promise<void>;
}

export async function startMetaTemplateStandin(o: { wabaId: string; token?: string; rejectNames?: string[]; rateAfter?: number; pageSize?: number } = { wabaId: "102290129340398" }): Promise<MetaTemplateStandin> {
  const templates: { id: string; name: string; language: string; status: string; category: string; rejected_reason: string }[] = [];
  const created: MetaTemplateStandin["created"] = []; const paths: string[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://standin");
      paths.push(`${req.method} ${url.pathname}${url.search}`);
      const reply = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
      const error = (status: number, code: number, message: string) => reply(status, { error: { message, type: "OAuthException", code, fbtrace_id: "standin" } });
      const auth = req.headers.authorization;
      if (o.token !== undefined && auth !== o.token) return error(401, 190, "Invalid OAuth access token - Cannot parse access token");
      const m = /^\/v\d+\.\d+\/([^/]+)\/message_templates$/u.exec(url.pathname);
      if (!m) return error(400, 100, "Unsupported request");
      if (m[1] !== o.wabaId) return error(400, 100, `Unsupported get request. Object with ID '${m[1]}' does not exist`);
      if (req.method === "GET") {
        const limit = o.pageSize ?? Number(url.searchParams.get("limit") ?? 25);
        const start = Number(url.searchParams.get("after") ?? 0);
        const page = templates.slice(start, start + limit);
        const more = start + limit < templates.length;
        return reply(200, { data: page, paging: { cursors: { before: String(start), after: String(start + page.length) }, ...(more ? { next: `${url.origin}${url.pathname}?after=${start + page.length}` } : {}) } });
      }
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw) as Record<string, unknown>; } catch { return error(400, 100, "Invalid JSON"); }
      created.push({ wabaId: m[1], authorization: auth, body });
      if (o.rateAfter !== undefined && created.length > o.rateAfter) return error(429, 80008, "There have been too many calls to this WhatsApp Business account.");
      if (typeof body.name !== "string" || typeof body.language !== "string" || typeof body.category !== "string" || !Array.isArray(body.components)) return error(400, 100, "Invalid parameter");
      if (o.rejectNames?.includes(body.name)) return reply(400, { error: { message: "Invalid parameter", type: "OAuthException", code: 100, error_subcode: 2388024, error_user_msg: "Content in this language already exists" } });
      const t = { id: String(1_000_000 + templates.length), name: body.name, language: body.language, status: "PENDING", category: body.category, rejected_reason: "NONE" };
      templates.push(t);
      reply(200, { id: t.id, status: t.status, category: t.category });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const find = (name: string, language: string) => templates.find((t) => t.name === name && t.language === language);
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, created, paths,
    seed: (name, language, status, reason) => { templates.push({ id: String(1_000_000 + templates.length), name, language, status, category: "UTILITY", rejected_reason: reason ?? "NONE" }); },
    setState: (name, language, status, reason) => { const t = find(name, language); if (t) { t.status = status; t.rejected_reason = reason ?? "NONE"; } },
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
