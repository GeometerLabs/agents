// The licence lease on the bundle's side (B13). First the port against fleet's own test vectors (a copy in fixtures/, signed with RFC 8032's published TEST 1 key,
// never a production key): every good token, every refusal with its reason, the replay rule and the rule for a shop's state, the server clock set back included.
// Then the deployer's keeping of the lease: the pinned key only, this server's id only, newer only, and a deleted lease file letting nothing older back in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { checkToken, kidOf } from "../../modules/licence/token.ts";
import { allowsRecovery, effectiveState, licenceNow, newerThan, parseLicenceFile, serverNow, takesNewWork } from "../../modules/licence/rules.ts";
import type { Payload } from "../../modules/licence/rules.ts";
import { keptLicence, licenceFileFor, licencePaths, readSeen, statusLicence, takeExtension, takeLease } from "../lib/licence.ts";
import { tempServer } from "./helpers.ts";
import { DAY, PIN, T0, extension, lease, shopEntry, signTest } from "./licence-helpers.ts";
import { fleetFile } from "./monorepo.ts";

const VECTORS_FILE = new URL("./fixtures/licence-vectors.json", import.meta.url);
const V = JSON.parse(readFileSync(VECTORS_FILE, "utf8"));
const KEY = Buffer.from(V.test_key.public_hex, "hex");

test("the copy of the vectors is fleet's, byte for byte (when the monorepo is here)", { skip: fleetFile("test", "fixtures", "licence-vectors.json") && existsSync(fleetFile("test", "fixtures", "licence-vectors.json")!) ? false : "the monorepo's apps/fleet is not at hand (set GEOMETER_MONOREPO)" }, () => {
  assert.equal(readFileSync(VECTORS_FILE, "utf8"), readFileSync(fleetFile("test", "fixtures", "licence-vectors.json")!, "utf8"));
});

test("the test key's id is the vectors' kid", () => assert.equal(kidOf(KEY), V.test_key.kid));

test("every good token in the vectors checks, and carries exactly its payload bytes", () => {
  for (const v of V.valid) {
    const c = checkToken<Payload>(v.token, v.kind, [KEY]);
    assert.ok(c.ok, v.name);
    assert.deepEqual(c.ok && c.payload, JSON.parse(v.payload_json), v.name);
    assert.equal(Buffer.from(v.token.split(".")[2], "base64url").toString("ascii"), v.payload_json, v.name);
    assert.equal(v.token.split(".").slice(0, 3).join("."), v.signing_input, v.name);
  }
});

test("every refusal in the vectors is refused for the same reason as fleet's reference", () => {
  for (const v of V.invalid) {
    const c = checkToken(v.token, v.kind, [KEY]);
    assert.equal(c.ok, false, v.name);
    assert.equal(!c.ok && c.code, v.code, v.name);
  }
});

test("with no key pinned, even a good lease is refused: a key inside a token is never trusted", () => {
  for (const v of V.valid) assert.deepEqual(checkToken(v.token, v.kind, []), { ok: false, code: "unknown_key" }, v.name);
});

test("the replay rule gives the vectors' answers: newer only, never the same lease again, never an older one", () => {
  for (const r of V.replay) assert.equal(newerThan(r.incoming, r.kept), r.take, r.name);
});

test("the rule for a shop's state gives the vectors' answers, the server's clock set back included", () => {
  for (const e of V.effective) {
    const state = effectiveState(e.shop, serverNow(e.clock, e.newest_issued_at), e.extension_until);
    assert.equal(state, e.state, e.name);
    assert.equal(takesNewWork(state), e.new_work, e.name);
    assert.equal(allowsRecovery(state), e.recovery, e.name);
  }
});

// ---- the deployer keeps the lease ------------------------------------------------------------------------------------------------------------------------------

test("a good lease for this server is kept; one for another server, an unpinned key or a changed byte is not, and nothing is written", () => {
  const s = tempServer({}, PIN);
  const server = { id: "acme-vps-1", licence: PIN.licence };
  try {
    assert.deepEqual(takeLease(s.root, { id: "acme-vps-1" }, lease(10, T0)), { taken: false, why: "no licence key is pinned in geometer.json (licence.keys), so no lease is kept and no shop is restricted by one" });
    assert.match((takeLease(s.root, server, lease(10, T0, [shopEntry()], "other-vps")) as { why: string }).why, /another server/u);
    const changed = lease(10, T0).replace(/\.(.)/u, (_m, c) => `.${c === "a" ? "b" : "a"}`);
    assert.equal(takeLease(s.root, server, changed).taken, false);
    assert.equal(existsSync(licencePaths(s.root).lease), false, "nothing refused is ever written");
    const r = takeLease(s.root, server, lease(10, T0));
    assert.equal(r.taken, true);
    assert.equal(readFileSync(licencePaths(s.root).lease, "utf8"), `${lease(10, T0)}\n`, "the token as it came, on one line");
    assert.deepEqual(readSeen(s.root), { schema: 1, newest_issued_at: T0, kept: { serial: 10, issued_at: T0 }, inbox: null });
  } finally { s.done(); }
});

