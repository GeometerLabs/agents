// The hand check of a shop of several parts (decision 65): the shop's own situations (the router, the one question, one owner's page, one stock count), then every part's own
// situations, all on the shop's own Go program (go/cmd/parts), and it says plainly what held and what failed, part by part.
// Run it from anywhere: node templates/commerce/parts/scripts/hand-check.ts   (the starter shop: the credit book, Stock orders and the pickup hold)
// On any parts shop's own settings: add --settings <file>. "--details" shows what was done in each situation. The output's shape ("Held N of M", the tick and cross lines) is
// every template's (modules/crash-test/print.ts), so the deploy bundle reads it the same way.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { handCheckText } from "../../../../modules/crash-test/print.ts";
import { runOn } from "../crash-test/hand-check.ts";
import { validateSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";

function readSettings(path: string): Settings {
  let json: unknown;
  try { json = JSON.parse(readFileSync(path, "utf8")); } catch (e) { throw new Error(`I could not read ${path} as JSON (${(e as Error).message}).`); }
  const result = validateSettings(json);
  if (!result.ok) throw new Error(`${path} needs fixing:\n- ${result.errors.join("\n- ")}`);
  return result.settings;
}

async function main(): Promise<number> {
  const args = parseArgs({ args: process.argv.slice(2), options: { settings: { type: "string" }, details: { type: "boolean" } } });
  const settings = readSettings(args.values.settings ?? new URL("../settings/ganesh-electricals-starter.example.json", import.meta.url).pathname);
  const started = performance.now();
  const run = await runOn(settings);
  if (run.results.length === 0) throw new Error(`No situation could be run on these settings: ${run.skipped.map((s) => s.reason).join(" ")}`);
  const parts = run.parts.map((p) => `${p.name} ${p.run.results.filter((r) => r.held).length} of ${p.run.results.length}`).join(" · ");
  const shop = `${run.shop.results.filter((r) => r.held).length} of ${run.shop.results.length}`;
  const out = handCheckText({
    results: run.results, skipped: run.skipped, showAll: args.values.details === true, tookMs: Math.round(performance.now() - started),
    text: {
      heading: [
        "Stand-ins, not the Geometer engine. Hand-run check for a shop of several parts.",
        "",
        `CRASH TEST   ${settings.name} · ${settings.parts.map((p) => p.name).join(" + ")}`,
        `ON THE SHOP'S OWN PROGRAM   Go ${run.program?.name ?? "?"} ${run.program?.version ?? ""} · sha256:${run.program?.sha256.slice(0, 16) ?? "?"}`,
        `BY PART   the shop's own ${shop} · ${parts}`,
      ],
      workDone: (c) => [`  ${c.situations} situations, ${c.checks} checks, in ${(c.tookMs / 1000).toFixed(1)} s: the shop's own, then each part's own on its settings in this shop, all on one program.`],
      shopName: settings.name,
      judged: (n) => [`  Judged from the stand-in WhatsApp's outbox and the shop's own record and saved state (${n} checks), never from what the program said it did.`],
      notTested: ["each part's own list of what its hand check does not test (its template's)", "the real WhatsApp provider", "a real customer"],
    },
  });
  console.log(out.text);
  return out.failed === 0 ? 0 : 1;
}

main().then((code) => process.exit(code), (e: Error) => { console.error(e.message); process.exit(2); });
