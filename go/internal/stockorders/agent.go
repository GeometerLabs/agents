package stockorders

// The Stock orders agent: the Go twin of templates/commerce/stock-orders/src/agent.ts. One step handles ONE inbound WhatsApp message (the owner's or a supplier's), one press on the
// owner's page, or one beat of the clock, over the step's state (internal/runtime saves it whole or not at all).
//
// How it stays honest, as agent.ts says it:
//   - the agent builds the EXACT order and the owner approves THAT: a card bound to the supplier, the supplier's number, the item, the unit, the quantity, the unit price, the total
//     in paise and the budget month (internal/assistant cards). On the tap the order is read again as it is NOW; if anything differs nothing is sent and a new card is made;
//   - the month's budget is worked out from the orders (store.go reservedPaise), checked and reserved in one go with the approval;
//   - the order message goes only through the shared say (messaging.Say), whose gates include `send-only-when-approved`, and only by SEND ONCE (messaging.RunSendOnce): the step
//     records an intent; after the step is saved the runtime calls AfterSave, which claims, saves, sends and saves the ending. A claim with no ending is never sent again;
//   - what the supplier said, what arrived and whether it was paid are three fields; only the supplier's own number answers for the supplier;
//   - everything a message states is written from the record by a fixed template and read back against it before it is sent.

import (
	"context"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/stock"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

const (
	hour        int64 = 3_600_000
	askingForMs       = 6 * hour
	handledKeep       = 500
	maxLowAsks        = 3
	orderKind         = "purchase_order"
	checkKind         = "supplier_check"
	skillName         = "stock-orders"
)

var (
	digitsRe = regexp.MustCompile(`\D`)
	tapRe    = regexp.MustCompile(`^(ack|nack):(po-\d+)$`)
	pickRe   = regexp.MustCompile(`^pick:(\d+)$`)
	buttonRe = regexp.MustCompile(`^card-(yes|no):([A-HJKMNP-Za-hjkmnp-z2-9]{4,6})$`)
	typedRe  = regexp.MustCompile(`(?i)^[\s\x{00a0}\x{feff}]*(yes|no)[\s\x{00a0}\x{feff}]+([A-HJKMNP-Za-hjkmnp-z2-9]{4,6})[\s\x{00a0}\x{feff}]*$`)
	yesRe    = language.P("rules.yes")
	noRe     = language.P("rules.no")
)

func digits(n string) string { return digitsRe.ReplaceAllString(n, "") }

// Agent is one step's agent.
type Agent struct {
	kit  *Kit
	c    *runtime.StepContext
	st   *Store
	s    *Settings
	say  *messaging.Say
	msg  messaging.Messaging
	ctx  context.Context
	asst *runtime.Assistant
}

func newAgent(k *Kit, c *runtime.StepContext) *Agent {
	a := &Agent{kit: k, c: c, st: c.State.(*Store), s: k.Settings, ctx: context.Background(), msg: k.WhatsApp}
	// runtime-limits.ts apply: a cap or budget the owner tightened is in force for this step (a copy: the file's value is never touched)
	cp := *a.s
	if v, ok := c.InForce("order_cap"); ok {
		cp.Limits.MaxPerOrderInr = float64(v)
	}
	if v, ok := c.InForce("monthly_budget"); ok {
		cp.Limits.MonthlyBudgetInr = float64(v)
	}
	a.s = &cp
	a.say = messaging.NewSay(a.sayDeps())
	if a.s.Assistant {
		a.asst = c.Assistant(runtime.AssistantHooks{Skill: &skill{a: a}, Messaging: a.msg, Log: a.assistantLog, LanguageOf: a.languageOf,
			OptedOut: func(p string) bool { return a.st.optedOut(digits(p)) }})
	}
	return a
}

func (a *Agent) now() int64 {
	if a.c == nil {
		return a.kit.now() // a channel's read (readAgent)
	}
	return a.c.Now()
}

func (a *Agent) owner() string { n, _ := a.c.Owner(); return n }

func (a *Agent) ownerLanguage() string { return a.s.Owner.Language }

func (a *Agent) cards() *assistant.State { return a.c.Snap.EnsureAssistant() }

func (a *Agent) supplierByNumber(from string) *Supplier {
	for i := range a.s.Suppliers {
		if digits(a.s.Suppliers[i].WhatsApp) == digits(from) {
			return &a.s.Suppliers[i]
		}
	}
	return nil
}

func (a *Agent) languageOf(phone string) string {
	if digits(phone) == digits(a.owner()) {
		return a.ownerLanguage()
	}
	if sp := a.supplierByNumber(phone); sp != nil {
		return sp.Language
	}
	return a.s.Languages[0]
}

type logMore struct {
	decisions []messaging.Decision
	notes     string
	refs      map[string]string
}

func (a *Agent) log(o *Order, phone, action, outcome string, inputs any, more ...logMore) {
	var m logMore
	if len(more) > 0 {
		m = more[0]
	}
	id := ""
	if o != nil {
		id = o.ID
	}
	var ds []json.RawMessage
	for _, d := range m.decisions {
		b, _ := json.Marshal(d)
		ds = append(ds, b)
	}
	if inputs == nil {
		inputs = map[string]any{}
	}
	a.c.Rec.Append(runtime.NewLine{Conversation: phone, Booking: id, Action: action, Outcome: outcome, Inputs: inputs, Language: a.languageOf(phone), Notes: m.notes, Refs: m.refs, Decisions: ds})
}

func (a *Agent) assistantLog(caseID, phone, action, outcome string, inputs any, more messaging.LogMore) {
	m := logMore{decisions: more.Decisions, refs: more.Refs}
	if more.Notes != nil {
		m.notes = *more.Notes
	}
	a.log(a.st.order(caseID), phone, action, outcome, inputs, m)
}

// ---- the facts a message is written from ----------------------------------------------------------------------------------------------------------

func (a *Agent) monthLabel(ms int64) string {
	p := zoneParts(ms, a.s.Timezone)
	return w().MonthsEn[p.Month-1] + " " + strconv.Itoa(p.Year)
}

// budgetFacts are agent.ts budgetFacts: the month's figures with one order left out of what is reserved, in rupees.
func (a *Agent) budgetFacts(exceptID string, totalPaise int64) facts {
	month := monthOf(a.now(), a.s.Timezone)
	reserved := a.st.reservedPaise(month, exceptID)
	budget := a.s.Limits.MonthlyBudgetInr
	left := max(0, budget*100-float64(reserved)-float64(totalPaise)) / 100
	return facts{"budgetInr": budget, "reservedInr": float64(reserved) / 100, "leftInr": left, "capInr": a.s.Limits.MaxPerOrderInr, "monthLabel": a.monthLabel(a.now())}
}

// sayExtra is what a message carries beside the shared SayArgs: the order, the facts the order does not hold, and the offer.
type sayExtra struct {
	order   *Order
	facts   facts
	offer   string // card, choices, supplier
	code    string
	options []string
	body    []string
}

func extraOf(sa *messaging.SayArgs) *sayExtra {
	if e, ok := sa.Extra.(*sayExtra); ok {
		return e
	}
	return &sayExtra{}
}

func (a *Agent) factsFor(sa *messaging.SayArgs, lang string) (any, error) {
	e := extraOf(sa)
	f := facts{"language": lang, "timeZone": a.s.Timezone, "businessName": a.s.Name}
	if o := e.order; o != nil {
		sp := a.s.supplierOf(o.Supplier)
		f["supplierName"] = sp.Name
		f["itemName"] = nameIn(a.s.itemOf(o.Item).Names, lang)
		f["unitName"] = nameIn(a.s.unitOf(o.Unit).Names, lang)
		f["qty"] = o.Qty
		f["unitPriceInr"] = float64(o.UnitPaise) / 100
		f["totalInr"] = float64(o.TotalPaise) / 100
		if o.ID != "" {
			f["orderRef"] = o.ID
		}
	}
	for k, v := range e.facts {
		f[k] = v
	}
	if e.offer == "choices" {
		var chs []choice
		for _, k := range e.options {
			l := a.s.lineByKey(k)
			chs = append(chs, choice{SupplierName: a.s.supplierOf(l.Supplier).Name, UnitName: nameIn(a.s.unitOf(l.Unit).Names, lang), PriceInr: l.PriceInr})
		}
		f["choices"] = chs
	}
	return f, nil
}

// clip is interactive.ts clip: trimmed, at most max characters (code points), "…" when cut.
func clip(text string, max int) string {
	rs := []rune(language.TrimJS(text))
	if len(rs) <= max {
		return string(rs)
	}
	return string(rs[:max-1]) + "…"
}

func (a *Agent) interactiveFor(sa *messaging.SayArgs, fa any, lang string) (*messaging.InteractiveMessage, error) {
	e := extraOf(sa)
	if e.offer == "" {
		return nil, nil
	}
	f := fa.(facts)
	ids := e.body
	if ids == nil {
		ids = sa.Templates
	}
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		t, err := render(id, f)
		if err != nil {
			return nil, err
		}
		parts = append(parts, t)
	}
	body := strings.Join(parts, " ")
	lb := wordsFor(lang).Labels
	switch e.offer {
	case "card":
		return &messaging.InteractiveMessage{Body: body, Buttons: []messaging.Choice{{ID: "card-yes:" + e.code, Title: lb.Approve}, {ID: "card-no:" + e.code, Title: lb.Decline}}}, nil
	case "supplier":
		return &messaging.InteractiveMessage{Body: body, Buttons: []messaging.Choice{{ID: "ack:" + e.order.ID, Title: lb.SupplierYes}, {ID: "nack:" + e.order.ID, Title: lb.SupplierNo}}}, nil
	}
	chs, _ := f["choices"].([]choice)
	rows := make([]messaging.Choice, 0, len(chs))
	for i, c := range chs {
		d := clip(money(c.PriceInr)+" / "+c.UnitName, 72)
		rows = append(rows, messaging.Choice{ID: "pick:" + strconv.Itoa(i), Title: clip(c.SupplierName+" ("+c.UnitName+")", 24), Description: &d})
	}
	return &messaging.InteractiveMessage{Body: body, List: &messaging.InteractiveList{Button: lb.Choose, Rows: rows}}, nil
}

