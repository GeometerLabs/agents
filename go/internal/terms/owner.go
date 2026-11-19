// The owner's side of the shop terms on WhatsApp (B72): "terms" sends the terms in the owner's language with an "I agree" button; "I agree" (typed, or the button) records the agreement
// in the shop's record. Called by the Bookings, Orders and Fees runtimes from their owner handling. The Go twin of modules/terms/owner.ts.
//
// Why it is safe to add: with no terms file (the default) Setup is nil and HandleOwner returns false at once, so nothing changes for any shop. It never touches a limit, an approval
// or a customer. Only the owner's number reaches an agent's owner handling, so a customer or an approver writing "I agree" is not an agreement.
//
// What is recorded: `terms_sent` (digest, version, language) when the terms went out, and `terms_agreed` (the same three, plus the reply's WhatsApp message id) when the owner agreed. An
// agreement counts only if a `terms_sent` with the SAME digest is in the record: terms changed since (a new price, a new version) need to be sent and agreed again. The terms go out
// as plain text in the owner's open window, so no Meta template is needed.
//
// The messaging and the record are small interfaces defined here, so the Bookings, Orders and Fees runtimes pass whatever messaging and record they have; the package imports neither.
package terms

import (
	"context"
	"strings"
)

// Message is the inbound message (InboundMessage): its id, its text, and the id of the button or list row the owner tapped (nil when they typed).
type Message struct {
	ID      string
	Text    string
	ReplyID *string
}

// Button is one button of an interactive message.
type Button struct{ ID, Title string }

// Interactive is a message with buttons.
type Interactive struct {
	Body    string
	Buttons []Button
}

// Messaging is what the owner's side sends with. SendInteractive is optional, as `messaging.sendInteractive?` is in TypeScript: a Messaging that also implements InteractiveSender gets
// the buttons, and one that does not gets the question and the words of the agree button as plain text.
type Messaging interface {
	SendText(ctx context.Context, to, body string) error
}

// InteractiveSender is the optional half of Messaging.
type InteractiveSender interface {
	SendInteractive(ctx context.Context, to string, m Interactive) error
}

// Entry is the part of a record entry this reads: what was done, how it ended, and its references.
type Entry struct {
	Action, Outcome string
	Refs            map[string]string
}

// Record is the shop's action record, read for the entries so far (oldest first).
type Record interface{ Entries() []Entry }

// LogMore is the notes and references of a record line.
type LogMore struct {
	Notes string
	Refs  map[string]string
}

// Deps is OwnerTermsDeps. Log is the agent's own log (so the entry gets the agent's key and language handling); inputs is `{ digest }`.
type Deps struct {
	// Setup is the shop's terms file now; nil means the feature is off for this shop.
	Setup         *File
	ShopName      string
	OwnerNumber   string
	OwnerLanguage string
	Messaging     Messaging
	Record        Record
	Log           func(action, outcome string, inputs any, more LogMore)
}

// HandleOwner is handleOwnerTerms: did this handler take the owner's message? True means the agent should do nothing more with it.
func HandleOwner(ctx context.Context, msg Message, d Deps) bool {
	if d.Setup == nil {
		return false
	}
	tapped := msg.ReplyID
	asked := tapped == nil && IsTermsRequest(msg.Text)
	var agreed bool
	if tapped != nil {
		agreed = strings.HasPrefix(*tapped, AgreePrefix)
	} else {
		agreed = IsAgreeWords(msg.Text)
	}
	later := tapped != nil && *tapped == LaterID
	if !asked && !agreed && !later {
		return false
	}

	lang := d.OwnerLanguage
	words, ok := Words(lang, Version)
	if !ok {
		return false // the TypeScript would throw on a language it has no row for; the caller's language is one of the four
	}
	text, err := Text(lang, d.ShopName, *d.Setup)
	if err != nil {
		return false
	}
	digest := Digest(text)
	reply := func(body string) { _ = d.Messaging.SendText(ctx, d.OwnerNumber, body) } // the window or the provider failed: the record below says what happened

	if later {
		reply(words.OK)
		return true
	}

	if asked {
		if err := sendTerms(ctx, d, text, words); err != nil {
			d.Log(SentAction, "failed", map[string]string{"digest": digest}, LogMore{Notes: "the shop terms could not be sent to the owner (" + err.Error() + ")", Refs: map[string]string{"termsVersion": Version, "termsLanguage": lang}})
			return true
		}
		d.Log(SentAction, "confirmed", map[string]string{"digest": digest}, LogMore{Notes: "the shop terms were sent to the owner on WhatsApp, in the owner's language", Refs: map[string]string{"termsDigest": digest, "termsVersion": Version, "termsLanguage": lang}})
		return true
	}

	// agreed: only for the terms that were last sent, unchanged
	entries := d.Record.Entries()
	var sent *Entry
	for i := len(entries) - 1; i >= 0; i-- {
		if entries[i].Action == SentAction && entries[i].Outcome == "confirmed" {
			sent = &entries[i]
			break
		}
	}
	buttonDigest := ""
	if tapped != nil {
		buttonDigest = (*tapped)[len(AgreePrefix):]
	}
	if sent == nil || sent.Refs["termsDigest"] != digest || (tapped != nil && buttonDigest != digest[:12]) {
		notes := "the owner said they agree, but the terms have changed since they were sent, so nothing is recorded; they must be sent again"
		if sent == nil {
			notes = "the owner said they agree, but these terms were never sent to them, so nothing is recorded"
		}
		d.Log(AgreedAction, "blocked", map[string]string{"digest": digest}, LogMore{Notes: notes, Refs: map[string]string{"termsVersion": Version}})
		reply(words.AskFirst)
		return true
	}
	for _, e := range entries {
		if e.Action == AgreedAction && e.Outcome == "confirmed" && e.Refs["termsDigest"] == digest {
			reply(words.Already)
			return true
		}
	}
	d.Log(AgreedAction, "confirmed", map[string]string{"digest": digest}, LogMore{Notes: "the owner agreed to the shop terms on WhatsApp, from the owner's own number", Refs: map[string]string{"termsDigest": digest, "termsVersion": Version, "termsLanguage": lang, "messageId": msg.ID}})
	reply(words.Done)
	return true
}

// sendTerms sends the terms, then the question with its two buttons (or as plain text when the messaging has no buttons).
func sendTerms(ctx context.Context, d Deps, text string, w Answers) error {
	if err := d.Messaging.SendText(ctx, d.OwnerNumber, text); err != nil {
		return err
	}
	digest := Digest(text)
	if is, ok := d.Messaging.(InteractiveSender); ok {
		return is.SendInteractive(ctx, d.OwnerNumber, Interactive{Body: w.Ask, Buttons: []Button{{ID: AgreePrefix + digest[:12], Title: w.Agree}, {ID: LaterID, Title: w.Later}}})
	}
	return d.Messaging.SendText(ctx, d.OwnerNumber, w.Ask+" "+w.Agree)
}
