// The shared template code (lib/wa-templates.ts) and `geometer whatsapp-templates`, its command-line caller, against the stand-ins for Meta's and Gupshup's template
// calls (modules/standins/meta-templates.ts, gupshup-templates.ts); the real services are never called. The panel's own use of the same code is
// panel/test/wa-templates.test.ts; the Guard's routes for it, on the real Guard, are test/wa-templates-guard.test.ts.
// What is proved here: every template in the checkout maps to both providers' fields; a shop's set is the union of its parts in its languages (two parts sharing a name
// and language are merged when the words are the same and refused when they differ); the default is a dry run; --submit sends each once and a second run skips what
// the account holds; --status lists states with Meta's reason; the key comes from the environment or the shop's secret file, only in its header, and is never printed;
// a refused key stops the run; one refused template is said and the rest go on; Meta direct needs the account id, Gupshup's create needs the app id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../geometer.ts";
import { startGupshupTemplateStandin } from "../../modules/standins/gupshup-templates.ts";
import { startMetaTemplateStandin } from "../../modules/standins/meta-templates.ts";
import { TemplateSetConflict, baseUrlProblem, bucketOf, gupshupForm, metaBody, readEntries, shopLanguages, shopTemplateSet, statusRows, templateSet } from "../lib/wa-templates.ts";
import type { Entry } from "../lib/wa-templates.ts";
import { whatsappTemplatesCommand } from "../whatsapp-templates-cli.ts";
import { secretFile } from "../lib/secrets.ts";
import { panelRuntime, tempServer } from "./helpers.ts";

const KEY = "sk_test_0123456789abcdef0123456789";
const TOKEN = `EAAtesttoken${"x".repeat(30)}`;
const APP = "11111111-aaaa-bbbb-cccc-222222222222";
const WABA = "102290129340398";
const APP_DIR = new URL("../..", import.meta.url).pathname;
const TEMPLATES = new URL("../../templates/", import.meta.url).pathname;
const folderOf = (id: string) => join(TEMPLATES, id === "fees" ? "education" : "commerce", id);
const selfServe = (appId: string | null = APP) => panelRuntime({ services: { messaging: { provider: "gupshup-selfserve", appName: "Glow_Salon", sourceNumber: "919876543210", ...(appId ? { appId } : {}) } } as never });
const metaDirect = (wabaId: string | null = WABA) => panelRuntime({ services: { messaging: { phoneNumberId: "100000000000001", ...(wabaId ? { wabaId } : {}) } } as never });
const run = async (server: string, shop: string, flags: Parameters<typeof whatsappTemplatesCommand>[3], env: NodeJS.ProcessEnv) => {
  const out: string[] = [];
  const code = await whatsappTemplatesCommand(APP_DIR, server, shop, flags, { log: (l) => out.push(l), env, pause: async () => {} });
  return { code, out: out.join("\n") };
};

