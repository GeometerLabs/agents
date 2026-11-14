// `geometer whatsapp-templates` against a stand-in for Gupshup's template calls (modules/standins/gupshup-templates.ts); the real service is never called.
// What is proved: the default is a dry run that sends nothing; --submit maps every entry to Gupshup's fields; a second run skips what is pending or approved; --status lists
// states; the key comes from the environment or the shop's secret file, goes only in the apikey header, and is never printed; a wrong key stops the run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../geometer.ts";
import { startGupshupTemplateStandin } from "../../modules/standins/gupshup-templates.ts";
import { toForm, readEntries, baseUrlProblem } from "../lib/gupshup-templates.ts";
import { whatsappTemplatesCommand } from "../whatsapp-templates-cli.ts";
import { secretFile } from "../lib/secrets.ts";
import { panelRuntime, tempServer } from "./helpers.ts";

const KEY = "sk_test_0123456789abcdef0123456789";
const APP = "11111111-aaaa-bbbb-cccc-222222222222";
const APP_DIR = new URL("../..", import.meta.url).pathname;
const selfServe = (appId: string | null = APP) => panelRuntime({ services: { messaging: { provider: "gupshup-selfserve", appName: "Glow_Salon", sourceNumber: "919876543210", ...(appId ? { appId } : {}) } } as never });
const run = async (server: string, shop: string, flags: Parameters<typeof whatsappTemplatesCommand>[3], env: NodeJS.ProcessEnv) => {
  const out: string[] = [];
  const code = await whatsappTemplatesCommand(APP_DIR, server, shop, flags, { log: (l) => out.push(l), env, pause: async () => {} });
  return { code, out: out.join("\n") };
};

