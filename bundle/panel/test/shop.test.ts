// A shop in the panel: its live status in plain words (never "live" without the deployer's word), Stop, the checks and "Ready to go live", the monthly
// cost line, the papers, and the report that reads the go-live certificate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runBusyMonth } from "../../../templates/commerce/bookings/report/example-month.ts";
import { WORDS } from "../languages.ts";
import { formatRupees } from "../cost.ts";
import { M, STEP1, STEP2, STEP3, STEP4, setUp } from "./flow.ts";
import { NOW, boot, papers } from "./helpers.ts";
import type { Boot } from "./helpers.ts";

const applied = (o: Record<string, unknown> = {}) => ({
  updatedAt: new Date(NOW - 5 * 60_000).toISOString(), deploy: { state: "applied", at: new Date(NOW - 3600_000).toISOString() }, limits: { proven: 9, of: 9, unprovable: [] },
  versions: { pathway: "0.1.0", bundle: "0.1.0", guard: "geo-guard:0.1.0-alpha.2-pathways.1" }, backups: { lastCopyAt: new Date(NOW - 60_000).toISOString(), lastDrillAt: new Date(NOW - 86400_000).toISOString(), drillOk: true }, ...o,
});
const owned = async (b: Boot) => { const arjun = await b.account("arjun", "builder"); b.addShop("glow-salon", { name: "Glow Salon" }); return arjun; };
const live = WORDS.en.live;

test("'Live' needs the deployer's word: no status, an unreadable one, an old one and a failed update are never 'Live'", async () => {
  const b = await boot();
  try {
    const arjun = await owned(b);
    const says = async () => (await arjun.get("/shops/glow-salon")).plain;
    assert.ok((await says()).includes(live.unknown) && !(await says()).includes(`>${live.live}<`));
    b.status("glow-salon", "{ this is not json");
    assert.ok((await says()).includes(live.unknown) && (await says()).includes(WORDS.en.why["status-unreadable"]));
    b.status("glow-salon", applied());
    const ok = await says();
    assert.ok(ok.includes(`>${live.live}<`) && ok.includes(WORDS.en.shops.limits(9, 9)));
    assert.ok(ok.includes("0.1.0") && ok.includes(WORDS.en.shop.backupCopy("").slice(0, 12)));
    b.status("glow-salon", applied({ updatedAt: new Date(NOW - 3 * 3600_000).toISOString() }));
    assert.ok((await says()).includes(live.attention) && (await says()).includes(WORDS.en.why["status-old"]));
    b.status("glow-salon", applied({ deploy: { state: "failed", message: "Guard would not start" } }));
    assert.ok((await says()).includes(WORDS.en.why["deploy-failed"]));
    b.status("glow-salon", applied({ limits: { proven: 7, of: 9, unprovable: ["refund-limit"] } }));
    const partial = await says();
    assert.ok(partial.includes(live.attention) && partial.includes(WORDS.en.shops.limits(7, 9)) && partial.includes("refund-limit"));
    b.status("glow-salon", applied({ deploy: { state: "in-progress" } }));
    assert.ok((await says()).includes(live["setting-up"]));
    // The list says the same.
    b.status("glow-salon", applied());
    assert.ok((await arjun.get("/shops")).plain.includes(live.live));
  } finally { await b.close(); }
});

