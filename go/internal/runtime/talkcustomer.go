package runtime

// A customer's talk, run in a template's step (modules/assistant/talk-customer.ts customerTalk over talk-run.ts runTalk, and conversation.ts talkToCustomer's gate): where the template's
// own flow and the rule parser know no answer, the shop's assistant may answer from what the shop has said customers may be told. This file decides whether a model may be asked at all,
// asks it, counts what it cost in the month's AI spend, runs the checks (assistant.CheckTalk, the customer's role) and writes the `talk` line of the record. The owner's talk (talk.go)
// shares the metering (askMetered) and the gate (talkOff), so the switches, the caps and the record are the same for both.
//
// The talk is OFF, and nobody pays for a model call, when: the shop turned customers' talk off (`assistant.talk.customers: false`); the shop has no talk model; it is in button mode (the
// allowance is used up, it was switched to buttons from outside, or a model failed lately); it is at the AI cap or its own month budget is used up; the day's cap on customers' questions is
// reached; or the message tried to change the rules ("ignore your rules": the menu, with nothing asked of a model). The customer is then never told: the template sends its own menu.
// A model call that FAILS (no answer in time, an HTTP error, a reply that is not JSON) moves the shop to buttons for a few minutes, as every other model step does.
//
// The model's answer is untrusted input. It is decoded to `any`, its types are checked by hand (assistant.ReadCustomerAnswer), and a reply that fails a check is never sent: the record names
// only the check (the reason can quote what the model wrote, which can echo the customer's words), and the customer gets the template's menu. What passes goes back to the caller as text and
// the facts the outgoing check must read; the caller says it through its own say (which runs that check again), with its own menu's words added to the facts as the names they are.
//
// This file never writes memory and never makes an authority: a customer's message has no path to a note.

