// Item 11h: what Fees' part of the shop page and the owner's page may READ, built from the centre's saved state and settings. Used by the runtime (server/runtime.ts,
// the channel kit) for the reads, by the agent (src/agent.ts) to find the parent a link belongs to and to check that an owner's press matches what waits now, and by
// the assistant's skill (src/assistant.ts), so "what needs me", the owner's page and the mood list the same things.
//
// A typed phone number never opens a student's fees. A parent's page is found ONLY by the hash of their private link (`parentOf`), which the centre gave them (in a
// reminder, or by the owner's "send a new link"); the page shows that parent's students and nothing else. A payment's confirmation page is found only by the hash of
// the handle the parent's own press made through that link, and shows that one fee. Everything here is an allowlist: never the owner's one-use code, never another
// parent, never a record line.
import { createHash } from "node:crypto";
import { leftOn } from "../../../../modules/payments/owner-marked/ledger.ts";
import { ownerMarkedOf } from "../../../../modules/payments/providers/index.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { OwnerActionName } from "../../../../modules/channels/events.ts";
import type { FeeConfirmView, FeeLine, FeesOffer, OwnerParentView, ParentView, PayInstructions } from "../../../../modules/channels/backend.ts";
import { batchName } from "./settings.ts";
import type { Settings } from "./settings.ts";
import { balancePaise, monthLabel, owedPaise, paidPaise } from "./due.ts";
import type { Due, Store } from "./due.ts";

/** What the centre's own page says: its name, address, languages and how parents pay. `paused`: the centre's licence takes no new fee payments now. */
export function feesOffer(settings: Settings, paused: boolean): FeesOffer {
  const marked = ownerMarkedOf(settings.payment);
  return {
    kind: "fees",
    shop: { name: settings.name, ...(settings.address ? { address: settings.address } : {}), timezone: settings.timezone, languages: settings.languages, payment: marked ? { kind: "upi", payee: marked.payTo.name } : { kind: "link" }, paused },
  };
}

/** The parent whose private link has this hash NOW, or undefined. A replaced or revoked link's hash is no one's, so it opens nothing. */
export function parentOf(store: Store, linkHash: string): string | undefined {
  for (const [parent, link] of Object.entries(store.parentLinks ?? {})) if (link.hash === linkHash) return parent;
  return undefined;
}

/** A parent as the owner's page names them without their number: "p-" and 12 hex digits of its hash. */
export const parentRef = (parent: string): string => `p-${createHash("sha256").update(`parent-ref:${parent}`).digest("hex").slice(0, 12)}`;

const batchNames = (settings: Settings, batchId: string): Record<Language, string> => {
  const batch = settings.batches.find((b) => b.id === batchId);
  return Object.fromEntries(LANGUAGES.map((l) => [l, batch ? batchName(batch, l) : batchId])) as Record<Language, string>;
};

/**
 * How to pay what is owed now: on a UPI centre the fee's current request when it is for exactly what is owed (after a part was marked, the agent makes a request for
 * the rest), with the centre's UPI ID; on a gateway centre the current link when what is left on it is what is owed. Undefined otherwise: the page then offers "show
 * how to pay", which asks the agent to make the request (the same `currentLink` a reminder uses).
 */
function payOf(settings: Settings, store: Store, due: Due): PayInstructions | undefined {
  if (due.state !== "open" || balancePaise(due) <= 0) return undefined;
  const link = due.links.find((l) => l.id === due.currentLinkId);
  if (!link) return undefined;
  const marked = ownerMarkedOf(settings.payment);
  if (marked) {
    const r = store.upi?.requests.find((x) => x.id === link.id);
    if (!r || (r.status !== "created" && r.status !== "partially_paid") || leftOn(r) !== balancePaise(due)) return undefined;
    return { kind: "upi", link: r.link, payTo: marked.payTo, amountPaise: r.amountPaise, leftPaise: leftOn(r), note: r.reference };
  }
  const paidOnLink = due.payments.filter((p) => p.linkId === link.id).reduce((n, p) => n + p.amountPaise, 0);
  return link.amountPaise - paidOnLink === balancePaise(due) ? { kind: "link", url: link.url } : undefined;
}

