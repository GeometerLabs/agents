// A listings-only shop on the server (18 Nov 2026): the kind row, the plan (no Guard), the compose file (ONE shared container and door whatever the number of such shops, and a server
// without one composes as before), the shared services' configs (the inbox reaches a shop by a path on the shared door), the folders (client, secrets, data), the panel's form and
// preset, the move into a runtime of its own when the shop takes an agent (its listings kept), and the backup's paths.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeServer } from "../generate/compose.ts";
import type { ShopDeploy } from "../generate/compose.ts";
import { inboxConfig, opsConfig } from "../generate/configs.ts";
import { SHARED, dataVolumeOf, dbPathOf, names, planShop, secretsHolderOf, sharedPaths } from "../generate/shop.ts";
import { KINDS, guardsOf, isShared, kindFor } from "../lib/kinds.ts";
import { carry } from "../lib/listings-carry.ts";
import { needsMove } from "../lib/listings-move.ts";
import type { State } from "../lib/state.ts";
import { shopIndex } from "../lib/state.ts";
import { openStore } from "../../modules/runtime/store.ts";
import { assistantOf } from "../../modules/assistant/state.ts";
import { listingsOf, draft, publish } from "../../modules/listings/listings.ts";
import { ownerAuthority } from "../../modules/memory/memory.ts";
import { parseStore as parseListings, serializeStore as serializeListings } from "../../templates/commerce/listings/server/snapshot.ts";
import { parseStore as parseOrders } from "../../templates/commerce/orders/server/snapshot.ts";
import { parseStore as parseFees } from "../../templates/education/fees/server/snapshot.ts";
import { parseStore as parseBookings } from "../../templates/commerce/bookings/server/snapshot.ts";
import { parseStore as parseStock } from "../../templates/commerce/stock-orders/server/snapshot.ts";
import { parseSettings } from "../../templates/commerce/listings/src/settings.ts";
import { loadPresets, PHONE_TEMPLATES, PRESETS_DIR } from "../panel/presets.ts";
import { SETUPS } from "../panel/setups.ts";
import { buildListingsSettings, newListingsDraft, applyListingsBusiness } from "../panel/listings.ts";
import { WORDS } from "../panel/languages.ts";
import { serverConfig } from "./helpers.ts";

const dirs: string[] = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const D = { app: "/repo", generated: "/srv/generated", secrets: "/srv/secrets", status: "/srv/status", fleet: "/srv/fleet", shops: "/srv/shops", secretsInbox: "/srv/secrets-inbox", requests: "/srv/requests", exports: "/srv/exports", panelData: "/srv/panel", config: "/srv/geometer.json", licence: "/srv/state/licence" };
const own = (name: string, index: number): ShopDeploy => ({ name, index, pathwayDir: "/repo/templates/commerce/bookings", guards: (["razorpay", "whatsapp", "calendar"] as const).map((kind) => ({ kind, service: names.guard(name, kind), tenant: name })) });
const shared = (name: string): ShopDeploy => ({ name, index: 0, shared: true, pathwayDir: "/repo/templates/commerce/listings", guards: [] });
const build = (shops: ShopDeploy[]) => composeServer(serverConfig({ panel: { enabled: true } }), D, shops, { panel: { user: "501:20", shareAddress: "calendar@x.iam.gserviceaccount.com" } });
const nets = (c: ReturnType<typeof build>, svc: string): string[] => { const n = c.services[svc].block.networks as Record<string, unknown> | string[] | undefined; return n === undefined ? [] : Array.isArray(n) ? n : Object.keys(n); };

// ---- the kind ------------------------------------------------------------------------------------------------------------------------------------

test("the listings kind: shared, no Guard, no go-live paper, and the other templates are not shared", () => {
  const k = kindFor("listings")!;
  assert.equal(k.shared, true);
  assert.deepEqual(guardsOf(k, {}), []);
  assert.equal(k.papers, undefined);
  assert.equal(isShared("listings"), true);
  for (const other of ["bookings", "fees", "orders", "stock-orders", undefined, "nonsense"]) assert.equal(isShared(other), false, String(other));
  assert.equal(k.validateSettings({ name: "X", place: { town: "T" }, languages: ["en"], owner: { language: "en" } }).ok, true);
  assert.equal(kindFor("bookings")!.validateSettings({ name: "X" }).ok, false, "a listings shop is not mistaken for another kind, nor the other way round");
});

// ---- the plan -----------------------------------------------------------------------------------------------------------------------------------

