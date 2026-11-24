package runtime

// The shop owner's one plain service notice for the licence's wind-down and final stop (plan B13): the Go twin of modules/licence/notice.ts, the same for every template. ONCE for
// each `paid_through`, even if the process dies: the record is the only memory, the way the monthly report keeps it.
//
//  1. Is the shop restricted (the wind-down or the final stop) by a lease that lists it? No: nothing to say.
//  2. The notice's key is "<wind_down|stop>:<paid_through>". A send_message to the owner with `refs.licence` = that key that went out (confirmed or unconfirmed) means it was
//     sent; a claim with no ending (the process stopped between the two) may have gone out, so it is closed as unconfirmed and NOT sent again.
//  3. Otherwise: claim it (`attempted`), save, send (as text in the owner's open window, else the approved utility template), read it back, write how it ended, save. A refusal
//     before anything went out is tried again an hour later, three tries in all.
//
// The template gives the words (NoticeContext.Message). It runs on the clock's beat after the agent's own work (an AfterTicker), like the monthly report; in the final stop it is
// the one message that still goes from the shop.

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
)

// notice.ts NOTICE_RETRY_MS and NOTICE_TRIES.
const (
	NoticeRetryMs = 3_600_000
	NoticeTries   = 3
)

// NoticeContext is notice.ts NoticeContext with the setup's `licence` and `message` folded in.
type NoticeContext struct {
	// Licence is the step's licence ("", "paused" or "stopped") and PaidThrough the lease's paid_through (nil: the shop is not in a lease).
	Licence     string
	PaidThrough *int64
	Owner       string
	Language    string
	Now         int64
	Messaging   messaging.Messaging
	Rec         *Recorder
	Save        func() error
	Log         func(string)
	// Message is the notice in the owner's language: the words for an open window, and the approved template that carries the same words when it is closed. kind is "wind_down"
	// or "stop".
	Message func(kind string) (text string, template messaging.TemplateMessage, err error)
}

// NoticeDue is notice.ts noticeDue: the notice due now and its key, or "" (the stop's replaces the wind-down's: a shop that went straight to the stop hears of the stop only).
func NoticeDue(licence string, paidThrough *int64) (kind, key string) {
	if licence == "" || paidThrough == nil {
		return "", ""
	}
	kind = "wind_down"
	if licence == "stopped" {
		kind = "stop"
	}
	return kind, kind + ":" + strconv.FormatInt(*paidThrough, 10)
}

// RunLicenceNotice is the notice's `run(ctx)`. It says whether a notice went (and why not when none did). An error saving is returned; a send that failed is in the record.
func RunLicenceNotice(c NoticeContext) (sent bool, why string, err error) {
	// decision 65: in a shop of several parts the notice is the shop's, said once, by its first part (record.go SharedBeatOff)
	if c.Rec != nil && c.Rec.SharedBeatOff() {
		return false, "another-part", nil
	}
	kind, key := NoticeDue(c.Licence, c.PaidThrough)
	if kind == "" {
		return false, "none-due", nil
	}
	inputs := map[string]any{"to": "owner", "licence": key}
	var mine []int
	entries := c.Rec.Entries()
	for i, e := range entries {
		if e.Action == "send_message" && e.Refs["licence"] == key {
			mine = append(mine, i)
		}
	}
	if len(mine) > 0 && entries[mine[len(mine)-1]].Outcome == "attempted" {
		c.Rec.Append(NewLine{Conversation: c.Owner, Action: "send_message", Outcome: "unconfirmed", Inputs: inputs, Language: c.Language,
			Notes: "The process stopped while this service notice was being sent, so it may or may not have reached the owner. It is not sent again.", Refs: map[string]string{"to": "owner", "licence": key}})
		return false, "already", c.Save()
	}
	refused := 0
	for _, i := range mine {
		switch entries[i].Outcome {
		case "confirmed", "unconfirmed":
			return false, "already", nil
		case "failed":
			refused++
		}
	}
	if refused >= NoticeTries {
		return false, "gave-up", nil
	}
	if len(mine) > 0 {
		if at, perr := time.Parse("2006-01-02T15:04:05.000Z", entries[mine[len(mine)-1]].Time); perr == nil && at.UnixMilli()+NoticeRetryMs > c.Now {
			return false, "waiting", nil
		}
	}
	text, tmpl, merr := c.Message(kind)
	if merr != nil {
		return false, "", merr
	}
	refs := map[string]string{"to": "owner", "licence": key, "templates": tmpl.Name}
	c.Rec.Append(NewLine{Conversation: c.Owner, Action: "send_message", Outcome: "attempted", Inputs: inputs, Language: c.Language, Refs: refs})
	if err := c.Save(); err != nil {
		return false, "", err
	}
	ctx := context.Background()
	var out *messaging.OutboundMessage
	via, outcome, note := "template", "", ""
	func() {
		if open, oerr := c.Messaging.IsWindowOpen(ctx, c.Owner); oerr == nil && open {
			m, serr := c.Messaging.SendText(ctx, c.Owner, text)
			var closed *guard.WindowClosedError
			switch {
			case serr == nil:
				out, via = &m, "text"
			case !errors.As(serr, &closed):
				outcome, note = sendOutcome(out, serr), serr.Error()
				return
			}
		}
		if out == nil {
			m, serr := c.Messaging.SendTemplate(ctx, c.Owner, tmpl)
			if serr != nil {
				outcome, note = sendOutcome(nil, serr), serr.Error()
				return
			}
			out = &m
		}
		back, gerr := c.Messaging.GetMessage(ctx, out.ID)
		switch {
		case gerr != nil:
			outcome, note = "unconfirmed", gerr.Error()
		case back != nil:
			outcome = "confirmed"
		default:
			outcome = "unconfirmed"
		}
	}()
	end := map[string]string{}
	for k, v := range refs {
		end[k] = v
	}
	if out != nil {
		end["messageId"], end["via"] = out.ID, via
	}
	c.Rec.Append(NewLine{Conversation: c.Owner, Action: "send_message", Outcome: outcome, Inputs: inputs, Language: c.Language, Notes: note, Refs: end})
	if err := c.Save(); err != nil {
		return true, "", err
	}
	if c.Log != nil {
		what := "the wind-down"
		if kind == "stop" {
			what = "the final stop"
		}
		switch outcome {
		case "failed":
			more := "That was the last try."
			if refused+1 < NoticeTries {
				more = "It is tried again in an hour."
			}
			c.Log("The owner's service notice (" + what + ") could not be sent (" + note + "). " + more)
		case "unconfirmed":
			c.Log("The owner was sent the service notice for " + what + ", but WhatsApp did not show it back.")
		default:
			c.Log("The owner was sent the service notice for " + what + ".")
		}
	}
	return true, "", nil
}

// sendOutcome is notice.ts's `!sent && nothingWasSent(e) ? "failed" : "unconfirmed"`.
func sendOutcome(out *messaging.OutboundMessage, err error) string {
	if out == nil && messaging.NothingWasSent(err) {
		return "failed"
	}
	return "unconfirmed"
}
