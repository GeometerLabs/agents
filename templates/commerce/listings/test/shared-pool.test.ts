// The listings shared process with its pool of worker threads, for real: each shop's own start (shared-start.ts) runs INSIDE a worker, with the template's own runtime, store and tokens, and
// the router in the main thread still reaches it by port and still has the shop's own token check refuse another shop's credential. And the "back soon" page of a paused shop, in the
// four languages. The pool's behaviour under a blocked or leaking shop is tested in modules/runtime/test/shared-pool.test.ts with stand-ins.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderSource, startShared } from "../../../../modules/runtime/shared.ts";
import type { SharedProcess } from "../../../../modules/runtime/shared.ts";
import { pathwayVersion } from "../server/config.ts";
import { BACK_SOON, backSoon } from "../server/back-soon.ts";

const roots: string[] = [];
const procs: SharedProcess[] = [];
after(async () => { for (const p of procs) await p.stop(); for (const r of roots) rmSync(r, { recursive: true, force: true }); });

/** The page is HTML: an apostrophe in the English sentence is written as an entity. */
const escaped = (text: string): string => text.replace(/&/gu, "&amp;").replace(/'/gu, "&#39;");
const hex = (n: number) => randomUUID().replace(/-/gu, "").repeat(4).slice(0, n);

/** A shop's folder as the deployer writes it (the lock last), with a language of its own. */
function folder(root: string, name: string, language = "en"): { channel: string } {
  const client = join(root, "clients", name, "client");
  mkdirSync(client, { recursive: true });
  mkdirSync(join(root, "secrets", name), { recursive: true });
  const channel = hex(40);
  writeFileSync(join(root, "secrets", name, "internal_token"), hex(40));
  writeFileSync(join(root, "secrets", name, "channel_token"), channel);
  writeFileSync(join(root, "secrets", name, "record_key"), hex(64));
  writeFileSync(join(client, "settings.json"), JSON.stringify({ name: name.toUpperCase(), place: { town: "Thrissur" }, languages: [language], owner: { language } }));
  writeFileSync(join(client, "runtime.json"), JSON.stringify({ mode: "fakes", tickSeconds: 3600, dataDir: join(root, "data", name, "data"), services: {} }));
  writeFileSync(join(client, "pathway.lock"), `listings@${pathwayVersion()}\n`);
  return { channel };
}

test("two real listings shops in pool workers: each answers on its own path, and the other shop's token is refused by the shop itself", async () => {
  const root = mkdtempSync(join(tmpdir(), "listings-pool-"));
  roots.push(root);
  const a = folder(root, "glow-pets"); const b = folder(root, "sree-cycles");
  const p = await startShared({
    source: folderSource({ clientsDir: join(root, "clients"), secretsDir: join(root, "secrets") }), port: 0, scanSeconds: 3600,
    pool: { startModule: new URL("../server/shared-start.ts", import.meta.url).href, workers: 2 },
  });
  procs.push(p);
  assert.deepEqual(p.held(), ["glow-pets", "sree-cycles"]);
  assert.deepEqual(p.pool().workers.map((w) => w.shops), [["glow-pets"], ["sree-cycles"]], "one shop on each worker");
  const get = async (shop: string, token: string) => (await fetch(`${p.url}/shop/${shop}/internal/channel/listings`, { headers: { authorization: `Bearer ${token}` } })).status;
  assert.equal(await get("glow-pets", a.channel), 200);
  assert.equal(await get("sree-cycles", b.channel), 200);
  assert.equal(await get("glow-pets", b.channel), 401, "another shop's token opens nothing, in a worker as in a process");
  assert.equal((await fetch(`${p.url}/shop/sree-cycles/readyz`)).status, 200);
});

test("the back-soon page speaks the language asked (?lang, then the browser, then the shop's own)", () => {
  const root = mkdtempSync(join(tmpdir(), "listings-backsoon-"));
  roots.push(root);
  folder(root, "kerala-shop", "ml");
  const paths = folderSource({ clientsDir: join(root, "clients"), secretsDir: join(root, "secrets") }).paths("kerala-shop");
  const req = (url: string, acceptLanguage?: string) => ({ url, headers: acceptLanguage ? { "accept-language": acceptLanguage } : {} }) as unknown as IncomingMessage;
  for (const l of ["en", "hi", "ml", "kn"] as const) {
    const page = backSoon(paths, req(`/?lang=${l}`));
    assert.ok(page.html.includes(`lang="${l}"`) && page.html.includes(escaped(BACK_SOON[l])), `${l}: the page is in ${l}`);
    assert.deepEqual(page.json, { error: { code: "unavailable", message: BACK_SOON[l] }, backSoon: true });
  }
  assert.ok(backSoon(paths, req("/", "hi-IN,hi;q=0.9,en;q=0.8")).html.includes(BACK_SOON.hi), "the browser's language when none is asked");
  assert.ok(backSoon(paths, req("/")).html.includes(escaped(BACK_SOON.ml)), "the shop's own first language when the browser says nothing we speak");
  assert.ok(backSoon(paths, req("/", "fr-FR")).html.includes(escaped(BACK_SOON.ml)));
});
