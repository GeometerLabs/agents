// UPI in the panel (B33): a new shop defaults to UPI, a UPI shop is set up without any Razorpay key or check, a bad UPI ID is refused in the person's language, the cost line has no gateway
// fee for it (and a Razorpay shop's is as it was), and the two new inbox sentences exist in all four languages.
import { RAZORPAY_WORDS as RZW } from "../../../modules/payments/providers/razorpay/words.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { glowSalon } from "../../../templates/commerce/bookings/src/harness.ts";
import { LANGUAGES } from "../../../modules/language/languages.ts";
import { WORDS } from "../languages.ts";
import { latestPriceList, monthlyCost } from "../cost.ts";
import { openStores } from "../server.ts";
import { M, STEP1, STEP2, STEP3, STEP4, setUp } from "./flow.ts";
import { boot } from "./helpers.ts";

const { gwMode: _m, gwKeyId: _k, gwKeySecret: _s, gwWebhook: _w, ...WITHOUT_RAZORPAY } = STEP4;
const UPI4 = { ...WITHOUT_RAZORPAY, payMod: "upi", upiId: "GlowSalon@OkICICI", upiPayee: "Glow Salon" };

test("a new shop starts on UPI: the setup page has UPI chosen, says there is no check of a UPI ID, and keeps Razorpay as the other choice", async () => {
  const b = await boot();
  try {
    const divya = await b.account("divya", "partner");
    const start = await divya.post("/setup", { template: "bookings" }, "/setup");
    const draft = start.location!.split("/")[2];
    const store = openStores(b.config).store;
    assert.deepEqual(store.read<{ payment: unknown }>(`drafts/${draft}.json`)!.payment, { module: "upi", upiId: "", payee: "" });
    for (const [i, form] of [STEP1, STEP2, STEP3].entries()) await divya.post(`/setup/${draft}/${i + 1}`, form, `/setup/${draft}/${i + 1}`);
    const page = await divya.get(`/setup/${draft}/4`);
    assert.match(page.text, /name="payMod" value="upi" checked/u);
    assert.doesNotMatch(page.text, /name="payMod" value="razorpay" checked/u);
    assert.ok(page.plain.includes(WORDS.en.upi.setup.noCheck) && page.plain.includes(RZW.en.option));
  } finally { await b.close(); }
});

test("a UPI shop saves the payment block, asks for no Razorpay key, writes none, and the go-live checks do not look at Razorpay", async () => {
  const b = await boot({}, { standins: true });
  try {
    const divya = await b.account("divya", "partner");
    const f = await setUp(b, divya, [STEP1, STEP2, STEP3, UPI4]);
    const saved = await divya.post(`/setup/${f.draft}/save`, {}, `/setup/${f.draft}/5`);
    assert.equal(saved.location, `/setup/${f.draft}/5`);
    const folder = join(b.dir, "shops", f.shop);
    const settings = JSON.parse(readFileSync(join(folder, "settings.json"), "utf8"));
    assert.deepEqual(settings.payment, { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } });
    assert.deepEqual(readdirSync(join(b.dir, "secrets-inbox", f.shop)).sort(), ["whatsapp_app_secret", "whatsapp_token"], "no Razorpay key or webhook secret was written");
    const store = openStores(b.config).store;
    const meta = store.read<{ gateway?: unknown; whatsapp?: unknown }>(`meta/${f.shop}.json`)!;
    assert.ok(meta.whatsapp && meta.gateway === undefined);
    await divya.post(`/setup/${f.draft}/check`, {}, `/setup/${f.draft}/5`);
    const checks = store.read<{ connections: { service: string }[] | null }>(`checks/${f.shop}.json`)!;
    assert.deepEqual(checks.connections!.map((c) => c.service).sort(), ["calendar", "whatsapp"], "no Razorpay check for a UPI shop");
    // Editing it keeps it a UPI shop with the same ID and name.
    const edit = await divya.post(`/shops/${f.shop}/edit`, {}, `/shops/${f.shop}`);
    const again = edit.location!.split("/")[2];
    const page = await divya.get(`/setup/${again}/4`);
    assert.match(page.text, /name="payMod" value="upi" checked/u);
    assert.ok(page.text.includes('value="glowsalon@okicici"') && page.text.includes('value="Glow Salon"'));
    await divya.post(`/setup/${again}/save`, {}, `/setup/${again}/5`);
    assert.deepEqual(JSON.parse(readFileSync(join(folder, "settings.json"), "utf8")), settings);
    assert.ok(!page.text.includes(M.secret));
  } finally { await b.close(); }
});

