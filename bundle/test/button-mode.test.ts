// Fleet's button mode (B48): fleet's answer, kept by ops in <server>/fleet/<shop>.json, becomes `"ai": "buttons"` in the shop's GENERATED runtime config, and only
// there, and only if the pathway's own validator knows the key. Anything else (no answer, an old one, normal, no plan, a pathway that does not know `ai`) adds nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateRuntimeConfig } from "../../templates/commerce/bookings/server/config.ts";
import { applyOnce } from "../apply.ts";
import { deploy, desiredHashOf } from "../deploy.ts";
import { planShop, withFleetAi } from "../generate/shop.ts";
import { loadState } from "../lib/state.ts";
import { panelRuntime, serverConfig, tempServer } from "./helpers.ts";
import { world } from "./world.ts";

const NOW = "2026-11-05T10:00:00.000Z";
const answer = (more: Record<string, unknown> = {}) => ({ schema: 1, at: NOW, plan: "business", allowance: 3000, innovator: false, ai: "buttons", reason: "overage_unfunded", warn: [], ...more });
const putAnswer = (paths: { fleet: string; fleetAnswer: (n: string) => string }, value: unknown, shop = "glow-salon") => { mkdirSync(paths.fleet, { recursive: true }); writeFileSync(paths.fleetAnswer(shop), typeof value === "string" ? value : JSON.stringify(value)); };
/** A pathway version that knows the `ai` setting: today's own validator, with the key allowed. */
const knowsAi = (config: unknown, folder: string) => {
  const { ai, ...rest } = config as Record<string, unknown>;
  return validateRuntimeConfig(rest, folder).ok && (ai === undefined || ai === "buttons") ? { ok: true } : { ok: false };
};

test("the generated runtime config of a normal shop is valid for today's runtime, which is what the override is judged against", () => {
  const t = tempServer(); try {
    const p = planShop(serverConfig(), t.shop("glow-salon"));
    assert.deepEqual(p.problems, []);
    assert.equal(validateRuntimeConfig(p.runtime, "/").ok, true);
    assert.equal("ai" in p.runtime, false);
  } finally { t.done(); }
});

test("a pathway that knows `ai`: fleet's buttons go into the generated config, and are gone again when fleet says normal; the panel's runtime.json is never touched", () => {
  const t = tempServer(); try {
    const panelFile = join(t.paths.shop("glow-salon"), "runtime.json");
    const before = readFileSync(panelFile, "utf8");
    putAnswer(t.paths, answer());
    const on = planShop(serverConfig(), t.shop("glow-salon"), {}, knowsAi);
    assert.equal(on.runtime.ai, "buttons");
    assert.deepEqual(on.notes, []);
    assert.equal(knowsAi(on.runtime, "/").ok, true, "and it is a config the runtime accepts");
    putAnswer(t.paths, answer({ ai: "normal", reason: undefined }));
    assert.equal("ai" in planShop(serverConfig(), t.shop("glow-salon"), {}, knowsAi).runtime, false);
    assert.equal(readFileSync(panelFile, "utf8"), before, "the panel's file is the panel's");
  } finally { t.done(); }
});

test("today's pathway knows `ai`: with the real validator fleet's buttons are written, the shop's config is still one its runtime accepts, and normal removes it again", () => {
  const t = tempServer(); try {
    putAnswer(t.paths, answer());
    const p = planShop(serverConfig(), t.shop("glow-salon")); // the real validator
    assert.equal(p.runtime.ai, "buttons");
    assert.equal(validateRuntimeConfig(p.runtime, "/").ok, true, "so the shop starts");
    assert.deepEqual(p.notes, []);
    assert.deepEqual(p.problems, []);
    putAnswer(t.paths, answer({ ai: "normal", reason: undefined }));
    assert.equal("ai" in planShop(serverConfig(), t.shop("glow-salon")).runtime, false);
  } finally { t.done(); }
});

test("an older pathway that does not know `ai` (its runtime would refuse to start): the override is skipped and a note says why", () => {
  const t = tempServer(); try {
    putAnswer(t.paths, answer());
    const oldPathway = (config: unknown, folder: string) => ("ai" in (config as object) ? { ok: false } : validateRuntimeConfig(config, folder));
    const p = planShop(serverConfig(), t.shop("glow-salon"), {}, oldPathway);
    assert.equal("ai" in p.runtime, false);
    assert.equal(p.notes.length, 1);
    assert.match(p.notes[0], /fleet asked for button mode, but this template version does not know the ai setting yet/u);
    assert.deepEqual(p.problems, [], "a note, not a refusal");
  } finally { t.done(); }
});

