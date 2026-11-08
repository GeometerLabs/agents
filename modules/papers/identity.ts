// The know-your-agent paper (B36): a signed identity paper for one deployed agent, with a stable id. It states facts and counts only, never a score, a grade, a
// level or a rank (claim rule 2): who runs it and for which shop, the template and its version, the limits in plain words, the go-live checks ("held N of M")
// and what they did not test, the live counts so far, and who made a limit wider and when.
//
// The operator (the partner or builder) chooses which of those are public. A field they keep back reads "not shown by the operator" on the public paper,
// never as if it were empty: a missing "limits made wider" must not read as "no limit was made wider". Customer data is never an input here: the paper is
// made from counts of the record, the settings' limits and the go-live certificate, so it cannot carry a number or a name.
//
// Two envelopes come out of one call: the full paper (for the operator and the shop owner) and the public paper (the chosen fields only), each sealed with
// the same geometer-document/1 envelope, so the site's checker reads both. The page on geometer.dev that shows the public one is later (it needs a deploy yes).
import type { KeyObject } from "node:crypto";
import type { Language } from "../language/languages.ts";
import type { LocalDate } from "../core/time.ts";
import type { RecordEntry } from "../record/record.ts";
import { headOf } from "../record/ledger.ts";
import type { LedgerHead } from "../record/ledger.ts";
import { esc, list } from "../report/page.ts";
import { seal } from "../report/sign.ts";
import type { Envelope } from "../report/sign.ts";
import { UPI_PAID, UPI_REFUNDED, dayText, head, localDay, notCheckedSection, paperPage, sealSection } from "./common.ts";
import type { TemplatePapers } from "./common.ts";
import { WORDS } from "./words.ts";

export const IDENTITY_FORMAT = "geometer-agent-identity/1";

/** The fields the operator may show or keep back. The agent's id, its template and what the paper did not check are always shown. */
export const CHOOSABLE = ["operator", "shop", "limits", "checks", "live", "limitChanges", "ledger"] as const;
export type Choosable = (typeof CHOOSABLE)[number];
/** Shown unless the operator says otherwise: the facts about the agent, not about the business it serves. */
export const DEFAULT_PUBLIC: readonly Choosable[] = ["limits", "checks", "limitChanges"];

export interface Hidden { shown: false }
const HIDDEN: Hidden = { shown: false };

export interface LimitChange { at: string; by: string; what: string }

export interface IdentityPaper {
  format: typeof IDENTITY_FORMAT;
  agent: { id: string };
  template: { name: string; version: string };
  language: Language;
  issuedAt: string;
  issuedOn: LocalDate;
  operator: { name: string; role: string } | Hidden;
  shop: { name: string } | Hidden;
  limits: string[] | Hidden;
  checks: { held: number; total: number; on: LocalDate; notTested: string[] } | null | Hidden;
  live: { since: string | null; entries: number; payments: number; refunds: number; stopped: number; heldForOwner: number } | Hidden;
  limitChanges: { historyFrom: string | null; changes: LimitChange[] } | Hidden;
  ledger: { head: LedgerHead | null; published: { day: string; seq: number; head: string } | null } | Hidden;
  /** Which of the choosable fields this paper shows. */
  shown: Choosable[];
  notTested: string[];
  anchor: LedgerHead | null;
}

/** One limit a template can name, so a change can be read as wider or narrower: `wider` says which way loosens it. */
export interface LimitFact { key: string; label: string; value: number; wider: "higher" | "lower"; show: string }

export interface IdentityInput {
  template: TemplatePapers;
  /** The agent's stable id (see agentIdOf). */
  agentId: string;
  language: Language;
  operator: { name: string; role: "builder" | "partner" | string };
  shop: { name: string; timeZone: string };
  /** The limits in plain words, in `language` (the template words them from its go-live certificate or its settings). */
  limits: string[];
  /** The go-live checks, from the go-live certificate: counts, the day, and what they did not test in plain words. null: none was given. */
  checks: { held: number; total: number; on: LocalDate; notTested: string[] } | null;
  /** The whole record, for the live counts and the ledger head. */
  entries: readonly RecordEntry[];
  /** Every saved version of the settings, oldest first, with who saved it (the panel's settings-history.jsonl). Empty: no history is kept. */
  history: readonly { at: string; by: { name: string; role: string } | null; settings: unknown }[];
  /** The template's limits of one version of its settings, in `language`. */
  limitFacts(settings: unknown, language: Language): LimitFact[];
  /** The last fingerprint published for this shop's ledger, if any. */
  published?: { day: string; seq: number; head: string } | null;
  tenant?: string;
  /** The fields the operator chose to show. Left out: DEFAULT_PUBLIC. */
  show?: readonly Choosable[];
  now: number;
}

