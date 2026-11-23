// The words and constants the Fees monthly report needs, loaded once per process from words/words.json.gz. This package is Fees-specific (the report reads a Fees centre's settings, its
// fees and the crash test's "not tested" list), so it sits beside internal/report (the generic half), internal/bookingsreport and internal/ordersreport (its twins).
//
// The file is MADE BY RUNNING the TypeScript (go/scripts/gen_fees_report_words.ts), never retyped: `strings` is templates/education/fees/report/strings.ts in four languages (a word that
// is a function of its arguments is a template with {0}, {1} ... slots, internal/slots, after the generator checked on other values that it does nothing but put its arguments in), and `facts`
// is what data.ts, text.ts and whatsapp.ts take from other TypeScript files (rule ids and where each is counted, the hand check's lists, the example centre's digest, the package
// version, the reminder and receipt template names, the four WhatsApp templates). Four words are not here because Go loads them from other generated files, and the generator asserts
// they are the same values: the check-link label and the two "settled by" lines (internal/report) and the "Money this month" words (internal/accounting). The freshness test
// (templates/commerce/listings/contract/words-fresh.test.ts) fails when the TypeScript changed and the generator was not run.
package feesreport

import (
	"bytes"
	"compress/gzip"
	_ "embed"
	"encoding/json"
	"io"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/bookingsreport"
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
	HandRun           string            `json:"handRun"`
	More              string            `json:"more"` // {0} how many more
	LanguageName      map[string]string `json:"languageName"`
	Label             struct {
		Collected, OldDuesCollected, StillToCollect, GivenBack, TakenOff, WasAsked, Approved, SaidNo, RemindersSent, StoppedByLimits, NotChecked, Students string
	} `json:"label"`
	Classes    struct{ Held, LinksSent, Attendance, MissedNotes, Doubts string }                                 `json:"classes"`
	Credit     struct{ OwedAtStart, CollectedAfterReminder, RemindersSent, RemindersAfterPaid, Accounts string } `json:"credit"`
	Stop       map[string]string                                                                                 `json:"stop"`
	SourceTag  map[string]string                                                                                 `json:"sourceTag"`
	NotChecked struct{ Cash, UPI, WhatsApp, Razorpay, Review string }                                            `json:"notChecked"`
	UpiLabel   struct{ Collected, OldDuesCollected, GivenBack, NotChecked string }                               `json:"upiLabel"`
	NotTested  map[string]string                                                                                 `json:"notTested"`
	NotCounted map[string]string                                                                                 `json:"notCounted"`
	Cert       struct {
		Held string `json:"held"` // {0} held, {1} total, {2} failed, {3} not tested
	} `json:"cert"`
	GoLive struct {
		Heading, Own, Example, Different, Untrusted, None, SignedWith string
	} `json:"goLive"`
	Page struct {
		Numbers, Item, Count, Amount, MoneyHeading, Opened, PaidInFull, PartlyPaid, StillOpen                                  string
		WaiversHeading, ByOwner, WithinLimit, LateFees, LateFeesAdded, MessagesHeading, RemindersToParents, ReceiptsToParents  string
		ToYou, HeldBack, StoppedHeading, Rule, Times, StoppedParents, NotCountedHeading, NotTestedHeading, Unconfirmed         string
		ShowWhatWeDid, ByActionHeading, Action, AgentVersion, LimitsDigest, RecordDigest, LiveServices                         string
		CheckHeading, Code, Digest, CountedFrom, SetUpBy, MadeOn, SignedBy, NotSigned, SignatureNote, ScanToCheck, ScanSummary string
		NotAGrade, Period                                                                                                      string
	} `json:"page"`
}

// Fill puts the arguments into a template word ({0}, {1} ...): the TypeScript's function call.
func Fill(template string, args ...string) string { return slots.Fill(template, args...) }

// reportTemplate is one of the four WhatsApp templates (whatsapp.ts REPORT_TEMPLATES): its name registered with Meta, whether it carries the badge line, whether it is a UPI
// centre's, and the wording per language with {slot} where a value goes.
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
	// UpiNotCounted is UPI_NOT_COUNTED: the line a UPI centre's report says in place of another (B71 part 2).
	UpiNotCounted map[string]string `json:"upiNotCounted"`
	Sources       []string          `json:"sources"`
	NotTested     []string          `json:"notTested"`
	UpiNotTested  []string          `json:"upiNotTested"`
	// StopSites is STOP_SITES: the entries a rule's "block" is counted at.
	StopSites          map[string][]string `json:"stopSites"`
	ReminderTemplates  []string            `json:"reminderTemplates"`
	ReceiptTemplates   []string            `json:"receiptTemplates"`
	MessageStatusEntry string              `json:"messageStatusEntry"`
	Templates          []reportTemplate    `json:"templates"`
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
			panic("feesreport/words/words.json.gz is not gzip: " + err.Error())
		}
		raw, err := io.ReadAll(zr)
		if err == nil {
			err = json.Unmarshal(raw, &words)
		}
		if err != nil {
			panic("feesreport/words/words.json.gz is not the words file: " + err.Error())
		}
	})
	return &words
}

// Pathway is `pathway`: the agent's name and version (the template's package.json version).
type Pathway = bookingsreport.Pathway

// DefaultPathway is PATHWAY: "fees" and the version in templates/education/fees/package.json at the time the words were generated.
func DefaultPathway() Pathway { return loadWords().Facts.Pathway }

// StringsOf is STRINGS[language].
func StringsOf(lang string) *Strings { return loadWords().Strings[lang] }

// RuleIDs is RULE_IDS, NotCounted is NOT_COUNTED and Sources is SOURCES, as the TypeScript lists them.
func RuleIDs() []string    { return loadWords().Facts.RuleIDs }
func NotCounted() []string { return loadWords().Facts.NotCounted }
func Sources() []string    { return loadWords().Facts.Sources }

// ReportTemplateNames is REPORT_TEMPLATE_NAMES: every report template name, for a provider (or the stand-in) to approve.
func ReportTemplateNames() []string {
	var out []string
	for _, t := range loadWords().Facts.Templates {
		out = append(out, t.Name)
	}
	return out
}

// moneyLabels is strings.ts moneyLabels: a UPI centre's (B33) labels say the money was marked by the owner; a gateway centre's are as they were.
func moneyLabels(lang string, upi bool) (collected, oldDues, givenBack string) {
	s := StringsOf(lang)
	if upi {
		return s.UpiLabel.Collected, s.UpiLabel.OldDuesCollected, s.UpiLabel.GivenBack
	}
	return s.Label.Collected, s.Label.OldDuesCollected, s.Label.GivenBack
}