type voice struct{}

func (voice) Render(id string, f any) (string, error) { return render(id, f.(facts)) }
func (voice) TemplateMessage(t messaging.TemplateArgs) (messaging.TemplateMessage, error) {
	return templateMessage(t.IDs, t.Facts.(facts), t.Text, t.Generic), nil
}
func (voice) GenericNames() messaging.GenericNames {
	return messaging.GenericNames{Customer: w().Generic.Customer, Reminder: w().Generic.Customer, Owner: w().Generic.Owner}
}
func (voice) Matches(text string, f any) messaging.Decision { return matches(text, f.(facts)) }

func (a *Agent) sayDeps() messaging.SayDeps {
	return messaging.SayDeps{
		Messaging: a.msg, Voice: voice{},
		Owner:      messaging.OwnerInfo{WhatsApp: a.owner(), Language: a.ownerLanguage()},
		LanguageOf: func(phone string, _ any) string { return a.languageOf(phone) },
		OptedOut:   func(phone string) bool { return a.st.optedOut(digits(phone)) },
		FactsFor:   a.factsFor, InteractiveFor: a.interactiveFor,
		Gates: func(sa *messaging.SayArgs, _ bool) []messaging.Decision {
			e := extraOf(sa)
			commits := false
			for _, t := range sa.Templates {
				commits = commits || t == "supplier_order" || t == "supplier_check"
			}
			if sa.To == "customer" && commits && e.order != nil {
				return []messaging.Decision{checkSendOnlyWhenApproved(e.order.ApprovedMs != nil && holdsBudget(e.order), a.s.supplierOf(e.order.Supplier))}
			}
			return nil
		},
		InputsOf: func(*messaging.SayArgs) map[string]any { return map[string]any{} },
		Log: func(booking any, phone, action, outcome string, inputs map[string]any, more messaging.LogMore) {
			o, _ := booking.(*Order)
			m := logMore{decisions: more.Decisions, refs: more.Refs}
			if more.Notes != nil {
				m.notes = *more.Notes
			}
			a.log(o, phone, action, outcome, inputs, m)
		},
		HeldBack: func(ctx context.Context, sa *messaging.SayArgs) error {
			if o := extraOf(sa).order; o != nil && o.ID != "" {
				a.tellOwner(o, []string{"owner_message_held"}, nil)
			}
			return nil
		},
	}
}

// tellOwner and tellSupplier are agent.ts's: the one way a message leaves the agent.
func (a *Agent) tellOwner(o *Order, templates []string, e *sayExtra) {
	if e == nil {
		e = &sayExtra{}
	}
	e.order = o
	var booking any
	if o != nil {
		booking = o
	}
	if _, err := a.say.Say(a.ctx, &messaging.SayArgs{Booking: booking, Phone: a.owner(), To: "owner", Templates: templates, Offer: offerOf(e), Extra: e}); err != nil {
		a.c.Log("A message to the owner could not be written: " + err.Error())
	}
}

func (a *Agent) tellSupplier(o *Order, sp *Supplier, template string, e *sayExtra) {
	if e == nil {
		e = &sayExtra{}
	}
	e.order = o
	if _, err := a.say.Say(a.ctx, &messaging.SayArgs{Booking: o, Phone: sp.WhatsApp, To: "customer", Templates: []string{template}, Offer: offerOf(e), Extra: e}); err != nil {
		a.c.Log("A message to a supplier could not be written: " + err.Error())
	}
}

func offerOf(e *sayExtra) *messaging.Offer {
	if e.offer == "" {
		return nil
	}
	return &messaging.Offer{Kind: e.offer, Body: e.body}
}

func one(t string) []string { return []string{t} }

// ---- the catalogue ----------------------------------------------------------------------------------------------------------------------------------

func (a *Agent) itemNames(lang string) []string {
	out := make([]string, len(a.s.Items))
	for i, it := range a.s.Items {
		out[i] = nameIn(it.Names, lang)
	}
	return out
}

func (a *Agent) approvedLines() []Line {
	var out []Line
	for _, l := range a.s.Catalogue {
		if a.s.supplierOf(l.Supplier).Approved {
			out = append(out, l)
		}
	}
	return out
}

func (a *Agent) draftOf(l Line, qty int64) *Order {
	unit := paise(l.PriceInr)
	return &Order{Supplier: l.Supplier, Line: lineKey(l), Item: l.Item, Unit: l.Unit, Qty: qty, UnitPaise: unit, TotalPaise: unit * qty, State: "void", CreatedMs: a.now(), Ack: "none", Receipt: "none", Asks: []Reminder{}}
}

func (a *Agent) exampleRequest(lang string) string {
	l := a.s.Catalogue[0]
	q := l.ReorderQty
	if q == 0 {
		q = 10
	}
	return "order " + strconv.FormatInt(q, 10) + " " + nameIn(a.s.unitOf(l.Unit).Names, lang) + " " + nameIn(a.s.itemOf(l.Item).Names, lang) + " from " + a.s.supplierOf(l.Supplier).Name
}

func (a *Agent) didntUnderstand() {
	a.tellOwner(nil, one("didnt_understand"), &sayExtra{facts: facts{"orderRef": "po-1", "example": a.exampleRequest(a.ownerLanguage())}})
}

func stateKeyOf(o *Order) string {
	switch o.State {
	case "awaiting_approval":
		return "awaiting"
	case "approved":
		return "sending"
	case "send_unknown":
		return "unknown"
	case "send_failed":
		return "failed"
	case "send_blocked":
		return "blocked"
	}
	if o.Receipt == "part" {
		return "part"
	}
	if o.Ack == "accepted" {
		return "accepted"
	}
	return "sent"
}

func (a *Agent) stateWord(o *Order) string { return stateWordIn(a.ownerLanguage(), stateKeyOf(o)) }

func (a *Agent) currentLine(o *Order) *Line { return a.s.lineByKey(o.Line) }

var blockTemplate = map[string]string{"approved-supplier-only": "blocked_supplier", "order-quantity": "blocked_qty", "per-order-cap": "blocked_cap", "monthly-budget": "blocked_budget"}

func blockTemplateOf(rule string) string {
	if t, ok := blockTemplate[rule]; ok {
		return t
	}
	return "blocked_budget"
}

// ---- a request becomes an order with a card ---------------------------------------------------------------------------------------------------------

