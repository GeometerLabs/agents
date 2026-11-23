package fees

// The credit book's settings block (decision 63, the shop starter's first job): the Go twin of templates/education/fees/src/credit/settings.ts `readCreditBook`, with its
// sentences in its order. Why it is a block of Fees and what it holds is said there. With the block the shop has no batches, no students and no due day to ask for (ReadSettings
// skips their readers), and the refusals of what a credit shop does not have come last, as the TypeScript pushes them.
//
// Where Go and JavaScript differ: `.trim().replace(/\s+/gu, " ")` is FieldsFunc over language.IsJSSpace (JavaScript's white space), `name.length` is language.UTF16Len, and
// `toLowerCase()` is language.LowerJS.

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/bookings"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// CreditBatch is credit/settings.ts CREDIT_BATCH: the batch id a credit account's entry carries in the store; never a real batch, since a credit shop has none.
const CreditBatch = "credit"

// CreditPeopleMax, CreditDefaultMaxInr and CreditDefaultEveryDays are credit/settings.ts's constants.
const (
	CreditPeopleMax        = 300
	CreditDefaultMaxInr    = 50_000
	CreditDefaultEveryDays = 7
)

// CreditPerson is one person's opening balance (credit/settings.ts CreditPerson); Language "" when left out.
type CreditPerson struct {
	Name      string
	Phone     string
	AmountInr int64
	Language  string
}

// CreditBook is credit/settings.ts CreditBookSettings.
type CreditBook struct {
	MaxPerPersonInr int64
	RemindEveryDays int64
	People          []CreditPerson
}

var creditNameBad = regexp.MustCompile(`[\p{Cc}\d+]`)

// creditName is `.trim().replace(/\s+/gu, " ")`.
func creditName(s string) string { return strings.Join(strings.FieldsFunc(s, language.IsJSSpace), " ") }