test("a listings-only shop's plan has no Guard, lists on a port of its own on the loopback address, and meters the model on its own agent credential", () => {
  const server = serverConfig({});
  const settings = parseSettings({ name: "Sree Pet Corner", place: { town: "Thrissur" }, languages: ["en"], owner: { language: "en" } });
  const folder = { name: "sree-pets", settingsText: "", pinsText: "", pins: {}, settings, runtime: { mode: "live", services: {}, parser: { wire: server.model.wire, model: server.model.model } }, lock: { pathway: "listings", version: "0.1.0" }, lockText: "", problems: [], preparedBy: "x", preparedBySource: "default", innovator: false } as never;
  const plan = planShop(server, folder);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.guards, [], "no Guard of its own: it takes no money and sends no WhatsApp");
  const rt = plan.runtime as Record<string, any>;
  assert.equal(rt.host, "127.0.0.1");
  assert.equal(rt.port, 0);
  assert.equal(rt.dataDir, sharedPaths("sree-pets").data);
  assert.deepEqual(rt.services, {});
  assert.equal(rt.parser.agentTokenFile, `${sharedPaths("sree-pets").secrets}/agent_model`);
  assert.equal(rt.allowance, undefined, "no hand-written cap: the budget is the caps module's");
  assert.ok(!JSON.stringify(rt).includes("agent_push") && !JSON.stringify(rt).includes("agent_whatsapp"));
});

// ---- compose -------------------------------------------------------------------------------------------------------------------------------------

test("one shared container, one door and one network for every listings-only shop: a new shop changes no service", () => {
  const two = build([own("glow-salon", 1), shared("sree-pets"), shared("glow-pets")]);
  const three = build([own("glow-salon", 1), shared("sree-pets"), shared("glow-pets"), shared("new-shop")]);
  for (const name of ["rt-sree-pets", "rt-glow-pets", "door-sree-pets", "g-sree-pets-push", "net-sree-pets", "rd-sree-pets"]) assert.ok(!two.compose.includes(name), `${name} does not exist: a listings-only shop has no container of its own`);
  assert.ok(two.services["rt-listings"] && two.services["door-listings"]);
  assert.equal(JSON.stringify(three.services["rt-listings"]), JSON.stringify(two.services["rt-listings"]), "adding a shop leaves the shared container's entry byte for byte as it was");
  assert.equal(JSON.stringify(three.services["door-listings"]), JSON.stringify(two.services["door-listings"]));
  assert.deepEqual(two.services["rt-listings"].files, [], "no file is listed, so adding a shop restarts nothing");
  const block = two.services["rt-listings"].block;
  assert.deepEqual(Object.keys(block.environment as object).sort(), ["HOST", "PORT", "SCAN_SECONDS", "SHOPS_DIR", "SECRETS_DIR"].sort(), "no token, key or token file in the environment: every shop's are files handed to that shop alone");
  assert.ok(!JSON.stringify(block).includes("INTERNAL_TOKEN_FILE") && !JSON.stringify(block).includes("RECORD_KEY_FILE") && !JSON.stringify(block).includes("CHANNEL_TOKEN_FILE"));
  const mounts = (block.volumes as string[]);
  assert.ok(mounts.includes("/srv/generated/listings:/shops:ro"), "its shops' client folders only, read-only");
  assert.ok(mounts.includes(`/srv/secrets/${SHARED.runtime}:/run/secrets:ro`));
  assert.ok(mounts.includes(`${SHARED.dataVolume}:/home/node`));
  assert.ok(!mounts.some((m) => m.includes("/srv/generated/shops") || m.includes("/srv/secrets:") || m.includes("docker.sock")), "no other shop's folder and no Docker socket");
});

test("the shared network holds only the shared container, its door and the model Guard; the container is on no other network", () => {
  const c = build([own("glow-salon", 1), shared("sree-pets")]);
  assert.deepEqual(nets(c, "rt-listings"), [SHARED.net]);
  const members = Object.keys(c.services).filter((s) => nets(c, s).includes(SHARED.net)).sort();
  assert.deepEqual(members, ["door-listings", "fwd-model", "rt-listings"]);
  assert.match(c.compose, new RegExp(`\\n  ${SHARED.net}:\\n    internal: true`), "no way out");
  const door = c.services["door-listings"].block;
  const ip = ((door.networks as Record<string, { ipv4_address?: string }>).admin).ipv4_address!;
  assert.deepEqual(door.command, ["nc", "-ll", "-s", ip, "-p", "8780", "-e", "nc", "rt-listings", "8780"]);
  assert.ok(nets(c, "fwd-model").includes(SHARED.net));
  assert.ok(c.compose.includes(`${SHARED.dataVolume}: {}`) || c.compose.includes(`  ${SHARED.dataVolume}:`));
});

