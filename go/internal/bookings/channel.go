package bookings

// What the booking page, its API, the MCP endpoint and the owner's private page may READ: the Go twin of templates/commerce/bookings/src/channel.ts and the channel kit of
// server/runtime.ts. Everything is an allowlist: a field is in a view because the page shows it. Never the owner's one-use code, never another customer, never a record line.
//
// Not ported yet (Deferred.md): a UPI shop's pay block and the owner's UPI items (they read the owner-marked ledger, `upi`, kept raw here), the free starts of a service (the
// calendar port; until it is wired the offer says `calendarUnread`, as the TypeScript does when its calendar cannot be read), the owner page's Money section and the documents
// (the books, go/internal/accounting), and the assistant's app view.

import (
	"fmt"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"time"

	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
)

type channelKit struct{ kit *Kit }

var _ runtime.ChannelKit = (*channelKit)(nil)

// publicServices is channel.ts publicServices: each service's first name in every language, its list price and how long it takes.
func publicServices(s *Settings, only *Service) []any {
	var out []any
	for i := range s.Services {
		sv := &s.Services[i]
		if only != nil && sv.ID != only.ID {
			continue
		}
		names := map[string]any{}
		for _, l := range runtime.LANGUAGES {
			names[l] = ServiceName(sv, l)
		}
		out = append(out, ordered2("id", sv.ID, "names", names, "priceInr", sv.PriceInr, "durationMinutes", sv.DurationMinutes))
	}
	if out == nil {
		out = []any{}
	}
	return out
}

// ordered2 is an object with its members in the order given (the TypeScript's object literal order), written as JSON.
func ordered2(kv ...any) json.RawMessage {
	var o object
	for i := 0; i+1 < len(kv); i += 2 {
		o.put(kv[i].(string), kv[i+1])
	}
	return o.done()
}

// shopInfo is channel.ts shopInfo. `paused`: the shop's licence takes no new bookings now.
func shopInfo(s *Settings, paused bool) json.RawMessage {
	var o object
	o.put("name", s.Name)
	if s.HasAddress {
		o.put("address", s.Address)
	}
	o.put("timezone", s.Timezone)
	o.put("languages", s.Languages)
	o.put("deposit", ordered2("amountInr", s.Deposit.AmountInr, "holdMinutes", s.Deposit.HoldMinutes))
	o.put("cancellation", ordered2("windowHours", s.Cancellation.WindowHours))
	if s.OwnerMarked() {
		o.put("payment", ordered2("kind", "upi", "payee", s.Payment.Payee))
	} else {
		o.put("payment", ordered2("kind", "link"))
	}
	o.put("paused", paused)
	o.put("hours", s.HoursJSON)
	return o.done()
}

// Offer is the channel kit's offer: the shop and its services, and for one service its free starts.
func (k *channelKit) Offer(st runtime.KitState, q runtime.OfferQuery) (any, error) {
	s := k.kit.Settings
	paused := k.kit.Licence != nil && k.kit.Licence() != ""
	base := []any{"shop", shopInfo(s, paused), "services", publicServices(s, nil)}
	if q.ServiceID == "" || s.ServiceByID(q.ServiceID) == nil {
		return ordered2(base...), nil
	}
	// runtime.ts channel.offer: the agent's own freeStarts over the last saved state (the shop's holds) and the calendar (a read, not watched: nothing here is saved)
	var from *LocalDate
	if q.FromDate != "" {
		var y, m, d int
		if _, err := fmt.Sscanf(q.FromDate, "%d-%d-%d", &y, &m, &d); err == nil {
			from = &LocalDate{Year: y, Month: m, Day: d}
		}
	}
	days := q.Days
	if days == 0 {
		days = 7
	}
	a := k.kit.readAgent(st.(*Store))
	out, err := a.FreeStarts(q.ServiceID, from, min(days, 14))
	if err != nil {
		return ordered2(append(base, "serviceId", q.ServiceID, "days", []any{}, "calendarUnread", true)...), nil
	}
	return ordered2(append(base, "serviceId", q.ServiceID, "days", out)...), nil
}

// publicStatus is channel.ts STATUS: a booking's state as its page says it.
var publicStatus = map[string]string{
	Enquiry: "not_held", ConfirmingDetails: "not_held", AwaitingDeposit: "held", NeedsOwner: "checking", Confirmed: "booked", Expired: "expired", Cancelled: "cancelled", Completed: "done",
}

