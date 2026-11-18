// The directory's buyer assistant, wired (decision 60, 19 Nov 2026, once the owner approved the budget numbers): the budget comes from the price list in force; the directory's config
// carries the `assistant` block only then; the directory joins the model Guard on ONE network of its own and still reaches only the door, the feeds and that Guard; its credential is a
// file only its container reads; and the service sends it as the Guard's bearer. Tests give fakes: no model, no network, no key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASSISTANT_NETWORK, addressing, composeServer } from "../generate/compose.ts";
import type { ShopDeploy } from "../generate/compose.ts";
import { DIRECTORY_SECRET_FILE, directoryConfig } from "../generate/configs.ts";
import { guardUrl, names } from "../generate/shop.ts";
import { DIRECTORY_AGENT_ID, directoryAssistant, discoveryBudgetFor } from "../lib/budget.ts";
import { PRICES_DIR, latestPriceList, loadPriceList } from "../panel/cost.ts";
import { bearerFetch } from "../services/directory.ts";
import { serverConfig } from "./helpers.ts";

const DIRS = { app: "/repo", generated: "/srv/generated", secrets: "/srv/secrets", status: "/srv/status", fleet: "/srv/fleet", shops: "/srv/shops", secretsInbox: "/srv/secrets-inbox", requests: "/srv/requests", exports: "/srv/exports", panelData: "/srv/panel", config: "/srv/geometer.json", licence: "/srv/state/licence", home: "/srv/home" };
const hosted = (extra: Record<string, unknown> = {}) => serverConfig({ panel: { enabled: true, mode: "hosted" }, fleet: { url: "https://fleet.example", keyFile: "fleet.key" }, pages: { domain: "pages.example", extraDomains: [] }, ...extra });
const shop = (name: string, index: number): ShopDeploy => ({ name, index, pathwayDir: "/repo/templates/commerce/bookings", guards: (["razorpay", "whatsapp", "calendar"] as const).map((kind) => ({ kind, service: names.guard(name, kind), tenant: name })) });
const nets = (c: ReturnType<typeof composeServer>, svc: string): string[] => Object.keys((c.services[svc].block.networks as Record<string, unknown> | undefined) ?? {}).sort();
const inForce = latestPriceList();
const before = loadPriceList(new URL("2026-11-14.json", PRICES_DIR).pathname);

test("the directory's assistant is on only where the server has the directory and a model, and the price list in force has its budget", () => {
  const b = directoryAssistant(hosted(), inForce)!;
  assert.deepEqual([b.monthlyMicroInr, b.daily.buyer, b.perBuyerPerDay], [2_500_000_000, 1500, 12]);
  assert.deepEqual(b, discoveryBudgetFor(inForce));
  assert.equal(directoryAssistant(hosted(), before), undefined, "a list with no budget: off");
  assert.equal(directoryAssistant(serverConfig({ panel: { enabled: true } }), inForce), undefined, "no pages domain, no directory");
  assert.equal(directoryAssistant({ ...hosted(), model: { ...hosted().model, model: "" } }, inForce), undefined, "no model chosen");
  assert.deepEqual(directoryAssistant(hosted()), directoryAssistant(hosted(), inForce), "by default it reads the list in force");
});

test("its config: the budget, the model by the Guard's address, the credential's file name and never the credential; with no budget there is no block", () => {
  const server = hosted();
  const withIt = JSON.parse(directoryConfig(server, directoryAssistant(server, inForce))!);
  assert.deepEqual(withIt.assistant, {
    monthlyMicroInr: 2_500_000_000, dailyCalls: 1500, perBuyerPerDay: 12,
    model: { wire: "openai", baseUrl: `${guardUrl("g-model")}/v1`, model: "gpt-4o-mini" }, agentTokenFile: DIRECTORY_SECRET_FILE,
    ...(withIt.assistant.provider ? { provider: withIt.assistant.provider } : {}),
  });
  assert.equal(DIRECTORY_SECRET_FILE, "/run/secrets/agent_model");
  assert.equal(JSON.parse(directoryConfig(server)!).assistant, undefined, "no budget: the assistant is off and the search page has no box");
  assert.equal(JSON.parse(directoryConfig(server, directoryAssistant(server, before))!).assistant, undefined);
  assert.ok(!/Bearer|"[A-Za-z0-9_-]{40,}"/u.test(JSON.stringify(withIt)), "no credential in the file");
});

