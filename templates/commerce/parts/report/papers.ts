// The go-live papers of a shop of several parts (decision 65): its hand check's summary and its certificate, for the panel and the deployer (bundle/lib/kinds.ts
// KINDS.parts.papers). Pure over the run: the run itself is crash-test/hand-check.ts, loaded only by the hand check's own child process (bundle/lib/hand-check-go.ts), so the
// panel and the deployer never load the runner, the stand-ins or the process tracker.
//
// THE HAND CHECK runs, all on the shop's own Go program (go/cmd/parts) and on the shop's own settings:
//   1. the shop's own situations (crash-test/situations.ts: the router, the one question, one owner's page, one stock count);
//   2. EVERY PART'S OWN SITUATIONS (its template's crash-test/situations.ts runOn), each on that part's settings in this shop, with the other parts beside it in the shop's own
//      order (modules/crash-test/go-world.ts goWorldPart: the world wraps the part's settings into the shop's, reads the part's own state and record lines, and serves the
//      number's templates, the union of the parts').
// A part none of whose situations could run, or a run with nothing in it, is not a pass: the gate refuses it (the summary's totals count every part).
//
// THE CERTIFICATE is each part's own go-live certificate (its template's report/certificate.ts, sealed by its run.ts), each from that part's own summary, in a folder of the
// part's name, and one list of the parts and the shop's own situations beside them (go-live-parts.json). Its totals are the sums. The settings' digest is one digest over the
// parts' own digests, in the shop's order.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KeyObject } from "node:crypto";
import type { ReportLanguage } from "../../../../modules/report/text.ts";
import type { HandCheckRun, SituationResult } from "../../../../modules/crash-test/situations.ts";
import { buildGoLiveCertificate as feesCertificate, summariseRun as feesSummary } from "../../../education/fees/report/certificate.ts";
import { policyDigest as feesDigest } from "../../../education/fees/report/data.ts";
import { writeGoLiveCertificate as feesWrite } from "../../../education/fees/report/run.ts";
import { buildGoLiveCertificate as ordersCertificate, summariseRun as ordersSummary } from "../../orders/report/certificate.ts";
import { policyDigest as ordersDigest } from "../../orders/report/data.ts";
import { writeGoLiveCertificate as ordersWrite } from "../../orders/report/run.ts";
import { buildGoLiveCertificate as stockCertificate, summariseRun as stockSummary } from "../../stock-orders/report/certificate.ts";
import { policyDigest as stockDigest } from "../../stock-orders/report/data.ts";
import { writeGoLiveCertificate as stockWrite } from "../../stock-orders/report/run.ts";
import type { PartName, Settings } from "../src/settings.ts";

type PartsFile = Record<string, unknown>;

/** What every part's template gives the papers. */
interface PartPapers {
  summariseRun(run: any): Summary;
  buildGoLiveCertificate(input: { settings: any; handCheck: any; issuedAt: number; preparedBy?: string }): { checks: { failed: number }; notTested: unknown[] };
  policyDigest(settings: any): string;
  writeGoLiveCertificate(run: { settings: any; handCheck: any; language: ReportLanguage; out: string; key?: KeyObject; preparedBy?: string; now: number }): { files: string[] };
}

const PAPERS: Record<PartName, PartPapers> = {
  fees: { summariseRun: feesSummary as never, buildGoLiveCertificate: feesCertificate as never, policyDigest: feesDigest, writeGoLiveCertificate: feesWrite as never },
  orders: { summariseRun: ordersSummary as never, buildGoLiveCertificate: ordersCertificate as never, policyDigest: ordersDigest, writeGoLiveCertificate: ordersWrite as never },
  "stock-orders": { summariseRun: stockSummary as never, buildGoLiveCertificate: stockCertificate as never, policyDigest: stockDigest, writeGoLiveCertificate: stockWrite as never },
};

/** A hand check's summary, as every template's summariseRun makes it, with the parts' own for a parts shop. */
export interface Summary { held: number; total: number; checks: number; failedTitles: string[]; ranOn?: string; notRun?: string[]; program?: { name: string; version: string; sha256: string }; parts?: { name: string; summary: Summary }[] }

/** A parts shop's run: the shop's own situations' and each part's, and all their results in one list (what the hand check's child counts). */
export interface PartsRun extends HandCheckRun<Settings> { shop: HandCheckRun<PartsFile>; parts: { name: PartName; run: HandCheckRun<any> }[] }

/** The run itself (crash-test/hand-check.ts), loaded only when asked. */
export const runOn = (settings: Settings): Promise<PartsRun> => import("../crash-test/hand-check.ts").then((m) => m.runOn(settings));