test("every template in the checkout maps to Gupshup's fields (name, language, category, body, a sample for each value)", () => {
  for (const t of ["bookings", "orders", "fees"]) {
    const entries = readEntries(APP_DIR, t);
    assert.ok(entries.length > 100, `${t} has its entries`);
    for (const e of entries) {
      const f = toForm(e);
      assert.ok(!("reason" in f), `${t} ${e.name} ${e.language}: ${"reason" in f ? f.reason : ""}`);
      assert.equal(f.elementName, e.name); assert.equal(f.languageCode, e.language); assert.equal(f.templateType, "TEXT");
      assert.ok(!/\{\{\d+\}\}/u.test(f.example), "no placeholder is left in the example");
    }
  }
  const e = readEntries(APP_DIR, "orders").find((x) => x.name === "order_confirmed" && x.language === "en")!;
  assert.match((toForm(e) as Record<string, string>).example, /^Confirmed! \[2 × veg thali\] for \[Thu 12 Nov/u);
});

test("an entry that cannot be sent as it is is refused with a reason, not sent half-made", () => {
  const base = { name: "x_y", language: "en", category: "UTILITY", components: [{ type: "BODY", text: "Hi {{1}}" }] };
  assert.match((toForm(base) as { reason: string }).reason, /no sample/u);
  assert.match((toForm({ ...base, components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Hi" }] }) as { reason: string }).reason, /HEADER \(IMAGE\)/u);
  assert.match((toForm({ ...base, name: "Bad Name", components: [{ type: "BODY", text: "Hi" }] }) as { reason: string }).reason, /name/u);
  assert.equal(baseUrlProblem("http://example.com"), "GUPSHUP_API_BASE must be https (plain http only for this machine).");
  assert.equal(baseUrlProblem("http://127.0.0.1:9"), undefined);
});

test("the default is a dry run: it prints what it would submit and sends nothing; --submit sends each once; running again skips what is with Gupshup; --status lists the states", async () => {
  const w = tempServer({ "glow-salon": selfServe() }); const g = await startGupshupTemplateStandin({ appId: APP, apikey: KEY });
  try {
    const env = { GUPSHUP_APIKEY: KEY, GUPSHUP_API_BASE: g.url };
    const flags = { template: "orders", languages: "en,hi", only: "order_confirmed,order_hold_ended" };
    const dry = await run(w.root, "glow-salon", flags, env);
    assert.equal(dry.code, 0); assert.equal(g.created.length, 0, "a dry run sends nothing");
    assert.match(dry.out, /would submit order_confirmed \(en\): \{"elementName":"order_confirmed","languageCode":"en","category":"UTILITY","templateType":"TEXT"/u);
    assert.match(dry.out, /Dry run: nothing was sent\. Would submit \d+/u);
    assert.doesNotMatch(dry.out, new RegExp(KEY), "the key is never printed");

    g.seed("order_hold_ended", "en", "APPROVED");
    const sent = await run(w.root, "glow-salon", { ...flags, submit: true }, env);
    assert.equal(sent.code, 0, sent.out);
    assert.ok(g.created.length >= 3);
    assert.ok(g.created.every((c) => c.apikey === KEY && c.appId === APP), "the key travels only in the apikey header, to this app");
    assert.ok(!g.created.some((c) => c.form.elementName === "order_hold_ended" && c.form.languageCode === "en"), "an approved one is skipped");
    assert.match(sent.out, /skip order_hold_ended \(en\): already approved/u);
    const before = g.created.length;
    const again = await run(w.root, "glow-salon", { ...flags, submit: true }, env);
    assert.equal(g.created.length, before, "nothing is sent twice"); assert.match(again.out, /Submitted 0/u);
    const status = await run(w.root, "glow-salon", { ...flags, status: true }, env);
    assert.match(status.out, /order_confirmed \(en\): submitted/u); assert.match(status.out, /order_hold_ended \(en\): approved/u);
  } finally { await g.close(); w.done(); }
});

test("the key is read from the shop's secret file when the environment has none, and a wrong key stops the run at once", async () => {
  const w = tempServer({ "glow-salon": selfServe() }); const g = await startGupshupTemplateStandin({ appId: APP, apikey: KEY });
  try {
    await assert.rejects(() => run(w.root, "glow-salon", { template: "orders" }, { GUPSHUP_API_BASE: g.url }), /No Gupshup API key found/u);
    const file = secretFile(w.root, "g-glow-salon-whatsapp", "whatsapp_authorization");
    mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, `${KEY}\n`);
    const ok = await run(w.root, "glow-salon", { template: "orders", only: "order_confirmed", languages: "en" }, { GUPSHUP_API_BASE: g.url });
    assert.equal(ok.code, 0);
    writeFileSync(file, "sk_wrong_0123456789abcdef0123456789");
    await assert.rejects(() => run(w.root, "glow-salon", { template: "orders", submit: true }, { GUPSHUP_API_BASE: g.url }), (e: Error) => /Could not read the templates/u.test(e.message) && !e.message.includes("sk_wrong"));
    assert.equal(g.created.length, 0);
  } finally { await g.close(); w.done(); }
});

test("one refused entry is said and the run goes on; a shop with no app id or not on its own Gupshup account is told so", async () => {
  const w = tempServer({ "glow-salon": selfServe(), "noid": selfServe(null), "meta": panelRuntime() }); const g = await startGupshupTemplateStandin({ appId: APP, apikey: KEY, rejectNames: ["order_confirmed"] });
  try {
    const env = { GUPSHUP_APIKEY: KEY, GUPSHUP_API_BASE: g.url };
    const r = await run(w.root, "glow-salon", { template: "orders", languages: "en", only: "order_confirmed,order_hold_ended", submit: true }, env);
    assert.equal(r.code, 1); assert.match(r.out, /refused order_confirmed \(en\): Gupshup: Template Name already exists/u); assert.match(r.out, /submitted order_hold_ended \(en\)/u);
    await assert.rejects(() => run(w.root, "noid", { template: "orders", submit: true }, env), /no app id/u);
    await assert.rejects(() => run(w.root, "meta", { template: "orders" }, env), /does not use its own Gupshup account/u);
  } finally { await g.close(); w.done(); }
});

test("the command is wired into the bundle's command line, and its help carries the plain steps", async () => {
  const lines: string[] = []; const log = console.log; console.log = (...a: unknown[]) => lines.push(a.join(" "));
  try { await main(["help"]); } finally { console.log = log; }
  const help = lines.join("\n");
  assert.match(help, /whatsapp-templates <shop>/u); assert.match(help, /GUPSHUP_APIKEY=/u); assert.match(help, /DRY RUN/u);
});
