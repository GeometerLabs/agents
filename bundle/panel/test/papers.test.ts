// The papers page (B28, B35, B36): the record of one case, a person's statement, the agent's identity paper and the evidence pack, for a shop the account may see, signed
// with the panel's key, and read by the report verifier. A partner asking for another partner's shop gets the same 404 as for a shop that does not exist; a person's
// number is only ever in a POST body, never in the log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runBusyMonth } from "../../../templates/commerce/bookings/report/example-month.ts";
import { buildGoLiveCertificate } from "../../../templates/commerce/bookings/report/certificate.ts";
import { ledgerEntries } from "../../../modules/record/ledger.ts";
import { envelopeFile, seal, verifyEnvelopeText } from "../../../modules/report/sign.ts";
import { NOW, accountIdOf, boot, papers } from "./helpers.ts";

const month = await runBusyMonth();
const entries = month.world.record.entries();
const bookings = [...month.world.store.bookings.values()];
const refund = entries.find((e) => e.action === "refund" && e.outcome === "confirmed")!;
const refunded = bookings.find((b) => b.id === refund.booking)!;

test("the papers of a partner's own shop: one case, a statement by POST, the identity paper full and public, the pack and its anchor; another partner gets 404", async () => {
  const b = await boot({}, { signing: true, key: true });
  try {
    const divya = await b.account("divya", "partner");
    const meena = await b.account("meena", "partner");
    b.addShop("glow-salon", { name: "Glow Salon", ownerId: accountIdOf(b, "divya"), ownerName: "Divya" });
    b.status("glow-salon", { updatedAt: new Date(NOW).toISOString(), deploy: { state: "applied" }, fingerprint: { at: new Date(NOW).toISOString(), ok: true, day: "2026-11-04", seq: 5, head: ledgerEntries(entries, "glow-salon")[4].hash, signed: true } });
    mkdirSync(join(b.dir, "exports", "glow-salon"), { recursive: true });
    writeFileSync(join(b.dir, "exports", "glow-salon", "record.json"), JSON.stringify(entries));
    writeFileSync(join(b.dir, "exports", "glow-salon", "bookings.json"), JSON.stringify(bookings));
    writeFileSync(join(b.dir, "exports", "glow-salon", "ledger.json"), JSON.stringify(ledgerEntries(entries, "glow-salon")));
    papers(b, "glow-salon").make("glow-salon", "go-live", (dir) => {
      const cert = buildGoLiveCertificate({ settings: month.world.settings, handCheck: { held: 38, total: 38, checks: 120, failedTitles: [] }, issuedAt: NOW - 86_400_000 });
      writeFileSync(join(dir, "go-live-certificate.json"), envelopeFile(seal(cert)));
    });

    const page = await divya.get("/shops/glow-salon/papers");
    assert.equal(page.status, 200);
    assert.match(page.plain, new RegExp(refunded.id));
    assert.ok((await divya.get("/shops/glow-salon")).text.includes("/shops/glow-salon/papers"), "the shop page links to the papers page");

    const json = await divya.bytes(`/shops/glow-salon/papers/case?case=${refunded.id}&as=json`);
    assert.equal(json.status, 200);
    assert.match(json.headers.get("content-disposition") ?? "", /attachment; filename="case-b-\d+\.json"/);
    const record = verifyEnvelopeText(json.body.toString("utf8"));
    assert.equal(record.unchanged && record.signed, true, record.summary);
    const doc = record.envelope!.document as { format: string; anchor: { tenant: string }; rows: { services: string[] }[]; case: { customer: string } };
    assert.equal(doc.format, "geometer-dispute-record/1");
    assert.equal(doc.anchor.tenant, "glow-salon");
    assert.ok(doc.rows.some((r) => r.services.some((s) => s.includes(refund.refs.refundId))));
    assert.equal((await divya.get(`/shops/glow-salon/papers/case?case=${refunded.id}`)).headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal((await divya.get("/shops/glow-salon/papers/case?case=b-99999")).status, 409);

    const statement = await divya.post("/shops/glow-salon/papers/statement", { number: refunded.customer, as: "json" }, "/shops/glow-salon/papers");
    assert.equal(statement.status, 200);
    const s = verifyEnvelopeText(statement.text);
    assert.equal(s.unchanged, true, s.summary);
    const sd = s.envelope!.document as { person: { cases: string[] }; totals: { refundedPaise: number } };
    assert.ok(sd.person.cases.includes(refunded.id) && sd.totals.refundedPaise > 0);
    assert.ok(!b.logs.join("\n").includes(refunded.customer.slice(-6)), "the number is not in the log");
    assert.equal((await divya.post("/shops/glow-salon/papers/statement", { number: "not a number" }, "/shops/glow-salon/papers")).status, 409);

    const identity = verifyEnvelopeText((await divya.bytes("/shops/glow-salon/papers/identity.json")).body.toString("utf8"));
    const id = identity.envelope!.document as { agent: { id: string }; operator: { name: string }; checks: { held: number }; ledger: { published: { seq: number } } };
    assert.match(id.agent.id, /^agt_/);
    assert.equal(id.operator.name, "Divya");
    assert.equal(id.checks.held, 38);
    assert.equal(id.ledger.published.seq, 5, "the last published fingerprint, from the shop's status");
    const again = verifyEnvelopeText((await divya.bytes("/shops/glow-salon/papers/identity-public.json")).body.toString("utf8"));
    const pub = again.envelope!.document as { agent: { id: string }; operator: unknown; shown: string[] };
    assert.equal(pub.agent.id, id.agent.id, "the same id every time: it is kept with the shop");
    assert.deepEqual(pub.operator, { shown: false });
    // the operator chooses what the public paper shows, on the papers page
    const chose = await divya.post("/shops/glow-salon/papers/public", { show_operator: "1", show_limits: "1", show_live: "1" }, "/shops/glow-salon/papers");
    assert.equal(chose.status, 303);
    assert.match((await divya.get("/shops/glow-salon/papers?notice=public")).text, /checked/);
    const chosen = verifyEnvelopeText((await divya.bytes("/shops/glow-salon/papers/identity-public.json")).body.toString("utf8")).envelope!.document as { agent: { id: string }; operator: { name: string }; checks: unknown; shown: string[] };
    assert.deepEqual(chosen.shown, ["operator", "limits", "live"]);
    assert.equal(chosen.operator.name, "Divya");
    assert.deepEqual(chosen.checks, { shown: false });
    assert.equal(chosen.agent.id, id.agent.id, "choosing keeps the id");
    assert.equal((await meena.post("/shops/glow-salon/papers/public", { show_shop: "1" }, "/shops")).status, 404);
    assert.equal(JSON.parse(readFileSync(join(b.dir, "shops", "glow-salon", "identity.json"), "utf8")).id, id.agent.id);

    const pack = JSON.parse((await divya.bytes("/shops/glow-salon/papers/ledger/pack.json")).body.toString("utf8"));
    assert.equal(pack.format, "geometer.evidence-pack");
    assert.equal(pack.key_log.length, 1);
    const anchor = JSON.parse((await divya.bytes("/shops/glow-salon/papers/ledger/anchor.json")).body.toString("utf8"));
    assert.equal(anchor.checkpoint.head, pack.entries.at(-1).hash);

    for (const path of ["/shops/glow-salon/papers", `/shops/glow-salon/papers/case?case=${refunded.id}`, "/shops/glow-salon/papers/identity.json", "/shops/glow-salon/papers/ledger/pack.json"]) {
      assert.equal((await meena.get(path)).status, 404, `${path} for another partner`);
    }
    assert.equal((await meena.post("/shops/glow-salon/papers/statement", { number: refunded.customer }, "/shops")).status, 404);
  } finally { await b.close(); }
});
