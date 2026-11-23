// Package orders is the Orders shop's template for the shared Go runtime (internal/runtime): decision 61, wave W4. It is the Go twin of templates/commerce/orders (the settings,
// the store, the derived reads, the books, the channel's reads, and in time the agent) and implements runtime.Kit, so the queue, the record, the owner's sign-in, passkeys,
// phones, push, the limits page, the owner's file and the HTTP face are the shared runtime's own code. It reads and writes the same files as the TypeScript runtime (agent.db,
// the snapshot member for member, the record), so a shop can move between the two runtimes and lose nothing. The model is internal/bookings, module for module.
//
// Explanation.md is the map of this package for the code that builds on it (the agent, the plans, the assistant, the report); Deferred.md says what is not here yet and why.
package orders

import (
	"encoding/json"
	"regexp"
	"time"

	"github.com/GeometerLabs/agents/go/internal/listings"
	"github.com/GeometerLabs/agents/go/internal/orders/reading"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
	"github.com/GeometerLabs/agents/go/internal/terms"
	"github.com/GeometerLabs/agents/go/internal/understanding"
	"github.com/GeometerLabs/agents/go/internal/voice"
)

// Pathway and Version are what an Orders folder's pathway.lock must name: the number in templates/commerce/orders/package.json (the contract suite pins a folder to it).
const (
	Pathway = "orders"
	Version = "0.1.0"
)

// Kit is the Orders template (runtime.Kit). The channel's reads need the shop's settings, the clock and the licence, which the command line hands in once the folder is read and
// the runtime is made (cmd/orders).
type Kit struct {
	// Ports are the services a step calls (ports.go); a nil port is a service this shop does not have.
	Ports    Ports
	Settings *Settings
	Now      func() int64
	// Licence is the shop's licence now: "" in order, "paused", "stopped".
	Licence func() string
	// SavedStock is the shop's stock count in the last saved state (runtime.Snap.Stock, the assistant's), for the page's offer: its "left" takes a counted item's count into
	// account, as orderOffer's countedLeft does. nil, or a nil answer: nothing is counted.
	SavedStock func() *listings.Stock
	// PageBase is where an order's own page lives (start.ts pageBase, read fresh on every use); nil or "": no page link is sent. The agent's (G2's) to use.
	PageBase func() string
	// OfferCharacter and OwnerApp are the two hooks of the shop's assistant on the channel's reads (G3's): the page head's character (publicCharacter, put in the offer's `shop`
	// as `character`) and the owner page's assistant view (ownerAppView, the owner view's `app`). nil, or a nil answer: the member is left out, as for a shop without the
	// assistant.
	OfferCharacter func(st *Store) json.RawMessage
	OwnerApp       func(st *Store, sn *runtime.Snap) json.RawMessage
	// Router reads a customer's words past the rules (the decision model and the language model, runtime.RouterFor over internal/orders/reading); nil: the rules alone.
	Router *understanding.Router[reading.Intent]
	// Terms is the shop terms now (B72: client/terms.json, terms.NewReader); nil, or a nil answer: the feature is off.
	Terms func() *terms.File
	// Voice is the shop's voice service (runtime.json `speech`, internal/voice); nil: voice is off, and a voice note gets the one line asking to type.
	Voice *voice.Service
	// QRImage makes and hosts the QR picture of a UPI request's link (an owner-marked shop with a `report` block: start.ts folderQrImages into its pages folder); nil: the words
	// carry the link, the UPI ID and the amount.
	QRImage ownermarked.ImageMaker
	// Report is the monthly report job (agent_after.go), made once per process from runtime.json's `report` block; nil: the shop has none. reportErr and reportErrAt are core.ts
	// lastReportError: a report that cannot be made is said once, and again each hour it goes on.
	Report      *MonthlyReport
	reportErr   string
	reportErrAt int64
	// shared is the part of the settings every shop has (the assistant's character), kept for the assistant's views
	shared *runtime.Settings
	// given are the Guards given up on in this outage (core.ts `givenUp`): tasks no longer wait for them until one answers. Steps run one at a time, so no lock.
	given map[string]bool
}

