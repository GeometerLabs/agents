package bookings

// Block M, the customer's talk, from the Bookings side: where the rules and the router know no answer, the shop's talk model may answer from what customers may be told (the shared
// runtime's StepContext.CustomerTalk does the asking, the caps and the five checks; go-bk-chat-19nov). What is Bookings' own is here: its public context (assistant.ts
// bookingsSkill `publicContext`: the shop, its services and prices, its hours, the deposit, the next free times, this customer's own booking) and the send (conversation.ts
// talkToCustomer's second half: the reply as the "assistant_talk" message, with the menu under it and the menu's own words added to what the outgoing check may read).

import (
	"strings"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// talkFacts are the facts of a talk reply: the words were written by the model and checked by the runtime, and the outgoing check reads them against Check.
type talkFacts struct {
	*MessageFacts
	Text  string
	Check language.Facts
}

var weekdayEN = []string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}

// stateWords is assistant.ts STATE_WORDS.
var stateWords = map[string]string{
	Enquiry: "still being arranged, no time agreed yet", ConfirmingDetails: "waiting for the customer's yes to the time", AwaitingDeposit: "waiting for the deposit to hold the time",
	NeedsOwner: "waiting for the owner to look at it", Confirmed: "in the shop's book for that time",
}

// publicContext is assistant.ts bookingsSkill publicContext, word for word.
func (a *Agent) publicContext(phone string) []assistant.TalkSource {
	s := a.settings
	lang := s.Languages[0]
	if c := a.store.FindCustomer(phone); c != nil && c.Language != "" {
		lang = c.Language
	}
	tz := s.Timezone
	fm := language.Formats(lang)
	shop := s.Name
	lits := []string{s.Name}
	if s.HasAddress && s.Address != "" {
		shop += ", " + s.Address
		lits = append(lits, s.Address)
	}
	out := []assistant.TalkSource{{ID: "s:shop", Kind: "setting", Text: shop + ". Bookings are made on WhatsApp.", Literals: lits}}
	minutes := int64(-1)
	for i := range s.Services {
		sv := &s.Services[i]
		name := ServiceName(sv, lang)
		out = append(out, assistant.TalkSource{ID: "s:svc:" + sv.ID, Kind: "setting", Text: name + ": " + language.FormatInr(float64(sv.PriceInr)) + ", " + i64(sv.DurationMinutes) + " minutes.",
			AmountsInr: []float64{float64(sv.PriceInr)}, Literals: []string{name}})
		if minutes < 0 || sv.DurationMinutes < minutes {
			minutes = sv.DurationMinutes
		}
	}
	var hours []string
	for i := 0; i < 7; i++ {
		if h := s.OpeningHours[i]; h != nil {
			hours = append(hours, weekdayEN[i]+" "+h.OpenText+" to "+h.CloseText)
		} else {
			hours = append(hours, weekdayEN[i]+" closed")
		}
	}
	out = append(out, assistant.TalkSource{ID: "s:hours", Kind: "setting", Text: "Opening hours: " + strings.Join(hours, ", ") + "."})
	out = append(out, assistant.TalkSource{ID: "s:deposit", Kind: "setting", Text: "A deposit of " + language.FormatInr(float64(s.Deposit.AmountInr)) + " holds a time for " + i64(s.Deposit.HoldMinutes) +
		" minutes. The deposit is refundable if the booking is cancelled at least " + i64(s.Cancellation.WindowHours) + " hours before it; later, the owner decides.", AmountsInr: []float64{float64(s.Deposit.AmountInr)}})
	// the next free times, from the shop's own bookings, a few days ahead
	now := a.now()
	type span struct{ a, z int64 }
	var busy []span
	for _, b := range a.store.Bookings {
		if contains([]string{AwaitingDeposit, NeedsOwner, Confirmed}, b.State) && b.StartMs != nil && b.EndMs != nil {
			busy = append(busy, span{*b.StartMs, *b.EndMs + s.BufferMinutes*Minute})
		}
	}
	free := []int64{}
	today := zone.LocalParts(now, tz).Date
	for d := 0; d < 4 && len(free) < 6; d++ {
		date := zone.AddDays(today, d)
		h := s.HoursOn(zone.WeekdayOf(date))
		if h == nil || contains(a.closedDays(), isoDate(date)) {
			continue
		}
		for m := h.Open; int64(m)+minutes <= int64(h.Close) && len(free) < 6; m += int(s.SlotMinutes) {
			at := zone.ZonedToMs(date, m/60, m%60, tz)
			taken := at <= now+30*Minute
			for _, x := range busy {
				taken = taken || (at < x.z && at+minutes*Minute > x.a)
			}
			if !taken {
				free = append(free, at)
			}
		}
	}
	text := "No free time in the next few days."
	if len(free) > 0 {
		var ts []string
		for _, ms := range free {
			ts = append(ts, fm.Slot(ms, s.Loc))
		}
		text = "Next free times: " + strings.Join(ts, "; ") + "."
	}
	out = append(out, assistant.TalkSource{ID: "r:free", Kind: "record", Text: text, MomentsMs: free})
	if mine := a.store.Latest(phone, LiveStates); mine != nil {
		sv := s.ServiceByID(mine.ServiceID)
		name := "a service"
		lits := []string{mine.ID}
		if sv != nil {
			name = ServiceName(sv, lang)
			lits = append(lits, name)
		}
		src := assistant.TalkSource{ID: "r:case", Kind: "record", Literals: lits}
		when := ""
		if mine.StartMs != nil {
			when = ", " + fm.Slot(*mine.StartMs, s.Loc)
			src.MomentsMs = []int64{*mine.StartMs}
		}
		words := stateWords[mine.State]
		if words == "" {
			words = mine.State
		}
		src.Text = "This customer's own booking " + mine.ID + ": " + name + when + ", " + words + "."
		out = append(out, src)
	}
	return out
}

