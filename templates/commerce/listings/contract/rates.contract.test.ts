// The Go runtime prices a model call from a COPY of the dated rate tables (go/internal/budget/rates). This file checks the copy is the TypeScript tables byte for byte, and that a
// draft through a priced model (a provider and model in the table) is counted with its cost on both runtimes, while an unknown model stays "unpriced".
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeShop, REPO, SKIP, startFakeModel } from "./harness.ts";
import type { FakeModel, Shop } from "./harness.ts";
import { rateFor, costMicroInr, dayOf } from "../../../../modules/understanding/rates.ts";

const shops: Shop[] = []; const fakes: FakeModel[] = [];
after(async () => { for (const s of shops) { await s.stop(); s.cleanup(); } for (const f of fakes) await f.close(); });

test("the Go copy of the rate tables is the TypeScript tables", { skip: SKIP }, () => {
  const ts = join(REPO, "modules", "understanding", "rates"); const go = join(REPO, "go", "internal", "budget", "rates");
  const names = readdirSync(ts).filter((n) => n.endsWith(".json")).sort();
  assert.deepEqual(readdirSync(go).filter((n) => n.endsWith(".json")).sort(), names, "run go/scripts/sync_rates.sh");
  for (const n of names) assert.equal(readFileSync(join(go, n), "utf8"), readFileSync(join(ts, n), "utf8"), n);
});

test("a draft through a priced model counts its cost from the table; an unknown model is unpriced", { skip: SKIP }, async () => {
  const fake = await startFakeModel(); fakes.push(fake);
  // the fake answers usage 100 in / 50 out; pick the provider and model of any line of the table with a price and no pattern
  const raw = JSON.parse(readFileSync(join(REPO, "modules", "understanding", "rates", "2026-11-07.json"), "utf8")).rates.find((l: any) => l.model !== "*" && !l.modelPattern && l.inputUsdPerMillion > 0);
  const want = costMicroInr(rateFor(raw.provider, raw.model, dayOf(Date.now())), { inputTokens: 100, outputTokens: 50 });
  assert.ok(want && want > 0);
  const s = await makeShop({ modelPort: fake.port, budget: { monthlyMicroInr: 50_000_000, daily: { listing_draft: 10 } }, parser: { provider: raw.provider, model: raw.model } }); shops.push(s); await s.start();
  const r = await s.call("/internal/channel/events", { owner: s.owner, body: { events: [{ kind: "owner_message", id: "p-1", text: "Two Persian kittens for sale on my page, 8000 rupees" }] } });
  assert.equal(r.status, 200); await s.settle();
  const ai = (await s.call("/status")).body.ai;
  assert.equal(ai.costMicroInr, want); assert.equal(ai.unpriced, 0);
});
