package runtime

// What the owner's talk-and-cards page reads (GET /internal/channel/owner): the Go twin of modules/assistant/app/view.ts `ownerAppView` added to the owner view of
// templates/commerce/listings/src/channel.ts. For a listings-only shop the shop has no cases, so what is waiting and what is today are empty; the page's content is the character, its mood,
// the assistant's open cards (answered by card id and digest, never by code) and the last lines of talk, and the notes the assistant remembers. Read from the last saved state.
//
// Also the owner_action event of that page: a card's yes or no (the runtime has checked the owner's link or session before it was saved).

import (
	"encoding/json"
	"time"

	"github.com/GeometerLabs/agents/go/internal/memory"
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

// inScopeNotes is notes.ts `forApp`: memory.ts `inScope` for the owner (open, not past their end, with their text), as the page lists them.
func inScopeNotes(raw json.RawMessage, now int64) []noteView {
	out := []noteView{}
	if len(raw) == 0 {
		return out
	}
	for _, n := range memory.Parse(raw).InScope("owner", now) {
		out = append(out, noteView{ID: n.ID, Text: n.Text, Kind: n.Kind, Audience: n.Audience, UntilMs: n.UntilMs})
	}
	return out
}

// OwnerPage is the answer of GET /internal/channel/owner.
func (r *Runtime) OwnerPage() map[string]any {
	s := r.current()
	set := r.o.Client.Settings
	return map[string]any{
		"shop": map[string]any{"name": set.Name, "timezone": set.Timezone, "ownerLanguage": set.Owner.Language}, "kind": "listings", "services": []any{}, "items": []any{}, "upcoming": []any{},
		"app": OwnerAppView(s, &set, nil, r.o.Now(), r.loc, false),
	}
}

// shopMood is conversation.ts shopMood: the mood (mood.ts moodOf) from the skill's reads, the assistant's open cards and closed days, and the clock, and the picture that shows it to
// the owner (character.ts FACE_OF_MOOD). Something wrong beats waiting for the owner, beats closed (or outside the hours), beats busy (a booking within the hour, or a full day),
// beats quiet.
func shopMood(s *Snap, skill OwnerSkill, now int64, loc *time.Location) (mood, face string) {
	d := dateIn(now, loc)
	problems, waiting := 0, 0
	var starts []int64
	closed, outside := IsClosedDay(s, d), false
	if skill != nil {
		problems, waiting = skill.Problems(), len(skill.Waiting())
		if ds, ok := skill.(DaySkill); ok {
			for _, r := range ds.Day(d) {
				starts = append(starts, r.StartMs)
			}
		}
		if hs, ok := skill.(HoursSkill); ok {
			open, close, ok := hs.Hours(d)
			closed = closed || !ok
			// mood.ts outsideHours: before opening or after closing (always, on a weekday with no hours)
			outside = !ok || now < time.Date(d.Year, time.Month(d.Month), d.Day, open/60, open%60, 0, 0, loc).UnixMilli() || now >= time.Date(d.Year, time.Month(d.Month), d.Day, close/60, close%60, 0, 0, loc).UnixMilli()
		}
	}
	if s.A != nil {
		waiting += len(s.A.OpenCards(now))
	}
	soon := false
	for _, st := range starts {
		soon = soon || (st >= now-3_600_000 && st <= now+3_600_000)
	}
	switch {
	case problems > 0:
		return "something_wrong", "wrong"
	case waiting > 0:
		return "waiting_for_owner", "needs"
	case closed || outside:
		return "closed", "closed"
	case soon || len(starts) >= 8: // mood.ts BUSY_DAY
		return "busy", "busy"
	}
	return "quiet", "well"
}

type waitingView struct {
	Case        string `json:"case"`
	Kind        string `json:"kind"`
	AmountPaise int64  `json:"amountPaise"`
	Who         string `json:"who"`
	What        string `json:"what"`
	Money       bool   `json:"money"`
	Yes         string `json:"yes"`
	No          string `json:"no,omitempty"`
	Skill       string `json:"skill"`
}

type dayRowView struct {
	Case    string `json:"case"`
	StartMs int64  `json:"startMs"`
	What    string `json:"what"`
	Who     string `json:"who"`
	State   string `json:"state"`
}

// OwnerAppView is modules/assistant/app/view.ts ownerAppView over the last saved state: the character, the mood (mood.ts moodOf from the skill's reads, the open cards and the closed
// days), today's rows, each waiting item, the open cards (answered by card id and digest, never by code), the talk and the notes. skill is the template's own (read-only), nil
// for the listings-only shop. listen: the page may record a voice note (the shop has a voice service).
func OwnerAppView(s *Snap, set *Settings, skill OwnerSkill, now int64, loc *time.Location, listen bool) any {
	v := appView{Character: characterView{Name: set.Assistant.Name, Style: set.Assistant.Style, Personality: set.Assistant.Personality, Seed: set.Assistant.Seed, Colour: set.Assistant.Colour, Paint: set.Assistant.Paint},
		Today: []any{}, Waiting: []any{}, Cards: []cardView{}, Talk: []talkView{}, Notes: []noteView{}, Listen: listen}
	d := dateIn(now, loc)
	if skill != nil {
		if ds, ok := skill.(DaySkill); ok {
			for _, r := range ds.Day(d) {
				v.Today = append(v.Today, dayRowView{r.Case, r.StartMs, r.What, r.Who, r.State})
			}
		}
		for _, w := range skill.Waiting() {
			v.Waiting = append(v.Waiting, waitingView{w.Case, w.Kind, w.AmountPaise, w.Who, w.What, w.Money, w.Yes, w.No, skill.Name()})
		}
	}
	if a := s.A; a != nil {
		for _, c := range a.OpenCards(now) {
			amount := int64(0)
			if raw, ok := c.Action.Fields["amountPaise"]; ok && isNumber(raw) {
				amount = rawInt(raw) // a number only (view.ts: `typeof ... === "number"`)
			}
			who := c.Action.Case
			if raw, ok := c.Action.Fields["who"]; ok {
				who = rawString(raw)
			}
			v.Cards = append(v.Cards, cardView{ID: c.ID, Digest: c.Digest, Skill: c.Action.Skill, Kind: c.Action.Kind, Case: c.Action.Case, AmountPaise: amount, Who: who, ExpiresAtMs: c.ExpiresAtMs, Question: c.Question, HasNo: c.HasNo()})
		}
		for _, l := range a.Talk {
			v.Talk = append(v.Talk, talkView{AtMs: l.AtMs, From: l.From, Text: l.Text})
		}
		v.Notes = inScopeNotes(a.Rest["memory"], now)
	}
	v.ClosedToday = IsClosedDay(s, d)
	v.Mood, v.Face = shopMood(s, skill, now, loc)
	return v
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
