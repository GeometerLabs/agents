// The words and constants the Bookings monthly report needs, loaded once per process from words/words.json.gz. This package is Bookings-specific (not a generic report): it reads
// Bookings' Settings, its bookings and the crash test's "not tested" list, so it sits beside internal/report (the generic half) rather than inside it.
//
// The file is MADE BY RUNNING the TypeScript (go/scripts/gen_bookings_report_words.ts), never retyped: `strings` is templates/commerce/bookings/report/strings.ts in four languages (a
// word that is a function of its arguments is a template with {0}, {1} ... slots, internal/slots, after the generator checked on other values that it does nothing but put its arguments
// in) and `facts` is what data.ts, text.ts and whatsapp.ts take from other TypeScript files (rule ids, the hand check's lists, the payment modules' capabilities, the example shop's
// digest, the package version, the four WhatsApp templates). Five words are not here because Go loads them from other generated files, and the generator asserts they are the
// same values: the Innovator badge, the check-link label and the two "settled by" lines (internal/report) and the "Money this month" words (internal/accounting). The freshness test
// (templates/commerce/listings/contract/words-fresh.test.ts) fails when the TypeScript changed and the generator was not run.
package bookingsreport

import (
	"bytes"
	"compress/gzip"
	_ "embed"
	"encoding/json"
	"io"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/slots"
)

//go:embed words/words.json.gz
var wordsGz []byte

// Strings is strings.ts Strings for one language (without the five shared words). A word that is a function in the TypeScript keeps its {0}, {1} ... slots: use Fill.
type Strings struct {
	Agent             string            `json:"agent"`
	MonthlyReport     string            `json:"monthlyReport"`
	GoLiveCertificate string            `json:"goLiveCertificate"`
	MonthlyCert       string            `json:"monthlyCertificate"`
	FullReport        string            `json:"fullReport"`
	LanguageName      map[string]string `json:"languageName"`
	// Discounts are E1's labels (modules/limits/discounts.ts DISCOUNT_REPORT_WORDS, carried in strings.ts)
	Discounts struct{ Given, Asked, Refused string } `json:"discounts"`
	Label     struct {
		BookingsMade, Cancelled, Moved, DepositsCollected, GivenBack, WasAsked, Approved, SaidNo, NotConfirmed, StoppedByLimits, NotChecked string
	} `json:"label"`
	Stop       map[string]string                    `json:"stop"`
	More       string                               `json:"more"` // {0} how many more
	HandRun    string                               `json:"handRun"`
	SourceTag  map[string]string                    `json:"sourceTag"`
	SourceLong map[string]string                    `json:"sourceLong"`
	UpiLabel   struct{ Deposits, GivenBack string } `json:"upiLabel"`
	NotTested  map[string]string                    `json:"notTested"`
	NotCounted map[string]string                    `json:"notCounted"`
	Work       struct {
		Heading, Jobs, Completed, Abandoned, Unresolved, SettledByPerson, Cost, CostUnknown, UnitCost, NoCompleted, NoCost, CompletedMeans, AbandonedMeans, UnresolvedMeans, AbandonedNeverClears string
	} `json:"work"`
	Page struct {
		Numbers, Item, Count, Amount, DroppedBeforeBooked, GivenBackDeposits, GivenBackSecond, Retried                                       string
		StoppedHeading, StoppedTotal, StoppedNote, Rule, Times                                                                               string
		MessagesHeading, ToCustomers, ToYou, HeldBack                                                                                        string
		UnconfirmedHeading, StillOpen, SettledLater, Nothing, WaitingNow, PaidNotBooked                                                      string
		MissingHeading, MissingDepositAmounts, MissingRefundAmounts, MissingOwnerCommands, MissingMessageTargets                             string
		NotCountedHeading, NotTestedHeading                                                                                                  string
		CheckHeading, Code, Digest, LimitsDigest, RecordDigest, CountedFrom, SetUpBy, MadeOn, AgentVersion                                   string
		CheckAt, SignedBy, NotSigned, SignatureNote, ScanToCheck, ScanSummary                                                                string
		ShowWhatWeDid, ByActionHeading, EntriesHeading, ColNo, ColTime, ColAction, ColOutcome, ColBooking, ColFingerprint, NotAGrade, Period string
	} `json:"page"`
	Cert struct {
		Date, Held, Intro, YourLimits, Floor, Deposit, Cancel, Refund, Hours, NotAGrade, DidNotHold, HandRunLine, CountedIntro, CheckedOn string
	} `json:"cert"`
	GoLive struct {
		Heading, Own, Example, Different, Untrusted, None, SignedWith string
	} `json:"goLive"`
}

// Fill puts the arguments into a template word ({0}, {1} ...): the TypeScript's function call.
func Fill(template string, args ...string) string { return slots.Fill(template, args...) }

// notTestedItem is one of the hand check's "not tested" items: its id and whether the owner's short form names it.
type notTestedItem struct {
	ID       string `json:"id"`
	ForOwner bool   `json:"forOwner"`
}

// reportTemplate is one of the four WhatsApp templates (whatsapp.ts REPORT_TEMPLATES): its name registered with Meta, whether it carries the badge line, whether it is a UPI
// shop's, and the wording per language with {slot} where a value goes.
type reportTemplate struct {
	Name   string            `json:"name"`
	Badge  bool              `json:"badge"`
	UPI    bool              `json:"upi"`
	Bodies map[string]string `json:"bodies"`
}

type factsFile struct {
	Languages           []string        `json:"languages"`
	Pathway             Pathway         `json:"pathway"`
	CheckedPolicyDigest string          `json:"checkedPolicyDigest"`
	RuleIDs             []string        `json:"ruleIds"`
	NotCounted          []string        `json:"notCounted"`
	Sources             []string        `json:"sources"`
	NotTested           []notTestedItem `json:"notTested"`
	UpiNotTested        []notTestedItem `json:"upiNotTested"`
	StandInServices     string          `json:"standInServices"`
	HandRun             string          `json:"handRun"`
	MessageStatusEntry  string          `json:"messageStatusEntry"`
	Payments            struct {
		DefaultProvider       string          `json:"defaultProvider"`
		ConfirmsAutomatically map[string]bool `json:"confirmsAutomatically"`
	} `json:"payments"`
	Templates []reportTemplate `json:"templates"`
}

type wordsFile struct {
	Strings map[string]*Strings `json:"strings"`
	Facts   factsFile           `json:"facts"`
}

var (
	wordsOnce sync.Once
	words     wordsFile
)

func loadWords() *wordsFile {
	wordsOnce.Do(func() {
		zr, err := gzip.NewReader(bytes.NewReader(wordsGz))
		if err != nil {
			panic("bookingsreport/words/words.json.gz is not gzip: " + err.Error())
		}
		raw, err := io.ReadAll(zr)
		if err == nil {
			err = json.Unmarshal(raw, &words)
		}
		if err != nil {
			panic("bookingsreport/words/words.json.gz is not the words file: " + err.Error())
		}
	})
	return &words
}

// StringsOf is STRINGS[language].
func StringsOf(lang string) *Strings { return loadWords().Strings[lang] }

// moneyLabels is strings.ts moneyLabels: a UPI shop's (B33) labels say the money was marked by the owner; a gateway shop's are as they were.
func moneyLabels(lang string, upi bool) (deposits, givenBack string) {
	s := StringsOf(lang)
	if upi {
		return s.UpiLabel.Deposits, s.UpiLabel.GivenBack
	}
	return s.Label.DepositsCollected, s.Label.GivenBack
}
