// WhatsApp's later reports on the messages a shop sent (delivered, read, failed), written into the shop's record against the message they are about (statuses.ts). The runtime calls
// RecordMessageStatus for each `message_status` event the inbox forwards; the agent never sees one, so a report changes no booking, no fee and no order, and nothing is ever sent again
// because of one.
//
// Why this matters: a send call's answer means only that WhatsApp (or Gupshup) ACCEPTED the message, and the record's send line says "confirmed" for that read-back. Gupshup accepts first
// and asks Meta afterwards, so even a closed 24-hour window (131047) arrives here, later, as "failed". These lines keep the two apart in words.
//
// The record is an INTERFACE (Record) the runtime implements over its own recorder (go/internal/runtime/record.go), so this file holds the rules and none of the storage. The record's
// notes are English words written for the person reading the shop's record; they are typed here and pinned to the TypeScript's by vectors (testdata/status-vectors.json).
package messaging

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strconv"
)

// MessageStatusEntry is unfinished/registry.ts MESSAGE_STATUS_ENTRY: the record action of a report.
const MessageStatusEntry = "message_status"

// Entry is the part of a record line this file reads (record.ts RecordEntry): the line that sent a message, found again by the id it kept.
type Entry struct {
	Seq          int               `json:"seq"`
	Conversation string            `json:"conversation"`
	Booking      *string           `json:"booking"`
	Action       string            `json:"action"`
	Language     Language          `json:"language"`
	Refs         map[string]string `json:"refs"`
}

// NewEntry is the line RecordMessageStatus writes (record.ts NewEntry). Inputs is a map the recorder digests (its keys are sorted there).
type NewEntry struct {
	Conversation string
	Booking      *string
	Action       string
	Inputs       map[string]any
	Outcome      string
	Language     Language
	Notes        string
	Refs         map[string]string
}

// Record is the record's two methods this file needs: every line so far, and append. The runtime's recorder keeps a message id only as its keyed fingerprint (B69), and does that itself
// on Append, so a NewEntry carries the plain id.
type Record interface {
	Entries() []Entry
	Append(e NewEntry) Entry
}

// StatusContext is who the shop's owner and approvers are, and the record's key.
type StatusContext struct {
	// Owner's number and language: a report on a message to the owner is the owner's, and a line with no sent message to copy a language from uses theirs. nil: unknown.
	Owner *OwnerInfo
	// Approvers are the other approvers' numbers (B37).
	Approvers []string
	// RecordKey is the record's key (B69): the send line keeps its message id as a fingerprint under it, so the report's ids are looked for in the same form. nil: the id itself.
	RecordKey []byte
}

// MessageFingerprint is fingerprint.ts messageFingerprint: WhatsApp's own message id can carry the sender's number, so it is kept as "m-<12 hex>" of its HMAC-SHA256 under the key.
func MessageFingerprint(key []byte, id string) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte("geometer/message/1\n" + id))
	return "m-" + hex.EncodeToString(m.Sum(nil))[:12]
}

var (
	nonDigit  = regexp.MustCompile(`[^0-9]`)
	numberish = regexp.MustCompile(`^\+?[0-9]{6,15}$`)
)

// FindSentEntry is the newest line that sent this message (any action with a messageId that is not a received message or another report), and the id it matched by. The ids are compared
// in the form the record keeps them: a fingerprint under the shop's key, or the id itself without one.
func FindSentEntry(entries []Entry, ids []string, recordKey []byte) (entry Entry, id string, ok bool) {
	stored := map[string]string{}
	for _, id := range ids {
		if recordKey != nil {
			stored[MessageFingerprint(recordKey, id)] = id
		} else {
			stored[id] = id
		}
	}
	for i := len(entries) - 1; i >= 0; i-- {
		e := entries[i]
		mid, has := e.Refs["messageId"]
		if e.Action == MessageStatusEntry || e.Action == "receive_message" || !has {
			continue
		}
		if found, ok := stored[mid]; ok {
			return e, found, true
		}
	}
	return Entry{}, "", false
}

// recipientOf: who the message was for: what the send line says, or else the number in the report (or on the send line) against the owner's and the approvers'.
func recipientOf(s MessageStatus, sent *Entry, ctx StatusContext) string {
	if sent != nil && (sent.Refs["to"] == "owner" || sent.Refs["to"] == "customer") {
		return sent.Refs["to"]
	}
	number := s.To
	if number == "" && sent != nil && numberish.MatchString(sent.Conversation) {
		number = sent.Conversation
	}
	if number == "" {
		return "unknown"
	}
	digits := func(n string) string { return nonDigit.ReplaceAllString(n, "") }
	if ctx.Owner != nil && digits(ctx.Owner.WhatsApp) == digits(number) {
		return "owner"
	}
	for _, a := range ctx.Approvers {
		if digits(a) == digits(number) {
			return "approver"
		}
	}
	return "customer"
}

