// Gupshup token renewal (follow-up 2, 12 Nov 2026): the token refresher mints each renewed shop's app token with the server's universal token, writes it where only that
// shop's WhatsApp Guard reads it, renews it before it ends, never faster than Gupshup allows, and says plainly when it cannot (to ops, the panel's list and the heartbeat).
// Against a stand-in that answers as Gupshup's mint page documents (read 12 Nov 2026); nothing here reaches Gupshup. Written 12 Nov 2026, not run yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UAT_LIFETIME_MS, UAT_RENEW_BEFORE_MS, MINTS_PER_MINUTE, createGupshupRenewer, jwtExpiryMs, mintAppToken } from "../services/gupshup-tokens.ts";
import { GUPSHUP_UAT_MAX_MS, GUPSHUP_UAT_MIN_MS } from "../../modules/messaging/gupshup.ts";
import { CREDENTIAL_WARN_MS, parseRenewalNotes, readRefresherRenewals, readRenewalsFile, renewalWork, writeRenewalsFile } from "../lib/renewals.ts";
import { checkShop, deploy } from "../deploy.ts";
import { planShop } from "../generate/shop.ts";
import { secretFile } from "../lib/secrets.ts";
import { loadState } from "../lib/state.ts";
import { panelRuntime, PHONE_NUMBER_ID, serverConfig, tempServer } from "./helpers.ts";
import { secretsFor, world } from "./world.ts";

