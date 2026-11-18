// `geometer shop budget <shop> ...`: the server admin's way to give ONE shop a model budget different from its plan's (owner, 19 Nov 2026: "a busy Basic shop"). It shows the plan's
// numbers, writes or removes shops/<shop>/budget-override.json (lib/budget-override.ts has the format and the checks), and says what happens next in plain words. Nothing here
// restarts a shop or runs a deploy: the deployer's next pass sees the budget changed (it is part of what a shop is asked to be, deploy.ts desiredOf) and redeploys that shop.
//
// It is a command line command and nothing else on purpose: on Geometer's own Operator server Geometer pays for the model, so an Operator must never be able to raise a budget,
// and the panel has no route that writes this file.
//
//   shop budget <shop>                                              the plan's numbers, the override if any, and the result
//   shop budget <shop> --monthly-inr N --reason "..." --set-by NAME [--daily feature=N ...]    set (or replace) the override; features: owner_talk, customer_talk, listing_draft, router
//   shop budget <shop> --clear                                      remove the override: the plan's numbers hold again
import { existsSync } from "node:fs";
import { SHOP_FEATURES, clearOverride, parseOverride, readOverride, writeOverride } from "./lib/budget-override.ts";
import { readAnswerFile } from "./lib/fleet.ts";
import { fleetIdOf, loadServer, readShop, serverPaths } from "./lib/server.ts";
import { shopNameProblem } from "./lib/util.ts";
import { latestPriceList } from "./panel/cost.ts";
import type { BudgetConfig } from "../modules/budget/budget.ts";

export interface BudgetFlags {
  monthlyInr?: string;
  reason?: string;
  setBy?: string;
  /** Each `--daily feature=N`, as typed. */
  daily?: string[];
  clear?: boolean;
}

const rupees = (micro: number): string => `INR ${micro / 1_000_000}`;

/** The numbers of one budget as plain lines. */
function lines(b: BudgetConfig): string[] {
  return [`  a month: ${rupees(b.monthlyMicroInr)}`, ...Object.entries(b.daily).map(([f, n]) => `  ${f} a day: ${n}`)];
}

/** Parse `--daily owner_talk=50` (repeated; a comma list also works). Plain-word errors; never a guess. */
function parseDaily(items: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items.flatMap((i) => i.split(",")).map((i) => i.trim()).filter((i) => i !== "")) {
    const m = /^([a-z_]+)=(\d+)$/u.exec(item);
    if (!m) throw new Error(`"${item}" is not a daily cap. Write it like --daily owner_talk=50 (a feature, an equals sign and a whole number). Features: ${SHOP_FEATURES.join(", ")}.`);
    out[m[1]] = Number(m[2]);
  }
  return out;
}

