package fees

// The credit book (decision 63, the shop starter's first job): the shop's *khata* as a variant of Fees, switched on by the settings' `creditBook` block (credit_settings.go).
// Nothing here runs for a centre without the block.
//
// What it reuses, and why: each person's debt is ONE open Fees fee (batch "credit"), so Fees' payment record, link for exactly what is owed, owner-marked UPI, cash mark,
// reminders that stop on a recorded payment, refunds, books and report all apply unchanged; there is no second ledger. What is the credit book's own:
//   - the owner writes the entries in words ("Ramesh owes 2,400", "Ramesh paid 1,000"), on WhatsApp or on the owner's page (credit_read.go reads them by rules alone);
//   - a customer's number is given by the owner once (typed) and stays in the shop's store (credit_state.go);
//   - NOTHING reaches a customer before the owner's tap ("Ask Ramesh", or "ask Ramesh"), and that first message only asks whether reminders on WhatsApp are fine; reminders
//     go only after the customer's yes; STOP (or a no) ends every message. The say path's gate (creditGate) holds this for every message, not only the reminder;
//   - "paid" in the owner's words is the owner's mark (cash at the counter), recorded as marked paid by the owner, never as a confirmed payment; a UPI payment counts only when the
//     owner marks its request received, and a gateway's only from the gateway's own list (Fees' paths);
//   - the words are an adult's about their own account (credit/words.ts), each Fees message a credit account reaches having its credit twin (creditTwin);
//   - reminders go at most every `remindEveryDays` at the shop's reminder hour, and at most reminders.maxPerMonth in a calendar month (a running account lives across months);
//   - the list of who owes what is the owner's alone (their WhatsApp, their page); no customer, page or report lists it.
//
// E4 (a credit ceiling per customer) is NOT approved and not built. It would sit in addCredit, beside the account's maximum: an entry that takes a customer past their ceiling is
// held for the owner's yes (a card, as the waiver asks), and the yes raises that customer's ceiling once. maxPerPersonInr is not that ceiling: it bounds a payment link (Guard).

