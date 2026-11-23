package fees

// The shop's talk to a parent (block M): conversation.ts talkToCustomer over Fees' public context (src/assistant.ts talkReads publicContext). The runtime's StepContext.CustomerTalk
// does the asking, the caps and the checks; what is Fees' own is the context, in words that carry NO student's name (the model gets "your child", because a student's name never
// leaves the centre as itself), and the reply as the "assistant_talk" message with the centre's own buttons under it. With no "assistant" block, or no talk model, nothing is asked
// and the centre's own fixed line goes, as in TypeScript.

import (
	"strings"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// talkReply is a talk reply's words and what the outgoing check reads over them (say's voice renders "assistant_talk" as the words).
type talkReply struct {
	Text  string
	Check language.Facts
}

// publicContext is assistant.ts talkReads.publicContext: the centre, its batches and fees, the due day and late fee rules, and this parent's own open fee as "their child".
func (a *Agent) publicContext(phone string) []assistant.TalkSource {
	s := a.settings
	lang := s.Languages[0]
	if c := a.store.FindCustomer(phone); c != nil && c.Language != "" {
		lang = c.Language
	}
	inr := func(n int64) string { return language.FormatInr(float64(n)) }
	shop := s.Name
	lits := []string{s.Name}
	if s.HasAddress {
		shop += ", " + s.Address
		lits = append(lits, s.Address)
	}
	out := []assistant.TalkSource{{ID: "s:shop", Kind: "setting", Text: shop + ". Fees are paid and asked about on WhatsApp.", Literals: lits}}
	for i := range s.Batches {
		b := &s.Batches[i]
		name := b.ID
		if n := b.Names[lang]; len(n) > 0 {
			name = n[0]
		} else if n := b.Names["en"]; len(n) > 0 {
			name = n[0]
		}
		out = append(out, assistant.TalkSource{ID: "s:batch:" + b.ID, Kind: "setting", Text: name + ": " + inr(b.MonthlyFeeInr) + " a month.", AmountsInr: []float64{float64(b.MonthlyFeeInr)}, Literals: []string{name}})
	}
	due := "Fees are due on day " + itoa(s.Due.Day) + " of the month, with " + itoa(s.Due.GraceDays) + " days to pay."
	if s.LateFeeInr > 0 {
		due += " After that a late fee of " + inr(s.LateFeeInr) + " is added once."
	}
	if s.PartPayments.Allowed {
		due += " Part payments are allowed, from " + inr(s.PartPayments.MinInr) + "."
	} else {
		due += " Part payments are not taken."
	}
	out = append(out, assistant.TalkSource{ID: "s:due", Kind: "setting", Text: due, AmountsInr: []float64{float64(s.LateFeeInr), float64(s.PartPayments.MinInr)}})
	// W2: a parent's chat talks about that parent's own fee, never another's (assistant.ts `parentOfChat(store, phone) ?? phone`)
	who := phone
	if p := a.store.parentOfChat(phone); p != "" {
		who = p
	}
	if open := a.store.openDues(who); len(open) > 0 {
		m := open[0]
		text := "This parent's open fee " + m.ID + " for their child, " + monthLabel(m.Month, lang) + ": balance " + inr(balancePaise(m)/100) + " (fee " + inr(m.FeeInr)
		if m.LateFeeInr > 0 {
			text += ", late fee " + inr(m.LateFeeInr)
		}
		out = append(out, assistant.TalkSource{ID: "r:case", Kind: "record", Text: text + ").", Literals: []string{m.ID}, AmountsInr: []float64{float64(balancePaise(m) / 100), float64(m.FeeInr), float64(m.LateFeeInr)}})
	}
	return out
}

// talkToCustomer is conversation.ts talkToCustomer: false when the talk did not answer (the centre's own line then goes). buttons are the centre's own under the reply (the
// owner's button alone when the reply says to ask the owner), about due when one is given.
func (a *Agent) talkToCustomer(phone, text string, overrideAttempt bool, due *Due) bool {
	if a.settings.Assistant == nil {
		return false
	}
	lang := a.languageOf(phone, due)
	r := a.c.CustomerTalk(runtime.CustomerTalkInput{Conversation: phone, Text: text, Language: lang, OverrideAttempt: overrideAttempt, Sources: a.publicContext(phone)})
	if !r.Sent {
		return false
	}
	ids, dueID := []string{"owner"}, ""
	if !r.AskOwner && due != nil {
		ids, dueID = []string{"pay", "paid", "owner"}, due.ID
	}
	check := r.Facts
	for _, c := range buttonsFor(lang, ids, dueID) {
		check.Literals = append(check.Literals, c.Title) // the centre's own button words are its, not the model's
	}
	o := sayOpts{offer: &offer{buttons: ids, dueID: dueID}, talk: &talkReply{Text: r.Text, Check: check}}
	went, err := a.say.Say(a.ctx, a.args(nil, phone, "customer", []string{"assistant_talk"}, o))
	return err == nil && went
}

// renderTalk is say's voice for a talk reply: the words as the model wrote them (checked by the runtime), and the check over them.
func renderTalk(id string, facts any) (string, bool) {
	if t, ok := facts.(*talkFacts); ok && id == "assistant_talk" {
		return t.reply.Text, true
	}
	return "", false
}

// talkFacts is a talk reply's facts: the message facts (for the buttons' words) and the reply.
type talkFacts struct {
	*MessageFacts
	reply *talkReply
}

func factsOf(v any) *MessageFacts {
	if t, ok := v.(*talkFacts); ok {
		return t.MessageFacts
	}
	return v.(*MessageFacts)
}

func matchTalk(text string, facts any) (messaging.Decision, bool) {
	t, ok := facts.(*talkFacts)
	if !ok {
		return messaging.Decision{}, false
	}
	problems := language.CheckText(text, t.reply.Check)
	if len(problems) == 0 {
		return messaging.Decision{RuleID: "message-matches-record", Verdict: "allow", Reason: "Every amount, date, time and link in the message is in the record."}, true
	}
	return messaging.Decision{RuleID: "message-matches-record", Verdict: "block", Reason: "The message does not match the record. " + strings.Join(problems, " ")}, true
}