test("a server with no listings-only shop has none of it: its compose file is as before", () => {
  const c = build([own("glow-salon", 1)]);
  for (const name of [SHARED.runtime, SHARED.door, SHARED.net, SHARED.dataVolume]) assert.ok(!c.compose.includes(name), name);
  assert.deepEqual(nets(c, "fwd-model").sort(), ["admin", "egress", "net-glow-salon"]);
});

test("a server with ONLY listings-only shops has the model Guard and the shared container, and no push sender, relay Guard or report folder", () => {
  const c = build([shared("sree-pets")]);
  assert.ok(c.services["fwd-model"] && c.services["rt-listings"]);
  assert.ok(!c.services.push, "no shop has a push Guard, so there is no sender to serve");
  assert.deepEqual(Object.keys(c.services).filter((s) => s.startsWith("rd-") || /^g-.+-(razorpay|whatsapp|calendar|push)$/u.test(s)), []);
});

// ---- the shared services' configs ---------------------------------------------------------------------------------------------------------------

test("the inbox and ops reach a listings-only shop by a path on the shared door, and the shop's page is the listings kind", () => {
  const server = serverConfig({});
  const s = { ...shared("sree-pets"), webhooks: { verification: "meta-signature" as const, hasGoogle: false, ownGoogleKey: false }, ownerWhatsapp: "", phoneNumberId: "", pathway: "listings", pathwayVersion: "0.1.0" };
  const inbox = JSON.parse(inboxConfig(server, [s as never]));
  assert.match(inbox.shops["sree-pets"].runtimeUrl, /^http:\/\/10\.\d+\.\d+\.\d+:8780\/shop\/sree-pets$/u);
  assert.equal(inbox.shops["sree-pets"].channel.kind, "listings");
  assert.ok(!("relayUrl" in inbox.shops["sree-pets"]), "no refund is ever held for it: no relay");
  const ops = JSON.parse(opsConfig(server, [s as never]));
  assert.equal(ops.shops["sree-pets"].runtimeUrl, inbox.shops["sree-pets"].runtimeUrl);
  assert.deepEqual(ops.shops["sree-pets"].guards.map((g: { id: string }) => g.id), ["guard-model"], "its only Guard is the model Guard");
  assert.equal(ops.shops["sree-pets"].internalTokenFile, "/run/secrets/sree-pets/internal_token");
});

// ---- where a shop's files are ------------------------------------------------------------------------------------------------------------------

test("a shared shop's data is a folder of the shared volume laid out as any shop's volume, one level down; the helpers say so in one place", () => {
  assert.equal(dataVolumeOf("sree-pets", true), "rt-data-listings");
  assert.equal(dataVolumeOf("glow-salon", false), "rt-data-glow-salon");
  assert.equal(dbPathOf("/v/rt-data-listings", "sree-pets", true), "/v/rt-data-listings/sree-pets/data/agent.db");
  assert.equal(dbPathOf("/v/rt-data-glow-salon", "glow-salon", false), "/v/rt-data-glow-salon/data/agent.db");
  assert.equal(secretsHolderOf("sree-pets", true), "rt-listings/sree-pets");
  assert.equal(secretsHolderOf("glow-salon", false), "rt-glow-salon");
  assert.equal(sharedPaths("sree-pets").data, "/home/node/sree-pets/data");
});

test("a listings-only shop takes no place in the pool of network addresses until it takes an agent", () => {
  const state = { schema: 1, shops: { "sree-pets": { index: 0, guards: {}, lockHistory: [] }, "glow-salon": { index: 1, guards: {}, lockHistory: [] } } } as State;
  assert.equal(shopIndex(state, "glow-salon"), 1, "a shop with an address keeps it");
  assert.equal(shopIndex(state, "sree-pets"), 2, "index 0 means none: the shop that takes an agent gets the lowest free one");
  assert.equal(shopIndex(state, "brand-new"), 2);
});

// ---- taking an agent: the listings stay -----------------------------------------------------------------------------------------------------------