import (
	"fmt"
	"sort"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/bookings"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// creditAskButton is the owner's "Ask Ramesh" button's id: credit-ask:<account ref>.
const creditAskButton = "credit-ask:"

// waitingForNumberMs is how long an entry for a name the book does not know waits for its number.
const waitingForNumberMs = day

func (a *Agent) credit() bool { return a.settings.Credit != nil }

func (a *Agent) book() *CreditState { return a.store.creditOf(true) }

// creditAccountOf is the account of a number, or nil (also for a centre without the credit book).
func (a *Agent) creditAccountOf(phone string) *CreditAccount {
	if !a.credit() {
		return nil
	}
	return a.store.creditOf(false).byPhone(phone)
}

// isCredit says a fee is a credit account's.
func isCredit(d *Due) bool { return d != nil && d.BatchID == CreditBatch }

// openCreditDue is the account's open fee, or nil.
func (a *Agent) openCreditDue(acc *CreditAccount) *Due {
	for _, d := range a.store.openDues(acc.Phone) {
		if isCredit(d) {
			return d
		}
	}
	return nil
}

// creditLog is one record line about an account: its ref and the amount in refs, never the owner's own words and never the number (the line's conversation is the customer's
// number, as every Fees line about a parent is: the report hashes it).
func (a *Agent) creditLog(d *Due, acc *CreditAccount, action, outcome string, refs map[string]string, notes string, ds ...Decision) {
	r := map[string]string{"account": acc.Ref}
	for k, v := range refs {
		r[k] = v
	}
	in := map[string]any{"account": acc.Ref}
	if v, ok := refs["amountPaise"]; ok {
		in["amountPaise"] = jsNumber(v)
	}
	a.log(d, acc.Phone, action, outcome, in, logMore{refs: r, notes: notes, decisions: ds})
}

// ---- opening the settings' people, and adding to an account ----

// creditOpen opens each person of the settings' creditBook.people once, by their number: the shop's book on the day it starts. A person the owner already added (the same
// number) is not opened again; a name already in the book under another number is left out, and the record says so.
func (a *Agent) creditOpen() {
	if !a.credit() || !a.takesNewWork() {
		return
	}
	for _, p := range a.settings.Credit.People {
		c := a.book()
		if c.byPhone(p.Phone) != nil {
			continue
		}
		if other := c.byName(p.Name); other != nil && nameKey(other.Name) == nameKey(p.Name) {
			a.log(nil, p.Phone, "credit_add", "blocked", map[string]any{"by": "settings"}, logMore{refs: map[string]string{"by": "settings"}, notes: "a person in the settings has the name of another account in the book (another number), so they were not opened: give them a name the owner can tell apart"})
			continue
		}
		acc := c.add(p.Name, p.Phone, true)
		if p.Language != "" {
			a.store.Customer(p.Phone).Language = p.Language
		}
		a.addCredit(acc, p.AmountInr, "settings")
	}
}

// addCredit is one entry in an account: the open fee grows by the amount (a fee_charged for it in the books), or a new fee opens. It is refused when the account would show
// more than the most one account may show (the bound Guard holds a link to). E4 would be checked here (see the file's head). ok false: refused, and the record says why.
func (a *Agent) addCredit(acc *CreditAccount, amountInr int64, by string) (*Due, bool) {
	d := a.openCreditDue(acc)
	before := int64(0)
	if d != nil {
		before = balanceInr(d)
	}
	most := a.settings.Credit.MaxPerPersonInr
	if before+amountInr > most {
		a.creditLog(d, acc, "credit_add", "blocked", map[string]string{"amountPaise": itoa(amountInr * 100), "by": by},
			fmt.Sprintf("the account would show %s, more than the most one account may show (%s), so nothing was written", language.FormatInr(float64(before+amountInr)), language.FormatInr(float64(most))),
			block("credit-account-max", "An account never shows more than the most one account may show, because a payment link is never for more."))
		return d, false
	}
	now := a.now()
	if d == nil {
		t := zone.LocalParts(now, a.settings.Timezone)
		lang := a.languageOf(acc.Phone, nil)
		d = a.store.Register(&Due{StudentName: acc.Name, BatchID: CreditBatch, Customer: acc.Phone, Language: lang, Month: monthKey(t.Year, t.Month), DueDate: dateOf(t.Date), DueMs: now,
			FeeInr: amountInr, State: Open, Links: []LinkRecord{}, Payments: []CountedPayment{}, Reminders: []bookings.Reminder{}})
	} else {
		d.FeeInr += amountInr
	}
	who := "the owner wrote it"
	if by == "settings" {
		who = "from the settings, at setup"
	}
	a.post(moneyEvent("fee_charged", d.ID, amountInr*100), func(m map[string]string) {
		a.creditLog(d, acc, "credit_add", "confirmed", merge(map[string]string{"amountPaise": itoa(amountInr * 100), "by": by, "month": d.Month}, m),
			fmt.Sprintf("an entry in the credit book (%s): the account now shows %s", who, language.FormatInr(float64(balanceInr(d)))))
	})
	a.creditSchedule(d, acc)
	return d, true
}

// ---- the first question, and the customer's answer ----

// creditAsk is the owner's tap (or "ask Ramesh"): the one message that may go before the customer's yes, asking whether reminders on WhatsApp are fine.
func (a *Agent) creditAsk(acc *CreditAccount) {
	d := a.openCreditDue(acc)
	switch {
	case a.store.Customer(acc.Phone).OptedOut:
		a.creditOwner(d, acc, "owner_credit_stopped", sayOpts{})
		return
	case acc.Consent == ConsentYes:
		a.creditOwner(d, acc, "owner_credit_already_yes", sayOpts{})
		return
	case acc.Consent == ConsentAsked:
		a.creditOwner(d, acc, "owner_credit_already_asked", sayOpts{})
		return
	case d == nil || balancePaise(d) <= 0:
		a.creditOwner(d, acc, "owner_credit_nothing_owed", sayOpts{})
		return
	}
	acc.Consent, acc.AskedAtMs = ConsentAsked, N(a.now())
	if !a.tellCustomer(d, acc.Phone, []string{"credit_consent_ask"}, sayOpts{offer: &offer{buttons: []string{"yes", "no"}}}) {
		acc.Consent, acc.AskedAtMs = ConsentNone, nil
		a.creditLog(d, acc, "credit_consent", "failed", map[string]string{"step": "ask"}, "the first question could not be sent, so the account is not asked; the owner can tap Ask again")
		return
	}
	a.creditLog(d, acc, "credit_consent", "confirmed", map[string]string{"step": "ask"}, "at the owner's tap, the customer was asked whether reminders on WhatsApp are fine; none goes until they say yes")
	a.creditOwner(d, acc, "owner_credit_asked", sayOpts{})
}

// creditCustomer is a message from someone in the book. taken false: the ordinary Fees paths answer it (a customer who said yes asking to pay, saying they paid, STOP ...).
func (a *Agent) creditCustomer(phone string, in intent) (bool, error) {
	acc := a.creditAccountOf(phone)
	if acc == nil || acc.Consent == ConsentYes {
		return false, nil
	}
	d := a.openCreditDue(acc)
	if acc.Consent == ConsentAsked && in.Kind == "yes" {
		now := a.now()
		acc.Consent, acc.YesAtMs = ConsentYes, N(now)
		a.creditLog(d, acc, "credit_consent", "confirmed", map[string]string{"step": "yes"}, "the customer said yes to reminders on WhatsApp")
		a.tellCustomer(d, phone, []string{"credit_consent_yes"}, sayOpts{})
		a.creditOwner(d, acc, "owner_credit_yes", sayOpts{})
		if d != nil {
			a.creditSchedule(d, acc)
		}
		return true, nil
	}
	if acc.Consent == ConsentAsked && in.Kind == "no" {
		a.creditLog(d, acc, "credit_consent", "confirmed", map[string]string{"step": "no"}, "the customer said no to reminders on WhatsApp: read as STOP")
		return true, a.onStop(phone)
	}
	// not asked yet, or asked and answered with something else: nothing about the account goes to them before their yes; the owner is told, once an hour
	c := a.store.Customer(phone)
	now := a.now()
	if c.OwnerAskedAtMs == nil || now-*c.OwnerAskedAtMs >= hourly {
		if a.creditOwner(d, acc, "owner_credit_wrote", sayOpts{}) {
			c.OwnerAskedAtMs = N(now)
		}
	}
	a.creditLog(d, acc, "credit_consent", "blocked", map[string]string{"step": "wrote"}, "the customer wrote before saying yes to reminders: nothing about the account was sent to them; the owner was told")
	return true, nil
}

// creditGate is the say path's gate (agent_say.go Gates): to a customer in the book, nothing goes before their yes, except the first question, and that only once the owner has
// tapped (the account is "asked").
func (a *Agent) creditGate(sa *messaging.SayArgs) *Decision {
	if sa.To != "customer" {
		return nil
	}
	acc := a.creditAccountOf(sa.Phone)
	if acc == nil || acc.Consent == ConsentYes {
		return nil
	}
	if acc.Consent == ConsentAsked && len(sa.Templates) == 1 && sa.Templates[0] == "credit_consent_ask" {
		d := allow("credit-consent", "The owner tapped Ask: this is the first question, whether reminders on WhatsApp are fine.")
		return &d
	}
	d := block("credit-consent", "This customer has not said yes to messages from the credit book: only the first question goes, and only after the owner's tap.")
	return &d
}

// ---- reminders ----

// creditSchedule gives an open account with the customer's yes its next reminder, when it has none waiting: `remindEveryDays` after the later of the yes, the entry and the last
// reminder, at the shop's reminder hour.
func (a *Agent) creditSchedule(d *Due, acc *CreditAccount) {
	if acc == nil || acc.Consent != ConsentYes || acc.YesAtMs == nil || d.State != Open || balancePaise(d) <= 0 || a.store.Customer(acc.Phone).OptedOut {
		return
	}
	base := max(*acc.YesAtMs, d.DueMs)
	for _, r := range d.Reminders {
		if !r.Sent {
			return
		}
		base = max(base, r.AtMs)
	}
	s := a.settings
	day := zone.AddDays(zone.LocalParts(base, s.Timezone).Date, int(s.Credit.RemindEveryDays))
	d.Reminders = append(d.Reminders, bookings.Reminder{AtMs: zone.ZonedToMs(day, int(s.Reminders.Hour), 0, s.Timezone)})
}

// creditRemindedThisMonth is how many reminders went to the account in this calendar month (the cap's count for a running account).
func (a *Agent) creditRemindedThisMonth(acc *CreditAccount) int64 {
	t := zone.LocalParts(a.now(), a.settings.Timezone)
	if acc.RemindMonth != monthKey(t.Year, t.Month) {
		return 0
	}
	return acc.RemindCount
}

// creditReminded counts a reminder that went.
func (a *Agent) creditReminded(acc *CreditAccount) {
	t := zone.LocalParts(a.now(), a.settings.Timezone)
	if key := monthKey(t.Year, t.Month); acc.RemindMonth != key {
		acc.RemindMonth, acc.RemindCount = key, 0
	}
	acc.RemindCount++
}

// creditTick is the beat's part: the settings' people opened, and each open account with a yes given its next reminder (remind then sends it, as for any fee).
func (a *Agent) creditTick() {
	a.creditOpen()
	c := a.store.creditOf(false)
	for _, d := range a.store.Dues {
		if isCredit(d) && d.State == Open {
			a.creditSchedule(d, c.byPhone(d.Customer))
		}
	}
}

// ---- the owner's words ----

// creditOwner says one of the credit book's owner messages about an account (or about a name not in the book yet: name only).
func (a *Agent) creditOwner(d *Due, acc *CreditAccount, template string, o sayOpts) bool {
	phone := a.owner()
	if acc != nil {
		phone = acc.Phone
		o.creditName = acc.Name
	}
	return a.tellOwner(d, phone, template, o)
}

// creditOwnerText reads the owner's words for the credit book (WhatsApp, or the owner's page). taken false: they are not the credit book's, and another part of the shop (the
// shop's assistant, an approval) may read them. A message with a number in it is always taken: a customer's number is never handed to the assistant or a model.
func (a *Agent) creditOwnerText(text, replyID string) (bool, error) {
	c := a.book()
	if strings.HasPrefix(replyID, creditAskButton) {
		acc := c.byRef(strings.TrimPrefix(replyID, creditAskButton))
		if acc == nil {
			return false, nil
		}
		a.log(nil, a.owner(), "owner_credit", "confirmed", map[string]any{"kind": "ask", "via": "button"}, logMore{refs: map[string]string{"kind": "ask", "account": acc.Ref}, notes: "the owner tapped Ask"})
		a.creditAsk(acc)
		return true, nil
	}
	said := readCredit(text)
	help := func() (bool, error) {
		a.log(nil, a.owner(), "owner_credit", "blocked", map[string]any{"kind": said.kind}, logMore{refs: map[string]string{"kind": said.kind}, notes: "words for the credit book that could not be read whole: the owner was sent the credit book's help line (nothing was written)"})
		a.sayOwner("owner_credit_help", sayOpts{})
		return true, nil
	}
	noted := func(kind string, acc *CreditAccount) {
		refs := map[string]string{"kind": kind}
		if acc != nil {
			refs["account"] = acc.Ref
		}
		a.log(nil, a.owner(), "owner_credit", "confirmed", map[string]any{"kind": kind}, logMore{refs: refs, notes: "the owner's words for the credit book, read by the rules (the words themselves are not kept)"})
	}
	switch said.kind {
	case "list":
		noted("list", nil)
		a.creditList()
		return true, nil
	case "ask":
		acc := c.byName(said.name)
		if acc == nil {
			if said.hasPhone {
				return help()
			}
			return false, nil // "ask ..." about someone not in the book may be another part's words
		}
		noted("ask", acc)
		a.creditAsk(acc)
		return true, nil
	case "owes":
		if said.name == "" || !said.hasAmount || said.badAmount {
			return help()
		}
		acc := c.byName(said.name)
		if acc == nil && !said.hasPhone {
			c.Waiting = &CreditWaiting{Name: creditName(said.name), AmountInr: said.amountInr, AtMs: a.now()}
			noted("owes", nil)
			a.creditOwner(nil, nil, "owner_credit_need_number", sayOpts{creditName: creditName(said.name)})
			return true, nil
		}
		if acc == nil {
			var ok bool
			if acc, ok = a.creditNewAccount(said.name, said.phone); !ok {
				return true, nil
			}
		} else if said.hasPhone && said.phone != acc.Phone {
			a.sayOwner("owner_credit_number_taken", sayOpts{})
			return true, nil
		}
		noted("owes", acc)
		a.creditEntry(acc, said.amountInr)
		return true, nil
	case "paid":
		acc := c.byName(said.name)
		if acc == nil {
			if said.name == "" {
				return help()
			}
			noted("paid", nil)
			a.creditOwner(nil, nil, "owner_credit_unknown_person", sayOpts{creditName: creditName(said.name)})
			return true, nil
		}
		if !said.hasAmount || said.badAmount {
			return help()
		}
		noted("paid", acc)
		return true, a.creditPaid(acc, said.amountInr)
	case "number":
		w := c.Waiting
		if w == nil || a.now()-w.AtMs > waitingForNumberMs || (said.name != "" && nameKey(said.name) != nameKey(w.Name)) {
			return help()
		}
		acc, ok := a.creditNewAccount(w.Name, said.phone)
		if !ok {
			return true, nil
		}
		c.Waiting = nil
		noted("number", acc)
		a.creditEntry(acc, w.AmountInr)
		return true, nil
	case "unclear":
		return help()
	}
	if said.hasPhone {
		return help()
	}
	return false, nil
}

// creditNewAccount makes an account for a name and the number the owner gave, unless the number is the owner's own or another account's.
func (a *Agent) creditNewAccount(name, phone string) (*CreditAccount, bool) {
	c := a.book()
	if phone == a.owner() {
		a.creditOwner(nil, nil, "owner_credit_number_owner", sayOpts{creditName: creditName(name)})
		return nil, false
	}
	if c.byPhone(phone) != nil {
		a.sayOwner("owner_credit_number_taken", sayOpts{})
		return nil, false
	}
	acc := c.add(name, phone, false)
	a.creditLog(nil, acc, "credit_account", "confirmed", nil, "the owner gave this customer's number to the credit book; it stays in the shop")
	return acc, true
}

// creditEntry is "Ramesh owes 2,400": the entry, then the owner's read-back (with the Ask button while the customer has not been asked).
func (a *Agent) creditEntry(acc *CreditAccount, amountInr int64) {
	d, ok := a.addCredit(acc, amountInr, "owner")
	if !ok {
		a.creditOwner(d, acc, "owner_credit_too_much", sayOpts{feeInr: N(a.settings.Credit.MaxPerPersonInr)})
		return
	}
	if acc.Consent == ConsentNone && !a.store.Customer(acc.Phone).OptedOut {
		w := WordsFor(a.settings.Owner.Language)
		title := bookings.Clip(w.Labels["creditAsk"]+" "+acc.Name, bookings.WordsFor("en").Limits.ButtonTitle)
		a.creditOwner(d, acc, "owner_credit_added", sayOpts{offer: &offer{choices: []messaging.Choice{{ID: creditAskButton + acc.Ref, Title: title}}}})
		return
	}
	a.creditOwner(d, acc, "owner_credit_added_known", sayOpts{})
}

// creditPaid is "Ramesh paid 1,000": the owner's mark of money at the counter, recorded as marked paid by the owner (never a confirmed payment), on the account's open fee.
func (a *Agent) creditPaid(acc *CreditAccount, amountInr int64) error {
	d := a.openCreditDue(acc)
	if d == nil || balancePaise(d) <= 0 {
		a.creditOwner(d, acc, "owner_credit_nothing_owed", sayOpts{})
		return nil
	}
	if amountInr*100 > balancePaise(d) {
		a.creditOwner(d, acc, "owner_credit_paid_too_much", sayOpts{})
		return nil
	}
	if err := a.recordCash(d, amountInr*100, "cash", "words", nil); err != nil {
		return err
	}
	t := "owner_credit_paid"
	if d.State != Open {
		t = "owner_credit_cleared"
	}
	a.creditOwner(d, acc, t, sayOpts{receivedInr: N(amountInr)})
	return nil
}

// creditList is the owner's list of who owes what, largest first: on the owner's WhatsApp (or page) only, never a customer's.
func (a *Agent) creditList() {
	type row struct {
		name string
		inr  int64
	}
	var rows []row
	c := a.store.creditOf(false)
	if c != nil {
		for _, acc := range c.People {
			if d := a.openCreditDue(acc); d != nil && balancePaise(d) > 0 {
				rows = append(rows, row{acc.Name, balanceInr(d)})
			}
		}
	}
	if len(rows) == 0 {
		a.sayOwner("owner_credit_list_empty", sayOpts{})
		return
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].inr > rows[j].inr })
	parts := make([]string, len(rows))
	for i, r := range rows {
		parts[i] = r.name + " " + language.FormatInr(float64(r.inr))
	}
	a.sayOwner("owner_credit_list", sayOpts{roster: strings.Join(parts, ", ")})
}

