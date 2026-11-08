// The panel's side of the three papers (B28 statement, B35 record of one case, B36 identity paper) and of the record's evidence pack, for one shop the account may
// see (the routes in server.ts ask shops.find first: a partner gets a 404 for a shop that is not theirs). Everything is made from files the panel already reads: the
// deployer's export of the record and the cases (numbers already short hashes there), the shop's settings and their history, the go-live certificate the panel keeps,
// and the last daily fingerprint the deployer wrote into the shop's status. The panel's signing key signs them; without one they say they are not signed.
//
// The agent's stable id lives in shops/<shop>/identity.json, written once (never overwritten) the first time it is asked for; the operator's choice of public fields
// is the `public` list in the same file (left out: the facts about the agent, not about the business), chosen on the papers page by whoever serves the shop.
import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Language } from "../../modules/language/languages.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import { anchorOf, evidencePack, ledgerFile } from "../../modules/record/ledger.ts";
import type { LedgerEntry } from "../../modules/record/ledger.ts";
import { loadPrivateKey, envelopeFile, verifyEnvelopeText } from "../../modules/report/sign.ts";
import type { PaperCase, TemplatePapers } from "../../modules/papers/common.ts";
import { disputePage, sealDisputeRecord } from "../../modules/papers/dispute.ts";
import { AGENT_ID, CHOOSABLE, DEFAULT_PUBLIC, identityPage, newAgentId, sealIdentity } from "../../modules/papers/identity.ts";
import type { Choosable, LimitFact } from "../../modules/papers/identity.ts";
import { sealStatement, statementPage } from "../../modules/papers/statement.ts";
import { BOOKINGS_PAPERS, bookingCase, fromGoLive as bookingsGoLive, limitFacts as bookingsLimits } from "../../templates/commerce/bookings/report/papers.ts";
import { FEES_PAPERS, feeCase, fromGoLive as feesGoLive, limitFacts as feesLimits } from "../../templates/education/fees/report/papers.ts";
import { ORDERS_PAPERS, orderCase, fromGoLive as ordersGoLive, limitFacts as ordersLimits } from "../../templates/commerce/orders/report/papers.ts";
import { readExport } from "./activity.ts";
import type { PanelConfig } from "./config.ts";
import type { Documents } from "./documents.ts";
import type { Shops } from "./shops.ts";

/** What each template gives the papers. A third template is one more entry. */
const KINDS: Record<string, { papers: TemplatePapers; cases(data: NonNullable<ReturnType<typeof readExport>>, settings: any): PaperCase[]; limitFacts(s: unknown, l: Language): LimitFact[]; fromGoLive(doc: any, l: Language): { limits: string[]; checks: { held: number; total: number; on: { year: number; month: number; day: number }; notTested: string[] } } }> = {
  bookings: { papers: BOOKINGS_PAPERS, cases: (d, s) => d.bookings.map((b) => bookingCase(b, s)), limitFacts: bookingsLimits, fromGoLive: bookingsGoLive },
  fees: { papers: FEES_PAPERS, cases: (d, s) => (d.dues ?? []).map((x) => feeCase(x, s)), limitFacts: feesLimits, fromGoLive: feesGoLive },
  orders: { papers: ORDERS_PAPERS, cases: (d, s) => (d.orders ?? []).map((x) => orderCase(x, s)), limitFacts: ordersLimits, fromGoLive: ordersGoLive },
};

export type PaperKind = "dispute" | "statement" | "identity" | "identity-public" | "pack" | "anchor";
export interface MadePaper { file: string; type: string; text: string }
export class PaperError extends Error {}

const readText = (file: string): string | undefined => { try { return readFileSync(file, "utf8"); } catch { return undefined; } };