/** One fee as the parent's page shows it, from the record: the month, the due date, the amounts, how to pay while something is owed, and whether they said they paid. */
export function feeLine(settings: Settings, store: Store, due: Due): FeeLine {
  const pay = payOf(settings, store, due);
  return {
    id: due.id, student: due.studentName, batch: batchNames(settings, due.batchId), month: due.month, dueMs: due.dueMs,
    feeInr: due.feeInr, lateFeeInr: due.lateFeeInr, waivedInr: due.waivedInr, owedInr: owedPaise(due) / 100, paidInr: paidPaise(due) / 100, balanceInr: Math.max(0, balancePaise(due)) / 100,
    state: due.state, ...(pay ? { pay } : {}),
    // "I have paid" asks the owner to look on a UPI centre, and the record to be read again on a gateway centre: for an open fee with something still owed
    canSayPaid: due.state === "open" && balancePaise(due) > 0,
    claimed: due.state === "open" && due.claimAtMs !== undefined,
  };
}

/** How many settled fees a parent's page still shows, newest first, under the open ones. */
export const SETTLED_SHOWN = 6;

/**
 * What a parent's private link opens: that parent's students (from the centre's settings) and their fees (the open ones, oldest due first, then the last few settled
 * ones). Null when no parent has this hash now.
 */
export function parentView(settings: Settings, store: Store, linkHash: string): ParentView | null {
  const parent = parentOf(store, linkHash);
  if (!parent) return null;
  const mine = [...store.dues.values()].filter((d) => d.customer === parent);
  const open = mine.filter((d) => d.state === "open").sort((a, b) => a.dueMs - b.dueMs);
  const settled = mine.filter((d) => d.state !== "open").sort((a, b) => b.dueMs - a.dueMs).slice(0, SETTLED_SHOWN);
  return {
    students: settings.students.filter((s) => s.parent === parent).map((s) => ({ name: s.name, batch: batchNames(settings, s.batchId) })),
    dues: [...open, ...settled].map((d) => feeLine(settings, store, d)),
  };
}

/**
 * A payment's confirmation page, by its handle's hash. Its status is the record's, read now: "confirmed" only when the fee is paid (the payments service's own list,
 * or the owner's mark on a UPI centre); "part" when some is recorded; "waiting" after "I have paid" until then. Null when no press made this handle.
 */
export function feeConfirmView(settings: Settings, store: Store, handleHash: string): FeeConfirmView | null {
  const c = store.confirmations?.[handleHash];
  if (!c) return null;
  if (c.refused !== undefined) return { status: "refused", reason: c.refused };
  const due = store.dues.get(c.dueId);
  if (!due || due.customer !== c.parent) return null;
  const status = due.state === "paid" ? "confirmed" : due.state === "closed" ? "closed" : paidPaise(due) > 0 ? "part" : "waiting";
  return { status, ref: due.id, op: "paid", atMs: c.atMs, due: feeLine(settings, store, due) };
}

/** What waits for the owner, as the owner's page shows it and the agent checks a press against. `code` and `request` are for the agent only and never sent out. */
export interface OwnerItem {
  kind: "deposit" | "refund_owed" | "waiver" | "refund_request";
  /** The fee ("f-3"). */
  case: string;
  /** The digest of exactly what is shown. A press with another digest does nothing (agent.ts onOwnerAction). */
  digest: string;
  actions: OwnerActionName[];
  amountPaise: number;
  /** The parent's number and the student's name. */
  customer: { phone: string; name?: string };
  channel: "whatsapp";
  /** The batch and the month, in the owner's language. */
  what: string;
  why?: string;
  /** The owner-marked one-use code the press stands for (the same the WhatsApp button carries). */
  code?: string;
  /** A waiver's or a refund request's id ("q-3"): the owner's own "approve q-3" on WhatsApp. */
  request?: string;
}

const digestOf = (parts: unknown[]): string => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
const whatOf = (settings: Settings, d: Due, language: Language = settings.owner.language): string => `${batchNames(settings, d.batchId)[language]}, ${monthLabel(d, language)}`;

