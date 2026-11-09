// The hand check: run every crash-test situation against the in-memory stand-ins and say plainly what held, what failed and what was not tested.
// Run it from anywhere: node templates/commerce/orders/scripts/hand-check.ts
// It runs on Annapurna Tiffins' example settings (UPI), or on any shop's own: add --settings <file>. A situation that a shop's settings cannot express (a shop that does not
// deliver has no address outside its area) is not run and is named, so the count never includes it.
// It reads in three layers: the result line and the work done by default, and "--details" (or --all) shows what was done in each situation: how the stand-ins made it go
// wrong, and every check read from their records.
// The deploy bundle reads this output (bundle/handcheck.ts): "Held N of M" and the tick and cross lines. Their shape is shared (modules/crash-test/print.ts).
import { capabilitiesOf } from "../../../../modules/payments/providers/index.ts";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { handCheckText } from "../../../../modules/crash-test/print.ts";
import { LANGUAGES, LANGUAGE_NAMES } from "../../../../modules/language/languages.ts";
import { HAND_RUN, STAND_IN_SERVICES, notTestedOf } from "../crash-test/not-tested.ts";
import { runOn } from "../crash-test/situations.ts";
import { annapurna } from "../src/harness.ts";
import { validateSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";

function readSettings(path: string): Settings {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { throw new Error(`I could not read ${path}.`); }
  let json: unknown;
  try { json = JSON.parse(text); } catch (e) { throw new Error(`${path} is not valid JSON (${(e as Error).message}).`); }
  const result = validateSettings(json);
  if (!result.ok) throw new Error(`${path} needs fixing:\n- ${result.errors.join("\n- ")}`);
  return result.settings;
}

/** "English, Hindi and Malayalam". */
const languageList = (languages: readonly string[]): string => {
  const names = languages.map((l) => LANGUAGE_NAMES[l as keyof typeof LANGUAGE_NAMES]);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs({ args: process.argv.slice(2), options: { settings: { type: "string" }, details: { type: "boolean" }, all: { type: "boolean" } } });
  } catch (e) { throw new Error(`${(e as Error).message}\nSee the first lines of templates/commerce/orders/scripts/hand-check.ts for the options.`); }
  const showAll = args.values.details === true || args.values.all === true;
  const settings = args.values.settings ? readSettings(args.values.settings) : annapurna();
  const started = performance.now();
  const { results, skipped } = await runOn(settings);
  if (results.length === 0) throw new Error(`No situation could be run on these settings: ${skipped.map((s) => s.reason).join(" ")}`);
  const tookMs = Math.round(performance.now() - started);
  const names = languageList(LANGUAGES.filter((l) => settings.languages.includes(l)));
  const upi = !capabilitiesOf(settings.payment).confirmsAutomatically; // the owner marks payments (UPI): their marks are the payment record
  const out = handCheckText({
    results, skipped, showAll, tookMs,
    text: {
      heading: [
        "Stand-ins, not the Geometer engine. Hand-run check for the Orders template.",
        "",
        `CRASH TEST   ${settings.name} · Orders · ${names.replace(/, | and /g, " + ")}   (${STAND_IN_SERVICES}, ${HAND_RUN})`,
      ],
      workDone: ({ situations, checks, tookMs: ms }) => upi ? [
        `  Work done for you: ${situations} situations and ${checks} checks in ${ms} ms, against stand-in WhatsApp, with UPI marked`,
        "  paid by the owner: orders beyond the stock and the day's limit, after the cut-off, a screenshot sent as proof, a payment twice or late,",
        `  a cancellation inside and outside the window, an address outside the delivery area, and a refund the owner owes, in ${names}.`,
      ] : [
        `  Work done for you: ${situations} situations and ${checks} checks in ${ms} ms, against stand-in WhatsApp and`,
        "  payments: orders beyond the stock and the day's limit, after the cut-off, lost replies, a payment twice or late, a cancellation inside",
        `  and outside the window, a refund above the limit, an address outside the delivery area, and customers pushing on the price in ${names}.`,
      ],
      shopName: settings.name,
      judged: (checks) => [
        "  Each situation was judged from the fakes' own records (what the payments service, Guard's model, the owner's marks and the",
        `  WhatsApp outbox hold), never from what the agent said. ${checks} checks in all.`,
      ],
      notTested: notTestedOf(settings).map((n) => n.text),
    },
  });
  console.log(out.text);
  return out.failed === 0 ? 0 : 1;
}

try { process.exitCode = await main(); } catch (e) { console.error((e as Error).message); process.exitCode = 2; }
