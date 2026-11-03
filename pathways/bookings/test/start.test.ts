// Starting a client for real: from its folder, with its token file, in this process and as the command line does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientError } from "../server/config.ts";
import { startClient } from "../server/start.ts";
import { openStore } from "../server/store.ts";

const EXAMPLE = new URL("../clients/glow-salon.example", import.meta.url).pathname;
const MAIN = new URL("../server/main.ts", import.meta.url).pathname;
const TOKEN = "0123456789abcdef0123456789abcdef";

/** A temp copy of the example client (listening on a free port) and a token file. */
function setup(runtime: object = { mode: "fakes", port: 0, tickSeconds: 1 }, lock = "bookings@0.1.0\n") {
  const root = mkdtempSync(join(tmpdir(), "geo-start-"));
  const folder = join(root, "glow");
  cpSync(EXAMPLE, folder, { recursive: true });
  writeFileSync(join(folder, "runtime.json"), JSON.stringify(runtime));
  writeFileSync(join(folder, "pathway.lock"), lock);
  const tokenFile = join(root, "token");
  writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
  return { root, folder, tokenFile, done: () => rmSync(root, { recursive: true, force: true }) };
}

const event = (id: string) => ({ events: [{ kind: "message", message: { id, from: "+919811111111", text: "hello", timestamp: Date.now() } }] });
const post = (url: string, body: unknown) => fetch(`${url}/internal/events`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });

test("a client starts from its folder, answers with its token, keeps its data in its own folder, and picks up where it stopped", async () => {
  const s = setup();
  const lines: string[] = [];
  try {
    const first = await startClient({ clientFolder: s.folder, tokenFile: s.tokenFile, log: (l) => lines.push(l) });
    assert.equal(first.server.host, "127.0.0.1");
    assert.equal((await fetch(`${first.server.url}/healthz`)).status, 200);
    assert.equal((await post(first.server.url, event("wamid.1"))).status, 200);
    await first.runtime.idle();
    assert.ok(lines.some((l) => l.startsWith("[stand-in WhatsApp]")), "a local run shows what the stand-in WhatsApp was asked to send");
    assert.equal((await fetch(`${first.server.url}/status`)).status, 401);
    await first.stop();
    assert.ok(existsSync(join(s.folder, "data", "agent.db")));

    // A task saved but not finished when the process stopped, as a kill would leave it: put straight into the store.
    const store = openStore(join(s.folder, "data"));
    store.saveEvents([{ kind: "message", message: { id: "wamid.left-over", from: "+919822222222", text: "hello", timestamp: Date.now() } }], Date.now());
    store.close();
    const second = await startClient({ clientFolder: s.folder, tokenFile: s.tokenFile, log: (l) => lines.push(l) });
    await second.runtime.idle();
    assert.deepEqual(second.runtime.status().tasks, { pending: 0, done: 2, failed: 0 });
    assert.ok(lines.some((l) => /Picking up 1 saved task/.test(l)));
    assert.ok(lines.some((l) => /remembers earlier bookings/.test(l)), "fakes mode warns that the stand-ins forgot");
    await second.stop();
  } finally { s.done(); }
});

test("a client pinned to another version does not start, and does not even create its data folder", async () => {
  const s = setup(undefined, "bookings@0.0.1\n");
  try {
    await assert.rejects(startClient({ clientFolder: s.folder, tokenFile: s.tokenFile, log: () => undefined }), (e: Error) => e instanceof ClientError && /bookings@0\.0\.1/.test(e.message) && /bookings@0\.1\.0/.test(e.message));
    assert.ok(!existsSync(join(s.folder, "data")));
  } finally { s.done(); }
});

test("live mode without live adapters does not start, and leaves the data folder usable", async () => {
  const live = { mode: "live", port: 0, services: { payments: { baseUrl: "http://g1" }, calendar: { baseUrl: "http://g2", calendarId: "c" }, messaging: { baseUrl: "http://g3", phoneNumberId: "p" } } };
  const s = setup(live);
  try {
    const refuse = async () => { throw new ClientError("no live adapters here"); };
    await assert.rejects(startClient({ clientFolder: s.folder, tokenFile: s.tokenFile, log: () => undefined, loadLive: refuse }), /no live adapters here/);
    const again = await startClient({ clientFolder: s.folder, tokenFile: s.tokenFile, log: () => undefined, loadLive: async () => ({ createLiveAdapters: () => { throw new ClientError("second try"); } }) }).catch((e: Error) => e);
    assert.match((again as Error).message, /second try/); // the store was closed the first time, so it opens again
  } finally { s.done(); }
});

/** Run main.ts as the command line, and collect what it prints. */
function run(args: string[], env: Record<string, string | undefined>) {
  const child = spawn(process.execPath, [MAIN, ...args], { env: { ...process.env, INTERNAL_TOKEN_FILE: undefined, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { out += c; });
  const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
  return { child, exited, output: () => out };
}

test("main.ts: a wrong pin prints both versions and exits 1; a missing token file says what to set", async () => {
  const s = setup(undefined, "bookings@7.7.7\n");
  try {
    const wrong = run(["--client", s.folder], { INTERNAL_TOKEN_FILE: s.tokenFile });
    assert.equal(await wrong.exited, 1);
    assert.match(wrong.output(), /pinned to bookings@7\.7\.7/);
    assert.match(wrong.output(), /this runtime is bookings@0\.1\.0/);

    writeFileSync(join(s.folder, "pathway.lock"), "bookings@0.1.0\n");
    const noToken = run(["--client", s.folder], {});
    assert.equal(await noToken.exited, 1);
    assert.match(noToken.output(), /Set INTERNAL_TOKEN_FILE/);

    const noClient = run([], {});
    assert.equal(await noClient.exited, 2);
    assert.match(noClient.output(), /--client <folder>/);
  } finally { s.done(); }
});

test("main.ts: runs the example client, serves, and stops cleanly on SIGTERM", async () => {
  const s = setup();
  const r = run(["--client", s.folder], { INTERNAL_TOKEN_FILE: s.tokenFile });
  try {
    let url: string | undefined;
    for (let i = 0; i < 400 && !url; i++) { url = /Listening on (http:\/\/\S+)/.exec(r.output())?.[1]; if (!url) await new Promise((res) => setTimeout(res, 10)); }
    assert.ok(url, r.output());
    assert.deepEqual(await (await fetch(`${url}/healthz`)).json(), { ok: true });
    assert.match(r.output(), /Stand-in services: nothing real is contacted/);
    assert.match(r.output(), /bookings@0\.1\.0/);
    r.child.kill("SIGTERM");
    assert.equal(await r.exited, 0);
  } finally { r.child.kill("SIGKILL"); s.done(); }
});
