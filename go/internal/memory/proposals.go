package memory

// A note the owner's talk proposes, saved only on the owner's tap (modules/memory/memory.ts propose, acceptProposal, declineProposal). The talk's model may suggest one standing
// fact about the shop; the assistant shows it with Remember / No buttons, and nothing is written to the notes until the owner taps Remember. No is final for a day: the same
// text (by its digest) is not proposed again until then. Proposals and the noes are carried in the same `assistant.memory` object TypeScript writes (memory.go marshals them).

import (
	"strconv"

	"github.com/GeometerLabs/agents/go/internal/language"
)

// Propose is memory.ts propose: nil for a kind that is not a note's, empty words, words over the note's length (UTF-16 units, JavaScript's `length`), or a text the owner said no
// to within the day.
func (m *State) Propose(in Input, now int64, digest func(string) string) *Proposal {
	text := clean(in.Text)
	if !kindOK(in.Kind) || text == "" || language.UTF16Len(text) > MaxNoteChars {
		return nil
	}
	d := digestWith(digest, text)
	for _, x := range m.No {
		if x.Digest == d && now-x.AtMs < NoFinalMs {
			return nil
		}
	}
	m.Seq++
	audience := in.Audience
	if audience == "" {
		audience = defaultAudience[in.Kind]
	}
	m.Proposals = append(m.Proposals, Proposal{ID: "p-" + strconv.FormatInt(m.Seq, 10), Kind: in.Kind, Text: text, Lang: in.Lang, Audience: audience, AtMs: now, ExpiresAtMs: now + ProposalMs})
	return &m.Proposals[len(m.Proposals)-1]
}

// AcceptProposal is memory.ts acceptProposal: the owner's Remember (with their authority) writes the note now; a proposal past its day is gone ("no_such_note"). The proposal goes
// unless the notes are full, so a Remember after one is forgotten still works.
func (m *State) AcceptProposal(a Authority, id string, now int64, digest func(string) string) (*Note, string) {
	if !a.valid() {
		panic("Only the owner, the Operator or the builder can change the shop's memory.")
	}
	at := -1
	for i := range m.Proposals {
		if m.Proposals[i].ID == id && m.Proposals[i].ExpiresAtMs > now {
			at = i
			break
		}
	}
	if at < 0 {
		return nil, "no_such_note"
	}
	p := m.Proposals[at]
	n, why := m.Add(a, Input{Kind: p.Kind, Text: p.Text, Lang: p.Lang, Audience: p.Audience}, now, digest)
	if why != "full" {
		m.dropProposal(id)
	}
	if why != "" {
		return nil, why
	}
	// Add appended to m.Notes, which the proposal's removal did not move
	return n, ""
}

// DeclineProposal is memory.ts declineProposal: the proposal goes, and its text is not proposed again for a day. False when there is no such proposal.
func (m *State) DeclineProposal(a Authority, id string, now int64, digest func(string) string) bool {
	if !a.valid() {
		panic("Only the owner, the Operator or the builder can change the shop's memory.")
	}
	for _, p := range m.Proposals {
		if p.ID == id {
			m.dropProposal(id)
			m.No = append(m.No, No{Digest: digestWith(digest, p.Text), AtMs: now})
			return true
		}
	}
	return false
}

func (m *State) dropProposal(id string) {
	out := m.Proposals[:0:0]
	for _, p := range m.Proposals {
		if p.ID != id {
			out = append(out, p)
		}
	}
	m.Proposals = out
}
