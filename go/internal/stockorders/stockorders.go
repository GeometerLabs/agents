// Package stockorders is the Stock orders shop's template for the shared Go runtime (internal/runtime): decision 61, wave 2, the Go twin of templates/commerce/stock-orders (the
// settings, the store, the agent, the owner's page). It implements runtime.Kit, so the queue, the record, the owner's sign-in, passkeys, phones, push, the limits page, the owner's
// file and the HTTP face are the shared runtime's own code. It reads and writes the same files as the TypeScript runtime (agent.db schema 5, the snapshot in pieces, the record),
// so a shop can move between the two runtimes and lose nothing. What is ported and what is not is in go/TRIAL.md ("go-w5-stock-22nov") and this package's Deferred.md.
package stockorders

import (
	"encoding/json"
	"time"

	"github.com/GeometerLabs/agents/go/internal/listings"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/stock"
	"github.com/GeometerLabs/agents/go/internal/store"
)

// Pathway and Version are what a Stock orders folder's pathway.lock must name (templates/commerce/stock-orders/package.json).
const (
	Pathway = "stock-orders"
	Version = "0.2.0"
)

// Kit is the Stock orders template (runtime.Kit). The command line hands in the settings, the clock and the shop's WhatsApp once the folder is read.
type Kit struct {
	Settings *Settings
	Now      func() int64
	// WhatsApp is the shop's one service (required: the order goes to a supplier on it).
	WhatsApp messaging.Messaging
	// Report is the monthly report to the owner (report.go); nil when runtime.json has no `report` block: none is made and nothing is sent.
	Report *MonthlyReport
	shared *runtime.Settings
	// PushOwner and OwnerRoute are the owner's alerts by their choice of WhatsApp, push or both (push.ts pushMessaging; runtime.OwnerPush and OwnerRoute, set by the command once the
	// runtime exists). Nil: WhatsApp alone.
	PushOwner  func(text string) []string
	OwnerRoute func(hasWhatsApp bool) string
	// given are the Guards given up on in this outage (core.ts `givenUp`): tasks no longer wait for them until one answers. Steps run one at a time, so no lock.
	given map[string]bool
}

func (k *Kit) givenUp() map[string]bool {
	if k.given == nil {
		k.given = map[string]bool{}
	}
	return k.given
}

var (
	_ runtime.Kit      = (*Kit)(nil)
	_ runtime.StockKit = (*Kit)(nil)
)

func (k *Kit) now() int64 {
	if k.Now != nil {
		return k.Now()
	}
	return time.Now().UnixMilli()
}

func (k *Kit) Pathway() string   { return Pathway }
func (k *Kit) Version() string   { return Version }
func (k *Kit) CasesName() string { return "orders" }

// ReadSettings checks the settings the Stock orders way (settings.go) and fills the part every shop shares.
func (k *Kit) ReadSettings(in map[string]any, raw []byte, shared *runtime.Settings) (any, []string) {
	s, errs := ReadSettings(raw)
	if len(errs) > 0 {
		return nil, errs
	}
	shared.Name, shared.Timezone, shared.Language = s.Name, s.Timezone, s.Languages
	shared.Owner.Whatsapp, shared.Owner.Language = s.Owner.WhatsApp, s.Owner.Language
	shared.ReadAssistant(in["assistant"])
	k.shared = shared
	return s, nil
}

func (k *Kit) ParseState(ms []runtime.Member) (runtime.KitState, error) { return ParseStore(ms) }

func (k *Kit) NewAgent(c *runtime.StepContext) runtime.Agent { return newAgent(k, c) }

// CountCases is runtime.ts countByState: the purchase orders by state.
func (k *Kit) CountCases(st runtime.KitState) map[string]int {
	out := map[string]int{}
	for _, o := range st.(*Store).Orders {
		out[o.State]++
	}
	return out
}

// Refunds: Stock orders holds no refund.
func (k *Kit) Refunds(runtime.KitState) runtime.RefundCounts { return runtime.NoRefunds() }

// RefundContext: nothing is held for the approvals relay.
func (k *Kit) RefundContext(runtime.KitState, *runtime.Settings, string) any { return nil }

// SkipCounters moves the order counter on (snapshot.ts skipCounters: `seq` is the store's one count).
func (k *Kit) SkipCounters(st runtime.KitState, gap int64) { st.(*Store).Seq += gap }

// KeepCounters puts the counter at least where a thrown-away step's store had it.
func (k *Kit) KeepCounters(st runtime.KitState, taken runtime.KitState) bool {
	s, t := st.(*Store), taken.(*Store)
	if t.Seq > s.Seq {
		s.Seq = t.Seq
		return true
	}
	return false
}

func (k *Kit) Channel() runtime.ChannelKit { return &channelKit{k} }