/** The shop's own situations, summed as every template sums its own. */
function summariseShop(results: readonly SituationResult[]): Summary {
  return { held: results.filter((r) => r.held).length, total: results.length, checks: results.reduce((n, r) => n + r.checks.length, 0), failedTitles: results.filter((r) => !r.held).map((r) => r.situation.title) };
}

/** The digest of the settings a parts shop's papers are about: one over its parts' own digests, in the shop's order. */
export function policyDigest(settings: Settings): string {
  const parts = settings.parts.map((p) => [p.name, PAPERS[p.name].policyDigest(p.settings)]);
  return createHash("sha256").update(JSON.stringify({ parts, carried: settings.carried ?? null })).digest("hex");
}

export function summariseRun(run: PartsRun): Summary {
  const shop = summariseShop(run.shop.results);
  const parts = run.parts.map((x) => ({ name: x.name, summary: PAPERS[x.name].summariseRun(x.run) }));
  const all = [shop, ...parts.map((x) => x.summary)];
  const notRun = [...run.shop.skipped.map((s) => s.title), ...run.parts.flatMap((x) => (x.run.results.length === 0 ? [`${x.name}: no situation of this part could run`] : []).concat(x.run.skipped.map((s) => `${x.name}: ${s.title}`)))];
  // a part none of whose situations ran is not a pass: it counts as one situation that did not hold
  const empty = run.parts.filter((x) => x.run.results.length === 0).map((x) => x.name);
  return {
    held: all.reduce((n, s) => n + s.held, 0), total: all.reduce((n, s) => n + s.total, 0) + empty.length, checks: all.reduce((n, s) => n + s.checks, 0),
    failedTitles: [...all.flatMap((s) => s.failedTitles), ...empty.map((n) => `${n}: no situation of this part could run`)],
    ranOn: policyDigest(run.settings), ...(notRun.length > 0 ? { notRun } : {}), ...(run.program ? { program: run.program } : {}), parts,
  };
}

/** The certificate's facts: each part's own certificate from its own summary, and the sums. */
export function buildGoLiveCertificate(input: { settings: Settings; handCheck: Summary; issuedAt: number; preparedBy?: string }): { checks: { held: number; total: number; failed: number }; notTested: unknown[]; parts: { name: string; certificate: unknown }[] } {
  const parts = input.settings.parts.map((p) => {
    const summary = input.handCheck.parts?.find((x) => x.name === p.name)?.summary ?? { held: 0, total: 0, checks: 0, failedTitles: [] };
    return { name: p.name, certificate: PAPERS[p.name].buildGoLiveCertificate({ settings: p.settings, handCheck: summary, issuedAt: input.issuedAt, ...(input.preparedBy ? { preparedBy: input.preparedBy } : {}) }) as { checks: { failed: number }; notTested: unknown[] } };
  });
  return { checks: { held: input.handCheck.held, total: input.handCheck.total, failed: input.handCheck.total - input.handCheck.held }, notTested: parts.flatMap((p) => p.certificate.notTested), parts };
}

/** Each part's certificate, sealed by its own template, in a folder of the part's name, and the list of the parts beside them. */
export function writeGoLiveCertificate(run: { settings: Settings; handCheck: Summary; language: ReportLanguage; out: string; key?: KeyObject; preparedBy?: string; now: number }): { files: string[] } {
  const files: string[] = [];
  for (const p of run.settings.parts) {
    const summary = run.handCheck.parts?.find((x) => x.name === p.name)?.summary ?? { held: 0, total: 0, checks: 0, failedTitles: [] };
    const out = join(run.out, p.name);
    mkdirSync(out, { recursive: true });
    files.push(...PAPERS[p.name].writeGoLiveCertificate({ settings: p.settings, handCheck: summary, language: run.language, out, ...(run.key ? { key: run.key } : {}), ...(run.preparedBy ? { preparedBy: run.preparedBy } : {}), now: run.now }).files);
  }
  const list = join(run.out, "go-live-parts.json");
  mkdirSync(run.out, { recursive: true });
  const shop = { held: run.handCheck.held - (run.handCheck.parts ?? []).reduce((n, x) => n + x.summary.held, 0), total: run.handCheck.total - (run.handCheck.parts ?? []).reduce((n, x) => n + x.summary.total, 0) };
  writeFileSync(list, `${JSON.stringify({ format: "geometer-go-live-parts/1", shop: run.settings.name, parts: run.settings.parts.map((p) => p.name), shopSituations: shop, program: run.handCheck.program ?? null, issuedAt: new Date(run.now).toISOString() }, null, 1)}\n`);
  files.push(list);
  return { files };
}
