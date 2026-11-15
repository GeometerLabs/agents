// The accounting module on Fees' pages, end to end through a real runtime and the real public front (written 15 Nov 2026): a parent's private page and a payment's
// confirmation page list the receipts of that parent's fees and serve each at <page>/d/<number>, with the student's name shown on the page and never in a file; another
// parent's number is a plain not-found, in both directions; the pages run no script; the owner's app shows the Money section (with what is still to come) in four
// languages; and the accountant's files download only for the owner's session, without the student's name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
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
const SETTINGS = new URL("../settings/bright-tuition-upi.example.json", import.meta.url);
const OWNER = "+919000000000";
const NAIR = "+919822222222"; // Meera's parent (Malayalam)
const MEHTA = "+919844444444"; // Rohan's parent (English)
const PAGE_BASE = "https://partners.example/s/bright";
/** The first reminder day of November: 2 Nov, 10:00 in Kochi. */
const FIRST_REMINDER = zonedToMs({ year: 2026, month: 11, day: 2 }, { hour: 10, minute: 0 }, "Asia/Kolkata");

/** A UPI centre with a page, its runtime on a free port with a fake clock (Sun 1 Nov 2026, 09:00 in Kochi), and the front in front of it; the owner can sign in. */
async function world() {
  const root = mkdtempSync(join(tmpdir(), "geo-fees-acct-"));
  const folder = join(root, "bright");
  mkdirSync(folder);
  writeFileSync(join(folder, "settings.json"), readFileSync(SETTINGS));
  writeFileSync(join(folder, "runtime.json"), JSON.stringify({ mode: "fakes", port: 0, tickSeconds: 3600 }));
  writeFileSync(join(folder, "pathway.lock"), "fees@0.1.0\n");
  writeFileSync(join(folder, "pages.json"), JSON.stringify({ schema: 1, base: PAGE_BASE, ownerBase: `${PAGE_BASE}/owner` }));
  writeFileSync(join(root, "token"), INTERNAL);
  writeFileSync(join(root, "channel"), CHANNEL);
  const shops: Record<string, FrontShop> = {};
  const front = createServer(frontHandler({ shops, waitMs: 1_500 }));
  const port = await new Promise<number>((r) => front.listen(0, "127.0.0.1", () => r((front.address() as { port: number }).port)));
  const origin = `http://127.0.0.1:${port}`;
  const pagesFile = { schema: 1, base: `${origin}/s/bright`, ownerBase: `${origin}/s/bright/owner`, slug: "bright", url: "https://pages.example/bright", phone: "+919855555555" };
  const clock = fakeClock(zonedToMs({ year: 2026, month: 11, day: 1 }, { hour: 9, minute: 0 }, "Asia/Kolkata"));
  const lines: string[] = [];
  const client = await startClient({ clientFolder: folder, tokenFile: join(root, "token"), channelTokenFile: join(root, "channel"), clock, log: (l) => lines.push(l) });
  shops.bright = { publicUrl: `${origin}/s/bright`, backend: runtimeBackend({ url: client.server.url, token: CHANNEL }), kind: "fees", pages: () => pagesFile as never };
  const page = (path: string, init: RequestInit = {}) => fetch(`${origin}/s/bright${path}`, { redirect: "manual", ...init });
  const form = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) => page(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin, ...headers }, body: new URLSearchParams(fields).toString() });
  const ownerToken = newOwnerToken();
  writeFileSync(join(folder, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(ownerToken, new Date(clock.now()))));
  const linksTo = (parent: string): string[] => lines.filter((l) => l.startsWith(`[stand-in WhatsApp] to ${parent}:`)).flatMap((l) => [...l.matchAll(/https:\/\/partners\.example\/s\/bright\/f\/([A-Za-z0-9_-]{32})/gu)].map((m) => m[1]));
  return {
    origin, page, form, client, ownerToken, ownerBase: pagesFile.ownerBase, lines, clock,
    async tickAt(ms: number) { clock.set(ms); await client.runtime.tick(); await client.runtime.idle(); },
    linksTo,
    /** The parent says they paid their one open fee on the page, and the owner marks it received on the panel's link page: the parent's link and the confirmation page. */
    async paidFee(parent: string): Promise<{ link: string; confirm: string }> {
      const link = linksTo(parent)[0];
      assert.ok(link, `${parent} got a reminder with their link`);
      const parentHtml = await (await page(`/f/${link}?lang=en`)).text();
      const dueId = /name="due" value="(f-\d+)"/u.exec(parentHtml)?.[1];
      const nonce = /name="nonce" value="([A-Za-z0-9_-]{32})"/u.exec(parentHtml)?.[1];
      assert.ok(dueId && nonce);
      const pressed = await form(`/f/${link}/paid`, { due: dueId!, nonce: nonce!, lang: "en" });
      const confirm = new URL(pressed.headers.get("location")!).pathname.replace("/s/bright", "");
      await client.runtime.idle();
      const ownerHtml = await (await page(`/o/${ownerToken}?lang=en`)).text();
      const digest = new RegExp(`name="action" value="received"><input type="hidden" name="case" value="${dueId}"><input type="hidden" name="digest" value="([0-9a-f]{32})"`, "u").exec(ownerHtml)?.[1];
      assert.ok(digest, "the owner's page lists the claimed fee");
      const done = await form(`/o/${ownerToken}/answer`, { source: "runtime", action: "received", case: dueId!, digest: digest! });
      assert.match(done.headers.get("location") ?? "", /n=done/u);
      await client.runtime.idle();
      return { link, confirm };
    },
    async signIn(): Promise<string> {
      const access = openOwnerAccess(join(folder, "data", "owner-access.sqlite"));
      const { token } = access.issue({ owner: OWNER, base: `${PAGE_BASE}/owner`, via: "page", now: clock.now() });
      access.close();
      const signed = await form(`/owner/in/${token}`, { lang: "en" });
      assert.equal(signed.status, 303);
      return String(signed.headers.get("set-cookie")).split(";")[0];
    },
    async done() { await new Promise<void>((r) => { front.closeAllConnections(); front.close(() => r()); }); await client.stop(); rmSync(root, { recursive: true, force: true }); },
  };
}