// Limits is src/chat-limits.ts CHAT_LIMITS: the cap (never below the dearest catalogue line) and the month's budget (never below the cap), both lower is tighter.
func (k *Kit) Limits() []runtime.LimitDecl {
	s := k.Settings
	if s == nil {
		return nil
	}
	dearest := 1.0
	for _, l := range s.Catalogue {
		dearest = max(dearest, l.PriceInr)
	}
	minCap := int64(ceil(dearest))
	capFile := int64(s.Limits.MaxPerOrderInr)
	minBudget := int64(ceil(s.Limits.MaxPerOrderInr))
	return []runtime.LimitDecl{
		{ID: "order_cap", Path: "limits.maxPerOrderInr", Unit: "inr", Tighter: "lower", Kind: "orderCap", File: capFile, Min: minCap, Max: max(minCap, capFile)},
		{ID: "monthly_budget", Path: "limits.monthlyBudgetInr", Unit: "inr", Tighter: "lower", Kind: "monthlyBudget", File: int64(s.Limits.MonthlyBudgetInr), Min: minBudget, Max: max(minBudget, int64(s.Limits.MonthlyBudgetInr))},
	}
}

func ceil(f float64) float64 {
	i := float64(int64(f))
	if f > i {
		return i + 1
	}
	return i
}

// SigninMessaging is the shop's WhatsApp for the owner's sign-in link.
func (k *Kit) SigninMessaging() messaging.Messaging { return k.WhatsApp }

var _ runtime.SigninKit = (*Kit)(nil)

// StockOn: the owner's Stock page is served for a shop with the assistant (core.ts: the stock kit needs the assistant and the owner).
func (k *Kit) StockOn() bool { return k.Settings != nil && k.Settings.Assistant }

// StockItems is core.ts templateItems for Stock orders: each item as "supply:<id>", named in the language (else English, else its id), with the unit when every catalogue line
// for the item uses the same one.
func (k *Kit) StockItems(lang string) []listings.ItemRef {
	out := []listings.ItemRef{}
	if k.Settings == nil {
		return out
	}
	for _, it := range k.Settings.Items {
		name := ""
		if l, ok := it.Names[lang]; ok && len(l) > 0 {
			name = l[0]
		} else if l := it.Names["en"]; len(l) > 0 {
			name = l[0]
		}
		if name == "" {
			name = it.ID
		}
		units := map[string]bool{}
		unit := ""
		for _, l := range k.Settings.Catalogue {
			if l.Item == it.ID {
				units[l.Unit] = true
				unit = l.Unit
			}
		}
		ref := listings.ItemRef{ID: stock.SupplyID(it.ID), Name: name}
		if len(units) == 1 {
			ref.Unit = unit
		}
		out = append(out, ref)
	}
	return out
}

// readAgent is an agent over the last saved state for a channel's read (no step, no record).
func (k *Kit) readAgent(st *Store) *Agent { return &Agent{kit: k, st: st, s: k.Settings} }

type channelKit struct{ kit *Kit }

// Offer is server/runtime.ts channel.offer: a Stock orders shop has no customers, so the offer names the shop only.
func (c *channelKit) Offer(runtime.KitState, runtime.OfferQuery) (any, error) {
	return map[string]any{"kind": "stock", "shop": map[string]any{"name": c.kit.Settings.Name}}, nil
}

func (c *channelKit) View(runtime.KitState, string) any { return nil }

// Owner is server/runtime.ts channel.owner: the owner's page, and with the assistant its app view with the order cards left out (an order that waits is already an item).
func (c *channelKit) Owner(kst runtime.KitState, sn *runtime.Snap, _ []store.Entry) any {
	st := kst.(*Store)
	now := c.kit.now()
	var cards = sn.A
	view := ownerView(c.kit.Settings, st, now, cards)
	if !c.kit.Settings.Assistant || c.kit.shared == nil {
		return view
	}
	app := runtime.OwnerAppView(sn, c.kit.shared, &skill{c.kit.readAgent(st)}, now, zoneLoc(c.kit.Settings.Timezone), false)
	raw, _ := json.Marshal(app)
	var m map[string]any
	if json.Unmarshal(raw, &m) == nil {
		if list, ok := m["cards"].([]any); ok {
			kept := []any{}
			for _, x := range list {
				if cm, ok := x.(map[string]any); ok && cm["skill"] == skillName && cm["kind"] == "order" {
					continue
				}
				kept = append(kept, x)
			}
			m["cards"] = kept
		}
		m["listen"] = false
		view["app"] = m
	}
	return view
}

func (c *channelKit) Documents(runtime.KitState, []store.Entry, string, string) ([]any, bool) {
	return nil, false
}

func (c *channelKit) ChatWork(runtime.KitState, string) int { return 0 }
