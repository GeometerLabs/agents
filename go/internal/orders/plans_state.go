package orders

// The monthly plans' state as the store keeps it (templates/commerce/orders/src/plans/ledger.ts Plan, PlanPeriod, PlansState) and its pure reads and changes (ledger.ts and
// periods.ts): the ONE source for what a customer is owed. The kitchen's count, a slot's capacity, the credits and the morning line read it; nothing keeps a number beside it.
//
// The block is typed once per store (Store.PlansState, as the owner-marked ledger is) and written back in Members, so a step's changes and a slot's count read the same object.
// SAME BYTES: a JavaScript object keeps the order its members were first set in, so each struct lists its members in the order flow.ts first sets them (subscribe's literal, then
// area, address and cancelledAtMs; a period's literal, then paidAtMs and settlement); a member the TypeScript sets to `undefined` is left out, and an empty list stays `[]`
// (a renewal's `reminders: []` is written, so nil and empty differ). The plans are an ordered list of [id, plan] (a JavaScript object's insertion order: "p-10" after "p-7", the
// `pending:<phone>` entries among them), and any member a later version adds is carried through raw, after the known ones. Proved on stores the TypeScript agent wrote
// (testdata/store-vectors.json.gz, order_test.go: the plans shop read and written back is the same bytes).

import (
	"bytes"
	"encoding/json"
	"strconv"

	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// Day states (ledger.ts DayState) and period states (PeriodState).
const (
	dayDue       = "due"
	daySkipped   = "skipped"
	dayPaused    = "paused"
	dayDelivered = "delivered"
	dayCancelled = "cancelled"

	periodAwaiting = "awaiting_payment"
	periodPaid     = "paid"
	periodLapsed   = "lapsed"

	planAwaitingAddress = "awaiting_address"
	planActive          = "active"
	planCancelled       = "cancelled"
	planLapsed          = "lapsed"
)

// BalancePiece is ledger.ts BalancePiece: credit carried from a period's payment (orderId is the order that was paid, so the money can go back to it).
type BalancePiece struct {
	OrderID   string `json:"orderId"`
	AmountInr int64  `json:"amountInr"`
}

// Settlement is a period's settlement: its days not taken, counted once.
type Settlement struct {
	Kind      string `json:"kind"` // "carried", "refunded" or "none"
	AmountInr int64  `json:"amountInr"`
	Days      int64  `json:"days"`
	AtMs      int64  `json:"atMs"`
}

// PlanPeriod is ledger.ts PlanPeriod. Days are the period's meal days by key ("2026-11-16"); Go writes a map's keys sorted, which is the order flow.ts makes them in (newDays walks
// the dates in order and nothing adds a day later), so the bytes are the same.
type PlanPeriod struct {
	Index       int64             `json:"index"`
	From        string            `json:"from"`
	To          string            `json:"to"`
	PriceInr    int64             `json:"priceInr"`
	DueInr      int64             `json:"dueInr"`
	Taken       []BalancePiece    `json:"taken"`
	OrderID     string            `json:"orderId"`
	Days        map[string]string `json:"days"`
	State       string            `json:"state"`
	HoldUntilMs *int64            `json:"holdUntilMs,omitempty"`
	PayByMs     *int64            `json:"payByMs,omitempty"`
	Reminders   *[]reminder       `json:"reminders,omitempty"` // nil: left out; a pointer to an empty list: `[]`
	PaidAtMs    *int64            `json:"paidAtMs,omitempty"`
	Settlement  *Settlement       `json:"settlement,omitempty"`
	extra       []runtime.Member
}

// PlanPause is a pause as asked: from a day, to a day before another (set when the customer resumes); "" is open-ended.
type PlanPause struct {
	From string `json:"from"`
	To   string `json:"to,omitempty"`
}

// Plan is ledger.ts Plan.
type Plan struct {
	ID            string         `json:"id"`
	Customer      string         `json:"customer"`
	Language      string         `json:"language"`
	TypeID        string         `json:"typeId"`
	SlotID        string         `json:"slotId"`
	Mode          string         `json:"mode"`
	State         string         `json:"state"`
	StartKey      string         `json:"startKey"`
	Periods       []*PlanPeriod  `json:"periods"`
	Pauses        []PlanPause    `json:"pauses"`
	Balance       []BalancePiece `json:"balance"`
	AskedAtMs     *int64         `json:"askedAtMs,omitempty"`
	Area          string         `json:"area,omitempty"`
	Address       string         `json:"address,omitempty"`
	CancelledAtMs *int64         `json:"cancelledAtMs,omitempty"`
	extra         []runtime.Member
}

// PlansState is ledger.ts PlansState: the plans by id, in their insertion order.
type PlansState struct {
	ids   []string
	plans map[string]*Plan
	extra []runtime.Member // top-level members a later version adds
}

func newPlansState() *PlansState { return &PlansState{plans: map[string]*Plan{}} }

// Get is `state.plans[id]`, or nil.
func (ps *PlansState) Get(id string) *Plan {
	if ps == nil {
		return nil
	}
	return ps.plans[id]
}

// Set is `state.plans[id] = plan`: a new id goes last; an id already there keeps its place.
func (ps *PlansState) Set(id string, p *Plan) {
	if _, ok := ps.plans[id]; !ok {
		ps.ids = append(ps.ids, id)
	}
	ps.plans[id] = p
}

// Delete is `delete state.plans[id]`.
func (ps *PlansState) Delete(id string) {
	if _, ok := ps.plans[id]; !ok {
		return
	}
	delete(ps.plans, id)
	for i, x := range ps.ids {
		if x == id {
			ps.ids = append(ps.ids[:i:i], ps.ids[i+1:]...)
			break
		}
	}
}

// IDs are the plans' ids in their order (Object.keys), a copy.
func (ps *PlansState) IDs() []string {
	if ps == nil {
		return nil
	}
	return append([]string(nil), ps.ids...)
}

// All is ledger.ts plansOf: Object.values in their order (the `pending:` entries too).
func (ps *PlansState) All() []*Plan {
	if ps == nil {
		return nil
	}
	out := make([]*Plan, 0, len(ps.ids))
	for _, id := range ps.ids {
		out = append(out, ps.plans[id])
	}
	return out
}

// ---- reading and writing the block ------------------------------------------------------------------------------------------------------------------------------------

// objectMembers is a JSON object's members in the order written; false when it is not an object.
func objectMembers(raw []byte) ([]runtime.Member, bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil, false
	}
	var out []runtime.Member
	for dec.More() {
		t, err := dec.Token()
		k, ok := t.(string)
		if err != nil || !ok {
			return nil, false
		}
		var v json.RawMessage
		if dec.Decode(&v) != nil {
			return nil, false
		}
		out = append(out, runtime.Member{Name: k, Raw: v})
	}
	return out, true
}

