package fees

// Other approvers (B37) on a Fees centre: the Go twin of agent.ts's `askedByOwner` and `approverDigits` (modules/approvals/people.ts ownerAsked and approverNumbers). With an
// `approvers` block, (1) a refund the owner's own command asks for ("approve q-4", the assistant's refund card) names the owner in Geo-Requested-By, so Guard never asks the
// owner to approve their own refund, and (2) another approver's reply to the approvals relay ("approve K7M2QX" or its button) is the relay's: the inbox hands the runtime a
// copy, which gets no reply and no record here, as for the owner's. Added 23 Nov 2026 (go-fees-gaps-23nov); until then Go sent no header and read such a reply as words.

import "strings"

// ownerApprover is people.ts OWNER_APPROVER: the owner's id among the approvers.
const ownerApprover = "owner"

// approverDigits is people.ts approverNumbers: the digits of every other approver's number (`digits(p.whatsapp)`, `\D` removed as JavaScript's /\D/gu does: only 0-9 stay).
func (a *Agent) approverDigits() map[string]bool {
	out := map[string]bool{}
	people, _ := a.settings.Approvers["people"].([]any)
	for _, p := range people {
		if m, ok := p.(map[string]any); ok {
			if wa, ok := m["whatsapp"].(string); ok {
				out[onlyDigits(wa)] = true
			}
		}
	}
	return out
}

// askedByOwner is people.ts ownerAsked: the owner, named only in a centre with other approvers (with the owner alone nobody else could approve it); nil otherwise.
func (a *Agent) askedByOwner() []string {
	if a.settings.Approvers == nil {
		return nil
	}
	return []string{ownerApprover}
}

// approverRelayReply is agent.ts onMessage's first B37 line: another approver's reply to the relay, which is not the centre's to answer.
func (a *Agent) approverRelayReply(from string, isRelay bool) bool {
	return isRelay && a.approverDigits()[onlyDigits(from)]
}

func onlyDigits(s string) string {
	var b strings.Builder
	for _, c := range s {
		if c >= '0' && c <= '9' {
			b.WriteRune(c)
		}
	}
	return b.String()
}
