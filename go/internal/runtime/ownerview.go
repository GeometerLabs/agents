package runtime

// What the owner's talk-and-cards page reads (GET /internal/channel/owner): the Go twin of modules/assistant/app/view.ts `ownerAppView` added to the owner view of
// templates/commerce/listings/src/channel.ts. For a listings-only shop the shop has no cases, so what is waiting and what is today are empty; the page's content is the character, its mood,
// the assistant's open cards (answered by card id and digest, never by code) and the last lines of talk, and the notes the assistant remembers. Read from the last saved state.
//
// Also the owner_action event of that page: a card's yes or no (the runtime has checked the owner's link or session before it was saved).

import (
	"encoding/json"
	"strings"
)

type characterView struct {
	Name        string `json:"name,omitempty"`
	Style       string `json:"style"`
	Personality string `json:"personality"`
	Seed        string `json:"seed,omitempty"`
	Colour      string `json:"colour,omitempty"`
	Paint       string `json:"paint,omitempty"`
}

type cardView struct {
	ID          string `json:"id"`
	Digest      string `json:"digest"`
	Skill       string `json:"skill"`
	Kind        string `json:"kind"`
	Case        string `json:"case"`
	AmountPaise int64  `json:"amountPaise"`
	Who         string `json:"who"`
	ExpiresAtMs int64  `json:"expiresAtMs"`
	Question    string `json:"question,omitempty"`
	HasNo       bool   `json:"hasNo"`
}

type talkView struct {
	AtMs int64  `json:"atMs"`
	From string `json:"from"`
	Text string `json:"text"`
}

type noteView struct {
	ID       string `json:"id"`
	Text     string `json:"text"`
	Kind     string `json:"kind"`
	Audience string `json:"audience"`
	UntilMs  *int64 `json:"untilMs,omitempty"`
}

type appView struct {
	Character   characterView `json:"character"`
	Mood        string        `json:"mood"`
	Face        string        `json:"face"`
	ClosedToday bool          `json:"closedToday"`
	Today       []any         `json:"today"`
	Waiting     []any         `json:"waiting"`
	Cards       []cardView    `json:"cards"`
	Talk        []talkView    `json:"talk"`
	Notes       []noteView    `json:"notes"`
	Listen      bool          `json:"listen"`
}

// inScopeNotes is memory.ts `inScope` for the owner: open, not past their end, with their text. Read only: this runtime keeps no notes of its own (go/TRIAL.md), but the ones the
// TypeScript runtime kept in the same state are shown.
func inScopeNotes(memory json.RawMessage, now int64) []noteView {
	out := []noteView{}
	var m struct {
		Notes []struct {
			ID       string          `json:"id"`
			Kind     string          `json:"kind"`
			Text     string          `json:"text"`
			Audience string          `json:"audience"`
			UntilMs  *int64          `json:"untilMs"`
			Closed   json.RawMessage `json:"closed"`
			TextGone bool            `json:"textGone"`
		} `json:"notes"`
	}
	if len(memory) == 0 || json.Unmarshal(memory, &m) != nil {
		return out
	}
	for _, n := range m.Notes {
		closed := len(n.Closed) > 0 && string(n.Closed) != "null"
		if closed || n.TextGone || n.Text == "" || (n.UntilMs != nil && *n.UntilMs <= now) {
			continue
		}
		out = append(out, noteView{ID: n.ID, Text: n.Text, Kind: n.Kind, Audience: n.Audience, UntilMs: n.UntilMs})
	}
	return out
}

// OwnerPage is the answer of GET /internal/channel/owner.
func (r *Runtime) OwnerPage() map[string]any {
	s := r.current()
	now := r.o.Now()
	set := r.o.Client.Settings
	v := appView{Character: characterView{Name: set.Assistant.Name, Style: set.Assistant.Style, Personality: set.Assistant.Personality, Seed: set.Assistant.Seed, Colour: set.Assistant.Colour, Paint: set.Assistant.Paint},
		Today: []any{}, Waiting: []any{}, Cards: []cardView{}, Talk: []talkView{}, Notes: []noteView{}}
	waiting := 0
	if a := s.A; a != nil {
		for _, c := range a.OpenCards(now) {
			amount := int64(0)
			if raw, ok := c.Action.Fields["amountPaise"]; ok {
				if b := strings.TrimSpace(string(raw)); b != "" && (b[0] == '-' || (b[0] >= '0' && b[0] <= '9')) {
					amount = rawInt(raw) // a number only (view.ts: `typeof ... === "number"`)
				}
			}
			who := c.Action.Case
			if raw, ok := c.Action.Fields["who"]; ok {
				who = rawString(raw)
			}
			v.Cards = append(v.Cards, cardView{ID: c.ID, Digest: c.Digest, Skill: c.Action.Skill, Kind: c.Action.Kind, Case: c.Action.Case, AmountPaise: amount, Who: who, ExpiresAtMs: c.ExpiresAtMs, Question: c.Question, HasNo: c.HasNo()})
			waiting++
		}
		for _, l := range a.Talk {
			v.Talk = append(v.Talk, talkView{AtMs: l.AtMs, From: l.From, Text: l.Text})
		}
		v.Notes = inScopeNotes(a.Rest["memory"], now)
		today := r.today(now)
		for _, d := range a.ClosedDays {
			v.ClosedToday = v.ClosedToday || d == today
		}
	}
	// mood.ts moodOf for a shop with no problems, no hours and no bookings: waiting for the owner beats closed beats quiet
	switch {
	case waiting > 0:
		v.Mood, v.Face = "waiting_for_owner", "needs"
	case v.ClosedToday:
		v.Mood, v.Face = "closed", "closed"
	default:
		v.Mood, v.Face = "quiet", "well"
	}
	return map[string]any{
		"shop": map[string]any{"name": set.Name, "timezone": set.Timezone, "ownerLanguage": set.Owner.Language}, "kind": "listings", "services": []any{}, "items": []any{}, "upcoming": []any{},
		"app": v,
	}
}

// ownerAction runs an owner_action in a step: a card's yes or no goes through the card binding; every other action name is the TypeScript templates' (a deposit received, a refund sent...) and
// a listings-only shop has none of those, so it is ignored, as the TypeScript agent ignores it.
func (r *Runtime) ownerAction(snap *Snap, rec *recorder, ev map[string]any, now int64) {
	action, _ := ev["action"].(string)
	if action != "card_yes" && action != "card_no" {
		return
	}
	id, _ := ev["case"].(string)
	digest, _ := ev["digest"].(string)
	answer := "yes"
	if action == "card_no" {
		answer = "no"
	}
	r.assistantFor(snap, rec, now).onPageCard(id, digest, answer)
}
