// The monthly job (plan B54), for every template: modules/report/monthly-job.ts. On the first morning of the month, in the shop's time zone, the owner gets last month's report on
// WhatsApp, once. What is the same for all is here: when it may go, the claim before and the ending after, the retries, the quiet month. What a template gives is `Make`: its own
// report, its page and its message (Bookings: templates/commerce/bookings/report/monthly-job.ts, its Go twin comes with the Bookings wave).
//
// WHEN. From 09:00 on the 1st, not midnight. The job reports the month that has just ended and only that one; a month before the last one is never made up. A month in which the
// record holds nothing but this job's own entries gets no message and no record entry.
//
// ONCE, EVEN IF THE PROCESS DIES. The record is the only memory. (1) an entry `send_message` / `attempted` keyed by the month (`refs.report`, "2026-11") is written and SAVED before
// anything is sent; (2) the message is sent; (3) a second entry says how it ended (`confirmed`, `unconfirmed` or `failed`) and is saved. A month with an `attempted`, `confirmed` or
// `unconfirmed` entry is never sent again: each of those may have gone out. A claim found with no ending is closed as `unconfirmed` and not sent. Only `failed` (a refusal that says
// nothing was sent: NothingWasSent) is tried again, after an hour, three tries in all. Anything else is `unconfirmed`.
//
// WHAT THE BOOKINGS WAVE WRITES. The messaging stream's real types do not exist yet, so this file asks for the least: `Messaging` (the four calls the job makes; its errors are the
// kinds in sendonce.go, or any error with `HTTPStatus() int`), `DocumentSender` (checked by a type assertion, as the TypeScript checks `typeof sendDocument`), and the shop's record
// (accounting.Record) with a `Save` callback. The adapter turns the runtime's messaging client and record into these three and maps its provider errors to NotSentError,
// WindowClosedError and APIError. The job is one instance per shop and is not safe for two runs at once (the runtime runs it from its one tick).
//
// Where Go and JavaScript differ: the record's `time` is an ISO text read with time.Parse (the TypeScript's Date.parse; a time that does not parse counts as NaN, so neither "waiting"
// nor "activity" is concluded from it).
package report

import (
	"errors"
	"fmt"
	"time"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// SendFromHour is SEND_FROM_HOUR: the local hour from which last month's report may go.
const SendFromHour = 9

// Template is a pre-approved WhatsApp template message (messaging.ts TemplateMessage), as much of it as the report needs to pass on.
type Template struct {
	Name        string
	Language    string
	Text        string
	Parameters  []string
	HeaderImage string
}

// Document is a file sent by its address (messaging.ts DocumentMessage).
type Document struct{ Link, Filename, Caption string }

// Outbound is what WhatsApp took: its id.
type Outbound struct{ ID string }

// Messaging is the part of modules/messaging Messaging the job calls. GetMessage returns nil (and no error) for a message the provider does not show back.
type Messaging interface {
	IsWindowOpen(to string) (bool, error)
	SendText(to, text string) (Outbound, error)
	SendTemplate(to string, t Template) (Outbound, error)
	GetMessage(id string) (*Outbound, error)
}

// DocumentSender is the optional `sendDocument`: a provider without it is simply not asked.
type DocumentSender interface {
	SendDocument(to string, d Document) (Outbound, error)
}

// CertificateDoc is a certificate's text to send as a document, once, when the window is open.
type CertificateDoc struct{ Filename, Link, Caption, Code string }

// MadeReport is what a template's Make hands back: the report it made and the message to send.
type MadeReport struct {
	Code   string // the report's check code
	Folder string // the folder on disk the report was written into, for the log line when a send is given up on
	Page   string // the name of the folder the page is in, as the address has it: random, so the address cannot be guessed
	// Text is the words as plain text for an open window; Template the approved template for a closed one.
	Text        string
	Template    Template
	Certificate *CertificateDoc // nil: none
}

// MakeArgs is what Make is asked for.
type MakeArgs struct {
	Month    string
	Language string
	Now      int64
}

// JobContext is the shop's side of one run (MonthlyJobContext).
type JobContext struct {
	Timezone      string
	OwnerWhatsapp string
	OwnerLanguage string
	Now           func() int64 // the clock, epoch milliseconds
	Messaging     Messaging
	Record        accounting.Record
	Save          func()       // save the record as it is now: after the claim and after the ending, so a restart in between finds the claim
	Log           func(string) // nil is allowed
}

// MonthlyResult is what a run did. When Done is false, Why is "not-yet", "already", "quiet", "waiting" or "gave-up"; when true, Month, Outcome ("confirmed", "unconfirmed" or
// "failed") and Via ("template" or "text") say what was sent.
type MonthlyResult struct {
	Done    bool
	Why     string
	Month   string
	Outcome string
	Via     string
}

// MonthlyJob is createMonthlyJob(setup): the same schedule for every template.
type MonthlyJob struct {
	// Make makes the report for a month (written into a folder of its own) and the message that tells the owner. An error is returned from Run before anything is claimed.
	Make     func(MakeArgs) (MadeReport, error)
	finished struct{ month, why string } // the month this process found done or given up on, so a tick does not look again
	quiet    string
}

func monthKey(year, month int) string { return fmt.Sprintf("%d-%02d", year, month) }

// LastMonth is lastMonth: the month before the one it is now in this time zone, as "2026-11" (December of the year before for January).
func LastMonth(now int64, timeZone string) string {
	t := zone.LocalParts(now, timeZone)
	if t.Month == 1 {
		return monthKey(t.Year-1, 12)
	}
	return monthKey(t.Year, t.Month-1)
}

// SendFrom is sendFrom: the moment, in the shop's time zone, from which the report for the month before `now`'s may go: 09:00 on the 1st.
func SendFrom(now int64, timeZone string) int64 {
	t := zone.LocalParts(now, timeZone)
	return zone.ZonedToMs(zone.Date{Year: t.Year, Month: t.Month, Day: 1}, SendFromHour, 0, timeZone)
}

// parseTime is Date.parse of a record time; ok is false for NaN.
func parseTime(s string) (int64, bool) {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return 0, false
	}
	return t.UnixMilli(), true
}

