// The phone setup: five short steps that write the same client folder a builder would, refuse bad input in plain words, take the shop's secrets without
// ever showing, keeping or logging them, and end in checks and "Ready to go live".
import { RAZORPAY_WORDS as RZW } from "../../../modules/payments/providers/razorpay/words.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSettings } from "../../../templates/commerce/bookings/src/settings.ts";
import { loadClient } from "../../../templates/commerce/bookings/server/config.ts";
import { WORDS } from "../languages.ts";
import { CALENDAR_ID, PHONE_ID, boot } from "./helpers.ts";
import { M, MARKERS, STEP1, STEP2, STEP3, STEP4, setUp } from "./flow.ts";

const text = (html: string) => html.replace(/<[^>]+>/gu, " ").replace(/&[a-z#0-9]+;/gu, " ").replace(/\s+/gu, " ");
const everythingOnDisk = (dir: string): string => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => `${join(e.parentPath, e.name)}\n${readFileSync(join(e.parentPath, e.name), "utf8")}`).join("\n----\n");

test("five steps write the client folder a builder would: valid settings, the runtime's own ids, the pin, and the partner as the permanent owner", async () => {
  const b = await boot({}, { standins: true });
  try {
    const divya = await b.account("divya", "partner", "ml");
    const f = await setUp(b, divya);
    assert.equal(f.shop, "hosahalli-beauty");
    assert.equal((await divya.post(`/setup/${f.draft}/save`, {}, `/setup/${f.draft}/6`)).location, `/setup/${f.draft}/6`);
    const folder = join(b.dir, "shops", f.shop);
    assert.deepEqual(readdirSync(folder).sort(), ["character", "owner.json", "pathway.lock", "runtime.json", "settings-history.jsonl", "settings.json"], "and the history of the settings (B38), which starts with this first save, and (item 11i) the character's pictures");
    const history = readFileSync(join(folder, "settings-history.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(history.length, 1);
    assert.deepEqual(Object.keys(history[0].by).sort(), ["id", "name", "role"]);
    assert.deepEqual(history[0].settings, JSON.parse(readFileSync(join(folder, "settings.json"), "utf8")));
    const settings = validateSettings(JSON.parse(readFileSync(join(folder, "settings.json"), "utf8")));
    assert.ok(settings.ok, settings.ok ? "" : settings.errors.join("; "));
    if (!settings.ok) return;
    const s = settings.settings;
    assert.equal(s.name, "Hosahalli Beauty");
    assert.deepEqual(s.services.map((x) => [x.id, x.priceInr, x.durationMinutes]), [["haircut", 450, 45], ["facial", 900, 60]]);
    assert.deepEqual(s.languages, ["ml", "en"]);
    assert.deepEqual(s.owner, { whatsapp: "+919876543210", language: "ml" });
    assert.deepEqual([s.deposit.amountInr, s.cancellation.windowHours, s.cancellation.refundLimitInr], [200, 24, 200]);
    assert.deepEqual([s.openingHours.sun, s.openingHours.mon], [null, { open: "10:00", close: "20:00" }]);
    assert.ok(s.services[0].names.en!.includes("hair cut") && s.services[0].names.ml!.includes("Haircut"));
    const runtime = JSON.parse(readFileSync(join(folder, "runtime.json"), "utf8"));
    assert.deepEqual(runtime, { mode: "live", tickSeconds: 30, services: { payments: {}, calendar: { calendarId: CALENDAR_ID }, messaging: { phoneNumberId: PHONE_ID }, timeoutMs: 20000 } });
    assert.equal(readFileSync(join(folder, "pathway.lock"), "utf8").trim(), "bookings@0.1.0");
    const owner = JSON.parse(readFileSync(join(folder, "owner.json"), "utf8"));
    assert.deepEqual([owner.accountName, owner.role, owner.template], ["DIVYA", "partner", "bookings"]);
    // The pathway's own loader accepts the folder once the bundle has added the Guard addresses it owns.
    const withGuards = mkdtempSync(join(tmpdir(), "geo-client-"));
    cpSync(folder, withGuards, { recursive: true });
    runtime.services.payments.baseUrl = runtime.services.calendar.baseUrl = runtime.services.messaging.baseUrl = "http://guard.invalid";
    writeFileSync(join(withGuards, "runtime.json"), JSON.stringify(runtime));
    const client = loadClient(withGuards);
    assert.equal(client.settings.name, "Hosahalli Beauty");
    // The shop belongs to Divya for good: saving again as someone else does not change who set it up.
    // and an edit does not move the shop to another version: `geometer update` holds a shop back on its pin, and only it moves one
    writeFileSync(join(folder, "pathway.lock"), "bookings@0.0.9\n");
    const arjun = await b.account("arjun", "builder");
    const edit = await arjun.post(`/shops/${f.shop}/edit`, {}, `/shops/${f.shop}`);
    await arjun.post(`/setup/${edit.location!.split("/")[2]}/save`, {}, `/setup/${edit.location!.split("/")[2]}/6`);
    assert.equal(JSON.parse(readFileSync(join(folder, "owner.json"), "utf8")).accountName, "DIVYA");
    assert.equal(readFileSync(join(folder, "pathway.lock"), "utf8").trim(), "bookings@0.0.9");
  } finally { await b.close(); }
});

test("bad input is refused in the person's own language, in plain words, and nothing is saved from the bad step", async () => {
  const b = await boot();
  try {
    const divya = await b.account("divya", "partner", "ml");
    const start = await divya.post("/setup", { template: "bookings" }, "/setup");
    const d = start.location!.split("/")[2];
    const one = (form: Record<string, string>) => divya.post(`/setup/${d}/1`, form, `/setup/${d}/1`);
    const w = WORDS.ml.setup.problems;
    let r = await one({ ...STEP1, name: "" });
    assert.equal(r.status, 400);
    assert.ok(r.plain.includes(w.nameEmpty) && r.plain.includes(WORDS.ml.setup.problemsTitle));
    r = await one({ ...STEP1, svc_price_0: "four fifty" });
    assert.ok(r.plain.includes(w.priceBad(1)));
    r = await one({ ...STEP1, opens: "21:00", closes: "09:00" });
    assert.ok(r.plain.includes(w.hoursBad));
    r = await one({ ...STEP1, day_1: "", day_2: "", day_3: "", day_4: "", day_5: "", day_6: "" });
    assert.ok(r.plain.includes(w.noDay));
    r = await one({ ...STEP1, svc_name_0: "", svc_price_0: "", svc_name_1: "", svc_price_1: "" });
    assert.ok(r.plain.includes(w.noService));
    assert.equal(existsSync(join(b.dir, "shops")), true);
    assert.deepEqual(readdirSync(join(b.dir, "shops")), [], "a refused step writes no shop");
    // The form comes back as it was typed.
    assert.ok(r.plain.includes('value="Hosahalli Beauty"'));
    assert.equal((await one(STEP1)).status, 303);
    // English, Hindi and Kannada say the same thing in their own words.
    for (const l of ["en", "hi", "kn"] as const) {
      const person = await b.account(`p${l}`, "partner", l);
      const s = await person.post("/setup", { template: "bookings" }, "/setup");
      const id = s.location!.split("/")[2];
      const bad = await person.post(`/setup/${id}/1`, { ...STEP1, name: "" }, `/setup/${id}/1`);
      assert.ok(bad.plain.includes(WORDS[l].setup.problems.nameEmpty), l);
    }
    // Step 2 and 3.
    const two = (form: Record<string, string>) => divya.post(`/setup/${d}/2`, form, `/setup/${d}/2`);
    assert.ok((await two({ deposit: "500", window: "24" })).plain.includes(w.depositTooBig("₹500", "₹450")));
    assert.ok((await two({ deposit: "", window: "24" })).plain.includes(w.depositBad));
    assert.ok((await two({ deposit: "200", window: "a day" })).plain.includes(w.windowBad));
    assert.equal((await two(STEP2)).status, 303);
    const three = (form: Record<string, string>) => divya.post(`/setup/${d}/3`, form, `/setup/${d}/3`);
    assert.ok((await three({ ...STEP3, ownerNumber: "12345" })).plain.includes(w.ownerNumberBad));
    assert.ok((await three({ ...STEP3, primary: "fr" })).plain.includes(w.noLanguage));
    assert.equal((await three(STEP3)).status, 303);
    // Step 4: the owner and the shop must be different numbers, and a live key is not a practice key.
    const four = (form: Record<string, string>) => divya.post(`/setup/${d}/4`, form, `/setup/${d}/4`);
    assert.ok((await four({ ...STEP4, waNumber: "98765 43210" })).plain.includes(w.sameNumber));
    assert.ok((await four({ ...STEP4, gwMode: "test" })).plain.includes(RZW.ml.checks.wrongMode));
    assert.ok((await four({ ...STEP4, gwKeyId: "key 123" })).plain.includes(RZW.ml.accounts.keyIdBad));
    assert.ok((await four({ ...STEP4, waNumberId: "12ab" })).plain.includes(w.numberIdBad));
    assert.ok((await four({ ...STEP4, calId: "my calendar" })).plain.includes(w.calendarIdBad));
    // Someone else's draft is not found.
    assert.equal((await (await b.account("meena", "partner")).get(`/setup/${d}/2`)).status, 404);
    assert.equal((await divya.get(`/setup/${d}/9`)).status, 404);
    assert.equal((await divya.get("/setup/not-a-draft-id-abcdefg/1")).status, 404);
  } finally { await b.close(); }
});

test("the secrets: written once to the inbox, exactly as given, 0600; never in a page, a log, the panel's data or the shop's folder", async () => {
  const b = await boot({}, { standins: true });
  try {
    const divya = await b.account("divya", "partner");
    const f = await setUp(b, divya);
    const inbox = join(b.dir, "secrets-inbox", f.shop);
    assert.deepEqual(readdirSync(inbox).sort(), ["razorpay_key", "razorpay_webhook_secret", "whatsapp_app_secret", "whatsapp_token"]);
    const content = (name: string) => readFileSync(join(inbox, name), "utf8").trim();
    assert.equal(content("whatsapp_token"), M.token);
    assert.equal(content("whatsapp_app_secret"), M.app);
    assert.equal(content("razorpay_key"), `rzp_live_AbCdEf123456:${M.secret}`);
    assert.equal(content("razorpay_webhook_secret"), M.hook);
    for (const name of readdirSync(inbox)) assert.equal(statSync(join(inbox, name)).mode & 0o777, 0o600, name);
    const before = readdirSync(inbox).map((n) => statSync(join(inbox, n)).mtimeMs);

    // What the panel shows afterwards: that each arrived, and nothing else.
    const again = await divya.get(`/setup/${f.draft}/4`);
    assert.ok(again.plain.includes(WORDS.en.setup.accounts.keepEmpty) && !again.plain.includes("rzp_live_AbCdEf123456:"));
    const all = [...f.replies, again.text, (await divya.get("/shops")).text];
    // A step 4 with the secret boxes left empty keeps what arrived and writes nothing new.
    const keep = await divya.post(`/setup/${f.draft}/4`, { ...STEP4, waToken: "", waAppSecret: "", gwKeySecret: "", gwWebhook: "" }, `/setup/${f.draft}/4`);
    assert.equal(keep.status, 303);
    assert.deepEqual(readdirSync(inbox).map((n) => statSync(join(inbox, n)).mtimeMs), before);
    // A box with a space in it is refused, nothing at all is written from that submission, and the page does not repeat it.
    const bad = await divya.post(`/setup/${f.draft}/4`, { ...STEP4, waToken: `${M.token} MARKERTOKENBAD`, waAppSecret: "0000000000000000000000000000ffff" }, `/setup/${f.draft}/4`);
    all.push(bad.text);
    assert.equal(bad.status, 400);
    assert.ok(bad.plain.includes(WORDS.en.setup.problems.secretShape(WORDS.en.setup.accounts.whatsapp.token)));
    assert.equal(content("whatsapp_app_secret"), M.app, "the good app secret in the same form was not written either");
    // A changed key id needs its secret again; the old secret is never reused for it.
    const changed = await divya.post(`/setup/${f.draft}/4`, { ...STEP4, gwKeyId: "rzp_live_Another123456", gwKeySecret: "" }, `/setup/${f.draft}/4`);
    assert.equal(changed.status, 400);
    const go = await divya.post(`/setup/${f.draft}/save`, {}, `/setup/${f.draft}/6`);
    all.push((await divya.get(`/setup/${f.draft}/6`)).text);
    assert.equal(go.status, 303);

    for (const reply of all) for (const m of MARKERS) assert.ok(!reply.includes(m), `a page showed ${m}`);
    const log = b.logs.join("\n");
    for (const m of MARKERS) assert.ok(!log.includes(m), `the log held ${m}`);
    const elsewhere = [join(b.dir, "panel"), join(b.dir, "shops")].map(everythingOnDisk).join("\n");
    for (const m of MARKERS) assert.ok(!elsewhere.includes(m), `the panel's data or the shop folder held ${m}`);
    // The panel remembers that each arrived, and when.
    const meta = JSON.parse(readFileSync(join(b.dir, "panel", "data", "meta", `${f.shop}.json`), "utf8"));
    assert.deepEqual(Object.keys(meta.receipts).sort(), ["razorpay_key", "razorpay_webhook_secret", "whatsapp_app_secret", "whatsapp_token"]);
    assert.deepEqual(meta.gateway, { provider: "razorpay", mode: "live", keyId: "rzp_live_AbCdEf123456" });
    // The intake has no way to read anything back.
    const source = readFileSync(new URL("../secrets.ts", import.meta.url), "utf8");
    assert.ok(!/readFile|readdir|createReadStream|readSync|openSync/u.test(source), "secrets.ts must only write");
  } finally { await b.close(); }
});

test("a calendar key file is taken when the server has no shared address; only its public address is kept, and shown as the one to share with", async () => {
  const b = await boot({ calendarShareAddress: undefined });
  try {
    const divya = await b.account("divya", "partner");
    const start = await divya.post("/setup", { template: "bookings" }, "/setup");
    const d = start.location!.split("/")[2];
    for (const [i, form] of [STEP1, STEP2, STEP3].entries()) assert.equal((await divya.post(`/setup/${d}/${i + 1}`, form, `/setup/${d}/${i + 1}`)).status, 303);
    const page = await divya.get(`/setup/${d}/4`);
    assert.ok(page.plain.includes('name="calJson"') && page.plain.includes(WORDS.en.setup.accounts.calendar.noAddress));
    const missing = await divya.post(`/setup/${d}/4`, STEP4, `/setup/${d}/4`);
    assert.equal(missing.status, 400);
    assert.ok(missing.plain.includes(WORDS.en.setup.problems.secretMissing(WORDS.en.setup.accounts.calendar.json)));
    const notJson = await divya.post(`/setup/${d}/4`, { ...STEP4, calJson: `{"private_key": "MARKERPRIVATEKEY-not-complete` }, `/setup/${d}/4`);
    assert.equal(notJson.status, 400);
    assert.ok(notJson.plain.includes(WORDS.en.setup.problems.jsonBad) && !notJson.plain.includes("MARKERPRIVATEKEY"));
    const ok = await divya.post(`/setup/${d}/4`, { ...STEP4, calJson: M.json }, `/setup/${d}/4`);
    assert.equal(ok.status, 303);
    const shop = JSON.parse(readFileSync(join(b.dir, "panel", "data", "drafts", `${d}.json`), "utf8")).shopId;
    assert.ok(readFileSync(join(b.dir, "secrets-inbox", shop, "google_service_account.json"), "utf8").includes("MARKERPRIVATEKEYBODY"));
    const after = await divya.get(`/setup/${d}/4`);
    assert.ok(after.plain.includes("shop-calendar@proj.iam.gserviceaccount.com") && !after.plain.includes("MARKERPRIVATEKEY") && !after.plain.includes('name="calJson"'));
    assert.ok(!b.logs.join("\n").includes("MARKERPRIVATEKEY"));
    assert.ok(!everythingOnDisk(join(b.dir, "panel")).includes("MARKERPRIVATEKEY"));
  } finally { await b.close(); }
});

test("it asks only for what the template uses, and a template added to templates/<domain>/ shows up in setup on its own", async () => {
  const templates = mkdtempSync(join(tmpdir(), "geo-templates-"));
  const mini = join(templates, "somewhere", "mini");
  mkdirSync(join(mini, "settings"), { recursive: true });
  cpSync(new URL("../../../templates/commerce/bookings/settings/glow-salon.example.json", import.meta.url).pathname, join(mini, "settings", "x.json"));
  writeFileSync(join(mini, "package.json"), JSON.stringify({ name: "mini", version: "0.1.0" }));
  writeFileSync(join(mini, "template.json"), JSON.stringify({ schema: 1, id: "mini", setup: "bookings", accounts: ["whatsapp"], steps: ["business", "languages", "accounts", "checks"], settingsExample: "settings/x.json" }));
  mkdirSync(join(templates, "somewhere", "elsewhere"));
  writeFileSync(join(templates, "somewhere", "elsewhere", "package.json"), JSON.stringify({ name: "elsewhere", version: "0.2.0" }));
  writeFileSync(join(templates, "somewhere", "elsewhere", "template.json"), JSON.stringify({ schema: 1, id: "elsewhere", setup: "custom-form", accounts: ["payment"] }));
  const b = await boot({ templatesDir: templates });
  try {
    const divya = await b.account("divya", "partner");
    const list = await divya.get("/setup");
    assert.ok(list.plain.includes('value="mini"') && list.plain.includes(WORDS.en.setup.templateElsewhere));
    assert.equal((await divya.post("/setup", { template: "elsewhere" }, "/setup")).status, 404, "a template the phone form cannot set up is not started");
    const start = await divya.post("/setup", { template: "mini" }, "/setup");
    const d = start.location!.split("/")[2];
    assert.equal((await divya.post(`/setup/${d}/1`, STEP1, `/setup/${d}/1`)).location, `/setup/${d}/2`);
    assert.equal((await divya.post(`/setup/${d}/2`, STEP3, `/setup/${d}/2`)).location, `/setup/${d}/3`);
    const three = await divya.get(`/setup/${d}/3`);
    assert.ok(three.plain.includes(WORDS.en.setup.steps.accounts) && three.plain.includes('name="waToken"'));
    assert.ok(!three.plain.includes('name="calId"') && !three.plain.includes('name="gwKeyId"') && !three.plain.includes('name="deposit"'), "no calendar, no Razorpay and no deposit question for this template");
  } finally { await b.close(); }
});

test("setup never writes into another shop: a name taken after step 1 gets a fresh id before any secret is written, a file already waiting in an inbox is never overwritten, and a shop that appears before the save is not touched", async () => {
  const b = await boot({}, { standins: true });
  try {
    const divya = await b.account("divya", "partner");
    // 1. Another shop with the same name appears after step 1 (a builder adds it on the server).
    const start = await divya.post("/setup", { template: "bookings" }, "/setup");
    const d = start.location!.split("/")[2];
    for (const [i, form] of [STEP1, STEP2, STEP3].entries()) assert.equal((await divya.post(`/setup/${d}/${i + 1}`, form, `/setup/${d}/${i + 1}`)).status, 303);
    assert.equal(JSON.parse(readFileSync(join(b.dir, "panel", "data", "drafts", `${d}.json`), "utf8")).shopId, "hosahalli-beauty");
    b.addShop("hosahalli-beauty", { name: "Someone Else's Shop" });
    const theirs = readFileSync(join(b.dir, "shops", "hosahalli-beauty", "settings.json"), "utf8");
    assert.equal((await divya.post(`/setup/${d}/4`, STEP4, `/setup/${d}/4`)).status, 303);
    const mine = JSON.parse(readFileSync(join(b.dir, "panel", "data", "drafts", `${d}.json`), "utf8")).shopId as string;
    assert.equal(mine, "hosahalli-beauty-2");
    assert.equal(existsSync(join(b.dir, "secrets-inbox", "hosahalli-beauty")), false, "nothing went into the other shop's inbox");
    assert.ok(existsSync(join(b.dir, "secrets-inbox", mine, "whatsapp_token")));
    await divya.post(`/setup/${d}/save`, {}, `/setup/${d}/6`);
    assert.equal(readFileSync(join(b.dir, "shops", "hosahalli-beauty", "settings.json"), "utf8"), theirs, "the other shop's settings are untouched");
    assert.ok(existsSync(join(b.dir, "shops", mine, "owner.json")));

    // 2. A file already waiting in the inbox of the id this draft wants: not overwritten, another id is used.
    const s2 = await divya.post("/setup", { template: "bookings" }, "/setup");
    const d2 = s2.location!.split("/")[2];
    await divya.post(`/setup/${d2}/1`, { ...STEP1, name: "Quiet Corner" }, `/setup/${d2}/1`);
    for (const n of [2, 3]) await divya.post(`/setup/${d2}/${n}`, n === 2 ? STEP2 : STEP3, `/setup/${d2}/${n}`);
    mkdirSync(join(b.dir, "secrets-inbox", "quiet-corner"), { recursive: true });
    writeFileSync(join(b.dir, "secrets-inbox", "quiet-corner", "whatsapp_token"), "someone-elses-token\n");
    assert.equal((await divya.post(`/setup/${d2}/4`, STEP4, `/setup/${d2}/4`)).status, 303);
    assert.equal(readFileSync(join(b.dir, "secrets-inbox", "quiet-corner", "whatsapp_token"), "utf8"), "someone-elses-token\n");
    assert.equal(JSON.parse(readFileSync(join(b.dir, "panel", "data", "drafts", `${d2}.json`), "utf8")).shopId, "quiet-corner-2");

    // 3. A shop appears between step 4 and the save: the save is refused, and its folder is not touched.
    const s3 = await divya.post("/setup", { template: "bookings" }, "/setup");
    const d3 = s3.location!.split("/")[2];
    await divya.post(`/setup/${d3}/1`, { ...STEP1, name: "Late Arrival" }, `/setup/${d3}/1`);
    for (const n of [2, 3, 4]) await divya.post(`/setup/${d3}/${n}`, n === 2 ? STEP2 : n === 3 ? STEP3 : STEP4, `/setup/${d3}/${n}`);
    b.addShop("late-arrival", { name: "Not Mine" });
    const before = readFileSync(join(b.dir, "shops", "late-arrival", "settings.json"), "utf8");
    const refused = await divya.post(`/setup/${d3}/save`, {}, `/setup/${d3}/6`);
    assert.equal(refused.status, 409);
    assert.ok(refused.plain.includes("already exists"));
    assert.equal(readFileSync(join(b.dir, "shops", "late-arrival", "settings.json"), "utf8"), before);
    assert.equal(existsSync(join(b.dir, "shops", "late-arrival", "owner.json")), false);
  } finally { await b.close(); }
});

test("every step URL can be opened directly, and a step whose earlier steps are not filled in goes back to the first one that is not: no crash, nothing written", async () => {
  const b = await boot({}, { standins: true });
  try {
    const divya = await b.account("divya", "partner");
    const start = await divya.post("/setup", { template: "bookings" }, "/setup");
    const d = start.location!.split("/")[2];
    for (const n of [2, 3, 4, 5]) {
      const r = await divya.get(`/setup/${d}/${n}`);
      assert.deepEqual([r.status, r.location], [303, `/setup/${d}/1`], `GET step ${n}`);
    }
    for (const n of [2, 3, 4]) assert.deepEqual((await divya.post(`/setup/${d}/${n}`, STEP4, `/setup/${d}/1`)).location, `/setup/${d}/1`, `POST step ${n}`);
    for (const path of ["save", "check", "ready", "expected"]) assert.deepEqual((await divya.post(`/setup/${d}/${path}`, {}, `/setup/${d}/1`)).location, `/setup/${d}/1`, path);
    assert.equal(existsSync(join(b.dir, "secrets-inbox")), false);
    assert.deepEqual(readdirSync(join(b.dir, "shops")), []);
    // Half way: step 3 still waits for step 2.
    await divya.post(`/setup/${d}/1`, STEP1, `/setup/${d}/1`);
    assert.equal((await divya.get(`/setup/${d}/3`)).location, `/setup/${d}/2`);
    assert.equal((await divya.post(`/setup/${d}/save`, {}, `/setup/${d}/1`)).location, `/setup/${d}/2`);
    assert.ok(!b.logs.some((l) => l.startsWith("failed")), b.logs.filter((l) => l.startsWith("failed")).join("\n"));
  } finally { await b.close(); }
});
