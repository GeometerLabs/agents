package orders

// Block M, the customer's talk, from the Orders side: where the rules and the router know no answer, the shop's talk model may answer from what customers may be told (the shared
// runtime's StepContext.CustomerTalk does the asking, the caps and the checks). What is Orders' own is here: its public context (src/assistant.ts talkReads `publicContext`: the
// shop, its menu and prices, its slots, the delivery area, the advance and the cancellation rule, this customer's own live order), word for word, and the send (conversation.ts
// talkToCustomer's second half: the reply as the "assistant_talk" message, with the menu under it and the menu's own words added to what the outgoing check may read). As in
// TypeScript the talk is the shop's assistant's: a shop without an `assistant` block has none. Modelled on internal/bookings/agent_talk.go.

import (
	"strings"
	"time"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/orders/words"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// stateWords is assistant.ts STATE_WORDS.
var stateWords = map[string]string{
	Enquiry: "still being put together", AwaitingOwner: "waiting for the owner to look at it", AwaitingAdvance: "waiting for the advance", Confirmed: "in the shop's list for its slot",
}

// publicContext is assistant.ts talkReads publicContext.
func (a *Agent) publicContext(phone string) []assistant.TalkSource {
	s := a.settings
	lang := s.Languages[0]
	if c := a.store.FindCustomer(phone); c != nil && c.Language != "" {
		lang = c.Language
	}
	shop, lits := s.Name, []string{s.Name}
	if s.Address != "" {
		shop += ", " + s.Address
		lits = append(lits, s.Address)
	}
	out := []assistant.TalkSource{{ID: "s:shop", Kind: "setting", Text: shop + ". Orders are taken on WhatsApp.", Literals: lits}}
	for i := range s.Menu {
		m := &s.Menu[i]
		name := ItemName(m, lang)
		out = append(out, assistant.TalkSource{ID: "s:item:" + m.ID, Kind: "setting", Text: name + ": " + inr(m.PriceInr) + " each; at most " + i64(m.DailyStock) + " a day.",
			AmountsInr: []float64{float64(m.PriceInr)}, Literals: []string{name}})
	}
	slots := func(list []Slot) string {
		parts := make([]string, len(list))
		for i, x := range list {
			parts[i] = x.From + " to " + x.To
		}
		return strings.Join(parts, ", ")
	}
	out = append(out, assistant.TalkSource{ID: "s:pickup", Kind: "setting", Text: "Pickup windows: " + slots(s.Pickup) + ". Orders can be for up to " + i64(s.Orders.DaysAhead) +
		" days ahead; at most " + i64(s.Orders.MaxPerDay) + " orders a day."})
	if s.Delivery != nil {
		out = append(out, assistant.TalkSource{ID: "s:delivery", Kind: "setting", Text: "Delivery windows: " + slots(s.Delivery.Slots) + ". Delivery areas: " + strings.Join(s.Delivery.Area, ", ") + ".",
			Literals: append([]string{}, s.Delivery.Area...)})
	}
	advance := "An advance of " + i64(s.Advance.Percent) + " percent of the total is paid."
	if s.Advance.Mode == "full" {
		advance = "The whole order is paid in advance."
	}
	if s.NoAdvance() {
		// the pickup hold (agent_hold.go): nothing is paid ahead, so the talk never states an advance or a refund
		out = append(out, assistant.TalkSource{ID: "s:advance", Kind: "setting", Text: "Nothing is paid ahead. Once the shop says yes, an item is kept for the customer until the end of the pickup time they chose, and they pay at the counter when they collect it."})
	} else {
		out = append(out, assistant.TalkSource{ID: "s:advance", Kind: "setting", Text: advance + " The advance is refundable if the order is cancelled at least " + i64(s.Cancellation.WindowHours) +
			" hours before its slot; later, the owner decides."})
	}
	// this customer's own live order (the latest; a plan's period payment counts, as `[...store.orders.values()].reverse().find(...)` finds it)
	var mine *Order
	for i := len(a.store.Orders) - 1; i >= 0; i-- {
		if o := a.store.Orders[i]; o.Customer == phone && contains(LiveStates, o.State) {
			mine = o
			break
		}
	}
	if mine != nil {
		parts := make([]string, len(mine.Lines))
		for i, l := range mine.Lines {
			name := l.ItemID
			if it := s.ItemOf(l.ItemID); it != nil {
				name = ItemName(it, lang)
			}
			parts[i] = i64(l.Qty) + " × " + name
		}
		text := "This customer's own order " + mine.ID + ": " + strings.Join(parts, ", ")
		src := assistant.TalkSource{ID: "r:case", Kind: "record", Literals: []string{mine.ID}}
		if mine.TotalInr != nil {
			text += ", total " + inr(*mine.TotalInr)
			src.AmountsInr = []float64{float64(*mine.TotalInr)}
		}
		if mine.SlotStartMs != nil {
			loc, err := time.LoadLocation(s.Timezone)
			if err != nil {
				loc = time.UTC
			}
			text += ", for " + language.Formats(lang).Slot(*mine.SlotStartMs, loc)
			src.MomentsMs = []int64{*mine.SlotStartMs}
		}
		w := stateWords[mine.State]
		if w == "" {
			w = mine.State
		}
		src.Text = text + ", " + w + "."
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
		return false
	}
	// the menu under the reply: the shop's items, or a button to reach the owner when the reply says to; their words are the template's, not the model's, so the outgoing check
	// reads them as the names they are
	o := &offer{kind: "talk:items"}
	check := r.Facts
	if r.AskOwner {
		o = &offer{kind: "talk:buttons", buttons: []string{"owner"}}
		for _, c := range words.ButtonsFor(lang, "owner") {
			check.Literals = append(check.Literals, c.Title)
		}
	} else {
		l := words.ItemList(a.settings.WordsShop(), lang)
		check.Literals = append(check.Literals, l.Button)
		for _, row := range l.Rows {
			check.Literals = append(check.Literals, row.Title)
			if row.Description != "" {
				check.Literals = append(check.Literals, row.Description)
			}
		}
	}
	args := a.sayArgs(nil, phone, "customer", []string{"assistant_talk"}, sayOpts{offer: o})
	extraOf(args).talk = &talkFacts{Text: r.Text, Check: check}
	went, err := a.say.Say(a.ctx, args)
	return err == nil && went
}