// isOwn: an entry this job wrote itself (the claim, the ending, the document), or one the licence wrote (its state line and the owner's service notice) or the owner's morning line.
// They are not the shop's activity: a month holding only these would otherwise be reported forever.
func isOwn(e accounting.Entry) bool {
	if e.Action == "licence" {
		return true
	}
	if e.Action != "send_message" {
		return false
	}
	for _, k := range []string{"report", "reportFile", "licence", "morning"} {
		if _, ok := e.Refs[k]; ok {
			return true
		}
	}
	return false
}

// hasActivity: is there any entry of the shop's in [from, to)? The record is in time order, so look from the end and stop as soon as it is before the month.
func hasActivity(entries []accounting.Entry, from, to int64) bool {
	for i := len(entries) - 1; i >= 0; i-- {
		t, ok := parseTime(entries[i].Time)
		if ok && t >= to || isOwn(entries[i]) {
			continue
		}
		return ok && t >= from
	}
	return false
}

// Run is run(ctx): one look at whether this month's report is due and, if so, make it, claim it, send it and write the ending. The error is only from Make.
func (j *MonthlyJob) Run(ctx JobContext) (MonthlyResult, error) {
	log := ctx.Log
	if log == nil {
		log = func(string) {}
	}
	record := ctx.Record
	now := ctx.Now()
	tz := ctx.Timezone
	if now < SendFrom(now, tz) {
		return MonthlyResult{Why: "not-yet"}, nil
	}
	month := LastMonth(now, tz)
	if j.finished.month == month {
		return MonthlyResult{Why: j.finished.why}, nil
	}
	if j.quiet == month {
		return MonthlyResult{Why: "quiet"}, nil
	}
	owner := ctx.OwnerWhatsapp
	lang := ctx.OwnerLanguage

	// ---- has this month been sent, or tried? The record is the only memory. ----
	var mine []accounting.Entry
	all := record.Entries()
	for _, e := range all {
		if e.Action == "send_message" && e.Refs["report"] == month {
			mine = append(mine, e)
		}
	}
	var last *accounting.Entry
	if len(mine) > 0 {
		last = &mine[len(mine)-1]
	}
	if last != nil && last.Outcome == "attempted" { // the process stopped between the claim and the ending: it may have gone out
		refs := map[string]string{"to": "owner", "report": month}
		if c := last.Refs["code"]; c != "" {
			refs["code"] = c
		}
		if p := last.Refs["page"]; p != "" {
			refs["page"] = p
		}
		record.Append(accounting.NewEntry{
			Conversation: owner, Action: "send_message", Outcome: "unconfirmed", Inputs: map[string]any{"to": "owner", "report": month}, Language: lang,
			Notes: "The process stopped while this report was being sent, so it may or may not have reached the owner. It is not sent again.", Refs: refs,
		})
		ctx.Save()
		log(fmt.Sprintf("The monthly report for %s was being sent when the process stopped. It may or may not have reached the owner, and it will not be sent again. The record says so.", month))
		j.finished.month, j.finished.why = month, "already"
		return MonthlyResult{Why: "already"}, nil
	}
	refused := 0
	for _, e := range mine {
		if e.Outcome == "confirmed" || e.Outcome == "unconfirmed" {
			j.finished.month, j.finished.why = month, "already"
			return MonthlyResult{Why: "already"}, nil
		}
		if e.Outcome == "failed" {
			refused++
		}
	}
	if refused >= MaxTries {
		j.finished.month, j.finished.why = month, "gave-up"
		return MonthlyResult{Why: "gave-up"}, nil
	}
	if last != nil {
		if t, ok := parseTime(last.Time); ok && t+RetryAfterMs > now {
			return MonthlyResult{Why: "waiting"}, nil
		}
	}

	// ---- a month with nothing in the record gets no message ----
	from, to, err := MonthRange(month, tz)
	if err != nil {
		return MonthlyResult{}, err
	}
	if !hasActivity(all, from, to) {
		j.quiet = month
		return MonthlyResult{Why: "quiet"}, nil
	}

	// ---- make the report: the page, and whatever the template writes with it, in a folder of its own ----
	made, err := j.Make(MakeArgs{Month: month, Language: lang, Now: now})
	if err != nil {
		return MonthlyResult{}, err
	}
	refs := map[string]string{"to": "owner", "report": month, "code": made.Code, "page": made.Page, "templates": made.Template.Name}
	inputs := map[string]any{"to": "owner", "report": month, "code": made.Code}

	// ---- 1. claim the month, and save the claim before anything goes out ----
	record.Append(accounting.NewEntry{Conversation: owner, Action: "send_message", Outcome: "attempted", Inputs: inputs, Language: lang, Refs: refs})
	ctx.Save()

	// ---- 2. send it ----
	var outcome, note string
	via := "template"
	var sent *Outbound
	sendErr := func() error {
		if open, err := ctx.Messaging.IsWindowOpen(owner); err == nil && open {
			o, err := ctx.Messaging.SendText(owner, made.Text)
			var closed *WindowClosedError
			switch {
			case err == nil:
				sent, via = &o, "text"
			case !errors.As(err, &closed):
				return err
			}
		}
		if sent == nil {
			o, err := ctx.Messaging.SendTemplate(owner, made.Template)
			if err != nil {
				return err
			}
			sent = &o
		}
		shown, err := ctx.Messaging.GetMessage(sent.ID)
		if err != nil {
			return err
		}
		outcome = "unconfirmed"
		if shown != nil {
			outcome = "confirmed"
		}
		return nil
	}()
	if sendErr != nil {
		outcome = "unconfirmed" // once WhatsApp has taken it (`sent`), whatever happens next, it went out
		if sent == nil && NothingWasSent(sendErr) {
			outcome = "failed"
		}
		note = sendErr.Error()
	}

	// ---- 3. say how it ended ----
	endRefs := map[string]string{}
	for k, v := range refs {
		endRefs[k] = v
	}
	if sent != nil {
		endRefs["messageId"], endRefs["via"] = sent.ID, via
	}
	record.Append(accounting.NewEntry{Conversation: owner, Action: "send_message", Outcome: outcome, Inputs: inputs, Language: lang, Notes: note, Refs: endRefs})
	ctx.Save()
	if outcome == "failed" {
		tries := refused + 1
		next := fmt.Sprintf("That was the last try. The page is in %s.", made.Folder)
		if tries < MaxTries {
			next = fmt.Sprintf("It will be tried again in an hour (try %d of %d).", tries, MaxTries)
		}
		log(fmt.Sprintf("The monthly report for %s could not be sent to the owner (%s). %s", month, note, next))
	} else {
		what := "sent"
		if outcome != "confirmed" {
			what = "sent, but WhatsApp did not show it back"
		}
		as := "a template"
		if via == "text" {
			as = "a message"
		}
		log(fmt.Sprintf("The monthly report for %s was %s to the owner as %s (code %s).", month, what, as, made.Code))
		j.finished.month, j.finished.why = month, "already"
	}

	// ---- the certificate's text as a document, once, only when the owner's window is open (a file is a session message); a missing copy costs nothing ----
	if ds, ok := ctx.Messaging.(DocumentSender); ok && outcome == "confirmed" && via == "text" && made.Certificate != nil {
		sendCertificate(ctx, ds, month, lang, made.Page, *made.Certificate)
	}
	return MonthlyResult{Done: true, Month: month, Outcome: outcome, Via: via}, nil
}

