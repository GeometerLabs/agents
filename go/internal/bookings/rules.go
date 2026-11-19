package bookings

// The Bookings limits that read only their arguments, and the free starts worked out from them: the Go twin of templates/commerce/bookings/src/limits.ts (within-hours,
// no-double-booking, no-message-after-stop, one-deposit-per-booking's shape), agent.ts freeOnDay, modules/reminders/reminders.ts and the time helpers of modules/core/time.ts. Each
// rule returns a Decision {ruleId, verdict, reason} with the TypeScript's words: the record keeps the decisions, and a line written by either runtime reads the same.
//
// The time helpers are internal/zone's (the one Go copy of core/time.ts): a local time is Go's time package over the zone database the binary carries, where time.ts asks Intl, and
// zonedToMs makes time.ts's own two passes, so even a time a summer-time change skips lands where the TypeScript puts it.

import (
	"encoding/json"
	"fmt"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// Minute and Hour in milliseconds (time.ts).
const (
	Minute = zone.Minute
	Hour   = zone.Hour
	Day    = 24 * Hour
)

// Decision is modules/limits/limits.ts Decision, its members in the TypeScript's order.
type Decision struct {
	RuleID  string `json:"ruleId"`
	Verdict string `json:"verdict"`
	Reason  string `json:"reason"`
}

func allow(rule, reason string) Decision { return Decision{rule, "allow", reason} }
func block(rule, reason string) Decision { return Decision{rule, "block", reason} }

// Blocked: the action does not happen.
func (d Decision) Blocked() bool { return d.Verdict == "block" }

// JSON is the decision as the record keeps it.
func (d Decision) JSON() json.RawMessage { b, _ := json.Marshal(d); return b }

// LocalDate and LocalParts are core/time.ts's, from internal/zone, the one Go copy of time.ts (its zonedToMs two-pass guess included, so a booking's minute in a zone with summer
// time is the TypeScript's).
type (
	LocalDate  = zone.Date
	LocalParts = zone.Parts
)

// isoDate is the date as "2026-11-16" (the key a day the owner closed is kept under).
func isoDate(d LocalDate) string { return fmt.Sprintf("%04d-%02d-%02d", d.Year, d.Month, d.Day) }

// HoursOn is settings.ts hoursOn: the opening window of a weekday, or nil when closed.
func (s *Settings) HoursOn(weekday int) *Hours { return s.OpeningHours[weekday] }

// CheckWithinHours is limits.ts checkWithinHours: never book outside opening hours (and only on the slot grid). closedDays are the dates the owner closed through the assistant.
func CheckWithinHours(s *Settings, sv *Service, startMs int64, closedDays []string) Decision {
	start := zone.LocalParts(startMs, s.Timezone)
	end := zone.LocalParts(startMs+sv.DurationMinutes*Minute, s.Timezone)
	hours := s.HoursOn(start.Weekday)
	if hours == nil {
		return block("within-hours", "The business is closed that day.")
	}
	if contains(closedDays, isoDate(start.Date)) {
		return block("within-hours", "The owner closed the business that day.")
	}
	startMin, endMin := start.Hour*60+start.Minute, end.Hour*60+end.Minute
	if startMin < hours.Open {
		return block("within-hours", "That is before opening time.")
	}
	if start.Date != end.Date || endMin > hours.Close {
		return block("within-hours", fmt.Sprintf("%d minutes from then would run past closing time.", sv.DurationMinutes))
	}
	if int64(startMin)%s.SlotMinutes != 0 {
		return block("within-hours", fmt.Sprintf("Bookings start every %d minutes, and that time is between two slots.", s.SlotMinutes))
	}
	return allow("within-hours", "The whole booking falls inside opening hours.")
}

// BusyEvent is limits.ts BusyEvent: a stretch something uses. TentativeUntil (a hold) stops blocking when it ends; Resource "" blocks every resource (another tool's event).
type BusyEvent struct {
	Start, End     int64
	BookingRef     string
	TentativeUntil *int64
	Resource       string
}

// CheckNoDoubleBooking is limits.ts checkNoDoubleBooking: one booking per slot, or as many as the shop has units of the thing booked.
func CheckNoDoubleBooking(startMs, endMs, bufferMinutes int64, ownRef string, others []BusyEvent, nowMs int64, resource string, units int64) Decision {
	if units == 0 {
		units = 1
	}
	buffer := bufferMinutes * Minute
	var clashing []BusyEvent
	for _, e := range others {
		if e.BookingRef == ownRef || (e.TentativeUntil != nil && *e.TentativeUntil <= nowMs) {
			continue // the asking booking itself, and a hold that ended, block nobody
		}
		if e.Resource != "" && resource != "" && e.Resource != resource {
			continue
		}
		if e.Start < endMs+buffer && startMs < e.End+buffer {
			clashing = append(clashing, e)
		}
	}
	// the same booking listed twice (its calendar event and the shop's own hold) is one use of one unit; only matters above one unit
	uses := clashing
	if units != 1 {
		uses = nil
		seen := map[string]bool{}
		for _, e := range clashing {
			if e.BookingRef == "" || e.BookingRef == "foreign" || !seen[e.BookingRef] {
				if e.BookingRef != "" && e.BookingRef != "foreign" {
					seen[e.BookingRef] = true
				}
				uses = append(uses, e)
			}
		}
	}
	until := endMs + buffer
	depthAt := func(t int64) int64 {
		var n int64
		for _, e := range uses {
			if e.Start <= t && t < e.End+buffer {
				n++
			}
		}
		return n
	}
	var busiest int64
	if len(uses) > 0 {
		busiest = depthAt(startMs)
		for _, e := range uses {
			if e.Start > startMs && e.Start < until {
				busiest = max(busiest, depthAt(e.Start))
			}
		}
	}
	if busiest >= units {
		gap := ""
		if bufferMinutes > 0 {
			gap = fmt.Sprintf(" (including the %d-minute gap kept between bookings)", bufferMinutes)
		}
		if units > 1 {
			return block("no-double-booking", fmt.Sprintf("All %d are already in use then%s.", units, gap))
		}
		return block("no-double-booking", "Another booking or hold already uses that time"+gap+".")
	}
	return allow("no-double-booking", "Nothing else in the calendar uses that time.")
}

// CheckNoMessageAfterStop is limits.ts checkNoMessageAfterStop: no reminder after a cancellation, completion or STOP.
func CheckNoMessageAfterStop(isReminder, bookingConfirmed, optedOut bool) Decision {
	switch {
	case !isReminder:
		return allow("no-message-after-stop", "This is not a reminder.")
	case optedOut:
		return block("no-message-after-stop", "The customer sent STOP, so no reminder goes out.")
	case !bookingConfirmed:
		return block("no-message-after-stop", "The booking is cancelled, finished or never confirmed, so no reminder goes out.")
	}
	return allow("no-message-after-stop", "The booking is live and the customer has not opted out.")
}

// resourceOf is agent.ts resourceOf: the service's resource, or the shared pool.
func resourceOf(sv *Service) string {
	if sv != nil && sv.Resource != "" {
		return sv.Resource
	}
	return SharedResource
}

// HeldByBookings is agent.ts heldByBookings: the times the shop's own bookings hold, from the bookings themselves (the shop's saved state is the authority for its holds). One
// waiting for its deposit holds until its hold ends; one waiting for the owner and a confirmed one hold until they are cancelled or done.
func HeldByBookings(st *Store, s *Settings, exceptID string) []BusyEvent {
	var held []BusyEvent
	for _, x := range st.Bookings {
		if x.ID == exceptID || x.StartMs == nil || x.EndMs == nil {
			continue
		}
		res := resourceOf(s.ServiceByID(x.ServiceID))
		switch {
		case x.State == AwaitingDeposit && x.HoldExpiresAt != nil:
			until := *x.HoldExpiresAt
			held = append(held, BusyEvent{Start: *x.StartMs, End: *x.EndMs, BookingRef: x.ID, TentativeUntil: &until, Resource: res})
		case x.State == NeedsOwner || x.State == Confirmed:
			held = append(held, BusyEvent{Start: *x.StartMs, End: *x.EndMs, BookingRef: x.ID, Resource: res})
		}
	}
	return held
}

// FreeOnDay is agent.ts freeOnDay: every start on the slot grid, on one day, free for this service: inside its hours, clear of everything busy (the calendar and the shop's own
// holds), and far enough ahead that the customer has the hold's time to pay. The one place free times are worked out.
func FreeOnDay(s *Settings, sv *Service, date LocalDate, others []BusyEvent, nowMs int64, closedDays []string) []int64 {
	hours := s.HoursOn(zone.WeekdayOf(date))
	if hours == nil || contains(closedDays, isoDate(date)) {
		return []int64{}
	}
	grid := int(s.SlotMinutes)
	free := []int64{}
	for m := (hours.Open + grid - 1) / grid * grid; m+int(sv.DurationMinutes) <= hours.Close; m += grid {
		start := zone.ZonedToMs(date, m/60, m%60, s.Timezone)
		if start <= nowMs+s.Deposit.HoldMinutes*Minute {
			continue // the customer needs the hold's time to pay before it starts
		}
		d := CheckNoDoubleBooking(start, start+sv.DurationMinutes*Minute, s.BufferMinutes, "", others, nowMs, resourceOf(sv), s.UnitsFor(sv))
		if !d.Blocked() {
			free = append(free, start)
		}
	}
	return free
}

// Reminder is reminders.ts Reminder.
type Reminder struct {
	AtMs int64 `json:"atMs"`
	Sent bool  `json:"sent"`
}

// ReminderSchedule is booking.ts reminderSchedule: each configured number of hours before the start, leaving out any that is already past.
func ReminderSchedule(s *Settings, startMs, nowMs int64) []Reminder {
	out := []Reminder{}
	for _, h := range s.Reminders {
		if at := startMs - h*Hour; at > nowMs {
			out = append(out, Reminder{AtMs: at})
		}
	}
	return out
}

// TakeDue is reminders.ts takeDue: every reminder that fell due is marked sent, and ONE message goes, for the latest of them (never a burst after the agent was down).
func TakeDue(rs []Reminder, nowMs int64) (due bool, atMs int64) {
	for i := range rs {
		if !rs[i].Sent && rs[i].AtMs <= nowMs {
			rs[i].Sent = true
			if !due || rs[i].AtMs > atMs {
				atMs = rs[i].AtMs
			}
			due = true
		}
	}
	return due, atMs
}

func hold(rule, reason string) Decision { return Decision{rule, "hold_for_owner", reason} }

// inr is format.ts formatInr over whole rupees ("₹1,200", en-IN grouping), the words every limit's reason writes.
func inr(rupees int64) string { return language.FormatInrWhole(rupees) }

// CheckPriceAtOrAboveList is limits.ts checkPriceAtOrAboveList: never quote or agree below the price list.
func CheckPriceAtOrAboveList(serviceName string, listInr, proposedInr int64) Decision {
	if proposedInr < listInr {
		return block("price-at-or-above-list", fmt.Sprintf("%s is below the price list: %s is %s. The agent never quotes or agrees to less.", inr(proposedInr), serviceName, inr(listInr)))
	}
	return allow("price-at-or-above-list", fmt.Sprintf("%s is at or above the list price of %s for %s.", inr(proposedInr), inr(listInr), serviceName))
}

// CheckRefundLimit is limits.ts checkRefundLimit over modules/limits checkRefund: a refund above the limit, or one not owed automatically (a late cancellation), needs the owner;
// "within the limit" includes the limit itself. paidInr < 0 is "not given".
func CheckRefundLimit(amountInr, limitInr, paidInr int64, ownerApproved, inCancellationWindow bool) Decision {
	switch {
	case amountInr <= 0:
		return block("refund-limit", "A refund must be more than zero.")
	case paidInr >= 0 && amountInr > paidInr:
		return block("refund-limit", fmt.Sprintf("A refund of %s is more than the %s that was paid.", inr(amountInr), inr(paidInr)))
	case ownerApproved:
		return allow("refund-limit", fmt.Sprintf("The owner approved this refund of %s.", inr(amountInr)))
	case !inCancellationWindow:
		return hold("refund-limit", "The booking was cancelled too late for an automatic refund, so the owner decides.")
	case amountInr > limitInr:
		return hold("refund-limit", fmt.Sprintf("%s is above your %s refund limit, so the owner has to approve it.", inr(amountInr), inr(limitInr)))
	}
	return allow("refund-limit", fmt.Sprintf("%s is within your %s refund limit.", inr(amountInr), inr(limitInr)))
}
