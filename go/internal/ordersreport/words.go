// The words and constants the Orders monthly report needs, loaded once per process from words/words.json.gz. This package is Orders-specific (not a generic report): it reads Orders'
// settings, its orders and the crash test's "not tested" list, so it sits beside internal/report (the generic half) and internal/bookingsreport (the Bookings twin) rather than inside either.
//
// The file is MADE BY RUNNING the TypeScript (go/scripts/gen_orders_report_words.ts), never retyped: `strings` is templates/commerce/orders/report/strings.ts in four languages (a word that is
// a function of its arguments is a template with {0}, {1} ... slots, internal/slots, after the generator checked on other values that it does nothing but put its arguments in), `plans`
// is src/plans/report.ts PLAN_REPORT_WORDS, and `facts` is what data.ts, text.ts and whatsapp.ts take from other TypeScript files (rule ids, the hand check's lists, the example shop's
// digest, the package version, ORDERS_LEGACY, the four WhatsApp templates). Four words are not here because Go loads them from other generated files, and the generator asserts they are
// the same values: the check-link label and the two "settled by" lines (internal/report) and the "Money this month" words (internal/accounting). The freshness test
// (templates/commerce/listings/contract/words-fresh.test.ts) fails when the TypeScript changed and the generator was not run.
package ordersreport

import (
	"bytes"
	"compress/gzip"
	_ "embed"
	"encoding/json"
	"io"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/slots"
)

//go:embed words/words.json.gz
var wordsGz []byte

// Strings is strings.ts Strings for one language (without the four shared words, and with only `cert.held` of the go-live certificate's words). A word that is a function in the
// TypeScript keeps its {0}, {1} ... slots: use Fill. The JSON members are matched to the fields by name without regard to case, as the TypeScript's members are camelCase.
type Strings struct {
	Agent             string            `json:"agent"`
	MonthlyReport     string            `json:"monthlyReport"`
	GoLiveCertificate string            `json:"goLiveCertificate"`
	FullReport        string            `json:"fullReport"`
	HelpLine          string            `json:"helpLine"`
	Promise           string            `json:"promise"`
	HandRun           string            `json:"handRun"`
	More              string            `json:"more"` // {0} how many more
	LanguageName      map[string]string `json:"languageName"`
	// Discounts are E1's labels (modules/limits/discounts.ts DISCOUNT_REPORT_WORDS, carried in strings.ts)
	Discounts struct{ Given, Asked, Refused string } `json:"discounts"`
	Label     struct {
		BalanceCollected, Collected, StillToCollect, GivenBack, OrdersTaken, Cancelled, WasAsked, Approved, SaidNo, StoppedByLimits, NotChecked, Orders string
	} `json:"label"`
	Stop       map[string]string                                      `json:"stop"`
	SourceTag  map[string]string                                      `json:"sourceTag"`
	NotChecked struct{ Cash, UPI, WhatsApp, Razorpay, Review string } `json:"notChecked"`
	UpiLabel   struct{ Collected, GivenBack, NotChecked string }      `json:"upiLabel"`
	NotTested  map[string]string                                      `json:"notTested"`
	NotCounted map[string]string                                      `json:"notCounted"`
	Cert       struct {
		Held string `json:"held"` // {0} held, {1} total, {2} failed, {3} not tested
	} `json:"cert"`
	GoLive struct {
		Heading, Own, Example, Different, Untrusted, None, SignedWith string
	} `json:"goLive"`
	Page struct {
		Numbers, Item, Count, Amount, OrdersTaken, OrdersCompleted, OrdersCancelled, HoldsRanOut, SoldHeading, SoldOrders      string
		Pickup, Delivery, ItemsSold, NoItems, MessagesHeading, ToYou, HeldBack                                                 string
		StoppedHeading, Rule, Times, StoppedCustomers, NotCountedHeading, NotTestedHeading, Unconfirmed                        string
		CheckHeading, Code, Digest, CountedFrom, SetUpBy, MadeOn, SignedBy, NotSigned, SignatureNote, ScanToCheck, ScanSummary string
		NotAGrade, Period, ShowWhatWeDid, ByActionHeading, Action, AgentVersion, LimitsDigest, RecordDigest, LiveServices      string
	} `json:"page"`
}

// PlanWords is PlanReportWords: the words of the monthly plans' block of the page.
type PlanWords struct {
	Heading, Active, Started, Renewals, Meals, CreditDays, Carried, Refunded, Cancelled, Lapsed string
}

// Fill puts the arguments into a template word ({0}, {1} ...): the TypeScript's function call.
func Fill(template string, args ...string) string { return slots.Fill(template, args...) }

// reportTemplate is one of the four WhatsApp templates (whatsapp.ts REPORT_TEMPLATES): its name registered with Meta, whether it carries the badge line, whether it is a UPI
// shop's, and the wording per language with {slot} where a value goes.
type reportTemplate struct {
	Name   string            `json:"name"`
	Badge  bool              `json:"badge"`
	UPI    bool              `json:"upi"`
	Bodies map[string]string `json:"bodies"`
}

type factsFile struct {
	Languages           []string `json:"languages"`
	Pathway             Pathway  `json:"pathway"`
	CheckedPolicyDigest string   `json:"checkedPolicyDigest"`
	RuleIDs             []string `json:"ruleIds"`
	NotCounted          []string `json:"notCounted"`
	// UpiNotCounted is UPI_NOT_COUNTED: the line a UPI shop's report says in place of another (B71 part 2).
	UpiNotCounted      map[string]string    `json:"upiNotCounted"`
	Sources            []string             `json:"sources"`
	NotTested          []string             `json:"notTested"`
	UpiNotTested       []string             `json:"upiNotTested"`
	MessageStatusEntry string               `json:"messageStatusEntry"`
	Legacy             accounting.LegacyMap `json:"legacy"`
	Templates          []reportTemplate     `json:"templates"`
}

type wordsFile struct {
	Strings map[string]*Strings   `json:"strings"`
	Plans   map[string]*PlanWords `json:"plans"`
	Facts   factsFile             `json:"facts"`
}

var (
	wordsOnce sync.Once
	words     wordsFile
)

func loadWords() *wordsFile {
	wordsOnce.Do(func() {
		zr, err := gzip.NewReader(bytes.NewReader(wordsGz))
		if err != nil {
			panic("ordersreport/words/words.json.gz is not gzip: " + err.Error())
		}
		raw, err := io.ReadAll(zr)
		if err == nil {
			err = json.Unmarshal(raw, &words)
		}
		if err != nil {
			panic("ordersreport/words/words.json.gz is not the words file: " + err.Error())
		}
	})
	return &words
}

// StringsOf is STRINGS[language].
func StringsOf(lang string) *Strings { return loadWords().Strings[lang] }

// PlanWordsOf is PLAN_REPORT_WORDS[language].
func PlanWordsOf(lang string) *PlanWords { return loadWords().Plans[lang] }

// Legacy is ORDERS_LEGACY (templates/commerce/orders/src/accounting.ts): Orders' older action names, which the books read a record written before the core existed with. It is made
// by running the TypeScript (words.json.gz), so the lead's books and this report cannot disagree about it.
func Legacy() accounting.LegacyMap { return loadWords().Facts.Legacy }

// moneyLabels is strings.ts moneyLabels: a UPI shop's (B33) labels say the money was marked by the owner; a gateway shop's are as they were.
func moneyLabels(lang string, upi bool) (collected, givenBack string) {
	s := StringsOf(lang)
	if upi {
		return s.UpiLabel.Collected, s.UpiLabel.GivenBack
	}
	return s.Label.Collected, s.Label.GivenBack
}
