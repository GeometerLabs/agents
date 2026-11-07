// Where a template's code is found, since the templates were grouped by domain (templates/<domain>/<name>): the current checkout, a version kept beside the server in the
// same layout, a version kept in the layout from before (<server>/pathways/<name>@<version>), the shared modules for each shape, and a running shop whose stored folder is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploy } from "../deploy.ts";
import { modulesOf } from "../generate/compose.ts";
import { appliedPathwayDir, checkoutDirOf, keptDirFor, pathwayDirFor } from "../lib/pathways.ts";
import { loadState, saveState } from "../lib/state.ts";
import { panelRuntime } from "./helpers.ts";
import { world } from "./world.ts";

const scratch = (): string => mkdtempSync(join(tmpdir(), "geo-layout-"));
function template(folder: string, version: string): string {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "package.json"), JSON.stringify({ name: "x", version }));
  return folder;
}

test("the current checkout is found by the template's name under any domain, only at the version asked for, and a spec without a version is not a template", () => {
  const app = scratch(); const server = scratch();
  try {
    const bookings = template(join(app, "templates", "commerce", "bookings"), "0.1.0");
    const fees = template(join(app, "templates", "education", "fees"), "0.3.0");
    mkdirSync(join(app, "templates", "community", "community-fund"), { recursive: true });
    writeFileSync(join(app, "templates", "community", "community-fund", "README.md"), "a spec");
    assert.equal(pathwayDirFor(app, server, { pathway: "bookings", version: "0.1.0" }), bookings);
    assert.equal(pathwayDirFor(app, server, { pathway: "fees", version: "0.3.0" }), fees);
    assert.equal(pathwayDirFor(app, server, { pathway: "bookings", version: "0.2.0" }), undefined, "another version is not this checkout's");
    assert.equal(pathwayDirFor(app, server, { pathway: "community-fund", version: "0.1.0" }), undefined);
    assert.equal(checkoutDirOf(app, "fees"), fees);
    assert.equal(checkoutDirOf(app, "community-fund"), undefined);
    assert.equal(checkoutDirOf(app, "nothing"), undefined);
    assert.equal(checkoutDirOf(join(app, "no-such-folder"), "bookings"), undefined, "a folder with no templates in it finds none, and does not throw");
    assert.equal(modulesOf(bookings), join(app, "modules"));
  } finally { rmSync(app, { recursive: true, force: true }); rmSync(server, { recursive: true, force: true }); }
});

test("a version kept beside the server is found in the layout of this repository and in the older one, and each finds the shared modules at <server>/modules", () => {
  const app = scratch(); const server = scratch();
  try {
    template(join(app, "templates", "commerce", "bookings"), "0.1.0");
    const newer = template(join(server, "templates", "commerce", "bookings@0.2.0"), "0.2.0");
    const older = template(join(server, "pathways", "bookings@0.0.9"), "0.0.9");
    assert.equal(pathwayDirFor(app, server, { pathway: "bookings", version: "0.2.0" }), newer);
    assert.equal(pathwayDirFor(app, server, { pathway: "bookings", version: "0.0.9" }), older);
    assert.equal(modulesOf(newer), join(server, "modules"), "three folders up from the new shape");
    assert.equal(modulesOf(older), join(server, "modules"), "two folders up from the old shape");
    // a folder that holds another version than its name says is not that version
    template(join(server, "templates", "commerce", "bookings@0.5.0"), "0.4.0");
    assert.equal(pathwayDirFor(app, server, { pathway: "bookings", version: "0.5.0" }), undefined);
    assert.equal(pathwayDirFor(app, server, { pathway: "bookings", version: "0.7.0" }), undefined);
  } finally { rmSync(app, { recursive: true, force: true }); rmSync(server, { recursive: true, force: true }); }
});

test("a missing version is asked for in the layout of this repository, in the domain this checkout keeps the template in", () => {
  const app = scratch(); const server = scratch();
  try {
    template(join(app, "templates", "commerce", "bookings"), "0.1.0");
    assert.equal(keptDirFor(app, server, "bookings", "0.9.0"), join(server, "templates", "commerce", "bookings@0.9.0"));
    assert.equal(keptDirFor(app, server, "unknown", "0.9.0"), join(server, "templates", "<domain>", "unknown@0.9.0"), "a template this checkout does not have: the person fills in the domain");
  } finally { rmSync(app, { recursive: true, force: true }); rmSync(server, { recursive: true, force: true }); }
});

test("the folder stored for a running shop is used only while it still holds the version the shop was applied at; otherwise it is found again from the pin", () => {
  const app = scratch(); const server = scratch();
  try {
    const current = template(join(app, "templates", "commerce", "bookings"), "0.1.0");
    const kept = template(join(server, "templates", "commerce", "bookings@0.0.8"), "0.0.8");
    const applied = (pathwayDir: string, pathway: string) => ({ pathway, pathwayDir });
    assert.equal(appliedPathwayDir(app, server, applied(current, "bookings@0.1.0")), current, "still there, still that version");
    // the checkout moved on to the layout by domain: the folder the state remembers is gone
    assert.equal(appliedPathwayDir(app, server, applied(join(app, "pathways", "bookings"), "bookings@0.1.0")), current);
    // ... or is left holding only what git does not track (a report sample, a build), which Docker would mount as an empty /pathway
    mkdirSync(join(app, "pathways", "bookings", "report-sample"), { recursive: true });
    writeFileSync(join(app, "pathways", "bookings", "report-sample", "x.json"), "{}");
    assert.equal(appliedPathwayDir(app, server, applied(join(app, "pathways", "bookings"), "bookings@0.1.0")), current);
    // the stored folder holds a newer version than the shop runs: the shop's own version is looked for
    assert.equal(appliedPathwayDir(app, server, applied(current, "bookings@0.0.8")), kept);
    // a version this server does not have at all
    assert.equal(appliedPathwayDir(app, server, applied(join(app, "pathways", "bookings"), "bookings@0.0.1")), undefined);
  } finally { rmSync(app, { recursive: true, force: true }); rmSync(server, { recursive: true, force: true }); }
});

test("a shop deployed from the old folder is mounted from the new one the next time any shop is deployed, and its stale stored folder is never written into the compose file", async () => {
  const w = world({ "glow-salon": panelRuntime(), "pet-spa": panelRuntime() });
  try {
    w.handIn("glow-salon"); w.handIn("pet-spa");
    await deploy(w.ctx);
    const current = join(w.ctx.appDir, "templates", "commerce", "bookings");
    // the state of a server set up before the move: both shops were deployed from <app>/templates/commerce/bookings, which a pull has since removed (only an untracked sample is left)
    const old = join(w.root, "old-app", "pathways", "bookings");
    mkdirSync(join(old, "report-sample"), { recursive: true });
    writeFileSync(join(old, "report-sample", "x.json"), "{}");
    const state = loadState(w.root);
    for (const shop of ["glow-salon", "pet-spa"]) state.shops[shop].applied!.pathwayDir = old;
    saveState(w.root, state);
    // only pet-spa is deployed; glow-salon is written into the compose file from what was applied
    await deploy(w.ctx, "pet-spa");
    const compose = readFileSync(join(w.paths.generated, "compose.yaml"), "utf8");
    assert.ok(!compose.includes(old), "the stale folder is in no mount");
    assert.equal(compose.split(`${current}:/pathway:ro`).length - 1, 2, "both shops mount the current folder as /pathway");
    assert.ok(compose.includes(`${join(w.ctx.appDir, "modules")}:/modules:ro`));
    assert.ok(existsSync(join(current, "package.json")));
  } finally { w.done(); }
});
