// The go-live gate on the hand check run on the shop's own Go program (owner, 24 Nov 2026: "Run the hand check on Go"). The panel runs the template's situations, each on the
// program of go/bin (GEOMETER_GO_PROGRAMS on a server), in a child process (bundle/lib/hand-check-go.ts), and keeps the summary as before. Each case is one the old path got
// wrong or could not do:
//   * a pickup-hold shop (Orders, advance "none") had 0 situations, so the gate refused it: now its hold situations run and the gate takes the hand check;
//   * a credit-book shop (Fees, decision 63) had every situation "not run": now its credit situations run and the gate takes it;
//   * the certificate made from such a run names the program it ran on and checks (its signature and its digest);
//   * a hand check that could not run (no program here) is kept as nothing held, with the reason, and the gate refuses it; a stored check from before (no program) is refused too;
//   * a deliberately broken setting fails it (a fee above the day's refund cap the deployer gives Guard), and a setting changed after the check is "settings changed".
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goSkip } from "../../../modules/crash-test/go-shop.ts";
import { verifyEnvelopeText } from "../../../modules/report/sign.ts";
import { runGoHandCheck } from "../../lib/hand-check-go.ts";
import { KINDS } from "../../lib/kinds.ts";
import { createGoLive } from "../golive.ts";
import { createShops } from "../shops.ts";
import { openStores } from "../server.ts";
import { boot } from "./helpers.ts";
import type { Boot } from "./helpers.ts";

const TEMPLATES = new URL("../../../templates/", import.meta.url).pathname;
const versionOf = (folder: string): string => (JSON.parse(readFileSync(join(TEMPLATES, folder, "package.json"), "utf8")) as { version: string }).version;

/** A shop on the server as `shop add` makes one: a template's example settings and the pin. */
function addShop(b: Boot, id: string, folder: string, example: string, pathway: string): void {
  const shop = join(b.dir, "shops", id);
  mkdirSync(shop, { recursive: true });
  cpSync(join(TEMPLATES, folder, "settings", example), join(shop, "settings.json"));
  writeFileSync(join(shop, "pathway.lock"), `${pathway}@${versionOf(folder)}\n`);
  writeFileSync(join(shop, "runtime.json"), JSON.stringify({ mode: "live", tickSeconds: 30, services: { messaging: { phoneNumberId: "100000000000001" }, timeoutMs: 20000 } }));
}

test("a pickup-hold shop: its hold situations run on the Orders program, and the hand check no longer stands between it and going live", { skip: goSkip("orders") }, async () => {
  const b = await boot({}, { signing: true });
  try {
    addShop(b, "ganesh", "commerce/orders", "ganesh-electricals-hold.example.json", "orders");
    const { store } = openStores(b.config);
    const shops = createShops(b.config, store);
    const live = createGoLive(b.config, shops, store);
    const ran = await live.run("ganesh");
    assert.ok(ran && ran.hand.total >= 4 && ran.hand.held === ran.hand.total, JSON.stringify(ran?.hand));
    assert.equal(ran.hand.program?.name, "orders", "the summary names the program it ran on");
    assert.match(ran.hand.program?.sha256 ?? "", /^[0-9a-f]{64}$/u);
    assert.equal(ran.settingsDigest, KINDS.orders.papers!.policyDigest(shops.settings("ganesh")));
    assert.ok(!live.unmet("ganesh", shops.settings("ganesh")).includes("hand-check"), "the hand check stands");
    // the certificate made from this run checks, and says what it ran on
    const cert = KINDS.orders.papers!.buildGoLiveCertificate({ settings: shops.settings("ganesh"), handCheck: ran.hand, issuedAt: Date.UTC(2026, 10, 24) });
    const dir = mkdtempSync(join(tmpdir(), "golive-go-"));
    const key = generateKeyPairSync("ed25519").privateKey;
    const { files } = KINDS.orders.papers!.writeGoLiveCertificate({ settings: shops.settings("ganesh"), handCheck: ran.hand, language: "en", out: dir, key, now: Date.UTC(2026, 10, 24) });
    const json = files.find((f) => f.endsWith(".json"))!;
    const v = verifyEnvelopeText(readFileSync(json, "utf8"));
    assert.equal(v.unchanged && v.signed, true, v.summary);
    assert.deepEqual((v.envelope!.document as { program?: unknown }).program, ran.hand.program, "the certificate names the program and its digest");
    assert.equal((cert as { checks: { total: number } }).checks.total, ran.hand.total);
    assert.ok(readFileSync(files.find((f) => f.endsWith(".html"))!, "utf8").includes(`Go orders ${ran.hand.program!.version}`), "and the page says it");
  } finally { await b.close(); }
});