// unknownOf are the members whose names are not among the known ones.
func unknownOf(ms []runtime.Member, known ...string) []runtime.Member {
	var out []runtime.Member
	for _, m := range ms {
		if !contains(known, m.Name) {
			out = append(out, m)
		}
	}
	return out
}

// withExtra is the struct's JSON with the carried members after its own.
func withExtra(v any, extra []runtime.Member) json.RawMessage {
	b := jsonOf(v)
	if len(extra) == 0 {
		return b
	}
	var out bytes.Buffer
	out.Write(b[:len(b)-1])
	for _, m := range extra {
		out.WriteByte(',')
		out.Write(jsonOf(m.Name))
		out.WriteByte(':')
		out.Write(m.Raw)
	}
	out.WriteByte('}')
	return out.Bytes()
}

var (
	planKeys   = []string{"id", "customer", "language", "typeId", "slotId", "mode", "state", "startKey", "periods", "pauses", "balance", "askedAtMs", "area", "address", "cancelledAtMs"}
	periodKeys = []string{"index", "from", "to", "priceInr", "dueInr", "taken", "orderId", "days", "state", "holdUntilMs", "payByMs", "reminders", "paidAtMs", "settlement"}
)

// UnmarshalJSON reads a period, keeping members a later version adds.
func (p *PlanPeriod) UnmarshalJSON(raw []byte) error {
	type plain PlanPeriod
	var v plain
	if err := json.Unmarshal(raw, &v); err != nil {
		return err
	}
	*p = PlanPeriod(v)
	if ms, ok := objectMembers(raw); ok {
		p.extra = unknownOf(ms, periodKeys...)
	}
	return nil
}

