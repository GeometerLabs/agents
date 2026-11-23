// The hand check: run every crash-test situation against the in-memory stand-ins and say plainly what held, what failed and what was not tested.
// Run it from anywhere: node templates/commerce/stock-orders/scripts/hand-check.ts
// It runs on Glow Unisex Salon's example settings, or on any shop's own: add --settings <file>. A situation that a shop's settings cannot express (no paused supplier to
// try, no item that comes in two units) is not run and is named, so the count never includes it. "--details" shows what was done in each situation.
// The deploy bundle can read this output ("Held N of M" and the tick and cross lines); their shape is shared (modules/crash-test/print.ts).
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { handCheckText } from "../../../../modules/crash-test/print.ts";
import { LANGUAGES, LANGUAGE_NAMES } from "../../../../modules/language/languages.ts";
import { HAND_RUN, STAND_IN_SERVICES, notTestedOf } from "../crash-test/not-tested.ts";
import { runOn } from "../crash-test/situations.ts";
import { glowSalon } from "../src/harness.ts";
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

const languageList = (languages: readonly string[]): string => {
  const names = languages.map((l) => LANGUAGE_NAMES[l as keyof typeof LANGUAGE_NAMES]);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs({ args: process.argv.slice(2), options: { settings: { type: "string" }, details: { type: "boolean" }, all: { type: "boolean" } } });
  } catch (e) { throw new Error(`${(e as Error).message}\nSee the first lines of templates/commerce/stock-orders/scripts/hand-check.ts for the options.`); }
  const showAll = args.values.details === true || args.values.all === true;
  const settings = args.values.settings ? readSettings(args.values.settings) : glowSalon();
  const started = performance.now();
  const { results, skipped, program } = await runOn(settings); // each situation on the shop's own Go program (crash-test/go-world.ts)
  if (results.length === 0) throw new Error(`No situation could be run on these settings: ${skipped.map((s) => s.reason).join(" ")}`);
  const tookMs = Math.round(performance.now() - started);
  const names = languageList(LANGUAGES.filter((l) => settings.languages.includes(l)));
  const out = handCheckText({
    results, skipped, showAll, tookMs,
    text: {
      heading: [
        "Stand-ins, not the Geometer engine. Hand-run check for the Stock orders template.",
        "",
        `CRASH TEST   ${settings.name} · Stock orders · ${names.replace(/, | and /g, " + ")}   (${STAND_IN_SERVICES}, ${HAND_RUN})`,
        `ON THE SHOP'S OWN PROGRAM   Go ${program?.name ?? "?"} ${program?.version ?? ""} · sha256:${program?.sha256.slice(0, 16) ?? "?"}`,
      ],
      workDone: ({ situations, checks, tookMs: ms }) => [
        `  Work done for you: ${situations} situations and ${checks} checks in ${ms} ms, against a stand-in WhatsApp: an order message whose reply`,
        "  is lost, a supplier who never answers, two orders racing for the last of the budget, a quantity or a price changed after the card, a",
        `  supplier not on the list, a number with no unit, a wrong item, and an OK from the wrong person, in ${names}.`,
      ],
      shopName: settings.name,
      judged: (checks) => [
        "  Each situation was judged from the stand-ins' own records (what the WhatsApp outbox, the orders and the action record hold),",
        `  never from what the agent said. ${checks} checks in all.`,
      ],
      notTested: notTestedOf(settings).map((n) => n.text),
    },
  });
  console.log(out.text);
  return out.failed === 0 ? 0 : 1;
}

try { process.exitCode = await main(); } catch (e) { console.error((e as Error).message); process.exitCode = 2; }
