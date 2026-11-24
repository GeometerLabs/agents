package fees

// Every message the Fees agent sends, per language: the Go twin of templates/education/fees/src/language/templates.ts (`render`, MessageFacts, payTo, familyLines), Classes'
// classes/words.ts, check.ts (`checkFactsOf`) and meta-templates.ts (`templateMessage`). The words are GENERATED, never retyped: words/<lang>.json.gz is written by
// go/scripts/gen_fees_words.ts, which renders each TypeScript template with probe facts and turns each probe back into a `{slot}` named after the fact it reads; this file only
// fills the slots. Dates, times and rupees are internal/language's (shared with Bookings and Orders).
//
// A message whose record lacks a fact it needs is refused with the TypeScript's own sentence (`need`), naming the first fact missing in the order the message reads.

import (
	"compress/gzip"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/GeometerLabs/agents/go/internal/bookings"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
)

//go:embed words/en.json.gz words/hi.json.gz words/ml.json.gz words/kn.json.gz
var wordsFS embed.FS

// MetaWord is one WhatsApp template in one language.
type MetaWord = bookings.MetaWord

// Words is one language's pack.
type Words struct {
	Lang     string            `json:"lang"`
	T        map[string]string `json:"t"`
	Patterns struct {
		PayToLink  string `json:"payToLink"`
		PayToUpi   string `json:"payToUpi"`
		FamilyLink string `json:"familyLink"`
		FamilyUpi  string `json:"familyUpi"`
		FamilyJoin string `json:"familyJoin"`
		ClassLine  string `json:"classLine"`
		ClassJoin  string `json:"classJoin"`
	} `json:"patterns"`
	Meta      []MetaWord        `json:"meta"`
	MetaSlots map[string]string `json:"metaSlots"`
	Labels    map[string]string `json:"labels"`
	Generic   struct {
		Customer string `json:"customer"`
		Reminder string `json:"reminder"`
		Owner    string `json:"owner"`
	} `json:"generic"`
}

var (
	wordsMu    sync.Mutex
	wordsCache = map[string]*Words{}
	slotRe     = regexp.MustCompile(`\{([A-Za-z]+)\}`)
)

// WordsFor is the pack of a language; an unknown language is English.
func WordsFor(lang string) *Words {
	if lang != "hi" && lang != "ml" && lang != "kn" {
		lang = "en"
	}
	wordsMu.Lock()
	defer wordsMu.Unlock()
	if w, ok := wordsCache[lang]; ok {
		return w
	}
	f, err := wordsFS.Open("words/" + lang + ".json.gz")
	if err != nil {
		panic("the packed words are missing: " + lang)
	}
	defer f.Close()
	z, err := gzip.NewReader(f)
	if err != nil {
		panic(err)
	}
	raw, err := io.ReadAll(z)
	if err != nil {
		panic(err)
	}
	w := &Words{}
	if err := json.Unmarshal(raw, w); err != nil {
		panic("the packed words are not readable: " + err.Error())
	}
	wordsCache[lang] = w
	return w
}

// FamilyLine is templates.ts FamilyLine: one open fee in a reminder that lists several, each with its own link.
type FamilyLine struct {
	StudentName, BatchName, MonthLabel string
	BalanceInr                         int64
	DueMs                              int64
	Link, DueRef                       string
}

// ClassLine is templates.ts ClassLine.
type ClassLine struct {
	StudentName, BatchName string
	StartMs                int64
}

// MessageFacts is templates.ts MessageFacts. A fact the record does not have is nil, and a message that needs it is not written.
type MessageFacts struct {
	Language                                                                                string
	Loc                                                                                     *time.Location
	BusinessName                                                                            string
	StudentName, BatchName, MonthLabel                                                      *string
	FeeInr, LateFeeInr, BalanceInr, PaidInr, ReceivedInr, WaiverInr, RefundInr, WaiverLimit *int64
	DueMs                                                                                   *int64
	GraceDays                                                                               *int64
	Link, DueRef, RequestRef, CustomerPhone, ApprovalCode                                   *string
	ApprovalHours, ApprovalsLeft                                                            *int64
	UpiID, Payee, UpiCode, Partner                                                          *string
	OpenFeesCount                                                                           *int64
	PageLink                                                                                *string
	Family                                                                                  []FamilyLine
	HasFamily                                                                               bool
	// Classes
	ClassMs                                                          *int64
	ClassLink, MaterialLink, Roster, DoubtText                       *string
	ClassLines                                                       []ClassLine
	HasClassLines                                                    bool
	LeadMinutes, PresentCount, AbsentCount, NotedCount, WaitingCount *int64
	SentCount, HeldCount                                             *int64
	// 25 Nov 2026: the number (or chat guest) that asked about a fee from another conversation (runtime/caseasked.go), only in a message to the owner; and a UPI refund's
	// payment (ownermarked.RefundSource): the day the owner marked it and the note it carried (its amount is ReceivedInr)
	AskerPhone, UpiNote *string
	PaidAtMs            *int64
}

