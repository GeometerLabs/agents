// The hand check of a shop of several parts (decision 65): its own situations, then every part's own, all on the shop's own Go program (report/papers.ts says what is run and
// how it is counted). Loaded only by the hand check's child process (bundle/lib/hand-check-go.ts through KINDS.parts.papers.runOn).
import { goWorldPart } from "../../../../modules/crash-test/go-world.ts";
import type { HandCheckRun, SituationResult } from "../../../../modules/crash-test/situations.ts";
import { goProgram, servedVersions } from "../../../../modules/crash-test/programs.ts";
import { serveHandlers } from "../../../../modules/standins/http.ts";
import { approveTemplates, whatsappStandin } from "../../../../modules/standins/whatsapp.ts";
import type { TemplateCatalogue } from "../../../../modules/standins/whatsapp.ts";
import { PROGRAM, VERSION } from "./go-world.ts";
import type { PartsFile } from "./go-world.ts";
import { runOn as runShop } from "./situations.ts";
import { partsMetaTemplates } from "../src/whatsapp.ts";
import { asParts } from "../src/settings.ts";
import type { PartName, Settings } from "../src/settings.ts";
import type { PartsRun } from "../report/papers.ts";

/** Each part's own situations (its template's crash-test runOn). */
const RUN: Record<PartName, (settings: any) => Promise<HandCheckRun<any>>> = {
  fees: (s) => import("../../../education/fees/crash-test/situations.ts").then((m) => m.runOn(s)),
  orders: (s) => import("../../orders/crash-test/situations.ts").then((m) => m.runOn(s)),
  "stock-orders": (s) => import("../../stock-orders/crash-test/situations.ts").then((m) => m.runOn(s)),
};

/** The shop's settings file with one part's block made from that part's own (the situation's) settings: the shop's order, the shop's top, the situation's top keys. */
function wrapInto(shop: Settings, part: PartName, own: Record<string, unknown>): Record<string, unknown> {
  const others: Record<string, Record<string, unknown>> = {};
  const order = Object.keys(shop.file.parts as Record<string, unknown>);
  for (const n of order) if (n !== part) others[n] = (shop.file.parts as Record<string, Record<string, unknown>>)[n];
  const made = asParts(part, own, { others });
  // back into the shop's order
  const blocks = made.parts as Record<string, unknown>;
  const parts: Record<string, unknown> = {};
  for (const n of order) parts[n] = blocks[n];
  return { ...made, ...(shop.carried ? { carried: shop.carried } : {}), parts };
}

/** A part's saved state as its template's codec reads it: its members, with the shop's shared assistant and AI counts. */
function unwrap(part: string, snapshot: string): string {
  const all = JSON.parse(snapshot) as Record<string, unknown>;
  const own = ((all.parts ?? {}) as Record<string, Record<string, unknown>>)[part] ?? {};
  return JSON.stringify({ format: all.format, ...own, ...(all.assistant !== undefined ? { assistant: all.assistant } : {}), ...(all.ai !== undefined ? { ai: all.ai } : {}) });
}

/** Run the shop's own situations, then every part's, each on the parts program. */
export async function runOn(settings: Settings): Promise<PartsRun> {
  const names = settings.parts.map((p) => p.name);
  const shop = await runShop(settings.file as PartsFile);
  const catalogue = { templates: partsMetaTemplates(names, { assistant: settings.assistant !== undefined }) } as TemplateCatalogue;
  const parts: { name: PartName; run: HandCheckRun<any> }[] = [];
  const program = goProgram(PROGRAM);
  for (const p of settings.parts) {
    goWorldPart.current = {
      part: p.name, program: PROGRAM, version: VERSION, wrap: (file) => wrapInto(settings, p.name, file), unwrap: (text) => unwrap(p.name, text),
      standins: async (_clock, fakes) => { approveTemplates(fakes.messaging, catalogue); return serveHandlers([whatsappStandin(fakes.messaging, catalogue, { phoneNumberId: "100000000000001" })]); },
    };
    try {
      const run = await RUN[p.name](p.settings);
      // the part ran on the shop's program, not on its template's own: the run names the program it really ran on
      parts.push({ name: p.name, run: { ...run, ...(program.ok && run.results.length > 0 ? { program: { name: PROGRAM, version: servedVersions.get(PROGRAM) ?? VERSION, sha256: program.sha256 } } : {}) } });
    } finally {
      goWorldPart.current = undefined;
    }
  }
  const results: SituationResult[] = [...shop.results, ...parts.flatMap((x) => x.run.results)];
  const skipped = [...shop.skipped, ...parts.flatMap((x) => x.run.skipped.map((s) => ({ ...s, title: `${x.name}: ${s.title}` })))];
  return { results, skipped, settings, ...(shop.program ? { program: shop.program } : {}), shop, parts };
}

