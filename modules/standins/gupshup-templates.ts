// A stand-in for Gupshup's self-serve TEMPLATE calls (bundle/lib/gupshup-templates.ts speaks them): create a template for an app and list an app's templates.
// Paths, the `apikey` header, the form fields and the reply shapes are the ones docs.gupshup.io documents (see that file's header). It keeps its own small list of templates,
// because this call is a form post, which the shared JSON server (http.ts) refuses. A created template starts "SUBMITTED", as Gupshup's statuses page says. It never reaches the
// real service. `rejectNames` makes it refuse those names; `wrongKey` makes it answer 401, as Gupshup does for a key that does not match.
import { createServer } from "node:http";

export interface GupshupTemplateStandin {
  url: string;
  /** Every create request, in order, with the apikey header it carried. */
  created: { appId: string; apikey: string | undefined; form: Record<string, string> }[];
  /** Every request path, in order. */
  paths: string[];
  /** Put a template in the app as if it was submitted earlier. */
  seed(name: string, language: string, status: string): void;
  close(): Promise<void>;
}

export async function startGupshupTemplateStandin(o: { appId: string; apikey: string; rejectNames?: string[]; pageSize?: number }): Promise<GupshupTemplateStandin> {
  const templates: { id: string; elementName: string; languageCode: string; status: string; category: string }[] = [];
  const created: GupshupTemplateStandin["created"] = []; const paths: string[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://standin");
      paths.push(`${req.method} ${url.pathname}`);
      const reply = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
      const key = req.headers.apikey as string | undefined;
      if (key !== o.apikey) return reply(401, { status: "error", message: "Authentication Failed" });
      const m = /^\/wa\/app\/([^/]+)\/template$/u.exec(url.pathname);
      if (!m || m[1] !== o.appId) return reply(400, { status: "error", message: "Invalid App Details" });
      if (req.method === "GET") {
        const size = Number(url.searchParams.get("pageSize") ?? 100); const page = Number(url.searchParams.get("pageNo") ?? 0);
        return reply(200, { status: "success", templates: templates.slice(page * (o.pageSize ?? size), (page + 1) * (o.pageSize ?? size)) });
      }
      const form = Object.fromEntries(new URLSearchParams(raw));
      created.push({ appId: m[1], apikey: key, form });
      if (o.rejectNames?.includes(form.elementName)) return reply(400, { status: "error", message: "Template Name already exists" });
      if (!form.elementName || !form.languageCode || !form.content || !form.category) return reply(400, { status: "error", message: "Missing required fields" });
      const t = { id: `t-${templates.length + 1}`, elementName: form.elementName, languageCode: form.languageCode, status: "SUBMITTED", category: form.category };
      templates.push(t);
      reply(200, { status: "success", template: t });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, created, paths,
    seed: (elementName, languageCode, status) => { templates.push({ id: `t-${templates.length + 1}`, elementName, languageCode, status, category: "UTILITY" }); },
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