func (k *Kit) givenUp() map[string]bool {
	if k.given == nil {
		k.given = map[string]bool{}
	}
	return k.given
}

var _ runtime.Kit = (*Kit)(nil)

func (k *Kit) now() int64 {
	if k.Now != nil {
		return k.Now()
	}
	return time.Now().UnixMilli()
}

// Shared is the part of the settings every shop has, as ReadSettings filled it (nil before).
func (k *Kit) Shared() *runtime.Settings { return k.shared }

func (k *Kit) Pathway() string   { return Pathway }
func (k *Kit) Version() string   { return Version }
func (k *Kit) CasesName() string { return "orders" }

// ReadSettings checks the settings the Orders way and fills the shared part (the owner's number and language, the name, the zone, the languages, the assistant's character).
func (k *Kit) ReadSettings(in map[string]any, raw []byte, shared *runtime.Settings) (any, []string) {
	s, errs := ReadSettings(in, raw)
	if len(errs) > 0 {
		return nil, errs
	}
	shared.Name, shared.Timezone, shared.Language = s.Name, s.Timezone, s.Languages
	shared.Owner.Whatsapp, shared.Owner.Language = s.Owner.Whatsapp, s.Owner.Language
	shared.ReadAssistant(in["assistant"])
	k.shared = shared
	return s, nil
}

// SettingsOf is the Orders settings inside the shared ones.
func SettingsOf(sh *runtime.Settings) *Settings { return sh.Own.(*Settings) }

// ParseState reads the store's members.
func (k *Kit) ParseState(ms []runtime.Member) (runtime.KitState, error) {
	s, err := ParseStore(ms)
	if err != nil {
		return nil, err
	}
	return s, nil
}

// NewAgent is the agent over one step's state (agent.go).
func (k *Kit) NewAgent(c *runtime.StepContext) runtime.Agent { return newAgent(k, c) }

// CountCases is runtime.ts countByState: the orders by state, a state with none left out.
func (k *Kit) CountCases(st runtime.KitState) map[string]int {
	out := map[string]int{}
	for _, o := range st.(*Store).Orders {
		out[o.State]++
	}
	return out
}

// Refunds is core.ts countRefunds over the orders: the refunds Guard holds for the owner, the ones being sent again, and the ones that need the builder, by kind.
func (k *Kit) Refunds(st runtime.KitState) runtime.RefundCounts {
	c := runtime.NoRefunds()
	for _, o := range st.(*Store).Orders {
		for _, p := range o.Pending {
			switch p.PendingKind() {
			case "guard_hold":
				c.WaitingForOwner++
			case "refund_retry":
				c.BeingSentAgain++
			}
		}
		for _, i := range o.RefundIssues {
			c.NeedBuilder[i.Kind]++
			c.NeedBuilder["total"]++
		}
	}
	return c
}

var receiptOrder = regexp.MustCompile(`^(o-\d+):`)

// RefundContext is runtime.ts refundContext: what the approvals relay may know of a HELD refund, found by the receipt the agent put on it ("o-3:pay_x"). `booking` is the order's
// id (the shared relay calls any case that); `slotMs` the start of its slot, 0 when it has none (a plan's period payment always has one; the TypeScript writes 0 for none).
func (k *Kit) RefundContext(st runtime.KitState, sh *runtime.Settings, receipt string) any {
	s := SettingsOf(sh)
	id := receiptOrder.FindStringSubmatch(receipt)
	if id == nil {
		return nil
	}
	o := st.(*Store).Order(id[1])
	if o == nil {
		return nil
	}
	var hold *payments.GuardHold
	for _, p := range o.Pending {
		if h, ok := p.(*payments.GuardHold); ok && h.Receipt == receipt {
			hold = h
			break
		}
	}
	if hold == nil {
		return nil
	}
	phone := o.Customer
	if o.Contact != nil {
		phone = o.Contact.Phone // a page order's: the number its customer typed, never its "web:..." conversation
	}
	var slot int64
	if o.SlotStartMs != nil {
		slot = *o.SlotStartMs
	}
	out := map[string]any{
		"booking": o.ID, "customerPhone": phone, "businessName": s.Name, "timeZone": s.Timezone, "ownerLanguage": s.Owner.Language, "slotMs": slot,
		"paymentId": hold.PaymentID, "amountPaise": hold.AmountInr * 100, "approval": hold.Approval, "expiresAtMs": hold.ExpiresAtMs,
	}
	if hold.RequestedBy != nil {
		out["requestedBy"] = hold.RequestedBy
	}
	return out
}

