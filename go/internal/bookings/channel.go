package bookings

// What the booking page, its API, the MCP endpoint and the owner's private page may READ: the Go twin of templates/commerce/bookings/src/channel.ts and the channel kit of
// server/runtime.ts. Everything is an allowlist: a field is in a view because the page shows it. Never the owner's one-use code, never another customer, never a record line.
//
// Not ported yet (Deferred.md): the owner page's Money section, the assistant's app view, and a chat guest's label
// ("Chat guest 3") on the owner's items.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
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
	if status == "held" {
		if r := requestOfStore(st, b); s.OwnerMarked() && r != nil {
			// after a part was marked, the link (and its QR) asks for what is left, the same amount the page states; a whole deposit keeps the request's own link
			left, link := ownermarked.LeftOn(r), r.Link
			if left > 0 && left < r.AmountPaise {
				if l, err := s.UpiPayLink()(left, r.Reference); err == nil {
					link = l
				}
			}
			o.put("pay", ordered2("kind", "upi", "link", link, "payTo", ordered2("id", s.Payment.UpiID, "name", s.Payment.Payee), "amountPaise", r.AmountPaise, "leftPaise", left, "note", r.Reference))
			payUPI = true
		} else if !s.OwnerMarked() && b.LinkURL != "" {
			o.put("pay", ordered2("kind", "link", "url", b.LinkURL))
		}
	}
	// a WhatsApp booking's page shows and lets the customer pay; cancelling and "I have paid" stay on WhatsApp, where the customer is known by their number
	o.put("canCancel", byLink == nil && (status == "held" || status == "booked" || status == "checking"))
	// money clarity: also after the hold ended, while the owner could still mark the request (lateClaimable): the customer may have paid as the time ran out
	o.put("canSayPaid", byLink == nil && ((status == "held" && payUPI) || (status == "expired" && lateRequest(st, b, k.kit.now()) != nil)))
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
	// item 11h: a refund on this booking as the record holds it (refundOf): on a UPI shop the newest refund the owner owes, marked sent or kept; else the owner's call on a
	// late cancellation still open
	var owed *ownermarked.OwedRefund
	if l := st.ledger(false); l != nil {
		for _, r := range l.Refunds {
			if r.CaseID == b.ID {
				owed = r
			}
		}
	}
	if owed != nil {
		state := "owed"
		switch owed.State {
		case ownermarked.RefundDone:
			state = "sent"
		case ownermarked.RefundKept:
			state = "kept"
		}
		o.put("refund", ordered2("state", state, "amountInr", jsDiv100(owed.AmountPaise)))
		return o.done()
	}
	for _, p := range b.Pending {
		if r := OwnerRefundOf(p); r != nil {
			o.put("refund", ordered2("state", "asked", "amountInr", r.AmountInr))
			break
		}
	}
	return o.done()
}

// jsDiv100 is `paise / 100` as JavaScript writes it in JSON: a whole number of rupees as an integer, else the decimal.
func jsDiv100(paise int64) any {
	if paise%100 == 0 {
		return paise / 100
	}
	return float64(paise) / 100
}

// requestOfStore is channel.ts requestOf: the booking's request in the saved ledger, by its link id.
func requestOfStore(st *Store, b *Booking) *ownermarked.MarkedRequest {
	l := st.ledger(false)
	if l == nil || b.LinkID == "" {
		return nil
	}
	for _, r := range l.Requests {
		if r.ID == b.LinkID {
			return r
		}
	}
	return nil
}

// LateWindowMs and LateClaimWindowMs are channel.ts LATE_WINDOW_MS and LATE_CLAIM_WINDOW_MS: how long after a hold ended the owner's page still lists "money may have come" (48
// hours), and longer after the customer said they paid (14 days: the owner may see the payment in their UPI app days later).
const (
	LateWindowMs      = 48 * 3_600_000
	LateClaimWindowMs = 14 * 24 * 3_600_000
)

// lateRequest is channel.ts lateRequest: an expired booking whose UPI request is still open to a mark (its code stays live after the hold ended) and has none: money may have come
// as the time ran out. Bounded in time so an old, forgotten hold is not listed forever.
func lateRequest(st *Store, b *Booking, nowMs int64) *ownermarked.MarkedRequest {
	if b.State != Expired {
		return nil
	}
	r := requestOfStore(st, b)
	if r == nil || r.Code == nil || len(r.Marks) > 0 || b.DepositPaymentID != "" {
		return nil
	}
	var closed int64
	if r.ClosedAtMs != nil {
		closed = *r.ClosedAtMs
	}
	since, window := closed, int64(LateWindowMs)
	var claim float64
	if b.extra("claimAtMs", &claim) {
		since, window = max(int64(claim), closed), LateClaimWindowMs
	}
	if nowMs-since < window {
		return r
	}
	return nil
}

// digestOf is channel.ts digestOf: the SHA-256 of JSON.stringify(parts), 32 hex digits.
func digestOf(parts ...any) string {
	b, _ := json.Marshal(parts)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])[:32]
}

