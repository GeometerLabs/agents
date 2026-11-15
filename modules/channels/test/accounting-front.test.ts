// The accountant's downloads at the public front, with two shops behind one front (written 15 Nov 2026): a session made for one shop opens nothing at the other (the
// runtime of each shop checks its own sessions, and the front carries the cookie to the shop whose address it came to), a request without a session or with a panel
// link opens nothing, and the front serves only this month, last month and the financial year, only the files a period has, only by GET. The shops here are stand-ins
// that keep their sign-ins in the real access store; the whole chain over real runtimes is in each template's accounting-pages.test.ts.
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
import { OWNER_COOKIE } from "../owner-session.ts";
import type { PagesFile } from "../pages-file.ts";
import { ownerMoney } from "../../accounting/owner-money.ts";
import { journal } from "../../accounting/journal.ts";
import type { LegacyMap } from "../../accounting/journal.ts";

const NOW = Date.UTC(2026, 10, 15, 6, 0);
const dir = mkdtempSync(join(tmpdir(), "accounting-front-"));
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); rmSync(dir, { recursive: true, force: true }); });

const OFFER = (name: string): Offer => ({
  shop: { name, timezone: "Asia/Kolkata", languages: ["en"], deposit: { amountInr: 100, holdMinutes: 60 }, cancellation: { windowHours: 24 }, payment: { kind: "upi", payee: name }, paused: false },
  services: [],
});
const MONEY = ownerMoney({ journal: journal([], { received: [] } as LegacyMap), entries: [], refundsUntold: [], nowMs: NOW, timeZone: "Asia/Kolkata" });

