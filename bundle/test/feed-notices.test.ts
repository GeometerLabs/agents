// The courier for "my feed changed" notices (bundle/services/notices.ts, wired in services/inbox.ts): a shop's runtime cannot call out, so the inbox asks it whether a notice is due and carries
// the signed notice to the directory, then tells the runtime it arrived. Written, not run, in the 18 Nov build stream, on a fake network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCourier } from "../services/notices.ts";
import { loadCourier } from "../services/inbox.ts";
import { inboxConfig } from "../generate/configs.ts";
import { composeServer } from "../generate/compose.ts";
import { serverConfig } from "./helpers.ts";

const TOKEN = "t".repeat(40);
const NOTICE = { format: "shop-feed-changed/1", feed: "https://pages.example/veena/listings.json", updated: "2026-11-18T03:30:00.000Z", keyId: "k".repeat(43), sig: "s".repeat(86) };
const FP = "f".repeat(43);

/** A fake network: each shop's runtime has a notice due or not; the directory answers with `directory`. */
function network(o: { due?: string[]; directory?: number; runtimeDown?: string[] } = {}) {
  const log: { url: string; method: string; auth: string | undefined; body?: unknown }[] = [];
  const due = new Set(o.due ?? ["veena"]);
  const acked: string[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const headers = init.headers as Record<string, string> | undefined;
    const method = init.method ?? "GET";
    log.push({ url, method, auth: headers?.authorization, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const shop = /http:\/\/rt-(\w+):8780\/internal\/feed-notice/u.exec(url)?.[1];
    if (shop) {
      if (o.runtimeDown?.includes(shop)) throw new Error("connect ECONNREFUSED");
      if (method === "POST") { acked.push(shop); due.delete(shop); return new Response("{}", { status: 200 }); }
      return due.has(shop) ? new Response(JSON.stringify({ notice: NOTICE, fingerprint: FP }), { status: 200 }) : new Response(null, { status: 204 });
    }
    if (url === "http://directory:8799/feed-changed") return new Response("{}", { status: o.directory ?? 202 });
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, log, acked, due };
}
const shops = (...names: string[]) => names.map((name) => ({ name, runtimeUrl: `http://rt-${name}:8780`, token: TOKEN }));

test("a due notice is carried to the directory as it is, and the runtime is told it arrived", async () => {
  const n = network();
  const r = await createCourier({ shops: shops("veena"), directoryUrl: "http://directory:8799", fetchImpl: n.fetchImpl }).pass();
  assert.deepEqual(r, { sent: 1, refused: 0, waiting: 0, down: 0 });
  const toDirectory = n.log.find((c) => c.url.startsWith("http://directory"))!;
  assert.deepEqual(toDirectory.body, NOTICE, "the signed notice goes across untouched");
  assert.equal(toDirectory.auth, undefined, "the shop's internal token is never sent to the directory");
  assert.deepEqual(n.log.filter((c) => c.method === "POST" && c.url.includes("rt-veena")).map((c) => c.body), [{ fingerprint: FP }]);
  assert.ok(n.log.filter((c) => c.url.includes("rt-veena")).every((c) => c.auth === `Bearer ${TOKEN}`));
  assert.deepEqual(n.acked, ["veena"]);
});

test("nothing due, nothing sent; a runtime that is down is counted and does not stop the other shops", async () => {
  const quiet = network({ due: [] });
  assert.deepEqual(await createCourier({ shops: shops("veena"), directoryUrl: "http://directory:8799", fetchImpl: quiet.fetchImpl }).pass(), { sent: 0, refused: 0, waiting: 0, down: 0 });
  assert.ok(!quiet.log.some((c) => c.url.startsWith("http://directory")));
  const lines: string[] = [];
  const n = network({ due: ["asha"], runtimeDown: ["veena"] });
  const r = await createCourier({ shops: shops("veena", "asha"), directoryUrl: "http://directory:8799", fetchImpl: n.fetchImpl, log: (l) => lines.push(l) }).pass();
  assert.deepEqual(r, { sent: 1, refused: 0, waiting: 0, down: 1 });
  assert.ok(lines.every((l) => !l.includes(TOKEN)), "the token is never logged");
});

test("a directory that says wait (429) leaves the notice pending in the runtime; another refusal is not repeated", async () => {
  const slow = network({ directory: 429 });
  const c = createCourier({ shops: shops("veena"), directoryUrl: "http://directory:8799", fetchImpl: slow.fetchImpl });
  assert.deepEqual(await c.pass(), { sent: 0, refused: 0, waiting: 1, down: 0 });
  assert.deepEqual(slow.acked, [], "not acknowledged, so the runtime offers it again next pass");
  assert.ok(slow.due.has("veena"));
  const failing = network({ directory: 503 });
  assert.deepEqual(await createCourier({ shops: shops("veena"), directoryUrl: "http://directory:8799", fetchImpl: failing.fetchImpl }).pass(), { sent: 0, refused: 0, waiting: 1, down: 0 });
  assert.deepEqual(failing.acked, [], "a directory that is down does not make the notice go away");
  const refused = network({ directory: 403 });
  const lines: string[] = [];
  assert.deepEqual(await createCourier({ shops: shops("veena"), directoryUrl: "http://directory:8799", fetchImpl: refused.fetchImpl, log: (l) => lines.push(l) }).pass(), { sent: 0, refused: 1, waiting: 0, down: 0 });
  assert.deepEqual(refused.acked, ["veena"], "acknowledged, so the same refused notice is not offered every pass");
  assert.ok(lines.some((l) => l.includes("veena")));
});

test("at most 15 notices a minute across all shops (the directory takes 20 a minute from one address); the rest go on the next pass", async () => {
  const names = Array.from({ length: 20 }, (_, i) => `shop${String(i).padStart(2, "0")}`);
  const n = network({ due: names });
  let t = 1_000_000;
  const c = createCourier({ shops: shops(...names), directoryUrl: "http://directory:8799", fetchImpl: n.fetchImpl, now: () => t });
  assert.deepEqual(await c.pass(), { sent: 15, refused: 0, waiting: 5, down: 0 });
  assert.equal(n.acked.length, 15);
  t += 61_000;
  assert.deepEqual(await c.pass(), { sent: 5, refused: 0, waiting: 0, down: 0 });
  assert.equal(n.acked.length, 20);
});

test("the inbox makes a courier only when the server has a directory and a shop with a page and its own internal token", () => {
  const read = (path: string) => (path.endsWith("/internal_token") ? TOKEN : undefined);
  const lines: string[] = [];
  const shop = { runtimeUrl: "http://10.1.0.5:8780", ownerWhatsapp: "+919000000000", phoneNumberId: "1", verification: "meta-signature" as const, secretsDir: "/run/secrets/veena", channel: { publicUrl: "https://s.example/s/veena" } };
  assert.ok(loadCourier({ directoryUrl: "http://directory:8799", shops: { veena: shop } }, read, (l) => lines.push(l)));
  assert.equal(loadCourier({ shops: { veena: shop } }, read, () => undefined), undefined, "no directory on this server");
  assert.equal(loadCourier({ directoryUrl: "http://directory:8799", shops: { veena: { ...shop, channel: undefined } } }, read, () => undefined), undefined, "a shop with no page has no feed");
  assert.equal(loadCourier({ directoryUrl: "http://directory:8799", shops: { veena: shop } }, () => undefined, (l) => lines.push(l)), undefined);
  assert.ok(lines.some((l) => l.includes("internal_token")) && lines.every((l) => !l.includes(TOKEN)));
});

test("the inbox's config names the directory only on a server that has one, and the inbox is on the directory's network and the runtimes' doors, not the runtime's", () => {
  const hosted = serverConfig({ panel: { enabled: true, mode: "hosted" }, fleet: { url: "https://fleet.example", keyFile: "fleet.key" }, pages: { domain: "pages.example", extraDomains: [] } });
  const shop = { name: "veena", index: 1, pathwayDir: "/p", guards: [], webhooks: { verification: "meta-signature" as const, hasGoogle: false, ownGoogleKey: false }, ownerWhatsapp: "+919000000000", phoneNumberId: "1", pathway: "bookings" };
  assert.equal(JSON.parse(inboxConfig(hosted, [shop as never])).directoryUrl, "http://directory:8799");
  assert.equal(JSON.parse(inboxConfig(hosted, [])).directoryUrl, undefined, "no shops, nothing to carry");
  assert.equal(JSON.parse(inboxConfig(serverConfig(), [shop as never])).directoryUrl, undefined, "no pages domain, no directory");
  // the network rule: the runtime is on its own internal network only, and cannot call out
  const dirs = { app: "/repo", generated: "/srv/generated", secrets: "/srv/secrets", status: "/srv/status", fleet: "/srv/fleet", shops: "/srv/shops", secretsInbox: "/srv/secrets-inbox", requests: "/srv/requests", exports: "/srv/exports", panelData: "/srv/panel", config: "/srv/geometer.json", licence: "/srv/state/licence", home: "/srv/home" };
  const c = composeServer(hosted, dirs, [], {});
  const inbox = Object.keys((c.services.inbox.block as { networks: Record<string, unknown> }).networks).sort();
  assert.deepEqual(inbox, ["admin", "front", "pages"], "the one service on the doors' network (admin) and the directory's (pages)");
  assert.ok(Object.keys((c.services.directory.block as { networks: Record<string, unknown> }).networks).includes("pages"));
});