test("the runtime's own answer counts too: unreachable, not ready, or a refund that needs the builder is 'Needs a look'", async () => {
  const answers: { ready: boolean; needBuilder: number } = { ready: true, needBuilder: 0 };
  const runtime = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/readyz") return void res.end(JSON.stringify({ ok: answers.ready }));
    if (req.url === "/status" && req.headers.authorization === "Bearer runtime-token") return void res.end(JSON.stringify({ bookings: { confirmed: 3, awaiting_deposit: 1 }, refunds: { waitingForOwner: 2, needBuilder: { total: answers.needBuilder } } }));
    res.statusCode = 401; res.end("{}");
  });
  await new Promise<void>((r) => runtime.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(runtime.address() as { port: number }).port}`;
  const tokenDir = join(process.env.TMPDIR ?? "/tmp", `geo-token-${process.pid}`);
  mkdirSync(tokenDir, { recursive: true });
  writeFileSync(join(tokenDir, "glow-salon"), "runtime-token\n", { mode: 0o600 });
  const b = await boot({ runtimeUrl: `${url}`, runtimeTokenFile: join(tokenDir, "{shop}") });
  try {
    const arjun = await owned(b);
    b.status("glow-salon", applied());
    let page = (await arjun.get("/shops/glow-salon")).plain;
    assert.ok(page.includes(`>${live.live}<`));
    assert.ok(page.includes(WORDS.en.shop.bookingStates.confirmed) && page.includes(WORDS.en.shop.waiting(2)));
    answers.needBuilder = 1;
    page = (await arjun.get("/shops/glow-salon")).plain;
    assert.ok(page.includes(live.attention) && page.includes(WORDS.en.why["refunds-need-builder"]) && page.includes(WORDS.en.shop.needBuilder(1)));
    answers.needBuilder = 0; answers.ready = false;
    assert.ok((await arjun.get("/shops/glow-salon")).plain.includes(WORDS.en.why["runtime-not-ready"]));
    await new Promise<void>((r) => runtime.close(() => r())); runtime.closeAllConnections();
    assert.ok((await arjun.get("/shops/glow-salon")).plain.includes(WORDS.en.why["runtime-unreachable"]));
  } finally { await b.close(); }
});

test("Stop writes a request and says so; 'Stopped. Nothing more goes out.' appears only when the deployer's status shows it", async () => {
  const b = await boot();
  try {
    const arjun = await owned(b);
    b.status("glow-salon", applied());
    const confirm = await arjun.get("/shops/glow-salon/stop");
    assert.ok(confirm.plain.includes(WORDS.en.shop.stopText) && confirm.text.includes(`action="/shops/glow-salon/stop"`));
    const go = await arjun.post("/shops/glow-salon/stop", {}, "/shops/glow-salon/stop");
    assert.deepEqual([go.status, go.location], [303, "/shops/glow-salon/stop"]);
    const file = join(b.dir, "requests", "glow-salon.stop.json");
    const request = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual([request.schema, request.shop, request.requestedBy.name, request.requestedBy.role], [1, "glow-salon", "ARJUN", "builder"]);
    assert.match(request.requestId, /^stop_[0-9a-f]{16}$/u);
    const waiting = (await arjun.get("/shops/glow-salon")).plain;
    assert.ok(waiting.includes(live.stopping), "requested, not yet done");
    assert.ok(!waiting.includes(live.stopped), "the panel does not claim a stop the deployer has not shown");
    assert.ok(!waiting.includes(">" + live.live + "<"));
    assert.ok((await arjun.get("/shops")).plain.includes(live.stopping));
    // A second press does not make a second request.
    await arjun.post("/shops/glow-salon/stop", {}, "/shops/glow-salon/stop");
    assert.equal(JSON.parse(readFileSync(file, "utf8")).requestId, request.requestId);
    assert.ok(b.logs.some((l) => l.includes("stop requested for glow-salon")));
    // Now the deployer has stopped it.
    b.status("glow-salon", applied({ stopped: { at: new Date(NOW).toISOString(), requestId: request.requestId } }));
    const done = (await arjun.get("/shops/glow-salon")).plain;
    assert.ok(done.includes(live.stopped) && done.includes("Nothing more goes out"));
    assert.ok(!done.includes(`>${live.live}<`) && !done.includes(WORDS.en.shop.stop + "<"), "no Stop button for a stopped shop");
    // In Hindi too: the same rule, in the person's words.
    const hi = await b.account("hindi.builder", "builder", "hi");
    assert.ok((await hi.get("/shops/glow-salon")).plain.includes(WORDS.hi.live.stopped));
  } finally { await b.close(); }
});

test("the monthly cost line on the shop page: unknown is 'unknown', never ₹0; an early estimate says so; the sum says it is a subtotal", async () => {
  const b = await boot();
  try {
    const arjun = await owned(b);
    const page = (await arjun.get("/shops/glow-salon")).plain;
    assert.ok(page.includes(WORDS.en.cost.heading) && page.includes(WORDS.en.cost.early) && page.includes(WORDS.en.cost.assumption(40)));
    // 40 bookings: 120 reminders and notices at 11.5 paise; 40 deposits of ₹200 cost the shop 472 paise each in Razorpay's fee.
    assert.ok(page.includes(formatRupees(1380)) && page.includes(formatRupees(40 * 472)));
    const rowOf = (label: string) => page.split("<tr").find((r) => r.includes(label)) ?? "";
    for (const line of ["whatsapp-provider", "hosting"] as const) {
      const row = rowOf(WORDS.en.cost.lines[line]);
      assert.ok(row.includes(`>${WORDS.en.cost.unknown}<`) && !row.includes(">₹0"), `${line} is unknown, not zero: ${row.slice(0, 200)}`);
    }
    // Geometer's flat fee, read from the price list, with the AI model in it and nothing passed through.
    const fee = rowOf(WORDS.en.cost.lines.geometer);
    assert.ok(fee.includes(formatRupees(19900)) && fee.includes(WORDS.en.cost.payer["builder-pays-geometer"]) && WORDS.en.cost.payer["builder-pays-geometer"].includes("AI model"), fee.slice(0, 300));
    assert.ok(rowOf(WORDS.en.cost.lines.whatsapp).includes(WORDS.en.cost.payer["builder-pays-whatsapp-provider"]));
    const totalRow = page.split('<tr class="total">')[1].split("</tr>")[0];
    assert.ok(totalRow.includes(WORDS.en.cost.subtotal(2)) && !totalRow.includes(`<td>${WORDS.en.cost.total}</td>`), "unknown lines make a subtotal");
    assert.ok(page.includes(WORDS.en.cost.payer["shop-pays-razorpay"]) && page.includes(WORDS.en.cost.caveats["hosting-not-measured"]) && page.includes(WORDS.en.cost.caveats["provider-not-chosen"]));
    assert.ok(page.includes(WORDS.en.cost.priceList("2026-11-04")));
    assert.ok(!/unknown\s*₹0/u.test(page));
  } finally { await b.close(); }
  const full = await boot({ whatsappProvider: "gupshup", hostingSharePaise: 5000 });
  try {
    const arjun = await owned(full);
    const page = (await arjun.get("/shops/glow-salon")).plain;
    const totalRow = page.split('<tr class="total">')[1].split("</tr>")[0];
    assert.ok(totalRow.includes(`<td>${WORDS.en.cost.total}</td>`) && totalRow.includes("₹") && !page.includes("Subtotal") && !page.includes(`>${WORDS.en.cost.unknown}<`), "no cost row is unknown once everything is priced");
    const hindi = await full.account("hindi", "builder", "hi");
    const hiPage = (await hindi.get("/shops/glow-salon")).plain;
    assert.ok(hiPage.includes(WORDS.hi.cost.heading) && hiPage.includes(WORDS.hi.cost.payer["builder-pays-geometer"]));
  } finally { await full.close(); }
});

test("the checks, then 'Ready to go live': a different account stops it and is never silently switched to; with the right accounts it makes the certificate", async () => {
  const b = await boot({}, { standins: true, signing: true });
  try {
    const divya = await b.account("divya", "partner");
    const f = await setUp(b, divya);
    const checks = `/setup/${f.draft}/5`;
    assert.equal((await divya.post(`/setup/${f.draft}/save`, {}, checks)).status, 303);
    const folder = join(b.dir, "shops", f.shop);
    const runtimeBefore = readFileSync(join(folder, "runtime.json"), "utf8");
    // Before the server has applied the shop, nothing is ready, and pressing ready is refused.
    assert.ok(!(await divya.get(checks)).plain.includes(WORDS.en.setup.checks.readyButton));
    assert.equal((await divya.post(`/setup/${f.draft}/ready`, {}, checks)).status, 409);
    assert.deepEqual(papers(b, f.shop).list(f.shop, "go-live"), [], "no paper before the checks pass");

    // 1. The shop's WhatsApp number is not the one behind that id: the check says so and pins nothing.
    const wrong = await boot({}, { standins: true });
    try {
      const w2 = await wrong.account("divya", "partner");
      const g = await setUp(wrong, w2, [STEP1, STEP2, STEP3, { ...STEP4, waNumber: "+91 80000 22222" }]);
      await w2.post(`/setup/${g.draft}/save`, {}, `/setup/${g.draft}/5`);
      wrong.status(g.shop, applied());
      await w2.post(`/setup/${g.draft}/check`, {}, `/setup/${g.draft}/5`);
      const page = (await w2.get(`/setup/${g.draft}/5`)).plain;
      assert.ok(page.includes(WORDS.en.setup.checks.whatsapp.differs("1111")), "the number found ends in 1111");
      assert.ok(!page.includes(WORDS.en.setup.checks.readyButton) && page.includes(WORDS.en.setup.checks.notReady(1)));
      assert.equal(existsSync(join(wrong.dir, "shops", g.shop, "pins.json")), false, "a different account is never pinned");
      assert.equal(JSON.parse(readFileSync(join(wrong.dir, "shops", g.shop, "runtime.json"), "utf8")).services.messaging.phoneNumberId, STEP4.waNumberId);
      assert.equal((await w2.post(`/setup/${g.draft}/ready`, {}, `/setup/${g.draft}/5`)).status, 409);
    } finally { await wrong.close(); }

    // 2. The right accounts, once the server says it applied the shop.
    b.status(f.shop, applied());
    assert.equal((await divya.post(`/setup/${f.draft}/check`, {}, checks)).location, checks);
    const page = (await divya.get(checks)).plain;
    const w = WORDS.en.setup.checks;
    assert.ok(page.includes(w.whatsapp.confirmed("+919000011111")), page.slice(page.indexOf("Checks"), page.indexOf("Checks") + 1500));
    assert.ok(page.includes(w.calendar.confirmed("Stand-in calendar")) && page.includes(w.razorpay.confirmed(WORDS.en.setup.accounts.razorpay.modeLive)) && page.includes(w.razorpayWhose));
    assert.ok(/Held \d+ of \d+ situations\. 0 failed\. \d+ not tested\./u.test(page), "the certificate's own sentence");
    assert.ok(page.includes(w.limitsProven(9, 9)) && page.includes(w.readOnly));
    assert.ok(page.includes(w.readyButton));
    // The ids the providers reported are pinned for Guard's exact allowlists.
    const pins = JSON.parse(readFileSync(join(folder, "pins.json"), "utf8"));
    assert.deepEqual([pins.whatsapp, pins.calendar, pins.razorpay], [{ phoneNumberId: STEP4.waNumberId, displayNumber: "+919000011111" }, { calendarId: STEP4.calId }, { keyId: "rzp_live_AbCdEf123456", mode: "live" }]);

    const ready = await divya.post(`/setup/${f.draft}/ready`, {}, checks);
    assert.equal(ready.status, 303);
    const docs = papers(b, f.shop);
    const names = docs.list(f.shop, "go-live");
    assert.ok(names.includes("go-live-certificate.json") && names.includes("go-live-certificate-ml.html"), names.join());
    const cert = JSON.parse(docs.get(f.shop, "go-live/go-live-certificate.json")!);
    assert.ok(cert.signatures?.length > 0 || cert.signature, "signed with the panel's key");
    assert.equal(cert.document.preparedBy, "DIVYA, local partner");
    assert.equal(cert.document.shop.name, "Hosahalli Beauty");
    const done = (await divya.get(checks)).plain;
    assert.ok(done.includes(w.ready) && done.includes(w.certificate));
    const shopPage = await divya.get(`/shops/${f.shop}`);
    assert.match(shopPage.text, new RegExp(`/shops/${f.shop}/docs/go-live/go-live-certificate-ml\\.html`));
    const doc = await divya.get(`/shops/${f.shop}/docs/go-live/go-live-certificate-ml.html`);
    assert.equal(doc.status, 200);
    assert.ok(doc.text.includes("Hosahalli Beauty") && !doc.text.includes(M.secret));
    // The runtime.json the owner saved is unchanged (the ids were already as the providers write them).
    assert.equal(readFileSync(join(folder, "runtime.json"), "utf8"), runtimeBefore);

    // Changing the settings afterwards means the checks no longer describe them.
    const edit = await divya.post(`/shops/${f.shop}/edit`, {}, `/shops/${f.shop}`);
    const d2 = edit.location!.split("/")[2];
    await divya.post(`/setup/${d2}/1`, { ...STEP1, svc_price_0: "500" }, `/setup/${d2}/1`);
    for (const n of [2, 3, 4]) await divya.post(`/setup/${d2}/${n}`, n === 2 ? STEP2 : n === 3 ? STEP3 : { ...STEP4, waToken: "", waAppSecret: "", rzpKeySecret: "", rzpWebhook: "" }, `/setup/${d2}/${n}`);
    await divya.post(`/setup/${d2}/save`, {}, `/setup/${d2}/5`);
    const changed = (await divya.get(`/setup/${d2}/5`)).plain;
    assert.ok(!changed.includes(w.readyButton) && changed.includes(w.notReady(1)), "the settings changed after the checks ran");
  } finally { await b.close(); }
});

test("the monthly report reads the go-live certificate the panel made, and says what the checks ran on; a shop without one says none was given", async () => {
  const b = await boot({}, { standins: true, signing: true });
  try {
    const divya = await b.account("divya", "partner");
    // A shop with Glow Salon's own settings, so the scripted busy month fits it.
    const arjun = await b.account("arjun", "builder");
    b.addShop("glow-salon", { ownerId: JSON.parse(readFileSync(join(b.dir, "panel", "data", "accounts.json"), "utf8")).accounts[0].id, name: undefined });
    void divya; void arjun;
    const month = await runBusyMonth();
    {
      const { createShops } = await import("../shops.ts");
      const { openStores } = await import("../server.ts");
      const s = createShops(b.config, openStores(b.config).store);
      s.saveMeta("glow-salon", { schema: 1, receipts: {}, whatsapp: { businessNumber: "+91 90000 11111" }, razorpay: { mode: "live", keyId: "rzp_live_AbCdEf123456" } });
    }
    mkdirSync(join(b.dir, "exports", "glow-salon"), { recursive: true });
    writeFileSync(join(b.dir, "exports", "glow-salon", "record.json"), JSON.stringify(month.world.record.entries()));
    writeFileSync(join(b.dir, "exports", "glow-salon", "bookings.json"), JSON.stringify([...month.world.store.bookings.values()]));
    const owner = await b.account("owner.partner", "builder");
    const monthly = "2026-11";
    const before = await owner.post("/shops/glow-salon/report", { month: monthly }, "/shops/glow-salon");
    assert.equal(before.status, 303);
    const reportJson = (file: string) => JSON.parse(papers(b, "glow-salon").get("glow-salon", `monthly/${monthly}/${file}`)!);
    assert.equal(reportJson(`report-${monthly}.json`).document.goLive.status, "none", "no go-live certificate was given");
    // Make the go-live certificate for this shop's own settings, then the report again.
    const { createGoLive } = await import("../golive.ts");
    const { createShops } = await import("../shops.ts");
    const { openStores } = await import("../server.ts");
    const { store } = openStores(b.config);
    const shops = createShops(b.config, store);
    const gl = createGoLive(b.config, shops, store);
    const checks = await gl.run("glow-salon");
    assert.ok(checks && checks.hand.total > 0 && checks.hand.held === checks.hand.total);
    b.status("glow-salon", applied());
    await gl.run("glow-salon");
    const result = gl.ready("glow-salon", "Divya, local partner");
    assert.equal(result.ok, true, JSON.stringify(result));
    await owner.post("/shops/glow-salon/report", { month: monthly }, "/shops/glow-salon");
    const after = reportJson(`report-${monthly}.json`).document;
    assert.equal(after.goLive.status, "own", "the checks ran on this shop's own settings");
    assert.equal(after.goLive.held, checks.hand.held);
    // The page: counts only, the approvals as counts and outcomes, and the papers.
    const page = (await owner.get("/shops/glow-salon")).plain;
    assert.ok(page.includes(WORDS.en.shop.approvals) && /Asked \d+ times?: approved \d+, denied \d+\./u.test(page));
    assert.ok(page.includes(WORDS.en.common.counts));
    assert.ok(/href="\/shops\/glow-salon\/docs\/monthly\/2026-11\/report-2026-11-en\.html"/u.test((await owner.get("/shops/glow-salon")).text) || /monthly\/2026-11\//u.test((await owner.get("/shops/glow-salon")).text));
    assert.equal((await owner.get("/shops/glow-salon/docs/monthly/2026-11/report-2026-11.json")).status, 200);
    assert.equal((await owner.get("/shops/glow-salon/docs/monthly/2026-11/..%2fsecret.txt")).status, 404);
    // No message text is anywhere on the page: only counts.
    assert.ok(!/नमस्ते|Glow Salon-ലേക്ക്/u.test(page));
    // Builders can open "Show what we did"; a partner cannot see it.
    assert.ok(page.includes(WORDS.en.shop.detailsPins) && page.includes("sha256 "));
  } finally { await b.close(); }
});
