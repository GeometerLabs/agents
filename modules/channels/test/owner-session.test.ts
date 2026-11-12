// The owner's view on the shop's page, the public front's side (plan item 11f): the sign-in page has no number field and nothing posted reaches the runtime but
// the request itself; a link's GET never uses it up; its POST signs THIS browser in with a cookie scoped to the shop's owner path (HttpOnly, Secure, SameSite=Lax,
// no Domain); every owner POST needs the session's form token; sign-out ends the session; through the front door the addresses (and the cookie's path) are the
// pages domain's, for the shop's own slug only; the visitor's language; and the customer view's head (hours, WhatsApp, the stable address in the QR).
// Written 12 Nov 2026.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frontHandler } from "../front.ts";
import type { ChannelBackend, Offer, OwnerCred, OwnerView } from "../backend.ts";
import type { ChannelEvent } from "../events.ts";
import { openOwnerAccess } from "../owner-access.ts";
import { OWNER_COOKIE, csrfFor } from "../owner-session.ts";
import type { PagesFile } from "../pages-file.ts";

const OWNER = "+919800000001";
const SERVER = "https://partners.example/s/veena";
const PAGES = "https://pages.example/veena-salon";
const dir = mkdtempSync(join(tmpdir(), "owner-session-"));
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); rmSync(dir, { recursive: true, force: true }); });

const OFFER: Offer = {
  shop: {
    name: "Veena Salon", timezone: "Asia/Kolkata", languages: ["en", "hi", "ml", "kn"], deposit: { amountInr: 100, holdMinutes: 60 }, cancellation: { windowHours: 24 },
    payment: { kind: "upi", payee: "Veena" }, paused: false,
    hours: { sun: null, mon: { open: "10:00", close: "20:00" }, tue: { open: "10:00", close: "20:00" }, wed: { open: "10:00", close: "20:00" }, thu: { open: "10:00", close: "20:00" }, fri: { open: "10:00", close: "20:00" }, sat: { open: "09:00", close: "18:00" } },
  },
  services: [{ id: "haircut", names: { en: "Haircut", hi: "हेयरकट", ml: "ഹെയർകട്ട്", kn: "ಹೇರ್‌ಕಟ್" }, priceInr: 300, durationMinutes: 30 }],
};
const VIEW: OwnerView = { shop: { name: "Veena Salon", timezone: "Asia/Kolkata", ownerLanguage: "en" }, services: [], items: [], upcoming: [] };

