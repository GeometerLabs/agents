package runtime

// The owner's words read through the router, and the owner's talk with the model, in a step (modules/assistant/reading.ts createOwnerReader over understanding/reader.ts, and
// conversation.ts `talkToOwner` with talk-owner.ts and talk-run.ts):
//
//   - readOwner: the router (internal/understanding, with assistant.OwnerReading) reads the words cheapest first: the rules; then, for words they could not place, the decision
//     model and the language model, each only when the month's AI state allows it (button mode reads with the rules alone; a decision model that keeps failing is paused; the
//     language model is left out under fleet's cap, the shop's month budget or the router's daily cap). What it cost is counted in the month (countUnderstood);
//   - talkToOwner: words still unknown are answered as a conversation when the talk may ask a model (the same switches and caps, and the owner_talk feature's daily cap), from the
//     shop's notes and its public listings; every call is metered (askMetered, shared with a listing's draft) and written as a `talk` line; a reply that fails a check is never shown
//     (the owner gets the fixed line), and one that passes goes through the same outgoing check as every line on the page.

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/listings"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

// ownerRouter is modules/runtime/start.ts `buildUnderstanding` with assistant/understanding.ts OWNER_UNDERSTANDING over RouterSteps; nil when the shop has neither model (the rules
// alone read the words).
func ownerRouter(cfg *Config, _ *understanding.Model, log func(string)) *understanding.Router[assistant.Intent] {
	return RouterFor[assistant.Intent](cfg, assistant.OwnerReading{}, log)
}

// RouterFor is start.ts `buildUnderstanding`'s router for any reading (the owner's, a template's customer reading): the decision model from runtime.json `decision` (off, with a
// line, when its key is not in the environment) and the language model from `parser`; nil when the shop has neither.
func RouterFor[I any](cfg *Config, reading understanding.Reading[I], log func(string)) *understanding.Router[I] {
	var decision *understanding.SystemOne
	if cfg.Decision != nil {
		if decision = understanding.NewSystemOne(cfg.Decision); decision == nil {
			log(fmt.Sprintf("Step 1 (the decision model) is off: %s is not set, so nothing is sent to %s.", cfg.Decision.KeyEnv, cfg.Decision.Provider))
		}
	}
	model := understanding.NewModel(cfg.Parser, log, "Step 2 (the language model) is off", understanding.ParserTimeoutMs, understanding.ParserMaxTokens)
	if decision == nil && model == nil {
		return nil
	}
	r := &understanding.Router[I]{Reading: reading, Decision: decision, Model: model}
	if cfg.Decision != nil {
		if cfg.Decision.Threshold != nil {
			r.Threshold = *cfg.Decision.Threshold
		}
		r.Languages = cfg.Decision.Languages
	}
	return r
}

// readOwner is reading.ts createOwnerReader's `read`: the owner's intent, the note for the record when a model could not be used, and the cost refs (reader.ts
// understandingRefs).
func (c *conv) readOwner(text string) (assistant.Intent, string, map[string]string) {
	r, now := c.r, c.now
	buttons, _ := budget.Buttons(&c.snap.AI, r.policy, r.clock, now)
	skip := budget.PausedSteps(&c.snap.AI, r.clock, now)
	if budget.ModelOff(&c.snap.AI, r.policy, r.clock, now) != "" || budget.Gate(&c.snap.AI, r.policy.Budget, "router", r.clock, now, "") != "" {
		skip = append(skip, "model")
	}
	var in assistant.Intent
	u := understanding.Rules()
	reason := ""
	if r.router == nil {
		in = c.reading.Rules(text)
	} else {
		router := *r.router // the shop's router with this shop's reading (its kinds, its limit rule)
		router.Reading = c.reading
		in, u, reason = router.Parse(text, understanding.Options{RulesOnly: buttons, SkipSteps: skip}, now)
	}
	in = assistant.CoerceIntentIn(in, c.reading.Kinds())
	note := ""
	if reason != "" {
		note = fmt.Sprintf("the model could not be used (%s), so the rule parser read the message", reason)
	}
	c.countUnderstood(u)
	return in, note, u.Refs()
}

func has(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}

// countUnderstood is reader.ts `countUnderstood`: the message in the month's totals; the router's call against the budget when the language step was asked; a model step that
// was asked and could not answer starts the fault pause; the decision model's breaker.
func (c *conv) countUnderstood(u understanding.Understood) {
	CountUnderstood(&c.snap.AI, c.r.policy, c.r.clock, c.now, u)
}

