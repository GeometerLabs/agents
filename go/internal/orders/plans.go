package orders

// What the agent does about monthly plans: the Go twin of templates/commerce/orders/src/plans/flow.ts createPlans, filling the agent's `plans` seam (agent_seams.go). The
// customer's words (subscribe, skip, pause, resume, cancel, "my plan"), the payment of each period, the meals going out, the renewal and the credits. The agent hands in what is
// its own (saying, the record, the payment link, the refund paths): here they are the agent's methods themselves (askPlanPayment, refundPlanCredit, planApplied, qrOf,
// reconcilePayments, cancelWaiting, log, tellCustomer, tellOwner), so plans add no other way to speak, to ask for money or to move it.
//
// A plan's period is paid like an order's advance: it is an Order record with `plan` set (no day, no items), so the payment link, the owner's UPI mark, a payment matched to it, a
// second payment refunded and a late one owed back are the agent's own paths. The meals are not orders: each is a day in the period's ledger (plans_state.go, the one source),
// counted against the slot's capacity through OrdersInSlot. A credit is settled once, as carried or refunded; a cancelled plan refunds what is unused. There is no automatic debit:
// a renewal is a payment link the customer pays, and one not paid before its first meal closes lapses without charge.
//
// The words are internal/orders/words' plan_* templates (generated from plans/templates.ts); the reading is internal/orders/reading ReadPlanIntent (generated from plans/words.ts).