test("a Razorpay shop says so in its settings (B71: no block is never read as a gateway), and its Razorpay key and webhook secret are written and checked", async () => {
  const b = await boot({}, { standins: true });
  try {
    const divya = await b.account("divya", "partner");
    const f = await setUp(b, divya, [STEP1, STEP2, STEP3, { ...STEP4, payMod: "razorpay" }]);
    await divya.post(`/setup/${f.draft}/save`, {}, `/setup/${f.draft}/5`);
    const settings = JSON.parse(readFileSync(join(b.dir, "shops", f.shop, "settings.json"), "utf8"));
    assert.deepEqual(settings.payment, { module: "razorpay" });
    assert.deepEqual(readdirSync(join(b.dir, "secrets-inbox", f.shop)).sort(), ["razorpay_key", "razorpay_webhook_secret", "whatsapp_app_secret", "whatsapp_token"]);
    await divya.post(`/setup/${f.draft}/check`, {}, `/setup/${f.draft}/5`);
    const checks = openStores(b.config).store.read<{ connections: { service: string }[] }>(`checks/${f.shop}.json`)!;
    assert.deepEqual(checks.connections.map((c) => c.service).sort(), ["calendar", "razorpay", "whatsapp"]);
    // Editing it in the panel leaves it Razorpay with settings unchanged.
    const edit = await divya.post(`/shops/${f.shop}/edit`, {}, `/shops/${f.shop}`);
    const again = edit.location!.split("/")[2];
    assert.match((await divya.get(`/setup/${again}/4`)).text, /name="payMod" value="razorpay" checked/u);
    await divya.post(`/setup/${again}/save`, {}, `/setup/${again}/5`);
    assert.deepEqual(JSON.parse(readFileSync(join(b.dir, "shops", f.shop, "settings.json"), "utf8")), settings);
  } finally { await b.close(); }
});

test("a bad UPI ID or payee name is refused in plain words in the person's language, and nothing is written", async () => {
  const b = await boot();
  try {
    let written = 0; // shops whose step 4 went through (each leaves its WhatsApp secrets in the inbox)
    for (const l of ["ml", "hi", "kn", "en"] as const) {
      const person = await b.account(`p${l}`, "partner", l);
      const start = await person.post("/setup", { template: "bookings" }, "/setup");
      const d = start.location!.split("/")[2];
      for (const [i, form] of [STEP1, STEP2, STEP3].entries()) await person.post(`/setup/${d}/${i + 1}`, form, `/setup/${d}/${i + 1}`);
      const four = (form: Record<string, string>) => person.post(`/setup/${d}/4`, form, `/setup/${d}/4`);
      const u = WORDS[l].upi.problems;
      const noAt = await four({ ...UPI4, upiId: "glowsalon" });
      assert.equal(noAt.status, 400, l);
      assert.ok(noAt.plain.includes(u.idNoAt("glowsalon")), l);
      assert.ok((await four({ ...UPI4, upiId: "glow salon@okicici" })).plain.includes(u.idShape("glow salon@okicici")), l);
      assert.ok((await four({ ...UPI4, upiId: "" })).plain.includes(u.idEmpty), l);
      assert.ok((await four({ ...UPI4, upiPayee: "" })).plain.includes(u.payeeEmpty), l);
      assert.ok((await four({ ...UPI4, upiPayee: "x".repeat(80) })).plain.includes(u.payeeLong), l);
      assert.equal(existsSync(join(b.dir, "secrets-inbox")) ? readdirSync(join(b.dir, "secrets-inbox")).length : 0, written, "a refused step writes nothing to the inbox");
      assert.equal((await four(UPI4)).status, 303, l);
      written++;
    }
    assert.notEqual(WORDS.ml.upi.problems.idEmpty, WORDS.en.upi.problems.idEmpty);
  } finally { await b.close(); }
});