// SkipCounters moves the order counter on (snapshot.ts skipCounters: nextOrder is the store's one count field; a plan's id is made from its first period's order number).
func (k *Kit) SkipCounters(st runtime.KitState, gap int64) { st.(*Store).NextOrder += gap }

// KeepCounters puts the order counter at least where a thrown-away step's store had it (snapshot.ts keepCounters).
func (k *Kit) KeepCounters(st runtime.KitState, taken runtime.KitState) bool {
	s, t := st.(*Store), taken.(*Store)
	if t.NextOrder > s.NextOrder {
		s.NextOrder = t.NextOrder
		return true
	}
	return false
}

// Limits is src/chat-limits.ts CHAT_LIMITS: the order total above which an order waits for the owner (owner.approveOverInr, 0 is never, bounded 0 to ₹1,00,000), the refund
// the agent makes alone (refund.limitInr, 0 to ₹10,000) and the most orders in a day (orders.maxPerDay, 1 to 10,000). The kinds' words are the shared generated ones
// (runtime/limitwords: bigOrder, refund, perDay).
func (k *Kit) Limits() []runtime.LimitDecl {
	s := k.Settings
	if s == nil {
		return nil
	}
	return []runtime.LimitDecl{
		{ID: "big_order_limit", Path: "owner.approveOverInr", Unit: "inr", Tighter: "lower", Kind: "bigOrder", ZeroIsOff: true, File: s.Owner.ApproveOverInr, Min: 0, Max: 100_000},
		{ID: "refund_limit", Path: "refund.limitInr", Unit: "inr", Tighter: "lower", Kind: "refund", File: s.Refund.LimitInr, Min: 0, Max: 10_000},
		{ID: "orders_per_day", Path: "orders.maxPerDay", Unit: "count", Tighter: "lower", Kind: "perDay", File: s.Orders.MaxPerDay, Min: 1, Max: 10_000},
	}
}

// ChannelRaw is the saved state's `channel` member as read (runtime chatroutes.go ChannelStater): the chat's thread read needs no other member.
func (k *Kit) ChannelRaw(st runtime.KitState) json.RawMessage { return st.(*Store).Channel }

var _ runtime.ChannelStater = (*Kit)(nil)

// ended is server/runtime.ts `ended`: is this order over, for the retention (its page's words and its typed name go)? A page order that was never held is over at once.
func ended(o *Order) bool {
	return o == nil || o.State == Cancelled || o.State == Completed || o.State == Expired || (o.State == Enquiry && o.Channel != "")
}

