// Reading the go-live certificate a monthly report is given, and saying what its checks actually ran on.
//
// The monthly report used to assume the checks ran on Glow Salon's example settings, because it was never told otherwise. Now the caller hands it the go-live certificate (the file
// go-live-certificate.ts writes) and this decides what that file shows. The reading itself is the same for every template (modules/report/go-live.ts, which explains what is
// checked and why a signature is not an identity); this file gives it Bookings' digests and words.
import { readGoLiveText, noGoLive, untrustedGoLive } from "../../../modules/report/go-live.ts";
import type { GoLiveReading, GoLiveSubject } from "../../../modules/report/go-live.ts";
import type { Settings } from "../src/settings.ts";
import { checkedPolicyDigest, policyDigest } from "./data.ts";

export type { GoLiveReading };

const subject = (settings: Settings): GoLiveSubject => ({ pathway: "bookings", ownDigest: policyDigest(settings), exampleDigest: checkedPolicyDigest(), noun: "shop", exampleName: "Glow Salon" });

/** What the person running the script is told when the certificate could not be trusted. The report itself says it without the reason. */
export const untrustedReading = (why: string): GoLiveReading => untrustedGoLive(why, { noun: "shop" });

/** Nothing was given. */
export const noReading = (): GoLiveReading => noGoLive({ noun: "shop" });

/** Read the text of a go-live certificate file for this shop. Never throws: whatever is wrong with the file is an "untrusted" reading. */
export const readGoLiveCertificate = (text: string, settings: Settings): GoLiveReading => readGoLiveText(text, subject(settings));
