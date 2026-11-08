// Example papers (B28, B35, B36) from the busy month the report tests use (Glow Salon, stand-in services, test money): a customer's statement in their language,
// the record of one refunded booking in English and in the owner's language, the agent's identity paper (full and public), and the record as an evidence pack with
// its anchor for geo-verify. It writes into templates/commerce/bookings/report-sample/papers/ (ignored by git) unless --out names another folder.
//   node templates/commerce/bookings/scripts/papers-example.ts [--out <folder>]
// Signed with a throwaway key made in memory; its private half is never written. Check a paper with
//   node templates/commerce/bookings/scripts/verify-report.ts <out>/statement.json --trust-key <out>/example-public-key.pem
// and the pack with geo-verify (built from the geometer-verify repository): geo-verify <out>/pack.json --anchor <out>/anchor.json
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { anchorOf, evidencePack, ledgerEntries, ledgerFile } from "../../../../modules/record/ledger.ts";
import { writer } from "../../../../modules/report/months.ts";
import { envelopeFile, seal } from "../../../../modules/report/sign.ts";
import { disputePage, disputeText, sealDisputeRecord } from "../../../../modules/papers/dispute.ts";
import { identityPage, newAgentId, sealIdentity } from "../../../../modules/papers/identity.ts";
import { sealStatement, statementPage, statementText } from "../../../../modules/papers/statement.ts";
import { buildGoLiveCertificate } from "../report/certificate.ts";
import { UsageError, main } from "../report/cli.ts";
import { at, runBusyMonth } from "../report/example-month.ts";
import { BOOKINGS_PAPERS, bookingCase, fromGoLive, limitFacts } from "../report/papers.ts";

await main(async () => {
  let args;
  try { args = parseArgs({ args: process.argv.slice(2), options: { out: { type: "string" } } }); } catch (e) { throw new UsageError((e as Error).message); }
  const out = args.values.out ?? fileURLToPath(new URL("../report-sample/papers/", import.meta.url));
  const w = writer(out);
  const { world } = await runBusyMonth();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(join(out, "example-public-key.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const entries = world.record.entries();
  const bookings = [...world.store.bookings.values()];
  const cases = bookings.map((b) => bookingCase(b, world.settings));
  const shop = { name: world.settings.name, timeZone: world.settings.timezone };
  const now = at(12, 2, 10);
  const tenant = "glow-salon";
  const refund = entries.find((e) => e.action === "refund" && e.outcome === "confirmed")!;
  const booking = bookings.find((b) => b.id === refund.booking)!;

  const statement = sealStatement({ template: BOOKINGS_PAPERS, shop, number: booking.customer, entries, cases, now, tenant }, privateKey);
  w.write("statement.json", envelopeFile(statement));
  w.write(`statement-${statement.document.language}.html`, statementPage(statement));
  w.write(`statement-${statement.document.language}.txt`, `${statementText(statement)}\n`);
  for (const language of [...new Set(["en", world.settings.owner.language] as const)]) {
    const record = sealDisputeRecord({ template: BOOKINGS_PAPERS, shop, case: bookingCase(booking, world.settings), entries, language, now, tenant }, privateKey);
    w.write(`case-${booking.id}-${language}.json`, envelopeFile(record));
    w.write(`case-${booking.id}-${language}.html`, disputePage(record));
    w.write(`case-${booking.id}-${language}.txt`, `${disputeText(record)}\n`);
  }
  const cert = buildGoLiveCertificate({ settings: world.settings, handCheck: { held: 38, total: 38, checks: 120, failedTitles: [] }, issuedAt: at(10, 27, 10), preparedBy: "Divya, local partner (example)" });
  w.write("go-live-certificate.json", envelopeFile(seal(cert, privateKey)));
  const goLive = fromGoLive(cert, "en");
  const wider = { ...world.settings, cancellation: { ...world.settings.cancellation, refundLimitInr: world.settings.cancellation.refundLimitInr + 300 } };
  const identity = sealIdentity({
    template: BOOKINGS_PAPERS, agentId: newAgentId(new Uint8Array(13).fill(42)), language: "en", operator: { name: "Divya (example)", role: "partner" }, shop, limits: goLive.limits, checks: goLive.checks, entries,
    history: [{ at: "2026-10-27T04:30:00.000Z", by: { name: "Divya (example)", role: "partner" }, settings: world.settings }, { at: "2026-11-20T04:30:00.000Z", by: { name: "Arjun (example)", role: "builder" }, settings: wider }],
    limitFacts, tenant, now,
  }, privateKey);
  w.write("identity.json", envelopeFile(identity.full));
  w.write("identity-en.html", identityPage(identity.full));
  w.write("identity-public.json", envelopeFile(identity.public));
  w.write("identity-public-en.html", identityPage(identity.public));
  const ledger = ledgerEntries(entries, tenant);
  w.write("pack.json", ledgerFile(evidencePack(ledger, { tenant, now, key: privateKey })));
  w.write("anchor.json", ledgerFile(anchorOf(ledger, privateKey)));
  console.log(`Example papers for Glow Salon (stand-in services, test money): ${w.files.length} files in ${out}`);
  for (const f of w.files) console.log(`  ${f}`);
  console.log(`\nCheck one: node templates/commerce/bookings/scripts/verify-report.ts ${join(out, "statement.json")} --trust-key ${join(out, "example-public-key.pem")}\nCheck the pack: geo-verify ${join(out, "pack.json")} --anchor ${join(out, "anchor.json")}`);
});
