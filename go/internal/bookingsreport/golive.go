// Reading the go-live certificate a monthly report is given, and saying what its checks actually ran on: templates/commerce/bookings/report/go-live.ts (the subject: Bookings' digests and
// words) and the part of report/cli.ts the runtime imports (`readGoLive`, which server/start.ts calls). The reading itself is the same for every template (report.ReadGoLiveText).
// A file that is missing, unreadable, unsigned, changed or not a go-live certificate is NOT a reason to stop: it becomes a reading that says the certificate could not be trusted, the
// report says so, and it is still made. The go-live certificate is MADE by the CLI and the deployer (TypeScript); the runtime only reads it.
//
// Not ported from cli.ts: the command-line frame (`main`, `UsageError`, `readJson`, `readKey`, `readNow`, `readSettings` (validateSettings), `readBookings`): scripts, not the runtime.
package bookingsreport

import (
	"github.com/GeometerLabs/agents/go/internal/report"
)

// GoLiveSubject is subject(settings): Bookings accepts its own certificates and the own-agent ones ("bring your own agent", checked against Bookings-shaped settings).
func GoLiveSubject(s Settings) report.GoLiveSubject {
	return report.GoLiveSubject{Pathway: []string{"bookings", "own-agent"}, OwnDigest: PolicyDigest(s), ExampleDigest: CheckedPolicyDigest(), Noun: "shop", ExampleName: "Glow Salon"}
}

// ReadGoLiveCertificate is readGoLiveCertificate: read the text of a go-live certificate file for this shop. It never fails.
func ReadGoLiveCertificate(text string, s Settings) report.GoLiveReading {
	return report.ReadGoLiveText(text, GoLiveSubject(s))
}

// ReadGoLive is cli.ts readGoLive(path, settings): the go-live certificate for a monthly report. An empty path is "none given" (the reading itself is report.ReadGoLiveFile, the same for
// every template).
func ReadGoLive(path string, s Settings) report.GoLiveReading {
	return report.ReadGoLiveFile(path, "shop", func() report.GoLiveSubject { return GoLiveSubject(s) })
}