/** A stable id for a deployed agent: "agt_" and 20 Crockford base32 characters of random. Made once and kept with the shop (it survives a move, an update and a settings change). */
export function newAgentId(random: Uint8Array): string {
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  if (random.length < 13) throw new Error("An agent id needs 13 random bytes.");
  let bits = 0n;
  for (const b of random.slice(0, 13)) bits = (bits << 8n) | BigInt(b);
  let id = "";
  for (let i = 0; i < 20; i++) { id = alphabet[Number(bits & 31n)] + id; bits >>= 5n; }
  return `agt_${id}`;
}
export const AGENT_ID = /^agt_[0-9a-hjkmnp-tv-z]{20}$/u;

/** The label of each choosable field, in a language (the paper's own headings). */
export const choosableLabel = (field: Choosable, language: Language): string => {
  const w = WORDS[language];
  const labels: Record<Choosable, string> = { operator: w.identity.operator, shop: w.identity.shop, limits: w.identity.limits, checks: w.identity.checks, live: w.identity.live, limitChanges: w.identity.changes, ledger: w.common.ledger };
  return labels[field];
};

/** Who made a limit wider and when: each saved version compared with the one before it. The first version is where the history starts, not a change. */
export function widenedLimits(input: Pick<IdentityInput, "history" | "limitFacts" | "language">): LimitChange[] {
  const changes: LimitChange[] = [];
  const w = WORDS[input.language].identity;
  for (let i = 1; i < input.history.length; i++) {
    const before = new Map(input.limitFacts(input.history[i - 1].settings, input.language).map((f) => [f.key, f]));
    for (const now of input.limitFacts(input.history[i].settings, input.language)) {
      const was = before.get(now.key);
      if (!was || was.value === now.value) continue;
      const wider = now.wider === "higher" ? now.value > was.value : now.value < was.value;
      if (!wider) continue;
      const by = input.history[i].by;
      changes.push({ at: input.history[i].at, by: by ? `${by.name} (${w.role[by.role] ?? by.role})` : "?", what: `${now.label}: ${was.show} → ${now.show}` });
    }
  }
  return changes;
}

function liveCounts(entries: readonly RecordEntry[], t: TemplatePapers): Exclude<IdentityPaper["live"], Hidden> {
  const paid = new Set([...t.paidActions, UPI_PAID]);
  const refunded = new Set([...t.refundActions, UPI_REFUNDED]);
  const once = (keep: (e: RecordEntry) => boolean, key: (e: RecordEntry) => string) => new Set(entries.filter((e) => e.outcome === "confirmed" && keep(e)).map(key)).size;
  return {
    since: entries[0]?.time ?? null,
    entries: entries.length,
    payments: once((e) => paid.has(e.action), (e) => e.refs.paymentId ?? `entry-${e.seq}`),
    refunds: once((e) => refunded.has(e.action), (e) => e.refs.refundId ?? `entry-${e.seq}`),
    stopped: entries.filter((e) => e.outcome === "blocked" || e.decisions.some((d) => d.verdict === "block")).length,
    heldForOwner: entries.filter((e) => e.outcome === "held_for_owner").length,
  };
}

export function buildIdentity(input: IdentityInput): { full: IdentityPaper; public: IdentityPaper } {
  const w = WORDS[input.language];
  const show = new Set((input.show ?? DEFAULT_PUBLIC).filter((f) => (CHOOSABLE as readonly string[]).includes(f)));
  const anchor = input.tenant ? headOf(input.entries, input.tenant) : null;
  const historyFrom = input.history[0]?.at ?? null;
  const fields: Pick<IdentityPaper, Choosable> = {
    operator: { name: input.operator.name, role: input.operator.role },
    shop: { name: input.shop.name },
    limits: [...input.limits],
    checks: input.checks ? { ...input.checks, notTested: [...input.checks.notTested] } : null,
    live: liveCounts(input.entries, input.template),
    limitChanges: { historyFrom, changes: widenedLimits(input) },
    ledger: { head: anchor, published: input.published ?? null },
  };
  const notTested = [
    w.not.everySituation, w.not.liveNotChecked,
    ...(historyFrom ? [w.not.historyStart(dayText(localDay(Date.parse(historyFrom), input.shop.timeZone), input.language))] : [w.identity.noHistory]),
    w.not.keyHolder, w.not.truth, anchor ? w.not.anchorNotCompared : w.not.noLedger,
  ];
  const base = {
    format: IDENTITY_FORMAT, agent: { id: input.agentId }, template: { ...input.template.pathway }, language: input.language,
    issuedAt: new Date(input.now).toISOString(), issuedOn: localDay(input.now, input.shop.timeZone), notTested,
  } as const;
  const full: IdentityPaper = { ...base, ...fields, shown: [...CHOOSABLE], anchor };
  const pub: IdentityPaper = {
    ...base,
    ...(Object.fromEntries(CHOOSABLE.map((f) => [f, show.has(f) ? fields[f] : HIDDEN])) as Pick<IdentityPaper, Choosable>),
    shown: CHOOSABLE.filter((f) => show.has(f)),
    // the anchor names the record's length and head: it is part of the ledger field, and kept back with it
    anchor: show.has("ledger") ? anchor : null,
  };
  return { full, public: pub };
}