/**
 * Everything the owner can answer from their page: a payment a parent says they made (a UPI centre: from the claim until the owner marks it or the fee is settled),
 * a refund the owner owes and marks sent (UPI), and a waiver or a refund a parent asked for (the agent answers the first request on a fee, `pending[0]`). An open
 * fee nobody has claimed is not listed: it waits for the parent, and a centre of forty students would otherwise have forty items every month (modules/Deferred.md).
 */
export function ownerItems(settings: Settings, store: Store): OwnerItem[] {
  const items: OwnerItem[] = [];
  for (const d of store.dues.values()) {
    if (d.state !== "open" || d.claimAtMs === undefined) continue;
    const r = store.upi?.requests.find((x) => x.id === d.currentLinkId);
    if (!r || !r.code || (r.status !== "created" && r.status !== "partially_paid")) continue;
    const left = leftOn(r);
    items.push({ kind: "deposit", case: d.id, digest: digestOf(["fee_claim", d.id, r.id, left, r.marks.length, r.usedCodes.length]), actions: ["received"], amountPaise: left, customer: { phone: d.customer, name: d.studentName }, channel: "whatsapp", what: whatOf(settings, d), code: r.code });
  }
  for (const r of store.upi?.refunds ?? []) {
    if (r.state !== "owed" || !r.code) continue;
    const d = store.dues.get(r.caseId);
    items.push({ kind: "refund_owed", case: r.caseId, digest: digestOf(["refund_owed", r.caseId, r.id, r.amountPaise, r.usedCodes.length]), actions: ["refunded"], amountPaise: r.amountPaise, customer: { phone: r.customer, ...(d ? { name: d.studentName } : {}) }, channel: "whatsapp", what: d ? whatOf(settings, d) : "", why: r.why, code: r.code });
  }
  for (const d of store.dues.values()) {
    const p = d.pending[0];
    if (p?.kind === "waiver") items.push({ kind: "waiver", case: d.id, digest: digestOf(["waiver", d.id, p.id, p.amountInr, p.balanceAtAskInr]), actions: ["approve", "deny"], amountPaise: p.amountInr * 100, customer: { phone: d.customer, name: d.studentName }, channel: "whatsapp", what: whatOf(settings, d), request: p.id });
    else if (p?.kind === "refund_request") items.push({ kind: "refund_request", case: d.id, digest: digestOf(["refund_request", d.id, p.id, p.amountInr, p.paymentId]), actions: ["approve", "deny"], amountPaise: p.amountInr * 100, customer: { phone: d.customer, name: d.studentName }, channel: "whatsapp", what: whatOf(settings, d), request: p.id });
  }
  return items;
}

/** The centre's parents (from its settings: one entry per number), each with their students and their private link's state, for the owner's page. */
export function parentsList(settings: Settings, store: Store): OwnerParentView[] {
  const byParent = new Map<string, string[]>();
  for (const s of settings.students) byParent.set(s.parent, [...(byParent.get(s.parent) ?? []), s.name]);
  return [...byParent.entries()].map(([phone, students]) => {
    const link = store.parentLinks?.[phone];
    // the digest binds a press to the link as shown: "send a new link" pressed twice sends one, and a revoke of a link replaced since does nothing
    return { ref: parentRef(phone), phone, students, link: link ? "active" as const : "none" as const, ...(link ? { sinceMs: link.atMs } : {}), digest: digestOf(["parent", phone, link?.hash ?? "", link?.atMs ?? 0]) };
  });
}

/** The owner's page's read: the items without their codes, the parents and their links, the centre's name and the owner's language. Fees has no coming list. */
export function ownerView(settings: Settings, store: Store) {
  return {
    shop: { name: settings.name, timezone: settings.timezone, ownerLanguage: settings.owner.language },
    kind: "fees" as const,
    services: [],
    items: ownerItems(settings, store).map(({ code: _code, request: _request, ...shown }) => shown),
    upcoming: [],
    parents: parentsList(settings, store),
  };
}
