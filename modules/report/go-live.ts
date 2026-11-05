// Reading the go-live certificate a monthly report is given, and saying what its checks actually ran on. The same for every template; a template gives the digests of
// its own settings and the words it uses for a client ("shop", "centre").
//
// The monthly report must not assume that the hand check ran on this client's own settings. The caller hands it the go-live certificate (the file the template's
// go-live-certificate script writes) and this decides what that file shows:
//   - the file is checked the way verify-report.ts checks any file (verifyEnvelopeText: canonical form, digest, code, signature) and must be signed. A file that is missing,
//     changed, unsigned, signed wrongly, signed but not a go-live certificate, or a go-live certificate of ANOTHER template is "untrusted": it is not used, the report says
//     so, and the report is still made.
//   - a certificate that passes says which settings its situations ran on (`checkedPolicyDigest`). If that is the digest of THIS client's settings the checks ran on this
//     client's own settings; if it is the example's digest they ran on the example; otherwise on different settings.
// A signature shows that whoever holds the key signed exactly these bytes and that they have not changed. It does not show who holds the key (anyone can sign a made-up
// certificate with their own key), so the key is named in the report and the reader decides whether it is the issuer's.
import type { LocalDate } from "../core/time.ts";
import { verifyEnvelopeText } from "./sign.ts";

export const GO_LIVE_FORMAT = "geometer-go-live-certificate/1";
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

/**
 * What the monthly report was told about the go-live checks, from the go-live certificate it was given. Only a certificate whose signature is good and whose document is a
 * go-live certificate of this template is ever read; anything else is "untrusted", and no certificate at all is "none". For a certificate that was read, `own` says its
 * checks ran on this client's own settings (the digest of the settings they ran on is the digest of this client's), `example` that they ran on the example's settings,
 * `different` on any other settings. Counts are carried only for `own`, as the certificate states them: a count from settings that are not this client's would be read as its.
 */
export interface GoLiveSeen { code: string; signedBy: string; issuedOn: LocalDate }
export type GoLiveFinding =
  | { status: "none" }
  | { status: "untrusted" }
  | ({ status: "own"; held: number; total: number; failed: number; notRun: number; notTested: number } & GoLiveSeen)
  | ({ status: "example" | "different" } & GoLiveSeen);

export interface GoLiveReading {
  finding: GoLiveFinding;
  /** One plain English sentence for the person running the script: what was found and what the report will say about it. */
  said: string;
}

/** What a template says about itself. */
export interface GoLiveSubject {
  /** The pathway whose certificate this is ("bookings", "fees"): a certificate of another one is not used. */
  pathway: string;
  /** The digest of this client's own settings, and of the example settings the hand check runs on when it is given none. */
  ownDigest: string;
  exampleDigest: string;
  /** What the template calls its client in a sentence ("shop", "centre"), and its example ("Glow Salon"). */
  noun: string;
  exampleName: string;
}

/** The go-live certificate's fields the report uses, or null if the document does not have them. */
function fieldsOf(document: unknown): { checkedPolicyDigest: string; issuedOn: LocalDate; held: number; total: number; failed: number; notRun: number; notTested: number; pathway: string | undefined } | null {
  if (!isObject(document) || document.format !== GO_LIVE_FORMAT) return null;
  const { checkedPolicyDigest: ran, issuedOn, checks, notTested } = document;
  if (typeof ran !== "string" || !DIGEST.test(ran) || !Array.isArray(notTested)) return null;
  if (!isObject(issuedOn) || !isCount(issuedOn.year) || !isCount(issuedOn.month) || !isCount(issuedOn.day) || issuedOn.month < 1 || issuedOn.month > 12 || issuedOn.day < 1 || issuedOn.day > 31) return null;
  if (!isObject(checks) || !isCount(checks.held) || !isCount(checks.total) || !isCount(checks.failed)) return null;
  const notRun = checks.notRun === undefined ? 0 : Array.isArray(checks.notRun) ? checks.notRun.length : -1;
  if (notRun < 0) return null;
  const pathway = isObject(document.pathway) && typeof document.pathway.name === "string" ? document.pathway.name : undefined;
  return { checkedPolicyDigest: ran, issuedOn: { year: issuedOn.year, month: issuedOn.month, day: issuedOn.day }, held: checks.held, total: checks.total, failed: checks.failed, notRun, notTested: notTested.length, pathway };
}

const day = (d: LocalDate) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** What the person running the script is told when the certificate could not be trusted. The report itself says it without the reason. */
export function untrustedGoLive(why: string, subject: Pick<GoLiveSubject, "noun">): GoLiveReading {
  return { finding: { status: "untrusted" }, said: `The go-live certificate could not be trusted (${why}), so it was not used. The report says that no go-live checks are shown for this ${subject.noun}'s own settings.` };
}

/** Nothing was given. */
export const noGoLive = (subject: Pick<GoLiveSubject, "noun">): GoLiveReading => ({
  finding: { status: "none" },
  said: `No go-live certificate was given (--go-live <go-live-certificate.json>), so the report says no go-live certificate was given and lists the checks on this ${subject.noun}'s own settings as not tested.`,
});

/** Read the text of a go-live certificate file for this client. Never throws: whatever is wrong with the file is an "untrusted" reading. */
export function readGoLiveText(text: string, subject: GoLiveSubject): GoLiveReading {
  const v = verifyEnvelopeText(text);
  if (!v.unchanged || !v.envelope) return untrustedGoLive("the file has been changed, or it is not a report or certificate file", subject);
  if (!v.signed) return untrustedGoLive("it is not signed, so nothing shows it has not been made up", subject);
  const fields = fieldsOf(v.envelope.document);
  if (!fields) return untrustedGoLive("it is not a go-live certificate", subject);
  if (fields.pathway !== undefined && fields.pathway !== subject.pathway) return untrustedGoLive(`it is a go-live certificate of the ${fields.pathway} template, not ${subject.pathway}`, subject);
  const seen = { code: v.envelope.code, signedBy: v.keyId as string, issuedOn: fields.issuedOn };
  const signed = `signed with ${seen.signedBy}, which does not show who holds that key`;
  if (fields.checkedPolicyDigest === subject.ownDigest) {
    return {
      finding: { status: "own", ...seen, held: fields.held, total: fields.total, failed: fields.failed, notRun: fields.notRun, notTested: fields.notTested },
      said: `The go-live certificate of ${day(fields.issuedOn)} (${signed}) says its checks ran on this ${subject.noun}'s own settings: held ${fields.held} of ${fields.total}, ${fields.failed} failed. The report says so.`,
    };
  }
  if (fields.checkedPolicyDigest === subject.exampleDigest) {
    return {
      finding: { status: "example", ...seen },
      said: `The go-live certificate of ${day(fields.issuedOn)} (${signed}) says its checks ran on ${subject.exampleName}'s example settings, not on this ${subject.noun}'s. The report says so and keeps this ${subject.noun}'s own settings in the not-tested list.`,
    };
  }
  return {
    finding: { status: "different", ...seen },
    said: `The go-live certificate of ${day(fields.issuedOn)} (${signed}) says its checks ran on different settings from this ${subject.noun}'s. The report says so and keeps this ${subject.noun}'s own settings in the not-tested list.`,
  };
}