// channelRequest is a request of the store's `channel` block (modules/channels/state.ts), as the page's read needs it.
type channelRequest struct {
	Booking *string `json:"booking"`
	Refused *string `json:"refused"`
	Channel string  `json:"channel"`
}

type channelState struct {
	Requests map[string]channelRequest `json:"requests"`
	Outbox   []struct {
		To   string `json:"to"`
		AtMs int64  `json:"atMs"`
		Text string `json:"text"`
	} `json:"outbox"`
}

func (s *Store) channelState() channelState {
	var c channelState
	if s.Channel != nil {
		_ = json.Unmarshal(s.Channel, &c)
	}
	return c
}

func (b *Booking) extraString(name string) (string, bool) {
	for _, m := range b.Extra {
		if m.Name == name {
			var s string
			if json.Unmarshal(m.Raw, &s) == nil {
				return s, true
			}
		}
	}
	return "", false
}

func (b *Booking) extraList(name string) []string {
	for _, m := range b.Extra {
		if m.Name == name {
			var l []string
			_ = json.Unmarshal(m.Raw, &l)
			return l
		}
	}
	return nil
}

func (b *Booking) hasExtra(name string) bool {
	for _, m := range b.Extra {
		if m.Name == name {
			return true
		}
	}
	return false
}

// lookup is channel.ts lookup: a page's booking by its handle's hash, the one lookup the page's read and its documents share.
func lookup(st *Store, hash string) (req *channelRequest, byLink *Booking, booking *Booking) {
	cs := st.channelState()
	if r, ok := cs.Requests[hash]; ok {
		req = &r
	}
	if req == nil {
		for _, x := range st.Bookings {
			if (x.PageLink == hash || contains(x.extraList("pageLinksBefore"), hash)) && x.Channel == "" {
				byLink = x
				break
			}
		}
	}
	found := byLink
	if found == nil && req != nil && req.Refused == nil && req.Booking != nil {
		found = st.Booking(*req.Booking)
	}
	if found != nil && (byLink != nil || found.Handle == hash) {
		booking = found
	}
	return
}

// View is channel.ts bookingView.
func (k *channelKit) View(kst runtime.KitState, hash string) any {
	st := kst.(*Store)
	s := k.kit.Settings
	req, byLink, b := lookup(st, hash)
	if req == nil && byLink == nil {
		return nil
	}
	if req != nil && (req.Refused != nil || req.Booking == nil) {
		reason := "unknown"
		if req.Refused != nil {
			reason = *req.Refused
		}
		return ordered2("status", "refused", "reason", reason, "channel", req.Channel)
	}
	if b == nil {
		return nil
	}
	status := publicStatus[b.State]
	var o object
	o.put("status", status)
	o.put("ref", b.ID)
	if b.Channel != "" {
		o.put("channel", b.Channel)
	}
	if sv := s.ServiceByID(b.ServiceID); sv != nil {
		o.put("service", publicServices(s, sv)[0])
	}
	if b.StartMs != nil {
		o.put("startMs", *b.StartMs)
		if b.EndMs != nil {
			o.put("endMs", *b.EndMs)
		}
	}
	deposit := s.Deposit.AmountInr
	if b.DepositInr != nil {
		deposit = *b.DepositInr
	}
	o.put("depositInr", deposit)
	if status == "held" && b.HoldExpiresAt != nil {
		o.put("holdExpiresAt", *b.HoldExpiresAt)
	}
	payUPI := false
	if status == "held" && !s.OwnerMarked() && b.LinkURL != "" {
		o.put("pay", ordered2("kind", "link", "url", b.LinkURL))
	}
	// a UPI shop's pay block reads the owner-marked ledger (not ported yet): left out, and with it "I have paid" on the page
	o.put("canCancel", byLink == nil && (status == "held" || status == "booked" || status == "checking"))
	o.put("canSayPaid", byLink == nil && status == "held" && payUPI)
	o.put("claimed", byLink == nil && b.hasExtra("claimAtMs"))
	messages := []any{}
	if byLink == nil {
		for _, m := range st.channelState().Outbox {
			if m.To == b.Customer {
				messages = append(messages, ordered2("atMs", m.AtMs, "text", m.Text))
			}
		}
	}
	o.put("messages", messages)
	for _, p := range b.Pending {
		if r := OwnerRefundOf(p); r != nil {
			o.put("refund", ordered2("state", "asked", "amountInr", r.AmountInr))
			break
		}
	}
	return o.done()
}