/** Two shops, each with its own owner sign-ins; `a`'s and `b`'s files say whose they are. `asked` counts the file reads each shop's runtime answered. */
async function front() {
  const shops: Record<string, FrontShop> = {};
  const people: Record<string, { access: ReturnType<typeof openOwnerAccess>; who: { owner: string; base: string }; asked: string[] }> = {};
  for (const [id, owner] of [["a", "+919800000001"], ["b", "+919800000002"]] as const) {
    const base = `https://pages.example/${id}/owner`;
    people[id] = { access: openOwnerAccess(join(dir, `access-${id}-${Math.random().toString(36).slice(2)}.sqlite`)), who: { owner, base }, asked: [] };
  }
  const run = Object.fromEntries(Object.entries(people).map(([id, p]) => {
    const isOwner = (c: OwnerCred | undefined) => typeof c === "object" && "session" in c && p.access.check(c.session, p.who, Date.now()) !== undefined;
    const view: OwnerView = { shop: { name: `Shop ${id}`, timezone: "Asia/Kolkata", ownerLanguage: "en" }, services: [], items: [], upcoming: [], money: MONEY };
    const backend: ChannelBackend = {
      offer: async () => OFFER(`Shop ${id}`),
      submit: async () => "saved",
      view: async () => null,
      owner: async (c) => (isOwner(c) ? view : null),
      accountantFiles: async (owner, period) => { if (!isOwner(owner)) return null; p.asked.push(period); return [{ name: `journal-${period}.csv`, content: `a,b\r\nshop ${id},${period}\r\n` }, { name: `documents-${period}.csv`, content: "number\r\n" }, { name: "README.txt", content: `shop ${id}` }, { name: "tally-masters.xml", content: "<ENVELOPE></ENVELOPE>" }]; },
      linkState: async (link) => p.access.linkState(link, p.who, Date.now()),
      signin: async (link) => { const r = p.access.consume(link, p.who, Date.now()); return r.ok ? { session: r.session, expiresAtMs: r.expiresAt } : { state: r.state }; },
      signout: async (s) => { p.access.end(s, Date.now()); },
    };
    return [id, backend] as const;
  }));
  const server = createServer(frontHandler({ shops, waitMs: 10 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  for (const id of ["a", "b"]) {
    const pages: PagesFile = { schema: 1, base: `${url}/s/${id}`, ownerBase: `${url}/s/${id}/owner`, slug: id, url: `https://pages.example/${id}` } as PagesFile;
    shops[id] = { publicUrl: `${url}/s/${id}`, backend: run[id], pages: () => pages };
  }
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${url}${path}`, { headers, redirect: "manual" });
  /** Sign in at shop `id`: the cookie. */
  async function signIn(id: string): Promise<string> {
    const p = people[id];
    const { token } = p.access.issue({ ...p.who, via: "page", now: Date.now() });
    const r = await fetch(`${url}/s/${id}/owner/in/${token}`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: url }, body: "lang=en" });
    assert.equal(r.status, 303);
    return String(r.headers.get("set-cookie")).split(";")[0];
  }
  // the stand-in owner sessions are bound to https://pages.example/<id>/owner; the front sends the owner back to its own address, so the sign-in base must be the front's
  for (const id of ["a", "b"]) people[id].who.base = `${url}/s/${id}/owner`;
  return { get, signIn, people, url };
}

test("a session made for one shop opens nothing at the other; no session and no cookie open nothing; the right session downloads", async () => {
  const f = await front();
  const a = await f.signIn("a");
  const b = await f.signIn("b");
  const file = "/owner/accounting/2026-11/journal-2026-11.csv";
  const own = await f.get(`/s/a${file}`, { cookie: a });
  assert.equal(own.status, 200);
  assert.equal(await own.text(), "a,b\r\nshop a,2026-11\r\n");
  assert.equal((await f.get(`/s/b${file}`, { cookie: b })).status, 200);
  // shop a's cookie at shop b: b's own runtime does not know the session, so it is the sign-in page again and the cookie is dropped; b's file is never read
  const before = f.people.b.asked.length;
  const across = await f.get(`/s/b${file}`, { cookie: a });
  assert.equal(across.status, 303);
  assert.equal(across.headers.get("location"), `${f.url}/s/b/owner`);
  assert.match(String(across.headers.get("set-cookie")), new RegExp(`${OWNER_COOKIE}=;.*Max-Age=0`, "u"));
  assert.equal(f.people.b.asked.length, before, "nothing of shop b was read for shop a's session");
  assert.equal((await f.get(`/s/a${file}`)).status, 303, "no cookie");
});

test("only this month, last month and the financial year, only a period's files, and only by GET", async () => {
  const f = await front();
  const cookie = await f.signIn("a");
  const at = (p: string) => f.get(`/s/a/owner/accounting/${p}`, { cookie });
  // the runtime says it is November 2026 (its money view): the front allows what the page offers and nothing else
  for (const ok of ["2026-11/journal-2026-11.csv", "2026-10/journal-2026-10.csv", "26-27/journal-26-27.csv", "2026-11/README.txt", "2026-11/documents-2026-11.csv"]) assert.equal((await at(ok)).status, 200, ok);
  for (const no of ["2026-09/journal-2026-09.csv", "2026-12/journal-2026-12.csv", "25-26/journal-25-26.csv", "27-28/journal-27-28.csv", "2026-13/journal-2026-13.csv", "2026-11/other.csv", "2026-11/journal-2026-10.csv", "2026-11", "2026-11/", "2026-11/a/b", "..%2F..%2Fowner/x"]) assert.equal((await at(no)).status, 404, no);
  const post = await fetch(`${f.url}/s/a/owner/accounting/2026-11/journal-2026-11.csv`, { method: "POST", redirect: "manual", headers: { cookie, origin: f.url } });
  assert.equal(post.status, 405);
  const csv = await at("2026-11/journal-2026-11.csv");
  assert.equal(csv.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(csv.headers.get("content-disposition"), 'attachment; filename="journal-2026-11.csv"');
  assert.equal((await at("2026-11/README.txt")).headers.get("content-type"), "text/plain; charset=utf-8");
  // any file the runtime lists for the period is served by its name (the Tally files, a settlements file), and an XML file as XML
  const xml = await at("2026-11/tally-masters.xml");
  assert.equal(xml.status, 200);
  assert.equal(xml.headers.get("content-type"), "application/xml; charset=utf-8");
});
