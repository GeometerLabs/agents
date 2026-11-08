// The papers' command line, shared by every template's `scripts/papers.ts` (which hands in how to read its settings and its cases):
//
//   papers.ts statement --number +9198... --settings shop.json --record entries.json --cases bookings.json --out <folder> [--lang hi] [--key key.pem] [--tenant glow-salon] [--now T]
//   papers.ts dispute   --case b-3        --settings ... --record ... --cases ... --out <folder> [--lang en] [--key ...] [--tenant ...]
//   papers.ts identity  --agent-id agt_... --operator "Divya" --role partner --go-live go-live-certificate.json --settings ... --record ... --out <folder>
//                       [--history settings-history.jsonl] [--show limits,checks,limitChanges] [--lang en] [--key ...] [--tenant ...] [--published fingerprints.jsonl]
//   papers.ts ledger    --settings ... --record ... --out <folder> [--key key.pem] [--tenant ...]     the evidence pack and, with a key, its anchor, for geo-verify
//
// Each paper is written as <name>.json (the signed envelope, which the site's checker and verify-report.ts read), <name>-<lang>.html and, for the
// statement and the record of one case, <name>-<lang>.txt for WhatsApp. Without --key nothing is signed and the script says so. Files go into --out only.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Language } from "../language/languages.ts";
import { LANGUAGES } from "../language/languages.ts";
import type { RecordEntry } from "../record/record.ts";
import { anchorOf, evidencePack, ledgerEntries, ledgerFile, tenantOf } from "../record/ledger.ts";
import { lastPublished } from "../record/publish.ts";
import { writer } from "../report/months.ts";
import { envelopeFile, verifyEnvelopeText } from "../report/sign.ts";
import { UsageError, ledgerTenant, readEntries, readKey, readNow } from "../report/cli.ts";
import type { PaperCase, TemplatePapers } from "./common.ts";
import { disputePage, disputeText, sealDisputeRecord } from "./dispute.ts";
import { CHOOSABLE, identityPage, sealIdentity } from "./identity.ts";
import type { Choosable, LimitFact } from "./identity.ts";
import { sealStatement, statementPage, statementText } from "./statement.ts";

/** What a template's script hands in. */
export interface PapersAdapter<Settings, Cert> {
  papers: TemplatePapers;
  readSettings(path: string | undefined): Settings;
  /** The cases file (bookings.json, dues.json) as the template's cases. */
  readCases(path: string | undefined, settings: Settings): PaperCase[];
  shop(settings: Settings): { name: string; timeZone: string; ownerLanguage: Language };
  limitFacts(settings: unknown, language: Language): LimitFact[];
  /** The go-live certificate's document, read from its signed file. */
  fromGoLive(cert: Cert, language: Language): { limits: string[]; checks: { held: number; total: number; on: { year: number; month: number; day: number }; notTested: string[] } };
}

const lang = (v: string | undefined, fallback: Language): Language => {
  if (v === undefined) return fallback;
  if ((LANGUAGES as readonly string[]).includes(v)) return v as Language;
  throw new UsageError(`--lang ${v} is not one of ${LANGUAGES.join(", ")}.`);
};

function readHistory(path: string | undefined): { at: string; by: { name: string; role: string } | null; settings: unknown }[] {
  if (!path) return [];
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { throw new UsageError(`I cannot read the settings history at ${path}.`); }
  return text.split("\n").filter((l) => l.trim() !== "").map((l, i) => {
    try { const x = JSON.parse(l); return { at: String(x.at), by: x.by ?? null, settings: x.settings }; } catch { throw new UsageError(`Line ${i + 1} of ${path} is not JSON.`); }
  });
}

