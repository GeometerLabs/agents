// Package bookings is the Bookings shop's template for the shared Go runtime (internal/runtime): decision 61, wave 2. It is the Go twin of templates/commerce/bookings (the
// settings, the store, the agent, the channel's reads) and implements runtime.Kit, so the queue, the record, the owner's sign-in, passkeys, phones, push, the limits page, the
// owner's file and the HTTP face are the listings shop's own code, shared. It reads and writes the same files as the TypeScript runtime (agent.db schema 5, the snapshot in
// pieces, the record), so a shop can move between the two runtimes and lose nothing.
//
// What is ported is said in go/TRIAL.md ("Wave 2: the Bookings runtime") and, with the reason for each part that is not, in this package's Deferred.md. The services a step calls
// (payments, messaging, calendar, the books) are the ports in ports.go: interfaces the domain code is written against, wired to the packages the other streams write.
package bookings

import (
	"time"

	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// Pathway and Version are what a Bookings folder's pathway.lock must name: the number in templates/commerce/bookings/package.json (the contract suite pins a folder to it).
const (
	Pathway = "bookings"
	Version = "0.1.0"
)

// Kit is the Bookings template (runtime.Kit). The channel's reads need the shop's settings, the clock and the licence, which the command line hands in once the folder is read and
// the runtime is made (cmd/bookings).
type Kit struct {
	// Ports are the services a step calls; a nil port is a service this shop does not have (or that is not wired yet).
	Ports    Ports
	Settings *Settings
	Now      func() int64
	// Licence is the shop's licence now: "" in order, "paused", "stopped".
	Licence func() string
}

func (k *Kit) now() int64 {
	if k.Now != nil {
		return k.Now()
	}
	return time.Now().UnixMilli()
}

var _ runtime.Kit = (*Kit)(nil)

func (k *Kit) Pathway() string   { return Pathway }
func (k *Kit) Version() string   { return Version }
func (k *Kit) CasesName() string { return "bookings" }

// ReadSettings checks the settings the Bookings way and fills the shared part (the owner's number and language, the name, the zone, the languages, the assistant's character).
func (k *Kit) ReadSettings(in map[string]any, raw []byte, shared *runtime.Settings) (any, []string) {
	s, errs := ReadSettings(in, raw)
	if len(errs) > 0 {
		return nil, errs
	}
	shared.Name, shared.Timezone, shared.Language = s.Name, s.Timezone, s.Languages
	shared.Owner.Whatsapp, shared.Owner.Language = s.Owner.Whatsapp, s.Owner.Language
	shared.ReadAssistant(in["assistant"])
	return s, nil
}

// ParseState reads the store's members.
func (k *Kit) ParseState(ms []runtime.Member) (runtime.KitState, error) {
	s, err := ParseStore(ms)
	if err != nil {
		return nil, err
	}
	return s, nil
}

func settingsOf(sh *runtime.Settings) *Settings { return sh.Own.(*Settings) }

// NewAgent is the agent over one step's state.
func (k *Kit) NewAgent(c *runtime.StepContext) runtime.Agent {
	return &Agent{c: c, store: c.State.(*Store), settings: settingsOf(c.Settings), ports: k.Ports}
}

// CountCases is runtime.ts countByState.
func (k *Kit) CountCases(st runtime.KitState) map[string]int {
	out := map[string]int{}
	for _, b := range st.(*Store).Bookings {
		out[b.State]++
	}
	return out
}

// Refunds is core.ts countRefunds over the bookings.
func (k *Kit) Refunds(st runtime.KitState) runtime.RefundCounts {
	c := runtime.NoRefunds()
	for _, b := range st.(*Store).Bookings {
		for _, p := range b.Pending {
			switch p.Kind {
			case "guard_hold":
				c.WaitingForOwner++
			case "refund_retry":
				c.BeingSentAgain++
			}
		}
		for _, i := range b.RefundIssues {
			c.NeedBuilder[i.Kind]++
			c.NeedBuilder["total"]++
		}
	}
	return c
}

// RefundContext is runtime.ts refundContext: what the approvals relay may know of a HELD refund, found by the receipt the agent put on it ("b-3:pay_x").
func (k *Kit) RefundContext(st runtime.KitState, sh *runtime.Settings, receipt string) any {
	s := settingsOf(sh)
	id := receiptBooking.FindStringSubmatch(receipt)
	if id == nil {
		return nil
	}
	b := st.(*Store).Booking(id[1])
	if b == nil || b.StartMs == nil {
		return nil
	}
	var hold *Pending
	for i := range b.Pending {
		if b.Pending[i].Kind == "guard_hold" && b.Pending[i].Receipt == receipt {
			hold = &b.Pending[i]
			break
		}
	}
	sv := s.ServiceByID(b.ServiceID)
	if hold == nil || sv == nil {
		return nil
	}
	phone := b.Customer
	if b.Contact != nil {
		phone = b.Contact.Phone // a booking page's: the number its customer typed
	}
	out := map[string]any{
		"booking": b.ID, "customerPhone": phone, "businessName": s.Name, "timeZone": s.Timezone, "ownerLanguage": s.Owner.Language, "serviceName": ServiceName(sv, s.Owner.Language),
		"slotMs": *b.StartMs, "paymentId": hold.PaymentID, "amountPaise": hold.AmountInr * 100, "approval": hold.Approval, "expiresAtMs": hold.ExpiresAtMs,
	}
	if hold.RequestedBy != nil {
		out["requestedBy"] = hold.RequestedBy
	}
	return out
}

// SkipCounters moves the booking counter on (snapshot.ts skipCounters: nextBooking is the store's one count field).
func (k *Kit) SkipCounters(st runtime.KitState, gap int64) { st.(*Store).NextBooking += gap }

// KeepCounters puts the booking counter at least where a thrown-away step's store had it (snapshot.ts keepCounters).
func (k *Kit) KeepCounters(st runtime.KitState, taken runtime.KitState) bool {
	s, t := st.(*Store), taken.(*Store)
	if t.NextBooking > s.NextBooking {
		s.NextBooking = t.NextBooking
		return true
	}
	return false
}

// Channel is the Bookings channel's reads (channel.go).
func (k *Kit) Channel() runtime.ChannelKit { return &channelKit{kit: k} }