// ownerItem is channel.ts OwnerItem: one thing the owner can answer from their page. Code is the owner-marked one-use code the press stands for; it never leaves the runtime.
type ownerItem struct {
	Kind, Case, Digest string
	Actions            []string
	AmountPaise        int64
	Customer           json.RawMessage
	Channel            string
	ServiceID          string
	StartMs            *int64
	Why                string
	ClaimedAtMs        *int64
	UpiRef             string
	Code               string
}

// json is the item as the owner's page reads it, in the TypeScript's member order, never with its code.
func (it ownerItem) json() json.RawMessage {
	kv := []any{"kind", it.Kind, "case", it.Case, "digest", it.Digest, "actions", it.Actions, "amountPaise", it.AmountPaise, "customer", it.Customer, "channel", it.Channel}
	if it.ServiceID != "" {
		kv = append(kv, "serviceId", it.ServiceID)
	}
	if it.StartMs != nil {
		kv = append(kv, "startMs", *it.StartMs)
	}
	if it.Why != "" {
		kv = append(kv, "why", it.Why)
	}
	if it.ClaimedAtMs != nil {
		kv = append(kv, "claimedAtMs", *it.ClaimedAtMs)
	}
	if it.UpiRef != "" {
		kv = append(kv, "upiRef", it.UpiRef)
	}
	return ordered2(kv...)
}

// ownerCustomer is channel.ts customerOf: a chat guest is "Chat guest 3" to the owner (chat-guest.ts guestLabel), with no phone, never its "chat:..." conversation; anyone else is
// the number (or the channel's typed number and name).
func ownerCustomer(st *Store, lang string, b *Booking, phone string) json.RawMessage {
	if isChatConversation(phone) {
		return ordered2("phone", "", "name", runtime.GuestLabel(st.chanState(), phone, lang))
	}
	if b != nil && b.Contact != nil {
		if b.Contact.Name != "" {
			return ordered2("phone", b.Contact.Phone, "name", b.Contact.Name)
		}
		return ordered2("phone", b.Contact.Phone)
	}
	return ordered2("phone", phone)
}

func ownerChannel(b *Booking) string {
	if b != nil && isChatConversation(b.Customer) {
		return "chat" // channel.ts channelOf
	}
	if b != nil && b.Channel != "" {
		return b.Channel
	}
	return "whatsapp"
}

// claimOf is channel.ts claimOf: when the customer said they paid, and the UPI reference they typed (NOT in the digest: a customer's press must not make the owner's own stale).
func claimOf(b *Booking, it *ownerItem) {
	var at float64
	if b.extra("claimAtMs", &at) {
		it.ClaimedAtMs = ptr(int64(at))
	}
	if ref, ok := b.extraString("claimRef"); ok && ref != "" {
		it.UpiRef = ref
	}
}

// ownerItems is channel.ts ownerItems' items: a deposit to mark received (UPI), a hold that ended where money may have come anyway, a refund the owner owes, a late
// cancellation's refund the agent asked about, and a paid booking the calendar would not confirm. Only what the agent would act on now.
func ownerItems(st *Store, now int64, lang string) []ownerItem {
	var items []ownerItem
	at := func(b *Booking, it *ownerItem) {
		if b == nil {
			return
		}
		it.ServiceID = b.ServiceID
		if b.StartMs != nil {
			it.StartMs = ptr(*b.StartMs)
		}
	}
	l := st.ledger(false)
	if l != nil {
		for _, r := range l.Requests {
			b := st.Booking(r.Reference)
			if b == nil || b.State != AwaitingDeposit || r.Code == nil || (r.Status != ownermarked.StatusCreated && r.Status != ownermarked.StatusPartiallyPaid) {
				continue
			}
			left := ownermarked.LeftOn(r)
			it := ownerItem{Kind: "deposit", Case: b.ID, Digest: digestOf("deposit", b.ID, r.ID, left, len(r.Marks), len(r.UsedCodes)), Actions: []string{"received"}, AmountPaise: left,
				Customer: ownerCustomer(st, lang, b, b.Customer), Channel: ownerChannel(b), Code: *r.Code}
			at(b, &it)
			claimOf(b, &it)
			items = append(items, it)
		}
	}
	for _, b := range st.Bookings {
		r := lateRequest(st, b, now)
		if r == nil || r.Code == nil {
			continue
		}
		it := ownerItem{Kind: "late_deposit", Case: b.ID, Digest: digestOf("late_deposit", b.ID, r.ID, r.AmountPaise, len(r.UsedCodes)), Actions: []string{"received"}, AmountPaise: r.AmountPaise,
			Customer: ownerCustomer(st, lang, b, b.Customer), Channel: ownerChannel(b), Code: *r.Code}
		at(b, &it)
		claimOf(b, &it)
		items = append(items, it)
	}
	if l != nil {
		for _, r := range l.Refunds {
			if r.State != ownermarked.RefundOwed || r.Code == nil {
				continue
			}
			b := st.Booking(r.CaseID)
			actions := []string{"refunded"}
			if r.KeepAllowed {
				actions = []string{"refunded", "kept"}
			}
			it := ownerItem{Kind: "refund_owed", Case: r.CaseID, Digest: digestOf("refund_owed", r.CaseID, r.ID, r.AmountPaise, r.KeepAllowed, len(r.UsedCodes)), Actions: actions, AmountPaise: r.AmountPaise,
				Customer: ownerCustomer(st, lang, b, r.Customer), Channel: ownerChannel(b), Why: r.Why, Code: *r.Code}
			at(b, &it)
			items = append(items, it)
		}
	}
	for _, b := range st.Bookings {
		if len(b.Pending) == 0 {
			continue
		}
		p := b.Pending[0]
		var it ownerItem
		switch r := OwnerRefundOf(p); {
		case r != nil:
			it = ownerItem{Kind: "late_refund", Case: b.ID, Digest: digestOf("late_refund", b.ID, r.PaymentID, r.AmountInr*100), Actions: []string{"approve", "deny"}, AmountPaise: r.AmountInr * 100}
		case p.PendingKind() == "calendar" && b.DepositInr != nil:
			var start int64
			if b.StartMs != nil {
				start = *b.StartMs
			}
			it = ownerItem{Kind: "calendar", Case: b.ID, Digest: digestOf("calendar", b.ID, b.DepositPaymentID, start), Actions: []string{"retry", "approve"}, AmountPaise: *b.DepositInr * 100}
		default:
			continue
		}
		it.Customer, it.Channel = ownerCustomer(st, lang, b, b.Customer), ownerChannel(b)
		at(b, &it)
		items = append(items, it)
	}
	return items
}

