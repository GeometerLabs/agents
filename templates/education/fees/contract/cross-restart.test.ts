// A shop stopped and started again on one folder: the store file (agent.db, its tables, the record, the queue) and the files beside it carry everything over, and the
// shop goes on from where it stopped. Until 24 Nov 2026 this ran the TypeScript runtime and the Go runtime in turn, both ways (decision 61: a shop could move between them
// and lose nothing); the TypeScript runtime was deleted then, so it is the Go program twice. Without the Go binary (go/bin/fees, or FEES_GO_BIN) it is skipped and
// says so.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { OWNER_NUMBER, REPO, ROHAN, lines, makeCentre } from "./harness.ts";
import type { Centre } from "./harness.ts";

const GO = process.env.FEES_GO_BIN ?? join(REPO, "go", "bin", "fees");
const SKIP = existsSync(GO) ? undefined : "the Go Fees program is not built (go build -o go/bin/ ./cmd/fees, or set FEES_GO_BIN)";
const centres: Centre[] = [];
after(async () => { for (const c of centres) await c.cleanup(); });

for (const [first, second] of [["go", "go"]] as const) {
  test(`a UPI centre started on ${first} and started again on ${second} keeps its fees, the owner's code, the parent's link, its record and its queue, and goes on`, { skip: SKIP }, async () => {
    const c = await makeCentre({ mode: "guards" }); centres.push(c);
    await c.start(first);
    await c.waitFor(() => lines(c, "open_fee", "confirmed").length === 2, "the two earlier months opened");
    await c.inbound(ROHAN, "hello");
    const row = ((await c.ownerView()).body.parents as { phone: string; ref: string; digest: string }[]).find((p) => p.phone === ROHAN)!;
    await c.ownerAction("send_link", row.ref, row.digest);
    const hash = c.linkOf(ROHAN)!.hash;
    await c.inbound(ROHAN, "pay");
    const code = /received ([A-Z0-9]{4,})/u.exec(c.sent(OWNER_NUMBER).map((m) => m.text).reverse().find((t) => t.includes("f-2"))!)![1];
    const record = c.record().map((r) => [r.action, r.outcome]);
    const tasks = (await c.status()).tasks;
    const page = (await c.parent(hash)).body;
    await c.stop();
    await c.start(second);
    assert.deepEqual((await c.parent(hash)).body, page, "the parent's page is the same");
    assert.deepEqual(c.record().slice(0, record.length).map((r) => [r.action, r.outcome]), record, "the record is the same, line for line");
    assert.deepEqual((await c.status()).tasks, tasks);
    await c.inbound(OWNER_NUMBER, `received ${code}`);
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 }, "the code the first runtime gave is marked on the second");
    assert.match(c.sent(ROHAN).at(-1)!.text, /has received ₹1,800/u);
  });
}