export function sealIdentity(input: IdentityInput, key?: KeyObject): { full: Envelope<IdentityPaper>; public: Envelope<IdentityPaper> } {
  const papers = buildIdentity(input);
  return { full: seal(papers.full, key), public: seal(papers.public, key) };
}

const isHidden = (v: unknown): v is Hidden => typeof v === "object" && v !== null && (v as Hidden).shown === false;

export function identityPage(envelope: Envelope<IdentityPaper>): string {
  const p = envelope.document;
  const w = WORDS[p.language];
  const i = w.identity;
  const hidden = `<p class="small">${esc(i.hidden)}</p>`;
  const section = <T>(title: string, v: T | Hidden, render: (x: T) => string) => `<h2>${esc(title)}</h2>${isHidden(v) ? hidden : render(v as T)}`;
  const body = `${head(i.title, isHidden(p.shop) ? p.agent.id : p.shop.name, `${p.agent.id} · ${w.common.issued} ${dayText(p.issuedOn, p.language)}`, p.language)}
<dl><dt>${esc(i.id)}</dt><dd class="mono">${esc(p.agent.id)}</dd><dt>${esc(i.template)}</dt><dd>${esc(`${p.template.name} ${p.template.version}`)}</dd>
<dt>${esc(i.operator)}</dt><dd>${isHidden(p.operator) ? esc(i.hidden) : esc(`${p.operator.name} (${i.role[p.operator.role] ?? p.operator.role})`)}</dd>
<dt>${esc(i.shop)}</dt><dd>${isHidden(p.shop) ? esc(i.hidden) : esc(p.shop.name)}</dd></dl>
${section(i.limits, p.limits, (l: string[]) => list(l))}
${section(i.checks, p.checks, (c: Exclude<IdentityPaper["checks"], Hidden>) => (c ? `<p><b>${esc(i.held(c.held, c.total))}</b> · ${esc(dayText(c.on, p.language))}</p><h2>${esc(i.notTestedHeading)}</h2><div class="warn">${list(c.notTested)}</div>` : `<p>${esc(i.checksNone)}</p>`))}
${section(i.live, p.live, (l: Exclude<IdentityPaper["live"], Hidden>) => `<p class="small">${l.since ? esc(i.liveSince(dayText(localDay(Date.parse(l.since), "UTC"), p.language))) : ""}</p><div class="cards">${([[i.entries, l.entries], [i.payments, l.payments], [i.refunds, l.refunds], [i.stopped, l.stopped], [i.heldForOwner, l.heldForOwner]] as [string, number][]).map(([k, v]) => `<div class="card"><b>${v}</b><span>${esc(k)}</span></div>`).join("")}</div>`)}
${section(i.changes, p.limitChanges, (c: Exclude<IdentityPaper["limitChanges"], Hidden>) => (c.historyFrom === null ? `<p>${esc(i.noHistory)}</p>` : c.changes.length === 0 ? `<p>${esc(i.noChanges(dayText(localDay(Date.parse(c.historyFrom), "UTC"), p.language)))}</p>` : list(c.changes.map((x) => i.changed(dayText(localDay(Date.parse(x.at), "UTC"), p.language), x.by, x.what)))))}
${section(w.common.ledger, p.ledger, (l: Exclude<IdentityPaper["ledger"], Hidden>) => `<p class="mono">${esc(l.head ? `${l.head.tenant} #${l.head.seq} ${l.head.head}` : w.common.ledgerNone)}</p>${l.published ? `<p class="small mono">${esc(`${l.published.day}: #${l.published.seq} ${l.published.head}`)}</p>` : ""}`)}
${notCheckedSection(p.notTested, p.language)}
${sealSection(envelope, p.language)}`;
  return paperPage(`${i.title} · ${p.agent.id}`, p.language, body);
}