export function createPapers(config: PanelConfig, shops: Shops, docs: Documents, now: () => number) {
  const key = config.signingKeyFile ? loadPrivateKey(config.signingKeyFile) : undefined;
  const ledgerOf = (id: string): LedgerEntry[] | undefined => { try { return JSON.parse(readText(join(shops.paths.exports(id), "ledger.json")) ?? "null") ?? undefined; } catch { return undefined; } };

  function base(id: string) {
    const settings = shops.settings(id);
    const data = readExport(shops.paths.exports(id));
    if (!settings || !data) throw new PaperError("This shop's record has not been shared with the panel yet (the deployer exports it every quarter of an hour).");
    const kind = KINDS[shops.kind(id)] ?? KINDS.bookings;
    return { settings, data, kind, shop: { name: settings.name as string, timeZone: settings.timezone as string }, ownerLanguage: settings.owner.language as Language };
  }
  const lang = (v: string | undefined, fallback: Language): Language => ((LANGUAGES as readonly string[]).includes(v ?? "") ? v as Language : fallback);

  /** The agent's stable id and the operator's public fields: made once, kept with the shop, never overwritten. */
  function identityFile(id: string): { id: string; public: Choosable[] } {
    const file = join(shops.paths.shop(id), "identity.json");
    const read = () => { try { const x = JSON.parse(readText(file) ?? "null"); return x && AGENT_ID.test(x.id) ? x : undefined; } catch { return undefined; } };
    let found = read();
    if (!found) {
      try { writeFileSync(file, `${JSON.stringify({ schema: 1, id: newAgentId(randomBytes(13)), createdAt: new Date(now()).toISOString() }, null, 2)}\n`, { flag: "wx", mode: 0o644 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      found = read();
      if (!found) throw new PaperError("The agent's id file could not be read back.");
    }
    const pub = Array.isArray(found.public) ? found.public.filter((f: unknown): f is Choosable => (CHOOSABLE as readonly unknown[]).includes(f)) : [...DEFAULT_PUBLIC];
    return { id: found.id, public: pub };
  }

  /** Write the operator's public fields, keeping the id (made first if it is not there yet). The file is replaced whole, by a rename. */
  function setPublic(id: string, fields: readonly string[]): Choosable[] {
    const current = identityFile(id);
    const chosen = CHOOSABLE.filter((f) => fields.includes(f));
    const file = join(shops.paths.shop(id), "identity.json");
    let createdAt: string | undefined;
    try { createdAt = JSON.parse(readText(file) ?? "{}").createdAt; } catch { createdAt = undefined; }
    const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ schema: 1, id: current.id, ...(createdAt ? { createdAt } : {}), public: chosen, publicSetAt: new Date(now()).toISOString() }, null, 2)}\n`, { mode: 0o644 });
    renameSync(tmp, file);
    return chosen;
  }

  function history(id: string): { at: string; by: { name: string; role: string } | null; settings: unknown }[] {
    return (readText(join(shops.paths.shop(id), "settings-history.jsonl")) ?? "").split("\n").filter((l) => l.trim() !== "").flatMap((l) => {
      try { const x = JSON.parse(l); return [{ at: String(x.at), by: x.by ? { name: String(x.by.name), role: String(x.by.role) } : null, settings: x.settings }]; } catch { return []; }
    });
  }

  return {
    /** The operator's public fields now (without making the id), for the papers page. */
    publicOf(id: string): Choosable[] {
      try { const x = JSON.parse(readText(join(shops.paths.shop(id), "identity.json")) ?? "null"); if (x && Array.isArray(x.public)) return CHOOSABLE.filter((f) => x.public.includes(f)); } catch { /* the default below */ }
      return [...DEFAULT_PUBLIC];
    },
    setPublic,
    /** The record of one case: its signed JSON and its page, in the shop's language unless another is asked for. */
    dispute(id: string, caseId: string, language?: string): MadePaper[] {
      const b = base(id);
      const found = b.kind.cases(b.data, b.settings).find((c) => c.id === caseId);
      if (!found) throw new PaperError(`There is no case ${caseId} in this shop's record.`);
      const env = sealDisputeRecord({ template: b.kind.papers, shop: b.shop, case: found, entries: b.data.entries, language: lang(language, b.ownerLanguage), now: now(), tenant: id }, key);
      return [{ file: `case-${caseId}.json`, type: "application/json; charset=utf-8", text: envelopeFile(env) }, { file: `case-${caseId}-${env.document.language}.html`, type: "text/html; charset=utf-8", text: disputePage(env) }];
    },
    /** A person's statement, by the number the partner typed (never kept, never logged). */
    statement(id: string, number: string, language?: string): MadePaper[] {
      if (!/^\+?[0-9 ]{8,16}$/u.test(number.trim())) throw new PaperError("Type the person's WhatsApp number, with the country code (like +91 98...).");
      const b = base(id);
      const digits = `+${number.replace(/\D/gu, "")}`;
      const env = sealStatement({ template: b.kind.papers, shop: b.shop, number: digits, entries: b.data.entries, cases: b.kind.cases(b.data, b.settings), ...(language ? { language: lang(language, "en") } : {}), now: now(), tenant: id }, key);
      return [{ file: "statement.json", type: "application/json; charset=utf-8", text: envelopeFile(env) }, { file: `statement-${env.document.language}.html`, type: "text/html; charset=utf-8", text: statementPage(env) }];
    },
    /** The identity paper, full and public. */
    identity(id: string, language?: string): { full: MadePaper[]; public: MadePaper[] } {
      const b = base(id);
      const l = lang(language, "en");
      const agent = identityFile(id);
      const cert = docs.get(id, "go-live/go-live-certificate.json");
      const checked = cert ? verifyEnvelopeText(cert) : undefined;
      const goLive = checked?.unchanged && checked.envelope ? b.kind.fromGoLive(checked.envelope.document, l) : null;
      const operator = shops.servedBy(id);
      const status = (() => { try { return JSON.parse(readText(join(config.serverDir, "status", `${id}.json`)) ?? "null"); } catch { return null; } })();
      const fp = status?.fingerprint;
      const papers = sealIdentity({
        template: b.kind.papers, agentId: agent.id, language: l, operator: { name: operator?.accountName ?? "?", role: operator?.role ?? "builder" }, shop: b.shop,
        limits: goLive?.limits ?? [], checks: goLive?.checks ?? null, entries: b.data.entries, history: history(id), limitFacts: b.kind.limitFacts,
        ...(fp?.ok && typeof fp.seq === "number" && typeof fp.head === "string" ? { published: { day: String(fp.day), seq: fp.seq, head: fp.head } } : {}),
        tenant: id, show: agent.public, now: now(),
      }, key);
      const made = (env: typeof papers.full, name: string): MadePaper[] => [{ file: `${name}.json`, type: "application/json; charset=utf-8", text: envelopeFile(env) }, { file: `${name}-${l}.html`, type: "text/html; charset=utf-8", text: identityPage(env) }];
      return { full: made(papers.full, "identity"), public: made(papers.public, "identity-public") };
    },
    /** The record as geometer-verify's evidence pack, and (with the panel's key) the anchor over today's head. */
    ledger(id: string): MadePaper[] {
      const ledger = ledgerOf(id);
      if (!ledger) throw new PaperError("This shop's record has not been shared with the panel yet.");
      return [
        { file: `${id}-pack.json`, type: "application/json; charset=utf-8", text: ledgerFile(evidencePack(ledger, { tenant: id, now: now(), ...(key ? { key } : {}) })) },
        ...(key && ledger.length > 0 ? [{ file: `${id}-anchor.json`, type: "application/json; charset=utf-8", text: ledgerFile(anchorOf(ledger, key)) }] : []),
      ];
    },
    /** The signed checkpoint over the head, for the deployer's daily fingerprint (`main.ts anchor`). */
    anchor(id: string) {
      if (!key) throw new PaperError("The panel has no signing key (PANEL_SIGNING_KEY_FILE), so the fingerprint is written without a signature.");
      const ledger = ledgerOf(id);
      if (!ledger || ledger.length === 0) throw new PaperError("This shop's record has not been exported yet, or it is empty.");
      return anchorOf(ledger, key);
    },
  };
}

export type Papers = ReturnType<typeof createPapers>;
