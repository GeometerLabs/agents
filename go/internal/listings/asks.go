package listings

import "sort"

// AsksPerDay: the owner is asked "still have it?" at most this many times a day (listings.ts ASKS_PER_DAY); about one listing at most once in FreshMs.
const AsksPerDay = 3

// DueAsks is listings.ts `dueAsks`: the live listings whose confirmation is old enough to ask about (confirmed more than a day before it would go stale, and not asked in the last two days),
// the oldest confirmation first, at most as many as the day has room for. Returns their ids.
func DueAsks(s *State, nowMs int64, askedToday int) []string {
	room := AsksPerDay - askedToday
	if room < 0 {
		room = 0
	}
	var due []*Listing
	for i := range s.Items {
		l := &s.Items[i]
		if l.State == "live" && nowMs-l.ConfirmedMs > FreshMs-Day && nowMs-l.AskedMs > 2*Day {
			due = append(due, l)
		}
	}
	sort.SliceStable(due, func(i, j int) bool { return due[i].ConfirmedMs < due[j].ConfirmedMs })
	if len(due) > room {
		due = due[:room]
	}
	ids := make([]string, len(due))
	for i, l := range due {
		ids[i] = l.ID
	}
	return ids
}
