package stockorders

// The shop's assistant skill for Stock orders: the Go twin of src/assistant.ts stockSkill, over one step's store (runtime.OwnerSkill). Its READS are the orders that wait for
// the owner's yes and the ones the owner must look at; its ACTS are this agent's own paths (approve, decline, cancel), so a card made by the assistant for an order has the same
// digest as the agent's own card (approvalAction) and a change under either voids both.
//
// Ported 23 Nov (stream SG, proved by testdata/skill-vectors.json made by go/scripts/gen_stockorders_skill_vectors.ts): the talk's reads (`facts`, `publicContext`) and the open list
// (`open`). Not ported (Deferred.md): the routing words (the router here recognises a case by its reference, Owns, and the skill's own words are not used to guess a skill).

import (
	"encoding/json"
	"regexp"
	"strconv"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

var poRef = regexp.MustCompile(`^po-\d{1,6}$`)

type skill struct{ a *Agent }

var (
	_ runtime.OwnerSkill     = (*skill)(nil)
	_ runtime.OpenSkill      = (*skill)(nil)
	_ runtime.TalkFactsSkill = (*skill)(nil)
	_ runtime.PublicSkill    = (*skill)(nil)
)

func (*skill) Name() string         { return skillName }
func (*skill) Owns(ref string) bool { return poRef.MatchString(ref) }

func rawStr(r json.RawMessage) string {
	var s string
	_ = json.Unmarshal(r, &s)
	return s
}

func (k *skill) who(o *Order) string  { return k.a.s.supplierOf(o.Supplier).Name }
func (k *skill) what(o *Order) string { return whatOf(k.a.s, o) }

// Prepare is assistant.ts prepare.
func (k *skill) Prepare(p assistant.Raw) (runtime.Prepared, string) {
	a := k.a
	kind := rawStr(p["kind"])
	if kind == "limit" {
		return runtime.Prepared{}, "not_here" // limits are the limits skill's
	}
	o := a.st.order(rawStr(p["case"]))
	if o == nil {
		return runtime.Prepared{}, "no_case"
	}
	switch kind {
	case "answer":
		if o.State != "awaiting_approval" {
			return runtime.Prepared{}, "nothing_waiting"
		}
		l := a.currentLine(o)
		if l == nil {
			return runtime.Prepared{}, "not_live"
		}
		return runtime.Prepared{Action: a.approvalAction(o, l), Shown: runtime.Shown{Who: k.who(o), What: k.what(o), AmountPaise: o.TotalPaise}}, ""
	case "cancel":
		if o.State == "awaiting_approval" || o.State == "send_failed" || o.State == "send_blocked" {
			act := assistant.Action{Kind: "cancel", Skill: skillName, Case: o.ID, Fields: assistant.Raw{"who": mustRaw(k.who(o)), "state": mustRaw(o.State), "qty": mustRaw(o.Qty),
				"totalPaise": mustRaw(o.TotalPaise), "amountPaise": mustRaw(0)}}
			return runtime.Prepared{Action: act, Shown: runtime.Shown{Who: k.who(o), What: k.what(o)}}, ""
		}
		if o.State == "approved" {
			return runtime.Prepared{}, "busy"
		}
		return runtime.Prepared{}, "not_live"
	}
	return runtime.Prepared{}, "not_here" // no refund (this agent paid nothing), and no free-text message to a supplier from the chat
}

// Execute is assistant.ts execute: the agent's own paths.
func (k *skill) Execute(act assistant.Action) runtime.Executed {
	o := k.a.st.order(act.Case)
	if o == nil {
		return runtime.Executed{Note: "failed"}
	}
	ok := false
	switch act.Kind {
	case "order":
		if rawStr(act.Fields["answer"]) == "no" {
			ok = k.a.decline(o, nil)
		} else {
			ok = k.a.approve(o, nil)
		}
	case "cancel":
		k.a.onCancel(o)
		ok = o.State == "cancelled"
	}
	if ok {
		return runtime.Executed{OK: true, Note: "done"}
	}
	return runtime.Executed{Note: "failed"}
}

// Waiting is assistant.ts waiting: the orders that wait for the owner's yes.
func (k *skill) Waiting() []runtime.WaitingItem {
	var out []runtime.WaitingItem
	for _, o := range k.a.st.Orders {
		if o.State == "awaiting_approval" {
			out = append(out, runtime.WaitingItem{Case: o.ID, Kind: "order_approval", AmountPaise: o.TotalPaise, Who: k.who(o), What: k.what(o), Money: true, Yes: "approve", No: "decline"})
		}
	}
	return out
}

// Problems is assistant.ts problems: the orders the owner must look at (the supplier's silence, an order WhatsApp refused, a check held back).
func (k *skill) Problems() int {
	n := 0
	for _, o := range k.a.st.Orders {
		if o.State == "send_failed" || o.State == "send_blocked" || o.State == "send_unknown" || (o.SilentTold != nil && o.Ack == "none" && isOpen(o)) {
			n++
		}
	}
	return n
}

// Open is assistant.ts `open`: the orders that wait for the owner's yes and the ones still to arrive, in the order the store holds them.
func (k *skill) Open() []runtime.OpenRow {
	var rows []runtime.OpenRow
	for _, o := range k.a.st.Orders {
		if o.State == "awaiting_approval" || isOpen(o) {
			rows = append(rows, runtime.OpenRow{Case: o.ID, Who: k.who(o), What: k.what(o), AmountPaise: o.TotalPaise, State: o.State})
		}
	}
	return rows
}

// Facts is assistant.ts talkReads.facts: the numbers the owner's talk may rest on, counts and money only, never a supplier's number or a line of a message. The sentences are the
// TypeScript's English word for word (they are data for the model, never shown as they are), and `formatInr` is language.FormatInr.
func (k *skill) Facts(nowMs int64) []assistant.TalkSource {
	s, st := k.a.s, k.a.st
	reserved := st.reservedPaise(monthOf(nowMs, s.Timezone), "")
	var open, waiting, silent int
	for _, o := range st.Orders {
		if o.State == "awaiting_approval" {
			waiting++
		}
		if isOpen(o) {
			open++
			if o.Ack == "none" {
				silent++
			}
		}
	}
	reservedInr := float64(reserved) / 100
	return []assistant.TalkSource{
		{ID: "r:budget", Kind: "record", Text: "This month's supplier orders reserved " + language.FormatInr(reservedInr) + " of the " + language.FormatInr(s.Limits.MonthlyBudgetInr) + " budget. The most one order may be worth is " +
			language.FormatInr(s.Limits.MaxPerOrderInr) + ".", AmountsInr: []float64{reservedInr, s.Limits.MonthlyBudgetInr, s.Limits.MaxPerOrderInr}},
		{ID: "r:orders", Kind: "record", Text: "Supplier orders still to arrive: " + strconv.Itoa(open) + ". Waiting for the owner's yes: " + strconv.Itoa(waiting) + ". Not answered by the supplier: " + strconv.Itoa(silent) + "."},
	}
}

// PublicContext is assistant.ts talkReads.publicContext: what a supplier may be told about their own orders (only that supplier's own open ones: never the budget, the cap,
// another supplier's lines or the prices of other suppliers). The owner's talk reads it with no one (phone "").
func (k *skill) PublicContext(phone string, _ int64) []assistant.TalkSource {
	s := k.a.s
	out := []assistant.TalkSource{{ID: "s:shop", Kind: "setting", Text: s.Name + " orders from its suppliers on WhatsApp.", Literals: []string{s.Name}}}
	var sup *Supplier
	for i := range s.Suppliers {
		if digits(s.Suppliers[i].WhatsApp) == digits(phone) {
			sup = &s.Suppliers[i]
			break
		}
	}
	if sup == nil {
		return out
	}
	for _, o := range k.a.st.Orders {
		if o.Supplier != sup.ID || !isOpen(o) {
			continue
		}
		out = append(out, assistant.TalkSource{ID: "r:" + o.ID, Kind: "record", Literals: []string{o.ID},
			Text: "Order " + o.ID + " to this supplier: " + strconv.FormatInt(o.Qty, 10) + " " + nameIn(s.unitOf(o.Unit).Names, sup.Language) + " " + nameIn(s.itemOf(o.Item).Names, sup.Language) + "."})
	}
	return out
}
