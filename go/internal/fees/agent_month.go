package fees

// The clock's work: agent.ts onTick (refunds first, the owner's UPI refund reminders, the links closed at the licence's final stop, then the month's fees opened, the late fee
// and the reminders, then Classes), with openMonthlyFees, addLateFee, remind and otherOpenFees; and item 11h's parent's private link (linkFor, keepLink, revokeLink): one link
// per parent, ONLY its hash kept, saved as the parent's only when the message carrying it was accepted.

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/bookings"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// newHandle is handle.ts newHandle: 24 random bytes in base64url.
func newHandle() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func sha(s string) string { x := sha256.Sum256([]byte(s)); return hex.EncodeToString(x[:]) }

// ParentLinkHash is handle.ts parentLinkHash.
func ParentLinkHash(link string) string { return sha("parent-link:" + link) }

// ParentRef is channel.ts parentRef: a parent as the owner's page names them without their number.
func ParentRef(parent string) string { return "p-" + sha("parent-ref:" + parent)[:12] }

// parentChatHash is handle.ts parentChatHash.
func parentChatHash(ref string) string { return sha("parent-chat:" + ref) }

func dateOf(d zone.Date) LocalDate { return LocalDate{d.Year, d.Month, d.Day} }
func zdate(d LocalDate) zone.Date  { return zone.Date{Year: d.Year, Month: d.Month, Day: d.Day} }

func (a *Agent) midnight(d LocalDate) int64 { return dueMsOf(a.settings, d) }

func (a *Agent) reminderMoments(date LocalDate) []int64 { return reminderMomentsOf(a.settings, date) }

// The month's schedule as pure rules: due.ts dueMsOf, reminderMomentsOf, lateFeeFrom and backDueReminderAt, held to the TypeScript's by go/scripts/gen_fees_vectors.ts
// (testdata/rules-vectors.json, rules_test.go).

// dueMsOf is due.ts dueMsOf: the start of the due day in the centre's time zone.
func dueMsOf(s *Settings, d LocalDate) int64 { return zone.ZonedToMs(zdate(d), 0, 0, s.Timezone) }

// reminderMomentsOf is due.ts reminderMomentsOf: each reminder day from the due day, at the reminder hour, in the centre's time zone.
func reminderMomentsOf(s *Settings, date LocalDate) []int64 {
	out := make([]int64, len(s.Reminders.DaysFromDue))
	for i, dd := range s.Reminders.DaysFromDue {
		out[i] = zone.ZonedToMs(zone.AddDays(zdate(date), int(dd)), int(s.Reminders.Hour), 0, s.Timezone)
	}
	return out
}

// lateFeeFrom is due.ts lateFeeFrom: the start of the day after the due date and the grace days.
func lateFeeFrom(s *Settings, dueDate LocalDate) int64 {
	return zone.ZonedToMs(zone.AddDays(zdate(dueDate), int(s.Due.GraceDays)+1), 0, 0, s.Timezone)
}

// backDueReminderAt is due.ts backDueReminderAt: today at the reminder hour, or now if that hour has passed.
func backDueReminderAt(s *Settings, now int64) int64 {
	today := zone.LocalParts(now, s.Timezone)
	return max(now, zone.ZonedToMs(today.Date, int(s.Reminders.Hour), 0, s.Timezone))
}

func monthKey(year, month int) string { return fmt.Sprintf("%d-%02d", year, month) }

// newDue is due.ts newDue.
func (a *Agent) newDue(s Student, lang, month string, date LocalDate, dueMs, feeInr int64) *Due {
	b := a.settings.BatchByID(s.BatchID)
	return &Due{StudentName: s.Name, BatchID: b.ID, Customer: s.Parent, Language: lang, Month: month, DueDate: date, DueMs: dueMs, FeeInr: feeInr, State: Open,
		Links: []LinkRecord{}, Payments: []CountedPayment{}, Reminders: []bookings.Reminder{}, Pending: nil}
}