test("every template in the checkout maps to Meta's body and to Gupshup's form (name, language, category, body, a sample for each value)", () => {
  for (const t of ["bookings", "orders", "fees", "stock-orders"]) {
    const entries = readEntries(folderOf(t));
    assert.ok(entries.length > 50, `${t} has its entries`);
    for (const e of entries) {
      const f = gupshupForm(e);
      assert.ok(!("reason" in f), `${t} ${e.name} ${e.language}: ${"reason" in f ? f.reason : ""}`);
      assert.equal(f.body.elementName, e.name); assert.equal(f.body.languageCode, e.language); assert.equal(f.body.templateType, "TEXT");
      assert.ok(!/\{\{\d+\}\}/u.test(f.body.example), "no placeholder is left in Gupshup's example");
      const m = metaBody(e);
      assert.ok(!("reason" in m), `${t} ${e.name} ${e.language} for Meta: ${"reason" in m ? m.reason : ""}`);
      assert.deepEqual(Object.keys(m.body).sort(), ["category", "components", "language", "name", "parameter_format"]);
    }
  }
  const e = readEntries(folderOf("orders")).find((x) => x.name === "order_confirmed" && x.language === "en")!;
  assert.match((gupshupForm(e) as { body: Record<string, string> }).body.example, /^Confirmed! \[2 × veg thali\] for \[Thu 12 Nov/u);
});

test("an entry that cannot be sent as it is is refused with a reason, not sent half-made", () => {
  const base: Entry = { name: "x_y", language: "en", category: "UTILITY", components: [{ type: "BODY", text: "Hi {{1}}" }] };
  assert.match((gupshupForm(base) as { reason: string }).reason, /no sample/u);
  assert.match((metaBody(base) as { reason: string }).reason, /no sample/u);
  assert.match((gupshupForm({ ...base, components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Hi" }] }) as { reason: string }).reason, /HEADER \(IMAGE\)/u);
  assert.match((metaBody({ ...base, components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Hi" }] }) as { reason: string }).reason, /HEADER \(IMAGE\) needs a sample file/u);
  assert.match((gupshupForm({ ...base, name: "Bad Name", components: [{ type: "BODY", text: "Hi" }] }) as { reason: string }).reason, /name/u);
  assert.equal(baseUrlProblem("http://example.com", "GUPSHUP_API_BASE"), "GUPSHUP_API_BASE must be https (plain http only for this machine).");
  assert.equal(baseUrlProblem("http://127.0.0.1:9", "GUPSHUP_API_BASE"), undefined);
});

test("a shop's template set is the union of its parts in its languages: a name shared with the same words is one template, with other words it is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-wa-parts-"));
  try {
    const body = (text: string): Entry => ({ name: "pickup_ready", language: "en", category: "UTILITY", parameter_format: "positional", components: [{ type: "BODY", text }] });
    const part = (id: string, entries: Entry[]) => { mkdirSync(join(dir, id)); writeFileSync(join(dir, id, "whatsapp-templates.json"), JSON.stringify(entries)); return { id, folder: join(dir, id) }; };
    const a = part("credit-book", [body("Your order is ready."), { ...body("Aapka order taiyaar hai."), language: "hi" }, { ...body("Pay by Friday."), name: "credit_due" }]);
    const b = part("pickup-holds", [body("Your order is ready."), { ...body("Held till 6."), name: "hold_ends" }]);
    const c = part("other-words", [body("Come and collect it.")]);
    const union = templateSet([a, b], ["en"]);
    assert.deepEqual(union.map((e) => `${e.name}:${e.language}`).sort(), ["credit_due:en", "hold_ends:en", "pickup_ready:en"], "the same name and words from two parts is one template; Hindi is not one of the shop's languages");
    assert.equal(templateSet([a, b]).length, 4, "no languages named: all of them");
    assert.throws(() => templateSet([a, c], ["en"]), (e: Error) => e instanceof TemplateSetConflict && /credit-book and other-words both have a WhatsApp template pickup_ready \(en\) with different words/u.test(e.message));
    assert.deepEqual(templateSet([part("no-whatsapp", []), a], ["hi"]).map((e) => e.language), ["hi"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // the shop's own languages: its customers', the owner's and its approvers', so an owner's notice in a language no customer reads is still submitted
  assert.deepEqual(shopLanguages({ languages: ["ml"], owner: { language: "en" }, approvers: [{ whatsapp: "+91", language: "kn" }] }).sort(), ["en", "kn", "ml"]);
  const set = shopTemplateSet({ templateId: "orders", settings: { languages: ["en"], owner: { language: "en" } }, folderOf });
  assert.ok(set.length > 30 && set.every((e) => e.language === "en"));
});

test("the states fall in plain buckets, and a rejected one keeps the provider's reason as it wrote it", () => {
  assert.deepEqual(["APPROVED", "PENDING", "IN_APPEAL", "SUBMITTED", "REJECTED", "FAILED", "PAUSED", "DISABLED", undefined].map(bucketOf), ["approved", "pending", "pending", "pending", "rejected", "rejected", "stopped", "stopped", "not-submitted"]);
  const entries = readEntries(folderOf("orders")).filter((e) => e.language === "en").slice(0, 3);
  const s = statusRows(entries, new Map([[`${entries[0].name}:en`, { state: "APPROVED" }], [`${entries[1].name}:en`, { state: "REJECTED", reason: "INVALID_FORMAT" }]]));
  assert.deepEqual(s.counts, { approved: 1, pending: 0, rejected: 1, stopped: 0, "not-submitted": 1 });
  assert.equal(s.rows[1].reason, "INVALID_FORMAT");
});

test("Gupshup: the default is a dry run that sends nothing; --submit sends each once; running again skips what is with Gupshup; --status lists the states", async () => {
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

test("Gupshup: the key is read from the shop's secret file when the environment has none, and a wrong key stops the run at once", async () => {
  const w = tempServer({ "glow-salon": selfServe() }); const g = await startGupshupTemplateStandin({ appId: APP, apikey: KEY });
  try {
    await assert.rejects(() => run(w.root, "glow-salon", { template: "orders" }, { GUPSHUP_API_BASE: g.url }), /No Gupshup API key found/u);
    const file = secretFile(w.root, "g-glow-salon-whatsapp", "whatsapp_authorization");
    mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, `${KEY}\n`);
    const ok = await run(w.root, "glow-salon", { template: "orders", only: "order_confirmed", languages: "en" }, { GUPSHUP_API_BASE: g.url });
    assert.equal(ok.code, 0);
    writeFileSync(file, "sk_wrong_0123456789abcdef0123456789");
    const wrong = await run(w.root, "glow-salon", { template: "orders", submit: true }, { GUPSHUP_API_BASE: g.url });
    assert.equal(wrong.code, 1); assert.match(wrong.out, /Stopped: Gupshup did not accept the shop's key/u); assert.ok(!wrong.out.includes("sk_wrong"));
    assert.equal(g.created.length, 0);
  } finally { await g.close(); w.done(); }
});

test("Gupshup: one refused entry is said and the run goes on; a shop with no app id, or with no account of its own, is told so", async () => {
  const w = tempServer({ "glow-salon": selfServe(), "noid": selfServe(null), "partner": panelRuntime({ services: { messaging: { phoneNumberId: "1", provider: "gupshup", appId: APP } } as never }) });
  const g = await startGupshupTemplateStandin({ appId: APP, apikey: KEY, rejectNames: ["order_confirmed"] });
  try {
    const env = { GUPSHUP_APIKEY: KEY, GUPSHUP_API_BASE: g.url };
    const r = await run(w.root, "glow-salon", { template: "orders", languages: "en", only: "order_confirmed,order_hold_ended", submit: true }, env);
    assert.equal(r.code, 1); assert.match(r.out, /refused order_confirmed \(en\): Gupshup: Template Name already exists/u); assert.match(r.out, /submitted order_hold_ended \(en\)/u);
    await assert.rejects(() => run(w.root, "noid", { template: "orders", submit: true }, env), /no app id/u);
    await assert.rejects(() => run(w.root, "partner", { template: "orders" }, env), /Gupshup partner app/u);
  } finally { await g.close(); w.done(); }
});

test("Meta direct: the shop's own WhatsApp Business Account, its token as the whole Authorization header from the secret file, Meta's reason for a rejected one, and a refused token stops the run", async () => {
  const w = tempServer({ "glow-salon": metaDirect(), "noaccount": metaDirect(null) });
  const m = await startMetaTemplateStandin({ wabaId: WABA, token: `Bearer ${TOKEN}`, pageSize: 2 });
  try {
    const env = { WHATSAPP_GRAPH_BASE: m.url };
    const flags = { template: "orders", languages: "en", only: "order_confirmed,order_hold_ended,order_reminder" };
    await assert.rejects(() => run(w.root, "noaccount", flags, env), /no WhatsApp Business Account id/u);
    await assert.rejects(() => run(w.root, "glow-salon", flags, env), /No WhatsApp access token found/u);
    const file = secretFile(w.root, "g-glow-salon-whatsapp", "whatsapp_authorization");
    mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, `Bearer ${TOKEN}\n`); // as the intake writes it from whatsapp_token
    m.seed("order_reminder", "en", "REJECTED", "INVALID_FORMAT");
    const sent = await run(w.root, "glow-salon", { ...flags, submit: true }, env);
    assert.equal(sent.code, 0, sent.out);
    assert.deepEqual(m.created.map((c) => c.body.name).sort(), ["order_confirmed", "order_hold_ended"]);
    assert.ok(m.created.every((c) => c.authorization === `Bearer ${TOKEN}` && c.wabaId === WABA));
    assert.match(sent.out, /skip order_reminder \(en\): already rejected \(needs a look in WhatsApp Manager/u);
    assert.ok(!sent.out.includes(TOKEN), "the token is never printed");
    m.setState("order_confirmed", "en", "APPROVED");
    const status = await run(w.root, "glow-salon", { ...flags, status: true }, env);
    assert.match(status.out, /order_confirmed \(en\): approved/u); assert.match(status.out, /order_reminder \(en\): rejected \(INVALID_FORMAT\)/u);
    assert.match(status.out, /Summary: 1 approved, 1 waiting, 1 rejected/u, "the list was read over two pages");
    const wrong = await run(w.root, "glow-salon", { ...flags, submit: true }, { ...env, WHATSAPP_TOKEN: "EAAwrongtoken0123456789" });
    assert.equal(wrong.code, 1); assert.match(wrong.out, /Stopped: Meta did not accept the shop's key \(Meta: Invalid OAuth access token/u);
    assert.equal(m.created.length, 2);
  } finally { await m.close(); w.done(); }
});

test("Meta's limit of 100 new templates an hour stops the run without calling the rest refused", async () => {
  const w = tempServer({ "glow-salon": metaDirect() }); const m = await startMetaTemplateStandin({ wabaId: WABA, rateAfter: 2 });
  try {
    const env = { WHATSAPP_GRAPH_BASE: m.url, WHATSAPP_TOKEN: TOKEN };
    const flags = { template: "orders", languages: "en", submit: true };
    const first = await run(w.root, "glow-salon", flags, env);
    assert.equal(first.code, 1); assert.match(first.out, /Stopped at \S+ \(en\): Meta says too many calls just now/u); assert.match(first.out, /Submitted 2, refused 0 \(stopped early\)/u);
  } finally { await m.close(); w.done(); }
});

test("the command is wired into the bundle's command line, and its help carries the plain steps", async () => {
  const lines: string[] = []; const log = console.log; console.log = (...a: unknown[]) => lines.push(a.join(" "));
  try { await main(["help"]); } finally { console.log = log; }
  const help = lines.join("\n");
  assert.match(help, /whatsapp-templates <shop>/u); assert.match(help, /GUPSHUP_APIKEY=/u); assert.match(help, /WHATSAPP_TOKEN=/u); assert.match(help, /DRY RUN/u);
});
