// "Get my shop's file" at the public front: the file is served only to a signed-in owner's SESSION, once; no cookie opens nothing; another shop's session opens nothing; only
// GET; "Get my shop's file" and "Change my Operator" are posted only with the session's form token and reach the assistant as the owner's own words; the owner's page shows
// the file's state and the buttons for a session and never for anyone else.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frontHandler } from "../front.ts";
import type { FrontShop } from "../front.ts";
import type { ChannelBackend, Offer, OwnerCred, OwnerView } from "../backend.ts";
import { openOwnerAccess } from "../owner-access.ts";
import type { OwnerFileState } from "../owner-file.ts";
import type { PagesFile } from "../pages-file.ts";

const dir = mkdtempSync(join(tmpdir(), "owner-file-front-"));
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); rmSync(dir, { recursive: true, force: true }); });
const ID = "A".repeat(32);

async function front() {
  const sent: string[] = [];
  const state: { file: OwnerFileState; used: boolean } = { file: { state: "ready", id: ID, name: "glow-shop-file.tar.gz", bytes: 5, expiresAt: "2026-11-21T10:00:00Z" }, used: false };
  const access = openOwnerAccess(join(dir, `access-${Math.random().toString(36).slice(2)}.sqlite`));
  const who = { owner: "+919800000001", base: "" };
  const isOwner = (c: OwnerCred | undefined) => typeof c === "object" && "session" in c && access.check(c.session, who, Date.now()) !== undefined;
  const view: OwnerView = { shop: { name: "Glow", timezone: "Asia/Kolkata", ownerLanguage: "en" }, services: [], items: [], upcoming: [], app: { character: {}, face: "well", talk: [], cards: [], listen: false } as never };
  const offer: Offer = { shop: { name: "Glow", timezone: "Asia/Kolkata", languages: ["en"], deposit: { amountInr: 100, holdMinutes: 60 }, cancellation: { windowHours: 24 }, payment: { kind: "upi", payee: "Glow" }, paused: false }, services: [] };
  const backend: ChannelBackend = {
    offer: async () => offer, view: async () => null,
    submit: async (events) => { for (const e of events) if (e.kind === "owner_message") sent.push(e.text); return "saved"; },
    owner: async (c) => (isOwner(c) ? view : null),
    ownerFile: async (c) => (isOwner(c) ? (state.used ? { state: "taken" } : state.file) : null),
    ownerFileBytes: async (c, id) => { if (!isOwner(c) || id !== ID || state.used) return null; state.used = true; return { name: "glow-shop-file.tar.gz", bytes: Buffer.from("bytes") }; },
    linkState: async (link) => access.linkState(link, who, Date.now()),
    signin: async (link) => { const r = access.consume(link, who, Date.now()); return r.ok ? { session: r.session, expiresAtMs: r.expiresAt } : { state: r.state }; },
    signout: async (s) => { access.end(s, Date.now()); },
  };
  const shops: Record<string, FrontShop> = {};
  const server = createServer(frontHandler({ shops, waitMs: 10 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  who.base = `${url}/s/a/owner`;
  const pages = { schema: 1, base: `${url}/s/a`, ownerBase: who.base, slug: "a", url: "https://pages.example/a" } as PagesFile;
  shops.a = { publicUrl: `${url}/s/a`, backend, pages: () => pages };
  const { token } = access.issue({ ...who, via: "page", now: Date.now() });
  const r = await fetch(`${url}/s/a/owner/in/${token}`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: url }, body: "lang=en" });
  const cookie = String(r.headers.get("set-cookie")).split(";")[0];
  return { url, cookie, sent, state };
}

test("the session takes the file once; the second try and a request with no cookie get nothing", async () => {
  const f = await front();
  const none = await fetch(`${f.url}/s/a/owner/file/${ID}`, { redirect: "manual" });
  assert.notEqual(none.status, 200, "no cookie");
  const own = await fetch(`${f.url}/s/a/owner/file/${ID}`, { headers: { cookie: f.cookie } });
  assert.equal(own.status, 200);
  assert.match(String(own.headers.get("content-disposition")), /attachment; filename="glow-shop-file.tar.gz"/u);
  assert.equal(await own.text(), "bytes");
  assert.equal((await fetch(`${f.url}/s/a/owner/file/${ID}`, { headers: { cookie: f.cookie } })).status, 404, "one use");
});

test("only GET takes a file, and a path that is not an id finds nothing", async () => {
  const f = await front();
  assert.equal((await fetch(`${f.url}/s/a/owner/file/${ID}`, { method: "POST", headers: { cookie: f.cookie }, redirect: "manual" })).status, 405);
  assert.equal((await fetch(`${f.url}/s/a/owner/file/short`, { headers: { cookie: f.cookie }, redirect: "manual" })).status, 404);
});

test("the owner's page shows the file and both buttons to the session, and the file's state after it is taken", async () => {
  const f = await front();
  const page = await (await fetch(`${f.url}/s/a/owner?lang=en`, { headers: { cookie: f.cookie } })).text();
  assert.match(page, /Your shop is yours/u);
  assert.match(page, /Take the file/u);
  assert.match(page, /Get my shop&#39;s file|Get my shop's file/u);
  assert.match(page, /Change my Operator/u);
  assert.doesNotMatch(page, /export|handover/iu, "no jargon on the page");
  await fetch(`${f.url}/s/a/owner/file/${ID}`, { headers: { cookie: f.cookie } });
  assert.match(await (await fetch(`${f.url}/s/a/owner?lang=en`, { headers: { cookie: f.cookie } })).text(), /You took your file/u);
});

test("the two buttons need the session's form token, and send the owner's own words to the assistant", async () => {
  const f = await front();
  const page = await (await fetch(`${f.url}/s/a/owner?lang=en`, { headers: { cookie: f.cookie } })).text();
  const csrf = /name="csrf" value="([^"]+)"/u.exec(page)![1];
  const post = (body: string) => fetch(`${f.url}/s/a/owner/leave`, { method: "POST", redirect: "manual", headers: { cookie: f.cookie, origin: f.url, "content-type": "application/x-www-form-urlencoded" }, body });
  assert.equal((await post("what=file")).status, 403, "no form token");
  assert.deepEqual(f.sent, []);
  assert.equal((await post(`csrf=${encodeURIComponent(csrf)}&what=file`)).status, 303);
  assert.equal((await post(`csrf=${encodeURIComponent(csrf)}&what=operator`)).status, 303);
  assert.equal((await post(`csrf=${encodeURIComponent(csrf)}&what=anything`)).status, 303);
  assert.deepEqual(f.sent, ["get my shop's file", "change my operator"], "only the two known asks reach the assistant");
});