// CompactStore is server/runtime.ts compactStore, the daily retention: the delivery addresses of finished orders, the words of a page's finished conversations and its finished
// requests (a guest with an order still going keeps their number), the typed name of an order that ended, and the customer entry of a page conversation whose order is over and
// whose request is gone. The record is whole. How many things changed.
//
// NOTE: the shared Go runtime has no daily compaction hook for a template yet (core.ts calls kit.compactStore once a day); this is ready for it (Deferred.md).
func (k *Kit) CompactStore(st *Store, beforeMs int64) int {
	changed := st.CompactFinishedOrders(beforeMs)
	if st.Channel != nil || st.channel != nil {
		changed += st.ChannelState().Compact(beforeMs, func(id string) bool { return ended(st.Order(id)) }, func(conversation string) bool {
			for _, o := range st.Orders {
				if o.Customer == conversation && !ended(o) {
					return true
				}
			}
			return false
		})
		st.reqs = nil // the requests are read again from the compacted block
	}
	for _, o := range st.Orders {
		if o.Contact == nil || o.Contact.Name == "" || !ended(o) || (o.SlotEndMs != nil && *o.SlotEndMs >= beforeMs) || (o.SlotEndMs == nil && 0 >= beforeMs) {
			continue
		}
		o.Contact.Name = ""
		changed++
	}
	var gone []string
	for _, c := range st.Customers {
		conv := c.Phone
		if !runtime.IsChannelConversation(conv) || runtime.IsChatConversation(conv) {
			continue
		}
		used := false
		reqs := st.Requests()
		for _, h := range reqs.Keys() {
			if r := reqs.Get(h); r.Booking != nil {
				if o := st.Order(*r.Booking); o != nil && o.Customer == conv {
					used = true
				}
			}
		}
		if !used {
			gone = append(gone, conv)
		}
	}
	for _, conv := range gone {
		st.DeleteCustomer(conv)
		changed++
	}
	return changed
}

// ---- the channel kit (server/runtime.ts `channel`) -------------------------------------------------------------------------------------------------------------------------

// Channel is the Orders channel's reads.
func (k *Kit) Channel() runtime.ChannelKit { return &channelKit{kit: k} }

type channelKit struct{ kit *Kit }

var (
	_ runtime.ChannelKit      = (*channelKit)(nil)
	_ runtime.AccountantFiler = (*channelKit)(nil)
)

// Offer is the page's offer (orderOffer), with the assistant's character in its head when the hook gives one. The query is not read: an Orders offer is every day it takes.
func (c *channelKit) Offer(st runtime.KitState, _ runtime.OfferQuery) (any, error) {
	k := c.kit
	s := st.(*Store)
	var count *listings.Stock
	if k.SavedStock != nil {
		count = k.SavedStock()
	}
	var character json.RawMessage
	if k.OfferCharacter != nil {
		character = k.OfferCharacter(s)
	}
	paused := k.Licence != nil && k.Licence() != ""
	return k.Settings.orderOffer(s, count, k.now(), paused, character), nil
}

// View is one request by its handle's hash (orderView); nil when the saved state has none.
func (c *channelKit) View(st runtime.KitState, hash string) any {
	if v := c.kit.Settings.OrderView(st.(*Store), hash); v != nil {
		return v
	}
	return nil
}

// Owner is the owner's page (ownerView), with the assistant's view when the hook gives one.
func (c *channelKit) Owner(st runtime.KitState, sn *runtime.Snap, entries []store.Entry) any {
	k := c.kit
	s := st.(*Store)
	var app json.RawMessage
	if k.OwnerApp != nil && k.Settings.Assistant != nil {
		app = k.OwnerApp(s, sn)
	}
	return k.Settings.OwnerView(s, k.now(), entries, app)
}

// Documents are the page's receipts (documentsOf).
func (c *channelKit) Documents(st runtime.KitState, entries []store.Entry, hash, lang string) ([]any, bool) {
	docs := c.kit.Settings.DocumentsOf(st.(*Store), entries, hash, lang)
	out := make([]any, len(docs))
	for i, d := range docs {
		out[i] = d
	}
	return out, true
}

// AccountantFiles are the accountant's files for a period (exportFilesOf); an error is a period the books refuse, said as a 400.
func (c *channelKit) AccountantFiles(_ runtime.KitState, entries []store.Entry, period string) (any, error) {
	return c.kit.Settings.ExportFilesOf(entries, period)
}

// ChatWork is runtime.ts chatWork.
func (c *channelKit) ChatWork(st runtime.KitState, conversation string) int {
	return st.(*Store).ChatWork(conversation)
}
