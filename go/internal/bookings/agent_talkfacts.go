package bookings

// The reads the owner's talk rests on, on a Bookings shop (templates/commerce/bookings/src/assistant.ts talkReads): `Facts` is the shop's own numbers for the OWNER's talk, counts
// only, never a customer's name or number (bookings today and the first one's time, the last and next seven days, the weekdays and the top services over 28 days, the cancelled
// and what waits for the owner), and `PublicContext` is what a customer may be told (agent_talk.go publicContext, the same the customer's talk reads), which the owner's talk
// reads with no customer. Word for word TypeScript's English: the sources are data for the model, never shown as they are. Proved on the TypeScript's own output
// (internal/bookings/testdata/talk-facts-vectors.json, go/scripts/gen_talk_facts_vectors.ts).

import (
	"sort"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

const dayMs = 86_400_000 // assistant.ts DAY_MS: a fixed day (India keeps no summer time)

// stands is talkReads' `stands`: a booking that counts as one the shop has.
func stands(b *Booking) bool {
	return b.State == Confirmed || b.State == NeedsOwner || b.State == Completed
}

// Facts is skill.ts `facts` for Bookings.
func (k *bookingsSkill) Facts(nowMs int64) []assistant.TalkSource {
	return ownerTalkFacts(k.a.settings, k.a.store, nowMs)
}

// PublicContext is skill.ts `publicContext` for Bookings (no links: assistant.ts gives none).
func (k *bookingsSkill) PublicContext(phone string, _ int64) []assistant.TalkSource {
	return k.a.publicContext(phone)
}

func ownerTalkFacts(s *Settings, st *Store, nowMs int64) []assistant.TalkSource {
	tz := s.Timezone
	lang := s.Owner.Language
	start := zone.ZonedToMs(zone.LocalParts(nowMs, tz).Date, 0, 0, tz)
	inDay := func(b *Booking, from, to int64) bool {
		return b.StartMs != nil && *b.StartMs >= from && *b.StartMs < to
	}
	var out []assistant.TalkSource

	var today []int64
	for _, b := range st.Bookings {
		if stands(b) && inDay(b, start, start+dayMs) {
			today = append(today, *b.StartMs)
		}
	}
	text := "Bookings today: " + i64(int64(len(today)))
	if len(today) > 0 {
		first := today[0]
		for _, ms := range today {
			first = min(first, ms)
		}
		text += ", the first at " + language.Formats(lang).Slot(first, s.Loc)
	}
	out = append(out, assistant.TalkSource{ID: "r:today", Kind: "record", Text: text + ".", MomentsMs: orEmpty(today)})

	week := func(from, to int64) int64 {
		n := int64(0)
		for _, b := range st.Bookings {
			if stands(b) && inDay(b, from, to) {
				n++
			}
		}
		return n
	}
	out = append(out, assistant.TalkSource{ID: "r:week", Kind: "record", Text: "Bookings in the last 7 days: " + i64(week(start-7*dayMs, start)) + ". In the next 7 days: " + i64(week(start, start+7*dayMs)) + "."})

	var weekdays [7]int64
	for _, b := range st.Bookings {
		if stands(b) && b.StartMs != nil && *b.StartMs >= start-28*dayMs && *b.StartMs < start {
			weekdays[zone.WeekdayOf(zone.LocalParts(*b.StartMs, tz).Date)]++
		}
	}
	days := make([]string, 7)
	for i, d := range weekdayEN {
		days[i] = d + " " + i64(weekdays[i])
	}
	out = append(out, assistant.TalkSource{ID: "r:weekdays", Kind: "record", Text: "Bookings by weekday over the last 28 days: " + strings.Join(days, ", ") + "."})

	// the top three services over the last 28 days (from then on, the future included, as TypeScript counts them), most first; a tie keeps the order the services were first met in
	type count struct {
		id string
		n  int64
	}
	var counts []count
	at := map[string]int{}
	for _, b := range st.Bookings {
		if stands(b) && b.ServiceID != "" && b.StartMs != nil && *b.StartMs >= start-28*dayMs {
			if i, ok := at[b.ServiceID]; ok {
				counts[i].n++
			} else {
				at[b.ServiceID] = len(counts)
				counts = append(counts, count{b.ServiceID, 1})
			}
		}
	}
	sort.SliceStable(counts, func(i, j int) bool { return counts[i].n > counts[j].n })
	if len(counts) > 3 {
		counts = counts[:3]
	}
	top := assistant.TalkSource{ID: "r:top", Kind: "record", Text: "No bookings in the last 28 days.", Literals: []string{}}
	if len(counts) > 0 {
		parts := make([]string, len(counts))
		for i, c := range counts {
			sv := s.ServiceByID(c.id)
			if sv == nil {
				sv = &Service{ID: c.id}
			}
			name := ServiceName(sv, lang)
			top.Literals = append(top.Literals, name)
			parts[i] = name + " " + i64(c.n)
		}
		top.Text = "Top services over the last 28 days: " + strings.Join(parts, ", ") + "."
	}
	out = append(out, top)

	var cancelled, waiting int64
	for _, b := range st.Bookings {
		if b.State == Cancelled && b.StartMs != nil && *b.StartMs >= start-28*dayMs {
			cancelled++
		}
		if b.State == NeedsOwner {
			waiting++
		}
	}
	out = append(out, assistant.TalkSource{ID: "r:cancelled", Kind: "record", Text: "Cancelled bookings over the last 28 days: " + i64(cancelled) + ". Waiting for the owner now: " + i64(waiting) + "."})
	return out
}

func orEmpty(xs []int64) []int64 {
	if xs == nil {
		return []int64{}
	}
	return xs
}