// readCreditBook is credit/settings.ts readCreditBook; nil when the block is left out.
func readCreditBook(r *bookings.SettingsReader, in map[string]any, langs []string, owner string) *CreditBook {
	v, given := in["creditBook"]
	if !given {
		return nil
	}
	m, ok := isObj(v)
	if !ok {
		r.Add(`The credit book ("creditBook") must look like {"maxPerPersonInr": 50000, "remindEveryDays": 7, "people": []}.`)
		return nil
	}
	r.UnknownKeys(m, "/creditBook", []string{"maxPerPersonInr", "remindEveryDays", "people"}, "the credit book")
	most, mostOK := int64(CreditDefaultMaxInr), true
	if x, has := m["maxPerPersonInr"]; has {
		most, mostOK = bookings.IsWhole(x)
		mostOK = mostOK && most >= 1 && most <= 1_000_000
	}
	if !mostOK {
		r.Add(`The most one person's account may show ("creditBook.maxPerPersonInr") must be whole rupees from 1 to 1000000.`)
	}
	every, everyWhole := int64(CreditDefaultEveryDays), true
	if x, has := m["remindEveryDays"]; has {
		every, everyWhole = bookings.IsWhole(x)
	}
	if !everyWhole || every < 1 || every > 60 {
		r.Add(`How often a reminder may go ("creditBook.remindEveryDays") must be a whole number of days from 1 to 60.`)
	}
	out := &CreditBook{MaxPerPersonInr: CreditDefaultMaxInr, RemindEveryDays: CreditDefaultEveryDays, People: []CreditPerson{}}
	if mostOK {
		out.MaxPerPersonInr = most
	}
	if everyWhole {
		out.RemindEveryDays = every
	}
	list, isList := []any{}, true
	if x, has := m["people"]; has {
		list, isList = x.([]any)
	}
	if !isList || len(list) > CreditPeopleMax {
		r.Add(`Who owes what today ("creditBook.people") must be a list of at most %d, each like {"name": "Ramesh", "phone": "+919800000000", "amountInr": 2400}.`, CreditPeopleMax)
	} else {
		names, phones := map[string]bool{}, map[string]bool{}
		for i, raw := range list {
			obj, isO := isObj(raw)
			label := fmt.Sprintf("Person number %d", i+1)
			if n, ok := obj["name"].(string); isO && ok && language.TrimJS(n) != "" {
				label = fmt.Sprintf(`Person "%s"`, language.TrimJS(n))
			}
			if !isO {
				r.Add(`%s in the credit book must look like {"name": "Ramesh", "phone": "+919800000000", "amountInr": 2400}.`, label)
				continue
			}
			r.UnknownKeys(obj, fmt.Sprintf("/creditBook/people/%d", i), []string{"name", "phone", "amountInr", "language"}, label)
			name := ""
			if n, ok := obj["name"].(string); ok {
				name = creditName(n)
			}
			nameOK := name != "" && language.UTF16Len(name) <= 40 && !creditNameBad.MatchString(name)
			if !nameOK {
				r.Add(`%s needs a name ("name") of at most 40 letters, with no digits.`, label)
			}
			phone, _ := obj["phone"].(string)
			phoneOK := phoneRe.MatchString(phone)
			if !phoneOK {
				r.Add(`%s needs their WhatsApp number ("phone"), starting with + and the country code, then digits only, for example +919800000000.`, label)
			} else if phone == owner {
				r.Add(`%s: the number is the owner's. The owner's number is for the owner's replies, not for a customer.`, label)
			}
			amount, amountOK := bookings.IsWhole(obj["amountInr"])
			amountOK = amountOK && amount >= 1 && (!mostOK || amount <= most)
			if !amountOK {
				r.Add(`%s needs what they owe today ("amountInr") in whole rupees, from 1 to the most one account may show.`, label)
			}
			lang, hasLang := obj["language"]
			ls, _ := lang.(string)
			if hasLang && !(contains(runtime.LANGUAGES, ls) && contains(langs, ls)) {
				quoted := make([]string, len(langs))
				for j, l := range langs {
					quoted[j] = `"` + l + `"`
				}
				r.Add(`%s's language ("language") must be one of the shop's languages: %s.`, label, strings.Join(quoted, ", "))
			}
			key := language.LowerJS(name)
			if name != "" && names[key] {
				r.Add(`%s is in the credit book twice. Give each person a name the owner can tell apart, like "Ramesh K".`, label)
			}
			if phoneOK && phones[phone] {
				r.Add(`%s's number is another person's in the credit book. One number is one account.`, label)
			}
			if name != "" {
				names[key] = true
			}
			if phoneOK {
				phones[phone] = true
			}
			if nameOK && phoneOK && amountOK {
				p := CreditPerson{Name: name, Phone: phone, AmountInr: amount}
				if contains(langs, ls) {
					p.Language = ls
				}
				out.People = append(out.People, p)
			}
		}
	}
	// what a credit shop does not have: each said once, in the settings' own words
	if hasKey(in, "batches") || hasKey(in, "students") {
		r.Add(`A credit book ("creditBook") has no batches or students: leave "batches" and "students" out. Who owes what goes in "creditBook.people".`)
	}
	if lf, has := in["lateFeeInr"]; has && lf != float64(0) {
		r.Add(`A credit book adds no late fee: leave "lateFeeInr" out.`)
	}
	if hasKey(in, "joiningMidMonth") {
		r.Add(`A credit book has no rule for joining mid-month: leave "joiningMidMonth" out.`)
	}
	if hasKey(in, "classes") {
		r.Add(`A credit book has no classes: leave "classes" out.`)
	}
	if w, ok := isObj(in["waiver"]); ok && w["limitInr"] != float64(0) {
		r.Add(`In a credit book every discount a customer asks about goes to the owner: set the waiver limit ("waiver.limitInr") to 0, or leave "waiver" out.`)
	}
	return out
}
