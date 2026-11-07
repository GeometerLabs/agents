// The hand check: run every crash-test situation against the in-memory fakes and say plainly what held, what failed
// and what was not tested. Run it from anywhere: node templates/commerce/bookings/scripts/hand-check.ts
// It runs on Glow Salon's example settings, or on any shop's own: add --settings <file>. A situation that a shop's settings
// cannot express (a shop with no cancellation window has nothing to be "late" for) is not run and is named, so the count
// never includes it.
// It reads in three layers: the result line and the work done by default, and "--details" (or --all) shows what was
// done in each situation: how the stand-ins made it go wrong, and every check read from their records.
import { parseArgs } from "node:util";
import { HAND_RUN, STAND_IN_SERVICES, notTestedOf } from "../crash-test/not-tested.ts";
import { languageList } from "../crash-test/says.ts";
import { runOn } from "../crash-test/situations.ts";
import { handCheckText } from "../../../../modules/crash-test/print.ts";
import { UsageError, main, readSettings } from "../report/cli.ts";
import { glowSalon } from "../src/harness.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";

await main(async () => {
  let args;
  try {
    args = parseArgs({ args: process.argv.slice(2), options: { settings: { type: "string" }, details: { type: "boolean" }, all: { type: "boolean" } } });
  } catch (e) { throw new UsageError(`${(e as Error).message}\nSee the first lines of templates/commerce/bookings/scripts/hand-check.ts for the options.`); }
  const showAll = args.values.details === true || args.values.all === true;
  const settings = args.values.settings ? readSettings(args.values.settings) : glowSalon();
  const started = performance.now();
  const { results, skipped } = await runOn(settings);
  if (results.length === 0) throw new Error(`No situation could be run on these settings: ${skipped.map((s) => s.reason).join(" ")}`);
  const tookMs = Math.round(performance.now() - started);
  const speaks = LANGUAGES.filter((l) => settings.languages.includes(l));
  const names = languageList(speaks);
  const out = handCheckText({
    results, skipped, showAll, tookMs,
    text: {
      heading: [
        "Stand-ins, not the Geometer engine. Hand-run check for the Phase 0 prototype.",
        "",
        `CRASH TEST   ${settings.name} · Bookings · ${names.replace(/, | and /g, " + ")}   (${STAND_IN_SERVICES}, ${HAND_RUN})`,
      ],
      workDone: ({ situations, checks, tookMs: ms }) => [
        `  Work done for you: ${situations} situations and ${checks} checks in ${ms} ms, against stand-in WhatsApp,`,
        "  calendar and payments: lost replies, duplicate messages and payments, silent calendar failures, late payments,",
        `  an expired key, and customers haggling or trying to trick the agent in ${names}.`,
      ],
      shopName: settings.name,
      judged: (checks) => [
        `  Each situation was judged from the fakes' own records (what the calendar, the payments service and the`,
        `  WhatsApp outbox hold), never from what the agent said. ${checks} checks in all.`,
      ],
      notTested: notTestedOf(settings).map((n) => n.text),
    },
  });
  console.log(out.text);
  return out.failed === 0 ? 0 : 1;
});