// ---- the words: each Fees message a credit account reaches has its credit twin ----

// creditTwins are the Fees messages and their credit twins (credit/words.ts). A customer's twin needs nothing the fee does not have; an owner's twin names the account, so it is
// used only when the account is known.
var creditTwins = map[string]string{
	"fee_received": "credit_received", "fee_part_received": "credit_part_received", "fee_pay_link": "credit_pay_link", "fee_already_paid": "credit_already_paid",
	"fee_claim_partial": "credit_claim_partial", "fee_claim_not_found": "credit_claim_not_found", "fee_upi_claim": "credit_upi_claim", "fee_menu": "credit_menu",
	"fee_discount_to_owner": "credit_discount_to_owner", "fee_request_waiting": "credit_request_waiting", "fee_refund_asked": "credit_refund_asked",
	"fee_refund_too_much": "credit_refund_too_much", "fee_refund_none": "credit_refund_none", "fee_upi_qr_caption": "credit_upi_qr_caption",
	"fee_upi_refund_owed": "credit_upi_refund_owed", "fee_upi_refund_sent": "credit_upi_refund_sent", "fee_chat_public": "credit_chat_public", "fee_paused": "credit_paused",
	"fee_wait_over":       "credit_wait_over",
	"owner_payment_claim": "owner_credit_claim", "owner_fee_upi_claim": "owner_credit_upi_claim", "owner_fee_upi_expected": "owner_credit_upi_expected",
	"owner_fee_upi_marked": "owner_credit_upi_marked", "owner_fee_upi_part": "owner_credit_upi_part", "owner_link_failed": "owner_credit_link_failed",
	"owner_discount_note": "owner_credit_discount_note", "owner_refund_request": "owner_credit_refund_request", "owner_overpayment": "owner_credit_overpayment",
	"owner_opted_out": "owner_credit_opted_out", "owner_wants_to_talk": "owner_credit_wants_to_talk", "owner_request_stale": "owner_credit_request_stale",
	"owner_fee_upi_refund_owed": "owner_credit_upi_refund_owed", "owner_fee_upi_refund_reminder": "owner_credit_upi_refund_reminder",
	"owner_fee_upi_refund_marked": "owner_credit_upi_refund_marked",
}