test("replay: the same lease again is not an update, an older one played back is refused, and a deleted lease file lets nothing older back in", () => {
  const s = tempServer({}, PIN);
  const server = { id: "acme-vps-1", licence: PIN.licence };
  try {
    assert.equal(takeLease(s.root, server, lease(10, T0)).taken, true);
    assert.equal(takeLease(s.root, server, lease(12, T0 + DAY, [shopEntry({ state: "wind_down", notice: "wind_down" })])).taken, true);
    assert.deepEqual(takeLease(s.root, server, lease(12, T0 + DAY, [shopEntry({ state: "wind_down", notice: "wind_down" })])), { taken: false, same: true, why: "it is the lease already kept" });
    assert.equal((takeLease(s.root, server, lease(11, T0 + 2 * DAY)) as { why: string }).why, "it is older than the lease already kept (an old lease played back)");
    assert.equal(takeLease(s.root, server, lease(13, T0)).taken, false, "a higher serial signed earlier than the kept one");
    rmSync(licencePaths(s.root).lease);
    assert.equal(takeLease(s.root, server, lease(11, T0 + 2 * DAY)).taken, false, "the order is in seen.json, not only in the lease file");
    assert.equal(takeLease(s.root, server, lease(12, T0 + DAY, [shopEntry({ state: "wind_down", notice: "wind_down" })])).taken, true, "the same lease puts a lost file back");
    assert.equal(keptLicence(s.root, server).lease?.serial, 12);
    writeFileSync(licencePaths(s.root).lease, "gl1.not-a-lease\n");
    assert.equal(keptLicence(s.root, server).lease, undefined, "a lease file changed by hand is not a lease");
  } finally { s.done(); }
});

test("an extension pushes an expired lease's cover out, never lifts a stated wind-down, and the newest issue time keeps a clock set back from stretching anything", () => {
  const s = tempServer({}, PIN);
  const server = { id: "acme-vps-1", licence: PIN.licence };
  try {
    assert.equal(takeLease(s.root, server, lease(10, T0, [shopEntry(), shopEntry({ id: "spa-one", state: "wind_down", notice: "wind_down" })])).taken, true);
    const past = T0 + 31 * DAY; // the lease's cover for glow-salon has ended
    const file = (id: string) => licenceFileFor(keptLicence(s.root, server), id, "Divya, local partner");
    assert.equal(licenceNow(file("glow-salon"), past * 1000).state, "wind_down", "offline past its cover: the wind-down, never the stop");
    const ext = extension(T0 + 20 * DAY, T0 + 40 * DAY);
    assert.equal((takeExtension(s.root, server, extension(T0, T0 + 40 * DAY, ["other-vps"]), past) as { why: string }).why, "it does not name this server (acme-vps-1)");
    assert.match((takeExtension(s.root, server, extension(T0, T0 + DAY), past) as { why: string }).why, /^it ended on /u);
    assert.equal(takeExtension(s.root, server, signTest({ v: 1, kind: "lease", deployment: "acme-vps-1", serial: 1, issued_at: T0, shops: [] }, "gx1"), past).taken, false, "a lease's body under the extension prefix");
    assert.equal(takeExtension(s.root, server, lease(10, T0), past).taken, false, "a lease is not an extension");
    assert.equal(takeExtension(s.root, server, ext, past).taken, true);
    assert.deepEqual(takeExtension(s.root, server, ext, past), { taken: false, same: true, why: "it is already kept" });
    assert.equal(licenceNow(file("glow-salon"), past * 1000).state, "active", "covered by the extension");
    assert.equal(licenceNow(file("spa-one"), past * 1000).state, "wind_down", "a stated wind-down holds");
    assert.equal(licenceNow(file("chai-point"), past * 1000).restricted, false, "a shop the lease does not list is not restricted");
    assert.equal(keptLicence(s.root, server).newestIssuedAt, T0 + 20 * DAY, "the extension's issue time is the newest taken");
    // the clock set back to before the lease was signed: judged no earlier than the newest issue time taken
    const late = licenceFileFor({ ...keptLicence(s.root, server), extensionUntil: 0, newestIssuedAt: T0 + 30 * DAY }, "glow-salon", "");
    assert.equal(licenceNow(late, (T0 - 10 * DAY) * 1000).state, "wind_down");
    const status = statusLicence(keptLicence(s.root, server), file("glow-salon"), past * 1000);
    assert.equal(status.state, "active");
    assert.equal(status.windDownOn, new Date((T0 + 40 * DAY) * 1000).toISOString(), "the wind-down day the extension moved");
  } finally { s.done(); }
});

test("the runtime's licence.json is read field by field: a lease shop with a field more, or a partner name too long, is not a licence file", () => {
  const good = { schema: 1, shop: shopEntry(), newest_issued_at: T0, extension_until: 0, partner: "Divya, local partner" };
  assert.deepEqual(parseLicenceFile(good), good);
  assert.equal(parseLicenceFile({ ...good, shop: { ...shopEntry(), extra: 1 } }), undefined);
  assert.equal(parseLicenceFile({ ...good, partner: "x".repeat(121) }), undefined);
  assert.equal(parseLicenceFile({ ...good, shop: null })?.shop, null);
  assert.equal(licenceNow(undefined, Date.now()).restricted, false, "no file: never restricted");
});
