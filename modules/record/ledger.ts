// The record as a hash-chained ledger in geometer-verify's own evidence format (`geometer.evidence-pack` version 1), so the open verifier
// (`geo-verify`, the geometer-verify repository, Apache-2.0) can check a shop's record without trusting Geometer or the shop.
//
// One record entry is one ledger entry, in the same order (record seq N is ledger seq N). Each entry carries the hash of the one before it
// (`prev`), so changing, removing or reordering any entry changes every hash after it, and the last hash (the HEAD) stands for the whole
// history. The head is what the daily fingerprint publishes and what a paper's `anchor` names. The checkpoint over the head is signed with
// the shop's signing key (the key that signs its papers); a signed checkpoint kept somewhere the shop cannot rewrite is an ANCHOR.
//
// The bytes follow geometer-verify's contract (docs/contracts.md and contracts/schemas/core.toml there): records are canonical JSON (keys
// sorted, no spaces), `u32` fields are JSON numbers and `u64` fields are decimal STRINGS, an absent optional field has no key at all (never
// null), digests are "sha256:<64 hex>", key ids are "key:" + the sha256 of the raw public key.
//   entry hash       sha256("geo-ledger/1\n"     + the entry's canonical bytes with `hash` set to 64 zero digits)
//   key event hash   sha256("geo-keylog/1\n"     + the event's canonical bytes with `sigs` empty and `hash` zeroed)
//   key event sig    Ed25519("geo-keyevent/1\n"  + the same bytes)
//   checkpoint sig   Ed25519("geo-checkpoint/1\n" + the checkpoint's canonical bytes with `sig` empty)   (version 1, classical)
//
// What an entry's body holds (BODY_TYPE): the entry's own fields EXCEPT the three that the deployer's export does not carry as the shop holds
// them: `conversation` (a customer's number), `notes` (free text, which names a child in a Fees record) and `refs.page` (the secret folder of a
// served report page). So the head worked out from the shop's own database and the head worked out from the bundle's export are the same, and
// a pack can be handed to an auditor without a phone number, a name or a secret in it. Those three are NOT chained: changing them does not
// change a hash. The rest (the time, the action, the outcome, the case id, the inputs' fingerprint, the limits' decisions, the language, the
// services' ids and amounts) is.
//
// What a pass of geo-verify shows, and does not: see Explanation.md. In one line: the record was not changed since the anchor you kept, not
// that what it says is true or that everything that happened was recorded.
import { createHash, createPublicKey, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { canonicalJson } from "./record.ts";
import type { RecordEntry } from "./record.ts";

export const PACK_FORMAT = "geometer.evidence-pack";
export const LEDGER = "agent-record";
export const BODY_TYPE = "geometer.agent-record-entry/1";
const ZERO = `sha256:${"0".repeat(64)}`;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/u;

/** geometer-verify's kinds that an agent's own record can honestly use. Guard's decisions and the providers' receipts are Guard's to write, not the agent's. */
export type LedgerKind = "observed_fact" | "approval";

export interface LedgerEntry {
  v: 1;
  tenant: string;
  seq: string;
  prev?: string;
  kind: LedgerKind;
  subject: string;
  at_ms: string;
  body_type: string;
  body: string;
  links: never[];
  hash: string;
}

export interface KeyEvent {
  v: 1; seq: string; kind: "genesis"; key: string; public_key: string; compromised: false; at_ms: string; note: string; sigs: { key: string; sig: string }[]; hash: string;
}

export interface Checkpoint { v: 1; tenant: string; seq: string; head: string; count: string; key: string; key_log_seq: string; at_ms: string; sig: string }

export interface Anchor { v: 1; checkpoint: Checkpoint; public_key: string; key_log_head: string; note: string }

export interface EvidencePack {
  format: typeof PACK_FORMAT; v: 1; tenant: string; ledger: string; generated_ms: string; from_seq: string; to_seq: string;
  entries: LedgerEntry[]; checkpoints: Checkpoint[]; key_log: KeyEvent[]; gaps: never[]; actions: never[];
  coverage: { evaluated_rules: string[]; unexercised_rules: string[]; monitor_only_rules: string[]; unsupported: string[]; missing_receipts: string[]; unavailable_payloads: string[]; notes: string[] };
  notes: string[];
}

/** The head of a ledger: what a paper's anchor slot and a daily fingerprint name. Numbers here are plain numbers: this is the papers' own form, not geometer-verify's. */
export interface LedgerHead { ledger: typeof LEDGER; tenant: string; seq: number; head: string }

const sha256 = (bytes: string | Buffer): string => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Canonical bytes, refusing what geometer-verify's strict decoder would refuse: an undefined value (canonicalJson would write null) or a lone surrogate. */
function bytesOf(value: unknown): string {
  const walk = (v: unknown, path: string): void => {
    if (v === undefined) throw new Error(`The ledger was about to write an empty value at ${path}; geometer-verify's format has no empty values.`);
    if (typeof v === "string" && !v.isWellFormed()) throw new Error(`The ledger was about to write broken text at ${path}.`);
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(value, "$");
  return canonicalJson(value);
}

const domainHash = (domain: string, value: unknown): string => sha256(Buffer.from(domain + bytesOf(value), "utf8"));

/** A tenant id: the shop's id on the server (bundle), or a slug of the shop's name (the template scripts). geometer-verify's id pattern. */
export function tenantOf(text: string): string {
  if (ID.test(text)) return text;
  const slug = text.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80);
  if (!slug) throw new Error(`"${text}" cannot be turned into a ledger tenant id. Name the shop with letters or digits, or give the shop's id.`);
  return slug;
}

/** What one record entry puts in the chain (see the header for what it leaves out, and why). */
export function ledgerBody(e: RecordEntry): Record<string, unknown> {
  const { page: _page, ...refs } = e.refs;
  // through JSON once, as the runtime's database keeps it: a ref left undefined in memory is simply absent, there as here
  return JSON.parse(JSON.stringify({ seq: e.seq, time: e.time, booking: e.booking, action: e.action, outcome: e.outcome, inputsDigest: e.inputsDigest, decisions: e.decisions, language: e.language, refs }));
}

/** The owner's decision on something the agent asked about is the one kind of entry a person makes; everything else is what the agent saw or did. */
export const kindOf = (e: RecordEntry): LedgerKind => (e.action === "owner_decision" ? "approval" : "observed_fact");

/** The hash of an entry whose `hash` field is ignored. Exported for the tests that pin it against geometer-verify's own vectors. */
export const entryHash = (entry: Omit<LedgerEntry, "hash"> & { hash?: string }): string => domainHash("geo-ledger/1\n", { ...entry, hash: ZERO });

/** The whole record as ledger entries, oldest first. The record must run 1, 2, 3 ... with no gap, as the record itself writes it. */
export function ledgerEntries(entries: readonly RecordEntry[], tenantText: string): LedgerEntry[] {
  const tenant = tenantOf(tenantText);
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const out: LedgerEntry[] = [];
  let prev: string | undefined;
  sorted.forEach((e, i) => {
    if (e.seq !== i + 1) throw new Error(`The record jumps from entry ${i} to entry ${e.seq}: a record is numbered 1, 2, 3 ... and this one has a gap or a repeat, so it is not chained.`);
    const at = Date.parse(e.time);
    if (!Number.isInteger(at) || at < 0) throw new Error(`Record entry ${e.seq} has no readable time.`);
    const base = { v: 1 as const, tenant, seq: String(e.seq), ...(prev ? { prev } : {}), kind: kindOf(e), subject: e.booking ?? "", at_ms: String(at), body_type: BODY_TYPE, body: bytesOf(ledgerBody(e)), links: [] as never[] };
    const hash = entryHash(base);
    out.push({ ...base, hash });
    prev = hash;
  });
  return out;
}

/** The head: the last entry's hash and number, or null for an empty record (there is nothing to fingerprint yet). */
export function ledgerHead(ledger: readonly LedgerEntry[]): LedgerHead | null {
  const last = ledger.at(-1);
  return last ? { ledger: LEDGER, tenant: last.tenant, seq: Number(last.seq), head: last.hash } : null;
}

/** The hash at one entry (what a fingerprint published when the record was that long said), or null when the ledger is shorter. */
export const hashAt = (ledger: readonly LedgerEntry[], seq: number): string | null => ledger[seq - 1]?.hash ?? null;

/** The head straight from a record: the one call the papers and the drill make. */
export const headOf = (entries: readonly RecordEntry[], tenant: string): LedgerHead | null => ledgerHead(ledgerEntries(entries, tenant));

// ---- the key log, the checkpoint and the anchor (the signed parts) ---------------------------------------------------------------------

function publicKeyHex(key: KeyObject): string {
  const x = (key.type === "public" ? key : createPublicKey(key)).export({ format: "jwk" }).x as string;
  return Buffer.from(x, "base64url").toString("hex");
}
const keyIdOf = (publicKey: string): string => `key:${sha256(Buffer.from(publicKey, "hex")).slice("sha256:".length)}`;
const ed25519 = (key: KeyObject, domain: string, value: unknown): string => sign(null, Buffer.from(domain + bytesOf(value), "utf8"), key).toString("hex");

/**
 * The key log: one genesis event for the shop's signing key. It is made the same way every time (Ed25519 signatures are deterministic, and its
 * time is the first entry's), so an anchor saved last month still finds the same key-log head this month.
 */
export function genesisEvent(key: KeyObject, atMs: number): KeyEvent {
  const public_key = publicKeyHex(key);
  const id = keyIdOf(public_key);
  const body = { v: 1 as const, seq: "1", kind: "genesis" as const, key: id, public_key, compromised: false as const, at_ms: String(atMs), note: "the shop's signing key", sigs: [] as { key: string; sig: string }[], hash: ZERO };
  return { ...body, sigs: [{ key: id, sig: ed25519(key, "geo-keyevent/1\n", body) }], hash: domainHash("geo-keylog/1\n", body) };
}

/** A checkpoint over the head, signed. Its time is the last entry's, so the same head always gives the same checkpoint (and the same anchor bytes). */
export function checkpointOf(ledger: readonly LedgerEntry[], key: KeyObject): Checkpoint {
  const last = ledger.at(-1);
  if (!last) throw new Error("An empty record has no head to sign.");
  const unsigned = { v: 1 as const, tenant: last.tenant, seq: last.seq, head: last.hash, count: String(ledger.length), key: keyIdOf(publicKeyHex(key)), key_log_seq: "1", at_ms: last.at_ms, sig: "" };
  return { ...unsigned, sig: ed25519(key, "geo-checkpoint/1\n", unsigned) };
}

/** The anchor file: the signed checkpoint, the public key and the key-log head. Keep it where the shop cannot rewrite it; `geo-verify pack.json --anchor anchor.json` uses it. */
export function anchorOf(ledger: readonly LedgerEntry[], key: KeyObject): Anchor {
  const first = ledger[0];
  if (!first) throw new Error("An empty record has no head to anchor.");
  const genesis = genesisEvent(key, Number(first.at_ms));
  return { v: 1, checkpoint: checkpointOf(ledger, key), public_key: genesis.public_key, key_log_head: genesis.hash, note: `the head of ${first.tenant}'s record at entry ${ledger.length}` };
}

const COVERAGE_NOTES = [
  "This is the agent's own record of what it did, tried or was stopped from doing. Guard's decisions and the services' own records are kept by them, not here.",
  "Left out of every entry, and so not chained: the customer's number, the free-text note and a served page's secret address.",
  "What a customer wrote is kept only as a fingerprint (inputsDigest), never as text.",
];

/** The evidence pack geo-verify reads. With a key it carries the key log and a checkpoint over the head; without one it is the chain alone (geo-verify then says "unverifiable" whatever anchor you hold, because no key log names your anchor's key). */
export function evidencePack(ledger: readonly LedgerEntry[], o: { tenant: string; now: number; key?: KeyObject }): EvidencePack {
  const tenant = tenantOf(o.tenant);
  if (ledger.some((e) => e.tenant !== tenant)) throw new Error(`These ledger entries are not all ${tenant}'s.`);
  const first = ledger[0];
  return {
    format: PACK_FORMAT, v: 1, tenant, ledger: LEDGER, generated_ms: String(o.now), from_seq: "1", to_seq: String(ledger.length),
    entries: [...ledger],
    checkpoints: o.key && first ? [checkpointOf(ledger, o.key)] : [],
    key_log: o.key && first ? [genesisEvent(o.key, Number(first.at_ms))] : [],
    gaps: [], actions: [],
    coverage: { evaluated_rules: [], unexercised_rules: [], monitor_only_rules: [], unsupported: [], missing_receipts: [], unavailable_payloads: [], notes: [...COVERAGE_NOTES] },
    notes: [`body_type ${BODY_TYPE}: each body is the canonical JSON of one record entry without its conversation, notes and page.`],
  };
}

/** The exact bytes to write for a pack or an anchor: canonical JSON and one newline (geo-verify also reads pretty JSON; canonical keeps one spelling). */
export const ledgerFile = (value: EvidencePack | Anchor): string => `${bytesOf(value)}\n`;
