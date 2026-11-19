package runtime

// WhatsApp's later reports on the messages a shop sent (delivered, read, failed), written into the record against the message they are about: modules/messaging/statuses.ts,
// line for line. The core runs it for a `message_status` event and never hands one to the agent, so a report changes no case and nothing is ever sent again because of one.

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// MessageStatusEntry is unfinished/registry.ts MESSAGE_STATUS_ENTRY.
const MessageStatusEntry = "message_status"

// statusContext is statuses.ts StatusContext: whose number a report names (the owner's, the other approvers').
type statusContext struct {
	ownerNumber, ownerLanguage string
	approvers                  []string
}

func onlyDigits(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, s)
}

var sentNumber = regexp.MustCompile(`^\+?\d{6,15}$`)

// recordMessageStatus writes one line for a report (or nothing when the same report is already there). `status` is the checked event's status (events.go checkStatus).
func recordMessageStatus(rec *Recorder, status map[string]any, ctx statusContext) {
	var ids []string
	for _, x := range status["ids"].([]any) {
		ids = append(ids, x.(string))
	}
	state, _ := status["status"].(string)
	to, _ := status["to"].(string)
	entries := rec.Entries()
	// findSentEntry: the newest line that sent this message, compared in the form the record keeps ids (the keyed fingerprint, or the id itself)
	stored := map[string]string{}
	for _, id := range ids {
		stored[rec.Fingerprint(id)] = id
	}
	sentIdx, matched := -1, ""
	for i := len(entries) - 1; i >= 0; i-- {
		e := entries[i]
		mid, has := e.Refs["messageId"]
		if e.Action == MessageStatusEntry || e.Action == "receive_message" || !has {
			continue
		}
		if id, ok := stored[mid]; ok {
			sentIdx, matched = i, id
			break
		}
	}
	messageID := ids[0]
	if sentIdx >= 0 {
		messageID = matched
	}
	kept := rec.Fingerprint(messageID)
	for _, e := range entries {
		if e.Action == MessageStatusEntry && e.Refs["messageId"] == kept && e.Refs["status"] == state {
			return
		}
	}
	// recipientOf
	who := "unknown"
	var conversation, lang string
	var caseID string
	if sentIdx >= 0 {
		sent := entries[sentIdx]
		conversation, lang = sent.Conversation, sent.Language
		if sent.Booking != nil {
			caseID = *sent.Booking
		}
	}
	if sentIdx >= 0 && (entries[sentIdx].Refs["to"] == "owner" || entries[sentIdx].Refs["to"] == "customer") {
		who = entries[sentIdx].Refs["to"]
	} else {
		number := to
		if number == "" && sentIdx >= 0 && sentNumber.MatchString(entries[sentIdx].Conversation) {
			number = entries[sentIdx].Conversation
		}
		switch {
		case number == "":
		case ctx.ownerNumber != "" && onlyDigits(ctx.ownerNumber) == onlyDigits(number):
			who = "owner"
		case func() bool {
			for _, a := range ctx.approvers {
				if onlyDigits(a) == onlyDigits(number) {
					return true
				}
			}
			return false
		}():
			who = "approver"
		default:
			who = "customer"
		}
	}
	listed := state == "failed" && (who == "owner" || who == "approver" || caseID != "")
	errObj, hasErr := status["error"].(map[string]any)
	// notesFor
	code := ""
	if hasErr {
		title, _ := errObj["title"].(string)
		if c, ok := errObj["code"].(float64); ok {
			code = fmt.Sprintf(" (code %d", int64(c))
			if title != "" {
				code += ": " + title
			}
			code += ")"
		} else if title != "" {
			code = " (" + title + ")"
		}
	}
	var said string
	switch state {
	case "delivered":
		said = "WhatsApp reported this message delivered to the person's phone. When it was sent, WhatsApp had only accepted it; this is the later delivery report."
	case "read":
		said = "WhatsApp reported this message read on the person's phone."
	default:
		said = "WhatsApp reported this message failed" + code + ": it never reached the person's phone, although it was accepted when it was sent. Nothing is sent again by itself."
		if listed {
			said += " It is listed on the shop's to-do list for a person to follow up."
		}
	}
	if sentIdx < 0 {
		said += " No line in this record sent a message with this id: something else on the shop's server sent it (the approvals relay sends its own messages to the owner), or it was sent before this record began."
	}
	if conversation == "" {
		conversation = to
		if conversation == "" {
			conversation = "unknown"
		}
	}
	if lang == "" {
		lang = ctx.ownerLanguage
		if lang == "" {
			lang = "en"
		}
	}
	inputs := map[string]any{"status": state, "ids": status["ids"]}
	if hasErr {
		inputs["error"] = errObj
	}
	refs := map[string]string{"messageId": messageID, "status": state, "to": who}
	if sentIdx >= 0 {
		refs["sent"] = fmt.Sprint(entries[sentIdx].Seq)
	}
	if ts, _ := status["timestamp"].(float64); ts > 0 {
		refs["reportedAt"] = time.UnixMilli(int64(ts)).UTC().Format("2006-01-02T15:04:05.000Z")
	}
	if hasErr {
		if c, ok := errObj["code"].(float64); ok {
			refs["errorCode"] = fmt.Sprint(int64(c))
		}
	}
	outcome := "confirmed"
	if state == "failed" {
		outcome = "failed"
	}
	rec.Append(NewLine{Conversation: conversation, Booking: caseID, Action: MessageStatusEntry, Outcome: outcome, Inputs: inputs, Language: lang, Notes: said, Refs: refs})
}
