// Guard's half of the licence (plan B13, monorepo ADR-0062 and Deferred D83): the `[licence]` block the bundle writes into each per-shop Guard's guard.toml, the
// folder it mounts, and the check of the running Guards' own account of the lease. Against the fake machine (test/world.ts); the real binary is the Docker proof's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addAgent, deployAgent } from "../agent/deploy.ts";
import { Refused, checkShop, deploy } from "../deploy.ts";
import { LICENCE_MOUNT, guardDef, guardToml, ownerNumbers } from "../generate/guards.ts";
import { LICENCE_PROBE_TOML, readsLicenceFrom } from "../generate/verify.ts";
import { licencePaths } from "../lib/licence.ts";
import { readStatus } from "../lib/status.ts";
import { kidOf } from "../../modules/licence/token.ts";
import { CALENDAR_ID, PHONE_NUMBER_ID } from "./helpers.ts";
import { PIN, TEST_PUBLIC_HEX } from "./licence-helpers.ts";
import { composeCalls, read, secretsFor, world } from "./world.ts";

const TEST_KID = kidOf(Buffer.from(TEST_PUBLIC_HEX, "hex"));
const refusedWith = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (e instanceof Refused) return e.problems; throw e; } assert.fail("it should have been refused"); };
const toml = (w: ReturnType<typeof world>, service: string) => read(join(w.paths.generated, "guards", service, "guard.toml"));
/** The [licence] table of a guard.toml, as key = value lines (it is the last table the bundle writes). */
const block = (text: string): Record<string, string> => {
  const body = /\n\[licence\]\n([\s\S]*)$/u.exec(text)?.[1];
  if (!body) return {};
  return Object.fromEntries(body.split("\n").map((l) => /^([a-z_]+) = (.*)$/u.exec(l.trim())).filter((m): m is RegExpExecArray => !!m).map((m) => [m[1], m[2]]));
};
const opts = { tenant: "glow-salon", deployment: "glow-salon-razorpay", bundleDigest: "sha256:" + "0".repeat(64), upstream: { host: "api.razorpay.com:443", tls: true }, adminSha: "0".repeat(64), agents: [{ id: "runtime-glow-salon", sha: "0".repeat(64) }] };

test("guardToml writes [licence] last, with the server's id (not the Guard's own name), the shop, the fixed lists and the owner's number; never on the model Guard", () => {
  const licence = { deployment: "acme-vps-1", shop: "glow-salon", ownerNumbers: ["+919000000000"] };
  for (const kind of ["razorpay", "whatsapp", "calendar"] as const) {
    const text = guardToml({ ...opts, def: guardDef(kind), licence });
    const b = block(text);
    assert.deepEqual(b, {
      lease_file: `"${LICENCE_MOUNT}/lease"`, seen_file: `"${LICENCE_MOUNT}/seen.json"`, extensions_dir: `"${LICENCE_MOUNT}/extensions"`,
      deployment: '"acme-vps-1"', shop: '"glow-salon"',
      wind_down_refuses: '["create_link", "insert"]', stopped_refuses: '["create_link", "insert", "send"]', owner_numbers: '["+919000000000"]', recipient_field: '"to"',
    }, kind);
    assert.match(text, /^deployment = "glow-salon-razorpay"$/mu, "the Guard's own name stays the top-level deployment");
  }
  assert.ok(!guardToml({ ...opts, def: guardDef("model", { wire: "openai", model: "gpt-4o-mini" }), licence }).includes("[licence]"), "the model Guard serves every shop: it is never given a shop's lease");
  assert.ok(!guardToml({ ...opts, def: guardDef("razorpay") }).includes("[licence]"), "no block unless asked for");
});

test("only numbers Guard reads as numbers are written as the owner's (Guard refuses the whole file for one it cannot read)", () => {
  assert.deepEqual(ownerNumbers(["+91 90000 00000", "+91-(900)-000-0000", "919000000000"]), ["+91 90000 00000", "+91-(900)-000-0000", "919000000000"]);
  assert.deepEqual(ownerNumbers(["owner@example.com", "12345", "+1234567890123456", "", undefined]), [], "letters, fewer than 6 digits, more than 15, nothing");
});

test("the image is asked whether it reads [licence]: a newer Guard refuses the probe's refund by name, an older one stops at the missing bundle", () => {
  assert.match(LICENCE_PROBE_TOML, /^\[licence\]$/mu);
  assert.match(LICENCE_PROBE_TOML, /^wind_down_refuses = \["refund"\]$/mu, "a refund: the one thing no licence may hold back");
  assert.equal(readsLicenceFrom("", "refused: /work/guard.toml: [licence]: licence.wind_down_refuses names refund: a licence never refuses refunds, cancellations, reads, lists, patch or delete, in any state"), true);
  assert.equal(readsLicenceFrom("", "/work/no-such-bundle.json: No such file or directory (os error 2)"), false);
});