export async function runPapersCli<Settings, Cert>(argv: string[], a: PapersAdapter<Settings, Cert>): Promise<number> {
  const [command, ...rest] = argv;
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: {
      settings: { type: "string" }, record: { type: "string" }, cases: { type: "string" }, out: { type: "string" }, lang: { type: "string" }, key: { type: "string" }, tenant: { type: "string" }, now: { type: "string" },
      number: { type: "string" }, case: { type: "string" }, "agent-id": { type: "string" }, operator: { type: "string" }, role: { type: "string" }, "go-live": { type: "string" },
      history: { type: "string" }, show: { type: "string" }, published: { type: "string" },
    } });
  } catch (e) { throw new UsageError(`${(e as Error).message}\nSee the first lines of modules/papers/cli.ts for the options.`); }
  const o = parsed.values;
  if (!["statement", "dispute", "identity", "ledger"].includes(command ?? "")) throw new UsageError("Say which paper: statement, dispute, identity or ledger.");
  if (!o.out) throw new UsageError("Say which folder to write into: --out <folder>.");
  const settings = a.readSettings(o.settings);
  const shop = a.shop(settings);
  const entries: RecordEntry[] = readEntries(o.record);
  const key = readKey(o.key);
  const now = readNow(o.now);
  const { tenant } = ledgerTenant(o.tenant, shop.name);
  const w = writer(o.out);
  const say = (line: string) => console.log(line);
  say(key ? "Signed with your key." : "NOT signed (no --key): the files carry a digest and a code, but nothing shows who issued them.");
  say(tenant ? `Anchored to the head of the record as ledger ${tenant}.` : "Not anchored to the record's ledger: give --tenant <the shop's id>.");

  if (command === "ledger") {
    if (!tenant) throw new UsageError("The ledger needs a tenant: --tenant <the shop's id>.");
    const ledger = ledgerEntries(entries, tenant);
    w.write("pack.json", ledgerFile(evidencePack(ledger, { tenant, now, ...(key ? { key } : {}) })));
    if (key && ledger.length > 0) w.write("anchor.json", ledgerFile(anchorOf(ledger, key)));
    say(`${ledger.length} entries. Check with: geo-verify ${o.out}/pack.json --anchor <an anchor you kept elsewhere>${key ? ` (today's is ${o.out}/anchor.json)` : ""}`);
    for (const f of w.files) say(`  ${f}`);
    return 0;
  }
  const cases = command === "identity" ? [] : a.readCases(o.cases, settings);

  if (command === "statement") {
    if (!o.number) throw new UsageError("Say whose statement: --number <their WhatsApp number>.");
    const env = sealStatement({ template: a.papers, shop, number: o.number, entries, cases, ...(o.lang ? { language: lang(o.lang, "en") } : {}), now, ...(tenant ? { tenant } : {}) }, key);
    const l = env.document.language;
    w.write("statement.json", envelopeFile(env));
    w.write(`statement-${l}.html`, statementPage(env));
    w.write(`statement-${l}.txt`, `${statementText(env)}\n`);
    say(`\n${statementText(env)}`);
  } else if (command === "dispute") {
    const found = cases.find((c) => c.id === o.case);
    if (!found) throw new UsageError(`There is no case ${o.case ?? "(none given: --case b-3)"} in ${o.cases}.`);
    const env = sealDisputeRecord({ template: a.papers, shop, case: found, entries, language: lang(o.lang, shop.ownerLanguage), now, ...(tenant ? { tenant } : {}) }, key);
    const l = env.document.language;
    w.write(`case-${found.id}.json`, envelopeFile(env));
    w.write(`case-${found.id}-${l}.html`, disputePage(env));
    w.write(`case-${found.id}-${l}.txt`, `${disputeText(env)}\n`);
    say(`\n${disputeText(env)}`);
  } else {
    const agentId = o["agent-id"];
    if (!agentId) throw new UsageError("Say the agent's id: --agent-id agt_... (the panel keeps one per shop; it never changes).");
    if (!o.operator) throw new UsageError("Say who runs the agent: --operator \"Divya\" --role partner|builder.");
    const language = lang(o.lang, "en");
    let goLive: ReturnType<PapersAdapter<Settings, Cert>["fromGoLive"]> | null = null;
    if (o["go-live"]) {
      const v = verifyEnvelopeText(readFileSync(o["go-live"], "utf8"));
      if (!v.unchanged || !v.envelope) throw new UsageError(`The go-live certificate ${o["go-live"]} has been changed or is not one: ${v.summary}`);
      goLive = a.fromGoLive(v.envelope.document as Cert, language);
    }
    const show = o.show === undefined ? undefined : o.show.split(",").map((s) => s.trim()).filter(Boolean);
    const unknown = (show ?? []).filter((s) => !(CHOOSABLE as readonly string[]).includes(s));
    if (unknown.length > 0) throw new UsageError(`--show takes ${CHOOSABLE.join(", ")}; not ${unknown.join(", ")}.`);
    const published = o.published && tenant ? lastPublished(o.published, tenantOf(tenant)) : undefined;
    const papers = sealIdentity({
      template: a.papers, agentId, language, operator: { name: o.operator, role: o.role ?? "partner" }, shop, limits: goLive?.limits ?? [], checks: goLive?.checks ?? null, entries,
      history: readHistory(o.history), limitFacts: a.limitFacts, ...(published ? { published: { day: published.day, seq: published.seq, head: published.head } } : {}),
      ...(tenant ? { tenant } : {}), ...(show ? { show: show as Choosable[] } : {}), now,
    }, key);
    w.write("identity.json", envelopeFile(papers.full));
    w.write(`identity-${language}.html`, identityPage(papers.full));
    w.write("identity-public.json", envelopeFile(papers.public));
    w.write(`identity-public-${language}.html`, identityPage(papers.public));
    say(`Agent ${agentId}: the full paper (identity.json) and the public one (identity-public.json, showing ${papers.public.document.shown.join(", ") || "nothing the operator can keep back"}).`);
  }
  say(`Wrote ${w.files.length} files into ${o.out}:`);
  for (const f of w.files) say(`  ${f}`);
  return 0;
}
