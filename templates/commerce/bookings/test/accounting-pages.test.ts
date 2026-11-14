// The accounting module on Bookings' pages, end to end through a real runtime and the real public front (written 15 Nov 2026): a booking's own page lists its receipts
// and serves each at <page>/d/<number>; another booking's number is a plain not-found; the pages run no script; the owner's app shows the Money section in all four
// languages; and the accountant's files download only for the owner's signed-in session (a panel link, no cookie, a made-up cookie and the channel token alone
// are all refused) and parse as CSV whose debits and credits balance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { frontHandler } from "../../../../modules/channels/front.ts";
import type { FrontShop } from "../../../../modules/channels/front.ts";
import { runtimeBackend } from "../../../../modules/channels/backend.ts";
import { OWNER_LINK_FILE, newOwnerToken, ownerLinkFile } from "../../../../modules/channels/owner-link.ts";
import { openOwnerAccess } from "../../../../modules/channels/owner-access.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { MONTH_NAMES } from "../../../../modules/language/format.ts";
import { bannedIn } from "../../../../modules/report/claims.ts";
import { OWNER_MONEY_WORDS } from "../../../../modules/accounting/words-owner.ts";
import { DOC } from "../../../../modules/accounting/words-documents.ts";
import { startClient } from "../server/start.ts";

const INTERNAL = "internal-0123456789abcdef0123";
const CHANNEL = "channel-0123456789abcdef01234";
const UPI_SETTINGS = new URL("../settings/glow-salon-upi.example.json", import.meta.url);
const RUNTIME_OWNER_BASE = "https://pages.example/glow-salon/owner";
const OWNER = "+919000000000";

/** A UPI shop, its runtime on a free port with a fake clock (Monday 16 Nov 2026, 09:00 in Kochi), and the front in front of it; the owner can sign in (a pages file). */
async function world() {
  const root = mkdtempSync(join(tmpdir(), "geo-acct-pages-"));
  const folder = join(root, "glow");
  mkdirSync(folder);
  const settings = { ...JSON.parse(readFileSync(UPI_SETTINGS, "utf8")), calendar: { module: "own" } };
  writeFileSync(join(folder, "settings.json"), JSON.stringify(settings));
  writeFileSync(join(folder, "runtime.json"), JSON.stringify({ mode: "fakes", port: 0, tickSeconds: 3600 }));
  writeFileSync(join(folder, "pathway.lock"), "bookings@0.1.0\n");
  writeFileSync(join(folder, "pages.json"), JSON.stringify({ schema: 1, base: "https://partners.example/s/glow", ownerBase: RUNTIME_OWNER_BASE, slug: "glow-salon", url: "https://pages.example/glow-salon" }));
  writeFileSync(join(root, "token"), INTERNAL);
  writeFileSync(join(root, "channel"), CHANNEL);
  const shops: Record<string, FrontShop> = {};
  const front = createServer(frontHandler({ shops, waitMs: 1_500 }));
  const port = await new Promise<number>((r) => front.listen(0, "127.0.0.1", () => r((front.address() as { port: number }).port)));
  const origin = `http://127.0.0.1:${port}`;
  const pagesFile = { schema: 1, base: `${origin}/s/glow`, ownerBase: `${origin}/s/glow/owner`, slug: "glow-salon", url: "https://pages.example/glow-salon", phone: "+919822222222" };
  const clock = fakeClock(Date.UTC(2026, 10, 16, 3, 30));
  const client = await startClient({ clientFolder: folder, tokenFile: join(root, "token"), channelTokenFile: join(root, "channel"), clock, log: () => undefined });
  shops.glow = { publicUrl: `${origin}/s/glow`, backend: runtimeBackend({ url: client.server.url, token: CHANNEL }), pages: () => pagesFile as never };
  const page = (path: string, init: RequestInit = {}) => fetch(`${origin}/s/glow${path}`, { redirect: "manual", ...init });
  const form = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) => page(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin, ...headers }, body: new URLSearchParams(fields).toString() });
  const ownerToken = newOwnerToken();
  writeFileSync(join(folder, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(ownerToken, new Date(clock.now()))));
  return {
    origin, page, form, client, folder, ownerToken, ownerBase: pagesFile.ownerBase,
    /** A booking from the page for the n-th free time, and the owner's mark of its deposit on the panel's link page: its handle. */
    async paidBooking(n: number, phone: string): Promise<string> {
      const slots = await (await page("/?lang=en&service=haircut")).text();
      const starts = [...slots.matchAll(/name="start" value="(\d+)"/gu)].map((m) => m[1]);
      const nonce = /name="nonce" value="([A-Za-z0-9_-]{32})"/u.exec(slots)?.[1] ?? "";
      const posted = await form("/book", { service: "haircut", start: starts[n], name: "Asha", phone, lang: "en", nonce });
      const handle = /\/b\/([A-Za-z0-9_-]{32})/u.exec(posted.headers.get("location") ?? "")?.[1] ?? "";
      assert.ok(handle, "the booking has its own page");
      await client.runtime.idle();
      const state = await (await page(`/o/${ownerToken}/api/v1/state`)).json() as { waiting: { case: string; digest: string }[] };
      const w = state.waiting.at(-1)!;
      const pressed = await form(`/o/${ownerToken}/answer`, { source: "runtime", action: "received", case: w.case, digest: w.digest });
      assert.match(pressed.headers.get("location") ?? "", /n=done/u);
      await client.runtime.idle();
      return handle;
    },
    /** The owner signed in as WhatsApp's one-time link would do it: the cookie of the session. */
    async signIn(): Promise<string> {
      const access = openOwnerAccess(join(folder, "data", "owner-access.sqlite"));
      const { token } = access.issue({ owner: OWNER, base: RUNTIME_OWNER_BASE, via: "page", now: clock.now() });
      access.close();
      const signed = await form(`/owner/in/${token}`, { lang: "en" });
      assert.equal(signed.status, 303);
      return String(signed.headers.get("set-cookie")).split(";")[0];
    },
    async done() { await new Promise<void>((r) => { front.closeAllConnections(); front.close(() => r()); }); await client.stop(); rmSync(root, { recursive: true, force: true }); },
  };
}

