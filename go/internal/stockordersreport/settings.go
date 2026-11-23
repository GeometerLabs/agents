// What the report reads of the shop's Settings (templates/commerce/stock-orders/src/settings.ts) and of the crash test (crash-test/not-tested.ts), and the digest of the limits.
//
// Settings are carried as a JSON tree (bookingsreport.Settings, `map[string]any`, numbers as float64), as the Bookings and Orders reports carry them: the report needs the name, the time
// zone, the languages, the owner's language, the suppliers' ids and names and the month's budget, but the POLICY DIGEST is the digest of the whole settings without the address, with the
// owner reduced to their language and each supplier without its number (data.ts policyOf), so the whole tree is kept and digested with report.CanonicalJSON, the same bytes as the
// TypeScript's canonicalJson.
//
// IMPORTANT, the caller's duty: the TypeScript digests the settings AS VALIDATED (validateSettings fills the defaults, trims the names and writes the assistant block in its checked form),
// not as the file was written. The tree handed in must be what stockorders.Settings.Tree returns; a raw file that leaves a default out gives another digest, and a go-live certificate of
// the same settings would then be read as "different" instead of "own".
package stockordersreport

import (
	"math"

	"github.com/GeometerLabs/agents/go/internal/bookingsreport"
	"github.com/GeometerLabs/agents/go/internal/report"
)

// Settings is the shop's validated settings as a JSON tree.
type Settings = bookingsreport.Settings

// ShopView is what the report reads of the settings (name, time zone, languages, owner's language); ShopOf is Bookings' (the same reading, which asks for nothing Stock orders lacks).
type ShopView = bookingsreport.ShopView

// ShopOf reads the fields the report needs, or says which one is missing or of the wrong kind.
func ShopOf(s Settings) (ShopView, error) { return bookingsreport.ShopOf(s) }

// PolicyOf is policyOf: what governs how the agent behaves and speaks, without contact details: every setting but the address, with the owner reduced to their language and each supplier
// without its WhatsApp number. A missing member is undefined in the TypeScript, which canonicalJson writes as null.
func PolicyOf(s Settings) map[string]any {
	out := make(map[string]any, len(s))
	for k, v := range s {
		if k != "address" && k != "owner" && k != "suppliers" {
			out[k] = v
		}
	}
	var lang any
	if owner, ok := s["owner"].(map[string]any); ok {
		lang = owner["language"] // absent: nil, written as null
	}
	out["owner"] = map[string]any{"language": lang}
	list, _ := s["suppliers"].([]any)
	suppliers := make([]any, 0, len(list))
	for _, raw := range list {
		m, ok := raw.(map[string]any)
		if !ok {
			suppliers = append(suppliers, raw)
			continue
		}
		c := make(map[string]any, len(m))
		for k, v := range m {
			if k != "whatsapp" {
				c[k] = v
			}
		}
		suppliers = append(suppliers, c)
	}
	out["suppliers"] = suppliers
	return out
}

// PolicyDigest is policyDigest: two shops with the same digest have the same limits and words.
func PolicyDigest(s Settings) string { return report.DigestOf(PolicyOf(s)) }

// CheckedPolicyDigest is checkedPolicyDigest(): the digest of the example settings (Glow Unisex Salon's) the hand check runs on when it is given none. It is a constant made by running
// the TypeScript (words.json.gz facts), so Go does not need harness.ts.
func CheckedPolicyDigest() string { return loadWords().Facts.CheckedPolicyDigest }

// NotTestedOf is notTestedOf(settings): the hand check's list of ids. The TypeScript's list does not depend on the settings.
func NotTestedOf() []string { return append([]string{}, loadWords().Facts.NotTested...) }

// NotTestedForReport is notTestedForReport(goLive, settings): the hand check's list, and one more unless a go-live certificate shows the checks ran on this shop's own settings with
// nothing left out. (notTestedFor, which the go-live CERTIFICATE's builder calls, is not ported: see Deferred.md.)
func NotTestedForReport(goLive report.GoLiveFinding) []string {
	ids := NotTestedOf()
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

// supplierRow is what the report reads of one supplier (settings.suppliers[i]): its id and the shop's own name for it.
type supplierRow struct{ id, name string }

func suppliersOf(s Settings) []supplierRow {
	list, _ := s["suppliers"].([]any)
	var out []supplierRow
	for _, raw := range list {
		if m, ok := raw.(map[string]any); ok {
			id, _ := m["id"].(string)
			name, _ := m["name"].(string)
			out = append(out, supplierRow{id, name})
		}
	}
	return out
}

// monthlyPaise is `Math.round(settings.limits.monthlyBudgetInr * 100)`: JavaScript rounds a half up, so this is floor(x + 0.5) (the budget is a whole number of rupees once validated).
func monthlyPaise(s Settings) int64 {
	limits, _ := s["limits"].(map[string]any)
	inr, _ := limits["monthlyBudgetInr"].(float64)
	return int64(math.Floor(inr*100 + 0.5))
}