// sendCertificate sends the certificate's text as a document, once, with its own claim and ending in the record; nothing here is retried, and nothing here fails the report.
func sendCertificate(ctx JobContext, ds DocumentSender, month, lang, page string, c CertificateDoc) {
	owner := ctx.OwnerWhatsapp
	refs := map[string]string{"to": "owner", "reportFile": month, "kind": "document", "code": c.Code, "page": page}
	inputs := map[string]any{"to": "owner", "reportFile": month}
	ctx.Record.Append(accounting.NewEntry{Conversation: owner, Action: "send_message", Outcome: "attempted", Inputs: inputs, Language: lang, Refs: refs})
	ctx.Save()
	var outcome, note, id string
	sent, err := ds.SendDocument(owner, Document{Link: c.Link, Filename: c.Filename, Caption: c.Caption})
	if err == nil {
		id = sent.ID
		var shown *Outbound
		if shown, err = ctx.Messaging.GetMessage(sent.ID); err == nil {
			outcome = "unconfirmed"
			if shown != nil {
				outcome = "confirmed"
			}
		}
	}
	if err != nil {
		outcome = "unconfirmed"
		if NothingWasSent(err) {
			outcome = "failed"
		}
		note = err.Error()
	}
	endRefs := map[string]string{}
	for k, v := range refs {
		endRefs[k] = v
	}
	if id != "" {
		endRefs["messageId"] = id
	}
	ctx.Record.Append(accounting.NewEntry{Conversation: owner, Action: "send_message", Outcome: outcome, Inputs: inputs, Language: lang, Notes: note, Refs: endRefs})
	ctx.Save()
}