// feeForMonth is joining.ts feeForMonth: owed or not, for how much, and the part-month facts (rule, joined, days, daysInMonth) when the joining day mattered.
func feeForMonth(rule string, monthly int64, joined *LocalDate, year, month int) (owed bool, fee int64, part map[string]any) {
	if rule == "usual" || joined == nil {
		return true, monthly, nil
	}
	order := (year-joined.Year)*12 + (month - joined.Month)
	if order < 0 {
		return false, 0, nil
	}
	if order > 0 || joined.Day == 1 {
		return true, monthly, nil
	}
	length := DaysInMonth(year, month)
	days := length - joined.Day + 1
	iso := fmt.Sprintf("%04d-%02d-%02d", joined.Year, joined.Month, joined.Day)
	switch rule {
	case "nextMonth":
		return false, 0, nil
	case "full":
		return true, monthly, map[string]any{"rule": "full", "joined": iso, "days": days, "daysInMonth": length}
	}
	// Math.max(1, Math.round(monthly * days / length)): JavaScript rounds half up
	f := float64(monthly*int64(days)) / float64(length)
	return true, max(1, int64(f+0.5)), map[string]any{"rule": "prorata", "joined": iso, "days": days, "daysInMonth": length}
}

// openMonthlyFees is agent.ts openMonthlyFees: each student's back dues once, and this month's and next month's fee once their first reminder moment has come.
func (a *Agent) openMonthlyFees() {
	now := a.now()
	tz := a.settings.Timezone
	today := zone.LocalParts(now, tz)
	ny, nm := today.Year, today.Month+1
	if today.Month == 12 {
		ny, nm = today.Year+1, 1
	}
	rule := a.settings.JoiningMidMonth
	for _, st := range a.settings.Students {
		lang := st.Language
		if lang == "" {
			if c := a.store.FindCustomer(st.Parent); c != nil && c.Language != "" {
				lang = c.Language
			} else {
				lang = a.settings.Languages[0]
			}
		}
		has := func(key string) bool {
			for _, d := range a.store.Dues {
				if d.Customer == st.Parent && d.StudentName == st.Name && d.Month == key {
					return true
				}
			}
			return false
		}
		for _, back := range st.BackDues {
			if has(back.Month) {
				continue
			}
			y, _ := strconv.Atoi(back.Month[:4])
			m, _ := strconv.Atoi(back.Month[5:])
			date := LocalDate{y, m, int(a.settings.Due.Day)}
			d := a.store.Register(a.newDue(st, lang, back.Month, date, a.midnight(date), back.AmountInr))
			d.BackDue = true
			d.Reminders = []bookings.Reminder{{AtMs: backDueReminderAt(a.settings, now)}}
			a.post(accounting.MoneyEvent{Kind: "fee_charged", Case: strp(d.ID), AmountPaise: d.FeeInr * 100}, func(m map[string]string) {
				a.log(d, d.Customer, "open_fee", "confirmed", map[string]any{"month": back.Month, "feeInr": d.FeeInr, "backDue": true}, logMore{
					refs:  merge(map[string]string{"month": back.Month, "amountPaise": itoa(d.FeeInr * 100), "backDue": "true"}, m),
					notes: fmt.Sprintf("an earlier unpaid month for %s (%s), entered by the owner in the settings, carried as a fee of its own", d.StudentName, back.Month)})
			})
		}
		var joined *LocalDate
		if rule != "usual" && st.Joined != "" {
			if y, m, dd, ok := ParseJoined(st.Joined); ok {
				joined = &LocalDate{y, m, dd}
			}
		}
		for _, ym := range [][2]int{{today.Year, today.Month}, {ny, nm}} {
			key := monthKey(ym[0], ym[1])
			if has(key) {
				continue
			}
			owed, fee, part := feeForMonth(rule, a.settings.BatchByID(st.BatchID).MonthlyFeeInr, joined, ym[0], ym[1])
			if !owed {
				continue
			}
			joiningNow := joined != nil && joined.Year == ym[0] && joined.Month == ym[1] && joined.Day > 1
			date := LocalDate{ym[0], ym[1], int(a.settings.Due.Day)}
			if joiningNow && a.midnight(date) < a.midnight(*joined) {
				date = *joined
			}
			moments := a.reminderMoments(date)
			first := moments[0]
			for _, x := range moments {
				first = min(first, x)
			}
			if now < first {
				continue
			}
			if !joiningNow && a.store.StartedAtMs != nil && first < *a.store.StartedAtMs {
				continue
			}
			d := a.store.Register(a.newDue(st, lang, key, date, a.midnight(date), fee))
			if part != nil {
				d.PartMonth = mustJSON(part)
			}
			for _, at := range moments {
				d.Reminders = append(d.Reminders, bookings.Reminder{AtMs: at})
			}
			notes := fmt.Sprintf("the fee for %s, %s, is open", d.StudentName, key)
			refs := map[string]string{"month": key, "amountPaise": itoa(d.FeeInr * 100)}
			if part != nil {
				refs["partMonth"], refs["joined"] = part["rule"].(string), part["joined"].(string)
				how := "the full month"
				if part["rule"] == "prorata" {
					how = fmt.Sprintf("%d of %d days", part["days"], part["daysInMonth"])
				}
				notes = fmt.Sprintf("the fee for %s, %s, is open (the student joined on %s: %s, by the centre's rule)", d.StudentName, key, part["joined"], how)
			}
			a.post(accounting.MoneyEvent{Kind: "fee_charged", Case: strp(d.ID), AmountPaise: d.FeeInr * 100}, func(m map[string]string) {
				a.log(d, d.Customer, "open_fee", "confirmed", map[string]any{"month": key, "feeInr": d.FeeInr}, logMore{refs: merge(refs, m), notes: notes})
			})
		}
	}
}