// CountUnderstood is reader.ts countUnderstood, for every reader (the owner's here, a template's customer reader): what reading one message cost goes into the month, the router's
// daily cap counts a call of the language model, a model that failed puts the shop in button mode for PauseMinutes, and the decision model's run of failures is noted.
func CountUnderstood(ai **budget.AI, policy budget.Policy, clock budget.Clock, now int64, u understanding.Understood) {
	month := budget.For(ai, clock, now)
	switch u.Step {
	case "decision":
		month.Decision++
	case "model":
		month.Model++
	default:
		month.Rules++
	}
	if u.CostMicroInr == nil {
		month.Unpriced++
	} else {
		month.CostMicroInr += *u.CostMicroInr
	}
	if has(u.Tried, "model") {
		var cost *int64
		if u.Step == "model" {
			cost = u.CostMicroInr
		}
		budget.Record(ai, policy.Budget, "router", cost, "", clock, now)
	}
	if u.Step == "rules" && len(u.Failed) > 0 {
		pause := now + policy.PauseMinutes*60_000
		budget.For(ai, clock, now).PausedUntilMs = &pause
	}
	if has(u.Tried, "decision") {
		failed := has(u.Failed, "decision")
		if !failed || (has(u.Tried, "model") && !has(u.Failed, "model")) {
			budget.NoteStep(ai, "decision", !failed, clock, now)
		}
	}
}

// askMetered is talk-run.ts `askMetered`: one call of the talk model and what it cost, counted in the month's AI spend whether or not the answer is usable, and against its
// feature's daily cap and the month's budget. `meter` is the record's refs for the call.
func (c *conv) askMetered(feature, key string, call understanding.Call) (understanding.Answer, map[string]string, *budget.AI) {
	return c.r.askMetered(c.snap, c.now, feature, key, call)
}

// askMetered is the same call over any step's state: the owner's talk (above) and a customer's (talkcustomer.go) both come through here, so the metering is the same for both.
func (r *Runtime) askMetered(snap *Snap, now int64, feature, key string, call understanding.Call) (understanding.Answer, map[string]string, *budget.AI) {
	got := r.o.Model.Ask(call)
	month := budget.For(&snap.AI, r.clock, now)
	month.Model++
	cost, rateDate := r.o.Model.Cost(got, now)
	if cost == nil {
		month.Unpriced++
	} else {
		month.CostMicroInr += *cost
	}
	budget.Record(&snap.AI, r.policy.Budget, feature, cost, key, r.clock, now)
	meter := map[string]string{"step": "model", "provider": r.o.Model.Provider, "model": r.o.Model.Cfg.Model, "inputTokens": strconv.FormatInt(got.InputTokens, 10), "outputTokens": strconv.FormatInt(got.OutputTokens, 10)}
	if cost != nil {
		meter["costMicroInr"] = strconv.FormatInt(*cost, 10)
	}
	if rateDate != "" {
		meter["rateDate"] = rateDate
	}
	return got, meter, budget.For(&snap.AI, r.clock, now)
}

// capNotice is conversation.ts `capNotice`: a feature stopped for the day is told to the owner once that day (only under a budget).
func (c *conv) capNotice(reason, feature string) {
	if reason != "day" || c.r.policy.Budget == nil || !budget.TakeDayNotice(&c.snap.AI, feature, c.r.clock, c.now) {
		return
	}
	c.tellBudget("day", feature)
}

// listingSources is listing-card.ts `listingSources`: each public listing as a setting the talk may rest on, in English, with its price as an amount and its title and id as
// literals.
func (c *conv) listingSources() []assistant.TalkSource {
	if !c.snap.hasList {
		return nil
	}
	ls := &c.snap.Listings
	var out []assistant.TalkSource
	for _, l := range ls.Public(c.now, c.snap.Stock.SoldOut()) {
		t := listings.TextIn(&l, "en")
		price := "no price set (ask the shop)"
		if l.PricePaise != 0 {
			price = assistant.INR(l.PricePaise)
			if l.PriceNote != "" {
				price += " " + l.PriceNote
			}
		}
		fresh := "not confirmed lately: call the shop to check"
		if listings.Freshness(&l, c.now) == "fresh" {
			fresh = "confirmed by the owner within 3 days"
		}
		claims := ""
		if len(l.Claims) > 0 {
			claims = " The owner says: " + strings.Join(l.Claims, "; ") + "."
		}
		text := "Listing " + l.ID + ". Category: " + l.Category + ". " + t.Title + "."
		if t.Text != "" {
			text += " " + t.Text
		}
		text += " Price: " + price + "."
		var qty int64
		ok := false
		if c.snap.Stock != nil {
			qty, ok = c.snap.Stock.Count(l.ID)
		}
		if !ok && l.Qty != 0 {
			qty, ok = l.Qty, true
		}
		if ok {
			text += " Quantity: " + strconv.FormatInt(qty, 10) + "."
		}
		text += " " + fresh + "." + claims
		src := assistant.TalkSource{ID: "s:" + l.ID, Kind: "setting", Text: text, Literals: []string{t.Title, l.ID}}
		if l.PricePaise != 0 {
			src.AmountsInr = []float64{float64(l.PricePaise) / 100}
		}
		out = append(out, src)
	}
	return out
}

