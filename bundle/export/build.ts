// Export a shop (plan B38): everything that is the shop's, in an open format a person can read and a program can check, with no key or secret in it.
//
// One builder serves `geometer export <shop>` and the panel's download. It reads only files (the shop's folder, the deployer's export of its record, the papers the panel
// made) and never talks to the shop's runtime or to any service, so it works for a shop that is stopped, a server whose runtime is down, and a shop whose subscription lapsed.
// What it leaves out on purpose: every key and secret (the secrets inbox, the panel's accounts, sessions and vault, signing keys), and the shop's own WhatsApp, payment and
// calendar accounts, which are the shop's and not Geometer's to carry. The record's customers are the keyed fingerprints the deployer's export writes (B69, modules/record/fingerprint.ts);
// manifest.json and README.txt say which form this package uses and what it does not cover, in particular that settings.json holds the shop's own list of people as written.
//
// The package is a folder of plain files (JSON, JSON lines, HTML, text) and, for the download, the same folder as a .tar.gz:
//   README.txt                       what each file is and how to check it (this file's FORMAT_README)
//   manifest.json                    the shop, the time, and every other file with its sha256 and size
//   SHA256SUMS                       the same hashes in the format `sha256sum -c` reads (it covers manifest.json too)
//   settings.json                    the shop's settings, as they are on the server
//   limits.json                      the limits the settings give, in the Guard's own shape, and how many were proven to bite at the last deploy
//   history/settings-history.jsonl   every saved version of the settings, with who saved it (starts when the panel began keeping it)
//   accounts.json                    which phone number, calendar and payment mode the shop used: names, never keys
//   record/record.jsonl              the shop's record of what the agent did, one entry per line
//   record/cases.jsonl               the bookings (or fees, or orders), one per line
//   assignment.json                  who served the shop, and every move to someone else with its reason (when there was one)
//   status.json                      the deployer's last word on the shop
//   reports/<month>/...              each monthly report and certificate the panel made, signed (.json) and readable (.html)
//   certificates/go-live/...         the go-live certificate, signed (.json) and readable (.html)
//   identity.json                    the agent's stable id and the fields its operator shows on the public identity paper (B36), when the shop has one
//   record/ledger/pack.json          the record as geometer-verify's evidence pack (B28), with the key log and a checkpoint when the panel's key signs it
//   record/ledger/anchor.json        the anchor over the head when the package was made (signed by the same key)
//   record/ledger/fingerprints.jsonl the shop's daily fingerprints as the server kept them, each line with its own anchor when it was signed
import { createHash } from "node:crypto";
import { canonicalJson } from "../../modules/record/record.ts";
import { kindFor } from "../lib/kinds.ts";
import { toTarGz } from "./tar.ts";
import type { KeyObject } from "node:crypto";
import { anchorOf, evidencePack, ledgerFile } from "../../modules/record/ledger.ts";
import type { LedgerEntry } from "../../modules/record/ledger.ts";
import { OLD_PERSON_FORM, PERSON_FORM } from "../../modules/record/fingerprint.ts";
import type { PersonForm } from "../backup/export.ts";

export const EXPORT_FORMAT = "geometer-shop-export/1";

/** Where the builder reads from. Every method returns text, or undefined when the thing is not there. */
export interface ExportSources {
  /** shops/<shop>/<name>: settings.json, pathway.lock, runtime.json, assignment.json, settings-history.jsonl, status via `status`. */
  shopFile(name: string): string | undefined;
  /** exports/<shop>/<name>: record.json, bookings.json, dues.json, orders.json. */
  exportFile(name: string): string | undefined;
  /** When the deployer last wrote the record's export (ISO). */
  exportedAt(): string | undefined;
  /** status/<shop>.json as the deployer wrote it. */
  statusText(): string | undefined;
  /**
   * The Razorpay limits spec for these settings, made the way the deployer makes the one Guard enforces (the server's approval hours and link cap, the template's own numbers), or
   * undefined when the server's own settings cannot be read, in which case the export makes it with the generator's defaults and says so.
   */
  limitsSpec?(settings: any, template: string): unknown;
  /** The papers the panel made, as it keeps them: `go-live/<file>` or `monthly/<month>/<file>`. */
  papers(): { path: string; text: string }[];
  /** The pins the checks confirmed (ids, never keys), and the panel's own memory of the shop's accounts. */
  pins(): { whatsapp?: { phoneNumberId?: string; displayNumber?: string }; calendar?: { calendarId?: string }; razorpay?: { mode?: string } } | undefined;
  meta(): { whatsapp?: { businessNumber?: string }; razorpay?: { mode?: string }; calendar?: { shareAddress?: string } } | undefined;
  /** The key that signs the record's evidence pack and its anchor (the panel's). Left out, the pack is the chain alone, which geo-verify can check only against an anchor that names a key in a key log: so it is said, not hidden. */
  signingKey?(): KeyObject | undefined;
}

