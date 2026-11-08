// One-time confirmation links (the Claude Code plugin, plan B11): a link only asks, a signed-in person's button does it, a limit is only ever made tighter, and go-live
// is never done by a link alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ConfigError } from "../config.ts";
import { makeConfirmLink, openStores } from "../server.ts";
import { accountIdOf, boot } from "./helpers.ts";
import type { Boot } from "./helpers.ts";

const settingsOf = (b: Boot, shop = "glow-salon") => JSON.parse(readFileSync(join(b.dir, "shops", shop, "settings.json"), "utf8"));
const ask = (b: Boot, o: Parameters<typeof makeConfirmLink>[1]) => makeConfirmLink({ ...b.config, port: b.panel.port }, o);
const pathOf = (link: string) => new URL(link).pathname;

async function setUp() {
  const b = await boot();
  const arjun = await b.account("arjun", "builder");
  b.addShop("glow-salon", { name: "Glow Salon" });
  return { b, arjun };
}

test("a limit made tighter is saved only when a signed-in person presses the button, once, and the history names them", async () => {
  const { b, arjun } = await setUp();
  try {
    assert.equal(settingsOf(b).cancellation.refundLimitInr, 200);
    const { link } = ask(b, { kind: "limits", shop: "glow-salon", changes: [{ path: "cancellation.refundLimitInr", value: 100 }], note: "Claude Code drafted this" });
    assert.equal(settingsOf(b).cancellation.refundLimitInr, 200, "a link alone changes nothing");

    const stranger = b.browser();
    const signedOut = await stranger.get(pathOf(link));
    assert.equal(signedOut.status, 303);
    assert.equal(signedOut.location, "/login");

    const page = await arjun.get(pathOf(link));
    assert.equal(page.status, 200);
    assert.ok(page.plain.includes("Glow Salon") && page.plain.includes("tighter") && page.plain.includes("Claude Code drafted this"));
    assert.equal(settingsOf(b).cancellation.refundLimitInr, 200, "opening it changes nothing either");

    const done = await arjun.post(pathOf(link), {}, pathOf(link));
    assert.equal(done.status, 200);
    assert.equal(settingsOf(b).cancellation.refundLimitInr, 100);
    const history = readFileSync(join(b.dir, "shops", "glow-salon", "settings-history.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(history.at(-1).by.id, accountIdOf(b, "arjun"));

    const again = await arjun.get(pathOf(link));
    assert.equal(again.status, 410);
    assert.ok(!b.logs.some((l) => l.includes(pathOf(link).slice("/confirm/".length))), "the token is not in the panel's log");
  } finally { await b.close(); }
});

test("only the sha256 of the token is kept, and a link runs out", async () => {
  const { b, arjun } = await setUp();
  try {
    const { link } = ask(b, { kind: "limits", shop: "glow-salon", changes: [{ path: "cancellation.refundLimitInr", value: 150 }] });
    const token = pathOf(link).slice("/confirm/".length);
    const kept = JSON.stringify(openStores(b.config).store.read("confirmations.json"));
    assert.ok(!kept.includes(token));
    assert.ok(kept.includes(createHash("sha256").update(token).digest("hex")));
    const late = { ...b.config, now: () => (b.config.now as () => number)() + 3 * 3_600_000 };
    assert.ok(late.now() > Date.parse(JSON.parse(kept).items[0].expiresAt));
    // the same check the panel makes, with the clock three hours on
    const { createConfirmations } = await import("../confirmations.ts");
    assert.equal(createConfirmations(openStores(b.config).store, late.now).status(token), "expired");
    assert.equal((await arjun.get("/confirm/not-a-link-we-made-xxxxxxxx")).status, 404);
  } finally { await b.close(); }
});

test("a link cannot be made, or used, to loosen a limit or to change something that is not on the list", async () => {
  const { b, arjun } = await setUp();
  try {
    for (const changes of [
      [{ path: "cancellation.refundLimitInr", value: 200 }], // the same: nothing to confirm
      [{ path: "deposit.amountInr", value: 100 }], // a deposit is not a limit the plugin may change, even downwards
      [{ path: "services", value: 1 }],
      [{ path: "cancellation.noSuchField", value: 1 }],
    ]) assert.throws(() => ask(b, { kind: "limits", shop: "glow-salon", changes }), ConfigError);
    // widening is refused when asked for... (the example's refund limit equals its deposit, so lower it first, then try to raise it again)
    const first = ask(b, { kind: "limits", shop: "glow-salon", changes: [{ path: "cancellation.refundLimitInr", value: 100 }] });
    await arjun.post(pathOf(first.link), {}, pathOf(first.link));
    assert.throws(() => ask(b, { kind: "limits", shop: "glow-salon", changes: [{ path: "cancellation.refundLimitInr", value: 180 }] }), /loosens/u);

    // ...and it is refused again at the button, whatever is written into the panel's own file
    const store = openStores(b.config).store;
    const { createConfirmations } = await import("../confirmations.ts");
    const forged = createConfirmations(store, b.config.now).create({ kind: "limits", shop: "glow-salon", digest: "x", changes: [{ path: "cancellation.refundLimitInr", value: 200 }] });
    const forgedPath = `/confirm/${forged.token}`;
    const refused = await arjun.post(forgedPath, {}, forgedPath);
    assert.equal(refused.status, 409);
    assert.equal(settingsOf(b).cancellation.refundLimitInr, 100);
    // a forged request for a field that is not on the list is refused too, even with the right digest
    const { settingsDigest } = await import("../../lib/limits-draft.ts");
    const f2 = createConfirmations(store, b.config.now).create({ kind: "limits", shop: "glow-salon", digest: settingsDigest(settingsOf(b)), changes: [{ path: "deposit.amountInr", value: 50 }] });
    assert.equal((await arjun.post(`/confirm/${f2.token}`, {}, `/confirm/${f2.token}`)).status, 409);
    assert.equal(settingsOf(b).deposit.amountInr, 200);
  } finally { await b.close(); }
});

test("a link made before the settings changed is refused, and a partner who does not own the shop cannot open it", async () => {
  const { b, arjun } = await setUp();
  try {
    const { link } = ask(b, { kind: "limits", shop: "glow-salon", changes: [{ path: "cancellation.refundLimitInr", value: 100 }] });
    const other = ask(b, { kind: "limits", shop: "glow-salon", changes: [{ path: "cancellation.refundLimitInr", value: 120 }] });
    await arjun.post(pathOf(other.link), {}, pathOf(other.link));
    const stale = await arjun.post(pathOf(link), {}, pathOf(link));
    assert.equal(stale.status, 409);
    assert.ok(stale.plain.includes("settings changed"));
    assert.equal(settingsOf(b).cancellation.refundLimitInr, 120);

    b.addShop("pet-spa", { name: "Pet Spa", ownerId: accountIdOf(b, "arjun"), ownerName: "Arjun", ownerRole: "builder" });
    const divya = await b.account("divya", "partner");
    const fresh = ask(b, { kind: "limits", shop: "pet-spa", changes: [{ path: "cancellation.refundLimitInr", value: 100 }] });
    assert.equal((await divya.get(pathOf(fresh.link))).status, 404);
    assert.equal(settingsOf(b, "pet-spa").cancellation.refundLimitInr, 200);
  } finally { await b.close(); }
});

test("go-live is not done by a link: it needs a person's two ticks and every check, and a refusal leaves the link unspent and no certificate", async () => {
  const { b, arjun } = await setUp();
  try {
    const { link } = ask(b, { kind: "go-live", shop: "glow-salon" });
    const path = pathOf(link);
    const page = await arjun.get(path);
    assert.ok(page.plain.includes("not checked by Geometer"), "the WhatsApp templates are said to be unchecked");
    assert.ok(page.plain.includes("booking_reminder"), "the templates are listed");

    const noTicks = await arjun.post(path, {}, path);
    assert.equal(noTicks.status, 409);
    const ticked = await arjun.post(path, { templates_seen: "yes", keys_in_guard: "yes" }, path);
    assert.equal(ticked.status, 409, "no deployed shop and no connection checks here, so it is not ready");
    assert.ok(ticked.plain.includes("Still in the way"));
    assert.equal((await arjun.get(path)).status, 200, "the link was not spent by a refusal");
    assert.equal(openStores(b.config).store.read<{ readyAt?: string }>("meta/glow-salon.json")?.readyAt, undefined);
  } finally { await b.close(); }
});
