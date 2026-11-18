// The directory of local shops as a service (block S, 18 Nov 2026): modules/discovery wired to a port, a database file, a signing key and the network. It runs on Geometer's
// Operator server only, as its own container (`directory`, generate/compose.ts), on the `pages` network (reached by the door, which forwards /search, /order, /feed-changed,
// /mcp and /.well-known/agent-card.json to it) and `egress` (only to read the feeds of servers named in geometer.json `directory.feeds`). It holds no shop's secret and no shop's
// data beyond what shops publish in their open feeds.
//
// What it keeps, in its own volume (DIRECTORY_VOLUME, not in any backup): the index (directory.sqlite, a CACHE rebuilt from the shops' own feeds) and its signing key
// (directory.key, 0600, only for its Agent Card). Losing the volume loses nothing the shops do not hold: the feeds are read again.
//
// How it reaches shops: a feed or a check at an address under a pages domain it serves goes through THE DOOR'S OWN PORT (http://door:8798, the same routes a visitor has, with no
// per-visitor limits, as the door sees one visitor otherwise and would stop a busy directory); any other address (a configured feed on a builder's own domain) is read directly,
// under the door's rules for an outgoing address: https only, a DNS name, the name resolved here and refused when any answer is a private, loopback, link-local or reserved address,
// connected to the address checked, no redirect followed, the body capped. A feed is capped at 1 MB while it is read.
//
// A shop whose feed came signed by a key other than the one pinned is HELD (its items leave every search) and the change is listed for a person: the service says so in its log
// every time it happens, and `docker exec <directory> node /app/bundle/services/directory.ts changes` lists them, `... accept <shop page>` accepts one (the shop is read again at
// once). There is no panel view of them yet (bundle/Deferred.md).
//
// Every 20 seconds it reads the feeds that are due (modules/discovery/refresh.ts): hinted by a notice (at most once a minute per feed), never read, or not read for six hours.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { DirectoryIndex } from "../../modules/discovery/index.ts";
import { directoryCard } from "../../modules/discovery/card.ts";
import { createChecker } from "../../modules/discovery/check.ts";
import { assistantFromSettings } from "../../modules/discovery/assistant.ts";
import type { AssistantSettings } from "../../modules/discovery/assistant.ts";
import { directoryHandler } from "../../modules/discovery/http.ts";
import { feedAllowed } from "../../modules/discovery/notices.ts";
import { refreshDue } from "../../modules/discovery/refresh.ts";
import { generateSigningKey, privateText, signingKeyFromText } from "../../modules/signing/keys.ts";
import type { SigningKey } from "../../modules/signing/keys.ts";
import type { Fetcher } from "../../modules/discovery/types.ts";
import { DIRECTORY_PORT, guardedLookup, nodeTransport, originProblem } from "./door.ts";
import type { Transport } from "./door.ts";

/** The directory's config file (generate/configs.ts directoryConfig writes it). */
export interface DirectoryConfig {
  /** https://<the primary pages domain>: the directory's own address, which its pages, its card and its photos' address rule use. */
  origin: string;
  /** The pages domains it serves: a notice is accepted for a feed under one of them, and an address under one is read through the door. */
  served: string[];
  /** The door's own port (http://door:8798). */
  doorUrl: string;
  /** Where it keeps its files, inside its own volume. */
  dataDir: string;
  /** Feed addresses to read besides the shops that send notices (a builder's own domain). */
  feeds: string[];
  provider: { organization: string; url: string };
  area?: string;
  /**
   * The buyer's assistant (modules/discovery/assistant.ts). Left out, and so OFF, until the owner approves the price list that holds the directory's budget (`ai.budget.discovery`): the
   * search page then has no "Ask in your own words" box and the plain search works exactly as before. The bundle does not write this block yet (Deferred).
   */
  assistant?: AssistantSettings;
}

/**
 * The directory's way out: this server's own shops through the door's own port (with the pages domain as the Host the door expects), anything else directly and guarded. Tests give
 * their own transports. The answer's body is cut off by the transport at 2 MB; a feed over `maxBytes` (1 MB) is refused here.
 */