// digestOf is channel.ts digestOf: the SHA-256 of JSON.stringify(parts), 32 hex digits.
func digestOf(parts ...any) string {
	b, _ := json.Marshal(parts)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])[:32]
}

// Owner is channel.ts ownerView without the UPI items and the Money section (not ported yet): the shop, the services, what the agent asked the owner, the coming week.
func (k *channelKit) Owner(kst runtime.KitState, _ *runtime.Snap, _ []store.Entry) any {
	st := kst.(*Store)
	s := k.kit.Settings
	now := k.kit.now()
	customer := func(b *Booking) json.RawMessage {
		if b.Contact != nil {
			if b.Contact.Name != "" {
				return ordered2("phone", b.Contact.Phone, "name", b.Contact.Name)
			}
			return ordered2("phone", b.Contact.Phone)
		}
		return ordered2("phone", b.Customer)
	}
	channel := func(b *Booking) string {
		if b.Channel != "" {
			return b.Channel
		}
		return "whatsapp"
	}
	items := []any{}
	for _, b := range st.Bookings {
		if len(b.Pending) == 0 {
			continue
		}
		p := b.Pending[0]
		kv := []any{}
		switch r := OwnerRefundOf(p); {
		case r != nil:
			kv = []any{"kind", "late_refund", "case", b.ID, "digest", digestOf("late_refund", b.ID, r.PaymentID, r.AmountInr*100), "actions", []string{"approve", "deny"}, "amountPaise", r.AmountInr * 100, "customer", customer(b), "channel", channel(b)}
		case p.PendingKind() == "calendar" && b.DepositInr != nil:
			var start int64
			if b.StartMs != nil {
				start = *b.StartMs
			}
			kv = []any{"kind", "calendar", "case", b.ID, "digest", digestOf("calendar", b.ID, b.DepositPaymentID, start), "actions", []string{"retry", "approve"}, "amountPaise", *b.DepositInr * 100, "customer", customer(b), "channel", channel(b)}
		default:
			continue
		}
		if b.ServiceID != "" {
			kv = append(kv, "serviceId", b.ServiceID)
		}
		if b.StartMs != nil {
			kv = append(kv, "startMs", *b.StartMs)
		}
		items = append(items, ordered2(kv...))
	}
	// the coming bookings of the next seven days (to midnight eight days on, in the shop's zone)
	day := time.UnixMilli(now).In(s.Loc)
	end := time.Date(day.Year(), day.Month(), day.Day()+8, 0, 0, 0, 0, s.Loc).UnixMilli()
	var up []*Booking
	for _, b := range st.Bookings {
		if (b.State == Confirmed || b.State == NeedsOwner) && b.StartMs != nil && *b.StartMs >= now-2*3_600_000 && *b.StartMs < end {
			up = append(up, b)
		}
	}
	sort.SliceStable(up, func(i, j int) bool { return *up[i].StartMs < *up[j].StartMs })
	if len(up) > 50 {
		up = up[:50]
	}
	upcoming := []any{}
	for _, b := range up {
		kv := []any{"case", b.ID, "startMs", *b.StartMs}
		if b.ServiceID != "" {
			kv = append(kv, "serviceId", b.ServiceID)
		}
		kv = append(kv, "customer", customer(b), "channel", channel(b), "state", b.State)
		upcoming = append(upcoming, ordered2(kv...))
	}
	return ordered2("shop", ordered2("name", s.Name, "timezone", s.Timezone, "ownerLanguage", s.Owner.Language), "services", publicServices(s, nil), "items", items, "upcoming", upcoming)
}

// Documents are the books' (go/internal/accounting, another stream): not wired yet, so the route answers 404.
func (k *channelKit) Documents(runtime.KitState, []store.Entry, string, string) ([]any, bool) {
	return nil, false
}

// ChatWork is runtime.ts chatWork: a chat guest has made a booking when a booking beyond the first enquiry is theirs.
func (k *channelKit) ChatWork(kst runtime.KitState, conversation string) int {
	n := 0
	for _, b := range kst.(*Store).Bookings {
		if b.Customer == conversation && b.State != Enquiry && b.State != ConfirmingDetails {
			n++
		}
	}
	return n
}
