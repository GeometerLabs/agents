// Telling fleet about a move (block S): after the owner's own code moved a shop, the deployer tells fleet who holds it now, once per move, with the server's own deployment key,
// and the panel can say what came of it. A refusal in words is kept and not repeated; an unreachable fleet, or one that does not know the route yet, is asked again later.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RETRY_MS, readFleetMoveStatus, syncFleetMoves, writeFleetMove } from "../lib/fleet-move.ts";
import type { ServerConfig } from "../lib/server.ts";

const dirs: string[] = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const T0 = new Date("2026-11-18T10:00:00Z");

function world(o: { fleet?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "fleet-move-"));
  dirs.push(dir);
  mkdirSync(join(dir, "shops", "glow"), { recursive: true });
  writeFileSync(join(dir, "fleet.key"), "gdk_test_key_for_this_test\n", { mode: 0o600 });
  const server = { fleet: o.fleet === false ? undefined : { url: "https://fleet.example", keyFile: "fleet.key" } } as unknown as ServerConfig;
  const calls: { url: string; auth: string; body: unknown }[] = [];
  let reply: { status: number; body: unknown } | "down" = { status: 200, body: { shop: { moved: true } } };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, auth: String((init.headers as Record<string, string>).authorization), body: JSON.parse(String(init.body)) });
    if (reply === "down") throw new Error("connect ECONNREFUSED");
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const run = (at = T0) => syncFleetMoves({ dir, server, shops: ["glow"], now: at, fetchImpl });
  return { dir, calls, run, answer: (r: typeof reply) => { reply = r; } };
}
const move = (hash = "a".repeat(64), partner: string | null = "ravi") => ({ codeHash: hash, partner, to: "Ravi Digital", at: T0.toISOString() });

test("a finished move is told to fleet with the server's own key, naming the shop and the new Operator, and only once", async () => {
  const w = world();
  writeFleetMove(w.dir, "glow", move());
  await w.run();
  assert.deepEqual(w.calls, [{ url: "https://fleet.example/v1/shops/glow/partner", auth: "Bearer gdk_test_key_for_this_test", body: { partner: "ravi" } }]);
  assert.equal(readFleetMoveStatus(w.dir, "glow")?.state, "told");
  await w.run(new Date(T0.getTime() + 3_600_000));
  assert.equal(w.calls.length, 1, "asked once for this move");
});

test("a fleet that cannot be reached, or does not know the route yet (before its deploy), is asked again after ten minutes", async () => {
  const w = world();
  writeFleetMove(w.dir, "glow", move());
  w.answer("down");
  await w.run();
  assert.equal(readFleetMoveStatus(w.dir, "glow")?.state, "waiting");
  await w.run(new Date(T0.getTime() + RETRY_MS - 1));
  assert.equal(w.calls.length, 1);
  w.answer({ status: 404, body: { error: "There is nothing here." } });
  await w.run(new Date(T0.getTime() + RETRY_MS));
  assert.equal(w.calls.length, 2);
  assert.equal(readFleetMoveStatus(w.dir, "glow")?.state, "waiting");
  w.answer({ status: 200, body: { shop: { moved: true } } });
  await w.run(new Date(T0.getTime() + 2 * RETRY_MS));
  assert.equal(readFleetMoveStatus(w.dir, "glow")?.state, "told");
});

test("fleet's refusal in words is kept for the panel and not sent again for this move; a later move is asked on its own", async () => {
  const w = world();
  writeFleetMove(w.dir, "glow", move());
  w.answer({ status: 400, body: { error: "\"ravi\" does not serve on acme yet, so this server cannot give them a shop." } });
  const lines = await w.run();
  assert.equal(readFleetMoveStatus(w.dir, "glow")?.state, "refused");
  assert.match(readFleetMoveStatus(w.dir, "glow")!.message!, /does not serve on acme yet/u);
  assert.match(lines[0], /did not take the move/u);
  await w.run(new Date(T0.getTime() + 3_600_000));
  assert.equal(w.calls.length, 1);
  w.answer({ status: 200, body: { shop: { moved: true } } });
  writeFleetMove(w.dir, "glow", move("b".repeat(64), "asha"));
  await w.run(new Date(T0.getTime() + 7_200_000));
  assert.deepEqual(w.calls.at(-1)?.body, { partner: "asha" });
  assert.equal(readFleetMoveStatus(w.dir, "glow")?.state, "told");
});

test("an Operator account with no id in fleet, and a server not paired with fleet, call nothing and say why", async () => {
  const noId = world();
  writeFleetMove(noId.dir, "glow", move("c".repeat(64), null));
  await noId.run();
  assert.equal(noId.calls.length, 0);
  assert.equal(readFleetMoveStatus(noId.dir, "glow")?.state, "no_id");
  const unpaired = world({ fleet: false });
  writeFleetMove(unpaired.dir, "glow", move());
  await unpaired.run();
  assert.equal(unpaired.calls.length, 0);
  assert.equal(readFleetMoveStatus(unpaired.dir, "glow")?.state, "no_fleet");
});

test("a shop that was never moved calls nothing", async () => {
  const w = world();
  await w.run();
  assert.equal(w.calls.length, 0);
});