test("a credit-book shop: its credit situations run on the Fees program, and the gate takes the hand check; a changed reminder hour is 'settings changed'", { skip: goSkip("fees") }, async () => {
  const b = await boot({}, { signing: true });
  try {
    addShop(b, "lakshmi", "education/fees", "hardware-credit.example.json", "fees");
    const { store } = openStores(b.config);
    const shops = createShops(b.config, store);
    const live = createGoLive(b.config, shops, store);
    const ran = await live.run("lakshmi");
    assert.ok(ran && ran.hand.total >= 4 && ran.hand.held === ran.hand.total, JSON.stringify(ran?.hand));
    assert.equal(ran.hand.program?.name, "fees");
    assert.ok(!live.unmet("lakshmi", shops.settings("lakshmi")).includes("hand-check"));
    const file = shops.settingsFile("lakshmi");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...raw, reminders: { ...raw.reminders, hour: 11 } }));
    assert.ok(live.unmet("lakshmi", shops.settings("lakshmi")).includes("settings-changed"), "the check ran on other settings than the ones the shop has now");
  } finally { await b.close(); }
});

test("a deliberately broken setting fails the hand check on the program: a centre whose fee is above what Guard lets be refunded in a day", { skip: goSkip("fees") }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "golive-go-broken-"));
  const raw = JSON.parse(readFileSync(join(TEMPLATES, "education/fees/settings/bright-tuition.example.json"), "utf8"));
  // a fee of ₹60,000 on a Razorpay centre: the day's refund cap the deployer gives Guard (₹5,000) is below it, so an approved refund of it could still be refused (src/guard-limits.ts)
  raw.batches[0].monthlyFeeInr = 60_000;
  const broken = join(dir, "settings.json");
  writeFileSync(broken, JSON.stringify(raw));
  const out = await runGoHandCheck("fees", broken);
  assert.equal(out.ok, true, JSON.stringify(out));
  if (!out.ok) return;
  assert.ok(out.summary.total > 0 && out.summary.held < out.summary.total, `the broken centre does not pass: ${out.summary.held} of ${out.summary.total}`);
  assert.ok(out.summary.failedTitles.length === out.summary.total - out.summary.held);
});

test("a hand check that cannot run is stored as nothing held, with the reason, and the gate refuses it; so is a stored check from before the switch to Go", async () => {
  const b = await boot({ handCheck: (kind, file) => runGoHandCheck(kind, file, { env: { GEOMETER_GO_PROGRAMS: join(tmpdir(), "no-programs-here") } }) }, { signing: true });
  try {
    addShop(b, "ganesh", "commerce/orders", "ganesh-electricals-hold.example.json", "orders");
    const { store } = openStores(b.config);
    const shops = createShops(b.config, store);
    const live = createGoLive(b.config, shops, store);
    const ran = await live.run("ganesh");
    assert.deepEqual([ran?.hand.held, ran?.hand.total], [0, 0]);
    assert.match(ran?.hand.notRun?.join(" ") ?? "", /Go program \(orders\) is not on this machine/u);
    assert.ok(live.unmet("ganesh", shops.settings("ganesh")).includes("hand-check"));
    // a check kept from the TypeScript engine (no program named) counts for nothing now
    store.write("checks/ganesh.json", { ...ran!, hand: { held: 4, total: 4, checks: 20, failedTitles: [], failed: 0, notTested: 1 } });
    assert.ok(live.unmet("ganesh", shops.settings("ganesh")).includes("hand-check"), "a hand check that names no program is run again");
  } finally { await b.close(); }
});
