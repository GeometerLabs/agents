package runtime

// The parts of the owner's assistant an Orders shop adds (wave W4): a skill with open cases (skill.ts `open`: "open orders" lists them, and the morning line counts them), a
// skill's own wording of a few lines (words.ts SKILL_ASK and SKILL_REFUSAL: the Orders skill's cancel and refund name an advance, not a deposit), and the face the shop's public
// pages show (character.ts publicFace). Each is used only by a skill that has it: a Bookings or listings-only shop is answered exactly as before.
//
// What the assistant says here is written from the packed words (go/scripts/gen_words.ts ordersWords) through one Writer, as dayList is: the count in {n}, the amount in {inr},
// the customer, what they ordered and the case as the key's own literal slots, so the outgoing check finds every value noted.

import (
	"strconv"
	"time"

	"github.com/GeometerLabs/agents/go/internal/assistant"
)

// OpenRow is skill.ts OpenRow: one open case, in the owner's language.
type OpenRow struct {
	Case        string
	Who, What   string
	AmountPaise int64
	State       string
}

// OpenSkill is a skill with open cases (skill.ts `open`: an Orders shop's open orders, and its plans' meals for tomorrow).
type OpenSkill interface {
	Open() []OpenRow
}

// openOrders is conversation.ts `case "open_orders": tell("open_list", {rows: skills.flatMap((s) => s.open?.() ?? [])})`.
func (c *conv) openOrders() {
	var rows []OpenRow
	for _, s := range c.skills {
		if os, ok := s.(OpenSkill); ok {
			rows = append(rows, os.Open()...)
		}
	}
	w := c.pack.Writer()
	c.tellText("open_list", c.openList(w, rows), w.Facts(), "", nil)
}

// openList is words.ts open_list: none, or the head and the rows (at most 12, then "and N more").
func (c *conv) openList(w *assistant.Writer, rows []OpenRow) string {
	if len(rows) == 0 {
		return w.Say("open_list.none")
	}
	text := w.Say("open_list.head", "n", strconv.Itoa(len(rows)))
	for i, r := range rows {
		if i >= listRows {
			break
		}
		text += "\n" + w.Say("open_list.row", "who", r.Who, "what", r.What, "inr", assistant.INR(r.AmountPaise), "case", r.Case)
	}
	if len(rows) > listRows {
		text += "\n" + w.Say("open_list.more", "n", strconv.Itoa(len(rows)-listRows))
	}
	return text
}

// skillKey is words.ts's skill wording (SKILL_ASK, SKILL_REFUSAL): the key's "@<skill>" form when the skill words it its own way, else the shared key.
func skillKey(p *assistant.Pack, key, skill string) string {
	if skill != "" && p.Has(key+"@"+skill) {
		return key + "@" + skill
	}
	return key
}

// PublicFace is conversation.ts shopMood's publicFace over the last saved state (character.ts publicFace): the mood the shop's public pages show, which leaves out what is the
// owner's (something wrong, something waiting for them): the face the shop would have with nothing waiting and nothing wrong.
func PublicFace(s *Snap, skill OwnerSkill, now int64, loc *time.Location) string {
	return publicFace(s, skill, now, loc)
}

func publicFace(s *Snap, skill OwnerSkill, now int64, loc *time.Location) string {
	mood, face := shopMood(s, skill, now, loc)
	if mood != "something_wrong" && mood != "waiting_for_owner" {
		return face
	}
	// moodOf({...facts, problems: 0, waiting: 0}): closed (or outside the hours) beats busy beats quiet, from the same reads as shopMood
	d := dateIn(now, loc)
	closed, outside := IsClosedDay(s, d), false
	var starts []int64
	if ds, ok := skill.(DaySkill); ok {
		for _, r := range ds.Day(d) {
			starts = append(starts, r.StartMs)
		}
	}
	if hs, ok := skill.(HoursSkill); ok {
		open, close, ok := hs.Hours(d)
		closed = closed || !ok
		outside = !ok || now < time.Date(d.Year, time.Month(d.Month), d.Day, open/60, open%60, 0, 0, loc).UnixMilli() || now >= time.Date(d.Year, time.Month(d.Month), d.Day, close/60, close%60, 0, 0, loc).UnixMilli()
	}
	soon := false
	for _, st := range starts {
		soon = soon || (st >= now-3_600_000 && st <= now+3_600_000)
	}
	switch {
	case closed || outside:
		return "closed"
	case soon || len(starts) >= 8:
		return "busy"
	}
	return "well"
}