// notesFor is the line's words: what WhatsApp reported, kept apart from what the send line meant ("accepted"). English, as every record note is.
func notesFor(s MessageStatus, listed, matched bool) string {
	code := ""
	if s.Error != nil {
		switch {
		case s.Error.Code != nil && s.Error.Title != "":
			code = " (code " + strconv.FormatInt(*s.Error.Code, 10) + ": " + s.Error.Title + ")"
		case s.Error.Code != nil:
			code = " (code " + strconv.FormatInt(*s.Error.Code, 10) + ")"
		case s.Error.Title != "":
			code = " (" + s.Error.Title + ")"
		}
	}
	var said string
	switch s.Status {
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
	if matched {
		return said
	}
	return said + " No line in this record sent a message with this id: something else on the shop's server sent it (the approvals relay sends its own messages to the owner), or it was sent before this record began."
}

// reliedOn is registry.ts reliedOn: was a message one the shop counted on? One about a case, or one to the owner or another approver.
func reliedOn(to string, hasCase bool) bool { return to == "owner" || to == "approver" || hasCase }

// RecordMessageStatus writes one record line for a report: action `message_status`, outcome "confirmed" for delivered and read (WhatsApp's own word that it arrived) and "failed" for failed.
// It copies the case and the conversation from the line that sent the message, so a failure about a booking sits with that booking. The same report twice (a provider retrying, or
// Gupshup's ids in another order) writes one line. It returns the line and true, or false when it was already there. The error is always nil (kept for callers): since 22 Nov a time
// outside the Date range is left out of the line on both sides, where the TypeScript's toISOString() used to throw.
func RecordMessageStatus(rec Record, s MessageStatus, ctx StatusContext) (Entry, bool, error) {
	entries := rec.Entries()
	found, foundID, has := FindSentEntry(entries, s.IDs, ctx.RecordKey)
	var sent *Entry
	messageID := ""
	if len(s.IDs) > 0 {
		messageID = s.IDs[0]
	}
	if has {
		sent, messageID = &found, foundID
	}
	kept := messageID
	if ctx.RecordKey != nil {
		kept = MessageFingerprint(ctx.RecordKey, messageID)
	}
	for _, e := range entries {
		if e.Action == MessageStatusEntry && e.Refs["messageId"] == kept && e.Refs["status"] == s.Status {
			return Entry{}, false, nil
		}
	}
	to := recipientOf(s, sent, ctx)
	var caseID *string
	if sent != nil {
		caseID = sent.Booking
	}
	listed := s.Status == "failed" && reliedOn(to, caseID != nil)
	inputs := map[string]any{"status": s.Status, "ids": s.IDs}
	if s.Error != nil {
		e := map[string]any{}
		if s.Error.Code != nil {
			e["code"] = *s.Error.Code
		}
		if s.Error.Title != "" {
			e["title"] = s.Error.Title
		}
		inputs["error"] = e
	}
	conversation := "unknown"
	if sent != nil {
		conversation = sent.Conversation
	} else if s.To != "" {
		conversation = s.To
	}
	lang := Language("en")
	if sent != nil {
		lang = sent.Language
	} else if ctx.Owner != nil {
		lang = ctx.Owner.Language
	}
	outcome := "confirmed"
	if s.Status == "failed" {
		outcome = "failed"
	}
	refs := map[string]string{"messageId": messageID, "status": s.Status, "to": to}
	if sent != nil {
		refs["sent"] = strconv.Itoa(sent.Seq)
	}
	if s.Timestamp > 0 {
		if iso, ok := isoString(s.Timestamp); ok { // statuses.ts: past ±8.64e15 ms the time is left out
			refs["reportedAt"] = iso
		}
	}
	if s.Error != nil && s.Error.Code != nil {
		refs["errorCode"] = strconv.FormatInt(*s.Error.Code, 10)
	}
	line := rec.Append(NewEntry{Conversation: conversation, Booking: caseID, Action: MessageStatusEntry, Inputs: inputs, Outcome: outcome, Language: lang, Notes: notesFor(s, listed, sent != nil), Refs: refs})
	return line, true, nil
}
