package orders

// What Orders' part of the shop page, its API, the MCP endpoint and the owner's page may READ: the Go twin of templates/commerce/orders/src/channel.ts (orderOffer, orderView,
// ownerItems, ownerView, documentsOf, exportFilesOf) and the channel kit of server/runtime.ts (chatWork). Everything is an allowlist: a field is in a view because the page shows
// it. Never the owner's one-use code, never another customer, never a record line, never the delivery address as typed (only its place on the shop's list). Prices are the shop's
// own, from the settings.
//
// Every view is written with its members in the TypeScript's object order (the routes send it as it is), and every digest is the TypeScript's: the SHA-256 of JSON.stringify of
// the parts, its first 32 hex digits (proved on stores the TypeScript agent wrote, testdata/store-vectors.json.gz).
//
// Left as hooks (G3's part of wave W4): the page head's character (`shop.character`, publicCharacter over the shop's assistant: Kit.OfferCharacter) and the owner page's assistant
// view (`app`, ownerAppView over the Orders skill: Kit.OwnerApp). Both are nil until the Orders skill of the assistant is ported, and the views are then exactly the TypeScript's
// for a shop without the assistant.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/discounts"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/listings"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// ordered is an object with its members in the order given (a TypeScript object literal's), written as JavaScript writes it; a nil value (json.RawMessage(nil)) is left out.
func ordered(kv ...any) json.RawMessage {
	var o obj
	for i := 0; i+1 < len(kv); i += 2 {
		switch v := kv[i+1].(type) {
		case json.RawMessage:
			o.put(kv[i].(string), v)
		default:
			o.put(kv[i].(string), jsonOf(v))
		}
	}
	return o.done()
}

// IsoOf is channel.ts isoOf: "2026-11-16", a day as the page, the API and the event name it.
func IsoOf(d LocalDate) string { return KeyOf(d) }