// creditTwin is the template list with each Fees message replaced by its credit twin, for a credit book's message about this fee or this number.
func (a *Agent) creditTwin(d *Due, phone string, templates []string, o sayOpts) []string {
	if !a.credit() {
		return templates
	}
	named := isCredit(d) || o.creditName != "" || a.creditAccountOf(phone) != nil
	out := make([]string, len(templates))
	for i, t := range templates {
		out[i] = t
		if twin, ok := creditTwins[t]; ok && (!strings.HasPrefix(twin, "owner_") || named) {
			out[i] = twin
		}
	}
	return out
}

// creditName is the account's name a message about a number states, when the fee does not give it.
func (a *Agent) creditNameOf(phone string) string {
	if acc := a.creditAccountOf(phone); acc != nil {
		return acc.Name
	}
	return ""
}

// remindCredit is remind's last part for a credit account (agent_month.go remind has read the record and made the link): one reminder about the account, no family lines and no
// parent's page; counted against the calendar month's cap; the next one scheduled.
func (a *Agent) remindCredit(d *Due, now int64) error {
	bookings.TakeDue(d.Reminders, now)
	acc := a.creditAccountOf(d.Customer)
	if a.tellCustomer(d, d.Customer, []string{"credit_reminder"}, sayOpts{reminder: true, readOK: true, offer: feeButtons(d), image: a.qrOf(d)}) {
		d.RemindersSent++
		if acc != nil {
			a.creditReminded(acc)
		}
	}
	a.creditSchedule(d, acc)
	return nil
}