// addLateFee is agent.ts addLateFee: the grace days are over and the record shows the fee unpaid: the late fee, once.
func (a *Agent) addLateFee(d *Due) error {
	s := a.settings
	if s.LateFeeInr <= 0 || d.LateFeeInr > 0 || d.State != Open || d.BackDue {
		return nil
	}
	if a.store.Customer(d.Customer).OptedOut {
		return nil
	}
	after := lateFeeFrom(s, d.DueDate)
	if a.now() < after {
		return nil
	}
	if _, _, err := a.look(d); err != nil {
		return err
	}
	if d.State != Open {
		return nil
	}
	d.LateFeeInr = s.LateFeeInr
	a.post(accounting.MoneyEvent{Kind: "late_fee", Case: strp(d.ID), AmountPaise: s.LateFeeInr * 100}, func(m map[string]string) {
		a.log(d, d.Customer, "add_late_fee", "confirmed", map[string]any{"amountPaise": s.LateFeeInr * 100}, logMore{refs: merge(map[string]string{"amountPaise": itoa(s.LateFeeInr * 100)}, m), notes: "the grace days are over and the payment record shows the fee unpaid"})
	})
	unsent := false
	for _, r := range d.Reminders {
		unsent = unsent || !r.Sent
	}
	if d.RemindersSent < s.Reminders.MaxPerMonth && !unsent {
		d.Reminders = append(d.Reminders, bookings.Reminder{AtMs: a.now()})
	}
	return nil
}

func dueNow(rs []bookings.Reminder, now int64) bool {
	for _, r := range rs {
		if !r.Sent && r.AtMs <= now {
			return true
		}
	}
	return false
}

// remind is agent.ts remind: a reminder has fallen due: look at the payment record first, then send the one reminder (one message for several open fees of a parent).
func (a *Agent) remind(d *Due) error {
	now := a.now()
	if !dueNow(d.Reminders, now) {
		return nil
	}
	ok, _, err := a.look(d)
	if err != nil {
		return err
	}
	if d.State != Open || a.store.Customer(d.Customer).OptedOut {
		bookings.TakeDue(d.Reminders, now)
		return nil
	}
	if !ok {
		if d.ReadNoteAtMs == nil || now-*d.ReadNoteAtMs >= 30*minute {
			d.ReadNoteAtMs = N(now)
			a.log(d, d.Customer, "send_message", "blocked", map[string]any{"reminder": true}, logMore{decisions: []Decision{a.checkNoReminderOncePaid(d, false)}, notes: "the reminder waits until the payment record can be read", refs: map[string]string{"to": "customer"}})
		}
		return nil
	}
	link, err := a.currentLink(d)
	if err != nil {
		return err
	}
	if !link.ok && link.paused {
		bookings.TakeDue(d.Reminders, now)
		return nil
	}
	if !link.ok {
		if d.LinkFailTellAtMs == nil || now-*d.LinkFailTellAtMs >= hourly {
			d.LinkFailTellAtMs = N(now)
			a.tellOwner(d, d.Customer, "owner_link_failed", sayOpts{})
		}
		return nil
	}
	others, err := a.otherOpenFees(d, now)
	if err != nil {
		return err
	}
	bookings.TakeDue(d.Reminders, now)
	if len(others) > 0 {
		for _, o := range others {
			if dueNow(o.Reminders, now) {
				bookings.TakeDue(o.Reminders, now)
				if o.RemindersSent < a.settings.Reminders.MaxPerMonth {
					o.RemindersSent++
				}
			}
		}
		all := append([]*Due{d}, others...)
		sortByDue(all)
		lines := make([]FamilyLine, len(all))
		for i, x := range all {
			lines[i] = FamilyLine{StudentName: x.StudentName, BatchName: BatchName(a.settings.BatchByID(x.BatchID), d.Language), MonthLabel: monthLabel(x.Month, d.Language), BalanceInr: balanceInr(x), DueMs: x.DueMs, Link: x.linkOf().URL, DueRef: x.ID}
		}
		page, token := a.linkFor(d.Customer, false)
		template := "fee_reminder_family"
		if page != "" {
			template = "fee_reminder_family_page"
		}
		sent := a.tellCustomer(d, d.Customer, []string{template}, sayOpts{reminder: true, readOK: true, offer: ownerButton, family: lines, pageLink: page})
		if sent {
			d.RemindersSent++
		}
		if sent && page != "" {
			a.keepLink(d.Customer, token, "reminder")
		}
		return nil
	}
	t := zone.LocalParts(now, a.settings.Timezone)
	startOfToday := zone.ZonedToMs(t.Date, 0, 0, a.settings.Timezone)
	page, token := a.linkFor(d.Customer, false)
	kind := "fee_reminder"
	switch {
	case d.LateFeeInr > 0:
		kind = "fee_overdue_late"
	case startOfToday > d.DueMs:
		kind = "fee_overdue"
	}
	if page != "" {
		kind += "_page"
	}
	sent := a.tellCustomer(d, d.Customer, []string{kind}, sayOpts{reminder: true, readOK: true, offer: feeButtons(d), image: a.qrOf(d), pageLink: page})
	if sent {
		d.RemindersSent++
	}
	if sent && page != "" {
		a.keepLink(d.Customer, token, "reminder")
	}
	return nil
}

