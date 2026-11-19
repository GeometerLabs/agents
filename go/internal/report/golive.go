// Reading the go-live certificate a monthly report is given, and saying what its checks actually ran on: modules/report/go-live.ts, the same for every template (a template gives the
// digests of its own settings and the words it uses for a client). The monthly report must not assume the hand check ran on this client's own settings: the caller hands it the
// go-live certificate (the file the template's go-live-certificate script writes) and ReadGoLiveText decides what that file shows. Reading the file from disk is the caller's
// (templates/commerce/bookings/report/cli.ts readGoLive does it): a file that is missing is NoGoLive or UntrustedGoLive, never a stop.
//
//   - the file is checked the way verify-report checks any file (VerifyEnvelopeText) and must be signed; a file that is changed, unsigned, signed wrongly, not a go-live
//     certificate, or a go-live certificate of ANOTHER template is "untrusted": it is not used, the report says so, and the report is still made;
//   - a certificate that passes says which settings its situations ran on: this client's own, the example's, or different ones.
//
// A signature shows that whoever holds the key signed exactly these bytes and that they have not changed; it does not show who holds the key.
//
// The certificate's JSON is read by encoding/json with numbers kept as json.Number (a JSON.parse double): "is a count" means a whole number of 0 or more, as Number.isInteger does.
package report

import (
	"encoding/json"
	"fmt"
	"math"

	"github.com/GeometerLabs/agents/go/internal/zone"
)

// GoLiveFormat is GO_LIVE_FORMAT.
const GoLiveFormat = "geometer-go-live-certificate/1"

// GoLiveFinding is what the monthly report was told about the go-live checks. Status is "none" (no certificate given), "untrusted", "own" (its checks ran on this client's own
// settings: the counts are set, as the certificate states them), "example" or "different" (Code, SignedBy and IssuedOn are set for these three too).
type GoLiveFinding struct {
	Status                                 string
	Code, SignedBy                         string
	IssuedOn                               zone.Date
	Held, Total, Failed, NotRun, NotTested int
}

// GoLiveReading is a finding and one plain English sentence for the person running the script: what was found and what the report will say about it.
type GoLiveReading struct {
	Finding GoLiveFinding
	Said    string
}

// GoLiveSubject is what a template says about itself: Pathway lists the template names whose certificate it accepts (Bookings also reads the own-agent certificates), the digest of
// this client's own settings and of the example settings, what it calls its client in a sentence ("shop", "centre") and its example ("Glow Salon").
type GoLiveSubject struct {
	Pathway       []string
	OwnDigest     string
	ExampleDigest string
	Noun          string
	ExampleName   string
}

func isObject(v any) (map[string]any, bool) { m, ok := v.(map[string]any); return m, ok }

// count is isCount: a whole number of 0 or more.
func count(v any) (int, bool) {
	var f float64
	switch x := v.(type) {
	case json.Number:
		var err error
		if f, err = x.Float64(); err != nil {
			return 0, false
		}
	case float64:
		f = x
	case int:
		f = float64(x)
	default:
		return 0, false
	}
	if f != math.Trunc(f) || f < 0 || f > math.MaxInt32 {
		return 0, false
	}
	return int(f), true
}

type goLiveFields struct {
	checkedPolicyDigest                    string
	issuedOn                               zone.Date
	held, total, failed, notRun, notTested int
	pathway                                *string
}

// goLiveFieldsOf is fieldsOf: the go-live certificate's fields the report uses, or ok=false if the document does not have them.
func goLiveFieldsOf(document any) (goLiveFields, bool) {
	var f goLiveFields
	doc, ok := isObject(document)
	if !ok || doc["format"] != GoLiveFormat {
		return f, false
	}
	ran, isStr := doc["checkedPolicyDigest"].(string)
	notTested, isArr := doc["notTested"].([]any)
	if !isStr || !sha256Re.MatchString(ran) || !isArr {
		return f, false
	}
	on, ok := isObject(doc["issuedOn"])
	if !ok {
		return f, false
	}
	y, ok1 := count(on["year"])
	m, ok2 := count(on["month"])
	d, ok3 := count(on["day"])
	if !ok1 || !ok2 || !ok3 || m < 1 || m > 12 || d < 1 || d > 31 {
		return f, false
	}
	checks, ok := isObject(doc["checks"])
	if !ok {
		return f, false
	}
	held, ok1 := count(checks["held"])
	total, ok2 := count(checks["total"])
	failed, ok3 := count(checks["failed"])
	if !ok1 || !ok2 || !ok3 {
		return f, false
	}
	notRun := 0
	if nr, has := checks["notRun"]; has { // undefined is 0, an array is its length, anything else is not a certificate
		arr, isA := nr.([]any)
		if !isA {
			return f, false
		}
		notRun = len(arr)
	}
	var pathway *string
	if p, ok := isObject(doc["pathway"]); ok {
		if name, isS := p["name"].(string); isS {
			pathway = &name
		}
	}
	return goLiveFields{ran, zone.Date{Year: y, Month: m, Day: d}, held, total, failed, notRun, len(notTested), pathway}, true
}