// S and N make an optional fact.
func S(v string) *string { return &v }
func N(v int64) *int64   { return &v }

// MissingFact is `need`'s refusal.
type MissingFact struct{ Key string }

func (e *MissingFact) Error() string {
	return fmt.Sprintf("The message needs %q from the record, and the record does not have it.", e.Key)
}

func needS(v *string, key string) (string, error) {
	if v == nil {
		return "", &MissingFact{key}
	}
	return *v, nil
}

func needN(v *int64, key string) (int64, error) {
	if v == nil {
		return 0, &MissingFact{key}
	}
	return *v, nil
}

func (f *MessageFacts) zone() *time.Location {
	if f.Loc == nil {
		return time.UTC
	}
	return f.Loc
}

// date is format.ts formatDate(localParts(ms, zone), language).
func (f *MessageFacts) date(ms int64) string {
	t := time.UnixMilli(ms).In(f.zone())
	return language.Formats(f.Language).Date(t.Year(), int(t.Month()), t.Day())
}

func fill(pattern string, values map[string]string) string {
	return slotRe.ReplaceAllStringFunc(pattern, func(m string) string { return values[m[1:len(m)-1]] })
}

// payTo is templates.ts payTo: the link, or for a UPI centre the link with its UPI ID and payee after it.
func (f *MessageFacts) payTo(w *Words) (string, error) {
	link, err := needS(f.Link, "link")
	if err != nil {
		return "", err
	}
	if f.UpiID == nil || *f.UpiID == "" {
		return fill(w.Patterns.PayToLink, map[string]string{"link": link}), nil
	}
	payee, err := needS(f.Payee, "payee")
	if err != nil {
		return "", err
	}
	return fill(w.Patterns.PayToUpi, map[string]string{"link": link, "upiId": *f.UpiID, "payee": payee}), nil
}