export interface ExportRequest {
  shop: string;
  now: number;
  exportedBy?: { name: string; role: string };
}

export interface ManifestFile { path: string; sha256: string; bytes: number }
export interface Manifest {
  schema: 1;
  format: typeof EXPORT_FORMAT;
  shop: string;
  template: string;
  pathway: string | null;
  exportedAt: string;
  exportedBy?: { name: string; role: string };
  /** When the deployer last exported the record this package holds. Anything after it is not in the package. */
  recordAsOf: string | null;
  counts: { recordEntries: number; cases: number; reports: number; certificates: number; settingsVersions: number };
  /** Which form this package's fingerprints use (B69). "unkeyed" means an export from before the keyed form: its fingerprints can be worked back by trying every number. */
  personFingerprints: { form: string; keyed: boolean; inputsKeyed?: number; inputsOlder?: number; messageIdsOlder?: number };
  notes: string[];
  files: ManifestFile[];
}

export interface BuiltExport { name: string; files: Map<string, Buffer>; manifest: Manifest; warnings: string[] }

export class ExportError extends Error {}

const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const buf = (text: string) => Buffer.from(text, "utf8");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const dayStamp = (ms: number) => new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");

/**
 * Things that must never be in an export: the VALUES of keys and secrets. The builder never reads where they live; this stops a mistake from putting one in anyway. It looks for what a
 * secret looks like (a private-key block, a service-account key, an access token, a Razorpay key id with its secret), never for the NAME of a secret or a key id on its own: a failed
 * deploy's message in status.json may say "razorpay_key is missing", and that must not stop a shop from taking its files out.
 */
