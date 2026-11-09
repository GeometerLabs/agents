// The backup's cost ceiling, enforced: what one nightly snapshot asks of the bucket, counted request by request at the HTTP layer (a bucket bills per request, and a
// list is paged at 1,000 keys), is a fixed number per shop: a small constant times its database files (the runtime and each Guard), whatever the shop holds. An empty
// shop and one with thousands of record entries and a Guard ledger of many files make exactly the same requests, night after night, for longer than the keep period.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity } from "../backup/age.ts";
import { fetchSnapshot } from "../backup/restore-snapshot.ts";
import { snapshotShop } from "../backup/snapshot.ts";
import { s3Store } from "../backup/store.ts";
import { openStore } from "../../templates/commerce/bookings/server/store.ts";

type Counts = { PUT: number; GET: number; LIST: number; DELETE: number };

/** An S3-compatible bucket in memory, behind a fetch: PUT, GET, DELETE of an object, and ListObjectsV2 in pages of 1,000 keys, each request counted. */
function countingBucket() {
  const objects = new Map<string, Buffer>();
  const counts: Counts = { PUT: 0, GET: 0, LIST: 0, DELETE: 0 };
  const fetchFn = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const [, , ...rest] = url.pathname.split("/");
    const key = rest.map(decodeURIComponent).join("/");
    const method = init?.method ?? "GET";
    if (method === "GET" && key === "") {
      counts.LIST++;
      const prefix = url.searchParams.get("prefix") ?? "";
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = Number(url.searchParams.get("continuation-token") ?? 0);
      const page = all.slice(from, from + 1000);
      const more = from + 1000 < all.length;
      const xml = `<ListBucketResult><IsTruncated>${more}</IsTruncated>${page.map((k) => `<Contents><Key>${k}</Key><LastModified>2026-11-04T01:30:00.000Z</LastModified></Contents>`).join("")}${more ? `<NextContinuationToken>${from + 1000}</NextContinuationToken>` : ""}</ListBucketResult>`;
      return new Response(xml, { status: 200 });
    }
    if (method === "PUT") { counts.PUT++; objects.set(key, Buffer.from(init!.body as Uint8Array)); return new Response("", { status: 200 }); }
    if (method === "DELETE") { counts.DELETE++; objects.delete(key); return new Response("", { status: 204 }); }
    counts.GET++;
    const o = objects.get(key);
    return o ? new Response(o, { status: 200 }) : new Response("", { status: 404 });
  }) as typeof fetch;
  return { objects, counts, store: s3Store({ url: "s3://snaps", endpoint: "http://bucket.test", accessKeyId: "A", secretAccessKey: "B" }, fetchFn) };
}

/** A runtime database with this many record entries, and a Guard backup folder as Guard writes it, with this many evidence segments (one per 500 decisions). */
function shopFiles(dir: string, records: number, segments: number, guards: string[]): { runtimeDb: string; guards: { kind: string; dir: string }[] } {
  const store = openStore(join(dir, "rt"));
  const entry = (i: number) => ({ seq: i, time: "2026-11-04T10:00:00Z", conversation: `c-${i % 50}`, booking: `b-${i % 400}`, action: "send_message", outcome: "confirmed" }) as never;
  for (let i = 1; i <= records; i += 500) store.commitStep({ snapshot: JSON.stringify({ format: 1, note: "x".repeat(200) }), entries: Array.from({ length: Math.min(500, records - i + 1) }, (_, k) => entry(i + k)), nowMs: Date.now() });
  store.close();
  const write = () => guards.map((kind) => {
    const g = join(dir, "guards", kind); rmSync(g, { recursive: true, force: true }); mkdirSync(join(g, "evidence", "acme"), { recursive: true });
    for (const f of ["state.db", "anchor.json", "evidence-pack.json", "backup.json"]) writeFileSync(join(g, f), `${kind} ${f} ${"y".repeat(100)}`);
    for (let s = 0; s < segments; s++) writeFileSync(join(g, "evidence", "acme", `seg-${String(s * 500 + 1).padStart(20, "0")}.jsonl`), "z".repeat(1000));
    return { kind, dir: g };
  });
  return { runtimeDb: join(dir, "rt", "agent.db"), get guards() { return write(); } };
}