const APP = "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8";
const HOUR = 3_600_000;
const jwt = (exp: number) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ exp: Math.floor(exp / 1000) })).toString("base64url")}.c2lnbmF0dXJl`;

/** Gupshup's mint and a Guard's reload, standing in: every request kept; `answer` says what the mint returns. */
function stand(answer: (n: number) => { status: number; body: unknown } = (n) => ({ status: 200, body: { status: "success", token: `uat_${"x".repeat(20)}_${n}`, id: `row-${n}` } })) {
  const seen: { url: string; auth: string | null; body: string }[] = [];
  let mints = 0;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, auth: new Headers(init?.headers).get("authorization"), body: String(init?.body ?? "") });
    if (url.endsWith("/admin/reload")) return new Response("{}", { status: 200 });
    const a = answer(++mints);
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { seen, fetchFn, mints: () => mints };
}

function folder(universalToken: string | null) {
  const root = mkdtempSync(join(tmpdir(), "geo-gupshup-"));
  const ut = join(root, "ut");
  if (universalToken !== null) writeFileSync(ut, `${universalToken}\n`);
  writeFileSync(join(root, "admin"), "gg_admin_token_for_the_whatsapp_guard\n");
  const config = (shops: string[], header: "bearer" | "bare" = "bearer") => ({ outDir: join(root, "out"), universalTokenFile: ut, header, baseUrl: "https://gupshup.test", shops: Object.fromEntries(shops.map((s) => [s, { appId: APP, guardAdminUrl: `http://fwd-${s}:8190`, adminTokenFile: join(root, "admin") }])) });
  return { root, config, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("one mint: Gupshup's app-token route, the universal token as Bearer, a unique name and an expiry inside Gupshup's 1 to 24 hours; a refusal is said in plain words without the token", async () => {
  const s = stand();
  const now = Date.UTC(2026, 10, 12, 6);
  const r = await mintAppToken({ baseUrl: "https://gupshup.test", appId: APP, universalToken: "eyJ.ut.sig", name: "geometer-glow-1", expiryMs: now + UAT_LIFETIME_MS, fetchFn: s.fetchFn });
  assert.equal(r.ok, true);
  assert.equal(s.seen[0].url, `https://gupshup.test/partner/app/${APP}/token`);
  assert.equal(s.seen[0].auth, "Bearer eyJ.ut.sig");
  const form = new URLSearchParams(s.seen[0].body);
  assert.equal(form.get("name"), "geometer-glow-1");
  assert.ok(Number(form.get("expiry")) - now >= GUPSHUP_UAT_MIN_MS && Number(form.get("expiry")) - now <= GUPSHUP_UAT_MAX_MS, "epoch ms, within Gupshup's bounds");
  for (const [status, words] of [[401, /universal token .*hand in a new one/u], [403, /not turned these tokens on/u], [409, /already has 3 active tokens/u], [429, /too many token requests/u], [400, /answered 400: expiry cannot exceed 24 hours/u]] as const) {
    const bad = stand(() => ({ status, body: { status: "error", message: "expiry cannot exceed 24 hours from now" } }));
    const out = await mintAppToken({ baseUrl: "https://gupshup.test", appId: APP, universalToken: "eyJ.ut.sig", name: "n", expiryMs: now, fetchFn: bad.fetchFn });
    assert.equal(out.ok, false);
    assert.match((out as { why: string }).why, words);
    assert.ok(!(out as { why: string }).why.includes("eyJ.ut.sig"));
  }
  assert.deepEqual(await mintAppToken({ baseUrl: "https://gupshup.test", appId: "../x", universalToken: "u", name: "n", expiryMs: now, fetchFn: s.fetchFn }), { ok: false, why: "the shop's Gupshup app id is not an app id" });
});

test("the renewer writes the app token where only that shop's Guard reads it, asks the Guard to read it, and keeps when it ends so a restart mints nothing", async () => {
  const f = folder(jwt(Date.UTC(2026, 11, 30)));
  try {
    let now = Date.UTC(2026, 10, 12, 6);
    const s = stand();
    const r = createGupshupRenewer(f.config(["glow"]), { fetch: s.fetchFn, now: () => now });
    assert.equal(r.healthy(), false, "not tried yet");
    await r.tick();
    assert.equal(readFileSync(join(f.root, "out", "glow", "authorization"), "utf8"), `Bearer uat_${"x".repeat(20)}_1`, "the whole Authorization value, Bearer by default");
    assert.deepEqual(JSON.parse(readFileSync(join(f.root, "out", "glow", "renewal.json"), "utf8")), { validUntil: now + UAT_LIFETIME_MS, mintedAt: now, tokenId: "row-1" });
    assert.deepEqual(s.seen.map((x) => [x.url, x.auth]).at(-1), ["http://fwd-glow:8190/admin/reload", "Bearer gg_admin_token_for_the_whatsapp_guard"]);
    assert.equal(r.healthy(), true);
    assert.deepEqual(r.state().glow, { validUntil: now + UAT_LIFETIME_MS, lastError: null, failingSince: null, credentialValidUntil: Date.UTC(2026, 11, 30) });
    // a restart (each deploy that changes the refresher's files): the token kept is not minted again until it is due
    const again = createGupshupRenewer(f.config(["glow"]), { fetch: s.fetchFn, now: () => now });
    assert.equal(again.healthy(), true, "a token kept counts as tried");
    await again.tick();
    assert.equal(s.mints(), 1, "no second mint: Gupshup allows 3 active per app");
    // due once it has 8 hours left
    now += UAT_LIFETIME_MS - UAT_RENEW_BEFORE_MS - 60_000;
    await again.tick();
    assert.equal(s.mints(), 1);
    now += 120_000;
    await again.tick();
    assert.equal(s.mints(), 2, "renewed with 8 hours left: at most two alive at once");
    // "bare" for Gupshup's API if it turns out to take the token without Bearer (not documented)
    const bare = createGupshupRenewer(f.config(["spa"], "bare"), { fetch: stand().fetchFn, now: () => now });
    await bare.tick();
    assert.equal(readFileSync(join(f.root, "out", "spa", "authorization"), "utf8"), `uat_${"x".repeat(20)}_1`);
  } finally { f.done(); }
});

test("a renewal that fails is said at once, with how long the token in use has left; it waits longer each time and never loops on the credential", async () => {
  const f = folder("eyJ.ut.sig");
  try {
    let now = Date.UTC(2026, 10, 12, 6);
    let refuse = false;
    const s = stand((n) => (refuse ? { status: 401, body: { status: "error" } } : { status: 200, body: { status: "success", token: `uat_${"y".repeat(20)}_${n}`, id: `r${n}` } }));
    const lines: string[] = [];
    const r = createGupshupRenewer(f.config(["glow"]), { fetch: s.fetchFn, now: () => now, log: (l) => lines.push(l) });
    await r.tick();
    refuse = true;
    now += UAT_LIFETIME_MS - UAT_RENEW_BEFORE_MS;
    await r.tick();
    const st = r.state().glow;
    assert.match(st.lastError ?? "", /did not accept the universal token/u);
    assert.equal(st.failingSince, now);
    assert.match(lines.at(-1) ?? "", /ALERT no new Gupshup token .* the one in use ends in 480 min; trying again in 1 min/u);
    assert.ok(!lines.join("\n").includes("eyJ.ut.sig") && !lines.join("\n").includes("uat_"), "no token in the log");
    const minted = s.mints();
    await r.tick();
    assert.equal(s.mints(), minted, "not again before its wait");
    now += 60_000; await r.tick(); now += 2 * 60_000; await r.tick();
    assert.equal(s.mints(), minted + 2, "then after 1 minute, then 2");
    assert.equal(renewalWork(r.state().glow, now)?.kind, "whatsapp_token_renewal");
    // no universal token at all: said, nothing sent
    const none = folder(null);
    try {
      const empty = stand();
      const n = createGupshupRenewer(none.config(["glow"]), { fetch: empty.fetchFn, now: () => now });
      await n.tick();
      assert.equal(empty.mints(), 0);
      assert.match(n.state().glow.lastError ?? "", /no Gupshup universal token was handed in/u);
      assert.equal(existsSync(join(none.root, "out", "glow")), true, "the shop's folder exists anyway, so its Guard's mount does");
    } finally { none.done(); }
  } finally { f.done(); }
});

test("never more mints in a minute than Gupshup allows: a first start with many shops mints in a burst, then the rest a minute later", async () => {
  const f = folder("eyJ.ut.sig");
  try {
    let now = Date.UTC(2026, 10, 12, 6);
    const s = stand();
    const shops = Array.from({ length: 12 }, (_v, i) => `shop-${i}`);
    const r = createGupshupRenewer(f.config(shops), { fetch: s.fetchFn, now: () => now });
    await r.tick();
    assert.equal(s.mints(), MINTS_PER_MINUTE);
    assert.ok(MINTS_PER_MINUTE < 10, "under Gupshup's 10 a minute");
    now += 30_000; await r.tick();
    assert.equal(s.mints(), MINTS_PER_MINUTE, "not within the same minute");
    now += 31_000; await r.tick();
    assert.equal(s.mints(), 12);
    assert.equal(r.healthy(), true);
  } finally { f.done(); }
});

test("the rule the panel's list and the heartbeat share: failing, ended or missing is renewal work; a universal token within 7 days of its end is credential work", async () => {
  const now = Date.UTC(2026, 10, 12, 6);
  assert.deepEqual(renewalWork({ validUntil: now + 5 * HOUR, lastError: "x", failingSince: now - HOUR, credentialValidUntil: null }, now), { kind: "whatsapp_token_renewal", hoursLeft: 5, sinceMs: now - HOUR });
  assert.equal(renewalWork({ validUntil: now - 1, lastError: null, failingSince: null, credentialValidUntil: null }, now)?.hoursLeft, 0);
  assert.equal(renewalWork({ validUntil: null, lastError: null, failingSince: null, credentialValidUntil: null }, now)?.kind, "whatsapp_token_renewal");
  assert.deepEqual(renewalWork({ validUntil: now + 20 * HOUR, lastError: null, failingSince: null, credentialValidUntil: now + CREDENTIAL_WARN_MS - HOUR }, now), { kind: "whatsapp_token_credential", hoursLeft: 7 * 24 - 1, sinceMs: null });
  assert.equal(renewalWork({ validUntil: now + 20 * HOUR, lastError: null, failingSince: null, credentialValidUntil: now + 30 * 24 * HOUR }, now), undefined);
  assert.deepEqual(Object.keys(parseRenewalNotes({ glow: { validUntil: 1 }, "__proto__": {}, "Bad Shop": {} })), ["glow"]);
  assert.equal(jwtExpiryMs(jwt(Date.UTC(2027, 0, 1))), Date.UTC(2027, 0, 1));
  assert.equal(jwtExpiryMs("not-a-jwt"), undefined);
  // the refresher not answering: every shop it knew is said to be failing, so the list does not go quiet
  const dir = mkdtempSync(join(tmpdir(), "geo-renewals-"));
  try {
    writeRenewalsFile(dir, { glow: { validUntil: now + 9 * HOUR, lastError: null, failingSince: null, credentialValidUntil: null } }, new Date(now));
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const notes = await readRefresherRenewals("http://refresher:8791", readRenewalsFile(dir)!.shops, now, down);
    assert.deepEqual([notes.glow.lastError, notes.glow.failingSince], ["the token refresher is not answering, so nothing is renewed", now]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("deploy: a Gupshup shop with no token of its own on a server holding a universal token is renewed; its Guard reads the refresher's token; a static token always wins", async () => {
  const gupshup = panelRuntime({ services: { payments: {}, calendar: { calendarId: "glow@example.com" }, messaging: { phoneNumberId: PHONE_NUMBER_ID, provider: "gupshup", appId: APP }, timeoutMs: 20_000 } });
  const w = world({ "glow-salon": gupshup });
  try {
    const { whatsapp_token: _t, whatsapp_app_secret: _s, whatsapp_verify_token: _v, ...rest } = secretsFor("glow-salon");
    w.handIn("glow-salon", { ...rest, whatsapp_path_token: "Zk3-mQ9_vT7xLp2Rw8YdNa5c" });
    // no static token and no universal token: asked for, as before
    assert.ok((await checkShop(w.ctx, "glow-salon")).problems.some((p) => p.rule === "secret-missing:gupshup_authorization"));
    mkdirSync(secretFile(w.root, "refresher", "_server"), { recursive: true });
    writeFileSync(secretFile(w.root, "refresher", "_server", "gupshup_universal_token"), "eyJ.ut.sig\n");
    assert.ok(!(await checkShop(w.ctx, "glow-salon")).problems.some((p) => p.rule === "secret-missing:gupshup_authorization"), "the refresher renews one instead");
    await deploy(w.ctx, "glow-salon");
    const toml = readFileSync(join(w.paths.generated, "guards", "g-glow-salon-whatsapp", "guard.toml"), "utf8");
    assert.match(toml, /^Authorization = "\$\{file:\/run\/gupshup\/authorization\}"$/mu, "the Guard reads the renewed token");
    const compose = readFileSync(join(w.paths.generated, "compose.yaml"), "utf8");
    assert.match(compose, /gupshup-auth/u);
    const refresher = JSON.parse(readFileSync(join(w.paths.generated, "refresher", "refresher.json"), "utf8"));
    assert.deepEqual(Object.keys(refresher.gupshup.shops), ["glow-salon"]);
    assert.equal(refresher.gupshup.shops["glow-salon"].appId, APP);
    assert.equal(refresher.gupshup.universalTokenFile, "/run/secrets/_server/gupshup_universal_token");
    assert.ok(existsSync(secretFile(w.root, "refresher", "glow-salon", "whatsapp_admin_token")), "the refresher can ask the Guard to read a new token");
    assert.equal(JSON.parse(readFileSync(join(w.paths.generated, "ops", "ops.json"), "utf8")).refresherUrl, "http://refresher:8791");
    assert.equal(loadState(w.root).shops["glow-salon"].applied?.whatsappTokens, "renewed");
    // the universal token is never anywhere but the refresher's folder
    assert.ok(!compose.includes("eyJ.ut.sig") && !toml.includes("eyJ.ut.sig") && !JSON.stringify(refresher).includes("eyJ.ut.sig"));
  } finally { w.done(); }
  // a static token handed in wins: the shop is exactly as before (no refresher section, the Guard reads its own file)
  const t = tempServer({ "glow-salon": gupshup });
  try {
    const statics = planShop(serverConfig(), t.shop("glow-salon")).guards.find((g) => g.kind === "whatsapp")!;
    assert.equal(statics.def.headers.Authorization, "${file:/run/secrets/whatsapp_authorization}");
    const renewed = planShop(serverConfig(), t.shop("glow-salon"), {}, undefined, { gupshupRenewed: true }).guards.find((g) => g.kind === "whatsapp")!;
    assert.deepEqual(renewed.def, { kind: "whatsapp", tool: "whatsapp", upstream: "partner.gupshup.io:443", headers: { Authorization: "${file:/run/gupshup/authorization}" } });
    assert.equal(renewed.specText, statics.specText, "the limits are the same: only where the token is read from changes");
  } finally { t.done(); }
});