// UntrustedGoLive is untrustedGoLive: what the person running the script is told when the certificate could not be trusted. The report itself says it without the reason.
func UntrustedGoLive(why, noun string) GoLiveReading {
	return GoLiveReading{Finding: GoLiveFinding{Status: "untrusted"}, Said: fmt.Sprintf("The go-live certificate could not be trusted (%s), so it was not used. The report says that no go-live checks are shown for this %s's own settings.", why, noun)}
}

// NoGoLive is noGoLive: nothing was given.
func NoGoLive(noun string) GoLiveReading {
	return GoLiveReading{Finding: GoLiveFinding{Status: "none"}, Said: fmt.Sprintf("No go-live certificate was given (--go-live <go-live-certificate.json>), so the report says no go-live certificate was given and lists the checks on this %s's own settings as not tested.", noun)}
}

// ReadGoLiveText is readGoLiveText: read the text of a go-live certificate file for this client. It never fails: whatever is wrong with the file is an "untrusted" reading.
func ReadGoLiveText(text string, subject GoLiveSubject) GoLiveReading {
	v := VerifyEnvelopeText(text, nil)
	if !v.Unchanged || v.Envelope == nil {
		return UntrustedGoLive("the file has been changed, or it is not a report or certificate file", subject.Noun)
	}
	if !v.Signed {
		return UntrustedGoLive("it is not signed, so nothing shows it has not been made up", subject.Noun)
	}
	fields, ok := goLiveFieldsOf(v.Envelope.Document)
	if !ok {
		return UntrustedGoLive("it is not a go-live certificate", subject.Noun)
	}
	if fields.pathway != nil {
		accepted := false
		for _, p := range subject.Pathway {
			accepted = accepted || p == *fields.pathway
		}
		if !accepted {
			return UntrustedGoLive(fmt.Sprintf("it is a go-live certificate of the %s template, not %s", *fields.pathway, subject.Pathway[0]), subject.Noun)
		}
	}
	seen := GoLiveFinding{Code: v.Envelope.Code, SignedBy: *v.KeyID, IssuedOn: fields.issuedOn}
	day := DayOf(fields.issuedOn)
	signed := fmt.Sprintf("signed with %s, which does not show who holds that key", seen.SignedBy)
	switch fields.checkedPolicyDigest {
	case subject.OwnDigest:
		seen.Status, seen.Held, seen.Total, seen.Failed, seen.NotRun, seen.NotTested = "own", fields.held, fields.total, fields.failed, fields.notRun, fields.notTested
		return GoLiveReading{seen, fmt.Sprintf("The go-live certificate of %s (%s) says its checks ran on this %s's own settings: held %d of %d, %d failed. The report says so.", day, signed, subject.Noun, fields.held, fields.total, fields.failed)}
	case subject.ExampleDigest:
		seen.Status = "example"
		return GoLiveReading{seen, fmt.Sprintf("The go-live certificate of %s (%s) says its checks ran on %s's example settings, not on this %s's. The report says so and keeps this %s's own settings in the not-tested list.", day, signed, subject.ExampleName, subject.Noun, subject.Noun)}
	}
	seen.Status = "different"
	return GoLiveReading{seen, fmt.Sprintf("The go-live certificate of %s (%s) says its checks ran on different settings from this %s's. The report says so and keeps this %s's own settings in the not-tested list.", day, signed, subject.Noun, subject.Noun)}
}