function listingsShopFile(): string {
  const root = mkdtempSync(join(tmpdir(), "listings-move-"));
  dirs.push(root);
  const store = openStore(root);
  const s = parseListings(serializeListings({}));
  const l = listingsOf(assistantOfCreate(s));
  const made = draft(l, { category: "pets", words: { en: { title: "Two Persian kittens", text: "Eight weeks old." } }, ownerLang: "en", pricePaise: 800_000, by: "owner", from: "app" } as never, { nowMs: Date.now() });
  assert.ok(made.ok);
  assert.ok(publish(l, ownerAuthority("app"), (made as { value: { id: string } }).value.id, { nowMs: Date.now() }).ok);
  store.commitStep({ snapshot: serializeListings(s), entries: [], nowMs: Date.now() });
  store.close();
  return root;
}
/** The store's assistant part, made on first use (the same call the agent makes). */
function assistantOfCreate(s: { assistant?: unknown }) { return assistantOf(s as never); }

test("a listings-only shop that takes an agent keeps its listings: the file is converted for each template and the same listing is in it", () => {
  for (const [target, parse] of [["bookings", parseBookings], ["orders", parseOrders], ["fees", parseFees], ["stock-orders", parseStock]] as const) {
    const root = listingsShopFile();
    const r = carry(root, target);
    assert.deepEqual(r, { ok: true, listings: 1 }, target);
    const store = openStore(root);
    const read = parse(store.loadState().snapshot!) as { assistant?: { listings?: { items: { words: { en: { title: string } } }[] } } };
    store.close();
    assert.equal(read.assistant?.listings?.items[0].words.en.title, "Two Persian kittens", `${target} reads the shop's listing from the converted file`);
  }
});

test("the conversion refuses what is not a listings-only shop's file, and a template that is not an agent's", () => {
  const root = listingsShopFile();
  assert.equal(carry(root, "listings").ok, false);
  assert.equal(carry(root, "nonsense").ok, false);
  const once = carry(root, "orders");
  assert.ok(once.ok);
  assert.equal(carry(root, "orders").ok, false, "an orders store is not a listings-only one: nothing is converted twice");
});

test("a move is needed only from a shared pathway to one that is not", () => {
  const state = { schema: 1, shops: { a: { index: 0, guards: {}, lockHistory: [], applied: { pathway: "listings@0.1.0" } }, b: { index: 1, guards: {}, lockHistory: [], applied: { pathway: "orders@0.1.0" } } } } as unknown as State;
  assert.equal(needsMove(state, "a", "orders"), true);
  assert.equal(needsMove(state, "a", "listings"), false);
  assert.equal(needsMove(state, "b", "orders"), false);
  assert.equal(needsMove(state, "nobody", "orders"), false);
  assert.ok(KINDS.listings && KINDS.orders.storeWith, "every template that can take the shop has a way to hold what it carries");
});

// ---- the panel -------------------------------------------------------------------------------------------------------------------------------

test("the preset 'Only show what the shop has (free)' is offered, in four languages, for a template the phone form can set up", () => {
  assert.ok(PHONE_TEMPLATES.includes("listings") && SETUPS.listings);
  const presets = loadPresets(PRESETS_DIR, ["bookings", ...Object.keys(SETUPS)]);
  const p = presets.find((x) => x.id === "shows-only")!;
  assert.equal(p.template, "listings");
  for (const l of ["en", "hi", "ml", "kn"] as const) assert.match(p.names[l], /\S/u);
  assert.match(p.names.en, /free/iu);
});

test("the form: name, town, trade and languages make the shop; no payment or WhatsApp is asked; the owner's number is optional", () => {
  const w = WORDS.en;
  const example = parseSettings({ name: "X", place: { town: "T" }, languages: ["en"], owner: { language: "en" } });
  const d = newListingsDraft("draft-1", "acct", { id: "listings", version: "0.1.0" } as never, example, "2026-11-18T10:00:00Z");
  assert.equal(applyListingsBusiness(d, { name: "", town: "", pincode: "012345" }, w).problems.length, 3, "name, town and pincode are each said");
  assert.deepEqual(applyListingsBusiness(d, { name: "Sree Pet Corner", town: "Thrissur", pincode: "680001", trade: "pets" }, w).problems, []);
  d.primaryLanguage = "ml"; d.otherLanguages = ["en"]; d.ownerLanguage = "ml";
  const built = buildListingsSettings(d, example);
  assert.ok(built.ok, JSON.stringify(built));
  const s = (built as { settings: ReturnType<typeof parseSettings> }).settings;
  assert.equal(s.owner.noNumber, true);
  assert.equal(s.place.town, "Thrissur");
  assert.equal(SETUPS.listings.runtime("", { wire: "openai", model: "m" }).services && Object.keys(SETUPS.listings.runtime("", undefined).services as object).length, 0, "runtime.json names no service");
  d.ownerNumber = "+919812345678";
  assert.equal((buildListingsSettings(d, example) as { settings: ReturnType<typeof parseSettings> }).settings.owner.whatsapp, "+919812345678");
});

