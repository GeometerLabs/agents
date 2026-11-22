package stockorders

// The shop's assistant skill for Stock orders: the Go twin of src/assistant.ts stockSkill, over one step's store (runtime.OwnerSkill). Its READS are the orders that wait for
// the owner's yes and the ones the owner must look at; its ACTS are this agent's own paths (approve, decline, cancel), so a card made by the assistant for an order has the same
// digest as the agent's own card (approvalAction) and a change under either voids both.
//
// Not ported here (Deferred.md): the talk's reads (`facts`, `publicContext`), the open list (`open`) and the routing words: the shop's assistant here answers cards, its limits
// and the owner's page; reading the owner's open questions with a model over Stock orders' facts waits for the talk wave.

import (
	"encoding/json"
	"regexp"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

var poRef = regexp.MustCompile(`^po-\d{1,6}$`)

type skill struct{ a *Agent }

var _ runtime.OwnerSkill = (*skill)(nil)

func (*skill) Name() string           { return skillName }
func (*skill) Owns(ref string) bool   { return poRef.MatchString(ref) }

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
