// Item 11f through a real Bookings runtime (stand-in services, started the way the bundle starts it): the page's sign-in request and the owner's "open my app"
// are the runtime core's, never the agent's (no "I didn't understand" goes back), and are written in the record; a sign-in link is used up once over the runtime's
// own route and the session it makes opens the owner's reads; the new events live in the real task store. The stand-in WhatsApp keeps its own 24-hour window,
// which events posted here never open, so the link itself is shown going out in modules/channels/test/owner-signin.test.ts; here the record says "blocked".
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { OWNER_SESSION_HEADER, OWNER_SIGNIN_HEADER, openOwnerAccess } from "../../../../modules/channels/owner-access.ts";
import { openStore } from "../server/store.ts";
import { startClient } from "../server/start.ts";

const INTERNAL = "internal-0123456789abcdef0123";
const CHANNEL = "channel-0123456789abcdef01234";
const OWNER = "+919000000000";
const OWNER_BASE = "https://pages.example/glow-salon/owner";

async function world() {
  const root = mkdtempSync(join(tmpdir(), "geo-signin-"));
  const folder = join(root, "glow");
  mkdirSync(folder);
  const settings = { ...JSON.parse(readFileSync(new URL("../settings/glow-salon-upi.example.json", import.meta.url), "utf8")), calendar: { module: "own" } };
  writeFileSync(join(folder, "settings.json"), JSON.stringify(settings));
  writeFileSync(join(folder, "runtime.json"), JSON.stringify({ mode: "fakes", port: 0, tickSeconds: 3600 }));
  writeFileSync(join(folder, "pathway.lock"), "bookings@0.1.0\n");
  // what the deployer hands the runtime (bundle/lib/pages.ts): where the owner's view is
  writeFileSync(join(folder, "pages.json"), JSON.stringify({ schema: 1, base: "https://partners.example/s/glow", ownerBase: OWNER_BASE, slug: "glow-salon", url: "https://pages.example/glow-salon" }));
  writeFileSync(join(root, "token"), INTERNAL);
  writeFileSync(join(root, "channel"), CHANNEL);
  const clock = fakeClock(Date.UTC(2026, 10, 16, 3, 30));
  const client = await startClient({ clientFolder: folder, tokenFile: join(root, "token"), channelTokenFile: join(root, "channel"), clock, log: () => undefined });
  const call = (path: string, token: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
    fetch(`${client.server.url}${path}`, { method: init.method ?? (init.body ? "POST" : "GET"), headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers }, ...(init.body ? { body: JSON.stringify(init.body) } : {}) });
  const record = () => { const s = openStore(join(folder, "data")); try { return s.loadState().record; } finally { s.close(); } };
  return { client, clock, folder, call, record, async done() { await client.stop(); rmSync(root, { recursive: true, force: true }); } };
}

test("the page's request and the owner's \"open my app\" are the core's: in the record, never answered by the agent", async () => {
  const w = await world();
  try {
    const before = w.record().length;
    // a number posted with the request is dropped by the event check; the runtime takes the owner's number from its settings
    const asked = await w.call("/internal/channel/events", CHANNEL, { body: { events: [{ kind: "owner_signin", id: "page-1", phone: "+919811111111" }] } });
    assert.equal(asked.status, 200);
    await w.client.runtime.idle();
    const owner = await w.call("/internal/events", INTERNAL, { body: { events: [{ kind: "message", message: { id: "wamid.owner-app", from: OWNER, text: "Open my app", timestamp: w.clock.now() } }] } });
    assert.equal(owner.status, 200);
    await w.client.runtime.idle();
    const fresh = w.record().slice(before);
    assert.deepEqual(fresh.map((e) => [e.action, e.conversation, e.refs.via]), [["owner_signin", OWNER, "page"], ["owner_signin", OWNER, "whatsapp"]], "two sign-in lines and nothing from the agent");
    assert.ok(!fresh.some((e) => e.conversation === "+919811111111"), "nothing about the number that was posted");
  } finally { await w.done(); }
});

test("a link is used up once over the runtime's route; its session opens the owner's reads and goes into the record", async () => {
  const w = await world();
  try {
    // the link as the core would have sent it (the stand-in's window never opens here), from the runtime's own access file
    const access = openOwnerAccess(join(w.folder, "data", "owner-access.sqlite"));
    const { token } = access.issue({ owner: OWNER, base: OWNER_BASE, via: "page", now: w.clock.now() });
    access.close();
    const used = await w.call("/internal/channel/owner-signin", CHANNEL, { method: "POST", headers: { [OWNER_SIGNIN_HEADER]: token } });
    assert.equal(used.status, 200);
    const { session } = await used.json() as { session: string };
    assert.equal((await w.call("/internal/channel/owner-signin", CHANNEL, { method: "POST", headers: { [OWNER_SIGNIN_HEADER]: token } })).status, 403, "once");
    assert.equal((await w.call("/internal/channel/owner", CHANNEL, { headers: { [OWNER_SESSION_HEADER]: session } })).status, 200);
    assert.equal((await w.call("/internal/channel/owner-signin", INTERNAL, { method: "POST", headers: { [OWNER_SIGNIN_HEADER]: token } })).status, 401, "only the channel token reaches the sign-in routes");
    await w.client.runtime.idle();
    assert.deepEqual(w.record().filter((e) => e.action === "owner_session").map((e) => e.refs.what), ["signed_in"]);
  } finally { await w.done(); }
});