export function budgetCommand(dir: string, shop: string | undefined, flags: BudgetFlags, io: { log: (line: string) => void; now: () => Date; priceList?: () => ReturnType<typeof latestPriceList> }): number {
  const problem = shop === undefined ? "Say which shop: geometer shop budget <shop> [--monthly-inr N --reason \"...\" --set-by NAME [--daily feature=N ...] | --clear]" : shopNameProblem(shop);
  if (problem || shop === undefined) throw new Error(problem as string);
  const folder = serverPaths(dir).shop(shop);
  if (!existsSync(folder)) throw new Error(`There is no shop called ${shop} on this server.`);

  const setting = flags.monthlyInr !== undefined || flags.reason !== undefined || flags.setBy !== undefined || (flags.daily?.length ?? 0) > 0;
  if (flags.clear && setting) throw new Error("Use --clear on its own, or the numbers to set; not both.");

  if (flags.clear) {
    io.log(clearOverride(folder) ? `${shop} is back on its plan's model budget. The deployer applies it on its next pass (or run: geometer deploy ${shop}).` : `${shop} had no budget of its own; its plan's numbers hold.`);
    return 0;
  }

  if (setting) {
    if (flags.monthlyInr === undefined) throw new Error("Say the month's budget in whole rupees: --monthly-inr 40.");
    if (flags.reason === undefined) throw new Error('Say why, in one line: --reason "busy shop, owner asked".');
    if (flags.setBy === undefined) throw new Error("Say who is setting it: --set-by NAME.");
    if (!/^\d+$/u.test(flags.monthlyInr)) throw new Error(`--monthly-inr is a whole number of rupees, like 40 (you wrote "${flags.monthlyInr}").`);
    const daily = parseDaily(flags.daily ?? []);
    const wanted = { monthlyInr: Number(flags.monthlyInr), ...(Object.keys(daily).length > 0 ? { daily } : {}), reason: flags.reason, setBy: flags.setBy, date: io.now().toISOString().slice(0, 10) };
    const checked = parseOverride(wanted);
    if (!checked.ok) throw new Error(`That budget cannot be set:\n- ${checked.errors.join("\n- ")}`);
    writeOverride(folder, checked.override);
    io.log(`${shop} now has a model budget of its own: ${rupees(checked.override.monthlyInr * 1_000_000)} a month${checked.override.daily ? `, and daily caps ${Object.entries(checked.override.daily).map(([f, n]) => `${f} ${n}`).join(", ")}` : ""}. Everything it does not name stays the plan's.`);
    io.log(`The deployer applies it on its next pass (or run: geometer deploy ${shop}). The shop's Operator sees it in the panel, read-only.`);
    // Fleet's wall is separate: a budget above what fleet allows this shop is stopped by fleet, so say so while the admin is here (one sentence, with the command).
    const wall = fleetWallMicro(dir, shop, io.priceList);
    if (wall !== undefined && checked.override.monthlyInr * 1_000_000 > wall) {
      let deployment = "<this server's id>";
      try { deployment = fleetIdOf(loadServer(dir)); } catch { /* the placeholder stands */ }
      io.log(`Fleet stops this shop's model spend at ${rupees(wall)} a month (its plan's cap), so fleet's cap for this shop must be raised too, or it will switch the model off first: node apps/fleet/main.ts shop ai-cap ${deployment} ${shop} --monthly-inr ${checked.override.monthlyInr} --reason "${checked.override.reason.replace(/"/gu, "'")}"`);
    }
    return 0;
  }

  // show: the plan's numbers, the override, and the result
  const f = readShop(dir, shop, io.now());
  const { override, problem: bad } = readOverride(folder);
  const plan = f.planBudget ?? f.budget;
  const extra = f.boughtThisMonth ? ` (with the ${f.boughtThisMonth} extra messages bought this month)` : "";
  io.log(plan ? `${shop}: the plan's model budget${extra}:` : `${shop}: the price list in force gives this shop no model budget (it has no plan from fleet yet, or the list has none).`);
  if (plan) lines(plan).forEach(io.log);
  if (override) io.log(`Its own budget, set by ${override.setBy} on ${override.date}: ${override.reason}\n${lines({ monthlyMicroInr: override.monthlyInr * 1_000_000, daily: override.daily ?? {} }).join("\n")}`);
  else if (bad) io.log(`Its own budget file cannot be used: ${bad}`);
  else io.log("It has no budget of its own.");
  if (f.budget && override) { io.log("The result, which the shop runs on:"); lines(f.budget).forEach(io.log); }
  return 0;
}

/**
 * What fleet's cap allows this shop a month, in micro-rupees: `ai.cap` x (the plan's allowance + the extra messages bought) / 1,000, from fleet's last answer file and the list in force
 * (the same rule as apps/fleet/src/aicap.ts). Undefined when fleet has said nothing about the shop's plan or the list has no `ai.cap`: then nothing is claimed.
 */
function fleetWallMicro(dir: string, shop: string, priceList: () => ReturnType<typeof latestPriceList> = latestPriceList): number | undefined {
  const answer = readAnswerFile(serverPaths(dir).fleetAnswer(shop));
  if (!answer || answer.plan === null || answer.allowance === null) return undefined;
  let rate: number | undefined;
  try { rate = priceList().rates["ai.cap"]?.micro; } catch { return undefined; }
  if (rate === undefined) return undefined;
  return Math.ceil((rate * (answer.allowance + (answer.bought ?? 0))) / 1000);
}