import (
	"strconv"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/listings"
	"github.com/GeometerLabs/agents/go/internal/memory"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

// CustomerTalkInput is what a template gives a customer's talk (conversation.ts talkToCustomer's argument and the skill's public context for this customer).
type CustomerTalkInput struct {
	// Conversation is the customer's number (or a chat guest's conversation): the record's conversation.
	Conversation string
	Text         string
	Language     string
	// OverrideAttempt is the intent's: the message tried to change the rules, so no model is asked.
	OverrideAttempt bool
	// Sources and Links are the skill's public context for this customer (talk-types.ts PublicContext): the shop's public settings (services, prices, hours), the next free times and this
	// customer's own open case, and the addresses of the shop's own pages (the only links a reply may carry).
	Sources []assistant.TalkSource
	Links   []string
}

// CustomerTalkResult is what a customer's talk came to. Sent: a reply passed every check and Text goes out. Otherwise Reason says why not: "customers_off", "no_model", "buttons", "cap",
// "budget", "day", "override_attempt", "no_answer" or "check" (the template then sends its own menu).
type CustomerTalkResult struct {
	Sent   bool
	Reason string
	Text   string
	// Facts is what the outgoing check reads over the whole reply; the caller adds its own menu's words to Literals.
	Facts    language.Facts
	AskOwner bool
	// NoticeDay: the reason is "day" and the shop has a budget, and the owner has not yet been told today that customers' talk stopped (conversation.ts capNotice): tell them once.
	NoticeDay bool
}

// CustomerTalk is talkToCustomer's first half. It runs over the step's own state, so what it counts is saved with the step, whole or not at all. A step the runtime did not make (a test's
// literal) has no runtime and answers "no_model".
func (c *StepContext) CustomerTalk(in CustomerTalkInput) CustomerTalkResult {
	r := c.rt
	if r == nil || c.Snap == nil {
		return CustomerTalkResult{Reason: "no_model"}
	}
	snap, now := c.Snap, r.o.Now()
	if a, _ := c.Settings.Raw["assistant"].(map[string]any); a != nil {
		if t, _ := a["talk"].(map[string]any); t != nil && t["customers"] == false {
			return CustomerTalkResult{Reason: "customers_off"}
		}
	}
	if off := r.talkOff(snap, "customer_talk", ""); off != "" {
		return CustomerTalkResult{Reason: off, NoticeDay: r.dayNotice(snap, off, "customer_talk", now)}
	}
	if in.OverrideAttempt {
		return CustomerTalkResult{Reason: "override_attempt"} // "ignore your rules": the menu, with nothing asked of a model
	}
	// the sources: the notes for everyone (never an owner-only one), then the skill's public context
	var sources []assistant.TalkSource
	if snap.A != nil && snap.A.Rest["memory"] != nil { // (reading makes no assistant state: a shop that never had notes saves exactly what it did)
		raw := snap.A.Rest["memory"]
		for _, n := range memory.Parse(raw).Recall("everyone", assistant.CustomerNotesBudget, now) {
			sources = append(sources, assistant.TalkSource{ID: n.ID, Kind: "note", Text: n.Text})
		}
	}
	sources = append(sources, in.Sources...)
	set := c.Settings
	system := assistant.CustomerPrompt(set.Name, set.Assistant.Name, set.Assistant.Personality, in.Language, sources)
	got, meter, month := r.askMetered(snap, now, "customer_talk", "", understanding.Call{System: system, User: understanding.Redact(in.Text), Schema: assistant.CustomerSchema(), Name: "talk"})
	line := func(result string, reply any, notes string, check int) {
		refs := map[string]string{"role": "customer", "result": result}
		if check > 0 {
			refs["check"] = strconv.Itoa(check)
		}
		for k, v := range meter {
			refs[k] = v
		}
		c.Rec.append(NewLine{Conversation: in.Conversation, Action: "talk", Outcome: "confirmed", Inputs: map[string]any{"reply": reply}, Language: in.Language, Refs: refs, Notes: notes})
	}
	if got.Reason != "" || got.Answer == nil {
		pause := now + r.policy.PauseMinutes*60_000
		month.PausedUntilMs = &pause
		why := got.Reason
		if why == "" {
			why = "no answer"
		}
		line("no_answer", nil, "the talk model could not be used ("+why+"); the fixed answer was used", 0)
		return CustomerTalkResult{Reason: "no_answer"}
	}
	answer := assistant.ReadCustomerAnswer(got.Answer)
	if answer == nil {
		line("refused", nil, "the talk model's answer was not the shape asked for; the fixed answer was used", 1)
		return CustomerTalkResult{Reason: "check"}
	}
	checked := assistant.CheckTalk(assistant.TalkInput{
		Role: "customer", Answer: answer, Scope: sources, SpeakerText: in.Text, SpeakerLanguage: in.Language, Loc: r.loc, Links: in.Links, Literals: []string{set.Name},
		MaxChars: assistant.CustomerChars(), ClaimKinds: listings.ClaimKindsOf, Banned: listings.BannedWords, HealthClaim: listings.HasHealthClaim,
	})
	if !checked.OK {
		// a customer's turn names only the check: the reason can quote what the model wrote, which can echo the customer's words
		line("refused", nil, "the talk reply failed check "+strconv.Itoa(checked.Check)+" and was not sent", checked.Check)
		return CustomerTalkResult{Reason: "check"}
	}
	line("checked", checked.Text, "the talk reply passed the five checks; it goes out through the outgoing check, and the record keeps only its digest", 0)
	return CustomerTalkResult{Sent: true, Text: checked.Text, Facts: checked.Facts, AskOwner: answer.AskOwner}
}

// dayNotice is conversation.ts `capNotice`'s test: a feature stopped for the day is told to the owner once that day, and only under a budget.
func (r *Runtime) dayNotice(snap *Snap, reason, feature string, now int64) bool {
	return reason == "day" && r.policy.Budget != nil && budget.TakeDayNotice(&snap.AI, feature, r.clock, now)
}