// talkLine is talk-run.ts's `talk` record line.
func (c *conv) talkLine(meter map[string]string, result string, reply any, notes string, check int) {
	refs := map[string]string{"role": "owner", "result": result}
	if check > 0 {
		refs["check"] = strconv.Itoa(check)
	}
	for k, v := range meter {
		refs[k] = v
	}
	c.logLine("talk", "confirmed", map[string]any{"reply": reply}, refs, notes)
}

// chatLine is conversation.ts `chatLine`: one turn kept for the next prompt's last lines.
func (c *conv) chatLine(from, text string) {
	c.a.Chat = append(c.a.Chat, assistant.TalkLine{AtMs: c.now, From: from, Text: text})
	if len(c.a.Chat) > assistant.ChatLines {
		c.a.Chat = c.a.Chat[len(c.a.Chat)-assistant.ChatLines:]
	}
}

// talkToOwner is conversation.ts `talkToOwner`: false when the talk is off (the caller then says the fixed "not understood").
func (c *conv) talkToOwner(text, key string) bool {
	off := c.r.talkOff(c.snap, "owner_talk", key)
	if off == "again" {
		return true // the same message delivered again: it was answered the first time
	}
	if off != "" {
		c.capNotice(off, "owner_talk")
		return false
	}
	// the sources: every open note (the owner may see each), then the public listings (talk-owner.ts)
	var sources []assistant.TalkSource
	if raw := c.a.Rest["memory"]; raw != nil {
		for _, n := range c.mem().Recall("owner", assistant.OwnerNotesBudget, c.now) {
			who := ", owner only"
			if n.Audience == "everyone" {
				who = ", customers may be told"
			}
			sources = append(sources, assistant.TalkSource{ID: n.ID, Kind: "note", Text: n.Kind + who + ": " + n.Text})
		}
	}
	sources = append(sources, c.listingSources()...)
	set := c.r.o.Client.Settings
	named := "plain"
	if set.Assistant.Name != "" {
		named = "named"
	}
	system := c.pack.Say("talk.system."+set.Assistant.Personality+"."+named, "shop", set.Name, "name", set.Assistant.Name, "sources", assistant.SourceLines(sources))
	user := assistant.HistoryText(c.a.Chat) + understanding.Redact(text)
	got, meter, month := c.askMetered("owner_talk", key, understanding.Call{System: system, User: user, Schema: assistant.Rules().TalkSchema, Name: "talk"})
	literals := []string{set.Name}
	fallback := func() bool {
		c.say("talk_fallback", "n", strconv.Itoa(len(c.a.OpenCards(c.now))))
		return true
	}
	if got.Reason != "" || got.Answer == nil {
		pause := c.now + c.r.policy.PauseMinutes*60_000
		month.PausedUntilMs = &pause
		why := got.Reason
		if why == "" {
			why = "no answer"
		}
		c.talkLine(meter, "no_answer", nil, "the talk model could not be used ("+why+"); the fixed answer was used", 0)
		return fallback()
	}
	answer := assistant.ReadTalkAnswer(got.Answer)
	if answer == nil {
		c.talkLine(meter, "refused", nil, "the talk model's answer was not the shape asked for; the fixed answer was used", 1)
		return fallback()
	}
	checked := assistant.CheckOwnerTalk(answer, sources, text, c.lang, literals)
	if !checked.OK {
		c.talkLine(meter, "refused", nil, fmt.Sprintf("the talk reply failed check %d and was not sent: %s", checked.Check, checked.Why), checked.Check)
		return fallback()
	}
	c.talkLine(meter, "checked", checked.Text, "the talk reply passed the five checks; it goes out through the outgoing check, and the record keeps only its digest", 0)
	c.chatLine("owner", text)
	if answer.Limit != "" {
		// the model only names which declared limit is meant; the value is read from the owner's words by rule (conversation.ts onLimit); a listings-only shop declares none, so
		// the limits half answers "which limit?"
		c.onLimit(text, answer.Limit)
		return true
	}
	// talk_reply: the words as they are, through the outgoing check the page's every line has (conversation.ts `tell`)
	if problems := language.CheckText(checked.Text, checked.Facts); len(problems) > 0 {
		c.logLine("send_message", "blocked", map[string]any{"templates": []string{"assistant_talk_reply"}}, map[string]string{"to": "owner", "channel": "owner_page"}, "the answer failed the outgoing check and was not shown: "+strings.Join(problems, " "))
	} else {
		c.tellText("talk_reply", checked.Text, "", nil)
	}
	c.chatLine("assistant", checked.Text)
	// a note the talk proposes is shown with Remember / No buttons, which the owner's page does not have: none is made here (notes.ts `proposeNote`)
	return true
}
