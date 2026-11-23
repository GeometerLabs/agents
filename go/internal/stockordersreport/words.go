// The words and constants the Stock orders monthly report needs, loaded once per process from words/words.json.gz. This package is Stock orders' own (it reads Stock orders' settings and
// its purchase orders), so it sits beside internal/report (the generic half), internal/bookingsreport and internal/ordersreport (the twins it follows).
//
// The file is MADE BY RUNNING the TypeScript (go/scripts/gen_stockorders_report_words.ts), never retyped: `strings` is templates/commerce/stock-orders/report/strings.ts in four languages (a
// word that is a function of its arguments is a template with {0}, {1} ... slots, internal/slots, after the generator checked on other values that it does nothing but put its arguments
// in), and `facts` is what data.ts, text.ts and whatsapp.ts take from other TypeScript files (the rule ids, the hand check's "not tested" ids, the example shop's digest, the package
// version and the two WhatsApp templates). The check-link label is not here: Go loads it from internal/report's generated words (the generator asserts it is the same value). The freshness
// test (templates/commerce/listings/contract/words-fresh.test.ts) fails when the TypeScript changed and the generator was not run.
package stockordersreport

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

// Strings is strings.ts Strings for one language (without `checkGenuine`, and with only `cert.held` of the go-live certificate's words). A word that is a function in the TypeScript keeps
// its {0}, {1} ... slots: use Fill. The JSON members are matched to the fields by name without regard to case, as the TypeScript's members are camelCase.
type Strings struct {
	Agent         string            `json:"agent"`
	MonthlyReport string            `json:"monthlyReport"`
	FullReport    string            `json:"fullReport"`
	HelpLine      string            `json:"helpLine"`
	Promise       string            `json:"promise"`
	HandRun       string            `json:"handRun"`
	SourceTag     map[string]string `json:"sourceTag"`
	More          string            `json:"more"`     // {0} how many more
	BudgetOf      string            `json:"budgetOf"` // {0} used, {1} the month's budget
	Label         struct {
		Placed, Acknowledged, ReceivedFull, PartReceived, WrongItem, SupplierSaidNo, NoAnswer, NeverSent, BudgetUsed, BudgetLeft, MarkedPaid, Asked, Approved, SaidNo, Stopped, NotChecked string
	} `json:"label"`
	Stop       map[string]string                                   `json:"stop"`
	NotChecked struct{ Whatsapp, Supplier, Paying, Review string } `json:"notChecked"`
	NotTested  map[string]string                                   `json:"notTested"`
	NotCounted map[string]string                                   `json:"notCounted"`
	Cert       struct {
		Held string `json:"held"` // {0} held, {1} total, {2} failed, {3} not tested
	} `json:"cert"`
	GoLive struct {
		Heading, Own, Example, Different, Untrusted, None, SignedWith string
	} `json:"goLive"`
	Page struct {
		Numbers, Item, Count, Amount, OrdersHeading, BudgetHeading, MonthlyBudget, OwnersNoteHeading, SuppliersHeading, Supplier                  string
		StoppedHeading, Rule, Times, NotCountedHeading, NotTestedHeading, Unconfirmed                                                             string
		CheckHeading, Code, Digest, CountedFrom, SetUpBy, MadeOn, SignedBy, NotSigned, SignatureNote, ScanToCheck, ScanSummary, NotAGrade, Period string
		ShowWhatWeDid, ByActionHeading, Action, AgentVersion, LimitsDigest, RecordDigest, LiveServices                                            string
	} `json:"page"`
}

// Fill puts the arguments into a template word ({0}, {1} ...): the TypeScript's function call.
func Fill(template string, args ...string) string { return slots.Fill(template, args...) }

// reportTemplate is one of the two WhatsApp templates (whatsapp.ts REPORT_TEMPLATES): its name registered with Meta, whether it carries the badge line, and the wording per language with
// {slot} where a value goes.
type reportTemplate struct {
	Name   string            `json:"name"`
	Badge  bool              `json:"badge"`
	Bodies map[string]string `json:"bodies"`
}

type factsFile struct {
	Languages           []string               `json:"languages"`
	Pathway             bookingsreport.Pathway `json:"pathway"`
	CheckedPolicyDigest string                 `json:"checkedPolicyDigest"`
	RuleIDs             []string               `json:"ruleIds"`
	NotCounted          []string               `json:"notCounted"`
	Sources             []string               `json:"sources"`
	NotTested           []string               `json:"notTested"`
	Templates           []reportTemplate       `json:"templates"`
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
			panic("stockordersreport/words/words.json.gz is not gzip: " + err.Error())
		}
		raw, err := io.ReadAll(zr)
		if err == nil {
			err = json.Unmarshal(raw, &words)
		}
		if err != nil {
			panic("stockordersreport/words/words.json.gz is not the words file: " + err.Error())
		}
	})
	return &words
}

// StringsOf is STRINGS[language].
func StringsOf(lang string) *Strings { return loadWords().Strings[lang] }

// RuleIDs is RULE_IDS, NotCounted is NOT_COUNTED and Sources is SOURCES (what the numbers were counted from), as the TypeScript lists them.
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
