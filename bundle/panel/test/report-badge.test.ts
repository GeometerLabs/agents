// The builder's own copy of a shop's monthly report (the "report" button on the shop's page) says the same two things the owner's WhatsApp message says, from the same files
// the deployer reads: who set the shop up (report.json, else the attribution) and the Innovator badge (fleet's answer for the shop).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runBusyMonth } from "../../../templates/commerce/bookings/report/example-month.ts";
import { preparedByOf } from "../contract.ts";
import { boot, papers } from "./helpers.ts";

const AT = "2026-11-05T10:00:00.000Z";
const answer = (more: Record<string, unknown> = {}) => ({ schema: 1, at: AT, plan: "business", allowance: 3000, innovator: false, ai: "normal", warn: [], ...more });

// worked out once, before any request: the panel runs inside this process, and a long stretch of work between two requests lets it close the browser's idle connection (five seconds)
const busyMonth = await runBusyMonth();

test("the report the panel makes carries the Innovator badge when fleet says so, and the name from report.json or the attribution", async () => {
  const b = await boot();
  try {
    const arjun = await b.account("arjun", "builder");
    const accountId = JSON.parse(readFileSync(join(b.dir, "panel", "data", "accounts.json"), "utf8")).accounts[0].id as string;
    b.addShop("glow-salon", { ownerId: accountId, ownerName: "Divya", ownerRole: "partner" });
    const month = busyMonth;
    mkdirSync(join(b.dir, "exports", "glow-salon"), { recursive: true });
    writeFileSync(join(b.dir, "exports", "glow-salon", "record.json"), JSON.stringify(month.world.record.entries()));
    writeFileSync(join(b.dir, "exports", "glow-salon", "bookings.json"), JSON.stringify([...month.world.store.bookings.values()]));
    const fleet = (value: unknown) => { mkdirSync(join(b.dir, "fleet"), { recursive: true }); writeFileSync(join(b.dir, "fleet", "glow-salon.json"), typeof value === "string" ? value : JSON.stringify(value)); };
    const make = async () => {
      const r = await arjun.post("/shops/glow-salon/report", { month: "2026-11" }, "/shops/glow-salon");
      assert.equal(r.status, 303);
      return JSON.parse(papers(b, "glow-salon").get("glow-salon", "monthly/2026-11/report-2026-11.json")!).document as { preparedBy: string | null; innovator?: true };
    };
    let doc = await make();
    assert.equal(doc.preparedBy, "Divya, local partner");
    assert.equal(doc.innovator, undefined, "fleet has said nothing: no badge");
    fleet(answer({ innovator: true }));
    doc = await make();
    assert.equal(doc.innovator, true, "the badge is on the builder's copy too");
    fleet(answer({ innovator: "yes" }));
    assert.equal((await make()).innovator, undefined, "only a plain true");
    fleet(answer({ innovator: false }));
    assert.equal((await make()).innovator, undefined);
    fleet("{ not json");
    assert.equal((await make()).innovator, undefined);
    // report.json, when the shop has one, is the name on both copies
    writeFileSync(join(b.dir, "shops", "glow-salon", "report.json"), JSON.stringify({ schema: 1, preparedBy: "Meera, Kochi partner" }));
    assert.equal((await make()).preparedBy, "Meera, Kochi partner");
    writeFileSync(join(b.dir, "shops", "glow-salon", "report.json"), "{ nope");
    assert.equal((await make()).preparedBy, "Divya, local partner", "a report.json that cannot be read falls back to the attribution");
    assert.equal(preparedByOf({ accountName: "Divya", role: "partner" }), "Divya, local partner");
  } finally { await b.close(); }
});