const stampOf = (day: number) => new Date(Date.UTC(2026, 9, 1 + day, 1, 30)).toISOString().replace(/[-:]|\.\d{3}/gu, "");

async function nights(records: number, segments: number, guards: string[], n: number): Promise<Counts[]> {
  const dir = mkdtempSync(join(tmpdir(), "geo-cost-"));
  try {
    const files = shopFiles(dir, records, segments, guards);
    const bucket = countingBucket();
    const recipients = [generateIdentity().recipient, generateIdentity().recipient];
    const per: Counts[] = [];
    for (let day = 0; day < n; day++) {
      const before = { ...bucket.counts };
      const r = await snapshotShop({ name: "glow-salon", runtimeDb: files.runtimeDb, guards: files.guards }, { stamp: stampOf(day), keepDays: 30, recipients, target: { url: "s3://snaps" }, shops: [] }, bucket.store, join(dir, "scratch"));
      assert.equal(r.ok, true, r.error);
      per.push({ PUT: bucket.counts.PUT - before.PUT, GET: bucket.counts.GET - before.GET, LIST: bucket.counts.LIST - before.LIST, DELETE: bucket.counts.DELETE - before.DELETE });
    }
    return per;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** The constant the README states: per database file one PUT a night, plus the manifest; one LIST a night; once the keep period is full, as many DELETEs as PUTs. */
const expected = (guards: number, full: boolean): Counts => ({ PUT: 1 + guards + 1, GET: 0, LIST: 1, DELETE: full ? 1 + guards + 1 : 0 });

test("one night's bucket requests per shop are a fixed constant times its database files: an empty shop and one with thousands of records make the same, for 35 nights", async () => {
  const guards = ["razorpay", "whatsapp", "calendar"];
  const empty = await nights(0, 1, guards, 35);
  const busy = await nights(3000, 40, guards, 35); // 3,000 record entries; each Guard's ledger 40 files (20,000 decisions)
  assert.deepEqual(busy, empty, "the shop's size changes nothing");
  // nights 0 to 30 keep everything (30 days); from night 31 the night that ages out is deleted, one object for one object
  empty.forEach((c, day) => assert.deepEqual(c, expected(guards.length, day > 30), `night ${day}`));
  // a shop with two Guards (Fees: Razorpay and WhatsApp) costs one object less a night
  assert.deepEqual((await nights(10, 3, ["razorpay", "whatsapp"], 1))[0], expected(2, false));
});

test("the weekly drill and `restore` read one snapshot with one LIST and two GETs (the manifest and the runtime's database), whatever the shop holds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-cost-"));
  try {
    const files = shopFiles(dir, 3000, 40, ["razorpay", "whatsapp", "calendar"]);
    const bucket = countingBucket();
    const drill = generateIdentity();
    for (let day = 0; day < 5; day++) await snapshotShop({ name: "glow-salon", runtimeDb: files.runtimeDb, guards: files.guards }, { stamp: stampOf(day), keepDays: 30, recipients: [generateIdentity().recipient, drill.recipient], target: { url: "s3://snaps" }, shops: [] }, bucket.store, join(dir, "scratch"));
    const before = { ...bucket.counts };
    const got = await fetchSnapshot(bucket.store, "glow-salon", drill.identity);
    assert.equal(got.stamp, stampOf(4));
    assert.deepEqual({ PUT: bucket.counts.PUT - before.PUT, GET: bucket.counts.GET - before.GET, LIST: bucket.counts.LIST - before.LIST, DELETE: bucket.counts.DELETE - before.DELETE }, { PUT: 0, GET: 2, LIST: 1, DELETE: 0 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