func (a *Agent) propose(requestID string, lowStock bool, l Line, qty int64, phone string) {
	sp := a.s.supplierOf(l.Supplier)
	once := checkOneOrderPerRequest(requestID, a.st)
	if once.Verdict != "allow" {
		a.log(nil, phone, "propose_order", "blocked", map[string]any{"requestId": requestID}, logMore{decisions: []messaging.Decision{once}, notes: once.Reason})
		return
	}
	if lowStock {
		for _, o := range a.st.Orders {
			if o.Line == lineKey(l) && (o.State == "awaiting_approval" || isOpen(o)) {
				a.tellOwner(o, one("already_open"), nil)
				a.log(o, phone, "propose_order", "blocked", map[string]any{"requestId": requestID, "lowStock": lowStock}, logMore{notes: "an order for this line is already open"})
				return
			}
		}
	}
	draft := a.draftOf(l, qty)
	month := monthOf(a.now(), a.s.Timezone)
	decisions := proposalChecks(a.s, sp, qty, draft.TotalPaise, a.st.reservedPaise(month, ""))
	worst := messaging.Strictest(decisions)
	if worst.Verdict != "allow" {
		a.log(nil, phone, "propose_order", "blocked", map[string]any{"requestId": requestID, "line": lineKey(l), "qty": qty}, logMore{decisions: decisions, notes: worst.Reason})
		f := a.budgetFacts("", 0)
		f["saidQty"], f["maxQty"] = qty, a.s.Limits.MaxQuantity
		a.tellOwner(draft, one(blockTemplateOf(worst.RuleID)), &sayExtra{facts: f})
		return
	}
	o := draft
	o.ID, o.RequestID, o.LowStock, o.State, o.CreatedMs = a.st.nextOrderID(), requestID, lowStock, "awaiting_approval", a.now()
	a.st.put(o)
	a.st.setRequest(requestID, o.ID)
	a.log(o, phone, "propose_order", "held_for_owner", map[string]any{"requestId": requestID, "line": lineKey(l), "qty": qty, "totalPaise": o.TotalPaise}, logMore{decisions: decisions, notes: "waiting for the owner's approval"})
	a.showCard(o, nil)
}