// MarshalJSON writes a period in flow.ts's member order; a list that is not there is written `[]` (flow.ts always sets it).
func (p *PlanPeriod) MarshalJSON() ([]byte, error) {
	type plain PlanPeriod
	v := plain(*p)
	if v.Taken == nil {
		v.Taken = []BalancePiece{}
	}
	if v.Days == nil {
		v.Days = map[string]string{}
	}
	return withExtra(v, p.extra), nil
}

// UnmarshalJSON reads a plan, keeping members a later version adds.
func (p *Plan) UnmarshalJSON(raw []byte) error {
	type plain Plan
	var v plain
	if err := json.Unmarshal(raw, &v); err != nil {
		return err
	}
	*p = Plan(v)
	if ms, ok := objectMembers(raw); ok {
		p.extra = unknownOf(ms, planKeys...)
	}
	return nil
}

// MarshalJSON writes a plan in flow.ts's member order.
func (p *Plan) MarshalJSON() ([]byte, error) {
	type plain Plan
	v := plain(*p)
	if v.Periods == nil {
		v.Periods = []*PlanPeriod{}
	}
	if v.Pauses == nil {
		v.Pauses = []PlanPause{}
	}
	if v.Balance == nil {
		v.Balance = []BalancePiece{}
	}
	return withExtra(v, p.extra), nil
}

// parsePlansState reads the `plans` block; false when it is not one this version reads.
func parsePlansState(raw json.RawMessage) (*PlansState, bool) {
	top, ok := objectMembers(raw)
	if !ok {
		return nil, false
	}
	ps := newPlansState()
	for _, m := range top {
		if m.Name != "plans" {
			ps.extra = append(ps.extra, m)
			continue
		}
		list, ok := objectMembers(m.Raw)
		if !ok {
			return nil, false
		}
		for _, e := range list {
			var p Plan
			if json.Unmarshal(e.Raw, &p) != nil {
				return nil, false
			}
			ps.Set(e.Name, &p)
		}
	}
	return ps, true
}

// json is the block as the TypeScript writes it: {"plans": {...}} then any member carried.
func (ps *PlansState) json() json.RawMessage {
	var b bytes.Buffer
	b.WriteString(`{"plans":{`)
	for i, id := range ps.ids {
		if i > 0 {
			b.WriteByte(',')
		}
		b.Write(jsonOf(id))
		b.WriteByte(':')
		raw, _ := ps.plans[id].MarshalJSON()
		b.Write(raw)
	}
	b.WriteByte('}')
	for _, m := range ps.extra {
		b.WriteByte(',')
		b.Write(jsonOf(m.Name))
		b.WriteByte(':')
		b.Write(m.Raw)
	}
	b.WriteByte('}')
	return b.Bytes()
}

// PlansState is the store's `plans` block, typed once per store; with create, `store.plans ??= { plans: {} }`. nil without create when there is none (or a block this version
// cannot read: it is then counted as no plans, and with create started fresh in memory only).
func (s *Store) PlansState(create bool) *PlansState {
	if s.plans == nil && s.Plans != nil {
		if ps, ok := parsePlansState(s.Plans); ok {
			s.plans = ps
		}
	}
	if s.plans == nil && create {
		s.plans = newPlansState()
	}
	return s.plans
}

// ---- periods.ts: the dates of a plan's periods ------------------------------------------------------------------------------------------------------------------------

// DateOfKey is periods.ts dateOfKey: "2026-11-16" as a date (Number of each part; a key that is not one reads as zeros, as Number("") is 0).
func DateOfKey(k string) zone.Date {
	num := func(s string) int { n, _ := strconv.Atoi(s); return n }
	if len(k) < 10 {
		return zone.Date{}
	}
	return zone.Date{Year: num(k[0:4]), Month: num(k[5:7]), Day: num(k[8:10])}
}