import (
	"errors"
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/orders/reading"
	"github.com/GeometerLabs/agents/go/internal/orders/words"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

func init() { newPlans = func(a *Agent) Plans { return &plansFlow{a: a} } }

// errBadPlans: the saved `plans` block is not one this version can read; a step that went on would save the customers' plans as nothing (agent.go errBadLedger's twin).
var errBadPlans = errors.New("The shop's monthly plans (plans in the saved state) cannot be read by this version, so nothing about a plan is done until it is fixed or the TypeScript runtime runs the shop.")

// plansFlow is createPlans' return over one step's agent.
type plansFlow struct{ a *Agent }

var _ Plans = (*plansFlow)(nil)

func (pf *plansFlow) cfg() *PlansSettings { return pf.a.settings.Plans }
func (pf *plansFlow) tz() string          { return pf.a.settings.Timezone }

// state is flow.ts `state()`: `store.plans ??= { plans: {} }`.
func (pf *plansFlow) state() *PlansState { return pf.a.store.PlansState(true) }

func (pf *plansFlow) typeOf(p *Plan) *PlanType { return pf.a.settings.PlanTypeOf(p.TypeID) }

// weekdays of the plan's type (a type no longer in the settings has none; the TypeScript would throw on it).
func (pf *plansFlow) rulesOf(p *Plan) planRules {
	r := planRules{tz: pf.tz(), cutoff: pf.cfg().Cutoff, credits: pf.cfg().Credits}
	if t := pf.typeOf(p); t != nil {
		r.weekdays = t.Weekdays
	}
	return r
}

func (pf *plansFlow) orderOf(per *PlanPeriod) *Order { return pf.a.store.Order(per.OrderID) }

// at is flow.ts `at`: a clock time on a day, in the shop's zone.
func (pf *plansFlow) at(clock, key string) int64 {
	m := ParseClock(clock)
	return zone.ZonedToMs(DateOfKey(key), m/60, m%60, pf.tz())
}

// slotWindow is flow.ts slotWindow: the plan's slot on a day.
func (pf *plansFlow) slotWindow(p *Plan, key string) (fromMs, toMs int64) {
	found, ok := pf.a.settings.SlotOf(p.SlotID)
	if !ok {
		return 0, 0
	}
	return pf.at(found.Slot.From, key), pf.at(found.Slot.To, key)
}

// momentOf is flow.ts momentOf: midnight of a day in the shop's zone.
func (pf *plansFlow) momentOf(key string) int64 { return zone.ZonedToMs(DateOfKey(key), 0, 0, pf.tz()) }

func (pf *plansFlow) nameOf(p *Plan) string {
	if t := pf.typeOf(p); t != nil {
		return PlanName(t, p.Language)
	}
	return p.TypeID
}

// ---- the facts a plan message lays over the order's own -----------------------------------------------------------------------------------------------------------------

// planFacts is flow.ts facts' result: what is set replaces the order's own fact, as `{...factsFor(o), ...facts}` does. A member the TypeScript sets to `undefined` (the link of a
// period whose order has none, a cut-off that is not there) clears the order's fact; a member it leaves out (area and address of a pickup plan) keeps it.
type planFacts struct {
	itemsText, orderRef, mode string
	area, address             string
	period                    bool
	meals, fromMs, toMs       int64
	totalInr, advanceInr      int64
	setLink                   bool
	link                      string
	setDate                   bool
	dateMs                    *int64
	setCutoff                 bool
	cutoffMs                  *int64
}

func (pf *plansFlow) facts(p *Plan, per *PlanPeriod) *planFacts {
	f := &planFacts{itemsText: pf.nameOf(p), orderRef: p.ID, mode: p.Mode, area: p.Area, address: p.Address}
	if per != nil {
		f.period = true
		f.meals, f.fromMs, f.toMs = int64(len(per.Days)), pf.momentOf(per.From), pf.momentOf(per.To)
		f.totalInr, f.advanceInr = per.PriceInr, per.DueInr
		if per.OrderID != "" {
			f.setLink = true
			if o := pf.orderOf(per); o != nil {
				f.link = o.LinkURL
			}
		}
	}
	return f
}

// dayFacts is flow.ts dayFacts: the plan's name only, and the day.
func (pf *plansFlow) dayFacts(p *Plan, key string) *planFacts {
	f := pf.facts(p, nil)
	d := pf.momentOf(key)
	f.setDate, f.dateMs = true, &d
	return f
}

func (f *planFacts) cutoff(ms *int64) *planFacts { f.setCutoff, f.cutoffMs = true, ms; return f }
func (f *planFacts) date(ms int64) *planFacts    { f.setDate, f.dateMs = true, &ms; return f }

// apply lays the facts over the order's own (agent_say.go sayOpts.facts).
func (f *planFacts) apply(m *words.MessageFacts) {
	m.ItemsText, m.OrderRef, m.Mode = words.S(f.itemsText), words.S(f.orderRef), words.S(f.mode)
	if f.area != "" {
		m.Area = words.S(f.area)
	}
	if f.address != "" {
		m.Address = words.S(f.address)
	}
	if f.period {
		m.Plan = &words.PlanFacts{Meals: words.N(f.meals), FromMs: words.N(f.fromMs), ToMs: words.N(f.toMs)}
		m.TotalInr, m.AdvanceInr = words.N(f.totalInr), words.N(f.advanceInr)
	}
	if f.setLink {
		m.Link = nil
		if f.link != "" {
			m.Link = words.S(f.link)
		}
	}
	if f.setDate {
		m.DateMs = f.dateMs
	}
	if f.setCutoff {
		m.CutoffMs = f.cutoffMs
	}
}

// itemsOnly is `{ facts: { itemsText } }`: a line about a plan before it has a period (plan_choose, ask_address, plan_full).
func itemsOnly(text string) func(*words.MessageFacts) {
	return func(m *words.MessageFacts) { m.ItemsText = words.S(text) }
}

// say is flow.ts `say`: one line to the plan's customer from a template, with the plan facts.
func (pf *plansFlow) say(p *Plan, template string, f *planFacts, o *Order) {
	pf.a.tellCustomer(o, p.Customer, []string{template}, sayOpts{facts: f.apply})
}

// logPlan is flow.ts logPlan: a record line about the plan (refs.plan its id).
func (pf *plansFlow) logPlan(p *Plan, action, outcome string, in any, more logMore) {
	more.refs = mergeRefs(map[string]string{"plan": p.ID}, more.refs)
	pf.a.log(nil, p.Customer, action, outcome, in, more)
}

// qr is the agent's `qr` for a plan: a UPI shop's QR picture of the period's request (never for a page's order).
func (pf *plansFlow) qr(o *Order) *messaging.SayImage {
	a := pf.a
	if !a.ownerConfirms || o.Channel != "" {
		return nil
	}
	if r := a.requestOf(o); r != nil {
		return a.qrOf(r)
	}
	return nil
}

// AwaitingOrderOf is flow.ts awaitingOrderOf: the order waiting for a plan period's payment, for a customer who says they paid (latestOrder leaves plan orders out).
func (pf *plansFlow) AwaitingOrderOf(phone string) *Order {
	all := pf.a.store.PlansState(false).All()
	for i := len(all) - 1; i >= 0; i-- {
		p := all[i]
		if p.Customer != phone {
			continue
		}
		for j := len(p.Periods) - 1; j >= 0; j-- {
			if p.Periods[j].State == periodAwaiting {
				if o := pf.orderOf(p.Periods[j]); o != nil && o.State == AwaitingAdvance {
					return o
				}
			}
		}
	}
	return nil
}

// ---- a new plan ---------------------------------------------------------------------------------------------------------------------------------------------------------

func (pf *plansFlow) subscribe(phone, lang, typeID string) error {
	a := pf.a
	if !a.takesNewWork() {
		a.log(nil, phone, "new_work", "blocked", map[string]any{"asked": "plan"}, logMore{notes: "online ordering is paused, so no plan is started"})
		a.tellCustomer(nil, phone, []string{"orders_paused"}, sayOpts{})
		return nil
	}
	if existing := pf.state().planOfCustomer(phone); existing != nil {
		pf.myPlan(existing)
		return nil
	}
	cfg := pf.cfg()
	var t *PlanType
	if typeID != "" {
		t = a.settings.PlanTypeOf(typeID)
	} else if len(cfg.Types) == 1 {
		t = &cfg.Types[0]
	}
	if t == nil {
		a.tellCustomer(nil, phone, []string{"plan_choose"}, sayOpts{facts: itemsOnly(pf.plansLine(lang))})
		return nil
	}
	slot, ok := a.settings.SlotOf(t.SlotID)
	if !ok {
		return nil // the settings check refuses a plan whose slot is not the shop's; the TypeScript would throw (`!`)
	}
	now := a.now()
	p := &Plan{Customer: phone, Language: lang, TypeID: t.ID, SlotID: t.SlotID, Mode: slot.Mode, State: planAwaitingAddress, Periods: []*PlanPeriod{}, Pauses: []PlanPause{},
		Balance: []BalancePiece{}, AskedAtMs: &now}
	if slot.Mode == Delivery {
		pf.state().Set("pending:"+phone, p)
		a.tellCustomer(nil, phone, []string{"ask_address"}, sayOpts{areas: true, facts: itemsOnly(PlanName(t, lang))})
		return nil
	}
	return pf.begin(p)
}

// plansLine is plans/words.ts plansLine: "Lunch plan ₹2,400, Dinner plan ₹2,800" (formatInr of whole rupees).
func (pf *plansFlow) plansLine(lang string) string {
	out := ""
	for i := range pf.cfg().Types {
		t := &pf.cfg().Types[i]
		if i > 0 {
			out += ", "
		}
		out += PlanName(t, lang) + " " + inr(t.PriceInr)
	}
	return out
}

// onAddress is flow.ts onAddress: the customer's next plain message to a delivery plan is its address, checked against the delivery list like an order's.
func (pf *plansFlow) onAddress(p *Plan, text string) error {
	a := pf.a
	address := cleanAddress(text)
	var area []string
	if a.settings.Delivery != nil {
		area = a.settings.Delivery.Area
	}
	d := checkDeliveryArea(address, area)
	if blocked(d) {
		a.log(nil, p.Customer, "check_address", "blocked", map[string]any{"area": nil}, logMore{decisions: []Decision{d}, notes: "the address names no place on the delivery list; it is not kept"})
		a.tellCustomer(nil, p.Customer, []string{"outside_area"}, sayOpts{areas: true})
		return nil
	}
	p.Area, p.Address = areaOf(address, area), address
	a.log(nil, p.Customer, "check_address", "confirmed", map[string]any{"area": p.Area}, logMore{decisions: []Decision{d}, notes: "the address names a place on the delivery list"})
	pf.state().Delete("pending:" + p.Customer)
	return pf.begin(p)
}

// firstOpenDay is the first meal day whose cut-off is still ahead (flow.ts begin and dayOf: at most 14 tries).
func (pf *plansFlow) firstOpenDay(r planRules, now int64) zone.Date {
	start := firstMealOnOrAfter(zone.LocalParts(now, pf.tz()).Date, r.weekdays)
	for i := 0; i < 14 && now >= cutoffMsFor(r, keyOfZ(start)); i++ {
		start = firstMealOnOrAfter(zone.AddDays(start, 1), r.weekdays)
	}
	return start
}

// begin is flow.ts begin: the first period (the first meal day whose cut-off is ahead), every meal day of the month fitting the slot, then the payment link. Nothing is made if
// the slot is full.
func (pf *plansFlow) begin(p *Plan) error {
	a := pf.a
	now := a.now()
	r := pf.rulesOf(p)
	start := pf.firstOpenDay(r, now)
	p.StartKey = keyOfZ(start)
	from, to, days := p.newDays(r.weekdays, start, 0)
	found, _ := a.settings.SlotOf(p.SlotID)
	if found.Slot != nil && found.Slot.MaxOrders != nil {
		limit := int(*found.Slot.MaxOrders)
		for _, k := range sortedKeys(days) { // `Object.keys(made.days).some(...)`
			if a.store.OrdersInSlot(DateOf(DateOfKey(k)), p.SlotID, now, "") >= limit {
				a.log(nil, p.Customer, "plan_start", "blocked", map[string]any{"type": p.TypeID}, logMore{decisions: []Decision{block("within-day-cap", "a day of the plan's first month has no place left in the slot (the slot's own most orders, plan meals counted)")}})
				a.tellCustomer(nil, p.Customer, []string{"plan_full"}, sayOpts{facts: itemsOnly(pf.nameOf(p))})
				return nil
			}
		}
	}
	t := pf.typeOf(p)
	o := a.store.Register(NewDraft(p.Customer, p.Language))
	p.ID = "p-" + o.ID[2:]
	hold := now + a.settings.Advance.HoldMinutes*60_000
	per := &PlanPeriod{Index: 0, From: from, To: to, PriceInr: t.PriceInr, DueInr: t.PriceInr, Taken: []BalancePiece{}, OrderID: o.ID, Days: days, State: periodAwaiting, HoldUntilMs: &hold}
	p.Periods = append(p.Periods, per)
	pf.state().Set(p.ID, p)
	pf.attach(o, p, per)
	p.State = planActive // nothing is owed or delivered until the first payment is recorded: the period holds its places only while its hold runs
	a.log(o, p.Customer, "plan_start", "confirmed", map[string]any{"type": p.TypeID, "from": per.From, "to": per.To, "meals": len(per.Days)},
		logMore{refs: map[string]string{"plan": p.ID, "period": "0"}, notes: "the plan's first month is held; it starts when the payment record shows the payment"})
	asked, err := a.askPlanPayment(o)
	if err != nil {
		return err
	}
	if asked != "ok" {
		p.State, per.State = planCancelled, periodLapsed
		if err := o.MoveTo(Cancelled); err != nil {
			return err
		}
		if asked == "failed" {
			a.tellCustomer(o, p.Customer, []string{"link_failed"}, sayOpts{})
		}
		return nil
	}
	buttons := []string{"owner"}
	if a.ownerConfirms {
		buttons = []string{"paid", "owner"}
	}
	f := pf.facts(p, per)
	a.tellCustomer(o, p.Customer, []string{"plan_quote"}, sayOpts{facts: f.apply, offer: &offer{kind: "buttons", buttons: buttons, body: []string{"plan_quote"}}, image: pf.qr(o)})
	return nil
}

// sortedKeys are a day map's keys in order.
func sortedKeys(days map[string]string) []string {
	keys := make([]string, 0, len(days))
	for k := range days {
		keys = append(keys, k)
	}
	sortStrings(keys)
	return keys
}

// attach is flow.ts attach: the period's order, the record its payment is matched to. No day, no items, so it is never one of the shop's orders in a slot. The state is set as
// it is (`o.state = "awaiting_advance"`), not moved.
func (pf *plansFlow) attach(o *Order, p *Plan, per *PlanPeriod) {
	o.Plan = &OrderPlan{ID: p.ID, Period: per.Index, TypeID: p.TypeID}
	o.State = AwaitingAdvance
	due := per.DueInr
	o.TotalInr, o.AdvanceInr = &due, &due
	o.Mode = p.Mode
	if p.Area != "" {
		o.Area = p.Area
	}
	if keys := per.sortedDays(); len(keys) > 0 {
		from, to := pf.slotWindow(p, keys[0])
		o.SlotStartMs, o.SlotEndMs = &from, &to
	}
}

// ---- a period's payment is recorded ---------------------------------------------------------------------------------------------------------------------------------------

// OnPaid is flow.ts onPaid: the period is paid, the plan stands, the customer (and for a first period, the owner) is told.
func (pf *plansFlow) OnPaid(o *Order) error {
	a := pf.a
	if a.store.PlansUnreadable() {
		return errBadPlans
	}
	p := pf.state().Get(o.Plan.ID)
	var per *PlanPeriod
	if p != nil && o.Plan.Period >= 0 && o.Plan.Period < int64(len(p.Periods)) {
		per = p.Periods[o.Plan.Period]
	}
	if p == nil || per == nil || per.State != periodAwaiting || p.State != planActive {
		a.log(o, o.Customer, "plan_paid", "blocked", map[string]any{"plan": o.Plan}, logMore{notes: "the plan or the period does not stand any more, so the payment is not counted as meals"})
		return nil
	}
	now := a.now()
	per.State, per.PaidAtMs, per.HoldUntilMs, per.Reminders = periodPaid, &now, nil, nil
	o.HoldExpiresAt = nil
	if err := o.MoveTo(Confirmed); err != nil {
		return err
	}
	if err := o.MoveTo(Completed); err != nil { // meals are not this record's business: the ledger carries them
		return err
	}
	var taken int64
	for _, piece := range per.Taken { // credit used: the earlier payment it came from is earned now
		if origin := a.store.Order(piece.OrderID); origin != nil {
			a.planApplied(origin, piece.AmountInr)
		}
		taken += piece.AmountInr
	}
	a.log(o, o.Customer, "plan_paid", "confirmed", map[string]any{"period": per.Index, "amountInr": per.DueInr, "creditTakenInr": taken},
		logMore{refs: map[string]string{"plan": p.ID, "period": i64(per.Index), "amountPaise": i64(per.DueInr * 100)}, notes: "the payment record shows this period's payment: its meals are owed"})
	first := per.From
	if keys := per.sortedDays(); len(keys) > 0 {
		first = keys[0]
	}
	cut := cutoffMsFor(pf.rulesOf(p), first)
	a.tellCustomer(o, o.Customer, []string{"plan_active"}, sayOpts{facts: pf.facts(p, per).cutoff(&cut).apply})
	if per.Index == 0 {
		a.tellOwner(o, o.Customer, "owner_plan_started", sayOpts{facts: pf.facts(p, per).apply})
	}
	return nil
}

// ---- what the customer writes ---------------------------------------------------------------------------------------------------------------------------------------------

// notAddress is flow.ts's `/^\s*(stop|cancel|no)\s*$/iu` (JavaScript's \s, ASCII case folding of these words).
var notAddress = regexp.MustCompile(`(?i)^[` + language.JSSpace + `]*(stop|cancel|no)[` + language.JSSpace + `]*$`)

// OnMessage is flow.ts onMessage: true when the message was about a plan and has been answered.
func (pf *plansFlow) OnMessage(phone, text, lang string) (bool, error) {
	a := pf.a
	if a.store.PlansUnreadable() {
		return false, errBadPlans
	}
	cfg := pf.cfg()
	pending := pf.state().Get("pending:" + phone)
	p := a.store.PlansState(false).planOfCustomer(phone)
	types := make([]reading.PlanType, len(cfg.Types))
	for i, t := range cfg.Types {
		types[i] = reading.PlanType{ID: t.ID, Names: t.Names}
	}
	intent := reading.ReadPlanIntent(text, p != nil, types, a.settings.Languages)
	if pending != nil && intent == nil {
		if notAddress.MatchString(text) {
			pf.state().Delete("pending:" + phone)
			return false, nil
		}
		return true, pf.onAddress(pending, text)
	}
	if intent == nil {
		return false, nil
	}
	a.log(nil, phone, "receive_message", "confirmed", map[string]any{"plan": intent.Kind}, logMore{notes: "a message about the customer's monthly plan, read from plain words (no model)"})
	switch intent.Kind {
	case "subscribe":
		return true, pf.subscribe(phone, lang, intent.TypeID)
	case "my_plan":
		if p != nil {
			pf.myPlan(p)
		} else {
			a.tellCustomer(nil, phone, []string{"plan_none"}, sayOpts{})
		}
		return true, nil
	case "cancel_plan":
		if p != nil {
			return true, pf.cancel(p)
		}
		pf.state().Delete("pending:" + phone)
		a.tellCustomer(nil, phone, []string{"plan_none"}, sayOpts{})
		return true, nil
	}
	if p == nil {
		a.tellCustomer(nil, phone, []string{"plan_none"}, sayOpts{})
		return true, nil
	}
	pf.change(p, intent)
	return true, nil
}

// dayOf is flow.ts dayOf: the day a customer means, or the earliest that can still be changed when they name none; "" for a date that does not exist.
func (pf *plansFlow) dayOf(p *Plan, phrase map[string]any) string {
	if dp := datePhraseOf(phrase); dp != nil {
		d, _, ok := pf.a.resolveDate(*dp)
		if !ok {
			return ""
		}
		return keyOfZ(d)
	}
	return keyOfZ(pf.firstOpenDay(pf.rulesOf(p), pf.a.now()))
}

// change is flow.ts change: a skip, a pause or a resume, written in the ledger or refused.
func (pf *plansFlow) change(p *Plan, intent *reading.PlanIntent) {
	key := pf.dayOf(p, intent.Date)
	if key == "" {
		pf.say(p, "plan_no_meal", pf.facts(p, nil), nil)
		return
	}
	r := pf.rulesOf(p)
	now := pf.a.now()
	var res asked
	switch intent.Kind {
	case "skip":
		res = p.skipDay(key, r, now)
	case "pause":
		res = p.pauseFrom(key, r, now)
	default:
		res = p.resumeFrom(key, r, now)
	}
	action := "plan_" + intent.Kind
	if !res.ok {
		pf.logPlan(p, action, "blocked", map[string]any{"day": key}, logMore{decisions: []Decision{res.decision}, refs: map[string]string{"day": key}})
		if res.why == "after_cutoff" {
			pf.say(p, "plan_cutoff_refused", pf.dayFacts(p, key).cutoff(res.cutoffMs), nil)
		} else {
			pf.say(p, "plan_no_meal", pf.dayFacts(p, key), nil)
		}
		return
	}
	pf.logPlan(p, action, "confirmed", map[string]any{"day": key, "days": res.days}, logMore{decisions: []Decision{res.decision}, refs: map[string]string{"day": key, "days": i64(res.days)},
		notes: "the days are recorded in the entitlement ledger; they become credit when the period is settled, once"})
	done := map[string]string{"skip": "plan_skip_done", "pause": "plan_pause_done", "resume": "plan_resume_done"}[intent.Kind]
	pf.say(p, done, pf.dayFacts(p, key), nil)
}

// myPlan is flow.ts myPlan: a period still waiting for payment gets its link again; otherwise the current period.
func (pf *plansFlow) myPlan(p *Plan) {
	a := pf.a
	if len(p.Periods) == 0 {
		a.tellCustomer(nil, p.Customer, []string{"plan_choose"}, sayOpts{facts: itemsOnly(pf.nameOf(p))})
		return
	}
	last := p.Periods[len(p.Periods)-1]
	if o := pf.orderOf(last); last.State == periodAwaiting && o != nil && o.State == AwaitingAdvance {
		t := "plan_renewal"
		if last.Index == 0 {
			t = "plan_quote"
		}
		a.tellCustomer(o, p.Customer, []string{t}, sayOpts{facts: pf.facts(p, last).date(pf.momentOf(last.From)).cutoff(last.PayByMs).apply})
		return
	}
	now := a.now()
	var current *PlanPeriod
	for _, per := range p.Periods {
		if per.State == periodPaid && now < pf.momentOf(per.To)+24*Hour {
			current = per
			break
		}
	}
	if current == nil {
		for _, per := range p.Periods {
			if per.State == periodPaid {
				current = per
			}
		}
	}
	if current == nil {
		current = last
	}
	first := current.From
	if keys := current.sortedDays(); len(keys) > 0 {
		first = keys[0]
	}
	cut := cutoffMsFor(pf.rulesOf(p), first)
	a.tellCustomer(nil, p.Customer, []string{"plan_active"}, sayOpts{facts: pf.facts(p, current).cutoff(&cut).apply})
}

// ---- cancelling -----------------------------------------------------------------------------------------------------------------------------------------------------------

// cancel is flow.ts cancel: nothing is sent or charged for a day whose cut-off is still ahead, a renewal waiting for its payment is given up (and the credit it was to take
// comes back), and what is unused is refunded through the agent's refund path. Never both for one day.
func (pf *plansFlow) cancel(p *Plan) error {
	a := pf.a
	now := a.now()
	for _, per := range p.Periods {
		if per.State != periodAwaiting {
			continue
		}
		o := pf.orderOf(per)
		if o != nil {
			if _, err := a.reconcilePayments(o); err != nil { // a payment that landed just before the cancel is counted, then refunded below
				return err
			}
		}
		if per.State != periodAwaiting {
			continue
		}
		per.State, per.Reminders = periodLapsed, nil // a reminder still queued for it never goes out
		p.returnBalance(per.Taken)
		if o != nil && o.State == AwaitingAdvance {
			if err := a.cancelWaiting(o, "the customer cancelled the plan before paying this period"); err != nil {
				return err
			}
		}
	}
	days, d := p.cancelPlan(pf.rulesOf(p), now)
	pf.logPlan(p, "plan_cancel", "confirmed", map[string]any{"days": days}, logMore{decisions: []Decision{d}, refs: map[string]string{"days": i64(days)},
		notes: "no meal is sent or charged for the days after the cancellation; what is unused is refunded below"})
	var last *PlanPeriod
	for _, per := range p.Periods {
		if per.State == periodPaid {
			last = per
		}
	}
	if last != nil && last.Settlement == nil {
		if err := pf.closeAndRefund(p, last); err != nil {
			return err
		}
	}
	if err := pf.refundBalance(p, "because the plan was cancelled"); err != nil {
		return err
	}
	pf.state().Delete("pending:" + p.Customer)
	pf.say(p, "plan_cancelled", pf.facts(p, nil), nil)
	a.tellOwner(nil, p.Customer, "owner_plan_cancelled", sayOpts{facts: pf.facts(p, nil).apply})
	return nil
}

// refundBalance is flow.ts refundBalance: credit carried and not used goes back to the payment it came from.
func (pf *plansFlow) refundBalance(p *Plan, why string) error {
	pieces := p.Balance
	p.Balance = []BalancePiece{} // `plan.balance.splice(0)`
	for _, piece := range pieces {
		if origin := pf.a.store.Order(piece.OrderID); origin != nil {
			if _, err := pf.a.refundPlanCredit(origin, piece.AmountInr, "credit carried from an earlier month, unused "+why); err != nil {
				return err
			}
		}
	}
	return nil
}

// closeAndRefund is flow.ts closeAndRefund: a paid period's days not taken, counted once and acted on; then the period's earned money is applied.
func (pf *plansFlow) closeAndRefund(p *Plan, per *PlanPeriod) error {
	a := pf.a
	d, amount, kind := p.settle(per, pf.rulesOf(p), a.now())
	var days int64
	if per.Settlement != nil {
		days = per.Settlement.Days
	}
	notes := "no day was left untaken"
	switch kind {
	case "carried":
		notes = "the days not taken are carried: they come off a later payment"
	case "refunded":
		notes = "the days not taken are refunded"
	}
	in := map[string]any{"period": per.Index, "amountInr": amount, "kind": kind}
	if per.Settlement != nil {
		in["days"] = per.Settlement.Days
	}
	pf.logPlan(p, "plan_credit", "confirmed", in, logMore{decisions: []Decision{d}, refs: map[string]string{"period": i64(per.Index), "kind": kind, "days": i64(days), "amountPaise": i64(amount * 100)}, notes: notes})
	o := pf.orderOf(per)
	if o != nil {
		applied := per.DueInr
		if kind != "none" {
			applied -= amount
		}
		a.planApplied(o, applied)
	}
	if kind == "refunded" && o != nil {
		if _, err := a.refundPlanCredit(o, amount, "days of a plan not taken, refunded by the shop's rule or because the plan ended"); err != nil {
			return err
		}
	}
	return nil
}

// ---- time passing ---------------------------------------------------------------------------------------------------------------------------------------------------------

// OnTick is flow.ts onTick: meals whose slot ended are delivered, a period whose credit is final is settled and the next asked for, an unpaid renewal is reminded and lapses,
// a hold ends.
func (pf *plansFlow) OnTick() error {
	a := pf.a
	if a.store.PlansUnreadable() {
		return errBadPlans
	}
	now := a.now()
	ps := pf.state()
	for _, id := range ps.IDs() {
		if p := ps.Get(id); strings.HasPrefix(id, "pending:") && p.AskedAtMs != nil && now-*p.AskedAtMs > a.settings.Advance.HoldMinutes*60_000 {
			ps.Delete(id)
		}
	}
	for _, p := range ps.All() {
		if p.State == planAwaitingAddress {
			continue
		}
		for _, key := range p.deliverDue(func(k string) int64 { _, to := pf.slotWindow(p, k); return to }, now) {
			pf.logPlan(p, "deliver_meal", "confirmed", map[string]any{"day": key}, logMore{refs: map[string]string{"day": key},
				notes: "the meal day's slot ended and the plan stood, so the meal is counted as delivered once (what was handed over is the shop's to say)"})
		}
		for _, per := range append([]*PlanPeriod(nil), p.Periods...) {
			if per.State == periodAwaiting {
				if err := pf.watch(p, per, now); err != nil {
					return err
				}
			}
		}
		if p.State == planActive && p.renewalDue(pf.rulesOf(p), now) && a.takesNewWork() {
			if err := pf.renew(p); err != nil {
				return err
			}
		}
	}
	return nil
}

// watch is flow.ts watch: a period waiting for its payment: the one reminder when it is due, and given up when its time is out. Since 23 Nov 2026 (both runtimes) a period
// whose payment order already ended outside the plan (the owner cancelled it from the chat) is given up the same way at once, saying nothing more to the customer (that cancel
// told them) but still giving a renewal's carried credit back; it used to stay awaiting_payment for ever.
func (pf *plansFlow) watch(p *Plan, per *PlanPeriod, now int64) error {
	a := pf.a
	o := pf.orderOf(per)
	if o == nil {
		return nil
	}
	ended := o.State == Cancelled || o.State == Expired
	if o.State != AwaitingAdvance && !ended {
		return nil
	}
	if !ended {
		var out bool
		if per.Index == 0 {
			out = per.HoldUntilMs == nil || *per.HoldUntilMs <= now
		} else {
			out = per.PayByMs != nil && *per.PayByMs <= now
		}
		// takeDue runs only when the period is not out and the plan stands (the TypeScript's && short-circuits)
		if per.Reminders != nil && !out && p.State == planActive && takeDue(*per.Reminders, now) {
			a.tellCustomer(o, p.Customer, []string{"plan_renewal"}, sayOpts{facts: pf.facts(p, per).date(pf.momentOf(per.From)).cutoff(per.PayByMs).apply})
		}
		if !out {
			return nil
		}
		if _, err := a.reconcilePayments(o); err != nil {
			return err
		}
		if per.State != periodAwaiting || o.State != AwaitingAdvance {
			return nil
		}
	}
	per.State, per.Reminders = periodLapsed, nil
	p.returnBalance(per.Taken)
	if !ended {
		why := "the renewal was not paid before its first meal closed"
		if per.Index == 0 {
			why = "the hold on the plan's first payment ran out"
		}
		if err := a.cancelWaiting(o, why); err != nil {
			return err
		}
	}
	if per.Index == 0 {
		p.State = planCancelled
		if !ended {
			a.tellCustomer(o, p.Customer, []string{"plan_hold_expired"}, sayOpts{facts: pf.facts(p, nil).apply})
		}
	} else {
		p.State = planLapsed
		if !ended {
			a.tellCustomer(o, p.Customer, []string{"plan_lapsed"}, sayOpts{facts: pf.facts(p, nil).apply})
		}
		if err := pf.refundBalance(p, "because the renewal lapsed"); err != nil {
			return err
		}
	}
	notes := "the payment did not come in time: no meal is owed and nothing is charged for this period"
	if ended {
		notes = "the period's payment was cancelled before it came: no meal is owed and nothing is charged for this period"
	}
	pf.logPlan(p, "plan_lapse", "confirmed", map[string]any{"period": per.Index}, logMore{refs: map[string]string{"period": i64(per.Index)}, notes: notes})
	return nil
}

// reminderFor is flow.ts reminderFor: one reminder half way between now and the pay-by time (Math.floor of a whole number of milliseconds halved); none under six hours.
func (pf *plansFlow) reminderFor(payBy int64) *[]reminder {
	now := pf.a.now()
	rs := []reminder{}
	if payBy-now >= 6*Hour {
		rs = append(rs, reminder{AtMs: now + floorDiv(payBy-now, 2)})
	}
	return &rs
}

func floorDiv(a, b int64) int64 {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

// renew is flow.ts renew: the last period's credit is final; settle it once, take what is carried off the next payment, and ask for that payment: a link, never a debit.
func (pf *plansFlow) renew(p *Plan) error {
	a := pf.a
	last := p.Periods[len(p.Periods)-1]
	next := last.Index + 1
	once := p.checkOneRenewal(next)
	if blocked(once) {
		pf.logPlan(p, "plan_renew", "blocked", map[string]any{"period": next}, logMore{decisions: []Decision{once}})
		return nil
	}
	if last.Settlement == nil {
		if err := pf.closeAndRefund(p, last); err != nil {
			return err
		}
	}
	t := pf.typeOf(p)
	if t == nil {
		return nil // a plan type no longer in the settings: the TypeScript would throw (`planTypeOf(...)!`)
	}
	r := pf.rulesOf(p)
	from, to, days := p.newDays(r.weekdays, DateOfKey(p.StartKey), int(next))
	taken := []BalancePiece{}
	if pf.cfg().Credits == "carry" {
		taken = p.takeBalance(t.PriceInr)
	}
	var takenInr int64
	for _, x := range taken {
		takenInr += x.AmountInr
	}
	keys := sortedKeys(days)
	firstDay := ""
	if len(keys) > 0 {
		firstDay = keys[0]
	}
	payBy := cutoffMsFor(r, firstDay)
	o := a.store.Register(NewDraft(p.Customer, p.Language))
	per := &PlanPeriod{Index: next, From: from, To: to, PriceInr: t.PriceInr, DueInr: t.PriceInr - takenInr, Taken: taken, OrderID: o.ID, Days: days, State: periodAwaiting, PayByMs: &payBy,
		Reminders: pf.reminderFor(payBy)}
	p.Periods = append(p.Periods, per)
	pf.attach(o, p, per)
	pf.logPlan(p, "plan_renew", "confirmed", map[string]any{"period": next, "dueInr": per.DueInr, "creditTakenInr": takenInr}, logMore{decisions: []Decision{once}, refs: map[string]string{"period": i64(next)},
		notes: "the next period is asked for with a payment link; nothing is charged by itself"})
	if per.DueInr == 0 {
		return pf.OnPaid(o)
	}
	asked, err := a.askPlanPayment(o)
	if err != nil {
		return err
	}
	if asked != "ok" {
		per.State = periodLapsed
		p.returnBalance(taken)
		return o.MoveTo(Cancelled)
	}
	a.tellCustomer(o, p.Customer, []string{"plan_renewal"}, sayOpts{facts: pf.facts(p, per).date(pf.momentOf(per.From)).cutoff(&payBy).apply, image: pf.qr(o)})
	return nil
}
