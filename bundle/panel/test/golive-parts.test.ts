// The go-live gate on a shop of several parts (decision 65): the panel's hand check of the starter shop (the credit book, Stock orders and the pickup hold) runs the shop's own
// situations and every part's own, all on go/cmd/parts (templates/commerce/parts/crash-test/hand-check.ts), and the gate reads them: every part's situations counted, the
// summary naming the parts program, each part's certificate written in a folder of its own. A summary in which a part ran nothing is a part that did not pass.
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goSkip } from "../../../modules/crash-test/go-shop.ts";
import { runGoHandCheck } from "../../lib/hand-check-go.ts";
import { KINDS } from "../../lib/kinds.ts";
import { createGoLive } from "../golive.ts";
import { createShops } from "../shops.ts";
import { openStores } from "../server.ts";
import { boot } from "./helpers.ts";

const PARTS = new URL("../../../templates/commerce/parts/", import.meta.url).pathname;
const version = (JSON.parse(readFileSync(join(PARTS, "package.json"), "utf8")) as { version: string }).version;
const skip = goSkip("parts") ?? goSkip("orders") ?? goSkip("fees") ?? goSkip("stock-orders");

test("the starter shop of three parts: every part's situations run on the parts program, and the gate takes the hand check", { skip }, async () => {
  const b = await boot({ handCheck: (kind, file) => runGoHandCheck(kind, file) }, { signing: true });
  try {
    const shop = join(b.dir, "shops", "ganesh");
    mkdirSync(shop, { recursive: true });
    cpSync(join(PARTS, "settings", "ganesh-electricals-starter.example.json"), join(shop, "settings.json"));
    writeFileSync(join(shop, "pathway.lock"), `parts@${version}\n`);
    writeFileSync(join(shop, "runtime.json"), JSON.stringify({ mode: "live", tickSeconds: 30, services: { messaging: { phoneNumberId: "100000000000001" }, timeoutMs: 20000 } }));
    const { store } = openStores(b.config);
    const shops = createShops(b.config, store);
    const live = createGoLive(b.config, shops, store);
    const ran = await live.run("ganesh");
    const parts = (ran?.hand as { parts?: { name: string; summary: { total: number; held: number } }[] } | undefined)?.parts ?? [];
    assert.deepEqual(parts.map((p) => p.name), ["fees", "stock-orders", "orders"], "each part's own situations ran");
    for (const p of parts) assert.ok(p.summary.total > 0 && p.summary.held === p.summary.total, `${p.name}: ${JSON.stringify(p.summary)}`);
    assert.ok(ran && ran.hand.held === ran.hand.total && ran.hand.total > parts.reduce((n, p) => n + p.summary.total, 0), "the shop's own situations are counted too");
    assert.equal(ran.hand.program?.name, "parts", "it ran on the parts program");
    assert.equal(ran.settingsDigest, KINDS.parts.papers!.policyDigest(shops.settings("ganesh")));
    assert.ok(!live.unmet("ganesh", shops.settings("ganesh")).includes("hand-check"), "the hand check stands");
    const dir = mkdtempSync(join(tmpdir(), "golive-parts-"));
    const { files } = KINDS.parts.papers!.writeGoLiveCertificate({ settings: shops.settings("ganesh"), handCheck: ran.hand, language: "en", out: dir, key: generateKeyPairSync("ed25519").privateKey, now: Date.UTC(2026, 10, 25) });
    for (const p of ["fees", "stock-orders", "orders"]) assert.ok(files.some((f) => f.includes(`/${p}/go-live-certificate.json`)), `${p}'s certificate`);
  } finally { await b.close(); }
});

test("a parts shop's summary with a part that ran nothing is not a pass", () => {
  const checked = KINDS.parts.validateSettings(JSON.parse(readFileSync(join(PARTS, "settings", "ganesh-electricals-starter.example.json"), "utf8")));
  assert.ok(checked.ok);
  const summary = KINDS.parts.papers!.summariseRun({
    results: [], skipped: [], settings: checked.settings,
    shop: { results: [], skipped: [] }, parts: [{ name: "fees", run: { results: [], skipped: [{ id: "all", title: "Every situation", reason: "the program is not here" }], settings: {} } }],
  } as never);
  assert.equal(summary.total, 1);
  assert.equal(summary.held, 0);
  assert.match(summary.failedTitles.join(" "), /fees: no situation of this part could run/u);
});