/** A front for one shop over a stand-in runtime that keeps its sign-ins in the real access store. `ownerOnPages`: the door serves this shop from here. */
async function shop(o: { ownerOnPages?: boolean } = {}) {
  const access = openOwnerAccess(join(dir, `access-${Math.random().toString(36).slice(2)}.sqlite`));
  const pages: PagesFile = { schema: 1, base: SERVER, ownerBase: `${o.ownerOnPages ? PAGES : SERVER}/owner`, slug: "veena-salon", url: PAGES, pageUrl: "https://pages.example/p/k7m2qx9r4t", whatsapp: "+919800000002", panelUrl: "https://partners.example/shops/veena" };
  const who = () => ({ owner: OWNER, base: pages.ownerBase });
  const submitted: { events: ChannelEvent[]; owner?: OwnerCred }[] = [];
  const isOwner = (c: OwnerCred | undefined) => typeof c === "object" && "session" in c && access.check(c.session, who(), Date.now()) !== undefined;
  const backend: ChannelBackend = {
    offer: async () => OFFER,
    submit: async (events, owner) => { submitted.push({ events, ...(owner ? { owner } : {}) }); return events.some((e) => e.kind === "owner_action") && !isOwner(owner) ? "refused" : "saved"; },
    view: async () => null,
    owner: async (c) => (isOwner(c) ? VIEW : null),
    linkState: async (link) => access.linkState(link, who(), Date.now()),
    signin: async (link) => { const r = access.consume(link, who(), Date.now()); return r.ok ? { session: r.session, expiresAtMs: r.expiresAt } : { state: r.state }; },
    signout: async (s) => { access.end(s, Date.now()); },
  };
  const server = createServer(frontHandler({ shops: { veena: { publicUrl: SERVER, backend, pages: () => pages } }, waitMs: 10 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${url}${path}`, { headers, redirect: "manual" });
  const post = (path: string, body: string, headers: Record<string, string> = {}) => fetch(`${url}${path}`, { method: "POST", body, redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...headers } });
  const link = () => access.issue({ ...who(), via: "page", now: Date.now() }).token;
  return { access, submitted, get, post, link, pages };
}

test("the sign-in page has no number field, and a number posted with the request never reaches the runtime", async () => {
  const s = await shop();
  const page = await (await s.get("/s/veena/owner")).text();
  assert.match(page, /Send me a sign-in link/u);
  assert.ok(!/name="(phone|number|whatsapp|to)"/u.test(page), "no field for a number");
  assert.match(page, /https:\/\/wa\.me\/919800000002\?text=open%20my%20app/u, "the way that always works: \"open my app\" to the shop's number");
  const r = await s.post("/s/veena/owner/signin", "phone=%2B919811111111&to=%2B919811111111");
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), `${SERVER}/owner?sent=1&lang=en`);
  assert.equal(s.submitted.length, 1);
  assert.equal(s.submitted[0].events.length, 1);
  assert.deepEqual(Object.keys(s.submitted[0].events[0]).sort(), ["id", "kind"], "only the kind and a fresh id");
  assert.equal(s.submitted[0].events[0].kind, "owner_signin");
  assert.match(await (await s.get("/s/veena/owner?sent=1")).text(), /If you are this shop&#39;s owner, a sign-in link is on its way/u, "the same words whatever happened (the page escapes the apostrophe)");
  assert.equal((await s.post("/s/veena/owner/signin", "", { origin: "https://evil.example" })).status, 403, "a form from another site");
});

test("a link's GET shows a button and uses nothing up; its POST signs this browser in with a cookie scoped to the owner path; a second POST gets nothing", async () => {
  const s = await shop();
  const token = s.link();
  const looked = await s.get(`/s/veena/owner/in/${token}`);
  assert.equal(looked.status, 200);
  assert.match(await looked.text(), new RegExp(`action="${SERVER}/owner/in/${token}"`, "u"));
  await s.get(`/s/veena/owner/in/${token}`); // a scanner fetching the link again
  const r = await s.post(`/s/veena/owner/in/${token}`, "");
  assert.equal(r.status, 303);
  const cookie = r.headers.get("set-cookie") ?? "";
  const session = new RegExp(`^${OWNER_COOKIE}=([A-Za-z0-9_-]{43}); `, "u").exec(cookie)?.[1];
  assert.ok(session, cookie);
  for (const part of ["Path=/s/veena/owner", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=2592000"]) assert.ok(cookie.includes(part), part);
  assert.ok(!/domain=/iu.test(cookie), "no Domain: the cookie is for this host only");
  const again = await s.post(`/s/veena/owner/in/${token}`, "");
  assert.equal(again.status, 410);
  assert.equal(again.headers.get("set-cookie"), null);
  assert.match(await again.text(), /used already/u);
  assert.equal((await s.get(`/s/veena/owner/in/${"x".repeat(43)}`)).status, 410, "an unknown link");
});

test("signed in: the owner's page carries the form token; every owner POST without it is refused; sign-out ends the session", async () => {
  const s = await shop();
  const r = await s.post(`/s/veena/owner/in/${s.link()}`, "");
  const session = /=([A-Za-z0-9_-]{43});/u.exec(r.headers.get("set-cookie") ?? "")![1];
  const jar = { cookie: `${OWNER_COOKIE}=${session}` };
  const page = await (await s.get("/s/veena/owner", jar)).text();
  assert.match(page, /Veena Salon/u);
  assert.ok(page.includes(`name="csrf" value="${csrfFor(session)}"`), "the sign-out form carries the token");
  const answer = "source=runtime&action=received&case=b-1&digest=" + "0".repeat(32);
  assert.equal((await s.post("/s/veena/owner/answer", answer, jar)).status, 403, "no form token");
  assert.equal((await s.post("/s/veena/owner/answer", `${answer}&csrf=${"A".repeat(32)}`, jar)).status, 403, "another token");
  assert.equal((await s.post("/s/veena/owner/answer", `${answer}&csrf=${csrfFor(session)}`, jar)).status, 303, "the page's own form");
  const json = await fetch((await s.get("/s/veena/owner", jar)).url.replace(/\/owner$/u, "/owner/api/v1/answer"), { method: "POST", headers: { ...jar, "content-type": "application/json" }, body: JSON.stringify({ source: "runtime", action: "received", case: "b-1", digest: "0".repeat(32) }) });
  assert.equal(json.status, 403, "the JSON answer needs x-owner-csrf too");
  assert.equal((await s.post("/s/veena/owner/out", "", jar)).status, 403, "sign-out needs the token too");
  const out = await s.post("/s/veena/owner/out", `csrf=${csrfFor(session)}`, jar);
  assert.equal(out.status, 200);
  assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0/u);
  const after = await s.get("/s/veena/owner", jar);
  assert.equal(after.status, 303, "an ended session goes back to sign in, and the cookie is cleared");
  assert.match(after.headers.get("set-cookie") ?? "", /Max-Age=0/u);
});

test("through the front door the addresses are the pages domain's, only for the shop's own slug; the owner's view has one home", async () => {
  const s = await shop({ ownerOnPages: true });
  const door = { "x-geometer-door": "veena-salon" };
  const page = await (await s.get("/s/veena/?service=haircut", door)).text();
  assert.ok(page.includes(`href="${PAGES}/?`), "links under the pages address");
  assert.ok(!page.includes(SERVER), "and none under the server's own");
  const forged = await (await s.get("/s/veena/?service=haircut", { "x-geometer-door": "other-shop" })).text();
  assert.ok(forged.includes(`href="${SERVER}/?`), "another slug in the header is ignored");
  // the owner's view lives on the pages domain for this shop: the server's own address sends the owner there
  const there = await s.get("/s/veena/owner");
  assert.equal(there.status, 303);
  assert.equal(there.headers.get("location"), `${PAGES}/owner`);
  const r = await s.post(`/s/veena/owner/in/${s.link()}`, "", { ...door, origin: "https://pages.example" });
  assert.match(r.headers.get("set-cookie") ?? "", /Path=\/veena-salon\/owner;/u, "the cookie's path is the one the browser sees");
  assert.equal(r.headers.get("location"), `${PAGES}/owner?lang=en`);
  assert.equal((await s.post("/s/veena/owner/signin", "", { ...door, origin: "https://partners.example" })).status, 403, "through the door, only the pages origin's forms");
});

test("the visitor's language: ?lang= first, then the browser's; the customer view shows the hours, WhatsApp and the partner's line, and the QR carries the stable address", async () => {
  const s = await shop();
  assert.match(await (await s.get("/s/veena/owner", { "accept-language": "hi-IN,hi;q=0.9" })).text(), /मुझे साइन-इन लिंक भेजें/u);
  assert.match(await (await s.get("/s/veena/owner?lang=kn", { "accept-language": "hi" })).text(), /ನನಗೆ ಸೈನ್ ಇನ್ ಲಿಂಕ್ ಕಳುಹಿಸಿ/u);
  const ml = await (await s.get("/s/veena/?lang=ml")).text();
  assert.match(ml, /ഞായർ അടച്ചിരിക്കും/u, "Sunday closed, in Malayalam");
  assert.match(ml, /href="https:\/\/wa\.me\/919800000002"/u);
  assert.match(ml, /https:\/\/geometer\.dev\/account/u, "the partner's line");
  const en = await (await s.get("/s/veena/", { "accept-language": "en" })).text();
  assert.match(en, /Mon 10:00–20:00/u);
  assert.match(en, /<svg class="face-c"/u, "the character's placeholder");
  assert.ok(!/<script/iu.test(en), "no script on the customer view");
  const qr = await (await s.get("/s/veena/qr.svg")).text();
  assert.ok(qr.includes("https://pages.example/p/k7m2qx9r4t"), "the counter's QR carries the address that survives renames");
});