// ---- backup, the owner's file, and the heartbeat ----------------------------------------------------------------------------------------------------

test("backup: the shared volume is mounted ONCE for every shared shop, and each shop's database is its own folder of it", async () => {
  const { dataMounts, dbOf, sharedOf } = await import("../backup/jobs.ts");
  const state = { schema: 1, shops: {
    "sree-pets": { index: 0, guards: {}, lockHistory: [], applied: { pathway: "listings@0.1.0" } },
    "glow-pets": { index: 0, guards: {}, lockHistory: [], applied: { pathway: "listings@0.1.0" } },
    "glow-salon": { index: 1, guards: {}, lockHistory: [], applied: { pathway: "bookings@0.1.0" } },
  } } as unknown as State;
  const server = serverConfig({});
  assert.equal(sharedOf(state, "sree-pets"), true);
  assert.equal(sharedOf(state, "glow-salon"), false);
  assert.equal(dbOf(state, "sree-pets"), "/v/rt-data-listings/sree-pets/data/agent.db");
  assert.equal(dbOf(state, "glow-pets"), "/v/rt-data-listings/glow-pets/data/agent.db");
  assert.equal(dbOf(state, "glow-salon"), "/v/rt-data-glow-salon/data/agent.db");
  const mounts = dataMounts(server, state, ["sree-pets", "glow-pets", "glow-salon"]);
  assert.deepEqual(mounts.filter((m) => m !== "-v"), [`geometer-acme-vps-1_rt-data-listings:/v/rt-data-listings`, `geometer-acme-vps-1_rt-data-glow-salon:/v/rt-data-glow-salon`], "two shared shops, one mount: Docker refuses the same mount point twice");
});

test("the owner's file and the export carry a listings-only shop: its record and its listings, and no cases file", async () => {
  const { exportShop } = await import("../backup/export.ts");
  const root = listingsShopFile();
  const keyFile = join(root, "person-key");
  writeFileSync(keyFile, "0f".repeat(32), { mode: 0o600 });
  const out = join(root, "out");
  const r = exportShop({ name: "sree-pets", db: join(root, "agent.db"), out, personKeyFile: keyFile } as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  const files = readdirSync(out).sort();
  assert.ok(files.includes("record.json") && files.includes("listings.json") && files.includes("person-form.json"), files.join(", "));
  assert.ok(!files.some((f) => /^(bookings|dues|orders|purchase-orders)\.json$/u.test(f)), "no cases file for a shop with no cases");
  const listed = JSON.parse(readFileSync(join(out, "listings.json"), "utf8")) as { items?: { words: { en: { title: string } } }[] } | { words: { en: { title: string } } }[];
  assert.match(JSON.stringify(listed), /Two Persian kittens/u);
});

test("the heartbeat carries a listings-only shop's counts in the one map fleet reads", async () => {
  const src = readFileSync(new URL("../services/heartbeat.ts", import.meta.url), "utf8");
  assert.match(src, /known\?\.orders \?\? known\?\.listings/u);
});

test("a listings-only shop's budget is the caps module's, under the plan listings-only, and nothing until a list that has it is in force", async () => {
  const { budgetFor } = await import("../lib/budget.ts");
  const list = { rates: { "ai.budget.listings-only": { micro: 6_000_000 }, "ai.daily.listing-draft": { count: 10 }, "ai.daily.listings-only.owner-talk": { count: 30 }, "ai.daily.listings-only.customer-talk": { count: 50 } } };
  assert.deepEqual(budgetFor("listings-only", list)?.daily, { owner_talk: 30, listing_draft: 10, customer_talk: 50 });
  assert.equal(budgetFor("listings-only", { rates: {} }), undefined, "a list with no entry gives no budget: the shop is inert, as every shop is before approval");
  const server = serverConfig({});
  const settings = parseSettings({ name: "X", place: { town: "T" }, languages: ["en"], owner: { language: "en" } });
  const folder = { name: "x", settingsText: "", pinsText: "", pins: {}, settings, runtime: { mode: "live", services: {} }, lock: { pathway: "listings", version: "0.1.0" }, lockText: "", problems: [], preparedBy: "x", preparedBySource: "default", innovator: false, budget: budgetFor("listings-only", list) } as never;
  assert.ok((planShop(server, folder).runtime as Record<string, unknown>).budget, "the generated runtime.json carries the budget");
});
