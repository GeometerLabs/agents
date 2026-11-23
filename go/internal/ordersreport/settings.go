// What the report reads of the shop's Settings (templates/commerce/orders/src/settings.ts) and of the crash test (crash-test/not-tested.ts), and the digest of the limits.
//
// Settings are carried as a JSON tree (bookingsreport.Settings, `map[string]any`, numbers as float64): the report needs the name, the time zone, the languages, the owner's language, the
// payment module, the menu and whether there are plans, but the POLICY DIGEST is the digest of the whole settings without the address and with the owner reduced to their language and
// the line above which they approve, and the payment reduced to its module (data.ts policyOf), so the whole tree is kept and digested with report.CanonicalJSON, the same bytes as the
// TypeScript's canonicalJson.
//
// IMPORTANT, the caller's duty (as for Bookings): the TypeScript digests the settings AS VALIDATED (validateSettings fills defaults and trims the name), not as the file was written. The tree
// handed in must be what Orders' validateSettings returns, as JSON; a raw file that leaves a default out gives another digest, and a go-live certificate of the same settings would then
// be read as "different" instead of "own". The generator's vectors hold both digests and fail when the validated settings' digest changes when they go through JSON.
//
// Where Go differs: an undefined value inside the settings is "null" in canonicalJson but absent after a JSON round trip; a validated tree has none.
package ordersreport

import (
	"github.com/GeometerLabs/agents/go/internal/bookingsreport"
	"github.com/GeometerLabs/agents/go/internal/report"
)

// Settings is the shop's validated settings as a JSON tree.
type Settings = bookingsreport.Settings

// ShopView is what the report reads of the settings (name, time zone, languages, owner's language, payment module); ShopOf and ConfirmsAutomatically are Bookings' (the same reading and the
// same payment providers' capabilities, which the TypeScript takes from modules/payments for every template).
type ShopView = bookingsreport.ShopView

// ShopOf reads the fields the report needs, or says which one is missing or of the wrong kind.
func ShopOf(s Settings) (ShopView, error) { return bookingsreport.ShopOf(s) }

// ConfirmsAutomatically is capabilitiesOf(settings.payment).confirmsAutomatically; false is a UPI shop, whose owner marks each payment.
func ConfirmsAutomatically(sh ShopView) bool { return bookingsreport.ConfirmsAutomatically(sh) }

// PolicyOf is policyOf: what governs how the agent behaves and speaks, without contact details: every setting but the address, with the owner reduced to their language and
// `approveOverInr` and the payment reduced to its module. A missing member is undefined in the TypeScript, which canonicalJson writes as null.
func PolicyOf(s Settings) map[string]any {
	out := make(map[string]any, len(s))
	for k, v := range s {
		if k != "address" && k != "owner" && k != "payment" {
			out[k] = v
		}
	}
	pick := func(from any, key string) any {
		if m, ok := from.(map[string]any); ok {
			return m[key] // absent: nil, the TypeScript's undefined, written as null
		}
		return nil
	}
	out["owner"] = map[string]any{"language": pick(s["owner"], "language"), "approveOverInr": pick(s["owner"], "approveOverInr")}
	out["payment"] = map[string]any{"module": pick(s["payment"], "module")}
	return out
}

// PolicyDigest is policyDigest: two shops with the same digest have the same limits and words.
func PolicyDigest(s Settings) string { return report.DigestOf(PolicyOf(s)) }

// CheckedPolicyDigest is checkedPolicyDigest(): the digest of the example settings (Annapurna Tiffins') the hand check runs on when it is given none. It is a constant made by running
// the TypeScript (words.json.gz facts), so Go does not need harness.ts.
func CheckedPolicyDigest() string { return loadWords().Facts.CheckedPolicyDigest }

// NotTestedOf is notTestedOf(settings): the hand check's list (ids), and for a UPI shop the UPI lines in place of the Razorpay ones. NOTE the TypeScript's two different tests of "is it
// UPI": notTestedOf compares the module's name with "upi" literally (so settings with no payment block, or an unknown module, get the Razorpay list), while the report's `upi` flag
// (paidBy) is "the provider cannot confirm by itself" (ConfirmsAutomatically): each is ported as written. Unlike Bookings, only two ids are dropped for UPI (webhook-signatures stays).
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

// NotTestedForReport is notTestedForReport(goLive, settings): the hand check's list, and one more unless a go-live certificate shows the checks ran on this shop's own settings with
// nothing left out. (notTestedFor, which the go-live CERTIFICATE's builder calls, is not ported: see Deferred.md.)
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

// menuItem is what the report reads of one menu item (settings.menu[i]).
type menuItem struct {
	id    string
	names map[string][]any
}

func menuOf(s Settings) []menuItem {
	list, _ := s["menu"].([]any)
	var out []menuItem
	for _, raw := range list {
		m, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		it := menuItem{names: map[string][]any{}}
		it.id, _ = m["id"].(string)
		if names, ok := m["names"].(map[string]any); ok {
			for lang, v := range names {
				if arr, ok := v.([]any); ok {
					it.names[lang] = arr
				}
			}
		}
		out = append(out, it)
	}
	return out
}

// itemName is settings.ts itemName: the name the agent says for an item in a language, falling back to English, then Hindi, Malayalam and Kannada, then the id. `names[l]?.[0] ?? ...`:
// a language with no names, or an empty list, falls through to the next.
func itemName(it menuItem, lang string) string {
	for _, l := range []string{lang, "en", "hi", "ml", "kn"} {
		if arr := it.names[l]; len(arr) > 0 && arr[0] != nil {
			if s, ok := arr[0].(string); ok {
				return s
			}
		}
	}
	return it.id
}

// hasPlans is `settings.plans` as a condition: the shop has monthly plans (the member is there and is not null or false).
func hasPlans(s Settings) bool {
	v, ok := s["plans"]
	if !ok || v == nil {
		return false
	}
	b, isBool := v.(bool)
	return !isBool || b
}
