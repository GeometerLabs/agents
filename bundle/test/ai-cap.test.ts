// The month's AI cap (9 Nov; price list `ai.cap`): fleet answers `model: "normal" | "off"` for a shop on Geometer's server with a plan, ops keeps it in <server>/fleet/<shop>.json,
// and "off" becomes `"model": "off"` in the shop's GENERATED runtime config, only there, and only if the pathway's own validator knows the key (as button mode does).
// A missing or unknown `model` keeps the last mode: the cap is lifted only by fleet saying "normal".
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateRuntimeConfig } from "../../templates/commerce/bookings/server/config.ts";
import { applyOnce } from "../apply.ts";
import { deploy, desiredHashOf } from "../deploy.ts";
import { planShop, withFleetModel } from "../generate/shop.ts";
import { parseShopAnswer, readAnswerFile, writeAnswerFiles } from "../lib/fleet.ts";
import type { ShopAnswer } from "../lib/fleet.ts";
import { loadState } from "../lib/state.ts";
import { serverConfig, tempServer } from "./helpers.ts";
import { world } from "./world.ts";

const NOW = "2026-11-20T10:00:00.000Z";
const answer = (more: Record<string, unknown> = {}) => ({ schema: 1, at: NOW, plan: "business", allowance: 3000, innovator: false, ai: "normal", model: "off", warn: ["ai_cap"], ...more });
const putAnswer = (paths: { fleet: string; fleetAnswer: (n: string) => string }, value: unknown, shop = "glow-salon") => { mkdirSync(paths.fleet, { recursive: true }); writeFileSync(paths.fleetAnswer(shop), typeof value === "string" ? value : JSON.stringify(value)); };

test("fleet's entry: model is read only as normal or off; anything else is left out, and the rest of the entry is kept", () => {
  const entry = (model: unknown) => parseShopAnswer({ plan: "business", allowance: 3000, ai: "normal", warn: ["ai_cap"], model });
  assert.equal(entry("off")?.model, "off");
  assert.equal(entry("normal")?.model, "normal");
  for (const odd of [undefined, "OFF", "capped", 0, null, true]) {
    const e = entry(odd);
    assert.ok(e && !("model" in e), String(odd));
    assert.deepEqual([e!.plan, e!.warn], ["business", ["ai_cap"]], "a bad model does not drop the entry, unlike a bad ai");
  }
});

test("ops keeps the last model mode when fleet's entry has none or a garbled one; only fleet saying normal lifts the cap", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-fleet-"));
  try {
    const write = (raw: Record<string, unknown>) => { writeAnswerFiles(dir, ["glow-salon"], { "glow-salon": parseShopAnswer({ plan: "business", allowance: 3000, ai: "normal", warn: [], ...raw }) as ShopAnswer }, new Date(NOW)); return readAnswerFile(join(dir, "glow-salon.json")); };
    assert.equal(write({ model: "off" })?.model, "off");
    assert.equal(write({})?.model, "off", "off, then missing: stays off");
    assert.equal(write({ model: "capped" })?.model, "off", "off, then garbage: stays off");
    assert.deepEqual(write({ model: "normal", warn: ["balance_80"] })?.warn, ["balance_80"], "the rest of the entry is written either way");
    assert.equal(readAnswerFile(join(dir, "glow-salon.json"))?.model, "normal", "off, then normal: normal");
    assert.equal(write({})?.model, "normal");
    rmSync(join(dir, "glow-salon.json"));
    assert.equal(write({})?.model, undefined, "no file before and no field: nothing is made up");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("only off for a shop with a plan reaches the shop folder: normal, no plan, a wrong value and no file all add nothing", () => {
  const t = tempServer(); try {
    const model = (more: Record<string, unknown> = {}) => { putAnswer(t.paths, answer(more)); return t.shop("glow-salon").fleetModel; };
    assert.equal(model(), "off");
    assert.equal(model({ model: "normal" }), undefined);
    assert.equal(model({ plan: null }), undefined, "a shop with no plan (a builder's, an own agent) has no cap");
    assert.equal(model({ model: "turbo" }), undefined);
    putAnswer(t.paths, "{ not json");
    assert.equal(t.shop("glow-salon").fleetModel, undefined);
  } finally { t.done(); }
});

test("today's pathway knows model: off goes into the generated config with the real validator, the shop still starts, and normal removes it; the panel's runtime.json is never touched", () => {
  const t = tempServer(); try {
    const panelFile = join(t.paths.shop("glow-salon"), "runtime.json");
    const before = readFileSync(panelFile, "utf8");
    putAnswer(t.paths, answer());
    const p = planShop(serverConfig(), t.shop("glow-salon"));
    assert.equal(p.runtime.model, "off");
    assert.equal("ai" in p.runtime, false, "the cap is not button mode");
    assert.equal(validateRuntimeConfig(p.runtime, "/").ok, true, "so the shop starts");
    assert.deepEqual([p.notes, p.problems], [[], []]);
    putAnswer(t.paths, answer({ model: "normal" }));
    assert.equal("model" in planShop(serverConfig(), t.shop("glow-salon")).runtime, false);
    assert.equal(readFileSync(panelFile, "utf8"), before);
  } finally { t.done(); }
});

test("an older pathway that does not know model: the cap is skipped, the shop keeps its language model, and a note says why", () => {
  const t = tempServer(); try {
    putAnswer(t.paths, answer());
    const oldPathway = (config: unknown, folder: string) => ("model" in (config as object) ? { ok: false } : validateRuntimeConfig(config, folder));
    const p = planShop(serverConfig(), t.shop("glow-salon"), {}, oldPathway);
    assert.equal("model" in p.runtime, false);
    assert.equal(p.notes.length, 1);
    assert.match(p.notes[0], /does not know the model setting yet, so the shop keeps its language model/u);
    assert.deepEqual(p.problems, []);
    const notes: string[] = [];
    assert.deepEqual(withFleetModel({}, "off", oldPathway, notes), {}, "no runtime, nothing to add to");
    assert.deepEqual(notes, []);
  } finally { t.done(); }
});

test("the cap is part of what the shop is asked to be: off changes the desired hash, normal restores it, and a shop that never had it keeps its hash", () => {
  const t = tempServer(); try {
    const plain = desiredHashOf(t.shop("glow-salon"));
    putAnswer(t.paths, answer({ model: "normal" }));
    assert.equal(desiredHashOf(t.shop("glow-salon")), plain, "'normal' is nothing");
    putAnswer(t.paths, answer());
    assert.notEqual(desiredHashOf(t.shop("glow-salon")), plain);
    putAnswer(t.paths, answer({ model: "normal" }));
    assert.equal(desiredHashOf(t.shop("glow-salon")), plain);
  } finally { t.done(); }
});

test("the deployer redeploys a shop when fleet caps it, writes model: off, and redeploys again when fleet says normal", async () => {
  const w = world();
  try {
    w.handIn("glow-salon");
    await deploy(w.ctx);
    const first = loadState(w.root).shops["glow-salon"].applied!.desiredHash;
    putAnswer(w.paths, answer());
    assert.deepEqual((await applyOnce(w.ctx)).applied, ["glow-salon"]);
    const generated = JSON.parse(readFileSync(join(w.root, "generated", "shops", "glow-salon", "client", "runtime.json"), "utf8"));
    assert.equal(generated.model, "off");
    putAnswer(w.paths, answer({ model: "normal", warn: [] }));
    assert.deepEqual((await applyOnce(w.ctx)).applied, ["glow-salon"]);
    assert.equal(loadState(w.root).shops["glow-salon"].applied!.desiredHash, first);
  } finally { w.done(); }
});