func sortByDue(ds []*Due) {
	for i := 1; i < len(ds); i++ {
		for j := i; j > 0 && ds[j].DueMs < ds[j-1].DueMs; j-- {
			ds[j], ds[j-1] = ds[j-1], ds[j]
		}
	}
}

// otherOpenFees is agent.ts otherOpenFees: the parent's other open fees to list with this one, each read and with a link for exactly what is owed.
func (a *Agent) otherOpenFees(d *Due, now int64) ([]*Due, error) {
	var out []*Due
	for _, o := range a.store.openDues(d.Customer) {
		if o == d || o.State != Open || !(dueNow(o.Reminders, now) || o.DueMs <= now) {
			continue
		}
		ok, _, err := a.look(o)
		if err != nil {
			return nil, err
		}
		if o.State != Open || !ok || balancePaise(o) <= 0 {
			continue
		}
		if a.checkNoReminderOncePaid(o, true).Verdict == "block" {
			continue
		}
		l, err := a.currentLink(o)
		if err != nil {
			return nil, err
		}
		if !l.ok || o.linkOf() == nil {
			continue
		}
		out = append(out, o)
	}
	return out, nil
}

// ---- item 11h: the parent's private link ----

// linkFor is agent.ts linkFor: the page's link for this parent now (the URL and its token), or "" when the centre has no page.
func (a *Agent) linkFor(parent string, fresh bool) (url, token string) {
	base := ""
	if a.kit.PageBase != nil {
		base = a.kit.PageBase()
	}
	if base == "" {
		return "", ""
	}
	if !fresh {
		token = a.madeThisStep[parent]
	}
	if token == "" {
		remembered := a.kit.linkMemory()[parent]
		saved := a.store.parentLinks(false)
		if !fresh && remembered != "" && saved != nil && saved.get(parent) != nil && ParentLinkHash(remembered) == saved.get(parent).Hash {
			token = remembered
		} else {
			token = newHandle()
		}
		a.madeThisStep[parent] = token
	}
	return base + "/f/" + token, token
}

// keepLink is agent.ts keepLink: the link went out, so it is the parent's link from now on (its hash only), and the one before opens nothing.
func (a *Agent) keepLink(parent, token, via string) {
	hash := ParentLinkHash(token)
	a.kit.linkMemory()[parent] = token
	links := a.store.parentLinks(true)
	old := links.get(parent)
	if old != nil && old.Hash == hash {
		return
	}
	links.set(parent, &ParentLink{Hash: hash, AtMs: a.now(), Via: via})
	refs := map[string]string{"via": via}
	how := "in a fee reminder"
	switch via {
	case "owner":
		how = "at the owner's press on their page"
	case "classes":
		how = "with a reading-material message"
	}
	tail := ""
	if old != nil {
		refs["replaced"] = "yes"
		tail = ", and the link it replaces opens nothing from now on"
	}
	a.log(nil, parent, "parent_link", "confirmed", map[string]any{"via": via}, logMore{refs: refs, notes: "the parent's private fees link was sent " + how + "; only its hash is kept" + tail})
}

