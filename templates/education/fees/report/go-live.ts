// Reading the go-live certificate a monthly report is given, and saying what its checks actually ran on. The reading itself is the same for every template
// (modules/report/go-live.ts, which explains what is checked and why a signature is not an identity); this file gives it Fees' digests and words.
import { readGoLiveText, noGoLive, untrustedGoLive } from "../../../../modules/report/go-live.ts";
import type { GoLiveFinding, GoLiveReading, GoLiveSubject } from "../../../../modules/report/go-live.ts";
import type { Settings } from "../src/settings.ts";
import { checkedPolicyDigest, policyDigest } from "./data.ts";

export type { GoLiveFinding, GoLiveReading };

const subject = (settings: Settings): GoLiveSubject => ({ pathway: "fees", ownDigest: policyDigest(settings), exampleDigest: checkedPolicyDigest(), noun: "centre", exampleName: "Bright Tuition Centre" });

/** What the person running the script is told when the certificate could not be trusted. The report itself says it without the reason. */
export const untrustedReading = (why: string): GoLiveReading => untrustedGoLive(why, { noun: "centre" });

/** Nothing was given. */
export const noReading = (): GoLiveReading => noGoLive({ noun: "centre" });

/** Read the text of a go-live certificate file for this centre. Never throws: whatever is wrong with the file is an "untrusted" reading. */
export const readGoLiveCertificate = (text: string, settings: Settings): GoLiveReading => readGoLiveText(text, subject(settings));
