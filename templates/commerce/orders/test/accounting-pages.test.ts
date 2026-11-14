// The accounting module on Orders' pages, end to end through a real runtime and the real public front (written 15 Nov 2026): an order's own page lists its receipts and
// serves each at <page>/d/<number>, another order's number is a plain not-found, the pages run no script; the owner's app shows the Money section in four languages; and
// the accountant's files download only for the owner's signed-in session. The Bookings test (templates/commerce/bookings/test/accounting-pages.test.ts) goes further on
// each point; this one pins that Orders' own reads (its items-and-day wording, its journal, its owner view) are wired and run.
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
import { bannedIn } from "../../../../modules/report/claims.ts";
import { OWNER_MONEY_WORDS } from "../../../../modules/accounting/words-owner.ts";
import { DOC } from "../../../../modules/accounting/words-documents.ts";
import { startClient } from "../server/start.ts";

const INTERNAL = "internal-0123456789abcdef0123";
const CHANNEL = "channel-0123456789abcdef01234";
const SETTINGS = new URL("../settings/annapurna-tiffins.example.json", import.meta.url);
const OWNER = "+919800000001";
const RUNTIME_OWNER_BASE = "https://pages.example/annapurna/owner";
const TOMORROW = "2026-11-17";

/** A UPI tiffin shop, its runtime on a free port with a fake clock (Monday 16 Nov 2026, 09:00 in Kochi), and the front in front of it; the owner can sign in. */
async function world() {
  const root = mkdtempSync(join(tmpdir(), "geo-orders-acct-"));
  const folder = join(root, "annapurna");
  mkdirSync(folder);
  writeFileSync(join(folder, "settings.json"), readFileSync(SETTINGS));
  writeFileSync(join(folder, "runtime.json"), JSON.stringify({ mode: "fakes", port: 0, tickSeconds: 3600 }));
  writeFileSync(join(folder, "pathway.lock"), "orders@0.1.0\n");
  writeFileSync(join(folder, "pages.json"), JSON.stringify({ schema: 1, base: "https://partners.example/s/annapurna", ownerBase: RUNTIME_OWNER_BASE, slug: "annapurna", url: "https://pages.example/annapurna" }));
  writeFileSync(join(root, "token"), INTERNAL);
  writeFileSync(join(root, "channel"), CHANNEL);
  const shops: Record<string, FrontShop> = {};
  const front = createServer(frontHandler({ shops, waitMs: 1_500 }));
  const port = await new Promise<number>((r) => front.listen(0, "127.0.0.1", () => r((front.address() as { port: number }).port)));
  const origin = `http://127.0.0.1:${port}`;
  const pagesFile = { schema: 1, base: `${origin}/s/annapurna`, ownerBase: `${origin}/s/annapurna/owner`, slug: "annapurna", url: "https://pages.example/annapurna", phone: "+919833333333" };
  const clock = fakeClock(Date.UTC(2026, 10, 16, 3, 30));
  const client = await startClient({ clientFolder: folder, tokenFile: join(root, "token"), channelTokenFile: join(root, "channel"), clock, log: () => undefined });
  shops.annapurna = { publicUrl: `${origin}/s/annapurna`, backend: runtimeBackend({ url: client.server.url, token: CHANNEL }), kind: "orders", pages: () => pagesFile as never };
  const page = (path: string, init: RequestInit = {}) => fetch(`${origin}/s/annapurna${path}`, { redirect: "manual", ...init });
  const form = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) => page(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin, ...headers }, body: new URLSearchParams(fields).toString() });
  const ownerToken = newOwnerToken();
  writeFileSync(join(folder, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(ownerToken, new Date(clock.now()))));
  return {
    origin, page, form, client, ownerToken, ownerBase: pagesFile.ownerBase,
    /** An order from the page of `qty` veg thalis, and the owner's mark of its whole advance on the panel's link page: its handle. */
    async paidOrder(qty: number, phone: string): Promise<string> {
      const menu = await (await page(`/?lang=en&date=${TOMORROW}`)).text();
      const nonce = /name="nonce" value="([A-Za-z0-9_-]{32})"/u.exec(menu)?.[1] ?? "";
      const posted = await form("/order", { date: TOMORROW, slot: "lunch", "qty_veg-thali": String(qty), name: "Asha", phone, lang: "en", nonce });
      const handle = /\/order\/([A-Za-z0-9_-]{32})/u.exec(posted.headers.get("location") ?? "")?.[1] ?? "";
      assert.ok(handle, "the order has its own page");
      await client.runtime.idle();
      const state = await (await page(`/o/${ownerToken}/api/v1/state`)).json() as { waiting: { case: string; digest: string }[] };
      const w = state.waiting.at(-1)!;
      const pressed = await form(`/o/${ownerToken}/answer`, { source: "runtime", action: "received", case: w.case, digest: w.digest });
      assert.match(pressed.headers.get("location") ?? "", /n=done/u);
      await client.runtime.idle();
      return handle;
    },
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

const visible = (page: string) => page.replace(/<style>[\s\S]*?<\/style>/gu, " ").replace(/<[^>]+>/gu, " ").replace(/&#39;/gu, "'");

test("an order's page lists its own receipts and serves them; another order's number is not found; the owner's app has the Money section and the downloads", async () => {
  const w = await world();
  try {
    const first = await w.paidOrder(2, "98111 11111");
    const second = await w.paidOrder(1, "98222 22222");
    // this shop's page is in English and Hindi (its settings); the Money section below is in all four (the owner's own language)
    for (const language of ["en", "hi"] as const) {
      const html = await (await w.page(`/order/${first}?lang=${language}`)).text();
      assert.ok(html.includes(`<h2>${DOC[language].receipts}</h2>`), `${language}: the Receipts heading`);
      assert.ok(html.includes(`/order/${first}/d/RCT%2F26-27%2F0001?lang=${language}`), `${language}: the link`);
      assert.ok(!html.includes("RCT%2F26-27%2F0002"), `${language}: not the other order's`);
      assert.equal(/<script/iu.test(html), false, `${language}: no script`);
      assert.deepEqual(bannedIn(visible(html), language), [], `${language}: claims`);
    }
    const r = await w.page(`/order/${first}/d/RCT%2F26-27%2F0001?lang=en`);
    assert.equal(r.status, 200);
    const doc = await r.text();
    const text = visible(doc);
    for (const need of ["RCT/26-27/0001", "Annapurna Tiffins", "₹120", "2 × veg thali", "Tue 17 Nov", "+919833333333"]) assert.ok(text.includes(need), need);
    assert.equal(/<script/iu.test(doc), false);
    assert.equal((await w.page(`/order/${first}/d/RCT%2F26-27%2F0002`)).status, 404, "another order's number");
    assert.equal((await w.page(`/order/${second}/d/RCT%2F26-27%2F0001`)).status, 404, "and the other way round");
    assert.equal((await w.page(`/order/${second}/d/RCT%2F26-27%2F0002`)).status, 200);

    const cookie = await w.signIn();
    for (const language of LANGUAGES) {
      const html = await (await w.page(`/owner/?lang=${language}`, { headers: { cookie } })).text();
      const words = OWNER_MONEY_WORDS[language];
      assert.ok(html.includes(`<h2>${words.title}</h2>`) && html.includes("₹180"), `${language}: the Money section with this month's ₹120 and ₹60`);
      assert.deepEqual(bannedIn(visible(html), language), [], `${language}: claims`);
    }
    const j = await w.page("/owner/accounting/2026-11/journal-2026-11.csv", { headers: { cookie } });
    assert.equal(j.status, 200);
    assert.match(String(j.headers.get("content-disposition")), /^attachment; filename="journal-2026-11\.csv"$/u);
    const csv = await j.text();
    assert.match(csv, /^date,voucher_no,voucher_type,account,debit,credit/u);
    assert.ok(csv.includes("RCT/26-27/0001") && csv.includes("RCT/26-27/0002"));
    assert.equal(/9811111111|9822222222|Asha/u.test(csv), false, "no customer in the file");
    assert.equal((await w.page("/owner/accounting/2026-11/journal-2026-11.csv")).status, 303, "no session");
    assert.equal((await w.page(`/o/${w.ownerToken}/accounting/2026-11/journal-2026-11.csv`)).status, 404, "the panel's link");
  } finally { await w.done(); }
});