func (f *MessageFacts) value(w *Words, name string) (string, error) {
	rupees := func(v *int64, key string) (string, error) {
		n, err := needN(v, key)
		return language.FormatInr(float64(n)), err
	}
	count := func(v *int64, key string) (string, error) {
		n, err := needN(v, key)
		return strconv.FormatInt(n, 10), err
	}
	fm := language.Formats(f.Language)
	switch name {
	case "businessName":
		return f.BusinessName, nil
	case "studentName":
		return needS(f.StudentName, name)
	case "batchName":
		return needS(f.BatchName, name)
	case "monthLabel":
		return needS(f.MonthLabel, name)
	case "feeInr":
		return rupees(f.FeeInr, name)
	case "lateFeeInr":
		return rupees(f.LateFeeInr, name)
	case "balanceInr":
		return rupees(f.BalanceInr, name)
	case "paidInr":
		return rupees(f.PaidInr, name)
	case "receivedInr":
		return rupees(f.ReceivedInr, name)
	case "waiverInr":
		return rupees(f.WaiverInr, name)
	case "refundInr":
		return rupees(f.RefundInr, name)
	case "waiverLimitInr":
		return rupees(f.WaiverLimit, name)
	case "dueDate":
		ms, err := needN(f.DueMs, "dueMs")
		if err != nil {
			return "", err
		}
		return f.date(ms), nil
	case "graceDays":
		return count(f.GraceDays, name)
	case "payTo":
		return f.payTo(w)
	case "link":
		return needS(f.Link, name)
	case "dueRef":
		return needS(f.DueRef, name)
	case "requestRef":
		return needS(f.RequestRef, name)
	case "customerPhone":
		return needS(f.CustomerPhone, name)
	case "askerPhone":
		return needS(f.AskerPhone, name)
	case "upiNote":
		return needS(f.UpiNote, name)
	case "paidDate": // templates.ts paidDate: the day a UPI refund's payment was marked
		ms, err := needN(f.PaidAtMs, "paidAtMs")
		if err != nil {
			return "", err
		}
		return f.date(ms), nil
	case "approvalCode":
		return needS(f.ApprovalCode, name)
	case "approvalHours":
		return count(f.ApprovalHours, name)
	case "approvalsLeft":
		return count(f.ApprovalsLeft, name)
	case "upiId":
		return needS(f.UpiID, name)
	case "payee":
		return needS(f.Payee, name)
	case "upiCode":
		return needS(f.UpiCode, name)
	case "partner":
		return needS(f.Partner, name)
	case "openFeesCount":
		return count(f.OpenFeesCount, name)
	case "pageLink":
		return needS(f.PageLink, name)
	case "family":
		if !f.HasFamily {
			return "", &MissingFact{"family"}
		}
		pattern := w.Patterns.FamilyLink
		if f.UpiID != nil && *f.UpiID != "" {
			pattern = w.Patterns.FamilyUpi
		}
		lines := make([]string, len(f.Family))
		for i, l := range f.Family {
			v := map[string]string{"studentName": l.StudentName, "batchName": l.BatchName, "monthLabel": l.MonthLabel, "balanceInr": language.FormatInr(float64(l.BalanceInr)), "dueDate": f.date(l.DueMs), "link": l.Link, "dueRef": l.DueRef}
			if f.UpiID != nil {
				v["upiId"] = *f.UpiID
				payee, err := needS(f.Payee, "payee")
				if err != nil {
					return "", err
				}
				v["payee"] = payee
			}
			lines[i] = fill(pattern, v)
		}
		return strings.Join(lines, w.Patterns.FamilyJoin), nil
	case "classDate":
		ms, err := needN(f.ClassMs, "classMs")
		if err != nil {
			return "", err
		}
		return f.date(ms), nil
	case "classTime":
		ms, err := needN(f.ClassMs, "classMs")
		if err != nil {
			return "", err
		}
		return fm.SlotTime(ms, f.zone()), nil
	case "classLink":
		return needS(f.ClassLink, name)
	case "materialLink":
		return needS(f.MaterialLink, name)
	case "roster":
		return needS(f.Roster, name)
	case "doubtText":
		return needS(f.DoubtText, name)
	case "classLines":
		if !f.HasClassLines {
			return "", &MissingFact{"classLines"}
		}
		lines := make([]string, len(f.ClassLines))
		for i, l := range f.ClassLines {
			lines[i] = fill(w.Patterns.ClassLine, map[string]string{"studentName": l.StudentName, "batchName": l.BatchName, "classDate": f.date(l.StartMs), "classTime": fm.SlotTime(l.StartMs, f.zone())})
		}
		return strings.Join(lines, w.Patterns.ClassJoin), nil
	case "leadMinutes":
		return count(f.LeadMinutes, name)
	case "presentCount":
		return count(f.PresentCount, name)
	case "absentCount":
		return count(f.AbsentCount, name)
	case "notedCount":
		return count(f.NotedCount, name)
	case "waitingCount":
		return count(f.WaitingCount, name)
	case "sentCount":
		return count(f.SentCount, name)
	case "heldCount":
		return count(f.HeldCount, name)
	}
	return "", fmt.Errorf("the words name a value %q this runtime does not know", name)
}

// Render is templates.ts render: one message from the record.
func Render(id string, f *MessageFacts) (string, error) {
	w := WordsFor(f.Language)
	text, ok := w.T[id]
	if !ok {
		return "", fmt.Errorf("there is no message %q", id)
	}
	var b strings.Builder
	at := 0
	for _, m := range slotRe.FindAllStringSubmatchIndex(text, -1) {
		b.WriteString(text[at:m[0]])
		v, err := f.value(w, text[m[2]:m[3]])
		if err != nil {
			return "", err
		}
		b.WriteString(v)
		at = m[1]
	}
	b.WriteString(text[at:])
	return b.String(), nil
}