// approvalAction is order.ts approvalAction: exactly the fields the owner approves, read from the order and the catalogue line as they are NOW.
func (a *Agent) approvalAction(o *Order, l *Line) assistant.Action {
	raw := func(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
	unit := paise(l.PriceInr)
	return assistant.Action{Kind: "order", Skill: skillName, Case: o.ID, Fields: assistant.Raw{
		"supplier": raw(o.Supplier), "supplierWhatsapp": raw(a.s.supplierOf(o.Supplier).WhatsApp), "item": raw(o.Item), "unit": raw(o.Unit), "qty": raw(o.Qty),
		"unitPaise": raw(unit), "totalPaise": raw(unit * o.Qty), "currency": raw("INR"), "month": raw(monthOf(a.now(), a.s.Timezone)),
	}}
}

func (a *Agent) showCard(o *Order, prefix []string) {
	l := a.currentLine(o)
	proposal := assistant.Raw{"kind": json.RawMessage(`"order"`), "order": mustRaw(o.ID)}
	card, code, _ := a.cards().MakeCard(a.approvalAction(o, l), proposal, a.now())
	a.log(o, a.owner(), "ask_owner", "held_for_owner", map[string]any{"card": card.ID, "digest": card.Digest}, logMore{refs: map[string]string{"card": card.ID, "kind": "order_approval"}})
	f := a.budgetFacts(o.ID, o.TotalPaise)
	f["code"] = code
	ids := append(append([]string{}, prefix...), "card")
	a.tellOwner(o, ids, &sayExtra{facts: f, offer: "card", code: code, body: ids})
}

func mustRaw(v any) json.RawMessage { b, _ := json.Marshal(v); return b }

// ---- the owner answers a card -----------------------------------------------------------------------------------------------------------------------

func (a *Agent) currentOf(c *assistant.Card) (assistant.Action, string, bool) {
	o := a.st.order(c.Action.Case)
	if o == nil || o.State != "awaiting_approval" {
		return assistant.Action{}, "the order is not waiting for approval any more", false
	}
	l := a.currentLine(o)
	if l == nil {
		return assistant.Action{}, "the item is no longer in the catalogue", false
	}
	return a.approvalAction(o, l), "", true
}

func (a *Agent) cardByCode(code string) *assistant.Card {
	hash := assistant.CodeHash(code)
	st := a.cards()
	for i := range st.Cards {
		if st.Cards[i].CodeHash == hash {
			return &st.Cards[i]
		}
	}
	return nil
}

func (a *Agent) applyVerdict(v assistant.Verdict) {
	switch v.Kind {
	case "unknown":
		a.tellOwner(nil, one("card_unknown"), nil)
	case "closed":
		a.tellOwner(nil, one("card_closed"), nil)
	case "gone":
		a.cards().Close(v.Card, "void", a.now())
		a.tellOwner(nil, one("card_closed"), nil)
	case "expired":
		a.cards().Close(v.Card, "expired", a.now())
		if o := a.st.order(v.Card.Action.Case); o != nil && o.State == "awaiting_approval" {
			o.State = "void"
		}
		a.tellOwner(nil, one("card_expired"), nil)
	case "refuse":
		a.cards().Close(v.Card, "refused", a.now())
		if o := a.st.order(v.Card.Action.Case); o != nil {
			a.decline(o, v.Card)
		}
	case "changed":
		a.cards().Close(v.Card, "void", a.now())
		o := a.st.order(v.Card.Action.Case)
		l := a.currentLine(o)
		same := checkApprovalMatches(false, "price or month")
		o.UnitPaise = paise(l.PriceInr)
		o.TotalPaise = o.UnitPaise * o.Qty
		a.log(o, a.owner(), "owner_decision", "blocked", map[string]any{"decision": "approve", "card": v.Card.ID}, logMore{decisions: []messaging.Decision{same}, notes: same.Reason, refs: map[string]string{"card": v.Card.ID}})
		a.recheckAndShow(o, one("card_changed"))
	case "do":
		a.approve(a.st.order(v.Card.Action.Case), v.Card)
	}
}

func (a *Agent) recheckAndShow(o *Order, prefix []string) {
	decisions := proposalChecks(a.s, a.s.supplierOf(o.Supplier), o.Qty, o.TotalPaise, a.st.reservedPaise(monthOf(a.now(), a.s.Timezone), o.ID))
	if worst := messaging.Strictest(decisions); worst.Verdict != "allow" {
		o.State = "void"
		a.log(o, a.owner(), "propose_order", "blocked", map[string]any{"qty": o.Qty, "totalPaise": o.TotalPaise}, logMore{decisions: decisions, notes: worst.Reason})
		f := a.budgetFacts(o.ID, 0)
		f["saidQty"], f["maxQty"] = o.Qty, a.s.Limits.MaxQuantity
		a.tellOwner(o, one(blockTemplateOf(worst.RuleID)), &sayExtra{facts: f})
		return
	}
	a.showCard(o, prefix)
}

// approve is agent.ts approve: the checks, the reservation (this order's state) and the intent, with nothing in between that could let another approval in.
func (a *Agent) approve(o *Order, card *assistant.Card) bool {
	if o == nil || o.State != "awaiting_approval" {
		return false
	}
	month := monthOf(a.now(), a.s.Timezone)
	decisions := proposalChecks(a.s, a.s.supplierOf(o.Supplier), o.Qty, o.TotalPaise, a.st.reservedPaise(month, o.ID))
	worst := messaging.Strictest(decisions)
	inputs := map[string]any{"decision": "approve"}
	refs := map[string]string{}
	if card != nil {
		inputs["card"] = card.ID
		refs["card"] = card.ID
	}
	if worst.Verdict != "allow" {
		a.closeOrderCards(o, "void")
		o.State = "void"
		a.log(o, a.owner(), "owner_decision", "blocked", inputs, logMore{decisions: decisions, notes: worst.Reason, refs: refs})
		t := "blocked_budget"
		if worst.RuleID == "approved-supplier-only" {
			t = "blocked_supplier"
		} else if worst.RuleID == "per-order-cap" {
			t = "blocked_cap"
		}
		f := a.budgetFacts(o.ID, 0)
		f["saidQty"], f["maxQty"] = o.Qty, a.s.Limits.MaxQuantity
		a.tellOwner(o, one(t), &sayExtra{facts: f})
		return false
	}
	a.closeOrderCards(o, "done")
	o.State = "approved"
	now := a.now()
	o.ApprovedMs, o.BudgetMonth = &now, &month
	matched := checkApprovalMatches(true, "")
	if card != nil {
		inputs["digest"] = card.Digest
	}
	inputs["totalPaise"] = o.TotalPaise
	refs["evidence"], refs["month"] = "owner_marked", month
	a.log(o, a.owner(), "owner_decision", "confirmed", inputs, logMore{decisions: append(decisions, matched), notes: "the owner approved exactly this order; the budget is reserved", refs: refs})
	a.tellOwner(o, one("order_approved"), &sayExtra{facts: a.budgetFacts(o.ID, o.TotalPaise)})
	a.queueOrder(o)
	return true
}

func (a *Agent) closeOrderCards(o *Order, to string) {
	st := a.cards()
	for i := range st.Cards {
		c := &st.Cards[i]
		if c.State == "open" && c.Action.Skill == skillName && c.Action.Kind == "order" && c.Action.Case == o.ID {
			st.Close(c, to, a.now())
		}
	}
}

func (a *Agent) decline(o *Order, card *assistant.Card) bool {
	if o.State != "awaiting_approval" {
		return false
	}
	a.closeOrderCards(o, "refused")
	o.State = "declined"
	inputs := map[string]any{"decision": "decline"}
	refs := map[string]string{"evidence": "owner_marked"}
	if card != nil {
		inputs["card"], refs["card"] = card.ID, card.ID
	}
	a.log(o, a.owner(), "owner_decision", "confirmed", inputs, logMore{refs: refs})
	a.tellOwner(o, one("order_declined"), nil)
	return true
}

// ---- the order goes to the supplier: send once ----------------------------------------------------------------------------------------------------

type orderValues struct {
	OrderRef     string  `json:"orderRef"`
	SupplierName string  `json:"supplierName"`
	Qty          int64   `json:"qty"`
	UnitPriceInr float64 `json:"unitPriceInr"`
	TotalInr     float64 `json:"totalInr"`
}

func (a *Agent) queueOrder(o *Order) {
	if o.State != "approved" {
		return
	}
	so := a.st.sendOnce()
	for _, i := range so.Intents {
		if i.CaseID == o.ID && i.Kind == orderKind && (i.Status == "queued" || i.Status == "claimed" || i.Status == "failed") {
			return // one live message per order
		}
	}
	sp := a.s.supplierOf(o.Supplier)
	vals, _ := json.Marshal(orderValues{o.ID, sp.Name, o.Qty, float64(o.UnitPaise) / 100, float64(o.TotalPaise) / 100})
	messaging.QueueSend(so, messaging.SendIntent{ID: messaging.NextIntentID(so, o.ID, orderKind), Kind: orderKind, CaseID: o.ID, To: sp.WhatsApp, ToName: sp.Name, Templates: one("supplier_order"), Values: vals, CreatedMs: a.now()})
}

func (a *Agent) queueCheck(o *Order) {
	so := a.st.sendOnce()
	sp := a.s.supplierOf(o.Supplier)
	vals, _ := json.Marshal(struct {
		OrderRef     string `json:"orderRef"`
		SupplierName string `json:"supplierName"`
	}{o.ID, sp.Name})
	messaging.QueueSend(so, messaging.SendIntent{ID: messaging.NextIntentID(so, o.ID, checkKind), Kind: checkKind, CaseID: o.ID, To: sp.WhatsApp, ToName: sp.Name, Templates: one("supplier_check"), Values: vals, CreatedMs: a.now()})
}

func intentAction(i *messaging.SendIntent) string {
	if i.Kind == orderKind {
		return "send_order"
	}
	return "ask_supplier_again"
}

func intentRefs(i *messaging.SendIntent) map[string]string {
	return map[string]string{"intent": i.ID, "kind": i.Kind, "to": "customer"}
}

func (a *Agent) deliverIntent(ctx context.Context, i *messaging.SendIntent) (messaging.SaidOutcome, error) {
	o := a.st.order(i.CaseID)
	stale := o == nil
	if o != nil {
		if i.Kind == orderKind {
			stale = o.State != "approved"
		} else {
			stale = o.Ack != "none" || (o.State != "sent" && o.State != "send_unknown")
		}
	}
	if stale {
		a.log(o, i.To, intentAction(i), "blocked", map[string]any{"intent": i.ID}, logMore{refs: intentRefs(i), notes: "the order is not in the state this message was asked for in, so nothing was sent"})
		return messaging.HeldBack, nil
	}
	var vals map[string]any
	_ = json.Unmarshal(i.Values, &vals)
	e := &sayExtra{order: o, facts: facts(vals)}
	if i.Kind == orderKind {
		e.offer = "supplier"
	}
	return a.say.Outcome(ctx, &messaging.SayArgs{Booking: o, Phone: i.To, To: "customer", Templates: i.Templates, Action: intentAction(i), Offer: offerOf(e), Extra: e})
}

func (a *Agent) settleIntent(i *messaging.SendIntent, ending messaging.SendEnding) {
	o := a.st.order(i.CaseID)
	if o == nil || i.Kind != orderKind || o.State != "approved" || ending == "failed" {
		return
	}
	switch ending {
	case "gave_up":
		o.State = "send_failed"
		return
	case "blocked":
		o.State = "send_blocked"
		return
	}
	now := a.now()
	o.SentMs = &now
	if ending == "confirmed" {
		o.State = "sent"
	} else {
		o.State = "send_unknown"
	}
	o.Asks = []Reminder{}
	for _, h := range a.s.FollowUpHours {
		if at := now + h*hour; at > now {
			o.Asks = append(o.Asks, Reminder{AtMs: at})
		}
	}
}

func (a *Agent) tellIntent(_ context.Context, i *messaging.SendIntent, ending messaging.SendEnding) error {
	o := a.st.order(i.CaseID)
	if o == nil || i.Kind != orderKind {
		return nil
	}
	switch {
	case ending == "confirmed" && o.State == "sent":
		a.tellOwner(o, one("sent_ok"), nil)
	case ending == "unconfirmed" && o.State == "send_unknown":
		a.tellOwner(o, one("sent_unknown"), nil)
	case ending == "gave_up" && o.State == "send_failed":
		a.tellOwner(o, one("send_failed"), nil)
	case ending == "blocked" && o.State == "send_blocked":
		a.tellOwner(o, one("send_blocked"), nil)
	}
	return nil
}

// AfterSave is agent.ts sendOnce.run: the messages the step asked for, sent once, after the step's save (runtime.AfterSaver).
func (a *Agent) AfterSave(save func() error) {
	if a.st.SendOnce == nil {
		return // nothing was ever asked for
	}
	messaging.RunSendOnce(a.ctx, messaging.SendOnceDeps{
		State: a.st.SendOnce, Now: a.now,
		RecordClaim: func(i *messaging.SendIntent) {
			a.log(a.st.order(i.CaseID), i.To, intentAction(i), "attempted", map[string]any{"intent": i.ID}, logMore{refs: intentRefs(i)})
		},
		RecordEnding: func(i *messaging.SendIntent, ending, note string) {
			a.log(a.st.order(i.CaseID), i.To, intentAction(i), ending, map[string]any{"intent": i.ID}, logMore{notes: note, refs: intentRefs(i)})
		},
		Deliver: a.deliverIntent, Settle: a.settleIntent, Notify: a.tellIntent,
		Save: func() {
			if err := save(); err != nil {
				a.c.Log("The step's messages could not be saved: " + err.Error())
			}
		},
		Log: a.c.Log,
	})
}

var _ runtime.AfterSaver = (*Agent)(nil)

func (a *Agent) unsureOf(o *Order) *messaging.SendIntent {
	if o.State != "send_unknown" || a.st.SendOnce == nil {
		return nil
	}
	for _, i := range messaging.OpenUnknowns(a.st.SendOnce, orderKind) {
		if i.CaseID == o.ID {
			return i
		}
	}
	return nil
}

func (a *Agent) refusedOf(o *Order) *messaging.SendIntent {
	if o.State != "approved" || a.st.SendOnce == nil {
		return nil
	}
	for _, i := range messaging.OpenRefusals(a.st.SendOnce, orderKind) {
		if i.CaseID == o.ID {
			return i
		}
	}
	return nil
}

func (a *Agent) onTryNow(o *Order) {
	i := a.refusedOf(o)
	if i == nil || messaging.RetryNow(a.st.sendOnce(), i.ID) == nil {
		return
	}
	a.log(o, a.owner(), "owner_decision", "confirmed", map[string]any{"decision": "try_now", "intent": i.ID}, logMore{notes: "the owner asked to try the refused order message now; nothing was sent yet", refs: map[string]string{"evidence": "owner_marked", "intent": i.ID}})
}

func (a *Agent) onCancelRefused(o *Order) {
	i := a.refusedOf(o)
	if i == nil {
		return
	}
	i.Status = "gave_up"
	o.State = "send_failed"
	a.onCancel(o)
}

func (a *Agent) onGotIt(o *Order) {
	u := a.unsureOf(o)
	if u == nil || messaging.ResolveUnknown(a.st.sendOnce(), u.ID, "owner_got_it") == nil {
		return
	}
	o.State = "sent"
	a.log(o, a.owner(), "owner_decision", "confirmed", map[string]any{"decision": "supplier_got_it", "intent": u.ID}, logMore{notes: "the owner says the supplier got the order; nothing was sent", refs: map[string]string{"evidence": "owner_marked", "intent": u.ID}})
}

func (a *Agent) onSendAgain(o *Order) {
	u := a.unsureOf(o)
	if u == nil || messaging.ResolveUnknown(a.st.sendOnce(), u.ID, "owner_send_again") == nil {
		return
	}
	o.State = "approved"
	a.log(o, a.owner(), "owner_decision", "confirmed", map[string]any{"decision": "send_again", "intent": u.ID}, logMore{notes: "the owner chose to send the order again, knowing the first may have reached the supplier", refs: map[string]string{"evidence": "owner_marked", "intent": u.ID}})
	a.queueOrder(o)
}

// ---- the supplier answers ---------------------------------------------------------------------------------------------------------------------------

func (a *Agent) onSupplierMessage(m messaging.InboundMessage, sp *Supplier) {
	replyID := ""
	if m.Reply != nil {
		replyID = m.Reply.ID
	}
	a.log(nil, m.From, "receive_message", "confirmed", map[string]any{"text": m.Text, "reply": nilIfEmpty(replyID)}, logMore{refs: map[string]string{"from": "supplier", "supplier": sp.ID, "messageId": m.ID}})
	if understanding.IsStop(language.Canon(m.Text)) {
		if !a.st.optedOut(digits(m.From)) { // a Set in TypeScript: a second STOP adds nothing
			a.st.OptedOut = append(a.st.OptedOut, digits(m.From))
		}
		a.log(nil, m.From, "opt_out", "confirmed", map[string]any{}, logMore{refs: map[string]string{"supplier": sp.ID}})
		a.tellOwner(nil, one("owner_supplier_stopped"), &sayExtra{facts: facts{"supplierName": sp.Name}})
		return
	}
	var tapped []string
	if replyID != "" {
		tapped = tapRe.FindStringSubmatch(replyID)
	}
	answerRef := ""
	if tapped != nil {
		answerRef = tapped[2]
	} else {
		answerRef = orderRefOf(m.Text)
	}
	t := language.Canon(m.Text)
	var yes, no bool
	if tapped != nil {
		yes, no = tapped[1] == "ack", tapped[1] == "nack"
	} else {
		yes, no = yesRe.Test(t) && !noRe.Test(t), noRe.Test(t) && !yesRe.Test(t)
	}
	waiting := a.st.unansweredFor(sp.ID)
	var target *Order
	if answerRef != "" {
		target = a.st.order(answerRef)
	} else if len(waiting) == 1 {
		target = waiting[0]
	}
	if target != nil && target.Supplier != sp.ID {
		a.log(target, m.From, "supplier_reply", "blocked", map[string]any{}, logMore{notes: "that order is not this supplier's"})
		return
	}
	refs := func() facts {
		ids := make([]string, len(waiting))
		for i, o := range waiting {
			ids[i] = o.ID
		}
		return facts{"refs": ids}
	}
	if !yes && !no {
		switch {
		case len(waiting) == 0:
		case len(waiting) == 1:
			a.tellSupplier(waiting[0], sp, "supplier_unclear", nil)
		default:
			a.tellSupplier(waiting[0], sp, "supplier_which", &sayExtra{facts: refs()})
		}
		return
	}
	if target == nil {
		if len(waiting) > 1 {
			a.tellSupplier(waiting[0], sp, "supplier_which", &sayExtra{facts: refs()})
		} else {
			a.log(nil, m.From, "supplier_reply", "blocked", map[string]any{}, logMore{notes: "no order of this supplier is waiting for an answer"})
		}
		return
	}
	if target.Ack != "none" || (target.State != "sent" && target.State != "send_unknown") {
		a.log(target, m.From, "supplier_reply", "blocked", map[string]any{}, logMore{notes: "this order was answered already or is not out with the supplier"})
		return
	}
	now := a.now()
	if yes {
		target.Ack = "accepted"
	} else {
		target.Ack = "declined"
	}
	target.AckMs = &now
	for i := range target.Asks {
		target.Asks[i].Sent = true
	}
	if !yes {
		target.State = "supplier_declined"
	} else if target.State == "send_unknown" {
		target.State = "sent"
	}
	a.log(target, m.From, "supplier_reply", "confirmed", map[string]any{"answer": target.Ack}, logMore{refs: map[string]string{"evidence": "supplier_reply", "supplier": sp.ID, "messageId": m.ID}})
	if yes {
		a.tellSupplier(target, sp, "supplier_thanks_yes", nil)
		a.tellOwner(target, one("owner_supplier_accepted"), nil)
	} else {
		a.tellSupplier(target, sp, "supplier_thanks_no", nil)
		a.tellOwner(target, one("owner_supplier_declined"), nil)
	}
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ---- the owner's commands about an order ------------------------------------------------------------------------------------------------------------

func (a *Agent) targetOf(r reading, fits func(*Order) bool) *Order {
	if r.Ref != "" {
		return a.st.order(r.Ref)
	}
	var all []*Order
	for _, o := range a.st.Orders {
		if fits(o) && (r.Item == "" || o.Item == r.Item) {
			all = append(all, o)
		}
	}
	if len(all) == 1 {
		return all[0]
	}
	return nil
}

func (a *Agent) onCommand(r reading, m messaging.InboundMessage) {
	o := a.targetOf(r, func(x *Order) bool {
		switch r.Command {
		case "change":
			return x.State == "awaiting_approval"
		case "send":
			return x.State == "send_failed"
		case "cancel":
			return x.State == "awaiting_approval" || x.State == "send_failed" || x.State == "send_blocked"
		}
		return holdsBudget(x)
	})
	if o == nil {
		if r.Ref != "" {
			a.tellOwner(nil, one("no_such_order"), &sayExtra{facts: facts{"orderRef": r.Ref}})
		} else {
			a.tellStatus()
		}
		return
	}
	switch r.Command {
	case "receive":
		a.onReceipt(o, r.Qty, false, m)
	case "wrong":
		a.onReceipt(o, nil, true, m)
	case "paid":
		a.onPaid(o)
	case "cancel":
		a.onCancel(o)
	case "send":
		a.onResend(o)
	case "change":
		a.onChange(o, r.Qty)
	}
}

func (a *Agent) notOpen(o *Order) {
	a.tellOwner(o, one("order_not_open"), &sayExtra{facts: facts{"stateWord": a.stateWord(o)}})
}

func (a *Agent) onReceipt(o *Order, said *int64, wrong bool, m messaging.InboundMessage) {
	if !holdsBudget(o) || o.Receipt == "full" || o.Receipt == "wrong_item" {
		a.notOpen(o)
		return
	}
	remaining := o.Qty - o.ReceivedQty
	now := a.now()
	if wrong {
		o.Receipt, o.ReceiptMs = "wrong_item", &now
		a.log(o, a.owner(), "mark_receipt", "confirmed", map[string]any{"receipt": "wrong_item"}, logMore{refs: map[string]string{"evidence": "owner_marked", "receipt": "wrong_item", "messageId": m.ID}})
		a.tellOwner(o, one("received_wrong"), nil)
		return
	}
	qty := remaining
	if said != nil {
		qty = *said
	}
	if qty < 1 || qty > remaining {
		a.tellOwner(o, one("receive_too_many"), &sayExtra{facts: facts{"saidQty": qty, "moreQty": remaining, "receivedQty": o.ReceivedQty}})
		return
	}
	o.ReceivedQty += qty
	if o.ReceivedQty >= o.Qty {
		o.Receipt = "full"
	} else {
		o.Receipt = "part"
	}
	o.ReceiptMs = &now
	a.syncDeliveries()
	a.log(o, a.owner(), "mark_receipt", "confirmed", map[string]any{"qty": qty, "receivedQty": o.ReceivedQty}, logMore{refs: map[string]string{"evidence": "owner_marked", "receipt": o.Receipt, "messageId": m.ID}})
	t := "received_part"
	if o.Receipt == "full" {
		t = "received_full"
	}
	a.tellOwner(o, one(t), &sayExtra{facts: facts{"receivedQty": o.ReceivedQty, "moreQty": o.Qty - o.ReceivedQty}})
}

func (a *Agent) onPaid(o *Order) {
	if !holdsBudget(o) {
		a.notOpen(o)
		return
	}
	now := a.now()
	o.PaidOutside = &now
	a.log(o, a.owner(), "mark_paid_outside", "confirmed", map[string]any{}, logMore{notes: "the owner says they paid the supplier themselves; this agent pays nothing and cannot check it", refs: map[string]string{"evidence": "owner_marked"}})
	a.tellOwner(o, one("paid_outside_noted"), nil)
}

func (a *Agent) onCancel(o *Order) {
	if o.State == "awaiting_approval" {
		st := a.cards()
		for i := range st.Cards {
			if st.Cards[i].State == "open" && st.Cards[i].Action.Case == o.ID {
				st.Close(&st.Cards[i], "void", a.now())
			}
		}
	} else if o.State != "send_failed" && o.State != "send_blocked" {
		t := "order_not_open"
		if holdsBudget(o) {
			t = "cannot_cancel"
		}
		a.tellOwner(o, one(t), &sayExtra{facts: facts{"stateWord": a.stateWord(o)}})
		return
	}
	o.State = "cancelled"
	a.log(o, a.owner(), "owner_decision", "confirmed", map[string]any{"decision": "cancel"}, logMore{notes: "cancelled before it was with the supplier; the budget is released", refs: map[string]string{"evidence": "owner_marked"}})
	a.tellOwner(o, one("cancelled"), nil)
}

func (a *Agent) onResend(o *Order) {
	if o.State != "send_failed" {
		a.notOpen(o)
		return
	}
	o.State = "approved"
	a.log(o, a.owner(), "owner_decision", "confirmed", map[string]any{"decision": "send_again"}, logMore{refs: map[string]string{"evidence": "owner_marked"}})
	a.queueOrder(o)
}

func (a *Agent) onChange(o *Order, qty *int64) {
	if qty == nil {
		a.didntUnderstand()
		return
	}
	if o.State != "awaiting_approval" {
		a.notOpen(o)
		return
	}
	l := a.currentLine(o)
	if q := checkQuantity(*qty, a.s.Limits.MaxQuantity); q.Verdict != "allow" {
		a.tellOwner(a.draftOf(*l, *qty), one("blocked_qty"), &sayExtra{facts: facts{"saidQty": *qty, "maxQty": a.s.Limits.MaxQuantity}})
		return
	}
	o.Qty = *qty
	o.UnitPaise = paise(l.PriceInr)
	o.TotalPaise = o.UnitPaise * *qty
	a.log(o, a.owner(), "change_order", "held_for_owner", map[string]any{"qty": *qty, "totalPaise": o.TotalPaise}, logMore{notes: "the order changed, so its earlier card no longer counts"})
	a.recheckAndShow(o, one("card_changed"))
}

func (a *Agent) tellStatus() {
	month := monthOf(a.now(), a.s.Timezone)
	var open []*Order
	for _, o := range a.st.Orders {
		if o.State == "awaiting_approval" || isOpen(o) {
			open = append(open, o)
		}
	}
	if len(open) > 8 {
		open = open[len(open)-8:]
	}
	lang := a.ownerLanguage()
	rows := make([]statusRow, len(open))
	for i, o := range open {
		rows[i] = statusRow{Ref: o.ID, ItemName: nameIn(a.s.itemOf(o.Item).Names, lang), UnitName: nameIn(a.s.unitOf(o.Unit).Names, lang), SupplierName: a.s.supplierOf(o.Supplier).Name,
			Qty: o.Qty, ReceivedQty: o.ReceivedQty, TotalInr: float64(o.TotalPaise) / 100, StateWord: a.stateWord(o)}
	}
	t := "status"
	if len(open) == 0 {
		t = "status_empty"
	}
	a.tellOwner(nil, one(t), &sayExtra{facts: facts{"lines": rows, "budgetInr": a.s.Limits.MonthlyBudgetInr, "reservedInr": float64(a.st.reservedPaise(month, "")) / 100, "monthLabel": a.monthLabel(a.now())}})
}

// ---- reading a request, and asking what it cannot tell ---------------------------------------------------------------------------------------------

func (a *Agent) settle(requestID string, lowStock bool, l Line, qty *int64, phone string) {
	if qty == nil && lowStock && l.ReorderQty > 0 {
		q := l.ReorderQty
		qty = &q
	}
	if qty == nil {
		a.st.Asking = &Asking{Kind: "qty", RequestID: requestID, LowStock: lowStock, Item: l.Item, Options: []string{lineKey(l)}, AskedMs: a.now()}
		a.tellOwner(a.draftOf(l, 1), one("ask_qty"), nil)
		return
	}
	a.propose(requestID, lowStock, l, *qty, phone)
}

func (a *Agent) askWhich(requestID string, lowStock bool, item string, qty *int64, lines []Line) {
	if len(lines) > 10 {
		lines = lines[:10]
	}
	options := make([]string, len(lines))
	for i, l := range lines {
		options[i] = lineKey(l)
	}
	a.st.Asking = &Asking{Kind: "line", RequestID: requestID, LowStock: lowStock, Item: item, Qty: qty, Options: options, AskedMs: a.now()}
	a.tellOwner(nil, one("ask_line"), &sayExtra{offer: "choices", options: options, facts: facts{"itemName": nameIn(a.s.itemOf(item).Names, a.ownerLanguage())}})
}

func (a *Agent) onRequest(r reading, m messaging.InboundMessage) {
	lang := a.ownerLanguage()
	unknownItem := func() { a.tellOwner(nil, one("item_unknown"), &sayExtra{facts: facts{"options": a.itemNames(lang)}}) }
	if r.Item == "" {
		unknownItem()
		return
	}
	if r.UnknownSupplier != "" || (r.Supplier != "" && !a.s.supplierOf(r.Supplier).Approved) {
		var named *Supplier
		if r.Supplier != "" {
			named = a.s.supplierOf(r.Supplier)
		}
		d := checkApprovedSupplier(named, r.UnknownSupplier)
		sup := r.Supplier
		if sup == "" {
			sup = "unknown"
		}
		a.log(nil, a.owner(), "propose_order", "blocked", map[string]any{"requestId": m.ID, "supplier": sup}, logMore{decisions: []messaging.Decision{d}, notes: d.Reason})
		name := r.UnknownSupplier
		if named != nil {
			name = named.Name
		}
		a.tellOwner(nil, one("blocked_supplier"), &sayExtra{facts: facts{"supplierName": name}})
		return
	}
	var lines []Line
	for _, l := range a.s.Catalogue {
		if l.Item == r.Item {
			lines = append(lines, l)
		}
	}
	if len(lines) == 0 {
		unknownItem()
		return
	}
	approvedOf := func(ls []Line) []Line {
		var out []Line
		for _, l := range ls {
			if a.s.supplierOf(l.Supplier).Approved {
				out = append(out, l)
			}
		}
		return out
	}
	if r.Supplier != "" {
		var theirs []Line
		for _, l := range lines {
			if l.Supplier == r.Supplier {
				theirs = append(theirs, l)
			}
		}
		if len(theirs) > 0 {
			lines = theirs
		} else {
			lines = approvedOf(lines)
		}
	} else {
		ok := approvedOf(lines)
		if len(ok) == 0 {
			sp := a.s.supplierOf(lines[0].Supplier)
			d := checkApprovedSupplier(sp, "")
			a.log(nil, a.owner(), "propose_order", "blocked", map[string]any{"requestId": m.ID}, logMore{decisions: []messaging.Decision{d}, notes: d.Reason})
			a.tellOwner(nil, one("blocked_supplier"), &sayExtra{facts: facts{"supplierName": sp.Name}})
			return
		}
		lines = ok
	}
	if len(lines) == 0 {
		unknownItem()
		return
	}
	if r.Unit != "" {
		var byUnit []Line
		for _, l := range lines {
			if l.Unit == r.Unit {
				byUnit = append(byUnit, l)
			}
		}
		if len(byUnit) > 0 {
			lines = byUnit // else the unit asked for is not sold that way: the owner is asked, nothing is converted
		}
	}
	if len(lines) == 1 && (r.Unit == "" || lines[0].Unit == r.Unit) {
		a.settle(m.ID, r.LowStock, lines[0], r.Qty, a.owner())
		return
	}
	a.askWhich(m.ID, r.LowStock, r.Item, r.Qty, lines)
}

func (a *Agent) onAnswer(m messaging.InboundMessage, q *Asking) bool {
	if a.now()-q.AskedMs > askingForMs {
		a.st.Asking = nil
		return false
	}
	if q.Kind == "qty" {
		n := quantityIn(m.Text)
		if n == nil {
			return false
		}
		a.st.Asking = nil
		a.propose(q.RequestID, q.LowStock, *a.s.lineByKey(q.Options[0]), *n, a.owner())
		return true
	}
	key := ""
	var picked []string
	if m.Reply != nil {
		picked = pickRe.FindStringSubmatch(m.Reply.ID)
	}
	if picked != nil {
		if i, _ := strconv.Atoi(picked[1]); i < len(q.Options) {
			key = q.Options[i]
		}
	} else {
		wd := padded(m.Text)
		sp, un := supplierIn(a.s, wd), unitIn(a.s, wd)
		var fit []*Line
		for _, k := range q.Options {
			l := a.s.lineByKey(k)
			if (sp == "" || l.Supplier == sp) && (un == "" || l.Unit == un) {
				fit = append(fit, l)
			}
		}
		if (sp != "" || un != "") && len(fit) == 1 {
			key = lineKey(*fit[0])
		}
	}
	if key == "" {
		return false
	}
	a.st.Asking = nil
	qty := q.Qty
	if qty == nil {
		text := m.Text
		if picked != nil {
			text = ""
		}
		qty = quantityIn(text)
	}
	a.settle(q.RequestID, q.LowStock, *a.s.lineByKey(key), qty, a.owner())
	return true
}

// ---- inbound ----------------------------------------------------------------------------------------------------------------------------------------

func (a *Agent) isOrderCard(c *assistant.Card) bool {
	var kind string
	_ = json.Unmarshal(c.Proposal["kind"], &kind)
	return c.Action.Skill == skillName && kind == "order"
}

func (a *Agent) onOwnerMessage(m messaging.InboundMessage) {
	replyID := ""
	if m.Reply != nil {
		replyID = m.Reply.ID
	}
	a.log(nil, a.owner(), "receive_message", "confirmed", map[string]any{"text": m.Text, "reply": nilIfEmpty(replyID)}, logMore{refs: map[string]string{"from": "owner", "messageId": m.ID}})
	// cards.ts parseCardReply: a tap on a card's button, or "yes CODE" / "no CODE" typed
	answer, code := "", ""
	if mm := buttonRe.FindStringSubmatch(replyID); mm != nil {
		answer, code = mm[1], strings.ToUpper(mm[2])
	} else if mm := typedRe.FindStringSubmatch(m.Text); mm != nil {
		answer, code = strings.ToLower(mm[1]), strings.ToUpper(mm[2])
	}
	if code != "" {
		found := a.cardByCode(code)
		if a.asst != nil && found != nil && !a.isOrderCard(found) {
			_, _ = a.asst.OnOwnerMessage(m)
			return
		}
		a.applyVerdict(assistant.JudgeCard(found, answer, a.now(), a.currentOf))
		return
	}
	r := readOwnerText(a.s, m.Text)
	if a.asst != nil && r.Kind == "status" && a.c.LooksLikeLimitRule(m.Text) {
		if took, _ := a.asst.OnOwnerMessage(m); took {
			return
		}
	}
	if a.st.Asking != nil && !(r.Kind == "command" || r.Kind == "status" || (r.Kind == "order" && r.Item != "")) {
		if a.onAnswer(m, a.st.Asking) {
			return
		}
	} else if a.st.Asking != nil && strings.HasPrefix(replyID, "pick:") {
		if a.onAnswer(m, a.st.Asking) {
			return
		}
	}
	switch r.Kind {
	case "status":
		a.tellStatus()
	case "command":
		if r.Command == "change" && r.Ref != "" {
			if o := a.st.order(r.Ref); o != nil && holdsBudget(o) {
				a.tellOwner(o, one("cannot_change"), nil)
				return
			}
		}
		a.onCommand(r, m)
	case "order":
		if len(r.Tied) > 0 {
			a.tellOwner(nil, one("item_unknown"), &sayExtra{facts: facts{"options": a.itemNames(a.ownerLanguage())}})
			return
		}
		a.onRequest(r, m)
	default:
		if a.asst != nil {
			if took, _ := a.asst.OnOwnerMessage(m); took {
				return
			}
		}
		a.didntUnderstand()
	}
}

func (a *Agent) handleMessage(m messaging.InboundMessage) {
	if a.st.handled(m.ID) {
		a.log(nil, m.From, "receive_message", "blocked", map[string]any{}, logMore{notes: "this message was delivered twice and handled once", refs: map[string]string{"messageId": m.ID}})
		return
	}
	a.st.Handled = append(a.st.Handled, m.ID)
	if len(a.st.Handled) > handledKeep {
		a.st.Handled = a.st.Handled[len(a.st.Handled)-handledKeep:]
	}
	if digits(m.From) == digits(a.owner()) {
		a.onOwnerMessage(m)
		return
	}
	if sp := a.supplierByNumber(m.From); sp != nil {
		a.onSupplierMessage(m, sp)
		return
	}
	a.log(nil, m.From, "receive_message", "blocked", map[string]any{}, logMore{notes: "this number is neither the owner's nor a listed supplier's, so nothing is done", refs: map[string]string{"messageId": m.ID}})
}

// ---- the shop's stock count (internal/stock) --------------------------------------------------------------------------------------------------------

func (a *Agent) talkToOwner(text string) { a.cards().AddTalk("assistant", text, a.now()) }

func (a *Agent) itemNameOf(id string) string { return nameIn(a.s.itemOf(id).Names, a.ownerLanguage()) }

// syncDeliveries is agent.ts syncDeliveries: deliveries the owner marked received are added to a COUNTED item's count once per purchase order, by the quantity received so far.
func (a *Agent) syncDeliveries() {
	st := a.c.Snap.Stock
	if st == nil || len(st.Lines) == 0 {
		return
	}
	now := a.now()
	var fs []stock.DeliveryFact
	for _, o := range a.st.Orders {
		rm := int64(0)
		if o.ReceiptMs != nil {
			rm = *o.ReceiptMs
		}
		if o.ReceivedQty > 0 && (o.Receipt != "full" || now-rm <= stock.FactHorizonMs) {
			f := stock.DeliveryFact{Key: "delivery:" + o.ID, ID: stock.SupplyID(o.Item), Cumulative: o.ReceivedQty, Unit: o.Unit}
			if o.ReceiptMs != nil {
				v := *o.ReceiptMs
				f.AtMs = &v
			}
			fs = append(fs, f)
		}
	}
	before := countsOf(st)
	refused := st.ReconcileDeliveries(stock.ShopRecord(), fs, now)
	if countsOf(st) != before {
		a.log(nil, a.owner(), stock.Action, "confirmed", map[string]any{"deliveries": len(fs)}, logMore{refs: stock.Refs("supply:*", "received", "shop"), notes: "goods the owner marked received were added to the stock count (each purchase order once, by the quantity received so far)"})
	}
	for _, f := range refused {
		o := a.st.order(strings.TrimPrefix(f.Key, "delivery:"))
		a.log(o, a.owner(), stock.Action, "blocked", map[string]any{"delivery": f.Key, "unit": f.Unit}, logMore{refs: stock.Refs(f.ID, "received", "shop"), notes: "the delivery is in another unit than the count, so it was not added; units are never converted"})
		unit := ""
		if l := st.LineOf(f.ID); l != nil {
			unit = l.Unit
		}
		a.talkToOwner(stockLine(a.ownerLanguage(), "unitRefused", map[string]string{"name": a.itemNameOf(strings.TrimPrefix(f.ID, "supply:")), "unit": unit}))
	}
}

func countsOf(st *stock.Stock) string {
	var b strings.Builder
	for i, l := range st.Lines {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatInt(l.Count, 10))
	}
	return b.String()
}

// lowStockTick is agent.ts lowStockTick: ONE reorder per crossing, through the existing flow (a card for the owner's yes; nothing is approved here).
func (a *Agent) lowStockTick() {
	st := a.c.Snap.Stock
	if st == nil {
		return
	}
	for _, al := range st.PendingAlerts("supply") {
		itemID := strings.TrimPrefix(al.Line, "supply:")
		requestID := stock.LowRequestID(al.Line, al.Crossing)
		known := false
		for _, i := range a.s.Items {
			known = known || i.ID == itemID
		}
		_, made := a.st.request(requestID)
		if l := st.LineOf(al.Line); l == nil || !l.LowFlag || !known || made {
			st.AckAlert(al.Line, al.Crossing)
			continue
		}
		if a.st.Asking != nil {
			return // the owner is in the middle of another question: wait, never overwrite it
		}
		if al.Asked >= maxLowAsks {
			st.AckAlert(al.Line, al.Crossing)
			continue
		}
		var lines []Line
		for _, l := range a.approvedLines() {
			if l.Item == itemID {
				lines = append(lines, l)
			}
		}
		asked := st.NoteAsked(al.Line, al.Crossing)
		if asked == 1 {
			a.log(nil, a.owner(), stock.Action, "confirmed", map[string]any{"item": al.Line, "count": al.Count, "crossing": al.Crossing}, logMore{refs: stock.Refs(al.Line, "low", "shop"), notes: "a counted item fell to its low mark; the reorder flow was started (nothing is approved by this)"})
		}
		n := strconv.FormatInt(al.Count, 10)
		if len(lines) == 0 {
			a.talkToOwner(stockLine(a.ownerLanguage(), "runningLow", map[string]string{"name": a.itemNameOf(itemID), "n": n}))
			st.AckAlert(al.Line, al.Crossing)
			continue
		}
		// agent.ts's alert is the queue's own object, so noteAsked has already counted this question: the first one says which item is low
		if asked == 1 {
			a.talkToOwner(stockLine(a.ownerLanguage(), "reorderAsk", map[string]string{"name": a.itemNameOf(itemID), "n": n, "supplier": a.s.supplierOf(lines[0].Supplier).Name}))
		}
		if len(lines) == 1 {
			a.settle(requestID, true, lines[0], nil, a.owner())
		} else {
			a.askWhich(requestID, true, itemID, nil, lines)
		}
		if a.st.Asking == nil {
			st.AckAlert(al.Line, al.Crossing)
		}
		return
	}
}

// ---- the clock --------------------------------------------------------------------------------------------------------------------------------------

func (a *Agent) tick() {
	now := a.now()
	if a.st.Asking != nil && now-a.st.Asking.AskedMs > askingForMs {
		a.st.Asking = nil
	}
	a.syncDeliveries()
	a.lowStockTick()
	cards := a.cards()
	for _, o := range a.st.Orders {
		if o.State != "awaiting_approval" {
			continue
		}
		has := false
		for _, c := range cards.OpenCards(now) {
			has = has || (c.Action.Skill == skillName && c.Action.Kind == "order" && c.Action.Case == o.ID)
		}
		if !has {
			o.State = "void"
			a.log(o, a.owner(), "owner_decision", "blocked", map[string]any{"decision": "expired"}, logMore{notes: "the card ran out; nothing was sent"})
			a.tellOwner(o, one("card_expired"), nil)
		}
	}
	for _, c := range cards.Expire(now) {
		if o := a.st.order(c.Action.Case); o != nil && o.State == "awaiting_approval" {
			o.State = "void"
			a.log(o, a.owner(), "owner_decision", "blocked", map[string]any{"decision": "expired", "card": c.ID}, logMore{notes: "the card ran out; nothing was sent"})
			a.tellOwner(o, one("card_expired"), nil)
		}
	}
	for _, o := range append([]*Order{}, a.st.Orders...) {
		if o.Ack != "none" || (o.State != "sent" && o.State != "send_unknown") || len(o.Asks) == 0 {
			continue
		}
		due := false
		for i := range o.Asks {
			if !o.Asks[i].Sent && o.Asks[i].AtMs <= now {
				o.Asks[i].Sent, due = true, true
			}
		}
		if !due {
			continue
		}
		a.queueCheck(o)
		all := true
		for _, r := range o.Asks {
			all = all && r.Sent
		}
		if all && o.SilentTold == nil {
			o.SilentTold = &now
			sent := now
			if o.SentMs != nil {
				sent = *o.SentMs
			}
			hours := int64(jsRound(float64(now-sent) / float64(hour)))
			a.tellOwner(o, one("owner_supplier_silent"), &sayExtra{facts: facts{"hours": hours}})
		}
	}
}

// ---- the owner's page -------------------------------------------------------------------------------------------------------------------------------

func (a *Agent) onOwnerAction(ev map[string]any) {
	action, _ := ev["action"].(string)
	caseID, _ := ev["case"].(string)
	digest, _ := ev["digest"].(string)
	eventID, _ := ev["id"].(string)
	page := map[string]string{"channel": "owner_page", "action": action}
	if action == "card_yes" || action == "card_no" {
		found := a.cards().CardByID(caseID)
		answer := "no"
		if action == "card_yes" {
			answer = "yes"
		}
		if found != nil && !a.isOrderCard(found) {
			if a.asst == nil {
				a.log(nil, a.owner(), "owner_page_action", "blocked", map[string]any{"action": action, "case": caseID}, logMore{refs: page, notes: "a card's answer came for a shop without the assistant: nothing was done"})
				return
			}
			a.asst.OnPageCard(caseID, digest, answer)
			return
		}
		if found == nil || found.Digest != digest {
			a.log(nil, a.owner(), "owner_page_action", "blocked", map[string]any{"action": action, "case": caseID}, logMore{refs: page, notes: "the owner's page showed a card that is not the one waiting now: nothing was done"})
			return
		}
		a.log(nil, a.owner(), "owner_page_action", "confirmed", map[string]any{"action": action, "case": caseID}, logMore{refs: page, notes: "pressed by the owner on their page; the card's own binding decides, as for a tap on WhatsApp"})
		a.applyVerdict(assistant.JudgeCard(found, answer, a.now(), a.currentOf))
		return
	}
	var item *ownerItem
	for _, x := range ownerItems(a.s, a.st, a.now(), a.cards()) {
		if x.Case == caseID && x.Digest == digest && contains(x.Actions, action) {
			x := x
			item = &x
			break
		}
	}
	o := a.st.order(caseID)
	if item == nil || o == nil {
		a.log(o, a.owner(), "owner_page_action", "blocked", map[string]any{"action": action, "case": caseID}, logMore{refs: page, notes: "what the owner's page showed is not what waits now (already answered or changed): nothing was done"})
		return
	}
	a.log(o, a.owner(), "owner_page_action", "confirmed", map[string]any{"action": action, "case": caseID}, logMore{refs: page, notes: "pressed by the owner on their page; done exactly as the same words on WhatsApp"})
	switch action {
	case "received":
		a.onReceipt(o, nil, false, messaging.InboundMessage{ID: "owner-page:" + eventID, From: a.owner(), Timestamp: a.now()})
	case "retry":
		a.askSupplierAgain(o)
	case "try_now":
		a.onTryNow(o)
	case "cancel_order":
		a.onCancelRefused(o)
	case "got_it":
		a.onGotIt(o)
	case "send_again":
		a.onSendAgain(o)
	}
}

func contains(l []string, x string) bool {
	for _, v := range l {
		if v == x {
			return true
		}
	}
	return false
}

func (a *Agent) askSupplierAgain(o *Order) {
	if o.Ack != "none" || (o.State != "sent" && o.State != "send_unknown") {
		return
	}
	now := a.now()
	o.AskedMs = &now
	a.queueCheck(o)
}

// ---- the step ---------------------------------------------------------------------------------------------------------------------------------------

// Handle is agent.ts dispatch for one event.
func (a *Agent) Handle(ev map[string]any) error {
	switch ev["kind"] {
	case "message":
		raw, _ := json.Marshal(ev["message"])
		var m messaging.InboundMessage
		if err := json.Unmarshal(raw, &m); err != nil {
			return err
		}
		a.handleMessage(m)
	case "owner_action":
		a.onOwnerAction(ev)
	case "owner_message":
		id, _ := ev["id"].(string)
		text, _ := ev["text"].(string)
		if a.asst == nil {
			a.log(nil, a.owner(), "owner_page_message", "blocked", map[string]any{}, logMore{refs: map[string]string{"channel": "owner_page"}, notes: "the owner's talk box is the shop's assistant's, and this shop has none: nothing was read"})
			return nil
		}
		return a.asst.OnPageMessage(id, text, a.now())
	}
	// every other kind (a sign-in, a recovery, a payment event) is the runtime's own: Stock orders has no payments and nothing to recover by hand
	return nil
}

// Tick is agent.ts dispatch for the clock's beat, then the assistant's.
func (a *Agent) Tick() error {
	a.tick()
	if a.asst != nil {
		a.asst.OnTick()
	}
	return nil
}

// GiveUp: Stock orders' steps never wait for a Guard (Deferred.md), so nothing is to be written.
func (a *Agent) GiveUp(map[string]any, string, bool) error { return nil }
