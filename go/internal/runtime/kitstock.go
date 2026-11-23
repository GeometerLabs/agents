package runtime

// What a template's agent needs of the shared runtime beyond Bookings' (wave 2, Stock orders, 22 Nov 2026), added beside the rest so no existing call changes:
//   - the shop's one stock count for a template shop (modules/runtime/core.ts `createStockKit` with `templateItems`): a Kit that is a StockKit serves the owner's Stock page, and
//     the items it may count (Stock orders' supply items, Orders' menu) are its own, after the shop's listings;
//   - SEND ONCE after the step is saved (core.ts step: `agent.sendOnce.run(() => save(store, record))`): a Kit's agent that is an AfterSaver is called once the step's own save is
//     done, on every step and every beat, unless the licence is in its final stop; its save commits the state and the record lines so far;
//   - the assistant's state on first use, for a template agent that keeps its own cards in it (state.ts `assistantOf`).

import (
	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/listings"
)

// StockKit is a Kit whose shop counts stock (TypeScript: the stock kit exists when the settings have an assistant and an owner). StockItems are the template's own items the owner
// may start counting, in a language (core.ts templateItems).
type StockKit interface {
	StockOn() bool
	StockItems(lang string) []listings.ItemRef
}

// AfterSaver is an Agent with messages the step asked for, to send after the step is saved (send-once.ts, core.ts `agent.sendOnce`).
type AfterSaver interface {
	AfterSave(save func() error)
}

// EnsureAssistant is state.ts `assistantOf`: the assistant's state, made on first use.
func (s *Snap) EnsureAssistant() *assistant.State {
	s.ensureA()
	return s.A
}

// EnsureStock is `stockOf(store.assistant)`: the stock count, made on first use.
func (s *Snap) EnsureStock() *listings.Stock { return s.touchStock() }

// stockRefs are the items the owner could count: the shop's live listings, then the template's own items.
func (r *Runtime) stockRefs(s *Snap, lang string) []listings.ItemRef {
	refs := s.listingRefs(lang)
	if sk, ok := r.o.Kit.(StockKit); ok && r.o.Kit != nil {
		refs = append(refs, sk.StockItems(lang)...)
	}
	return refs
}

// stockOn: the owner's Stock page is served (the listings shop always; a template shop when its Kit counts stock).
func (r *Runtime) stockOn() bool {
	if r.o.Kit == nil {
		return true
	}
	sk, ok := r.o.Kit.(StockKit)
	return ok && sk.StockOn()
}

// afterSave runs a Kit agent's send-once after the step's save: the recorder goes on from the saved lines (as saveMid leaves it), so nothing is written twice.
func (r *Runtime) afterSave(agent Agent, snap *Snap, rec *recorder) {
	as, ok := agent.(AfterSaver)
	if !ok || r.licenceNow() == "stopped" {
		return
	}
	r.mu.RLock()
	rec.saved, rec.base = r.entries, len(r.entries)
	r.mu.RUnlock()
	rec.fresh = nil
	as.AfterSave(func() error { return r.saveMid(snap, rec) })
}

// LooksLikeLimitRule is limits-card.ts looksLikeLimitRule over the Kit's declared limits: "monthly budget at most ₹15,000" is a rule about a limit the owner may tighten, not a
// question (a template's agent hands it to the assistant, which makes a limit card).
func (c *StepContext) LooksLikeLimitRule(text string) bool {
	if c.rt == nil {
		return false
	}
	return (&limitsSkill{c: &conv{r: c.rt}}).looksLikeRule(text)
}