export function directoryFetcher(o: { served: readonly string[]; doorUrl: string; local?: Transport; remote?: Transport }): Fetcher {
  const local = o.local ?? nodeTransport();
  const remote = o.remote ?? nodeTransport(guardedLookup());
  return async (url, init) => {
    const u = new URL(url);
    const viaDoor = u.protocol === "https:" && !u.port && o.served.includes(u.hostname);
    let target: URL;
    const headers: Record<string, string> = { ...(init.headers ?? {}), "user-agent": "geometer-directory/1" };
    if (viaDoor) { target = new URL(`${u.pathname}${u.search}`, o.doorUrl); headers.host = u.hostname; } else {
      const problem = originProblem(u.origin);
      if (problem) throw new Error(`not an address the directory reads (${problem})`);
      target = u;
    }
    const body = init.body === undefined ? undefined : Buffer.from(init.body, "utf8");
    if (body) headers["content-length"] = String(body.length);
    const up = await (viaDoor ? local : remote)(target, { method: init.method, headers, ...(body ? { body } : {}), timeoutMs: init.timeoutMs });
    if (up.body.length > init.maxBytes) throw new Error("the answer was too big");
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(up.headers)) if (typeof v === "string") lower[k.toLowerCase()] = v;
    return { status: up.status, headers: lower, body: up.body.toString("utf8") };
  };
}

/** The directory's signing key: read from its folder, or made there on the first start (0600; the folder is its own volume). */
export function loadKey(dataDir: string): SigningKey {
  const file = join(dataDir, "directory.key");
  if (existsSync(file)) return signingKeyFromText(readFileSync(file, "utf8").trim());
  const key = generateSigningKey();
  writeFileSync(file, `${privateText(key)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(file, 0o600);
  return key;
}

if (import.meta.main) {
  const config = JSON.parse(readFileSync(process.env.CONFIG ?? "/etc/geometer/directory.json", "utf8")) as DirectoryConfig;
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const log = (line: string) => console.error(line);
  const index = new DirectoryIndex(join(config.dataDir, "directory.sqlite"));
  // the person's side: list the key changes that wait, or accept one (run beside the service, in its container, through `docker exec`)
  if (process.argv[2] === "changes") {
    const list = index.keyChanges();
    console.log(list.length === 0 ? "No key change waits." : list.map((c) => `${c.page}  pinned ${c.pinnedKeyId}  offered ${c.offeredKeyId}  seen ${new Date(c.seenAt).toISOString()}`).join("\n"));
    process.exit(0);
  }
  if (process.argv[2] === "accept") {
    const ok = index.acceptKeyChange(String(process.argv[3] ?? ""), Date.now());
    console.log(ok ? "Accepted: the shop's feed is read again within a minute." : "No key change waits for that shop page.");
    process.exit(ok ? 0 : 1);
  }
  const now = Date.now();
  for (const url of config.feeds) { if (feedAllowed(url, { served: config.served, configured: config.feeds })) index.addFeed(url, "config", now); else log(`directory: ${url} is not a feed address it will read`); }
  const fetch = directoryFetcher({ served: config.served, doorUrl: config.doorUrl });
  const key = loadKey(config.dataDir);
  const assistant = assistantFromSettings(config.assistant, process.env, log);
  const card = directoryCard({ origin: config.origin, provider: config.provider, ...(config.area ? { area: config.area } : {}), key, ...(assistant ? { assistant: true } : {}) });
  const handler = directoryHandler({
    search: { index, checker: createChecker({ fetch }), origin: config.origin }, origin: config.origin,
    card: () => card, notices: { served: config.served, configured: config.feeds }, log, ...(assistant ? { assistant } : {}),
  });
  const server = createServer(handler);
  server.requestTimeout = 15_000;
  server.headersTimeout = 5_000;
  server.listen(Number(process.env.PORT ?? DIRECTORY_PORT), process.env.HOST ?? "127.0.0.1", () => log(`The directory listens for ${config.origin}: ${index.counts().items} items from ${index.counts().shops} shops; ${index.keyChanges().length} key changes wait for a person.`));
  // read the feeds that are due: now, then every 20 seconds (a hint waits at most that long after its minute; a first read is at once)
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const done = await refreshDue({ index, fetch });
      // what a person needs to hear: a held shop, a refused feed, a dropped one (a feed address is public; nothing about a buyer is ever here)
      for (const [url, result] of Object.entries(done)) if (result === "held" || result === "refused" || result === "dropped") log(`directory: ${url} was ${result}${result === "held" ? ` (a key change waits for a person: ${index.keyChanges().length} in all)` : result === "refused" ? ` (${index.feed(url)?.error ?? "not a good feed"})` : ""}`);
    } catch (e) { log(`directory: a refresh failed (${(e as Error).name})`); } finally { running = false; }
  };
  void tick();
  setInterval(() => void tick(), 20_000).unref();
}
