// Reading the go-live certificate a monthly report is given, and saying what its checks actually ran on.
//
// The monthly report used to assume the checks ran on Glow Salon's example settings, because it was never told otherwise. Now the caller hands
// it the go-live certificate (the file go-live-certificate.ts writes) and this decides what that file shows:
//   - the file is checked the way verify-report.ts checks any file (verifyEnvelopeText: canonical form, digest, code, signature) and must
//     be signed. A file that is missing, changed, unsigned, signed wrongly, or signed but not a go-live certificate is "untrusted": it is not
//     used, the report says so, and the report is still made.
//   - a certificate that passes says which settings its situations ran on (`checkedPolicyDigest`). If that is the digest of THIS shop's settings
//     the checks ran on this shop's own settings; if it is Glow Salon's digest they ran on the example shop; otherwise on different settings.
// A signature shows that whoever holds the key signed exactly these bytes and that they have not changed. It does not show who holds the key
// (anyone can sign a made-up certificate with their own key), so the key is named in the report and the reader decides whether it is the issuer's.
import type { Settings } from "../src/settings.ts";
import type { LocalDate } from "../src/time.ts";
import { checkedPolicyDigest, policyDigest } from "./data.ts";
import type { GoLiveFinding } from "./data.ts";
import { verifyEnvelopeText } from "./sign.ts";

const GO_LIVE_FORMAT = "geometer-go-live-certificate/1";
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

/** The go-live certificate's fields the report uses, or null if the document does not have them. */
function fieldsOf(document: unknown): { checkedPolicyDigest: string; issuedOn: LocalDate; held: number; total: number; failed: number; notRun: number; notTested: number } | null {
  if (!isObject(document) || document.format !== GO_LIVE_FORMAT) return null;
  const { checkedPolicyDigest: ran, issuedOn, checks, notTested } = document;
  if (typeof ran !== "string" || !DIGEST.test(ran) || !Array.isArray(notTested)) return null;
  if (!isObject(issuedOn) || !isCount(issuedOn.year) || !isCount(issuedOn.month) || !isCount(issuedOn.day) || issuedOn.month < 1 || issuedOn.month > 12 || issuedOn.day < 1 || issuedOn.day > 31) return null;
  if (!isObject(checks) || !isCount(checks.held) || !isCount(checks.total) || !isCount(checks.failed)) return null;
  const notRun = checks.notRun === undefined ? 0 : Array.isArray(checks.notRun) ? checks.notRun.length : -1;
  if (notRun < 0) return null;
  return { checkedPolicyDigest: ran, issuedOn: { year: issuedOn.year, month: issuedOn.month, day: issuedOn.day }, held: checks.held, total: checks.total, failed: checks.failed, notRun, notTested: notTested.length };
}

export interface GoLiveReading {
  finding: GoLiveFinding;
  /** One plain English sentence for the person running the script: what was found and what the report will say about it. */
  said: string;
}

const day = (d: LocalDate) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** What the person running the script is told when the certificate could not be trusted. The report itself says it without the reason. */
export function untrustedReading(why: string): GoLiveReading {
  return { finding: { status: "untrusted" }, said: `The go-live certificate could not be trusted (${why}), so it was not used. The report says that no go-live checks are shown for this shop's own settings.` };
}

/** Nothing was given. */
export const noReading = (): GoLiveReading => ({
  finding: { status: "none" },
  said: "No go-live certificate was given (--go-live <go-live-certificate.json>), so the report says no go-live certificate was given and lists the checks on this shop's own settings as not tested.",
});

/** Read the text of a go-live certificate file for this shop. Never throws: whatever is wrong with the file is an "untrusted" reading. */
export function readGoLiveCertificate(text: string, settings: Settings): GoLiveReading {
  const v = verifyEnvelopeText(text);
  if (!v.unchanged || !v.envelope) return untrustedReading("the file has been changed, or it is not a report or certificate file");
  if (!v.signed) return untrustedReading("it is not signed, so nothing shows it has not been made up");
  const fields = fieldsOf(v.envelope.document);
  if (!fields) return untrustedReading("it is not a go-live certificate");
  const seen = { code: v.envelope.code, signedBy: v.keyId as string, issuedOn: fields.issuedOn };
  const signed = `signed with ${seen.signedBy}, which does not show who holds that key`;
  if (fields.checkedPolicyDigest === policyDigest(settings)) {
    return {
      finding: { status: "own", ...seen, held: fields.held, total: fields.total, failed: fields.failed, notRun: fields.notRun, notTested: fields.notTested },
      said: `The go-live certificate of ${day(fields.issuedOn)} (${signed}) says its checks ran on this shop's own settings: held ${fields.held} of ${fields.total}, ${fields.failed} failed. The report says so.`,
    };
  }
  if (fields.checkedPolicyDigest === checkedPolicyDigest()) {
    return {
      finding: { status: "example", ...seen },
      said: `The go-live certificate of ${day(fields.issuedOn)} (${signed}) says its checks ran on Glow Salon's example settings, not on this shop's. The report says so and keeps this shop's own settings in the not-tested list.`,
    };
  }
  return {
    finding: { status: "different", ...seen },
    said: `The go-live certificate of ${day(fields.issuedOn)} (${signed}) says its checks ran on different settings from this shop's. The report says so and keeps this shop's own settings in the not-tested list.`,
  };
}
