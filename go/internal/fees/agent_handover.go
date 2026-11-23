package fees

// The owner's handover code and the shop terms on a Fees centre (agent.ts onOwnerMessage, after the relay's replies and before Classes): "move K7M2QX" is the owner agreeing,
// from their own number, to hand the centre to another Operator or builder (one record line with the code's hash, no reply; the panel does the rest), and "terms" / "I agree"
// are the shop terms on WhatsApp (B72, internal/terms; off unless the centre was handed a terms file). Both read through internal/runtime ownerwords.go, which Bookings and
// Orders use too. Added 23 Nov 2026 (go-fees-gaps-23nov); until then the owner's "move" or "terms" got "I did not understand" on Go.

import (
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/terms"
)

// ownerFixedWords answers the handover code and the shop terms; true when the message was one of them.
func (a *Agent) ownerFixedWords(m messaging.InboundMessage) bool {
	if code, ok := runtime.HandoverCode(m.Text); ok {
		a.log(nil, a.owner(), runtime.HandoverAction, "confirmed", map[string]any{"command": "handover"}, logMore{refs: runtime.HandoverRefs(code), notes: runtime.HandoverNotes})
		return true
	}
	if a.kit.Terms == nil {
		return false
	}
	setup := a.kit.Terms()
	return setup != nil && terms.HandleOwner(a.ctx, runtime.TermsMessage(m), terms.Deps{
		Setup: setup, ShopName: a.settings.Name, OwnerNumber: a.owner(), OwnerLanguage: a.settings.Owner.Language, Messaging: runtime.TermsMessaging(a.msg), Record: runtime.TermsRecord(a.c.Rec.Entries),
		Log: func(action, outcome string, in any, more terms.LogMore) {
			a.log(nil, a.owner(), action, outcome, in, logMore{notes: more.Notes, refs: more.Refs})
		},
	})
}