test("withFleetAi adds nothing without buttons, with no runtime to add to, or when the config was broken before the key was added", () => {
  const notes: string[] = [];
  const ok = { mode: "fakes" };
  assert.equal(withFleetAi(ok, undefined, knowsAi, notes), ok);
  assert.deepEqual(withFleetAi({}, "buttons", knowsAi, notes), {});
  const broken = { mode: "nonsense" };
  assert.equal(withFleetAi(broken, "buttons", knowsAi, notes), broken);
  assert.deepEqual(notes, [], "a config that was never valid is somebody else's problem and is not blamed on the pathway");
});

test("only a plain, readable answer for a shop with a plan turns buttons on: normal, no plan, a wrong type, garbage and no file all add nothing", () => {
  const t = tempServer(); try {
    const buttons = (more: Record<string, unknown> = {}) => { putAnswer(t.paths, answer(more)); return t.shop("glow-salon").fleetAi; };
    assert.equal(buttons(), "buttons");
    assert.equal(buttons({ ai: "normal" }), undefined);
    assert.equal(buttons({ plan: null }), undefined, "a shop with no plan is never switched");
    assert.equal(buttons({ ai: "turbo" }), undefined);
    assert.equal(buttons({ schema: 2 }), undefined);
    assert.equal(buttons({ at: "yesterday" }), undefined);
    putAnswer(t.paths, "{ not json");
    assert.equal(t.shop("glow-salon").fleetAi, undefined);
    putAnswer(t.paths, answer(), "another-shop");
    assert.equal(t.shop("glow-salon").fleetAi, undefined, "another shop's answer is not this shop's");
  } finally { t.done(); }
});

test("a flip is part of what the shop is asked to be: it changes the desired hash, and flipping back restores it; a shop that never had it keeps the hash it had", () => {
  const t = tempServer(); try {
    const plain = desiredHashOf(t.shop("glow-salon"));
    assert.equal(desiredHashOf({ ...t.shop("glow-salon"), fleetAi: undefined }), plain);
    putAnswer(t.paths, answer({ ai: "normal" }));
    assert.equal(desiredHashOf(t.shop("glow-salon")), plain, "'normal' is nothing");
    putAnswer(t.paths, answer());
    assert.notEqual(desiredHashOf(t.shop("glow-salon")), plain);
    putAnswer(t.paths, answer({ ai: "normal" }));
    assert.equal(desiredHashOf(t.shop("glow-salon")), plain);
  } finally { t.done(); }
});

test("the deployer redeploys a shop when fleet flips it, and writes the setting now that the pathway takes it", async () => {
  const w = world();
  try {
    const logs: string[] = [];
    w.ctx.log = (line) => logs.push(line);
    w.handIn("glow-salon");
    await deploy(w.ctx);
    const first = loadState(w.root).shops["glow-salon"].applied!.desiredHash;
    assert.deepEqual((await applyOnce(w.ctx)).skipped, ["glow-salon"], "nothing changed");
    putAnswer(w.paths, answer());
    const r = await applyOnce(w.ctx);
    assert.deepEqual(r.applied, ["glow-salon"], "fleet's flip is a change");
    assert.notEqual(loadState(w.root).shops["glow-salon"].applied!.desiredHash, first);
    const generated = JSON.parse(readFileSync(join(w.root, "generated", "shops", "glow-salon", "client", "runtime.json"), "utf8"));
    assert.equal(generated.ai, "buttons", "the pathway's own validator takes the key, so it is written");
    assert.ok(!logs.some((l) => /does not know the ai setting yet/u.test(l)), logs.join("\n"));
    putAnswer(w.paths, answer({ ai: "normal", reason: undefined }));
    assert.deepEqual((await applyOnce(w.ctx)).applied, ["glow-salon"], "and flipping back is a change too");
    assert.equal(loadState(w.root).shops["glow-salon"].applied!.desiredHash, first);
  } finally { w.done(); }
});