func keyOfZ(d zone.Date) string { return KeyOf(DateOf(d)) }

// daysIn is the days of a month (Date.UTC(year, month, 0)).
func daysIn(year, month int) int {
	return zone.AddDays(zone.Date{Year: year, Month: month + 1, Day: 1}, -1).Day
}

// addMonths is periods.ts addMonths: k whole months on from the START day, the 31st becoming the last day of a shorter month (Math.floor and % of a non-negative total).
func addMonths(start zone.Date, k int) zone.Date {
	total := start.Year*12 + (start.Month - 1) + k
	year, month := total/12, total%12+1
	if month > 12 { // zone.AddDays normalises a month 13 (Date.UTC rolls it over); total%12 is never 12, so this is only a guard
		year, month = year+1, month-12
	}
	return zone.Date{Year: year, Month: month, Day: min(start.Day, daysIn(year, month))}
}

// periodRange is periods.ts periodRange: period `index` of a plan that started on `start`.
func periodRange(start zone.Date, index int) (from, to zone.Date) {
	return addMonths(start, index), zone.AddDays(addMonths(start, index+1), -1)
}

// mealDates is periods.ts mealDates: the dates in the range whose weekday is one of the plan's (0 is Sunday).
func mealDates(from, to zone.Date, weekdays []int) []zone.Date {
	var out []zone.Date
	for d := from; keyOfZ(d) <= keyOfZ(to); d = zone.AddDays(d, 1) {
		if contains(weekdays, zone.WeekdayOf(d)) {
			out = append(out, d)
		}
	}
	return out
}

// firstMealOnOrAfter is periods.ts firstMealOnOrAfter.
func firstMealOnOrAfter(d zone.Date, weekdays []int) zone.Date {
	for i := 0; i < 7 && !contains(weekdays, zone.WeekdayOf(d)); i++ {
		d = zone.AddDays(d, 1)
	}
	return d
}

// creditInr is periods.ts creditInr: what `days` meal days not taken are worth in whole rupees, rounded DOWN, never more than paidInr or the price (integer division of
// non-negative numbers is Math.floor).
func creditInr(priceInr, meals, days, paidInr int64) int64 {
	if meals <= 0 || days <= 0 {
		return 0
	}
	return max(0, min(paidInr, priceInr, priceInr*min(days, meals)/meals))
}

// ---- ledger.ts: the reads and the changes ------------------------------------------------------------------------------------------------------------------------------

// planRules is ledger.ts PlanRules.
type planRules struct {
	tz       string
	cutoff   Cutoff
	weekdays []int
	credits  string
}

// cutoffMsFor is ledger.ts cutoffMsFor: the moment a meal day closes for pausing and skipping.
func cutoffMsFor(r planRules, key string) int64 {
	m := ParseClock(r.cutoff.Time)
	return zone.ZonedToMs(zone.AddDays(DateOfKey(key), -int(r.cutoff.DaysBefore)), m/60, m%60, r.tz)
}

func (r planRules) open(key string, nowMs int64) bool { return nowMs < cutoffMsFor(r, key) }

// planOfCustomer is ledger.ts planOfCustomer: the latest running plan of a customer.
func (ps *PlansState) planOfCustomer(customer string) *Plan {
	all := ps.All()
	for i := len(all) - 1; i >= 0; i-- {
		if all[i].Customer == customer && all[i].State == planActive {
			return all[i]
		}
	}
	return nil
}

// periodOfDay is ledger.ts periodOfDay: the first period that has the day.
func (p *Plan) periodOfDay(key string) *PlanPeriod {
	for _, per := range p.Periods {
		if key >= per.From && key <= per.To {
			return per
		}
	}
	return nil
}

func (p *Plan) paused(key string) bool {
	for _, q := range p.Pauses {
		if key >= q.From && (q.To == "" || key <= q.To) {
			return true
		}
	}
	return false
}

// newDays is ledger.ts newDays: a period's days from the plan's weekdays, a day a pause covers starting "paused", the others "due".
func (p *Plan) newDays(weekdays []int, start zone.Date, index int) (from, to string, days map[string]string) {
	f, t := periodRange(start, index)
	days = map[string]string{}
	for _, d := range mealDates(f, t, weekdays) {
		k := keyOfZ(d)
		days[k] = dayDue
		if p.paused(k) {
			days[k] = dayPaused
		}
	}
	return keyOfZ(f), keyOfZ(t), days
}