// ---- the owner's page ----

// creditRow is one account on the owner's page (channel.go Owner's `credit`): named by its ref and the name the owner gave, never by its number; askable when the owner's tap
// may send the first question now. The digest binds a press to the account as it was shown.
type creditRow struct {
	Ref         string `json:"ref"`
	Name        string `json:"name"`
	AmountPaise int64  `json:"amountPaise"`
	Consent     string `json:"consent"`
	Stopped     bool   `json:"stopped"`
	Askable     bool   `json:"askable"`
	Digest      string `json:"digest"`
}

// creditRows is the book as the owner's page shows it: every account with something owed, largest first, then the ones that owe nothing.
func creditRows(st *Store) []creditRow {
	c := st.creditOf(false)
	out := []creditRow{}
	if c == nil {
		return out
	}
	for _, acc := range c.People {
		var owed int64
		for _, d := range st.openDues(acc.Phone) {
			if isCredit(d) {
				owed += max(0, balancePaise(d))
			}
		}
		stopped := false
		if cu := st.FindCustomer(acc.Phone); cu != nil {
			stopped = cu.OptedOut
		}
		consent := acc.Consent
		if consent == "" {
			consent = "none"
		}
		out = append(out, creditRow{Ref: acc.Ref, Name: acc.Name, AmountPaise: owed, Consent: consent, Stopped: stopped, Askable: acc.Consent == ConsentNone && !stopped && owed > 0,
			Digest: digestOf("credit", acc.Ref, owed, acc.Consent, stopped)})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].AmountPaise > out[j].AmountPaise })
	return out
}
