// The rules that refuse a bad deploy, after the specs are generated and compiled. (The rules about the shop's own files, such as the
// runtime's timeout being longer than Guard's, are in shop.ts, next to the numbers they check.) Each one returns problems that name the rule.
import type { Problem } from "../lib/util.ts";
import type { GuardPlan } from "./shop.ts";
import type { CompileResult, TripwireResult } from "./verify.ts";

/** The tool name appears in the spec, in guard.toml and in the compiled bundle. All three must be the one name, or Guard protects nothing. */
export function toolNamesMatch(plan: GuardPlan, toml: string, compiled?: CompileResult): Problem[] {
  const problems: Problem[] = [];
  const inToml = /^tool\s*=\s*"([^"]*)"/mu.exec(toml)?.[1];
  const tenantInToml = /^tenant\s*=\s*"([^"]*)"/mu.exec(toml)?.[1];
  const where = `${plan.service}`;
  if (plan.spec.tool !== plan.def.tool) problems.push({ rule: "tool-names-match", message: `${where}: the spec says tool "${String(plan.spec.tool)}" but the Guard is for "${plan.def.tool}".` });
  if (inToml !== plan.def.tool) problems.push({ rule: "tool-names-match", message: `${where}: guard.toml says tool "${String(inToml)}" but the Guard is for "${plan.def.tool}".` });
  if (tenantInToml !== plan.spec.tenant) problems.push({ rule: "tool-names-match", message: `${where}: guard.toml says tenant "${String(tenantInToml)}" but the spec is for "${String(plan.spec.tenant)}".` });
  if (compiled && compiled.tool !== plan.def.tool) problems.push({ rule: "tool-names-match", message: `${where}: the compiled bundle is for tool "${compiled.tool}", not "${plan.def.tool}".` });
  if (compiled && compiled.tenant !== plan.tenant) problems.push({ rule: "tool-names-match", message: `${where}: the compiled bundle is for tenant "${compiled.tenant}", not "${plan.tenant}".` });
  return problems;
}

/** Shapes of things that must never be written into a generated file, whatever their name. */
const SECRET_SHAPES: [string, RegExp][] = [
  ["a Guard token (gg_...)", /\bgg_[0-9a-f]{32}\b/u],
  ["a Razorpay key (rzp_...)", /\brzp_(?:live|test)_[A-Za-z0-9]{8,}/u],
  ["a Basic credential", /\bBasic\s+[A-Za-z0-9+/=]{16,}/u],
  ["a Bearer credential", /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/u],
  ["a Meta access token (EAA...)", /\bEAA[A-Za-z0-9]{20,}/u],
  ["an API key (sk-...)", /\bsk-[A-Za-z0-9_-]{16,}/u],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/u],
  ["a service-account private key", /"private_key"\s*:/u],
];

/**
 * No secret appears in any generated file. Two checks: the literal value of every secret the bundle knows (the minted tokens and what was
 * handed in), and the shapes above. `files` maps a path to its text. A file that is meant to hold secrets is not given to this.
 */
export function noSecretsIn(files: Record<string, string>, secretValues: string[]): Problem[] {
  const problems: Problem[] = [];
  const secrets = secretValues.filter((s) => s.length >= 8);
  for (const [path, text] of Object.entries(files)) {
    for (const s of secrets) if (text.includes(s)) problems.push({ rule: "no-secret-in-files", message: `${path} contains a secret value (${s.slice(0, 2)}${"*".repeat(6)}). Secrets are files under secrets/, never part of a generated file.` });
    for (const [what, shape] of SECRET_SHAPES) if (shape.test(text)) problems.push({ rule: "no-secret-in-files", message: `${path} contains something shaped like ${what}.` });
  }
  return problems;
}

/** Every tripwire must pass. One that would have been allowed names the rule that does not hold. */
export function tripwiresHold(plan: GuardPlan, result: TripwireResult): Problem[] {
  if (result.ok) return [];
  if (result.failedRules.length > 0) return result.failedRules.map((rule) => ({ rule: `tripwire:${rule}`, message: `${plan.service}: the rule "${rule}" would let a forbidden call through (${result.passed} of ${result.of} tripwires passed). Nothing was started.` }));
  return [{ rule: "tripwire", message: `${plan.service}: geo-guard verify-bundle refused this setup: ${result.text.split("\n").slice(-3).join(" | ")}` }];
}

/** The line a deploy prints and the go-live certificate reads: how many limits were proven to bite. Spend and count caps are never in it. */
export function provenLine(result: Pick<TripwireResult, "passed" | "of" | "notSelfTestable">): string {
  return `${result.passed} of ${result.of} limits proven to bite${result.notSelfTestable.length > 0 ? ` (${result.notSelfTestable.length} cannot be tested without writing, and are not counted)` : ""}`;
}