var isoRe = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`)

// DateOfIso is channel.ts dateOf: the day a "YYYY-MM-DD" names, or nil (a day that does not exist, "2026-02-30", is nil).
func DateOfIso(iso string) *LocalDate {
	m := isoRe.FindStringSubmatch(iso)
	if m == nil {
		return nil
	}
	atoi := func(s string) int {
		n := 0
		for _, c := range s {
			n = n*10 + int(c-'0')
		}
		return n
	}
	d := LocalDate{Year: atoi(m[1]), Month: atoi(m[2]), Day: atoi(m[3])}
	if back := zone.AddDays(d.Zone(), 0); back != d.Zone() {
		return nil
	}
	return &d
}

// publicItems is channel.ts publicItems: each item's first name in each language and its price.
func (s *Settings) publicItems() []json.RawMessage {
	out := make([]json.RawMessage, len(s.Menu))
	for i := range s.Menu {
		out[i] = ordered("id", s.Menu[i].ID, "names", s.itemNames(&s.Menu[i]), "priceInr", s.Menu[i].PriceInr)
	}
	return out
}

// itemNames is an item's first name in every language, in LANGUAGES' order.
func (s *Settings) itemNames(it *MenuItem) json.RawMessage {
	kv := []any{}
	for _, l := range runtime.LANGUAGES {
		kv = append(kv, l, ItemName(it, l))
	}
	return ordered(kv...)
}

// OrderShopInfo is channel.ts orderShopInfo: what the page says about the shop and its rules. `paused`: the shop's licence takes no new orders now.
func (s *Settings) OrderShopInfo(paused bool) json.RawMessage { return s.orderShopInfo(paused, nil) }

// orderShopInfo is OrderShopInfo with the assistant's character last (runtime.ts offer: `{...offer.shop, character}`); nil: none.
func (s *Settings) orderShopInfo(paused bool, character json.RawMessage) json.RawMessage {
	kv := []any{"name", s.Name}
	if s.Address != "" {
		kv = append(kv, "address", s.Address)
	}
	payment := ordered("kind", "link")
	if s.Payment.Module == "upi" {
		payment = ordered("kind", "upi", "payee", s.Payment.Payee)
	}
	kv = append(kv, "timezone", s.Timezone, "languages", s.Languages, "payment", payment, "paused", paused,
		"advance", ordered("mode", s.Advance.Mode, "percent", s.Advance.Percent, "holdMinutes", s.Advance.HoldMinutes),
		"cancellation", ordered("windowHours", s.Cancellation.WindowHours), "character", character)
	return ordered(kv...)
}

// OrderOffer is channel.ts orderOffer: the menu, and each day from today to the shop's last day with its slots (open while their cut-off has not passed and the slot is not
// full), what is left of each item and whether the day's count is reached. Worked out from the orders themselves, as the agent's own limits are. `count` is the shop's stock
// count (nil: none counted).
func (s *Settings) OrderOffer(st *Store, count *listings.Stock, nowMs int64, paused bool) json.RawMessage {
	return s.orderOffer(st, count, nowMs, paused, nil)
}

func (s *Settings) orderOffer(st *Store, count *listings.Stock, nowMs int64, paused bool, character json.RawMessage) json.RawMessage {
	today := zone.LocalParts(nowMs, s.Timezone).Date
	days := []json.RawMessage{}
	for d := 0; int64(d) <= s.Orders.DaysAhead; d++ {
		date := DateOf(zone.AddDays(today, d))
		slots := []json.RawMessage{}
		for _, x := range s.AllSlots() {
			probe := &Order{Date: &date, SlotID: x.Slot.ID}
			s.FixSlot(probe)
			full := x.Slot.MaxOrders != nil && int64(st.OrdersInSlot(date, x.Slot.ID, nowMs, "")) >= *x.Slot.MaxOrders
			slots = append(slots, ordered("id", x.Slot.ID, "mode", probe.Mode, "fromMs", *probe.SlotStartMs, "toMs", *probe.SlotEndMs, "open", *probe.CutoffMs > nowMs && !full))
		}
		left := []any{}
		for i := range s.Menu {
			it := &s.Menu[i]
			n := max(0, it.DailyStock-st.TakenOf(date, it.ID, nowMs, ""))
			if c, counted := st.CountedLeft(count, it.ID, nowMs, ""); counted {
				n = min(n, c)
			}
			left = append(left, it.ID, n)
		}
		days = append(days, ordered("date", IsoOf(date), "slots", slots, "left", ordered(left...), "full", int64(st.OrdersOn(date, nowMs, "")) >= s.Orders.MaxPerDay))
	}
	kv := []any{"kind", "orders", "shop", s.orderShopInfo(paused, character), "items", s.publicItems(), "days", days}
	if s.Delivery != nil {
		kv = append(kv, "delivery", ordered("areas", s.Delivery.Area))
	}
	kv = append(kv, "maxItemsPerOrder", s.Orders.MaxItemsPerOrder)
	return ordered(kv...)
}

// publicStatus is channel.ts STATUS: an order's state as its page says it.
var publicStatus = map[string]string{
	Enquiry: "not_held", AwaitingOwner: "checking", AwaitingAdvance: "held", Confirmed: "confirmed", Expired: "expired", Cancelled: "cancelled", Completed: "done",
}

// requestOf is channel.ts requestOf: the order's owner-marked request, by its link id.
func (st *Store) requestOf(o *Order) *ownermarked.MarkedRequest {
	l := st.Ledger(false)
	if l == nil {
		return nil
	}
	for _, r := range l.Requests {
		if r.ID == o.LinkID {
			return r
		}
	}
	return nil
}

// OrderOfHandle is channel.ts orderOf: a page's order by its handle's hash, the one lookup the page's read and its receipts share. A refused request has no order; an order answers
// only to its own handle.
func (st *Store) OrderOfHandle(hash string) *Order {
	r := st.Requests().Get(hash)
	if r == nil || r.Refused != nil || r.Booking == nil {
		return nil
	}
	if o := st.Order(*r.Booking); o != nil && o.Handle == hash {
		return o
	}
	return nil
}

// payOf is channel.ts payOf: how to pay a held order: the owner-marked UPI request (what is still asked, after a part was marked), or the gateway's link.
func (s *Settings) payOf(st *Store, o *Order) (json.RawMessage, string) {
	if s.Payment.Module == "upi" {
		r := st.requestOf(o)
		if r == nil {
			return nil, ""
		}
		left := ownermarked.LeftOn(r)
		link := r.Link
		if left > 0 && left < r.AmountPaise {
			if l, err := s.UpiPayLink()(left, r.Reference); err == nil {
				link = l
			}
		}
		return ordered("kind", "upi", "link", link, "payTo", ordered("id", s.Payment.UpiID, "name", s.Payment.Payee), "amountPaise", r.AmountPaise, "leftPaise", left, "note", r.Reference), "upi"
	}
	if o.LinkURL != "" {
		return ordered("kind", "link", "url", o.LinkURL), "link"
	}
	return nil, ""
}

// OrderView is channel.ts orderView: one request by its handle's hash, as its own page may show it; nil when the store has none (the runtime then says whether its task waits).
func (s *Settings) OrderView(st *Store, hash string) json.RawMessage {
	req := st.Requests().Get(hash)
	if req == nil {
		return nil
	}
	if req.Refused != nil || req.Booking == nil {
		reason := "unknown"
		if req.Refused != nil {
			reason = *req.Refused
		}
		return ordered("status", "refused", "reason", reason, "channel", req.Channel)
	}
	o := st.OrderOfHandle(hash)
	if o == nil {
		return nil
	}
	status := publicStatus[o.State]
	var pay json.RawMessage
	payKind := ""
	if status == "held" {
		pay, payKind = s.payOf(st, o)
	}
	lines := []json.RawMessage{}
	for _, l := range o.Lines {
		names := json.RawMessage(nil)
		var price int64
		if it := s.ItemOf(l.ItemID); it != nil {
			names, price = s.itemNames(it), it.PriceInr
		} else {
			kv := []any{}
			for _, lang := range runtime.LANGUAGES {
				kv = append(kv, lang, l.ItemID)
			}
			names = ordered(kv...)
		}
		lines = append(lines, ordered("itemId", l.ItemID, "names", names, "qty", l.Qty, "priceInr", price))
	}
	kv := []any{"status", status, "ref", o.ID}
	if o.Channel != "" {
		kv = append(kv, "channel", o.Channel)
	}
	kv = append(kv, "lines", lines, "totalInr", numRaw(o.TotalInr), "advanceInr", numRaw(o.AdvanceInr))
	if o.Date != nil {
		kv = append(kv, "date", IsoOf(*o.Date))
	}
	kv = append(kv, "mode", strRaw(o.Mode))
	if o.SlotID != "" && o.SlotStartMs != nil && o.SlotEndMs != nil {
		kv = append(kv, "slot", ordered("id", o.SlotID, "fromMs", *o.SlotStartMs, "toMs", *o.SlotEndMs))
	}
	kv = append(kv, "area", strRaw(o.Area))
	if status == "held" {
		kv = append(kv, "holdExpiresAt", numRaw(o.HoldExpiresAt))
	}
	kv = append(kv, "pay", pay,
		// what the WhatsApp "cancel" takes (agent.ts onCancel): one waiting for the owner or its advance ends at once; a confirmed one follows the cancellation window
		"canCancel", status == "checking" || status == "held" || status == "confirmed",
		"canSayPaid", status == "held" && payKind == "upi",
		"claimed", o.ClaimAtMs != nil)
	messages := []json.RawMessage{}
	var outbox []runtime.OutboxMessage
	if cs := st.channelRead(); cs != nil {
		outbox = cs.Outbox
	}
	for _, m := range outbox {
		if m.To == o.Customer {
			messages = append(messages, ordered("atMs", m.AtMs, "text", m.Text))
		}
	}
	return ordered(append(kv, "messages", messages)...)
}

// LateWindowMs and LateClaimWindowMs are channel.ts LATE_WINDOW_MS and LATE_CLAIM_WINDOW_MS: how long after a hold ended the owner's page still lists "money may have come" (48
// hours), and after the customer said they paid (14 days).
const (
	LateWindowMs      = 48 * 3_600_000
	LateClaimWindowMs = 14 * 24 * 3_600_000
)

// lateRequest is channel.ts lateRequest: an expired order whose UPI request is still open to a mark (its code stays live after the hold ended) and has none, bounded in time.
func (st *Store) lateRequest(o *Order, nowMs int64) *ownermarked.MarkedRequest {
	if o.State != Expired {
		return nil
	}
	r := st.requestOf(o)
	if r == nil || r.Code == nil || len(r.Marks) > 0 || o.AdvancePaymentID != "" {
		return nil
	}
	var closed int64
	if r.ClosedAtMs != nil {
		closed = *r.ClosedAtMs
	}
	since, window := closed, int64(LateWindowMs)
	if o.ClaimAtMs != nil {
		since, window = max(*o.ClaimAtMs, closed), LateClaimWindowMs
	}
	if nowMs-since < window {
		return r
	}
	return nil
}

// OwnerItem is channel.ts OwnerItem: one thing the owner can answer from their page. Code is the owner-marked one-use code the press stands for; it never leaves the runtime
// (JSON leaves it out).
type OwnerItem struct {
	Kind, Case, Digest string
	Actions            []string
	AmountPaise        int64
	Customer           json.RawMessage
	Channel            string
	What               string
	StartMs            *int64
	Why                *string // a refund owed: why, in the template's words (`why` is always written for one, even "")
	ClaimedAtMs        *int64
	UpiRef             string
	Code               string
	// Deal is a waiting price card (E1, kind "discount"): the page shows its item, quantity, menu price, price asked and the order's total, and a press sends
	// "approve o-3 <code>" with ITS code (never Code above, which is a UPI mark's). DealName is the item's name in the owner's language.
	Deal     *discounts.Deal
	DealName string
}

// JSON is the item as the owner's page reads it, in the TypeScript's member order, never with its code.
func (it OwnerItem) JSON() json.RawMessage {
	kv := []any{"kind", it.Kind, "case", it.Case, "digest", it.Digest, "actions", it.Actions, "amountPaise", it.AmountPaise, "customer", it.Customer, "channel", it.Channel,
		"what", it.What, "startMs", numRaw(it.StartMs)}
	if it.Why != nil {
		kv = append(kv, "why", *it.Why)
	}
	kv = append(kv, "claimedAtMs", numRaw(it.ClaimedAtMs), "upiRef", strRaw(it.UpiRef))
	if d := it.Deal; d != nil { // only a price card has it, so every other item keeps its bytes; never the card's code
		kv = append(kv, "deal", ordered("name", it.DealName, "qty", d.Qty, "listInr", d.ListInr, "offeredInr", d.OfferedInr, "totalInr", d.TotalInr))
	}
	return ordered(kv...)
}

// digestOf is channel.ts digestOf: the SHA-256 of JSON.stringify(parts), 32 hex digits.
func digestOf(parts ...any) string {
	h := sha256.Sum256(jsonOf(parts))
	return hex.EncodeToString(h[:])[:32]
}

// OrderWhat is channel.ts orderWhat: the order in the owner's words, its lines from the shop's menu ("2 × Veg thali, 1 × Curd"), or a plan's name; lang "" is the owner's.
func (s *Settings) OrderWhat(o *Order, lang string) string {
	if lang == "" {
		lang = s.Owner.Language
	}
	if o.Plan != nil {
		name := o.Plan.TypeID // a plan type no longer in the settings (the TypeScript would throw on it)
		if t := s.PlanTypeOf(o.Plan.TypeID); t != nil {
			name = PlanName(t, lang)
		}
		return name + " (monthly plan)"
	}
	return s.ItemsText(o.Lines, lang)
}

// guestLabel is chat-guest.ts guestLabel: "Chat guest 3" for a chat guest (the words alone when the number is no longer kept).
func (st *Store) guestLabel(conversation, lang string) string {
	if !runtime.IsChatConversation(conversation) {
		return conversation
	}
	if cs := st.channelRead(); cs != nil {
		if g := cs.Guest(conversation); g != nil && g.N != 0 {
			return ChatGuestWords(lang) + " " + strconv.FormatInt(g.N, 10)
		}
	}
	return ChatGuestWords(lang)
}

// customerOf is channel.ts customerOf as ownerItems uses it: a chat guest by their label (no phone); a page order's customer by the name and number typed; else the number.
func (s *Settings) customerOf(st *Store, o *Order, phone string) json.RawMessage {
	if runtime.IsChatConversation(phone) {
		return ordered("phone", "", "name", st.guestLabel(phone, s.Owner.Language))
	}
	if o != nil && o.Contact != nil {
		if o.Contact.Name != "" {
			return ordered("phone", o.Contact.Phone, "name", o.Contact.Name)
		}
		return ordered("phone", o.Contact.Phone)
	}
	return ordered("phone", phone)
}

func channelOf(o *Order) string {
	switch {
	case o != nil && runtime.IsChatConversation(o.Customer):
		return "chat"
	case o != nil && o.Channel != "":
		return o.Channel
	}
	return "whatsapp"
}

// Upcoming is one confirmed order of the coming week, for the owner's list.
type Upcoming struct {
	Case     string
	StartMs  int64
	What     string
	Customer json.RawMessage
	Channel  string
	State    string
}

// JSON is the entry as the owner's page reads it.
func (u Upcoming) JSON() json.RawMessage {
	return ordered("case", u.Case, "startMs", u.StartMs, "what", u.What, "customer", u.Customer, "channel", u.Channel, "state", u.State)
}

// OwnerItems is channel.ts ownerItems: everything the owner can answer from their page (an advance to mark received, a hold that ended where money may have come, a refund the
// owner owes, a big order, a late cancellation's refund), only what the agent would act on now; and the confirmed orders of the coming week.
func (s *Settings) OwnerItems(st *Store, nowMs int64) ([]OwnerItem, []Upcoming) {
	var items []OwnerItem
	at := func(o *Order, it *OwnerItem) {
		if o != nil && o.SlotStartMs != nil {
			v := *o.SlotStartMs
			it.StartMs = &v
		}
	}
	claim := func(o *Order, it *OwnerItem) {
		if o.ClaimAtMs != nil {
			v := *o.ClaimAtMs
			it.ClaimedAtMs = &v
		}
		it.UpiRef = o.ClaimRef
	}
	l := st.Ledger(false)
	if l != nil {
		for _, r := range l.Requests {
			o := st.Order(r.Reference)
			if o == nil || o.State != AwaitingAdvance || r.Code == nil || (r.Status != ownermarked.StatusCreated && r.Status != ownermarked.StatusPartiallyPaid) {
				continue
			}
			left := ownermarked.LeftOn(r)
			it := OwnerItem{Kind: "deposit", Case: o.ID, Digest: digestOf("advance", o.ID, r.ID, left, len(r.Marks), len(r.UsedCodes)), Actions: []string{"received"},
				AmountPaise: left, Customer: s.customerOf(st, o, o.Customer), Channel: channelOf(o), What: s.OrderWhat(o, ""), Code: *r.Code}
			at(o, &it)
			claim(o, &it)
			items = append(items, it)
		}
	}
	for _, o := range st.Orders {
		r := st.lateRequest(o, nowMs)
		if r == nil || r.Code == nil {
			continue
		}
		it := OwnerItem{Kind: "late_deposit", Case: o.ID, Digest: digestOf("late_advance", o.ID, r.ID, r.AmountPaise, len(r.UsedCodes)), Actions: []string{"received"},
			AmountPaise: r.AmountPaise, Customer: s.customerOf(st, o, o.Customer), Channel: channelOf(o), What: s.OrderWhat(o, ""), Code: *r.Code}
		at(o, &it)
		claim(o, &it)
		items = append(items, it)
	}
	if l != nil {
		for _, r := range l.Refunds {
			if r.State != ownermarked.RefundOwed || r.Code == nil {
				continue
			}
			o := st.Order(r.CaseID)
			actions := []string{"refunded"}
			if r.KeepAllowed {
				actions = []string{"refunded", "kept"}
			}
			what := ""
			if o != nil {
				what = s.OrderWhat(o, "")
			}
			why := r.Why
			it := OwnerItem{Kind: "refund_owed", Case: r.CaseID, Digest: digestOf("refund_owed", r.CaseID, r.ID, r.AmountPaise, r.KeepAllowed, len(r.UsedCodes)), Actions: actions,
				AmountPaise: r.AmountPaise, Customer: s.customerOf(st, o, r.Customer), Channel: channelOf(o), What: what, Why: &why, Code: *r.Code}
			at(o, &it)
			items = append(items, it)
		}
	}
	for _, o := range st.Orders {
		if len(o.Pending) == 0 {
			continue
		}
		var it OwnerItem
		if b := BigOrderOf(o.Pending[0]); b != nil {
			it = OwnerItem{Kind: "big_order", Case: o.ID, Digest: digestOf("big_order", o.ID, b.TotalInr, b.AskedAtMs), Actions: []string{"approve", "deny"}, AmountPaise: b.TotalInr * 100}
		} else if r := OwnerRefundOf(o.Pending[0]); r != nil {
			it = OwnerItem{Kind: "late_refund", Case: o.ID, Digest: digestOf("late_refund", o.ID, r.PaymentID, r.AmountInr*100), Actions: []string{"approve", "deny"}, AmountPaise: r.AmountInr * 100}
		} else {
			continue
		}
		it.Customer, it.Channel, it.What = s.customerOf(st, o, o.Customer), channelOf(o), s.OrderWhat(o, "")
		at(o, &it)
		items = append(items, it)
	}
	// E1: a price card waiting for the owner (agent_discounts.go askedDeal). The digest is over the card's own code, which is over every field the card shows, so a press made on
	// an older card (the order changed since) or one already answered here or on WhatsApp finds nothing and does nothing. The amount shown is the order's total the card would agree.
	for _, o := range st.Orders {
		d := askedDeal(o)
		if d == nil {
			continue
		}
		name := d.Item
		if item := s.ItemOf(d.Item); item != nil {
			name = ItemName(item, s.Owner.Language)
		}
		it := OwnerItem{Kind: "discount", Case: o.ID, Digest: digestOf("discount", o.ID, d.Code), Actions: []string{"approve", "deny"}, AmountPaise: d.TotalInr * 100,
			Customer: s.customerOf(st, o, o.Customer), Channel: channelOf(o), What: s.OrderWhat(o, ""), Deal: d, DealName: name}
		at(o, &it)
		items = append(items, it)
	}
	// the confirmed orders of the next seven days (from two hours ago to midnight eight days on, in the shop's zone), soonest first, at most 50
	end := zone.ZonedToMs(zone.AddDays(zone.LocalParts(nowMs, s.Timezone).Date, 8), 0, 0, s.Timezone)
	var up []*Order
	for _, o := range st.Orders {
		if o.State == Confirmed && o.SlotStartMs != nil && *o.SlotStartMs >= nowMs-2*3_600_000 && *o.SlotStartMs < end {
			up = append(up, o)
		}
	}
	sort.SliceStable(up, func(i, j int) bool { return *up[i].SlotStartMs < *up[j].SlotStartMs })
	if len(up) > 50 {
		up = up[:50]
	}
	upcoming := []Upcoming{}
	for _, o := range up {
		what := s.OrderWhat(o, "")
		if o.Mode == Delivery && o.Area != "" {
			what += " · " + o.Area
		}
		upcoming = append(upcoming, Upcoming{Case: o.ID, StartMs: *o.SlotStartMs, What: what, Customer: s.customerOf(st, o, o.Customer), Channel: channelOf(o), State: o.State})
	}
	return items, upcoming
}

// OwnerView is channel.ts ownerView: the items without their codes, the shop's name and the owner's language, the coming week, and the Money section's figures worked out from
// the record. Orders has no services. `app` is the assistant's view, given by the caller (nil: no assistant, and the member is left out).
func (s *Settings) OwnerView(st *Store, nowMs int64, entries []store.Entry, app json.RawMessage) json.RawMessage {
	items, upcoming := s.OwnerItems(st, nowMs)
	shown := []json.RawMessage{}
	for _, it := range items {
		shown = append(shown, it.JSON())
	}
	up := []json.RawMessage{}
	for _, u := range upcoming {
		up = append(up, u.JSON())
	}
	untold := []accounting.UntoldInput{}
	for _, o := range st.Orders {
		for _, u := range o.RefundsUntold {
			untold = append(untold, accounting.UntoldInput{Case: o.ID, AmountInr: float64(u.AmountPaise) / 100}) // the TypeScript keeps amountInr; payments.UntoldRefund keeps paise (written back as amountInr)
		}
	}
	money := accounting.OwnerMoney(accounting.MoneyViewInput{Journal: OrdersJournal(entries), Entries: entries, RefundsUntold: untold, NowMs: nowMs, TimeZone: s.Timezone})
	return ordered("shop", ordered("name", s.Name, "timezone", s.Timezone, "ownerLanguage", s.Owner.Language), "kind", "orders", "services", []any{}, "items", shown,
		"upcoming", up, "money", money, "app", app)
}

// DocumentsOf is channel.ts documentsOf: the receipts and refund notes of the order the page with this handle's hash opens (the page's own lookup, so another order's number is
// never among them), newest first, drawn in the page's language; what each is for is the items and the day in that language.
func (s *Settings) DocumentsOf(st *Store, entries []store.Entry, hash, lang string) []accounting.Document {
	var cases []string
	if o := st.OrderOfHandle(hash); o != nil {
		cases = []string{o.ID}
	}
	whatFor := func(caseID, l string) string {
		x := st.Order(caseID)
		if x == nil {
			return ""
		}
		var parts []string
		if w := s.OrderWhat(x, l); w != "" {
			parts = append(parts, w)
		}
		if x.Date != nil {
			parts = append(parts, language.Formats(l).Date(x.Date.Year, x.Date.Month, x.Date.Day))
		}
		return strings.Join(parts, ", ")
	}
	return accounting.CaseDocuments(OrdersJournal(entries), cases, accounting.DocumentShop{Name: s.Name, Address: s.Address, Timezone: s.Timezone}, lang, whatFor, nil)
}

// ExportFilesOf is channel.ts exportFilesOf: the accountant's files for a period, from the record, with the two best-effort Tally files (no company name is put in them).
func (s *Settings) ExportFilesOf(entries []store.Entry, period string) ([]accounting.ExportFile, error) {
	return accounting.AccountantFiles(accounting.ExportInput{Journal: OrdersJournal(entries), Entries: entries, Period: period, TimeZone: s.Timezone, Tally: &accounting.TallyOptions{}})
}

// ChatWork is runtime.ts chatWork: a chat guest has made an order when an order beyond the first enquiry is theirs.
func (st *Store) ChatWork(conversation string) int {
	n := 0
	for _, o := range st.Orders {
		if o.Customer == conversation && o.State != Enquiry {
			n++
		}
	}
	return n
}
