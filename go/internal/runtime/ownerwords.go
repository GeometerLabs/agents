package runtime

// The owner's fixed words every template's runtime reads the same way, in one place (23 Nov 2026, go-fees-gaps-23nov): the handover code (modules/approvals/handover.ts: "move
// K7M2QX" is the owner agreeing, from their own number, to hand the shop to another Operator or builder; the record keeps only the code's hash) and the adapters the shop terms
// (internal/terms, B72) are called through. Until now internal/bookings and internal/orders each had their own copy of the terms adapters, and internal/orders the only copy of
// the handover code; Fees needed both, so they were moved here and the copies deleted (decision 61, "no duplicates"). internal/terms imports neither messaging nor the record on
// purpose, so the adapters live on the runtime's side.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/store"
	"github.com/GeometerLabs/agents/go/internal/terms"
)

// HandoverAction is handover.ts HANDOVER_ACTION: the record line of the owner's agreement.
const HandoverAction = "handover_agreed"

// handoverReply is handover.ts HANDOVER_REPLY, /^\s*move\s+([A-HJ-NP-Za-hj-np-z2-9]{4,6})\s*$/i: `\s` is JavaScript's (language.JSSpace) and (?i) folds case as the i flag does.
var handoverReply = regexp.MustCompile(`(?i)^[` + language.JSSpace + `]*move[` + language.JSSpace + `]+([A-HJKMNP-Za-hjkmnp-z2-9]{4,6})[` + language.JSSpace + `]*$`)

// HandoverCode is handover.ts parseHandoverReply: the code of "move K7M2QX", and whether the words were that.
func HandoverCode(text string) (string, bool) {
	m := handoverReply.FindStringSubmatch(text)
	if m == nil {
		return "", false
	}
	return m[1], true
}

// HandoverHash is handover.ts handoverHash: its own prefix, so an approval code can never be replayed as a handover code or the reverse. The code is upper-cased first (codes are
// ASCII, so Go's ToUpper is JavaScript's toUpperCase here).
func HandoverHash(code string) string {
	sum := sha256.Sum256([]byte("handover-code:" + strings.ToUpper(code)))
	return hex.EncodeToString(sum[:])
}

// HandoverRefs are the refs of the record line: the command in the clear and the code's hash (never the code).
func HandoverRefs(code string) map[string]string {
	return map[string]string{"command": "handover", "handover": HandoverHash(code)}
}

// HandoverNotes are the notes of that line, as every template writes them.
const HandoverNotes = "the owner agreed, from their own number, to hand the shop to another Operator or builder. The panel checks the code before it moves anything"

// TermsMessage is the owner's message as the terms read it: its id, its words, the button they tapped.
func TermsMessage(m messaging.InboundMessage) terms.Message {
	out := terms.Message{ID: m.ID, Text: m.Text}
	if m.Reply != nil {
		id := m.Reply.ID
		out.ReplyID = &id
	}
	return out
}

// TermsMessaging is a shop's messaging as the terms send with it: an interactive message when the provider has buttons, else the plain words (terms.InteractiveSender).
func TermsMessaging(m messaging.Messaging) terms.Messaging { return termsMessaging{m} }

type termsMessaging struct{ m messaging.Messaging }

func (t termsMessaging) SendText(ctx context.Context, to, body string) error {
	_, err := t.m.SendText(ctx, to, body)
	return err
}

func (t termsMessaging) SendInteractive(ctx context.Context, to string, m terms.Interactive) error {
	inter, ok := t.m.(messaging.Interactive)
	if !ok {
		_, err := t.m.SendText(ctx, to, m.Body)
		return err
	}
	var bs []messaging.Choice
	for _, b := range m.Buttons {
		bs = append(bs, messaging.Choice{ID: b.ID, Title: b.Title})
	}
	_, err := inter.SendInteractive(ctx, to, messaging.InteractiveMessage{Body: m.Body, Buttons: bs})
	return err
}

// TermsRecord is a step's record as the terms read it (its entries so far, oldest first).
func TermsRecord(entries func() []store.Entry) terms.Record { return termsRecord(entries) }

type termsRecord func() []store.Entry

func (t termsRecord) Entries() []terms.Entry {
	var out []terms.Entry
	for _, e := range t() {
		out = append(out, terms.Entry{Action: e.Action, Outcome: e.Outcome, Refs: e.Refs})
	}
	return out
}