// holdsPlaces is ledger.ts holdsPlaces: a paid period does; a renewal asked for does; a first period does while its hold runs.
func (per *PlanPeriod) holdsPlaces(nowMs int64) bool {
	return per.State == periodPaid || (per.State == periodAwaiting && (per.Index > 0 || (per.HoldUntilMs != nil && *per.HoldUntilMs > nowMs)))
}

// mealCounts: the plan's meal on that day holds its place (a delivered meal still counts that day).
func (p *Plan) mealCounts(key string, nowMs int64) bool {
	per := p.periodOfDay(key)
	if per == nil || !per.holdsPlaces(nowMs) {
		return false
	}
	d := per.Days[key]
	return d == dayDue || d == dayDelivered
}

// mealsOn is ledger.ts mealsOn: the meals the kitchen makes on a day in a slot.
func (ps *PlansState) mealsOn(key, slotID string, nowMs int64) int {
	n := 0
	for _, p := range ps.All() {
		if p.SlotID != slotID || p.State == planLapsed {
			continue
		}
		if p.mealCounts(key, nowMs) {
			n++
		}
	}
	return n
}

// mealsTomorrow is ledger.ts mealsTomorrow: tomorrow's meals for each slot that has any (the slots in the order their first plan is listed).
func (ps *PlansState) mealsTomorrow(tz string, nowMs int64) (key string, slots []string, counts []int) {
	key = keyOfZ(zone.AddDays(zone.LocalParts(nowMs, tz).Date, 1))
	var seen []string
	for _, p := range ps.All() {
		if !contains(seen, p.SlotID) {
			seen = append(seen, p.SlotID)
		}
	}
	for _, s := range seen {
		if n := ps.mealsOn(key, s, nowMs); n > 0 {
			slots, counts = append(slots, s), append(counts, n)
		}
	}
	return key, slots, counts
}

// asked is ledger.ts Asked: ok with the days changed, or the refusal and its cut-off.
type asked struct {
	ok       bool
	why      string // no_meal, already, after_cutoff, cancelled
	decision Decision
	days     int64
	cutoffMs *int64
}

func refuse(why, rule, reason string, cutoffMs *int64) asked {
	return asked{why: why, decision: block(rule, reason), cutoffMs: cutoffMs}
}

// skipDay is ledger.ts skipDay.
func (p *Plan) skipDay(key string, r planRules, nowMs int64) asked {
	if p.State != planActive {
		return refuse("cancelled", "plan-no-charge-after-cancel", "The plan is not running, so there is no meal to skip.", nil)
	}
	per := p.periodOfDay(key)
	var day string
	has := false
	if per != nil {
		day, has = per.Days[key]
	}
	if per == nil || per.State != periodPaid || !has {
		return refuse("no_meal", "plan-cutoff", "There is no paid meal that day.", nil)
	}
	if day != dayDue {
		return refuse("already", "plan-one-credit-per-period", "That day is already "+day+": it is counted once.", nil)
	}
	cut := cutoffMsFor(r, key)
	if nowMs >= cut {
		return refuse("after_cutoff", "plan-cutoff", "The cut-off for that meal day has passed.", &cut)
	}
	per.Days[key] = daySkipped
	return asked{ok: true, decision: allow("plan-cutoff", "The cut-off for that meal day has not passed."), days: 1}
}