test("a Fees centre can take UPI too: the payment block is written and no Razorpay key is asked", async () => {
  const b = await boot();
  try {
    const divya = await b.account("divya", "partner");
    const start = await divya.post("/setup", { template: "fees" }, "/setup");
    const d = start.location!.split("/")[2];
    const forms = [
      { name: "Sunrise Tuition", address: "12 Lake Road", batch_name_0: "Class 8", batch_fee_0: "1200", students: "Aarav Sharma, 98111 11111, Class 8" },
      { dueDay: "5", graceDays: "5", lateFee: "100", reminderDays: "-3, 0, 5", reminderHour: "10", reminderMost: "4", partAllowed: "on", partMin: "300", waiver: "500", refund: "1200" },
      STEP3,
    ];
    for (const [i, form] of forms.entries()) {
      const r = await divya.post(`/setup/${d}/${i + 1}`, form, `/setup/${d}/${i + 1}`);
      assert.equal(r.status, 303, `step ${i + 1}: ${r.plain.slice(0, 300)}`);
    }
    const { calId: _c, ...fees4 } = UPI4;
    assert.equal((await divya.post(`/setup/${d}/4`, fees4, `/setup/${d}/4`)).status, 303);
    assert.equal((await divya.post(`/setup/${d}/save`, {}, `/setup/${d}/5`)).location, `/setup/${d}/5`);
    const shop = readdirSync(join(b.dir, "shops"))[0];
    assert.deepEqual(JSON.parse(readFileSync(join(b.dir, "shops", shop, "settings.json"), "utf8")).payment, { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } });
    assert.deepEqual(readdirSync(join(b.dir, "secrets-inbox", shop)).sort(), ["whatsapp_app_secret", "whatsapp_token"]);
  } finally { await b.close(); }
});

test("the cost line of a UPI shop has no gateway fee and says so; a Razorpay shop's is as it was", () => {
  const prices = latestPriceList();
  const razorpay = monthlyCost({ settings: glowSalon() }, prices);
  const explicit = monthlyCost({ settings: { ...glowSalon(), payment: { module: "razorpay" } } }, prices);
  assert.deepEqual(explicit, razorpay, "an explicit Razorpay block changes nothing");
  assert.ok(razorpay.lines.some((l) => l.id === "gateway" && l.payer === "shop-pays-gateway") && !razorpay.caveats.includes("no-gateway-fee"));
  const upi = monthlyCost({ settings: { ...glowSalon(), payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } } } }, prices);
  assert.deepEqual(upi.lines.map((l) => l.id), ["whatsapp", "whatsapp-provider", "geometer", "hosting"]);
  assert.ok(!upi.lines.some((l) => l.payer === "shop-pays-gateway") && upi.caveats.includes("no-gateway-fee"));
  assert.equal(upi.total.paise, razorpay.total.paise - razorpay.lines.find((l) => l.id === "gateway")!.paise!);
});

test("the cost table on a UPI shop's page says there is no gateway fee, in the person's language", async () => {
  const b = await boot({}, { standins: true });
  try {
    for (const l of ["en", "kn"] as const) {
      const person = await b.account(`p${l}`, "partner", l);
      const f = await setUp(b, person, [STEP1, STEP2, STEP3, UPI4]);
      await person.post(`/setup/${f.draft}/save`, {}, `/setup/${f.draft}/5`);
      const page = await person.get(`/setup/${f.draft}/5`);
      assert.ok(page.plain.includes(WORDS[l].upi.noGatewayFee), l);
      assert.ok(!page.plain.includes(WORDS[l].cost.lines.gateway), l);
    }
  } finally { await b.close(); }
});

test("the two UPI inbox sentences exist in all four languages and show the id and the amount as given", () => {
  for (const l of LANGUAGES) {
    for (const kind of ["upi_payment_unconfirmed", "upi_refund_owed"]) {
      const sentence = WORDS[l].inbox.kinds[kind]("b-3", "₹200", 0, "");
      assert.ok(sentence.includes("b-3") && sentence.includes("₹200"), `${l} ${kind}: ${sentence}`);
      if (l !== "en") assert.notEqual(sentence, WORDS.en.inbox.kinds[kind]("b-3", "₹200", 0, ""), `${l} ${kind} is in its own language`);
    }
  }
});