/** RFC 4180 as export.ts writes it: quoted fields with doubled quotes, rows ending CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === "\"" && text[i + 1] === "\"") { field += "\""; i++; } else if (c === "\"") quoted = false; else field += c; }
    else if (c === "\"") quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r" && text[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
    else field += c;
  }
  assert.ok(field === "" && row.length === 0, "the file ends with a row ending");
  return rows;
}
const visible = (page: string) => page.replace(/<style>[\s\S]*?<\/style>/gu, " ").replace(/<[^>]+>/gu, " ").replace(/&#39;/gu, "'");

test("a booking's page lists its own receipts, serves each, refuses another booking's number, and runs no script", async () => {
  const w = await world();
  try {
    const first = await w.paidBooking(0, "98111 11111");
    const second = await w.paidBooking(3, "98222 22222");
    for (const language of LANGUAGES) {
      const html = await (await w.page(`/b/${first}?lang=${language}`)).text();
      assert.ok(html.includes(`<h2>${DOC[language].receipts}</h2>`), `${language}: the Receipts heading`);
      assert.ok(html.includes(`href="${w.origin}/s/glow/b/${first}/d/RCT%2F26-27%2F0001?lang=${language}"`), `${language}: one link, the number URL-encoded`);
      assert.ok(!html.includes("RCT%2F26-27%2F0002"), `${language}: the other booking's receipt is not listed`);
      assert.equal(/<script/iu.test(html), false, `${language}: no script on the page`);
      assert.deepEqual(bannedIn(visible(html), language), [], `${language}: claims`);
    }
    // the document: encoded and with plain slashes, in each language, from the shop's settings (name, address), pages.json (phone) and the booking (service and slot)
    for (const sub of ["RCT%2F26-27%2F0001", "RCT/26-27/0001"]) {
      const r = await w.page(`/b/${first}/d/${sub}?lang=en`);
      assert.equal(r.status, 200, sub);
      const doc = await r.text();
      const text = visible(doc);
      for (const need of ["RCT/26-27/0001", "Glow Salon", "₹200", "haircut", "Mon 16 Nov", "+919822222222", "Marked received by the shop owner"]) assert.ok(text.includes(need), `${sub}: ${need}`);
      assert.equal(/<script/iu.test(doc), false, "the document runs no script");
      assert.equal(/<link|src=|@import|url\(/u.test(doc.replace(/<style>[\s\S]*?<\/style>/u, "")), false, "and loads nothing");
      assert.ok(/noindex/u.test(String(r.headers.get("x-robots-tag"))));
    }
    for (const language of LANGUAGES) assert.equal((await w.page(`/b/${first}/d/RCT%2F26-27%2F0001?lang=${language}`)).status, 200, language);
    // another booking's number, one never issued, text that is not a number: a plain not-found, the same words as any missing page
    for (const sub of ["RCT%2F26-27%2F0002", "RCT/26-27/0002", "RCT%2F26-27%2F0099", "BILL%2F26-27%2F0001", "%E0%A4%A", ""]) {
      const r = await w.page(`/b/${first}/d/${sub}`);
      assert.equal(r.status, 404, sub);
      assert.match(await r.text(), /There is nothing here/u);
    }
    assert.equal((await w.page(`/b/${second}/d/RCT%2F26-27%2F0001`)).status, 404, "the second booking cannot read the first's");
    assert.equal((await w.page(`/b/${second}/d/RCT%2F26-27%2F0002`)).status, 200);
    assert.equal((await w.page(`/b/${"A".repeat(32)}/d/RCT%2F26-27%2F0001`)).status, 404, "a handle no booking has opens nothing");
    assert.equal((await w.page(`/b/${first}/d/RCT%2F26-27%2F0001`, { method: "POST", headers: { origin: w.origin } })).status, 405, "a receipt is only read");
    // what is read from the runtime is by hash: the channel route takes no case id, and gives nothing for a hash no page has
    const bare = await fetch(`${w.client.server.url}/internal/channel/documents?handle=${"0".repeat(64)}&lang=en`, { headers: { authorization: `Bearer ${CHANNEL}` } });
    assert.deepEqual(await bare.json(), { documents: [] });
    assert.equal((await fetch(`${w.client.server.url}/internal/channel/documents?case=b-1&lang=en`, { headers: { authorization: `Bearer ${CHANNEL}` } })).status, 400, "a case id is not a key");
    assert.equal((await fetch(`${w.client.server.url}/internal/channel/documents?handle=${"0".repeat(64)}`)).status, 401, "and only the channel token reads it");
  } finally { await w.done(); }
});

test("the owner's app shows the Money section in four languages; the panel's link page has none of the downloads", async () => {
  const w = await world();
  try {
    await w.paidBooking(0, "98111 11111");
    await w.paidBooking(3, "98222 22222");
    const cookie = await w.signIn();
    for (const language of LANGUAGES) {
      const words = OWNER_MONEY_WORDS[language];
      const r = await w.page(`/owner/?lang=${language}`, { headers: { cookie } });
      assert.equal(r.status, 200);
      const html = await r.text();
      assert.ok(html.includes(`<h2>${words.title}</h2>`), `${language}: the section`);
      assert.ok(html.includes("₹400"), `${language}: this month's received, two deposits of ₹200`);
      assert.ok(html.includes(words.scope), `${language}: the scope line`);
      assert.ok(html.indexOf(words.title) > html.indexOf("<h2>"), `${language}: below the page's first heading`);
      for (const href of ["2026-11/journal-2026-11.csv", "2026-11/documents-2026-11.csv", "2026-11/README.txt", "2026-10/journal-2026-10.csv", "26-27/journal-26-27.csv"]) assert.ok(html.includes(`href="${w.ownerBase}/accounting/${href}"`), `${language}: ${href}`);
      const wa = /href="(https:\/\/wa\.me\/\?text=[^"]*)"/u.exec(html)?.[1] ?? "";
      assert.equal(decodeURIComponent(wa.split("text=")[1]).replace(/&#39;/gu, "'"), words.shareText(`${MONTH_NAMES[language][10]} 2026`), `${language}: the share link holds the words only`);
      assert.equal(/csv|@|\d{10}/u.test(decodeURIComponent(wa)), false, `${language}: no file and no number in the share link`);
      assert.deepEqual(bannedIn(visible(html), language), [], `${language}: claims`);
    }
    // the panel's link page: the same figures, no download card, and its address serves no file
    const panel = await (await w.page(`/o/${w.ownerToken}?lang=en`)).text();
    assert.ok(panel.includes("<h2>Money</h2>") && panel.includes("₹400"));
    assert.equal(panel.includes("/accounting/"), false);
    assert.equal((await w.page(`/o/${w.ownerToken}/accounting/2026-11/journal-2026-11.csv`)).status, 404, "a panel link downloads nothing");
  } finally { await w.done(); }
});

test("the accountant's files download for the owner's session only, and parse as CSV whose debits and credits balance", async () => {
  const w = await world();
  try {
    await w.paidBooking(0, "98111 11111");
    await w.paidBooking(3, "98222 22222");
    const cookie = await w.signIn();
    const get = (path: string, headers: Record<string, string> = { cookie }) => w.page(`/owner/accounting/${path}`, { headers });
    const j = await get("2026-11/journal-2026-11.csv");
    assert.equal(j.status, 200);
    assert.equal(j.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal(j.headers.get("content-disposition"), "attachment; filename=\"journal-2026-11.csv\"");
    assert.equal(j.headers.get("cache-control"), "no-store");
    const journalText = await j.text();
    const rows = parseCsv(journalText);
    assert.deepEqual(rows[0].slice(0, 6), ["date", "voucher_no", "voucher_type", "account", "debit", "credit"]);
    const cents = (s: string) => Math.round(Number(s) * 100);
    const [debit, credit] = rows.slice(1).reduce(([d, c], r) => [d + cents(r[4]), c + cents(r[5])], [0, 0]);
    assert.ok(rows.length > 2 && debit === credit && debit > 0, "debits equal credits");
    assert.ok(rows.slice(1).every((r) => r.length === rows[0].length), "every row has every column");
    assert.equal(/9811111111|9822222222|Asha/u.test(journalText), false, "no customer number or name is in the file");
    const d = parseCsv(await (await get("2026-11/documents-2026-11.csv")).text());
    assert.deepEqual(d.slice(1).map((r) => r[0]), ["RCT/26-27/0001", "RCT/26-27/0002"]);
    const readme = await get("2026-11/README.txt");
    assert.equal(readme.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.match(await readme.text(), /journal-2026-11\.csv/u);
    assert.equal((await get("26-27/journal-26-27.csv")).status, 200, "the financial year");
    assert.equal((await get("2026-10/documents-2026-10.csv")).status, 200, "last month (empty is a file too)");
    // only this month, last month and the financial year, and only a period's own three files
    for (const nope of ["2026-09/journal-2026-09.csv", "2026-11/journal-2026-10.csv", "2026-11/other.csv", "2026-11", "../journal.csv", "25-26/journal-25-26.csv"]) assert.equal((await get(nope)).status, 404, nope);
    // refused: no session, a made-up one, the panel's link, the channel token alone
    const noCookie = await get("2026-11/journal-2026-11.csv", {});
    assert.equal(noCookie.status, 303);
    assert.equal(noCookie.headers.get("location"), `${w.ownerBase}`);
    const made = await get("2026-11/journal-2026-11.csv", { cookie: `__Secure-geo-owner=${"a".repeat(43)}` });
    assert.equal(made.status, 303, "a session nobody made");
    assert.match(String(made.headers.get("set-cookie")), /Max-Age=0/u, "its cookie is removed");
    assert.equal((await w.page(`/o/${w.ownerToken}/accounting/2026-11/journal-2026-11.csv`)).status, 404);
    const accounting = `${w.client.server.url}/internal/channel/accounting?period=2026-11`;
    assert.equal((await fetch(accounting, { headers: { authorization: `Bearer ${CHANNEL}` } })).status, 403, "the channel token alone");
    assert.equal((await fetch(accounting, { headers: { authorization: `Bearer ${CHANNEL}`, "x-owner-link": w.ownerToken } })).status, 403, "the panel's link at the runtime too");
    assert.equal((await w.form("/owner/accounting/2026-11/journal-2026-11.csv", {}, { cookie })).status, 405, "only read");
    const out = await w.form("/owner/out", { csrf: /name="csrf" value="([^"]+)"/u.exec(await (await w.page("/owner/?lang=en", { headers: { cookie } })).text())?.[1] ?? "" }, { cookie });
    assert.equal(out.status, 200);
    assert.equal((await get("2026-11/journal-2026-11.csv")).status, 303, "after signing out the same cookie opens nothing");
  } finally { await w.done(); }
});