const visible = (page: string) => page.replace(/<style>[\s\S]*?<\/style>/gu, " ").replace(/<[^>]+>/gu, " ").replace(/&#39;/gu, "'");

test("a parent's page and confirmation page list that parent's receipts and serve them; another parent's number is not found; no student's name is in a file", async () => {
  const w = await world();
  try {
    await w.tickAt(w.clock.now());
    await w.tickAt(FIRST_REMINDER);
    const mehta = await w.paidFee(MEHTA);
    const nair = await w.paidFee(NAIR);
    for (const language of LANGUAGES) {
      const html = await (await w.page(`/f/${mehta.link}?lang=${language}`)).text();
      assert.ok(html.includes(`<h2>${DOC[language].receipts}</h2>`), `${language}: the Receipts heading`);
      assert.ok(html.includes(`/f/${mehta.link}/d/RCT%2F26-27%2F0001?lang=${language}`), `${language}: the link`);
      assert.ok(!html.includes("RCT%2F26-27%2F0002"), `${language}: not the other parent's`);
      assert.equal(/<script/iu.test(html), false, `${language}: no script`);
      assert.deepEqual(bannedIn(visible(html), language), [], `${language}: claims`);
    }
    // the confirmation page of the payment lists the same receipt
    const confirmHtml = await (await w.page(`${mehta.confirm}?lang=en`)).text();
    assert.ok(confirmHtml.includes(`${w.origin}/s/bright${mehta.confirm}/d/RCT%2F26-27%2F0001?lang=en`), "the confirmation page links the receipt");
    assert.equal((await w.page(`${mehta.confirm}/d/RCT%2F26-27%2F0001?lang=en`)).status, 200);
    assert.equal((await w.page(`${mehta.confirm}/d/RCT%2F26-27%2F0002?lang=en`)).status, 404, "and not the other parent's");

    // the document: the fee's words, the student's name from the centre's own store, the shop's name and phone
    const r = await w.page(`/f/${mehta.link}/d/RCT%2F26-27%2F0001?lang=en`);
    assert.equal(r.status, 200);
    const doc = await r.text();
    const text = visible(doc);
    for (const need of ["RCT/26-27/0001", "Fee for Nov 2026", "Rohan Mehta", "₹1,800", "Bright", "+919855555555"]) assert.ok(text.includes(need), need);
    assert.equal(/<script/iu.test(doc), false);
    const ml = visible(await (await w.page(`/f/${nair.link}/d/RCT%2F26-27%2F0002?lang=ml`)).text());
    assert.ok(ml.includes("Meera") && ml.includes("-ലെ ഫീസ്"), "in Malayalam, for the other parent's own fee");
    assert.equal((await w.page(`/f/${mehta.link}/d/RCT%2F26-27%2F0002`)).status, 404, "another parent's number on this link");
    assert.equal((await w.page(`/f/${nair.link}/d/RCT%2F26-27%2F0001`)).status, 404, "and the other way round");
    assert.equal((await w.page(`/f/${"A".repeat(32)}/d/RCT%2F26-27%2F0001`)).status, 404, "a link nobody has");

    const cookie = await w.signIn();
    for (const language of LANGUAGES) {
      const html = await (await w.page(`/owner/?lang=${language}`, { headers: { cookie } })).text();
      const words = OWNER_MONEY_WORDS[language];
      assert.ok(html.includes(`<h2>${words.title}</h2>`), `${language}: the Money section`);
      const section = /<section class="money"[\s\S]*?<\/section>/u.exec(html)?.[0] ?? "";
      assert.ok(section.length > 0 && !/Rohan|Meera|Mehta/u.test(section), `${language}: no student's name in the Money section`);
      assert.deepEqual(bannedIn(visible(html), language), [], `${language}: claims`);
    }
    const en = await (await w.page("/owner/?lang=en", { headers: { cookie } })).text();
    assert.match(visible(/<section class="money"[\s\S]*?<\/section>/u.exec(en)![0]), /Still to come/u, "a centre sees what is still to come from its open fees");
    for (const file of ["journal-2026-11.csv", "documents-2026-11.csv", "README.txt"]) {
      const f = await w.page(`/owner/accounting/2026-11/${file}`, { headers: { cookie } });
      assert.equal(f.status, 200, file);
      assert.equal(/Rohan|Meera|Mehta|Nair|98444|98222/u.test(await f.text()), false, `${file}: no student or parent in the file`);
    }
    assert.equal((await w.page("/owner/accounting/2026-11/journal-2026-11.csv")).status, 303, "no session");
    assert.equal((await w.page(`/o/${w.ownerToken}/accounting/2026-11/journal-2026-11.csv`)).status, 404, "the panel's link");
  } finally { await w.done(); }
});