test("with a key pinned and an image that reads it, every per-shop Guard gets the block and the folder (read-only); the model Guard gets neither; the folders are made first", async () => {
  const w = world(undefined, PIN); try {
    w.guardLicence.reads = true; w.guardLicence.kids = [TEST_KID];
    w.handIn("glow-salon");
    const [r] = await deploy(w.ctx);
    assert.equal(r.shop, "glow-salon");
    for (const kind of ["razorpay", "whatsapp", "calendar"]) {
      const b = block(toml(w, `g-glow-salon-${kind}`));
      assert.deepEqual([b.deployment, b.shop, b.owner_numbers], ['"acme-vps-1"', '"glow-salon"', '["+919000000000"]'], kind);
    }
    assert.ok(!toml(w, "g-model").includes("[licence]"));
    const compose = read(join(w.paths.generated, "compose.yaml"));
    const mount = `${licencePaths(w.root).root}:${LICENCE_MOUNT}:ro`;
    const serviceBlock = (name: string) => new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)\\n  [a-z]`, "u").exec(compose)?.[1] ?? "";
    for (const kind of ["razorpay", "whatsapp", "calendar"]) assert.ok(serviceBlock(`g-glow-salon-${kind}`).includes(mount), `g-glow-salon-${kind} mounts the folder`);
    assert.ok(!serviceBlock("g-model").includes(LICENCE_MOUNT), "the model Guard does not");
    for (const d of [licencePaths(w.root).root, licencePaths(w.root).extensions]) assert.equal(statSync(d).mode & 0o777, 0o755, `${d} is made 0755 before compose up`);
    assert.equal(readStatus(w.root, "glow-salon")!.deploy.state, "applied");
    assert.ok(composeCalls(w).some((c) => c[0] === "up"));
  } finally { w.done(); }
});

test("a shop whose other people approve refunds (B37): their numbers go through in the final stop too, or a refund held for one of them could never be asked about", async () => {
  const w = world(undefined, PIN); try {
    w.guardLicence.reads = true; w.guardLicence.kids = [TEST_KID];
    const file = join(w.paths.shop("glow-salon"), "settings.json");
    const settings = JSON.parse(read(file));
    settings.approvers = { people: [{ id: "ravi", whatsapp: "+919800000002", language: "hi" }, { id: "meena", whatsapp: "+919800000003", language: "en" }], twoAboveInr: 500 };
    writeFileSync(file, JSON.stringify(settings));
    w.handIn("glow-salon");
    await deploy(w.ctx);
    for (const kind of ["razorpay", "whatsapp", "calendar"]) assert.equal(block(toml(w, `g-glow-salon-${kind}`)).owner_numbers, '["+919000000000", "+919800000002", "+919800000003"]', kind);
  } finally { w.done(); }
});

test("a Fees centre and an Orders shop get the block and the folder on each of their Guards too, with their own owner's number", async () => {
  const w = world({}, PIN); try {
    w.guardLicence.reads = true; w.guardLicence.kids = [TEST_KID];
    const live = { mode: "live", tickSeconds: 30, services: { payments: {}, messaging: { phoneNumberId: PHONE_NUMBER_ID }, timeoutMs: 20_000 } };
    const add = (name: string, settings: string, lock: string, template: string) => {
      mkdirSync(w.paths.shop(name), { recursive: true });
      cpSync(settings, join(w.paths.shop(name), "settings.json"));
      writeFileSync(join(w.paths.shop(name), "pathway.lock"), `${lock}\n`);
      writeFileSync(join(w.paths.shop(name), "runtime.json"), JSON.stringify(live));
      writeFileSync(join(w.paths.shop(name), "owner.json"), JSON.stringify({ schema: 1, accountId: "acc_test", accountName: "Divya", role: "partner", createdAt: "2026-11-01T10:00:00Z", template }));
      const { "google_service_account.json": _google, ...rest } = secretsFor(name);
      w.handIn(name, rest);
    };
    const repo = new URL("../../", import.meta.url).pathname;
    add("bright", join(repo, "templates/education/fees/clients/bright-tuition.example/settings.json"), "fees@0.1.0", "fees");
    add("annapurna", join(repo, "templates/commerce/orders/settings/annapurna-tiffins-razorpay.example.json"), "orders@0.1.0", "orders");
    await deploy(w.ctx);
    const compose = read(join(w.paths.generated, "compose.yaml"));
    const owners: Record<string, string> = {
      bright: JSON.parse(read(join(w.paths.shop("bright"), "settings.json"))).owner.whatsapp,
      annapurna: JSON.parse(read(join(w.paths.shop("annapurna"), "settings.json"))).owner.whatsapp,
    };
    for (const shop of ["bright", "annapurna"]) {
      for (const kind of ["razorpay", "whatsapp"]) {
        const b = block(toml(w, `g-${shop}-${kind}`));
        assert.deepEqual([b.deployment, b.shop, b.owner_numbers], ['"acme-vps-1"', `"${shop}"`, `["${owners[shop]}"]`], `${shop} ${kind}`);
        const service = new RegExp(`\\n  g-${shop}-${kind}:\\n([\\s\\S]*?)\\n  [a-z]`, "u").exec(compose)?.[1] ?? "";
        assert.ok(service.includes(`${licencePaths(w.root).root}:${LICENCE_MOUNT}:ro`), `${shop} ${kind} mounts the folder`);
      }
      assert.ok(!existsSync(join(w.paths.generated, "guards", `g-${shop}-calendar`)), `${shop} has no calendar Guard`);
    }
  } finally { w.done(); }
});

test("an image older than ADR-0062 gets no block (it would read as if it did something), and the deploy says why; with no key pinned there is none either", async () => {
  const old = world(undefined, PIN); try {
    const lines: string[] = []; old.ctx.log = (l) => lines.push(l);
    old.handIn("glow-salon");
    await deploy(old.ctx);
    assert.ok(!toml(old, "g-glow-salon-razorpay").includes("[licence]"));
    assert.ok(lines.some((l) => /does not read the licence lease .*only the runtime refuses new work/u.test(l)), lines.join("\n"));
    const check = await checkShop(old.ctx, "glow-salon");
    assert.ok(check.notes.some((n) => /does not read the licence lease/u.test(n)), "`check` says it too");
  } finally { old.done(); }
  const none = world(); try {
    none.guardLicence.reads = true;
    none.handIn("glow-salon");
    await deploy(none.ctx);
    assert.ok(!toml(none, "g-glow-salon-whatsapp").includes("[licence]"), "no key pinned: no lease is kept, so there is nothing for Guard to check");
  } finally { none.done(); }
});

test("a running Guard built with other licence keys than geometer.json pins refuses the deploy, by name, WITHOUT the kill switch (refunds owed must still go through)", async () => {
  const w = world(undefined, PIN); try {
    w.guardLicence.reads = true; w.guardLicence.kids = ["0123456789abcdef"];
    w.handIn("glow-salon");
    const problems = await refusedWith(deploy(w.ctx));
    assert.deepEqual([...new Set(problems.map((p) => p.rule))].sort(), ["licence:g-glow-salon-calendar", "licence:g-glow-salon-razorpay", "licence:g-glow-salon-whatsapp"]);
    assert.match(problems[0].message, new RegExp(`0123456789abcdef built in, but geometer.json pins ${TEST_KID}`, "u"));
    assert.ok(!w.admin.some((a) => a.startsWith("stop glow-salon on")), "the kill switch was not engaged");
    const status = readStatus(w.root, "glow-salon")!;
    assert.equal(status.deploy.state, "failed");
    assert.match(status.deploy.message ?? "", /licence key/u);
  } finally { w.done(); }
});

test("an agent someone else wrote is restricted by the lease at its Guards too: its id is the shop in the block", async () => {
  const w = world({}, PIN); try {
    w.guardLicence.reads = true; w.guardLicence.kids = [TEST_KID];
    addAgent(w.root, "my-agent", { upstreams: "razorpay,whatsapp,calendar", "owner-whatsapp": "+919800000001", deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "calendar-id": CALENDAR_ID }, (p) => { throw new Error(`no file ${p}`); }, new Date("2026-11-05T09:00:00Z"));
    const s = secretsFor("x");
    w.handIn("my-agent", { razorpay_key: s.razorpay_key, whatsapp_token: s.whatsapp_token, whatsapp_app_secret: s.whatsapp_app_secret, whatsapp_verify_token: s.whatsapp_verify_token, "google_service_account.json": s["google_service_account.json"] });
    await deployAgent(w.ctx, "my-agent");
    for (const kind of ["razorpay", "whatsapp", "calendar"]) {
      const b = block(toml(w, `g-my-agent-${kind}`));
      assert.deepEqual([b.deployment, b.shop, b.owner_numbers], ['"acme-vps-1"', '"my-agent"', '["+919800000001"]'], kind);
    }
    assert.ok(existsSync(licencePaths(w.root).extensions));
  } finally { w.done(); }
});