const SECRET_SHAPES: { name: string; pattern: RegExp }[] = [
  { name: "a private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
  { name: "a service-account key", pattern: /private_key\\?"\s*:\s*\\?"[^"\\]{20,}/u },
  { name: "an access token", pattern: /\bEAA[A-Za-z0-9]{40,}\b/u },
  { name: "a Razorpay key with its secret", pattern: /\brzp_(?:live|test)_[A-Za-z0-9]{6,}:[A-Za-z0-9]{10,}/u },
];

function jsonLines(text: string | undefined, what: string, warnings: string[]): { lines: string[]; count: number } {
  if (text === undefined) return { lines: [], count: 0 };
  let list: unknown;
  try { list = JSON.parse(text); } catch { warnings.push(`${what} could not be read, so it is not in this package.`); return { lines: [], count: 0 }; }
  const items = Array.isArray(list) ? list.map((x) => (Array.isArray(x) ? x[1] : x)) : [];
  return { lines: items.map((x) => JSON.stringify(x)), count: items.length };
}

export function buildExport(src: ExportSources, req: ExportRequest): BuiltExport {
  const warnings: string[] = [];
  const notes: string[] = [];
  const files = new Map<string, Buffer>();
  const put = (path: string, text: string | Buffer) => { files.set(path, typeof text === "string" ? buf(text) : text); };

  const settingsText = src.shopFile("settings.json");
  if (settingsText === undefined) throw new ExportError(`There is no settings.json for ${req.shop}, so there is nothing to export.`);
  let settings: any;
  try { settings = JSON.parse(settingsText); } catch { throw new ExportError(`The settings of ${req.shop} cannot be read as JSON, so they are not exported as they are. Fix the file, or restore it from a backup.`); }
  const lock = src.shopFile("pathway.lock")?.split("\n").map((l) => l.trim()).find((l) => l !== "" && !l.startsWith("#")) ?? null;
  const kind = kindFor(lock?.split("@")[0]);
  const template = kind?.id ?? "bookings";
  put("settings.json", settingsText);

  // ---- limits: what the settings give, in Guard's shape, and how many were proven at the last deploy
  const statusText = src.statusText();
  let status: any;
  try { status = statusText === undefined ? undefined : JSON.parse(statusText); } catch { status = undefined; }
  let guardSpec: unknown = null;
  let specNote = "";
  let policyDigest: string | null = null;
  if (kind) {
    const checked = kind.validateSettings(settings);
    if (checked.ok) {
      try { policyDigest = kind.papers.policyDigest(checked.settings); } catch { warnings.push("The policy digest could not be worked out."); }
      try {
        guardSpec = src.limitsSpec?.(checked.settings, kind.id);
        if (guardSpec === undefined) {
          guardSpec = kind.razorpaySpec(checked.settings, { tenant: req.shop, name: `${req.shop}-razorpay`, version: 1, reviewedBy: "made for this export, not reviewed" }, { approvalTtlSeconds: 86_400 });
          specNote = " This server's own settings (geometer.json) could not be read, so it was made with the default approval time and caps: it may differ from the one Guard enforces.";
          warnings.push("The server's own settings could not be read, so the limits were made with the defaults.");
        }
      } catch { warnings.push("The limits could not be written in Guard's shape from these settings."); guardSpec = null; }
    } else warnings.push("The settings do not pass the template's own check any more, so the limits could not be worked out; settings.json is as it is on the server.");
  }
  put("limits.json", json({
    schema: 1,
    note: `The limits the settings give. razorpay is the spec made the way the deployer makes the one Guard enforces for refunds and payment links (amounts in paise); policyDigest is what the go-live certificate names. history/settings-history.jsonl has every saved version.${specNote}`,
    policyDigest, razorpay: guardSpec,
    provenAtLastDeploy: status?.limits && typeof status.limits === "object" ? { proven: status.limits.proven ?? null, of: status.limits.of ?? null, unprovable: Array.isArray(status.limits.unprovable) ? status.limits.unprovable : [] } : null,
  }));

  // ---- the settings' history
  const historyText = src.shopFile("settings-history.jsonl");
  const history = (historyText ?? "").split("\n").filter((l) => l.trim() !== "");
  put("history/settings-history.jsonl", history.length > 0 ? `${history.join("\n")}\n` : "");
  if (history.length === 0) notes.push("No earlier versions of the settings were kept for this shop: the panel began keeping them when it first saved the shop's settings after this feature was added. settings.json is the version in force now.");
  else {
    let first: { at?: string } = {};
    try { first = JSON.parse(history[0]); } catch { /* the line is there to be read by a person */ }
    notes.push(`The settings history starts at ${first.at ?? "its first line"}; changes before that were not kept.`);
  }

  // ---- accounts: names and ids only
  const pins = src.pins();
  const meta = src.meta();
  put("accounts.json", json({
    schema: 1,
    note: "Which accounts the shop used. These are the shop's own accounts, not Geometer's, and they stay the shop's: no key or secret is in this package, and whoever serves the shop next must be given new ones.",
    whatsapp: { businessNumber: meta?.whatsapp?.businessNumber ?? pins?.whatsapp?.displayNumber ?? null, phoneNumberId: pins?.whatsapp?.phoneNumberId ?? null },
    calendar: { calendarId: pins?.calendar?.calendarId ?? null },
    payments: { provider: "Razorpay", mode: pins?.razorpay?.mode ?? meta?.razorpay?.mode ?? null },
  }));

  // ---- the record and the cases, as JSON lines
  const record = jsonLines(src.exportFile("record.json"), "The record", warnings);
  const casesName = template === "orders" ? "orders.json" : template === "fees" ? "dues.json" : "bookings.json";
  const cases = jsonLines(src.exportFile(casesName), template === "orders" ? "The orders" : template === "fees" ? "The fees" : "The bookings", warnings);
  const recordAsOf = src.exportedAt() ?? null;
  if (src.exportFile("record.json") === undefined) { notes.push("The deployer had not yet exported this shop's record when this package was made, so record/ is empty."); }
  else notes.push(`The record is as the deployer last exported it${recordAsOf ? ` (${recordAsOf})` : ""}. Customers' phone numbers (and, for a Fees centre, students' names) are fingerprints in it, as in the monthly reports: see PEOPLE IN THE RECORD in README.txt for what that covers.`);
  const formText = src.exportFile("person-form.json");
  let form: PersonForm | undefined;
  try { form = formText === undefined ? undefined : JSON.parse(formText) as PersonForm; } catch { form = undefined; }
  const personForm: Manifest["personFingerprints"] = form?.form === PERSON_FORM
    ? { form: PERSON_FORM, keyed: true, inputsKeyed: form.inputs.keyed, inputsOlder: form.inputs.older, messageIdsOlder: form.messageIds.older }
    : { form: src.exportFile("record.json") === undefined ? "none: there is no record in this package" : OLD_PERSON_FORM, keyed: false };
  if (src.exportFile("record.json") !== undefined && !personForm.keyed) warnings.push("The record in this package was exported before keyed fingerprints: its customer numbers and students' names can be worked back by anyone holding it. The server's next export (within a quarter of an hour) uses the keyed form.");
  put("record/record.jsonl", record.lines.length > 0 ? `${record.lines.join("\n")}\n` : "");
  put("record/cases.jsonl", cases.lines.length > 0 ? `${cases.lines.join("\n")}\n` : "");

  // ---- the record as geometer-verify's evidence pack (B28), the daily fingerprints, the agent's id (B36)
  const ledgerText = src.exportFile("ledger.json");
  if (ledgerText !== undefined) {
    let ledger: LedgerEntry[] | undefined;
    try { ledger = JSON.parse(ledgerText) as LedgerEntry[]; } catch { warnings.push("The record's ledger could not be read, so record/ledger/ has no evidence pack."); }
    if (ledger) {
      const key = src.signingKey?.();
      put("record/ledger/pack.json", ledgerFile(evidencePack(ledger, { tenant: req.shop, now: req.now, ...(key ? { key } : {}) })));
      if (key && ledger.length > 0) put("record/ledger/anchor.json", ledgerFile(anchorOf(ledger, key)));
      notes.push(key ? "record/ledger/pack.json is the record as geometer-verify's evidence pack, signed with the panel's key; anchor.json is the anchor over its head when this package was made. An anchor you kept from earlier (a fingerprint line) is the stronger check." : "record/ledger/pack.json is the record as geometer-verify's evidence pack, but no signing key made this package, so it has no key log and no anchor: geo-verify can say only that it is unverifiable.");
    }
  } else notes.push("The deployer had not yet written the record's ledger, so record/ledger/ has no evidence pack.");
  const fingerprints = src.exportFile("fingerprints.jsonl");
  if (fingerprints !== undefined && fingerprints.trim() !== "") put("record/ledger/fingerprints.jsonl", fingerprints.endsWith("\n") ? fingerprints : `${fingerprints}\n`);
  const identity = src.shopFile("identity.json");
  if (identity !== undefined) put("identity.json", identity.endsWith("\n") ? identity : `${identity}\n`);

  // ---- who served the shop
  const assignment = src.shopFile("assignment.json");
  if (assignment !== undefined) put("assignment.json", assignment.endsWith("\n") ? assignment : `${assignment}\n`);
  if (statusText !== undefined && status !== undefined) put("status.json", json(status));

  // ---- the papers the panel made
  let reports = 0;
  let certificates = 0;
  for (const paper of [...src.papers()].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = paper.path.split("/");
    if (parts[0] === "go-live" && parts.length === 2) { put(`certificates/go-live/${parts[1]}`, paper.text); if (parts[1].endsWith(".json")) certificates++; }
    else if (parts[0] === "monthly" && parts.length === 3) { put(`reports/${parts[1]}/${parts[2]}`, paper.text); if (parts[2].endsWith(".json")) reports++; }
  }

  // ---- a last look: nothing secret-shaped in anything we are about to hand over
  for (const [path, content] of files) {
    const text = content.toString("utf8");
    const hit = SECRET_SHAPES.find((s) => s.pattern.test(text));
    if (hit) throw new ExportError(`${path} looks as if it holds ${hit.name}, so nothing was exported. Keys and secrets are never exported; find out how it got there.`);
  }

  const manifest: Manifest = {
    schema: 1, format: EXPORT_FORMAT, shop: req.shop, template, pathway: lock, exportedAt: new Date(req.now).toISOString(),
    ...(req.exportedBy ? { exportedBy: req.exportedBy } : {}),
    recordAsOf,
    counts: { recordEntries: record.count, cases: cases.count, reports, certificates, settingsVersions: history.length },
    personFingerprints: personForm,
    notes,
    files: [...files].map(([path, content]) => ({ path, sha256: sha(content), bytes: content.length })),
  };
  put("README.txt", FORMAT_README(manifest));
  manifest.files.push({ path: "README.txt", sha256: sha(files.get("README.txt") as Buffer), bytes: (files.get("README.txt") as Buffer).length });
  manifest.files.sort((a, b) => a.path.localeCompare(b.path));
  put("manifest.json", json(manifest));
  put("SHA256SUMS", [...files].filter(([p]) => p !== "SHA256SUMS").map(([p, c]) => `${sha(c)}  ${p}`).sort((a, b) => a.slice(66).localeCompare(b.slice(66))).join("\n") + "\n");

  const name = `geometer-export-${req.shop}-${dayStamp(req.now)}`;
  return { name, files, manifest, warnings };
}

/** The package as a .tar.gz whose files sit in one folder named after the export. */
export function packageTarGz(built: BuiltExport, nowMs: number): Buffer {
  const inside = new Map<string, Buffer>();
  for (const [path, content] of built.files) inside.set(`${built.name}/${path}`, content);
  return toTarGz(inside, nowMs);
}

export { canonicalJson };

function peopleWords(m: Manifest): string {
  const f = m.personFingerprints;
  if (!f.keyed) return f.form === OLD_PERSON_FORM
    ? "  Made before fingerprints were keyed: the record holds a plain sha256 of each customer's number (and, for a Fees centre, each student's name). Anyone holding this package can work those back by trying every number. Do not pass it around; the server's next export uses the keyed form."
    : "  This package has no record, so it has no fingerprints.";
  return [
    `  Form: ${f.form}. A customer's number is "c-..." on a record entry and "p-..." on a case; a Fees student's name is "s-...": 12 hex digits of an HMAC-SHA256 of the value, under a key that stays with the shop and its backups and is never in this package. Without the key a guess cannot be tested against a fingerprint. With it, the shop's own tools can still find one person's entries.`,
    "  What this does not cover:",
    "    - settings.json and history/settings-history.jsonl are the shop's own settings as written: the owner's number, any approvers' numbers and, for a Fees centre, the list of students with their parents' numbers. They are in plain text. Give those two files only to someone you would show that list; the record/, reports/ and certificates/ folders are what you can hand to an auditor.",
    "    - Free text: a number or a name the shop or a customer wrote into a note is not replaced. Only a student's name spelled exactly as the centre's list has it is.",
    `    - Entries written before the shop had its key (${f.inputsOlder ?? 0} of them) carry "inputsDigest" as a plain digest, and ${f.messageIdsOlder ?? 0} carry WhatsApp's message id as it came: those can be tested by guessing, and a WhatsApp id can carry the number. Entries written since are keyed.`,
    "    - An Orders shop's \"area\" is the place on its delivery list, as the shop named it; the address a customer wrote is not in this package.",
    "    - accounts.json names the shop's own business number, because it is the shop's.",
  ].join("\n");
}

function FORMAT_README(m: Manifest): string {
  return `GEOMETER SHOP EXPORT (${EXPORT_FORMAT})
==========================================

This folder is everything that is ${m.shop}'s, taken out of Geometer in plain files, so it can be read, kept, and checked without Geometer.
Made ${m.exportedAt}${m.exportedBy ? ` for ${m.exportedBy.name} (${m.exportedBy.role})` : ""}. It was made from files only; nothing was sent to anyone, and no service was called.

WHAT IS IN IT
  manifest.json                 the shop, the time, the counts, and every other file with its sha256 and size
  SHA256SUMS                    the same sha256 values, in the format "sha256sum -c SHA256SUMS" reads (it covers manifest.json too)
  settings.json                 the shop's settings as they are on the server
  limits.json                   the limits the settings give: the refund and payment-link limits in Guard's own shape (amounts in paise),
                                the policy digest the go-live certificate names, and how many limits were proven to bite at the last deploy
  history/settings-history.jsonl  every saved version of the settings, one per line: {"at", "by", "digest", "settings"}. "digest" is the sha256 of the settings
                                written with sorted keys and no spaces. It starts when the panel began keeping it; manifest.json says from when.
  accounts.json                 which WhatsApp number, calendar and payment mode the shop used. Names and ids, never keys.
  record/record.jsonl           the record of what the agent did, tried, or was stopped from doing: one JSON entry per line, in order
                                {"seq","time","conversation","booking","action","inputsDigest","outcome","decisions","language","notes","refs"}.
                                "booking" holds the id of the booking (or the student's fee) the entry is about. "conversation" and customers are fingerprints (see PEOPLE IN THE RECORD).
  record/cases.jsonl            the bookings (or, for a Fees centre, the fees, or, for an Orders shop, the orders), one per line, as the agent held them. Customers are fingerprints (see PEOPLE IN THE RECORD); a delivery address is not in it.
  assignment.json               who serves the shop, and every move to another partner or builder with its date and reason (only when there has been one)
  status.json                   the deployer's last word on the shop (versions, limits proven, backups)
  reports/<month>/              each monthly report and its certificate: the signed .json and the readable .html
  certificates/go-live/         the go-live certificate: the signed .json and the readable .html
  identity.json                 the agent's stable id ({"id": "agt_..."}) and which fields its operator shows on the public identity paper (only when it has one)
  record/ledger/pack.json       the record as an evidence pack in geometer-verify's format: each entry chained to the one before it. The customer's number, the
                                note and a served page's address are left out of every entry, so they are not chained.
  record/ledger/anchor.json     the signed anchor over the pack's head when this package was made (only when the panel's key signed it)
  record/ledger/fingerprints.jsonl  the daily fingerprints the server published (or kept, before any public target was switched on): one line a day, each with
                                the entry count and the head, and its own signed anchor when the server had a key

HOW TO CHECK IT
  1. Nothing was changed after it was made:   sha256sum -c SHA256SUMS      (on a Mac: shasum -a 256 -c SHA256SUMS)
  2. The same check, and the signed papers, with the open tool in https://github.com/GeometerLabs/agents:
        node bundle/export/check.ts <this folder>
     It re-hashes every file against manifest.json, then checks every signed .json under reports/ and certificates/ the way the report verifier does.
  3. One signed paper on its own:
        node templates/commerce/bookings/scripts/verify-report.ts reports/2026-11/<the .json file>
     A signature shows that the paper has not changed since the key named in it signed it. It does not show who holds that key, and it does not show the numbers are true.
  4. The record itself, with the open verifier geo-verify (https://github.com/GeometerLabs/geometer-verify):
        geo-verify record/ledger/pack.json --anchor record/ledger/anchor.json
     Better: an anchor you kept from earlier, such as a fingerprint line's "anchor" saved to a file, or one from the public fingerprint file.
     "Verified" means the record was not changed since that anchor. It does not mean the record is true or complete.
     node bundle/export/check.ts runs it for you when GEO_VERIFY_BIN names the geo-verify program.
  geo-verify does not read the papers under reports/ and certificates/: they are in the report format; each names the ledger head it was made at ("anchor").

WHAT IS NOT IN IT, AND WHY
  - No key and no secret: no WhatsApp token, payment key, webhook secret, calendar key, signing key, passphrase or session. A shop moved to someone new needs new ones, entered by whoever serves it.
  - The shop's own accounts. The WhatsApp number, the payment account and the calendar belong to the shop; accounts.json only says which ones they were.
  - Customers' phone numbers and students' names in the record and the cases: these are fingerprints only the shop's key can match. See PEOPLE IN THE RECORD for what that covers and what it does not; settings.json is the main exception.
  - Anything after ${m.recordAsOf ?? "the deployer's last export of the record (it had made none)"}: the record is as the deployer last exported it.

PEOPLE IN THE RECORD
${peopleWords(m)}

${m.notes.map((n) => `NOTE: ${n}`).join("\n")}

Write to support. A person answers.
`;
}
