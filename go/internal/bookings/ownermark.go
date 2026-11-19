package bookings

// A UPI shop's owner-marked payments, as the Bookings runtime meets them: the ledger in the store's `upi` member (internal/payments/ownermarked), the link the customer pays through, and
// the owner's buttons (interactive.ts `ownerMarkButtons` over modules/payments/owner-marked/buttons.ts `ownerMarkChoices`).
//
// The ledger is kept in the store as raw JSON (state.go keeps `upi` whole, so a shop that goes back to the TypeScript runtime finds every field); UpiState reads it into the typed ledger
// and SetUpiState writes it back, so the agent changes it in place inside a step and the runtime saves the step whole or not at all.

import (
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/payments/upi"
)

// UpiState is the owner-marked ledger of this store: a fresh one when the shop has not sent a request yet (the member is left out until the first).
func (s *Store) UpiState() (*ownermarked.State, error) { return ownermarked.Parse(s.Upi) }

// SetUpiState writes the ledger back as the store's `upi` member.
func (s *Store) SetUpiState(st *ownermarked.State) error {
	raw, err := st.JSON()
	if err != nil {
		return err
	}
	s.Upi = raw
	return nil
}

// UpiPayLink is providers/index.ts ownerMarkedOf(settings.payment).payLink for a UPI shop: the `upi://pay` link with the shop's own UPI ID and payee, the exact amount and the reference as
// its note (never the owner's code). nil for a shop that is not owner-marked.
func (s *Settings) UpiPayLink() ownermarked.PayLink {
	if !s.OwnerMarked() {
		return nil
	}
	return func(amountPaise int64, note string) (string, error) {
		return upi.PayLink(upi.Request{Vpa: s.Payment.UpiID, Payee: s.Payment.Payee, AmountPaise: amountPaise, Note: note})
	}
}

// OwnerMarkAsk is what the owner is asked about: "received" (Kind "received", the amount still asked) or a refund owed (Kind "refund", and whether "kept for booking" is offered).
type OwnerMarkAsk struct {
	Kind        string // "received" or "refund"
	Code        string
	AmountInr   float64
	KeepAllowed bool
}

// OwnerMarkButtons is ownerMarkButtons(language, ask): "Received ₹200" (the exact amount still asked), "Refund sent" and, where it is true, "Kept for booking". Each button's id carries its
// one-use code (ownermarked.MarkButtonID); the words are Bookings' own labels, in the owner's language, cut to a button's length.
func OwnerMarkButtons(lang string, a OwnerMarkAsk) []Choice {
	w := WordsFor(lang)
	if a.Kind == "received" {
		return []Choice{{ID: ownermarked.MarkButtonID(ownermarked.ReplyReceived, a.Code), Title: Clip(w.Labels["received"]+" "+language.FormatInr(a.AmountInr), w.Limits.ButtonTitle)}}
	}
	out := []Choice{{ID: ownermarked.MarkButtonID(ownermarked.ReplyRefunded, a.Code), Title: Clip(w.Labels["refundSent"], w.Limits.ButtonTitle)}}
	if a.KeepAllowed && w.Labels["keptForBooking"] != "" {
		out = append(out, Choice{ID: ownermarked.MarkButtonID(ownermarked.ReplyKept, a.Code), Title: Clip(w.Labels["keptForBooking"], w.Limits.ButtonTitle)})
	}
	return out
}
