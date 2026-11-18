package runtime

// The owner's words become a draft listing (the owner's talk box, `owner_message`): the TypeScript runtime does this in the assistant's conversation (modules/assistant/
// conversation.ts listingFromWords, listing-draft.ts draftFromWords). This is that path and nothing around it: the words are taken as a listing when they say "put this on my page" or
// a photo waits; the model is asked only if the shop's cap and budget allow; every number, claim and health word the model wrote must come from the owner's own words; the draft is
// saved as a listing in state "draft", which nothing public shows. What the assistant ALSO does there (a card in the owner's talk list, the owner's reply lines, a morning
// question, "undo") is not here: see go/TRIAL.md "left out".

import (
	"strconv"
	"time"

	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/listings"
)

// talkOff: why this feature may not ask a model right now, or "" when it may. The model is asked only when this says "", so a feature over a cap costs nothing.
func (r *Runtime) talkOff(snap *Snap, feature, key string) string {
	if r.o.Model == nil {
		return "no_model"
	}
	now := r.o.Now()
	if buttons, _ := budget.Buttons(&snap.AI, r.policy, r.clock, now); buttons {
		return "buttons"
	}
	if off := budget.ModelOff(&snap.AI, r.policy, r.clock, now); off != "" {
		if off == "fleet" {
			return "cap"
		}
		return "budget"
	}
	if why := budget.Gate(&snap.AI, r.policy.Budget, feature, r.clock, now, key); why != "" {
		if why == "month" {
			return "budget"
		}
		return why
	}
	return ""
}

func (r *Runtime) ownerMessage(snap *Snap, rec *recorder, ev map[string]any, now int64) error {
	text, _ := ev["text"].(string)
	id, _ := ev["id"].(string)
	number, lang := r.owner()
	s := snap.Touch()
	waiting := s.PendingPhotos(now)
	if len(waiting) == 0 && !listings.HasListingCue(text) {
		return nil // not a listing: what else the assistant reads in the owner's words is the TypeScript runtime's
	}
	key := "o:" + id
	if off := r.talkOff(snap, "listing_draft", key); off != "" {
		// "again": the same words delivered again, the first was answered. Over a cap or a budget the TypeScript runtime tells the owner in the app's talk list (a plain form is
		// there to use); this runtime only does not call the model.
		return nil
	}
	if animal := listings.ProtectedAnimalIn(map[string]listings.LangText{"en": {Title: text}}); animal != "" {
		return nil // refused before the model is asked: nothing to pay for
	}
	read := listings.ReadListingWords(text)
	system, schema := listings.Prompt(r.o.Client.Settings.Name, nil)
	got := r.o.Model.Ask(system, text, schema, "listing")
	// the call is counted in the month's AI spend whether or not the answer is usable (a call whose answer was unusable still cost tokens), and against the feature's daily cap
	month := budget.For(&snap.AI, r.clock, now)
	month.Model++
	// priced from the dated rate table the TypeScript way (rates.ts): a call with no usage counts 0, one with usage and no price is "unpriced" (counted at the budget's assumed price),
	// one with a price adds its cost to the month. A builder's own rate (runtime.json parser.rate) is one more line, for provider "self-hosted".
	var cost *int64
	rateDate := ""
	if !got.HasUsage {
		zero := int64(0)
		cost = &zero
	} else {
		var extra []budget.Rate
		if cfg := r.o.Model.cfg; cfg.Rate != nil {
			extra = append(extra, budget.SelfHostedRate(cfg.Model, *cfg.Rate, time.UnixMilli(now).UTC().Format("2006-01-02")))
		}
		rate := budget.RateFor(r.o.Model.Provider, r.o.Model.cfg.Model, time.UnixMilli(now).UTC().Format("2006-01-02"), extra...)
		if cost = budget.CostMicroInr(rate, got.InputTokens, got.OutputTokens, 0); cost == nil {
			month.Unpriced++
		} else {
			month.CostMicroInr += *cost
			rateDate = rate.From
		}
	}
	budget.Record(&snap.AI, r.policy.Budget, "listing_draft", cost, key, r.clock, now)
	meter := map[string]string{"step": "model", "provider": r.o.Model.Provider, "model": r.o.Model.cfg.Model, "inputTokens": strconv.FormatInt(got.InputTokens, 10), "outputTokens": strconv.FormatInt(got.OutputTokens, 10)}
	if cost != nil {
		meter["costMicroInr"] = strconv.FormatInt(*cost, 10)
	}
	if rateDate != "" {
		meter["rateDate"] = rateDate
	}
	logLine := func(result string) {
		refs := map[string]string{"result": result}
		for k, v := range meter {
			refs[k] = v
		}
		rec.append(NewLine{Conversation: "owner", Action: "listing_draft", Outcome: "confirmed", Inputs: map[string]any{"digest": "owner words"}, Language: lang, Refs: refs,
			Notes: "the assistant drafted a listing from the owner's words; nothing is public until the owner taps Show it"})
	}
	if got.Reason != "" || got.Answer == nil {
		pause := now + r.policy.PauseMinutes*60_000
		month.PausedUntilMs = &pause
		logLine("no_answer")
		return nil
	}
	answer := listings.ReadAnswer(got.Answer)
	if answer == nil || !listings.IsCategory(answer.Category, nil) {
		logLine("refused_shape")
		return nil
	}
	if why := listings.GroundedIn(text, answer.Words, answer.Claims); why != "" {
		logLine("refused_" + string(why))
		return nil
	}
	logLine("checked")
	in := listings.DraftInput{Category: answer.Category, OwnerLang: read.OwnerLang, Words: answer.Words, OwnerWords: &text, Claims: answer.Claims, PricePaise: read.PricePaise, PriceNote: read.PriceNote, Qty: read.Qty}
	in.Photos = s.TakePhotos(photoIDs(waiting), now)
	made, why := s.Draft(in, now)
	if why != "" {
		return nil
	}
	made.From = "app" // the owner wrote from their page
	rec.append(NewLine{Conversation: number, Action: "listing", Outcome: "confirmed", Inputs: map[string]any{"listing": made.ID, "category": made.Category}, Language: lang, Refs: refsOf(made, "drafted"),
		Notes: "the assistant drafted a listing from the owner's words; it is not public until the owner taps Show it"})
	return nil
}

func photoIDs(p []listings.PendingPhoto) []string {
	out := make([]string, len(p))
	for i, x := range p {
		out[i] = x.ID
	}
	return out
}
