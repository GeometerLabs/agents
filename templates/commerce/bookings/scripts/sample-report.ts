// The sample report to take away (plan B66, checkpoint item 17): the monthly report and the crash-test report (the go-live certificate) of ONE sample shop, a made-up UPI
// salon on stand-in services with test money (report/sample-shop.ts), as a self-contained HTML page plus the signed JSON, with the paper's signed summary link
// (item 17b, `#s1.`). Committed in templates/commerce/bookings/sample-report/ and copied to geometer.dev by public-web's `npm run sample:pull`.
//   node templates/commerce/bookings/scripts/sample-report.ts [--out <folder>]     (default: the committed folder; writes nothing else)
// test/sample-report.test.ts makes it again into a temporary folder and fails if the committed copy differs, as prices/ does for the price list.
//
// THE KEY. The files are signed with a PUBLIC TEST KEY: an Ed25519 key made from a fixed, published seed (below), so the same script always gives the same bytes and the
// sample can be checked again by anyone. It is not a secret and is not anyone's identity: it is never on Geometer's list of signers, so the website's signed-link check
// says "unknown signer" for it, and the file check on /verify passes only with this key named (sample-report/manifest.json holds it). Never use it for a real paper.
//
// THE COST. What the month cost is the WhatsApp estimate the cost meter (bundle/lib/usage.ts) works out from the record and the price list in force on the month's last
// day (prices/README.md), before the month's free replies. No AI model is used by this sample. The price comes from prices/*.json and is written nowhere else.
import { createPrivateKey } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { summarizeUsage, usageRatesFrom } from "../../../../bundle/lib/usage.ts";
import { loadPriceList } from "../../../../bundle/panel/cost.ts";
import { runOn } from "../crash-test/situations.ts";
import { summariseRun } from "../report/certificate.ts";
import { readGoLiveCertificate } from "../report/go-live.ts";
import { writeClientReport, writeGoLiveCertificate } from "../report/run.ts";
import { at, runSampleMonth, sampleSettings } from "../report/sample-shop.ts";
import { keyIdOf, publicKeyHex } from "../../../../modules/report/sign.ts";
import { monthRange } from "../../../../modules/report/months.ts";

/** The committed folder. */
export const SAMPLE_FOLDER = fileURLToPath(new URL("../sample-report/", import.meta.url));
const PRICES = fileURLToPath(new URL("../../../../prices/", import.meta.url));

/** An Ed25519 private key from a fixed seed: 32 bytes of 0x2d (45). PKCS#8 for Ed25519 is this 16-byte prefix and the seed. A published test key, see the header. */
const TEST_SEED = Buffer.alloc(32, 45);
const testKey = () => createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), TEST_SEED]), format: "der", type: "pkcs8" });

/** The newest price list in force (not proposed) dated on or before the month's last day: how a month is priced (prices/README.md). */
function priceListFor(lastDay: string) {
  const files = readdirSync(PRICES).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(f) && f.slice(0, 10) <= lastDay).sort().reverse();
  for (const f of files) { const list = loadPriceList(join(PRICES, f)); if (list.status !== "proposed") return list; }
  throw new Error(`No price list in force on ${lastDay}.`);
}

/** Make the sample into `out` (created if missing) and return the manifest it wrote. Deterministic: same inputs, same bytes. */
export async function makeSampleReport(out: string): Promise<Record<string, unknown>> {
  mkdirSync(out, { recursive: true });
  const settings = sampleSettings();
  const { world } = await runSampleMonth();
  const key = testKey();
  const now = at(11, 30, 23, 5); // the report is made at the end of the month's last evening, so the customer who says they paid is still waiting
  const common = { settings, out, source: "stand-in" as const, key, preparedBy: "Divya, local partner (example)", now, language: "en" as const };

  // The crash-test report: the situations that suit a UPI shop, run on these settings with the stand-in services and read into the go-live certificate.
  const handCheck = summariseRun(await runOn(settings));
  const goLive = writeGoLiveCertificate({ ...common, handCheck });
  const reading = readGoLiveCertificate(readFileSync(join(out, "go-live-certificate.json"), "utf8"), settings);

  // The cost: the record through the cost meter, with the price list of the month.
  const { from, to } = monthRange("2026-11", settings.timezone);
  const inMonth = world.record.entries().filter((e) => Date.parse(e.time) >= from && Date.parse(e.time) < to);
  const list = priceListFor("2026-11-30");
  const usage = summarizeUsage(inMonth, usageRatesFrom([list]));
  const cost = usage.whatsapp.estimated && !usage.unpriced
    ? { microInr: usage.whatsapp.estMicroInr + usage.modelMicroInr, basis: `WhatsApp messages (${usage.whatsapp.utility} reminders and notices at the utility rate, ${usage.whatsapp.service} replies at the service rate, with GST) at the ${list.date} price list, before the month's free replies; no AI model was used.` }
    : undefined;

  const report = writeClientReport({ ...common, entries: world.record.entries(), bookings: [...world.store.bookings.values()], month: "2026-11", goLive: reading.finding, ...(cost ? { cost } : {}) });
  // writeClientReport also writes the monthly record certificate; the sample is the report and the crash-test report, so the certificate is not kept.
  for (const f of ["certificate-2026-11.json", "certificate-2026-11-en.html", "certificate-2026-11-en.txt"]) rmSync(join(out, f), { force: true });
  const publicKey = publicKeyHex(key);
  const manifest = {
    format: "geometer-sample-report/1",
    about: "A made-up UPI salon on stand-in services with test money. Signed with a public test key that is nobody's identity and is not on Geometer's list of signers.",
    shop: settings.name, month: "2026-11", source: "stand-in", language: "en",
    publicKey, keyId: keyIdOf(publicKey),
    report: { json: "report-2026-11.json", html: "report-2026-11-en.html", code: report.report.code, digest: report.report.digest, check: report.check ?? null },
    crashTest: { json: "go-live-certificate.json", html: "go-live-certificate-en.html", code: goLive.code, held: handCheck.held, total: handCheck.total },
    priceList: cost ? list.date : null,
    /** The owner's WhatsApp message, line for line (owner-2026-11-en.txt), so the website's preview shows the same words without reading a second file. */
    ownerLines: report.ownerTexts[0].split("\n"),
  };
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs({ args: process.argv.slice(2), options: { out: { type: "string" } } });
  const out = args.values.out ?? SAMPLE_FOLDER;
  const manifest = await makeSampleReport(out);
  console.log(`Sample report written to ${out}\nKey ${manifest.keyId}\nReport code ${(manifest.report as { code: string }).code}`);
}
