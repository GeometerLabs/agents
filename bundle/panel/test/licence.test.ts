// The shop's licence on the panel (B13): the state the server worked out from the signed lease, in plain words and in the partner's language, the dates from fleet's copy,
// fleet's renew link, a note when the lease has not been refreshed for more than 2 days, and nothing at all for a shop the lease does not list. A partner sees only their
// own shops' licences.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { licenceView } from "../licence.ts";
import { parseFleetAnswer, parseStatus } from "../contract.ts";
import { NOW, accountIdOf, boot } from "./helpers.ts";

const day = (d: string) => new Date(`${d}T00:00:00+05:30`).toISOString();
const statusLicence = (more: Record<string, unknown> = {}) => ({ state: "warning", listed: true, paidThrough: day("2026-12-08"), windDownOn: day("2027-01-07"), stopOn: null, exportUntil: null, leaseIssuedAt: new Date(NOW - 3_600_000).toISOString(), extendedUntil: null, at: new Date(NOW).toISOString(), ...more });
const fleetAnswer = (licence: Record<string, unknown> | undefined) => ({ schema: 1, at: new Date(NOW).toISOString(), plan: "business", allowance: 3000, innovator: false, ai: "normal", warn: ["licence_warning"], ...(licence ? { licence } : {}) });

test("the view: the signed state, fleet's days, the renew link only when something is owed, and the 2-day note", () => {
  const status = parseStatus(JSON.stringify({ licence: statusLicence() }));
  assert.ok(status.ok);
  const fleet = parseFleetAnswer(JSON.stringify(fleetAnswer({ state: "warning", paid_through: "2026-12-08", wind_down_on: "2027-01-07", stop_on: null, export_until: null, notice: null, renew_url: "https://rzp.io/i/abc123" })));
  const v = licenceView(status.ok ? status.status.licence : undefined, fleet?.licence, NOW)!;
  assert.deepEqual(v, { state: "warning", paidThrough: "2026-12-08", windDownOn: "2027-01-07", renewUrl: "https://rzp.io/i/abc123" });
  assert.equal(licenceView({ ...statusLicence({ state: "active" }) } as never, fleet?.licence, NOW)!.renewUrl, undefined, "nothing owed, no renew link");
  assert.equal(licenceView(statusLicence({ leaseIssuedAt: new Date(NOW - 3 * 86_400_000).toISOString() }) as never, undefined, NOW)!.staleSince, new Date(NOW - 3 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  assert.equal(licenceView(statusLicence({ listed: false }) as never, fleet?.licence, NOW), undefined, "a shop the lease does not list shows nothing");
  assert.equal(parseFleetAnswer(JSON.stringify(fleetAnswer({ state: "warning", renew_url: "javascript:alert(1)" })))?.licence?.renew_url, null, "a renew link is https or nothing");
});

test("the shop page and the list show the licence to the partner whose shop it is, in their language, and to no other partner", async () => {
  const b = await boot();
  try {
    const divya = await b.account("divya", "partner", "hi");
    const meena = await b.account("meena", "partner");
    b.addShop("divya-shop", { ownerId: accountIdOf(b, "divya"), ownerName: "Divya", ownerRole: "partner" });
    b.addShop("meena-shop", { ownerId: accountIdOf(b, "meena"), ownerName: "Meena", ownerRole: "partner" });
    b.status("divya-shop", { updatedAt: new Date(NOW).toISOString(), deploy: { state: "applied" }, licence: statusLicence({ state: "wind_down", stopOn: day("2027-02-06"), leaseIssuedAt: new Date(NOW - 3 * 86_400_000).toISOString() }) });
    mkdirSync(join(b.dir, "fleet"), { recursive: true });
    writeFileSync(join(b.dir, "fleet", "divya-shop.json"), JSON.stringify(fleetAnswer({ state: "wind_down", paid_through: "2026-12-08", wind_down_on: "2027-01-07", stop_on: "2027-02-06", export_until: null, notice: "wind_down", renew_url: "https://rzp.io/i/abc123" })));
    const page = await divya.get("/shops/divya-shop");
    assert.equal(page.status, 200);
    assert.match(page.plain, /लाइसेंस/u);
    assert.match(page.plain, /रुका हुआ: कोई नई बुकिंग या भुगतान अनुरोध नहीं/u);
    assert.match(page.plain, /href="https:\/\/rzp\.io\/i\/abc123"/u);
    assert.match(page.plain, /लाइसेंस .* से ताज़ा नहीं हुआ है/u, "the lease is more than 2 days old");
    assert.match(page.plain, /सहायता को लिखिए। एक इंसान जवाब देता है।/u);
    const list = await divya.get("/shops");
    assert.match(list.plain, /रुका हुआ: कोई नई बुकिंग या भुगतान अनुरोध नहीं/u);
    assert.equal((await meena.get("/shops/divya-shop")).status, 404, "another partner's shop is not there for her");
    assert.doesNotMatch((await meena.get("/shops")).plain, /rzp\.io|Paused/u);
    const own = await meena.get("/shops/meena-shop");
    assert.doesNotMatch(own.plain, /<h2>Licence<\/h2>/u, "no lease lists her shop: nothing is said about a licence");
  } finally { await b.close(); }
});