// Owner is channel.ts ownerView without the Money section (not ported yet): the shop, the services, what waits for the owner (never its code), the coming week.
func (k *channelKit) Owner(kst runtime.KitState, sn *runtime.Snap, _ []store.Entry) any {
	st := kst.(*Store)
	s := k.kit.Settings
	now := k.kit.now()
	items := []any{}
	for _, it := range ownerItems(st, now, s.Owner.Language) {
		items = append(items, it.json())
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
		kv = append(kv, "customer", ownerCustomer(st, s.Owner.Language, b, b.Customer), "channel", ownerChannel(b), "state", b.State)
		upcoming = append(upcoming, ordered2(kv...))
	}
	kv := []any{"shop", ordered2("name", s.Name, "timezone", s.Timezone, "ownerLanguage", s.Owner.Language), "services", publicServices(s, nil), "items", items, "upcoming", upcoming}
	// item 11e: the shop's assistant's view (app/view.ts ownerAppView over a read-only Bookings skill), on a shop with the assistant
	if s.Assistant != nil && k.kit.shared != nil && sn != nil {
		kv = append(kv, "app", runtime.OwnerAppView(sn, k.kit.shared, &bookingsSkill{k.kit.readAgent(st)}, now, s.Loc, k.kit.OwnerVoiceOn()))
	}
	return ordered2(kv...)
}

// Documents is channel.ts documentsOf: the receipts and refund notes of the booking the page with this handle's hash opens (the page's own lookup, so another booking's number is
// never among them), newest first, drawn in the page's language; what each is for is the service and the slot in that language.
func (k *channelKit) Documents(kst runtime.KitState, entries []store.Entry, hash, lang string) ([]any, bool) {
	st := kst.(*Store)
	s := k.kit.Settings
	var cases []string
	if _, _, b := lookup(st, hash); b != nil {
		cases = []string{b.ID}
	}
	whatFor := func(caseID, l string) string {
		x := st.Booking(caseID)
		var parts []string
		if x != nil {
			if sv := s.ServiceByID(x.ServiceID); sv != nil {
				parts = append(parts, ServiceName(sv, l))
			}
			if x.StartMs != nil {
				parts = append(parts, language.Formats(l).Slot(*x.StartMs, s.Loc))
			}
		}
		return strings.Join(parts, ", ")
	}
	docs := accounting.CaseDocuments(accounting.BookingsJournal(entries), cases, accounting.DocumentShop{Name: s.Name, Address: s.Address, Timezone: s.Timezone}, lang, whatFor, nil)
	out := make([]any, len(docs))
	for i, d := range docs {
		out[i] = d
	}
	return out, true
}

// AccountantFiles is channel.ts exportFilesOf: the accountant's files for a period, from the record, with the two best-effort Tally files. No company name is put in them (the
// accountant's Tally company may be named differently from the shop).
func (k *channelKit) AccountantFiles(_ runtime.KitState, entries []store.Entry, period string) (any, error) {
	return accounting.AccountantFiles(accounting.ExportInput{Journal: accounting.BookingsJournal(entries), Entries: entries, Period: period, TimeZone: k.kit.Settings.Timezone, Tally: &accounting.TallyOptions{}})
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
