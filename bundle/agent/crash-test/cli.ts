// The command line of the agent crash test:
//   geometer agent crash-test <name> [--situations a,b] [--run "<command>"] [--version V] [--guard-bin PATH] [--details] [--json]
//   geometer agent go-live <name> [--out <folder>] [--run ...] [--version V] [--guard-bin PATH]      the crash test, and the go-live certificate from it
//   geometer agent set <name> [--run "<command>"] [--version V]                                       record how to start the agent and which version it is at
import { resolve } from "node:path";
import type { Context } from "../../deploy.ts";
import { setAgent } from "../folder.ts";
import { crashTestText, planCrashTest, runCrashTest } from "./run.ts";
import type { CrashOptions } from "./run.ts";
import { issueGoLive, recordService } from "./golive.ts";

type Values = Record<string, string | boolean | undefined>;

export const CRASH_SUBCOMMANDS = ["crash-test", "go-live", "set"] as const;

function optionsOf(values: Values, progress: boolean): CrashOptions {
  const str = (k: string) => (typeof values[k] === "string" ? values[k] as string : undefined);
  const situations = str("situations")?.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    ...(situations && situations.length > 0 ? { situations } : {}), ...(str("run") ? { run: str("run") } : {}), ...(str("version") ? { version: str("version") } : {}),
    ...(str("guard-bin") ? { guardBin: resolve(str("guard-bin")!) } : {}),
    // progress goes to the error stream, so that what is on the output stream is the result alone (and, with --json, only JSON)
    ...(progress ? { progress: (line: string) => console.error(line) } : {}),
  };
}

/** `agent crash-test|go-live|set <name>`. Returns the exit code: 0 when every situation that ran held (and at least one ran), 1 otherwise. */
export async function crashCommand(ctx: Context, sub: (typeof CRASH_SUBCOMMANDS)[number], name: string, values: Values): Promise<number> {
  const str = (k: string) => (typeof values[k] === "string" ? values[k] as string : undefined);

  if (sub === "set") {
    if (str("run") === undefined && str("version") === undefined) throw new Error(`Say what to record: agent set ${name} --run "<the command that starts your agent>" and/or --version <the version it is at>. In the command, {version} stands for the version.`);
    const folder = setAgent(ctx.dir, name, { run: str("run"), version: str("version") });
    console.log(`${name}: ${folder.agent?.run ? `starts with: ${folder.agent.run}` : "no command to start it yet"}; version ${folder.agent?.version ?? "not set"}. The Guards are not touched: this is only what the crash test and \`geometer update\` use.`);
    return 0;
  }

  if (sub === "go-live" && str("situations") !== undefined) throw new Error("A go-live certificate counts all the situations, so --situations is for `agent crash-test` only.");
  const planned = await planCrashTest(ctx, name, optionsOf(values, false));
  const o = optionsOf(values, true);
  const result = await runCrashTest(planned.plan, o);

  if (values.json === true) {
    console.log(JSON.stringify(result));
    return result.total > 0 && result.failed === 0 ? 0 : 1;
  }
  const out = crashTestText(result, planned.plan.settings.name, { showAll: values.details === true });
  console.log(out.text);
  if (sub === "crash-test") return result.total > 0 && out.failed === 0 ? 0 : 1;

  // go-live: the certificate is written whatever the result (it says what did not hold), and the version is recorded as "in service" only when everything held
  if (result.total === 0) throw new Error("No situation could be run, so there is nothing to put in a certificate. The reasons are above.");
  const extra = str("out") ? resolve(str("out")!) : undefined;
  const issued = issueGoLive(ctx, name, result, extra);
  console.log(`\n${issued.signed ? "Signed with this server's key." : "NOT signed: this server has no signing key (secrets/panel/signing_key), so the monthly report will read this certificate as untrusted. It carries a digest and a code."}`);
  console.log(`Wrote ${issued.files.length} files:\n${issued.files.map((f) => `  ${f}`).join("\n")}\n\nCode ${issued.code}.\n\n${issued.text}`);
  if (result.failed === 0) {
    recordService(ctx, name, result, issued.code);
    console.log(`\n${name} at ${result.version ?? "its current version"} is recorded as the version in service. \`geometer update\` compares the next version with it.`);
    return 0;
  }
  console.log(`\n${result.failed} situation(s) did not hold. The certificate says so. ${name} is not recorded as in service.`);
  return 1;
}