// checkFactsOf is check.ts checkFactsOf: the lists the outgoing check reads, made from a fee conversation's facts.
func checkFactsOf(f *MessageFacts) language.Facts {
	var out language.Facts
	for _, v := range []*int64{f.FeeInr, f.LateFeeInr, f.BalanceInr, f.PaidInr, f.ReceivedInr, f.WaiverInr, f.RefundInr, f.WaiverLimit} {
		if v != nil {
			out.AmountsInr = append(out.AmountsInr, float64(*v))
		}
	}
	for _, l := range f.Family {
		out.AmountsInr = append(out.AmountsInr, float64(l.BalanceInr))
	}
	for _, v := range []*int64{f.GraceDays, f.ApprovalHours, f.OpenFeesCount, f.ApprovalsLeft, f.LeadMinutes, f.PresentCount, f.AbsentCount, f.NotedCount, f.WaitingCount, f.SentCount, f.HeldCount} {
		if v != nil {
			out.Counts = append(out.Counts, float64(*v))
		}
	}
	if f.DueMs != nil {
		out.ShownMs = f.DueMs
	} else {
		out.ShownMs = f.ClassMs
	}
	for _, l := range f.Family {
		out.MomentsMs = append(out.MomentsMs, l.DueMs)
	}
	if f.ClassMs != nil {
		out.MomentsMs = append(out.MomentsMs, *f.ClassMs)
	}
	for _, l := range f.ClassLines {
		out.MomentsMs = append(out.MomentsMs, l.StartMs)
	}
	if f.PaidAtMs != nil {
		out.MomentsMs = append(out.MomentsMs, *f.PaidAtMs) // 25 Nov 2026: the day a UPI refund's payment was marked
	}
	out.Loc = f.zone()
	for _, l := range []*string{f.Link, f.PageLink, f.ClassLink, f.MaterialLink} {
		if l != nil {
			out.Links = append(out.Links, *l)
		}
	}
	for _, l := range f.Family {
		out.Links = append(out.Links, l.Link)
	}
	for _, l := range f.Family {
		out.Literals = append(out.Literals, l.StudentName, l.BatchName, l.MonthLabel, l.DueRef)
	}
	out.Literals = append(out.Literals, f.BusinessName)
	for _, l := range []*string{f.StudentName, f.BatchName, f.MonthLabel, f.DueRef, f.RequestRef, f.CustomerPhone, f.AskerPhone, f.UpiNote, f.ApprovalCode, f.UpiID, f.Payee, f.UpiCode, f.Partner, f.Roster, f.DoubtText} {
		if l != nil {
			out.Literals = append(out.Literals, *l)
		}
	}
	for _, l := range f.ClassLines {
		out.Literals = append(out.Literals, l.StudentName, l.BatchName)
	}
	return out
}

// CheckMessage is check.ts checkMessage.
func CheckMessage(text string, f *MessageFacts) []string {
	return language.CheckText(text, checkFactsOf(f))
}

// matches is limits.ts checkMessageMatchesRecord.
func matches(text string, f *MessageFacts) messaging.Decision {
	problems := CheckMessage(text, f)
	if len(problems) == 0 {
		return messaging.Decision{RuleID: "message-matches-record", Verdict: "allow", Reason: "Every amount, date, time and link in the message is in the record."}
	}
	return messaging.Decision{RuleID: "message-matches-record", Verdict: "block", Reason: "The message does not match the record. " + strings.Join(problems, " ")}
}

// metaParameters is meta-templates.ts parametersFor.
func metaParameters(t MetaWord, f *MessageFacts) ([]string, error) {
	w := WordsFor(f.Language)
	var out []string
	for _, m := range slotRe.FindAllStringSubmatch(t.Body, -1) {
		slot, ok := w.MetaSlots[m[1]]
		if !ok {
			return nil, fmt.Errorf("The template body has an unknown value {%s}.", m[1])
		}
		v, err := f.value(w, slot)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// templateMessage is meta-templates.ts templateMessage: a message that is exactly one of the templates goes as that template with its parameters, if filling it gives back the very
// text the check read; anything else goes as the generic name with no parameters.
func templateMessage(ids []string, f *MessageFacts, text, generic string) messaging.TemplateMessage {
	if len(ids) == 1 {
		for _, t := range WordsFor(f.Language).Meta {
			if t.UsedFor != ids[0] {
				continue
			}
			if params, err := metaParameters(t, f); err == nil && bookings.FillBody(bookings.MetaBody(t.Body), params) == text {
				return messaging.TemplateMessage{Name: t.Name, Language: f.Language, Text: text, Parameters: params}
			}
			break
		}
	}
	return messaging.TemplateMessage{Name: generic, Language: f.Language, Text: text}
}

// TemplateNames is every WhatsApp template a Fees centre can send (services.ts: TEMPLATE_NAMES' values and META_TEMPLATE_NAMES; the report's are added by the caller).
func TemplateNames() []string {
	w := WordsFor("en")
	names := []string{w.Generic.Customer, w.Generic.Reminder, w.Generic.Owner}
	seen := map[string]bool{}
	for _, t := range w.Meta {
		if !seen[t.Name] {
			seen[t.Name] = true
			names = append(names, t.Name)
		}
	}
	return names
}

// monthLabel is due.ts monthLabel: "Nov 2026", in the language (format.ts MONTH_NAMES, the shared formats' table).
func monthLabel(month, lang string) string {
	y, _ := strconv.Atoi(month[:4])
	m, _ := strconv.Atoi(month[5:])
	return language.Formats(lang).Months[m-1] + " " + strconv.Itoa(y)
}