// sortedDays are a period's day keys in order (Object.entries of days made in date order).
func (per *PlanPeriod) sortedDays() []string {
	keys := make([]string, 0, len(per.Days))
	for k := range per.Days {
		keys = append(keys, k)
	}
	sortStrings(keys)
	return keys
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

// pauseFrom is ledger.ts pauseFrom: open-ended until the customer resumes.
func (p *Plan) pauseFrom(fromKey string, r planRules, nowMs int64) asked {
	if p.State != planActive {
		return refuse("cancelled", "plan-no-charge-after-cancel", "The plan is not running, so there is nothing to pause.", nil)
	}
	first := keyOfZ(firstMealOnOrAfter(DateOfKey(fromKey), r.weekdays))
	cut := cutoffMsFor(r, first)
	if nowMs >= cut {
		return refuse("after_cutoff", "plan-cutoff", "The cut-off for the first meal day of the pause has passed.", &cut)
	}
	for _, q := range p.Pauses {
		if q.To == "" && q.From <= fromKey {
			return refuse("already", "plan-one-credit-per-period", "The plan is already paused from before that day.", nil)
		}
	}
	kept := []PlanPause{}
	for _, q := range p.Pauses {
		if q.From < fromKey || q.To != "" {
			kept = append(kept, q)
		}
	}
	p.Pauses = append(kept, PlanPause{From: fromKey})
	var days int64
	for _, per := range p.Periods {
		if per.State == periodLapsed {
			continue
		}
		for _, k := range per.sortedDays() {
			if k >= fromKey && per.Days[k] == dayDue {
				per.Days[k] = dayPaused
				days++
			}
		}
	}
	return asked{ok: true, decision: allow("plan-cutoff", "The cut-off for the first paused meal day has not passed."), days: days}
}

// resumeFrom is ledger.ts resumeFrom: the pause ends the day before; days from then on that were only paused are due again.
func (p *Plan) resumeFrom(fromKey string, r planRules, nowMs int64) asked {
	if p.State != planActive {
		return refuse("cancelled", "plan-no-charge-after-cancel", "The plan is not running, so there is nothing to resume.", nil)
	}
	covering := false
	for _, q := range p.Pauses {
		covering = covering || q.To == "" || q.To >= fromKey
	}
	if !covering {
		return refuse("no_meal", "plan-cutoff", "The plan is not paused from that day.", nil)
	}
	first := keyOfZ(firstMealOnOrAfter(DateOfKey(fromKey), r.weekdays))
	cut := cutoffMsFor(r, first)
	if nowMs >= cut {
		return refuse("after_cutoff", "plan-cutoff", "The cut-off for the first meal day after the pause has passed.", &cut)
	}
	dayBefore := keyOfZ(zone.AddDays(DateOfKey(fromKey), -1))
	next := []PlanPause{}
	for _, q := range p.Pauses {
		switch {
		case q.To != "" && q.To < fromKey:
			next = append(next, q)
		case q.From >= fromKey:
		default:
			next = append(next, PlanPause{From: q.From, To: dayBefore})
		}
	}
	p.Pauses = next
	var days int64
	for _, per := range p.Periods {
		if per.State == periodLapsed {
			continue
		}
		for _, k := range per.sortedDays() {
			if k >= fromKey && per.Days[k] == dayPaused && !p.paused(k) {
				per.Days[k] = dayDue
				days++
			}
		}
	}
	return asked{ok: true, decision: allow("plan-cutoff", "The cut-off for the first meal day after the pause has not passed."), days: days}
}

// cancelPlan is ledger.ts cancelPlan: every day whose cut-off is still ahead is cancelled; days already closed stay due (the kitchen has made them).
func (p *Plan) cancelPlan(r planRules, nowMs int64) (int64, Decision) {
	p.State = planCancelled
	at := nowMs
	p.CancelledAtMs = &at
	var days int64
	for _, per := range p.Periods {
		if per.State == periodLapsed {
			continue
		}
		for _, k := range per.sortedDays() {
			if s := per.Days[k]; (s == dayDue || s == dayPaused) && r.open(k, nowMs) {
				per.Days[k] = dayCancelled
				days++
			}
		}
	}
	return days, allow("plan-no-charge-after-cancel", "No meal is sent or charged for a day whose cut-off is after the cancellation.")
}

// deliverDue is ledger.ts deliverDue: meals whose slot has ended become delivered; the days, sorted, so each is written in the record once.
func (p *Plan) deliverDue(slotEndMsOf func(key string) int64, nowMs int64) []string {
	var out []string
	for _, per := range p.Periods {
		if per.State != periodPaid {
			continue
		}
		for _, k := range per.sortedDays() {
			if per.Days[k] == dayDue && slotEndMsOf(k) <= nowMs {
				per.Days[k] = dayDelivered
				out = append(out, k)
			}
		}
	}
	sortStrings(out)
	return out
}

// creditDays is ledger.ts creditDays: the days not taken (skipped, paused or cancelled).
func (per *PlanPeriod) creditDays() int64 {
	var n int64
	for _, s := range per.Days {
		if s == daySkipped || s == dayPaused || s == dayCancelled {
			n++
		}
	}
	return n
}

// settledAfterMs is ledger.ts settledAfterMs: the cut-off of the period's last meal day (0 for a period with none).
func (per *PlanPeriod) settledAfterMs(r planRules) int64 {
	keys := per.sortedDays()
	if len(keys) == 0 {
		return 0
	}
	return cutoffMsFor(r, keys[len(keys)-1])
}

// renewalDue is ledger.ts renewalDue: active, the last period paid, and its credit final.
func (p *Plan) renewalDue(r planRules, nowMs int64) bool {
	if p.State != planActive || len(p.Periods) == 0 {
		return false
	}
	last := p.Periods[len(p.Periods)-1]
	return last.State == periodPaid && nowMs >= last.settledAfterMs(r)
}

// checkOneRenewal is ledger.ts checkOneRenewal: one payment request for each period.
func (p *Plan) checkOneRenewal(next int64) Decision {
	n := strconv.FormatInt(next+1, 10)
	for _, per := range p.Periods {
		if per.Index == next {
			return block("plan-one-renewal-per-period", "Period "+n+" was already asked for, so it is not asked for again.")
		}
	}
	return allow("plan-one-renewal-per-period", "Period "+n+" has not been asked for.")
}

// settle is ledger.ts settle: count a paid period's days not taken, once; refunded under "refund" or for a plan that no longer stands, else carried onto the balance.
func (p *Plan) settle(per *PlanPeriod, r planRules, nowMs int64) (Decision, int64, string) {
	if per.Settlement != nil {
		return block("plan-one-credit-per-period", "Period "+strconv.FormatInt(per.Index+1, 10)+" was already settled ("+per.Settlement.Kind+"), so its days are not credited again."), 0, per.Settlement.Kind
	}
	days := per.creditDays()
	meals := int64(len(per.Days))
	amount := creditInr(per.PriceInr, meals, days, per.DueInr)
	kind := "carried"
	switch {
	case amount == 0:
		kind = "none"
	case r.credits == "refund" || p.State != planActive:
		kind = "refunded"
	}
	per.Settlement = &Settlement{Kind: kind, AmountInr: amount, Days: days, AtMs: nowMs}
	if kind == "carried" {
		p.Balance = append(p.Balance, BalancePiece{OrderID: per.OrderID, AmountInr: amount})
	}
	return allow("plan-credit-within-paid", i64(days)+" of "+i64(meals)+" meals not taken, worth "+i64(amount)+" of the "+i64(per.DueInr)+" paid."), amount, kind
}

// takeBalance is ledger.ts takeBalance: credit off a new payment, oldest first.
func (p *Plan) takeBalance(maxInr int64) []BalancePiece {
	taken := []BalancePiece{}
	left := maxInr
	for left > 0 && len(p.Balance) > 0 {
		piece := &p.Balance[0]
		use := min(piece.AmountInr, left)
		taken = append(taken, BalancePiece{OrderID: piece.OrderID, AmountInr: use})
		left -= use
		if use == piece.AmountInr {
			p.Balance = p.Balance[1:]
		} else {
			piece.AmountInr -= use
		}
	}
	return taken
}

// returnBalance is ledger.ts returnBalance: the pieces go back to the front, in the order they were taken.
func (p *Plan) returnBalance(pieces []BalancePiece) {
	for i := len(pieces) - 1; i >= 0; i-- {
		piece := pieces[i]
		if len(p.Balance) > 0 && p.Balance[0].OrderID == piece.OrderID {
			p.Balance[0].AmountInr += piece.AmountInr
		} else {
			p.Balance = append([]BalancePiece{piece}, p.Balance...)
		}
	}
}
