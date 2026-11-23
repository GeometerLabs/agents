// What the report reads of the centre's settings (templates/education/fees/src/settings.ts) and of the crash test (crash-test/not-tested.ts), and the digest of the limits.
//
// Settings are carried as a JSON tree (bookingsreport.Settings, `map[string]any`, numbers as float64), as for Bookings and Orders: the report needs the name, the time zone, the languages,
// the owner's language, the payment module and whether the centre has Classes, but the POLICY DIGEST is the digest of the whole settings without the address and the students' list (a
// count instead) and with the owner reduced to their language (data.ts policyOf), so the whole tree is kept and digested with report.CanonicalJSON, the same bytes as the TypeScript's
// canonicalJson. Unlike Orders' policy, the payment block is kept whole here, as the TypeScript keeps it.
//
// IMPORTANT, the caller's duty: the TypeScript digests the settings AS VALIDATED (validateSettings fills defaults and trims the name), not as the file was written. The tree handed in
// must be what Fees' validateSettings returns, as JSON: fees.Settings.Tree() makes it, and a vector holds that it digests the same as the TypeScript's.
//
// Students' names: the tree holds them (they are in settings.students) but the policy reduces students to a COUNT, and nothing else of the report reads them, so no name reaches a report
// file or the owner's message. A vector puts names in the settings and in the record's notes and scans every file and message for them.
package feesreport

import (
	"github.com/GeometerLabs/agents/go/internal/bookingsreport"
	"github.com/GeometerLabs/agents/go/internal/report"
)

// Settings is the centre's validated settings as a JSON tree.
type Settings = bookingsreport.Settings

// ShopView is what the report reads of the settings; ShopOf and ConfirmsAutomatically are Bookings' (the same reading and the same payment providers' capabilities, which the
// TypeScript takes from modules/payments for every template).
type ShopView = bookingsreport.ShopView

// ShopOf reads the fields the report needs, or says which one is missing or of the wrong kind.
func ShopOf(s Settings) (ShopView, error) { return bookingsreport.ShopOf(s) }

// ConfirmsAutomatically is capabilitiesOf(settings.payment).confirmsAutomatically; false is a UPI centre, whose owner marks each payment.
func ConfirmsAutomatically(sh ShopView) bool { return bookingsreport.ConfirmsAutomatically(sh) }

// PolicyOf is policyOf: what governs how the agent behaves and speaks, without contact details: every setting but the address, with the owner reduced to their language and the students
// reduced to how many there are. `students` of a tree that has none is the count 0 (the TypeScript's `settings.students.length`).
func PolicyOf(s Settings) map[string]any {
	out := make(map[string]any, len(s))
	for k, v := range s {
		if k != "address" && k != "owner" && k != "students" {
			out[k] = v
		}
	}
	var owner any
	if m, ok := s["owner"].(map[string]any); ok {
		owner = m["language"] // absent: nil, the TypeScript's undefined, written as null
	}
	out["owner"] = map[string]any{"language": owner}
	students, _ := s["students"].([]any)
	out["students"] = len(students)
	// the credit book's people are counted like the students (data.ts policyOf), whether the tree holds them (as validated) or already their count (fees.Settings.ReportTree)
	if cb, ok := s["creditBook"].(map[string]any); ok {
		if people, isList := cb["people"].([]any); isList {
			cp := make(map[string]any, len(cb))
			for k, v := range cb {
				cp[k] = v
			}
			cp["people"] = len(people)
			out["creditBook"] = cp
		}
	}
	return out
}

// PolicyDigest is policyDigest: two centres with the same digest have the same limits and words.
func PolicyDigest(s Settings) string { return report.DigestOf(PolicyOf(s)) }

// CheckedPolicyDigest is checkedPolicyDigest(): the digest of the example settings (Bright Tuition Centre's) the hand check runs on when it is given none. It is a constant made by
// running the TypeScript (words.json.gz facts), so Go does not need harness.ts.
func CheckedPolicyDigest() string { return loadWords().Facts.CheckedPolicyDigest }

// NotTestedOf is notTestedOf(settings): the hand check's list (ids), and for a UPI centre the UPI lines in place of the Razorpay ones. NOTE the TypeScript's two different tests of "is it
// UPI": notTestedOf compares the module's name with "upi" literally (so settings with no payment block, or an unknown module, get the Razorpay list), while the report's `upi` flag
// (paidBy) is "the provider cannot confirm by itself" (ConfirmsAutomatically): each is ported as written.
func NotTestedOf(sh ShopView) []string {
	f := &loadWords().Facts
	if !sh.HasPayment || sh.PaymentModule != "upi" {
		return append([]string{}, f.NotTested...)
	}
	var out []string
	for _, id := range f.NotTested {
		if id != "payments-outside-razorpay" && id != "real-razorpay" {
			out = append(out, id)
		}
	}
	return append(out, f.UpiNotTested...)
}

// NotTestedForReport is notTestedForReport(goLive, settings): the hand check's list, and one more unless a go-live certificate shows the checks ran on this centre's own settings with
// nothing left out.
func NotTestedForReport(goLive report.GoLiveFinding, sh ShopView) []string {
	ids := NotTestedOf(sh)
	switch goLive.Status {
	case "own":
		if goLive.NotRun > 0 {
			return append(ids, "situations-skipped")
		}
		return ids
	case "example":
		return append(ids, "own-settings")
	case "different":
		return append(ids, "other-settings")
	case "untrusted":
		return append(ids, "go-live-untrusted")
	}
	return append(ids, "no-go-live-certificate") // "none"
}

// hasClasses is `settings.classes` as a condition: the centre has the Classes add-on (the member is there and is not null).
func hasClasses(s Settings) bool { v, ok := s["classes"]; return ok && v != nil }

// hasCredit is `settings.creditBook` as a condition: the shop keeps the credit book.
func hasCredit(s Settings) bool { v, ok := s["creditBook"]; return ok && v != nil }