// revokeLink is agent.ts revokeLink.
func (a *Agent) revokeLink(parent string) {
	if l := a.store.parentLinks(false); l != nil {
		l.del(parent)
	}
	delete(a.kit.linkMemory(), parent)
	dropped := 0
	if cs := a.store.confirmationsOf(false); cs != nil {
		for _, h := range append([]string(nil), cs.Keys...) {
			if cs.get(h).Parent == parent {
				cs.del(h)
				dropped++
			}
		}
	}
	tail := ""
	if dropped > 0 {
		tail = fmt.Sprintf(", and nor do the %d confirmation page(s) made through it", dropped)
	}
	a.log(nil, parent, "parent_link", "confirmed", map[string]any{"revoked": true}, logMore{refs: map[string]string{"revoked": "yes"}, notes: "the owner switched the parent's private fees link off from their page: it opens nothing from now on" + tail})
}

// parentOf is channel.ts parentOf: the parent whose private link has this hash NOW.
func (s *Store) parentOf(linkHash string) string {
	l := s.parentLinks(false)
	if l == nil {
		return ""
	}
	for _, p := range l.Keys {
		if l.get(p).Hash == linkHash {
			return p
		}
	}
	return ""
}

// ---- the beat ----

// onTick is agent.ts onTick.
func (a *Agent) onTick() error {
	if as := a.assistantOf(); as != nil {
		as.OnTick() // item 11e: cards past their time close; the morning line is the runtime's own job (AfterTick)
	}
	now := a.now()
	if a.store.StartedAtMs == nil {
		a.store.StartedAtMs = N(now) // agent.ts `store.startedAtMs ??= clock.now()` at the agent's making, saved with the first step
	}
	if err := a.refunds.Sweep(a.ctx, now); err != nil {
		return err
	}
	if a.marks != nil {
		a.remindOwedRefunds(now)
	}
	a.closeLinksAtStop()
	a.readSettlements(now) // yesterday's settlement rows, once a day (agent_settlements.go)
	working := a.takesNewWork()
	if working {
		a.openMonthlyFees()
	}
	for _, d := range append([]*Due(nil), a.store.Dues...) {
		if d.State != Open {
			continue
		}
		if !working {
			bookings.TakeDue(d.Reminders, now)
			continue
		}
		if err := a.addLateFee(d); err != nil {
			return err
		}
		if d.State == Open {
			if err := a.remind(d); err != nil {
				return err
			}
		}
	}
	if working && a.settings.Classes != nil {
		return a.classesTick()
	}
	return nil
}

// closeLinksAtStop is agent.ts closeLinksAtStop: the final stop, once for each paid_through: every open fee link closed at the gateway.
func (a *Agent) closeLinksAtStop() {
	if a.c.Licence() != "stopped" || !a.can.Cancels {
		return
	}
	var pt int64
	if p := a.c.PaidThrough(); p != nil {
		pt = *p
	}
	key := "stop:" + itoa(pt)
	for _, d := range append([]*Due(nil), a.store.Dues...) {
		if d.State != Open || d.CurrentLinkID == "" {
			continue
		}
		done := false
		for _, e := range a.c.Rec.Entries() {
			if e.Booking != nil && *e.Booking == d.ID && e.Action == "cancel_fee_link" && e.Refs["licence"] == key {
				done = true
			}
		}
		if done {
			continue
		}
		id := d.CurrentLinkID
		closed := a.cancelAndConfirm(id)
		outcome, notes := "unconfirmed", "the final stop of the centre's licence: the link could not be closed (it may have a payment on it, or the gateway did not answer); the owner can close it in the gateway's own dashboard"
		if closed {
			outcome, notes = "confirmed", "the final stop of the centre's licence: the open fee link is closed, so no new payment comes in; a payment already made is still recorded"
		}
		a.log(d, d.Customer, "cancel_fee_link", outcome, map[string]any{"linkId": id}, logMore{refs: map[string]string{"linkId": id, "licence": key}, notes: notes})
	}
}

// onStartedAt is the agent's making: `store.startedAtMs ??= clock.now()` runs for every step, so a message's step notes it too.
func (a *Agent) noteStarted() {
	if a.store.StartedAtMs == nil {
		a.store.StartedAtMs = N(a.now())
	}
}

var _ = strings.TrimSpace
