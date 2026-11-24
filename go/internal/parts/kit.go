package parts

// The shop's runtime.Kit over its parts: the program's wiring (each part's own wire.go, in the shop's order), the counts and refunds summed over the parts, the counters moved
// in each, the declared limits of every part (each where it sits in the part's block), the one stock count's items, the chat, the sign-in link and the owner's voice from the
// part that has them.

import (
	"encoding/json"

	"github.com/GeometerLabs/agents/go/internal/listings"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

var (
	_ runtime.ChannelStater = (*Kit)(nil)
	_ runtime.SigninKit     = (*Kit)(nil)
	_ runtime.OwnerVoiceKit = (*Kit)(nil)
)

// PreCheck runs each part's own check of the folder (Stock orders: a live shop names its WhatsApp).
func (k *Kit) PreCheck(c *runtime.Client) error {
	for _, p := range k.parts {
		if pc, ok := p.Kit.(runtime.PreChecker); ok {
			if err := pc.PreCheck(c); err != nil {
				return err
			}
		}
	}
	return nil
}

// Wire wires each part as its own program would (wire.go of its template), over the one store, clock and runtime, each with its own settings.
func (k *Kit) Wire(w runtime.Wiring) error {
	for _, p := range k.parts {
		pw := w
		pw.Own = p.Own
		if err := p.Kit.Wire(pw); err != nil {
			return err
		}
	}
	return nil
}

// Started hands each part the runtime.
func (k *Kit) Started(rt *runtime.Runtime) {
	for _, p := range k.parts {
		p.Kit.Started(rt)
	}
}

func (k *Kit) stateOf(s runtime.KitState) *State { st, _ := s.(*State); return st }

// CountCases is each part's cases by state, under the part's name ("orders:confirmed").
func (k *Kit) CountCases(s runtime.KitState) map[string]int {
	st := k.stateOf(s)
	out := map[string]int{}
	for i, p := range k.parts {
		for state, n := range p.Kit.CountCases(st.parts[i]) {
			out[p.Name+":"+state] += n
		}
	}
	return out
}

// Refunds is every part's refunds, summed.
func (k *Kit) Refunds(s runtime.KitState) runtime.RefundCounts {
	st := k.stateOf(s)
	out := runtime.NoRefunds()
	for i, p := range k.parts {
		r := p.Kit.Refunds(st.parts[i])
		out.WaitingForOwner += r.WaitingForOwner
		out.BeingSentAgain += r.BeingSentAgain
		for key, n := range r.NeedBuilder {
			out.NeedBuilder[key] += n
		}
	}
	return out
}

// RefundContext is the refund held under this receipt, from the part that holds it.
func (k *Kit) RefundContext(s runtime.KitState, _ *runtime.Settings, receipt string) any {
	st := k.stateOf(s)
	for i, p := range k.parts {
		if c := p.Kit.RefundContext(st.parts[i], p.Shared, receipt); c != nil {
			return c
		}
	}
	return nil
}

// SkipCounters moves every part's counters on (after a restore).
func (k *Kit) SkipCounters(s runtime.KitState, gap int64) {
	st := k.stateOf(s)
	for i, p := range k.parts {
		p.Kit.SkipCounters(st.parts[i], gap)
	}
}

// KeepCounters keeps every part's counters at least where a thrown-away step left them.
func (k *Kit) KeepCounters(s, taken runtime.KitState) bool {
	st, tk := k.stateOf(s), k.stateOf(taken)
	moved := false
	for i, p := range k.parts {
		if tk != nil && i < len(tk.parts) && p.Kit.KeepCounters(st.parts[i], tk.parts[i]) {
			moved = true
		}
	}
	return moved
}

// Limits are every part's declared limits, each where it sits in the settings (`parts.<template>.` before the part's own path). A limit id two parts both declare is the
// first part's only: the owner's "refund limit 500" must name one limit, never two at once (the second part's stays as its settings say; Deferred.md).
func (k *Kit) Limits() []runtime.LimitDecl {
	var out []runtime.LimitDecl
	seen := map[string]bool{}
	for _, p := range k.parts {
		for _, l := range p.Kit.Limits() {
			if seen[l.ID] {
				continue
			}
			seen[l.ID] = true
			l.Path = "parts." + p.Name + "." + l.Path
			out = append(out, l)
		}
	}
	return out
}

// StockOn: the shop counts stock when any part does (one count for the shop, under the assistant's state).
func (k *Kit) StockOn() bool {
	for _, p := range k.parts {
		if sk, ok := p.Kit.(runtime.StockKit); ok && sk.StockOn() {
			return true
		}
	}
	return false
}

// StockItems are every counting part's own items, in the shop's order, each item once.
func (k *Kit) StockItems(lang string) []listings.ItemRef {
	var out []listings.ItemRef
	seen := map[string]bool{}
	for _, p := range k.parts {
		if sk, ok := p.Kit.(runtime.StockKit); ok && sk.StockOn() {
			for _, it := range sk.StockItems(lang) {
				if !seen[it.ID] {
					seen[it.ID] = true
					out = append(out, it)
				}
			}
		}
	}
	return out
}

// customerPart is the part whose customer side the shop's page and chat are: the first Orders part (it takes new customers), else the first Fees part, else none (-1).
func (k *Kit) customerPart() int {
	for _, want := range []string{"orders", "fees"} {
		for i, p := range k.parts {
			if p.Name == want {
				return i
			}
		}
	}
	return -1
}

// ChannelRaw is the chat's state: the customer part's.
func (k *Kit) ChannelRaw(s runtime.KitState) json.RawMessage {
	i := k.customerPart()
	if i < 0 {
		return nil
	}
	if cs, ok := k.parts[i].Kit.(runtime.ChannelStater); ok {
		return cs.ChannelRaw(k.stateOf(s).parts[i])
	}
	return nil
}

// SigninMessaging is the WhatsApp the owner's sign-in link goes by: the first part that sends one.
func (k *Kit) SigninMessaging() messaging.Messaging {
	for _, p := range k.parts {
		if sk, ok := p.Kit.(runtime.SigninKit); ok {
			if m := sk.SigninMessaging(); m != nil {
				return m
			}
		}
	}
	return nil
}

// OwnerVoiceOn: a part hears the owner's voice notes.
func (k *Kit) OwnerVoiceOn() bool {
	for _, p := range k.parts {
		if vk, ok := p.Kit.(runtime.OwnerVoiceKit); ok && vk.OwnerVoiceOn() {
			return true
		}
	}
	return false
}

// partIndex is the index of the part `name`, or -1.
func (k *Kit) partIndex(name string) int {
	for i, p := range k.parts {
		if p.Name == name {
			return i
		}
	}
	return -1
}