// talkToCustomer is conversation.ts talkToCustomer: false when the talk did not answer (the template's own menu then goes, and the customer is never told why).
func (a *Agent) talkToCustomer(phone, text string, overrideAttempt bool) bool {
	if a.c == nil || a.settings.Assistant == nil {
		return false // `assistant?.talkToCustomer`: the talk is the shop's assistant's
	}
	lang := a.languageOf(phone, nil)
	r := a.c.CustomerTalk(runtime.CustomerTalkInput{Conversation: phone, Text: text, Language: lang, OverrideAttempt: overrideAttempt, Sources: a.publicContext(phone)})
	if !r.Sent {
		// TODO(go-bk-agent): r.NoticeDay, the owner's once-a-day notice that customers' talk stopped (conversation.ts capNotice, tellBudget "day")
		return false
	}
	o := servicesOffer() // the menu: the shop's services, or a button to reach the owner when the reply says to
	if r.AskOwner {
		o = &offer{kind: "buttons", buttons: []string{"owner"}}
	}
	check := r.Facts
	// the template's own button and row words are its, not the model's: the outgoing check reads them as the names they are
	if r.AskOwner {
		for _, c := range ButtonsFor(lang, "owner") {
			check.Literals = append(check.Literals, c.Title)
		}
	} else {
		l := ServiceList(a.settings, lang)
		check.Literals = append(check.Literals, l.Button)
		for _, row := range l.Rows {
			check.Literals = append(check.Literals, row.Title)
			if row.Description != "" {
				check.Literals = append(check.Literals, row.Description)
			}
		}
	}
	o.kind, o.body = "talk:"+o.kind, nil
	args := a.sayArgs(nil, phone, "customer", []string{"assistant_talk"}, sayOpts{offer: o})
	extraOf(args).talk = &talkFacts{Text: r.Text, Check: check}
	went, err := a.say.Say(a.ctx, args)
	return err == nil && went
}

// ---- the talk reply through say's voice ----------------------------------------------------------------------------------------------------------------------------

func renderAny(id string, facts any) (string, error) {
	if t, ok := facts.(*talkFacts); ok && id == "assistant_talk" {
		return t.Text, nil
	}
	if t, ok := facts.(*talkFacts); ok {
		return Render(id, t.MessageFacts)
	}
	return Render(id, facts.(*MessageFacts))
}

func matchAny(text string, facts any) messaging.Decision {
	if t, ok := facts.(*talkFacts); ok {
		return decisionOf(language.CheckText(text, t.Check))
	}
	return decisionOf(CheckMessage(text, facts.(*MessageFacts)))
}

func decisionOf(problems []string) messaging.Decision {
	if len(problems) == 0 {
		return messaging.Decision{RuleID: "message-matches-record", Verdict: "allow", Reason: "Every amount, date, time and link in the message is in the record."}
	}
	return messaging.Decision{RuleID: "message-matches-record", Verdict: "block", Reason: "The message does not match the record. " + strings.Join(problems, " ")}
}
