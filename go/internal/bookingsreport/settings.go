// What the report reads of the shop's Settings (templates/commerce/bookings/src/settings.ts) and of the crash test (crash-test/not-tested.ts), and the digest of the limits.
//
// Settings are carried as a JSON tree (`map[string]any`, numbers as float64): the report never needs more than the name, the time zone, the languages, the owner's language and the
// payment module, but the POLICY DIGEST is the digest of the whole settings without the address and with the owner reduced to their language (data.ts policyOf), so the whole tree is
// kept and digested with report.CanonicalJSON, the same bytes as the TypeScript's canonicalJson.
//
// IMPORTANT, the caller's duty: the TypeScript digests the settings AS VALIDATED (validateSettings fills defaults: the time zone, `bufferMinutes` 0, `languages`, trims the name, reads
// each service and the payment block), not as the file was written. validateSettings is NOT ported here, and the file on disk is NOT always the validated tree: `geometer deploy`
// (bundle/geometer.ts) checks the settings file and then ships its text as the owner wrote it, and only the TypeScript runtime validates on load. So the tree handed in must be what
// validateSettings returns, as JSON; a raw file that leaves a default out or pads the name gives another digest, and a go-live certificate of the same settings (which the CLI makes
// from the validated settings) would then be read as "different" instead of "own". Until the Bookings runtime has its own validateSettings port (Deferred.md), this is the one
// known way for Go and TypeScript to disagree about a shop. The generator's vectors hold both digests (`policies.raw`) and fail when the validated settings' digest changes when they go
// through JSON (it does not, for the settings used).
//
// Where Go differs: an undefined value inside the settings is "null" in canonicalJson but absent after a JSON round trip; a validated tree has none.
package bookingsreport

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/GeometerLabs/agents/go/internal/report"
)

// Settings is the shop's validated settings as a JSON tree.
type Settings = map[string]any

// ParseSettings reads settings.json: an object. Numbers become float64, as JSON.parse reads them.
func ParseSettings(raw []byte) (Settings, error) {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	m, ok := v.(map[string]any)
	if !ok {
		return nil, errors.New("The settings must be an object with the business's name, services, hours and so on.")
	}
	return m, nil
}

// ShopView is what the report reads of the settings.
type ShopView struct {
	Name          string
	Timezone      string
	Languages     []string
	OwnerLanguage string
	// PaymentModule is settings.payment.module; HasPayment is false when there is no payment block (a draft), which is read as the default provider's (UPI), never as a gateway.
	PaymentModule string
	HasPayment    bool
}

// ShopOf reads the fields the report needs, or says which one is missing or of the wrong kind.
func ShopOf(s Settings) (ShopView, error) {
	var sh ShopView
	var ok bool
	if sh.Name, ok = s["name"].(string); !ok {
		return sh, errors.New("The settings have no name (\"name\").")
	}
	if sh.Timezone, ok = s["timezone"].(string); !ok {
		return sh, errors.New("The settings have no time zone (\"timezone\").")
	}
	langs, ok := s["languages"].([]any)
	if !ok {
		return sh, errors.New("The settings have no languages (\"languages\").")
	}
	for _, l := range langs {
		str, ok := l.(string)
		if !ok {
			return sh, fmt.Errorf("The language %v is not text.", l)
		}
		sh.Languages = append(sh.Languages, str)
	}
	owner, ok := s["owner"].(map[string]any)
	if !ok {
		return sh, errors.New("The settings have no owner (\"owner\").")
	}
	if sh.OwnerLanguage, ok = owner["language"].(string); !ok {
		return sh, errors.New("The owner has no language (\"owner.language\").")
	}
	if p, isObj := s["payment"].(map[string]any); isObj {
		sh.HasPayment = true
		sh.PaymentModule, _ = p["module"].(string)
	}
	return sh, nil
}

// PolicyOf is policyOf: what governs how the agent behaves and speaks, without contact details: every setting but the address, with the owner reduced to their language.
func PolicyOf(s Settings) map[string]any {
	out := make(map[string]any, len(s))
	for k, v := range s {
		if k != "address" && k != "owner" {
			out[k] = v
		}
	}
	var lang any // an owner with no language is undefined, which canonicalJson writes as null
	if owner, ok := s["owner"].(map[string]any); ok {
		if l, has := owner["language"]; has {
			lang = l
		}
	}
	out["owner"] = map[string]any{"language": lang}
	return out
}

// PolicyDigest is policyDigest: two shops with the same digest have the same limits and words.
func PolicyDigest(s Settings) string { return report.DigestOf(PolicyOf(s)) }

// CheckedPolicyDigest is checkedPolicyDigest(): the digest of the example settings (Glow Salon's) the hand check runs on when it is given none. It is a constant made by running
// the TypeScript (words.json.gz facts), so Go does not need harness.ts.
func CheckedPolicyDigest() string { return loadWords().Facts.CheckedPolicyDigest }

// ConfirmsAutomatically is capabilitiesOf(settings.payment).confirmsAutomatically: the provider whose id is the payment module, else the default provider's (an unknown module, or no payment
// block, is read as the default, never as a gateway). A shop where this is false is a UPI shop: its owner marks each payment.
func ConfirmsAutomatically(sh ShopView) bool {
	f := loadWords().Facts.Payments
	if sh.HasPayment {
		if v, ok := f.ConfirmsAutomatically[sh.PaymentModule]; ok {
			return v
		}
	}
	return f.ConfirmsAutomatically[f.DefaultProvider]
}

// NotTested is crash-test/not-tested.ts NotTested without its English text: the id (what a report lists) and whether the owner's short form names it.
type NotTested struct {
	ID       string
	ForOwner bool
}

func notTestedItems(in []notTestedItem) []NotTested {
	out := make([]NotTested, len(in))
	for i, n := range in {
		out[i] = NotTested{n.ID, n.ForOwner}
	}
	return out
}

// NotTestedList is NOT_TESTED, and UpiNotTestedList is UPI_NOT_TESTED.
func NotTestedList() []NotTested    { return notTestedItems(loadWords().Facts.NotTested) }
func UpiNotTestedList() []NotTested { return notTestedItems(loadWords().Facts.UpiNotTested) }

// NotTestedOf is notTestedOf(settings): the list, and for a UPI shop the UPI lines in place of the Razorpay ones. NOTE the TypeScript's two different tests of "is it UPI":
// notTestedOf compares the module's name with "upi" literally (so a settings tree with no payment block, or an unknown module, gets the Razorpay list), while the report's `upi` flag (paidBy)
// is "the provider cannot confirm by itself" (ConfirmsAutomatically): each is ported as written, and a vector holds a module that is neither.
func NotTestedOf(sh ShopView) []NotTested {
	if !sh.HasPayment || sh.PaymentModule != "upi" {
		return NotTestedList()
	}
	var out []NotTested
	for _, n := range NotTestedList() {
		if n.ID != "payments-outside-razorpay" && n.ID != "real-razorpay" && n.ID != "webhook-signatures" {
			out = append(out, n)
		}
	}
	return append(out, UpiNotTestedList()...)
}

// NotTestedForReport is notTestedForReport(goLive, settings): the hand check's list, and one more unless a go-live certificate shows the checks ran on this shop's own settings with
// nothing left out. (notTestedFor, which the go-live CERTIFICATE's builder calls, is not ported: see Explanation.md.)
func NotTestedForReport(goLive report.GoLiveFinding, sh ShopView) []string {
	var ids []string
	for _, n := range NotTestedOf(sh) {
		ids = append(ids, n.ID)
	}
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