test("compose: the model Guard and the directory share one internal network of their own; the directory still reaches only the door, the feeds and that Guard", () => {
  const c = composeServer(hosted(), DIRS, [shop("glow-salon", 1)], { assistant: true });
  assert.deepEqual(nets(c, "directory"), ["assistant", "egress", "pages"]);
  assert.ok(nets(c, "fwd-model").includes(ASSISTANT_NETWORK), "the Guard is reachable there");
  assert.deepEqual(Object.keys(c.services).filter((s) => nets(c, s).includes(ASSISTANT_NETWORK)).sort(), ["directory", "fwd-model"], "nobody else is on it");
  assert.match(c.compose, /\n  assistant:\n    internal: true/u, "it has no way out");
  const subnets = addressing(hosted()).subnets;
  assert.equal(new Set(Object.values(subnets)).size, Object.keys(subnets).length, "its subnet overlaps none");
  const d = c.services.directory.block as { volumes: string[] };
  assert.ok(d.volumes.includes("/srv/secrets/directory:/run/secrets:ro"), "its own credential folder, read-only");
  assert.ok(!d.volumes.some((v) => v.includes("/secrets/") && !v.includes("/secrets/directory")), "no other secret");
  for (const n of ["admin", "front", "panel", "net-glow-salon"]) assert.ok(!nets(c, "directory").includes(n), `the directory is not on ${n}`);
  assert.ok(nets(c, "fwd-model").includes("net-glow-salon"), "the shops still reach the Guard as before");
});

test("compose without the assistant is as it was: no assistant network, no credential folder; and with no shop there is no model Guard to reach", () => {
  const plain = composeServer(hosted(), DIRS, [shop("glow-salon", 1)], {});
  assert.deepEqual(nets(plain, "directory"), ["egress", "pages"]);
  assert.doesNotMatch(plain.compose, /\n  assistant:\n    internal/u);
  assert.ok(!(plain.services.directory.block.volumes as string[]).some((v) => v.includes("/secrets")));
  const noShops = composeServer(hosted(), DIRS, [], { assistant: true });
  assert.deepEqual(nets(noShops, "directory"), ["egress", "pages"]);
  assert.equal(noShops.services["g-model"], undefined);
  const noPages = composeServer(serverConfig({ panel: { enabled: true } }), DIRS, [shop("glow-salon", 1)], { assistant: true });
  assert.ok(!noPages.compose.includes(`\n  ${ASSISTANT_NETWORK}:`), "no directory, no network");
});

test("the directory is one more agent of the model Guard under its own id, which no shop's id can be", () => {
  assert.equal(DIRECTORY_AGENT_ID, "directory-assistant");
  assert.notEqual(DIRECTORY_AGENT_ID, names.agentId("directory-assistant"), "a shop named so is `runtime-directory-assistant`");
  assert.ok(!names.agentId("x").startsWith(DIRECTORY_AGENT_ID));
});

test("the service sends its credential to the model Guard as a bearer, and is off (with a line) when the file cannot be read or is empty", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-dir-"));
  try {
    const file = join(dir, "agent_model");
    writeFileSync(file, "tok-123\n");
    const seen: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => { seen.push(String((init?.headers as Record<string, string>).authorization)); return new Response("{}"); }) as typeof fetch;
    try { await bearerFetch(file)!("http://g-model:8081/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" } }); } finally { globalThis.fetch = real; }
    assert.deepEqual(seen, ["Bearer tok-123"]);
    const lines: string[] = [];
    assert.equal(bearerFetch(join(dir, "missing"), (l) => lines.push(l)), undefined);
    writeFileSync(join(dir, "empty"), "\n");
    assert.equal(bearerFetch(join(dir, "empty"), (l) => lines.push(l)), undefined);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /assistant is off/u);
    assert.equal(bearerFetch(undefined), undefined, "no file named: no credential, as before");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
